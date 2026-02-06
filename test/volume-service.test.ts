import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createRuntime } from '../src/bootstrap/create-runtime.js';

const sandboxes: string[] = [];

const createIsolatedRuntime = async () => {
  const sandboxRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'virtual-volumes-'));
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

describe('VolumeService', () => {
  it('creates volumes, directories and explorer snapshots', async () => {
    const runtime = await createIsolatedRuntime();
    const volume = await runtime.volumeService.createVolume({
      name: 'Contracts',
      description: 'Legal docs',
    });

    await runtime.volumeService.createDirectory(volume.id, '/', 'contracts');

    const snapshot = await runtime.volumeService.getExplorerSnapshot(volume.id, '/');

    expect(snapshot.volume.name).toBe('Contracts');
    expect(snapshot.entries.map((entry) => entry.name)).toEqual(['contracts']);
    expect(snapshot.volume.entryCount).toBe(2);
  });

  it('writes text files through the Node API and previews them', async () => {
    const runtime = await createIsolatedRuntime();
    const volume = await runtime.volumeService.createVolume({ name: 'Notes' });

    await runtime.volumeService.writeTextFile(volume.id, '/todo.txt', 'hello world');
    await runtime.volumeService.writeTextFile(
      volume.id,
      '/todo.txt',
      'updated from node api',
    );

    const preview = await runtime.volumeService.previewFile(volume.id, '/todo.txt');
    const snapshot = await runtime.volumeService.getExplorerSnapshot(volume.id, '/');

    expect(preview.kind).toBe('text');
    expect(preview.content).toContain('updated from node api');
    expect(snapshot.entries).toHaveLength(1);
    expect(snapshot.entries[0]?.name).toBe('todo.txt');
  });

  it('imports host files and directories in batch and resolves name conflicts', async () => {
    const runtime = await createIsolatedRuntime();
    const volume = await runtime.volumeService.createVolume({ name: 'Imports' });
    const hostRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'virtual-host-'));
    sandboxes.push(hostRoot);

    const bundleRoot = path.join(hostRoot, 'bundle');
    await fs.mkdir(bundleRoot, { recursive: true });
    await fs.writeFile(path.join(hostRoot, 'alpha.txt'), 'alpha');
    await fs.writeFile(path.join(bundleRoot, 'nested.txt'), 'nested');
    await runtime.volumeService.createDirectory(volume.id, '/', 'imports');

    const summary = await runtime.volumeService.importHostPaths(volume.id, {
      destinationPath: '/imports',
      hostPaths: [
        path.join(hostRoot, 'alpha.txt'),
        bundleRoot,
        path.join(hostRoot, 'alpha.txt'),
      ],
    });

    const snapshot = await runtime.volumeService.getExplorerSnapshot(
      volume.id,
      '/imports',
    );

    expect(summary.filesImported).toBe(3);
    expect(summary.directoriesImported).toBe(1);
    expect(summary.conflictsResolved).toBe(1);
    expect(snapshot.entries.map((entry) => entry.name)).toEqual([
      'bundle',
      'alpha (2).txt',
      'alpha.txt',
    ]);
  });

  it('prevents moving a directory into one of its descendants', async () => {
    const runtime = await createIsolatedRuntime();
    const volume = await runtime.volumeService.createVolume({ name: 'Move Guard' });

    await runtime.volumeService.createDirectory(volume.id, '/', 'a');
    await runtime.volumeService.createDirectory(volume.id, '/a', 'b');

    await expect(
      runtime.volumeService.moveEntry(volume.id, {
        sourcePath: '/a',
        destinationDirectoryPath: '/a/b',
      }),
    ).rejects.toMatchObject({
      code: 'INVALID_OPERATION',
    });
  });

  it('deletes directory subtrees recursively', async () => {
    const runtime = await createIsolatedRuntime();
    const volume = await runtime.volumeService.createVolume({ name: 'Cleanup' });

    await runtime.volumeService.createDirectory(volume.id, '/', 'docs');
    await runtime.volumeService.writeTextFile(
      volume.id,
      '/docs/readme.txt',
      'documentation',
    );

    const deletedCount = await runtime.volumeService.deleteEntry(volume.id, '/docs');
    const snapshot = await runtime.volumeService.getExplorerSnapshot(volume.id, '/');

    expect(deletedCount).toBe(2);
    expect(snapshot.entries).toHaveLength(0);
  });
});
