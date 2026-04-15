import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createRuntime } from '../src/bootstrap/create-runtime.js';
import type { AppRuntime } from '../src/bootstrap/create-runtime.js';
import { APP_VERSION } from '../src/config/app-metadata.js';
import { resolveAppLogFilePath, resolveAuditLogFilePath } from '../src/logging/logger.js';
import { createSupportBundle, inspectSupportBundle } from '../src/ops/support-bundle.js';
import type {
  SupportBundleChecksumManifest,
  SupportBundleFileRecord,
  SupportBundleInspectionIssue,
} from '../src/domain/types.js';

const sandboxes: string[] = [];
const runtimes: AppRuntime[] = [];

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
    const copiedBackupManifest = JSON.parse(
      await fs.readFile(result.backupManifestCopyPath!, 'utf8'),
    ) as {
      volumeId: string;
      checksumSha256: string;
    };

    expect(result.bundleVersion).toBe(1);
    expect(result.cliVersion).toBe(APP_VERSION);
    expect(result.correlationId).toBe(runtime.correlationId);
    expect(result.config.logRetentionDays).toBeNull();
    expect(result.config.redactSensitiveDetails).toBe(false);
    expect(result.bundlePath).toBe(path.resolve(bundlePath));
    expect(result.backupPath).toBe(path.resolve(backupPath));
    expect(result.volumeId).toBe(volume.id);
    expect(result.checkedVolumes).toBe(1);
    expect(result.issueCount).toBe(0);
    expect(result.backupInspectionReportPath).not.toBeNull();
    expect(result.backupManifestCopyPath).not.toBeNull();
    expect(result.checksumsPath).toBe(
      path.join(path.resolve(bundlePath), 'checksums.json'),
    );
    expect(result.auditLogSnapshotPath).not.toBeNull();
    expect(result.logSnapshotPath).not.toBeNull();
    expect(await fs.readFile(result.auditLogSnapshotPath!, 'utf8')).toContain(
      '"eventType":"volume.create"',
    );
    expect(await fs.readFile(result.logSnapshotPath!, 'utf8')).toContain(
      'support bundle log',
    );
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
    expect(checksumManifest.files).toHaveLength(6);
    const manifestRecord = findBundleFileRecord(checksumManifest.files, 'manifest');
    const doctorRecord = findBundleFileRecord(checksumManifest.files, 'doctor-report');
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
    expect(findBundleFileRecord(checksumManifest.files, 'log-snapshot')).toBeUndefined();
    expect(
      findBundleFileRecord(checksumManifest.files, 'audit-log-snapshot'),
    ).toBeUndefined();
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
      volumeId: volume.id,
      issueCount: 0,
      expectedFiles: 6,
      verifiedFiles: 6,
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
    expect(inspection.expectedFiles).toBe(4);
    expect(inspection.verifiedFiles).toBe(3);
    expect(issueCodes).toContain('CHECKSUM_MISMATCH');
    expect(issueCodes).toContain('MISSING_BUNDLE_FILE');
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
