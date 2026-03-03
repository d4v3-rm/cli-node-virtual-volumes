import { getParentHostPath, type HostBrowserEntry, type HostBrowserSnapshot } from './host-browser.js';
import {
  getExportDestinationPath,
  getHostVisibleEntries,
  getPreferredHostSelectionIndex,
  jumpHostSelection,
  moveHostSelection,
  toggleHostSelection,
  toggleVisibleHostSelections,
  type HostOverlayMode,
} from './host-browser-overlay.js';

export interface HostBrowserSessionState {
  loading: boolean;
  selectedIndex: number;
  selectedPaths: Set<string>;
  snapshot: HostBrowserSnapshot;
}

export interface HostBrowserLoadRequest {
  preferredAbsolutePath: string | null;
  targetPath: string | null;
}

export type HostBrowserUpdateAction =
  | { kind: 'noop' }
  | { kind: 'load'; request: HostBrowserLoadRequest }
  | { kind: 'update'; state: HostBrowserSessionState };

export type HostBrowserConfirmAction =
  | { kind: 'notify'; message: string }
  | { kind: 'resolve'; result: string[] | string };

export const createHostBrowserSessionState = (
  initialHostPath: string | null,
): HostBrowserSessionState => ({
  loading: false,
  selectedIndex: 0,
  selectedPaths: new Set(),
  snapshot: {
    currentPath: initialHostPath,
    displayPath: 'Loading host filesystem...',
    entries: [],
  },
});

export const setHostBrowserLoading = (
  state: HostBrowserSessionState,
  loading: boolean,
): HostBrowserSessionState =>
  state.loading === loading
    ? state
    : {
        ...state,
        loading,
      };

export const applyHostBrowserSnapshot = (
  state: HostBrowserSessionState,
  snapshot: HostBrowserSnapshot,
  preferredAbsolutePath: string | null = null,
): HostBrowserSessionState => ({
  ...state,
  loading: false,
  selectedIndex: getPreferredHostSelectionIndex(snapshot, preferredAbsolutePath),
  snapshot,
});

export const getCurrentHostBrowserEntry = (
  state: HostBrowserSessionState,
): HostBrowserEntry | null => state.snapshot.entries[state.selectedIndex] ?? null;

export const moveHostBrowserSelectionState = (
  state: HostBrowserSessionState,
  direction: number,
): HostBrowserSessionState => {
  if (state.loading || state.snapshot.entries.length === 0) {
    return state;
  }

  const nextIndex = moveHostSelection(state.selectedIndex, state.snapshot.entries.length, direction);
  return nextIndex === state.selectedIndex
    ? state
    : {
        ...state,
        selectedIndex: nextIndex,
      };
};

export const jumpHostBrowserSelectionState = (
  state: HostBrowserSessionState,
  target: 'start' | 'end',
): HostBrowserSessionState => {
  if (state.loading || state.snapshot.entries.length === 0) {
    return state;
  }

  const nextIndex = jumpHostSelection(target, state.snapshot.entries.length);
  return nextIndex === state.selectedIndex
    ? state
    : {
        ...state,
        selectedIndex: nextIndex,
      };
};

export const toggleCurrentHostBrowserSelectionState = (
  state: HostBrowserSessionState,
): HostBrowserSessionState => {
  const nextSelectedPaths = toggleHostSelection(
    state.selectedPaths,
    getCurrentHostBrowserEntry(state),
  );

  return nextSelectedPaths.size === state.selectedPaths.size &&
    Array.from(nextSelectedPaths).every((hostPath) => state.selectedPaths.has(hostPath))
    ? state
    : {
        ...state,
        selectedPaths: nextSelectedPaths,
      };
};

export const toggleVisibleHostBrowserSelectionsState = (
  state: HostBrowserSessionState,
): HostBrowserSessionState => {
  const visibleEntries = getHostVisibleEntries(state.snapshot, state.selectedIndex).items;
  const nextSelectedPaths = toggleVisibleHostSelections(state.selectedPaths, visibleEntries);

  return nextSelectedPaths.size === state.selectedPaths.size &&
    Array.from(nextSelectedPaths).every((hostPath) => state.selectedPaths.has(hostPath))
    ? state
    : {
        ...state,
        selectedPaths: nextSelectedPaths,
      };
};

export const getHostBrowserNavigateInAction = (
  mode: HostOverlayMode,
  state: HostBrowserSessionState,
): HostBrowserUpdateAction => {
  if (state.loading) {
    return { kind: 'noop' };
  }

  const currentEntry = getCurrentHostBrowserEntry(state);
  if (!currentEntry) {
    return { kind: 'noop' };
  }

  if (currentEntry.navigable) {
    return {
      kind: 'load',
      request: {
        preferredAbsolutePath: null,
        targetPath: currentEntry.absolutePath,
      },
    };
  }

  if (mode === 'import' && currentEntry.selectable && currentEntry.absolutePath !== null) {
    return {
      kind: 'update',
      state: toggleCurrentHostBrowserSelectionState(state),
    };
  }

  return { kind: 'noop' };
};

export const getHostBrowserNavigateOutAction = (
  state: HostBrowserSessionState,
): HostBrowserUpdateAction => {
  if (state.loading || state.snapshot.currentPath === null) {
    return { kind: 'noop' };
  }

  const previousPath = state.snapshot.currentPath;
  const parentPath = getParentHostPath(previousPath);
  if (parentPath === previousPath) {
    return { kind: 'noop' };
  }

  return {
    kind: 'load',
    request: {
      preferredAbsolutePath: previousPath,
      targetPath: parentPath,
    },
  };
};

export const getHostBrowserConfirmAction = (options: {
  emptySelectionMessage: string | null;
  mode: HostOverlayMode;
  state: HostBrowserSessionState;
}): HostBrowserConfirmAction => {
  if (options.mode === 'import') {
    if (options.state.selectedPaths.size === 0) {
      return {
        kind: 'notify',
        message: options.emptySelectionMessage ?? 'Nothing selected.',
      };
    }

    return {
      kind: 'resolve',
      result: Array.from(options.state.selectedPaths),
    };
  }

  const destinationPath = getExportDestinationPath(
    options.state.snapshot,
    getCurrentHostBrowserEntry(options.state),
  );

  if (destinationPath === null) {
    return {
      kind: 'notify',
      message: options.emptySelectionMessage ?? 'Select a destination.',
    };
  }

  return {
    kind: 'resolve',
    result: destinationPath,
  };
};
