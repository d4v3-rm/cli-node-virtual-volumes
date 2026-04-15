import { describe, expect, it } from 'vitest';

import type {
  DirectoryListingItem,
  ExplorerSnapshot,
  VolumeManifest,
} from '../src/domain/types.js';
import { buildStatusPanel } from '../src/ui/status-panel.js';

const sampleVolume: VolumeManifest = {
  id: 'volume-1',
  name: 'Finance',
  description: 'Quarter close',
  quotaBytes: 8192,
  logicalUsedBytes: 4096,
  entryCount: 2,
  revision: 5,
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

describe('ui status panel presenter', () => {
  it('renders busy progress state with progress metrics', () => {
    const rendered = buildStatusPanel({
      availableWidth: 120,
      mode: 'explorer',
      volumes: [sampleVolume],
      selectedVolumeIndex: 0,
      currentSnapshot: sampleSnapshot,
      selectedEntry: sampleEntry,
      logDir: '/logs',
      busyLabel: 'Importing files',
      busyDetail: null,
      busyProgressCurrent: 2048,
      busyProgressTotal: 4096,
      elapsedMs: 125000,
      spinnerIndex: 1,
      spinnerFrames: ['|', '/', '-', '\\'],
      toast: null,
    });

    expect(rendered.state).toBe('busy');
    expect(rendered.label).toBe(' Status  Running ');
    expect(rendered.lines[0]).toContain('/ Importing files');
    expect(rendered.lines[0]).toContain('2:05');
    expect(rendered.lines[1]).toContain('50%');
    expect(rendered.lines[1]).toContain('2.0 KB / 4.0 KB');
    expect(rendered.lines[1]).toContain('Selected file report.txt');
  });

  it('renders toast state and falls back to contextual details with logs', () => {
    const rendered = buildStatusPanel({
      availableWidth: 180,
      mode: 'dashboard',
      volumes: [sampleVolume],
      selectedVolumeIndex: 0,
      currentSnapshot: null,
      selectedEntry: null,
      logDir: '/logs',
      busyLabel: null,
      busyDetail: null,
      busyProgressCurrent: null,
      busyProgressTotal: null,
      elapsedMs: 0,
      spinnerIndex: 0,
      spinnerFrames: ['|', '/', '-', '\\'],
      toast: {
        tone: 'success',
        message: 'Import complete',
      },
    });

    expect(rendered.state).toBe('success');
    expect(rendered.label).toBe(' Status  SUCCESS ');
    expect(rendered.lines[0]).toContain('[SUCCESS] Import complete');
    expect(rendered.lines[1]).toContain('Selected volume Finance');
    expect(rendered.lines[1]).toContain('Logs /logs');
  });

  it('renders idle explorer state for an empty directory', () => {
    const emptySnapshot: ExplorerSnapshot = {
      ...sampleSnapshot,
      entries: [],
      totalEntries: 0,
    };

    const rendered = buildStatusPanel({
      availableWidth: 180,
      mode: 'explorer',
      volumes: [sampleVolume],
      selectedVolumeIndex: 0,
      currentSnapshot: emptySnapshot,
      selectedEntry: null,
      logDir: '/logs',
      busyLabel: null,
      busyDetail: null,
      busyProgressCurrent: null,
      busyProgressTotal: null,
      elapsedMs: 0,
      spinnerIndex: 0,
      spinnerFrames: ['|', '/', '-', '\\'],
      toast: null,
    });

    expect(rendered.state).toBe('idle');
    expect(rendered.label).toBe(' Status  Ready ');
    expect(rendered.lines[0]).toContain('Ready. Explorer active in /reports.');
    expect(rendered.lines[1]).toContain('Directory empty.');
    expect(rendered.lines[1]).toContain('Logs /logs');
  });

  it('renders idle dashboard onboarding context with no volumes', () => {
    const rendered = buildStatusPanel({
      availableWidth: 180,
      mode: 'dashboard',
      volumes: [],
      selectedVolumeIndex: 0,
      currentSnapshot: null,
      selectedEntry: null,
      logDir: '/logs',
      busyLabel: null,
      busyDetail: null,
      busyProgressCurrent: null,
      busyProgressTotal: null,
      elapsedMs: 0,
      spinnerIndex: 0,
      spinnerFrames: ['|', '/', '-', '\\'],
      toast: null,
    });

    expect(rendered.lines[0]).toContain('Ready. Dashboard active with 0 volumes available.');
    expect(rendered.lines[1]).toContain('Press N to create your first volume.');
  });
});
