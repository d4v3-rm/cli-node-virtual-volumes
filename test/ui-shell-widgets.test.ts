import { describe, expect, it } from 'vitest';

import { buildScreenOptions, buildShellWidgetSpecs } from '../src/ui/shell-widgets.js';
import { THEME } from '../src/ui/theme.js';

describe('ui shell widget specs', () => {
  it('builds stable screen options for the terminal shell', () => {
    expect(buildScreenOptions()).toEqual({
      smartCSR: false,
      fullUnicode: true,
      dockBorders: true,
      autoPadding: false,
      title: 'Virtual Volumes',
      warnings: false,
    });
  });

  it('builds shell widget specs using the shared theme palette', () => {
    const specs = buildShellWidgetSpecs(THEME);

    expect(specs.headerBox).toMatchObject({
      top: 0,
      left: 0,
      width: '100%',
      height: 3,
      style: {
        bg: THEME.headerDashboard,
        fg: THEME.accentSecondary,
      },
    });

    expect(specs.leftPane).toMatchObject({
      label: ' Navigation ',
      width: '62%',
      style: {
        bg: THEME.panelNavigation,
        border: {
          fg: THEME.borderNavigation,
        },
      },
    });

    expect(specs.primaryList).toMatchObject({
      mouse: true,
      style: {
        selected: {
          bg: THEME.accentSecondary,
          fg: '#020617',
          bold: true,
        },
      },
    });

    expect(specs.rightPane).toMatchObject({
      label: ' Inspector ',
      left: '62%',
      style: {
        bg: THEME.panelInspector,
        border: {
          fg: THEME.borderInspector,
        },
      },
    });

    expect(specs.shortcutsBox).toMatchObject({
      label: ' Keyboard ',
      style: {
        bg: THEME.panelShortcuts,
        border: {
          fg: THEME.borderShortcuts,
        },
      },
    });

    expect(specs.statusBox).toMatchObject({
      label: ' Status ',
      style: {
        bg: THEME.statusIdleBg,
        border: {
          fg: THEME.borderStatus,
        },
      },
    });

    expect(specs.overlayBackdrop).toMatchObject({
      hidden: true,
      style: {
        bg: THEME.background,
        transparent: false,
      },
    });

    expect(specs.overlayContainer).toMatchObject({
      hidden: true,
      label: ' Modal ',
      style: {
        bg: THEME.panelOverlay,
        border: {
          fg: THEME.borderOverlay,
        },
      },
    });
  });
});
