import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createRuntime } from '../src/bootstrap/create-runtime.js';
import type { AppRuntime } from '../src/bootstrap/create-runtime.js';
import { APP_VERSION } from '../src/config/app-metadata.js';
import { resolveAppLogFilePath, resolveAuditLogFilePath } from '../src/logging/logger.js';
import { createSupportBundle, inspectSupportBundle } from '../src/ops/support-bundle.js';
import { getVolumeDatabasePath, withVolumeDatabase } from '../src/storage/sqlite-volume.js';
import type {
  SupportBundleChecksumManifest,
  SupportBundleFileRecord,
  SupportBundleInspectionIssue,
} from '../src/domain/types.js';

const sandboxes: string[] = [];
const runtimes: AppRuntime[] = [];

vi.setConfig({
  hookTimeout: 20000,
  testTimeout: 20000,
});

const createIsolatedRuntime = async (
  overrides: Parameters<typeof createRuntime>[0] = {},
) => {
  const sandboxRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), 'cli-node-virtual-volumes-support-bundle-'),
  );
  sandboxes.push(sandboxRoot);

  const runtime = await createRuntime({
    dataDir: path.join(sandboxRoot, 'data'),
    logDir: path.join(sandboxRoot, 'logs'),
    logLevel: 'silent',
    logToStdout: false,
    ...overrides,
  });
  runtimes.push(runtime);

  return runtime;
};

const findBundleFileRecord = (
  files: SupportBundleFileRecord[],
  role: SupportBundleFileRecord['role'],
): SupportBundleFileRecord | undefined =>
  files.find((file) => file.role === role);

afterEach(async () => {
  await Promise.all(runtimes.splice(0, runtimes.length).map((runtime) => runtime.close()));
  await Promise.all(
    sandboxes.splice(0, sandboxes.length).map((sandboxRoot) =>
      fs.rm(sandboxRoot, { recursive: true, force: true }),
    ),
  );
});

