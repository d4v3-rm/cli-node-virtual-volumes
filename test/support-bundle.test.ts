import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createRuntime } from '../src/bootstrap/create-runtime.js';
import { APP_VERSION } from '../src/config/app-metadata.js';
import { resolveAppLogFilePath } from '../src/logging/logger.js';
import { createSupportBundle } from '../src/ops/support-bundle.js';

const sandboxes: string[] = [];

const createIsolatedRuntime = async () => {
  const sandboxRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), 'cli-node-virtual-volumes-support-bundle-'),
  );
  sandboxes.push(sandboxRoot);

  return createRuntime({
    dataDir: path.join(sandboxRoot, 'data'),
    logDir: path.join(sandboxRoot, 'logs'),
    logLevel: 'silent',
    logToStdout: false,
  });
};

afterEach(async () => {
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

    expect(result.bundleVersion).toBe(1);
    expect(result.cliVersion).toBe(APP_VERSION);
    expect(result.bundlePath).toBe(path.resolve(bundlePath));
    expect(result.backupPath).toBe(path.resolve(backupPath));
    expect(result.volumeId).toBe(volume.id);
    expect(result.checkedVolumes).toBe(1);
    expect(result.issueCount).toBe(0);
    expect(result.backupInspectionReportPath).not.toBeNull();
    expect(result.logSnapshotPath).not.toBeNull();
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
    expect(result.bundlePath).toBe(path.resolve(bundlePath));
  });
});
