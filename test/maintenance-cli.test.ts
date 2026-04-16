import { describe, expect, it } from 'vitest';

import {
  formatVolumeCompactionBatchResult,
  formatVolumeCompactionResult,
} from '../src/cli/maintenance.js';
import type {
  VolumeCompactionBatchResult,
  VolumeCompactionResult,
} from '../src/domain/types.js';
import { formatDateTime } from '../src/utils/formatters.js';

describe('maintenance cli formatter', () => {
  it('formats volume compaction output with before and after sizes', () => {
    const result: VolumeCompactionResult = {
      volumeId: 'volume-1',
      volumeName: 'Finance',
      revision: 9,
      schemaVersion: 3,
      databasePath: 'C:\\data\\volumes\\volume-1.sqlite',
      bytesBefore: 1048576,
      bytesAfter: 524288,
      reclaimedBytes: 524288,
      compactedAt: '2026-04-16T10:30:00.000Z',
    };

    expect(formatVolumeCompactionResult(result)).toBe(
      [
        'Volume compaction: COMPLETED',
        'Volume: Finance (volume-1)',
        'Revision: 9',
        'Schema version: 3',
        'Database path: C:\\data\\volumes\\volume-1.sqlite',
        'Bytes before: 1048576 (1.0 MB)',
        'Bytes after: 524288 (512 KB)',
        'Reclaimed: 524288 (512 KB)',
        `Compacted at: ${formatDateTime(result.compactedAt)}`,
      ].join('\n'),
    );
  });

  it('formats recommended batch compaction output with planned and compacted volumes', () => {
    const result: VolumeCompactionBatchResult = {
      generatedAt: '2026-04-16T11:00:00.000Z',
      dryRun: false,
      checkedVolumes: 3,
      recommendedVolumes: 2,
      plannedVolumes: 2,
      deferredVolumes: 0,
      skippedVolumes: 1,
      compactedVolumes: 1,
      failedVolumes: 1,
      totalReclaimedBytes: 1048576,
      volumes: [
        {
          volumeId: 'volume-1',
          volumeName: 'Finance',
          revision: 9,
          issueCount: 1,
          artifactBytes: 8388608,
          freeBytes: 2097152,
          freeRatio: 0.25,
          status: 'compacted',
          compaction: {
            volumeId: 'volume-1',
            volumeName: 'Finance',
            revision: 9,
            schemaVersion: 3,
            databasePath: 'C:\\data\\volumes\\volume-1.sqlite',
            bytesBefore: 8388608,
            bytesAfter: 7340032,
            reclaimedBytes: 1048576,
            compactedAt: '2026-04-16T11:00:01.000Z',
          },
        },
        {
          volumeId: 'volume-2',
          volumeName: 'Ops',
          revision: 4,
          issueCount: 2,
          artifactBytes: 4194304,
          freeBytes: 1572864,
          freeRatio: 0.375,
          status: 'failed',
          error: 'disk busy',
        },
      ],
    };

    expect(formatVolumeCompactionBatchResult(result)).toBe(
      [
        'Recommended compaction: COMPLETED WITH FAILURES',
        `Generated at: ${formatDateTime(result.generatedAt)}`,
        'Checked volumes: 3',
        'Recommended volumes: 2',
        'Planned volumes: 2',
        'Deferred volumes: 0',
        'Skipped volumes: 1',
        'Compacted volumes: 1',
        'Failed volumes: 1',
        'Total reclaimed: 1.0 MB',
        '',
        '  - COMPACTED Finance (volume-1) revision=9 reclaimed=1.0 MB before=8.0 MB after=7.0 MB free=2.0 MB (25.0%) artifacts=8.0 MB issues=1',
        '  - FAILED Ops (volume-2) revision=4 free=1.5 MB (37.5%) artifacts=4.0 MB issues=2 error=disk busy',
      ].join('\n'),
    );
  });
});
