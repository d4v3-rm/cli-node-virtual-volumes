import type {
  StorageDoctorIssue,
  StorageDoctorReport,
  StorageDoctorVolumeReport,
  StorageRepairReport,
  StorageRepairVolumeReport,
} from '../domain/types.js';

const formatIssue = (issue: StorageDoctorIssue): string => {
  const details = [issue.entryId ? `entry=${issue.entryId}` : null, issue.contentRef]
    .filter((value): value is string => value !== undefined && value !== null)
    .join(' ');

  const suffix = details.length > 0 ? ` (${details})` : '';
  return `  - [${issue.severity.toUpperCase()}] ${issue.code}: ${issue.message}${suffix}`;
};

const formatVolumeReport = (report: StorageDoctorVolumeReport): string => {
  const lines = [
    `${report.healthy ? 'OK' : 'FAIL'} ${report.volumeName} (${report.volumeId}) revision=${report.revision} issues=${report.issueCount}`,
  ];

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
    `Checked volumes: ${report.checkedVolumes}`,
    `Total issues: ${report.issueCount}`,
  ];

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
