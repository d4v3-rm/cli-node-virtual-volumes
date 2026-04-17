import { describe, expect, it } from 'vitest';

import {
  evaluateStorageRepairBatchPolicy,
  evaluateVolumeCompactionBatchPolicy,
  formatStorageRepairBatchPolicyStatus,
  formatStorageRepairBatchResult,
  formatVolumeCompactionBatchPolicyStatus,
  formatVolumeCompactionBatchResult,
  formatVolumeCompactionResult,
} from '../src/cli/maintenance.js';
import type {
  StorageRepairBatchResult,
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
      includeUnsafe: false,
      checkedVolumes: 3,
      recommendedVolumes: 2,
      eligibleVolumes: 2,
      eligibleReclaimableBytes: 3670016,
      plannedVolumes: 2,
      plannedReclaimableBytes: 3670016,
      blockedVolumes: 0,
      blockedReclaimableBytes: 0,
      deferredVolumes: 0,
      deferredReclaimableBytes: 0,
      skippedVolumes: 1,
      filteredVolumes: 0,
      filteredReclaimableBytes: 0,
      minimumFreeBytes: null,
      minimumFreeRatio: null,
      maximumReclaimableBytes: null,
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
        'Unsafe compaction allowed: no',
        'Checked volumes: 3',
        'Recommended volumes: 2',
        'Eligible volumes: 2',
        'Eligible reclaimable bytes: 3.5 MB',
        'Planned volumes: 2',
        'Planned reclaimable bytes: 3.5 MB',
        'Blocked volumes: 0',
        'Blocked reclaimable bytes: 0 B',
        'Filtered volumes: 0',
        'Filtered reclaimable bytes: 0 B',
        'Deferred volumes: 0',
        'Deferred reclaimable bytes: 0 B',
        'Skipped volumes: 1',
        'Compacted volumes: 1',
        'Failed volumes: 1',
        'Minimum free bytes: none',
        'Minimum free ratio: none',
        'Maximum planned reclaimable bytes: none',
        'Total reclaimed: 1.0 MB',
        '',
        '  - COMPACTED Finance (volume-1) revision=9 reclaimed=1.0 MB before=8.0 MB after=7.0 MB free=2.0 MB (25.0%) artifacts=8.0 MB issues=1',
        '  - FAILED Ops (volume-2) revision=4 free=1.5 MB (37.5%) artifacts=4.0 MB issues=2 error=disk busy',
      ].join('\n'),
    );
  });

  it('formats blocked batch compaction items with safety details', () => {
    const result: VolumeCompactionBatchResult = {
      generatedAt: '2026-04-16T11:10:00.000Z',
      dryRun: true,
      includeUnsafe: false,
      checkedVolumes: 2,
      recommendedVolumes: 1,
      eligibleVolumes: 1,
      eligibleReclaimableBytes: 2097152,
      plannedVolumes: 0,
      plannedReclaimableBytes: 0,
      blockedVolumes: 1,
      blockedReclaimableBytes: 2097152,
      compactedVolumes: 0,
      failedVolumes: 0,
      skippedVolumes: 1,
      filteredVolumes: 0,
      filteredReclaimableBytes: 0,
      deferredVolumes: 0,
      deferredReclaimableBytes: 0,
      minimumFreeBytes: null,
      minimumFreeRatio: null,
      maximumReclaimableBytes: null,
      totalReclaimedBytes: 0,
      volumes: [
        {
          volumeId: 'volume-9',
          volumeName: 'Broken',
          revision: 12,
          issueCount: 2,
          artifactBytes: 4194304,
          freeBytes: 2097152,
          freeRatio: 0.5,
          status: 'blocked',
          blockingIssueCodes: ['MISSING_BLOB'],
          reason: 'Additional doctor findings must be cleared before batch compaction.',
        },
      ],
    };

    expect(formatVolumeCompactionBatchResult(result)).toBe(
      [
        'Recommended compaction: DRY RUN',
        `Generated at: ${formatDateTime(result.generatedAt)}`,
        'Unsafe compaction allowed: no',
        'Checked volumes: 2',
        'Recommended volumes: 1',
        'Eligible volumes: 1',
        'Eligible reclaimable bytes: 2.0 MB',
        'Planned volumes: 0',
        'Planned reclaimable bytes: 0 B',
        'Blocked volumes: 1',
        'Blocked reclaimable bytes: 2.0 MB',
        'Filtered volumes: 0',
        'Filtered reclaimable bytes: 0 B',
        'Deferred volumes: 0',
        'Deferred reclaimable bytes: 0 B',
        'Skipped volumes: 1',
        'Compacted volumes: 0',
        'Failed volumes: 0',
        'Minimum free bytes: none',
        'Minimum free ratio: none',
        'Maximum planned reclaimable bytes: none',
        'Total reclaimed: 0 B',
        '',
        '  - BLOCKED Broken (volume-9) revision=12 free=2.0 MB (50.0%) artifacts=4.0 MB issues=2 blocking=MISSING_BLOB reason=Additional doctor findings must be cleared before batch compaction.',
      ].join('\n'),
    );
  });

  it('formats filtered and deferred plan items with explicit reasons', () => {
    const result: VolumeCompactionBatchResult = {
      generatedAt: '2026-04-16T11:20:00.000Z',
      dryRun: true,
      includeUnsafe: false,
      checkedVolumes: 4,
      recommendedVolumes: 3,
      eligibleVolumes: 2,
      eligibleReclaimableBytes: 2359296,
      plannedVolumes: 1,
      plannedReclaimableBytes: 1048576,
      blockedVolumes: 0,
      blockedReclaimableBytes: 0,
      compactedVolumes: 0,
      failedVolumes: 0,
      skippedVolumes: 1,
      filteredVolumes: 1,
      filteredReclaimableBytes: 786432,
      deferredVolumes: 1,
      deferredReclaimableBytes: 1572864,
      minimumFreeBytes: 1048576,
      minimumFreeRatio: 0.25,
      maximumReclaimableBytes: null,
      totalReclaimedBytes: 0,
      volumes: [
        {
          volumeId: 'volume-2',
          volumeName: 'Planned',
          revision: 1,
          issueCount: 1,
          artifactBytes: 4194304,
          freeBytes: 1048576,
          freeRatio: 0.25,
          status: 'planned',
        },
        {
          volumeId: 'volume-3',
          volumeName: 'Filtered',
          revision: 2,
          issueCount: 1,
          artifactBytes: 5242880,
          freeBytes: 786432,
          freeRatio: 0.2,
          status: 'filtered',
          reason: 'Below both thresholds: requires at least 1048576 B and 25.0%.',
        },
        {
          volumeId: 'volume-4',
          volumeName: 'Deferred',
          revision: 3,
          issueCount: 1,
          artifactBytes: 6291456,
          freeBytes: 1572864,
          freeRatio: 0.3,
          status: 'deferred',
          reason: 'Deferred by --limit 1.',
        },
      ],
    };

    expect(formatVolumeCompactionBatchResult(result)).toBe(
      [
        'Recommended compaction: DRY RUN',
        `Generated at: ${formatDateTime(result.generatedAt)}`,
        'Unsafe compaction allowed: no',
        'Checked volumes: 4',
        'Recommended volumes: 3',
        'Eligible volumes: 2',
        'Eligible reclaimable bytes: 2.3 MB',
        'Planned volumes: 1',
        'Planned reclaimable bytes: 1.0 MB',
        'Blocked volumes: 0',
        'Blocked reclaimable bytes: 0 B',
        'Filtered volumes: 1',
        'Filtered reclaimable bytes: 768 KB',
        'Deferred volumes: 1',
        'Deferred reclaimable bytes: 1.5 MB',
        'Skipped volumes: 1',
        'Compacted volumes: 0',
        'Failed volumes: 0',
        'Minimum free bytes: 1.0 MB',
        'Minimum free ratio: 25.0%',
        'Maximum planned reclaimable bytes: none',
        'Total reclaimed: 0 B',
        '',
        '  - PLANNED Planned (volume-2) revision=1 free=1.0 MB (25.0%) artifacts=4.0 MB issues=1',
        '  - FILTERED Filtered (volume-3) revision=2 free=768 KB (20.0%) artifacts=5.0 MB issues=1 reason=Below both thresholds: requires at least 1048576 B and 25.0%.',
        '  - DEFERRED Deferred (volume-4) revision=3 free=1.5 MB (30.0%) artifacts=6.0 MB issues=1 reason=Deferred by --limit 1.',
      ].join('\n'),
    );
  });

  it('evaluates strict batch policy failures for blocked, filtered, deferred, and failed volumes', () => {
    const status = evaluateVolumeCompactionBatchPolicy(
      {
        blockedVolumes: 1,
        filteredVolumes: 2,
        deferredVolumes: 3,
        failedVolumes: 4,
      },
      {
        strictPlan: true,
      },
    );

    expect(status).toEqual({
      strictPlan: true,
      satisfied: false,
      messages: [
        '1 blocked volume(s) still require doctor cleanup before the batch is automation-safe.',
        '2 volume(s) were filtered out by the current free-space thresholds.',
        '3 volume(s) remain deferred outside the current batch budget.',
        '4 volume(s) failed during compaction execution.',
      ],
    });
    expect(formatVolumeCompactionBatchPolicyStatus(status)).toBe(
      [
        'Strict plan gate: FAILED',
        '- 1 blocked volume(s) still require doctor cleanup before the batch is automation-safe.',
        '- 2 volume(s) were filtered out by the current free-space thresholds.',
        '- 3 volume(s) remain deferred outside the current batch budget.',
        '- 4 volume(s) failed during compaction execution.',
      ].join('\n'),
    );
  });

  it('formats reclaim-budget settings and budget-based deferred reasons', () => {
    const result: VolumeCompactionBatchResult = {
      generatedAt: '2026-04-16T11:25:00.000Z',
      dryRun: true,
      includeUnsafe: false,
      checkedVolumes: 3,
      recommendedVolumes: 2,
      eligibleVolumes: 2,
      eligibleReclaimableBytes: 3670016,
      plannedVolumes: 1,
      plannedReclaimableBytes: 2097152,
      blockedVolumes: 0,
      blockedReclaimableBytes: 0,
      compactedVolumes: 0,
      failedVolumes: 0,
      skippedVolumes: 1,
      filteredVolumes: 0,
      filteredReclaimableBytes: 0,
      deferredVolumes: 1,
      deferredReclaimableBytes: 1572864,
      minimumFreeBytes: null,
      minimumFreeRatio: null,
      maximumReclaimableBytes: 2097152,
      totalReclaimedBytes: 0,
      volumes: [
        {
          volumeId: 'volume-2',
          volumeName: 'Planned',
          revision: 1,
          issueCount: 1,
          artifactBytes: 8388608,
          freeBytes: 2097152,
          freeRatio: 0.25,
          status: 'planned',
        },
        {
          volumeId: 'volume-3',
          volumeName: 'Deferred',
          revision: 2,
          issueCount: 1,
          artifactBytes: 4194304,
          freeBytes: 1572864,
          freeRatio: 0.375,
          status: 'deferred',
          reason:
            'Deferred by --max-reclaimable-bytes 2097152 because planning this volume would exceed the current reclaim budget.',
        },
      ],
    };

    expect(formatVolumeCompactionBatchResult(result)).toBe(
      [
        'Recommended compaction: DRY RUN',
        `Generated at: ${formatDateTime(result.generatedAt)}`,
        'Unsafe compaction allowed: no',
        'Checked volumes: 3',
        'Recommended volumes: 2',
        'Eligible volumes: 2',
        'Eligible reclaimable bytes: 3.5 MB',
        'Planned volumes: 1',
        'Planned reclaimable bytes: 2.0 MB',
        'Blocked volumes: 0',
        'Blocked reclaimable bytes: 0 B',
        'Filtered volumes: 0',
        'Filtered reclaimable bytes: 0 B',
        'Deferred volumes: 1',
        'Deferred reclaimable bytes: 1.5 MB',
        'Skipped volumes: 1',
        'Compacted volumes: 0',
        'Failed volumes: 0',
        'Minimum free bytes: none',
        'Minimum free ratio: none',
        'Maximum planned reclaimable bytes: 2.0 MB',
        'Total reclaimed: 0 B',
        '',
        '  - PLANNED Planned (volume-2) revision=1 free=2.0 MB (25.0%) artifacts=8.0 MB issues=1',
        '  - DEFERRED Deferred (volume-3) revision=2 free=1.5 MB (37.5%) artifacts=4.0 MB issues=1 reason=Deferred by --max-reclaimable-bytes 2097152 because planning this volume would exceed the current reclaim budget.',
      ].join('\n'),
    );
  });

  it('passes strict batch policy when the plan is fully actionable', () => {
    const status = evaluateVolumeCompactionBatchPolicy(
      {
        blockedVolumes: 0,
        filteredVolumes: 0,
        deferredVolumes: 0,
        failedVolumes: 0,
      },
      {
        strictPlan: true,
      },
    );

    expect(status).toEqual({
      strictPlan: true,
      satisfied: true,
      messages: [],
    });
    expect(formatVolumeCompactionBatchPolicyStatus(status)).toBe(
      'Strict plan gate: PASSED',
    );
  });

  it('formats safe repair batch output with blocked, repaired, and deferred volumes', () => {
    const result: StorageRepairBatchResult = {
      generatedAt: '2026-04-16T11:30:00.000Z',
      dryRun: false,
      checkedVolumes: 4,
      integrityDepth: 'deep',
      repairableVolumes: 3,
      plannedVolumes: 2,
      blockedVolumes: 1,
      deferredVolumes: 1,
      skippedVolumes: 1,
      repairedVolumes: 1,
      failedVolumes: 0,
      actionsApplied: 2,
      volumes: [
        {
          volumeId: 'volume-9',
          volumeName: 'Blocked',
          revision: 12,
          issueCount: 2,
          repairableIssueCodes: ['BLOB_SIZE_MISMATCH'],
          status: 'blocked',
          blockingIssueCodes: ['BLOB_CONTENT_REF_MISMATCH'],
          reason:
            'Additional non-safe doctor findings must be cleared before batch repair can automate this volume.',
        },
        {
          volumeId: 'volume-1',
          volumeName: 'Finance',
          revision: 9,
          issueCount: 1,
          repairableIssueCodes: ['BLOB_SIZE_MISMATCH'],
          status: 'repaired',
          repair: {
            volumeId: 'volume-1',
            volumeName: 'Finance',
            revision: 10,
            healthy: true,
            repaired: true,
            issueCountBefore: 1,
            issueCountAfter: 0,
            actions: [
              {
                code: 'SYNC_BLOB_LAYOUT_METADATA',
                message: 'Recomputed blob layout metadata from payload.',
                contentRef: 'blob:1',
              },
            ],
            remainingIssues: [],
          },
        },
        {
          volumeId: 'volume-2',
          volumeName: 'Deferred',
          revision: 4,
          issueCount: 1,
          repairableIssueCodes: ['MANIFEST_USAGE_MISMATCH'],
          status: 'deferred',
          reason: 'Deferred by --limit 1.',
        },
      ],
    };

    expect(formatStorageRepairBatchResult(result)).toBe(
      [
        'Safe repair batch: COMPLETED',
        `Generated at: ${formatDateTime(result.generatedAt)}`,
        'Integrity depth: deep',
        'Checked volumes: 4',
        'Repairable volumes: 3',
        'Planned volumes: 2',
        'Blocked volumes: 1',
        'Deferred volumes: 1',
        'Skipped volumes: 1',
        'Repaired volumes: 1',
        'Failed volumes: 0',
        'Actions applied: 2',
        '',
        '  - BLOCKED Blocked (volume-9) revision=12 issues=2 repairable=BLOB_SIZE_MISMATCH blocking=BLOB_CONTENT_REF_MISMATCH reason=Additional non-safe doctor findings must be cleared before batch repair can automate this volume.',
        '  - REPAIRED Finance (volume-1) revision=9 before=1 after=0 actions=1 issues=1 repairable=BLOB_SIZE_MISMATCH',
        '  - DEFERRED Deferred (volume-2) revision=4 issues=1 repairable=MANIFEST_USAGE_MISMATCH reason=Deferred by --limit 1.',
      ].join('\n'),
    );
  });

  it('evaluates strict safe repair batch policy failures', () => {
    const status = evaluateStorageRepairBatchPolicy(
      {
        blockedVolumes: 1,
        deferredVolumes: 2,
        failedVolumes: 3,
      },
      {
        strictPlan: true,
      },
    );

    expect(status).toEqual({
      strictPlan: true,
      satisfied: false,
      messages: [
        '1 volume(s) still mix safe repair drifts with non-safe doctor findings.',
        '2 volume(s) remain deferred outside the current batch limit.',
        '3 volume(s) did not finish healthy after repair execution.',
      ],
    });
    expect(formatStorageRepairBatchPolicyStatus(status)).toBe(
      [
        'Strict plan gate: FAILED',
        '- 1 volume(s) still mix safe repair drifts with non-safe doctor findings.',
        '- 2 volume(s) remain deferred outside the current batch limit.',
        '- 3 volume(s) did not finish healthy after repair execution.',
      ].join('\n'),
    );
  });

  it('formats safe repair batch output with no repairable volumes', () => {
    const result: StorageRepairBatchResult = {
      generatedAt: '2026-04-16T11:35:00.000Z',
      dryRun: true,
      checkedVolumes: 2,
      integrityDepth: 'metadata',
      repairableVolumes: 0,
      plannedVolumes: 0,
      blockedVolumes: 0,
      deferredVolumes: 0,
      skippedVolumes: 2,
      repairedVolumes: 0,
      failedVolumes: 0,
      actionsApplied: 0,
      volumes: [],
    };

    expect(formatStorageRepairBatchResult(result)).toBe(
      [
        'Safe repair batch: DRY RUN',
        `Generated at: ${formatDateTime(result.generatedAt)}`,
        'Integrity depth: metadata',
        'Checked volumes: 2',
        'Repairable volumes: 0',
        'Planned volumes: 0',
        'Blocked volumes: 0',
        'Deferred volumes: 0',
        'Skipped volumes: 2',
        'Repaired volumes: 0',
        'Failed volumes: 0',
        'Actions applied: 0',
        'No volumes currently require safe batch repair.',
      ].join('\n'),
    );
  });
});
