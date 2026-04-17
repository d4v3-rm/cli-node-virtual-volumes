import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createRuntime } from '../src/bootstrap/create-runtime.js';
import type { AppRuntime } from '../src/bootstrap/create-runtime.js';
import { resolveAppLogFilePath, resolveAuditLogFilePath } from '../src/logging/logger.js';
import { runRestoreDrill } from '../src/ops/restore-drill.js';

const sandboxes: string[] = [];
const runtimes: AppRuntime[] = [];

vi.setConfig({
  hookTimeout: 20000,
  testTimeout: 20000,
});

const createIsolatedRuntime = async (
  overrides: Parameters<typeof createRuntime>[0] = {},
) => {
  const sandboxRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'cli-node-virtual-volumes-audit-'));
  sandboxes.push(sandboxRoot);

  const runtime = await createRuntime({
    dataDir: path.join(sandboxRoot, 'data'),
    logDir: path.join(sandboxRoot, 'logs'),
    logLevel: 'silent',
    auditLogLevel: 'info',
    logToStdout: false,
    ...overrides,
  });
  runtimes.push(runtime);

  return runtime;
};

const readJsonLogEntries = async (logPath: string): Promise<Record<string, unknown>[]> => {
  const raw = await fs.readFile(logPath, 'utf8');

  return raw
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
};

afterEach(async () => {
  await Promise.all(runtimes.splice(0, runtimes.length).map((runtime) => runtime.close()));
  await Promise.all(
    sandboxes.splice(0, sandboxes.length).map((sandboxRoot) =>
      fs.rm(sandboxRoot, { recursive: true, force: true }),
    ),
  );
});

