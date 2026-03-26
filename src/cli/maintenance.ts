import type {
  VolumeCompactionBatchItem,
  VolumeCompactionBatchResult,
  VolumeCompactionResult,
} from '../domain/types.js';
import { formatBytes, formatDateTime } from '../utils/formatters.js';

export interface VolumeCompactionBatchPolicyStatus {
  strictPlan: boolean;
  satisfied: boolean;
  messages: string[];
}

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
    const reason = item.reason ? ` reason=${item.reason}` : '';
    return `${prefix} ${maintenance} blocking=${blockingIssues}${reason}`;
  }

  if (item.status === 'filtered' || item.status === 'deferred') {
    const reason = item.reason ?? 'unknown';
    return `${prefix} ${maintenance} reason=${reason}`;
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
    `Eligible reclaimable bytes: ${formatBytes(result.eligibleReclaimableBytes)}`,
    `Planned volumes: ${result.plannedVolumes}`,
    `Planned reclaimable bytes: ${formatBytes(result.plannedReclaimableBytes)}`,
    `Blocked volumes: ${result.blockedVolumes}`,
    `Blocked reclaimable bytes: ${formatBytes(result.blockedReclaimableBytes)}`,
    `Filtered volumes: ${result.filteredVolumes}`,
    `Filtered reclaimable bytes: ${formatBytes(result.filteredReclaimableBytes)}`,
    `Deferred volumes: ${result.deferredVolumes}`,
    `Deferred reclaimable bytes: ${formatBytes(result.deferredReclaimableBytes)}`,
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

export const evaluateVolumeCompactionBatchPolicy = (
  result: Pick<
    VolumeCompactionBatchResult,
    'blockedVolumes' | 'deferredVolumes' | 'failedVolumes' | 'filteredVolumes'
  >,
  options: {
    strictPlan?: boolean;
  } = {},
): VolumeCompactionBatchPolicyStatus => {
  if (!options.strictPlan) {
    return {
      strictPlan: false,
      satisfied: true,
      messages: [],
    };
  }

  const messages: string[] = [];

  if (result.blockedVolumes > 0) {
    messages.push(
      `${result.blockedVolumes} blocked volume(s) still require doctor cleanup before the batch is automation-safe.`,
    );
  }

  if (result.filteredVolumes > 0) {
    messages.push(
      `${result.filteredVolumes} volume(s) were filtered out by the current free-space thresholds.`,
    );
  }

  if (result.deferredVolumes > 0) {
    messages.push(
      `${result.deferredVolumes} volume(s) remain deferred outside the current --limit budget.`,
    );
  }

  if (result.failedVolumes > 0) {
    messages.push(
      `${result.failedVolumes} volume(s) failed during compaction execution.`,
    );
  }

  return {
    strictPlan: true,
    satisfied: messages.length === 0,
    messages,
  };
};

export const formatVolumeCompactionBatchPolicyStatus = (
  status: VolumeCompactionBatchPolicyStatus,
): string => {
  const lines = [
    `Strict plan gate: ${status.satisfied ? 'PASSED' : 'FAILED'}`,
  ];

  if (status.messages.length > 0) {
    lines.push(...status.messages.map((message) => `- ${message}`));
  }

  return lines.join('\n');
};
