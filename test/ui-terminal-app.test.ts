import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AppRuntime } from '../src/bootstrap/create-runtime.js';
import type { ExplorerSnapshot, VolumeManifest } from '../src/domain/types.js';
import {
  TerminalApp,
  type TerminalUiFactory,
} from '../src/ui/terminal-app.js';

class FakeElement {
  public readonly children: FakeElement[] = [];

  public readonly style: Record<string, unknown>;

  public content = '';

  public label = '';

  public hidden = false;

  public width: number | string | undefined;

  public height: number | string | undefined;

  public left: number | string | undefined;

  public right: number | string | undefined;

  public top: number | string | undefined;

  public bottom: number | string | undefined;

  public focused = false;

  public items: string[] = [];

  public scrollOffset = 0;

  public selectedIndex = 0;

  public parent: FakeElement | null = null;

  private readonly eventHandlers = new Map<string, (() => void)[]>();

  private readonly keyHandlers: { keys: string[]; handler: () => void }[] = [];

  public constructor(options: Record<string, unknown> = {}) {
    this.style =
      typeof options.style === 'object' && options.style !== null
        ? structuredClone(options.style as Record<string, unknown>)
        : {};
    this.content = typeof options.content === 'string' ? options.content : '';
    this.label = typeof options.label === 'string' ? options.label : '';
    this.hidden = options.hidden === true;
    this.width = options.width as number | string | undefined;
    this.height = options.height as number | string | undefined;
    this.left = options.left as number | string | undefined;
    this.right = options.right as number | string | undefined;
    this.top = options.top as number | string | undefined;
    this.bottom = options.bottom as number | string | undefined;

    if (options.parent instanceof FakeElement) {
      this.parent = options.parent;
      this.parent.children.push(this);
    }
  }

  public setContent(value: string): void {
    this.content = value;
  }

  public setLabel(value: string): void {
    this.label = value;
  }

  public setItems(items: string[]): void {
    this.items = [...items];
  }

  public select(index: number): void {
    this.selectedIndex = index;
  }

  public setScroll(offset: number): void {
    this.scrollOffset = offset;
  }

  public focus(): void {
    this.focused = true;
  }

  public show(): void {
    this.hidden = false;
  }

  public hide(): void {
    this.hidden = true;
  }

  public detach(): void {
    if (!this.parent) {
      return;
    }

    const index = this.parent.children.indexOf(this);
    if (index >= 0) {
      this.parent.children.splice(index, 1);
    }
    this.parent = null;
  }

  public key(keys: string[] | string, handler: () => void): void {
    this.keyHandlers.push({
      keys: Array.isArray(keys) ? [...keys] : [keys],
      handler,
    });
  }

  public on(event: string, handler: () => void): void {
    const handlers = this.eventHandlers.get(event) ?? [];
    handlers.push(handler);
    this.eventHandlers.set(event, handlers);
  }

  public triggerEvent(event: string): void {
    for (const handler of this.eventHandlers.get(event) ?? []) {
      handler();
    }
  }

  public triggerKey(key: string): void {
    for (const binding of this.keyHandlers) {
      if (binding.keys.includes(key)) {
        binding.handler();
      }
    }
  }
}

class FakeScreen extends FakeElement {
  public renderCount = 0;

  public destroyCount = 0;

  public render(): void {
    this.renderCount += 1;
  }

  public destroy(): void {
    this.destroyCount += 1;
  }
}

const createFakeUiFactory = (): {
  factory: TerminalUiFactory;
  screen: FakeScreen;
} => {
  const screen = new FakeScreen();

  return {
    factory: {
      screen: () => screen as never,
      box: (options) => new FakeElement(options as Record<string, unknown>) as never,
      list: (options) => new FakeElement(options as Record<string, unknown>) as never,
      textbox: (options) => new FakeElement(options as Record<string, unknown>) as never,
    },
    screen,
  };
};

interface RuntimeTestContext {
  closeMock: ReturnType<typeof vi.fn>;
  getExplorerSnapshotMock: ReturnType<typeof vi.fn>;
  listVolumesMock: ReturnType<typeof vi.fn>;
  runtime: AppRuntime;
}

interface TerminalAppTestHandle {
  inspectorBox: FakeElement;
  leftPane: FakeElement;
  loadVolumes: () => Promise<void>;
  mode: 'dashboard' | 'explorer';
  openVolume: (volumeId: string) => Promise<void>;
  primaryList: FakeElement;
  rightPane: FakeElement;
  shortcutsBox: FakeElement;
  shutdown: () => void;
  statusBox: FakeElement;
}

const asTestApp = (app: TerminalApp): TerminalAppTestHandle =>
  app as unknown as TerminalAppTestHandle;

