import path from 'node:path';

import blessed from 'neo-blessed';
import type { Widgets } from 'blessed';

import type { AppRuntime } from '../bootstrap/create-runtime.js';
import type {
  DirectoryListingItem,
  ExplorerSnapshot,
  ExportProgress,
  FilePreview,
  ImportProgress,
  VolumeManifest,
} from '../domain/types.js';
import { formatBytes, formatDateTime, truncate } from '../utils/formatters.js';
import { getParentVirtualPath } from '../utils/virtual-paths.js';
import type { HostBrowserEntry, HostBrowserSnapshot } from './host-browser.js';
import {
  getDefaultHostPath,
  getParentHostPath,
  listHostBrowserSnapshot,
} from './host-browser.js';
import {
  VISIBLE_ENTRY_ROWS,
  VISIBLE_VOLUME_ROWS,
  clampIndex,
  formatWindowSummary,
  getPageOffset,
  getVisibleWindow,
} from './navigation.js';

type ScreenMode = 'dashboard' | 'explorer';
type ToastTone = 'success' | 'error' | 'info';
type OverlayMode = 'help' | 'preview' | 'confirm' | 'input' | 'hostBrowser' | null;

interface ToastState {
  tone: ToastTone;
  message: string;
}

interface LayoutPositionSpec {
  width?: number | string;
  left?: number | string;
  right?: number | string;
}

interface LayoutElementSpec {
  position?: LayoutPositionSpec;
  parent?: unknown;
}

interface ThemePalette {
  background: string;
  header: string;
  panel: string;
  panelAlt: string;
  border: string;
  accent: string;
  accentMuted: string;
  text: string;
  muted: string;
  success: string;
  warning: string;
  danger: string;
}

const THEME: ThemePalette = {
  background: '#0b1220',
  header: '#132238',
  panel: '#101a2b',
  panelAlt: '#0f1727',
  border: '#2a4862',
  accent: '#4fd1c5',
  accentMuted: '#1d7f75',
  text: '#e5eef7',
  muted: '#8aa0b7',
  success: '#6ee7b7',
  warning: '#fbbf24',
  danger: '#fb7185',
};

const SPINNER_FRAMES = ['|', '/', '-', '\\'];
const HOST_BROWSER_VISIBLE_ROWS = 14;
const ICONS = {
  checkboxOff: '□',
  checkboxOn: '■',
  drive: '◉',
  file: '▪',
  folder: '▸',
  parent: '↰',
  volume: '◈',
} as const;

const createPanel = (
  screen: Widgets.Screen,
  options: Widgets.BoxOptions,
): Widgets.BoxElement =>
  blessed.box({
    parent: screen,
    border: 'line',
    tags: false,
    style: {
      bg: THEME.panel,
      fg: THEME.text,
      border: {
        fg: THEME.border,
      },
    },
    ...options,
  });

export class TerminalApp {
  private readonly screen: Widgets.Screen;

  private readonly headerBox: Widgets.BoxElement;

  private readonly leftPane: Widgets.BoxElement;

  private readonly rightPane: Widgets.BoxElement;

  private readonly primaryList: Widgets.ListElement;

  private readonly inspectorBox: Widgets.BoxElement;

  private readonly shortcutsBox: Widgets.BoxElement;

  private readonly statusBox: Widgets.BoxElement;

  private readonly overlayBackdrop: Widgets.BoxElement;

  private readonly overlayContainer: Widgets.BoxElement;

  private resolveExit: (() => void) | null = null;

  private spinnerIndex = 0;

  private spinnerInterval: NodeJS.Timeout;

  private toastTimeout: NodeJS.Timeout | null = null;

  private lastBusyRefreshAt = 0;

  private mode: ScreenMode = 'dashboard';

  private volumes: VolumeManifest[] = [];

  private selectedVolumeIndex = 0;

  private currentVolumeId: string | null = null;

  private currentSnapshot: ExplorerSnapshot | null = null;

  private selectedEntryIndex = 0;

  private busyLabel: string | null = 'Loading volumes';

  private toast: ToastState | null = null;

  private overlayMode: OverlayMode = null;

  private destroyed = false;

  public constructor(private readonly runtime: AppRuntime) {
    this.screen = blessed.screen({
      smartCSR: false,
      fullUnicode: true,
      dockBorders: true,
      autoPadding: false,
      title: 'Virtual Volumes',
      warnings: false,
    });

    this.headerBox = blessed.box({
      parent: this.screen,
      top: 0,
      left: 0,
      width: '100%',
      height: 3,
      style: {
        bg: THEME.header,
        fg: THEME.text,
      },
      padding: {
        left: 1,
        right: 1,
      },
    });

    this.leftPane = createPanel(this.screen, {
      top: 3,
      left: 0,
      width: '62%',
      bottom: 2,
      label: ' Navigation ',
    });

    this.primaryList = blessed.list({
      parent: this.leftPane,
      top: 1,
      left: 1,
      right: 1,
      bottom: 1,
      keys: false,
      mouse: true,
      vi: false,
      tags: false,
      style: {
        bg: THEME.panel,
        fg: THEME.text,
        selected: {
          bg: THEME.accent,
          fg: THEME.background,
          bold: true,
        },
        item: {
          fg: THEME.text,
          bg: THEME.panel,
        },
      },
      scrollbar: {
        ch: ' ',
        style: {
          bg: THEME.accentMuted,
        },
      },
    });

    this.rightPane = createPanel(this.screen, {
      top: 3,
      left: '62%',
      width: '38%',
      bottom: 11,
      label: ' Inspector ',
    });

    this.inspectorBox = blessed.box({
      parent: this.rightPane,
      top: 1,
      left: 1,
      right: 1,
      bottom: 1,
      scrollable: true,
      alwaysScroll: true,
      keys: false,
      mouse: false,
      tags: false,
      style: {
        bg: THEME.panel,
        fg: THEME.text,
      },
      scrollbar: {
        ch: ' ',
        style: {
          bg: THEME.accentMuted,
        },
      },
    });

    this.shortcutsBox = createPanel(this.screen, {
      height: 9,
      bottom: 2,
      left: '62%',
      width: '38%',
      label: ' Keyboard ',
    });

    this.statusBox = createPanel(this.screen, {
      height: 2,
      bottom: 0,
      left: 0,
      width: '100%',
      label: ' Status ',
    });

    this.overlayBackdrop = blessed.box({
      parent: this.screen,
      top: 0,
      left: 0,
      width: '100%',
      height: '100%',
      hidden: true,
      style: {
        bg: '#050811',
        transparent: false,
      },
    });

    this.overlayContainer = blessed.box({
      parent: this.screen,
      top: 'center',
      left: 'center',
      width: '78%',
      height: '72%',
      hidden: true,
      border: 'line',
      label: ' Modal ',
      style: {
        bg: THEME.panelAlt,
        fg: THEME.text,
        border: {
          fg: THEME.accent,
        },
      },
    });

    this.spinnerInterval = setInterval(() => {
      if (!this.busyLabel) {
        return;
      }

      this.spinnerIndex = (this.spinnerIndex + 1) % SPINNER_FRAMES.length;
      this.renderStatus();
      this.screen.render();
    }, 100);

    this.bindKeys();
    this.focusShell();
  }

  public async start(): Promise<void> {
    this.render();
    await this.loadVolumes();

    if (this.runtime.config.logToStdout) {
      this.notify(
        'info',
        'Terminal log mirroring is enabled and may visually interfere with fullscreen mode.',
      );
    }

    return new Promise<void>((resolve) => {
      this.resolveExit = resolve;
    });
  }

