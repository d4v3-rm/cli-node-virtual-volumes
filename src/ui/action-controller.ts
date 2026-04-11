import type {
  DirectoryListingItem,
  ExplorerSnapshot,
  VolumeManifest,
} from '../domain/types.js';
import {
  buildExplorerOpenRequest,
  clampVolumeSelection,
  getSelectedVolume,
  type ExplorerOpenRequest,
} from './shell-navigation.js';

export interface ExplorerActionContext {
  currentSnapshot: ExplorerSnapshot | null;
  currentVolumeId: string | null;
  selectedEntry: DirectoryListingItem | null;
  selectedEntryIndex: number;
}

export type ExplorerActionGuard<TReady> =
  | { kind: 'noop' }
  | { kind: 'notify'; message: string }
  | ({ kind: 'ready' } & TReady);

export type CreateFolderAction = ExplorerActionGuard<{
  currentPath: string;
  refreshRequest: ExplorerOpenRequest;
  volumeId: string;
}>;

export type ImportAction = ExplorerActionGuard<{
  destinationPath: string;
  volumeId: string;
}>;

export type ExportAction = ExplorerActionGuard<{
  sourcePath: string;
  volumeId: string;
}>;

export type MoveEntryAction = ExplorerActionGuard<{
  currentPath: string;
  refreshRequest: ExplorerOpenRequest;
  selectedEntry: DirectoryListingItem;
  volumeId: string;
}>;

export type DeleteEntryAction = ExplorerActionGuard<{
  refreshRequest: ExplorerOpenRequest;
  selectedEntry: DirectoryListingItem;
  volumeId: string;
}>;

export type PreviewEntryAction = ExplorerActionGuard<{
  sourcePath: string;
  volumeId: string;
}>;

export type DeleteVolumeAction =
  | { kind: 'notify'; message: string }
  | { kind: 'ready'; volume: VolumeManifest };

export type EditVolumeAction =
  | { kind: 'notify'; message: string }
  | { kind: 'ready'; volume: VolumeManifest };

const getExplorerRefreshRequest = (
  context: ExplorerActionContext,
): ExplorerOpenRequest | null => {
  if (!context.currentVolumeId || !context.currentSnapshot) {
    return null;
  }

  return buildExplorerOpenRequest(
    context.currentVolumeId,
    context.currentSnapshot.currentPath,
    context.selectedEntryIndex,
  );
};

export const getCreatedVolumeSelectionIndex = (
  volumes: VolumeManifest[],
  createdVolumeId: string,
): number =>
  clampVolumeSelection(
    volumes.findIndex((volume) => volume.id === createdVolumeId),
    volumes.length,
  );

export const getCreateFolderAction = (
  context: ExplorerActionContext,
): CreateFolderAction => {
  if (!context.currentVolumeId || !context.currentSnapshot) {
    return { kind: 'noop' };
  }

  return {
    kind: 'ready',
    currentPath: context.currentSnapshot.currentPath,
    refreshRequest: buildExplorerOpenRequest(
      context.currentVolumeId,
      context.currentSnapshot.currentPath,
      context.selectedEntryIndex,
    ),
    volumeId: context.currentVolumeId,
  };
};

export const getImportAction = (context: ExplorerActionContext): ImportAction => {
  if (!context.currentVolumeId || !context.currentSnapshot) {
    return { kind: 'noop' };
  }

  return {
    kind: 'ready',
    destinationPath: context.currentSnapshot.currentPath,
    volumeId: context.currentVolumeId,
  };
};

export const getExportAction = (context: ExplorerActionContext): ExportAction => {
  if (!context.currentVolumeId || !context.currentSnapshot) {
    return { kind: 'noop' };
  }

  if (!context.selectedEntry) {
    return { kind: 'notify', message: 'Select a file or folder first.' };
  }

  return {
    kind: 'ready',
    sourcePath: context.selectedEntry.path,
    volumeId: context.currentVolumeId,
  };
};

export const getMoveEntryAction = (
  context: ExplorerActionContext,
): MoveEntryAction => {
  if (!context.currentVolumeId || !context.currentSnapshot) {
    return { kind: 'noop' };
  }

  if (!context.selectedEntry) {
    return { kind: 'notify', message: 'Select an entry first.' };
  }

  return {
    kind: 'ready',
    currentPath: context.currentSnapshot.currentPath,
    refreshRequest: buildExplorerOpenRequest(
      context.currentVolumeId,
      context.currentSnapshot.currentPath,
      context.selectedEntryIndex,
    ),
    selectedEntry: context.selectedEntry,
    volumeId: context.currentVolumeId,
  };
};

export const getDeleteEntryAction = (
  context: ExplorerActionContext,
): DeleteEntryAction => {
  if (!context.currentVolumeId || !context.currentSnapshot) {
    return { kind: 'noop' };
  }

  if (!context.selectedEntry) {
    return { kind: 'notify', message: 'Select an entry first.' };
  }

  const refreshRequest = getExplorerRefreshRequest(context);
  if (!refreshRequest) {
    return { kind: 'noop' };
  }

  return {
    kind: 'ready',
    refreshRequest,
    selectedEntry: context.selectedEntry,
    volumeId: context.currentVolumeId,
  };
};

export const getDeleteVolumeAction = (
  volumes: VolumeManifest[],
  selectedVolumeIndex: number,
): DeleteVolumeAction => {
  const selectedVolume = getSelectedVolume(volumes, selectedVolumeIndex);
  if (!selectedVolume) {
    return { kind: 'notify', message: 'No volume selected.' };
  }

  return {
    kind: 'ready',
    volume: selectedVolume,
  };
};

export const getEditVolumeAction = (
  volumes: VolumeManifest[],
  selectedVolumeIndex: number,
): EditVolumeAction => {
  const selectedVolume = getSelectedVolume(volumes, selectedVolumeIndex);
  if (!selectedVolume) {
    return { kind: 'notify', message: 'No volume selected.' };
  }

  return {
    kind: 'ready',
    volume: selectedVolume,
  };
};

export const getPreviewEntryAction = (
  context: ExplorerActionContext,
): PreviewEntryAction => {
  if (!context.currentVolumeId) {
    return { kind: 'noop' };
  }

  if (!context.selectedEntry) {
    return { kind: 'notify', message: 'Select an entry first.' };
  }

  if (context.selectedEntry.kind !== 'file') {
    return { kind: 'notify', message: 'Preview is available for files only.' };
  }

  return {
    kind: 'ready',
    sourcePath: context.selectedEntry.path,
    volumeId: context.currentVolumeId,
  };
};
