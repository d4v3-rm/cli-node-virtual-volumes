import path from 'node:path';

import { truncate } from '../utils/formatters.js';
import type { HostBrowserEntry, HostBrowserSnapshot } from './host-browser.js';
import {
  clampIndex,
  formatWindowSummary,
  getVisibleWindow,
  type VisibleWindow,
} from './navigation.js';
import {
  fitSingleLine,
  formatHostBrowserRow,
  formatHostNavigationRow,
  TERMINAL_ICONS,
} from './presenters.js';

export type HostOverlayMode = 'import' | 'export';

export interface HostOverlayDimensions {
  overlayWidth: number;
  overlayHeight: number;
  summaryWidth: number;
}

export interface HostOverlayView {
  browserItems: string[];
  browserLabel: string;
  browserSelectionIndex: number;
  footerContent: string;
  headerContent: string;
  summaryContent: string;
}

export const HOST_BROWSER_VISIBLE_ROWS = 14;

export const getHostOverlayDimensions = (
  viewportWidth: number,
  viewportHeight: number,
  mode: HostOverlayMode,
): HostOverlayDimensions => {
  const overlayWidth =
    viewportWidth > 90
      ? Math.min(viewportWidth - 4, 148)
      : Math.max(40, viewportWidth - 2);
  const overlayHeight =
    mode === 'import'
      ? viewportHeight > 26
        ? Math.min(viewportHeight - 4, 34)
        : Math.max(12, viewportHeight - 1)
      : viewportHeight > 24
        ? Math.min(viewportHeight - 4, 30)
        : Math.max(12, viewportHeight - 1);
  const summaryWidth = Math.max(
    22,
    Math.min(
      Math.min(38, Math.max(22, overlayWidth - 34)),
      Math.floor((overlayWidth - 2) * 0.34),
    ),
  );

  return {
    overlayWidth,
    overlayHeight,
    summaryWidth,
  };
};

export const getHostVisibleEntries = (
  snapshot: HostBrowserSnapshot,
  selectedIndex: number,
): VisibleWindow<HostBrowserEntry> =>
  getVisibleWindow(snapshot.entries, selectedIndex, HOST_BROWSER_VISIBLE_ROWS);

export const getPreferredHostSelectionIndex = (
  snapshot: HostBrowserSnapshot,
  preferredAbsolutePath: string | null,
): number => {
  const preferredIndex =
    preferredAbsolutePath === null
      ? -1
      : snapshot.entries.findIndex((entry) => entry.absolutePath === preferredAbsolutePath);

  if (preferredIndex >= 0) {
    return preferredIndex;
  }

  return clampIndex(0, snapshot.entries.length);
};

export const moveHostSelection = (
  selectedIndex: number,
  totalEntries: number,
  direction: number,
): number => clampIndex(selectedIndex + direction, totalEntries);

export const jumpHostSelection = (
  target: 'start' | 'end',
  totalEntries: number,
): number => {
  if (totalEntries <= 0) {
    return 0;
  }

  return target === 'start' ? 0 : totalEntries - 1;
};

export const getHostRowsSignature = (options: {
  loading: boolean;
  selectedIndex: number;
  selectedPaths?: ReadonlySet<string>;
  snapshot: HostBrowserSnapshot;
}): string => {
  if (options.loading) {
    return 'loading';
  }

  if (options.snapshot.entries.length === 0) {
    return `empty:${options.snapshot.currentPath ?? 'root'}`;
  }

  const visibleWindow = getHostVisibleEntries(options.snapshot, options.selectedIndex);
  const signatureParts = [
    options.snapshot.currentPath ?? 'root',
    String(visibleWindow.start),
    String(visibleWindow.end),
  ];

  if (options.selectedPaths) {
    signatureParts.push(
      Array.from(options.selectedPaths)
        .sort((left, right) => left.localeCompare(right))
        .join('|'),
    );
  }

  return signatureParts.join('::');
};

export const toggleHostSelection = (
  selectedPaths: ReadonlySet<string>,
  entry: HostBrowserEntry | null,
): Set<string> => {
  const nextSelectedPaths = new Set(selectedPaths);

  if (!entry?.selectable || entry.absolutePath === null) {
    return nextSelectedPaths;
  }

  if (nextSelectedPaths.has(entry.absolutePath)) {
    nextSelectedPaths.delete(entry.absolutePath);
  } else {
    nextSelectedPaths.add(entry.absolutePath);
  }

  return nextSelectedPaths;
};

export const toggleVisibleHostSelections = (
  selectedPaths: ReadonlySet<string>,
  visibleEntries: HostBrowserEntry[],
): Set<string> => {
  const nextSelectedPaths = new Set(selectedPaths);
  const selectableEntries = visibleEntries.filter(
    (entry) => entry.selectable && entry.absolutePath !== null,
  );

  if (selectableEntries.length === 0) {
    return nextSelectedPaths;
  }

  const shouldSelectAll = selectableEntries.some(
    (entry) => !nextSelectedPaths.has(entry.absolutePath!),
  );

  for (const entry of selectableEntries) {
    if (shouldSelectAll) {
      nextSelectedPaths.add(entry.absolutePath!);
    } else {
      nextSelectedPaths.delete(entry.absolutePath!);
    }
  }

  return nextSelectedPaths;
};

export const getExportDestinationPath = (
  snapshot: HostBrowserSnapshot,
  currentEntry: HostBrowserEntry | null,
): string | null => {
  if (snapshot.currentPath !== null) {
    return snapshot.currentPath;
  }

  if (currentEntry?.kind === 'drive' && currentEntry.absolutePath !== null) {
    return currentEntry.absolutePath;
  }

  return null;
};

