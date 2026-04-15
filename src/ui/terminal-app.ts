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
import {
  buildCreateFolderPrompt,
  buildCreateFolderSuccessMessage,
  buildCreateVolumePrompts,
  buildCreateVolumeSuccessMessage,
  buildDeleteEntryConfirmation,
  buildDeleteEntrySuccessMessage,
  buildDeleteVolumeConfirmation,
  buildDeleteVolumeSuccessMessage,
  buildExportSuccessNotification,
  buildExportTaskDetail,
  buildHelpOverlayOptions,
  buildImportEmptySelectionMessage,
  buildImportSuccessNotification,
  buildImportTaskDetail,
  buildMoveEntryPrompts,
  buildMoveEntrySuccessMessage,
  buildPreviewOverlayOptions,
  parseVolumeQuotaInput,
} from './action-presenters.js';
import type { HostBrowserEntry, HostBrowserSnapshot } from './host-browser.js';
import {
  buildConfirmOverlayView,
  buildPromptOverlayView,
  buildScrollableOverlayView,
  resolvePromptValue,
  toggleConfirmButton,
} from './dialog-overlay.js';
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
} from './host-browser-overlay.js';
import {
  getDefaultHostPath,
  getParentHostPath,
  listHostBrowserSnapshot,
} from './host-browser.js';
import { buildStatusPanel, getStatusContextLine } from './status-panel.js';
import {
  fitSingleLine as fitSingleLineText,
  formatExportProgress as formatExportProgressText,
  formatImportProgress as formatImportProgressText,
} from './presenters.js';
import {
  getContentWidth as getLayoutContentWidth,
  resolveElementOuterWidth as resolveLayoutOuterWidth,
} from './layout.js';
import {
  buildHeaderPanelContent,
  buildInspectorPanelContent,
  buildPrimaryPanelView,
  buildShortcutsPanelContent,
} from './shell-panels.js';
import {
  buildExplorerOpenRequest,
  canHandleShellNavigation,
  clampExplorerSelection,
  clampVolumeSelection,
  getGoBackNavigationAction,
  getOpenSelectedEntryAction,
  getRefreshExplorerRequest,
  getSelectedExplorerEntry,
  getSelectedVolume,
  jumpDashboardSelection,
  jumpExplorerSelection,
  moveDashboardSelection,
  moveExplorerSelection,
  pageDashboardSelection,
  pageExplorerSelection,
} from './shell-navigation.js';

type ScreenMode = 'dashboard' | 'explorer';
type ToastTone = 'success' | 'error' | 'info';
type OverlayMode = 'help' | 'preview' | 'confirm' | 'input' | 'hostBrowser' | null;

