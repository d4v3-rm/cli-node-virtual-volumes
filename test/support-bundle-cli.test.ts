import { describe, expect, it } from 'vitest';

import { APP_VERSION } from '../src/config/app-metadata.js';
import type { SupportBundleResult } from '../src/domain/types.js';
import { formatSupportBundleResult } from '../src/cli/support-bundle.js';
import { formatDateTime } from '../src/utils/formatters.js';

describe('support bundle cli formatter', () => {
  it('formats support bundle output with bundle paths and scope', () => {
    const result: SupportBundleResult = {
      bundleVersion: 1,
      cliVersion: APP_VERSION,
      generatedAt: '2026-04-15T20:30:00.000Z',
      supportedVolumeSchemaVersion: 3,
      volumeId: 'volume-1',
      backupPath: 'C:\\backups\\finance.sqlite',
      healthy: true,
      checkedVolumes: 1,
      issueCount: 0,
      bundlePath: 'C:\\reports\\support-bundle',
      manifestPath: 'C:\\reports\\support-bundle\\manifest.json',
      doctorReportPath: 'C:\\reports\\support-bundle\\doctor-report.json',
      backupInspectionReportPath:
        'C:\\reports\\support-bundle\\backup-inspection.json',
      logSnapshotPath: 'C:\\reports\\support-bundle\\logs\\app.log',
      config: {
        dataDir: 'C:\\data',
        logDir: 'C:\\logs',
        logLevel: 'info',
        logToStdout: false,
        defaultQuotaBytes: 1024,
        previewBytes: 2048,
      },
      environment: {
        platform: 'win32',
        arch: 'x64',
        nodeVersion: 'v22.0.0',
        hostname: 'ops-host',
        cwd: 'C:\\workspace',
      },
    };

    expect(formatSupportBundleResult(result)).toBe(
      [
        'Support bundle: CREATED',
        'Bundle path: C:\\reports\\support-bundle',
        'Manifest: C:\\reports\\support-bundle\\manifest.json',
        'Scope: volume-1',
        'Volumes checked: 1',
        'Issues detected: 0',
        'Doctor report: C:\\reports\\support-bundle\\doctor-report.json',
        'Backup path: C:\\backups\\finance.sqlite',
        'Backup inspection: C:\\reports\\support-bundle\\backup-inspection.json',
        'Log snapshot: C:\\reports\\support-bundle\\logs\\app.log',
        `CLI version: ${APP_VERSION}`,
        'Supported schema: 3',
        `Generated at: ${formatDateTime(result.generatedAt)}`,
      ].join('\n'),
    );
  });

  it('formats support bundles without backup or log snapshots', () => {
    const result: SupportBundleResult = {
      bundleVersion: 1,
      cliVersion: APP_VERSION,
      generatedAt: '2026-04-15T20:30:00.000Z',
      supportedVolumeSchemaVersion: 3,
      volumeId: null,
      backupPath: null,
      healthy: true,
      checkedVolumes: 0,
      issueCount: 0,
      bundlePath: '/tmp/support-bundle',
      manifestPath: '/tmp/support-bundle/manifest.json',
      doctorReportPath: '/tmp/support-bundle/doctor-report.json',
      backupInspectionReportPath: null,
      logSnapshotPath: null,
      config: {
        dataDir: '/tmp/data',
        logDir: '/tmp/logs',
        logLevel: 'silent',
        logToStdout: false,
        defaultQuotaBytes: 1024,
        previewBytes: 2048,
      },
      environment: {
        platform: 'linux',
        arch: 'x64',
        nodeVersion: 'v22.0.0',
        hostname: 'ops-host',
        cwd: '/workspace',
      },
    };

    expect(formatSupportBundleResult(result)).toContain('Scope: all volumes');
    expect(formatSupportBundleResult(result)).toContain(
      'Backup inspection: not included',
    );
    expect(formatSupportBundleResult(result)).toContain('Log snapshot: not included');
  });
});
