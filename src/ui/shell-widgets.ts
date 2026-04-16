import type { Widgets } from 'blessed';

import type { ThemePalette } from './theme.js';

export interface ShellWidgetSpecs {
  headerBox: Widgets.BoxOptions;
  inspectorBox: Widgets.BoxOptions;
  leftPane: Widgets.BoxOptions;
  overlayBackdrop: Widgets.BoxOptions;
  overlayContainer: Widgets.BoxOptions;
  primaryList: Widgets.ListOptions<Widgets.ListElementStyle>;
  rightPane: Widgets.BoxOptions;
  shortcutsBox: Widgets.BoxOptions;
  statusBox: Widgets.BoxOptions;
}

const createPanelOptions = (
  theme: ThemePalette,
  options: Widgets.BoxOptions,
): Widgets.BoxOptions => ({
  border: 'line',
  tags: false,
  style: {
    bg: theme.panelNavigation,
    fg: theme.text,
    border: {
      fg: theme.borderNavigation,
    },
  },
  ...options,
});

export const buildScreenOptions = (): Widgets.IScreenOptions => ({
  smartCSR: false,
  fullUnicode: true,
  dockBorders: true,
  autoPadding: false,
  title: 'Virtual Volumes',
  warnings: false,
});

export const buildShellWidgetSpecs = (theme: ThemePalette): ShellWidgetSpecs => ({
  headerBox: {
    top: 0,
    left: 0,
    width: '100%',
    height: 3,
    style: {
      bg: theme.headerDashboard,
      fg: theme.accentSecondary,
    },
    padding: {
      left: 1,
      right: 1,
    },
  },
  leftPane: createPanelOptions(theme, {
    top: 3,
    left: 0,
    width: '62%',
    bottom: 4,
    label: ' Navigation ',
  }),
  primaryList: {
    top: 1,
    left: 1,
    right: 1,
    bottom: 1,
    keys: false,
    mouse: true,
    vi: false,
    tags: false,
    style: {
      bg: theme.panelNavigation,
      fg: theme.text,
      selected: {
        bg: theme.accentSecondary,
        fg: '#020617',
        bold: true,
      },
      item: {
        fg: theme.text,
        bg: theme.panelNavigation,
      },
    },
    scrollbar: {
      ch: ' ',
      style: {
        bg: theme.borderNavigation,
      },
    },
  },
  rightPane: createPanelOptions(theme, {
    top: 3,
    left: '62%',
    width: '38%',
    bottom: 13,
    label: ' Inspector ',
    style: {
      bg: theme.panelInspector,
      fg: theme.text,
      border: {
        fg: theme.borderInspector,
      },
    },
  }),
  inspectorBox: {
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
      bg: theme.panelInspector,
      fg: theme.text,
    },
    scrollbar: {
      ch: ' ',
      style: {
        bg: theme.borderInspector,
      },
    },
  },
  shortcutsBox: createPanelOptions(theme, {
    height: 9,
    bottom: 4,
    left: '62%',
    width: '38%',
    label: ' Keyboard ',
    style: {
      bg: theme.panelShortcuts,
      fg: theme.text,
      border: {
        fg: theme.borderShortcuts,
      },
    },
  }),
  statusBox: createPanelOptions(theme, {
    height: 4,
    bottom: 0,
    left: 0,
    width: '100%',
    label: ' Status ',
    style: {
      bg: theme.statusIdleBg,
      fg: theme.text,
      border: {
        fg: theme.borderStatus,
      },
    },
  }),
  overlayBackdrop: {
    top: 0,
    left: 0,
    width: '100%',
    height: '100%',
    hidden: true,
    style: {
      bg: theme.background,
      transparent: false,
    },
  },
  overlayContainer: {
    top: 'center',
    left: 'center',
    width: '78%',
    height: '72%',
    hidden: true,
    border: 'line',
    label: ' Modal ',
    style: {
      bg: theme.panelOverlay,
      fg: theme.text,
      border: {
        fg: theme.borderOverlay,
      },
    },
  },
});