describe('audit log', () => {
  it('records structured success entries for core volume operations', async () => {
    const runtime = await createIsolatedRuntime();
    const hostRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'cli-node-virtual-volumes-audit-host-'));
    sandboxes.push(hostRoot);
    const importHostPath = path.join(hostRoot, 'import.txt');
    const exportRoot = path.join(hostRoot, 'exports');

    await fs.writeFile(importHostPath, 'host import payload', 'utf8');

    const volume = await runtime.volumeService.createVolume({ name: 'Audit Trail' });
    await runtime.volumeService.createDirectory(volume.id, '/', 'docs');
    await runtime.volumeService.writeTextFile(volume.id, '/docs/notes.txt', 'initial notes');
    await runtime.volumeService.importHostPaths(volume.id, {
      destinationPath: '/',
      hostPaths: [importHostPath],
    });
    await runtime.volumeService.exportEntryToHost(volume.id, {
      sourcePath: '/import.txt',
      destinationHostDirectory: exportRoot,
    });
    await runtime.volumeService.compactVolume(volume.id);
    await runtime.volumeService.compactRecommendedVolumes({ dryRun: true });
    await runtime.volumeService.moveEntry(volume.id, {
      sourcePath: '/docs/notes.txt',
      destinationDirectoryPath: '/',
      newName: 'notes-root.txt',
    });
    await runtime.volumeService.deleteEntry(volume.id, '/notes-root.txt');
    await runtime.volumeService.runDoctor(volume.id);
    await runtime.volumeService.deleteVolume(volume.id);

    const auditLogPath = resolveAuditLogFilePath(runtime.config);
    const entries = await readJsonLogEntries(auditLogPath);
    const successEventTypes = entries
      .filter((entry) => entry.outcome === 'success')
      .map((entry) => entry.eventType);

    expect(successEventTypes).toEqual(
      expect.arrayContaining([
        'volume.create',
        'entry.directory.create',
        'entry.file.write',
        'host.import',
        'host.export',
        'volume.compact',
        'volume.compact.batch',
        'entry.move',
        'entry.delete',
        'storage.doctor',
        'volume.delete',
      ]),
    );
    expect(
      entries.every(
        (entry) =>
          entry.category === 'audit' &&
          typeof entry.operationId === 'string' &&
          typeof entry.resourceType === 'string',
      ),
    ).toBe(true);
  });

  it('uses the same correlation id across application and audit logs', async () => {
    const correlationId = 'corr_test-runtime';
    const runtime = await createIsolatedRuntime({
      logLevel: 'info',
      auditLogLevel: 'info',
      correlationId,
      logToStdout: false,
    });

    await runtime.volumeService.createVolume({ name: 'Correlation Trace' });
    await runtime.close();

    const appEntries = await readJsonLogEntries(resolveAppLogFilePath(runtime.config));
    const auditEntries = await readJsonLogEntries(resolveAuditLogFilePath(runtime.config));

    expect(appEntries.some((entry) => entry.correlationId === correlationId)).toBe(true);
    expect(
      auditEntries.some(
        (entry) =>
          entry.correlationId === correlationId &&
          entry.eventType === 'volume.create' &&
          entry.outcome === 'success',
      ),
    ).toBe(true);
    expect(auditEntries.every((entry) => entry.correlationId === correlationId)).toBe(true);
  });

  it('records structured failure entries for rejected operations', async () => {
    const runtime = await createIsolatedRuntime();
    const volume = await runtime.volumeService.createVolume({ name: 'Audit Failures' });

    await expect(
      runtime.volumeService.deleteEntry(volume.id, '/missing.txt'),
    ).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });

    const auditLogPath = resolveAuditLogFilePath(runtime.config);
    const entries = await readJsonLogEntries(auditLogPath);
    const failedDeleteEntry = entries.find(
      (entry) =>
        entry.eventType === 'entry.delete' &&
        entry.outcome === 'failure' &&
        typeof entry.error === 'object' &&
        entry.error !== null,
    ) as { error: { code?: string; message?: string } } | undefined;

    expect(failedDeleteEntry).toBeDefined();
    expect(failedDeleteEntry?.error.code).toBe('NOT_FOUND');
    expect(failedDeleteEntry?.error.message).toContain('/missing.txt');
  });

  it('redacts sensitive host paths in app and audit logs when configured', async () => {
    const runtime = await createIsolatedRuntime({
      logLevel: 'info',
      auditLogLevel: 'info',
      redactSensitiveDetails: true,
    });
    const hostRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'cli-node-virtual-volumes-audit-host-'));
    sandboxes.push(hostRoot);
    const importHostPath = path.join(hostRoot, 'import.txt');
    const exportRoot = path.join(hostRoot, 'exports');

    await fs.writeFile(importHostPath, 'host import payload', 'utf8');

    const volume = await runtime.volumeService.createVolume({ name: 'Audit Redaction' });
    await runtime.volumeService.importHostPaths(volume.id, {
      destinationPath: '/',
      hostPaths: [importHostPath],
    });
    await runtime.volumeService.exportEntryToHost(volume.id, {
      sourcePath: '/import.txt',
      destinationHostDirectory: exportRoot,
    });
    await runtime.close();

    const auditEntries = await readJsonLogEntries(resolveAuditLogFilePath(runtime.config));
    const appLogRaw = await fs.readFile(resolveAppLogFilePath(runtime.config), 'utf8');
    const hostImportEntry = auditEntries.find(
      (entry) => entry.eventType === 'host.import' && entry.outcome === 'success',
    ) as { details?: { hostPathsPreview?: string[] } } | undefined;
    const hostExportEntry = auditEntries.find(
      (entry) => entry.eventType === 'host.export' && entry.outcome === 'success',
    ) as { details?: { destinationHostDirectory?: string } } | undefined;

    expect(hostImportEntry?.details?.hostPathsPreview?.[0]).toMatch(/^<redacted:/u);
    expect(hostImportEntry?.details?.hostPathsPreview?.[0]).not.toBe(importHostPath);
    expect(hostExportEntry?.details?.destinationHostDirectory).toMatch(/^<redacted:/u);
    expect(appLogRaw).toContain('<redacted:');
    expect(appLogRaw).not.toContain(importHostPath);
    expect(appLogRaw).not.toContain(exportRoot);
  });

  it('records structured success entries for restore drills', async () => {
    const runtime = await createIsolatedRuntime();
    const volume = await runtime.volumeService.createVolume({ name: 'Audit Drill' });
    const backupPath = path.join(runtime.config.dataDir, '..', 'audit-drill.sqlite');

    await runtime.volumeService.writeTextFile(volume.id, '/payload.txt', 'audit drill');
    await runtime.volumeService.backupVolume(volume.id, backupPath);
    await runRestoreDrill(runtime, { backupPath });

    const auditEntries = await readJsonLogEntries(resolveAuditLogFilePath(runtime.config));
    const restoreDrillEntry = auditEntries.find(
      (entry) =>
        entry.eventType === 'volume.restore.drill' &&
        entry.outcome === 'success',
    ) as
      | {
          backupPath?: string;
          issueCount?: number;
          keptSandbox?: boolean;
          resourceType?: string;
          volumeId?: string;
        }
      | undefined;

    expect(restoreDrillEntry).toBeDefined();
    expect(restoreDrillEntry?.resourceType).toBe('backup');
    expect(restoreDrillEntry?.volumeId).toBe(volume.id);
    expect(restoreDrillEntry?.backupPath).toBe(path.resolve(backupPath));
    expect(restoreDrillEntry?.issueCount).toBe(0);
    expect(restoreDrillEntry?.keptSandbox).toBe(false);
  });
});
