import { formatDateTime } from '../utils/formatters.js';
import type { VolumeBackupResult, VolumeRestoreResult } from '../domain/types.js';

export const formatBackupResult = (result: VolumeBackupResult): string =>
  [
    'Volume backup: CREATED',
    `Volume: ${result.volumeName} (${result.volumeId})`,
    `Revision: ${result.revision}`,
    `Schema version: ${result.schemaVersion}`,
    `Backup path: ${result.backupPath}`,
    `Artifact manifest: ${result.manifestPath}`,
    `SHA-256: ${result.checksumSha256}`,
    `Bytes written: ${result.bytesWritten}`,
    `Created at: ${formatDateTime(result.createdAt)}`,
  ].join('\n');

export const formatRestoreResult = (result: VolumeRestoreResult): string =>
  [
    'Volume restore: COMPLETED',
    `Volume: ${result.volumeName} (${result.volumeId})`,
    `Revision: ${result.revision}`,
    `Schema version: ${result.schemaVersion}`,
    `Backup path: ${result.backupPath}`,
    `Artifact manifest: ${result.manifestPath ?? 'not present (legacy backup)'}`,
    `Artifact validation: ${result.validatedWithManifest ? 'PASSED' : 'SKIPPED'}`,
    `SHA-256: ${result.checksumSha256}`,
    `Bytes restored: ${result.bytesRestored}`,
    `Restored at: ${formatDateTime(result.restoredAt)}`,
  ].join('\n');