describe('support bundle', () => {
  it('creates a support bundle with doctor output, backup inspection, and log snapshot', async () => {
    const runtime = await createIsolatedRuntime();
    const volume = await runtime.volumeService.createVolume({ name: 'Ops Bundle' });
    const bundlePath = path.join(runtime.config.dataDir, '..', 'support-bundle');
    const backupPath = path.join(runtime.config.dataDir, '..', 'bundle.sqlite');

    await runtime.volumeService.writeTextFile(volume.id, '/hello.txt', 'support bundle');
    const backupResult = await runtime.volumeService.backupVolume(volume.id, backupPath);
    const currentLogPath = resolveAppLogFilePath(runtime.config);
    const currentAuditLogPath = resolveAuditLogFilePath(runtime.config);

    await fs.mkdir(path.dirname(currentLogPath), { recursive: true });
    await fs.writeFile(currentLogPath, 'support bundle log\n', 'utf8');

    const result = await createSupportBundle(runtime, {
      destinationPath: bundlePath,
      volumeId: volume.id,
      backupPath,
    });
    const manifest = JSON.parse(
      await fs.readFile(result.manifestPath, 'utf8'),
    ) as typeof result;
    const doctorReport = JSON.parse(
      await fs.readFile(result.doctorReportPath, 'utf8'),
    ) as {
      healthy: boolean;
      checkedVolumes: number;
      issueCount: number;
      volumes: { volumeId: string }[];
    };
    const backupInspection = JSON.parse(
      await fs.readFile(result.backupInspectionReportPath!, 'utf8'),
    ) as {
      volumeId: string;
      checksumSha256: string;
      validatedWithManifest: boolean;
    };
    const checksumManifest = JSON.parse(
      await fs.readFile(result.checksumsPath, 'utf8'),
    ) as SupportBundleChecksumManifest;
    const handoffReport = await fs.readFile(result.handoffReportPath!, 'utf8');
    const copiedBackupManifest = JSON.parse(
      await fs.readFile(result.backupManifestCopyPath!, 'utf8'),
    ) as {
      volumeId: string;
      checksumSha256: string;
    };

    expect(result.bundleVersion).toBe(1);
    expect(result.cliVersion).toBe(APP_VERSION);
    expect(result.correlationId).toBe(runtime.correlationId);
    expect(result.doctorIntegrityDepth).toBe('metadata');
    expect(result.config.logRetentionDays).toBeNull();
    expect(result.config.redactSensitiveDetails).toBe(false);
    expect(result.bundlePath).toBe(path.resolve(bundlePath));
    expect(result.backupPath).toBe(path.resolve(backupPath));
    expect(result.volumeId).toBe(volume.id);
    expect(result.checkedVolumes).toBe(1);
    expect(result.issueCount).toBe(0);
    expect(result.backupInspectionReportPath).not.toBeNull();
    expect(result.backupManifestCopyPath).not.toBeNull();
    expect(result.handoffReportPath).toBe(
      path.join(path.resolve(bundlePath), 'handoff-report.md'),
    );
    expect(result.checksumsPath).toBe(
      path.join(path.resolve(bundlePath), 'checksums.json'),
    );
    expect(result.contentProfile).toMatchObject({
      redacted: false,
      includesAppLogSnapshot: true,
      includesAuditLogSnapshot: true,
      includesBackupInspection: true,
      includesBackupManifestCopy: true,
      sensitivity: 'restricted',
      sharingRecommendation: 'internal-only',
      recommendedRetentionDays: 7,
    });
    expect(result.auditLogSnapshotPath).not.toBeNull();
    expect(result.logSnapshotPath).not.toBeNull();
    expect(await fs.readFile(result.auditLogSnapshotPath!, 'utf8')).toContain(
      '"eventType":"volume.create"',
    );
    expect(await fs.readFile(result.logSnapshotPath!, 'utf8')).toContain(
      'support bundle log',
    );
    expect(handoffReport).toContain('# Support Bundle Handoff Report');
    expect(handoffReport).toContain('- Doctor integrity depth: metadata');
    expect(handoffReport).toContain('- Sharing: internal-only');
    expect(handoffReport).toContain('- Retention: 7 days');
    expect(handoffReport).toContain('- Doctor report: doctor-report.json');
    expect(handoffReport).toContain('- No immediate storage remediation is recommended from this snapshot.');
    expect(manifest).toEqual(result);
    expect(doctorReport).toMatchObject({
      healthy: true,
      checkedVolumes: 1,
      issueCount: 0,
      volumes: [{ volumeId: volume.id }],
    });
    expect(backupInspection).toMatchObject({
      volumeId: volume.id,
      checksumSha256: backupResult.checksumSha256,
      validatedWithManifest: true,
    });
    expect(copiedBackupManifest).toMatchObject({
      volumeId: volume.id,
      checksumSha256: backupResult.checksumSha256,
    });
    expect(checksumManifest.bundlePath).toBe(path.resolve(bundlePath));
    expect(checksumManifest.files).toHaveLength(7);
    const manifestRecord = findBundleFileRecord(checksumManifest.files, 'manifest');
    const doctorRecord = findBundleFileRecord(checksumManifest.files, 'doctor-report');
    const handoffRecord = findBundleFileRecord(checksumManifest.files, 'handoff-report');
    const inspectionRecord = findBundleFileRecord(
      checksumManifest.files,
      'backup-inspection',
    );
    const backupManifestRecord = findBundleFileRecord(
      checksumManifest.files,
      'backup-manifest',
    );
    const auditLogRecord = findBundleFileRecord(
      checksumManifest.files,
      'audit-log-snapshot',
    );
    const logRecord = findBundleFileRecord(checksumManifest.files, 'log-snapshot');

    expect(manifestRecord).toMatchObject({
      relativePath: 'manifest.json',
    });
    expect(manifestRecord?.checksumSha256).toMatch(/^[0-9a-f]{64}$/u);
    expect(doctorRecord).toMatchObject({
      relativePath: 'doctor-report.json',
    });
    expect(doctorRecord?.checksumSha256).toMatch(/^[0-9a-f]{64}$/u);
    expect(handoffRecord).toMatchObject({
      relativePath: 'handoff-report.md',
    });
    expect(handoffRecord?.checksumSha256).toMatch(/^[0-9a-f]{64}$/u);
    expect(inspectionRecord).toMatchObject({
      relativePath: 'backup-inspection.json',
    });
    expect(inspectionRecord?.checksumSha256).toMatch(/^[0-9a-f]{64}$/u);
    expect(backupManifestRecord).toMatchObject({
      relativePath: 'backup-artifact.manifest.json',
    });
    expect(backupManifestRecord?.checksumSha256).toMatch(/^[0-9a-f]{64}$/u);
    expect(auditLogRecord).toMatchObject({
      relativePath: path.join(
        'audit',
        path.basename(resolveAuditLogFilePath(runtime.config)),
      ),
      sourcePath: currentAuditLogPath,
    });
    expect(auditLogRecord?.checksumSha256).toMatch(/^[0-9a-f]{64}$/u);
    expect(logRecord).toMatchObject({
      relativePath: path.join(
        'logs',
        path.basename(resolveAppLogFilePath(runtime.config)),
      ),
    });
    expect(logRecord?.checksumSha256).toMatch(/^[0-9a-f]{64}$/u);
  });

  it('captures only the configured tail of app and audit logs in support bundles', async () => {
    const runtime = await createIsolatedRuntime({
      auditLogLevel: 'silent',
      supportBundleLogTailLines: 2,
    });
    const bundlePath = path.join(runtime.config.dataDir, '..', 'tail-support-bundle');
    const currentLogPath = resolveAppLogFilePath(runtime.config);
    const currentAuditLogPath = resolveAuditLogFilePath(runtime.config);

    await fs.mkdir(path.dirname(currentLogPath), { recursive: true });
    await fs.mkdir(path.dirname(currentAuditLogPath), { recursive: true });
    await fs.writeFile(
      currentLogPath,
      ['app-1', 'app-2', 'app-3', 'app-4'].join('\n').concat('\n'),
      'utf8',
    );
    await fs.writeFile(
      currentAuditLogPath,
      ['audit-1', 'audit-2', 'audit-3'].join('\n').concat('\n'),
      'utf8',
    );

    const result = await createSupportBundle(runtime, {
      destinationPath: bundlePath,
    });

    expect(await fs.readFile(result.logSnapshotPath!, 'utf8')).toBe('app-3\napp-4\n');
    expect(await fs.readFile(result.auditLogSnapshotPath!, 'utf8')).toBe(
      'audit-2\naudit-3\n',
    );
    expect(result.contentProfile.includesAppLogSnapshot).toBe(true);
    expect(result.contentProfile.includesAuditLogSnapshot).toBe(true);
  });

  it('supports deep doctor verification and operational next actions in support bundle handoff reports', async () => {
    const runtime = await createIsolatedRuntime();
    const repairVolume = await runtime.volumeService.createVolume({ name: 'Repair Fleet' });
    const compactVolume = await runtime.volumeService.createVolume({ name: 'Compact Fleet' });
    const bundlePath = path.join(runtime.config.dataDir, '..', 'deep-support-bundle');

    await runtime.volumeService.writeTextFile(repairVolume.id, '/repair.txt', 'repair me');
    await runtime.volumeService.writeTextFile(
      compactVolume.id,
      '/deleted.txt',
      'c'.repeat(2 * 1024 * 1024),
    );
    await runtime.volumeService.deleteEntry(compactVolume.id, '/deleted.txt');

    await withVolumeDatabase(
      getVolumeDatabasePath(runtime.config.dataDir, repairVolume.id),
      async (database) => {
        const fileRow = await database.get<{ content_ref: string }>(
          `SELECT content_ref
             FROM entries
            WHERE name = 'repair.txt'
            LIMIT 1`,
        );

        await database.run(
          `UPDATE blobs
              SET size = size + 7
            WHERE content_ref = ?`,
          fileRow?.content_ref ?? '',
        );
      },
    );

    const result = await createSupportBundle(runtime, {
      destinationPath: bundlePath,
      verifyBlobPayloads: true,
    });
    const doctorReport = JSON.parse(
      await fs.readFile(result.doctorReportPath, 'utf8'),
    ) as {
      integrityDepth?: 'metadata' | 'deep';
      repairSummary: {
        repairableVolumes: number;
        readyBatchRepairVolumes: number;
      };
      maintenanceSummary: {
        recommendedCompactions: number;
      };
    };
    const handoffReport = await fs.readFile(result.handoffReportPath!, 'utf8');

    expect(result.doctorIntegrityDepth).toBe('deep');
    expect(doctorReport.integrityDepth).toBe('deep');
    expect(doctorReport.repairSummary.repairableVolumes).toBe(1);
    expect(doctorReport.repairSummary.readyBatchRepairVolumes).toBe(1);
    expect(doctorReport.maintenanceSummary.recommendedCompactions).toBe(1);
    expect(handoffReport).toContain('- Doctor integrity depth: deep');
    expect(handoffReport).toContain('## Fleet Posture');
    expect(handoffReport).toContain('## Top Compaction Candidates');
    expect(handoffReport).toContain('## Top Repair Candidates');
    expect(handoffReport).toContain(
      '- Run virtual-volumes repair-safe --verify-blobs --dry-run to preview safe fleet repairs before execution.',
    );
    expect(handoffReport).toContain(
      '- Run virtual-volumes compact-recommended --dry-run to size the current SQLite maintenance batch.',
    );
  });

  it('omits log snapshots when support bundle creation disables them explicitly', async () => {
    const runtime = await createIsolatedRuntime();
    const volume = await runtime.volumeService.createVolume({ name: 'No Logs Bundle' });
    const bundlePath = path.join(runtime.config.dataDir, '..', 'no-logs-support-bundle');
    const currentLogPath = resolveAppLogFilePath(runtime.config);
    const currentAuditLogPath = resolveAuditLogFilePath(runtime.config);

    await runtime.volumeService.writeTextFile(volume.id, '/hello.txt', 'support bundle');
    await fs.mkdir(path.dirname(currentLogPath), { recursive: true });
    await fs.mkdir(path.dirname(currentAuditLogPath), { recursive: true });
    await fs.writeFile(currentLogPath, 'should not be copied\n', 'utf8');
    await fs.writeFile(currentAuditLogPath, 'should not be copied\n', 'utf8');

    const result = await createSupportBundle(runtime, {
      destinationPath: bundlePath,
      volumeId: volume.id,
      includeLogs: false,
    });
    const checksumManifest = JSON.parse(
      await fs.readFile(result.checksumsPath, 'utf8'),
    ) as SupportBundleChecksumManifest;

    expect(result.logSnapshotPath).toBeNull();
    expect(result.auditLogSnapshotPath).toBeNull();
    expect(result.contentProfile).toMatchObject({
      includesAppLogSnapshot: false,
      includesAuditLogSnapshot: false,
      sensitivity: 'restricted',
      sharingRecommendation: 'internal-only',
      recommendedRetentionDays: 7,
    });
    expect(findBundleFileRecord(checksumManifest.files, 'log-snapshot')).toBeUndefined();
    expect(
      findBundleFileRecord(checksumManifest.files, 'audit-log-snapshot'),
    ).toBeUndefined();
  });

  it('classifies redacted bundles without logs as externally shareable', async () => {
    const runtime = await createIsolatedRuntime({
      redactSensitiveDetails: true,
    });
    const volume = await runtime.volumeService.createVolume({ name: 'Shareable Bundle' });
    const bundlePath = path.join(runtime.config.dataDir, '..', 'shareable-support-bundle');

    await runtime.volumeService.writeTextFile(volume.id, '/hello.txt', 'share me');

    const result = await createSupportBundle(runtime, {
      destinationPath: bundlePath,
      volumeId: volume.id,
      includeLogs: false,
    });
    const inspection = await inspectSupportBundle(bundlePath);

    expect(result.contentProfile).toMatchObject({
      redacted: true,
      includesAppLogSnapshot: false,
      includesAuditLogSnapshot: false,
      sensitivity: 'sanitized',
      sharingRecommendation: 'external-shareable',
      recommendedRetentionDays: 30,
    });
    expect(inspection.contentProfile).toMatchObject({
      redacted: true,
      includesAppLogSnapshot: false,
      includesAuditLogSnapshot: false,
      sensitivity: 'sanitized',
      sharingRecommendation: 'external-shareable',
      recommendedRetentionDays: 30,
    });
    expect(result.doctorIntegrityDepth).toBe('metadata');
    expect(inspection.doctorIntegrityDepth).toBe('metadata');
  });

  it('rejects existing bundle destinations without overwrite', async () => {
    const runtime = await createIsolatedRuntime();
    const bundlePath = path.join(runtime.config.dataDir, '..', 'existing-support-bundle');

    await fs.mkdir(bundlePath, { recursive: true });

    await expect(
      createSupportBundle(runtime, {
        destinationPath: bundlePath,
      }),
    ).rejects.toMatchObject({
      code: 'ALREADY_EXISTS',
    });
  });

  it('overwrites existing bundle destinations when force is enabled', async () => {
    const runtime = await createIsolatedRuntime();
    const bundlePath = path.join(runtime.config.dataDir, '..', 'overwrite-support-bundle');

    await fs.mkdir(bundlePath, { recursive: true });
    await fs.writeFile(path.join(bundlePath, 'stale.txt'), 'old', 'utf8');

    const result = await createSupportBundle(runtime, {
      destinationPath: bundlePath,
      overwrite: true,
    });

    await expect(fs.access(path.join(bundlePath, 'stale.txt'))).rejects.toThrow();
    await expect(fs.access(result.manifestPath)).resolves.toBeUndefined();
    await expect(fs.access(result.checksumsPath)).resolves.toBeUndefined();
    expect(result.bundlePath).toBe(path.resolve(bundlePath));
  });

  it('inspects healthy support bundles and verifies their inventory', async () => {
    const runtime = await createIsolatedRuntime();
    const volume = await runtime.volumeService.createVolume({ name: 'Inspect Bundle' });
    const bundlePath = path.join(runtime.config.dataDir, '..', 'inspected-support-bundle');
    const backupPath = path.join(runtime.config.dataDir, '..', 'inspected.sqlite');
    const currentLogPath = resolveAppLogFilePath(runtime.config);

    await runtime.volumeService.writeTextFile(volume.id, '/hello.txt', 'inspect me');
    await runtime.volumeService.backupVolume(volume.id, backupPath);
    await fs.mkdir(path.dirname(currentLogPath), { recursive: true });
    await fs.writeFile(currentLogPath, 'inspect support bundle log\n', 'utf8');

    await createSupportBundle(runtime, {
      destinationPath: bundlePath,
      volumeId: volume.id,
      backupPath,
    });

    const inspection = await inspectSupportBundle(bundlePath);

    expect(inspection).toMatchObject({
      healthy: true,
      bundlePath: path.resolve(bundlePath),
      manifestPath: path.join(path.resolve(bundlePath), 'manifest.json'),
      checksumsPath: path.join(path.resolve(bundlePath), 'checksums.json'),
      bundleVersion: 1,
      bundleCliVersion: APP_VERSION,
      bundleCorrelationId: runtime.correlationId,
      doctorIntegrityDepth: 'metadata',
      volumeId: volume.id,
      handoffReportPath: path.join(path.resolve(bundlePath), 'handoff-report.md'),
      issueCount: 0,
      expectedFiles: 7,
      verifiedFiles: 7,
      contentProfile: {
        redacted: false,
        includesAppLogSnapshot: true,
        includesAuditLogSnapshot: true,
        includesBackupInspection: true,
        includesBackupManifestCopy: true,
        sensitivity: 'restricted',
        sharingRecommendation: 'internal-only',
        recommendedRetentionDays: 7,
        sharingNotes: [
          'Runtime metadata and embedded reports are not redacted.',
          'Log snapshots are included and may contain sensitive operational context.',
          'A backup manifest copy is included for artifact correlation and recovery review.',
        ],
        disposalNotes: [
          'Delete this bundle after the incident or support escalation is closed.',
          'Purge embedded log snapshots together with the bundle; they are not intended for long-term archival.',
          'Remove the copied backup manifest together with the bundle to avoid stale recovery metadata.',
        ],
      },
      issues: [],
    });
    expect(Date.parse(inspection.bundleCreatedAt ?? '')).not.toBeNaN();
    expect(Date.parse(inspection.generatedAt)).not.toBeNaN();
  });

  it('reports checksum mismatches and missing files when a support bundle is tampered with', async () => {
    const runtime = await createIsolatedRuntime();
    const volume = await runtime.volumeService.createVolume({ name: 'Tampered Bundle' });
    const bundlePath = path.join(runtime.config.dataDir, '..', 'tampered-support-bundle');
    const currentLogPath = resolveAppLogFilePath(runtime.config);

    await runtime.volumeService.writeTextFile(volume.id, '/hello.txt', 'tamper target');
    await fs.mkdir(path.dirname(currentLogPath), { recursive: true });
    await fs.writeFile(currentLogPath, 'tampered support bundle log\n', 'utf8');

    const bundle = await createSupportBundle(runtime, {
      destinationPath: bundlePath,
      volumeId: volume.id,
    });

    await fs.appendFile(bundle.doctorReportPath, '\ncorrupted', 'utf8');
    await fs.rm(bundle.auditLogSnapshotPath!, { force: true });

    const inspection = await inspectSupportBundle(bundlePath);
    const issueCodes = inspection.issues.map(
      (issue: SupportBundleInspectionIssue) => issue.code,
    );

    expect(inspection.healthy).toBe(false);
    expect(inspection.expectedFiles).toBe(5);
    expect(inspection.verifiedFiles).toBe(4);
    expect(issueCodes).toContain('CHECKSUM_MISMATCH');
    expect(issueCodes).toContain('MISSING_BUNDLE_FILE');
  });

  it('flags support bundles that exceed their recommended retention window', async () => {
    const runtime = await createIsolatedRuntime({
      redactSensitiveDetails: true,
    });
    const volume = await runtime.volumeService.createVolume({ name: 'Expired Bundle' });
    const bundlePath = path.join(runtime.config.dataDir, '..', 'expired-support-bundle');

    await runtime.volumeService.writeTextFile(volume.id, '/hello.txt', 'retention');

    const bundle = await createSupportBundle(runtime, {
      destinationPath: bundlePath,
      volumeId: volume.id,
      includeLogs: false,
    });
    const manifest = JSON.parse(
      await fs.readFile(bundle.manifestPath, 'utf8'),
    ) as Record<string, unknown>;
    const checksumManifestPath = path.join(bundlePath, 'checksums.json');
    const checksumManifest = JSON.parse(
      await fs.readFile(checksumManifestPath, 'utf8'),
    ) as SupportBundleChecksumManifest;

    manifest.generatedAt = '2026-01-01T00:00:00.000Z';
    const serializedManifest = JSON.stringify(manifest, null, 2);
    await fs.writeFile(bundle.manifestPath, serializedManifest, 'utf8');

    const manifestRecord = checksumManifest.files.find((file) => file.role === 'manifest');
    expect(manifestRecord).toBeDefined();
    if (manifestRecord) {
      manifestRecord.bytes = Buffer.byteLength(serializedManifest, 'utf8');
      manifestRecord.checksumSha256 = createHash('sha256')
        .update(serializedManifest)
        .digest('hex');
    }

    await fs.writeFile(
      checksumManifestPath,
      JSON.stringify(checksumManifest, null, 2),
      'utf8',
    );

    const inspection = await inspectSupportBundle(bundlePath);
    const retentionIssue = inspection.issues.find(
      (issue: SupportBundleInspectionIssue) =>
        issue.code === 'RETENTION_WINDOW_EXCEEDED',
    );

    expect(inspection.healthy).toBe(false);
    expect(retentionIssue).toMatchObject({
      code: 'RETENTION_WINDOW_EXCEEDED',
      severity: 'warn',
    });
    expect(retentionIssue?.message).toContain('retention window');
  });

  it('inspects legacy support bundle manifests that do not include a content profile', async () => {
    const runtime = await createIsolatedRuntime({
      redactSensitiveDetails: true,
    });
    const volume = await runtime.volumeService.createVolume({ name: 'Legacy Bundle' });
    const bundlePath = path.join(runtime.config.dataDir, '..', 'legacy-profile-support-bundle');

    await runtime.volumeService.writeTextFile(volume.id, '/hello.txt', 'legacy');

    const bundle = await createSupportBundle(runtime, {
      destinationPath: bundlePath,
      volumeId: volume.id,
      includeLogs: false,
    });
    const manifest = JSON.parse(
      await fs.readFile(bundle.manifestPath, 'utf8'),
    ) as Record<string, unknown>;
    const checksumManifestPath = path.join(bundlePath, 'checksums.json');
    const checksumManifest = JSON.parse(
      await fs.readFile(checksumManifestPath, 'utf8'),
    ) as SupportBundleChecksumManifest;

    delete manifest.contentProfile;
    const serializedManifest = JSON.stringify(manifest, null, 2);
    await fs.writeFile(bundle.manifestPath, serializedManifest, 'utf8');

    const manifestRecord = checksumManifest.files.find((file) => file.role === 'manifest');
    expect(manifestRecord).toBeDefined();
    if (manifestRecord) {
      manifestRecord.bytes = Buffer.byteLength(serializedManifest, 'utf8');
      manifestRecord.checksumSha256 = createHash('sha256')
        .update(serializedManifest)
        .digest('hex');
    }

    await fs.writeFile(
      checksumManifestPath,
      JSON.stringify(checksumManifest, null, 2),
      'utf8',
    );

    const inspection = await inspectSupportBundle(bundlePath);

    expect(inspection.healthy).toBe(true);
    expect(inspection.doctorIntegrityDepth).toBe('metadata');
    expect(inspection.contentProfile).toMatchObject({
      redacted: true,
      includesAppLogSnapshot: false,
      includesAuditLogSnapshot: false,
      sensitivity: 'sanitized',
      sharingRecommendation: 'external-shareable',
      recommendedRetentionDays: 30,
    });
  });

  it('redacts sensitive runtime paths in support bundle metadata when configured', async () => {
    const runtime = await createIsolatedRuntime({
      redactSensitiveDetails: true,
      hostAllowPaths: ['C:\\allowed-root'],
      hostDenyPaths: ['C:\\blocked-root'],
    });
    const volume = await runtime.volumeService.createVolume({ name: 'Redacted Bundle' });
    const bundlePath = path.join(runtime.config.dataDir, '..', 'redacted-support-bundle');
    const backupPath = path.join(runtime.config.dataDir, '..', 'redacted.sqlite');
    const currentLogPath = resolveAppLogFilePath(runtime.config);

    await runtime.volumeService.writeTextFile(volume.id, '/hello.txt', 'redact me');
    await runtime.volumeService.backupVolume(volume.id, backupPath);
    await fs.mkdir(path.dirname(currentLogPath), { recursive: true });
    await fs.writeFile(currentLogPath, 'redacted support bundle log\n', 'utf8');

    const result = await createSupportBundle(runtime, {
      destinationPath: bundlePath,
      volumeId: volume.id,
      backupPath,
    });
    const backupInspectionReport = JSON.parse(
      await fs.readFile(result.backupInspectionReportPath!, 'utf8'),
    ) as {
      backupPath: string;
      manifestPath: string | null;
    };
    const checksumManifest = JSON.parse(
      await fs.readFile(result.checksumsPath, 'utf8'),
    ) as SupportBundleChecksumManifest;
    const auditLogRecord = findBundleFileRecord(checksumManifest.files, 'audit-log-snapshot');

    expect(result.backupPath).toMatch(/^<redacted:/u);
    expect(result.backupPath).not.toBe(path.resolve(backupPath));
    expect(result.config.redactSensitiveDetails).toBe(true);
    expect(result.contentProfile).toMatchObject({
      redacted: true,
      includesAppLogSnapshot: true,
      includesAuditLogSnapshot: true,
      includesBackupInspection: true,
      includesBackupManifestCopy: true,
      sensitivity: 'restricted',
      sharingRecommendation: 'internal-only',
      recommendedRetentionDays: 7,
    });
    expect(result.config.dataDir).toMatch(/^<redacted:/u);
    expect(result.config.logDir).toMatch(/^<redacted:/u);
    expect(result.config.auditLogDir).toMatch(/^<redacted:/u);
    expect(result.config.hostAllowPaths[0]).toMatch(/^<redacted:/u);
    expect(result.config.hostDenyPaths[0]).toMatch(/^<redacted:/u);
    expect(result.environment.cwd).toMatch(/^<redacted:/u);
    expect(result.environment.hostname).toMatch(/^<redacted:/u);
    expect(backupInspectionReport.backupPath).toMatch(/^<redacted:/u);
    expect(backupInspectionReport.manifestPath).toMatch(/^<redacted:/u);
    expect(auditLogRecord?.sourcePath).toMatch(/^<redacted:/u);
  });
});
