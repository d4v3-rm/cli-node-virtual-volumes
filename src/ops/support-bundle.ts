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
  SupportBundleInspectionIssue,
  SupportBundleInspectionResult,
  SupportBundleResult,
} from '../domain/types.js';
import type { AppRuntime } from '../bootstrap/create-runtime.js';
import { resolveAppLogFilePath, resolveAuditLogFilePath } from '../logging/logger.js';
import { writeJsonAtomic, pathExists } from '../utils/fs.js';
import { SUPPORTED_VOLUME_SCHEMA_VERSION } from '../storage/sqlite-volume.js';

const SUPPORT_BUNDLE_VERSION = 1 as const;
const SUPPORT_BUNDLE_FILE_ROLES: SupportBundleFileRole[] = [
  'audit-log-snapshot',
  'backup-inspection',
  'backup-manifest',
  'doctor-report',
  'log-snapshot',
  'manifest',
];

const createTemporaryBundlePath = (destinationPath: string): string =>
  `${destinationPath}.${process.pid}.${Date.now()}.tmp`;

const normalizePathForComparison = (targetPath: string): string => {
  const resolved = path.resolve(targetPath);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
};

const samePath = (leftPath: string, rightPath: string): boolean =>
  normalizePathForComparison(leftPath) === normalizePathForComparison(rightPath);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const isStringOrNull = (value: unknown): value is string | null =>
  typeof value === 'string' || value === null;

const isNonNegativeNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0;

const isSupportBundleFileRole = (
  value: unknown,
): value is SupportBundleFileRole =>
  typeof value === 'string' &&
  SUPPORT_BUNDLE_FILE_ROLES.includes(value as SupportBundleFileRole);

const isSupportBundleFileRecord = (
  value: unknown,
): value is SupportBundleFileRecord => {
  if (!isRecord(value)) {
    return false;
  }

  return (
    isSupportBundleFileRole(value.role) &&
    typeof value.path === 'string' &&
    typeof value.relativePath === 'string' &&
    isNonNegativeNumber(value.bytes) &&
    typeof value.checksumSha256 === 'string' &&
    /^[0-9a-f]{64}$/u.test(value.checksumSha256) &&
    isStringOrNull(value.sourcePath)
  );
};

const isSupportBundleChecksumManifest = (
  value: unknown,
): value is SupportBundleChecksumManifest => {
  if (!isRecord(value)) {
    return false;
  }

  return (
    value.bundleVersion === SUPPORT_BUNDLE_VERSION &&
    typeof value.generatedAt === 'string' &&
    typeof value.bundlePath === 'string' &&
    Array.isArray(value.files) &&
    value.files.every((file) => isSupportBundleFileRecord(file))
  );
};

const isSupportBundleResult = (value: unknown): value is SupportBundleResult => {
  if (!isRecord(value) || !isRecord(value.config) || !isRecord(value.environment)) {
    return false;
  }

  return (
    value.bundleVersion === SUPPORT_BUNDLE_VERSION &&
    typeof value.cliVersion === 'string' &&
    typeof value.correlationId === 'string' &&
    typeof value.generatedAt === 'string' &&
    isNonNegativeNumber(value.supportedVolumeSchemaVersion) &&
    isStringOrNull(value.volumeId) &&
    isStringOrNull(value.backupPath) &&
    typeof value.healthy === 'boolean' &&
    isNonNegativeNumber(value.checkedVolumes) &&
    isNonNegativeNumber(value.issueCount) &&
    typeof value.bundlePath === 'string' &&
    typeof value.manifestPath === 'string' &&
    typeof value.doctorReportPath === 'string' &&
    isStringOrNull(value.backupInspectionReportPath) &&
    isStringOrNull(value.backupManifestCopyPath) &&
    typeof value.checksumsPath === 'string' &&
    isStringOrNull(value.auditLogSnapshotPath) &&
    isStringOrNull(value.logSnapshotPath) &&
    typeof value.config.auditLogDir === 'string' &&
    typeof value.config.auditLogLevel === 'string' &&
    typeof value.config.dataDir === 'string' &&
    Array.isArray(value.config.hostAllowPaths) &&
    value.config.hostAllowPaths.every((entry) => typeof entry === 'string') &&
    Array.isArray(value.config.hostDenyPaths) &&
    value.config.hostDenyPaths.every((entry) => typeof entry === 'string') &&
    typeof value.config.logDir === 'string' &&
    typeof value.config.logLevel === 'string' &&
    typeof value.config.logToStdout === 'boolean' &&
    isNonNegativeNumber(value.config.defaultQuotaBytes) &&
    isNonNegativeNumber(value.config.previewBytes) &&
    typeof value.environment.platform === 'string' &&
    typeof value.environment.arch === 'string' &&
    typeof value.environment.nodeVersion === 'string' &&
    typeof value.environment.hostname === 'string' &&
    typeof value.environment.cwd === 'string'
  );
};

