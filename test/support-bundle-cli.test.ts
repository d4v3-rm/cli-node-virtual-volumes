import { describe, expect, it } from 'vitest';

import { APP_VERSION } from '../src/config/app-metadata.js';
import type {
  SupportBundleInspectionResult,
  SupportBundleResult,
} from '../src/domain/types.js';
import {
  evaluateSupportBundleSharingRequirement,
  formatSupportBundleSharingRequirementStatus,
  formatSupportBundleInspectionResult,
  formatSupportBundleResult,
  parseSupportBundleSharingRecommendation,
} from '../src/cli/support-bundle.js';
import { formatDateTime } from '../src/utils/formatters.js';

describe('support bundle cli formatter', () => {
  it('formats support bundle output with bundle paths and scope', () => {
    const result: SupportBundleResult = {
      bundleVersion: 1,
      cliVersion: APP_VERSION,
      correlationId: 'corr_support-bundle',
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
      auditLogSnapshotPath: 'C:\\reports\\support-bundle\\audit\\audit.log',
      logSnapshotPath: 'C:\\reports\\support-bundle\\logs\\app.log',
      contentProfile: {
        redacted: false,
        includesAppLogSnapshot: true,
        includesAuditLogSnapshot: true,
        includesBackupInspection: true,
        includesBackupManifestCopy: true,
        sensitivity: 'restricted',
        sharingRecommendation: 'internal-only',
        sharingNotes: [
          'Runtime metadata and embedded reports are not redacted.',
          'Log snapshots are included and may contain sensitive operational context.',
          'A backup manifest copy is included for artifact correlation and recovery review.',
        ],
      },
      config: {
        auditLogDir: 'C:\\audit',
        auditLogLevel: 'info',
        dataDir: 'C:\\data',
        hostAllowPaths: ['C:\\allowed'],
        hostDenyPaths: ['C:\\allowed\\blocked'],
        logDir: 'C:\\logs',
        logLevel: 'info',
        logRetentionDays: 30,
        redactSensitiveDetails: false,
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
        'Correlation ID: corr_support-bundle',
        'Sensitivity: restricted',
        'Sharing: internal-only',
        'Scope: volume-1',
        'Volumes checked: 1',
        'Issues detected: 0',
        'Backup path: C:\\backups\\finance.sqlite',
        'Doctor report: C:\\reports\\support-bundle\\doctor-report.json',
        'Backup inspection: C:\\reports\\support-bundle\\backup-inspection.json',
        'Backup manifest copy: C:\\reports\\support-bundle\\backup-artifact.manifest.json',
        'Audit log snapshot: C:\\reports\\support-bundle\\audit\\audit.log',
        'Log snapshot: C:\\reports\\support-bundle\\logs\\app.log',
        `CLI version: ${APP_VERSION}`,
        'Supported schema: 3',
        `Generated at: ${formatDateTime(result.generatedAt)}`,
        'Sharing notes:',
        '- Runtime metadata and embedded reports are not redacted.',
        '- Log snapshots are included and may contain sensitive operational context.',
        '- A backup manifest copy is included for artifact correlation and recovery review.',
      ].join('\n'),
    );
  });

  it('formats support bundles without backup or log snapshots', () => {
    const result: SupportBundleResult = {
      bundleVersion: 1,
      cliVersion: APP_VERSION,
      correlationId: 'corr_support-bundle-all',
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
      auditLogSnapshotPath: null,
      logSnapshotPath: null,
      contentProfile: {
        redacted: true,
        includesAppLogSnapshot: false,
        includesAuditLogSnapshot: false,
        includesBackupInspection: false,
        includesBackupManifestCopy: false,
        sensitivity: 'sanitized',
        sharingRecommendation: 'external-shareable',
        sharingNotes: [
          'Bundle metadata is redacted and log snapshots are excluded, which is suitable for broader sharing.',
        ],
      },
      config: {
        auditLogDir: '/tmp/audit',
        auditLogLevel: 'info',
        dataDir: '/tmp/data',
        hostAllowPaths: [],
        hostDenyPaths: [],
        logDir: '/tmp/logs',
        logLevel: 'silent',
        logRetentionDays: null,
        redactSensitiveDetails: false,
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
      'Correlation ID: corr_support-bundle-all',
    );
    expect(formatSupportBundleResult(result)).toContain('Sensitivity: sanitized');
    expect(formatSupportBundleResult(result)).toContain(
      'Sharing: external-shareable',
    );
    expect(formatSupportBundleResult(result)).toContain(
      'Backup inspection: not included',
    );
    expect(formatSupportBundleResult(result)).toContain(
      'Backup manifest copy: not included',
    );
    expect(formatSupportBundleResult(result)).toContain(
      'Audit log snapshot: not included',
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
      bundleCorrelationId: 'corr_bundle-inspect',
      bundleCreatedAt: '2026-04-15T21:20:00.000Z',
      volumeId: 'volume-1',
      issueCount: 0,
      expectedFiles: 5,
      verifiedFiles: 5,
      contentProfile: {
        redacted: true,
        includesAppLogSnapshot: false,
        includesAuditLogSnapshot: false,
        includesBackupInspection: true,
        includesBackupManifestCopy: true,
        sensitivity: 'sanitized',
        sharingRecommendation: 'external-shareable',
        sharingNotes: [
          'Bundle metadata is redacted and log snapshots are excluded, which is suitable for broader sharing.',
        ],
      },
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
        'Bundle correlation ID: corr_bundle-inspect',
        'Sensitivity: sanitized',
        'Sharing: external-shareable',
        `Bundle created at: ${formatDateTime(result.bundleCreatedAt!)}`,
        'Scope: volume-1',
        'Verified files: 5/5',
        'Issues: 0',
        `Inspected at: ${formatDateTime(result.generatedAt)}`,
        'Sharing notes:',
        '- Bundle metadata is redacted and log snapshots are excluded, which is suitable for broader sharing.',
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
      bundleCorrelationId: null,
      bundleCreatedAt: null,
      volumeId: null,
      issueCount: 2,
      expectedFiles: 4,
      verifiedFiles: 3,
      contentProfile: null,
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
      'Bundle correlation ID: unknown',
    );
    expect(formatSupportBundleInspectionResult(result)).toContain(
      'Sensitivity: unknown',
    );
    expect(formatSupportBundleInspectionResult(result)).toContain('Sharing: unknown');
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

  it('parses valid support bundle sharing policies', () => {
    expect(parseSupportBundleSharingRecommendation('internal-only')).toBe(
      'internal-only',
    );
    expect(parseSupportBundleSharingRecommendation('external-shareable')).toBe(
      'external-shareable',
    );
    expect(() => parseSupportBundleSharingRecommendation('public')).toThrow(
      'Unsupported support bundle sharing policy "public".',
    );
  });

  it('accepts bundles that are shareable to a broader audience than required', () => {
    const status = evaluateSupportBundleSharingRequirement(
      {
        contentProfile: {
          redacted: true,
          includesAppLogSnapshot: false,
          includesAuditLogSnapshot: false,
          includesBackupInspection: true,
          includesBackupManifestCopy: false,
          sensitivity: 'sanitized',
          sharingRecommendation: 'external-shareable',
          sharingNotes: [],
        },
      },
      'internal-only',
    );

    expect(status).toEqual({
      required: 'internal-only',
      satisfied: true,
      message: null,
    });
    expect(formatSupportBundleSharingRequirementStatus(status)).toBe(
      ['Required sharing: internal-only', 'Policy gate: PASSED'].join('\n'),
    );
  });

  it('fails the sharing policy gate when the bundle is not shareable enough', () => {
    const status = evaluateSupportBundleSharingRequirement(
      {
        contentProfile: {
          redacted: false,
          includesAppLogSnapshot: true,
          includesAuditLogSnapshot: true,
          includesBackupInspection: true,
          includesBackupManifestCopy: true,
          sensitivity: 'restricted',
          sharingRecommendation: 'internal-only',
          sharingNotes: [],
        },
      },
      'external-shareable',
    );

    expect(status).toEqual({
      required: 'external-shareable',
      satisfied: false,
      message:
        'Support bundle is recommended for internal-only sharing, but external-shareable was required.',
    });
    expect(formatSupportBundleSharingRequirementStatus(status)).toContain(
      'Policy gate: FAILED',
    );
    expect(formatSupportBundleSharingRequirementStatus(status)).toContain(
      'Policy note: Support bundle is recommended for internal-only sharing, but external-shareable was required.',
    );
  });

  it('fails the sharing policy gate when the bundle profile is unknown', () => {
    const status = evaluateSupportBundleSharingRequirement(
      {
        contentProfile: null,
      },
      'internal-only',
    );

    expect(status).toEqual({
      required: 'internal-only',
      satisfied: false,
      message:
        'Support bundle sharing guidance is unknown, so the required sharing policy cannot be verified.',
    });
  });
});
