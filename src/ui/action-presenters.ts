import type {
  DirectoryListingItem,
  ExportSummary,
  FilePreview,
  ImportSummary,
  VolumeManifest,
} from '../domain/types.js';
import { formatBytes } from '../utils/formatters.js';
import type {
  ChoiceOverlayOptions,
  ConfirmOverlayOptions,
  PromptOverlayOptions,
  ScrollableOverlayOptions,
} from './dialog-overlay.js';

export const VOLUME_QUOTA_UNITS = ['KB', 'MB', 'GB', 'TB'] as const;
export type VolumeQuotaUnit = (typeof VOLUME_QUOTA_UNITS)[number];

const QUOTA_UNIT_MULTIPLIERS: Record<VolumeQuotaUnit, bigint> = {
  KB: 1024n,
  MB: 1024n ** 2n,
  GB: 1024n ** 3n,
  TB: 1024n ** 4n,
};

const clampChoiceIndex = (selectedIndex: number, choicesLength: number): number => {
  if (choicesLength <= 0) {
    return 0;
  }

  return Math.min(Math.max(0, selectedIndex), choicesLength - 1);
};

const formatExactQuotaValue = (quotaBytes: number, unit: VolumeQuotaUnit): string => {
  const denominator = QUOTA_UNIT_MULTIPLIERS[unit];
  const whole = BigInt(quotaBytes) / denominator;
  let remainder = BigInt(quotaBytes) % denominator;

  if (remainder === 0n) {
    return whole.toString();
  }

  const fractionalDigits: string[] = [];
  while (remainder > 0n) {
    remainder *= 10n;
    fractionalDigits.push((remainder / denominator).toString());
    remainder %= denominator;
  }

  return `${whole}.${fractionalDigits.join('').replace(/0+$/, '')}`;
};

const getPreferredQuotaUnit = (quotaBytes: number): VolumeQuotaUnit => {
  const rankedUnits: VolumeQuotaUnit[] = ['TB', 'GB', 'MB', 'KB'];

  for (const unit of rankedUnits) {
    const multiplier = QUOTA_UNIT_MULTIPLIERS[unit];
    if (BigInt(quotaBytes) >= multiplier) {
      return unit;
    }
  }

  return 'KB';
};

const getDefaultQuotaPresentation = (
  defaultQuotaBytes: number,
): {
  unit: VolumeQuotaUnit;
  value: string;
} => {
  const unit = getPreferredQuotaUnit(defaultQuotaBytes);
  return {
    unit,
    value: formatExactQuotaValue(defaultQuotaBytes, unit),
  };
};

export const isVolumeQuotaUnit = (value: string): value is VolumeQuotaUnit =>
  VOLUME_QUOTA_UNITS.includes(value as VolumeQuotaUnit);

export const buildCreateVolumePrompts = (
  defaultQuotaBytes: number,
): {
  description: PromptOverlayOptions;
  name: PromptOverlayOptions;
  quotaUnit: ChoiceOverlayOptions;
  quotaValue: PromptOverlayOptions;
} => {
  const defaultQuota = getDefaultQuotaPresentation(defaultQuotaBytes);

  return {
  name: {
    title: 'Create Volume',
    description: 'Volume name',
    initialValue: '',
    footer: 'Enter saves. Esc cancels.',
  },
  quotaValue: {
    title: 'Create Volume',
    description: `Logical quota value. Leave empty to use the default quota of ${formatBytes(defaultQuotaBytes)}.`,
    initialValue: defaultQuota.value,
    footer: 'Enter saves. Esc cancels.',
  },
  quotaUnit: {
    title: 'Create Volume',
    description: 'Quota unit. Left/Right or Tab switches between binary units.',
    choices: [...VOLUME_QUOTA_UNITS],
    initialIndex: clampChoiceIndex(
      VOLUME_QUOTA_UNITS.indexOf(defaultQuota.unit),
      VOLUME_QUOTA_UNITS.length,
    ),
    footer: 'Left/Right or Tab switches. Enter saves. Esc cancels.',
  },
  description: {
    title: 'Create Volume',
    description: 'Optional description',
    initialValue: '',
    footer: 'Enter saves. Esc cancels.',
  },
  };
};

export const parseVolumeQuotaInput = (
  quotaInput: string,
  quotaUnit: string,
): {
  error: string | null;
  quotaBytes: number | undefined;
} => {
  const trimmedQuota = quotaInput.trim();
  if (trimmedQuota.length === 0) {
    return {
      error: null,
      quotaBytes: undefined,
    };
  }

  if (!isVolumeQuotaUnit(quotaUnit)) {
    return {
      error: `Quota unit must be one of ${VOLUME_QUOTA_UNITS.join(', ')}.`,
      quotaBytes: undefined,
    };
  }

  const normalizedQuota = trimmedQuota.replace(',', '.');
  if (!/^\d+(?:\.\d+)?$/.test(normalizedQuota)) {
    return {
      error: 'Quota value must be a valid number.',
      quotaBytes: undefined,
    };
  }

  const [wholePart, fractionalPart = ''] = normalizedQuota.split('.');
  const scale = 10n ** BigInt(fractionalPart.length);
  const numerator = BigInt(`${wholePart}${fractionalPart}`);
  const bytesNumerator = numerator * QUOTA_UNIT_MULTIPLIERS[quotaUnit];

  if (bytesNumerator % scale !== 0n) {
    return {
      error: `Quota ${trimmedQuota} ${quotaUnit} does not resolve to a whole number of bytes.`,
      quotaBytes: undefined,
    };
  }

  const quotaBytes = bytesNumerator / scale;
  if (quotaBytes <= 0n) {
    return {
      error: 'Quota must be greater than zero.',
      quotaBytes: undefined,
    };
  }

  if (quotaBytes > BigInt(Number.MAX_SAFE_INTEGER)) {
    return {
      error: 'Quota exceeds the supported size for this runtime.',
      quotaBytes: undefined,
    };
  }

  return {
    error: null,
    quotaBytes: Number(quotaBytes),
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
