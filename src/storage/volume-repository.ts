import fs from 'node:fs/promises';
import path from 'node:path';

import { nanoid } from 'nanoid';
import type { Logger } from 'pino';

import { VolumeError } from '../domain/errors.js';
import type {
  CreateVolumeInput,
  DirectoryEntry,
  FileEntry,
  VolumeManifest,
  VolumeRecord,
  VolumeState,
} from '../domain/types.js';
import {
  ensureDirectory,
  pathExists,
  readJsonFile,
  writeJsonAtomic,
} from '../utils/fs.js';

interface RepositoryConfig {
  dataDir: string;
}

export class VolumeRepository {
  public constructor(
    private readonly config: RepositoryConfig,
    private readonly logger: Logger,
  ) {}

  public async initialize(): Promise<void> {
    await ensureDirectory(this.getVolumesDirectory());
  }

  public async listVolumes(): Promise<VolumeManifest[]> {
    await this.initialize();

    const directoryEntries = await fs.readdir(this.getVolumesDirectory(), {
      withFileTypes: true,
    });

    const manifests = await Promise.all(
      directoryEntries
        .filter((entry) => entry.isDirectory())
        .map(async (entry) => {
          const manifestPath = path.join(
            this.getVolumeDirectory(entry.name),
            'manifest.json',
          );

          if (!(await pathExists(manifestPath))) {
            return null;
          }

          return readJsonFile<VolumeManifest>(manifestPath);
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
    const volumeDirectory = this.getVolumeDirectory(id);

    await ensureDirectory(volumeDirectory);

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

  public async loadVolume(volumeId: string): Promise<VolumeRecord> {
    const manifestPath = path.join(this.getVolumeDirectory(volumeId), 'manifest.json');
    const statePath = path.join(this.getVolumeDirectory(volumeId), 'state.json');

    if (!(await pathExists(manifestPath)) || !(await pathExists(statePath))) {
      throw new VolumeError('NOT_FOUND', `Volume ${volumeId} does not exist.`, {
        volumeId,
      });
    }

    const [manifest, state] = await Promise.all([
      readJsonFile<VolumeManifest>(manifestPath),
      readJsonFile<VolumeState>(statePath),
    ]);

    return { manifest, state };
  }

  public async saveVolume(record: VolumeRecord): Promise<void> {
    const now = new Date().toISOString();
    const volumeDirectory = this.getVolumeDirectory(record.manifest.id);
    const manifestPath = path.join(volumeDirectory, 'manifest.json');
    const statePath = path.join(volumeDirectory, 'state.json');

    record.manifest.logicalUsedBytes = this.getLogicalUsedBytes(record.state);
    record.manifest.entryCount = Object.keys(record.state.entries).length;
    record.manifest.updatedAt = now;

    await Promise.all([
      writeJsonAtomic(manifestPath, record.manifest),
      writeJsonAtomic(statePath, record.state),
    ]);

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
    const targetDirectory = this.getVolumeDirectory(volumeId);
    await fs.rm(targetDirectory, { recursive: true, force: true });
    this.logger.info({ volumeId }, 'Volume deleted.');
  }

  public getVolumeDirectory(volumeId: string): string {
    return path.join(this.getVolumesDirectory(), volumeId);
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
}
