import { describe, expect, it } from 'vitest';

import { loadAppConfig } from '../src/config/env.js';

describe('loadAppConfig', () => {
  it('parses false boolean strings from the environment correctly', () => {
    const config = loadAppConfig({}, {
      VOLUME_LOG_TO_STDOUT: 'false',
    });

    expect(config.logToStdout).toBe(false);
  });

  it('parses true boolean strings from the environment correctly', () => {
    const config = loadAppConfig({}, {
      VOLUME_LOG_TO_STDOUT: 'true',
    });

    expect(config.logToStdout).toBe(true);
  });
});
