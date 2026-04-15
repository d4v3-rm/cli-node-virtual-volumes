import { describe, expect, it } from 'vitest';

import {
  buildChoiceButtonRow,
  buildChoiceOverlayView,
  buildConfirmButtonRow,
  buildConfirmOverlayView,
  buildPromptOverlayView,
  buildScrollableOverlayView,
  cycleChoiceIndex,
  getScrollableOverlayMode,
  isDangerConfirmAction,
  resolvePromptValue,
  toggleConfirmButton,
} from '../src/ui/dialog-overlay.js';

describe('ui dialog overlay helpers', () => {
  it('builds help and preview scrollable overlays with the right mode', () => {
    expect(getScrollableOverlayMode('Help')).toBe('help');
    expect(getScrollableOverlayMode('Preview  /tmp/file.txt')).toBe('preview');

    expect(
      buildScrollableOverlayView({
        title: 'Help',
        content: 'Keyboard shortcuts',
        footer: 'Esc closes.',
      }),
    ).toEqual({
      borderTone: 'info',
      content: 'Keyboard shortcuts',
      footer: 'Esc closes.',
      height: '72%',
      mode: 'help',
      title: 'Help',
      width: '78%',
    });

    expect(
      buildScrollableOverlayView({
        title: 'Preview  /tmp/file.txt',
        content: 'body',
        footer: 'Esc closes.',
      }).borderTone,
    ).toBe('accentSecondary');
  });

  it('detects danger confirmations and renders button states', () => {
    expect(
      isDangerConfirmAction({
        title: 'Delete Volume',
        body: 'Delete the selected volume?',
        confirmLabel: 'Delete',
      }),
    ).toBe(true);

    expect(
      isDangerConfirmAction({
        title: 'Overwrite Entry',
        body: 'Continue?',
        confirmLabel: 'Replace',
      }),
    ).toBe(false);

    expect(buildConfirmButtonRow('Delete', 'confirm')).toContain('[ Delete ]');
    expect(buildConfirmButtonRow('Delete', 'cancel')).toContain('[ Cancel ]');
    expect(toggleConfirmButton('confirm')).toBe('cancel');
    expect(toggleConfirmButton('cancel')).toBe('confirm');
  });

  it('builds confirm overlays with stable dimensions and tone', () => {
    const view = buildConfirmOverlayView(
      {
        title: 'Delete Entry',
        body: 'Delete the selected entry?',
        confirmLabel: 'Delete',
      },
      'cancel',
    );

    expect(view.mode).toBe('confirm');
    expect(view.width).toBe('64%');
    expect(view.height).toBe(11);
    expect(view.borderTone).toBe('danger');
    expect(view.isDangerAction).toBe(true);
    expect(view.buttonContent).toContain('[ Cancel ]');
  });

  it('builds prompt overlays and resolves submitted values safely', () => {
    expect(
      buildPromptOverlayView({
        title: 'Move / Rename',
        description: 'New name',
        initialValue: 'report.txt',
        footer: 'Enter saves.',
      }),
    ).toEqual({
      borderTone: 'accentWarm',
      description: 'New name',
      footer: 'Enter saves.',
      height: 11,
      initialValue: 'report.txt',
      mode: 'input',
      title: 'Move / Rename',
      width: '68%',
    });

    expect(resolvePromptValue('renamed.txt', 'report.txt')).toBe('renamed.txt');
    expect(resolvePromptValue(undefined, 'report.txt')).toBe('report.txt');
    expect(resolvePromptValue(null, 'report.txt')).toBe('report.txt');
  });

  it('builds choice overlays and cycles selections safely', () => {
    expect(cycleChoiceIndex(0, 4, -1)).toBe(3);
    expect(cycleChoiceIndex(3, 4, 1)).toBe(0);
    expect(buildChoiceButtonRow(['KB', 'MB', 'GB', 'TB'], 2)).toContain('[ GB ]');

    const view = buildChoiceOverlayView(
      {
        title: 'Create Volume',
        description: 'Quota unit',
        choices: ['KB', 'MB', 'GB', 'TB'],
        initialIndex: 2,
        footer: 'Left/Right switches.',
      },
      2,
    );

    expect(view).toMatchObject({
      borderTone: 'accentWarm',
      description: 'Quota unit',
      footer: 'Left/Right switches.',
      height: 9,
      mode: 'choice',
      selectedIndex: 2,
      title: 'Create Volume',
      width: '68%',
    });
    expect(view.choicesContent).toContain('[ GB ]');
  });
});
