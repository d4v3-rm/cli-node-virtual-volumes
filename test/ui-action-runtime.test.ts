import { describe, expect, it } from 'vitest';

import type {
  DirectoryEntry,
  DirectoryListingItem,
  ExplorerSnapshot,
  ExportSummary,
  FilePreview,
  ImportSummary,
  VolumeManifest,
} from '../src/domain/types.js';
import {
  runCreateFolderWizard,
  runCreateVolumeWizard,
  runDeleteSelectedEntry,
  runDeleteSelectedVolume,
  runExportWizard,
  runImportWizard,
  runMoveSelectedEntry,
  runPreviewSelectedEntry,
  type ActionRuntime,
} from '../src/ui/action-runtime.js';

const sampleVolume: VolumeManifest = {
  id: 'volume-1',
  name: 'Finance',
  description: 'Quarter close workspace',
  quotaBytes: 8192,
  logicalUsedBytes: 4096,
  entryCount: 2,
  revision: 3,
  createdAt: '2026-04-01T08:00:00.000Z',
  updatedAt: '2026-04-01T09:00:00.000Z',
};

const secondVolume: VolumeManifest = {
  id: 'volume-2',
  name: 'Roadmap',
  description: 'Planning workspace',
  quotaBytes: 16384,
  logicalUsedBytes: 0,
  entryCount: 0,
  revision: 1,
  createdAt: '2026-04-02T08:00:00.000Z',
  updatedAt: '2026-04-02T09:00:00.000Z',
};

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
  volume: sampleVolume,
  currentPath: '/reports',
  breadcrumbs: ['/', '/reports'],
  entries: [directoryEntry, fileEntry],
  totalEntries: 2,
  windowOffset: 0,
  windowSize: 12,
  usageBytes: 4096,
  remainingBytes: 4096,
};

const createdDirectory: DirectoryEntry = {
  id: 'dir-created',
  name: 'archives',
  kind: 'directory',
  parentId: 'root',
  childIds: [],
  createdAt: '2026-04-03T08:00:00.000Z',
  updatedAt: '2026-04-03T08:00:00.000Z',
};

const importSummary: ImportSummary = {
  filesImported: 1,
  directoriesImported: 1,
  bytesImported: 2048,
  conflictsResolved: 0,
  integrityChecksPassed: 2,
};

const exportSummary: ExportSummary = {
  filesExported: 1,
  directoriesExported: 0,
  bytesExported: 2048,
  conflictsResolved: 0,
  integrityChecksPassed: 1,
};

const preview: FilePreview = {
  path: '/reports/report.txt',
  size: 2048,
  kind: 'text',
  content: 'Quarter close notes',
  truncated: false,
};

interface ActionRuntimeHarnessOptions {
  confirmations?: boolean[];
  currentSnapshot?: ExplorerSnapshot | null;
  currentVolumeId?: string | null;
  exportDestination?: string | null;
  importSelection?: string[] | null;
  promptValues?: (string | null)[];
  selectedEntry?: DirectoryListingItem | null;
  selectedEntryIndex?: number;
  selectedVolumeIndex?: number;
  volumes?: VolumeManifest[];
}

