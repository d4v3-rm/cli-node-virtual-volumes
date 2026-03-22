import { describe, expect, it } from 'vitest';

import { formatDoctorReport, formatRepairReport } from '../src/cli/doctor.js';
import type { StorageDoctorReport, StorageRepairReport } from '../src/domain/types.js';

describe('doctor cli formatters', () => {
  it('formats a healthy doctor report with no issues', () => {
    const report: StorageDoctorReport = {
      generatedAt: '2026-04-15T10:00:00.000Z',
      healthy: true,
      checkedVolumes: 1,
      issueCount: 0,
      volumes: [
        {
          volumeId: 'volume-1',
          volumeName: 'Finance',
          revision: 7,
          healthy: true,
          issueCount: 0,
          issues: [],
          maintenance: {
            artifactBytes: 1048576,
            databaseBytes: 1048576,
            walBytes: 0,
            pageSizeBytes: 4096,
            pageCount: 256,
            freelistCount: 0,
            freeBytes: 0,
            freeRatio: 0,
            compactionRecommended: false,
          },
        },
      ],
    };

    expect(formatDoctorReport(report)).toBe(
      [
        'Storage doctor: HEALTHY',
        'Generated at: 2026-04-15T10:00:00.000Z',
        'Checked volumes: 1',
        'Total issues: 0',
        '',
        'OK Finance (volume-1) revision=7 issues=0',
        '  - Maintenance: artifacts=1.0 MB db=1.0 MB wal=0 B free=0 B (0.0%) compact=not-needed',
        '  - No issues detected.',
      ].join('\n'),
    );
  });

  it('formats repair output with actions and remaining issues', () => {
    const report: StorageRepairReport = {
      generatedAt: '2026-04-15T10:05:00.000Z',
      healthy: false,
      checkedVolumes: 1,
      repairedVolumes: 1,
      actionsApplied: 2,
      volumes: [
        {
          volumeId: 'volume-1',
          volumeName: 'Finance',
          revision: 8,
          healthy: false,
          repaired: true,
          issueCountBefore: 3,
          issueCountAfter: 1,
          actions: [
            {
              code: 'DELETE_ORPHAN_BLOB',
              message: 'Removed orphan blob from storage.',
              contentRef: 'blob:123',
            },
            {
              code: 'REBUILD_MANIFEST',
              message: 'Rebuilt manifest counters from current entries.',
            },
          ],
          remainingIssues: [
            {
              code: 'MISSING_BLOB',
              severity: 'error',
              message: 'Blob is still missing for entry.',
              contentRef: 'blob:404',
              entryId: 'entry-9',
            },
          ],
        },
      ],
    };

    expect(formatRepairReport(report)).toBe(
      [
        'Storage repair: ISSUES REMAIN',
        'Generated at: 2026-04-15T10:05:00.000Z',
        'Checked volumes: 1',
        'Repaired volumes: 1',
        'Actions applied: 2',
        '',
        'WARN Finance (volume-1) revision=8 before=3 after=1',
        '  - [FIX] DELETE_ORPHAN_BLOB: Removed orphan blob from storage. (contentRef=blob:123)',
        '  - [FIX] REBUILD_MANIFEST: Rebuilt manifest counters from current entries.',
        '  - [ERROR] MISSING_BLOB: Blob is still missing for entry. (entry=entry-9 blob:404)',
      ].join('\n'),
    );
  });
});
