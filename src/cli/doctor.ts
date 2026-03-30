import type {
  StorageDoctorIssue,
  StorageDoctorReport,
  StorageDoctorMaintenanceStats,
  StorageDoctorVolumeReport,
  StorageRepairReport,
  StorageRepairVolumeReport,
} from '../domain/types.js';
import { formatBytes } from '../utils/formatters.js';

const formatIssue = (issue: StorageDoctorIssue): string => {
  const details = [issue.entryId ? `entry=${issue.entryId}` : null, issue.contentRef]
    .filter((value): value is string => value !== undefined && value !== null)
    .join(' ');

  const suffix = details.length > 0 ? ` (${details})` : '';
  return `  - [${issue.severity.toUpperCase()}] ${issue.code}: ${issue.message}${suffix}`;
};

const formatMaintenance = (maintenance: StorageDoctorMaintenanceStats): string =>
  [
    '  - Maintenance:',
    `artifacts=${formatBytes(maintenance.artifactBytes)}`,
    `db=${formatBytes(maintenance.databaseBytes)}`,
    `wal=${formatBytes(maintenance.walBytes)}`,
    `free=${formatBytes(maintenance.freeBytes)} (${(maintenance.freeRatio * 100).toFixed(1)}%)`,
    `compact=${maintenance.compactionRecommended ? 'recommended' : 'not-needed'}`,
  ].join(' ');

const formatMaintenanceCandidate = (
  index: number,
  candidate: StorageDoctorReport['maintenanceSummary']['topCompactionCandidates'][number],
): string =>
  `  ${index}. ${candidate.volumeName} (${candidate.volumeId}) free=${formatBytes(candidate.freeBytes)} (${(candidate.freeRatio * 100).toFixed(1)}%) artifacts=${formatBytes(candidate.artifactBytes)} issues=${candidate.issueCount}`;

const formatRepairCandidate = (
  index: number,
  candidate: StorageDoctorReport['repairSummary']['topRepairCandidates'][number],
): string => {
  const blockingSummary =
    candidate.blockingIssueCodes.length > 0
      ? ` blocking=${candidate.blockingIssueCodes.join(',')}`
      : '';

  return `  ${index}. ${candidate.volumeName} (${candidate.volumeId}) safe=${candidate.repairableIssueCount} ready=${candidate.readyForBatchRepair ? 'yes' : 'no'} issues=${candidate.issueCount}${blockingSummary}`;
};

const formatVolumeReport = (report: StorageDoctorVolumeReport): string => {
  const lines = [
    `${report.healthy ? 'OK' : 'FAIL'} ${report.volumeName} (${report.volumeId}) revision=${report.revision} issues=${report.issueCount}`,
  ];

  if (report.maintenance) {
    lines.push(formatMaintenance(report.maintenance));
  }

  if (report.issues.length === 0) {
    lines.push('  - No issues detected.');
    return lines.join('\n');
  }

  for (const issue of report.issues) {
    lines.push(formatIssue(issue));
  }

  return lines.join('\n');
};

export const formatDoctorReport = (report: StorageDoctorReport): string => {
  const lines = [
    `Storage doctor: ${report.healthy ? 'HEALTHY' : 'ISSUES FOUND'}`,
    `Generated at: ${report.generatedAt}`,
    `Integrity depth: ${report.integrityDepth ?? 'metadata'}`,
    `Checked volumes: ${report.checkedVolumes}`,
    `Total issues: ${report.issueCount}`,
    `Volumes with maintenance stats: ${report.maintenanceSummary.volumesWithStats}`,
    `Recommended compactions: ${report.maintenanceSummary.recommendedCompactions}`,
    `Total SQLite artifacts: ${formatBytes(report.maintenanceSummary.totalArtifactBytes)}`,
    `Total reclaimable free bytes: ${formatBytes(report.maintenanceSummary.totalFreeBytes)}`,
    `Repairable volumes: ${report.repairSummary.repairableVolumes}`,
    `Ready batch repairs: ${report.repairSummary.readyBatchRepairVolumes}`,
    `Blocked batch repairs: ${report.repairSummary.blockedBatchRepairVolumes}`,
    `Total safe repair issues: ${report.repairSummary.totalRepairableIssues}`,
  ];

  if (report.maintenanceSummary.topCompactionCandidates.length > 0) {
    lines.push('Top compaction candidates:');
    lines.push(
      ...report.maintenanceSummary.topCompactionCandidates.map((candidate, index) =>
        formatMaintenanceCandidate(index + 1, candidate),
      ),
    );
  }

  if (report.repairSummary.topRepairCandidates.length > 0) {
    lines.push('Top repair candidates:');
    lines.push(
      ...report.repairSummary.topRepairCandidates.map((candidate, index) =>
        formatRepairCandidate(index + 1, candidate),
      ),
    );
  }

  if (report.volumes.length > 0) {
    lines.push('');
    lines.push(...report.volumes.map((volume) => formatVolumeReport(volume)));
  }

  return lines.join('\n');
};

const formatRepairVolumeReport = (report: StorageRepairVolumeReport): string => {
  const lines = [
    `${report.healthy ? 'OK' : 'WARN'} ${report.volumeName} (${report.volumeId}) revision=${report.revision} before=${report.issueCountBefore} after=${report.issueCountAfter}`,
  ];

  if (report.actions.length === 0) {
    lines.push('  - No automatic repair actions were applied.');
  } else {
    for (const action of report.actions) {
      const suffix = action.contentRef ? ` (contentRef=${action.contentRef})` : '';
      lines.push(`  - [FIX] ${action.code}: ${action.message}${suffix}`);
    }
  }

  if (report.remainingIssues.length > 0) {
    for (const issue of report.remainingIssues) {
      lines.push(formatIssue(issue));
    }
  }

  return lines.join('\n');
};

export const formatRepairReport = (report: StorageRepairReport): string => {
  const lines = [
    `Storage repair: ${report.healthy ? 'HEALTHY' : 'ISSUES REMAIN'}`,
    `Generated at: ${report.generatedAt}`,
    `Integrity depth: ${report.integrityDepth ?? 'metadata'}`,
    `Checked volumes: ${report.checkedVolumes}`,
    `Repaired volumes: ${report.repairedVolumes}`,
    `Actions applied: ${report.actionsApplied}`,
  ];

  if (report.volumes.length > 0) {
    lines.push('');
    lines.push(...report.volumes.map((volume) => formatRepairVolumeReport(volume)));
  }

  return lines.join('\n');
};
