import { describe, expect, it } from 'vitest';

import {
  createActivityBar,
  createProgressBar,
  formatElapsedTime,
} from '../src/ui/status.js';

describe('status helpers', () => {
  it('renders a bounded progress bar', () => {
    expect(createProgressBar(50, 100, 10)).toBe('[#####-----]');
    expect(createProgressBar(150, 100, 10)).toBe('[##########]');
    expect(createProgressBar(0, 0, 10)).toBe('[----------]');
  });

  it('renders an indeterminate activity bar', () => {
    expect(createActivityBar(0, 10)).toBe('[====......]');
    expect(createActivityBar(3, 10)).toBe('[...====...]');
  });

  it('formats elapsed time compactly', () => {
    expect(formatElapsedTime(9000)).toBe('0:09');
    expect(formatElapsedTime(125000)).toBe('2:05');
    expect(formatElapsedTime(3723000)).toBe('1:02:03');
  });
});
