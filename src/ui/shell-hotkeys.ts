import type { ShellScreenMode } from './shell-navigation.js';

export type ShellHotkeyAction =
  | 'help'
  | 'moveUp'
  | 'moveDown'
  | 'pageUp'
  | 'pageDown'
  | 'jumpStart'
  | 'jumpEnd'
  | 'goBack'
  | 'openSelected'
  | 'refresh'
  | 'createVolume'
  | 'editVolume'
  | 'deleteVolume'
  | 'createFolder'
  | 'import'
  | 'export'
  | 'moveEntry'
  | 'deleteEntry'
  | 'previewEntry';

export type ShellHotkeyScope = 'globalIdle' | 'navigation' | 'dashboard' | 'explorer';

export interface ShellHotkeyBinding {
  action: ShellHotkeyAction;
  keys: string[];
  scope: ShellHotkeyScope;
}

export interface ShellHotkeyContext {
  busy: boolean;
  mode: ShellScreenMode;
  navigationAvailable: boolean;
  overlayOpen: boolean;
}

export type QuitHotkeyAction =
  | { kind: 'noop' }
  | { kind: 'notify'; message: string }
  | { kind: 'shutdown' }
  | { kind: 'dashboard' };

const SHELL_HOTKEY_BINDINGS: ShellHotkeyBinding[] = [
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
  { action: 'editVolume', keys: ['m'], scope: 'dashboard' },
  { action: 'deleteVolume', keys: ['x'], scope: 'dashboard' },
  { action: 'createFolder', keys: ['c'], scope: 'explorer' },
  { action: 'import', keys: ['i'], scope: 'explorer' },
  { action: 'export', keys: ['e'], scope: 'explorer' },
  { action: 'moveEntry', keys: ['m'], scope: 'explorer' },
  { action: 'deleteEntry', keys: ['d'], scope: 'explorer' },
  { action: 'previewEntry', keys: ['p'], scope: 'explorer' },
];

const SHELL_SHORTCUT_LINES: Record<ShellScreenMode, string[]> = {
  dashboard: [
    '[UP/DOWN] Select volume',
    '[RIGHT/ENTER] Open volume',
    '[PGUP/PGDN] Page volumes',
    '[HOME/END] Jump list bounds',
    '[N] New volume',
    '[M] Edit volume',
    '[X] Delete volume',
    '[R] Refresh   [?] Help   [Q] Quit',
  ],
  explorer: [
    '[UP/DOWN] Select entry',
    '[LEFT/RIGHT] Parent or open',
    '[PGUP/PGDN] Page entries',
    '[HOME/END] Jump list bounds',
    '[I] Import   [E] Export',
    '[C] Folder   [M] Move',
    '[D] Delete   [P] Preview',
    '[R] Refresh  [B/Q] Dashboard',
  ],
};

export const getShellHotkeyBindings = (): ShellHotkeyBinding[] => SHELL_HOTKEY_BINDINGS;

export const buildShellShortcutLines = (mode: ShellScreenMode): string[] =>
  SHELL_SHORTCUT_LINES[mode];

export const canRunShellHotkey = (
  scope: ShellHotkeyScope,
  context: ShellHotkeyContext,
): boolean => {
  if (context.busy || context.overlayOpen) {
    return false;
  }

  switch (scope) {
    case 'navigation':
      return context.navigationAvailable;
    case 'dashboard':
      return context.mode === 'dashboard';
    case 'explorer':
      return context.mode === 'explorer';
    default:
      return true;
  }
};

export const getQuitHotkeyAction = (options: {
  busy: boolean;
  mode: ShellScreenMode;
  overlayOpen: boolean;
}): QuitHotkeyAction => {
  if (options.overlayOpen) {
    return { kind: 'noop' };
  }

  if (options.busy) {
    return {
      kind: 'notify',
      message: 'An operation is still running. Press Ctrl+C to force exit.',
    };
  }

  return options.mode === 'dashboard' ? { kind: 'shutdown' } : { kind: 'dashboard' };
};
