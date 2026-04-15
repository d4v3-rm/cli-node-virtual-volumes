import { describe, expect, it } from 'vitest';

import { getParentHostPath } from '../src/ui/host-browser.js';
import {
  applyHostBrowserSnapshot,
  createHostBrowserSessionState,
  getCurrentHostBrowserEntry,
  getHostBrowserConfirmAction,
  getHostBrowserNavigateInAction,
  getHostBrowserNavigateOutAction,
  jumpHostBrowserSelectionState,
  moveHostBrowserSelectionState,
  setHostBrowserLoading,
  toggleCurrentHostBrowserSelectionState,
  toggleVisibleHostBrowserSelectionsState,
} from '../src/ui/host-browser-controller.js';
import type { HostBrowserSnapshot } from '../src/ui/host-browser.js';

const sampleSnapshot: HostBrowserSnapshot = {
  currentPath: '/sandbox',
  displayPath: '/sandbox',
  entries: [
    {
      absolutePath: '/sandbox/..',
      id: 'parent:/sandbox',
      kind: 'parent',
      name: '..',
      navigable: true,
      selectable: false,
    },
    {
      absolutePath: '/sandbox/contracts',
      id: '/sandbox/contracts',
      kind: 'directory',
      name: 'contracts',
      navigable: true,
      selectable: true,
    },
    {
      absolutePath: '/sandbox/report.txt',
      id: '/sandbox/report.txt',
      kind: 'file',
      name: 'report.txt',
      navigable: false,
      selectable: true,
    },
  ],
};

const driveSnapshot: HostBrowserSnapshot = {
  currentPath: null,
  displayPath: 'This Computer',
  entries: [
    {
      absolutePath: 'D:\\',
      id: 'drive:D',
      kind: 'drive',
      name: 'D:\\',
      navigable: true,
      selectable: false,
    },
  ],
};

describe('ui host browser controller helpers', () => {
  it('creates and applies host browser session state deterministically', () => {
    const initialState = createHostBrowserSessionState('/sandbox');
    expect(initialState.snapshot.currentPath).toBe('/sandbox');
    expect(initialState.snapshot.displayPath).toBe('Loading host filesystem...');
    expect(initialState.selectedIndex).toBe(0);
    expect(initialState.loading).toBe(false);
    expect(Array.from(initialState.selectedPaths)).toEqual([]);

    const loadedState = applyHostBrowserSnapshot(
      setHostBrowserLoading(initialState, true),
      sampleSnapshot,
      '/sandbox/report.txt',
    );
    expect(loadedState.loading).toBe(false);
    expect(loadedState.selectedIndex).toBe(2);
    expect(getCurrentHostBrowserEntry(loadedState)?.name).toBe('report.txt');
  });

  it('moves and jumps selection while respecting loading and empty states', () => {
    const initialState = createHostBrowserSessionState('/sandbox');
    expect(moveHostBrowserSelectionState(initialState, 1)).toBe(initialState);

    const loadedState = applyHostBrowserSnapshot(initialState, sampleSnapshot);
    expect(moveHostBrowserSelectionState(loadedState, 1).selectedIndex).toBe(1);
    expect(moveHostBrowserSelectionState(loadedState, -1)).toBe(loadedState);
    expect(jumpHostBrowserSelectionState(loadedState, 'end').selectedIndex).toBe(2);
    expect(jumpHostBrowserSelectionState(setHostBrowserLoading(loadedState, true), 'end')).toEqual(
      setHostBrowserLoading(loadedState, true),
    );
  });

  it('toggles current and visible selections only when entries are selectable', () => {
    const baseState = applyHostBrowserSnapshot(createHostBrowserSessionState('/sandbox'), sampleSnapshot);
    const selectedFileState = toggleCurrentHostBrowserSelectionState({
      ...baseState,
      selectedIndex: 2,
    });
    expect(Array.from(selectedFileState.selectedPaths)).toEqual(['/sandbox/report.txt']);

    const unchangedParentState = toggleCurrentHostBrowserSelectionState(baseState);
    expect(unchangedParentState).toBe(baseState);

    const toggledVisibleState = toggleVisibleHostBrowserSelectionsState(selectedFileState);
    expect(Array.from(toggledVisibleState.selectedPaths).sort()).toEqual([
      '/sandbox/contracts',
      '/sandbox/report.txt',
    ]);
  });

  it('derives navigate-in and navigate-out actions for import and export modes', () => {
    const baseState = applyHostBrowserSnapshot(createHostBrowserSessionState('/sandbox'), sampleSnapshot);

    expect(
      getHostBrowserNavigateInAction('import', {
        ...baseState,
        selectedIndex: 1,
      }),
    ).toEqual({
      kind: 'load',
      request: {
        preferredAbsolutePath: null,
        targetPath: '/sandbox/contracts',
      },
    });

    const importToggleAction = getHostBrowserNavigateInAction('import', {
      ...baseState,
      selectedIndex: 2,
    });
    expect(importToggleAction.kind).toBe('update');
    if (importToggleAction.kind === 'update') {
      expect(Array.from(importToggleAction.state.selectedPaths)).toEqual(['/sandbox/report.txt']);
    }

    expect(
      getHostBrowserNavigateInAction('export', {
        ...baseState,
        selectedIndex: 2,
      }),
    ).toEqual({ kind: 'noop' });

    const nestedPath =
      process.platform === 'win32' ? 'C:\\sandbox\\nested' : '/sandbox/nested';
    const nestedState = applyHostBrowserSnapshot(createHostBrowserSessionState(nestedPath), {
      ...sampleSnapshot,
      currentPath: nestedPath,
      displayPath: nestedPath,
    });

    expect(getHostBrowserNavigateOutAction(nestedState)).toEqual({
      kind: 'load',
      request: {
        preferredAbsolutePath: nestedPath,
        targetPath: getParentHostPath(nestedPath),
      },
    });

    expect(getHostBrowserNavigateOutAction(setHostBrowserLoading(nestedState, true))).toEqual({
      kind: 'noop',
    });
  });

  it('derives confirm actions for import and export results', () => {
    const emptyImportState = applyHostBrowserSnapshot(
      createHostBrowserSessionState('/sandbox'),
      sampleSnapshot,
    );

    expect(
      getHostBrowserConfirmAction({
        emptySelectionMessage: 'Select one or more host files or folders with Space.',
        mode: 'import',
        state: emptyImportState,
      }),
    ).toEqual({
      kind: 'notify',
      message: 'Select one or more host files or folders with Space.',
    });

    const selectedImportState = toggleCurrentHostBrowserSelectionState({
      ...emptyImportState,
      selectedIndex: 2,
    });
    expect(
      getHostBrowserConfirmAction({
        emptySelectionMessage: 'Select one or more host files or folders with Space.',
        mode: 'import',
        state: selectedImportState,
      }),
    ).toEqual({
      kind: 'resolve',
      result: ['/sandbox/report.txt'],
    });

    expect(
      getHostBrowserConfirmAction({
        emptySelectionMessage: 'Enter a drive or folder before exporting.',
        mode: 'export',
        state: applyHostBrowserSnapshot(createHostBrowserSessionState(null), driveSnapshot),
      }),
    ).toEqual({
      kind: 'resolve',
      result: 'D:\\',
    });

    expect(
      getHostBrowserConfirmAction({
        emptySelectionMessage: 'Enter a drive or folder before exporting.',
        mode: 'export',
        state: createHostBrowserSessionState(null),
      }),
    ).toEqual({
      kind: 'notify',
      message: 'Enter a drive or folder before exporting.',
    });
  });
});
