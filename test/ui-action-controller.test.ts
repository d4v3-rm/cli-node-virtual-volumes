import { describe, expect, it } from 'vitest';

import type {
  DirectoryListingItem,
  ExplorerSnapshot,
  VolumeManifest,
} from '../src/domain/types.js';
import {
  getCreateFolderAction,
  getCreatedVolumeSelectionIndex,
  getDeleteEntryAction,
  getDeleteVolumeAction,
  getExportAction,
  getImportAction,
  getMoveEntryAction,
  getPreviewEntryAction,
} from '../src/ui/action-controller.js';

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

const snapshot: ExplorerSnapshot = {
  volume: volumes[0]!,
  currentPath: '/reports',
  breadcrumbs: ['/', '/reports'],
  entries: [directoryEntry, fileEntry],
  totalEntries: 2,
  windowOffset: 0,
  windowSize: 12,
  usageBytes: 4096,
  remainingBytes: 4096,
};

describe('ui action controller helpers', () => {
  it('selects the created volume index with safe clamping', () => {
    expect(getCreatedVolumeSelectionIndex(volumes, 'volume-2')).toBe(1);
    expect(getCreatedVolumeSelectionIndex(volumes, 'missing')).toBe(0);
  });

  it('builds create-folder and import actions only when explorer state is available', () => {
    expect(
      getCreateFolderAction({
        currentSnapshot: null,
        currentVolumeId: null,
        selectedEntry: null,
        selectedEntryIndex: 0,
      }),
    ).toEqual({ kind: 'noop' });

    expect(
      getCreateFolderAction({
        currentSnapshot: snapshot,
        currentVolumeId: 'volume-1',
        selectedEntry: fileEntry,
        selectedEntryIndex: 1,
      }),
    ).toEqual({
      kind: 'ready',
      currentPath: '/reports',
      refreshRequest: {
        volumeId: 'volume-1',
        targetPath: '/reports',
        selectionIndex: 1,
        offset: 0,
        limit: 12,
      },
      volumeId: 'volume-1',
    });

    expect(
      getImportAction({
        currentSnapshot: snapshot,
        currentVolumeId: 'volume-1',
        selectedEntry: fileEntry,
        selectedEntryIndex: 1,
      }),
    ).toEqual({
      kind: 'ready',
      destinationPath: '/reports',
      volumeId: 'volume-1',
    });
  });

  it('guards export flow when there is no selected explorer entry', () => {
    expect(
      getExportAction({
        currentSnapshot: null,
        currentVolumeId: null,
        selectedEntry: null,
        selectedEntryIndex: 0,
      }),
    ).toEqual({ kind: 'noop' });

    expect(
      getExportAction({
        currentSnapshot: snapshot,
        currentVolumeId: 'volume-1',
        selectedEntry: null,
        selectedEntryIndex: 0,
      }),
    ).toEqual({
      kind: 'notify',
      message: 'Select a file or folder first.',
    });

    expect(
      getExportAction({
        currentSnapshot: snapshot,
        currentVolumeId: 'volume-1',
        selectedEntry: directoryEntry,
        selectedEntryIndex: 0,
      }),
    ).toEqual({
      kind: 'ready',
      sourcePath: '/reports',
      volumeId: 'volume-1',
    });
  });

  it('builds move and delete-entry actions with refresh requests', () => {
    expect(
      getMoveEntryAction({
        currentSnapshot: snapshot,
        currentVolumeId: 'volume-1',
        selectedEntry: null,
        selectedEntryIndex: 0,
      }),
    ).toEqual({
      kind: 'notify',
      message: 'Select an entry first.',
    });

    expect(
      getMoveEntryAction({
        currentSnapshot: snapshot,
        currentVolumeId: 'volume-1',
        selectedEntry: fileEntry,
        selectedEntryIndex: 1,
      }),
    ).toEqual({
      kind: 'ready',
      currentPath: '/reports',
      refreshRequest: {
        volumeId: 'volume-1',
        targetPath: '/reports',
        selectionIndex: 1,
        offset: 0,
        limit: 12,
      },
      selectedEntry: fileEntry,
      volumeId: 'volume-1',
    });

    expect(
      getDeleteEntryAction({
        currentSnapshot: snapshot,
        currentVolumeId: 'volume-1',
        selectedEntry: directoryEntry,
        selectedEntryIndex: 0,
      }),
    ).toEqual({
      kind: 'ready',
      refreshRequest: {
        volumeId: 'volume-1',
        targetPath: '/reports',
        selectionIndex: 0,
        offset: 0,
        limit: 12,
      },
      selectedEntry: directoryEntry,
      volumeId: 'volume-1',
    });
  });

  it('guards delete-volume and preview flows with user-facing outcomes', () => {
    expect(getDeleteVolumeAction([], 0)).toEqual({
      kind: 'notify',
      message: 'No volume selected.',
    });

    expect(getDeleteVolumeAction(volumes, 1)).toEqual({
      kind: 'ready',
      volume: volumes[1],
    });

    expect(
      getPreviewEntryAction({
        currentSnapshot: snapshot,
        currentVolumeId: null,
        selectedEntry: null,
        selectedEntryIndex: 0,
      }),
    ).toEqual({ kind: 'noop' });

    expect(
      getPreviewEntryAction({
        currentSnapshot: snapshot,
        currentVolumeId: 'volume-1',
        selectedEntry: null,
        selectedEntryIndex: 0,
      }),
    ).toEqual({
      kind: 'notify',
      message: 'Select an entry first.',
    });

    expect(
      getPreviewEntryAction({
        currentSnapshot: snapshot,
        currentVolumeId: 'volume-1',
        selectedEntry: directoryEntry,
        selectedEntryIndex: 0,
      }),
    ).toEqual({
      kind: 'notify',
      message: 'Preview is available for files only.',
    });

    expect(
      getPreviewEntryAction({
        currentSnapshot: snapshot,
        currentVolumeId: 'volume-1',
        selectedEntry: fileEntry,
        selectedEntryIndex: 1,
      }),
    ).toEqual({
      kind: 'ready',
      sourcePath: '/reports/report.txt',
      volumeId: 'volume-1',
    });
  });
});
