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
        VOLUME_AUDIT_LOG_DIR: './audit-trail',
        VOLUME_AUDIT_LOG_LEVEL: 'warn',
        VOLUME_HOST_ALLOW_PATHS: ['/allowed', '/shared'].join(path.delimiter),
        VOLUME_HOST_DENY_PATHS: ['/allowed/blocked'].join(path.delimiter),
        VOLUME_LOG_RETENTION_DAYS: '14',
        VOLUME_REDACT_SENSITIVE_DETAILS: 'true',
        VOLUME_SUPPORT_BUNDLE_LOG_TAIL_LINES: '250',
      },
    );

    expect(fromEnvironment.auditLogDir).toMatch(/audit-trail$/);
    expect(fromEnvironment.auditLogLevel).toBe('warn');
    expect(fromEnvironment.logRetentionDays).toBe(14);
    expect(fromEnvironment.redactSensitiveDetails).toBe(true);
    expect(fromEnvironment.supportBundleLogTailLines).toBe(250);
    expect(fromEnvironment.hostAllowPaths).toEqual([
      path.resolve('/allowed'),
      path.resolve('/shared'),
    ]);
    expect(fromEnvironment.hostDenyPaths).toEqual([path.resolve('/allowed/blocked')]);

    const fromOverrides = loadAppConfig(
      {
        hostAllowPaths: ['..\\exports'],
        hostDenyPaths: ['..\\exports\\blocked'],
        logRetentionDays: 30,
        redactSensitiveDetails: true,
        supportBundleLogTailLines: 80,
      },
      {},
    );

    expect(fromOverrides.hostAllowPaths[0]).toMatch(/exports$/);
    expect(fromOverrides.hostDenyPaths[0]).toMatch(/exports[\\/]blocked$/);
    expect(fromOverrides.logRetentionDays).toBe(30);
    expect(fromOverrides.redactSensitiveDetails).toBe(true);
    expect(fromOverrides.supportBundleLogTailLines).toBe(80);
  });

  it('allows runtime overrides to disable log retention configured through the environment', () => {
    const config = loadAppConfig(
      {
        logRetentionDays: null,
      },
      {
        VOLUME_LOG_RETENTION_DAYS: '14',
      },
    );

    expect(config.logRetentionDays).toBeNull();
  });
});
