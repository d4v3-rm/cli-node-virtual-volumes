#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const distCliPath = path.join(rootDir, 'dist', 'index.js');
const distLibPath = path.join(rootDir, 'dist', 'lib.js');
const packageJsonPath = path.join(rootDir, 'package.json');

const assert = (condition, message) => {
  if (!condition) {
    throw new Error(message);
  }
};

const pathExists = async (targetPath) => {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
};

const readJson = async (filePath) =>
  JSON.parse(await fs.readFile(filePath, 'utf8'));

const runCli = (args, runtimePaths) => {
  const result = spawnSync(
    process.execPath,
    [
      distCliPath,
      '--data-dir',
      runtimePaths.dataDir,
      '--log-dir',
      runtimePaths.logDir,
      '--log-level',
      'silent',
      ...args,
    ],
    {
      cwd: rootDir,
      encoding: 'utf8',
      env: {
        ...process.env,
        NO_COLOR: '1',
      },
    },
  );

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(
      [
        `CLI command failed: virtual-volumes ${args.join(' ')}`,
        result.stdout.trim(),
        result.stderr.trim(),
      ]
        .filter(Boolean)
        .join('\n'),
    );
  }

  return {
    stdout: result.stdout.trim(),
    stderr: result.stderr.trim(),
  };
};

const assertArtifactEnvelope = (artifact, expectedCommand, expectedVersion) => {
  assert(
    artifact && typeof artifact === 'object',
    `Artifact for ${expectedCommand} must be a JSON object.`,
  );
  assert(
    artifact.command === expectedCommand,
    `Artifact command mismatch for ${expectedCommand}.`,
  );
  assert(
    artifact.cliVersion === expectedVersion,
    `Artifact CLI version mismatch for ${expectedCommand}.`,
  );
  assert(
    typeof artifact.generatedAt === 'string' &&
      !Number.isNaN(Date.parse(artifact.generatedAt)),
    `Artifact generatedAt is invalid for ${expectedCommand}.`,
  );
  assert(
    typeof artifact.correlationId === 'string' &&
      artifact.correlationId.length > 0,
    `Artifact correlationId is missing for ${expectedCommand}.`,
  );
  assert(
    Object.hasOwn(artifact, 'payload'),
    `Artifact payload missing for ${expectedCommand}.`,
  );
};

let sandboxRoot = null;
let runtime = null;
let validationRuntime = null;