const readJsonFileSafe = async (filePath: string): Promise<unknown> =>
  JSON.parse(await fs.readFile(filePath, 'utf8')) as unknown;

const addInspectionIssue = (
  issues: SupportBundleInspectionIssue[],
  issue: SupportBundleInspectionIssue,
): void => {
  issues.push(issue);
};

const validateBundlePath = (
  issues: SupportBundleInspectionIssue[],
  actualPath: string,
  expectedPath: string,
  message: string,
  role?: SupportBundleFileRole,
): void => {
  if (!samePath(actualPath, expectedPath)) {
    addInspectionIssue(issues, {
      code: 'MANIFEST_PATH_MISMATCH',
      severity: 'error',
      message,
      path: actualPath,
      role,
    });
  }
};

const getExpectedBundleFiles = (
  manifest: SupportBundleResult,
): { path: string; role: SupportBundleFileRole }[] => {
  const files: { path: string; role: SupportBundleFileRole }[] = [
    { path: manifest.manifestPath, role: 'manifest' },
    { path: manifest.doctorReportPath, role: 'doctor-report' },
  ];

  if (manifest.backupInspectionReportPath) {
    files.push({
      path: manifest.backupInspectionReportPath,
      role: 'backup-inspection',
    });
  }

  if (manifest.backupManifestCopyPath) {
    files.push({
      path: manifest.backupManifestCopyPath,
      role: 'backup-manifest',
    });
  }

  if (manifest.logSnapshotPath) {
    files.push({
      path: manifest.logSnapshotPath,
      role: 'log-snapshot',
    });
  }

  if (manifest.auditLogSnapshotPath) {
    files.push({
      path: manifest.auditLogSnapshotPath,
      role: 'audit-log-snapshot',
    });
  }

  return files;
};

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
    const currentAuditLogPath = resolveAuditLogFilePath(runtime.config);
    const logSnapshotPath = (await pathExists(currentLogPath))
      ? path.join(destinationPath, 'logs', path.basename(currentLogPath))
      : null;
    const auditLogSnapshotPath = (await pathExists(currentAuditLogPath))
      ? path.join(destinationPath, 'audit', path.basename(currentAuditLogPath))
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

    if (auditLogSnapshotPath) {
      const temporaryAuditLogSnapshotPath = path.join(
        temporaryBundlePath,
        'audit',
        path.basename(currentAuditLogPath),
      );
      await fs.mkdir(path.dirname(temporaryAuditLogSnapshotPath), { recursive: true });
      await fs.copyFile(currentAuditLogPath, temporaryAuditLogSnapshotPath);
    }

    const result: SupportBundleResult = {
      bundleVersion: SUPPORT_BUNDLE_VERSION,
      cliVersion: APP_VERSION,
      correlationId: runtime.correlationId,
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
      auditLogSnapshotPath,
      logSnapshotPath,
      config: {
        auditLogDir: runtime.config.auditLogDir,
        auditLogLevel: runtime.config.auditLogLevel,
        dataDir: runtime.config.dataDir,
        hostAllowPaths: [...runtime.config.hostAllowPaths],
        hostDenyPaths: [...runtime.config.hostDenyPaths],
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

    if (auditLogSnapshotPath) {
      files.push(
        await buildBundleFileRecord(
          destinationPath,
          temporaryBundlePath,
          path.join(temporaryBundlePath, 'audit', path.basename(currentAuditLogPath)),
          'audit-log-snapshot',
          currentAuditLogPath,
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

export const inspectSupportBundle = async (
  bundlePath: string,
): Promise<SupportBundleInspectionResult> => {
  const absoluteBundlePath = path.resolve(bundlePath);
  const bundleStats = await fs.stat(absoluteBundlePath).catch(() => null);

  if (!bundleStats) {
    throw new VolumeError(
      'NOT_FOUND',
      `Support bundle does not exist: ${absoluteBundlePath}`,
      {
        bundlePath: absoluteBundlePath,
      },
    );
  }

  if (!bundleStats.isDirectory()) {
    throw new VolumeError(
      'INVALID_OPERATION',
      `Support bundle path must be a directory: ${absoluteBundlePath}`,
      {
        bundlePath: absoluteBundlePath,
      },
    );
  }

  const manifestPath = path.join(absoluteBundlePath, 'manifest.json');
  const checksumsPath = path.join(absoluteBundlePath, 'checksums.json');
  const issues: SupportBundleInspectionIssue[] = [];
  let manifest: SupportBundleResult | null = null;
  let checksumManifest: SupportBundleChecksumManifest | null = null;
  let verifiedFiles = 0;

  if (!(await pathExists(manifestPath))) {
    addInspectionIssue(issues, {
      code: 'MISSING_BUNDLE_FILE',
      severity: 'error',
      message: 'Support bundle manifest is missing.',
      path: manifestPath,
      relativePath: 'manifest.json',
      role: 'manifest',
    });
  } else {
    try {
      const manifestCandidate = await readJsonFileSafe(manifestPath);
      if (isSupportBundleResult(manifestCandidate)) {
        manifest = manifestCandidate;
      } else {
        addInspectionIssue(issues, {
          code: 'INVALID_BUNDLE_MANIFEST',
          severity: 'error',
          message: 'Support bundle manifest has an invalid structure.',
          path: manifestPath,
        });
      }
    } catch {
      addInspectionIssue(issues, {
        code: 'INVALID_BUNDLE_MANIFEST',
        severity: 'error',
        message: 'Support bundle manifest could not be parsed as JSON.',
        path: manifestPath,
      });
    }
  }

  if (!(await pathExists(checksumsPath))) {
    addInspectionIssue(issues, {
      code: 'MISSING_BUNDLE_FILE',
      severity: 'error',
      message: 'Support bundle checksum inventory is missing.',
      path: checksumsPath,
      relativePath: 'checksums.json',
    });
  } else {
    try {
      const checksumCandidate = await readJsonFileSafe(checksumsPath);
      if (isSupportBundleChecksumManifest(checksumCandidate)) {
        checksumManifest = checksumCandidate;
      } else {
        addInspectionIssue(issues, {
          code: 'INVALID_CHECKSUM_MANIFEST',
          severity: 'error',
          message: 'Support bundle checksum inventory has an invalid structure.',
          path: checksumsPath,
        });
      }
    } catch {
      addInspectionIssue(issues, {
        code: 'INVALID_CHECKSUM_MANIFEST',
        severity: 'error',
        message: 'Support bundle checksum inventory could not be parsed as JSON.',
        path: checksumsPath,
      });
    }
  }

  if (manifest) {
    if (manifest.bundleVersion !== SUPPORT_BUNDLE_VERSION) {
      addInspectionIssue(issues, {
        code: 'UNSUPPORTED_BUNDLE_VERSION',
        severity: 'error',
        message: `Support bundle version ${String(manifest.bundleVersion)} is not supported.`,
        path: manifestPath,
      });
    }

    validateBundlePath(
      issues,
      manifest.bundlePath,
      absoluteBundlePath,
      'Support bundle manifest points to a different bundle path.',
    );
    validateBundlePath(
      issues,
      manifest.manifestPath,
      manifestPath,
      'Support bundle manifest points to an unexpected manifest path.',
      'manifest',
    );
    validateBundlePath(
      issues,
      manifest.checksumsPath,
      checksumsPath,
      'Support bundle manifest points to an unexpected checksum manifest path.',
    );

    if (checksumManifest) {
      for (const expectedFile of getExpectedBundleFiles(manifest)) {
        const checksumRecord = checksumManifest.files.find(
          (file) => file.role === expectedFile.role,
        );

        if (!checksumRecord) {
          addInspectionIssue(issues, {
            code: 'MISSING_CHECKSUM_RECORD',
            severity: 'error',
            message: `Checksum inventory is missing a record for ${expectedFile.role}.`,
            path: expectedFile.path,
            role: expectedFile.role,
          });
          continue;
        }

        validateBundlePath(
          issues,
          checksumRecord.path,
          expectedFile.path,
          `Checksum inventory points to an unexpected path for ${expectedFile.role}.`,
          expectedFile.role,
        );
        validateBundlePath(
          issues,
          path.resolve(absoluteBundlePath, checksumRecord.relativePath),
          expectedFile.path,
          `Checksum inventory relative path does not match the expected file for ${expectedFile.role}.`,
          expectedFile.role,
        );
      }
    }
  }

  if (checksumManifest) {
    if (checksumManifest.bundleVersion !== SUPPORT_BUNDLE_VERSION) {
      addInspectionIssue(issues, {
        code: 'UNSUPPORTED_BUNDLE_VERSION',
        severity: 'error',
        message: `Checksum inventory bundle version ${String(checksumManifest.bundleVersion)} is not supported.`,
        path: checksumsPath,
      });
    }

    validateBundlePath(
      issues,
      checksumManifest.bundlePath,
      absoluteBundlePath,
      'Checksum inventory points to a different bundle path.',
    );

    for (const fileRecord of checksumManifest.files) {
      const expectedFilePath = path.resolve(
        absoluteBundlePath,
        fileRecord.relativePath,
      );
      validateBundlePath(
        issues,
        fileRecord.path,
        expectedFilePath,
        `Checksum inventory absolute path does not match ${fileRecord.relativePath}.`,
        fileRecord.role,
      );

      if (!(await pathExists(expectedFilePath))) {
        addInspectionIssue(issues, {
          code: 'MISSING_BUNDLE_FILE',
          severity: 'error',
          message: `Support bundle file is missing: ${fileRecord.relativePath}.`,
          path: expectedFilePath,
          relativePath: fileRecord.relativePath,
          role: fileRecord.role,
        });
        continue;
      }

      verifiedFiles += 1;
      const fileStats = await fs.stat(expectedFilePath);
      if (fileStats.size !== fileRecord.bytes) {
        addInspectionIssue(issues, {
          code: 'FILE_SIZE_MISMATCH',
          severity: 'error',
          message: `Support bundle file size does not match inventory for ${fileRecord.relativePath}.`,
          path: expectedFilePath,
          relativePath: fileRecord.relativePath,
          role: fileRecord.role,
        });
      }

      const checksumSha256 = await computeFileSha256(expectedFilePath);
      if (checksumSha256 !== fileRecord.checksumSha256) {
        addInspectionIssue(issues, {
          code: 'CHECKSUM_MISMATCH',
          severity: 'error',
          message: `Support bundle checksum does not match inventory for ${fileRecord.relativePath}.`,
          path: expectedFilePath,
          relativePath: fileRecord.relativePath,
          role: fileRecord.role,
        });
      }
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    healthy: issues.length === 0,
    bundlePath: absoluteBundlePath,
    manifestPath,
    checksumsPath,
    bundleVersion: manifest?.bundleVersion ?? checksumManifest?.bundleVersion ?? null,
    bundleCliVersion: manifest?.cliVersion ?? null,
    bundleCorrelationId: manifest?.correlationId ?? null,
    bundleCreatedAt: manifest?.generatedAt ?? checksumManifest?.generatedAt ?? null,
    volumeId: manifest?.volumeId ?? null,
    issueCount: issues.length,
    expectedFiles: checksumManifest?.files.length ?? 0,
    verifiedFiles,
    issues,
  };
};
