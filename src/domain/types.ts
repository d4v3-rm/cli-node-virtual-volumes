export type EntryKind = 'directory' | 'file';

export interface VolumeManifest {
  id: string;
  name: string;
  description: string;
  quotaBytes: number;
  logicalUsedBytes: number;
  entryCount: number;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

interface EntryBase {
  id: string;
  name: string;
  parentId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DirectoryEntry extends EntryBase {
  kind: 'directory';
  childIds: string[];
}

export interface FileEntry extends EntryBase {
  kind: 'file';
  size: number;
  contentRef: string;
  importedFromHostPath: string | null;
}

export type VolumeEntry = DirectoryEntry | FileEntry;

export interface VolumeState {
  version: 1;
  rootId: string;
  entries: Record<string, VolumeEntry>;
}

export interface VolumeRecord {
  manifest: VolumeManifest;
  state: VolumeState;
}

export interface DirectoryListingItem {
  id: string;
  name: string;
  path: string;
  kind: EntryKind;
  size: number;
  updatedAt: string;
}

export interface ExplorerSnapshot {
  volume: VolumeManifest;
  currentPath: string;
  breadcrumbs: string[];
  entries: DirectoryListingItem[];
  totalEntries: number;
  windowOffset: number;
  windowSize: number;
  usageBytes: number;
  remainingBytes: number;
}

export interface ExplorerSnapshotOptions {
  offset?: number;
  limit?: number;
}

export interface ImportSummary {
  filesImported: number;
  directoriesImported: number;
  bytesImported: number;
  conflictsResolved: number;
  integrityChecksPassed: number;
}

export interface ImportProgress {
  currentHostPath: string;
  phase: 'file' | 'directory' | 'integrity';
  summary: ImportSummary;
  currentBytes: number;
  currentTotalBytes: number | null;
}

export interface ExportSummary {
  filesExported: number;
  directoriesExported: number;
  bytesExported: number;
  conflictsResolved: number;
  integrityChecksPassed: number;
}

export interface ExportProgress {
  currentVirtualPath: string;
  destinationHostPath: string;
  phase: 'file' | 'directory' | 'integrity';
  summary: ExportSummary;
  currentBytes: number;
  currentTotalBytes: number | null;
}

export interface FilePreview {
  path: string;
  size: number;
  kind: 'text' | 'binary';
  content: string;
  truncated: boolean;
}

export interface CreateVolumeInput {
  name: string;
  description?: string;
  quotaBytes?: number;
}

export interface ImportHostPathsInput {
  destinationPath: string;
  hostPaths: string[];
  onProgress?: (progress: ImportProgress) => Promise<void> | void;
}

export interface ExportVolumeEntryInput {
  sourcePath: string;
  destinationHostDirectory: string;
  onProgress?: (progress: ExportProgress) => Promise<void> | void;
}

export interface MoveEntryInput {
  sourcePath: string;
  destinationDirectoryPath: string;
  newName?: string;
}

export interface VolumeBackupManifest {
  formatVersion: 1;
  volumeId: string;
  volumeName: string;
  revision: number;
  schemaVersion: number;
  createdWithVersion: string;
  bytesWritten: number;
  checksumSha256: string;
  createdAt: string;
}

export interface VolumeBackupResult extends VolumeBackupManifest {
  volumeId: string;
  volumeName: string;
  revision: number;
  schemaVersion: number;
  backupPath: string;
  manifestPath: string;
  checksumSha256: string;
  bytesWritten: number;
  createdAt: string;
}

export interface RestoreVolumeBackupOptions {
  overwrite?: boolean;
}

export interface CreateSupportBundleInput {
  destinationPath: string;
  volumeId?: string;
  backupPath?: string;
  includeLogs?: boolean;
  verifyBlobPayloads?: boolean;
  overwrite?: boolean;
}

export type SupportBundleFileRole =
  | 'action-plan'
  | 'audit-log-snapshot'
  | 'backup-inspection'
  | 'backup-manifest'
  | 'doctor-report'
  | 'handoff-report'
  | 'log-snapshot'
  | 'manifest';

export interface VolumeBackupInspectionResult {
  volumeId: string;
  volumeName: string;
  revision: number;
  schemaVersion: number;
  backupPath: string;
  manifestPath: string | null;
  formatVersion: 1 | null;
  createdWithVersion: string | null;
  checksumSha256: string;
  bytesWritten: number;
  createdAt: string | null;
  validatedWithManifest: boolean;
}

export interface VolumeRestoreResult {
  volumeId: string;
  volumeName: string;
  revision: number;
  schemaVersion: number;
  backupPath: string;
  manifestPath: string | null;
  createdWithVersion: string | null;
  checksumSha256: string;
  bytesRestored: number;
  restoredAt: string;
  validatedWithManifest: boolean;
}

export interface VolumeRestoreDrillResult {
  generatedAt: string;
  backupPath: string;
  sandboxPath: string | null;
  keptSandbox: boolean;
  healthy: boolean;
  inspection: VolumeBackupInspectionResult;
  restore: VolumeRestoreResult;
  doctor: StorageDoctorReport;
}

export interface VolumeCompactionResult {
  volumeId: string;
  volumeName: string;
  revision: number;
  schemaVersion: number;
  databasePath: string;
  bytesBefore: number;
  bytesAfter: number;
  reclaimedBytes: number;
  compactedAt: string;
}

export interface VolumeCompactionBatchItem {
  volumeId: string;
  volumeName: string;
  revision: number;
  issueCount: number;
  artifactBytes: number;
  freeBytes: number;
  freeRatio: number;
  status: 'blocked' | 'filtered' | 'deferred' | 'planned' | 'compacted' | 'failed';
  blockingIssueCodes?: StorageDoctorIssue['code'][];
  reason?: string;
  error?: string;
  compaction?: VolumeCompactionResult;
}

export interface VolumeCompactionBatchResult {
  generatedAt: string;
  dryRun: boolean;
  includeUnsafe: boolean;
  checkedVolumes: number;
  recommendedVolumes: number;
  eligibleVolumes: number;
  eligibleReclaimableBytes: number;
  plannedVolumes: number;
  plannedReclaimableBytes: number;
  blockedVolumes: number;
  blockedReclaimableBytes: number;
  compactedVolumes: number;
  failedVolumes: number;
  skippedVolumes: number;
  filteredVolumes: number;
  filteredReclaimableBytes: number;
  deferredVolumes: number;
  deferredReclaimableBytes: number;
  minimumFreeBytes: number | null;
  minimumFreeRatio: number | null;
  maximumReclaimableBytes: number | null;
  totalReclaimedBytes: number;
  volumes: VolumeCompactionBatchItem[];
}

export interface StorageDoctorIssue {
  code:
    | 'BLOB_CHUNK_COUNT_MISMATCH'
    | 'BLOB_CHUNK_INDEX_GAP'
    | 'BLOB_CONTENT_REF_MISMATCH'
    | 'BLOB_REFERENCE_COUNT_MISMATCH'
    | 'BLOB_SIZE_MISMATCH'
    | 'DATABASE_OPEN_FAILED'
    | 'BROKEN_ROOT'
    | 'COMPACTION_RECOMMENDED'
    | 'DUPLICATE_CHILD_NAME'
    | 'MANIFEST_ENTRY_COUNT_MISMATCH'
    | 'MANIFEST_USAGE_MISMATCH'
    | 'MISSING_BLOB'
    | 'MISSING_CONTENT_REF'
    | 'MISSING_PARENT'
    | 'ORPHAN_BLOB'
    | 'PARENT_NOT_DIRECTORY'
    | 'SQLITE_FOREIGN_KEY_VIOLATION'
    | 'SQLITE_INTEGRITY_CHECK_FAILED';
  severity: 'error' | 'warn';
  message: string;
  contentRef?: string;
  entryId?: string;
}

export interface StorageDoctorMaintenanceStats {
  databaseBytes: number;
  walBytes: number;
  artifactBytes: number;
  pageSizeBytes: number;
  pageCount: number;
  freelistCount: number;
  freeBytes: number;
  freeRatio: number;
  compactionRecommended: boolean;
}

export interface StorageDoctorMaintenanceCandidate {
  volumeId: string;
  volumeName: string;
  revision: number;
  issueCount: number;
  artifactBytes: number;
  freeBytes: number;
  freeRatio: number;
}

export interface StorageDoctorRepairCandidate {
  volumeId: string;
  volumeName: string;
  revision: number;
  issueCount: number;
  repairableIssueCount: number;
  repairableIssueCodes: StorageDoctorIssue['code'][];
  readyForBatchRepair: boolean;
  blockingIssueCodes: StorageDoctorIssue['code'][];
}

export interface StorageDoctorVolumeReport {
  volumeId: string;
  volumeName: string;
  revision: number;
  healthy: boolean;
  issueCount: number;
  issues: StorageDoctorIssue[];
  maintenance?: StorageDoctorMaintenanceStats;
}

export interface StorageDoctorMaintenanceSummary {
  volumesWithStats: number;
  recommendedCompactions: number;
  totalArtifactBytes: number;
  totalFreeBytes: number;
  topCompactionCandidates: StorageDoctorMaintenanceCandidate[];
}

export interface StorageDoctorRepairSummary {
  repairableVolumes: number;
  readyBatchRepairVolumes: number;
  blockedBatchRepairVolumes: number;
  totalRepairableIssues: number;
  topRepairCandidates: StorageDoctorRepairCandidate[];
}

export interface StorageDoctorReport {
  generatedAt: string;
  healthy: boolean;
  checkedVolumes: number;
  issueCount: number;
  integrityDepth?: 'metadata' | 'deep';
  maintenanceSummary: StorageDoctorMaintenanceSummary;
  repairSummary: StorageDoctorRepairSummary;
  volumes: StorageDoctorVolumeReport[];
}

export interface StorageDoctorOptions {
  verifyBlobPayloads?: boolean;
}

export interface StorageRepairOptions {
  verifyBlobPayloads?: boolean;
}

export interface StorageRepairAction {
  code:
    | 'DELETE_ORPHAN_BLOB'
    | 'REBUILD_MANIFEST'
    | 'SYNC_BLOB_LAYOUT_METADATA'
    | 'SYNC_BLOB_REFERENCE_COUNTS';
  message: string;
  contentRef?: string;
}

export interface StorageRepairVolumeReport {
  volumeId: string;
  volumeName: string;
  revision: number;
  healthy: boolean;
  repaired: boolean;
  issueCountBefore: number;
  issueCountAfter: number;
  actions: StorageRepairAction[];
  remainingIssues: StorageDoctorIssue[];
}

export interface StorageRepairBatchItem {
  volumeId: string;
  volumeName: string;
  revision: number;
  issueCount: number;
  repairableIssueCodes: StorageDoctorIssue['code'][];
  status: 'blocked' | 'deferred' | 'planned' | 'repaired' | 'failed';
  blockingIssueCodes?: StorageDoctorIssue['code'][];
  reason?: string;
  error?: string;
  repair?: StorageRepairVolumeReport;
}

export interface StorageRepairBatchResult {
  generatedAt: string;
  dryRun: boolean;
  checkedVolumes: number;
  integrityDepth: 'metadata' | 'deep';
  repairableVolumes: number;
  plannedVolumes: number;
  blockedVolumes: number;
  deferredVolumes: number;
  repairedVolumes: number;
  failedVolumes: number;
  skippedVolumes: number;
  actionsApplied: number;
  volumes: StorageRepairBatchItem[];
}

export interface StorageRepairReport {
  generatedAt: string;
  healthy: boolean;
  checkedVolumes: number;
  repairedVolumes: number;
  actionsApplied: number;
  integrityDepth?: 'metadata' | 'deep';
  volumes: StorageRepairVolumeReport[];
}

export interface SupportBundleConfigSnapshot {
  auditLogDir: string;
  auditLogLevel: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent';
  dataDir: string;
  hostAllowPaths: string[];
  hostDenyPaths: string[];
  logDir: string;
  logLevel: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent';
  logRetentionDays: number | null;
  redactSensitiveDetails: boolean;
  logToStdout: boolean;
  defaultQuotaBytes: number;
  previewBytes: number;
}

export interface SupportBundleEnvironmentSnapshot {
  platform: string;
  arch: string;
  nodeVersion: string;
  hostname: string;
  cwd: string;
}

export interface SupportBundleFileRecord {
  role: SupportBundleFileRole;
  path: string;
  relativePath: string;
  bytes: number;
  checksumSha256: string;
  sourcePath: string | null;
}

export interface SupportBundleChecksumManifest {
  bundleVersion: 1;
  generatedAt: string;
  bundlePath: string;
  files: SupportBundleFileRecord[];
}

export type SupportBundleSensitivity = 'sanitized' | 'restricted';

export type SupportBundleSharingRecommendation =
  | 'external-shareable'
  | 'internal-only';

export interface SupportBundleContentProfile {
  redacted: boolean;
  includesAppLogSnapshot: boolean;
  includesAuditLogSnapshot: boolean;
  includesBackupInspection: boolean;
  includesBackupManifestCopy: boolean;
  sensitivity: SupportBundleSensitivity;
  sharingRecommendation: SupportBundleSharingRecommendation;
  recommendedRetentionDays: number;
  sharingNotes: string[];
  disposalNotes: string[];
}

export interface SupportBundleActionPlanStep {
  kind:
    | 'compact-recommended'
    | 'inspect-support-bundle'
    | 'manual-investigation'
    | 'no-op'
    | 'repair-safe';
  priority: 'high' | 'medium' | 'low';
  title: string;
  reason: string;
  command: string | null;
}

export interface SupportBundleActionPlan {
  bundleVersion: 1;
  generatedAt: string;
  doctorIntegrityDepth: 'metadata' | 'deep';
  healthy: boolean;
  issueCount: number;
  recommendedCompactions: number;
  repairableVolumes: number;
  readyBatchRepairVolumes: number;
  blockedBatchRepairVolumes: number;
  steps: SupportBundleActionPlanStep[];
}

export interface SupportBundleInspectionIssue {
  code:
    | 'ACTION_PLAN_MISMATCH'
    | 'BACKUP_INSPECTION_MISMATCH'
    | 'BACKUP_MANIFEST_COPY_MISMATCH'
    | 'CHECKSUM_MISMATCH'
    | 'DOCTOR_REPORT_MISMATCH'
    | 'FILE_SIZE_MISMATCH'
    | 'INVALID_ACTION_PLAN'
    | 'INVALID_BACKUP_INSPECTION'
    | 'INVALID_BACKUP_MANIFEST_COPY'
    | 'INVALID_DOCTOR_REPORT'
    | 'INVALID_BUNDLE_MANIFEST'
    | 'INVALID_CHECKSUM_MANIFEST'
    | 'MANIFEST_PATH_MISMATCH'
    | 'MISSING_BUNDLE_FILE'
    | 'MISSING_CHECKSUM_RECORD'
    | 'RETENTION_WINDOW_EXCEEDED'
    | 'UNSUPPORTED_BUNDLE_VERSION';
  severity: 'error' | 'warn';
  message: string;
  path?: string;
  relativePath?: string;
  role?: SupportBundleFileRole;
}

export interface SupportBundleInspectionResult {
  generatedAt: string;
  healthy: boolean;
  bundlePath: string;
  manifestPath: string;
  checksumsPath: string;
  bundleVersion: number | null;
  bundleCliVersion: string | null;
  bundleCorrelationId: string | null;
  bundleCreatedAt: string | null;
  doctorIntegrityDepth: 'metadata' | 'deep' | null;
  volumeId: string | null;
  handoffReportPath: string | null;
  actionPlanPath: string | null;
  issueCount: number;
  expectedFiles: number;
  verifiedFiles: number;
  contentProfile: SupportBundleContentProfile | null;
  issues: SupportBundleInspectionIssue[];
}

export interface SupportBundleResult {
  bundleVersion: 1;
  cliVersion: string;
  correlationId: string;
  generatedAt: string;
  doctorIntegrityDepth?: 'metadata' | 'deep';
  supportedVolumeSchemaVersion: number;
  volumeId: string | null;
  backupPath: string | null;
  healthy: boolean;
  checkedVolumes: number;
  issueCount: number;
  bundlePath: string;
  manifestPath: string;
  doctorReportPath: string;
  handoffReportPath: string | null;
  actionPlanPath: string | null;
  backupInspectionReportPath: string | null;
  backupManifestCopyPath: string | null;
  checksumsPath: string;
  auditLogSnapshotPath: string | null;
  logSnapshotPath: string | null;
  contentProfile: SupportBundleContentProfile;
  config: SupportBundleConfigSnapshot;
  environment: SupportBundleEnvironmentSnapshot;
}
