import { describe, expect, it } from 'vitest';

import { APP_VERSION } from '../src/config/app-metadata.js';
import type {
  SupportBundleInspectionResult,
  SupportBundleResult,
} from '../src/domain/types.js';
import {
  formatSupportBundleInspectionResult,
  formatSupportBundleResult,
} from '../src/cli/support-bundle.js';
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
      checksumsPath: 'C:\\reports\\support-bundle\\checksums.json',
      doctorReportPath: 'C:\\reports\\support-bundle\\doctor-report.json',
      backupInspectionReportPath:
        'C:\\reports\\support-bundle\\backup-inspection.json',
      backupManifestCopyPath:
        'C:\\reports\\support-bundle\\backup-artifact.manifest.json',
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
        'Checksums: C:\\reports\\support-bundle\\checksums.json',
        'Scope: volume-1',
        'Volumes checked: 1',
        'Issues detected: 0',
        'Backup path: C:\\backups\\finance.sqlite',
        'Doctor report: C:\\reports\\support-bundle\\doctor-report.json',
        'Backup inspection: C:\\reports\\support-bundle\\backup-inspection.json',
        'Backup manifest copy: C:\\reports\\support-bundle\\backup-artifact.manifest.json',
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
      checksumsPath: '/tmp/support-bundle/checksums.json',
      doctorReportPath: '/tmp/support-bundle/doctor-report.json',
      backupInspectionReportPath: null,
      backupManifestCopyPath: null,
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
    expect(formatSupportBundleResult(result)).toContain(
      'Backup manifest copy: not included',
    );
    expect(formatSupportBundleResult(result)).toContain('Log snapshot: not included');
  });

  it('formats healthy support bundle inspections', () => {
    const result: SupportBundleInspectionResult = {
      generatedAt: '2026-04-15T21:30:00.000Z',
      healthy: true,
      bundlePath: 'C:\\reports\\support-bundle',
      manifestPath: 'C:\\reports\\support-bundle\\manifest.json',
      checksumsPath: 'C:\\reports\\support-bundle\\checksums.json',
      bundleVersion: 1,
      bundleCliVersion: APP_VERSION,
      bundleCreatedAt: '2026-04-15T21:20:00.000Z',
      volumeId: 'volume-1',
      issueCount: 0,
      expectedFiles: 5,
      verifiedFiles: 5,
      issues: [],
    };

    expect(formatSupportBundleInspectionResult(result)).toBe(
      [
        'Support bundle: HEALTHY',
        'Bundle path: C:\\reports\\support-bundle',
        'Manifest: C:\\reports\\support-bundle\\manifest.json',
        'Checksums: C:\\reports\\support-bundle\\checksums.json',
        'Bundle version: 1',
        `Created with: ${APP_VERSION}`,
        `Bundle created at: ${formatDateTime(result.bundleCreatedAt!)}`,
        'Scope: volume-1',
        'Verified files: 5/5',
        'Issues: 0',
        `Inspected at: ${formatDateTime(result.generatedAt)}`,
      ].join('\n'),
    );
  });

  it('formats unhealthy support bundle inspections with findings', () => {
    const result: SupportBundleInspectionResult = {
      generatedAt: '2026-04-15T21:30:00.000Z',
      healthy: false,
      bundlePath: '/tmp/support-bundle',
      manifestPath: '/tmp/support-bundle/manifest.json',
      checksumsPath: '/tmp/support-bundle/checksums.json',
      bundleVersion: null,
      bundleCliVersion: null,
      bundleCreatedAt: null,
      volumeId: null,
      issueCount: 2,
      expectedFiles: 4,
      verifiedFiles: 3,
      issues: [
        {
          code: 'MISSING_BUNDLE_FILE',
          severity: 'error',
          message: 'Support bundle file is missing: doctor-report.json.',
          relativePath: 'doctor-report.json',
        },
        {
          code: 'CHECKSUM_MISMATCH',
          severity: 'error',
          message: 'Support bundle checksum does not match inventory for manifest.json.',
          relativePath: 'manifest.json',
        },
      ],
    };

    expect(formatSupportBundleInspectionResult(result)).toContain(
      'Support bundle: UNHEALTHY',
    );
    expect(formatSupportBundleInspectionResult(result)).toContain(
      'Created with: unknown',
    );
    expect(formatSupportBundleInspectionResult(result)).toContain(
      'Bundle created at: unknown',
    );
    expect(formatSupportBundleInspectionResult(result)).toContain(
      '- [MISSING_BUNDLE_FILE] Support bundle file is missing: doctor-report.json.',
    );
    expect(formatSupportBundleInspectionResult(result)).toContain(
      '- [CHECKSUM_MISMATCH] Support bundle checksum does not match inventory for manifest.json.',
    );
  });
});