const createRuntime = (options: {
  explorerSnapshot?: ExplorerSnapshot;
  volumes?: VolumeManifest[];
} = {}): RuntimeTestContext => {
  const volumes = options.volumes ?? [];
  const closeMock = vi.fn(() => Promise.resolve());
  const listVolumesMock = vi.fn(() => Promise.resolve(volumes));
  const getExplorerSnapshotMock = vi.fn(() => {
    if (!options.explorerSnapshot) {
      return Promise.reject(new Error('Explorer snapshot not configured for test.'));
    }

    return Promise.resolve(options.explorerSnapshot);
  });

  return {
    closeMock,
    getExplorerSnapshotMock,
    listVolumesMock,
    runtime: {
      auditLogger: { info: vi.fn() } as never,
      close: closeMock,
      config: {
        auditLogDir: '/logs/audit',
        auditLogLevel: 'silent',
        dataDir: '/data',
        defaultQuotaBytes: 1024,
        hostAllowPaths: [],
        hostDenyPaths: [],
        logDir: '/logs',
        logLevel: 'silent',
        logRetentionDays: null,
        logToStdout: false,
        previewBytes: 2048,
        redactSensitiveDetails: false,
        supportBundleLogTailLines: 50,
      } as never,
      correlationId: 'corr_terminal-app-test',
      logger: {
        error: vi.fn(),
      } as never,
      volumeService: {
        getExplorerSnapshot: getExplorerSnapshotMock,
        listVolumes: listVolumesMock,
      } as never,
    },
  };
};

const sampleVolume: VolumeManifest = {
  id: 'volume-1',
  name: 'Finance',
  description: 'Quarter close workspace',
  quotaBytes: 8192,
  logicalUsedBytes: 4096,
  entryCount: 1,
  revision: 3,
  createdAt: '2026-04-01T08:00:00.000Z',
  updatedAt: '2026-04-01T09:00:00.000Z',
};

const sampleSnapshot: ExplorerSnapshot = {
  volume: sampleVolume,
  currentPath: '/reports',
  breadcrumbs: ['/', '/reports'],
  entries: [
    {
      id: 'entry-1',
      name: 'report.txt',
      path: '/reports/report.txt',
      kind: 'file',
      size: 2048,
      updatedAt: '2026-04-01T09:00:00.000Z',
    },
  ],
  totalEntries: 1,
  windowOffset: 0,
  windowSize: 12,
  usageBytes: 4096,
  remainingBytes: 4096,
};

const flushUi = async (): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ui terminal app runtime', () => {
  it('renders the dashboard shell from runtime volume data', async () => {
    const ui = createFakeUiFactory();
    const runtime = createRuntime({
      volumes: [sampleVolume],
    });
    const app = new TerminalApp(runtime.runtime, ui.factory);
    const testApp = asTestApp(app);

    await testApp.loadVolumes();

    expect(testApp.leftPane.label).toContain('Volumes');
    expect(testApp.primaryList.items[0]).toContain('Finance');
    expect(testApp.inspectorBox.content).toContain('Name     : Finance');
    expect(testApp.statusBox.content).toContain(
      'Ready. Dashboard active with 1 volumes available.',
    );
    expect(testApp.statusBox.content).toContain('Selected volume Finance');
    expect(ui.screen.renderCount).toBeGreaterThan(0);
    expect(testApp.primaryList.focused).toBe(true);

    testApp.shutdown();

    expect(ui.screen.destroyCount).toBe(1);
  });

  it('renders explorer wiring and handles quit hotkeys across shell states', async () => {
    const ui = createFakeUiFactory();
    const runtime = createRuntime({
      explorerSnapshot: sampleSnapshot,
      volumes: [sampleVolume],
    });
    const app = new TerminalApp(runtime.runtime, ui.factory);
    const testApp = asTestApp(app);

    await testApp.loadVolumes();
    await testApp.openVolume(sampleVolume.id);

    expect(testApp.mode).toBe('explorer');
    expect(testApp.rightPane.label).toBe(' Inspector  File ');
    expect(testApp.primaryList.items[0]).toContain('report.txt');
    expect(testApp.inspectorBox.content).toContain('Name    : report.txt');
    expect(testApp.shortcutsBox.content).toContain('[I] Import [E] Export');
    expect(testApp.statusBox.content).toContain('Ready. Explorer active in /reports.');
    expect(testApp.statusBox.content).toContain('Selected file report.txt');

    ui.screen.triggerKey('q');
    await flushUi();

    expect(testApp.mode).toBe('dashboard');
    expect(testApp.statusBox.content).toContain(
      'Ready. Dashboard active with 1 volumes available.',
    );
    expect(runtime.listVolumesMock).toHaveBeenCalledTimes(2);

    ui.screen.triggerKey('q');

    expect(ui.screen.destroyCount).toBe(1);
  });
});