const getOverlayBrowserItems = (options: {
  emptyStateLabel: string;
  formatter: (entry: HostBrowserEntry) => string;
  loading: boolean;
  snapshot: HostBrowserSnapshot;
  visibleWindow: VisibleWindow<HostBrowserEntry>;
}): string[] => {
  if (options.loading) {
    return ['Loading host filesystem...'];
  }

  if (options.snapshot.entries.length === 0) {
    return [options.emptyStateLabel];
  }

  return options.visibleWindow.items.map(options.formatter);
};

export const buildHostImportOverlayView = (options: {
  browserContentWidth: number;
  destinationPath: string;
  headerWidth: number;
  loading: boolean;
  overlayContentWidth: number;
  selectedIndex: number;
  selectedPaths: ReadonlySet<string>;
  snapshot: HostBrowserSnapshot;
}): HostOverlayView => {
  const currentEntry = options.snapshot.entries[options.selectedIndex] ?? null;
  const visibleWindow = getHostVisibleEntries(options.snapshot, options.selectedIndex);
  const selectedItemsPreview = Array.from(options.selectedPaths)
    .slice(0, 8)
    .map((hostPath) => `${TERMINAL_ICONS.file} ${path.basename(hostPath) || hostPath}`)
    .join('\n');

  return {
    headerContent: [
      fitSingleLine(`Host ${options.snapshot.displayPath}`, options.headerWidth),
      fitSingleLine(`Import destination ${options.destinationPath}`, options.headerWidth),
    ].join('\n'),
    browserLabel: options.loading
      ? ' Host Filesystem  loading '
      : ` Host Filesystem  ${formatWindowSummary(
          visibleWindow.start,
          visibleWindow.end,
          options.snapshot.entries.length,
        )} `,
    browserItems: getOverlayBrowserItems({
      emptyStateLabel: 'No files or folders here.',
      formatter: (entry) =>
        formatHostBrowserRow(
          entry,
          entry.absolutePath !== null && options.selectedPaths.has(entry.absolutePath),
          options.browserContentWidth,
        ),
      loading: options.loading,
      snapshot: options.snapshot,
      visibleWindow,
    }),
    browserSelectionIndex:
      options.loading || options.snapshot.entries.length === 0
        ? 0
        : clampIndex(
            options.selectedIndex - visibleWindow.start,
            visibleWindow.items.length,
          ),
    summaryContent: [
      `Checked items: ${options.selectedPaths.size}`,
      '',
      currentEntry
        ? `Current: ${currentEntry.name} (${options.selectedIndex + 1}/${options.snapshot.entries.length})`
        : 'Current: none',
      currentEntry ? `Type: ${currentEntry.kind}` : '',
      currentEntry?.absolutePath ? `Path: ${truncate(currentEntry.absolutePath, 220)}` : '',
      currentEntry?.selectable
        ? `Checked: ${
            currentEntry.absolutePath !== null &&
            options.selectedPaths.has(currentEntry.absolutePath)
              ? 'yes'
              : 'no'
          }`
        : 'Checked: not available',
      '',
      selectedItemsPreview.length > 0 ? `Selected\n${selectedItemsPreview}` : 'Selected\nNone yet.',
    ]
      .filter((line) => line.length > 0)
      .join('\n'),
    footerContent: fitSingleLine(
      'Up/Down move   Right enter   Left back   Space check   Enter/I import   A toggle page   Esc cancel',
      options.overlayContentWidth,
    ),
  };
};

export const buildHostExportOverlayView = (options: {
  browserContentWidth: number;
  headerWidth: number;
  loading: boolean;
  overlayContentWidth: number;
  selectedIndex: number;
  snapshot: HostBrowserSnapshot;
  sourcePath: string;
}): HostOverlayView => {
  const currentEntry = options.snapshot.entries[options.selectedIndex] ?? null;
  const visibleWindow = getHostVisibleEntries(options.snapshot, options.selectedIndex);
  const destinationPath = getExportDestinationPath(options.snapshot, currentEntry);

  return {
    headerContent: [
      fitSingleLine(`Host ${options.snapshot.displayPath}`, options.headerWidth),
      fitSingleLine(`Export source ${options.sourcePath}`, options.headerWidth),
    ].join('\n'),
    browserLabel: options.loading
      ? ' Host Destination  loading '
      : ` Host Destination  ${formatWindowSummary(
          visibleWindow.start,
          visibleWindow.end,
          options.snapshot.entries.length,
        )} `,
    browserItems: getOverlayBrowserItems({
      emptyStateLabel: 'No folders or files here.',
      formatter: (entry) => formatHostNavigationRow(entry, options.browserContentWidth),
      loading: options.loading,
      snapshot: options.snapshot,
      visibleWindow,
    }),
    browserSelectionIndex:
      options.loading || options.snapshot.entries.length === 0
        ? 0
        : clampIndex(
            options.selectedIndex - visibleWindow.start,
            visibleWindow.items.length,
          ),
    summaryContent: [
      destinationPath
        ? `Destination: ${truncate(destinationPath, 220)}`
        : 'Destination: select a drive or folder',
      '',
      `Source: ${truncate(options.sourcePath, 220)}`,
      currentEntry ? `Highlighted: ${currentEntry.name}` : 'Highlighted: none',
      currentEntry ? `Type: ${currentEntry.kind}` : '',
      currentEntry?.absolutePath ? `Path: ${truncate(currentEntry.absolutePath, 220)}` : '',
      '',
      'Enter exports into the current folder.',
      'Right navigates inside the highlighted directory or drive.',
    ]
      .filter((line) => line.length > 0)
      .join('\n'),
    footerContent: fitSingleLine(
      'Up/Down move   Right enter   Left back   Enter/E export here   Esc cancel',
      options.overlayContentWidth,
    ),
  };
};
