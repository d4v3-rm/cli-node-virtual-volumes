import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { open } from 'sqlite';
import sqlite3 from 'sqlite3';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createRuntime } from '../src/bootstrap/create-runtime.js';
import type { AppRuntime } from '../src/bootstrap/create-runtime.js';
import { APP_VERSION } from '../src/config/app-metadata.js';
import type { RuntimeOverrides } from '../src/config/env.js';
import type { VolumeBackupManifest } from '../src/domain/types.js';
import { BlobStore } from '../src/storage/blob-store.js';
import {
  getVolumeDatabasePath,
  SUPPORTED_VOLUME_SCHEMA_VERSION,
  withVolumeDatabase,
} from '../src/storage/sqlite-volume.js';
import { VolumeRepository } from '../src/storage/volume-repository.js';

const sandboxes: string[] = [];
const runtimes: AppRuntime[] = [];

vi.setConfig({
  hookTimeout: 15000,
  testTimeout: 15000,
});

const trackRuntime = async (
  runtimePromise: Promise<AppRuntime>,
): Promise<AppRuntime> => {
  const runtime = await runtimePromise;
  runtimes.push(runtime);
  return runtime;
};

const createIsolatedRuntime = async (overrides: RuntimeOverrides = {}) => {
  const sandboxRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'cli-node-virtual-volumes-'));
  sandboxes.push(sandboxRoot);

  return trackRuntime(
    createRuntime({
      dataDir: path.join(sandboxRoot, 'data'),
      logDir: path.join(sandboxRoot, 'logs'),
      logLevel: 'silent',
      logToStdout: false,
      ...overrides,
    }),
  );
};

const countPersistedBlobs = async (
  dataDir: string,
  volumeId: string,
): Promise<number> =>
  withVolumeDatabase(getVolumeDatabasePath(dataDir, volumeId), async (database) => {
    const row = await database.get<{ count: number }>(
      'SELECT COUNT(*) AS count FROM blobs',
    );

    return row?.count ?? 0;
  });

const getPersistedBlobChunkCount = async (
  dataDir: string,
  volumeId: string,
  contentRef: string,
): Promise<number> =>
  withVolumeDatabase(getVolumeDatabasePath(dataDir, volumeId), async (database) => {
    const row = await database.get<{ count: number }>(
      'SELECT COUNT(*) AS count FROM blob_chunks WHERE content_ref = ?',
      contentRef,
    );

    return row?.count ?? 0;
  });

const getPersistedDatabaseArtifactBytes = async (
  dataDir: string,
  volumeId: string,
): Promise<number> => {
  const databasePath = getVolumeDatabasePath(dataDir, volumeId);
  const artifactPaths = [
    databasePath,
    `${databasePath}-journal`,
    `${databasePath}-wal`,
    `${databasePath}-shm`,
  ];
  const sizes = await Promise.all(
    artifactPaths.map(async (artifactPath) => {
      try {
        const stats = await fs.stat(artifactPath);
        return stats.size;
      } catch {
        return 0;
      }
    }),
  );

  return sizes.reduce((total, size) => total + size, 0);
};

