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
  { action: 'deleteVolume', keys: ['x'], scope: 'dashboard' },
  { action: 'createFolder', keys: ['c'], scope: 'explorer' },
  { action: 'import', keys: ['i'], scope: 'explorer' },
  { action: 'export', keys: ['e'], scope: 'explorer' },
  { action: 'moveEntry', keys: ['m'], scope: 'explorer' },
  { action: 'deleteEntry', keys: ['d'], scope: 'explorer' },
  { action: 'previewEntry', keys: ['p'], scope: 'explorer' },
];

export const getShellHotkeyBindings = (): ShellHotkeyBinding[] => SHELL_HOTKEY_BINDINGS;

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