  private bindKeys(): void {
    this.screen.on('resize', () => {
      this.render();
    });

    this.screen.key(['C-c'], () => {
      void this.shutdown();
    });

    this.screen.key(['q'], () => {
      if (this.overlayMode) {
        return;
      }

      if (this.busyLabel) {
        this.notify('info', 'An operation is still running. Press Ctrl+C to force exit.');
        return;
      }

      if (this.mode === 'dashboard') {
        void this.shutdown();
        return;
      }

      void this.goToDashboard();
    });

    this.screen.key(['?'], () => {
      if (this.busyLabel || this.overlayMode) {
        return;
      }

      void this.openHelpOverlay();
    });

    this.screen.key(['up'], () => {
      if (!this.canHandleNavigation()) {
        return;
      }

      void this.moveSelection(-1);
    });

    this.screen.key(['down'], () => {
      if (!this.canHandleNavigation()) {
        return;
      }

      void this.moveSelection(1);
    });

    this.screen.key(['pageup'], () => {
      if (!this.canHandleNavigation()) {
        return;
      }

      void this.moveByPage(-1);
    });

    this.screen.key(['pagedown'], () => {
      if (!this.canHandleNavigation()) {
        return;
      }

      void this.moveByPage(1);
    });

    this.screen.key(['home'], () => {
      if (!this.canHandleNavigation()) {
        return;
      }

      void this.jumpSelection('start');
    });

    this.screen.key(['end'], () => {
      if (!this.canHandleNavigation()) {
        return;
      }

      void this.jumpSelection('end');
    });

    this.screen.key(['left', 'backspace', 'b'], () => {
      if (this.busyLabel || this.overlayMode) {
        return;
      }

      if (this.mode === 'explorer') {
        void this.goBack();
      }
    });

    this.screen.key(['right', 'enter', 'o'], () => {
      if (this.busyLabel || this.overlayMode) {
        return;
      }

      if (this.mode === 'dashboard') {
        void this.openSelectedVolume();
        return;
      }

      void this.openSelectedEntry();
    });

    this.screen.key(['r'], () => {
      if (this.busyLabel || this.overlayMode) {
        return;
      }

      void this.refreshCurrentScreen();
    });

    this.screen.key(['n'], () => {
      if (this.busyLabel || this.overlayMode || this.mode !== 'dashboard') {
        return;
      }

      void this.createVolumeWizard();
    });

    this.screen.key(['x'], () => {
      if (this.busyLabel || this.overlayMode || this.mode !== 'dashboard') {
        return;
      }

      void this.deleteSelectedVolume();
    });

    this.screen.key(['c'], () => {
      if (this.busyLabel || this.overlayMode || this.mode !== 'explorer') {
        return;
      }

      void this.createFolderWizard();
    });

    this.screen.key(['i'], () => {
      if (this.busyLabel || this.overlayMode || this.mode !== 'explorer') {
        return;
      }

      void this.importWizard();
    });

    this.screen.key(['e'], () => {
      if (this.busyLabel || this.overlayMode || this.mode !== 'explorer') {
        return;
      }

      void this.exportWizard();
    });

    this.screen.key(['m'], () => {
      if (this.busyLabel || this.overlayMode || this.mode !== 'explorer') {
        return;
      }

      void this.moveSelectedEntry();
    });

    this.screen.key(['d'], () => {
      if (this.busyLabel || this.overlayMode || this.mode !== 'explorer') {
        return;
      }

      void this.deleteSelectedEntry();
    });

    this.screen.key(['p'], () => {
      if (this.busyLabel || this.overlayMode || this.mode !== 'explorer') {
        return;
      }

      void this.previewSelectedEntry();
    });
  }

  private canHandleNavigation(): boolean {
    if (this.busyLabel || this.overlayMode) {
      return false;
    }

    if (this.mode === 'dashboard') {
      return this.volumes.length > 0;
    }

    return (this.currentSnapshot?.totalEntries ?? 0) > 0;
  }

  private render(): void {
    if (this.destroyed) {
      return;
    }

    this.renderHeader();
    this.renderPrimaryPane();
    this.renderInspector();
    this.renderShortcuts();
    this.renderStatus();
    this.screen.render();
  }

  private renderHeader(): void {
    const headerWidth = this.getContentWidth(this.headerBox);

    if (this.mode === 'dashboard') {
      this.headerBox.setContent(
        [
          this.fitSingleLine('Virtual Volumes  Stable keyboard-first shell', headerWidth),
          this.fitSingleLine(`Data root ${this.runtime.config.dataDir}`, headerWidth),
        ].join('\n'),
      );
      return;
    }

    if (!this.currentSnapshot) {
      this.headerBox.setContent(
        [
          this.fitSingleLine('Virtual Volumes', headerWidth),
          this.fitSingleLine('No volume opened.', headerWidth),
        ].join('\n'),
      );
      return;
    }

    const pageSummary = formatWindowSummary(
      this.currentSnapshot.windowOffset,
      this.currentSnapshot.windowOffset + this.currentSnapshot.entries.length,
      this.currentSnapshot.totalEntries,
    );

    this.headerBox.setContent(
      [
        this.fitSingleLine(
          `${this.currentSnapshot.volume.name}  ${this.currentSnapshot.currentPath}`,
          headerWidth,
        ),
        this.fitSingleLine(
          `Entries ${pageSummary}  Remaining ${formatBytes(this.currentSnapshot.remainingBytes)}`,
          headerWidth,
        ),
      ].join('\n'),
    );
  }

  private renderPrimaryPane(): void {
    if (this.mode === 'dashboard') {
      const visibleVolumes = getVisibleWindow(
        this.volumes,
        this.selectedVolumeIndex,
        VISIBLE_VOLUME_ROWS,
      );

      this.leftPane.setLabel(
        this.volumes.length > 0
          ? ` Volumes  ${formatWindowSummary(visibleVolumes.start, visibleVolumes.end, this.volumes.length)} `
          : ' Volumes ',
      );

      if (visibleVolumes.items.length === 0) {
        this.primaryList.setItems([
          this.fitSingleLine('No virtual volumes yet. Press N to create one.', this.getContentWidth(this.leftPane)),
        ]);
        this.primaryList.select(0);
        return;
      }

      this.primaryList.setItems(
        visibleVolumes.items.map((volume) =>
          this.formatVolumeRow(volume, this.getContentWidth(this.leftPane)),
        ),
      );
      this.primaryList.select(this.selectedVolumeIndex - visibleVolumes.start);
      return;
    }

    if (!this.currentSnapshot || this.currentSnapshot.entries.length === 0) {
      const currentPath = this.currentSnapshot?.currentPath ?? '/';
      this.leftPane.setLabel(
        ` Entries  ${this.fitSingleLine(currentPath, Math.max(12, this.getContentWidth(this.leftPane) - 10))} `,
      );
      this.primaryList.setItems([
        this.fitSingleLine('This directory is empty.', this.getContentWidth(this.leftPane)),
      ]);
      this.primaryList.select(0);
      return;
    }

    this.leftPane.setLabel(
      ` Entries  ${formatWindowSummary(
        this.currentSnapshot.windowOffset,
        this.currentSnapshot.windowOffset + this.currentSnapshot.entries.length,
        this.currentSnapshot.totalEntries,
      )} `,
    );

    this.primaryList.setItems(
      this.currentSnapshot.entries.map((entry) =>
        this.formatEntryRow(entry, this.getContentWidth(this.leftPane)),
      ),
    );
    this.primaryList.select(this.selectedEntryIndex - this.currentSnapshot.windowOffset);
  }

  private renderInspector(): void {
    if (this.mode === 'dashboard') {
      const selectedVolume = this.volumes[this.selectedVolumeIndex] ?? null;
      if (!selectedVolume) {
        this.inspectorBox.setContent(
          [
            'No volume selected.',
            '',
            `Data dir: ${this.runtime.config.dataDir}`,
            `Logs: ${this.runtime.config.logDir}`,
            '',
            'Use arrows to move and Enter to open a volume.',
          ].join('\n'),
        );
        return;
      }

      this.inspectorBox.setContent(
        [
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
          `Data dir: ${this.runtime.config.dataDir}`,
          `Logs: ${this.runtime.config.logDir}`,
        ].join('\n'),
      );
      return;
    }

    if (!this.currentSnapshot) {
      this.inspectorBox.setContent('No volume opened.');
      return;
    }

    const selectedEntry = this.getSelectedEntry();

    this.inspectorBox.setContent(
      [
        this.currentSnapshot.volume.name,
        `Path: ${this.currentSnapshot.currentPath}`,
        '',
        `Used: ${formatBytes(this.currentSnapshot.usageBytes)}`,
        `Quota: ${formatBytes(this.currentSnapshot.volume.quotaBytes)}`,
        `Remaining: ${formatBytes(this.currentSnapshot.remainingBytes)}`,
        `Entries in dir: ${this.currentSnapshot.totalEntries}`,
        '',
        selectedEntry ? `Selected: ${selectedEntry.name}` : 'Selected: none',
        selectedEntry ? `Type: ${selectedEntry.kind}` : '',
        selectedEntry?.kind === 'file'
          ? `Size: ${formatBytes(selectedEntry.size)}`
          : '',
        selectedEntry ? `Updated: ${formatDateTime(selectedEntry.updatedAt)}` : '',
        selectedEntry ? `Path: ${truncate(selectedEntry.path, 220)}` : '',
      ]
        .filter((line) => line.length > 0)
        .join('\n'),
    );
  }

  private renderShortcuts(): void {
    const shortcuts =
      this.mode === 'dashboard'
        ? [
            '[UP/DOWN] Select volume',
            '[RIGHT/ENTER] Open volume',
            '[PGUP/PGDN] Page volumes',
            '[HOME/END] Jump list bounds',
            '[N] New volume',
            '[X] Delete volume',
            '[R] Refresh   [?] Help',
            '[Q] Quit',
          ]
        : [
            '[UP/DOWN] Select entry',
            '[LEFT/RIGHT] Parent or open',
            '[PGUP/PGDN] Page entries',
            '[HOME/END] Jump list bounds',
            '[I] Import   [E] Export',
            '[C] Folder   [M] Move',
            '[D] Delete   [P] Preview',
            '[R] Refresh  [B/Q] Dashboard',
          ];

    const availableWidth = this.getContentWidth(this.shortcutsBox);
    this.shortcutsBox.setContent(
      shortcuts
        .map((shortcut) => this.fitSingleLine(shortcut, availableWidth))
        .join('\n'),
    );
  }

