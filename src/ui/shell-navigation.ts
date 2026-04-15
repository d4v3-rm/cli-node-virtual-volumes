import type {
  DirectoryListingItem,
  ExplorerSnapshot,
  VolumeManifest,
} from '../domain/types.js';
import { getParentVirtualPath } from '../utils/virtual-paths.js';
import { clampIndex, getPageOffset, VISIBLE_ENTRY_ROWS, VISIBLE_VOLUME_ROWS } from './navigation.js';

export type ShellScreenMode = 'dashboard' | 'explorer';
export type SelectionJumpTarget = 'start' | 'end';

export interface ExplorerOpenRequest {
  volumeId: string;
  targetPath: string;
  selectionIndex: number;
  offset: number;
  limit: number;
}

export type ExplorerSelectionChange =
  | { kind: 'noop' }
  | { kind: 'local'; selectedEntryIndex: number }
  | { kind: 'open'; request: ExplorerOpenRequest };

export type OpenSelectedEntryAction =
  | { kind: 'notify'; message: string }
  | { kind: 'open'; request: ExplorerOpenRequest }
  | { kind: 'preview' };

export type GoBackNavigationAction =
  | { kind: 'noop' }
  | { kind: 'dashboard' }
  | { kind: 'open'; request: ExplorerOpenRequest };

export const buildExplorerOpenRequest = (
  volumeId: string,
  targetPath = '/',
  selectionIndex = 0,
): ExplorerOpenRequest => ({
  volumeId,
  targetPath,
  selectionIndex,
  offset: getPageOffset(selectionIndex, VISIBLE_ENTRY_ROWS),
  limit: VISIBLE_ENTRY_ROWS,
});

export const canHandleShellNavigation = (options: {
  busy: boolean;
  currentSnapshot: ExplorerSnapshot | null;
  mode: ShellScreenMode;
  overlayOpen: boolean;
  volumesLength: number;
}): boolean => {
  if (options.busy || options.overlayOpen) {
    return false;
  }

  if (options.mode === 'dashboard') {
    return options.volumesLength > 0;
  }

  return (options.currentSnapshot?.totalEntries ?? 0) > 0;
};

export const clampVolumeSelection = (
  selectedVolumeIndex: number,
  volumesLength: number,
): number => clampIndex(selectedVolumeIndex, volumesLength);

export const moveDashboardSelection = (
  selectedVolumeIndex: number,
  volumesLength: number,
  direction: -1 | 1,
): number => clampVolumeSelection(selectedVolumeIndex + direction, volumesLength);

export const pageDashboardSelection = (
  selectedVolumeIndex: number,
  volumesLength: number,
  direction: -1 | 1,
): number =>
  clampVolumeSelection(selectedVolumeIndex + VISIBLE_VOLUME_ROWS * direction, volumesLength);

export const jumpDashboardSelection = (
  volumesLength: number,
  target: SelectionJumpTarget,
): number =>
  target === 'start' ? 0 : clampVolumeSelection(Number.MAX_SAFE_INTEGER, volumesLength);

export const clampExplorerSelection = (
  selectionIndex: number,
  snapshot: ExplorerSnapshot,
): number => clampIndex(selectionIndex, snapshot.totalEntries);

export const getSelectedExplorerEntry = (
  snapshot: ExplorerSnapshot | null,
  selectedEntryIndex: number,
): DirectoryListingItem | null => {
  if (!snapshot) {
    return null;
  }

  const relativeIndex = selectedEntryIndex - snapshot.windowOffset;
  return relativeIndex >= 0 ? snapshot.entries[relativeIndex] ?? null : null;
};

export const moveExplorerSelection = (
  volumeId: string | null,
  snapshot: ExplorerSnapshot | null,
  selectedEntryIndex: number,
  direction: -1 | 1,
): ExplorerSelectionChange => {
  if (!volumeId || !snapshot) {
    return { kind: 'noop' };
  }

  const nextIndex = clampExplorerSelection(selectedEntryIndex + direction, snapshot);
  if (nextIndex === selectedEntryIndex) {
    return { kind: 'noop' };
  }

  const windowStart = snapshot.windowOffset;
  const windowEnd = windowStart + snapshot.entries.length;
  if (nextIndex < windowStart || nextIndex >= windowEnd) {
    return {
      kind: 'open',
      request: buildExplorerOpenRequest(volumeId, snapshot.currentPath, nextIndex),
    };
  }

  return { kind: 'local', selectedEntryIndex: nextIndex };
};

export const pageExplorerSelection = (
  volumeId: string | null,
  snapshot: ExplorerSnapshot | null,
  selectedEntryIndex: number,
  direction: -1 | 1,
): ExplorerOpenRequest | null => {
  if (!volumeId || !snapshot) {
    return null;
  }

  const nextIndex = clampExplorerSelection(
    selectedEntryIndex + VISIBLE_ENTRY_ROWS * direction,
    snapshot,
  );

  return buildExplorerOpenRequest(volumeId, snapshot.currentPath, nextIndex);
};

export const jumpExplorerSelection = (
  volumeId: string | null,
  snapshot: ExplorerSnapshot | null,
  target: SelectionJumpTarget,
): ExplorerOpenRequest | null => {
  if (!volumeId || !snapshot) {
    return null;
  }

  const nextIndex =
    target === 'start'
      ? 0
      : clampExplorerSelection(Number.MAX_SAFE_INTEGER, snapshot);

  return buildExplorerOpenRequest(volumeId, snapshot.currentPath, nextIndex);
};

export const getRefreshExplorerRequest = (
  volumeId: string | null,
  snapshot: ExplorerSnapshot | null,
  selectedEntryIndex: number,
): ExplorerOpenRequest | null => {
  if (!volumeId || !snapshot) {
    return null;
  }

  return buildExplorerOpenRequest(volumeId, snapshot.currentPath, selectedEntryIndex);
};

export const getSelectedVolume = (
  volumes: VolumeManifest[],
  selectedVolumeIndex: number,
): VolumeManifest | null => volumes[selectedVolumeIndex] ?? null;

export const getOpenSelectedEntryAction = (
  currentVolumeId: string | null,
  selectedEntry: DirectoryListingItem | null,
): OpenSelectedEntryAction => {
  if (!selectedEntry || !currentVolumeId) {
    return { kind: 'notify', message: 'Select an entry first.' };
  }

  if (selectedEntry.kind === 'directory') {
    return {
      kind: 'open',
      request: buildExplorerOpenRequest(currentVolumeId, selectedEntry.path),
    };
  }

  return { kind: 'preview' };
};

export const getGoBackNavigationAction = (options: {
  currentSnapshot: ExplorerSnapshot | null;
  currentVolumeId: string | null;
  mode: ShellScreenMode;
}): GoBackNavigationAction => {
  if (options.mode !== 'explorer') {
    return { kind: 'noop' };
  }

  if (!options.currentVolumeId || !options.currentSnapshot) {
    return { kind: 'dashboard' };
  }

  if (options.currentSnapshot.currentPath === '/') {
    return { kind: 'dashboard' };
  }

  return {
    kind: 'open',
    request: buildExplorerOpenRequest(
      options.currentVolumeId,
      getParentVirtualPath(options.currentSnapshot.currentPath),
    ),
  };
};
