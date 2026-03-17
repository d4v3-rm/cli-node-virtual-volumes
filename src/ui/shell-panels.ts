import type {
  DirectoryListingItem,
  ExplorerSnapshot,
  VolumeManifest,
} from '../domain/types.js';
import { formatBytes, formatDateTime } from '../utils/formatters.js';
import {
  buildAsciiMeter,
  fitAlignedLine,
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

interface InspectorField {
  label: string;
  value: string;
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
  labelWidth = label.length,
): string[] => {
  const safeWidth = Math.max(18, width);
  const safeLabelWidth = Math.max(label.length, labelWidth);
  const prefix = `${label.padEnd(safeLabelWidth, ' ')} : `;
  const wrapped = wrapTextLines(value, Math.max(8, safeWidth - prefix.length));

  return wrapped.map((line, index) =>
    fitAlignedLine(
      `${index === 0 ? prefix : ' '.repeat(prefix.length)}${line}`,
      safeWidth,
    ),
  );
};

const buildInspectorFieldTable = (
  fields: InspectorField[],
  width: number,
): string[] => {
  if (fields.length === 0) {
    return [];
  }

  const labelWidth = fields.reduce(
    (maxWidth, field) => Math.max(maxWidth, field.label.length),
    0,
  );

  return fields.flatMap((field) =>
    buildInspectorFieldLines(field.label, field.value, width, labelWidth),
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

  lines.push(fitAlignedLine(`[ ${title} ]`, width));
  lines.push(...sectionLines.map((line) => fitAlignedLine(line, width)));
};

const buildCapacitySectionLines = (
  usedBytes: number,
  quotaBytes: number,
  remainingBytes: number,
  width: number,
): string[] => {
  const meterWidth = Math.max(8, Math.min(18, width - 16));

  return buildInspectorFieldTable(
    [
      {
        label: 'Used',
        value: `${formatBytes(usedBytes)} / ${formatBytes(quotaBytes)}`,
      },
      {
        label: 'Free',
        value: formatBytes(remainingBytes),
      },
      {
        label: 'Usage',
        value: `${buildAsciiMeter(usedBytes, quotaBytes, meterWidth)} ${formatPercentage(
          usedBytes,
          quotaBytes,
        )}`,
      },
      {
        label: 'Headroom',
        value: getQuotaHealthLabel(remainingBytes, quotaBytes),
      },
    ],
    width,
  );
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

  return buildInspectorFieldTable(
    [
      { label: 'Data root', value: options.dataDir },
      { label: 'Logs', value: options.logDir },
      { label: 'Audit', value: options.auditLogDir },
      { label: 'Host policy', value: hostPolicy },
    ],
    options.inspectorWidth,
  );
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
      buildInspectorFieldTable(
        [
          { label: 'Name', value: selectedVolume.name },
          { label: 'Id', value: selectedVolume.id },
          { label: 'Revision', value: String(selectedVolume.revision) },
          { label: 'Entries', value: String(selectedVolume.entryCount) },
        ],
        options.inspectorWidth,
      ),
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
      buildInspectorFieldTable(
        [
          { label: 'Created', value: formatDateTime(selectedVolume.createdAt) },
          { label: 'Updated', value: formatDateTime(selectedVolume.updatedAt) },
        ],
        options.inspectorWidth,
      ),
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
    buildInspectorFieldTable(
      [
        { label: 'Name', value: options.currentSnapshot.volume.name },
        { label: 'Path', value: options.currentSnapshot.currentPath },
        {
          label: 'Revision',
          value: String(options.currentSnapshot.volume.revision),
        },
        {
          label: 'Window',
          value: formatWindowSummary(
            options.currentSnapshot.windowOffset,
            options.currentSnapshot.windowOffset + options.currentSnapshot.entries.length,
            options.currentSnapshot.totalEntries,
          ),
        },
        {
          label: 'Depth',
          value: String(getPathDepth(options.currentSnapshot.currentPath)),
        },
      ],
      options.inspectorWidth,
    ),
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
      buildInspectorFieldTable(
        [
          { label: 'Name', value: options.selectedEntry.name },
          { label: 'Type', value: options.selectedEntry.kind },
          {
            label: 'Size',
            value:
              options.selectedEntry.kind === 'file'
                ? formatBytes(options.selectedEntry.size)
                : 'directory',
          },
          {
            label: 'Updated',
            value: formatDateTime(options.selectedEntry.updatedAt),
          },
          { label: 'Path', value: options.selectedEntry.path },
        ],
        options.inspectorWidth,
      ),
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
