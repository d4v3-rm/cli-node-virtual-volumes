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
      maintenanceSummary: {
        volumesWithStats: 1,
        recommendedCompactions: 0,
        totalArtifactBytes: 1048576,
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
        'Integrity depth: metadata',
        'Checked volumes: 1',
        'Total issues: 0',
        'Volumes with maintenance stats: 1',
        'Recommended compactions: 0',
        'Total SQLite artifacts: 1.0 MB',
        'Total reclaimable free bytes: 0 B',
        'Repairable volumes: 0',
        'Ready batch repairs: 0',
        'Blocked batch repairs: 0',
        'Total safe repair issues: 0',
        '',
        'OK Finance (volume-1) revision=7 issues=0',
        '  - Maintenance: artifacts=1.0 MB db=1.0 MB wal=0 B free=0 B (0.0%) compact=not-needed',
        '  - No issues detected.',
      ].join('\n'),
    );
  });

  it('formats maintenance summary with top compaction candidates', () => {
    const report: StorageDoctorReport = {
      generatedAt: '2026-04-15T10:02:00.000Z',
      healthy: false,
      checkedVolumes: 2,
      issueCount: 2,
      maintenanceSummary: {
        volumesWithStats: 2,
        recommendedCompactions: 2,
        totalArtifactBytes: 12582912,
        totalFreeBytes: 3670016,
        topCompactionCandidates: [
          {
            volumeId: 'volume-2',
            volumeName: 'Ops',
            revision: 4,
            issueCount: 1,
            artifactBytes: 8388608,
            freeBytes: 2097152,
            freeRatio: 0.25,
          },
          {
            volumeId: 'volume-3',
            volumeName: 'Archive',
            revision: 6,
            issueCount: 1,
            artifactBytes: 4194304,
            freeBytes: 1572864,
            freeRatio: 0.375,
          },
        ],
      },
      repairSummary: {
        repairableVolumes: 2,
        readyBatchRepairVolumes: 1,
        blockedBatchRepairVolumes: 1,
        totalRepairableIssues: 3,
        topRepairCandidates: [
          {
            volumeId: 'volume-2',
            volumeName: 'Ops',
            revision: 4,
            issueCount: 1,
            repairableIssueCount: 2,
            repairableIssueCodes: ['BLOB_SIZE_MISMATCH', 'MANIFEST_USAGE_MISMATCH'],
            readyForBatchRepair: true,
            blockingIssueCodes: [],
          },
          {
            volumeId: 'volume-3',
            volumeName: 'Archive',
            revision: 6,
            issueCount: 2,
            repairableIssueCount: 1,
            repairableIssueCodes: ['BLOB_CHUNK_COUNT_MISMATCH'],
            readyForBatchRepair: false,
            blockingIssueCodes: ['BLOB_CONTENT_REF_MISMATCH'],
          },
        ],
      },
      volumes: [],
    };

    expect(formatDoctorReport(report)).toBe(
      [
        'Storage doctor: ISSUES FOUND',
        'Generated at: 2026-04-15T10:02:00.000Z',
        'Integrity depth: metadata',
        'Checked volumes: 2',
        'Total issues: 2',
        'Volumes with maintenance stats: 2',
        'Recommended compactions: 2',
        'Total SQLite artifacts: 12.0 MB',
        'Total reclaimable free bytes: 3.5 MB',
        'Repairable volumes: 2',
        'Ready batch repairs: 1',
        'Blocked batch repairs: 1',
        'Total safe repair issues: 3',
        'Top compaction candidates:',
        '  1. Ops (volume-2) free=2.0 MB (25.0%) artifacts=8.0 MB issues=1',
        '  2. Archive (volume-3) free=1.5 MB (37.5%) artifacts=4.0 MB issues=1',
        'Top repair candidates:',
        '  1. Ops (volume-2) safe=2 ready=yes issues=1',
        '  2. Archive (volume-3) safe=1 ready=no issues=2 blocking=BLOB_CONTENT_REF_MISMATCH',
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
        'Integrity depth: metadata',
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
