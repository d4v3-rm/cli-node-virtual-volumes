import type { VolumeService } from '../application/volume-service.js';
import type {
  DirectoryListingItem,
  ExplorerSnapshot,
  ExportProgress,
  FilePreview,
  ImportProgress,
  VolumeManifest,
} from '../domain/types.js';
import type {
  ChoiceOverlayOptions,
  ConfirmOverlayOptions,
  PromptOverlayOptions,
} from './dialog-overlay.js';
import type { ToastTone } from './runtime-state.js';
import {
  getCreateFolderAction,
  getCreatedVolumeSelectionIndex,
  getEditVolumeAction,
  getDeleteEntryAction,
  getDeleteVolumeAction,
  getExportAction,
  getImportAction,
  getMoveEntryAction,
  getPreviewEntryAction,
  type ExplorerActionContext,
} from './action-controller.js';
import {
  buildCreateFolderPrompt,
  buildCreateFolderSuccessMessage,
  buildCreateVolumePrompts,
  buildCreateVolumeSuccessMessage,
  buildEditVolumePrompts,
  buildEditVolumeSuccessMessage,
  buildDeleteEntryConfirmation,
  buildDeleteEntrySuccessMessage,
  buildDeleteVolumeConfirmation,
  buildDeleteVolumeSuccessMessage,
  buildExportSuccessNotification,
  buildExportTaskDetail,
  buildImportEmptySelectionMessage,
  buildImportSuccessNotification,
  buildImportTaskDetail,
  buildMoveEntryPrompts,
  buildMoveEntrySuccessMessage,
  parseVolumeQuotaInput,
} from './action-presenters.js';

type GuardedAction<TReady> =
  | { kind: 'noop' }
  | { kind: 'notify'; message: string }
  | ({ kind: 'ready' } & TReady);

type ActionRuntimeVolumeService = Pick<
  VolumeService,
  | 'createDirectory'
  | 'createVolume'
  | 'deleteEntry'
  | 'deleteVolume'
  | 'exportEntryToHost'
  | 'importHostPaths'
  | 'moveEntry'
  | 'previewFile'
  | 'updateVolumeMetadata'
>;

export interface ActionRuntime {
  currentSnapshot: ExplorerSnapshot | null;
  currentVolumeId: string | null;
  defaultQuotaBytes: number;
  selectedEntry: DirectoryListingItem | null;
  selectedEntryIndex: number;
  selectedVolumeIndex: number;
  volumeService: ActionRuntimeVolumeService;
  volumes: VolumeManifest[];
  confirmAction: (options: ConfirmOverlayOptions) => Promise<boolean>;
  formatExportProgress: (progress: ExportProgress) => string;
  formatImportProgress: (progress: ImportProgress) => string;
  getVolumes: () => VolumeManifest[];
  goToDashboard: () => Promise<void>;
  loadVolumes: () => Promise<void>;
  notify: (tone: ToastTone, message: string, detail?: string) => void;
  openHostExportOverlay: (sourcePath: string) => Promise<string | null>;
  openHostImportOverlay: (destinationPath: string) => Promise<string[] | null>;
  openPreviewOverlay: (preview: FilePreview) => Promise<void>;
  openVolume: (
    volumeId: string,
    targetPath?: string,
    selectionIndex?: number,
  ) => Promise<void>;
  promptValue: (options: PromptOverlayOptions) => Promise<string | null>;
  promptChoice: (options: ChoiceOverlayOptions) => Promise<string | null>;
  render: () => void;
  runTask: <T>(
    label: string,
    operation: () => Promise<T>,
    detail?: string,
  ) => Promise<T | null>;
  setSelectedVolumeIndex: (index: number) => void;
  updateBusyState: (options: {
    label?: string;
    detail?: string;
    currentValue?: number | null;
    totalValue?: number | null;
  }) => void;
}

const getExplorerContext = (runtime: ActionRuntime): ExplorerActionContext => ({
  currentSnapshot: runtime.currentSnapshot,
  currentVolumeId: runtime.currentVolumeId,
  selectedEntry: runtime.selectedEntry,
  selectedEntryIndex: runtime.selectedEntryIndex,
});

const resolveReadyAction = <TReady>(
  runtime: Pick<ActionRuntime, 'notify'>,
  action: GuardedAction<TReady>,
): ({ kind: 'ready' } & TReady) | null => {
  if (action.kind === 'notify') {
    runtime.notify('info', action.message);
    return null;
  }

  return action.kind === 'ready' ? action : null;
};

