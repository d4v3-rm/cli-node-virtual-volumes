import { describe, expect, it } from 'vitest';

import type {
  DirectoryListingItem,
  ExplorerSnapshot,
  VolumeManifest,
} from '../src/domain/types.js';
import {
  buildExplorerOpenRequest,
  canHandleShellNavigation,
  clampExplorerSelection,
  clampVolumeSelection,
  getGoBackNavigationAction,
  getOpenSelectedEntryAction,
  getRefreshExplorerRequest,
  getSelectedExplorerEntry,
  getSelectedVolume,
  jumpDashboardSelection,
  jumpExplorerSelection,
  moveDashboardSelection,
  moveExplorerSelection,
  pageDashboardSelection,
  pageExplorerSelection,
} from '../src/ui/shell-navigation.js';

const volumes: VolumeManifest[] = [
  {
    id: 'volume-1',
    name: 'Finance',
    description: 'Quarter close workspace',
    quotaBytes: 8192,
    logicalUsedBytes: 4096,
    entryCount: 3,
    revision: 3,
    createdAt: '2026-04-01T08:00:00.000Z',
    updatedAt: '2026-04-01T09:00:00.000Z',
  },
  {
    id: 'volume-2',
    name: 'Legal',
    description: 'Contracts archive',
    quotaBytes: 4096,
    logicalUsedBytes: 1024,
    entryCount: 1,
    revision: 1,
    createdAt: '2026-04-02T08:00:00.000Z',
    updatedAt: '2026-04-02T09:00:00.000Z',
  },
];

const directoryEntry: DirectoryListingItem = {
  id: 'entry-dir',
  name: 'reports',
  path: '/reports',
  kind: 'directory',
  size: 0,
  updatedAt: '2026-04-01T09:00:00.000Z',
};

const fileEntry: DirectoryListingItem = {
  id: 'entry-file',
  name: 'report.txt',
  path: '/reports/report.txt',
  kind: 'file',
  size: 2048,
  updatedAt: '2026-04-01T09:00:00.000Z',
};

const reportSnapshot: ExplorerSnapshot = {
  volume: volumes[0]!,
  currentPath: '/reports',
  breadcrumbs: ['/', '/reports'],
  entries: [
    directoryEntry,
    fileEntry,
  ],
  totalEntries: 4,
  windowOffset: 1,
  windowSize: 12,
  usageBytes: 4096,
  remainingBytes: 4096,
};

