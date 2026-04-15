import { describe, expect, it } from 'vitest';

import type {
  DirectoryListingItem,
  ExplorerSnapshot,
  VolumeManifest,
} from '../src/domain/types.js';
import {
  buildHeaderPanelContent,
  buildInspectorPanelLabel,
  buildInspectorPanelContent,
  buildPrimaryPanelView,
  buildShortcutsPanelContent,
} from '../src/ui/shell-panels.js';

const sampleVolume: VolumeManifest = {
  id: 'volume-1',
  name: 'Finance',
  description: 'Quarter close workspace',
  quotaBytes: 8192,
  logicalUsedBytes: 4096,
  entryCount: 2,
  revision: 3,
  createdAt: '2026-04-01T08:00:00.000Z',
  updatedAt: '2026-04-01T09:00:00.000Z',
};

const sampleEntry: DirectoryListingItem = {
  id: 'entry-1',
  name: 'report.txt',
  path: '/reports/report.txt',
  kind: 'file',
  size: 2048,
  updatedAt: '2026-04-01T09:00:00.000Z',
};

const sampleSnapshot: ExplorerSnapshot = {
  volume: sampleVolume,
  currentPath: '/reports',
  breadcrumbs: ['/', '/reports'],
  entries: [sampleEntry],
  totalEntries: 1,
  windowOffset: 0,
  windowSize: 12,
  usageBytes: 4096,
  remainingBytes: 4096,
};

describe('ui shell panels', () => {
  it('builds header content for dashboard and explorer states', () => {
    expect(
      buildHeaderPanelContent({
        currentSnapshot: null,
        dataDir: '/data',
        headerWidth: 80,
        mode: 'dashboard',
      }),
    ).toContain('Data root /data');

    const explorerHeader = buildHeaderPanelContent({
      currentSnapshot: sampleSnapshot,
      dataDir: '/data',
      headerWidth: 80,
      mode: 'explorer',
    });

    expect(explorerHeader).toContain('Finance /reports');
    expect(explorerHeader).toContain('Entries 1-1 of 1 Remaining 4.0 KB');
  });

  it('builds primary panel views for volume lists and directory entries', () => {
    const dashboardView = buildPrimaryPanelView({
      currentSnapshot: null,
      leftPaneWidth: 80,
      mode: 'dashboard',
      selectedEntryIndex: 0,
      selectedVolumeIndex: 0,
      volumes: [sampleVolume],
    });

    expect(dashboardView.label).toContain('Volumes');
    expect(dashboardView.items[0]).toContain('Finance');
    expect(dashboardView.selectedIndex).toBe(0);

    const explorerView = buildPrimaryPanelView({
      currentSnapshot: sampleSnapshot,
      leftPaneWidth: 80,
      mode: 'explorer',
      selectedEntryIndex: 0,
      selectedVolumeIndex: 0,
      volumes: [sampleVolume],
    });

    expect(explorerView.label).toContain('1-1 of 1');
    expect(explorerView.items[0]).toContain('report.txt');
    expect(explorerView.selectedIndex).toBe(0);
  });

  it('builds inspector content for dashboard and explorer', () => {
    const dashboardInspector = buildInspectorPanelContent({
      auditLogDir: '/logs/audit',
      currentSnapshot: null,
      dataDir: '/data',
      hostAllowPathCount: 1,
      hostDenyPathCount: 1,
      inspectorWidth: 48,
      logDir: '/logs',
      mode: 'dashboard',
      selectedEntry: null,
      selectedVolumeIndex: 0,
      volumes: [sampleVolume],
    });

    expect(dashboardInspector).toContain('[ VOLUME ]');
    expect(dashboardInspector).toContain('Name     : Finance');
    expect(dashboardInspector).toContain('Usage    : [');
    expect(dashboardInspector).toContain('Host policy : allow 1 / deny 1');

    const explorerInspector = buildInspectorPanelContent({
      auditLogDir: '/logs/audit',
      currentSnapshot: sampleSnapshot,
      dataDir: '/data',
      hostAllowPathCount: 0,
      hostDenyPathCount: 0,
      inspectorWidth: 48,
      logDir: '/logs',
      mode: 'explorer',
      selectedEntry: sampleEntry,
      selectedVolumeIndex: 0,
      volumes: [sampleVolume],
    });

    expect(explorerInspector).toContain('[ VOLUME ]');
    expect(explorerInspector).toContain('Path     : /reports');
    expect(explorerInspector).toContain('[ SELECTION ]');
    expect(explorerInspector).toContain('Name    : report.txt');
    expect(explorerInspector).toContain('Size    : 2.0 KB');

    const inspectorLines = explorerInspector.split('\n');
    const selectionStart = inspectorLines.indexOf('[ SELECTION ]') + 1;
    const selectionEnd = inspectorLines.indexOf('', selectionStart);
    const selectionLines = inspectorLines
      .slice(selectionStart, selectionEnd === -1 ? undefined : selectionEnd)
      .filter((line) => line.length > 0 && !line.startsWith('[ '));
    const colonColumns = selectionLines
      .filter((line) => line.includes(':'))
      .map((line) => line.indexOf(':'));

    expect(new Set(colonColumns).size).toBe(1);
  });

  it('builds inspector labels that reflect the active context', () => {
    expect(
      buildInspectorPanelLabel({
        mode: 'dashboard',
        selectedEntry: null,
        selectedVolumeIndex: 0,
        volumes: [sampleVolume],
      }),
    ).toBe(' Inspector  Volume ');

    expect(
      buildInspectorPanelLabel({
        mode: 'explorer',
        selectedEntry: sampleEntry,
        selectedVolumeIndex: 0,
        volumes: [sampleVolume],
      }),
    ).toBe(' Inspector  File ');
  });

  it('builds shortcuts content for both shells', () => {
    expect(buildShortcutsPanelContent({ mode: 'dashboard', width: 80 })).toContain(
      '[N] New volume',
    );
    expect(buildShortcutsPanelContent({ mode: 'explorer', width: 80 })).toContain(
      '[I] Import [E] Export',
    );
  });
});