export const runCreateVolumeWizard = async (runtime: ActionRuntime): Promise<void> => {
  const prompts = buildCreateVolumePrompts(runtime.defaultQuotaBytes);
  const name = await runtime.promptValue(prompts.name);
  if (name === null) {
    return;
  }

  const quotaValue = await runtime.promptValue(prompts.quotaValue);
  if (quotaValue === null) {
    return;
  }

  let quotaBytes: number | undefined;
  if (quotaValue.trim().length > 0) {
    const quotaUnit = await runtime.promptChoice(prompts.quotaUnit);
    if (quotaUnit === null) {
      return;
    }

    const parsedQuota = parseVolumeQuotaInput(quotaValue, quotaUnit);
    if (parsedQuota.error) {
      runtime.notify('error', parsedQuota.error);
      return;
    }

    quotaBytes = parsedQuota.quotaBytes;
  }

  const description = await runtime.promptValue(prompts.description);
  if (description === null) {
    return;
  }

  const createdVolume = await runtime.runTask('Creating volume', () =>
    runtime.volumeService.createVolume({
      name,
      quotaBytes,
      description,
    }),
  );
  if (!createdVolume) {
    return;
  }

  runtime.notify('success', buildCreateVolumeSuccessMessage(createdVolume.name));
  await runtime.loadVolumes();
  runtime.setSelectedVolumeIndex(
    getCreatedVolumeSelectionIndex(runtime.getVolumes(), createdVolume.id),
  );
  runtime.render();
};

export const runCreateFolderWizard = async (runtime: ActionRuntime): Promise<void> => {
  const action = resolveReadyAction(
    runtime,
    getCreateFolderAction(getExplorerContext(runtime)),
  );
  if (!action) {
    return;
  }

  const name = await runtime.promptValue(buildCreateFolderPrompt(action.currentPath));
  if (name === null) {
    return;
  }

  const createdDirectory = await runtime.runTask('Creating folder', () =>
    runtime.volumeService.createDirectory(action.volumeId, action.currentPath, name),
  );
  if (!createdDirectory) {
    return;
  }

  runtime.notify('success', buildCreateFolderSuccessMessage(createdDirectory.name));
  await runtime.openVolume(
    action.refreshRequest.volumeId,
    action.refreshRequest.targetPath,
    action.refreshRequest.selectionIndex,
  );
};

export const runEditSelectedVolumeWizard = async (runtime: ActionRuntime): Promise<void> => {
  const action = resolveReadyAction(
    runtime,
    getEditVolumeAction(runtime.volumes, runtime.selectedVolumeIndex),
  );
  if (!action) {
    return;
  }

  const prompts = buildEditVolumePrompts(action.volume);
  const name = await runtime.promptValue(prompts.name);
  if (name === null) {
    return;
  }

  const description = await runtime.promptValue(prompts.description);
  if (description === null) {
    return;
  }

  const updatedVolume = await runtime.runTask('Updating volume', () =>
    runtime.volumeService.updateVolumeMetadata(action.volume.id, {
      name,
      description,
    }),
  );
  if (!updatedVolume) {
    return;
  }

  runtime.notify('success', buildEditVolumeSuccessMessage(updatedVolume.name));
  await runtime.loadVolumes();
  runtime.setSelectedVolumeIndex(
    getCreatedVolumeSelectionIndex(runtime.getVolumes(), updatedVolume.id),
  );
  runtime.render();
};

export const runImportWizard = async (runtime: ActionRuntime): Promise<void> => {
  const action = resolveReadyAction(runtime, getImportAction(getExplorerContext(runtime)));
  if (!action) {
    return;
  }

  const hostPaths = await runtime.openHostImportOverlay(action.destinationPath);
  if (hostPaths === null) {
    return;
  }

  if (hostPaths.length === 0) {
    runtime.notify('info', buildImportEmptySelectionMessage());
    return;
  }

  const summary = await runtime.runTask(
    'Importing host paths',
    () =>
      runtime.volumeService.importHostPaths(action.volumeId, {
        hostPaths,
        destinationPath: action.destinationPath,
        onProgress: (progress) => {
          runtime.updateBusyState({
            detail: runtime.formatImportProgress(progress),
            currentValue: progress.currentBytes,
            totalValue: progress.currentTotalBytes,
          });
        },
      }),
    buildImportTaskDetail(action.destinationPath, hostPaths.length),
  );
  if (!summary) {
    return;
  }

  const success = buildImportSuccessNotification(summary, action.destinationPath);
  runtime.notify('success', success.message, success.detail);
  await runtime.openVolume(action.volumeId, action.destinationPath);
};

