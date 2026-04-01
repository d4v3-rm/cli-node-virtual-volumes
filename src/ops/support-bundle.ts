import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { APP_VERSION } from '../config/app-metadata.js';
import { VolumeError } from '../domain/errors.js';
import type {
  SupportBundleActionPlan,
  StorageDoctorReport,
  CreateSupportBundleInput,
  SupportBundleChecksumManifest,
  SupportBundleContentProfile,
  SupportBundleFileRecord,
  SupportBundleFileRole,
  SupportBundleInspectionIssue,
  SupportBundleInspectionResult,
  SupportBundleResult,
} from '../domain/types.js';
import type { AppRuntime } from '../bootstrap/create-runtime.js';
import { resolveAppLogFilePath, resolveAuditLogFilePath } from '../logging/logger.js';
import { writeJsonAtomic, pathExists } from '../utils/fs.js';
import {
  redactFilesystemPath,
  redactOpaqueValue,
  sanitizeObservabilityValue,
} from '../utils/observability-redaction.js';
import { SUPPORTED_VOLUME_SCHEMA_VERSION } from '../storage/sqlite-volume.js';

const SUPPORT_BUNDLE_VERSION = 1 as const;
const LOG_TAIL_READ_CHUNK_BYTES = 64 * 1024;
const SUPPORT_BUNDLE_FILE_ROLES: SupportBundleFileRole[] = [
  'action-plan',
  'audit-log-snapshot',
  'backup-inspection',
  'backup-manifest',
  'doctor-report',
  'handoff-report',
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

const isSupportBundleContentProfile = (
  value: unknown,
): value is SupportBundleContentProfile => {
  if (
    !isRecord(value) ||
    !Array.isArray(value.sharingNotes) ||
    !Array.isArray(value.disposalNotes)
  ) {
    return false;
  }

  return (
    typeof value.redacted === 'boolean' &&
    typeof value.includesAppLogSnapshot === 'boolean' &&
    typeof value.includesAuditLogSnapshot === 'boolean' &&
    typeof value.includesBackupInspection === 'boolean' &&
    typeof value.includesBackupManifestCopy === 'boolean' &&
    (value.sensitivity === 'sanitized' || value.sensitivity === 'restricted') &&
    (value.sharingRecommendation === 'external-shareable' ||
      value.sharingRecommendation === 'internal-only') &&
    isNonNegativeNumber(value.recommendedRetentionDays) &&
    value.sharingNotes.every((entry) => typeof entry === 'string') &&
    value.disposalNotes.every((entry) => typeof entry === 'string')
  );
};

const isSupportBundleResultLike = (
  value: unknown,
): value is Omit<SupportBundleResult, 'contentProfile'> & {
  contentProfile?: SupportBundleContentProfile;
} => {
  if (!isRecord(value) || !isRecord(value.config) || !isRecord(value.environment)) {
    return false;
  }

  return (
    value.bundleVersion === SUPPORT_BUNDLE_VERSION &&
    typeof value.cliVersion === 'string' &&
    typeof value.correlationId === 'string' &&
    typeof value.generatedAt === 'string' &&
    (value.doctorIntegrityDepth === 'metadata' ||
      value.doctorIntegrityDepth === 'deep' ||
      typeof value.doctorIntegrityDepth === 'undefined') &&
    isNonNegativeNumber(value.supportedVolumeSchemaVersion) &&
    isStringOrNull(value.volumeId) &&
    isStringOrNull(value.backupPath) &&
    typeof value.healthy === 'boolean' &&
    isNonNegativeNumber(value.checkedVolumes) &&
    isNonNegativeNumber(value.issueCount) &&
    typeof value.bundlePath === 'string' &&
    typeof value.manifestPath === 'string' &&
    typeof value.doctorReportPath === 'string' &&
    (typeof value.actionPlanPath === 'string' ||
      value.actionPlanPath === null ||
      typeof value.actionPlanPath === 'undefined') &&
    (typeof value.handoffReportPath === 'string' ||
      value.handoffReportPath === null ||
      typeof value.handoffReportPath === 'undefined') &&
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
    (typeof value.config.logRetentionDays === 'number' ||
      value.config.logRetentionDays === null) &&
    typeof value.config.redactSensitiveDetails === 'boolean' &&
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

const buildContentProfile = (options: {
  redacted: boolean;
  includesAppLogSnapshot: boolean;
  includesAuditLogSnapshot: boolean;
  includesBackupInspection: boolean;
  includesBackupManifestCopy: boolean;
}): SupportBundleContentProfile => {
  const sharingNotes: string[] = [];
  const disposalNotes: string[] = [];

  if (!options.redacted) {
    sharingNotes.push('Runtime metadata and embedded reports are not redacted.');
  }

  if (options.includesAppLogSnapshot || options.includesAuditLogSnapshot) {
    sharingNotes.push(
      'Log snapshots are included and may contain sensitive operational context.',
    );
  }

  if (options.includesBackupManifestCopy) {
    sharingNotes.push(
      'A backup manifest copy is included for artifact correlation and recovery review.',
    );
  }

  if (sharingNotes.length === 0) {
    sharingNotes.push(
      'Bundle metadata is redacted and log snapshots are excluded, which is suitable for broader sharing.',
    );
  }

  const sensitivity =
    options.redacted &&
    !options.includesAppLogSnapshot &&
    !options.includesAuditLogSnapshot
      ? 'sanitized'
      : 'restricted';
  const recommendedRetentionDays = sensitivity === 'sanitized' ? 30 : 7;

  disposalNotes.push(
    sensitivity === 'sanitized'
      ? 'Delete this bundle when the diagnostic handoff or review window ends.'
      : 'Delete this bundle after the incident or support escalation is closed.',
  );

  if (options.includesAppLogSnapshot || options.includesAuditLogSnapshot) {
    disposalNotes.push(
      'Purge embedded log snapshots together with the bundle; they are not intended for long-term archival.',
    );
  }

  if (options.includesBackupManifestCopy) {
    disposalNotes.push(
      'Remove the copied backup manifest together with the bundle to avoid stale recovery metadata.',
    );
  }

  return {
    redacted: options.redacted,
    includesAppLogSnapshot: options.includesAppLogSnapshot,
    includesAuditLogSnapshot: options.includesAuditLogSnapshot,
    includesBackupInspection: options.includesBackupInspection,
    includesBackupManifestCopy: options.includesBackupManifestCopy,
    sensitivity,
    sharingRecommendation:
      sensitivity === 'sanitized' ? 'external-shareable' : 'internal-only',
    recommendedRetentionDays,
    sharingNotes,
    disposalNotes,
  };
};

const coerceSupportBundleResult = (value: unknown): SupportBundleResult | null => {
  if (!isSupportBundleResultLike(value)) {
    return null;
  }

  return {
    ...value,
    actionPlanPath: isStringOrNull(value.actionPlanPath) ? value.actionPlanPath : null,
    handoffReportPath: isStringOrNull(value.handoffReportPath)
      ? value.handoffReportPath
      : null,
    contentProfile: isSupportBundleContentProfile(value.contentProfile)
      ? value.contentProfile
      : buildContentProfile({
          redacted: value.config.redactSensitiveDetails,
          includesAppLogSnapshot: value.logSnapshotPath !== null,
          includesAuditLogSnapshot: value.auditLogSnapshotPath !== null,
          includesBackupInspection: value.backupInspectionReportPath !== null,
          includesBackupManifestCopy: value.backupManifestCopyPath !== null,
        }),
  };
};

const readJsonFileSafe = async (filePath: string): Promise<unknown> =>
  JSON.parse(await fs.readFile(filePath, 'utf8')) as unknown;

const addInspectionIssue = (
  issues: SupportBundleInspectionIssue[],
  issue: SupportBundleInspectionIssue,
): void => {
  issues.push(issue);
};

const addRetentionIssueIfExpired = (
  issues: SupportBundleInspectionIssue[],
  manifest: SupportBundleResult,
  manifestPath: string,
): void => {
  const createdAt = Date.parse(manifest.generatedAt);
  if (Number.isNaN(createdAt)) {
    return;
  }

  const retentionWindowMs =
    manifest.contentProfile.recommendedRetentionDays * 24 * 60 * 60 * 1000;
  if (retentionWindowMs <= 0) {
    return;
  }

  const expiresAt = createdAt + retentionWindowMs;
  if (Date.now() <= expiresAt) {
    return;
  }

  addInspectionIssue(issues, {
    code: 'RETENTION_WINDOW_EXCEEDED',
    severity: 'warn',
    message: `Support bundle retention window of ${manifest.contentProfile.recommendedRetentionDays} day(s) has been exceeded.`,
    path: manifestPath,
    relativePath: 'manifest.json',
    role: 'manifest',
  });
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

  if (manifest.actionPlanPath) {
    files.push({
      path: manifest.actionPlanPath,
      role: 'action-plan',
    });
  }

  if (manifest.handoffReportPath) {
    files.push({
      path: manifest.handoffReportPath,
      role: 'handoff-report',
    });
  }

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

const toBundleRelativePath = (
  bundlePath: string,
  filePath: string | null,
): string | null => {
  if (!filePath) {
    return null;
  }

  return path.relative(bundlePath, filePath).replace(/\\/g, '/');
};

const buildSupportBundleActionPlan = (
  result: SupportBundleResult,
  doctorReport: StorageDoctorReport,
): SupportBundleActionPlan => {
  const deepVerificationFlag =
    doctorReport.integrityDepth === 'deep' ? ' --verify-blobs' : '';
  const requiredIntegrityDepth = result.doctorIntegrityDepth ?? 'metadata';
  const steps: SupportBundleActionPlan['steps'] = [];

  if (doctorReport.repairSummary.readyBatchRepairVolumes > 0) {
    steps.push({
      kind: 'repair-safe',
      priority: 'high',
      title: 'Preview safe batch repairs',
      reason:
        'One or more volumes are ready for automated repair-safe remediation.',
      command: `virtual-volumes repair-safe${deepVerificationFlag} --dry-run`,
    });
  }

  if (doctorReport.repairSummary.blockedBatchRepairVolumes > 0) {
    steps.push({
      kind: 'manual-investigation',
      priority: 'high',
      title: 'Investigate blocked repair candidates',
      reason:
        'Some repairable volumes still mix safe drifts with non-safe findings and require manual review.',
      command: `virtual-volumes doctor${deepVerificationFlag}`,
    });
  }

  if (doctorReport.maintenanceSummary.recommendedCompactions > 0) {
    steps.push({
      kind: 'compact-recommended',
      priority: 'medium',
      title: 'Preview SQLite maintenance batch',
      reason:
        'One or more managed volumes are fragmented enough to justify compaction.',
      command: 'virtual-volumes compact-recommended --dry-run',
    });
  }

  steps.push({
    kind: 'inspect-support-bundle',
    priority: 'low',
    title: 'Validate bundle before handoff',
    reason:
      'Re-run bundle inspection with the intended sharing policy before handing it to another team.',
    command: `virtual-volumes inspect-support-bundle "${result.bundlePath}" --require-sharing ${result.contentProfile.sharingRecommendation} --require-integrity-depth ${requiredIntegrityDepth}`,
  });

  if (
    doctorReport.issueCount === 0 &&
    doctorReport.maintenanceSummary.recommendedCompactions === 0 &&
    doctorReport.repairSummary.repairableVolumes === 0
  ) {
    steps.unshift({
      kind: 'no-op',
      priority: 'low',
      title: 'No immediate remediation required',
      reason: 'This snapshot is healthy and does not currently require repair-safe or compaction follow-up.',
      command: null,
    });
  }

  return {
    bundleVersion: SUPPORT_BUNDLE_VERSION,
    generatedAt: result.generatedAt,
    doctorIntegrityDepth: doctorReport.integrityDepth ?? 'metadata',
    healthy: doctorReport.healthy,
    issueCount: doctorReport.issueCount,
    recommendedCompactions: doctorReport.maintenanceSummary.recommendedCompactions,
    repairableVolumes: doctorReport.repairSummary.repairableVolumes,
    readyBatchRepairVolumes: doctorReport.repairSummary.readyBatchRepairVolumes,
    blockedBatchRepairVolumes: doctorReport.repairSummary.blockedBatchRepairVolumes,
    steps,
  };
};

const buildSupportBundleHandoffReport = (
  result: SupportBundleResult,
  doctorReport: StorageDoctorReport,
): string => {
  const actionPlan = buildSupportBundleActionPlan(result, doctorReport);
  const lines = [
    '# Support Bundle Handoff Report',
    '',
    '## Summary',
    `- Status: ${result.healthy ? 'HEALTHY' : 'UNHEALTHY'}`,
    `- Generated at: ${result.generatedAt}`,
    `- Correlation ID: ${result.correlationId}`,
    `- Doctor integrity depth: ${doctorReport.integrityDepth ?? 'metadata'}`,
    `- Scope: ${result.volumeId ?? 'all volumes'}`,
    `- Volumes checked: ${result.checkedVolumes}`,
    `- Issues detected: ${result.issueCount}`,
    `- Sensitivity: ${result.contentProfile.sensitivity}`,
    `- Sharing: ${result.contentProfile.sharingRecommendation}`,
    `- Retention: ${result.contentProfile.recommendedRetentionDays} days`,
    '',
    '## Included Artifacts',
    `- Doctor report: ${toBundleRelativePath(result.bundlePath, result.doctorReportPath) ?? 'not included'}`,
    `- Action plan: ${toBundleRelativePath(result.bundlePath, result.actionPlanPath) ?? 'not included'}`,
    `- Backup inspection: ${toBundleRelativePath(result.bundlePath, result.backupInspectionReportPath) ?? 'not included'}`,
    `- Backup manifest copy: ${toBundleRelativePath(result.bundlePath, result.backupManifestCopyPath) ?? 'not included'}`,
    `- App log snapshot: ${toBundleRelativePath(result.bundlePath, result.logSnapshotPath) ?? 'not included'}`,
    `- Audit log snapshot: ${toBundleRelativePath(result.bundlePath, result.auditLogSnapshotPath) ?? 'not included'}`,
    '',
    '## Fleet Posture',
    `- Recommended compactions: ${doctorReport.maintenanceSummary.recommendedCompactions}`,
    `- Repairable volumes: ${doctorReport.repairSummary.repairableVolumes}`,
    `- Ready batch repairs: ${doctorReport.repairSummary.readyBatchRepairVolumes}`,
    `- Blocked batch repairs: ${doctorReport.repairSummary.blockedBatchRepairVolumes}`,
    '',
    '## Findings',
  ];

  if (doctorReport.issueCount === 0) {
    lines.push('- No storage issues were detected at bundle creation time.');
  } else {
    for (const volume of doctorReport.volumes) {
      if (volume.issues.length === 0) {
        continue;
      }

      lines.push(
        `- ${volume.volumeName} (${volume.volumeId}): ${volume.issueCount} issue(s)`,
      );
      lines.push(
        ...volume.issues.map((issue) => `  - [${issue.code}] ${issue.message}`),
      );
    }
  }

  if (doctorReport.maintenanceSummary.topCompactionCandidates.length > 0) {
    lines.push('', '## Top Compaction Candidates');
    lines.push(
      ...doctorReport.maintenanceSummary.topCompactionCandidates.map(
        (candidate, index) =>
          `${index + 1}. ${candidate.volumeName} (${candidate.volumeId}) free=${candidate.freeBytes}B ratio=${(candidate.freeRatio * 100).toFixed(1)}% issues=${candidate.issueCount}`,
      ),
    );
  }

  if (doctorReport.repairSummary.topRepairCandidates.length > 0) {
    lines.push('', '## Top Repair Candidates');
    lines.push(
      ...doctorReport.repairSummary.topRepairCandidates.map((candidate, index) => {
        const blockingSummary =
          candidate.blockingIssueCodes.length > 0
            ? ` blocking=${candidate.blockingIssueCodes.join(',')}`
            : '';
        return `${index + 1}. ${candidate.volumeName} (${candidate.volumeId}) safe=${candidate.repairableIssueCount} ready=${candidate.readyForBatchRepair ? 'yes' : 'no'}${blockingSummary}`;
      }),
    );
  }

  lines.push('', '## Sharing Notes');
  lines.push(...result.contentProfile.sharingNotes.map((note) => `- ${note}`));
  lines.push('', '## Disposal Notes');
  lines.push(...result.contentProfile.disposalNotes.map((note) => `- ${note}`));
  lines.push('', '## Recommended Next Actions');
  for (const step of actionPlan.steps) {
    const prefix = `[${step.priority.toUpperCase()}] ${step.title}: ${step.reason}`;
    if (step.command) {
      lines.push(`- ${prefix} Command: ${step.command}`);
    } else {
      lines.push(`- ${prefix}`);
    }
  }
  lines.push(
    `- [LOW] Respect sharing policy: enforce --require-sharing ${result.contentProfile.sharingRecommendation} before externalizing the bundle.`,
  );
  lines.push(
    '- [LOW] Retention: remove the bundle after the recommended retention window together with copied reports and snapshots.',
  );

  return `${lines.join('\n')}\n`;
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

const readTailLines = async (
  filePath: string,
  maxLines: number,
): Promise<string> => {
  const handle = await fs.open(filePath, 'r');

  try {
    const stats = await handle.stat();
    if (stats.size === 0) {
      return '';
    }

    let position = stats.size;
    let newlineCount = 0;
    const chunks: Buffer[] = [];

    while (position > 0 && newlineCount <= maxLines) {
      const chunkSize = Math.min(LOG_TAIL_READ_CHUNK_BYTES, position);
      position -= chunkSize;
      const buffer = Buffer.alloc(chunkSize);
      const { bytesRead } = await handle.read(buffer, 0, chunkSize, position);
      const chunk = bytesRead === chunkSize ? buffer : buffer.subarray(0, bytesRead);

      chunks.unshift(chunk);

      for (const byte of chunk) {
        if (byte === 0x0a) {
          newlineCount += 1;
        }
      }
    }

    const rawContent = Buffer.concat(chunks).toString('utf8');
    const hasTrailingNewline = /(?:\r?\n)$/u.test(rawContent);
    const normalizedContent = rawContent.replace(/\r\n/g, '\n');
    const lines = normalizedContent.split('\n');

    if (hasTrailingNewline) {
      lines.pop();
    }

    const tailLines = lines.slice(-maxLines);
    if (tailLines.length === 0) {
      return '';
    }

    return `${tailLines.join('\n')}${hasTrailingNewline ? '\n' : ''}`;
  } finally {
    await handle.close();
  }
};

const writeTailSnapshot = async (
  sourcePath: string,
  destinationPath: string,
  maxLines: number,
): Promise<void> => {
  const tailContent = await readTailLines(sourcePath, maxLines);

  await fs.mkdir(path.dirname(destinationPath), { recursive: true });
  await fs.writeFile(destinationPath, tailContent, 'utf8');
};

const buildBundleFileRecord = async (
  bundlePath: string,
  bundleSourcePath: string,
  filePath: string,
  role: SupportBundleFileRole,
  sourcePath: string | null,
  redactSensitiveDetails: boolean,
): Promise<SupportBundleFileRecord> => {
  const stats = await fs.stat(filePath);
  const relativePath = path.relative(bundleSourcePath, filePath);

  return {
    role,
    path: path.join(path.resolve(bundlePath), relativePath),
    relativePath,
    bytes: stats.size,
    checksumSha256: await computeFileSha256(filePath),
    sourcePath:
      sourcePath && redactSensitiveDetails
        ? redactFilesystemPath(sourcePath)
        : sourcePath,
  };
};

export const createSupportBundle = async (
  runtime: AppRuntime,
  input: CreateSupportBundleInput,
): Promise<SupportBundleResult> => {
  const destinationPath = path.resolve(input.destinationPath);
  const temporaryBundlePath = createTemporaryBundlePath(destinationPath);
  const backupPath = input.backupPath ? path.resolve(input.backupPath) : null;
  const includeLogs = input.includeLogs ?? true;

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

    const doctorReport = await runtime.volumeService.runDoctor(input.volumeId, {
      verifyBlobPayloads: input.verifyBlobPayloads,
    });
    const backupInspection = backupPath
      ? await runtime.volumeService.inspectVolumeBackup(backupPath)
      : null;
    const sanitizedDoctorReport = sanitizeObservabilityValue(
      doctorReport,
      runtime.config.redactSensitiveDetails,
    );
    const sanitizedBackupInspection = backupInspection
      ? sanitizeObservabilityValue(
          backupInspection,
          runtime.config.redactSensitiveDetails,
        )
      : null;
    const generatedAt = new Date().toISOString();
    const doctorReportPath = path.join(destinationPath, 'doctor-report.json');
    const actionPlanPath = path.join(destinationPath, 'action-plan.json');
    const handoffReportPath = path.join(destinationPath, 'handoff-report.md');
    const backupInspectionReportPath = backupInspection
      ? path.join(destinationPath, 'backup-inspection.json')
      : null;
    const backupManifestCopyPath = backupInspection?.manifestPath
      ? path.join(destinationPath, 'backup-artifact.manifest.json')
      : null;
    const checksumsPath = path.join(destinationPath, 'checksums.json');

    const currentLogPath = resolveAppLogFilePath(runtime.config);
    const currentAuditLogPath = resolveAuditLogFilePath(runtime.config);
    const logSnapshotPath =
      includeLogs && (await pathExists(currentLogPath))
        ? path.join(destinationPath, 'logs', path.basename(currentLogPath))
        : null;
    const auditLogSnapshotPath =
      includeLogs && (await pathExists(currentAuditLogPath))
        ? path.join(destinationPath, 'audit', path.basename(currentAuditLogPath))
        : null;

    await writeJsonAtomic(
      path.join(temporaryBundlePath, 'doctor-report.json'),
      sanitizedDoctorReport,
    );

    if (sanitizedBackupInspection) {
      await writeJsonAtomic(
        path.join(temporaryBundlePath, 'backup-inspection.json'),
        sanitizedBackupInspection,
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
      await writeTailSnapshot(
        currentLogPath,
        temporaryLogSnapshotPath,
        runtime.config.supportBundleLogTailLines,
      );
    }

    if (auditLogSnapshotPath) {
      const temporaryAuditLogSnapshotPath = path.join(
        temporaryBundlePath,
        'audit',
        path.basename(currentAuditLogPath),
      );
      await writeTailSnapshot(
        currentAuditLogPath,
        temporaryAuditLogSnapshotPath,
        runtime.config.supportBundleLogTailLines,
      );
    }

    const result: SupportBundleResult = {
      bundleVersion: SUPPORT_BUNDLE_VERSION,
      cliVersion: APP_VERSION,
      correlationId: runtime.correlationId,
      generatedAt,
      doctorIntegrityDepth: doctorReport.integrityDepth ?? 'metadata',
      supportedVolumeSchemaVersion: SUPPORTED_VOLUME_SCHEMA_VERSION,
      volumeId: input.volumeId ?? null,
      backupPath:
        backupPath && runtime.config.redactSensitiveDetails
          ? redactFilesystemPath(backupPath)
          : backupPath,
      healthy: doctorReport.healthy,
      checkedVolumes: doctorReport.checkedVolumes,
      issueCount: doctorReport.issueCount,
      bundlePath: destinationPath,
      manifestPath: path.join(destinationPath, 'manifest.json'),
      doctorReportPath,
      actionPlanPath,
      handoffReportPath,
      backupInspectionReportPath,
      backupManifestCopyPath,
      checksumsPath,
      auditLogSnapshotPath,
      logSnapshotPath,
      contentProfile: buildContentProfile({
        redacted: runtime.config.redactSensitiveDetails,
        includesAppLogSnapshot: logSnapshotPath !== null,
        includesAuditLogSnapshot: auditLogSnapshotPath !== null,
        includesBackupInspection: backupInspectionReportPath !== null,
        includesBackupManifestCopy: backupManifestCopyPath !== null,
      }),
      config: {
        auditLogDir: runtime.config.redactSensitiveDetails
          ? redactFilesystemPath(runtime.config.auditLogDir)
          : runtime.config.auditLogDir,
        auditLogLevel: runtime.config.auditLogLevel,
        dataDir: runtime.config.redactSensitiveDetails
          ? redactFilesystemPath(runtime.config.dataDir)
          : runtime.config.dataDir,
        hostAllowPaths: runtime.config.redactSensitiveDetails
          ? runtime.config.hostAllowPaths.map((entry) => redactFilesystemPath(entry))
          : [...runtime.config.hostAllowPaths],
        hostDenyPaths: runtime.config.redactSensitiveDetails
          ? runtime.config.hostDenyPaths.map((entry) => redactFilesystemPath(entry))
          : [...runtime.config.hostDenyPaths],
        logDir: runtime.config.redactSensitiveDetails
          ? redactFilesystemPath(runtime.config.logDir)
          : runtime.config.logDir,
        logLevel: runtime.config.logLevel,
        logRetentionDays: runtime.config.logRetentionDays,
        redactSensitiveDetails: runtime.config.redactSensitiveDetails,
        logToStdout: runtime.config.logToStdout,
        defaultQuotaBytes: runtime.config.defaultQuotaBytes,
        previewBytes: runtime.config.previewBytes,
      },
      environment: {
        platform: process.platform,
        arch: process.arch,
        nodeVersion: process.version,
        hostname: runtime.config.redactSensitiveDetails
          ? redactOpaqueValue(os.hostname(), 'host')
          : os.hostname(),
        cwd: runtime.config.redactSensitiveDetails
          ? redactFilesystemPath(process.cwd())
          : process.cwd(),
      },
    };
    const sanitizedActionPlan = sanitizeObservabilityValue(
      buildSupportBundleActionPlan(result, sanitizedDoctorReport),
      runtime.config.redactSensitiveDetails,
    );

    await writeJsonAtomic(
      path.join(temporaryBundlePath, 'action-plan.json'),
      sanitizedActionPlan,
    );

    await fs.writeFile(
      path.join(temporaryBundlePath, 'handoff-report.md'),
      buildSupportBundleHandoffReport(
        result,
        sanitizeObservabilityValue(
          doctorReport,
          runtime.config.redactSensitiveDetails,
        ),
      ),
      'utf8',
    );

    await writeJsonAtomic(path.join(temporaryBundlePath, 'manifest.json'), result);

    const files: SupportBundleFileRecord[] = [
      await buildBundleFileRecord(
        destinationPath,
        temporaryBundlePath,
        path.join(temporaryBundlePath, 'manifest.json'),
        'manifest',
        null,
        runtime.config.redactSensitiveDetails,
      ),
      await buildBundleFileRecord(
        destinationPath,
        temporaryBundlePath,
        path.join(temporaryBundlePath, 'doctor-report.json'),
        'doctor-report',
        null,
        runtime.config.redactSensitiveDetails,
      ),
      await buildBundleFileRecord(
        destinationPath,
        temporaryBundlePath,
        path.join(temporaryBundlePath, 'action-plan.json'),
        'action-plan',
        null,
        runtime.config.redactSensitiveDetails,
      ),
      await buildBundleFileRecord(
        destinationPath,
        temporaryBundlePath,
        path.join(temporaryBundlePath, 'handoff-report.md'),
        'handoff-report',
        null,
        runtime.config.redactSensitiveDetails,
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
          runtime.config.redactSensitiveDetails,
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
          runtime.config.redactSensitiveDetails,
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
          runtime.config.redactSensitiveDetails,
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
          runtime.config.redactSensitiveDetails,
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
      const normalizedManifest = coerceSupportBundleResult(manifestCandidate);
      if (normalizedManifest) {
        manifest = normalizedManifest;
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
    addRetentionIssueIfExpired(issues, manifest, manifestPath);

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
    doctorIntegrityDepth: manifest?.doctorIntegrityDepth ?? null,
    volumeId: manifest?.volumeId ?? null,
    handoffReportPath: manifest?.handoffReportPath ?? null,
    actionPlanPath: manifest?.actionPlanPath ?? null,
    issueCount: issues.length,
    expectedFiles: checksumManifest?.files.length ?? 0,
    verifiedFiles,
    contentProfile: manifest?.contentProfile ?? null,
    issues,
  };
};
