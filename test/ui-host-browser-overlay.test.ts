import { describe, expect, it } from 'vitest';

import type { HostBrowserSnapshot } from '../src/ui/host-browser.js';
import {
  buildHostExportOverlayView,
  buildHostImportOverlayView,
  getExportDestinationPath,
  getHostBrowserModeConfig,
  getHostOverlayDimensions,
  getHostRowsSignature,
  getHostVisibleEntries,
  getPreferredHostSelectionIndex,
  HOST_BROWSER_VISIBLE_ROWS,
  jumpHostSelection,
  moveHostSelection,
  toggleHostSelection,
  toggleVisibleHostSelections,
} from '../src/ui/host-browser-overlay.js';

const sampleSnapshot: HostBrowserSnapshot = {
  currentPath: '/sandbox',
  displayPath: '/sandbox',
  entries: [
    {
      absolutePath: '/sandbox/..',
      id: 'parent:/sandbox',
      kind: 'parent',
      name: '..',
      navigable: true,
      selectable: false,
    },
    {
      absolutePath: '/sandbox/contracts',
      id: '/sandbox/contracts',
      kind: 'directory',
      name: 'contracts',
      navigable: true,
      selectable: true,
    },
    {
      absolutePath: '/sandbox/report.txt',
      id: '/sandbox/report.txt',
      kind: 'file',
      name: 'report.txt',
      navigable: false,
      selectable: true,
    },
  ],
};

describe('ui host browser overlay helpers', () => {
  it('computes host overlay dimensions for import and export modes', () => {
    expect(getHostOverlayDimensions(120, 40, 'import')).toEqual({
      overlayWidth: 116,
      overlayHeight: 34,
      summaryWidth: 38,
    });

    expect(getHostOverlayDimensions(80, 20, 'export')).toEqual({
      overlayWidth: 78,
      overlayHeight: 19,
      summaryWidth: 25,
    });

    expect(getHostBrowserModeConfig('import')).toEqual({
      browserPaneLabel: ' Host Filesystem ',
      confirmKeys: ['enter', 'i'],
      containerLabel: ' Host Import ',
      emptySelectionMessage: 'Select one or more host files or folders with Space.',
      summaryPaneLabel: ' Selection ',
      variant: 'import',
    });

    expect(getHostBrowserModeConfig('export')).toEqual({
      browserPaneLabel: ' Host Destination ',
      confirmKeys: ['enter', 'e'],
      containerLabel: ' Host Export ',
      emptySelectionMessage: 'Enter a drive or folder before exporting.',
      summaryPaneLabel: ' Export Summary ',
      variant: 'export',
    });
  });

  it('derives visible entries and selection indexes deterministically', () => {
    expect(HOST_BROWSER_VISIBLE_ROWS).toBe(14);
    expect(getHostVisibleEntries(sampleSnapshot, 2).items).toHaveLength(3);
    expect(getPreferredHostSelectionIndex(sampleSnapshot, '/sandbox/report.txt')).toBe(2);
    expect(getPreferredHostSelectionIndex(sampleSnapshot, '/missing')).toBe(0);
    expect(moveHostSelection(1, sampleSnapshot.entries.length, 10)).toBe(2);
    expect(moveHostSelection(1, sampleSnapshot.entries.length, -10)).toBe(0);
    expect(jumpHostSelection('start', sampleSnapshot.entries.length)).toBe(0);
    expect(jumpHostSelection('end', sampleSnapshot.entries.length)).toBe(2);
  });

  it('builds stable row signatures and selection toggles', () => {
    const noSelectionSignature = getHostRowsSignature({
      loading: false,
      selectedIndex: 1,
      snapshot: sampleSnapshot,
    });
    const withSelectionSignature = getHostRowsSignature({
      loading: false,
      selectedIndex: 1,
      selectedPaths: new Set(['/sandbox/report.txt']),
      snapshot: sampleSnapshot,
    });

    expect(noSelectionSignature).not.toBe(withSelectionSignature);
    expect(getHostRowsSignature({
      loading: true,
      selectedIndex: 0,
      snapshot: sampleSnapshot,
    })).toBe('loading');

    const selectedOnce = toggleHostSelection(new Set<string>(), sampleSnapshot.entries[2] ?? null);
    expect(Array.from(selectedOnce)).toEqual(['/sandbox/report.txt']);

    const toggledVisible = toggleVisibleHostSelections(
      selectedOnce,
      sampleSnapshot.entries,
    );
    expect(Array.from(toggledVisible).sort()).toEqual([
      '/sandbox/contracts',
      '/sandbox/report.txt',
    ]);

    const untoggledVisible = toggleVisibleHostSelections(
      toggledVisible,
      sampleSnapshot.entries,
    );
    expect(Array.from(untoggledVisible)).toEqual([]);
  });

  it('builds import overlay view content with selection summary', () => {
    const view = buildHostImportOverlayView({
      browserContentWidth: 80,
      destinationPath: '/virtual/contracts',
      headerWidth: 80,
      loading: false,
      overlayContentWidth: 80,
      selectedIndex: 2,
      selectedPaths: new Set(['/sandbox/report.txt']),
      snapshot: sampleSnapshot,
    });

    expect(view.headerContent).toContain('Host /sandbox');
    expect(view.headerContent).toContain('Import destination /virtual/contracts');
    expect(view.browserLabel).toContain('1-3 of 3');
    expect(view.browserItems[2]).toContain('report.txt');
    expect(view.summaryContent).toContain('Checked items: 1');
    expect(view.summaryContent).toContain('Current: report.txt (3/3)');
    expect(view.summaryContent).toContain('Checked: yes');
    expect(view.summaryContent).toContain('Selected');
    expect(view.footerContent).toContain('Enter/I import');
  });

  it('builds export overlay view content and resolves destination paths', () => {
    const driveSnapshot: HostBrowserSnapshot = {
      currentPath: null,
      displayPath: 'This Computer',
      entries: [
        {
          absolutePath: 'D:\\',
          id: 'drive:D',
          kind: 'drive',
          name: 'D:\\',
          navigable: true,
          selectable: false,
        },
      ],
    };

    expect(getExportDestinationPath(driveSnapshot, driveSnapshot.entries[0] ?? null)).toBe('D:\\');

    const view = buildHostExportOverlayView({
      browserContentWidth: 80,
      headerWidth: 80,
      loading: false,
      overlayContentWidth: 80,
      selectedIndex: 0,
      snapshot: driveSnapshot,
      sourcePath: '/virtual/report.txt',
    });

    expect(view.headerContent).toContain('Host This Computer');
    expect(view.headerContent).toContain('Export source /virtual/report.txt');
    expect(view.browserLabel).toContain('1-1 of 1');
    expect(view.summaryContent).toContain('Destination: D:\\');
    expect(view.summaryContent).toContain('Highlighted: D:\\');
    expect(view.footerContent).toContain('Enter/E export here');
  });
});