export const runExportWizard = async (runtime: ActionRuntime): Promise<void> => {
  const action = resolveReadyAction(runtime, getExportAction(getExplorerContext(runtime)));
  if (!action) {
    return;
  }

  const destinationHostDirectory = await runtime.openHostExportOverlay(action.sourcePath);
  if (destinationHostDirectory === null) {
    return;
  }

  const summary = await runtime.runTask(
    'Exporting to host',
    () =>
      runtime.volumeService.exportEntryToHost(action.volumeId, {
        sourcePath: action.sourcePath,
        destinationHostDirectory,
        onProgress: (progress) => {
          runtime.updateBusyState({
            detail: runtime.formatExportProgress(progress),
            currentValue: progress.currentBytes,
            totalValue: progress.currentTotalBytes,
          });
        },
      }),
    buildExportTaskDetail(action.sourcePath, destinationHostDirectory),
  );
  if (!summary) {
    return;
  }

  const success = buildExportSuccessNotification(summary, destinationHostDirectory);
  runtime.notify('success', success.message, success.detail);
  runtime.render();
};

export const runMoveSelectedEntry = async (runtime: ActionRuntime): Promise<void> => {
  const action = resolveReadyAction(runtime, getMoveEntryAction(getExplorerContext(runtime)));
  if (!action) {
    return;
  }

  const movePrompts = buildMoveEntryPrompts(action.selectedEntry.name, action.currentPath);
  const destinationPath = await runtime.promptValue(movePrompts.destination);
  if (destinationPath === null) {
    return;
  }

  const newName = await runtime.promptValue(movePrompts.rename);
  if (newName === null) {
    return;
  }

  const updatedPath = await runtime.runTask('Moving entry', () =>
    runtime.volumeService.moveEntry(action.volumeId, {
      sourcePath: action.selectedEntry.path,
      destinationDirectoryPath: destinationPath,
      newName,
    }),
  );
  if (!updatedPath) {
    return;
  }

  runtime.notify('success', buildMoveEntrySuccessMessage(updatedPath));
  await runtime.openVolume(
    action.refreshRequest.volumeId,
    action.refreshRequest.targetPath,
    action.refreshRequest.selectionIndex,
  );
};

export const runDeleteSelectedEntry = async (runtime: ActionRuntime): Promise<void> => {
  const action = resolveReadyAction(runtime, getDeleteEntryAction(getExplorerContext(runtime)));
  if (!action) {
    return;
  }

  const confirmed = await runtime.confirmAction(
    buildDeleteEntryConfirmation(action.selectedEntry),
  );
  if (!confirmed) {
    return;
  }

  const deletedCount = await runtime.runTask('Deleting entry', () =>
    runtime.volumeService.deleteEntry(action.volumeId, action.selectedEntry.path),
  );
  if (deletedCount === null) {
    return;
  }

  runtime.notify('success', buildDeleteEntrySuccessMessage(deletedCount));
  await runtime.openVolume(
    action.refreshRequest.volumeId,
    action.refreshRequest.targetPath,
    action.refreshRequest.selectionIndex,
  );
};

export const runDeleteSelectedVolume = async (runtime: ActionRuntime): Promise<void> => {
  const action = resolveReadyAction(
    runtime,
    getDeleteVolumeAction(runtime.volumes, runtime.selectedVolumeIndex),
  );
  if (!action) {
    return;
  }

  const confirmed = await runtime.confirmAction(
    buildDeleteVolumeConfirmation(action.volume),
  );
  if (!confirmed) {
    return;
  }

  const deleted = await runtime.runTask('Deleting volume', async () => {
    await runtime.volumeService.deleteVolume(action.volume.id);
    return true;
  });
  if (!deleted) {
    return;
  }

  runtime.notify('success', buildDeleteVolumeSuccessMessage(action.volume.name));
  await runtime.goToDashboard();
};

export const runPreviewSelectedEntry = async (runtime: ActionRuntime): Promise<void> => {
  const action = resolveReadyAction(runtime, getPreviewEntryAction(getExplorerContext(runtime)));
  if (!action) {
    return;
  }

  const preview = await runtime.runTask('Loading preview', () =>
    runtime.volumeService.previewFile(action.volumeId, action.sourcePath),
  );
  if (!preview) {
    return;
  }

  await runtime.openPreviewOverlay(preview);
};
