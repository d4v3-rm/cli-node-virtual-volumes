import { describe, expect, it } from 'vitest';

import {
  redactFilesystemPath,
  sanitizeObservabilityMessage,
  sanitizeObservabilityValue,
} from '../src/utils/observability-redaction.js';

describe('observability redaction', () => {
  it('redacts sensitive path fields while leaving virtual paths intact', () => {
    const actualBackupPath = 'C:\\secure\\backups\\finance.sqlite';
    const actualHostPath = 'C:\\exports\\customer-report.csv';
    const payload = {
      backupPath: actualBackupPath,
      sourcePath: '/reports/customer-report.csv',
      hostPathsPreview: [actualHostPath],
      nested: {
        dataDir: 'C:\\runtime\\data',
      },
    };

    const sanitized = sanitizeObservabilityValue(payload, true);

    expect(sanitized.backupPath).toMatch(/^<redacted:/u);
    expect(sanitized.backupPath).not.toBe(actualBackupPath);
    expect(sanitized.sourcePath).toBe('/reports/customer-report.csv');
    expect(sanitized.hostPathsPreview[0]).toMatch(/^<redacted:/u);
    expect(sanitized.nested.dataDir).toMatch(/^<redacted:/u);
  });

  it('redacts sensitive path values inside structured messages', () => {
    const backupPath = 'C:\\secure\\backups\\finance.sqlite';
    const redactedBackupPath = redactFilesystemPath(backupPath);
    const message = sanitizeObservabilityMessage(
      `Backup file does not exist: ${backupPath}`,
      { backupPath },
      true,
    );

    expect(message).toContain(redactedBackupPath);
    expect(message).not.toContain(backupPath);
  });
});
