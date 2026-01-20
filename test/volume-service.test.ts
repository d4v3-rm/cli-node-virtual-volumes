import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createRuntime } from '../src/bootstrap/create-runtime.js';

const sandboxes: string[] = [];

const createIsolatedRuntime = async () => {
  const sandboxRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'cli-node-virtual-volumes-'));
  sandboxes.push(sandboxRoot);

  return createRuntime({
    dataDir: path.join(sandboxRoot, 'data'),
    logDir: path.join(sandboxRoot, 'logs'),
    logLevel: 'silent',
    logToStdout: false,
  });
};

const collectFilesRecursively = async (rootPath: string): Promise<string[]> => {
  const entries = await fs.readdir(rootPath, { withFileTypes: true }).catch(() => []);
  let files: string[] = [];

  for (const entry of entries) {
    const absolutePath = path.join(rootPath, entry.name);
    if (entry.isDirectory()) {
      files = files.concat(await collectFilesRecursively(absolutePath));
      continue;
    }

    files.push(absolutePath);
  }

  return files;
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

  it('removes orphaned blobs after overwriting and deleting files', async () => {
    const runtime = await createIsolatedRuntime();
    const volume = await runtime.volumeService.createVolume({ name: 'Blob Cleanup' });
    const blobsRoot = path.join(runtime.config.dataDir, 'volumes', volume.id, 'blobs');

    await runtime.volumeService.writeTextFile(volume.id, '/cleanup.txt', 'one');
    await runtime.volumeService.writeTextFile(volume.id, '/cleanup.txt', 'two');
    await runtime.volumeService.deleteEntry(volume.id, '/cleanup.txt');

    const blobFiles = await collectFilesRecursively(blobsRoot);
    expect(blobFiles).toHaveLength(0);
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

  it('reports import progress while host paths are being ingested', async () => {
    const runtime = await createIsolatedRuntime();
    const volume = await runtime.volumeService.createVolume({ name: 'Progress Import' });
    const hostRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'virtual-progress-'));
    sandboxes.push(hostRoot);

    await fs.mkdir(path.join(hostRoot, 'batch'), { recursive: true });
    await fs.writeFile(path.join(hostRoot, 'batch', 'one.txt'), 'one');
    await fs.writeFile(path.join(hostRoot, 'batch', 'two.txt'), 'two');

    const progressEvents: {
      phase: 'file' | 'directory';
      currentHostPath: string;
      filesImported: number;
      directoriesImported: number;
    }[] = [];

    await runtime.volumeService.importHostPaths(volume.id, {
      destinationPath: '/',
      hostPaths: [path.join(hostRoot, 'batch')],
      onProgress: (progress) => {
        progressEvents.push({
          phase: progress.phase,
          currentHostPath: progress.currentHostPath,
          filesImported: progress.summary.filesImported,
          directoriesImported: progress.summary.directoriesImported,
        });
      },
    });

    expect(progressEvents[0]).toMatchObject({
      phase: 'directory',
      directoriesImported: 1,
    });
    expect(progressEvents.some((event) => event.phase === 'file')).toBe(true);
    expect(progressEvents.at(-1)).toMatchObject({
      filesImported: 2,
      directoriesImported: 1,
    });
  });

  it('exports virtual files and directories to the host and resolves name conflicts', async () => {
    const runtime = await createIsolatedRuntime();
    const volume = await runtime.volumeService.createVolume({ name: 'Exports' });
    const hostRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'virtual-export-'));
    sandboxes.push(hostRoot);

    await runtime.volumeService.createDirectory(volume.id, '/', 'docs');
    await runtime.volumeService.writeTextFile(volume.id, '/docs/readme.txt', 'documentation');
    await runtime.volumeService.writeTextFile(volume.id, '/alpha.txt', 'alpha');

    await fs.mkdir(path.join(hostRoot, 'docs'), { recursive: true });
    await fs.writeFile(path.join(hostRoot, 'alpha.txt'), 'existing');

    const directorySummary = await runtime.volumeService.exportEntryToHost(volume.id, {
      sourcePath: '/docs',
      destinationHostDirectory: hostRoot,
    });
    const fileSummary = await runtime.volumeService.exportEntryToHost(volume.id, {
      sourcePath: '/alpha.txt',
      destinationHostDirectory: hostRoot,
    });

    expect(directorySummary).toMatchObject({
      directoriesExported: 1,
      filesExported: 1,
      conflictsResolved: 1,
    });
    expect(fileSummary).toMatchObject({
      directoriesExported: 0,
      filesExported: 1,
      conflictsResolved: 1,
    });
    await expect(
      fs.readFile(path.join(hostRoot, 'docs (2)', 'readme.txt'), 'utf8'),
    ).resolves.toBe('documentation');
    await expect(
      fs.readFile(path.join(hostRoot, 'alpha (2).txt'), 'utf8'),
    ).resolves.toBe('alpha');
  });

  it('reports export progress while virtual files are being written to the host', async () => {
    const runtime = await createIsolatedRuntime();
    const volume = await runtime.volumeService.createVolume({ name: 'Progress Export' });
    const hostRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'virtual-export-progress-'));
    sandboxes.push(hostRoot);

    const content = 'x'.repeat(512 * 1024);
    await runtime.volumeService.writeTextFile(volume.id, '/big.txt', content);

    const progressEvents: {
      phase: 'file' | 'directory';
      currentVirtualPath: string;
      destinationHostPath: string;
      bytesExported: number;
      currentBytes: number;
      currentTotalBytes: number | null;
    }[] = [];

    const summary = await runtime.volumeService.exportEntryToHost(volume.id, {
      sourcePath: '/big.txt',
      destinationHostDirectory: hostRoot,
      onProgress: (progress) => {
        progressEvents.push({
          phase: progress.phase,
          currentVirtualPath: progress.currentVirtualPath,
          destinationHostPath: progress.destinationHostPath,
          bytesExported: progress.summary.bytesExported,
          currentBytes: progress.currentBytes,
          currentTotalBytes: progress.currentTotalBytes,
        });
      },
    });

    expect(progressEvents.some((event) => event.phase === 'file' && event.currentBytes > 0)).toBe(
      true,
    );
    expect(progressEvents.at(-1)).toMatchObject({
      phase: 'file',
      currentVirtualPath: '/big.txt',
      bytesExported: Buffer.byteLength(content, 'utf8'),
      currentBytes: Buffer.byteLength(content, 'utf8'),
      currentTotalBytes: Buffer.byteLength(content, 'utf8'),
    });
    expect(summary).toMatchObject({
      filesExported: 1,
      directoriesExported: 0,
      bytesExported: Buffer.byteLength(content, 'utf8'),
    });
    await expect(fs.readFile(path.join(hostRoot, 'big.txt'), 'utf8')).resolves.toHaveLength(
      content.length,
    );
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

  it('returns paged explorer snapshots for large directories', async () => {
    const runtime = await createIsolatedRuntime();
    const volume = await runtime.volumeService.createVolume({ name: 'Paged Explorer' });

    for (let index = 0; index < 24; index += 1) {
      await runtime.volumeService.createDirectory(
        volume.id,
        '/',
        `dir-${String(index).padStart(2, '0')}`,
      );
    }

    const snapshot = await runtime.volumeService.getExplorerSnapshot(volume.id, '/', {
      offset: 12,
      limit: 5,
    });

    expect(snapshot.totalEntries).toBe(24);
    expect(snapshot.windowOffset).toBe(12);
    expect(snapshot.windowSize).toBe(5);
    expect(snapshot.entries.map((entry) => entry.name)).toEqual([
      'dir-12',
      'dir-13',
      'dir-14',
      'dir-15',
      'dir-16',
    ]);
  });

  it('reads fresh explorer snapshots across runtimes sharing the same data directory', async () => {
    const sandboxRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'virtual-shared-'));
    sandboxes.push(sandboxRoot);

    const sharedDataDir = path.join(sandboxRoot, 'data');
    const runtimeA = await createRuntime({
      dataDir: sharedDataDir,
      logDir: path.join(sandboxRoot, 'logs-a'),
      logLevel: 'silent',
      logToStdout: false,
    });
    const runtimeB = await createRuntime({
      dataDir: sharedDataDir,
      logDir: path.join(sandboxRoot, 'logs-b'),
      logLevel: 'silent',
      logToStdout: false,
    });

    const volume = await runtimeA.volumeService.createVolume({ name: 'Shared View' });

    const before = await runtimeA.volumeService.getExplorerSnapshot(volume.id, '/');
    await runtimeB.volumeService.createDirectory(volume.id, '/', 'external');
    const after = await runtimeA.volumeService.getExplorerSnapshot(volume.id, '/');

    expect(before.entries).toHaveLength(0);
    expect(after.entries.map((entry) => entry.name)).toEqual(['external']);
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