const createActionRuntimeHarness = (
  options: ActionRuntimeHarnessOptions = {},
): {
  busyUpdates: {
    currentValue?: number | null;
    detail?: string;
    totalValue?: number | null;
  }[];
  confirmPrompts: string[];
  createDirectoryCalls: {
    currentPath: string;
    name: string;
    volumeId: string;
  }[];
  createVolumeInputs: {
    description?: string;
    name: string;
    quotaBytes?: number;
  }[];
  readonly dashboardCalls: number;
  deleteEntryCalls: {
    path: string;
    volumeId: string;
  }[];
  deleteVolumeCalls: string[];
  exportCalls: {
    destinationHostDirectory: string;
    sourcePath: string;
    volumeId: string;
  }[];
  readonly loadVolumesCalls: number;
  moveCalls: {
    destinationDirectoryPath: string;
    newName?: string;
    sourcePath: string;
    volumeId: string;
  }[];
  notifications: {
    detail?: string;
    message: string;
    tone: string;
  }[];
  openPreviews: FilePreview[];
  openVolumes: {
    selectionIndex?: number;
    targetPath?: string;
    volumeId: string;
  }[];
  previewCalls: {
    sourcePath: string;
    volumeId: string;
  }[];
  promptDescriptions: string[];
  readonly renderCalls: number;
  runtime: ActionRuntime;
  selectedVolumeAssignments: number[];
  setVolumes: (nextVolumes: VolumeManifest[]) => void;
  taskCalls: {
    detail?: string;
    label: string;
  }[];
} => {
  const notifications: { detail?: string; message: string; tone: string }[] = [];
  const taskCalls: { detail?: string; label: string }[] = [];
  const promptDescriptions: string[] = [];
  const confirmPrompts: string[] = [];
  const openVolumes: {
    selectionIndex?: number;
    targetPath?: string;
    volumeId: string;
  }[] = [];
  const openPreviews: FilePreview[] = [];
  const busyUpdates: {
    currentValue?: number | null;
    detail?: string;
    totalValue?: number | null;
  }[] = [];
  const createVolumeInputs: {
    description?: string;
    name: string;
    quotaBytes?: number;
  }[] = [];
  const createDirectoryCalls: {
    currentPath: string;
    name: string;
    volumeId: string;
  }[] = [];
  const importCalls: {
    destinationPath: string;
    hostPaths: string[];
    volumeId: string;
  }[] = [];
  const exportCalls: {
    destinationHostDirectory: string;
    sourcePath: string;
    volumeId: string;
  }[] = [];
  const moveCalls: {
    destinationDirectoryPath: string;
    newName?: string;
    sourcePath: string;
    volumeId: string;
  }[] = [];
  const deleteEntryCalls: { path: string; volumeId: string }[] = [];
  const deleteVolumeCalls: string[] = [];
  const previewCalls: { sourcePath: string; volumeId: string }[] = [];
  const selectedVolumeAssignments: number[] = [];

  const promptValues = [...(options.promptValues ?? [])];
  const confirmations = [...(options.confirmations ?? [])];
  let importSelection = options.importSelection ?? null;
  let exportDestination = options.exportDestination ?? null;
  let volumes = [...(options.volumes ?? [sampleVolume])];
  let renderCalls = 0;
  let loadVolumesCalls = 0;
  let dashboardCalls = 0;

  const runtime: ActionRuntime = {
    currentSnapshot:
      options.currentSnapshot === undefined ? snapshot : options.currentSnapshot,
    currentVolumeId:
      options.currentVolumeId === undefined ? sampleVolume.id : options.currentVolumeId,
    defaultQuotaBytes: 4096,
    selectedEntry: options.selectedEntry === undefined ? fileEntry : options.selectedEntry,
    selectedEntryIndex: options.selectedEntryIndex ?? 1,
    selectedVolumeIndex: options.selectedVolumeIndex ?? 0,
    volumeService: {
      createVolume: (input) => {
        createVolumeInputs.push(input);
        return Promise.resolve(secondVolume);
      },
      createDirectory: (volumeId, currentPath, name) => {
        createDirectoryCalls.push({ volumeId, currentPath, name });
        return Promise.resolve(createdDirectory);
      },
      importHostPaths: async (volumeId, input) => {
        importCalls.push({
          volumeId,
          destinationPath: input.destinationPath,
          hostPaths: [...input.hostPaths],
        });
        await input.onProgress?.({
          currentHostPath: input.hostPaths[0] ?? 'C:\\imports\\report.txt',
          phase: 'file',
          summary: importSummary,
          currentBytes: 1024,
          currentTotalBytes: 2048,
        });
        return importSummary;
      },
      exportEntryToHost: async (volumeId, input) => {
        exportCalls.push({
          volumeId,
          sourcePath: input.sourcePath,
          destinationHostDirectory: input.destinationHostDirectory,
        });
        await input.onProgress?.({
          currentVirtualPath: input.sourcePath,
          destinationHostPath: `${input.destinationHostDirectory}\\report.txt`,
          phase: 'file',
          summary: exportSummary,
          currentBytes: 512,
          currentTotalBytes: 2048,
        });
        return exportSummary;
      },
      moveEntry: (volumeId, input) => {
        moveCalls.push({ volumeId, ...input });
        return Promise.resolve(`${input.destinationDirectoryPath}/${input.newName ?? 'moved'}`);
      },
      deleteEntry: (volumeId, path) => {
        deleteEntryCalls.push({ volumeId, path });
        return Promise.resolve(3);
      },
      deleteVolume: (volumeId) => {
        deleteVolumeCalls.push(volumeId);
        return Promise.resolve();
      },
      previewFile: (volumeId, sourcePath) => {
        previewCalls.push({ volumeId, sourcePath });
        return Promise.resolve(preview);
      },
    },
    volumes,
    confirmAction: (confirm) => {
      confirmPrompts.push(confirm.title);
      return Promise.resolve(confirmations.shift() ?? true);
    },
    formatExportProgress: (progress) =>
      `Exporting ${progress.currentVirtualPath} -> ${progress.destinationHostPath}`,
    formatImportProgress: (progress) => `Importing ${progress.currentHostPath}`,
    getVolumes: () => runtime.volumes,
    goToDashboard: () => {
      dashboardCalls += 1;
      return Promise.resolve();
    },
    loadVolumes: () => {
      loadVolumesCalls += 1;
      runtime.volumes = volumes;
      return Promise.resolve();
    },
    notify: (tone, message, detail) => {
      notifications.push({ tone, message, detail });
    },
    openHostExportOverlay: () => Promise.resolve(exportDestination),
    openHostImportOverlay: () => Promise.resolve(importSelection),
    openPreviewOverlay: (filePreview) => {
      openPreviews.push(filePreview);
      return Promise.resolve();
    },
    openVolume: (volumeId, targetPath, selectionIndex) => {
      openVolumes.push({ volumeId, targetPath, selectionIndex });
      return Promise.resolve();
    },
    promptValue: (prompt) => {
      promptDescriptions.push(prompt.description);
      return Promise.resolve(promptValues.shift() ?? null);
    },
    render: () => {
      renderCalls += 1;
    },
    runTask: (label, operation, detail) => {
      taskCalls.push({ label, detail });
      return operation();
    },
    setSelectedVolumeIndex: (index) => {
      runtime.selectedVolumeIndex = index;
      selectedVolumeAssignments.push(index);
    },
    updateBusyState: (update) => {
      busyUpdates.push(update);
    },
  };

  return {
    busyUpdates,
    confirmPrompts,
    createDirectoryCalls,
    createVolumeInputs,
    get dashboardCalls() {
      return dashboardCalls;
    },
    deleteEntryCalls,
    deleteVolumeCalls,
    exportCalls,
    get loadVolumesCalls() {
      return loadVolumesCalls;
    },
    moveCalls,
    notifications,
    openPreviews,
    openVolumes,
    previewCalls,
    promptDescriptions,
    get renderCalls() {
      return renderCalls;
    },
    runtime,
    selectedVolumeAssignments,
    setVolumes: (nextVolumes) => {
      volumes = [...nextVolumes];
      runtime.volumes = volumes;
    },
    taskCalls,
  };
};

