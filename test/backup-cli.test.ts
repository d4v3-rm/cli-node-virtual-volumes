import { describe, expect, it } from 'vitest';

import { formatBackupResult, formatRestoreResult } from '../src/cli/backup.js';
import type { VolumeBackupResult, VolumeRestoreResult } from '../src/domain/types.js';
import { formatDateTime } from '../src/utils/formatters.js';

describe('backup cli formatters', () => {
  it('formats backup output with key metadata', () => {
    const result: VolumeBackupResult = {
      volumeId: 'volume-1',
      volumeName: 'Finance',
      revision: 7,
      backupPath: 'C:\\backups\\finance.sqlite',
      bytesWritten: 16384,
      createdAt: '2026-04-15T13:30:00.000Z',
    };

    expect(formatBackupResult(result)).toBe(
      [
        'Volume backup: CREATED',
        'Volume: Finance (volume-1)',
        'Revision: 7',
        'Backup path: C:\\backups\\finance.sqlite',
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
      backupPath: 'C:\\backups\\finance.sqlite',
      bytesRestored: 16384,
      restoredAt: '2026-04-15T13:45:00.000Z',
    };

    expect(formatRestoreResult(result)).toBe(
      [
        'Volume restore: COMPLETED',
        'Volume: Finance (volume-1)',
        'Revision: 7',
        'Backup path: C:\\backups\\finance.sqlite',
        'Bytes restored: 16384',
        `Restored at: ${formatDateTime(result.restoredAt)}`,
      ].join('\n'),
    );
  });
});
