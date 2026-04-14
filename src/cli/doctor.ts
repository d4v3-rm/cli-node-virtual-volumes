import type {
  StorageDoctorIssue,
  StorageDoctorReport,
  StorageDoctorVolumeReport,
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
