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

export interface StorageDoctorIssue {
  code:
    | 'BROKEN_ROOT'
    | 'DUPLICATE_CHILD_NAME'
    | 'MANIFEST_ENTRY_COUNT_MISMATCH'
    | 'MANIFEST_USAGE_MISMATCH'
    | 'MISSING_BLOB'
    | 'MISSING_CONTENT_REF'
    | 'MISSING_PARENT'
    | 'ORPHAN_BLOB'
    | 'PARENT_NOT_DIRECTORY';
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
