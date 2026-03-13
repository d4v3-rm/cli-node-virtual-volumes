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
  overwrite?: boolean;
}

export type SupportBundleFileRole =
  | 'backup-inspection'
  | 'backup-manifest'
  | 'doctor-report'
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

export interface StorageDoctorIssue {
  code:
    | 'DATABASE_OPEN_FAILED'
    | 'BROKEN_ROOT'
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

export interface StorageDoctorVolumeReport {
  volumeId: string;
  volumeName: string;
  revision: number;
  healthy: boolean;
  issueCount: number;
  issues: StorageDoctorIssue[];
}

export interface StorageDoctorReport {
  generatedAt: string;
  healthy: boolean;
  checkedVolumes: number;
  issueCount: number;
  volumes: StorageDoctorVolumeReport[];
}

export interface StorageRepairAction {
  code: 'DELETE_ORPHAN_BLOB' | 'REBUILD_MANIFEST';
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

export interface StorageRepairReport {
  generatedAt: string;
  healthy: boolean;
  checkedVolumes: number;
  repairedVolumes: number;
  actionsApplied: number;
  volumes: StorageRepairVolumeReport[];
}

export interface SupportBundleConfigSnapshot {
  dataDir: string;
  logDir: string;
  logLevel: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent';
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

export interface SupportBundleInspectionIssue {
  code:
    | 'CHECKSUM_MISMATCH'
    | 'FILE_SIZE_MISMATCH'
    | 'INVALID_BUNDLE_MANIFEST'
    | 'INVALID_CHECKSUM_MANIFEST'
    | 'MANIFEST_PATH_MISMATCH'
    | 'MISSING_BUNDLE_FILE'
    | 'MISSING_CHECKSUM_RECORD'
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
  bundleCreatedAt: string | null;
  volumeId: string | null;
  issueCount: number;
  expectedFiles: number;
  verifiedFiles: number;
  issues: SupportBundleInspectionIssue[];
}

export interface SupportBundleResult {
  bundleVersion: 1;
  cliVersion: string;
  generatedAt: string;
  supportedVolumeSchemaVersion: number;
  volumeId: string | null;
  backupPath: string | null;
  healthy: boolean;
  checkedVolumes: number;
  issueCount: number;
  bundlePath: string;
  manifestPath: string;
  doctorReportPath: string;
  backupInspectionReportPath: string | null;
  backupManifestCopyPath: string | null;
  checksumsPath: string;
  logSnapshotPath: string | null;
  config: SupportBundleConfigSnapshot;
  environment: SupportBundleEnvironmentSnapshot;
}
