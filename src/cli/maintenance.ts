import type {
  VolumeCompactionBatchItem,
  VolumeCompactionBatchResult,
  VolumeCompactionResult,
} from '../domain/types.js';
import { formatBytes, formatDateTime } from '../utils/formatters.js';

export const formatVolumeCompactionResult = (
  result: VolumeCompactionResult,
): string =>
  [
    'Volume compaction: COMPLETED',
    `Volume: ${result.volumeName} (${result.volumeId})`,
    `Revision: ${result.revision}`,
    `Schema version: ${result.schemaVersion}`,
    `Database path: ${result.databasePath}`,
    `Bytes before: ${result.bytesBefore} (${formatBytes(result.bytesBefore)})`,
    `Bytes after: ${result.bytesAfter} (${formatBytes(result.bytesAfter)})`,
    `Reclaimed: ${result.reclaimedBytes} (${formatBytes(result.reclaimedBytes)})`,
    `Compacted at: ${formatDateTime(result.compactedAt)}`,
  ].join('\n');

const formatBatchItem = (item: VolumeCompactionBatchItem): string => {
  const prefix = `  - ${item.status.toUpperCase()} ${item.volumeName} (${item.volumeId}) revision=${item.revision}`;
  const maintenance = `free=${formatBytes(item.freeBytes)} (${(item.freeRatio * 100).toFixed(1)}%) artifacts=${formatBytes(item.artifactBytes)} issues=${item.issueCount}`;

  if (item.status === 'blocked') {
    const blockingIssues = item.blockingIssueCodes?.join(', ') ?? 'unknown';
    return `${prefix} ${maintenance} blocking=${blockingIssues}`;
  }

  if (item.status === 'compacted' && item.compaction) {
    return `${prefix} reclaimed=${formatBytes(item.compaction.reclaimedBytes)} before=${formatBytes(item.compaction.bytesBefore)} after=${formatBytes(item.compaction.bytesAfter)} ${maintenance}`;
  }

  if (item.status === 'failed') {
    return `${prefix} ${maintenance} error=${item.error ?? 'unknown'}`;
  }

  return `${prefix} ${maintenance}`;
};

export const formatVolumeCompactionBatchResult = (
  result: VolumeCompactionBatchResult,
): string => {
  const status = result.dryRun
    ? 'DRY RUN'
    : result.failedVolumes > 0
      ? 'COMPLETED WITH FAILURES'
      : 'COMPLETED';
  const lines = [
    `Recommended compaction: ${status}`,
    `Generated at: ${formatDateTime(result.generatedAt)}`,
    `Unsafe compaction allowed: ${result.includeUnsafe ? 'yes' : 'no'}`,
    `Checked volumes: ${result.checkedVolumes}`,
    `Recommended volumes: ${result.recommendedVolumes}`,
    `Eligible volumes: ${result.eligibleVolumes}`,
    `Planned volumes: ${result.plannedVolumes}`,
    `Blocked volumes: ${result.blockedVolumes}`,
    `Filtered volumes: ${result.filteredVolumes}`,
    `Deferred volumes: ${result.deferredVolumes}`,
    `Skipped volumes: ${result.skippedVolumes}`,
    `Compacted volumes: ${result.compactedVolumes}`,
    `Failed volumes: ${result.failedVolumes}`,
    `Minimum free bytes: ${result.minimumFreeBytes === null ? 'none' : formatBytes(result.minimumFreeBytes)}`,
    `Minimum free ratio: ${result.minimumFreeRatio === null ? 'none' : `${(result.minimumFreeRatio * 100).toFixed(1)}%`}`,
    `Total reclaimed: ${formatBytes(result.totalReclaimedBytes)}`,
  ];

  if (result.volumes.length === 0) {
    lines.push('No volumes currently require compaction.');
    return lines.join('\n');
  }

  lines.push('');
  lines.push(...result.volumes.map((item) => formatBatchItem(item)));
  return lines.join('\n');
};
