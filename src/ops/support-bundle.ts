import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { APP_VERSION } from '../config/app-metadata.js';
import { VolumeError } from '../domain/errors.js';
import type {
  CreateSupportBundleInput,
  SupportBundleResult,
} from '../domain/types.js';
import type { AppRuntime } from '../bootstrap/create-runtime.js';
import { resolveAppLogFilePath } from '../logging/logger.js';
import { writeJsonAtomic, pathExists } from '../utils/fs.js';
import { SUPPORTED_VOLUME_SCHEMA_VERSION } from '../storage/sqlite-volume.js';

const SUPPORT_BUNDLE_VERSION = 1 as const;

const createTemporaryBundlePath = (destinationPath: string): string =>
  `${destinationPath}.${process.pid}.${Date.now()}.tmp`;

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