  private renderStatus(): void {
    if (this.busyLabel) {
      this.statusBox.setContent(
        this.fitSingleLine(
          `${SPINNER_FRAMES[this.spinnerIndex]} ${this.busyLabel}    Logs ${this.runtime.config.logDir}`,
          this.getContentWidth(this.statusBox),
        ),
      );
      return;
    }

    if (this.toast) {
      this.statusBox.setContent(
        this.fitSingleLine(
          `[${this.toast.tone.toUpperCase()}] ${this.toast.message}    Logs ${this.runtime.config.logDir}`,
          this.getContentWidth(this.statusBox),
        ),
      );
      return;
    }

    this.statusBox.setContent(
      this.fitSingleLine(
        `Stable keyboard shell active. Use arrows for movement and shortcuts for actions.    Logs ${this.runtime.config.logDir}`,
        this.getContentWidth(this.statusBox),
      ),
    );
  }

  private async moveSelection(direction: -1 | 1): Promise<void> {
    if (this.mode === 'dashboard') {
      this.selectedVolumeIndex = clampIndex(
        this.selectedVolumeIndex + direction,
        this.volumes.length,
      );
      this.render();
      return;
    }

    if (!this.currentSnapshot || !this.currentVolumeId) {
      return;
    }

    const nextIndex = clampIndex(
      this.selectedEntryIndex + direction,
      this.currentSnapshot.totalEntries,
    );

    if (nextIndex === this.selectedEntryIndex) {
      return;
    }

    const windowStart = this.currentSnapshot.windowOffset;
    const windowEnd = windowStart + this.currentSnapshot.entries.length;

    if (nextIndex < windowStart || nextIndex >= windowEnd) {
      await this.openVolume(
        this.currentVolumeId,
        this.currentSnapshot.currentPath,
        nextIndex,
      );
      return;
    }

    this.selectedEntryIndex = nextIndex;
    this.render();
  }

  private async moveByPage(direction: -1 | 1): Promise<void> {
    if (this.mode === 'dashboard') {
      this.selectedVolumeIndex = clampIndex(
        this.selectedVolumeIndex + VISIBLE_VOLUME_ROWS * direction,
        this.volumes.length,
      );
      this.render();
      return;
    }

    if (!this.currentSnapshot || !this.currentVolumeId) {
      return;
    }

    const nextIndex = clampIndex(
      this.selectedEntryIndex + VISIBLE_ENTRY_ROWS * direction,
      this.currentSnapshot.totalEntries,
    );

    await this.openVolume(
      this.currentVolumeId,
      this.currentSnapshot.currentPath,
      nextIndex,
    );
  }

  private async jumpSelection(target: 'start' | 'end'): Promise<void> {
    if (this.mode === 'dashboard') {
      this.selectedVolumeIndex =
        target === 'start' ? 0 : clampIndex(Number.MAX_SAFE_INTEGER, this.volumes.length);
      this.render();
      return;
    }

    if (!this.currentSnapshot || !this.currentVolumeId) {
      return;
    }

    const nextIndex =
      target === 'start'
        ? 0
        : clampIndex(Number.MAX_SAFE_INTEGER, this.currentSnapshot.totalEntries);

    await this.openVolume(
      this.currentVolumeId,
      this.currentSnapshot.currentPath,
      nextIndex,
    );
  }

  private async loadVolumes(): Promise<void> {
    const volumes = await this.runTask('Loading volumes', () =>
      this.runtime.volumeService.listVolumes(),
    );

    if (!volumes) {
      return;
    }

    this.volumes = volumes;
    this.selectedVolumeIndex = clampIndex(this.selectedVolumeIndex, this.volumes.length);
    this.focusShell();
    this.render();
  }

  private async openVolume(
    volumeId: string,
    targetPath = '/',
    selectionIndex = 0,
  ): Promise<void> {
    const snapshot = await this.runTask('Opening volume', () =>
      this.runtime.volumeService.getExplorerSnapshot(volumeId, targetPath, {
        offset: getPageOffset(selectionIndex, VISIBLE_ENTRY_ROWS),
        limit: VISIBLE_ENTRY_ROWS,
      }),
    );

    if (!snapshot) {
      return;
    }

    this.mode = 'explorer';
    this.currentVolumeId = volumeId;
    this.currentSnapshot = snapshot;
    this.selectedEntryIndex = clampIndex(selectionIndex, snapshot.totalEntries);
    this.focusShell();
    this.render();
  }

  private async refreshCurrentScreen(): Promise<void> {
    if (this.mode === 'dashboard') {
      await this.loadVolumes();
      return;
    }

    if (!this.currentVolumeId || !this.currentSnapshot) {
      return;
    }

    await this.openVolume(
      this.currentVolumeId,
      this.currentSnapshot.currentPath,
      this.selectedEntryIndex,
    );
  }

  private async openSelectedVolume(): Promise<void> {
    const selectedVolume = this.volumes[this.selectedVolumeIndex] ?? null;
    if (!selectedVolume) {
      this.notify('info', 'Create a volume first.');
      return;
    }

    await this.openVolume(selectedVolume.id);
  }

  private async openSelectedEntry(): Promise<void> {
    const selectedEntry = this.getSelectedEntry();
    if (!selectedEntry || !this.currentVolumeId) {
      this.notify('info', 'Select an entry first.');
      return;
    }

    if (selectedEntry.kind === 'directory') {
      await this.openVolume(this.currentVolumeId, selectedEntry.path);
      return;
    }

    await this.previewSelectedEntry();
  }

  private async goBack(): Promise<void> {
    if (this.mode !== 'explorer') {
      return;
    }

    if (!this.currentVolumeId || !this.currentSnapshot) {
      await this.goToDashboard();
      return;
    }

    if (this.currentSnapshot.currentPath === '/') {
      await this.goToDashboard();
      return;
    }

    await this.openVolume(
      this.currentVolumeId,
      getParentVirtualPath(this.currentSnapshot.currentPath),
    );
  }

  private async goToDashboard(): Promise<void> {
    this.mode = 'dashboard';
    this.currentVolumeId = null;
    this.currentSnapshot = null;
    this.selectedEntryIndex = 0;
    await this.loadVolumes();
    this.focusShell();
  }

  private async createVolumeWizard(): Promise<void> {
    const name = await this.promptValue({
      title: 'Create Volume',
      description: 'Volume name',
      initialValue: '',
      footer: 'Enter saves. Esc cancels.',
    });

    if (name === null) {
      return;
    }

    const quotaInput = await this.promptValue({
      title: 'Create Volume',
      description: 'Logical quota in bytes. Leave empty to use the default quota.',
      initialValue: String(this.runtime.config.defaultQuotaBytes),
      footer: 'Enter saves. Esc cancels.',
    });

    if (quotaInput === null) {
      return;
    }

    const trimmedQuota = quotaInput.trim();
    const parsedQuota =
      trimmedQuota.length === 0 ? undefined : Number.parseInt(trimmedQuota, 10);

    if (parsedQuota !== undefined && Number.isNaN(parsedQuota)) {
      this.notify('error', 'Quota bytes must be a valid integer.');
      return;
    }

    const description = await this.promptValue({
      title: 'Create Volume',
      description: 'Optional description',
      initialValue: '',
      footer: 'Enter saves. Esc cancels.',
    });

    if (description === null) {
      return;
    }

    const createdVolume = await this.runTask('Creating volume', () =>
      this.runtime.volumeService.createVolume({
        name,
        quotaBytes: parsedQuota,
        description,
      }),
    );

    if (!createdVolume) {
      return;
    }

    this.notify('success', `Volume "${createdVolume.name}" created.`);
    await this.loadVolumes();
    const volumeIndex = this.volumes.findIndex((volume) => volume.id === createdVolume.id);
    this.selectedVolumeIndex = clampIndex(volumeIndex, this.volumes.length);
    this.render();
  }

  private async createFolderWizard(): Promise<void> {
    if (!this.currentVolumeId || !this.currentSnapshot) {
      return;
    }

    const name = await this.promptValue({
      title: 'Create Folder',
      description: `New folder inside ${this.currentSnapshot.currentPath}`,
      initialValue: '',
      footer: 'Enter saves. Esc cancels.',
    });

    if (name === null) {
      return;
    }

    const currentPath = this.currentSnapshot.currentPath;
    const createdDirectory = await this.runTask('Creating folder', () =>
      this.runtime.volumeService.createDirectory(this.currentVolumeId!, currentPath, name),
    );

    if (!createdDirectory) {
      return;
    }

    this.notify('success', `Folder "${createdDirectory.name}" created.`);
    await this.openVolume(this.currentVolumeId, currentPath, this.selectedEntryIndex);
  }

  private async importWizard(): Promise<void> {
    if (!this.currentVolumeId || !this.currentSnapshot) {
      return;
    }

    const destinationPath = this.currentSnapshot.currentPath;
    const hostPaths = await this.openHostImportOverlay(destinationPath);
    if (hostPaths === null) {
      return;
    }

    if (hostPaths.length === 0) {
      this.notify('info', 'Select at least one host file or folder to import.');
      return;
    }

    const summary = await this.runTask('Importing host paths', () =>
      this.runtime.volumeService.importHostPaths(this.currentVolumeId!, {
        hostPaths,
        destinationPath,
        onProgress: (progress) => {
          this.updateBusyLabel(this.formatImportProgress(progress));
        },
      }),
    );

    if (!summary) {
      return;
    }

    this.notify(
      'success',
      `Imported ${summary.filesImported} files and ${summary.directoriesImported} directories.`,
    );
    await this.openVolume(this.currentVolumeId, destinationPath);
  }

