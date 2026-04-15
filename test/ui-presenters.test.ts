import { describe, expect, it } from 'vitest';

import type {
  DirectoryListingItem,
  ExportProgress,
  ImportProgress,
  VolumeManifest,
} from '../src/domain/types.js';
import type { HostBrowserEntry } from '../src/ui/host-browser.js';
import {
  buildAsciiMeter,
  fitAlignedLine,
  fitSingleLine,
  formatExportProgressLabel,
  formatPercentage,
  formatEntryRow,
  formatExportProgress,
  formatHostBrowserRow,
  formatHostNavigationRow,
  formatImportProgressLabel,
  formatImportProgress,
  formatVolumeRow,
  getHostEntryIcon,
  getVirtualEntryIcon,
  TERMINAL_ICONS,
  wrapTextLines,
} from '../src/ui/presenters.js';

describe('ui presenters', () => {
  it('uses ascii-safe terminal icons for portable rendering', () => {
    expect(TERMINAL_ICONS).toEqual({
      checkboxOff: '[ ]',
      checkboxOn: '[x]',
      drive: '=',
      file: '-',
      folder: '>',
      parent: '<',
      volume: '*',
    });
  });

  it('normalizes and truncates single-line text', () => {
    expect(fitSingleLine('  hello   world  ', 40)).toBe('hello world');
    expect(fitSingleLine('alpha beta gamma delta', 10)).toBe('alpha b...');
    expect(fitAlignedLine('Type    : report.txt   ', 40)).toBe('Type    : report.txt');
    expect(fitAlignedLine('Updated : 15/04/26, 23:08', 16)).toBe('Updated : 15/...');
  });

  it('wraps text and renders ascii usage meters', () => {
    expect(wrapTextLines('alpha beta gamma delta', 10)).toEqual([
      'alpha beta',
      'gamma',
      'delta',
    ]);
    expect(wrapTextLines('C:/very/long/path/value', 8)).toEqual([
      'C:/very/',
      'long/pat',
      'h/value',
    ]);
    expect(buildAsciiMeter(50, 100, 10)).toBe('[#####.....]');
    expect(formatPercentage(1536, 2048)).toBe('75%');
  });

  it('formats volume and entry rows with the terminal icon set', () => {
    const volume: VolumeManifest = {
      id: 'volume-1',
      name: 'Finance workspace',
      description: '',
      quotaBytes: 4096,
      logicalUsedBytes: 2048,
      entryCount: 12,
      revision: 4,
      createdAt: '2026-04-01T08:00:00.000Z',
      updatedAt: '2026-04-01T08:30:00.000Z',
    };
    const entry: DirectoryListingItem = {
      id: 'entry-1',
      name: 'quarterly-report.txt',
      path: '/quarterly-report.txt',
      kind: 'file',
      size: 2048,
      updatedAt: '2026-04-01T08:30:00.000Z',
    };

    const volumeRow = formatVolumeRow(volume, 64);
    const entryRow = formatEntryRow(entry, 64);

    expect(volumeRow.startsWith(`${TERMINAL_ICONS.volume} `)).toBe(true);
    expect(volumeRow).toContain('2.0 KB / 4.0 KB');
    expect(volumeRow).toContain('No description.');

    expect(entryRow.startsWith(`${TERMINAL_ICONS.file} `)).toBe(true);
    expect(entryRow).toContain('2.0 KB');
  });

  it('formats host browser rows and icons consistently', () => {
    const directoryEntry: HostBrowserEntry = {
      absolutePath: '/sandbox/nested',
      id: '/sandbox/nested',
      kind: 'directory',
      name: 'nested',
      navigable: true,
      selectable: true,
    };
    const parentEntry: HostBrowserEntry = {
      absolutePath: '/sandbox',
      id: 'parent:/sandbox/nested',
      kind: 'parent',
      name: '..',
      navigable: true,
      selectable: false,
    };

    expect(getVirtualEntryIcon('directory')).toBe(TERMINAL_ICONS.folder);
    expect(getVirtualEntryIcon('file')).toBe(TERMINAL_ICONS.file);
    expect(getHostEntryIcon(directoryEntry)).toBe(TERMINAL_ICONS.folder);
    expect(getHostEntryIcon(parentEntry)).toBe(TERMINAL_ICONS.parent);

    const selectedRow = formatHostBrowserRow(directoryEntry, true, 80);
    const unselectedRow = formatHostBrowserRow(directoryEntry, false, 80);

    expect(selectedRow).toContain(`${TERMINAL_ICONS.folder} nested`);
    expect(unselectedRow).toContain(`${TERMINAL_ICONS.folder} nested`);
    expect(selectedRow).not.toBe(unselectedRow);
    expect(formatHostNavigationRow(parentEntry, 80)).toBe(`${TERMINAL_ICONS.parent} ..`);
  });

  it('formats import and export progress summaries for the status line', () => {
    const importProgress: ImportProgress = {
      currentHostPath: '/sandbox/report.txt',
      phase: 'file',
      summary: {
        filesImported: 2,
        directoriesImported: 1,
        bytesImported: 4096,
        conflictsResolved: 0,
        integrityChecksPassed: 3,
      },
      currentBytes: 1024,
      currentTotalBytes: 4096,
      metrics: {
        totalFiles: 5,
        totalDirectories: 2,
        totalBytes: 12288,
        transferredBytes: 5120,
      },
    };
    const exportProgress: ExportProgress = {
      currentVirtualPath: '/documents/archive.zip',
      destinationHostPath: '/exports',
      phase: 'integrity',
      summary: {
        filesExported: 4,
        directoriesExported: 2,
        bytesExported: 8192,
        conflictsResolved: 1,
        integrityChecksPassed: 6,
      },
      currentBytes: 8192,
      currentTotalBytes: 8192,
      metrics: {
        totalFiles: 6,
        totalDirectories: 3,
        totalBytes: 16384,
        transferredBytes: 12288,
      },
    };

    expect(formatImportProgressLabel(importProgress)).toBe('Import file report.txt');
    expect(formatExportProgressLabel(exportProgress)).toBe('Verify archive.zip');
    expect(formatImportProgress(importProgress)).toBe(
      'Files 2/5  Dirs 1/2  Verify 3/5  Item 1.0 KB / 4.0 KB',
    );
    expect(formatExportProgress(exportProgress)).toBe(
      'Files 4/6  Dirs 2/3  Verify 6/6  Check 8.0 KB / 8.0 KB',
    );
  });

  it('extracts import progress file names from Windows-style host paths on any runner OS', () => {
    const progress: ImportProgress = {
      currentHostPath: 'C:\\imports\\report.txt',
      phase: 'file',
      summary: {
        filesImported: 0,
        directoriesImported: 0,
        bytesImported: 0,
        conflictsResolved: 0,
        integrityChecksPassed: 0,
      },
      currentBytes: 0,
      currentTotalBytes: 0,
      metrics: {
        totalFiles: 1,
        totalDirectories: 0,
        totalBytes: 4096,
        transferredBytes: 0,
      },
    };

    expect(formatImportProgressLabel(progress)).toBe('Import file report.txt');
  });
});
