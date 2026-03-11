import type { SupportBundleResult } from '../domain/types.js';
import { formatDateTime } from '../utils/formatters.js';

export const formatSupportBundleResult = (
  result: SupportBundleResult,
): string => {
  const lines = [
    'Support bundle: CREATED',
    `Bundle path: ${result.bundlePath}`,
    `Manifest: ${result.manifestPath}`,
    `Scope: ${result.volumeId ?? 'all volumes'}`,
    `Volumes checked: ${result.checkedVolumes}`,
    `Issues detected: ${result.issueCount}`,
    `Doctor report: ${result.doctorReportPath}`,
    `Backup inspection: ${result.backupInspectionReportPath ?? 'not included'}`,
    `Log snapshot: ${result.logSnapshotPath ?? 'not included'}`,
    `CLI version: ${result.cliVersion}`,
    `Supported schema: ${result.supportedVolumeSchemaVersion}`,
    `Generated at: ${formatDateTime(result.generatedAt)}`,
  ];

  if (result.backupPath) {
    lines.splice(7, 0, `Backup path: ${result.backupPath}`);
  }

  return lines.join('\n');
};