try {
  const packageJson = await readJson(packageJsonPath);
  assert(
    (await pathExists(distCliPath)) && (await pathExists(distLibPath)),
    'Run npm run build before npm run smoke:ops.',
  );

  const { createRuntime } = await import(pathToFileURL(distLibPath).href);

  sandboxRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), 'virtual-volumes-ops-smoke-'),
  );

  const runtimePaths = {
    dataDir: path.join(sandboxRoot, 'data'),
    logDir: path.join(sandboxRoot, 'logs'),
  };
  const backupsDir = path.join(sandboxRoot, 'backups');
  const reportsDir = path.join(sandboxRoot, 'reports');

  await fs.mkdir(backupsDir, { recursive: true });
  await fs.mkdir(reportsDir, { recursive: true });

  runtime = await createRuntime({
    dataDir: runtimePaths.dataDir,
    logDir: runtimePaths.logDir,
    logLevel: 'silent',
  });

  const volume = await runtime.volumeService.createVolume({
    name: 'Recovery Smoke',
    description: 'Operational smoke test for backup and restore flows.',
  });
  await runtime.volumeService.writeTextFile(
    volume.id,
    '/baseline.txt',
    'enterprise smoke baseline',
  );

  const backupPath = path.join(backupsDir, 'recovery-smoke.sqlite');
  const backupReportPath = path.join(reportsDir, 'backup-report.json');
  const backupRun = runCli(
    ['backup', volume.id, backupPath, '--json', '--output', backupReportPath],
    runtimePaths,
  );
  const backupResult = JSON.parse(backupRun.stdout);
  const backupArtifact = await readJson(backupReportPath);
  const backupManifestPath = `${path.resolve(backupPath)}.manifest.json`;

  assert(
    backupResult.volumeId === volume.id,
    'Backup stdout payload should include the requested volume id.',
  );
  assert(
    !Object.hasOwn(backupResult, 'command'),
    'Backup stdout payload must remain the raw result object.',
  );
  assertArtifactEnvelope(backupArtifact, 'backup', packageJson.version);
  assert(
    backupArtifact.payload.backupPath === path.resolve(backupPath),
    'Backup artifact should point to the snapshot path.',
  );
  assert(await pathExists(backupPath), 'Backup snapshot was not created.');
  assert(
    await pathExists(backupManifestPath),
    'Backup manifest sidecar was not created.',
  );

  const inspectReportPath = path.join(reportsDir, 'inspect-report.json');
  const inspectRun = runCli(
    ['inspect-backup', backupPath, '--json', '--output', inspectReportPath],
    runtimePaths,
  );
  const inspectResult = JSON.parse(inspectRun.stdout);
  const inspectArtifact = await readJson(inspectReportPath);

  assert(
    inspectResult.validatedWithManifest === true,
    'Backup inspection should validate the sidecar manifest.',
  );
  assertArtifactEnvelope(
    inspectArtifact,
    'inspect-backup',
    packageJson.version,
  );
  assert(
    inspectArtifact.payload.checksumSha256 === backupArtifact.payload.checksumSha256,
    'Inspection artifact should match the backup checksum.',
  );

  const restoreDrillReportPath = path.join(reportsDir, 'restore-drill-report.json');
  const restoreDrillRun = runCli(
    ['restore-drill', backupPath, '--json', '--output', restoreDrillReportPath],
    runtimePaths,
  );
  const restoreDrillResult = JSON.parse(restoreDrillRun.stdout);
  const restoreDrillArtifact = await readJson(restoreDrillReportPath);

  assert(
    restoreDrillResult.healthy === true,
    'Restore drill should report a healthy isolated restore.',
  );
  assertArtifactEnvelope(
    restoreDrillArtifact,
    'restore-drill',
    packageJson.version,
  );
  assert(
    restoreDrillArtifact.payload.restore.volumeId === volume.id,
    'Restore drill artifact should report the restored volume id.',
  );
  assert(
    restoreDrillArtifact.payload.sandboxPath === null,
    'Restore drill should clean its sandbox by default.',
  );

  await runtime.volumeService.deleteVolume(volume.id);

  const restoreReportPath = path.join(reportsDir, 'restore-report.json');
  const restoreRun = runCli(
    ['restore', backupPath, '--json', '--output', restoreReportPath],
    runtimePaths,
  );
  const restoreResult = JSON.parse(restoreRun.stdout);
  const restoreArtifact = await readJson(restoreReportPath);

  assert(
    restoreResult.volumeId === volume.id,
    'Restore stdout payload should recreate the same volume id.',
  );
  assertArtifactEnvelope(restoreArtifact, 'restore', packageJson.version);
  assert(
    restoreArtifact.payload.validatedWithManifest === true,
    'Restore artifact should record manifest validation.',
  );

  validationRuntime = await createRuntime({
    dataDir: runtimePaths.dataDir,
    logDir: runtimePaths.logDir,
    logLevel: 'silent',
  });
  const preview = await validationRuntime.volumeService.previewFile(
    volume.id,
    '/baseline.txt',
  );
  assert(
    preview.content.includes('enterprise smoke baseline'),
    'Restored volume content did not match the backup snapshot.',
  );

  const compactReportPath = path.join(reportsDir, 'compact-report.json');
  const compactRun = runCli(
    ['compact', volume.id, '--json', '--output', compactReportPath],
    runtimePaths,
  );
  const compactResult = JSON.parse(compactRun.stdout);
  const compactArtifact = await readJson(compactReportPath);

  assert(
    compactResult.volumeId === volume.id,
    'Compaction stdout payload should target the restored volume.',
  );
  assertArtifactEnvelope(compactArtifact, 'compact', packageJson.version);
  assert(
    compactArtifact.payload.volumeId === volume.id,
    'Compaction artifact should target the restored volume.',
  );
  assert(
    Number.isInteger(compactArtifact.payload.bytesBefore) &&
      compactArtifact.payload.bytesBefore >= 0,
    'Compaction artifact should report a non-negative bytesBefore value.',
  );
  assert(
    Number.isInteger(compactArtifact.payload.bytesAfter) &&
      compactArtifact.payload.bytesAfter >= 0,
    'Compaction artifact should report a non-negative bytesAfter value.',
  );
  assert(
    compactArtifact.payload.reclaimedBytes ===
      Math.max(
        0,
        compactArtifact.payload.bytesBefore - compactArtifact.payload.bytesAfter,
      ),
    'Compaction artifact should report reclaimed bytes consistently.',
  );

  const doctorReportPath = path.join(reportsDir, 'doctor-report.json');
  const doctorRun = runCli(
    ['doctor', volume.id, '--output', doctorReportPath],
    runtimePaths,
  );
  const doctorArtifact = await readJson(doctorReportPath);

  assert(
    doctorRun.stdout.includes('Storage doctor: HEALTHY'),
    'Doctor human output should report a healthy volume.',
  );
  assert(
    doctorRun.stdout.includes(`Artifact path: ${path.resolve(doctorReportPath)}`),
    'Doctor human output should mention the artifact path.',
  );
  assert(
    doctorRun.stdout.includes(`Correlation ID: ${doctorArtifact.correlationId}`),
    'Doctor human output should mention the correlation id.',
  );
  assertArtifactEnvelope(doctorArtifact, 'doctor', packageJson.version);
  assert(
    doctorArtifact.payload.healthy === true,
    'Doctor artifact should report a healthy volume.',
  );

  const repairReportPath = path.join(reportsDir, 'repair-report.json');
  const repairRun = runCli(
    ['doctor', volume.id, '--fix', '--json', '--output', repairReportPath],
    runtimePaths,
  );
  const repairResult = JSON.parse(repairRun.stdout);
  const repairArtifact = await readJson(repairReportPath);

  assert(
    repairResult.healthy === true,
    'Doctor --fix should remain healthy on a clean volume.',
  );
  assertArtifactEnvelope(repairArtifact, 'doctor --fix', packageJson.version);

  const currentLogPath = path.join(
    runtimePaths.logDir,
    `cli-node-virtual-volumes-${new Date().toISOString().slice(0, 10)}.log`,
  );
  await fs.mkdir(path.dirname(currentLogPath), { recursive: true });
  await fs.writeFile(currentLogPath, 'ops smoke log\n', { flag: 'a' });

  const supportBundlePath = path.join(sandboxRoot, 'support-bundle');
  const supportBundleSummaryPath = path.join(
    reportsDir,
    'support-bundle-summary.json',
  );
  const supportBundleRun = runCli(
    [
      'support-bundle',
      supportBundlePath,
      volume.id,
      '--backup-path',
      backupPath,
      '--json',
      '--output',
      supportBundleSummaryPath,
    ],
    runtimePaths,
  );
  const supportBundleResult = JSON.parse(supportBundleRun.stdout);
  const supportBundleManifest = await readJson(
    path.join(supportBundlePath, 'manifest.json'),
  );
  const supportBundleArtifact = await readJson(supportBundleSummaryPath);

  assert(
    supportBundleResult.bundlePath === path.resolve(supportBundlePath),
    'Support bundle stdout should point to the generated bundle path.',
  );
  assertArtifactEnvelope(
    supportBundleArtifact,
    'support-bundle',
    packageJson.version,
  );
  assert(
    supportBundleArtifact.payload.checksumsPath ===
      path.join(path.resolve(supportBundlePath), 'checksums.json'),
    'Support bundle artifact should include the checksum inventory path.',
  );
  assert(
    supportBundleManifest.correlationId === supportBundleArtifact.correlationId,
    'Support bundle manifest should reuse the command correlation id.',
  );
  assert(
    supportBundleManifest.doctorReportPath ===
      path.join(path.resolve(supportBundlePath), 'doctor-report.json'),
    'Support bundle manifest should include the doctor report path.',
  );
  assert(
    supportBundleManifest.backupInspectionReportPath ===
      path.join(path.resolve(supportBundlePath), 'backup-inspection.json'),
    'Support bundle manifest should include the backup inspection path.',
  );
  assert(
    supportBundleManifest.backupManifestCopyPath ===
      path.join(path.resolve(supportBundlePath), 'backup-artifact.manifest.json'),
    'Support bundle manifest should include the copied backup manifest path.',
  );
  assert(
    supportBundleManifest.checksumsPath ===
      path.join(path.resolve(supportBundlePath), 'checksums.json'),
    'Support bundle manifest should include the checksum inventory path.',
  );
  assert(
    supportBundleManifest.auditLogSnapshotPath ===
      path.join(
        path.resolve(supportBundlePath),
        'audit',
        `cli-node-virtual-volumes-audit-${new Date().toISOString().slice(0, 10)}.log`,
      ),
    'Support bundle manifest should include the copied audit log snapshot.',
  );
  assert(
    supportBundleManifest.logSnapshotPath ===
      path.join(
        path.resolve(supportBundlePath),
        'logs',
        path.basename(currentLogPath),
      ),
    'Support bundle manifest should include the copied log snapshot.',
  );
  assert(
    await pathExists(supportBundleManifest.doctorReportPath),
    'Support bundle doctor report was not created.',
  );
  assert(
    await pathExists(supportBundleManifest.handoffReportPath),
    'Support bundle handoff report was not created.',
  );
  assert(
    await pathExists(supportBundleManifest.backupInspectionReportPath),
    'Support bundle backup inspection report was not created.',
  );
  assert(
    await pathExists(supportBundleManifest.backupManifestCopyPath),
    'Support bundle backup manifest copy was not created.',
  );
  assert(
    await pathExists(supportBundleManifest.checksumsPath),
    'Support bundle checksum inventory was not created.',
  );
  assert(
    await pathExists(supportBundleManifest.auditLogSnapshotPath),
    'Support bundle audit log snapshot was not created.',
  );
  assert(
    await pathExists(supportBundleManifest.logSnapshotPath),
    'Support bundle log snapshot was not created.',
  );
  const checksumManifest = await readJson(supportBundleManifest.checksumsPath);
  assert(
    Array.isArray(checksumManifest.files) && checksumManifest.files.length >= 7,
    'Support bundle checksum inventory should include the generated bundle files.',
  );

  const supportBundleInspectionPath = path.join(
    reportsDir,
    'support-bundle-inspection.json',
  );
  const supportBundleInspectRun = runCli(
    [
      'inspect-support-bundle',
      supportBundlePath,
      '--require-sharing',
      'internal-only',
      '--json',
      '--output',
      supportBundleInspectionPath,
    ],
    runtimePaths,
  );
  const supportBundleInspection = JSON.parse(supportBundleInspectRun.stdout);
  const supportBundleInspectionArtifact = await readJson(
    supportBundleInspectionPath,
  );

  assert(
    supportBundleInspection.healthy === true,
    'Support bundle inspection should report a healthy bundle.',
  );
  assert(
    supportBundleInspection.contentProfile?.sharingRecommendation === 'internal-only',
    'Support bundle inspection should expose the expected sharing recommendation.',
  );
  assertArtifactEnvelope(
    supportBundleInspectionArtifact,
    'inspect-support-bundle',
    packageJson.version,
  );
  assert(
    supportBundleInspectionArtifact.payload.verifiedFiles >= 6,
    'Support bundle inspection artifact should report verified bundle files.',
  );
  assert(
    supportBundleInspectionArtifact.payload.bundleCorrelationId ===
      supportBundleManifest.correlationId,
    'Support bundle inspection should expose the bundle correlation id.',
  );

  process.stdout.write(
    `[ops-smoke] verified backup, inspect, restore drill, restore, doctor, support bundle, and support bundle inspection flows for ${volume.id}\n`,
  );
} catch (error) {
  const message = error instanceof Error ? error.message : 'Unknown smoke failure.';
  if (sandboxRoot) {
    process.stderr.write(`[ops-smoke] sandbox preserved at ${sandboxRoot}\n`);
  }
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
} finally {
  if (validationRuntime) {
    await validationRuntime.close().catch(() => undefined);
  }
  if (runtime) {
    await runtime.close().catch(() => undefined);
  }
  if (sandboxRoot) {
    await fs.rm(sandboxRoot, { recursive: true, force: true }).catch(() => undefined);
  }
}
