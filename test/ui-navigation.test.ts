import { describe, expect, it } from 'vitest';

import {
  clampIndex,
  formatWindowSummary,
  getPageOffset,
  getVisibleWindow,
} from '../src/ui/navigation.js';

describe('ui navigation helpers', () => {
  it('clamps indexes inside the available range', () => {
    expect(clampIndex(-2, 5)).toBe(0);
    expect(clampIndex(3, 5)).toBe(3);
    expect(clampIndex(99, 5)).toBe(4);
    expect(clampIndex(1, 0)).toBe(0);
  });

  it('computes page offsets from a selected row', () => {
    expect(getPageOffset(0, 12)).toBe(0);
    expect(getPageOffset(11, 12)).toBe(0);
    expect(getPageOffset(12, 12)).toBe(12);
    expect(getPageOffset(25, 12)).toBe(24);
  });

  it('returns the visible window for a paged list', () => {
    const window = getVisibleWindow(
      ['a', 'b', 'c', 'd', 'e', 'f', 'g'],
      5,
      3,
    );

    expect(window.start).toBe(3);
    expect(window.end).toBe(6);
    expect(window.items).toEqual(['d', 'e', 'f']);
  });

  it('formats a summary for the current page window', () => {
    expect(formatWindowSummary(0, 0, 0)).toBe('0 of 0');
    expect(formatWindowSummary(0, 8, 30)).toBe('1-8 of 30');
    expect(formatWindowSummary(24, 30, 30)).toBe('25-30 of 30');
  });
});