interface ToastState {
  tone: ToastTone;
  message: string;
  detail?: string;
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

interface MutableBorderStyle {
  fg?: string;
}

interface MutableListStyle {
  bg?: string;
  fg?: string;
}

interface MutableSelectedStyle extends MutableListStyle {
  bold?: boolean;
}

interface MutableElementStyle {
  bg?: string;
  fg?: string;
  border?: MutableBorderStyle;
  item?: MutableListStyle;
  selected?: MutableSelectedStyle;
}

interface ThemePalette {
  background: string;
  headerDashboard: string;
  headerExplorer: string;
  panelNavigation: string;
  panelInspector: string;
  panelShortcuts: string;
  panelOverlay: string;
  panelOverlayAlt: string;
  borderNavigation: string;
  borderInspector: string;
  borderShortcuts: string;
  borderOverlay: string;
  borderOverlayAlt: string;
  borderStatus: string;
  accent: string;
  accentSecondary: string;
  accentWarm: string;
  accentMuted: string;
  text: string;
  muted: string;
  info: string;
  infoBg: string;
  success: string;
  successBg: string;
  warning: string;
  warningBg: string;
  danger: string;
  dangerBg: string;
  statusIdleBg: string;
  statusBusyBg: string;
  input: string;
}

const THEME: ThemePalette = {
  background: 'black',
  headerDashboard: 'black',
  headerExplorer: 'black',
  panelNavigation: 'black',
  panelInspector: 'black',
  panelShortcuts: 'black',
  panelOverlay: 'black',
  panelOverlayAlt: 'black',
  borderNavigation: '#3b82f6',
  borderInspector: '#2dd4bf',
  borderShortcuts: '#f59e0b',
  borderOverlay: '#60a5fa',
  borderOverlayAlt: '#34d399',
  borderStatus: '#64748b',
  accent: '#2dd4bf',
  accentSecondary: '#60a5fa',
  accentWarm: '#f59e0b',
  accentMuted: '#14b8a6',
  text: '#f3f4f6',
  muted: '#94a3b8',
  info: '#38bdf8',
  infoBg: 'black',
  success: '#34d399',
  successBg: 'black',
  warning: '#fbbf24',
  warningBg: 'black',
  danger: '#fb7185',
  dangerBg: 'black',
  statusIdleBg: 'black',
  statusBusyBg: 'black',
  input: 'black',
};

const SPINNER_FRAMES = ['|', '/', '-', '\\'];
// Legacy icon table retained while terminal-app extraction is still in progress.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
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
      bg: THEME.panelNavigation,
      fg: THEME.text,
      border: {
        fg: THEME.borderNavigation,
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

  private busyDetail: string | null = 'Initializing terminal shell.';

  private busyProgressCurrent: number | null = null;

  private busyProgressTotal: number | null = null;

  private busyStartedAt = Date.now();

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
        bg: THEME.headerDashboard,
        fg: THEME.accentSecondary,
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
      bottom: 4,
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
        bg: THEME.panelNavigation,
        fg: THEME.text,
        selected: {
          bg: THEME.accentSecondary,
          fg: '#020617',
          bold: true,
        },
        item: {
          fg: THEME.text,
          bg: THEME.panelNavigation,
        },
      },
      scrollbar: {
        ch: ' ',
        style: {
          bg: THEME.borderNavigation,
        },
      },
    });

    this.rightPane = createPanel(this.screen, {
      top: 3,
      left: '62%',
      width: '38%',
      bottom: 13,
      label: ' Inspector ',
      style: {
        bg: THEME.panelInspector,
        fg: THEME.text,
        border: {
          fg: THEME.borderInspector,
        },
      },
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
        bg: THEME.panelInspector,
        fg: THEME.text,
      },
      scrollbar: {
        ch: ' ',
        style: {
          bg: THEME.borderInspector,
        },
      },
    });

    this.shortcutsBox = createPanel(this.screen, {
      height: 9,
      bottom: 4,
      left: '62%',
      width: '38%',
      label: ' Keyboard ',
      style: {
        bg: THEME.panelShortcuts,
        fg: THEME.text,
        border: {
          fg: THEME.borderShortcuts,
        },
      },
    });

    this.statusBox = createPanel(this.screen, {
      height: 4,
      bottom: 0,
      left: 0,
      width: '100%',
      label: ' Status ',
      style: {
        bg: THEME.statusIdleBg,
        fg: THEME.text,
        border: {
          fg: THEME.borderStatus,
        },
      },
    });

    this.overlayBackdrop = blessed.box({
      parent: this.screen,
      top: 0,
      left: 0,
      width: '100%',
      height: '100%',
      hidden: true,
      style: {
        bg: THEME.background,
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
        bg: THEME.panelOverlay,
        fg: THEME.text,
        border: {
          fg: THEME.borderOverlay,
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
    return canHandleShellNavigation({
      busy: this.busyLabel !== null,
      currentSnapshot: this.currentSnapshot,
      mode: this.mode,
      overlayOpen: this.overlayMode !== null,
      volumesLength: this.volumes.length,
    });
  }

  private render(): void {
    if (this.destroyed) {
      return;
    }

    this.applyShellTheme();
    this.renderHeader();
    this.renderPrimaryPane();
    this.renderInspector();
    this.renderShortcuts();
    this.renderStatus();
    this.screen.render();
  }

  private applyShellTheme(): void {
    const isDashboard = this.mode === 'dashboard';
    const navigationBorder = isDashboard ? THEME.borderNavigation : THEME.accent;
    const navigationSelection = isDashboard ? THEME.accentSecondary : THEME.accent;
    const navigationPanel = THEME.panelNavigation;
    this.setElementColors(this.headerBox, {
      bg: isDashboard ? THEME.headerDashboard : THEME.headerExplorer,
      fg: isDashboard ? THEME.accentSecondary : THEME.accentWarm,
    });
    this.setElementColors(this.leftPane, {
      bg: navigationPanel,
      borderFg: navigationBorder,
    });
    this.setListColors(this.primaryList, {
      bg: navigationPanel,
      itemBg: navigationPanel,
      itemFg: THEME.text,
      selectedBg: navigationSelection,
      selectedFg: '#020617',
      selectedBold: true,
    });

    this.setElementColors(this.rightPane, {
      bg: THEME.panelInspector,
      borderFg: isDashboard ? THEME.borderInspector : THEME.accentSecondary,
    });
    this.setElementColors(this.inspectorBox, {
      bg: THEME.panelInspector,
      fg: isDashboard ? THEME.text : '#dbeafe',
    });

    this.setElementColors(this.shortcutsBox, {
      bg: THEME.panelShortcuts,
      fg: '#fef3c7',
      borderFg: isDashboard ? THEME.borderShortcuts : THEME.accentWarm,
    });

    this.setElementColors(this.overlayContainer, {
      bg: THEME.panelOverlay,
      borderFg: THEME.borderOverlay,
    });
  }

  private renderHeader(): void {
    this.headerBox.setContent(
      buildHeaderPanelContent({
        currentSnapshot: this.currentSnapshot,
        dataDir: this.runtime.config.dataDir,
        headerWidth: this.getContentWidth(this.headerBox),
        mode: this.mode,
      }),
    );
  }

  private renderPrimaryPane(): void {
    const view = buildPrimaryPanelView({
      currentSnapshot: this.currentSnapshot,
      leftPaneWidth: this.getContentWidth(this.leftPane),
      mode: this.mode,
      selectedEntryIndex: this.selectedEntryIndex,
      selectedVolumeIndex: this.selectedVolumeIndex,
      volumes: this.volumes,
    });

    this.leftPane.setLabel(view.label);
    this.primaryList.setItems(view.items);
    this.primaryList.select(view.selectedIndex);
  }

  private renderInspector(): void {
    this.inspectorBox.setContent(
      buildInspectorPanelContent({
        currentSnapshot: this.currentSnapshot,
        dataDir: this.runtime.config.dataDir,
        logDir: this.runtime.config.logDir,
        mode: this.mode,
        selectedEntry: this.getSelectedEntry(),
        selectedVolumeIndex: this.selectedVolumeIndex,
        volumes: this.volumes,
      }),
    );
  }

  private renderShortcuts(): void {
    this.shortcutsBox.setContent(
      buildShortcutsPanelContent({
        mode: this.mode,
        width: this.getContentWidth(this.shortcutsBox),
      }),
    );
  }

  private renderStatus(): void {
    const availableWidth = this.getContentWidth(this.statusBox);
    const rendered = buildStatusPanel({
      availableWidth,
      mode: this.mode,
      volumes: this.volumes,
      selectedVolumeIndex: this.selectedVolumeIndex,
      currentSnapshot: this.currentSnapshot,
      selectedEntry: this.getSelectedEntry(),
      logDir: this.runtime.config.logDir,
      busyLabel: this.busyLabel,
      busyDetail: this.busyDetail,
      busyProgressCurrent: this.busyProgressCurrent,
      busyProgressTotal: this.busyProgressTotal,
      elapsedMs: Date.now() - this.busyStartedAt,
      spinnerIndex: this.spinnerIndex,
      spinnerFrames: SPINNER_FRAMES,
      toast: this.toast,
    });

    this.applyStatusTheme(rendered.state);
    this.statusBox.setLabel(rendered.label);
    this.statusBox.setContent(rendered.lines.join('\n'));
  }

  private applyStatusTheme(state: ToastTone | 'busy' | 'idle'): void {
    switch (state) {
      case 'busy':
        this.setElementColors(this.statusBox, {
          bg: THEME.statusBusyBg,
          fg: THEME.text,
          borderFg: THEME.info,
        });
        return;
      case 'success':
        this.setElementColors(this.statusBox, {
          bg: THEME.successBg,
          fg: THEME.text,
          borderFg: THEME.success,
        });
        return;
      case 'error':
        this.setElementColors(this.statusBox, {
          bg: THEME.dangerBg,
          fg: THEME.text,
          borderFg: THEME.danger,
        });
        return;
      case 'info':
        this.setElementColors(this.statusBox, {
          bg: THEME.infoBg,
          fg: THEME.text,
          borderFg: THEME.info,
        });
        return;
      default:
        this.setElementColors(this.statusBox, {
          bg: THEME.statusIdleBg,
          fg: THEME.text,
          borderFg: THEME.borderStatus,
        });
    }
  }

  private async moveSelection(direction: -1 | 1): Promise<void> {
    if (this.mode === 'dashboard') {
      this.selectedVolumeIndex = moveDashboardSelection(
        this.selectedVolumeIndex,
        this.volumes.length,
        direction,
      );
      this.render();
      return;
    }

    const selectionChange = moveExplorerSelection(
      this.currentVolumeId,
      this.currentSnapshot,
      this.selectedEntryIndex,
      direction,
    );

    switch (selectionChange.kind) {
      case 'local':
        this.selectedEntryIndex = selectionChange.selectedEntryIndex;
        this.render();
        return;
      case 'open':
        await this.openVolume(
          selectionChange.request.volumeId,
          selectionChange.request.targetPath,
          selectionChange.request.selectionIndex,
        );
        return;
      default:
        return;
    }
  }

  private async moveByPage(direction: -1 | 1): Promise<void> {
    if (this.mode === 'dashboard') {
      this.selectedVolumeIndex = pageDashboardSelection(
        this.selectedVolumeIndex,
        this.volumes.length,
        direction,
      );
      this.render();
      return;
    }

    const request = pageExplorerSelection(
      this.currentVolumeId,
      this.currentSnapshot,
      this.selectedEntryIndex,
      direction,
    );
    if (!request) {
      return;
    }

    await this.openVolume(request.volumeId, request.targetPath, request.selectionIndex);
  }

  private async jumpSelection(target: 'start' | 'end'): Promise<void> {
    if (this.mode === 'dashboard') {
      this.selectedVolumeIndex = jumpDashboardSelection(this.volumes.length, target);
      this.render();
      return;
    }

    const request = jumpExplorerSelection(this.currentVolumeId, this.currentSnapshot, target);
    if (!request) {
      return;
    }

    await this.openVolume(request.volumeId, request.targetPath, request.selectionIndex);
  }

  private async loadVolumes(): Promise<void> {
    const volumes = await this.runTask('Loading volumes', () =>
      this.runtime.volumeService.listVolumes(),
    );

    if (!volumes) {
      return;
    }

    this.volumes = volumes;
    this.selectedVolumeIndex = clampVolumeSelection(this.selectedVolumeIndex, this.volumes.length);
    this.focusShell();
    this.render();
  }

  private async openVolume(
    volumeId: string,
    targetPath = '/',
    selectionIndex = 0,
  ): Promise<void> {
    const request = buildExplorerOpenRequest(volumeId, targetPath, selectionIndex);
    const snapshot = await this.runTask('Opening volume', () =>
      this.runtime.volumeService.getExplorerSnapshot(request.volumeId, request.targetPath, {
        offset: request.offset,
        limit: request.limit,
      }),
    );

    if (!snapshot) {
      return;
    }

    this.mode = 'explorer';
    this.currentVolumeId = request.volumeId;
    this.currentSnapshot = snapshot;
    this.selectedEntryIndex = clampExplorerSelection(request.selectionIndex, snapshot);
    this.focusShell();
    this.render();
  }

  private async refreshCurrentScreen(): Promise<void> {
    if (this.mode === 'dashboard') {
      await this.loadVolumes();
      return;
    }

    const request = getRefreshExplorerRequest(
      this.currentVolumeId,
      this.currentSnapshot,
      this.selectedEntryIndex,
    );
    if (!request) {
      return;
    }

    await this.openVolume(request.volumeId, request.targetPath, request.selectionIndex);
  }

  private async openSelectedVolume(): Promise<void> {
    const selectedVolume = getSelectedVolume(this.volumes, this.selectedVolumeIndex);
    if (!selectedVolume) {
      this.notify('info', 'Create a volume first.');
      return;
    }

    await this.openVolume(selectedVolume.id);
  }

  private async openSelectedEntry(): Promise<void> {
    const action = getOpenSelectedEntryAction(this.currentVolumeId, this.getSelectedEntry());
    switch (action.kind) {
      case 'notify':
        this.notify('info', action.message);
        return;
      case 'open':
        await this.openVolume(
          action.request.volumeId,
          action.request.targetPath,
          action.request.selectionIndex,
        );
        return;
      default:
        await this.previewSelectedEntry();
    }
  }

  private async goBack(): Promise<void> {
    const action = getGoBackNavigationAction({
      currentSnapshot: this.currentSnapshot,
      currentVolumeId: this.currentVolumeId,
      mode: this.mode,
    });

    switch (action.kind) {
      case 'dashboard':
        await this.goToDashboard();
        return;
      case 'open':
        await this.openVolume(
          action.request.volumeId,
          action.request.targetPath,
          action.request.selectionIndex,
        );
        return;
      default:
        return;
    }
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
    const prompts = buildCreateVolumePrompts(this.runtime.config.defaultQuotaBytes);
    const name = await this.promptValue(prompts.name);

    if (name === null) {
      return;
    }

    const quotaInput = await this.promptValue(prompts.quota);

    if (quotaInput === null) {
      return;
    }

    const parsedQuota = parseVolumeQuotaInput(quotaInput);
    if (parsedQuota.error) {
      this.notify('error', parsedQuota.error);
      return;
    }

    const description = await this.promptValue(prompts.description);

    if (description === null) {
      return;
    }

    const createdVolume = await this.runTask('Creating volume', () =>
      this.runtime.volumeService.createVolume({
        name,
        quotaBytes: parsedQuota.quotaBytes,
        description,
      }),
    );

    if (!createdVolume) {
      return;
    }

    this.notify('success', buildCreateVolumeSuccessMessage(createdVolume.name));
    await this.loadVolumes();
    const volumeIndex = this.volumes.findIndex((volume) => volume.id === createdVolume.id);
    this.selectedVolumeIndex = clampVolumeSelection(volumeIndex, this.volumes.length);
    this.render();
  }

  private async createFolderWizard(): Promise<void> {
    if (!this.currentVolumeId || !this.currentSnapshot) {
      return;
    }

    const name = await this.promptValue(
      buildCreateFolderPrompt(this.currentSnapshot.currentPath),
    );

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

    this.notify('success', buildCreateFolderSuccessMessage(createdDirectory.name));
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
      this.notify('info', buildImportEmptySelectionMessage());
      return;
    }

    const summary = await this.runTask('Importing host paths', () =>
      this.runtime.volumeService.importHostPaths(this.currentVolumeId!, {
        hostPaths,
        destinationPath,
        onProgress: (progress) => {
          this.updateBusyState({
            detail: this.formatImportProgress(progress),
            currentValue: progress.currentBytes,
            totalValue: progress.currentTotalBytes,
          });
        },
      }),
      buildImportTaskDetail(destinationPath, hostPaths.length),
    );

    if (!summary) {
      return;
    }

    const success = buildImportSuccessNotification(summary, destinationPath);
    this.notify('success', success.message, success.detail);
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
          this.updateBusyState({
            detail: this.formatExportProgress(progress),
            currentValue: progress.currentBytes,
            totalValue: progress.currentTotalBytes,
          });
        },
      }),
      buildExportTaskDetail(selectedEntry.path, destinationHostDirectory),
    );

    if (!summary) {
      return;
    }

    const success = buildExportSuccessNotification(summary, destinationHostDirectory);
    this.notify('success', success.message, success.detail);
    this.render();
  }

  private async openHostImportOverlay(destinationPath: string): Promise<string[] | null> {
    const result = await this.openHostBrowserOverlay({
      mode: 'import',
      destinationPath,
    });

    return Array.isArray(result) ? result : null;
  }

  private async openHostExportOverlay(sourcePath: string): Promise<string | null> {
    const result = await this.openHostBrowserOverlay({
      mode: 'export',
      sourcePath,
    });

    return typeof result === 'string' || result === null ? result : null;
  }

  private async openHostBrowserOverlay(
    options:
      | { mode: 'import'; destinationPath: string }
      | { mode: 'export'; sourcePath: string },
  ): Promise<string[] | string | null> {
    const initialHostPath = await getDefaultHostPath();
    const modeConfig = getHostBrowserModeConfig(options.mode);
    const isImportMode = options.mode === 'import';
    const browserAccent = isImportMode ? THEME.success : THEME.accentWarm;
    const browserBorder = isImportMode ? THEME.borderOverlayAlt : THEME.accentWarm;
    const browserSelectedFg = isImportMode ? '#081a14' : '#201106';

    return new Promise<string[] | string | null>((resolve) => {
      const viewportWidth = this.getViewportWidth();
      const viewportHeight = this.getViewportHeight();
      const { overlayWidth, overlayHeight, summaryWidth } = getHostOverlayDimensions(
        viewportWidth,
        viewportHeight,
        options.mode,
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
      let selectedPaths = new Set<string>();

      this.overlayMode = 'hostBrowser';
      this.overlayBackdrop.show();
      this.overlayContainer.setLabel(modeConfig.containerLabel);
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
          bg: THEME.panelOverlayAlt,
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
        label: modeConfig.browserPaneLabel,
        style: {
          bg: THEME.panelOverlayAlt,
          fg: THEME.text,
          border: {
            fg: browserBorder,
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
          bg: THEME.panelOverlayAlt,
          fg: THEME.text,
          selected: {
            bg: browserAccent,
            fg: browserSelectedFg,
            bold: true,
          },
          item: {
            bg: THEME.panelOverlayAlt,
            fg: THEME.text,
          },
        },
        scrollbar: {
          ch: ' ',
          style: {
            bg: browserAccent,
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
        label: modeConfig.summaryPaneLabel,
        style: {
          bg: THEME.panelOverlayAlt,
          fg: THEME.text,
          border: {
            fg: browserBorder,
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
          bg: THEME.panelOverlayAlt,
          fg: THEME.text,
        },
        scrollbar: {
          ch: ' ',
          style: {
            bg: browserAccent,
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
          bg: THEME.panelOverlayAlt,
          fg: THEME.muted,
        },
      });

      const getCurrentEntry = (): HostBrowserEntry | null =>
        snapshot.entries[selectedIndex] ?? null;

      const close = (result: string[] | string | null): void => {
        if (settled) {
          return;
        }

        settled = true;
        this.closeOverlay();
        resolve(result);
      };

      const renderBrowser = (): void => {
        const contentWidth = this.getContentWidth(this.overlayContainer) - 4;
        const rowsSignature = getHostRowsSignature({
          loading,
          selectedIndex,
          selectedPaths: isImportMode ? selectedPaths : undefined,
          snapshot,
        });
        const view = isImportMode
          ? buildHostImportOverlayView({
              browserContentWidth: this.getContentWidth(browserPane),
              destinationPath: options.destinationPath,
              headerWidth: contentWidth,
              loading,
              overlayContentWidth: contentWidth,
              selectedIndex,
              selectedPaths,
              snapshot,
            })
          : buildHostExportOverlayView({
              browserContentWidth: this.getContentWidth(browserPane),
              headerWidth: contentWidth,
              loading,
              overlayContentWidth: contentWidth,
              selectedIndex,
              snapshot,
              sourcePath: options.sourcePath,
            });

        headerBox.setContent(view.headerContent);
        browserPane.setLabel(view.browserLabel);

        if (rowsSignature !== renderedRowsSignature) {
          renderedRowsSignature = rowsSignature;
          browserList.setItems(view.browserItems);
        }

        browserList.select(view.browserSelectionIndex);
        summaryBox.setContent(view.summaryContent);
        footerBox.setContent(view.footerContent);

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
          selectedIndex = getPreferredHostSelectionIndex(snapshot, preferredAbsolutePath);
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

        selectedIndex = moveHostSelection(selectedIndex, snapshot.entries.length, direction);
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

        if (isImportMode && currentEntry.selectable && currentEntry.absolutePath !== null) {
          selectedPaths = toggleHostSelection(selectedPaths, currentEntry);
          renderedRowsSignature = '';
          renderBrowser();
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

      const confirmSelection = (): void => {
        if (isImportMode) {
          if (selectedPaths.size === 0) {
            this.notify('info', modeConfig.emptySelectionMessage ?? 'Nothing selected.');
            renderBrowser();
            return;
          }

          close(Array.from(selectedPaths));
          return;
        }

        const destinationPath = getExportDestinationPath(snapshot, getCurrentEntry());
        if (destinationPath === null) {
          this.notify('info', modeConfig.emptySelectionMessage ?? 'Select a destination.');
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
      if (isImportMode) {
        browserList.key(['enter', 'i'], () => {
          confirmSelection();
        });
        browserList.key(['space'], () => {
          selectedPaths = toggleHostSelection(selectedPaths, getCurrentEntry());
          renderedRowsSignature = '';
          renderBrowser();
        });
        browserList.key(['a'], () => {
          const visibleEntries = getHostVisibleEntries(snapshot, selectedIndex).items;
          if (visibleEntries.length === 0) {
            return;
          }

          selectedPaths = toggleVisibleHostSelections(selectedPaths, visibleEntries);
          renderedRowsSignature = '';
          renderBrowser();
        });
      } else {
        browserList.key(['enter', 'e'], () => {
          confirmSelection();
        });
      }
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

        selectedIndex = jumpHostSelection('start', snapshot.entries.length);
        renderBrowser();
      });
      browserList.key(['end'], () => {
        if (loading || snapshot.entries.length === 0) {
          return;
        }

        selectedIndex = jumpHostSelection('end', snapshot.entries.length);
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

    const movePrompts = buildMoveEntryPrompts(
      selectedEntry.name,
      this.currentSnapshot.currentPath,
    );
    const destinationPath = await this.promptValue(movePrompts.destination);

    if (destinationPath === null) {
      return;
    }

    const newName = await this.promptValue(movePrompts.rename);

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

    this.notify('success', buildMoveEntrySuccessMessage(updatedPath));
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

    const confirmed = await this.confirmAction(buildDeleteEntryConfirmation(selectedEntry));

    if (!confirmed) {
      return;
    }

    const deletedCount = await this.runTask('Deleting entry', () =>
      this.runtime.volumeService.deleteEntry(this.currentVolumeId!, selectedEntry.path),
    );

    if (deletedCount === null) {
      return;
    }

    this.notify('success', buildDeleteEntrySuccessMessage(deletedCount));
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

    const confirmed = await this.confirmAction(
      buildDeleteVolumeConfirmation(selectedVolume),
    );

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

    this.notify('success', buildDeleteVolumeSuccessMessage(selectedVolume.name));
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
    await this.openScrollableOverlay(buildHelpOverlayOptions());
  }

  private async openPreviewOverlay(preview: FilePreview): Promise<void> {
    await this.openScrollableOverlay(buildPreviewOverlayOptions(preview));
  }

  private async openScrollableOverlay(options: {
    title: string;
    content: string;
    footer: string;
  }): Promise<void> {
    await new Promise<void>((resolve) => {
      const view = buildScrollableOverlayView(options);

      this.overlayMode = view.mode;
      this.overlayBackdrop.show();
      this.overlayContainer.setLabel(` ${view.title} `);
      this.overlayContainer.width = view.width;
      this.overlayContainer.height = view.height;
      this.setElementColors(this.overlayContainer, {
        bg: THEME.panelOverlay,
        borderFg: view.borderTone === 'accentSecondary' ? THEME.accentSecondary : THEME.info,
      });
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
        content: view.content,
        style: {
          bg: THEME.panelOverlayAlt,
          fg: THEME.text,
        },
        scrollbar: {
          ch: ' ',
          style: {
            bg: view.borderTone === 'accentSecondary' ? THEME.accentSecondary : THEME.info,
          },
        },
      });

      blessed.box({
        parent: this.overlayContainer,
        left: 1,
        right: 1,
        bottom: 0,
        height: 1,
        content: view.footer,
        style: {
          bg: THEME.panelOverlayAlt,
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
      const applyConfirmView = (): void => {
        const view = buildConfirmOverlayView(options, selectedButton);

        this.overlayContainer.setLabel(` ${view.title} `);
        this.overlayContainer.width = view.width;
        this.overlayContainer.height = view.height;
        this.setElementColors(this.overlayContainer, {
          bg: THEME.panelOverlay,
          borderFg: view.borderTone === 'danger' ? THEME.danger : THEME.warning,
        });
        buttonRow.setContent(view.buttonContent);
      };

      this.overlayMode = 'confirm';
      this.overlayBackdrop.show();
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
          bg: THEME.panelOverlayAlt,
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
          bg: THEME.panelOverlayAlt,
          fg: THEME.text,
        },
      });

      const close = (value: boolean): void => {
        this.closeOverlay();
        resolve(value);
      };

      buttonRow.key(['left', 'right', 'tab', 'S-tab'], () => {
        selectedButton = toggleConfirmButton(selectedButton);
        applyConfirmView();
        this.screen.render();
      });

      buttonRow.key(['y'], () => close(true));
      buttonRow.key(['n', 'escape'], () => close(false));
      buttonRow.key(['enter'], () => close(selectedButton === 'confirm'));

      applyConfirmView();
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
      const view = buildPromptOverlayView(options);

      this.overlayMode = view.mode;
      this.overlayBackdrop.show();
      this.overlayContainer.setLabel(` ${view.title} `);
      this.overlayContainer.width = view.width;
      this.overlayContainer.height = view.height;
      this.setElementColors(this.overlayContainer, {
        bg: THEME.panelOverlay,
        borderFg: THEME.accentWarm,
      });
      this.overlayContainer.show();
      this.clearChildren(this.overlayContainer);

      blessed.box({
        parent: this.overlayContainer,
        top: 1,
        left: 2,
        right: 2,
        height: 2,
        content: view.description,
        style: {
          bg: THEME.panelOverlayAlt,
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
          bg: THEME.input,
          fg: THEME.text,
          border: {
            fg: THEME.accentWarm,
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
        content: view.footer,
        style: {
          bg: THEME.panelOverlayAlt,
          fg: THEME.muted,
        },
      });

      input.setValue(view.initialValue);

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

        finish(resolvePromptValue(value, input.getValue()));
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
    detail?: string,
  ): Promise<T | null> {
    this.startBusyState(label, detail);
    this.render();
    await this.flushUiFrame();

    try {
      const result = await operation();
      this.finishBusyState();
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unexpected error.';
      this.runtime.logger.error({ error, label }, 'Terminal operation failed.');
      this.finishBusyState();
      this.notify('error', message, `Operation failed: ${label}. ${this.buildStatusContextLine(true)}`);
      return null;
    }
  }

  private async flushUiFrame(): Promise<void> {
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
  }

  private notify(tone: ToastTone, message: string, detail?: string): void {
    if (this.destroyed) {
      return;
    }

    this.toast = {
      tone,
      message,
      detail,
    };

    if (this.toastTimeout) {
      clearTimeout(this.toastTimeout);
    }

    this.toastTimeout = setTimeout(() => {
      this.toast = null;
      this.render();
    }, 4500);

    this.render();
  }

  private startBusyState(label: string, detail?: string): void {
    this.busyLabel = label;
    this.busyDetail = detail ?? this.buildStatusContextLine(false);
    this.busyProgressCurrent = null;
    this.busyProgressTotal = null;
    this.busyStartedAt = Date.now();
    this.lastBusyRefreshAt = 0;
  }

  private buildStatusContextLine(includeLogs: boolean): string {
    return getStatusContextLine({
      mode: this.mode,
      volumes: this.volumes,
      selectedVolumeIndex: this.selectedVolumeIndex,
      currentSnapshot: this.currentSnapshot,
      selectedEntry: this.getSelectedEntry(),
      logDir: this.runtime.config.logDir,
      includeLogs,
    });
  }

  private finishBusyState(): void {
    this.busyLabel = null;
    this.busyDetail = null;
    this.busyProgressCurrent = null;
    this.busyProgressTotal = null;
    this.lastBusyRefreshAt = 0;
    this.render();
  }

  private updateBusyState(options: {
    label?: string;
    detail?: string;
    currentValue?: number | null;
    totalValue?: number | null;
  }): void {
    if (this.destroyed || !this.busyLabel) {
      return;
    }

    if (options.label !== undefined) {
      this.busyLabel = options.label;
    }

    if (options.detail !== undefined) {
      this.busyDetail = options.detail;
    }

    if (options.currentValue !== undefined) {
      this.busyProgressCurrent = options.currentValue;
    }

    if (options.totalValue !== undefined) {
      this.busyProgressTotal = options.totalValue;
    }

    const now = Date.now();
    if (now - this.lastBusyRefreshAt < 80) {
      return;
    }

    this.lastBusyRefreshAt = now;
    this.renderStatus();
    this.screen.render();
  }

  private formatImportProgress(progress: ImportProgress): string {
    return formatImportProgressText(progress);
  }

  private formatExportProgress(progress: ExportProgress): string {
    return formatExportProgressText(progress);
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
    return fitSingleLineText(value, width);
  }

  private getContentWidth(element: Widgets.BoxElement): number {
    return getLayoutContentWidth(
      element as unknown as LayoutElementSpec,
      this.getViewportWidth(),
    );
  }

  private getElementOuterWidth(element: Widgets.BoxElement): number {
    return resolveLayoutOuterWidth(
      element as unknown as LayoutElementSpec,
      this.getViewportWidth(),
    );
  }

  private getViewportWidth(): number {
    return process.stdout.columns ?? 120;
  }

  private getViewportHeight(): number {
    return process.stdout.rows ?? 40;
  }

  private setElementColors(
    element: Widgets.BoxElement,
    options: {
      bg?: string;
      fg?: string;
      borderFg?: string;
    },
  ): void {
    const style = element.style as unknown as MutableElementStyle;

    if (options.bg !== undefined) {
      style.bg = options.bg;
    }

    if (options.fg !== undefined) {
      style.fg = options.fg;
    }

    if (options.borderFg !== undefined) {
      style.border = style.border ?? {};
      style.border.fg = options.borderFg;
    }
  }

  private setListColors(
    element: Widgets.ListElement,
    options: {
      bg?: string;
      fg?: string;
      borderFg?: string;
      itemBg?: string;
      itemFg?: string;
      selectedBg?: string;
      selectedFg?: string;
      selectedBold?: boolean;
    },
  ): void {
    const style = element.style as unknown as MutableElementStyle;

    if (options.bg !== undefined) {
      style.bg = options.bg;
    }

    if (options.fg !== undefined) {
      style.fg = options.fg;
    }

    if (options.borderFg !== undefined) {
      style.border = style.border ?? {};
      style.border.fg = options.borderFg;
    }

    if (options.itemBg !== undefined || options.itemFg !== undefined) {
      style.item = style.item ?? {};
      if (options.itemBg !== undefined) {
        style.item.bg = options.itemBg;
      }
      if (options.itemFg !== undefined) {
        style.item.fg = options.itemFg;
      }
    }

    if (
      options.selectedBg !== undefined ||
      options.selectedFg !== undefined ||
      options.selectedBold !== undefined
    ) {
      style.selected = style.selected ?? {};
      if (options.selectedBg !== undefined) {
        style.selected.bg = options.selectedBg;
      }
      if (options.selectedFg !== undefined) {
        style.selected.fg = options.selectedFg;
      }
      if (options.selectedBold !== undefined) {
        style.selected.bold = options.selectedBold;
      }
    }
  }

  private getSelectedEntry(): DirectoryListingItem | null {
    return getSelectedExplorerEntry(this.currentSnapshot, this.selectedEntryIndex);
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
