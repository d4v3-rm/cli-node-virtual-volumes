import { describe, expect, it } from 'vitest';

import {
  canRunShellHotkey,
  getShellHotkeyBindings,
  type ShellHotkeyContext,
} from '../src/ui/shell-hotkeys.js';

const idleDashboardContext: ShellHotkeyContext = {
  busy: false,
  mode: 'dashboard',
  navigationAvailable: true,
  overlayOpen: false,
};

describe('ui shell hotkeys', () => {
  it('publishes the shell hotkey table in a stable order', () => {
    expect(getShellHotkeyBindings()).toEqual([
      { action: 'help', keys: ['?'], scope: 'globalIdle' },
      { action: 'moveUp', keys: ['up'], scope: 'navigation' },
      { action: 'moveDown', keys: ['down'], scope: 'navigation' },
      { action: 'pageUp', keys: ['pageup'], scope: 'navigation' },
      { action: 'pageDown', keys: ['pagedown'], scope: 'navigation' },
      { action: 'jumpStart', keys: ['home'], scope: 'navigation' },
      { action: 'jumpEnd', keys: ['end'], scope: 'navigation' },
      { action: 'goBack', keys: ['left', 'backspace', 'b'], scope: 'explorer' },
      { action: 'openSelected', keys: ['right', 'enter', 'o'], scope: 'globalIdle' },
      { action: 'refresh', keys: ['r'], scope: 'globalIdle' },
      { action: 'createVolume', keys: ['n'], scope: 'dashboard' },
      { action: 'deleteVolume', keys: ['x'], scope: 'dashboard' },
      { action: 'createFolder', keys: ['c'], scope: 'explorer' },
      { action: 'import', keys: ['i'], scope: 'explorer' },
      { action: 'export', keys: ['e'], scope: 'explorer' },
      { action: 'moveEntry', keys: ['m'], scope: 'explorer' },
      { action: 'deleteEntry', keys: ['d'], scope: 'explorer' },
      { action: 'previewEntry', keys: ['p'], scope: 'explorer' },
    ]);
  });

  it('blocks every scoped hotkey while busy or when an overlay is open', () => {
    for (const scope of ['globalIdle', 'navigation', 'dashboard', 'explorer'] as const) {
      expect(
        canRunShellHotkey(scope, {
          ...idleDashboardContext,
          busy: true,
        }),
      ).toBe(false);

      expect(
        canRunShellHotkey(scope, {
          ...idleDashboardContext,
          overlayOpen: true,
        }),
      ).toBe(false);
    }
  });

  it('gates navigation by availability and action scopes by current mode', () => {
    expect(
      canRunShellHotkey('globalIdle', {
        ...idleDashboardContext,
        navigationAvailable: false,
      }),
    ).toBe(true);

    expect(
      canRunShellHotkey('navigation', {
        ...idleDashboardContext,
        navigationAvailable: false,
      }),
    ).toBe(false);

    expect(canRunShellHotkey('navigation', idleDashboardContext)).toBe(true);
    expect(canRunShellHotkey('dashboard', idleDashboardContext)).toBe(true);
    expect(canRunShellHotkey('explorer', idleDashboardContext)).toBe(false);

    const explorerContext: ShellHotkeyContext = {
      ...idleDashboardContext,
      mode: 'explorer',
    };

    expect(canRunShellHotkey('dashboard', explorerContext)).toBe(false);
    expect(canRunShellHotkey('explorer', explorerContext)).toBe(true);
  });
});