  private async exportWizard(): Promise<void> {
    if (!this.currentVolumeId || !this.currentSnapshot) {
      return;
    }

    const selectedEntry = this.getSelectedEntry();
    if (!selectedEntry) {
      this.notify('info', 'Select a file or folder first.');
      return;
    }

    const destinationHostDirectory = await this.openHostExportOverlay(selectedEntry.path);
    if (destinationHostDirectory === null) {
      return;
    }

    const summary = await this.runTask('Exporting to host', () =>
      this.runtime.volumeService.exportEntryToHost(this.currentVolumeId!, {
        sourcePath: selectedEntry.path,
        destinationHostDirectory,
        onProgress: (progress) => {
          this.updateBusyLabel(this.formatExportProgress(progress));
        },
      }),
    );

    if (!summary) {
      return;
    }

    this.notify(
      'success',
      `Exported ${summary.filesExported} files and ${summary.directoriesExported} directories.`,
    );
    this.render();
  }

  private async openHostImportOverlay(destinationPath: string): Promise<string[] | null> {
    const initialHostPath = await getDefaultHostPath();

    return new Promise<string[] | null>((resolve) => {
      const viewportWidth = this.getViewportWidth();
      const viewportHeight = this.getViewportHeight();
      const overlayWidth =
        viewportWidth > 90
          ? Math.min(viewportWidth - 4, 148)
          : Math.max(40, viewportWidth - 2);
      const overlayHeight =
        viewportHeight > 26
          ? Math.min(viewportHeight - 4, 34)
          : Math.max(12, viewportHeight - 1);
      const summaryWidth = Math.max(
        22,
        Math.min(
          Math.min(38, Math.max(22, overlayWidth - 34)),
          Math.floor((overlayWidth - 2) * 0.34),
        ),
      );
      let snapshot: HostBrowserSnapshot = {
        currentPath: initialHostPath,
        displayPath: 'Loading host filesystem...',
        entries: [],
      };
      let selectedIndex = 0;
      let loading = false;
      let settled = false;
      let renderedRowsSignature = '';
      const selectedPaths = new Set<string>();

      this.overlayMode = 'hostBrowser';
      this.overlayBackdrop.show();
      this.overlayContainer.setLabel(' Host Import ');
      this.overlayContainer.width = overlayWidth;
      this.overlayContainer.height = overlayHeight;
      this.overlayContainer.left = Math.max(
        0,
        Math.floor((viewportWidth - overlayWidth) / 2),
      );
      this.overlayContainer.top = Math.max(
        1,
        Math.floor((viewportHeight - overlayHeight) / 2),
      );
      this.overlayContainer.show();
      this.clearChildren(this.overlayContainer);

      const headerBox = blessed.box({
        parent: this.overlayContainer,
        top: 1,
        left: 2,
        right: 2,
        height: 3,
        style: {
          bg: THEME.panelAlt,
          fg: THEME.text,
        },
      });

      const browserPane = blessed.box({
        parent: this.overlayContainer,
        top: 4,
        left: 1,
        right: summaryWidth + 2,
        bottom: 3,
        border: 'line',
        label: ' Host Filesystem ',
        style: {
          bg: THEME.panelAlt,
          fg: THEME.text,
          border: {
            fg: THEME.border,
          },
        },
      });

      const browserList = blessed.list({
        parent: browserPane,
        top: 1,
        left: 1,
        right: 1,
        bottom: 1,
        keys: false,
        mouse: false,
        tags: false,
        style: {
          bg: THEME.panelAlt,
          fg: THEME.text,
          selected: {
            bg: THEME.accent,
            fg: THEME.background,
            bold: true,
          },
          item: {
            bg: THEME.panelAlt,
            fg: THEME.text,
          },
        },
        scrollbar: {
          ch: ' ',
          style: {
            bg: THEME.accentMuted,
          },
        },
      });

      const summaryPane = blessed.box({
        parent: this.overlayContainer,
        top: 4,
        right: 1,
        width: summaryWidth,
        bottom: 3,
        border: 'line',
        label: ' Selection ',
        style: {
          bg: THEME.panelAlt,
          fg: THEME.text,
          border: {
            fg: THEME.border,
          },
        },
      });

      const summaryBox = blessed.box({
        parent: summaryPane,
        top: 1,
        left: 1,
        right: 1,
        bottom: 1,
        scrollable: true,
        alwaysScroll: true,
        mouse: false,
        style: {
          bg: THEME.panelAlt,
          fg: THEME.text,
        },
        scrollbar: {
          ch: ' ',
          style: {
            bg: THEME.accentMuted,
          },
        },
      });

      const footerBox = blessed.box({
        parent: this.overlayContainer,
        left: 2,
        right: 2,
        bottom: 1,
        height: 1,
        style: {
          bg: THEME.panelAlt,
          fg: THEME.muted,
        },
      });

      const getCurrentEntry = (): HostBrowserEntry | null =>
        snapshot.entries[selectedIndex] ?? null;

      const getVisibleEntries = () =>
        getVisibleWindow(snapshot.entries, selectedIndex, HOST_BROWSER_VISIBLE_ROWS);

      const getRowsSignature = (): string => {
        if (loading) {
          return 'loading';
        }

        if (snapshot.entries.length === 0) {
          return `empty:${snapshot.currentPath ?? 'root'}`;
        }

        const window = getVisibleEntries();
        const selectedKey = Array.from(selectedPaths)
          .sort((left, right) => left.localeCompare(right))
          .join('|');

        return [
          snapshot.currentPath ?? 'root',
          window.start,
          window.end,
          selectedKey,
        ].join('::');
      };

      const close = (result: string[] | null): void => {
        if (settled) {
          return;
        }

        settled = true;
        this.closeOverlay();
        resolve(result);
      };

      const syncBrowserRows = (): void => {
        const rowsSignature = getRowsSignature();
        if (rowsSignature === renderedRowsSignature) {
          return;
        }

        renderedRowsSignature = rowsSignature;

        if (loading) {
          browserList.setItems(['Loading host filesystem...']);
          browserList.select(0);
          return;
        }

        if (snapshot.entries.length === 0) {
          browserList.setItems(['No files or folders here.']);
          browserList.select(0);
          return;
        }

        const visibleWindow = getVisibleEntries();
        browserList.setItems(
          visibleWindow.items.map((entry) =>
            this.formatHostBrowserRow(
              entry,
              entry.absolutePath !== null && selectedPaths.has(entry.absolutePath),
              this.getContentWidth(browserPane),
            ),
          ),
        );
      };

      const syncBrowserSelection = (): void => {
        if (loading || snapshot.entries.length === 0) {
          browserList.select(0);
          return;
        }

        const visibleWindow = getVisibleEntries();
        browserList.select(
          clampIndex(selectedIndex - visibleWindow.start, visibleWindow.items.length),
        );
      };

      const renderBrowser = (): void => {
        const headerWidth = this.getContentWidth(this.overlayContainer) - 4;
        const currentEntry = getCurrentEntry();
        const visibleWindow = getVisibleEntries();
        const selectedItemsPreview = Array.from(selectedPaths)
          .slice(0, 8)
          .map((hostPath) => `${ICONS.file} ${path.basename(hostPath) || hostPath}`)
          .join('\n');

        headerBox.setContent(
          [
            this.fitSingleLine(`Host ${snapshot.displayPath}`, headerWidth),
            this.fitSingleLine(`Import destination ${destinationPath}`, headerWidth),
          ].join('\n'),
        );

        browserPane.setLabel(
          loading
            ? ' Host Filesystem  loading '
            : ` Host Filesystem  ${formatWindowSummary(
                visibleWindow.start,
                visibleWindow.end,
                snapshot.entries.length,
              )} `,
        );

        syncBrowserRows();
        syncBrowserSelection();

        summaryBox.setContent(
          [
            `Checked items: ${selectedPaths.size}`,
            '',
            currentEntry
              ? `Current: ${currentEntry.name} (${selectedIndex + 1}/${snapshot.entries.length})`
              : 'Current: none',
            currentEntry ? `Type: ${currentEntry.kind}` : '',
            currentEntry?.absolutePath
              ? `Path: ${truncate(currentEntry.absolutePath, 220)}`
              : '',
            currentEntry?.selectable
              ? `Checked: ${
                  currentEntry.absolutePath !== null && selectedPaths.has(currentEntry.absolutePath)
                    ? 'yes'
                    : 'no'
                }`
              : 'Checked: not available',
            '',
            selectedItemsPreview.length > 0
              ? `Selected\n${selectedItemsPreview}`
              : 'Selected\nNone yet.',
          ]
            .filter((line) => line.length > 0)
            .join('\n'),
        );

        footerBox.setContent(
          this.fitSingleLine(
            'Up/Down move   Right enter   Left back   Space check   Enter/I import   A toggle page   Esc cancel',
            this.getContentWidth(this.overlayContainer) - 4,
          ),
        );

        this.screen.render();
      };

      const loadSnapshot = async (
        targetPath: string | null,
        preferredAbsolutePath: string | null = null,
      ): Promise<void> => {
        loading = true;
        renderBrowser();

        try {
          const nextSnapshot = await listHostBrowserSnapshot(targetPath);
          snapshot = nextSnapshot;
          renderedRowsSignature = '';

          const preferredIndex =
            preferredAbsolutePath === null
              ? -1
              : snapshot.entries.findIndex(
                  (entry) => entry.absolutePath === preferredAbsolutePath,
                );

          if (preferredIndex >= 0) {
            selectedIndex = preferredIndex;
          } else {
            selectedIndex = clampIndex(0, snapshot.entries.length);
          }
        } catch (error) {
          const message =
            error instanceof Error ? error.message : 'Unable to browse the host filesystem.';
          this.notify('error', message);
        } finally {
          loading = false;
          renderBrowser();
        }
      };

      const moveSelectionBy = (direction: number): void => {
        if (loading || snapshot.entries.length === 0) {
          return;
        }

        selectedIndex = clampIndex(selectedIndex + direction, snapshot.entries.length);
        syncBrowserSelection();
        renderBrowser();
      };

      const navigateIn = async (): Promise<void> => {
        if (loading) {
          return;
        }

        const currentEntry = getCurrentEntry();
        if (!currentEntry) {
          return;
        }

        if (currentEntry.navigable) {
          await loadSnapshot(currentEntry.absolutePath);
          return;
        }

        if (currentEntry.selectable && currentEntry.absolutePath !== null) {
          toggleCurrentSelection();
        }
      };

      const navigateOut = async (): Promise<void> => {
        if (loading || snapshot.currentPath === null) {
          return;
        }

        const previousPath = snapshot.currentPath;
        const parentPath = getParentHostPath(snapshot.currentPath);
        if (parentPath === snapshot.currentPath) {
          return;
        }

        await loadSnapshot(parentPath, previousPath);
      };

      const toggleCurrentSelection = (): void => {
        if (loading) {
          return;
        }

        const currentEntry = getCurrentEntry();
        if (!currentEntry?.selectable || currentEntry.absolutePath === null) {
          return;
        }

        if (selectedPaths.has(currentEntry.absolutePath)) {
          selectedPaths.delete(currentEntry.absolutePath);
        } else {
          selectedPaths.add(currentEntry.absolutePath);
        }

        renderedRowsSignature = '';
        renderBrowser();
      };

      const toggleVisibleSelections = (): void => {
        const selectableEntries = getVisibleEntries().items.filter(
          (entry) => entry.selectable && entry.absolutePath !== null,
        );
        if (selectableEntries.length === 0) {
          return;
        }

        const shouldSelectAll = selectableEntries.some(
          (entry) => !selectedPaths.has(entry.absolutePath!),
        );

        for (const entry of selectableEntries) {
          if (shouldSelectAll) {
            selectedPaths.add(entry.absolutePath!);
          } else {
            selectedPaths.delete(entry.absolutePath!);
          }
        }

        renderedRowsSignature = '';
        renderBrowser();
      };

      const confirmSelection = (): void => {
        if (selectedPaths.size === 0) {
          this.notify('info', 'Select one or more host files or folders with Space.');
          renderBrowser();
          return;
        }

        close(Array.from(selectedPaths));
      };

      browserList.key(['up'], () => {
        moveSelectionBy(-1);
      });
      browserList.key(['down'], () => {
        moveSelectionBy(1);
      });
      browserList.key(['right'], () => {
        void navigateIn();
      });
      browserList.key(['left', 'backspace'], () => {
        void navigateOut();
      });
      browserList.key(['space'], () => {
        toggleCurrentSelection();
      });
      browserList.key(['enter', 'i'], () => {
        confirmSelection();
      });
      browserList.key(['a'], () => {
        toggleVisibleSelections();
      });
      browserList.key(['pageup'], () => {
        moveSelectionBy(-HOST_BROWSER_VISIBLE_ROWS);
      });
      browserList.key(['pagedown'], () => {
        moveSelectionBy(HOST_BROWSER_VISIBLE_ROWS);
      });
      browserList.key(['home'], () => {
        if (loading || snapshot.entries.length === 0) {
          return;
        }

        selectedIndex = 0;
        syncBrowserSelection();
        renderBrowser();
      });
      browserList.key(['end'], () => {
        if (loading || snapshot.entries.length === 0) {
          return;
        }

        selectedIndex = snapshot.entries.length - 1;
        syncBrowserSelection();
        renderBrowser();
      });
      browserList.key(['escape', 'q'], () => {
        close(null);
      });

      browserList.focus();
      renderBrowser();
      void loadSnapshot(initialHostPath);
    });
  }

