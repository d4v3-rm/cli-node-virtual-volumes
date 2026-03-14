import path from 'node:path';

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

  it('parses host path policy lists from the environment and overrides', () => {
    const fromEnvironment = loadAppConfig(
      {},
      {
        VOLUME_HOST_ALLOW_PATHS: ['/allowed', '/shared'].join(path.delimiter),
        VOLUME_HOST_DENY_PATHS: ['/allowed/blocked'].join(path.delimiter),
      },
    );

    expect(fromEnvironment.hostAllowPaths).toEqual([
      path.resolve('/allowed'),
      path.resolve('/shared'),
    ]);
    expect(fromEnvironment.hostDenyPaths).toEqual([path.resolve('/allowed/blocked')]);

    const fromOverrides = loadAppConfig(
      {
        hostAllowPaths: ['..\\exports'],
        hostDenyPaths: ['..\\exports\\blocked'],
      },
      {},
    );

    expect(fromOverrides.hostAllowPaths[0]).toMatch(/exports$/);
    expect(fromOverrides.hostDenyPaths[0]).toMatch(/exports[\\/]blocked$/);
  });
});
