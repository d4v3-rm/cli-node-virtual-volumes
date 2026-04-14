import { describe, expect, it } from 'vitest';

import { parseHostPathBatchInput } from '../src/utils/host-input.js';

describe('host path batch input parser', () => {
  it('splits newline, comma, and semicolon separated host paths', () => {
    const input = [
      '  C:\\imports\\alpha.txt ; /srv/shared/bravo.txt',
      '',
      '/srv/shared/charlie.txt,   D:\\exports\\delta.txt  ',
    ].join('\n');

    expect(parseHostPathBatchInput(input)).toEqual([
      'C:\\imports\\alpha.txt',
      '/srv/shared/bravo.txt',
      '/srv/shared/charlie.txt',
      'D:\\exports\\delta.txt',
    ]);
  });

  it('drops empty segments produced by repeated separators', () => {
    expect(parseHostPathBatchInput('one.txt,,;\n;two.txt\n\nthree.txt;;;')).toEqual([
      'one.txt',
      'two.txt',
      'three.txt',
    ]);
  });
});
