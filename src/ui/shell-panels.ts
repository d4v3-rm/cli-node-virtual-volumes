import type {
  DirectoryListingItem,
  ExplorerSnapshot,
  VolumeManifest,
} from '../domain/types.js';
import { formatBytes, formatDateTime } from '../utils/formatters.js';
import {
  buildAsciiMeter,
  fitSingleLine,
  formatEntryRow,
  formatPercentage,
  formatVolumeRow,
  wrapTextLines,
} from './presenters.js';
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
  auditLogDir: string;
  currentSnapshot: ExplorerSnapshot | null;
  dataDir: string;
  hostAllowPathCount: number;
  hostDenyPathCount: number;
  inspectorWidth: number;
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

const getPathDepth = (virtualPath: string): number =>
  virtualPath === '/'
    ? 0
    : virtualPath
        .split('/')
        .filter((segment) => segment.length > 0).length;

const getQuotaHealthLabel = (remainingBytes: number, quotaBytes: number): string => {
  if (quotaBytes <= 0 || remainingBytes <= 0) {
    return 'FULL';
  }

  const ratio = remainingBytes / quotaBytes;
  if (ratio <= 0.1) {
    return 'TIGHT';
  }

  if (ratio <= 0.25) {
    return 'WATCH';
  }

  return 'HEALTHY';
};

const buildInspectorFieldLines = (
  label: string,
  value: string,
  width: number,
): string[] => {
  const safeWidth = Math.max(18, width);
  const prefix = `${label}: `;
  const wrapped = wrapTextLines(value, Math.max(8, safeWidth - prefix.length));

  return wrapped.map((line, index) =>
    fitSingleLine(
      `${index === 0 ? prefix : ' '.repeat(prefix.length)}${line}`,
      safeWidth,
    ),
  );
};

const appendInspectorSection = (
  lines: string[],
  title: string,
  sectionLines: string[],
  width: number,
): void => {
  if (sectionLines.length === 0) {
    return;
  }

  if (lines.length > 0) {
    lines.push('');
  }

  lines.push(fitSingleLine(`[ ${title} ]`, width));
  lines.push(...sectionLines.map((line) => fitSingleLine(line, width)));
};

const buildCapacitySectionLines = (
  usedBytes: number,
  quotaBytes: number,
  remainingBytes: number,
  width: number,
): string[] => {
  const meterWidth = Math.max(8, Math.min(18, width - 16));

  return [
    `Used: ${formatBytes(usedBytes)} / ${formatBytes(quotaBytes)}`,
    `Free: ${formatBytes(remainingBytes)}`,
    `Usage: ${buildAsciiMeter(usedBytes, quotaBytes, meterWidth)} ${formatPercentage(
      usedBytes,
      quotaBytes,
    )}`,
    `Headroom: ${getQuotaHealthLabel(remainingBytes, quotaBytes)}`,
  ];
};

const buildRuntimeSectionLines = (
  options: Pick<
    InspectorPanelOptions,
    'auditLogDir' | 'dataDir' | 'hostAllowPathCount' | 'hostDenyPathCount' | 'inspectorWidth' | 'logDir'
  >,
): string[] => {
  const hostPolicy =
    options.hostAllowPathCount === 0 && options.hostDenyPathCount === 0
      ? 'open'
      : `allow ${options.hostAllowPathCount} / deny ${options.hostDenyPathCount}`;

  return [
    ...buildInspectorFieldLines('Data root', options.dataDir, options.inspectorWidth),
    ...buildInspectorFieldLines('Logs', options.logDir, options.inspectorWidth),
    ...buildInspectorFieldLines('Audit', options.auditLogDir, options.inspectorWidth),
    `Host policy: ${hostPolicy}`,
  ];
};

