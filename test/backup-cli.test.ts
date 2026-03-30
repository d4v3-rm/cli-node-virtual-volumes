import { describe, expect, it } from 'vitest';

import {
  formatBackupInspectionResult,
  formatBackupResult,
  formatRestoreDrillResult,
  formatRestoreResult,
} from '../src/cli/backup.js';
import type {
  VolumeBackupInspectionResult,
  VolumeBackupResult,
  VolumeRestoreDrillResult,
  VolumeRestoreResult,
} from '../src/domain/types.js';
import { APP_VERSION } from '../src/config/app-metadata.js';
import { formatDateTime } from '../src/utils/formatters.js';

describe('backup cli formatters', () => {
  it('formats backup output with key metadata', () => {
    const result: VolumeBackupResult = {
      formatVersion: 1,
      volumeId: 'volume-1',
      volumeName: 'Finance',
      revision: 7,
      schemaVersion: 3,
      createdWithVersion: APP_VERSION,
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
        `Created with: ${APP_VERSION}`,
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
      createdWithVersion: APP_VERSION,
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
        `Created with: ${APP_VERSION}`,
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
      createdWithVersion: null,
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
        'Created with: unknown (legacy backup)',
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
      createdWithVersion: APP_VERSION,
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
        `Created with: ${APP_VERSION}`,
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

  it('formats restore drill output with sandbox handling details', () => {
    const result: VolumeRestoreDrillResult = {
      generatedAt: '2026-04-16T10:00:00.000Z',
      backupPath: 'C:\\backups\\finance.sqlite',
      sandboxPath: null,
      keptSandbox: false,
      healthy: true,
      inspection: {
        volumeId: 'volume-1',
        volumeName: 'Finance',
        revision: 7,
        schemaVersion: 3,
        backupPath: 'C:\\backups\\finance.sqlite',
        manifestPath: 'C:\\backups\\finance.sqlite.manifest.json',
        formatVersion: 1,
        createdWithVersion: APP_VERSION,
        checksumSha256:
          'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
        bytesWritten: 16384,
        createdAt: '2026-04-15T13:30:00.000Z',
        validatedWithManifest: true,
      },
      restore: {
        volumeId: 'volume-1',
        volumeName: 'Finance',
        revision: 7,
        schemaVersion: 3,
        backupPath: 'C:\\backups\\finance.sqlite',
        manifestPath: 'C:\\backups\\finance.sqlite.manifest.json',
        createdWithVersion: APP_VERSION,
        checksumSha256:
          'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
        bytesRestored: 16384,
        restoredAt: '2026-04-16T10:00:00.000Z',
        validatedWithManifest: true,
      },
      doctor: {
        generatedAt: '2026-04-16T10:00:01.000Z',
        healthy: true,
        checkedVolumes: 1,
        issueCount: 0,
        maintenanceSummary: {
          volumesWithStats: 1,
          recommendedCompactions: 0,
          totalArtifactBytes: 16384,
          totalFreeBytes: 0,
          topCompactionCandidates: [],
        },
        repairSummary: {
          repairableVolumes: 0,
          readyBatchRepairVolumes: 0,
          blockedBatchRepairVolumes: 0,
          totalRepairableIssues: 0,
          topRepairCandidates: [],
        },
        volumes: [],
      },
    };

    expect(formatRestoreDrillResult(result)).toBe(
      [
        'Restore drill: PASSED',
        'Volume: Finance (volume-1)',
        'Revision: 7',
        'Schema version: 3',
        'Backup path: C:\\backups\\finance.sqlite',
        'Artifact validation: PASSED',
        'Bytes restored: 16384',
        'Doctor result: HEALTHY',
        'Doctor issues: 0',
        'Sandbox: cleaned automatically',
        `Drill completed at: ${formatDateTime(result.generatedAt)}`,
      ].join('\n'),
    );
  });
});