  private async openHostExportOverlay(sourcePath: string): Promise<string | null> {
    const initialHostPath = await getDefaultHostPath();

    return new Promise<string | null>((resolve) => {
      const viewportWidth = this.getViewportWidth();
      const viewportHeight = this.getViewportHeight();
      const overlayWidth =
        viewportWidth > 90
          ? Math.min(viewportWidth - 4, 148)
          : Math.max(40, viewportWidth - 2);
      const overlayHeight =
        viewportHeight > 24
          ? Math.min(viewportHeight - 4, 30)
          : Math.max(12, viewportHeight - 1);
      const summaryWidth = Math.max(
        22,
        Math.min(
          Math.min(38, Math.max(22, overlayWidth - 34)),
          Math.floor((overlayWidth - 2) * 0.34),
        ),
      );
      let snapshot: HostBrowserSnapshot = {
        currentPath: initialHostPath,
        displayPath: 'Loading host filesystem...',
        entries: [],
      };
      let selectedIndex = 0;
      let loading = false;
      let settled = false;
      let renderedRowsSignature = '';

      this.overlayMode = 'hostBrowser';
      this.overlayBackdrop.show();
      this.overlayContainer.setLabel(' Host Export ');
      this.overlayContainer.width = overlayWidth;
      this.overlayContainer.height = overlayHeight;
      this.overlayContainer.left = Math.max(
        0,
        Math.floor((viewportWidth - overlayWidth) / 2),
      );
      this.overlayContainer.top = Math.max(
        1,
        Math.floor((viewportHeight - overlayHeight) / 2),
      );
      this.overlayContainer.show();
      this.clearChildren(this.overlayContainer);

      const headerBox = blessed.box({
        parent: this.overlayContainer,
        top: 1,
        left: 2,
        right: 2,
        height: 3,
        style: {
          bg: THEME.panelAlt,
          fg: THEME.text,
        },
      });

      const browserPane = blessed.box({
        parent: this.overlayContainer,
        top: 4,
        left: 1,
        right: summaryWidth + 2,
        bottom: 3,
        border: 'line',
        label: ' Host Destination ',
        style: {
          bg: THEME.panelAlt,
          fg: THEME.text,
          border: {
            fg: THEME.border,
          },
        },
      });

      const browserList = blessed.list({
        parent: browserPane,
        top: 1,
        left: 1,
        right: 1,
        bottom: 1,
        keys: false,
        mouse: false,
        tags: false,
        style: {
          bg: THEME.panelAlt,
          fg: THEME.text,
          selected: {
            bg: THEME.accent,
            fg: THEME.background,
            bold: true,
          },
          item: {
            bg: THEME.panelAlt,
            fg: THEME.text,
          },
        },
        scrollbar: {
          ch: ' ',
          style: {
            bg: THEME.accentMuted,
          },
        },
      });

      const summaryPane = blessed.box({
        parent: this.overlayContainer,
        top: 4,
        right: 1,
        width: summaryWidth,
        bottom: 3,
        border: 'line',
        label: ' Export Summary ',
        style: {
          bg: THEME.panelAlt,
          fg: THEME.text,
          border: {
            fg: THEME.border,
          },
        },
      });

      const summaryBox = blessed.box({
        parent: summaryPane,
        top: 1,
        left: 1,
        right: 1,
        bottom: 1,
        scrollable: true,
        alwaysScroll: true,
        mouse: false,
        style: {
          bg: THEME.panelAlt,
          fg: THEME.text,
        },
        scrollbar: {
          ch: ' ',
          style: {
            bg: THEME.accentMuted,
          },
        },
      });

      const footerBox = blessed.box({
        parent: this.overlayContainer,
        left: 2,
        right: 2,
        bottom: 1,
        height: 1,
        style: {
          bg: THEME.panelAlt,
          fg: THEME.muted,
        },
      });

      const getCurrentEntry = (): HostBrowserEntry | null =>
        snapshot.entries[selectedIndex] ?? null;

      const getVisibleEntries = () =>
        getVisibleWindow(snapshot.entries, selectedIndex, HOST_BROWSER_VISIBLE_ROWS);

      const getRowsSignature = (): string => {
        if (loading) {
          return 'loading';
        }

        if (snapshot.entries.length === 0) {
          return `empty:${snapshot.currentPath ?? 'root'}`;
        }

        const window = getVisibleEntries();
        return [snapshot.currentPath ?? 'root', window.start, window.end].join('::');
      };

      const close = (result: string | null): void => {
        if (settled) {
          return;
        }

        settled = true;
        this.closeOverlay();
        resolve(result);
      };

      const syncBrowserRows = (): void => {
        const rowsSignature = getRowsSignature();
        if (rowsSignature === renderedRowsSignature) {
          return;
        }

        renderedRowsSignature = rowsSignature;

        if (loading) {
          browserList.setItems(['Loading host filesystem...']);
          browserList.select(0);
          return;
        }

        if (snapshot.entries.length === 0) {
          browserList.setItems(['No folders or files here.']);
          browserList.select(0);
          return;
        }

        const visibleWindow = getVisibleEntries();
        browserList.setItems(
          visibleWindow.items.map((entry) =>
            this.formatHostNavigationRow(entry, this.getContentWidth(browserPane)),
          ),
        );
      };

      const syncBrowserSelection = (): void => {
        if (loading || snapshot.entries.length === 0) {
          browserList.select(0);
          return;
        }

        const visibleWindow = getVisibleEntries();
        browserList.select(
          clampIndex(selectedIndex - visibleWindow.start, visibleWindow.items.length),
        );
      };

      const getDestinationPath = (): string | null => {
        if (snapshot.currentPath !== null) {
          return snapshot.currentPath;
        }

        const currentEntry = getCurrentEntry();
        if (currentEntry?.kind === 'drive' && currentEntry.absolutePath !== null) {
          return currentEntry.absolutePath;
        }

        return null;
      };

      const renderBrowser = (): void => {
        const headerWidth = this.getContentWidth(this.overlayContainer) - 4;
        const currentEntry = getCurrentEntry();
        const visibleWindow = getVisibleEntries();
        const destinationPath = getDestinationPath();

        headerBox.setContent(
          [
            this.fitSingleLine(`Host ${snapshot.displayPath}`, headerWidth),
            this.fitSingleLine(`Export source ${sourcePath}`, headerWidth),
          ].join('\n'),
        );

        browserPane.setLabel(
          loading
            ? ' Host Destination  loading '
            : ` Host Destination  ${formatWindowSummary(
                visibleWindow.start,
                visibleWindow.end,
                snapshot.entries.length,
              )} `,
        );

        syncBrowserRows();
        syncBrowserSelection();

        summaryBox.setContent(
          [
            destinationPath
              ? `Destination: ${truncate(destinationPath, 220)}`
              : 'Destination: select a drive or folder',
            '',
            `Source: ${truncate(sourcePath, 220)}`,
            currentEntry ? `Highlighted: ${currentEntry.name}` : 'Highlighted: none',
            currentEntry ? `Type: ${currentEntry.kind}` : '',
            currentEntry?.absolutePath
              ? `Path: ${truncate(currentEntry.absolutePath, 220)}`
              : '',
            '',
            'Enter exports into the current folder.',
            'Right navigates inside the highlighted directory or drive.',
          ]
            .filter((line) => line.length > 0)
            .join('\n'),
        );

        footerBox.setContent(
          this.fitSingleLine(
            'Up/Down move   Right enter   Left back   Enter/E export here   Esc cancel',
            this.getContentWidth(this.overlayContainer) - 4,
          ),
        );

        this.screen.render();
      };

      const loadSnapshot = async (
        targetPath: string | null,
        preferredAbsolutePath: string | null = null,
      ): Promise<void> => {
        loading = true;
        renderBrowser();

        try {
          const nextSnapshot = await listHostBrowserSnapshot(targetPath);
          snapshot = nextSnapshot;
          renderedRowsSignature = '';

          const preferredIndex =
            preferredAbsolutePath === null
              ? -1
              : snapshot.entries.findIndex(
                  (entry) => entry.absolutePath === preferredAbsolutePath,
                );

          if (preferredIndex >= 0) {
            selectedIndex = preferredIndex;
          } else {
            selectedIndex = clampIndex(0, snapshot.entries.length);
          }
        } catch (error) {
          const message =
            error instanceof Error ? error.message : 'Unable to browse the host filesystem.';
          this.notify('error', message);
        } finally {
          loading = false;
          renderBrowser();
        }
      };

      const moveSelectionBy = (direction: number): void => {
        if (loading || snapshot.entries.length === 0) {
          return;
        }

        selectedIndex = clampIndex(selectedIndex + direction, snapshot.entries.length);
        syncBrowserSelection();
        renderBrowser();
      };

      const navigateIn = async (): Promise<void> => {
        if (loading) {
          return;
        }

        const currentEntry = getCurrentEntry();
        if (!currentEntry?.navigable) {
          return;
        }

        await loadSnapshot(currentEntry.absolutePath);
      };

      const navigateOut = async (): Promise<void> => {
        if (loading || snapshot.currentPath === null) {
          return;
        }

        const previousPath = snapshot.currentPath;
        const parentPath = getParentHostPath(snapshot.currentPath);
        if (parentPath === snapshot.currentPath) {
          return;
        }

        await loadSnapshot(parentPath, previousPath);
      };

      const confirmSelection = (): void => {
        const destinationPath = getDestinationPath();
        if (destinationPath === null) {
          this.notify('info', 'Enter a drive or folder before exporting.');
          renderBrowser();
          return;
        }

        close(destinationPath);
      };

      browserList.key(['up'], () => {
        moveSelectionBy(-1);
      });
      browserList.key(['down'], () => {
        moveSelectionBy(1);
      });
      browserList.key(['right'], () => {
        void navigateIn();
      });
      browserList.key(['left', 'backspace'], () => {
        void navigateOut();
      });
      browserList.key(['enter', 'e'], () => {
        confirmSelection();
      });
      browserList.key(['pageup'], () => {
        moveSelectionBy(-HOST_BROWSER_VISIBLE_ROWS);
      });
      browserList.key(['pagedown'], () => {
        moveSelectionBy(HOST_BROWSER_VISIBLE_ROWS);
      });
      browserList.key(['home'], () => {
        if (loading || snapshot.entries.length === 0) {
          return;
        }

        selectedIndex = 0;
        syncBrowserSelection();
        renderBrowser();
      });
      browserList.key(['end'], () => {
        if (loading || snapshot.entries.length === 0) {
          return;
        }

        selectedIndex = snapshot.entries.length - 1;
        syncBrowserSelection();
        renderBrowser();
      });
      browserList.key(['escape', 'q'], () => {
        close(null);
      });

      browserList.focus();
      renderBrowser();
      void loadSnapshot(initialHostPath);
    });
  }

