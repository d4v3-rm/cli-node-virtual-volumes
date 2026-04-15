import { describe, expect, it } from 'vitest';

import {
  formatBackupInspectionResult,
  formatBackupResult,
  formatRestoreResult,
} from '../src/cli/backup.js';
import type {
  VolumeBackupInspectionResult,
  VolumeBackupResult,
  VolumeRestoreResult,
} from '../src/domain/types.js';
import { formatDateTime } from '../src/utils/formatters.js';

describe('backup cli formatters', () => {
  it('formats backup output with key metadata', () => {
    const result: VolumeBackupResult = {
      formatVersion: 1,
      volumeId: 'volume-1',
      volumeName: 'Finance',
      revision: 7,
      schemaVersion: 3,
      backupPath: 'C:\\backups\\finance.sqlite',
      manifestPath: 'C:\\backups\\finance.sqlite.manifest.json',
      checksumSha256:
        'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      bytesWritten: 16384,
      createdAt: '2026-04-15T13:30:00.000Z',
    };

    expect(formatBackupResult(result)).toBe(
      [
        'Volume backup: CREATED',
        'Volume: Finance (volume-1)',
        'Revision: 7',
        'Schema version: 3',
        'Backup path: C:\\backups\\finance.sqlite',
        'Artifact manifest: C:\\backups\\finance.sqlite.manifest.json',
        'SHA-256: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        'Bytes written: 16384',
        `Created at: ${formatDateTime(result.createdAt)}`,
      ].join('\n'),
    );
  });

  it('formats restore output with key metadata', () => {
    const result: VolumeRestoreResult = {
      volumeId: 'volume-1',
      volumeName: 'Finance',
      revision: 7,
      schemaVersion: 3,
      backupPath: 'C:\\backups\\finance.sqlite',
      manifestPath: 'C:\\backups\\finance.sqlite.manifest.json',
      checksumSha256:
        'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      bytesRestored: 16384,
      restoredAt: '2026-04-15T13:45:00.000Z',
      validatedWithManifest: true,
    };

    expect(formatRestoreResult(result)).toBe(
      [
        'Volume restore: COMPLETED',
        'Volume: Finance (volume-1)',
        'Revision: 7',
        'Schema version: 3',
        'Backup path: C:\\backups\\finance.sqlite',
        'Artifact manifest: C:\\backups\\finance.sqlite.manifest.json',
        'Artifact validation: PASSED',
        'SHA-256: bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        'Bytes restored: 16384',
        `Restored at: ${formatDateTime(result.restoredAt)}`,
      ].join('\n'),
    );
  });

  it('formats restore output for legacy backups without a manifest', () => {
    const result: VolumeRestoreResult = {
      volumeId: 'volume-1',
      volumeName: 'Finance',
      revision: 7,
      schemaVersion: 3,
      backupPath: 'C:\\backups\\finance.sqlite',
      manifestPath: null,
      checksumSha256:
        'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
      bytesRestored: 16384,
      restoredAt: '2026-04-15T13:45:00.000Z',
      validatedWithManifest: false,
    };

    expect(formatRestoreResult(result)).toBe(
      [
        'Volume restore: COMPLETED',
        'Volume: Finance (volume-1)',
        'Revision: 7',
        'Schema version: 3',
        'Backup path: C:\\backups\\finance.sqlite',
        'Artifact manifest: not present (legacy backup)',
        'Artifact validation: SKIPPED',
        'SHA-256: cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
        'Bytes restored: 16384',
        `Restored at: ${formatDateTime(result.restoredAt)}`,
      ].join('\n'),
    );
  });

  it('formats backup inspection output with manifest validation details', () => {
    const result: VolumeBackupInspectionResult = {
      volumeId: 'volume-1',
      volumeName: 'Finance',
      revision: 7,
      schemaVersion: 3,
      backupPath: 'C:\\backups\\finance.sqlite',
      manifestPath: 'C:\\backups\\finance.sqlite.manifest.json',
      formatVersion: 1,
      checksumSha256:
        'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
      bytesWritten: 16384,
      createdAt: '2026-04-15T13:30:00.000Z',
      validatedWithManifest: true,
    };

    expect(formatBackupInspectionResult(result)).toBe(
      [
        'Volume backup: VERIFIED',
        'Volume: Finance (volume-1)',
        'Revision: 7',
        'Schema version: 3',
        'Backup path: C:\\backups\\finance.sqlite',
        'Artifact manifest: C:\\backups\\finance.sqlite.manifest.json',
        'Artifact validation: PASSED',
        'Format version: 1',
        'SHA-256: dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
        'Bytes written: 16384',
        `Created at: ${formatDateTime(result.createdAt!)}`,
      ].join('\n'),
    );
  });
});
