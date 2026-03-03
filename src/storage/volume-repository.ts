import fs from 'node:fs/promises';
import path from 'node:path';

import { nanoid } from 'nanoid';
import type { Logger } from 'pino';

import { VolumeError } from '../domain/errors.js';
import type {
  CreateVolumeInput,
  DirectoryEntry,
  FileEntry,
  VolumeEntry,
  VolumeManifest,
  VolumeRecord,
  VolumeState,
} from '../domain/types.js';
import { ensureDirectory, pathExists, readJsonFile } from '../utils/fs.js';
import { BlobStore } from './blob-store.js';
import {
  VOLUME_DATABASE_EXTENSION,
  type VolumeEntryRow,
  type VolumeManifestRow,
  getVolumeDatabasePath,
  withVolumeDatabase,
} from './sqlite-volume.js';

interface RepositoryConfig {
  dataDir: string;
}

interface LoadVolumeOptions {
  preferCache?: boolean;
}

export class VolumeRepository {
  private readonly volumeCache = new Map<string, VolumeRecord>();

  public constructor(
    private readonly config: RepositoryConfig,
    private readonly logger: Logger,
  ) {}

  public async initialize(): Promise<void> {
    await ensureDirectory(this.getVolumesDirectory());
    await this.migrateLegacyVolumes();
  }

