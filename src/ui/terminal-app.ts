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
  buildHelpOverlayOptions,
  buildPreviewOverlayOptions,
} from './action-presenters.js';
import {
  runCreateFolderWizard,
  runCreateVolumeWizard,
  runEditSelectedVolumeWizard,
  runDeleteSelectedEntry,
  runDeleteSelectedVolume,
  runExportWizard,
  runImportWizard,
  runMoveSelectedEntry,
  runPreviewSelectedEntry,
  type ActionRuntime,
} from './action-runtime.js';
import {
  applyHostBrowserSnapshot,
  createHostBrowserSessionState,
  getHostBrowserConfirmAction,
  getHostBrowserNavigateInAction,
  getHostBrowserNavigateOutAction,
  jumpHostBrowserSelectionState,
  moveHostBrowserSelectionState,
  setHostBrowserLoading,
  toggleCurrentHostBrowserSelectionState,
  toggleVisibleHostBrowserSelectionsState,
} from './host-browser-controller.js';
import {
  buildChoiceOverlayView,
  buildConfirmOverlayView,
  buildPromptOverlayView,
  buildScrollableOverlayView,
  cycleChoiceIndex,
  resolvePromptValue,
  toggleConfirmButton,
} from './dialog-overlay.js';
import {
  buildHostExportOverlayView,
  buildHostImportOverlayView,
  getHostBrowserModeConfig,
  getHostOverlayDimensions,
  getHostRowsSignature,
  HOST_BROWSER_VISIBLE_ROWS,
} from './host-browser-overlay.js';
import {
  getDefaultHostPath,
  listHostBrowserSnapshot,
} from './host-browser.js';
import { buildStatusPanel, getStatusContextLine } from './status-panel.js';
import {
  fitSingleLine as fitSingleLineText,
  formatExportProgress as formatExportProgressText,
  formatImportProgress as formatImportProgressText,
} from './presenters.js';
import {
  applyBusyStateUpdate,
  createBusyState,
  createToastState,
  type BusyState,
  type ToastState,
  type ToastTone,
} from './runtime-state.js';
import type {
  OverlayBorderTone,
  OverlayFrameMode,
  OverlayFrameView,
  OverlayRegionLayout,
} from './overlay-shell.js';
import {
  buildOverlayFrame,
  getChoiceOverlayLayout,
  getConfirmOverlayLayout,
  getPromptOverlayLayout,
  getScrollableOverlayLayout,
} from './overlay-shell.js';
import {
  getContentWidth as getLayoutContentWidth,
  resolveElementOuterWidth as resolveLayoutOuterWidth,
} from './layout.js';
import {
  buildHeaderPanelContent,
  buildInspectorPanelLabel,
  buildInspectorPanelContent,
  buildPrimaryPanelView,
  buildShortcutsPanelContent,
} from './shell-panels.js';
import {
  canRunShellHotkey,
  getShellHotkeyBindings,
  getQuitHotkeyAction,
  type ShellHotkeyAction,
  type ShellHotkeyContext,
} from './shell-hotkeys.js';
import { buildScreenOptions, buildShellWidgetSpecs } from './shell-widgets.js';
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
import { THEME } from './theme.js';

type ScreenMode = 'dashboard' | 'explorer';
type OverlayMode = OverlayFrameMode | null;

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

const SPINNER_FRAMES = ['|', '/', '-', '\\'];
// Legacy icon table retained while terminal-app extraction is still in progress.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const ICONS = {
  checkboxOff: '[ ]',
  checkboxOn: '[x]',
  drive: '=',
  file: '-',
  folder: '>',
  parent: '<',
  volume: '*',
} as const;

export interface TerminalUiFactory {
  box: (options: Widgets.BoxOptions) => Widgets.BoxElement;
  list: (options: Widgets.ListOptions<Widgets.ListElementStyle>) => Widgets.ListElement;
  screen: (options: Widgets.IScreenOptions) => Widgets.Screen;
  textbox: (options: Widgets.TextboxOptions) => Widgets.TextboxElement;
}

