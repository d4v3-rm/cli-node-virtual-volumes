import path from 'node:path';

import type {
  DirectoryListingItem,
  ExportProgress,
  ImportProgress,
  VolumeManifest,
} from '../domain/types.js';
import { formatBytes, formatDateTime, truncate } from '../utils/formatters.js';
import type { HostBrowserEntry } from './host-browser.js';

export const TERMINAL_ICONS = {
  checkboxOff: '[ ]',
  checkboxOn: '[x]',
  drive: '=',
  file: '-',
  folder: '>',
  parent: '<',
  volume: '*',
} as const;

export const fitSingleLine = (value: string, width: number): string => {
  const normalized = value.replace(/\s+/g, ' ').trim();
  return truncate(normalized, Math.max(1, width));
};

export const wrapTextLines = (value: string, width: number): string[] => {
  const normalized = value.replace(/\s+/g, ' ').trim();
  const availableWidth = Math.max(1, width);

  if (normalized.length === 0) {
    return [''];
  }

  const words = normalized.split(' ');
  const lines: string[] = [];
  let currentLine = '';

  for (const word of words) {
    if (word.length > availableWidth) {
      if (currentLine.length > 0) {
        lines.push(currentLine);
        currentLine = '';
      }

      for (let index = 0; index < word.length; index += availableWidth) {
        lines.push(word.slice(index, index + availableWidth));
      }
      continue;
    }

    const nextLine =
      currentLine.length === 0 ? word : `${currentLine} ${word}`;

    if (nextLine.length > availableWidth) {
      lines.push(currentLine);
      currentLine = word;
    } else {
      currentLine = nextLine;
    }
  }

  if (currentLine.length > 0) {
    lines.push(currentLine);
  }

  return lines.length > 0 ? lines : [''];
};

export const buildAsciiMeter = (
  value: number,
  total: number,
  width: number,
): string => {
  const safeTotal = total > 0 ? total : 1;
  const safeValue = Math.max(0, Math.min(value, safeTotal));
  const slots = Math.max(6, width);
  const ratio = safeValue / safeTotal;
  const filled = Math.round(ratio * slots);

  return `[${'#'.repeat(filled)}${'.'.repeat(slots - filled)}]`;
};

export const formatPercentage = (value: number, total: number): string => {
  if (total <= 0) {
    return '0%';
  }

  return `${Math.round((Math.max(0, value) / total) * 100)}%`;
};

export const getVirtualEntryIcon = (kind: DirectoryListingItem['kind']): string =>
  kind === 'directory' ? TERMINAL_ICONS.folder : TERMINAL_ICONS.file;

export const getHostEntryIcon = (entry: HostBrowserEntry): string => {
  switch (entry.kind) {
    case 'drive':
      return TERMINAL_ICONS.drive;
    case 'directory':
      return TERMINAL_ICONS.folder;
    case 'file':
      return TERMINAL_ICONS.file;
    case 'parent':
      return TERMINAL_ICONS.parent;
    default:
      return TERMINAL_ICONS.file;
  }
};

export const formatVolumeRow = (
  volume: VolumeManifest,
  availableWidth: number,
): string => {
  const used = formatBytes(volume.logicalUsedBytes);
  const quota = formatBytes(volume.quotaBytes);
  const suffix = ` ${used} / ${quota}  `;
  const nameWidth = Math.max(12, Math.floor((availableWidth - 3) * 0.28));
  const descWidth = Math.max(12, availableWidth - suffix.length - nameWidth - 4);
  const name = truncate(volume.name, nameWidth).padEnd(nameWidth, ' ');
  const description = truncate(volume.description || 'No description.', descWidth);

  return `${TERMINAL_ICONS.volume} ${name} ${used} / ${quota}  ${description}`;
};

export const formatEntryRow = (
  entry: DirectoryListingItem,
  availableWidth: number,
): string => {
  const size = entry.kind === 'file' ? formatBytes(entry.size) : 'directory';
  const updated = formatDateTime(entry.updatedAt);
  const suffix = `  ${truncate(size, 10)}  ${updated}`;
  const nameWidth = Math.max(14, availableWidth - suffix.length - 4);
  const name = truncate(entry.name, nameWidth).padEnd(nameWidth, ' ');
  const paddedSize = truncate(size, 10).padStart(10, ' ');

  return `${getVirtualEntryIcon(entry.kind)} ${name}  ${paddedSize}  ${updated}`;
};

export const formatHostBrowserRow = (
  entry: HostBrowserEntry,
  isSelected: boolean,
  availableWidth: number,
): string => {
  const checkbox = entry.selectable
    ? isSelected
      ? TERMINAL_ICONS.checkboxOn
      : TERMINAL_ICONS.checkboxOff
    : ' ';

  return fitSingleLine(`${checkbox} ${getHostEntryIcon(entry)} ${entry.name}`, availableWidth);
};

export const formatHostNavigationRow = (
  entry: HostBrowserEntry,
  availableWidth: number,
): string => fitSingleLine(`${getHostEntryIcon(entry)} ${entry.name}`, availableWidth);

const getTransferPhaseLabel = (phase: 'file' | 'directory' | 'integrity'): string =>
  phase === 'directory' ? 'dir' : phase === 'integrity' ? 'verify' : 'file';

export const formatImportProgress = (progress: ImportProgress): string => {
  const currentTarget = path.basename(progress.currentHostPath) || progress.currentHostPath;
  const phaseLabel = getTransferPhaseLabel(progress.phase);

  return `Current ${phaseLabel}: ${currentTarget}  Imported ${progress.summary.filesImported} files / ${progress.summary.directoriesImported} dirs / ${formatBytes(progress.summary.bytesImported)} / Integrity ${progress.summary.integrityChecksPassed}`;
};

export const formatExportProgress = (progress: ExportProgress): string => {
  const currentTarget = path.basename(progress.currentVirtualPath) || progress.currentVirtualPath;
  const phaseLabel = getTransferPhaseLabel(progress.phase);

  return `Current ${phaseLabel}: ${currentTarget}  Exported ${progress.summary.filesExported} files / ${progress.summary.directoriesExported} dirs / ${formatBytes(progress.summary.bytesExported)} / Integrity ${progress.summary.integrityChecksPassed}`;
};