describe('ui action runtime', () => {
  it('executes the create-volume flow and selects the created volume after refresh', async () => {
    const harness = createActionRuntimeHarness({
      promptValues: ['Roadmap', '', 'Planning workspace'],
      volumes: [sampleVolume],
    });
    harness.setVolumes([sampleVolume, secondVolume]);

    await runCreateVolumeWizard(harness.runtime);

    expect(harness.createVolumeInputs).toEqual([
      {
        name: 'Roadmap',
        quotaBytes: undefined,
        description: 'Planning workspace',
      },
    ]);
    expect(harness.taskCalls).toEqual([{ label: 'Creating volume', detail: undefined }]);
    expect(harness.notifications).toContainEqual({
      tone: 'success',
      message: 'Volume "Roadmap" created.',
      detail: undefined,
    });
    expect(harness.loadVolumesCalls).toBe(1);
    expect(harness.selectedVolumeAssignments).toEqual([1]);
    expect(harness.runtime.selectedVolumeIndex).toBe(1);
    expect(harness.renderCalls).toBe(1);
  });

  it('rejects invalid create-volume quota input before running the task', async () => {
    const harness = createActionRuntimeHarness({
      promptValues: ['Roadmap', 'oops'],
    });

    await runCreateVolumeWizard(harness.runtime);

    expect(harness.createVolumeInputs).toHaveLength(0);
    expect(harness.taskCalls).toHaveLength(0);
    expect(harness.notifications).toEqual([
      {
        tone: 'error',
        message: 'Quota bytes must be a valid integer.',
        detail: undefined,
      },
    ]);
  });

  it('runs create-folder and move-entry flows through task execution and refresh', async () => {
    const folderHarness = createActionRuntimeHarness({
      promptValues: ['archives'],
    });

    await runCreateFolderWizard(folderHarness.runtime);

    expect(folderHarness.createDirectoryCalls).toEqual([
      {
        volumeId: 'volume-1',
        currentPath: '/reports',
        name: 'archives',
      },
    ]);
    expect(folderHarness.notifications).toContainEqual({
      tone: 'success',
      message: 'Folder "archives" created.',
      detail: undefined,
    });
    expect(folderHarness.openVolumes).toEqual([
      {
        volumeId: 'volume-1',
        targetPath: '/reports',
        selectionIndex: 1,
      },
    ]);

    const moveHarness = createActionRuntimeHarness({
      promptValues: ['/archive', 'report-final.txt'],
    });

    await runMoveSelectedEntry(moveHarness.runtime);

    expect(moveHarness.moveCalls).toEqual([
      {
        volumeId: 'volume-1',
        sourcePath: '/reports/report.txt',
        destinationDirectoryPath: '/archive',
        newName: 'report-final.txt',
      },
    ]);
    expect(moveHarness.notifications).toContainEqual({
      tone: 'success',
      message: 'Entry moved to /archive/report-final.txt.',
      detail: undefined,
    });
    expect(moveHarness.openVolumes).toEqual([
      {
        volumeId: 'volume-1',
        targetPath: '/reports',
        selectionIndex: 1,
      },
    ]);
  });

  it('handles import flow empty selections and successful imports with progress', async () => {
    const emptyHarness = createActionRuntimeHarness({
      importSelection: [],
    });

    await runImportWizard(emptyHarness.runtime);

    expect(emptyHarness.taskCalls).toHaveLength(0);
    expect(emptyHarness.notifications).toEqual([
      {
        tone: 'info',
        message: 'Select at least one host file or folder to import.',
        detail: undefined,
      },
    ]);

    const importHarness = createActionRuntimeHarness({
      importSelection: ['C:\\imports\\report.txt'],
    });

    await runImportWizard(importHarness.runtime);

    expect(importHarness.taskCalls).toEqual([
      {
        label: 'Importing host paths',
        detail: 'Destination /reports  1 host items queued.',
      },
    ]);
    expect(importHarness.busyUpdates).toEqual([
      {
        detail: 'Importing C:\\imports\\report.txt',
        currentValue: 1024,
        totalValue: 2048,
      },
    ]);
    expect(importHarness.notifications).toContainEqual({
      tone: 'success',
      message: 'Imported 1 files and 1 directories.',
      detail:
        'Destination /reports  2.0 KB transferred  Conflicts 0  Integrity 2',
    });
    expect(importHarness.openVolumes).toEqual([
      {
        volumeId: 'volume-1',
        targetPath: '/reports',
        selectionIndex: undefined,
      },
    ]);
  });

  it('handles export flow guard rails and successful exports with progress', async () => {
    const guardHarness = createActionRuntimeHarness({
      selectedEntry: null,
    });

    await runExportWizard(guardHarness.runtime);

    expect(guardHarness.taskCalls).toHaveLength(0);
    expect(guardHarness.notifications).toEqual([
      {
        tone: 'info',
        message: 'Select a file or folder first.',
        detail: undefined,
      },
    ]);

    const exportHarness = createActionRuntimeHarness({
      exportDestination: 'C:\\exports',
    });

    await runExportWizard(exportHarness.runtime);

    expect(exportHarness.exportCalls).toEqual([
      {
        volumeId: 'volume-1',
        sourcePath: '/reports/report.txt',
        destinationHostDirectory: 'C:\\exports',
      },
    ]);
    expect(exportHarness.busyUpdates).toEqual([
      {
        detail: 'Exporting /reports/report.txt -> C:\\exports\\report.txt',
        currentValue: 512,
        totalValue: 2048,
      },
    ]);
    expect(exportHarness.notifications).toContainEqual({
      tone: 'success',
      message: 'Exported 1 files and 0 directories.',
      detail: 'Destination C:\\exports  2.0 KB transferred  Conflicts 0  Integrity 1',
    });
    expect(exportHarness.renderCalls).toBe(1);
  });

  it('runs delete-entry and delete-volume flows after confirmation', async () => {
    const deleteEntryHarness = createActionRuntimeHarness({
      confirmations: [true],
    });

    await runDeleteSelectedEntry(deleteEntryHarness.runtime);

    expect(deleteEntryHarness.confirmPrompts).toEqual(['Delete Entry']);
    expect(deleteEntryHarness.deleteEntryCalls).toEqual([
      {
        volumeId: 'volume-1',
        path: '/reports/report.txt',
      },
    ]);
    expect(deleteEntryHarness.notifications).toContainEqual({
      tone: 'success',
      message: 'Deleted 3 entry nodes.',
      detail: undefined,
    });
    expect(deleteEntryHarness.openVolumes).toEqual([
      {
        volumeId: 'volume-1',
        targetPath: '/reports',
        selectionIndex: 1,
      },
    ]);

    const deleteVolumeHarness = createActionRuntimeHarness({
      confirmations: [true],
      selectedVolumeIndex: 0,
      volumes: [sampleVolume, secondVolume],
    });

    await runDeleteSelectedVolume(deleteVolumeHarness.runtime);

    expect(deleteVolumeHarness.confirmPrompts).toEqual(['Delete Volume']);
    expect(deleteVolumeHarness.deleteVolumeCalls).toEqual(['volume-1']);
    expect(deleteVolumeHarness.notifications).toContainEqual({
      tone: 'success',
      message: 'Volume "Finance" deleted.',
      detail: undefined,
    });
    expect(deleteVolumeHarness.dashboardCalls).toBe(1);
  });

  it('guards preview for non-file selections and opens the preview overlay for files', async () => {
    const guardHarness = createActionRuntimeHarness({
      selectedEntry: directoryEntry,
      selectedEntryIndex: 0,
    });

    await runPreviewSelectedEntry(guardHarness.runtime);

    expect(guardHarness.previewCalls).toHaveLength(0);
    expect(guardHarness.notifications).toEqual([
      {
        tone: 'info',
        message: 'Preview is available for files only.',
        detail: undefined,
      },
    ]);

    const previewHarness = createActionRuntimeHarness({
      selectedEntry: fileEntry,
      selectedEntryIndex: 1,
    });

    await runPreviewSelectedEntry(previewHarness.runtime);

    expect(previewHarness.previewCalls).toEqual([
      {
        volumeId: 'volume-1',
        sourcePath: '/reports/report.txt',
      },
    ]);
    expect(previewHarness.openPreviews).toEqual([preview]);
  });
});
