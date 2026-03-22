import type { VolumeCompactionResult } from '../domain/types.js';
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
