import { describe, expect, it } from 'vitest';

import {
  buildOverlayFrame,
  formatOverlayLabel,
  getChoiceOverlayLayout,
  getConfirmOverlayLayout,
  getPromptOverlayLayout,
  getScrollableOverlayLayout,
} from '../src/ui/overlay-shell.js';

describe('ui overlay shell helpers', () => {
  it('formats overlay labels and centers percentage-based frames', () => {
    expect(formatOverlayLabel('  Modal Title  ')).toBe(' Modal Title ');

    expect(
      buildOverlayFrame({
        borderTone: 'info',
        height: '72%',
        mode: 'help',
        title: 'Help',
        width: '78%',
      }),
    ).toEqual({
      borderTone: 'info',
      height: '72%',
      label: ' Help ',
      left: 'center',
      mode: 'help',
      top: 'center',
      width: '78%',
    });
  });

  it('centers fixed-size frames inside the viewport with a safe top offset', () => {
    expect(
      buildOverlayFrame({
        borderTone: 'success',
        height: 34,
        mode: 'hostBrowser',
        title: 'Host Import',
        viewportHeight: 40,
        viewportWidth: 120,
        width: 116,
      }),
    ).toEqual({
      borderTone: 'success',
      height: 34,
      label: ' Host Import ',
      left: 2,
      mode: 'hostBrowser',
      top: 3,
      width: 116,
    });

    expect(
      buildOverlayFrame({
        borderTone: 'warning',
        height: 20,
        mode: 'confirm',
        title: 'Confirm',
        viewportHeight: 18,
        viewportWidth: 90,
        width: 70,
      }).top,
    ).toBe(1);
  });

  it('returns stable region layouts for shared overlay shells', () => {
    expect(getScrollableOverlayLayout()).toEqual({
      contentBox: {
        top: 1,
        left: 1,
        right: 1,
        bottom: 2,
      },
      footerBox: {
        left: 1,
        right: 1,
        bottom: 0,
        height: 1,
      },
    });

    expect(getConfirmOverlayLayout()).toEqual({
      bodyBox: {
        top: 1,
        left: 2,
        right: 2,
        height: 4,
      },
      buttonRow: {
        bottom: 1,
        left: 2,
        right: 2,
        height: 2,
      },
    });

    expect(getPromptOverlayLayout()).toEqual({
      descriptionBox: {
        top: 1,
        left: 2,
        right: 2,
        height: 2,
      },
      inputBox: {
        top: 4,
        left: 2,
        right: 2,
        height: 3,
      },
      footerBox: {
        left: 2,
        right: 2,
        bottom: 0,
        height: 1,
      },
    });

    expect(getChoiceOverlayLayout()).toEqual({
      descriptionBox: {
        top: 1,
        left: 2,
        right: 2,
        height: 2,
      },
      choiceRow: {
        top: 4,
        left: 2,
        right: 2,
        height: 2,
      },
      footerBox: {
        left: 2,
        right: 2,
        bottom: 0,
        height: 1,
      },
    });
  });
});