  private async moveSelectedEntry(): Promise<void> {
    if (!this.currentVolumeId || !this.currentSnapshot) {
      return;
    }

    const selectedEntry = this.getSelectedEntry();
    if (!selectedEntry) {
      this.notify('info', 'Select an entry first.');
      return;
    }

    const destinationPath = await this.promptValue({
      title: 'Move / Rename',
      description: `Destination path for ${selectedEntry.name}`,
      initialValue: this.currentSnapshot.currentPath,
      footer: 'Enter saves. Esc cancels.',
    });

    if (destinationPath === null) {
      return;
    }

    const newName = await this.promptValue({
      title: 'Move / Rename',
      description: 'New name. Leave unchanged to keep the current entry name.',
      initialValue: selectedEntry.name,
      footer: 'Enter saves. Esc cancels.',
    });

    if (newName === null) {
      return;
    }

    const updatedPath = await this.runTask('Moving entry', () =>
      this.runtime.volumeService.moveEntry(this.currentVolumeId!, {
        sourcePath: selectedEntry.path,
        destinationDirectoryPath: destinationPath,
        newName,
      }),
    );

    if (!updatedPath) {
      return;
    }

    this.notify('success', `Entry moved to ${updatedPath}.`);
    await this.openVolume(
      this.currentVolumeId,
      this.currentSnapshot.currentPath,
      this.selectedEntryIndex,
    );
  }

  private async deleteSelectedEntry(): Promise<void> {
    if (!this.currentVolumeId || !this.currentSnapshot) {
      return;
    }

    const selectedEntry = this.getSelectedEntry();
    if (!selectedEntry) {
      this.notify('info', 'Select an entry first.');
      return;
    }

    const confirmed = await this.confirmAction({
      title: 'Delete Entry',
      body: `Delete "${selectedEntry.name}" and every nested node inside ${selectedEntry.path}?`,
      confirmLabel: 'Delete',
    });

    if (!confirmed) {
      return;
    }

    const deletedCount = await this.runTask('Deleting entry', () =>
      this.runtime.volumeService.deleteEntry(this.currentVolumeId!, selectedEntry.path),
    );

    if (deletedCount === null) {
      return;
    }

    this.notify('success', `Deleted ${deletedCount} entry nodes.`);
    await this.openVolume(
      this.currentVolumeId,
      this.currentSnapshot.currentPath,
      this.selectedEntryIndex,
    );
  }

