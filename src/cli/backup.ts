import { formatDateTime } from '../utils/formatters.js';
import type {
  VolumeBackupInspectionResult,
  VolumeBackupResult,
  VolumeRestoreDrillResult,
  VolumeRestoreResult,
} from '../domain/types.js';

export const formatBackupResult = (result: VolumeBackupResult): string =>
  [
    'Volume backup: CREATED',
    `Volume: ${result.volumeName} (${result.volumeId})`,
    `Revision: ${result.revision}`,
    `Schema version: ${result.schemaVersion}`,
    `Created with: ${result.createdWithVersion}`,
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
    `Created with: ${result.createdWithVersion ?? 'unknown (legacy backup)'}`,
    `Backup path: ${result.backupPath}`,
    `Artifact manifest: ${result.manifestPath ?? 'not present (legacy backup)'}`,
    `Artifact validation: ${result.validatedWithManifest ? 'PASSED' : 'SKIPPED'}`,
    `SHA-256: ${result.checksumSha256}`,
    `Bytes restored: ${result.bytesRestored}`,
    `Restored at: ${formatDateTime(result.restoredAt)}`,
  ].join('\n');

export const formatBackupInspectionResult = (
  result: VolumeBackupInspectionResult,
): string =>
  [
    'Volume backup: VERIFIED',
    `Volume: ${result.volumeName} (${result.volumeId})`,
    `Revision: ${result.revision}`,
    `Schema version: ${result.schemaVersion}`,
    `Created with: ${result.createdWithVersion ?? 'unknown (legacy backup)'}`,
    `Backup path: ${result.backupPath}`,
    `Artifact manifest: ${result.manifestPath ?? 'not present (legacy backup)'}`,
    `Artifact validation: ${result.validatedWithManifest ? 'PASSED' : 'SKIPPED'}`,
    `Format version: ${result.formatVersion ?? 'legacy'}`,
    `SHA-256: ${result.checksumSha256}`,
    `Bytes written: ${result.bytesWritten}`,
    `Created at: ${result.createdAt ? formatDateTime(result.createdAt) : 'unknown'}`,
  ].join('\n');

export const formatRestoreDrillResult = (
  result: VolumeRestoreDrillResult,
): string =>
  [
    `Restore drill: ${result.healthy ? 'PASSED' : 'FAILED'}`,
    `Volume: ${result.restore.volumeName} (${result.restore.volumeId})`,
    `Revision: ${result.restore.revision}`,
    `Schema version: ${result.restore.schemaVersion}`,
    `Backup path: ${result.backupPath}`,
    `Artifact validation: ${result.inspection.validatedWithManifest ? 'PASSED' : 'SKIPPED'}`,
    `Bytes restored: ${result.restore.bytesRestored}`,
    `Doctor result: ${result.doctor.healthy ? 'HEALTHY' : 'UNHEALTHY'}`,
    `Doctor issues: ${result.doctor.issueCount}`,
    `Sandbox: ${result.sandboxPath ?? 'cleaned automatically'}`,
    `Drill completed at: ${formatDateTime(result.generatedAt)}`,
  ].join('\n');
