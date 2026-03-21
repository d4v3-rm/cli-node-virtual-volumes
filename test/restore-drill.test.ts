import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createRuntime } from '../src/bootstrap/create-runtime.js';
import type { AppRuntime } from '../src/bootstrap/create-runtime.js';
import { runRestoreDrill } from '../src/ops/restore-drill.js';

const sandboxes: string[] = [];
const runtimes: AppRuntime[] = [];

const createIsolatedRuntime = async (
  overrides: Parameters<typeof createRuntime>[0] = {},
) => {
  const sandboxRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), 'cli-node-virtual-volumes-restore-drill-'),
  );
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

afterEach(async () => {
  await Promise.all(runtimes.splice(0, runtimes.length).map((runtime) => runtime.close()));
  await Promise.all(
    sandboxes.splice(0, sandboxes.length).map((sandboxRoot) =>
      fs.rm(sandboxRoot, { recursive: true, force: true }),
    ),
  );
});

describe('restore drill', () => {
  it('runs inspect, restore, and doctor in an isolated sandbox and cleans it by default', async () => {
    const runtime = await createIsolatedRuntime();
    const volume = await runtime.volumeService.createVolume({ name: 'Drill Finance' });
    const backupPath = path.join(runtime.config.dataDir, '..', 'drill-finance.sqlite');

    await runtime.volumeService.createDirectory(volume.id, '/', 'docs');
    await runtime.volumeService.writeTextFile(volume.id, '/docs/plan.txt', 'restore drill payload');

    const backup = await runtime.volumeService.backupVolume(volume.id, backupPath);
    const result = await runRestoreDrill(runtime, { backupPath });

    expect(result.healthy).toBe(true);
    expect(result.backupPath).toBe(path.resolve(backupPath));
    expect(result.keptSandbox).toBe(false);
    expect(result.sandboxPath).toBeNull();
    expect(result.inspection.checksumSha256).toBe(backup.checksumSha256);
    expect(result.restore.volumeId).toBe(volume.id);
    expect(result.restore.volumeName).toBe('Drill Finance');
    expect(result.restore.validatedWithManifest).toBe(true);
    expect(result.doctor.healthy).toBe(true);
    expect(result.doctor.issueCount).toBe(0);
  });

  it('preserves the sandbox when requested so operators can inspect drill artifacts', async () => {
    const runtime = await createIsolatedRuntime();
    const volume = await runtime.volumeService.createVolume({ name: 'Drill Preserve' });
    const backupPath = path.join(runtime.config.dataDir, '..', 'drill-preserve.sqlite');

    await runtime.volumeService.writeTextFile(volume.id, '/payload.txt', 'preserve sandbox');

    await runtime.volumeService.backupVolume(volume.id, backupPath);
    const result = await runRestoreDrill(runtime, {
      backupPath,
      keepSandbox: true,
    });

    expect(result.healthy).toBe(true);
    expect(result.keptSandbox).toBe(true);
    expect(result.sandboxPath).not.toBeNull();
    expect((await fs.stat(result.sandboxPath!)).isDirectory()).toBe(true);
    expect(
      (await fs.stat(path.join(result.sandboxPath!, 'data', 'volumes'))).isDirectory(),
    ).toBe(true);

    sandboxes.push(result.sandboxPath!);
  });
});