  private async deleteSelectedVolume(): Promise<void> {
    const selectedVolume = this.volumes[this.selectedVolumeIndex] ?? null;
    if (!selectedVolume) {
      this.notify('info', 'No volume selected.');
      return;
    }

    const confirmed = await this.confirmAction({
      title: 'Delete Volume',
      body: `Delete volume "${selectedVolume.name}" and all persisted blobs and metadata?`,
      confirmLabel: 'Delete',
    });

    if (!confirmed) {
      return;
    }

    const deleted = await this.runTask('Deleting volume', async () => {
      await this.runtime.volumeService.deleteVolume(selectedVolume.id);
      return true;
    });

    if (!deleted) {
      return;
    }

    this.notify('success', `Volume "${selectedVolume.name}" deleted.`);
    this.currentVolumeId = null;
    this.currentSnapshot = null;
    this.mode = 'dashboard';
    await this.loadVolumes();
  }

  private async previewSelectedEntry(): Promise<void> {
    if (!this.currentVolumeId) {
      return;
    }

    const selectedEntry = this.getSelectedEntry();
    if (!selectedEntry) {
      this.notify('info', 'Select an entry first.');
      return;
    }

    if (selectedEntry.kind !== 'file') {
      this.notify('info', 'Preview is available for files only.');
      return;
    }

    const preview = await this.runTask('Loading preview', () =>
      this.runtime.volumeService.previewFile(this.currentVolumeId!, selectedEntry.path),
    );

    if (!preview) {
      return;
    }

    await this.openPreviewOverlay(preview);
  }

  private async openHelpOverlay(): Promise<void> {
    await this.openScrollableOverlay({
      title: 'Help',
      footer: 'Arrows/PageUp/PageDown scroll. Enter, Q or Esc closes.',
      content: [
        'Dashboard',
        '',
        'Up/Down: move selection',
        'Enter or O: open selected volume',
        'N: create volume',
        'X: delete volume',
        'R: refresh volumes',
        '? : help',
        'Q: quit',
        '',
        'Explorer',
        '',
        'Up/Down: move selection',
        'PageUp/PageDown: move by page',
        'Home/End: jump first or last entry',
        'Right or Enter: open directory or preview file',
        'Backspace, Left or B: parent directory or dashboard',
        'C: create folder',
        'I: open host browser import modal',
        'E: export selected file or folder to host',
        'M: move or rename entry',
        'D: delete entry',
        'P: preview file',
        'R: refresh current directory',
        '',
        'Host Import Modal',
        '',
        'Up/Down: move selection',
        'Right: enter selected folder or drive',
        'Left: parent folder',
        'Space: toggle checkbox on file or folder',
        'Enter or I: import all checked items',
        'A: toggle all visible entries',
        'Esc or Q: cancel',
        '',
        'Host Export Modal',
        '',
        'Up/Down: move selection',
        'Right: enter selected folder or drive',
        'Left: parent folder',
        'Enter or E: export into the current host folder',
        'Esc or Q: cancel',
      ].join('\n'),
    });
  }

  private async openPreviewOverlay(preview: FilePreview): Promise<void> {
    await this.openScrollableOverlay({
      title: `Preview  ${preview.path}`,
      footer: 'Arrows/PageUp/PageDown scroll. Enter, Q or Esc closes.',
      content: [
        `Kind: ${preview.kind.toUpperCase()}`,
        `Size: ${formatBytes(preview.size)}`,
        `Truncated: ${preview.truncated ? 'yes' : 'no'}`,
        '',
        preview.content,
      ].join('\n'),
    });
  }

  private async openScrollableOverlay(options: {
    title: string;
    content: string;
    footer: string;
  }): Promise<void> {
    await new Promise<void>((resolve) => {
      this.overlayMode = options.title.startsWith('Preview') ? 'preview' : 'help';
      this.overlayBackdrop.show();
      this.overlayContainer.setLabel(` ${options.title} `);
      this.overlayContainer.width = '78%';
      this.overlayContainer.height = '72%';
      this.overlayContainer.show();
      this.clearChildren(this.overlayContainer);

      const contentBox = blessed.box({
        parent: this.overlayContainer,
        top: 1,
        left: 1,
        right: 1,
        bottom: 2,
        scrollable: true,
        alwaysScroll: true,
        keys: true,
        vi: true,
        mouse: true,
        tags: false,
        content: options.content,
        style: {
          bg: THEME.panelAlt,
          fg: THEME.text,
        },
        scrollbar: {
          ch: ' ',
          style: {
            bg: THEME.accentMuted,
          },
        },
      });

      blessed.box({
        parent: this.overlayContainer,
        left: 1,
        right: 1,
        bottom: 0,
        height: 1,
        content: options.footer,
        style: {
          bg: THEME.panelAlt,
          fg: THEME.muted,
        },
      });

      const close = (): void => {
        this.closeOverlay();
        resolve();
      };

      contentBox.key(['escape', 'enter', 'q'], () => {
        close();
      });

      contentBox.focus();
      this.screen.render();
    });
  }

  private async confirmAction(options: {
    title: string;
    body: string;
    confirmLabel: string;
  }): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      let selectedButton: 'confirm' | 'cancel' = 'confirm';

      this.overlayMode = 'confirm';
      this.overlayBackdrop.show();
      this.overlayContainer.setLabel(` ${options.title} `);
      this.overlayContainer.width = '64%';
      this.overlayContainer.height = 11;
      this.overlayContainer.show();
      this.clearChildren(this.overlayContainer);

      blessed.box({
        parent: this.overlayContainer,
        top: 1,
        left: 2,
        right: 2,
        height: 4,
        content: options.body,
        style: {
          bg: THEME.panelAlt,
          fg: THEME.text,
        },
      });

      const buttonRow = blessed.box({
        parent: this.overlayContainer,
        bottom: 1,
        left: 2,
        right: 2,
        height: 2,
        keys: true,
        mouse: false,
        style: {
          bg: THEME.panelAlt,
          fg: THEME.text,
        },
      });

      const renderButtons = (): void => {
        const confirmText =
          selectedButton === 'confirm'
            ? `[ ${options.confirmLabel} ]`
            : `  ${options.confirmLabel}  `;
        const cancelText =
          selectedButton === 'cancel' ? '[ Cancel ]' : '  Cancel  ';

        buttonRow.setContent(
          `${confirmText}    ${cancelText}\nLeft/Right switch. Enter confirms. Y/N and Esc also work.`,
        );
      };

      const close = (value: boolean): void => {
        this.closeOverlay();
        resolve(value);
      };

      buttonRow.key(['left', 'right', 'tab', 'S-tab'], () => {
        selectedButton = selectedButton === 'confirm' ? 'cancel' : 'confirm';
        renderButtons();
        this.screen.render();
      });

      buttonRow.key(['y'], () => close(true));
      buttonRow.key(['n', 'escape'], () => close(false));
      buttonRow.key(['enter'], () => close(selectedButton === 'confirm'));