  public async listVolumes(): Promise<VolumeManifest[]> {
    await this.initialize();

    const directoryEntries = await fs.readdir(this.getVolumesDirectory(), {
      withFileTypes: true,
    });

    const manifests = await Promise.all(
      directoryEntries
        .filter(
          (entry) => entry.isFile() && entry.name.endsWith(VOLUME_DATABASE_EXTENSION),
        )
        .map(async (entry) => {
          const databasePath = path.join(this.getVolumesDirectory(), entry.name);

          try {
            return await withVolumeDatabase(databasePath, async (database) => {
              const manifestRow = await database.get<VolumeManifestRow>(
                `SELECT
                   id,
                   name,
                   description,
                   quota_bytes,
                   logical_used_bytes,
                   entry_count,
                   created_at,
                   updated_at
                 FROM manifest
                 LIMIT 1`,
              );

              return manifestRow ? this.toManifest(manifestRow) : null;
            });
          } catch (error) {
            this.logger.warn(
              {
                databasePath,
                error: error instanceof Error ? error.message : String(error),
              },
              'Skipping unreadable volume database.',
            );
            return null;
          }
        }),
    );

    return manifests
      .filter((manifest): manifest is VolumeManifest => manifest !== null)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  public async createVolume(input: Required<CreateVolumeInput>): Promise<VolumeRecord> {
    await this.initialize();

    const id = `vol_${nanoid(10)}`;
    const now = new Date().toISOString();

    const rootEntry: DirectoryEntry = {
      id: 'root',
      kind: 'directory',
      name: '/',
      parentId: null,
      childIds: [],
      createdAt: now,
      updatedAt: now,
    };

    const state: VolumeState = {
      version: 1,
      rootId: rootEntry.id,
      entries: {
        [rootEntry.id]: rootEntry,
      },
    };

    const record: VolumeRecord = {
      manifest: {
        id,
        name: input.name,
        description: input.description,
        quotaBytes: input.quotaBytes,
        logicalUsedBytes: 0,
        entryCount: 1,
        createdAt: now,
        updatedAt: now,
      },
      state,
    };

    await this.saveVolume(record);
    this.logger.info({ volumeId: id, name: input.name }, 'Volume created.');

    return record;
  }

  public async loadVolume(
    volumeId: string,
    options: LoadVolumeOptions = {},
  ): Promise<VolumeRecord> {
    if (options.preferCache) {
      const cachedRecord = this.volumeCache.get(volumeId);
      if (cachedRecord) {
        return cachedRecord;
      }
    }

    const databasePath = this.getVolumeDatabasePath(volumeId);
    if (!(await pathExists(databasePath))) {
      throw new VolumeError('NOT_FOUND', `Volume ${volumeId} does not exist.`, {
        volumeId,
      });
    }

    const record = await withVolumeDatabase(databasePath, async (database) => {
      const manifestRow = await database.get<VolumeManifestRow>(
        `SELECT
           id,
           name,
           description,
           quota_bytes,
           logical_used_bytes,
           entry_count,
           created_at,
           updated_at
         FROM manifest
         LIMIT 1`,
      );

      if (!manifestRow) {
        throw new VolumeError('NOT_FOUND', `Volume ${volumeId} does not exist.`, {
          volumeId,
        });
      }

      const entryRows = await database.all<VolumeEntryRow[]>(
        `SELECT
           id,
           kind,
           name,
           parent_id,
           created_at,
           updated_at,
           size,
           content_ref,
           imported_from_host_path
         FROM entries`,
      );

      const state = this.toState(entryRows, volumeId);
      return {
        manifest: this.toManifest(manifestRow),
        state,
      };
    });

    if (options.preferCache) {
      this.volumeCache.set(volumeId, record);
    }

    return record;
  }

  public async saveVolume(record: VolumeRecord): Promise<void> {
    const now = new Date().toISOString();
    record.manifest.logicalUsedBytes = this.getLogicalUsedBytes(record.state);
    record.manifest.entryCount = Object.keys(record.state.entries).length;
    record.manifest.updatedAt = now;

    const databasePath = this.getVolumeDatabasePath(record.manifest.id);

    await withVolumeDatabase(databasePath, async (database) => {
      await database.exec('BEGIN IMMEDIATE TRANSACTION');

      try {
        await database.exec('DELETE FROM manifest');
        await database.run(
          `INSERT INTO manifest (
             id,
             name,
             description,
             quota_bytes,
             logical_used_bytes,
             entry_count,
             created_at,
             updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          record.manifest.id,
          record.manifest.name,
          record.manifest.description,
          record.manifest.quotaBytes,
          record.manifest.logicalUsedBytes,
          record.manifest.entryCount,
          record.manifest.createdAt,
          record.manifest.updatedAt,
        );

        await database.exec('DELETE FROM entries');

        for (const entry of Object.values(record.state.entries)) {
          if (entry.kind === 'directory') {
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
               ) VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, NULL)`,
              entry.id,
              entry.kind,
              entry.name,
              entry.parentId,
              entry.createdAt,
              entry.updatedAt,
            );
            continue;
          }

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
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            entry.id,
            entry.kind,
            entry.name,
            entry.parentId,
            entry.createdAt,
            entry.updatedAt,
            entry.size,
            entry.contentRef,
            entry.importedFromHostPath,
          );
        }

        await database.exec('COMMIT');
      } catch (error) {
        await database.exec('ROLLBACK').catch(() => undefined);
        throw error;
      }
    });

    this.volumeCache.set(record.manifest.id, record);

    this.logger.debug(
      {
        volumeId: record.manifest.id,
        entryCount: record.manifest.entryCount,
        logicalUsedBytes: record.manifest.logicalUsedBytes,
      },
      'Volume persisted.',
    );
  }

  public async deleteVolume(volumeId: string): Promise<void> {
    const databasePath = this.getVolumeDatabasePath(volumeId);
    await Promise.all([
      fs.rm(databasePath, { force: true }),
      fs.rm(`${databasePath}-journal`, { force: true }),
      fs.rm(`${databasePath}-wal`, { force: true }),
      fs.rm(`${databasePath}-shm`, { force: true }),
    ]);
    this.volumeCache.delete(volumeId);
    this.logger.info({ volumeId }, 'Volume deleted.');
  }

  public getVolumeDatabasePath(volumeId: string): string {
    return getVolumeDatabasePath(this.config.dataDir, volumeId);
  }

  private getVolumesDirectory(): string {
    return path.join(this.config.dataDir, 'volumes');
  }

  private getLogicalUsedBytes(state: VolumeState): number {
    return Object.values(state.entries).reduce((total, entry) => {
      if ((entry as FileEntry).kind === 'file') {
        return total + (entry as FileEntry).size;
      }

      return total;
    }, 0);
  }

  private toManifest(row: VolumeManifestRow): VolumeManifest {
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      quotaBytes: row.quota_bytes,
      logicalUsedBytes: row.logical_used_bytes,
      entryCount: row.entry_count,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private toState(entryRows: VolumeEntryRow[], volumeId: string): VolumeState {
    const entries: Record<string, VolumeEntry> = {};
    let rootId: string | null = null;

    for (const row of entryRows) {
      if (row.kind === 'directory') {
        entries[row.id] = {
          id: row.id,
          kind: 'directory',
          name: row.name,
          parentId: row.parent_id,
          childIds: [],
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        };
      } else {
        entries[row.id] = {
          id: row.id,
          kind: 'file',
          name: row.name,
          parentId: row.parent_id,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
          size: row.size ?? 0,
          contentRef: row.content_ref ?? '',
          importedFromHostPath: row.imported_from_host_path,
        };
      }

      if (row.parent_id === null) {
        rootId = row.id;
      }
    }

    if (!rootId) {
      throw new VolumeError(
        'INVALID_PATH',
        `Volume ${volumeId} does not contain a root directory.`,
      );
    }

    for (const entry of Object.values(entries)) {
      if (entry.parentId === null) {
        continue;
      }

      const parentEntry = entries[entry.parentId];
      if (parentEntry?.kind === 'directory') {
        parentEntry.childIds.push(entry.id);
      }
    }

    return {
      version: 1,
      rootId,
      entries,
    };
  }

  private async migrateLegacyVolumes(): Promise<void> {
    const directoryEntries = await fs.readdir(this.getVolumesDirectory(), {
      withFileTypes: true,
    });

    for (const entry of directoryEntries) {
      if (!entry.isDirectory()) {
        continue;
      }

      const legacyDirectoryPath = path.join(this.getVolumesDirectory(), entry.name);
      const manifestPath = path.join(legacyDirectoryPath, 'manifest.json');
      const statePath = path.join(legacyDirectoryPath, 'state.json');

      if (!(await pathExists(manifestPath)) || !(await pathExists(statePath))) {
        continue;
      }

      try {
        const manifest = await readJsonFile<VolumeManifest>(manifestPath);
        const state = await readJsonFile<VolumeState>(statePath);
        const databasePath = this.getVolumeDatabasePath(manifest.id);

        if (!(await pathExists(databasePath))) {
          await this.saveVolume({ manifest, state });
          await this.migrateLegacyBlobs(legacyDirectoryPath, databasePath, state);
        }

        await fs.rm(legacyDirectoryPath, { recursive: true, force: true });
        this.logger.info(
          { legacyDirectoryPath, volumeId: manifest.id },
          'Migrated legacy volume directory to sqlite volume file.',
        );
      } catch (error) {
        this.logger.error(
          {
            legacyDirectoryPath,
            error: error instanceof Error ? error.message : String(error),
          },
          'Failed to migrate legacy volume directory.',
        );
      }
    }
  }

  private async migrateLegacyBlobs(
    legacyDirectoryPath: string,
    databasePath: string,
    state: VolumeState,
  ): Promise<void> {
    const contentRefs = new Set(
      Object.values(state.entries).flatMap((entry) =>
        entry.kind === 'file' ? [entry.contentRef] : [],
      ),
    );
    const blobStore = new BlobStore(
      databasePath,
      this.logger.child({ scope: 'blob-store-migration' }),
    );

    for (const contentRef of contentRefs) {
      const legacyBlobPath = path.join(
        legacyDirectoryPath,
        'blobs',
        contentRef.slice(0, 2),
        contentRef.slice(2),
      );

      if (!(await pathExists(legacyBlobPath))) {
        this.logger.warn(
          { legacyBlobPath, contentRef },
          'Legacy blob file is missing during sqlite migration.',
        );
        continue;
      }

      const buffer = await fs.readFile(legacyBlobPath);
      await blobStore.putKnownBuffer(contentRef, buffer);
    }
  }
}
