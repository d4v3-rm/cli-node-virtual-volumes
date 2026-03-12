import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { APP_VERSION } from '../config/app-metadata.js';
import { VolumeError } from '../domain/errors.js';
import type {
  CreateSupportBundleInput,
  SupportBundleChecksumManifest,
  SupportBundleFileRecord,
  SupportBundleFileRole,
  SupportBundleResult,
} from '../domain/types.js';
import type { AppRuntime } from '../bootstrap/create-runtime.js';
import { resolveAppLogFilePath } from '../logging/logger.js';
import { writeJsonAtomic, pathExists } from '../utils/fs.js';
import { SUPPORTED_VOLUME_SCHEMA_VERSION } from '../storage/sqlite-volume.js';

const SUPPORT_BUNDLE_VERSION = 1 as const;

const createTemporaryBundlePath = (destinationPath: string): string =>
  `${destinationPath}.${process.pid}.${Date.now()}.tmp`;

const computeFileSha256 = async (filePath: string): Promise<string> =>
  new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(filePath);

    stream.on('data', (chunk) => {
      hash.update(chunk);
    });
    stream.on('error', reject);
    stream.on('end', () => {
      resolve(hash.digest('hex'));
    });
  });

const buildBundleFileRecord = async (
  bundlePath: string,
  bundleSourcePath: string,
  filePath: string,
  role: SupportBundleFileRole,
  sourcePath: string | null,
): Promise<SupportBundleFileRecord> => {
  const stats = await fs.stat(filePath);
  const relativePath = path.relative(bundleSourcePath, filePath);

  return {
    role,
    path: path.join(path.resolve(bundlePath), relativePath),
    relativePath,
    bytes: stats.size,
    checksumSha256: await computeFileSha256(filePath),
    sourcePath,
  };
};

export const createSupportBundle = async (
  runtime: AppRuntime,
  input: CreateSupportBundleInput,
): Promise<SupportBundleResult> => {
  const destinationPath = path.resolve(input.destinationPath);
  const temporaryBundlePath = createTemporaryBundlePath(destinationPath);
  const backupPath = input.backupPath ? path.resolve(input.backupPath) : null;

  if ((await pathExists(destinationPath)) && !input.overwrite) {
    throw new VolumeError(
      'ALREADY_EXISTS',
      `Support bundle destination already exists: ${destinationPath}`,
      {
        destinationPath,
      },
    );
  }

  await fs.rm(temporaryBundlePath, { recursive: true, force: true });

  try {
    if (input.overwrite) {
      await fs.rm(destinationPath, { recursive: true, force: true });
    }

    const doctorReport = await runtime.volumeService.runDoctor(input.volumeId);
    const backupInspection = backupPath
      ? await runtime.volumeService.inspectVolumeBackup(backupPath)
      : null;
    const generatedAt = new Date().toISOString();
    const doctorReportPath = path.join(destinationPath, 'doctor-report.json');
    const backupInspectionReportPath = backupInspection
      ? path.join(destinationPath, 'backup-inspection.json')
      : null;
    const backupManifestCopyPath = backupInspection?.manifestPath
      ? path.join(destinationPath, 'backup-artifact.manifest.json')
      : null;
    const checksumsPath = path.join(destinationPath, 'checksums.json');

    const currentLogPath = resolveAppLogFilePath(runtime.config);
    const logSnapshotPath = (await pathExists(currentLogPath))
      ? path.join(destinationPath, 'logs', path.basename(currentLogPath))
      : null;

    await writeJsonAtomic(
      path.join(temporaryBundlePath, 'doctor-report.json'),
      doctorReport,
    );

    if (backupInspection) {
      await writeJsonAtomic(
        path.join(temporaryBundlePath, 'backup-inspection.json'),
        backupInspection,
      );
    }

    if (backupInspection?.manifestPath && backupManifestCopyPath) {
      await fs.copyFile(
        backupInspection.manifestPath,
        path.join(temporaryBundlePath, 'backup-artifact.manifest.json'),
      );
    }

    if (logSnapshotPath) {
      const temporaryLogSnapshotPath = path.join(
        temporaryBundlePath,
        'logs',
        path.basename(currentLogPath),
      );
      await fs.mkdir(path.dirname(temporaryLogSnapshotPath), { recursive: true });
      await fs.copyFile(currentLogPath, temporaryLogSnapshotPath);
    }

    const result: SupportBundleResult = {
      bundleVersion: SUPPORT_BUNDLE_VERSION,
      cliVersion: APP_VERSION,
      generatedAt,
      supportedVolumeSchemaVersion: SUPPORTED_VOLUME_SCHEMA_VERSION,
      volumeId: input.volumeId ?? null,
      backupPath,
      healthy: doctorReport.healthy,
      checkedVolumes: doctorReport.checkedVolumes,
      issueCount: doctorReport.issueCount,
      bundlePath: destinationPath,
      manifestPath: path.join(destinationPath, 'manifest.json'),
      doctorReportPath,
      backupInspectionReportPath,
      backupManifestCopyPath,
      checksumsPath,
      logSnapshotPath,
      config: {
        dataDir: runtime.config.dataDir,
        logDir: runtime.config.logDir,
        logLevel: runtime.config.logLevel,
        logToStdout: runtime.config.logToStdout,
        defaultQuotaBytes: runtime.config.defaultQuotaBytes,
        previewBytes: runtime.config.previewBytes,
      },
      environment: {
        platform: process.platform,
        arch: process.arch,
        nodeVersion: process.version,
        hostname: os.hostname(),
        cwd: process.cwd(),
      },
    };

    await writeJsonAtomic(path.join(temporaryBundlePath, 'manifest.json'), result);

    const files: SupportBundleFileRecord[] = [
      await buildBundleFileRecord(
        destinationPath,
        temporaryBundlePath,
        path.join(temporaryBundlePath, 'manifest.json'),
        'manifest',
        null,
      ),
      await buildBundleFileRecord(
        destinationPath,
        temporaryBundlePath,
        path.join(temporaryBundlePath, 'doctor-report.json'),
        'doctor-report',
        null,
      ),
    ];

    if (backupInspectionReportPath) {
      files.push(
        await buildBundleFileRecord(
          destinationPath,
          temporaryBundlePath,
          path.join(temporaryBundlePath, 'backup-inspection.json'),
          'backup-inspection',
          backupPath,
        ),
      );
    }

    if (backupInspection?.manifestPath && backupManifestCopyPath) {
      files.push(
        await buildBundleFileRecord(
          destinationPath,
          temporaryBundlePath,
          path.join(temporaryBundlePath, 'backup-artifact.manifest.json'),
          'backup-manifest',
          backupInspection.manifestPath,
        ),
      );
    }

    if (logSnapshotPath) {
      files.push(
        await buildBundleFileRecord(
          destinationPath,
          temporaryBundlePath,
          path.join(temporaryBundlePath, 'logs', path.basename(currentLogPath)),
          'log-snapshot',
          currentLogPath,
        ),
      );
    }

    const checksumManifest: SupportBundleChecksumManifest = {
      bundleVersion: SUPPORT_BUNDLE_VERSION,
      generatedAt,
      bundlePath: destinationPath,
      files,
    };

    await writeJsonAtomic(
      path.join(temporaryBundlePath, 'checksums.json'),
      checksumManifest,
    );

    await fs.mkdir(path.dirname(destinationPath), { recursive: true });
    await fs.rename(temporaryBundlePath, destinationPath);

    return result;
  } catch (error) {
    await fs.rm(temporaryBundlePath, { recursive: true, force: true }).catch(
      () => undefined,
    );
    throw error;
  }
};