      renderButtons();
      buttonRow.focus();
      this.screen.render();
    });
  }

  private async promptValue(options: {
    title: string;
    description: string;
    initialValue: string;
    footer: string;
  }): Promise<string | null> {
    return new Promise<string | null>((resolve) => {
      let settled = false;

      this.overlayMode = 'input';
      this.overlayBackdrop.show();
      this.overlayContainer.setLabel(` ${options.title} `);
      this.overlayContainer.width = '68%';
      this.overlayContainer.height = 11;
      this.overlayContainer.show();
      this.clearChildren(this.overlayContainer);

      blessed.box({
        parent: this.overlayContainer,
        top: 1,
        left: 2,
        right: 2,
        height: 2,
        content: options.description,
        style: {
          bg: THEME.panelAlt,
          fg: THEME.text,
        },
      });

      const input = blessed.textbox({
        parent: this.overlayContainer,
        top: 4,
        left: 2,
        right: 2,
        height: 3,
        inputOnFocus: true,
        keys: true,
        mouse: true,
        border: 'line',
        style: {
          bg: '#0b1322',
          fg: THEME.text,
          border: {
            fg: THEME.accent,
          },
          focus: {
            border: {
              fg: THEME.warning,
            },
          },
        },
      });

      blessed.box({
        parent: this.overlayContainer,
        left: 2,
        right: 2,
        bottom: 0,
        height: 1,
        content: options.footer,
        style: {
          bg: THEME.panelAlt,
          fg: THEME.muted,
        },
      });

      input.setValue(options.initialValue);

      const finish = (value: string | null): void => {
        if (settled) {
          return;
        }

        settled = true;
        this.closeOverlay();
        resolve(value);
      };

      input.on('cancel', () => finish(null));
      input.on('submit', () => finish(input.getValue()));

      input.focus();
      this.screen.render();
      input.readInput((error, value) => {
        if (error) {
          finish(null);
          return;
        }

        finish(value ?? input.getValue());
      });
    });
  }

  private closeOverlay(): void {
    if (this.destroyed) {
      return;
    }

    this.overlayMode = null;
    this.overlayContainer.hide();
    this.overlayBackdrop.hide();
    this.clearChildren(this.overlayContainer);
    this.focusShell();
    this.screen.render();
  }

  private async runTask<T>(
    label: string,
    operation: () => Promise<T>,
  ): Promise<T | null> {
    this.busyLabel = label;
    this.lastBusyRefreshAt = 0;
    this.render();
    await this.flushUiFrame();

    try {
      return await operation();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unexpected error.';
      this.runtime.logger.error({ error, label }, 'Terminal operation failed.');
      this.notify('error', message);
      return null;
    } finally {
      this.busyLabel = null;
      this.render();
    }
  }

  private async flushUiFrame(): Promise<void> {
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
  }

  private notify(tone: ToastTone, message: string): void {
    if (this.destroyed) {
      return;
    }

    this.toast = { tone, message };

    if (this.toastTimeout) {
      clearTimeout(this.toastTimeout);
    }

    this.toastTimeout = setTimeout(() => {
      this.toast = null;
      this.render();
    }, 4500);

    this.render();
  }

  private updateBusyLabel(nextLabel: string): void {
    if (this.destroyed || !this.busyLabel) {
      return;
    }

    this.busyLabel = nextLabel;

    const now = Date.now();
    if (now - this.lastBusyRefreshAt < 80) {
      return;
    }

    this.lastBusyRefreshAt = now;
    this.renderStatus();
    this.screen.render();
  }

  private formatImportProgress(progress: ImportProgress): string {
    const currentTarget = path.basename(progress.currentHostPath) || progress.currentHostPath;
    const phaseLabel = progress.phase === 'directory' ? 'dir' : 'file';
    const transferDetail = this.formatTransferDetail(
      progress.currentBytes,
      progress.currentTotalBytes,
    );

    return `Importing ${progress.summary.filesImported} files / ${progress.summary.directoriesImported} dirs / ${formatBytes(progress.summary.bytesImported)}  Current ${phaseLabel}: ${currentTarget}${transferDetail}`;
  }

  private formatExportProgress(progress: ExportProgress): string {
    const currentTarget = path.basename(progress.currentVirtualPath) || progress.currentVirtualPath;
    const phaseLabel = progress.phase === 'directory' ? 'dir' : 'file';
    const transferDetail = this.formatTransferDetail(
      progress.currentBytes,
      progress.currentTotalBytes,
    );

    return `Exporting ${progress.summary.filesExported} files / ${progress.summary.directoriesExported} dirs / ${formatBytes(progress.summary.bytesExported)}  Current ${phaseLabel}: ${currentTarget}${transferDetail}`;
  }

  private formatTransferDetail(
    currentBytes: number,
    currentTotalBytes: number | null,
  ): string {
    if (currentTotalBytes === null || currentTotalBytes <= 0) {
      return '';
    }

    const percentage = Math.min(100, Math.max(0, Math.floor((currentBytes / currentTotalBytes) * 100)));
    return `  ${percentage}% ${formatBytes(currentBytes)} / ${formatBytes(currentTotalBytes)}`;
  }

  private focusShell(): void {
    if (this.destroyed || this.overlayMode) {
      return;
    }

    this.primaryList.focus();
  }

  private clearChildren(element: Widgets.BoxElement): void {
    while (element.children.length > 0) {
      element.children[0]?.detach();
    }
  }

  private fitSingleLine(value: string, width: number): string {
    const normalized = value.replace(/\s+/g, ' ').trim();
    return truncate(normalized, Math.max(1, width));
  }

  private getContentWidth(element: Widgets.BoxElement): number {
    return Math.max(20, this.getElementOuterWidth(element) - 4);
  }

  private getElementOuterWidth(
    element: Widgets.BoxElement,
  ): number {
    return this.resolveElementOuterWidth(
      element as unknown as LayoutElementSpec,
      this.getViewportWidth(),
    );
  }

  private resolveElementOuterWidth(
    element: LayoutElementSpec,
    fallbackParentWidth: number,
  ): number {
    const parentWidth = this.resolveParentWidth(element.parent, fallbackParentWidth);
    const width = element.position?.width;

    if (width !== undefined && width !== null) {
      return this.resolveLayoutValue(width, parentWidth, parentWidth);
    }

    const left = this.resolveLayoutValue(element.position?.left, parentWidth, 0);
    const right = this.resolveLayoutValue(element.position?.right, parentWidth, 0);
    return Math.max(0, parentWidth - left - right);
  }

  private resolveParentWidth(parent: unknown, fallbackWidth: number): number {
    if (!parent || typeof parent !== 'object') {
      return fallbackWidth;
    }

    const candidateParent = parent as LayoutElementSpec;

    if (!candidateParent.position) {
      return fallbackWidth;
    }

    return this.resolveElementOuterWidth(
      candidateParent,
      fallbackWidth,
    );
  }

  private resolveLayoutValue(
    size: number | string | undefined,
    parentWidth: number,
    fallbackValue: number,
  ): number {
    if (typeof size === 'number') {
      return size;
    }

    if (typeof size !== 'string') {
      return fallbackValue;
    }

    const trimmed = size.trim();
    if (trimmed.length === 0) {
      return fallbackValue;
    }

    if (trimmed === 'half') {
      return Math.floor(parentWidth * 0.5);
    }

    if (trimmed === 'center') {
      return 0;
    }

    const expressionParts = trimmed.split(/(?=[+-])/);
    const baseValue = expressionParts[0] ?? '';
    const deltaValue =
      expressionParts.length > 1
        ? Number.parseInt(expressionParts.slice(1).join(''), 10)
        : 0;
    const delta = Number.isNaN(deltaValue) ? 0 : deltaValue;

    if (baseValue.endsWith('%')) {
      const percentage = Number.parseFloat(baseValue.slice(0, -1));
      if (!Number.isNaN(percentage)) {
        return Math.floor(parentWidth * (percentage / 100)) + delta;
      }
    }

    const absolute = Number.parseInt(baseValue, 10);
    if (!Number.isNaN(absolute)) {
      return absolute + delta;
    }

    return fallbackValue;
  }

  private getViewportWidth(): number {
    return process.stdout.columns ?? 120;
  }

  private getViewportHeight(): number {
    return process.stdout.rows ?? 40;
  }

  private getSelectedEntry(): DirectoryListingItem | null {
    if (!this.currentSnapshot) {
      return null;
    }

    const relativeIndex = this.selectedEntryIndex - this.currentSnapshot.windowOffset;
    return relativeIndex >= 0 ? this.currentSnapshot.entries[relativeIndex] ?? null : null;
  }

  private formatVolumeRow(volume: VolumeManifest, availableWidth: number): string {
    const icon = ICONS.volume;
    const used = formatBytes(volume.logicalUsedBytes);
    const quota = formatBytes(volume.quotaBytes);
    const suffix = ` ${used} / ${quota}  `;
    const nameWidth = Math.max(12, Math.floor((availableWidth - 3) * 0.28));
    const descWidth = Math.max(12, availableWidth - suffix.length - nameWidth - 4);
    const name = truncate(volume.name, nameWidth).padEnd(nameWidth, ' ');
    const desc = truncate(volume.description || 'No description.', descWidth);

    return `${icon} ${name} ${used} / ${quota}  ${desc}`;
  }

  private formatEntryRow(entry: DirectoryListingItem, availableWidth: number): string {
    const icon = this.getVirtualEntryIcon(entry.kind);
    const size = entry.kind === 'file' ? formatBytes(entry.size) : 'directory';
    const updated = formatDateTime(entry.updatedAt);
    const suffix = `  ${truncate(size, 10)}  ${updated}`;
    const nameWidth = Math.max(14, availableWidth - suffix.length - 4);
    const name = truncate(entry.name, nameWidth).padEnd(nameWidth, ' ');
    const paddedSize = truncate(size, 10).padStart(10, ' ');

    return `${icon} ${name}  ${paddedSize}  ${updated}`;
  }

  private formatHostBrowserRow(
    entry: HostBrowserEntry,
    isSelected: boolean,
    availableWidth: number,
  ): string {
    const checkbox = entry.selectable
      ? isSelected
        ? ICONS.checkboxOn
        : ICONS.checkboxOff
      : ' ';

    return this.fitSingleLine(
      `${checkbox} ${this.getHostEntryIcon(entry)} ${entry.name}`,
      availableWidth,
    );
  }

  private formatHostNavigationRow(
    entry: HostBrowserEntry,
    availableWidth: number,
  ): string {
    return this.fitSingleLine(
      `${this.getHostEntryIcon(entry)} ${entry.name}`,
      availableWidth,
    );
  }

  private getVirtualEntryIcon(kind: DirectoryListingItem['kind']): string {
    return kind === 'directory' ? ICONS.folder : ICONS.file;
  }

  private getHostEntryIcon(entry: HostBrowserEntry): string {
    switch (entry.kind) {
      case 'drive':
        return ICONS.drive;
      case 'directory':
        return ICONS.folder;
      case 'file':
        return ICONS.file;
      case 'parent':
        return ICONS.parent;
      default:
        return ICONS.file;
    }
  }

  private shutdown(): void {
    if (this.destroyed) {
      return;
    }

    this.destroyed = true;

    if (this.toastTimeout) {
      clearTimeout(this.toastTimeout);
      this.toastTimeout = null;
    }

    clearInterval(this.spinnerInterval);
    this.screen.destroy();
    this.resolveExit?.();
  }
}