const DEFAULT_TERMINAL_UI_FACTORY: TerminalUiFactory = blessed;

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

  private mode: ScreenMode = 'dashboard';

  private volumes: VolumeManifest[] = [];

  private selectedVolumeIndex = 0;

  private currentVolumeId: string | null = null;

  private currentSnapshot: ExplorerSnapshot | null = null;

  private selectedEntryIndex = 0;

  private busyState: BusyState | null = createBusyState(
    'Loading volumes',
    'Initializing terminal shell.',
    Date.now(),
  );

  private toast: ToastState | null = null;

  private overlayMode: OverlayMode = null;

  private destroyed = false;

  public constructor(
    private readonly runtime: AppRuntime,
    private readonly uiFactory: TerminalUiFactory = DEFAULT_TERMINAL_UI_FACTORY,
  ) {
    const widgetSpecs = buildShellWidgetSpecs(THEME);

    this.screen = this.uiFactory.screen(buildScreenOptions());

    this.headerBox = this.uiFactory.box({
      parent: this.screen,
      ...widgetSpecs.headerBox,
    });

    this.leftPane = this.uiFactory.box({
      parent: this.screen,
      ...widgetSpecs.leftPane,
    });

    this.primaryList = this.uiFactory.list({
      parent: this.leftPane,
      ...widgetSpecs.primaryList,
    });

    this.rightPane = this.uiFactory.box({
      parent: this.screen,
      ...widgetSpecs.rightPane,
    });

    this.inspectorBox = this.uiFactory.box({
      parent: this.rightPane,
      ...widgetSpecs.inspectorBox,
    });

    this.shortcutsBox = this.uiFactory.box({
      parent: this.screen,
      ...widgetSpecs.shortcutsBox,
    });

    this.statusBox = this.uiFactory.box({
      parent: this.screen,
      ...widgetSpecs.statusBox,
    });

    this.overlayBackdrop = this.uiFactory.box({
      parent: this.screen,
      ...widgetSpecs.overlayBackdrop,
    });

    this.overlayContainer = this.uiFactory.box({
      parent: this.screen,
      ...widgetSpecs.overlayContainer,
    });

    this.spinnerInterval = setInterval(() => {
      if (!this.busyState) {
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
      const action = getQuitHotkeyAction({
        busy: this.isBusy(),
        mode: this.mode,
        overlayOpen: this.overlayMode !== null,
      });

      switch (action.kind) {
        case 'notify':
          this.notify('info', action.message);
          return;
        case 'shutdown':
          void this.shutdown();
          return;
        case 'dashboard':
          void this.goToDashboard();
          return;
        default:
          return;
      }
    });

    for (const binding of getShellHotkeyBindings()) {
      this.screen.key(binding.keys, () => {
        if (!canRunShellHotkey(binding.scope, this.getShellHotkeyContext())) {
          return;
        }

        this.runShellHotkey(binding.action);
      });
    }
  }

  private canHandleNavigation(): boolean {
    return canHandleShellNavigation({
      busy: this.isBusy(),
      currentSnapshot: this.currentSnapshot,
      mode: this.mode,
      overlayOpen: this.overlayMode !== null,
      volumesLength: this.volumes.length,
    });
  }

  private getShellHotkeyContext(): ShellHotkeyContext {
    return {
      busy: this.isBusy(),
      mode: this.mode,
      navigationAvailable: this.canHandleNavigation(),
      overlayOpen: this.overlayMode !== null,
    };
  }

  private runShellHotkey(action: ShellHotkeyAction): void {
    switch (action) {
      case 'help':
        void this.openHelpOverlay();
        return;
      case 'moveUp':
        void this.moveSelection(-1);
        return;
      case 'moveDown':
        void this.moveSelection(1);
        return;
      case 'pageUp':
        void this.moveByPage(-1);
        return;
      case 'pageDown':
        void this.moveByPage(1);
        return;
      case 'jumpStart':
        void this.jumpSelection('start');
        return;
      case 'jumpEnd':
        void this.jumpSelection('end');
        return;
      case 'goBack':
        void this.goBack();
        return;
      case 'openSelected':
        if (this.mode === 'dashboard') {
          void this.openSelectedVolume();
          return;
        }

        void this.openSelectedEntry();
        return;
      case 'refresh':
        void this.refreshCurrentScreen();
        return;
      case 'createVolume':
        void this.createVolumeWizard();
        return;
      case 'editVolume':
        void this.editSelectedVolume();
        return;
      case 'deleteVolume':
        void this.deleteSelectedVolume();
        return;
      case 'createFolder':
        void this.createFolderWizard();
        return;
      case 'import':
        void this.importWizard();
        return;
      case 'export':
        void this.exportWizard();
        return;
      case 'moveEntry':
        void this.moveSelectedEntry();
        return;
      case 'deleteEntry':
        void this.deleteSelectedEntry();
        return;
      case 'previewEntry':
        void this.previewSelectedEntry();
        return;
    }
  }

  private isBusy(): boolean {
    return this.busyState !== null;
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
    this.rightPane.setLabel(
      buildInspectorPanelLabel({
        mode: this.mode,
        selectedEntry: this.getSelectedEntry(),
        selectedVolumeIndex: this.selectedVolumeIndex,
        volumes: this.volumes,
      }),
    );
    this.inspectorBox.setContent(
      buildInspectorPanelContent({
        auditLogDir: this.runtime.config.auditLogDir,
        currentSnapshot: this.currentSnapshot,
        dataDir: this.runtime.config.dataDir,
        hostAllowPathCount: this.runtime.config.hostAllowPaths.length,
        hostDenyPathCount: this.runtime.config.hostDenyPaths.length,
        inspectorWidth: this.getContentWidth(this.rightPane),
        logDir: this.runtime.config.logDir,
        mode: this.mode,
        selectedEntry: this.getSelectedEntry(),
        selectedVolumeIndex: this.selectedVolumeIndex,
        volumes: this.volumes,
      }),
    );
    this.inspectorBox.setScroll(0);
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
      busyLabel: this.busyState?.label ?? null,
      busyDetail: this.busyState?.detail ?? null,
      busyProgressCurrent: this.busyState?.progressCurrent ?? null,
      busyProgressTotal: this.busyState?.progressTotal ?? null,
      elapsedMs: this.busyState ? Date.now() - this.busyState.startedAt : 0,
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
    await runCreateVolumeWizard(this.getActionRuntime());
  }

  private async createFolderWizard(): Promise<void> {
    await runCreateFolderWizard(this.getActionRuntime());
  }

  private async editSelectedVolume(): Promise<void> {
    await runEditSelectedVolumeWizard(this.getActionRuntime());
  }

  private async importWizard(): Promise<void> {
    await runImportWizard(this.getActionRuntime());
  }

  private async exportWizard(): Promise<void> {
    await runExportWizard(this.getActionRuntime());
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
      let session = createHostBrowserSessionState(initialHostPath);
      let settled = false;
      let renderedRowsSignature = '';

      this.openOverlayFrame(
        buildOverlayFrame({
          borderTone: isImportMode ? 'success' : 'accentWarm',
          height: overlayHeight,
          mode: 'hostBrowser',
          title: modeConfig.containerLabel,
          viewportHeight,
          viewportWidth,
          width: overlayWidth,
        }),
      );

      const headerBox = this.uiFactory.box({
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

      const browserPane = this.uiFactory.box({
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

      const browserList = this.uiFactory.list({
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

      const summaryPane = this.uiFactory.box({
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

      const summaryBox = this.uiFactory.box({
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

      const footerBox = this.uiFactory.box({
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
          loading: session.loading,
          selectedIndex: session.selectedIndex,
          selectedPaths: isImportMode ? session.selectedPaths : undefined,
          snapshot: session.snapshot,
        });
        const view = isImportMode
          ? buildHostImportOverlayView({
              browserContentWidth: this.getContentWidth(browserPane),
              destinationPath: options.destinationPath,
              headerWidth: contentWidth,
              loading: session.loading,
              overlayContentWidth: contentWidth,
              selectedIndex: session.selectedIndex,
              selectedPaths: session.selectedPaths,
              snapshot: session.snapshot,
            })
          : buildHostExportOverlayView({
              browserContentWidth: this.getContentWidth(browserPane),
              headerWidth: contentWidth,
              loading: session.loading,
              overlayContentWidth: contentWidth,
              selectedIndex: session.selectedIndex,
              snapshot: session.snapshot,
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
        session = setHostBrowserLoading(session, true);
        renderBrowser();

        try {
          const nextSnapshot = await listHostBrowserSnapshot(targetPath);
          session = applyHostBrowserSnapshot(session, nextSnapshot, preferredAbsolutePath);
          renderedRowsSignature = '';
        } catch (error) {
          const message =
            error instanceof Error ? error.message : 'Unable to browse the host filesystem.';
          session = setHostBrowserLoading(session, false);
          this.notify('error', message);
        }

        renderBrowser();
      };

      const moveSelectionBy = (direction: number): void => {
        const nextSession = moveHostBrowserSelectionState(session, direction);
        if (nextSession === session) {
          return;
        }

        session = nextSession;
        renderBrowser();
      };

      const navigateIn = async (): Promise<void> => {
        const action = getHostBrowserNavigateInAction(options.mode, session);
        switch (action.kind) {
          case 'load':
            await loadSnapshot(
              action.request.targetPath,
              action.request.preferredAbsolutePath,
            );
            return;
          case 'update':
            session = action.state;
            renderBrowser();
            return;
          default:
            return;
        }
      };

      const navigateOut = async (): Promise<void> => {
        const action = getHostBrowserNavigateOutAction(session);
        if (action.kind === 'load') {
          await loadSnapshot(
            action.request.targetPath,
            action.request.preferredAbsolutePath,
          );
        }
      };

      const confirmSelection = (): void => {
        const action = getHostBrowserConfirmAction({
          emptySelectionMessage: modeConfig.emptySelectionMessage,
          mode: options.mode,
          state: session,
        });
        if (action.kind === 'notify') {
          this.notify('info', action.message);
          renderBrowser();
          return;
        }

        close(action.result);
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
          const nextSession = toggleCurrentHostBrowserSelectionState(session);
          if (nextSession === session) {
            return;
          }

          session = nextSession;
          renderBrowser();
        });
        browserList.key(['a'], () => {
          const nextSession = toggleVisibleHostBrowserSelectionsState(session);
          if (nextSession === session) {
            return;
          }

          session = nextSession;
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
        const nextSession = jumpHostBrowserSelectionState(session, 'start');
        if (nextSession === session) {
          return;
        }

        session = nextSession;
        renderBrowser();
      });
      browserList.key(['end'], () => {
        const nextSession = jumpHostBrowserSelectionState(session, 'end');
        if (nextSession === session) {
          return;
        }

        session = nextSession;
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
    await runMoveSelectedEntry(this.getActionRuntime());
  }

  private async deleteSelectedEntry(): Promise<void> {
    await runDeleteSelectedEntry(this.getActionRuntime());
  }

  private async deleteSelectedVolume(): Promise<void> {
    await runDeleteSelectedVolume(this.getActionRuntime());
  }

  private async previewSelectedEntry(): Promise<void> {
    await runPreviewSelectedEntry(this.getActionRuntime());
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
      const layout = getScrollableOverlayLayout();

      this.openOverlayFrame(
        buildOverlayFrame({
          borderTone: view.borderTone,
          height: view.height,
          mode: view.mode,
          title: view.title,
          width: view.width,
        }),
      );

      const contentBox = this.createOverlayBox(layout.contentBox, {
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

      this.createOverlayFooter(layout.footerBox, view.footer);

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
      const layout = getConfirmOverlayLayout();
      const applyConfirmView = (): void => {
        const view = buildConfirmOverlayView(options, selectedButton);

        this.applyOverlayFrame(
          buildOverlayFrame({
            borderTone: view.borderTone,
            height: view.height,
            mode: view.mode,
            title: view.title,
            width: view.width,
          }),
        );
        buttonRow.setContent(view.buttonContent);
      };

      this.openOverlayFrame(
        buildOverlayFrame({
          borderTone: 'warning',
          height: 11,
          mode: 'confirm',
          title: options.title,
          width: '64%',
        }),
      );

      this.createOverlayBox(layout.bodyBox, {
        content: options.body,
        style: {
          bg: THEME.panelOverlayAlt,
          fg: THEME.text,
        },
      });

      const buttonRow = this.createOverlayBox(layout.buttonRow, {
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
      const layout = getPromptOverlayLayout();

      this.openOverlayFrame(
        buildOverlayFrame({
          borderTone: view.borderTone,
          height: view.height,
          mode: view.mode,
          title: view.title,
          width: view.width,
        }),
      );

      this.createOverlayBox(layout.descriptionBox, {
        content: view.description,
        style: {
          bg: THEME.panelOverlayAlt,
          fg: THEME.text,
        },
      });

      const input = this.createOverlayTextbox(layout.inputBox, {
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

      this.createOverlayFooter(layout.footerBox, view.footer);

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

  private async promptChoice(options: {
    title: string;
    description: string;
    choices: string[];
    initialIndex: number;
    footer: string;
  }): Promise<string | null> {
    return new Promise<string | null>((resolve) => {
      let selectedIndex =
        options.choices.length === 0
          ? 0
          : Math.min(Math.max(0, options.initialIndex), options.choices.length - 1);
      const layout = getChoiceOverlayLayout();

      this.openOverlayFrame(
        buildOverlayFrame({
          borderTone: 'accentWarm',
          height: 9,
          mode: 'choice',
          title: options.title,
          width: '68%',
        }),
      );

      this.createOverlayBox(layout.descriptionBox, {
        content: options.description,
        style: {
          bg: THEME.panelOverlayAlt,
          fg: THEME.text,
        },
      });

      const choiceRow = this.createOverlayBox(layout.choiceRow, {
        align: 'center',
        keys: true,
        mouse: false,
        style: {
          bg: THEME.panelOverlayAlt,
          fg: THEME.text,
        },
      });
      this.createOverlayFooter(layout.footerBox, options.footer);

      const close = (value: string | null): void => {
        this.closeOverlay();
        resolve(value);
      };

      const applyChoiceView = (): void => {
        const view = buildChoiceOverlayView(options, selectedIndex);

        selectedIndex = view.selectedIndex;
        this.applyOverlayFrame(
          buildOverlayFrame({
            borderTone: view.borderTone,
            height: view.height,
            mode: view.mode,
            title: view.title,
            width: view.width,
          }),
        );
        choiceRow.setContent(view.choicesContent);
      };

      const moveSelection = (direction: number): void => {
        const nextIndex = cycleChoiceIndex(selectedIndex, options.choices.length, direction);
        if (nextIndex === selectedIndex) {
          return;
        }

        selectedIndex = nextIndex;
        applyChoiceView();
        this.screen.render();
      };

      choiceRow.key(['left', 'up', 'S-tab'], () => {
        moveSelection(-1);
      });
      choiceRow.key(['right', 'down', 'tab'], () => {
        moveSelection(1);
      });
      choiceRow.key(['home'], () => {
        if (selectedIndex === 0) {
          return;
        }

        selectedIndex = 0;
        applyChoiceView();
        this.screen.render();
      });
      choiceRow.key(['end'], () => {
        const lastIndex = Math.max(0, options.choices.length - 1);
        if (selectedIndex === lastIndex) {
          return;
        }

        selectedIndex = lastIndex;
        applyChoiceView();
        this.screen.render();
      });
      choiceRow.key(['enter'], () => {
        close(options.choices[selectedIndex] ?? null);
      });
      choiceRow.key(['escape', 'q'], () => {
        close(null);
      });

      options.choices.forEach((choice, index) => {
        const hotkey = choice[0]?.toLowerCase();
        if (!hotkey) {
          return;
        }

        choiceRow.key([hotkey], () => {
          if (selectedIndex === index) {
            return;
          }

          selectedIndex = index;
          applyChoiceView();
          this.screen.render();
        });
      });

      applyChoiceView();
      choiceRow.focus();
      this.screen.render();
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

  private resolveOverlayBorderColor(tone: OverlayBorderTone): string {
    switch (tone) {
      case 'accentSecondary':
        return THEME.accentSecondary;
      case 'warning':
        return THEME.warning;
      case 'danger':
        return THEME.danger;
      case 'accentWarm':
        return THEME.accentWarm;
      case 'success':
        return THEME.borderOverlayAlt;
      default:
        return THEME.info;
    }
  }

  private applyOverlayFrame(view: OverlayFrameView): void {
    this.overlayMode = view.mode;
    this.overlayContainer.setLabel(view.label);
    this.overlayContainer.width = view.width;
    this.overlayContainer.height = view.height;
    this.overlayContainer.left = view.left;
    this.overlayContainer.top = view.top;
    this.setElementColors(this.overlayContainer, {
      bg: THEME.panelOverlay,
      borderFg: this.resolveOverlayBorderColor(view.borderTone),
    });
  }

  private openOverlayFrame(view: OverlayFrameView): void {
    this.overlayBackdrop.show();
    this.applyOverlayFrame(view);
    this.overlayContainer.show();
    this.clearChildren(this.overlayContainer);
  }

  private createOverlayBox(
    layout: OverlayRegionLayout,
    options: Widgets.BoxOptions,
  ): Widgets.BoxElement {
    return this.uiFactory.box({
      parent: this.overlayContainer,
      ...layout,
      ...options,
    });
  }

  private createOverlayTextbox(
    layout: OverlayRegionLayout,
    options: Widgets.TextboxOptions,
  ): Widgets.TextboxElement {
    return this.uiFactory.textbox({
      parent: this.overlayContainer,
      ...layout,
      ...options,
    });
  }

  private createOverlayFooter(layout: OverlayRegionLayout, content: string): Widgets.BoxElement {
    return this.createOverlayBox(layout, {
      content,
      style: {
        bg: THEME.panelOverlayAlt,
        fg: THEME.muted,
      },
    });
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

    this.toast = createToastState(tone, message, detail);

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
    this.busyState = createBusyState(
      label,
      detail ?? this.buildStatusContextLine(false),
      Date.now(),
    );
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
    this.busyState = null;
    this.render();
  }

  private updateBusyState(options: {
    label?: string;
    detail?: string;
    currentValue?: number | null;
    totalValue?: number | null;
  }): void {
    if (this.destroyed || !this.busyState) {
      return;
    }

    const patched = applyBusyStateUpdate(this.busyState, options, Date.now());
    this.busyState = patched.state;
    if (!patched.shouldRender) {
      return;
    }

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

  private getActionRuntime(): ActionRuntime {
    return {
      currentSnapshot: this.currentSnapshot,
      currentVolumeId: this.currentVolumeId,
      defaultQuotaBytes: this.runtime.config.defaultQuotaBytes,
      selectedEntry: this.getSelectedEntry(),
      selectedEntryIndex: this.selectedEntryIndex,
      selectedVolumeIndex: this.selectedVolumeIndex,
      volumeService: this.runtime.volumeService,
      volumes: this.volumes,
      confirmAction: (options) => this.confirmAction(options),
      formatExportProgress: (progress) => this.formatExportProgress(progress),
      formatImportProgress: (progress) => this.formatImportProgress(progress),
      getVolumes: () => this.volumes,
      goToDashboard: () => this.goToDashboard(),
      loadVolumes: () => this.loadVolumes(),
      notify: (tone, message, detail) => this.notify(tone, message, detail),
      openHostExportOverlay: (sourcePath) => this.openHostExportOverlay(sourcePath),
      openHostImportOverlay: (destinationPath) => this.openHostImportOverlay(destinationPath),
      openPreviewOverlay: (preview) => this.openPreviewOverlay(preview),
      openVolume: (volumeId, targetPath, selectionIndex) =>
        this.openVolume(volumeId, targetPath, selectionIndex),
      promptChoice: (options) => this.promptChoice(options),
      promptValue: (options) => this.promptValue(options),
      render: () => this.render(),
      runTask: (label, operation, detail) => this.runTask(label, operation, detail),
      setSelectedVolumeIndex: (index) => {
        this.selectedVolumeIndex = index;
      },
      updateBusyState: (options) => this.updateBusyState(options),
    };
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