export const buildInspectorPanelLabel = (
  options: Pick<
    InspectorPanelOptions,
    'mode' | 'selectedEntry' | 'selectedVolumeIndex' | 'volumes'
  >,
): string => {
  if (options.mode === 'dashboard') {
    return options.volumes[options.selectedVolumeIndex]
      ? ' Inspector  Volume '
      : ' Inspector  Overview ';
  }

  if (!options.selectedEntry) {
    return ' Inspector  Explorer ';
  }

  return options.selectedEntry.kind === 'file'
    ? ' Inspector  File '
    : ' Inspector  Directory ';
};

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
  const lines: string[] = [];

  if (options.mode === 'dashboard') {
    const selectedVolume = options.volumes[options.selectedVolumeIndex] ?? null;

    if (!selectedVolume) {
      appendInspectorSection(
        lines,
        'OVERVIEW',
        ['No volume selected.', 'Use arrows to move and Enter to open a volume.'],
        options.inspectorWidth,
      );
      appendInspectorSection(
        lines,
        'RUNTIME',
        buildRuntimeSectionLines(options),
        options.inspectorWidth,
      );

      return lines.join('\n');
    }

    appendInspectorSection(
      lines,
      'VOLUME',
      [
        ...buildInspectorFieldLines('Name', selectedVolume.name, options.inspectorWidth),
        ...buildInspectorFieldLines('Id', selectedVolume.id, options.inspectorWidth),
        `Revision: ${selectedVolume.revision}`,
        `Entries: ${selectedVolume.entryCount}`,
      ],
      options.inspectorWidth,
    );
    appendInspectorSection(
      lines,
      'CAPACITY',
      buildCapacitySectionLines(
        selectedVolume.logicalUsedBytes,
        selectedVolume.quotaBytes,
        Math.max(0, selectedVolume.quotaBytes - selectedVolume.logicalUsedBytes),
        options.inspectorWidth,
      ),
      options.inspectorWidth,
    );
    appendInspectorSection(
      lines,
      'TIMING',
      [
        `Created: ${formatDateTime(selectedVolume.createdAt)}`,
        `Updated: ${formatDateTime(selectedVolume.updatedAt)}`,
      ],
      options.inspectorWidth,
    );
    appendInspectorSection(
      lines,
      'DESCRIPTION',
      wrapTextLines(
        selectedVolume.description || 'No description.',
        options.inspectorWidth,
      ),
      options.inspectorWidth,
    );
    appendInspectorSection(
      lines,
      'RUNTIME',
      buildRuntimeSectionLines(options),
      options.inspectorWidth,
    );

    return lines.join('\n');
  }

  if (!options.currentSnapshot) {
    return 'No volume opened.';
  }

  appendInspectorSection(
    lines,
    'VOLUME',
    [
      ...buildInspectorFieldLines(
        'Name',
        options.currentSnapshot.volume.name,
        options.inspectorWidth,
      ),
      ...buildInspectorFieldLines(
        'Path',
        options.currentSnapshot.currentPath,
        options.inspectorWidth,
      ),
      `Revision: ${options.currentSnapshot.volume.revision}`,
      `Window: ${formatWindowSummary(
        options.currentSnapshot.windowOffset,
        options.currentSnapshot.windowOffset + options.currentSnapshot.entries.length,
        options.currentSnapshot.totalEntries,
      )}`,
      `Depth: ${getPathDepth(options.currentSnapshot.currentPath)}`,
    ],
    options.inspectorWidth,
  );
  appendInspectorSection(
    lines,
    'CAPACITY',
    buildCapacitySectionLines(
      options.currentSnapshot.usageBytes,
      options.currentSnapshot.volume.quotaBytes,
      options.currentSnapshot.remainingBytes,
      options.inspectorWidth,
    ),
    options.inspectorWidth,
  );

  if (!options.selectedEntry) {
    appendInspectorSection(
      lines,
      'SELECTION',
      ['No entry selected in the current directory window.'],
      options.inspectorWidth,
    );
  } else {
    appendInspectorSection(
      lines,
      'SELECTION',
      [
        ...buildInspectorFieldLines('Name', options.selectedEntry.name, options.inspectorWidth),
        `Type: ${options.selectedEntry.kind}`,
        ...(options.selectedEntry.kind === 'file'
          ? [`Size: ${formatBytes(options.selectedEntry.size)}`]
          : ['Size: directory']),
        `Updated: ${formatDateTime(options.selectedEntry.updatedAt)}`,
        ...buildInspectorFieldLines('Path', options.selectedEntry.path, options.inspectorWidth),
      ],
      options.inspectorWidth,
    );
  }

  appendInspectorSection(
    lines,
    'RUNTIME',
    buildRuntimeSectionLines(options),
    options.inspectorWidth,
  );

  return lines.join('\n');
};

export const buildShortcutsPanelContent = (
  options: ShortcutsPanelOptions,
): string => {
  return buildShellShortcutLines(options.mode)
    .map((shortcut) => fitSingleLine(shortcut, options.width))
    .join('\n');
};
