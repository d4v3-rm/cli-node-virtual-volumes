import type { StorageDoctorIssue } from './types.js';

const SAFE_BATCH_REPAIR_ISSUE_CODES = new Set<StorageDoctorIssue['code']>([
  'BLOB_CHUNK_COUNT_MISMATCH',
  'BLOB_CHUNK_INDEX_GAP',
  'BLOB_REFERENCE_COUNT_MISMATCH',
  'BLOB_SIZE_MISMATCH',
  'MANIFEST_ENTRY_COUNT_MISMATCH',
  'MANIFEST_USAGE_MISMATCH',
  'ORPHAN_BLOB',
  'PENDING_MUTATION_JOURNAL',
]);

const NON_BLOCKING_BATCH_REPAIR_ISSUE_CODES = new Set<StorageDoctorIssue['code']>([
  'COMPACTION_RECOMMENDED',
]);

export interface SafeBatchRepairIssueSummary {
  repairableIssueCodes: StorageDoctorIssue['code'][];
  blockingIssueCodes: StorageDoctorIssue['code'][];
}

export const collectDistinctStorageIssueCodes = (
  issues: readonly Pick<StorageDoctorIssue, 'code'>[],
): StorageDoctorIssue['code'][] => {
  const uniqueCodes = new Set<StorageDoctorIssue['code']>();

  for (const issue of issues) {
    uniqueCodes.add(issue.code);
  }

  return [...uniqueCodes];
};

export const summarizeSafeBatchRepairIssues = (
  issues: readonly StorageDoctorIssue[],
): SafeBatchRepairIssueSummary => ({
  repairableIssueCodes: collectDistinctStorageIssueCodes(
    issues.filter((issue) => SAFE_BATCH_REPAIR_ISSUE_CODES.has(issue.code)),
  ),
  blockingIssueCodes: collectDistinctStorageIssueCodes(
    issues.filter(
      (issue) =>
        !SAFE_BATCH_REPAIR_ISSUE_CODES.has(issue.code) &&
        !NON_BLOCKING_BATCH_REPAIR_ISSUE_CODES.has(issue.code),
    ),
  ),
});
