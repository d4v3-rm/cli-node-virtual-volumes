import { describe, expect, it } from 'vitest';

import {
  getContentWidth,
  resolveElementOuterWidth,
  resolveLayoutValue,
  type LayoutElementSpec,
} from '../src/ui/layout.js';

describe('ui layout helpers', () => {
  it('resolves numeric, percentage, and keyword layout values', () => {
    expect(resolveLayoutValue(24, 120, 0)).toBe(24);
    expect(resolveLayoutValue('50%', 120, 0)).toBe(60);
    expect(resolveLayoutValue('50%-4', 120, 0)).toBe(56);
    expect(resolveLayoutValue('half', 121, 0)).toBe(60);
    expect(resolveLayoutValue('center', 121, 15)).toBe(0);
    expect(resolveLayoutValue('bogus', 121, 15)).toBe(15);
    expect(resolveLayoutValue(undefined, 121, 15)).toBe(15);
  });

  it('derives element widths from parent layout constraints', () => {
    const root: LayoutElementSpec = {
      position: {
        width: 120,
      },
    };

    const explicitWidth: LayoutElementSpec = {
      position: {
        width: '50%-2',
      },
      parent: root,
    };

    const insetWidth: LayoutElementSpec = {
      position: {
        left: 10,
        right: '25%',
      },
      parent: root,
    };

    expect(resolveElementOuterWidth(explicitWidth, 180)).toBe(58);
    expect(resolveElementOuterWidth(insetWidth, 180)).toBe(80);
  });

  it('keeps a minimum readable content width', () => {
    expect(
      getContentWidth(
        {
          position: {
            width: 10,
          },
        },
        60,
      ),
    ).toBe(20);

    expect(
      getContentWidth(
        {
          position: {
            left: 4,
            right: 6,
          },
        },
        60,
      ),
    ).toBe(46);
  });
});
