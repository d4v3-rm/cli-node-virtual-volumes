import type {
  DirectoryListingItem,
  ExportSummary,
  FilePreview,
  ImportSummary,
  VolumeManifest,
} from '../domain/types.js';
import { formatBytes } from '../utils/formatters.js';
import type {
  ConfirmOverlayOptions,
  PromptOverlayOptions,
  ScrollableOverlayOptions,
} from './dialog-overlay.js';

export const buildCreateVolumePrompts = (
  defaultQuotaBytes: number,
): {
  description: PromptOverlayOptions;
  name: PromptOverlayOptions;
  quota: PromptOverlayOptions;
} => ({
  name: {
    title: 'Create Volume',
    description: 'Volume name',
    initialValue: '',
    footer: 'Enter saves. Esc cancels.',
  },
  quota: {
    title: 'Create Volume',
    description: 'Logical quota in bytes. Leave empty to use the default quota.',
    initialValue: String(defaultQuotaBytes),
    footer: 'Enter saves. Esc cancels.',
  },
  description: {
    title: 'Create Volume',
    description: 'Optional description',
    initialValue: '',
    footer: 'Enter saves. Esc cancels.',
  },
});

export const parseVolumeQuotaInput = (
  quotaInput: string,
): {
  error: string | null;
  quotaBytes: number | undefined;
} => {
  const trimmedQuota = quotaInput.trim();
  const parsedQuota =
    trimmedQuota.length === 0 ? undefined : Number.parseInt(trimmedQuota, 10);

  if (parsedQuota !== undefined && Number.isNaN(parsedQuota)) {
    return {
      error: 'Quota bytes must be a valid integer.',
      quotaBytes: undefined,
    };
  }

  return {
    error: null,
    quotaBytes: parsedQuota,
  };
};

export const buildCreateVolumeSuccessMessage = (volumeName: string): string =>
  `Volume "${volumeName}" created.`;

export const buildCreateFolderPrompt = (currentPath: string): PromptOverlayOptions => ({
  title: 'Create Folder',
  description: `New folder inside ${currentPath}`,
  initialValue: '',
  footer: 'Enter saves. Esc cancels.',
});

export const buildCreateFolderSuccessMessage = (folderName: string): string =>
  `Folder "${folderName}" created.`;

export const buildMoveEntryPrompts = (
  entryName: string,
  currentPath: string,
): {
  destination: PromptOverlayOptions;
  rename: PromptOverlayOptions;
} => ({
  destination: {
    title: 'Move / Rename',
    description: `Destination path for ${entryName}`,
    initialValue: currentPath,
    footer: 'Enter saves. Esc cancels.',
  },
  rename: {
    title: 'Move / Rename',
    description: 'New name. Leave unchanged to keep the current entry name.',
    initialValue: entryName,
    footer: 'Enter saves. Esc cancels.',
  },
});

export const buildMoveEntrySuccessMessage = (updatedPath: string): string =>
  `Entry moved to ${updatedPath}.`;

export const buildDeleteEntryConfirmation = (
  entry: Pick<DirectoryListingItem, 'name' | 'path'>,
): ConfirmOverlayOptions => ({
  title: 'Delete Entry',
  body: `Delete "${entry.name}" and every nested node inside ${entry.path}?`,
  confirmLabel: 'Delete',
});

export const buildDeleteEntrySuccessMessage = (deletedCount: number): string =>
  `Deleted ${deletedCount} entry nodes.`;

export const buildDeleteVolumeConfirmation = (
  volume: Pick<VolumeManifest, 'name'>,
): ConfirmOverlayOptions => ({
  title: 'Delete Volume',
  body: `Delete volume "${volume.name}" and all persisted blobs and metadata?`,
  confirmLabel: 'Delete',
});

export const buildDeleteVolumeSuccessMessage = (volumeName: string): string =>
  `Volume "${volumeName}" deleted.`;

export const buildImportEmptySelectionMessage = (): string =>
  'Select at least one host file or folder to import.';

export const buildImportTaskDetail = (
  destinationPath: string,
  queuedItems: number,
): string => `Destination ${destinationPath}  ${queuedItems} host items queued.`;

export const buildImportSuccessNotification = (
  summary: ImportSummary,
  destinationPath: string,
): {
  detail: string;
  message: string;
} => ({
  message: `Imported ${summary.filesImported} files and ${summary.directoriesImported} directories.`,
  detail: `Destination ${destinationPath}  ${formatBytes(summary.bytesImported)} transferred  Conflicts ${summary.conflictsResolved}  Integrity ${summary.integrityChecksPassed}`,
});

export const buildExportTaskDetail = (
  sourcePath: string,
  destinationHostDirectory: string,
): string => `Source ${sourcePath}  Destination ${destinationHostDirectory}`;

export const buildExportSuccessNotification = (
  summary: ExportSummary,
  destinationHostDirectory: string,
): {
  detail: string;
  message: string;
} => ({
  message: `Exported ${summary.filesExported} files and ${summary.directoriesExported} directories.`,
  detail: `Destination ${destinationHostDirectory}  ${formatBytes(summary.bytesExported)} transferred  Conflicts ${summary.conflictsResolved}  Integrity ${summary.integrityChecksPassed}`,
});

export const buildHelpOverlayOptions = (): ScrollableOverlayOptions => ({
  title: 'Help',
  footer: 'Arrows/PageUp/PageDown scroll. Enter, Q or Esc closes.',
  content: [
    'Dashboard',
    '',
    'Up/Down: move selection',
    'Enter or O: open selected volume',
    'N: create volume',
    'X: delete volume',
    'R: refresh volumes',
    '? : help',
    'Q: quit',
    '',
    'Explorer',
    '',
    'Up/Down: move selection',
    'PageUp/PageDown: move by page',
    'Home/End: jump first or last entry',
    'Right or Enter: open directory or preview file',
    'Backspace, Left or B: parent directory or dashboard',
    'C: create folder',
    'I: open host browser import modal',
    'E: export selected file or folder to host',
    'M: move or rename entry',
    'D: delete entry',
    'P: preview file',
    'R: refresh current directory',
    '',
    'Host Import Modal',
    '',
    'Up/Down: move selection',
    'Right: enter selected folder or drive',
    'Left: parent folder',
    'Space: toggle checkbox on file or folder',
    'Enter or I: import all checked items',
    'A: toggle all visible entries',
    'Esc or Q: cancel',
    '',
    'Host Export Modal',
    '',
    'Up/Down: move selection',
    'Right: enter selected folder or drive',
    'Left: parent folder',
    'Enter or E: export into the current host folder',
    'Esc or Q: cancel',
  ].join('\n'),
});

export const buildPreviewOverlayOptions = (
  preview: FilePreview,
): ScrollableOverlayOptions => ({
  title: `Preview  ${preview.path}`,
  footer: 'Arrows/PageUp/PageDown scroll. Enter, Q or Esc closes.',
  content: [
    `Kind: ${preview.kind.toUpperCase()}`,
    `Size: ${formatBytes(preview.size)}`,
    `Truncated: ${preview.truncated ? 'yes' : 'no'}`,
    '',
    preview.content,
  ].join('\n'),
});
