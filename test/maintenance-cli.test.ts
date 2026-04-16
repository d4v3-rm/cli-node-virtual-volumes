import { describe, expect, it } from 'vitest';

import { formatVolumeCompactionResult } from '../src/cli/maintenance.js';
import type { VolumeCompactionResult } from '../src/domain/types.js';
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
});
