export type EntryKind = 'directory' | 'file';

export interface VolumeManifest {
  id: string;
  name: string;
  description: string;
  quotaBytes: number;
  logicalUsedBytes: number;
  entryCount: number;
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
  usageBytes: number;
  remainingBytes: number;
}

export interface ImportSummary {
  filesImported: number;
  directoriesImported: number;
  bytesImported: number;
  conflictsResolved: number;
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
}

export interface MoveEntryInput {
  sourcePath: string;
  destinationDirectoryPath: string;
  newName?: string;
}