describe('ui shell navigation helpers', () => {
  it('gates navigation availability for dashboard and explorer modes', () => {
    expect(
      canHandleShellNavigation({
        busy: false,
        currentSnapshot: null,
        mode: 'dashboard',
        overlayOpen: false,
        volumesLength: 2,
      }),
    ).toBe(true);

    expect(
      canHandleShellNavigation({
        busy: true,
        currentSnapshot: reportSnapshot,
        mode: 'explorer',
        overlayOpen: false,
        volumesLength: 2,
      }),
    ).toBe(false);

    expect(
      canHandleShellNavigation({
        busy: false,
        currentSnapshot: reportSnapshot,
        mode: 'explorer',
        overlayOpen: true,
        volumesLength: 2,
      }),
    ).toBe(false);

    expect(
      canHandleShellNavigation({
        busy: false,
        currentSnapshot: null,
        mode: 'explorer',
        overlayOpen: false,
        volumesLength: 2,
      }),
    ).toBe(false);
  });

  it('clamps dashboard and explorer selections deterministically', () => {
    expect(clampVolumeSelection(10, volumes.length)).toBe(1);
    expect(moveDashboardSelection(0, volumes.length, 1)).toBe(1);
    expect(moveDashboardSelection(0, volumes.length, -1)).toBe(0);
    expect(pageDashboardSelection(0, volumes.length, 1)).toBe(1);
    expect(jumpDashboardSelection(volumes.length, 'start')).toBe(0);
    expect(jumpDashboardSelection(volumes.length, 'end')).toBe(1);

    expect(clampExplorerSelection(10, reportSnapshot)).toBe(3);
    expect(buildExplorerOpenRequest('volume-1', '/reports', 13)).toEqual({
      volumeId: 'volume-1',
      targetPath: '/reports',
      selectionIndex: 13,
      offset: 12,
      limit: 12,
    });
  });

  it('resolves selected explorer entries relative to window offsets', () => {
    expect(getSelectedExplorerEntry(reportSnapshot, 1)).toEqual(directoryEntry);
    expect(getSelectedExplorerEntry(reportSnapshot, 2)).toEqual(fileEntry);
    expect(getSelectedExplorerEntry(reportSnapshot, 0)).toBeNull();
    expect(getSelectedExplorerEntry(reportSnapshot, 3)).toBeNull();
    expect(getSelectedExplorerEntry(null, 0)).toBeNull();
  });

  it('moves explorer selection locally or requests a page reload when needed', () => {
    expect(moveExplorerSelection('volume-1', reportSnapshot, 1, 1)).toEqual({
      kind: 'local',
      selectedEntryIndex: 2,
    });

    expect(moveExplorerSelection('volume-1', reportSnapshot, 2, 1)).toEqual({
      kind: 'open',
      request: {
        volumeId: 'volume-1',
        targetPath: '/reports',
        selectionIndex: 3,
        offset: 0,
        limit: 12,
      },
    });

    expect(moveExplorerSelection('volume-1', reportSnapshot, 3, 1)).toEqual({
      kind: 'noop',
    });

    expect(moveExplorerSelection(null, reportSnapshot, 1, -1)).toEqual({
      kind: 'noop',
    });
  });

  it('builds page, jump, and refresh requests for explorer mode', () => {
    expect(pageExplorerSelection('volume-1', reportSnapshot, 1, 1)).toEqual({
      volumeId: 'volume-1',
      targetPath: '/reports',
      selectionIndex: 3,
      offset: 0,
      limit: 12,
    });

    expect(jumpExplorerSelection('volume-1', reportSnapshot, 'start')).toEqual({
      volumeId: 'volume-1',
      targetPath: '/reports',
      selectionIndex: 0,
      offset: 0,
      limit: 12,
    });

    expect(jumpExplorerSelection('volume-1', reportSnapshot, 'end')).toEqual({
      volumeId: 'volume-1',
      targetPath: '/reports',
      selectionIndex: 3,
      offset: 0,
      limit: 12,
    });

    expect(getRefreshExplorerRequest('volume-1', reportSnapshot, 2)).toEqual({
      volumeId: 'volume-1',
      targetPath: '/reports',
      selectionIndex: 2,
      offset: 0,
      limit: 12,
    });

    expect(pageExplorerSelection(null, reportSnapshot, 1, 1)).toBeNull();
    expect(jumpExplorerSelection('volume-1', null, 'start')).toBeNull();
    expect(getRefreshExplorerRequest(null, reportSnapshot, 2)).toBeNull();
  });

  it('resolves selected volumes and selected-entry actions', () => {
    expect(getSelectedVolume(volumes, 1)).toEqual(volumes[1]);
    expect(getSelectedVolume(volumes, 9)).toBeNull();

    expect(getOpenSelectedEntryAction(null, null)).toEqual({
      kind: 'notify',
      message: 'Select an entry first.',
    });

    expect(getOpenSelectedEntryAction('volume-1', directoryEntry)).toEqual({
      kind: 'open',
      request: {
        volumeId: 'volume-1',
        targetPath: '/reports',
        selectionIndex: 0,
        offset: 0,
        limit: 12,
      },
    });

    expect(getOpenSelectedEntryAction('volume-1', fileEntry)).toEqual({
      kind: 'preview',
    });
  });

  it('derives back-navigation targets for explorer state', () => {
    expect(
      getGoBackNavigationAction({
        currentSnapshot: reportSnapshot,
        currentVolumeId: 'volume-1',
        mode: 'dashboard',
      }),
    ).toEqual({ kind: 'noop' });

    expect(
      getGoBackNavigationAction({
        currentSnapshot: null,
        currentVolumeId: null,
        mode: 'explorer',
      }),
    ).toEqual({ kind: 'dashboard' });

    expect(
      getGoBackNavigationAction({
        currentSnapshot: {
          ...reportSnapshot,
          currentPath: '/',
        },
        currentVolumeId: 'volume-1',
        mode: 'explorer',
      }),
    ).toEqual({ kind: 'dashboard' });

    expect(
      getGoBackNavigationAction({
        currentSnapshot: reportSnapshot,
        currentVolumeId: 'volume-1',
        mode: 'explorer',
      }),
    ).toEqual({
      kind: 'open',
      request: {
        volumeId: 'volume-1',
        targetPath: '/',
        selectionIndex: 0,
        offset: 0,
        limit: 12,
      },
    });
  });
});
