import { formatDateTime } from '../utils/formatters.js';
import type { VolumeBackupResult, VolumeRestoreResult } from '../domain/types.js';

export const formatBackupResult = (result: VolumeBackupResult): string =>
  [
    'Volume backup: CREATED',
    `Volume: ${result.volumeName} (${result.volumeId})`,
    `Revision: ${result.revision}`,
    `Backup path: ${result.backupPath}`,
    `Bytes written: ${result.bytesWritten}`,
    `Created at: ${formatDateTime(result.createdAt)}`,
  ].join('\n');

export const formatRestoreResult = (result: VolumeRestoreResult): string =>
  [
    'Volume restore: COMPLETED',
    `Volume: ${result.volumeName} (${result.volumeId})`,
    `Revision: ${result.revision}`,
    `Backup path: ${result.backupPath}`,
    `Bytes restored: ${result.bytesRestored}`,
    `Restored at: ${formatDateTime(result.restoredAt)}`,
  ].join('\n');
