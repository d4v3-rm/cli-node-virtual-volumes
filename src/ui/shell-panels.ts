import type {
  DirectoryListingItem,
  ExplorerSnapshot,
  VolumeManifest,
} from '../domain/types.js';
import { formatBytes, formatDateTime, truncate } from '../utils/formatters.js';
import { fitSingleLine, formatEntryRow, formatVolumeRow } from './presenters.js';
import { buildShellShortcutLines } from './shell-hotkeys.js';
import {
  VISIBLE_VOLUME_ROWS,
  formatWindowSummary,
  getVisibleWindow,
} from './navigation.js';

export type ShellScreenMode = 'dashboard' | 'explorer';

export interface HeaderPanelOptions {
  currentSnapshot: ExplorerSnapshot | null;
  dataDir: string;
  headerWidth: number;
  mode: ShellScreenMode;
}

export interface PrimaryPanelOptions {
  currentSnapshot: ExplorerSnapshot | null;
  leftPaneWidth: number;
  mode: ShellScreenMode;
  selectedEntryIndex: number;
  selectedVolumeIndex: number;
  volumes: VolumeManifest[];
}

export interface PrimaryPanelView {
  items: string[];
  label: string;
  selectedIndex: number;
}

export interface InspectorPanelOptions {
  currentSnapshot: ExplorerSnapshot | null;
  dataDir: string;
  logDir: string;
  mode: ShellScreenMode;
  selectedEntry: DirectoryListingItem | null;
  selectedVolumeIndex: number;
  volumes: VolumeManifest[];
}

export interface ShortcutsPanelOptions {
  mode: ShellScreenMode;
  width: number;
}

export const buildHeaderPanelContent = (options: HeaderPanelOptions): string => {
  if (options.mode === 'dashboard') {
    return [
      fitSingleLine('Virtual Volumes  Stable keyboard-first shell', options.headerWidth),
      fitSingleLine(`Data root ${options.dataDir}`, options.headerWidth),
    ].join('\n');
  }

  if (!options.currentSnapshot) {
    return [
      fitSingleLine('Virtual Volumes', options.headerWidth),
      fitSingleLine('No volume opened.', options.headerWidth),
    ].join('\n');
  }

  const pageSummary = formatWindowSummary(
    options.currentSnapshot.windowOffset,
    options.currentSnapshot.windowOffset + options.currentSnapshot.entries.length,
    options.currentSnapshot.totalEntries,
  );

  return [
    fitSingleLine(
      `${options.currentSnapshot.volume.name}  ${options.currentSnapshot.currentPath}`,
      options.headerWidth,
    ),
    fitSingleLine(
      `Entries ${pageSummary}  Remaining ${formatBytes(options.currentSnapshot.remainingBytes)}`,
      options.headerWidth,
    ),
  ].join('\n');
};

export const buildPrimaryPanelView = (options: PrimaryPanelOptions): PrimaryPanelView => {
  if (options.mode === 'dashboard') {
    const visibleVolumes = getVisibleWindow(
      options.volumes,
      options.selectedVolumeIndex,
      VISIBLE_VOLUME_ROWS,
    );

    if (visibleVolumes.items.length === 0) {
      return {
        label: ' Volumes ',
        items: [
          fitSingleLine(
            'No virtual volumes yet. Press N to create one.',
            options.leftPaneWidth,
          ),
        ],
        selectedIndex: 0,
      };
    }

    return {
      label: ` Volumes  ${formatWindowSummary(
        visibleVolumes.start,
        visibleVolumes.end,
        options.volumes.length,
      )} `,
      items: visibleVolumes.items.map((volume) =>
        formatVolumeRow(volume, options.leftPaneWidth),
      ),
      selectedIndex: options.selectedVolumeIndex - visibleVolumes.start,
    };
  }

  if (!options.currentSnapshot || options.currentSnapshot.entries.length === 0) {
    const currentPath = options.currentSnapshot?.currentPath ?? '/';

    return {
      label: ` Entries  ${fitSingleLine(
        currentPath,
        Math.max(12, options.leftPaneWidth - 10),
      )} `,
      items: [fitSingleLine('This directory is empty.', options.leftPaneWidth)],
      selectedIndex: 0,
    };
  }

  return {
    label: ` Entries  ${formatWindowSummary(
      options.currentSnapshot.windowOffset,
      options.currentSnapshot.windowOffset + options.currentSnapshot.entries.length,
      options.currentSnapshot.totalEntries,
    )} `,
    items: options.currentSnapshot.entries.map((entry) =>
      formatEntryRow(entry, options.leftPaneWidth),
    ),
    selectedIndex: options.selectedEntryIndex - options.currentSnapshot.windowOffset,
  };
};

export const buildInspectorPanelContent = (
  options: InspectorPanelOptions,
): string => {
  if (options.mode === 'dashboard') {
    const selectedVolume = options.volumes[options.selectedVolumeIndex] ?? null;

    if (!selectedVolume) {
      return [
        'No volume selected.',
        '',
        `Data dir: ${options.dataDir}`,
        `Logs: ${options.logDir}`,
        '',
        'Use arrows to move and Enter to open a volume.',
      ].join('\n');
    }

    return [
      selectedVolume.name,
      `Id: ${selectedVolume.id}`,
      '',
      `Used: ${formatBytes(selectedVolume.logicalUsedBytes)}`,
      `Quota: ${formatBytes(selectedVolume.quotaBytes)}`,
      `Entries: ${selectedVolume.entryCount}`,
      `Updated: ${formatDateTime(selectedVolume.updatedAt)}`,
      '',
      truncate(selectedVolume.description || 'No description.', 220),
      '',
      `Data dir: ${options.dataDir}`,
      `Logs: ${options.logDir}`,
    ].join('\n');
  }

  if (!options.currentSnapshot) {
    return 'No volume opened.';
  }

  return [
    options.currentSnapshot.volume.name,
    `Path: ${options.currentSnapshot.currentPath}`,
    '',
    `Used: ${formatBytes(options.currentSnapshot.usageBytes)}`,
    `Quota: ${formatBytes(options.currentSnapshot.volume.quotaBytes)}`,
    `Remaining: ${formatBytes(options.currentSnapshot.remainingBytes)}`,
    `Entries in dir: ${options.currentSnapshot.totalEntries}`,
    '',
    options.selectedEntry ? `Selected: ${options.selectedEntry.name}` : 'Selected: none',
    options.selectedEntry ? `Type: ${options.selectedEntry.kind}` : '',
    options.selectedEntry?.kind === 'file'
      ? `Size: ${formatBytes(options.selectedEntry.size)}`
      : '',
    options.selectedEntry ? `Updated: ${formatDateTime(options.selectedEntry.updatedAt)}` : '',
    options.selectedEntry ? `Path: ${truncate(options.selectedEntry.path, 220)}` : '',
  ]
    .filter((line) => line.length > 0)
    .join('\n');
};

export const buildShortcutsPanelContent = (
  options: ShortcutsPanelOptions,
): string => {
  return buildShellShortcutLines(options.mode)
    .map((shortcut) => fitSingleLine(shortcut, options.width))
    .join('\n');
};
