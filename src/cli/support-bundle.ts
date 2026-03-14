import type {
  SupportBundleInspectionResult,
  SupportBundleResult,
} from '../domain/types.js';
import { formatDateTime } from '../utils/formatters.js';

export const formatSupportBundleResult = (
  result: SupportBundleResult,
): string => {
  const lines = [
    'Support bundle: CREATED',
    `Bundle path: ${result.bundlePath}`,
    `Manifest: ${result.manifestPath}`,
    `Checksums: ${result.checksumsPath}`,
    `Correlation ID: ${result.correlationId}`,
    `Scope: ${result.volumeId ?? 'all volumes'}`,
    `Volumes checked: ${result.checkedVolumes}`,
    `Issues detected: ${result.issueCount}`,
    `Doctor report: ${result.doctorReportPath}`,
    `Backup inspection: ${result.backupInspectionReportPath ?? 'not included'}`,
    `Backup manifest copy: ${result.backupManifestCopyPath ?? 'not included'}`,
    `Audit log snapshot: ${result.auditLogSnapshotPath ?? 'not included'}`,
    `Log snapshot: ${result.logSnapshotPath ?? 'not included'}`,
    `CLI version: ${result.cliVersion}`,
    `Supported schema: ${result.supportedVolumeSchemaVersion}`,
    `Generated at: ${formatDateTime(result.generatedAt)}`,
  ];

  if (result.backupPath) {
    lines.splice(8, 0, `Backup path: ${result.backupPath}`);
  }

  return lines.join('\n');
};

export const formatSupportBundleInspectionResult = (
  result: SupportBundleInspectionResult,
): string => {
  const lines = [
    `Support bundle: ${result.healthy ? 'HEALTHY' : 'UNHEALTHY'}`,
    `Bundle path: ${result.bundlePath}`,
    `Manifest: ${result.manifestPath}`,
    `Checksums: ${result.checksumsPath}`,
    `Bundle version: ${result.bundleVersion ?? 'unknown'}`,
    `Created with: ${result.bundleCliVersion ?? 'unknown'}`,
    `Bundle correlation ID: ${result.bundleCorrelationId ?? 'unknown'}`,
    `Bundle created at: ${
      result.bundleCreatedAt ? formatDateTime(result.bundleCreatedAt) : 'unknown'
    }`,
    `Scope: ${result.volumeId ?? 'all volumes'}`,
    `Verified files: ${result.verifiedFiles}/${result.expectedFiles}`,
    `Issues: ${result.issueCount}`,
    `Inspected at: ${formatDateTime(result.generatedAt)}`,
  ];

  if (result.issues.length > 0) {
    lines.push('Findings:');
    lines.push(
      ...result.issues.map((issue) => `- [${issue.code}] ${issue.message}`),
    );
  }

  return lines.join('\n');
};