afterEach(async () => {
  await Promise.all(runtimes.splice(0, runtimes.length).map((runtime) => runtime.close()));
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

  it('rolls writeTextFile back when file entry creation fails after blob storage', async () => {
    const runtime = await createIsolatedRuntime();
    const volume = await runtime.volumeService.createVolume({ name: 'Write Rollback' });

    const createFileEntrySpy = vi
      .spyOn(
        runtime.volumeService as unknown as {
          createFileEntry: (...args: unknown[]) => unknown;
        },
        'createFileEntry',
      )
      .mockImplementation(() => {
        throw new Error('Simulated file entry creation failure.');
      });

    await expect(
      runtime.volumeService.writeTextFile(volume.id, '/failed.txt', 'should roll back'),
    ).rejects.toThrow('Simulated file entry creation failure.');

    createFileEntrySpy.mockRestore();

    const snapshot = await runtime.volumeService.getExplorerSnapshot(volume.id, '/');

    expect(snapshot.entries).toHaveLength(0);
    await expect(countPersistedBlobs(runtime.config.dataDir, volume.id)).resolves.toBe(0);
  });

  it('rolls writeTextFile overwrites back when orphan cleanup fails after metadata mutation', async () => {
    const runtime = await createIsolatedRuntime();
    const volume = await runtime.volumeService.createVolume({ name: 'Overwrite Rollback' });

    await runtime.volumeService.writeTextFile(volume.id, '/tracked.txt', 'baseline content');

    const cleanupSpy = vi
      .spyOn(
        runtime.volumeService as unknown as {
          deleteOrphanedBlobsInDatabase: (...args: unknown[]) => Promise<void>;
        },
        'deleteOrphanedBlobsInDatabase',
      )
      .mockImplementation(
        () => Promise.reject(new Error('Simulated orphan cleanup failure.')),
      );

    await expect(
      runtime.volumeService.writeTextFile(volume.id, '/tracked.txt', 'new content'),
    ).rejects.toThrow('Simulated orphan cleanup failure.');

    cleanupSpy.mockRestore();

    const preview = await runtime.volumeService.previewFile(volume.id, '/tracked.txt');
    const snapshot = await runtime.volumeService.getExplorerSnapshot(volume.id, '/');

    expect(preview.content).toContain('baseline content');
    expect(snapshot.entries.map((entry) => entry.name)).toEqual(['tracked.txt']);
    await expect(countPersistedBlobs(runtime.config.dataDir, volume.id)).resolves.toBe(1);
  });

  it('removes orphaned blobs after overwriting and deleting files', async () => {
    const runtime = await createIsolatedRuntime();
    const volume = await runtime.volumeService.createVolume({ name: 'Blob Cleanup' });

    await runtime.volumeService.writeTextFile(volume.id, '/cleanup.txt', 'one');
    await runtime.volumeService.writeTextFile(volume.id, '/cleanup.txt', 'two');
    await runtime.volumeService.deleteEntry(volume.id, '/cleanup.txt');

    await expect(countPersistedBlobs(runtime.config.dataDir, volume.id)).resolves.toBe(0);
  });

  it('stores each volume in a single sqlite file', async () => {
    const runtime = await createIsolatedRuntime();
    const volume = await runtime.volumeService.createVolume({ name: 'Single File' });
    const databasePath = getVolumeDatabasePath(runtime.config.dataDir, volume.id);
    const legacyDirectoryPath = path.join(runtime.config.dataDir, 'volumes', volume.id);

    const databaseStats = await fs.stat(databasePath);

    expect(databaseStats.isFile()).toBe(true);
    await expect(fs.stat(legacyDirectoryPath)).rejects.toBeTruthy();
  });

  it('migrates legacy directory-based volumes into sqlite files', async () => {
    const sandboxRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), 'cli-node-virtual-volumes-legacy-'),
    );
    sandboxes.push(sandboxRoot);

    const dataDir = path.join(sandboxRoot, 'data');
    const logDir = path.join(sandboxRoot, 'logs');
    const legacyVolumeId = 'vol_legacy001';
    const legacyDirectoryPath = path.join(dataDir, 'volumes', legacyVolumeId);
    const legacyContent = Buffer.from('legacy content', 'utf8');
    const legacyContentRef = createHash('sha256').update(legacyContent).digest('hex');
    const timestamp = new Date().toISOString();

    await fs.mkdir(
      path.join(
        legacyDirectoryPath,
        'blobs',
        legacyContentRef.slice(0, 2),
      ),
      { recursive: true },
    );
    await fs.writeFile(
      path.join(
        legacyDirectoryPath,
        'blobs',
        legacyContentRef.slice(0, 2),
        legacyContentRef.slice(2),
      ),
      legacyContent,
    );
    await fs.writeFile(
      path.join(legacyDirectoryPath, 'manifest.json'),
      JSON.stringify(
        {
          id: legacyVolumeId,
          name: 'Legacy Volume',
          description: 'Directory-based volume',
          quotaBytes: 1024 * 1024,
          logicalUsedBytes: legacyContent.byteLength,
          entryCount: 2,
          revision: 0,
          createdAt: timestamp,
          updatedAt: timestamp,
        },
        null,
        2,
      ),
      'utf8',
    );
    await fs.writeFile(
      path.join(legacyDirectoryPath, 'state.json'),
      JSON.stringify(
        {
          version: 1,
          rootId: 'root',
          entries: {
            root: {
              id: 'root',
              kind: 'directory',
              name: '/',
              parentId: null,
              childIds: ['file_legacy'],
              createdAt: timestamp,
              updatedAt: timestamp,
            },
            file_legacy: {
              id: 'file_legacy',
              kind: 'file',
              name: 'legacy.txt',
              parentId: 'root',
              createdAt: timestamp,
              updatedAt: timestamp,
              size: legacyContent.byteLength,
              contentRef: legacyContentRef,
              importedFromHostPath: null,
            },
          },
        },
        null,
        2,
      ),
      'utf8',
    );

    const runtime = await trackRuntime(
      createRuntime({
        dataDir,
        logDir,
        logLevel: 'silent',
        logToStdout: false,
      }),
    );

    const volumes = await runtime.volumeService.listVolumes();
    const preview = await runtime.volumeService.previewFile(legacyVolumeId, '/legacy.txt');
    const migratedDatabasePath = getVolumeDatabasePath(dataDir, legacyVolumeId);
    const migratedDatabaseStats = await fs.stat(migratedDatabasePath);

    expect(volumes.map((volume) => volume.id)).toContain(legacyVolumeId);
    expect(preview.content).toContain('legacy content');
    expect(migratedDatabaseStats.isFile()).toBe(true);
    await expect(fs.stat(legacyDirectoryPath)).rejects.toBeTruthy();
  });

  it('rolls legacy blob imports back when metadata migration fails', async () => {
    const sandboxRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), 'cli-node-virtual-volumes-legacy-failure-'),
    );
    sandboxes.push(sandboxRoot);

    const dataDir = path.join(sandboxRoot, 'data');
    const logDir = path.join(sandboxRoot, 'logs');
    const legacyVolumeId = 'vol_legacy_fail01';
    const legacyDirectoryPath = path.join(dataDir, 'volumes', legacyVolumeId);
    const firstContent = Buffer.from('first legacy payload', 'utf8');
    const secondContent = Buffer.from('second legacy payload', 'utf8');
    const firstContentRef = createHash('sha256').update(firstContent).digest('hex');
    const secondContentRef = createHash('sha256').update(secondContent).digest('hex');
    const timestamp = new Date().toISOString();

    await fs.mkdir(
      path.join(
        legacyDirectoryPath,
        'blobs',
        firstContentRef.slice(0, 2),
      ),
      { recursive: true },
    );
    await fs.mkdir(
      path.join(
        legacyDirectoryPath,
        'blobs',
        secondContentRef.slice(0, 2),
      ),
      { recursive: true },
    );
    await fs.writeFile(
      path.join(
        legacyDirectoryPath,
        'blobs',
        firstContentRef.slice(0, 2),
        firstContentRef.slice(2),
      ),
      firstContent,
    );
    await fs.writeFile(
      path.join(
        legacyDirectoryPath,
        'blobs',
        secondContentRef.slice(0, 2),
        secondContentRef.slice(2),
      ),
      secondContent,
    );
    await fs.writeFile(
      path.join(legacyDirectoryPath, 'manifest.json'),
      JSON.stringify(
        {
          id: legacyVolumeId,
          name: 'Broken Legacy Volume',
          description: 'Should roll back on migration failure',
          quotaBytes: 1024 * 1024,
          logicalUsedBytes: firstContent.byteLength + secondContent.byteLength,
          entryCount: 3,
          revision: 0,
          createdAt: timestamp,
          updatedAt: timestamp,
        },
        null,
        2,
      ),
      'utf8',
    );
    await fs.writeFile(
      path.join(legacyDirectoryPath, 'state.json'),
      JSON.stringify(
        {
          version: 1,
          rootId: 'root',
          entries: {
            root: {
              id: 'root',
              kind: 'directory',
              name: '/',
              parentId: null,
              childIds: ['file_a', 'file_b'],
              createdAt: timestamp,
              updatedAt: timestamp,
            },
            file_a: {
              id: 'file_a',
              kind: 'file',
              name: 'duplicate.txt',
              parentId: 'root',
              createdAt: timestamp,
              updatedAt: timestamp,
              size: firstContent.byteLength,
              contentRef: firstContentRef,
              importedFromHostPath: null,
            },
            file_b: {
              id: 'file_b',
              kind: 'file',
              name: 'duplicate.txt',
              parentId: 'root',
              createdAt: timestamp,
              updatedAt: timestamp,
              size: secondContent.byteLength,
              contentRef: secondContentRef,
              importedFromHostPath: null,
            },
          },
        },
        null,
        2,
      ),
      'utf8',
    );

    const runtime = await trackRuntime(
      createRuntime({
        dataDir,
        logDir,
        logLevel: 'silent',
        logToStdout: false,
      }),
    );

    const volumes = await runtime.volumeService.listVolumes();
    const migratedDatabasePath = getVolumeDatabasePath(dataDir, legacyVolumeId);
    const legacyDirectoryStats = await fs.stat(legacyDirectoryPath);

    expect(volumes.map((volume) => volume.id)).not.toContain(legacyVolumeId);
    await expect(fs.stat(migratedDatabasePath)).rejects.toBeTruthy();
    expect(legacyDirectoryStats.isDirectory()).toBe(true);
  });

  it('rolls batched host imports back when a later file fails after earlier blobs were staged', async () => {
    const runtime = await createIsolatedRuntime();
    const volume = await runtime.volumeService.createVolume({ name: 'Import Rollback' });
    const hostRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'virtual-import-rollback-'));
    sandboxes.push(hostRoot);

    await fs.writeFile(path.join(hostRoot, 'alpha.txt'), 'alpha');
    await fs.writeFile(path.join(hostRoot, 'beta.txt'), 'beta');

    const originalCreateFileEntry = (
      runtime.volumeService as unknown as {
        createFileEntry: (...args: unknown[]) => unknown;
      }
    ).createFileEntry.bind(runtime.volumeService);

    const createFileEntrySpy = vi
      .spyOn(
        runtime.volumeService as unknown as {
          createFileEntry: (...args: unknown[]) => unknown;
        },
        'createFileEntry',
      )
      .mockImplementation((...args: unknown[]) => {
        const [, , name] = args;
        if (name === 'beta.txt') {
          throw new Error('Simulated batched import failure.');
        }

        return originalCreateFileEntry(...args);
      });

    await expect(
      runtime.volumeService.importHostPaths(volume.id, {
        destinationPath: '/',
        hostPaths: [path.join(hostRoot, 'alpha.txt'), path.join(hostRoot, 'beta.txt')],
      }),
    ).rejects.toThrow('Simulated batched import failure.');

    createFileEntrySpy.mockRestore();

    const snapshot = await runtime.volumeService.getExplorerSnapshot(volume.id, '/');

    expect(snapshot.entries).toHaveLength(0);
    await expect(countPersistedBlobs(runtime.config.dataDir, volume.id)).resolves.toBe(0);
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
    expect(summary.integrityChecksPassed).toBe(3);
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
      phase: 'file' | 'directory' | 'integrity';
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
    expect(progressEvents.some((event) => event.phase === 'integrity')).toBe(true);
    expect(progressEvents.at(-1)).toMatchObject({
      filesImported: 2,
      directoriesImported: 1,
    });
  });

  it('rejects symbolic-link host imports before staging metadata or blobs', async () => {
    const runtime = await createIsolatedRuntime();
    const volume = await runtime.volumeService.createVolume({ name: 'Symlink Guard' });
    const fakeSymlinkPath = path.join(runtime.config.dataDir, 'host-link');
    const realLstat = fs.lstat.bind(fs);

    const lstatSpy = vi
      .spyOn(fs, 'lstat')
      .mockImplementation(async (targetPath: Parameters<typeof fs.lstat>[0]) => {
        const targetPathText =
          typeof targetPath === 'string' ? targetPath : targetPath.toString();
        if (path.resolve(targetPathText) === path.resolve(fakeSymlinkPath)) {
          return {
            isSymbolicLink: () => true,
            isDirectory: () => false,
            isFile: () => false,
            size: 0,
          } as Awaited<ReturnType<typeof fs.lstat>>;
        }

        return realLstat(targetPath);
      });

    await expect(
      runtime.volumeService.importHostPaths(volume.id, {
        destinationPath: '/',
        hostPaths: [fakeSymlinkPath],
      }),
    ).rejects.toMatchObject({
      code: 'UNSUPPORTED_HOST_ENTRY',
      message: `Symbolic links are not supported: ${path.resolve(fakeSymlinkPath)}`,
    });

    lstatSpy.mockRestore();

    const snapshot = await runtime.volumeService.getExplorerSnapshot(volume.id, '/');

    expect(snapshot.entries).toHaveLength(0);
    await expect(countPersistedBlobs(runtime.config.dataDir, volume.id)).resolves.toBe(0);
  });

  it('enforces configured host path allowlist and denylist for import and export', async () => {
    const hostRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'virtual-host-policy-'));
    sandboxes.push(hostRoot);

    const allowedRoot = path.join(hostRoot, 'allowed');
    const deniedRoot = path.join(hostRoot, 'denied');
    const outsideRoot = path.join(hostRoot, 'outside');
    const allowedImportPath = path.join(allowedRoot, 'inside.txt');
    const deniedImportPath = path.join(deniedRoot, 'blocked.txt');
    const exportOutsideRoot = path.join(outsideRoot, 'exports');
    await fs.mkdir(allowedRoot, { recursive: true });
    await fs.mkdir(deniedRoot, { recursive: true });
    await fs.writeFile(allowedImportPath, 'allowed import');
    await fs.writeFile(deniedImportPath, 'denied import');

    const runtime = await createIsolatedRuntime({
      hostAllowPaths: [allowedRoot],
      hostDenyPaths: [deniedRoot],
    });
    const volume = await runtime.volumeService.createVolume({ name: 'Host Policy' });

    const importSummary = await runtime.volumeService.importHostPaths(volume.id, {
      destinationPath: '/',
      hostPaths: [allowedImportPath],
    });

    expect(importSummary).toMatchObject({
      filesImported: 1,
      directoriesImported: 0,
    });

    await expect(
      runtime.volumeService.importHostPaths(volume.id, {
        destinationPath: '/',
        hostPaths: [deniedImportPath],
      }),
    ).rejects.toMatchObject({
      code: 'INVALID_OPERATION',
      message: `Import path is blocked by configured host denylist: ${path.resolve(deniedImportPath)}`,
    });

    await runtime.volumeService.writeTextFile(volume.id, '/export.txt', 'policy export');

    await expect(
      runtime.volumeService.exportEntryToHost(volume.id, {
        sourcePath: '/export.txt',
        destinationHostDirectory: exportOutsideRoot,
      }),
    ).rejects.toMatchObject({
      code: 'INVALID_OPERATION',
      message: `Export path is outside the configured host allowlist: ${path.resolve(exportOutsideRoot)}`,
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
      integrityChecksPassed: 1,
    });
    expect(fileSummary).toMatchObject({
      directoriesExported: 0,
      filesExported: 1,
      conflictsResolved: 1,
      integrityChecksPassed: 1,
    });
    await expect(
      fs.readFile(path.join(hostRoot, 'docs (2)', 'readme.txt'), 'utf8'),
    ).resolves.toBe('documentation');
    await expect(
      fs.readFile(path.join(hostRoot, 'alpha (2).txt'), 'utf8'),
    ).resolves.toBe('alpha');
  });

  it('rejects export destinations that already exist as host files', async () => {
    const runtime = await createIsolatedRuntime();
    const volume = await runtime.volumeService.createVolume({ name: 'Export Guard' });
    const hostRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'virtual-export-guard-'));
    sandboxes.push(hostRoot);
    const hostFilePath = path.join(hostRoot, 'not-a-directory.txt');

    await runtime.volumeService.writeTextFile(volume.id, '/report.txt', 'export me');
    await fs.writeFile(hostFilePath, 'existing host file');

    await expect(
      runtime.volumeService.exportEntryToHost(volume.id, {
        sourcePath: '/report.txt',
        destinationHostDirectory: hostFilePath,
      }),
    ).rejects.toMatchObject({
      code: 'INVALID_OPERATION',
      message: `The host destination must be a directory: ${path.resolve(hostFilePath)}`,
    });

    await expect(fs.readFile(hostFilePath, 'utf8')).resolves.toBe('existing host file');
  });

  it('reports export progress while virtual files are being written to the host', async () => {
    const runtime = await createIsolatedRuntime();
    const volume = await runtime.volumeService.createVolume({ name: 'Progress Export' });
    const hostRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'virtual-export-progress-'));
    sandboxes.push(hostRoot);

    const content = 'x'.repeat(512 * 1024);
    await runtime.volumeService.writeTextFile(volume.id, '/big.txt', content);

    const progressEvents: {
      phase: 'file' | 'directory' | 'integrity';
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
    expect(progressEvents.some((event) => event.phase === 'integrity')).toBe(true);
    expect(progressEvents.at(-1)).toMatchObject({
      phase: 'integrity',
      currentVirtualPath: '/big.txt',
      bytesExported: Buffer.byteLength(content, 'utf8'),
      currentBytes: Buffer.byteLength(content, 'utf8'),
      currentTotalBytes: Buffer.byteLength(content, 'utf8'),
    });
    expect(summary).toMatchObject({
      filesExported: 1,
      directoriesExported: 0,
      bytesExported: Buffer.byteLength(content, 'utf8'),
      integrityChecksPassed: 1,
    });
    await expect(fs.readFile(path.join(hostRoot, 'big.txt'), 'utf8')).resolves.toHaveLength(
      content.length,
    );
  });

  it('imports and exports large files through chunked sqlite blobs with integrity verification', async () => {
    const runtime = await createIsolatedRuntime();
    const volume = await runtime.volumeService.createVolume({ name: 'Large Files' });
    const hostRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'virtual-large-file-'));
    sandboxes.push(hostRoot);

    const largeContent = Buffer.alloc(1024 * 1024 + 333, 0);
    const largeHostPath = path.join(hostRoot, 'large.bin');
    await fs.writeFile(largeHostPath, largeContent);

    const importSummary = await runtime.volumeService.importHostPaths(volume.id, {
      destinationPath: '/',
      hostPaths: [largeHostPath],
    });
    const snapshot = await runtime.volumeService.getExplorerSnapshot(volume.id, '/');
    const importedEntry = snapshot.entries.find((entry) => entry.name === 'large.bin');

    expect(importSummary).toMatchObject({
      filesImported: 1,
      directoriesImported: 0,
      bytesImported: largeContent.byteLength,
      integrityChecksPassed: 1,
    });
    expect(importedEntry?.kind).toBe('file');

    const preview = await runtime.volumeService.previewFile(volume.id, '/large.bin');
    expect(preview.kind).toBe('binary');

    const entryPath = path.join(hostRoot, 'exports');
    await fs.mkdir(entryPath, { recursive: true });

    const exportSummary = await runtime.volumeService.exportEntryToHost(volume.id, {
      sourcePath: '/large.bin',
      destinationHostDirectory: entryPath,
    });
    const exportedPath = path.join(entryPath, 'large.bin');
    const exportedContent = await fs.readFile(exportedPath);
    const expectedContentRef = createHash('sha256').update(largeContent).digest('hex');

    expect(exportSummary).toMatchObject({
      filesExported: 1,
      directoriesExported: 0,
      bytesExported: largeContent.byteLength,
      integrityChecksPassed: 1,
    });
    await expect(
      getPersistedBlobChunkCount(runtime.config.dataDir, volume.id, expectedContentRef),
    ).resolves.toBeGreaterThan(1);
    expect(createHash('sha256').update(exportedContent).digest('hex')).toBe(expectedContentRef);
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
    const runtimeA = await trackRuntime(
      createRuntime({
        dataDir: sharedDataDir,
        logDir: path.join(sandboxRoot, 'logs-a'),
        logLevel: 'silent',
        logToStdout: false,
      }),
    );
    const runtimeB = await trackRuntime(
      createRuntime({
        dataDir: sharedDataDir,
        logDir: path.join(sandboxRoot, 'logs-b'),
        logLevel: 'silent',
        logToStdout: false,
      }),
    );

    const volume = await runtimeA.volumeService.createVolume({ name: 'Shared View' });

    const before = await runtimeA.volumeService.getExplorerSnapshot(volume.id, '/');
    await runtimeB.volumeService.createDirectory(volume.id, '/', 'external');
    const after = await runtimeA.volumeService.getExplorerSnapshot(volume.id, '/');

    expect(before.entries).toHaveLength(0);
    expect(after.entries.map((entry) => entry.name)).toEqual(['external']);
  });

  it('rejects stale repository saves after a concurrent update bumps the volume revision', async () => {
    const sandboxRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'virtual-concurrency-'));
    sandboxes.push(sandboxRoot);

    const runtime = await trackRuntime(
      createRuntime({
        dataDir: path.join(sandboxRoot, 'data'),
        logDir: path.join(sandboxRoot, 'logs'),
        logLevel: 'silent',
        logToStdout: false,
      }),
    );
    const volume = await runtime.volumeService.createVolume({ name: 'Concurrent Save' });
    const repositoryA = new VolumeRepository(
      runtime.config,
      runtime.logger.child({ scope: 'repo-a' }),
    );
    const repositoryB = new VolumeRepository(
      runtime.config,
      runtime.logger.child({ scope: 'repo-b' }),
    );

    await Promise.all([repositoryA.initialize(), repositoryB.initialize()]);

    const recordA = await repositoryA.loadVolume(volume.id);
    const recordB = await repositoryB.loadVolume(volume.id);

    recordA.manifest.description = 'saved by repository A';
    await repositoryA.saveVolume(recordA);

    recordB.manifest.description = 'stale write from repository B';

    await expect(repositoryB.saveVolume(recordB)).rejects.toMatchObject({
      code: 'CONCURRENT_MODIFICATION',
    });

    const refreshed = await repositoryA.loadVolume(volume.id);
    expect(refreshed.manifest.description).toBe('saved by repository A');
    expect(refreshed.manifest.revision).toBe(2);
  });

  it('creates consistent SQLite backups and restores them after volume deletion', async () => {
    const runtime = await createIsolatedRuntime();
    const volume = await runtime.volumeService.createVolume({ name: 'Recovery Drill' });
    const backupRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'virtual-backup-'));
    sandboxes.push(backupRoot);
    const backupPath = path.join(backupRoot, 'recovery-drill.sqlite');

    await runtime.volumeService.createDirectory(volume.id, '/', 'docs');
    await runtime.volumeService.writeTextFile(volume.id, '/docs/plan.txt', 'snapshot state');

    const backupResult = await runtime.volumeService.backupVolume(volume.id, backupPath);
    const backupManifest = JSON.parse(
      await fs.readFile(backupResult.manifestPath, 'utf8'),
    ) as VolumeBackupManifest;

    await runtime.volumeService.writeTextFile(volume.id, '/docs/plan.txt', 'live change');
    await runtime.volumeService.writeTextFile(volume.id, '/later.txt', 'created after backup');
    await runtime.volumeService.deleteVolume(volume.id);

    const restoreResult = await runtime.volumeService.restoreVolumeBackup(backupPath);
    const rootSnapshot = await runtime.volumeService.getExplorerSnapshot(volume.id, '/');
    const docsSnapshot = await runtime.volumeService.getExplorerSnapshot(volume.id, '/docs');
    const preview = await runtime.volumeService.previewFile(volume.id, '/docs/plan.txt');

    expect(backupResult).toMatchObject({
      volumeId: volume.id,
      volumeName: 'Recovery Drill',
      backupPath: path.resolve(backupPath),
      manifestPath: `${path.resolve(backupPath)}.manifest.json`,
      revision: 3,
      schemaVersion: 3,
      createdWithVersion: APP_VERSION,
    });
    expect(backupResult.checksumSha256).toHaveLength(64);
    expect(backupResult.bytesWritten).toBeGreaterThan(0);
    expect(backupManifest).toMatchObject({
      formatVersion: 1,
      volumeId: volume.id,
      volumeName: 'Recovery Drill',
      revision: 3,
      schemaVersion: 3,
      createdWithVersion: APP_VERSION,
      bytesWritten: backupResult.bytesWritten,
      checksumSha256: backupResult.checksumSha256,
    });
    expect(restoreResult).toMatchObject({
      volumeId: volume.id,
      volumeName: 'Recovery Drill',
      backupPath: path.resolve(backupPath),
      manifestPath: `${path.resolve(backupPath)}.manifest.json`,
      revision: 3,
      schemaVersion: 3,
      createdWithVersion: APP_VERSION,
      checksumSha256: backupResult.checksumSha256,
      validatedWithManifest: true,
    });
    expect(restoreResult.bytesRestored).toBeGreaterThan(0);
    expect(rootSnapshot.entries.map((entry) => entry.name)).toEqual(['docs']);
    expect(docsSnapshot.entries.map((entry) => entry.name)).toEqual(['plan.txt']);
    expect(preview.content).toContain('snapshot state');
    await expect(runtime.volumeService.previewFile(volume.id, '/later.txt')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('inspects backup artifacts without touching the live volume', async () => {
    const runtime = await createIsolatedRuntime();
    const volume = await runtime.volumeService.createVolume({ name: 'Inspection Drill' });
    const backupRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'virtual-inspect-backup-'));
    sandboxes.push(backupRoot);
    const backupPath = path.join(backupRoot, 'inspection-drill.sqlite');

    await runtime.volumeService.writeTextFile(volume.id, '/report.txt', 'inspection payload');

    const backupResult = await runtime.volumeService.backupVolume(volume.id, backupPath);
    const inspection = await runtime.volumeService.inspectVolumeBackup(backupPath);
    const preview = await runtime.volumeService.previewFile(volume.id, '/report.txt');

    expect(inspection).toMatchObject({
      volumeId: volume.id,
      volumeName: 'Inspection Drill',
      revision: backupResult.revision,
      schemaVersion: 3,
      backupPath: path.resolve(backupPath),
      manifestPath: backupResult.manifestPath,
      formatVersion: 1,
      createdWithVersion: APP_VERSION,
      checksumSha256: backupResult.checksumSha256,
      bytesWritten: backupResult.bytesWritten,
      createdAt: backupResult.createdAt,
      validatedWithManifest: true,
    });
    expect(preview.content).toContain('inspection payload');
  });

  it('restores legacy backups even when the backup manifest sidecar is missing', async () => {
    const runtime = await createIsolatedRuntime();
    const volume = await runtime.volumeService.createVolume({ name: 'Legacy Recovery' });
    const backupRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'virtual-legacy-backup-'));
    sandboxes.push(backupRoot);
    const backupPath = path.join(backupRoot, 'legacy-recovery.sqlite');

    await runtime.volumeService.writeTextFile(volume.id, '/report.txt', 'legacy snapshot');

    const backupResult = await runtime.volumeService.backupVolume(volume.id, backupPath);
    await fs.rm(backupResult.manifestPath, { force: true });
    await runtime.volumeService.deleteVolume(volume.id);

    const restoreResult = await runtime.volumeService.restoreVolumeBackup(backupPath);
    const preview = await runtime.volumeService.previewFile(volume.id, '/report.txt');

    expect(restoreResult).toMatchObject({
      volumeId: volume.id,
      volumeName: 'Legacy Recovery',
      manifestPath: null,
      createdWithVersion: null,
      validatedWithManifest: false,
      schemaVersion: 3,
    });
    expect(restoreResult.checksumSha256).toBe(backupResult.checksumSha256);
    expect(preview.content).toContain('legacy snapshot');
  });

  it('inspects legacy backups without requiring a manifest sidecar', async () => {
    const runtime = await createIsolatedRuntime();
    const volume = await runtime.volumeService.createVolume({ name: 'Legacy Inspection' });
    const backupRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'virtual-legacy-inspect-'));
    sandboxes.push(backupRoot);
    const backupPath = path.join(backupRoot, 'legacy-inspection.sqlite');

    await runtime.volumeService.writeTextFile(volume.id, '/report.txt', 'legacy inspection');

    const backupResult = await runtime.volumeService.backupVolume(volume.id, backupPath);
    await fs.rm(backupResult.manifestPath, { force: true });

    const inspection = await runtime.volumeService.inspectVolumeBackup(backupPath);

    expect(inspection).toMatchObject({
      volumeId: volume.id,
      volumeName: 'Legacy Inspection',
      backupPath: path.resolve(backupPath),
      manifestPath: null,
      formatVersion: null,
      createdWithVersion: null,
      checksumSha256: backupResult.checksumSha256,
      validatedWithManifest: false,
      schemaVersion: 3,
    });
    expect(inspection.createdAt).toBeNull();
  });

  it('rejects backups that target the live managed database path', async () => {
    const runtime = await createIsolatedRuntime();
    const volume = await runtime.volumeService.createVolume({ name: 'Backup Safety' });
    const liveDatabasePath = getVolumeDatabasePath(runtime.config.dataDir, volume.id);

    await runtime.volumeService.writeTextFile(volume.id, '/safe.txt', 'must survive');

    await expect(runtime.volumeService.backupVolume(volume.id, liveDatabasePath)).rejects.toMatchObject({
      code: 'INVALID_OPERATION',
      details: {
        volumeId: volume.id,
        destinationPath: path.resolve(liveDatabasePath),
      },
    });

    await expect(runtime.volumeService.previewFile(volume.id, '/safe.txt')).resolves.toMatchObject({
      kind: 'text',
      content: 'must survive',
    });
  });

  it('compacts volume databases and reclaims free SQLite pages after churn', async () => {
    const runtime = await createIsolatedRuntime();
    const volume = await runtime.volumeService.createVolume({ name: 'Compaction Drill' });
    const largePayload = 'x'.repeat(2 * 1024 * 1024);

    await runtime.volumeService.writeTextFile(volume.id, '/large.txt', largePayload);
    await runtime.volumeService.deleteEntry(volume.id, '/large.txt');

    const doctorBefore = await runtime.volumeService.runDoctor(volume.id);
    const bytesBefore = await getPersistedDatabaseArtifactBytes(runtime.config.dataDir, volume.id);
    const result = await runtime.volumeService.compactVolume(volume.id);
    const doctorAfter = await runtime.volumeService.runDoctor(volume.id);
    const bytesAfter = await getPersistedDatabaseArtifactBytes(runtime.config.dataDir, volume.id);
    const rootSnapshot = await runtime.volumeService.getExplorerSnapshot(volume.id, '/');
    const issueCodesBefore = doctorBefore.volumes[0]?.issues.map((issue) => issue.code) ?? [];
    const issueCodesAfter = doctorAfter.volumes[0]?.issues.map((issue) => issue.code) ?? [];

    expect(result).toMatchObject({
      volumeId: volume.id,
      volumeName: 'Compaction Drill',
      revision: 3,
      schemaVersion: 3,
      databasePath: getVolumeDatabasePath(runtime.config.dataDir, volume.id),
    });
    expect(result.bytesBefore).toBe(bytesBefore);
    expect(result.bytesAfter).toBe(bytesAfter);
    expect(result.bytesAfter).toBeLessThan(bytesBefore);
    expect(result.reclaimedBytes).toBe(bytesBefore - bytesAfter);
    expect(issueCodesBefore).toContain('COMPACTION_RECOMMENDED');
    expect(doctorBefore.volumes[0]?.maintenance).toMatchObject({
      compactionRecommended: true,
    });
    expect(issueCodesAfter).not.toContain('COMPACTION_RECOMMENDED');
    expect(doctorAfter.volumes[0]?.maintenance).toMatchObject({
      compactionRecommended: false,
    });
    expect(rootSnapshot.entries).toHaveLength(0);
  });

  it('compacts all recommended volumes in batch and leaves clean volumes untouched', async () => {
    const runtime = await createIsolatedRuntime();
    const churnedVolume = await runtime.volumeService.createVolume({ name: 'Churned' });
    const cleanVolume = await runtime.volumeService.createVolume({ name: 'Clean' });
    const largePayload = 'y'.repeat(2 * 1024 * 1024);

    await runtime.volumeService.writeTextFile(churnedVolume.id, '/large.txt', largePayload);
    await runtime.volumeService.deleteEntry(churnedVolume.id, '/large.txt');
    await runtime.volumeService.writeTextFile(cleanVolume.id, '/steady.txt', 'steady');

    const dryRun = await runtime.volumeService.compactRecommendedVolumes({ dryRun: true });
    const dryRunItem = dryRun.volumes.find((item) => item.volumeId === churnedVolume.id);

    expect(dryRun.checkedVolumes).toBe(2);
    expect(dryRun.recommendedVolumes).toBe(1);
    expect(dryRun.skippedVolumes).toBe(1);
    expect(dryRun.compactedVolumes).toBe(0);
    expect(dryRun.failedVolumes).toBe(0);
    expect(dryRunItem).toMatchObject({
      volumeId: churnedVolume.id,
      status: 'planned',
    });

    const batchResult = await runtime.volumeService.compactRecommendedVolumes();
    const compactedItem = batchResult.volumes.find(
      (item) => item.volumeId === churnedVolume.id,
    );
    const followUpDoctor = await runtime.volumeService.runDoctor();
    const churnedDoctor = followUpDoctor.volumes.find(
      (volumeReport) => volumeReport.volumeId === churnedVolume.id,
    );
    const cleanDoctor = followUpDoctor.volumes.find(
      (volumeReport) => volumeReport.volumeId === cleanVolume.id,
    );

    expect(batchResult.checkedVolumes).toBe(2);
    expect(batchResult.recommendedVolumes).toBe(1);
    expect(batchResult.compactedVolumes).toBe(1);
    expect(batchResult.failedVolumes).toBe(0);
    expect(batchResult.totalReclaimedBytes).toBeGreaterThan(0);
    expect(compactedItem?.status).toBe('compacted');
    expect(compactedItem?.compaction?.reclaimedBytes).toBeGreaterThan(0);
    expect(
      churnedDoctor?.issues.some((issue) => issue.code === 'COMPACTION_RECOMMENDED'),
    ).toBe(false);
    expect(churnedDoctor?.maintenance?.compactionRecommended).toBe(false);
    expect(cleanDoctor?.maintenance?.compactionRecommended).toBe(false);
    expect(cleanDoctor?.issues).toEqual([]);
  });

  it('limits recommended batch compaction to the most fragmented volumes first', async () => {
    const runtime = await createIsolatedRuntime();
    const largestVolume = await runtime.volumeService.createVolume({ name: 'Largest churn' });
    const smallerVolume = await runtime.volumeService.createVolume({ name: 'Smaller churn' });
    const cleanVolume = await runtime.volumeService.createVolume({ name: 'Stable' });

    await runtime.volumeService.writeTextFile(
      largestVolume.id,
      '/large.txt',
      'a'.repeat(2 * 1024 * 1024),
    );
    await runtime.volumeService.deleteEntry(largestVolume.id, '/large.txt');
    await runtime.volumeService.writeTextFile(
      smallerVolume.id,
      '/small.txt',
      'b'.repeat(Math.floor(1.25 * 1024 * 1024)),
    );
    await runtime.volumeService.deleteEntry(smallerVolume.id, '/small.txt');
    await runtime.volumeService.writeTextFile(cleanVolume.id, '/stable.txt', 'steady');

    const dryRun = await runtime.volumeService.compactRecommendedVolumes({
      dryRun: true,
      limit: 1,
    });
    const batchResult = await runtime.volumeService.compactRecommendedVolumes({
      limit: 1,
    });
    const followUpDoctor = await runtime.volumeService.runDoctor();
    const largestDoctor = followUpDoctor.volumes.find(
      (volumeReport) => volumeReport.volumeId === largestVolume.id,
    );
    const smallerDoctor = followUpDoctor.volumes.find(
      (volumeReport) => volumeReport.volumeId === smallerVolume.id,
    );

    expect(dryRun.recommendedVolumes).toBe(2);
    expect(dryRun.plannedVolumes).toBe(1);
    expect(dryRun.deferredVolumes).toBe(1);
    expect(dryRun.volumes).toHaveLength(2);
    expect(dryRun.volumes.find((item) => item.status === 'planned')?.volumeId).toBe(
      largestVolume.id,
    );
    expect(dryRun.volumes.find((item) => item.status === 'deferred')?.volumeId).toBe(
      smallerVolume.id,
    );
    expect(batchResult.recommendedVolumes).toBe(2);
    expect(batchResult.plannedVolumes).toBe(1);
    expect(batchResult.compactedVolumes).toBe(1);
    expect(batchResult.deferredVolumes).toBe(1);
    expect(batchResult.volumes).toHaveLength(2);
    expect(batchResult.volumes.find((item) => item.status === 'compacted')?.volumeId).toBe(
      largestVolume.id,
    );
    expect(batchResult.volumes.find((item) => item.status === 'deferred')?.volumeId).toBe(
      smallerVolume.id,
    );
    expect(
      largestDoctor?.issues.some((issue) => issue.code === 'COMPACTION_RECOMMENDED'),
    ).toBe(false);
    expect(
      smallerDoctor?.issues.some((issue) => issue.code === 'COMPACTION_RECOMMENDED'),
    ).toBe(true);
  });

  it('filters recommended batch compaction by requested free-byte and free-ratio thresholds', async () => {
    const runtime = await createIsolatedRuntime();
    const highestRatioVolume = await runtime.volumeService.createVolume({ name: 'High ratio' });
    const lowerRatioVolume = await runtime.volumeService.createVolume({ name: 'Lower ratio' });

    await runtime.volumeService.writeTextFile(
      highestRatioVolume.id,
      '/deleted.txt',
      'a'.repeat(2 * 1024 * 1024),
    );
    await runtime.volumeService.deleteEntry(highestRatioVolume.id, '/deleted.txt');

    await runtime.volumeService.writeTextFile(
      lowerRatioVolume.id,
      '/deleted.txt',
      'b'.repeat(Math.floor(1.5 * 1024 * 1024)),
    );
    await runtime.volumeService.writeTextFile(
      lowerRatioVolume.id,
      '/retained.txt',
      'c'.repeat(1024 * 1024),
    );
    await runtime.volumeService.deleteEntry(lowerRatioVolume.id, '/deleted.txt');

    const doctorReport = await runtime.volumeService.runDoctor();
    const highestMaintenance = doctorReport.volumes.find(
      (volumeReport) => volumeReport.volumeId === highestRatioVolume.id,
    )?.maintenance;
    const lowerMaintenance = doctorReport.volumes.find(
      (volumeReport) => volumeReport.volumeId === lowerRatioVolume.id,
    )?.maintenance;

    expect(highestMaintenance?.compactionRecommended).toBe(true);
    expect(lowerMaintenance?.compactionRecommended).toBe(true);
    expect((highestMaintenance?.freeBytes ?? 0)).toBeGreaterThan(lowerMaintenance?.freeBytes ?? 0);
    expect((highestMaintenance?.freeRatio ?? 0)).toBeGreaterThan(lowerMaintenance?.freeRatio ?? 0);

    const minFreeBytes = Math.floor(
      ((highestMaintenance?.freeBytes ?? 0) + (lowerMaintenance?.freeBytes ?? 0)) / 2,
    );
    const minFreeRatio =
      ((highestMaintenance?.freeRatio ?? 0) + (lowerMaintenance?.freeRatio ?? 0)) / 2;

    const dryRun = await runtime.volumeService.compactRecommendedVolumes({
      dryRun: true,
      minFreeBytes,
      minFreeRatio,
    });

    expect(dryRun.recommendedVolumes).toBe(2);
    expect(dryRun.eligibleVolumes).toBe(1);
    expect(dryRun.filteredVolumes).toBe(1);
    expect(dryRun.plannedVolumes).toBe(1);
    expect(dryRun.minimumFreeBytes).toBe(minFreeBytes);
    expect(dryRun.minimumFreeRatio).toBe(minFreeRatio);
    expect(dryRun.volumes).toHaveLength(2);
    expect(dryRun.volumes.find((item) => item.status === 'planned')?.volumeId).toBe(
      highestRatioVolume.id,
    );
    expect(dryRun.volumes.find((item) => item.status === 'filtered')?.volumeId).toBe(
      lowerRatioVolume.id,
    );
  });

  it('reports filtered and deferred recommended volumes explicitly in the batch plan', async () => {
    const runtime = await createIsolatedRuntime();
    const filteredVolume = await runtime.volumeService.createVolume({ name: 'Filtered' });
    const plannedVolume = await runtime.volumeService.createVolume({ name: 'Planned' });
    const deferredVolume = await runtime.volumeService.createVolume({ name: 'Deferred' });

    await runtime.volumeService.writeTextFile(
      filteredVolume.id,
      '/deleted.txt',
      'f'.repeat(Math.floor(1.5 * 1024 * 1024)),
    );
    await runtime.volumeService.writeTextFile(
      filteredVolume.id,
      '/retained.txt',
      'r'.repeat(1024 * 1024),
    );
    await runtime.volumeService.deleteEntry(filteredVolume.id, '/deleted.txt');

    await runtime.volumeService.writeTextFile(
      plannedVolume.id,
      '/deleted.txt',
      'p'.repeat(2 * 1024 * 1024),
    );
    await runtime.volumeService.deleteEntry(plannedVolume.id, '/deleted.txt');

    await runtime.volumeService.writeTextFile(
      deferredVolume.id,
      '/deleted.txt',
      'd'.repeat(Math.floor(1.75 * 1024 * 1024)),
    );
    await runtime.volumeService.deleteEntry(deferredVolume.id, '/deleted.txt');

    const doctorReport = await runtime.volumeService.runDoctor();
    const filteredMaintenance = doctorReport.volumes.find(
      (volumeReport) => volumeReport.volumeId === filteredVolume.id,
    )?.maintenance;
    const plannedMaintenance = doctorReport.volumes.find(
      (volumeReport) => volumeReport.volumeId === plannedVolume.id,
    )?.maintenance;
    const deferredMaintenance = doctorReport.volumes.find(
      (volumeReport) => volumeReport.volumeId === deferredVolume.id,
    )?.maintenance;

    expect(filteredMaintenance?.compactionRecommended).toBe(true);
    expect(plannedMaintenance?.compactionRecommended).toBe(true);
    expect(deferredMaintenance?.compactionRecommended).toBe(true);

    const minFreeRatio = ((filteredMaintenance?.freeRatio ?? 0) + (plannedMaintenance?.freeRatio ?? 0)) / 2;
    const dryRun = await runtime.volumeService.compactRecommendedVolumes({
      dryRun: true,
      limit: 1,
      minFreeRatio,
    });

    const filteredItem = dryRun.volumes.find((item) => item.volumeId === filteredVolume.id);
    const plannedItem = dryRun.volumes.find((item) => item.volumeId === plannedVolume.id);
    const deferredItem = dryRun.volumes.find((item) => item.volumeId === deferredVolume.id);

    expect(dryRun.recommendedVolumes).toBe(3);
    expect(dryRun.eligibleVolumes).toBe(2);
    expect(dryRun.filteredVolumes).toBe(1);
    expect(dryRun.deferredVolumes).toBe(1);
    expect(filteredItem).toMatchObject({
      status: 'filtered',
    });
    expect(filteredItem?.reason).toContain('--min-free-ratio');
    expect(plannedItem).toMatchObject({
      status: 'planned',
    });
    expect(deferredItem).toMatchObject({
      status: 'deferred',
    });
    expect(deferredItem?.reason).toContain('--limit 1');
  });

  it('blocks unsafe recommended batch compaction by default unless includeUnsafe is enabled', async () => {
    const runtime = await createIsolatedRuntime();
    const volume = await runtime.volumeService.createVolume({ name: 'Unsafe churn' });
    const repository = new VolumeRepository(
      runtime.config,
      runtime.logger.child({ scope: 'unsafe-compaction-repository' }),
    );

    await runtime.volumeService.writeTextFile(
      volume.id,
      '/deleted.txt',
      'z'.repeat(2 * 1024 * 1024),
    );
    await runtime.volumeService.deleteEntry(volume.id, '/deleted.txt');
    await runtime.volumeService.writeTextFile(volume.id, '/broken.txt', 'broken payload');

    const record = await repository.loadVolume(volume.id);
    const brokenEntry = Object.values(record.state.entries).find(
      (entry) => entry.kind === 'file' && entry.name === 'broken.txt',
    );

    expect(brokenEntry?.kind).toBe('file');

    await withVolumeDatabase(getVolumeDatabasePath(runtime.config.dataDir, volume.id), async (database) => {
      await database.exec('PRAGMA foreign_keys = OFF');
      await database.run(
        'DELETE FROM blob_chunks WHERE content_ref = ?',
        brokenEntry?.kind === 'file' ? brokenEntry.contentRef : '',
      );
      await database.run(
        'DELETE FROM blobs WHERE content_ref = ?',
        brokenEntry?.kind === 'file' ? brokenEntry.contentRef : '',
      );
      await database.exec('PRAGMA foreign_keys = ON');
    });

    const doctorBefore = await runtime.volumeService.runDoctor(volume.id);
    const blockedDryRun = await runtime.volumeService.compactRecommendedVolumes({
      dryRun: true,
    });
    const unsafeBatch = await runtime.volumeService.compactRecommendedVolumes({
      includeUnsafe: true,
    });
    const doctorAfter = await runtime.volumeService.runDoctor(volume.id);
    const issueCodesAfter = doctorAfter.volumes[0]?.issues.map((issue) => issue.code) ?? [];

    expect(
      doctorBefore.volumes[0]?.issues.some((issue) => issue.code === 'COMPACTION_RECOMMENDED'),
    ).toBe(true);
    expect(
      doctorBefore.volumes[0]?.issues.some((issue) => issue.code === 'MISSING_BLOB'),
    ).toBe(true);
    expect(blockedDryRun.recommendedVolumes).toBe(1);
    expect(blockedDryRun.eligibleVolumes).toBe(1);
    expect(blockedDryRun.blockedVolumes).toBe(1);
    expect(blockedDryRun.plannedVolumes).toBe(0);
    expect(blockedDryRun.volumes[0]).toMatchObject({
      volumeId: volume.id,
      status: 'blocked',
    });
    expect(blockedDryRun.volumes[0]?.blockingIssueCodes).toEqual(
      expect.arrayContaining(['MISSING_BLOB']),
    );
    expect(unsafeBatch.includeUnsafe).toBe(true);
    expect(unsafeBatch.blockedVolumes).toBe(0);
    expect(unsafeBatch.plannedVolumes).toBe(1);
    expect(unsafeBatch.compactedVolumes).toBe(1);
    expect(unsafeBatch.volumes[0]?.status).toBe('compacted');
    expect(issueCodesAfter).toContain('MISSING_BLOB');
    expect(issueCodesAfter).not.toContain('COMPACTION_RECOMMENDED');
  });

  it('rejects restore when the backup manifest checksum does not match the artifact', async () => {
    const runtime = await createIsolatedRuntime();
    const volume = await runtime.volumeService.createVolume({ name: 'Tamper Detection' });
    const backupRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'virtual-tamper-backup-'));
    sandboxes.push(backupRoot);
    const backupPath = path.join(backupRoot, 'tamper-detection.sqlite');

    await runtime.volumeService.writeTextFile(volume.id, '/report.txt', 'tamper detection');

    const backupResult = await runtime.volumeService.backupVolume(volume.id, backupPath);
    const backupManifest = JSON.parse(
      await fs.readFile(backupResult.manifestPath, 'utf8'),
    ) as VolumeBackupManifest;
    backupManifest.checksumSha256 = '0'.repeat(64);
    await fs.writeFile(
      backupResult.manifestPath,
      JSON.stringify(backupManifest, null, 2),
      'utf8',
    );

    await runtime.volumeService.deleteVolume(volume.id);

    await expect(runtime.volumeService.restoreVolumeBackup(backupPath)).rejects.toMatchObject({
      code: 'INVALID_OPERATION',
      details: {
        backupPath: path.resolve(backupPath),
        manifestPath: backupResult.manifestPath,
        mismatches: ['checksumSha256'],
      },
    });

    await expect(runtime.volumeService.getExplorerSnapshot(volume.id, '/')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('rejects inspection and restore when the backup was created by a newer CLI major version', async () => {
    const runtime = await createIsolatedRuntime();
    const volume = await runtime.volumeService.createVolume({ name: 'Version Guard' });
    const backupRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'virtual-version-guard-'));
    sandboxes.push(backupRoot);
    const backupPath = path.join(backupRoot, 'version-guard.sqlite');

    await runtime.volumeService.writeTextFile(volume.id, '/report.txt', 'version guard');

    const backupResult = await runtime.volumeService.backupVolume(volume.id, backupPath);
    const backupManifest = JSON.parse(
      await fs.readFile(backupResult.manifestPath, 'utf8'),
    ) as VolumeBackupManifest;
    backupManifest.createdWithVersion = '2.0.0';
    await fs.writeFile(
      backupResult.manifestPath,
      JSON.stringify(backupManifest, null, 2),
      'utf8',
    );

    await expect(runtime.volumeService.inspectVolumeBackup(backupPath)).rejects.toMatchObject({
      code: 'INVALID_OPERATION',
      details: {
        backupPath: path.resolve(backupPath),
        manifestPath: backupResult.manifestPath,
        backupCreatedWithVersion: '2.0.0',
        currentRuntimeVersion: APP_VERSION,
      },
    });

    await runtime.volumeService.deleteVolume(volume.id);

    await expect(runtime.volumeService.restoreVolumeBackup(backupPath)).rejects.toMatchObject({
      code: 'INVALID_OPERATION',
      details: {
        backupPath: path.resolve(backupPath),
        manifestPath: backupResult.manifestPath,
        backupCreatedWithVersion: '2.0.0',
        currentRuntimeVersion: APP_VERSION,
      },
    });
  });

  it('rejects inspection and restore when the backup sqlite schema is newer than the runtime supports', async () => {
    const runtime = await createIsolatedRuntime();
    const volume = await runtime.volumeService.createVolume({ name: 'Schema Guard' });
    const backupRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'virtual-schema-guard-'));
    sandboxes.push(backupRoot);
    const backupPath = path.join(backupRoot, 'schema-guard.sqlite');
    const futureSchemaVersion = SUPPORTED_VOLUME_SCHEMA_VERSION + 1;

    await runtime.volumeService.writeTextFile(volume.id, '/report.txt', 'schema guard');

    const backupResult = await runtime.volumeService.backupVolume(volume.id, backupPath);
    const rawDatabase = await open({
      filename: backupPath,
      driver: sqlite3.Database,
    });

    try {
      await rawDatabase.run(
        `UPDATE schema_metadata
            SET value = ?
          WHERE key = 'schema_version'`,
        String(futureSchemaVersion),
      );
    } finally {
      await rawDatabase.close();
    }

    await expect(runtime.volumeService.inspectVolumeBackup(backupPath)).rejects.toMatchObject({
      code: 'INVALID_OPERATION',
      details: {
        currentSchemaVersion: futureSchemaVersion,
        supportedSchemaVersion: SUPPORTED_VOLUME_SCHEMA_VERSION,
      },
    });

    await runtime.volumeService.deleteVolume(volume.id);

    await expect(runtime.volumeService.restoreVolumeBackup(backupPath)).rejects.toMatchObject({
      code: 'INVALID_OPERATION',
      details: {
        currentSchemaVersion: futureSchemaVersion,
        supportedSchemaVersion: SUPPORTED_VOLUME_SCHEMA_VERSION,
      },
    });

    await expect(runtime.volumeService.getExplorerSnapshot(volume.id, '/')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(fs.access(backupResult.backupPath)).resolves.toBeUndefined();
  });

  it('requires overwrite to restore over an existing volume and rolls live changes back to the backup state', async () => {
    const runtime = await createIsolatedRuntime();
    const volume = await runtime.volumeService.createVolume({ name: 'Rollback Drill' });
    const backupRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'virtual-rollback-'));
    sandboxes.push(backupRoot);
    const backupPath = path.join(backupRoot, 'rollback-drill.sqlite');

    await runtime.volumeService.writeTextFile(volume.id, '/baseline.txt', 'before restore');
    await runtime.volumeService.backupVolume(volume.id, backupPath);

    await runtime.volumeService.writeTextFile(volume.id, '/baseline.txt', 'after restore point');
    await runtime.volumeService.writeTextFile(volume.id, '/extra.txt', 'extra file');

    await expect(runtime.volumeService.restoreVolumeBackup(backupPath)).rejects.toMatchObject({
      code: 'ALREADY_EXISTS',
    });

    const restoreResult = await runtime.volumeService.restoreVolumeBackup(backupPath, {
      overwrite: true,
    });
    const rootSnapshot = await runtime.volumeService.getExplorerSnapshot(volume.id, '/');
    const preview = await runtime.volumeService.previewFile(volume.id, '/baseline.txt');

    expect(restoreResult).toMatchObject({
      volumeId: volume.id,
      volumeName: 'Rollback Drill',
      backupPath: path.resolve(backupPath),
      revision: 2,
    });
    expect(rootSnapshot.entries.map((entry) => entry.name)).toEqual(['baseline.txt']);
    expect(preview.content).toContain('before restore');
    await expect(runtime.volumeService.previewFile(volume.id, '/extra.txt')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('rolls back to the live target volume when overwrite restore swap fails mid-flight', async () => {
    const runtime = await createIsolatedRuntime();
    const volume = await runtime.volumeService.createVolume({ name: 'Rollback Safety' });
    const backupRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'virtual-restore-failure-'));
    sandboxes.push(backupRoot);
    const backupPath = path.join(backupRoot, 'rollback-safety.sqlite');
    const targetDatabasePath = getVolumeDatabasePath(runtime.config.dataDir, volume.id);
    const realRename = fs.rename.bind(fs);
    let targetRenameAttempts = 0;

    await runtime.volumeService.writeTextFile(volume.id, '/baseline.txt', 'backup state');
    await runtime.volumeService.backupVolume(volume.id, backupPath);

    await runtime.volumeService.writeTextFile(volume.id, '/baseline.txt', 'live state');
    await runtime.volumeService.writeTextFile(volume.id, '/extra.txt', 'must survive');

    const renameSpy = vi
      .spyOn(fs, 'rename')
      .mockImplementation(async (...args: Parameters<typeof fs.rename>) => {
        const [, destinationPath] = args;
        const destinationPathText =
          typeof destinationPath === 'string'
            ? destinationPath
            : destinationPath.toString();
        if (
          path.resolve(destinationPathText) === path.resolve(targetDatabasePath) &&
          targetRenameAttempts === 0
        ) {
          targetRenameAttempts += 1;
          throw new Error('Simulated restore swap failure.');
        }

        return realRename(...args);
      });

    await expect(
      runtime.volumeService.restoreVolumeBackup(backupPath, { overwrite: true }),
    ).rejects.toThrow('Simulated restore swap failure.');

    renameSpy.mockRestore();

    const rootSnapshot = await runtime.volumeService.getExplorerSnapshot(volume.id, '/');
    const preview = await runtime.volumeService.previewFile(volume.id, '/baseline.txt');

    expect(rootSnapshot.entries.map((entry) => entry.name)).toEqual([
      'baseline.txt',
      'extra.txt',
    ]);
    expect(preview.content).toContain('live state');
    await expect(runtime.volumeService.previewFile(volume.id, '/extra.txt')).resolves.toMatchObject({
      kind: 'text',
      content: 'must survive',
    });
  });

  it('reports missing and orphaned blobs through storage doctor diagnostics', async () => {
    const runtime = await createIsolatedRuntime();
    const volume = await runtime.volumeService.createVolume({ name: 'Doctor' });
    const repository = new VolumeRepository(
      runtime.config,
      runtime.logger.child({ scope: 'doctor-repository' }),
    );
    const blobStore = new BlobStore(
      getVolumeDatabasePath(runtime.config.dataDir, volume.id),
      runtime.logger.child({ scope: 'doctor-blob-store' }),
    );

    await repository.initialize();
    await runtime.volumeService.writeTextFile(volume.id, '/tracked.txt', 'tracked content');

    const record = await repository.loadVolume(volume.id);
    const trackedEntry = Object.values(record.state.entries).find(
      (entry) => entry.kind === 'file' && entry.name === 'tracked.txt',
    );

    expect(trackedEntry?.kind).toBe('file');

    const orphanBlob = await blobStore.putBuffer(Buffer.from('orphan blob', 'utf8'));

    await withVolumeDatabase(getVolumeDatabasePath(runtime.config.dataDir, volume.id), async (database) => {
      await database.exec('PRAGMA foreign_keys = OFF');
      await database.run(
        'DELETE FROM blob_chunks WHERE content_ref = ?',
        trackedEntry?.kind === 'file' ? trackedEntry.contentRef : '',
      );
      await database.run(
        'DELETE FROM blobs WHERE content_ref = ?',
        trackedEntry?.kind === 'file' ? trackedEntry.contentRef : '',
      );
      await database.exec('PRAGMA foreign_keys = ON');
    });

    const report = await runtime.volumeService.runDoctor(volume.id);
    const issueCodes = report.volumes[0]?.issues.map((issue) => issue.code) ?? [];

    expect(report.healthy).toBe(false);
    expect(report.issueCount).toBeGreaterThanOrEqual(2);
    expect(issueCodes).toContain('MISSING_BLOB');
    expect(issueCodes).toContain('ORPHAN_BLOB');
    expect(
      report.volumes[0]?.issues.some(
        (issue) => issue.code === 'ORPHAN_BLOB' && issue.contentRef === orphanBlob.contentRef,
      ),
    ).toBe(true);
  });

  it('reports sqlite foreign key violations alongside logical storage issues', async () => {
    const runtime = await createIsolatedRuntime();
    const volume = await runtime.volumeService.createVolume({ name: 'SQLite FK Doctor' });
    const databasePath = getVolumeDatabasePath(runtime.config.dataDir, volume.id);
    const timestamp = new Date().toISOString();

    await withVolumeDatabase(databasePath, async (database) => {
      await database.exec('PRAGMA foreign_keys = OFF');

      try {
        await database.run(
          `INSERT INTO entries (
             id,
             kind,
             name,
             parent_id,
             created_at,
             updated_at,
             size,
             content_ref,
             imported_from_host_path
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
          'file_fk_violation',
          'file',
          'ghost.txt',
          'missing_parent',
          timestamp,
          timestamp,
          12,
          'missing_blob_ref',
        );
      } finally {
        await database.exec('PRAGMA foreign_keys = ON');
      }
    });

    const report = await runtime.volumeService.runDoctor(volume.id);
    const issueCodes = report.volumes[0]?.issues.map((issue) => issue.code) ?? [];

    expect(report.healthy).toBe(false);
    expect(issueCodes).toContain('SQLITE_FOREIGN_KEY_VIOLATION');
    expect(issueCodes).toContain('MISSING_PARENT');
    expect(issueCodes).toContain('MISSING_BLOB');
  });

  it('reports unreadable sqlite volume files instead of silently skipping them', async () => {
    const runtime = await createIsolatedRuntime();
    const volume = await runtime.volumeService.createVolume({ name: 'Healthy Volume' });
    const unreadableVolumeId = 'vol_brokenfile';
    const unreadableDatabasePath = getVolumeDatabasePath(runtime.config.dataDir, unreadableVolumeId);

    await fs.mkdir(path.dirname(unreadableDatabasePath), { recursive: true });
    await fs.writeFile(unreadableDatabasePath, 'not a sqlite database', 'utf8');

    const report = await runtime.volumeService.runDoctor();
    const brokenVolumeReport = report.volumes.find(
      (volumeReport) => volumeReport.volumeId === unreadableVolumeId,
    );
    const healthyVolumeReport = report.volumes.find(
      (volumeReport) => volumeReport.volumeId === volume.id,
    );

    expect(report.checkedVolumes).toBe(2);
    expect(report.healthy).toBe(false);
    expect(healthyVolumeReport?.healthy).toBe(true);
    expect(brokenVolumeReport?.healthy).toBe(false);
    expect(brokenVolumeReport?.issues).toHaveLength(1);
    expect(brokenVolumeReport?.issues[0]?.code).toBe('DATABASE_OPEN_FAILED');
    expect(brokenVolumeReport?.issues[0]?.severity).toBe('error');
    expect(brokenVolumeReport?.issues[0]?.message).toContain(
      `Volume ${unreadableVolumeId} could not be inspected`,
    );
  });

  it('repairs orphan blobs and manifest counter mismatches safely', async () => {
    const runtime = await createIsolatedRuntime();
    const volume = await runtime.volumeService.createVolume({ name: 'Repair' });
    const blobStore = new BlobStore(
      getVolumeDatabasePath(runtime.config.dataDir, volume.id),
      runtime.logger.child({ scope: 'repair-blob-store' }),
    );

    await runtime.volumeService.writeTextFile(volume.id, '/tracked.txt', 'tracked content');
    const orphanBlob = await blobStore.putBuffer(Buffer.from('orphan blob', 'utf8'));

    await withVolumeDatabase(getVolumeDatabasePath(runtime.config.dataDir, volume.id), async (database) => {
      await database.run(
        `UPDATE manifest
            SET logical_used_bytes = 0,
                entry_count = 999`,
      );
    });

    const repairReport = await runtime.volumeService.runRepair(volume.id);
    const repairedVolume = repairReport.volumes[0];

    expect(repairReport.healthy).toBe(true);
    expect(repairReport.actionsApplied).toBeGreaterThanOrEqual(2);
    expect(repairedVolume?.actions.some((action) => action.code === 'DELETE_ORPHAN_BLOB')).toBe(
      true,
    );
    expect(repairedVolume?.actions.some((action) => action.code === 'REBUILD_MANIFEST')).toBe(
      true,
    );
    expect(repairedVolume?.issueCountBefore).toBeGreaterThanOrEqual(2);
    expect(repairedVolume?.issueCountAfter).toBe(0);

    const finalDoctorReport = await runtime.volumeService.runDoctor(volume.id);
    expect(finalDoctorReport.healthy).toBe(true);

    await withVolumeDatabase(getVolumeDatabasePath(runtime.config.dataDir, volume.id), async (database) => {
      const orphanBlobRow = await database.get<{ content_ref: string }>(
        'SELECT content_ref FROM blobs WHERE content_ref = ?',
        orphanBlob.contentRef,
      );
      const manifestRow = await database.get<{
        logical_used_bytes: number;
        entry_count: number;
      }>(
        'SELECT logical_used_bytes, entry_count FROM manifest LIMIT 1',
      );

      expect(orphanBlobRow).toBeUndefined();
      expect(manifestRow?.logical_used_bytes).toBe(Buffer.byteLength('tracked content', 'utf8'));
      expect(manifestRow?.entry_count).toBe(2);
    });
  });

  it('enforces sibling uniqueness at the SQLite level', async () => {
    const runtime = await createIsolatedRuntime();
    const volume = await runtime.volumeService.createVolume({ name: 'Unique Siblings' });
    const timestamp = new Date().toISOString();

    await runtime.volumeService.createDirectory(volume.id, '/', 'docs');

    await withVolumeDatabase(getVolumeDatabasePath(runtime.config.dataDir, volume.id), async (database) => {
      await database.exec('BEGIN IMMEDIATE TRANSACTION');

      try {
        await expect(
          database.run(
            `INSERT INTO entries (
               id,
               kind,
               name,
               parent_id,
               created_at,
               updated_at,
               size,
               content_ref,
               imported_from_host_path
             ) VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, NULL)`,
            'dir_duplicate_docs',
            'directory',
            'docs',
            'root',
            timestamp,
            timestamp,
          ),
        ).rejects.toMatchObject({
          code: 'SQLITE_CONSTRAINT',
        });
      } finally {
        await database.exec('ROLLBACK').catch(() => undefined);
      }
    });
  });

  it('enforces relational foreign keys for file blobs at the SQLite level', async () => {
    const runtime = await createIsolatedRuntime();
    const volume = await runtime.volumeService.createVolume({ name: 'Relational Constraints' });
    const timestamp = new Date().toISOString();

    await withVolumeDatabase(getVolumeDatabasePath(runtime.config.dataDir, volume.id), async (database) => {
      const entryForeignKeys = await database.all<{ table: string; from: string }[]>(
        'PRAGMA foreign_key_list(entries)',
      );
      const blobChunkForeignKeys = await database.all<{ table: string; from: string }[]>(
        'PRAGMA foreign_key_list(blob_chunks)',
      );

      expect(
        entryForeignKeys.some((row) => row.table === 'entries' && row.from === 'parent_id'),
      ).toBe(true);
      expect(
        entryForeignKeys.some((row) => row.table === 'blobs' && row.from === 'content_ref'),
      ).toBe(true);
      expect(
        blobChunkForeignKeys.some(
          (row) => row.table === 'blobs' && row.from === 'content_ref',
        ),
      ).toBe(true);

      await database.exec('BEGIN IMMEDIATE TRANSACTION');

      try {
        await database.run(
          `INSERT INTO entries (
             id,
             kind,
             name,
             parent_id,
             created_at,
             updated_at,
             size,
             content_ref,
             imported_from_host_path
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
          'file_missing_blob',
          'file',
          'ghost.txt',
          'root',
          timestamp,
          timestamp,
          5,
          'missing_blob_ref',
        );

        await expect(database.exec('COMMIT')).rejects.toMatchObject({
          code: 'SQLITE_CONSTRAINT',
        });
      } finally {
        await database.exec('ROLLBACK').catch(() => undefined);
      }
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
