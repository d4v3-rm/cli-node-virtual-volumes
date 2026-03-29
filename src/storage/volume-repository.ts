import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';

import { nanoid } from 'nanoid';
import type { Logger } from 'pino';

import {
  APP_VERSION,
  isCompatibleBackupRuntimeVersion,
  parseSemanticVersion,
} from '../config/app-metadata.js';
import { VolumeError } from '../domain/errors.js';
import type {
  CreateVolumeInput,
  DirectoryEntry,
  FileEntry,
  StorageDoctorOptions,
  RestoreVolumeBackupOptions,
  StorageDoctorIssue,
  StorageDoctorMaintenanceSummary,
  StorageDoctorMaintenanceStats,
  StorageDoctorReport,
  StorageDoctorVolumeReport,
  StorageRepairAction,
  StorageRepairReport,
  StorageRepairVolumeReport,
  VolumeCompactionResult,
  VolumeBackupManifest,
  VolumeBackupInspectionResult,
  VolumeEntry,
  VolumeBackupResult,
  VolumeManifest,
  VolumeRecord,
  VolumeRestoreResult,
  VolumeState,
} from '../domain/types.js';
import {
  ensureDirectory,
  pathExists,
  readJsonFile,
  writeJsonAtomic,
} from '../utils/fs.js';
import {
  sanitizeObservabilityValue,
} from '../utils/observability-redaction.js';
import { BlobStore } from './blob-store.js';
import {
  type SqliteVolumeDatabase,
  SUPPORTED_VOLUME_SCHEMA_VERSION,
  VOLUME_DATABASE_EXTENSION,
  type VolumeEntryRow,
  type VolumeManifestRow,
  getVolumeDatabasePath,
  withVolumeDatabase,
} from './sqlite-volume.js';

interface RepositoryConfig {
  dataDir: string;
  redactSensitiveDetails: boolean;
}

interface LoadVolumeOptions {
  preferCache?: boolean;
}

interface SqliteForeignKeyCheckRow {
  fkid: number;
  parent: string;
  rowid: number;
  table: string;
}

interface VolumeDatabaseSnapshot {
  manifest: VolumeManifest;
  schemaVersion: number;
}

interface VolumeBackupArtifactMetadata {
  backupManifest: VolumeBackupManifest | null;
  backupManifestPath: string;
  bytesWritten: number;
  checksumSha256: string;
  snapshot: VolumeDatabaseSnapshot;
}

interface BlobPayloadStats {
  actualContentRef: string;
  actualSize: number;
  actualChunkCount: number;
  contiguousChunkIndexes: boolean;
}

const escapeSqliteStringLiteral = (value: string): string => value.replaceAll("'", "''");
const BACKUP_MANIFEST_SUFFIX = '.manifest.json';
const BACKUP_MANIFEST_FORMAT_VERSION = 1 as const;
const MAINTENANCE_SUMMARY_TOP_CANDIDATE_LIMIT = 5;

export class VolumeRepository {
  private readonly volumeCache = new Map<string, VolumeRecord>();

  public constructor(
    private readonly config: RepositoryConfig,
    private readonly logger: Logger,
  ) {}

  private sanitizeObservabilityPayload<T>(value: T): T {
    return sanitizeObservabilityValue(value, this.config.redactSensitiveDetails);
  }

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
                   revision,
                   created_at,
                   updated_at
                 FROM manifest
                 LIMIT 1`,
              );

              return manifestRow ? this.toManifest(manifestRow) : null;
            });
          } catch (error) {
            this.logger.warn(
              this.sanitizeObservabilityPayload({
                databasePath,
                error: error instanceof Error ? error.message : String(error),
              }),
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
        revision: 0,
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
           revision,
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
    const databasePath = this.getVolumeDatabasePath(record.manifest.id);

    await withVolumeDatabase(databasePath, async (database) => {
      await database.exec('BEGIN IMMEDIATE TRANSACTION');

      try {
        await this.persistVolumeToDatabase(database, record);
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
        revision: record.manifest.revision,
      },
      'Volume persisted.',
    );
  }

  public async mutateVolume<T>(
    volumeId: string,
    mutate: (
      record: VolumeRecord,
      database: SqliteVolumeDatabase,
    ) => Promise<T> | T,
  ): Promise<T> {
    const databasePath = this.getVolumeDatabasePath(volumeId);
    if (!(await pathExists(databasePath))) {
      throw new VolumeError('NOT_FOUND', `Volume ${volumeId} does not exist.`, {
        volumeId,
      });
    }

    return withVolumeDatabase(databasePath, async (database) => {
      await database.exec('BEGIN IMMEDIATE TRANSACTION');

      try {
        const record = await this.loadVolumeFromDatabase(database, volumeId);
        const result = await mutate(record, database);
        await this.persistVolumeToDatabase(database, record);
        await database.exec('COMMIT');

        this.volumeCache.set(record.manifest.id, record);
        this.logger.debug(
          {
            volumeId: record.manifest.id,
            entryCount: record.manifest.entryCount,
            logicalUsedBytes: record.manifest.logicalUsedBytes,
            revision: record.manifest.revision,
          },
          'Volume mutated transactionally.',
        );

        return result;
      } catch (error) {
        await database.exec('ROLLBACK').catch(() => undefined);
        throw error;
      }
    });
  }

  public async runDoctor(
    volumeId?: string,
    options: StorageDoctorOptions = {},
  ): Promise<StorageDoctorReport> {
    const volumeIds = volumeId
      ? [volumeId]
      : await this.listDiscoveredVolumeIds();
    const volumeReports = await Promise.all(
      volumeIds.map(async (discoveredVolumeId) =>
        this.inspectVolume(discoveredVolumeId, options),
      ),
    );
    const issueCount = volumeReports.reduce(
      (total, report) => total + report.issueCount,
      0,
    );
    const maintenanceSummary = volumeReports.reduce<StorageDoctorMaintenanceSummary>(
      (summary, report) => {
        if (!report.maintenance) {
          return summary;
        }

        summary.volumesWithStats += 1;
        summary.totalArtifactBytes += report.maintenance.artifactBytes;
        summary.totalFreeBytes += report.maintenance.freeBytes;
        if (report.maintenance.compactionRecommended) {
          summary.recommendedCompactions += 1;
        }
        return summary;
      },
      {
        volumesWithStats: 0,
        recommendedCompactions: 0,
        totalArtifactBytes: 0,
        totalFreeBytes: 0,
        topCompactionCandidates: [],
      },
    );
    maintenanceSummary.topCompactionCandidates = volumeReports
      .filter((report) => report.maintenance?.compactionRecommended)
      .sort(
        (left, right) =>
          (right.maintenance?.freeBytes ?? 0) - (left.maintenance?.freeBytes ?? 0),
      )
      .slice(0, MAINTENANCE_SUMMARY_TOP_CANDIDATE_LIMIT)
      .map((report) => ({
        volumeId: report.volumeId,
        volumeName: report.volumeName,
        revision: report.revision,
        issueCount: report.issueCount,
        artifactBytes: report.maintenance?.artifactBytes ?? 0,
        freeBytes: report.maintenance?.freeBytes ?? 0,
        freeRatio: report.maintenance?.freeRatio ?? 0,
      }));

    return {
      generatedAt: new Date().toISOString(),
      healthy: issueCount === 0,
      checkedVolumes: volumeReports.length,
      issueCount,
      integrityDepth: options.verifyBlobPayloads ? 'deep' : 'metadata',
      maintenanceSummary,
      volumes: volumeReports,
    };
  }

  public async runRepair(volumeId?: string): Promise<StorageRepairReport> {
    const manifests = volumeId
      ? [(await this.loadVolume(volumeId)).manifest]
      : await this.listVolumes();
    const volumeReports = await Promise.all(
      manifests.map(async (manifest) => this.repairVolume(manifest.id)),
    );

    return {
      generatedAt: new Date().toISOString(),
      healthy: volumeReports.every((report) => report.healthy),
      checkedVolumes: volumeReports.length,
      repairedVolumes: volumeReports.filter((report) => report.repaired).length,
      actionsApplied: volumeReports.reduce(
        (total, report) => total + report.actions.length,
        0,
      ),
      volumes: volumeReports,
    };
  }

  public async backupVolume(
    volumeId: string,
    destinationPath: string,
    options: { overwrite?: boolean } = {},
  ): Promise<VolumeBackupResult> {
    const databasePath = this.getVolumeDatabasePath(volumeId);
    if (!(await pathExists(databasePath))) {
      throw new VolumeError('NOT_FOUND', `Volume ${volumeId} does not exist.`, {
        volumeId,
      });
    }

    const absoluteDestinationPath = path.resolve(destinationPath);
    if (path.resolve(databasePath) === absoluteDestinationPath) {
      throw new VolumeError(
        'INVALID_OPERATION',
        'Cannot write a backup directly over the live volume database.',
        {
          volumeId,
          destinationPath: absoluteDestinationPath,
        },
      );
    }
    const destinationExists = await pathExists(absoluteDestinationPath);

    if (destinationExists && !options.overwrite) {
      throw new VolumeError(
        'ALREADY_EXISTS',
        `Backup destination already exists: ${absoluteDestinationPath}`,
        {
          destinationPath: absoluteDestinationPath,
        },
      );
    }

    await ensureDirectory(path.dirname(absoluteDestinationPath));
    const backupManifestPath = this.getBackupManifestPath(absoluteDestinationPath);

    try {
      const snapshot = await this.snapshotVolumeDatabase(
        databasePath,
        absoluteDestinationPath,
        volumeId,
      );

      const backupStats = await fs.stat(absoluteDestinationPath);
      const checksumSha256 = await this.computeFileSha256(absoluteDestinationPath);
      const backupManifest: VolumeBackupManifest = {
        formatVersion: BACKUP_MANIFEST_FORMAT_VERSION,
        volumeId: snapshot.manifest.id,
        volumeName: snapshot.manifest.name,
        revision: snapshot.manifest.revision,
        schemaVersion: snapshot.schemaVersion,
        createdWithVersion: APP_VERSION,
        bytesWritten: backupStats.size,
        checksumSha256,
        createdAt: new Date().toISOString(),
      };
      await writeJsonAtomic(backupManifestPath, backupManifest);

      const result: VolumeBackupResult = {
        ...backupManifest,
        backupPath: absoluteDestinationPath,
        manifestPath: backupManifestPath,
      };

        this.logger.info(
          this.sanitizeObservabilityPayload({
            volumeId: snapshot.manifest.id,
            backupPath: absoluteDestinationPath,
            manifestPath: backupManifestPath,
            bytesWritten: backupStats.size,
            createdWithVersion: APP_VERSION,
            checksumSha256,
            schemaVersion: snapshot.schemaVersion,
            revision: snapshot.manifest.revision,
          }),
          'Volume backup created.',
        );

      return result;
    } catch (error) {
      await Promise.all([
        this.deleteDatabaseArtifacts(absoluteDestinationPath).catch(() => undefined),
        fs.rm(backupManifestPath, { force: true }).catch(() => undefined),
      ]);
      throw error;
    }
  }

  public async inspectVolumeBackup(
    backupPath: string,
  ): Promise<VolumeBackupInspectionResult> {
    const absoluteBackupPath = path.resolve(backupPath);
    if (!(await pathExists(absoluteBackupPath))) {
      throw new VolumeError('NOT_FOUND', `Backup file does not exist: ${absoluteBackupPath}`, {
        backupPath: absoluteBackupPath,
      });
    }

    const volumesDirectory = this.getVolumesDirectory();
    await ensureDirectory(volumesDirectory);

    const temporaryInspectionPath = path.join(
      volumesDirectory,
      `inspect_${process.pid}_${Date.now()}_${nanoid(6)}${VOLUME_DATABASE_EXTENSION}`,
    );

    try {
      const artifact = await this.loadBackupArtifactMetadata(
        absoluteBackupPath,
        temporaryInspectionPath,
      );

      return {
        volumeId: artifact.snapshot.manifest.id,
        volumeName: artifact.snapshot.manifest.name,
        revision: artifact.snapshot.manifest.revision,
        schemaVersion: artifact.snapshot.schemaVersion,
        backupPath: absoluteBackupPath,
        manifestPath: artifact.backupManifest ? artifact.backupManifestPath : null,
        formatVersion: artifact.backupManifest?.formatVersion ?? null,
        createdWithVersion: artifact.backupManifest?.createdWithVersion ?? null,
        checksumSha256: artifact.checksumSha256,
        bytesWritten: artifact.bytesWritten,
        createdAt: artifact.backupManifest?.createdAt ?? null,
        validatedWithManifest: artifact.backupManifest !== null,
      };
    } finally {
      await this.deleteDatabaseArtifacts(temporaryInspectionPath).catch(() => undefined);
    }
  }

  public async restoreVolumeBackup(
    backupPath: string,
    options: RestoreVolumeBackupOptions = {},
  ): Promise<VolumeRestoreResult> {
    const absoluteBackupPath = path.resolve(backupPath);
    if (!(await pathExists(absoluteBackupPath))) {
      throw new VolumeError('NOT_FOUND', `Backup file does not exist: ${absoluteBackupPath}`, {
        backupPath: absoluteBackupPath,
      });
    }
    const volumesDirectory = this.getVolumesDirectory();
    await ensureDirectory(volumesDirectory);

    const temporaryRestorePath = path.join(
      volumesDirectory,
      `restore_${process.pid}_${Date.now()}_${nanoid(6)}${VOLUME_DATABASE_EXTENSION}`,
    );
    let restoredVolumeId: string | null = null;
    let rollbackSnapshotPath: string | null = null;

    try {
      const artifact = await this.loadBackupArtifactMetadata(
        absoluteBackupPath,
        temporaryRestorePath,
      );
      const manifest = artifact.snapshot.manifest;
      restoredVolumeId = manifest.id;

      const targetDatabasePath = this.getVolumeDatabasePath(manifest.id);
      if (path.resolve(targetDatabasePath) === absoluteBackupPath) {
        throw new VolumeError(
          'INVALID_OPERATION',
          'Cannot restore a backup directly over its own source file.',
          {
            backupPath: absoluteBackupPath,
            volumeId: manifest.id,
          },
        );
      }

      const targetExists = await pathExists(targetDatabasePath);
      if (targetExists && !options.overwrite) {
        throw new VolumeError(
          'ALREADY_EXISTS',
          `Volume ${manifest.id} already exists. Use overwrite to replace it from backup.`,
          {
            volumeId: manifest.id,
            backupPath: absoluteBackupPath,
          },
        );
      }

      if (targetExists) {
        rollbackSnapshotPath = path.join(
          volumesDirectory,
          `restore_rollback_${process.pid}_${Date.now()}_${nanoid(6)}${VOLUME_DATABASE_EXTENSION}`,
        );
        await this.snapshotVolumeDatabase(
          targetDatabasePath,
          rollbackSnapshotPath,
          manifest.id,
        );
        await this.deleteDatabaseArtifacts(targetDatabasePath);
      }

      try {
        await fs.rename(temporaryRestorePath, targetDatabasePath);
      } catch (error) {
        const rollbackError = rollbackSnapshotPath
          ? await this.rollbackOverwrittenRestore(
              rollbackSnapshotPath,
              targetDatabasePath,
              manifest.id,
            )
          : null;
        if (rollbackError) {
          throw new VolumeError(
            'INVALID_OPERATION',
            `Restore failed and the previous state of volume ${manifest.id} could not be recovered automatically.`,
            {
              backupPath: absoluteBackupPath,
              volumeId: manifest.id,
              restoreError:
                error instanceof Error ? error.message : String(error),
              rollbackError: rollbackError.message,
            },
          );
        }

        throw error;
      }
      this.volumeCache.delete(manifest.id);

      try {
        const restoredManifest = (await this.loadVolume(manifest.id)).manifest;
        const restoredStats = await fs.stat(targetDatabasePath);
        const result: VolumeRestoreResult = {
          volumeId: restoredManifest.id,
          volumeName: restoredManifest.name,
          revision: restoredManifest.revision,
          schemaVersion: artifact.snapshot.schemaVersion,
          backupPath: absoluteBackupPath,
          manifestPath: artifact.backupManifest ? artifact.backupManifestPath : null,
          createdWithVersion: artifact.backupManifest?.createdWithVersion ?? null,
          checksumSha256: artifact.checksumSha256,
          bytesRestored: restoredStats.size,
          restoredAt: new Date().toISOString(),
          validatedWithManifest: artifact.backupManifest !== null,
        };

          this.logger.info(
            this.sanitizeObservabilityPayload({
              volumeId: restoredManifest.id,
              backupPath: absoluteBackupPath,
              manifestPath: artifact.backupManifest ? artifact.backupManifestPath : null,
              bytesRestored: restoredStats.size,
              createdWithVersion: artifact.backupManifest?.createdWithVersion ?? null,
              checksumSha256: artifact.checksumSha256,
              schemaVersion: artifact.snapshot.schemaVersion,
              validatedWithManifest: artifact.backupManifest !== null,
              overwrite: options.overwrite ?? false,
              revision: restoredManifest.revision,
            }),
            'Volume restored from backup.',
          );

        return result;
      } catch (error) {
        const rollbackError = rollbackSnapshotPath
          ? await this.rollbackOverwrittenRestore(
              rollbackSnapshotPath,
              targetDatabasePath,
              manifest.id,
            )
          : null;
        if (rollbackError) {
          throw new VolumeError(
            'INVALID_OPERATION',
            `Restore validation failed and the previous state of volume ${manifest.id} could not be recovered automatically.`,
            {
              backupPath: absoluteBackupPath,
              volumeId: manifest.id,
              restoreError:
                error instanceof Error ? error.message : String(error),
              rollbackError: rollbackError.message,
            },
          );
        }

        throw error;
      }
    } catch (error) {
      await this.deleteDatabaseArtifacts(temporaryRestorePath).catch(() => undefined);

      if (restoredVolumeId) {
        this.volumeCache.delete(restoredVolumeId);
      }

      throw error;
    }
    finally {
      if (rollbackSnapshotPath) {
        await this.deleteDatabaseArtifacts(rollbackSnapshotPath).catch(() => undefined);
      }
    }
  }

  public async deleteVolume(volumeId: string): Promise<void> {
    const databasePath = this.getVolumeDatabasePath(volumeId);
    await this.deleteDatabaseArtifacts(databasePath);
    this.volumeCache.delete(volumeId);
    this.logger.info({ volumeId }, 'Volume deleted.');
  }

  public async compactVolume(volumeId: string): Promise<VolumeCompactionResult> {
    const databasePath = this.getVolumeDatabasePath(volumeId);
    if (!(await pathExists(databasePath))) {
      throw new VolumeError('NOT_FOUND', `Volume ${volumeId} does not exist.`, {
        volumeId,
      });
    }

    const bytesBefore = await this.getDatabaseArtifactBytes(databasePath);
    const metadata = await withVolumeDatabase(databasePath, async (database) => {
      const manifestRow = await this.requireManifestRow(database, volumeId);
      const schemaVersion = await this.getSchemaVersion(database);

      await database.get('PRAGMA wal_checkpoint(TRUNCATE)');
      await database.exec('VACUUM');
      await database.exec('PRAGMA optimize');
      await database.get('PRAGMA wal_checkpoint(TRUNCATE)');

      return {
        manifest: this.toManifest(manifestRow),
        schemaVersion,
      };
    });
    const bytesAfter = await this.getDatabaseArtifactBytes(databasePath);
    const result: VolumeCompactionResult = {
      volumeId: metadata.manifest.id,
      volumeName: metadata.manifest.name,
      revision: metadata.manifest.revision,
      schemaVersion: metadata.schemaVersion,
      databasePath,
      bytesBefore,
      bytesAfter,
      reclaimedBytes: Math.max(0, bytesBefore - bytesAfter),
      compactedAt: new Date().toISOString(),
    };

    this.logger.info(
      this.sanitizeObservabilityPayload({
        volumeId: result.volumeId,
        databasePath,
        bytesBefore,
        bytesAfter,
        reclaimedBytes: result.reclaimedBytes,
        schemaVersion: result.schemaVersion,
        revision: result.revision,
      }),
      'Volume compaction completed.',
    );

    return result;
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

  private async requireManifestRow(
    database: SqliteVolumeDatabase,
    volumeId: string,
  ): Promise<VolumeManifestRow> {
    const manifestRow = await database.get<VolumeManifestRow>(
      `SELECT
         id,
         name,
         description,
         quota_bytes,
         logical_used_bytes,
         entry_count,
         revision,
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

    return manifestRow;
  }

  private toManifest(row: VolumeManifestRow): VolumeManifest {
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      quotaBytes: row.quota_bytes,
      logicalUsedBytes: row.logical_used_bytes,
      entryCount: row.entry_count,
      revision: row.revision,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private async deleteDatabaseArtifacts(databasePath: string): Promise<void> {
    await Promise.all([
      fs.rm(databasePath, { force: true }),
      fs.rm(`${databasePath}-journal`, { force: true }),
      fs.rm(`${databasePath}-wal`, { force: true }),
      fs.rm(`${databasePath}-shm`, { force: true }),
    ]);
  }

  private async getDatabaseArtifactBytes(databasePath: string): Promise<number> {
    const artifactPaths = [
      databasePath,
      `${databasePath}-journal`,
      `${databasePath}-wal`,
      `${databasePath}-shm`,
    ];
    const sizes = await Promise.all(
      artifactPaths.map((artifactPath) => this.getArtifactSizeBytes(artifactPath)),
    );

    return sizes.reduce((total, size) => total + size, 0);
  }

  private async getArtifactSizeBytes(artifactPath: string): Promise<number> {
    try {
      const stats = await fs.stat(artifactPath);
      return stats.size;
    } catch {
      return 0;
    }
  }

  private async snapshotVolumeDatabase(
    sourceDatabasePath: string,
    destinationPath: string,
    volumeId: string,
  ): Promise<VolumeDatabaseSnapshot> {
    await ensureDirectory(path.dirname(destinationPath));
    if (await pathExists(destinationPath)) {
      await this.deleteDatabaseArtifacts(destinationPath);
    }

    return withVolumeDatabase(sourceDatabasePath, async (database) => {
      const manifestRow = await this.requireManifestRow(database, volumeId);
      const schemaVersion = await this.getSchemaVersion(database);

      await database.get('PRAGMA wal_checkpoint(TRUNCATE)');
      await database.exec(
        `VACUUM INTO '${escapeSqliteStringLiteral(destinationPath)}'`,
      );

      return {
        manifest: this.toManifest(manifestRow),
        schemaVersion,
      };
    });
  }

  private async rollbackOverwrittenRestore(
    rollbackSnapshotPath: string,
    targetDatabasePath: string,
    volumeId: string,
  ): Promise<Error | null> {
    try {
      await this.deleteDatabaseArtifacts(targetDatabasePath).catch(() => undefined);
      await fs.rename(rollbackSnapshotPath, targetDatabasePath);
      this.volumeCache.delete(volumeId);
      return null;
    } catch (error) {
      const rollbackError =
        error instanceof Error ? error : new Error(String(error));
      this.logger.error(
        this.sanitizeObservabilityPayload({
          volumeId,
          rollbackSnapshotPath,
          targetDatabasePath,
          error: rollbackError.message,
        }),
        'Automatic restore rollback failed.',
      );
      return rollbackError;
    }
  }

  private getBackupManifestPath(backupPath: string): string {
    return `${backupPath}${BACKUP_MANIFEST_SUFFIX}`;
  }

  private async loadBackupArtifactMetadata(
    absoluteBackupPath: string,
    temporaryDatabasePath: string,
  ): Promise<VolumeBackupArtifactMetadata> {
    const backupManifestPath = this.getBackupManifestPath(absoluteBackupPath);
    const backupManifest = await this.readBackupManifest(backupManifestPath);
    const backupStats = await fs.stat(absoluteBackupPath);
    const checksumSha256 = await this.computeFileSha256(absoluteBackupPath);

    await fs.copyFile(absoluteBackupPath, temporaryDatabasePath);

    const snapshot = await this.inspectVolumeDatabase(temporaryDatabasePath, 'backup');

    if (backupManifest) {
      this.assertBackupManifestMatchesArtifact(
        backupManifest,
        snapshot,
        backupStats.size,
        checksumSha256,
        absoluteBackupPath,
        backupManifestPath,
      );
      this.assertBackupRuntimeCompatibility(
        backupManifest,
        absoluteBackupPath,
        backupManifestPath,
      );
    }

    return {
      backupManifest,
      backupManifestPath,
      bytesWritten: backupStats.size,
      checksumSha256,
      snapshot,
    };
  }

  private async readBackupManifest(
    manifestPath: string,
  ): Promise<VolumeBackupManifest | null> {
    if (!(await pathExists(manifestPath))) {
      return null;
    }

    try {
      const payload = await readJsonFile<unknown>(manifestPath);

      if (!this.isVolumeBackupManifest(payload)) {
        throw new VolumeError(
          'INVALID_OPERATION',
          `Backup manifest is invalid: ${manifestPath}`,
          {
            manifestPath,
          },
        );
      }

      return payload;
    } catch (error) {
      if (error instanceof VolumeError) {
        throw error;
      }

      throw new VolumeError(
        'INVALID_OPERATION',
        `Backup manifest could not be read: ${manifestPath}`,
        {
          manifestPath,
          error: error instanceof Error ? error.message : String(error),
        },
      );
    }
  }

  private isVolumeBackupManifest(value: unknown): value is VolumeBackupManifest {
    if (typeof value !== 'object' || value === null) {
      return false;
    }

    const candidate = value as Partial<VolumeBackupManifest>;

    return (
      candidate.formatVersion === BACKUP_MANIFEST_FORMAT_VERSION &&
      typeof candidate.volumeId === 'string' &&
      candidate.volumeId.length > 0 &&
      typeof candidate.volumeName === 'string' &&
      typeof candidate.revision === 'number' &&
      Number.isInteger(candidate.revision) &&
      typeof candidate.schemaVersion === 'number' &&
      Number.isInteger(candidate.schemaVersion) &&
      typeof candidate.createdWithVersion === 'string' &&
      parseSemanticVersion(candidate.createdWithVersion) !== null &&
      typeof candidate.bytesWritten === 'number' &&
      Number.isInteger(candidate.bytesWritten) &&
      candidate.bytesWritten >= 0 &&
      typeof candidate.checksumSha256 === 'string' &&
      /^[0-9a-f]{64}$/u.test(candidate.checksumSha256) &&
      typeof candidate.createdAt === 'string' &&
      !Number.isNaN(Date.parse(candidate.createdAt))
    );
  }

  private async inspectVolumeDatabase(
    databasePath: string,
    volumeId: string,
  ): Promise<VolumeDatabaseSnapshot> {
    return withVolumeDatabase(databasePath, async (database) => ({
      manifest: this.toManifest(await this.requireManifestRow(database, volumeId)),
      schemaVersion: await this.getSchemaVersion(database),
    }));
  }

  private async getSchemaVersion(database: SqliteVolumeDatabase): Promise<number> {
    const row = await database.get<{ value: string }>(
      `SELECT value
         FROM schema_metadata
        WHERE key = 'schema_version'`,
    );

    const parsedVersion = Number.parseInt(row?.value ?? '0', 10);
    return Number.isNaN(parsedVersion) ? 0 : parsedVersion;
  }

  private async getPragmaIntegerValue(
    database: SqliteVolumeDatabase,
    pragmaName: 'page_count' | 'page_size' | 'freelist_count',
  ): Promise<number> {
    const row = await database.get<Record<string, number | bigint | string>>(
      `PRAGMA ${pragmaName}`,
    );
    const value = Number(Object.values(row ?? {})[0] ?? 0);
    return Number.isFinite(value) ? value : 0;
  }

  private async collectStorageMaintenanceStats(
    database: SqliteVolumeDatabase,
    databasePath: string,
  ): Promise<StorageDoctorMaintenanceStats> {
    const [pageCount, pageSizeBytes, freelistCount, databaseBytes, walBytes, artifactBytes] =
      await Promise.all([
        this.getPragmaIntegerValue(database, 'page_count'),
        this.getPragmaIntegerValue(database, 'page_size'),
        this.getPragmaIntegerValue(database, 'freelist_count'),
        this.getArtifactSizeBytes(databasePath),
        this.getArtifactSizeBytes(`${databasePath}-wal`),
        this.getDatabaseArtifactBytes(databasePath),
      ]);

    const freeBytes = Math.max(0, freelistCount * pageSizeBytes);
    const freeRatio = pageCount > 0 ? freelistCount / pageCount : 0;

    return {
      databaseBytes,
      walBytes,
      artifactBytes,
      pageSizeBytes,
      pageCount,
      freelistCount,
      freeBytes,
      freeRatio,
      compactionRecommended: freeBytes >= 1024 * 1024 && freeRatio >= 0.1,
    };
  }

  private async computeFileSha256(filePath: string): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const hash = createHash('sha256');
      const stream = createReadStream(filePath);

      stream.on('data', (chunk: Buffer) => {
        hash.update(chunk);
      });
      stream.once('end', () => {
        resolve(hash.digest('hex'));
      });
      stream.once('error', reject);
    });
  }

  private assertBackupRuntimeCompatibility(
    backupManifest: VolumeBackupManifest,
    backupPath: string,
    manifestPath: string,
  ): void {
    if (
      !isCompatibleBackupRuntimeVersion(
        backupManifest.createdWithVersion,
        APP_VERSION,
      )
    ) {
      throw new VolumeError(
        'INVALID_OPERATION',
        `Backup ${backupPath} was created by CLI version ${backupManifest.createdWithVersion}, which is newer than the current runtime ${APP_VERSION}.`,
        {
          backupPath,
          manifestPath,
          backupCreatedWithVersion: backupManifest.createdWithVersion,
          currentRuntimeVersion: APP_VERSION,
        },
      );
    }

    if (backupManifest.schemaVersion > SUPPORTED_VOLUME_SCHEMA_VERSION) {
      throw new VolumeError(
        'INVALID_OPERATION',
        `Backup ${backupPath} requires schema version ${backupManifest.schemaVersion}, but this runtime only supports schema version ${SUPPORTED_VOLUME_SCHEMA_VERSION}.`,
        {
          backupPath,
          manifestPath,
          backupSchemaVersion: backupManifest.schemaVersion,
          supportedSchemaVersion: SUPPORTED_VOLUME_SCHEMA_VERSION,
        },
      );
    }
  }

  private assertBackupManifestMatchesArtifact(
    backupManifest: VolumeBackupManifest,
    snapshot: VolumeDatabaseSnapshot,
    bytesWritten: number,
    checksumSha256: string,
    backupPath: string,
    manifestPath: string,
  ): void {
    const mismatches: string[] = [];

    if (backupManifest.volumeId !== snapshot.manifest.id) {
      mismatches.push('volumeId');
    }
    if (backupManifest.volumeName !== snapshot.manifest.name) {
      mismatches.push('volumeName');
    }
    if (backupManifest.revision !== snapshot.manifest.revision) {
      mismatches.push('revision');
    }
    if (backupManifest.schemaVersion !== snapshot.schemaVersion) {
      mismatches.push('schemaVersion');
    }
    if (backupManifest.bytesWritten !== bytesWritten) {
      mismatches.push('bytesWritten');
    }
    if (backupManifest.checksumSha256 !== checksumSha256) {
      mismatches.push('checksumSha256');
    }

    if (mismatches.length > 0) {
      throw new VolumeError(
        'INVALID_OPERATION',
        `Backup manifest does not match the backup artifact: ${backupPath}`,
        {
          backupPath,
          manifestPath,
          mismatches,
        },
      );
    }
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
      let databasePathToCleanup: string | null = null;
      let shouldCleanupDatabase = false;

      if (!(await pathExists(manifestPath)) || !(await pathExists(statePath))) {
        continue;
      }

      try {
        const manifest = await readJsonFile<VolumeManifest>(manifestPath);
        manifest.revision ??= 0;
        const state = await readJsonFile<VolumeState>(statePath);
        const databasePath = this.getVolumeDatabasePath(manifest.id);
        databasePathToCleanup = databasePath;
        const databaseAlreadyExists = await pathExists(databasePath);
        shouldCleanupDatabase = !databaseAlreadyExists;

        if (!databaseAlreadyExists) {
          await this.migrateLegacyVolumeToDatabase(
            legacyDirectoryPath,
            databasePath,
            manifest,
            state,
          );
        }

        await fs.rm(legacyDirectoryPath, { recursive: true, force: true });
        this.logger.info(
          this.sanitizeObservabilityPayload({ legacyDirectoryPath, volumeId: manifest.id }),
          'Migrated legacy volume directory to sqlite volume file.',
        );
      } catch (error) {
        if (shouldCleanupDatabase && databasePathToCleanup) {
          await this.deleteDatabaseArtifacts(databasePathToCleanup).catch(() => undefined);
          }
          this.logger.error(
            this.sanitizeObservabilityPayload({
              legacyDirectoryPath,
              error: error instanceof Error ? error.message : String(error),
            }),
            'Failed to migrate legacy volume directory.',
          );
      }
    }
  }

  private async migrateLegacyVolumeToDatabase(
    legacyDirectoryPath: string,
    databasePath: string,
    manifest: VolumeManifest,
    state: VolumeState,
  ): Promise<void> {
    const record: VolumeRecord = {
      manifest,
      state,
    };
    const blobStore = new BlobStore(
      databasePath,
      this.logger.child({ scope: 'blob-store-migration', volumeId: manifest.id }),
      this.config.redactSensitiveDetails,
    );

    await withVolumeDatabase(databasePath, async (database) => {
      await database.exec('BEGIN IMMEDIATE TRANSACTION');

      try {
        await this.migrateLegacyBlobsInDatabase(
          database,
          legacyDirectoryPath,
          blobStore,
          state,
        );
        await this.persistVolumeToDatabase(database, record);
        await database.exec('COMMIT');
      } catch (error) {
        await database.exec('ROLLBACK').catch(() => undefined);
        throw error;
      }
    });

    this.volumeCache.set(record.manifest.id, record);
  }

  private async migrateLegacyBlobsInDatabase(
    database: SqliteVolumeDatabase,
    legacyDirectoryPath: string,
    blobStore: BlobStore,
    state: VolumeState,
  ): Promise<void> {
    const contentRefs = new Set(
      Object.values(state.entries).flatMap((entry) =>
        entry.kind === 'file' ? [entry.contentRef] : [],
      ),
    );

    for (const contentRef of contentRefs) {
      const legacyBlobPath = path.join(
        legacyDirectoryPath,
        'blobs',
        contentRef.slice(0, 2),
        contentRef.slice(2),
      );

      if (!(await pathExists(legacyBlobPath))) {
        throw new VolumeError(
          'INTEGRITY_CHECK_FAILED',
          `Legacy blob file is missing during sqlite migration: ${legacyBlobPath}`,
          {
            legacyBlobPath,
            contentRef,
          },
        );
      }

      const blobStats = await fs.stat(legacyBlobPath);
      const descriptor = await blobStore.putHostFileInDatabase(
        database,
        legacyBlobPath,
        {
          totalBytes: blobStats.size,
        },
      );

      if (descriptor.contentRef !== contentRef) {
        throw new VolumeError(
          'INTEGRITY_CHECK_FAILED',
          `Legacy blob ${legacyBlobPath} does not match expected content ref ${contentRef}.`,
          {
            legacyBlobPath,
            expectedContentRef: contentRef,
            actualContentRef: descriptor.contentRef,
          },
        );
      }
    }
  }

  private async inspectVolume(
    volumeId: string,
    options: StorageDoctorOptions = {},
  ): Promise<StorageDoctorVolumeReport> {
    const databasePath = this.getVolumeDatabasePath(volumeId);
    if (!(await pathExists(databasePath))) {
      throw new VolumeError('NOT_FOUND', `Volume ${volumeId} does not exist.`, {
        volumeId,
      });
    }

    try {
      return await withVolumeDatabase(databasePath, async (database) => {
        const record = await this.loadVolumeFromDatabase(database, volumeId);
        const persistedBlobReferenceCounts =
          await this.listPersistedBlobReferenceCounts(database);
        const persistedBlobChunkCounts = await this.listPersistedBlobChunkCounts(database);
        const persistedBlobSizes = await this.listPersistedBlobSizes(database);
        const actualBlobChunkCounts = await this.listActualBlobChunkCounts(database);
        const actualBlobSizes = await this.listActualBlobSizes(database);
        const maintenance = await this.collectStorageMaintenanceStats(database, databasePath);
        const sqliteIssues = await this.collectSqliteDoctorIssues(database, volumeId);
        const blobPayloadIssues = options.verifyBlobPayloads
          ? await this.collectBlobPayloadDoctorIssues(
              database,
              new Set(
                Object.values(record.state.entries)
                  .filter((entry): entry is FileEntry => entry.kind === 'file')
                  .map((entry) => entry.contentRef)
                  .filter((contentRef) => contentRef.length > 0),
              ),
            )
          : [];
        const issues = [
          ...sqliteIssues,
          ...this.collectDoctorIssues(
            record,
            persistedBlobReferenceCounts,
            persistedBlobChunkCounts,
            actualBlobChunkCounts,
            persistedBlobSizes,
            actualBlobSizes,
          ),
          ...blobPayloadIssues,
          ...this.collectMaintenanceDoctorIssues(record.manifest.id, maintenance),
        ];

        return {
          volumeId: record.manifest.id,
          volumeName: record.manifest.name,
          revision: record.manifest.revision,
          healthy: issues.length === 0,
          issueCount: issues.length,
          issues,
          maintenance,
        };
      });
    } catch (error) {
      return this.buildDatabaseOpenFailureReport(volumeId, error);
    }
  }

  private async repairVolume(volumeId: string): Promise<StorageRepairVolumeReport> {
    const databasePath = this.getVolumeDatabasePath(volumeId);

    return withVolumeDatabase(databasePath, async (database) => {
      await database.exec('BEGIN IMMEDIATE TRANSACTION');

      try {
        const record = await this.loadVolumeFromDatabase(database, volumeId);
        const actions: StorageRepairAction[] = [];
        let persistedBlobReferenceCounts = await this.listPersistedBlobReferenceCounts(
          database,
        );
        let persistedBlobChunkCounts = await this.listPersistedBlobChunkCounts(database);
        let persistedBlobSizes = await this.listPersistedBlobSizes(database);
        let actualBlobChunkCounts = await this.listActualBlobChunkCounts(database);
        let actualBlobSizes = await this.listActualBlobSizes(database);
        const issuesBefore = this.collectDoctorIssues(
          record,
          persistedBlobReferenceCounts,
          persistedBlobChunkCounts,
          actualBlobChunkCounts,
          persistedBlobSizes,
          actualBlobSizes,
        );

        for (const issue of issuesBefore) {
          if (issue.code !== 'ORPHAN_BLOB' || !issue.contentRef) {
            continue;
          }

          await database.run('DELETE FROM blob_chunks WHERE content_ref = ?', issue.contentRef);
          await database.run('DELETE FROM blobs WHERE content_ref = ?', issue.contentRef);
          actions.push({
            code: 'DELETE_ORPHAN_BLOB',
            message: `Deleted orphan blob ${issue.contentRef}.`,
            contentRef: issue.contentRef,
          });
        }

        const blobLayoutSyncTargets = new Set(
          issuesBefore
            .filter(
              (
                issue,
              ): issue is StorageDoctorIssue & {
                contentRef: string;
              } =>
                issue.contentRef !== undefined &&
                (issue.code === 'BLOB_CHUNK_COUNT_MISMATCH' ||
                  issue.code === 'BLOB_SIZE_MISMATCH'),
            )
            .map((issue) => issue.contentRef),
        );

        for (const contentRef of blobLayoutSyncTargets) {
          const payloadStats = await this.readBlobPayloadStats(database, contentRef);
          if (
            payloadStats?.actualContentRef !== contentRef ||
            !payloadStats?.contiguousChunkIndexes
          ) {
            continue;
          }

          const persistedBlob = await database.get<{ size: number; chunk_count: number }>(
            `SELECT size,
                    chunk_count
               FROM blobs
              WHERE content_ref = ?`,
            contentRef,
          );

          if (
            !persistedBlob ||
            (persistedBlob.size === payloadStats.actualSize &&
              persistedBlob.chunk_count === payloadStats.actualChunkCount)
          ) {
            continue;
          }

          await database.run(
            `UPDATE blobs
                SET size = ?,
                    chunk_count = ?
              WHERE content_ref = ?`,
            payloadStats.actualSize,
            payloadStats.actualChunkCount,
            contentRef,
          );
          actions.push({
            code: 'SYNC_BLOB_LAYOUT_METADATA',
            message: 'Synchronized blob size and chunk-count metadata from the current SQLite payload layout.',
            contentRef,
          });
        }

        if (
          issuesBefore.some(
            (issue) =>
              issue.code === 'MANIFEST_USAGE_MISMATCH' ||
              issue.code === 'MANIFEST_ENTRY_COUNT_MISMATCH',
          )
        ) {
          await this.persistVolumeToDatabase(database, record);
          actions.push({
            code: 'REBUILD_MANIFEST',
            message: 'Rebuilt manifest counters and revision from the current volume state.',
          });
          if (
            issuesBefore.some(
              (issue) => issue.code === 'BLOB_REFERENCE_COUNT_MISMATCH',
            )
          ) {
            actions.push({
              code: 'SYNC_BLOB_REFERENCE_COUNTS',
              message: 'Synchronized blob reference counts from the current file entries.',
            });
          }
        } else if (
          issuesBefore.some((issue) => issue.code === 'BLOB_REFERENCE_COUNT_MISMATCH')
        ) {
          await this.syncBlobReferenceCounts(database);
          actions.push({
            code: 'SYNC_BLOB_REFERENCE_COUNTS',
            message: 'Synchronized blob reference counts from the current file entries.',
          });
        }

        persistedBlobReferenceCounts = await this.listPersistedBlobReferenceCounts(database);
        persistedBlobChunkCounts = await this.listPersistedBlobChunkCounts(database);
        persistedBlobSizes = await this.listPersistedBlobSizes(database);
        actualBlobChunkCounts = await this.listActualBlobChunkCounts(database);
        actualBlobSizes = await this.listActualBlobSizes(database);
        const remainingIssues = this.collectDoctorIssues(
          record,
          persistedBlobReferenceCounts,
          persistedBlobChunkCounts,
          actualBlobChunkCounts,
          persistedBlobSizes,
          actualBlobSizes,
        );

        await database.exec('COMMIT');

        return {
          volumeId: record.manifest.id,
          volumeName: record.manifest.name,
          revision: record.manifest.revision,
          healthy: remainingIssues.length === 0,
          repaired: actions.length > 0,
          issueCountBefore: issuesBefore.length,
          issueCountAfter: remainingIssues.length,
          actions,
          remainingIssues,
        };
      } catch (error) {
        await database.exec('ROLLBACK').catch(() => undefined);
        throw error;
      }
    });
  }

  private async loadVolumeFromDatabase(
    database: SqliteVolumeDatabase,
    volumeId: string,
  ): Promise<VolumeRecord> {
    const manifestRow = await database.get<VolumeManifestRow>(
      `SELECT
         id,
         name,
         description,
         quota_bytes,
         logical_used_bytes,
         entry_count,
         revision,
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

    return {
      manifest: this.toManifest(manifestRow),
      state: this.toState(entryRows, volumeId),
    };
  }

  private async listPersistedBlobReferenceCounts(
    database: SqliteVolumeDatabase,
  ): Promise<Map<string, number>> {
    const blobRows = await database.all<
      { content_ref: string; reference_count: number }[]
    >(
      `SELECT content_ref,
              reference_count
         FROM blobs`,
    );

    return new Map(
      blobRows.map((row) => [row.content_ref, row.reference_count] as const),
    );
  }

  private async listPersistedBlobChunkCounts(
    database: SqliteVolumeDatabase,
  ): Promise<Map<string, number>> {
    const blobRows = await database.all<{ content_ref: string; chunk_count: number }[]>(
      `SELECT content_ref,
              chunk_count
         FROM blobs`,
    );

    return new Map(blobRows.map((row) => [row.content_ref, row.chunk_count] as const));
  }

  private async listPersistedBlobSizes(
    database: SqliteVolumeDatabase,
  ): Promise<Map<string, number>> {
    const blobRows = await database.all<{ content_ref: string; size: number }[]>(
      `SELECT content_ref,
              size
         FROM blobs`,
    );

    return new Map(blobRows.map((row) => [row.content_ref, row.size] as const));
  }

  private async listActualBlobChunkCounts(
    database: SqliteVolumeDatabase,
  ): Promise<Map<string, number>> {
    const blobRows = await database.all<{ content_ref: string; chunk_count: number }[]>(
      `SELECT blobs.content_ref AS content_ref,
              COUNT(blob_chunks.chunk_index) AS chunk_count
         FROM blobs
         LEFT JOIN blob_chunks
           ON blob_chunks.content_ref = blobs.content_ref
     GROUP BY blobs.content_ref`,
    );

    return new Map(blobRows.map((row) => [row.content_ref, row.chunk_count] as const));
  }

  private async listActualBlobSizes(
    database: SqliteVolumeDatabase,
  ): Promise<Map<string, number>> {
    const blobRows = await database.all<{ content_ref: string; size: number }[]>(
      `SELECT blobs.content_ref AS content_ref,
              CASE
                WHEN blobs.chunk_count = 0
                  THEN MAX(LENGTH(blobs.content))
                ELSE COALESCE(SUM(LENGTH(blob_chunks.content)), 0)
              END AS size
         FROM blobs
         LEFT JOIN blob_chunks
           ON blob_chunks.content_ref = blobs.content_ref
     GROUP BY blobs.content_ref,
              blobs.chunk_count`,
    );

    return new Map(blobRows.map((row) => [row.content_ref, row.size] as const));
  }

  private async readBlobPayloadStats(
    database: SqliteVolumeDatabase,
    contentRef: string,
  ): Promise<BlobPayloadStats | null> {
    const blobRow = await database.get<{
      content_ref: string;
      content: Buffer | null;
    }>(
      `SELECT content_ref,
              content
         FROM blobs
        WHERE content_ref = ?`,
      contentRef,
    );

    if (!blobRow) {
      return null;
    }

    const chunkRows = await database.all<{ chunk_index: number; content: Buffer }[]>(
      `SELECT chunk_index,
              content
         FROM blob_chunks
        WHERE content_ref = ?
     ORDER BY chunk_index`,
      contentRef,
    );

    const hash = createHash('sha256');
    let actualSize = 0;
    let contiguousChunkIndexes = true;

    if (chunkRows.length === 0) {
      const inlineContent = blobRow.content ?? Buffer.alloc(0);
      hash.update(inlineContent);
      actualSize = inlineContent.byteLength;
    } else {
      for (let index = 0; index < chunkRows.length; index += 1) {
        const chunkRow = chunkRows[index];
        if (chunkRow && chunkRow.chunk_index !== index) {
          contiguousChunkIndexes = false;
        }
        const chunk = chunkRow?.content ?? Buffer.alloc(0);
        actualSize += chunk.byteLength;
        hash.update(chunk);
      }
    }

    return {
      actualContentRef: hash.digest('hex'),
      actualSize,
      actualChunkCount: chunkRows.length,
      contiguousChunkIndexes,
    };
  }

  private async collectBlobPayloadDoctorIssues(
    database: SqliteVolumeDatabase,
    contentRefs: Set<string>,
  ): Promise<StorageDoctorIssue[]> {
    const issues: StorageDoctorIssue[] = [];

    for (const contentRef of contentRefs) {
      const payloadStats = await this.readBlobPayloadStats(database, contentRef);
      if (!payloadStats) {
        continue;
      }

      if (payloadStats.actualContentRef !== contentRef) {
        issues.push({
          code: 'BLOB_CONTENT_REF_MISMATCH',
          severity: 'error',
          message: `Blob ${contentRef} hashes to ${payloadStats.actualContentRef} when its SQLite payload is read back.`,
          contentRef,
        });
      }
    }

    return issues;
  }

  private async collectSqliteDoctorIssues(
    database: SqliteVolumeDatabase,
    volumeId: string,
  ): Promise<StorageDoctorIssue[]> {
    const issues: StorageDoctorIssue[] = [];
    const integrityRows = await database.all<Record<string, string>[]>(
      'PRAGMA integrity_check',
    );
    const integrityMessages = integrityRows
      .map((row) => String(Object.values(row)[0] ?? ''))
      .filter((message) => message.length > 0 && message !== 'ok');

    if (integrityMessages.length > 0) {
      issues.push({
        code: 'SQLITE_INTEGRITY_CHECK_FAILED',
        severity: 'error',
        message: `SQLite integrity_check reported ${integrityMessages.length} problem(s) for volume ${volumeId}: ${integrityMessages.slice(0, 3).join(' | ')}.`,
      });
    }

    const foreignKeyViolations = await database.all<SqliteForeignKeyCheckRow[]>(
      'PRAGMA foreign_key_check',
    );
    if (foreignKeyViolations.length > 0) {
      const firstViolation = foreignKeyViolations[0];
      issues.push({
        code: 'SQLITE_FOREIGN_KEY_VIOLATION',
        severity: 'error',
        message: `SQLite foreign_key_check reported ${foreignKeyViolations.length} violation(s) for volume ${volumeId}. First violation: table=${firstViolation?.table ?? 'unknown'} rowid=${firstViolation?.rowid ?? -1} parent=${firstViolation?.parent ?? 'unknown'} fkid=${firstViolation?.fkid ?? -1}.`,
      });
    }

    return issues;
  }

  private buildDatabaseOpenFailureReport(
    volumeId: string,
    error: unknown,
  ): StorageDoctorVolumeReport {
    const message = error instanceof Error ? error.message : String(error);

    this.logger.warn(
      {
        volumeId,
        error: message,
      },
      'Doctor could not inspect volume database.',
    );

    return {
      volumeId,
      volumeName: volumeId,
      revision: 0,
      healthy: false,
      issueCount: 1,
      issues: [
        {
          code: 'DATABASE_OPEN_FAILED',
          severity: 'error',
          message: `Volume ${volumeId} could not be inspected because its SQLite database is unreadable or invalid: ${message}`,
        },
      ],
    };
  }

  private async listDiscoveredVolumeIds(): Promise<string[]> {
    await this.initialize();

    const directoryEntries = await fs.readdir(this.getVolumesDirectory(), {
      withFileTypes: true,
    });

    return directoryEntries
      .filter((entry) => entry.isFile() && entry.name.endsWith(VOLUME_DATABASE_EXTENSION))
      .map((entry) => entry.name.slice(0, -VOLUME_DATABASE_EXTENSION.length))
      .sort((left, right) => left.localeCompare(right));
  }

  private collectDoctorIssues(
    record: VolumeRecord,
    persistedBlobReferenceCounts: Map<string, number>,
    persistedBlobChunkCounts: Map<string, number>,
    actualBlobChunkCounts: Map<string, number>,
    persistedBlobSizes: Map<string, number>,
    actualBlobSizes: Map<string, number>,
  ): StorageDoctorIssue[] {
    const issues: StorageDoctorIssue[] = [];
    const entries = Object.values(record.state.entries);
    const rootEntry = record.state.entries[record.state.rootId];
    const referencedBlobReferenceCounts = new Map<string, number>();

    if (rootEntry?.kind !== 'directory') {
      issues.push({
        code: 'BROKEN_ROOT',
        severity: 'error',
        message: `Volume ${record.manifest.id} does not contain a valid root directory.`,
        entryId: record.state.rootId,
      });
    }

    const siblingNames = new Map<string, string>();

    for (const entry of entries) {
      if (entry.parentId !== null) {
        const parentEntry = record.state.entries[entry.parentId];

        if (!parentEntry) {
          issues.push({
            code: 'MISSING_PARENT',
            severity: 'error',
            message: `Entry ${entry.id} (${entry.name}) references missing parent ${entry.parentId}.`,
            entryId: entry.id,
          });
        } else if (parentEntry.kind !== 'directory') {
          issues.push({
            code: 'PARENT_NOT_DIRECTORY',
            severity: 'error',
            message: `Entry ${entry.id} (${entry.name}) points to non-directory parent ${entry.parentId}.`,
            entryId: entry.id,
          });
        }

        const siblingKey = `${entry.parentId}:${entry.name}`;
        const existingEntryId = siblingNames.get(siblingKey);
        if (existingEntryId && existingEntryId !== entry.id) {
          issues.push({
            code: 'DUPLICATE_CHILD_NAME',
            severity: 'error',
            message: `Sibling name collision detected for "${entry.name}" under parent ${entry.parentId}.`,
            entryId: entry.id,
          });
        } else {
          siblingNames.set(siblingKey, entry.id);
        }
      }

      if (entry.kind !== 'file') {
        continue;
      }

      if (entry.contentRef.length === 0) {
        issues.push({
          code: 'MISSING_CONTENT_REF',
          severity: 'error',
          message: `File ${entry.id} (${entry.name}) does not reference any blob content.`,
          entryId: entry.id,
        });
        continue;
      }

      referencedBlobReferenceCounts.set(
        entry.contentRef,
        (referencedBlobReferenceCounts.get(entry.contentRef) ?? 0) + 1,
      );
    }

    for (const entry of entries) {
      if (entry.kind !== 'file' || entry.contentRef.length === 0) {
        continue;
      }

      if (!persistedBlobReferenceCounts.has(entry.contentRef)) {
        issues.push({
          code: 'MISSING_BLOB',
          severity: 'error',
          message: `File ${entry.id} (${entry.name}) references missing blob ${entry.contentRef}.`,
          contentRef: entry.contentRef,
          entryId: entry.id,
        });
      }
    }

    for (const [
      persistedBlobRef,
      persistedReferenceCount,
    ] of persistedBlobReferenceCounts.entries()) {
      const actualReferenceCount =
        referencedBlobReferenceCounts.get(persistedBlobRef) ?? 0;
      const persistedChunkCount = persistedBlobChunkCounts.get(persistedBlobRef) ?? 0;
      const actualChunkCount = actualBlobChunkCounts.get(persistedBlobRef) ?? 0;
      const persistedSize = persistedBlobSizes.get(persistedBlobRef) ?? 0;
      const actualSize = actualBlobSizes.get(persistedBlobRef) ?? 0;

      if (actualReferenceCount === 0) {
        issues.push({
          code: 'ORPHAN_BLOB',
          severity: 'warn',
          message: `Blob ${persistedBlobRef} is stored in SQLite but is not referenced by any file entry.`,
          contentRef: persistedBlobRef,
        });
      }

      if (actualReferenceCount !== persistedReferenceCount) {
        issues.push({
          code: 'BLOB_REFERENCE_COUNT_MISMATCH',
          severity: 'error',
          message: `Blob ${persistedBlobRef} stores reference_count=${persistedReferenceCount}, but ${actualReferenceCount} file reference(s) were computed from the current entries.`,
          contentRef: persistedBlobRef,
        });
      }

      if (actualChunkCount !== persistedChunkCount) {
        issues.push({
          code: 'BLOB_CHUNK_COUNT_MISMATCH',
          severity: 'error',
          message: `Blob ${persistedBlobRef} stores chunk_count=${persistedChunkCount}, but ${actualChunkCount} blob chunk row(s) were found in SQLite.`,
          contentRef: persistedBlobRef,
        });
      }

      if (actualSize !== persistedSize) {
        issues.push({
          code: 'BLOB_SIZE_MISMATCH',
          severity: 'error',
          message: `Blob ${persistedBlobRef} stores size=${persistedSize}, but ${actualSize} byte(s) are currently readable from its SQLite payload layout.`,
          contentRef: persistedBlobRef,
        });
      }
    }

    const logicalUsedBytes = this.getLogicalUsedBytes(record.state);
    if (logicalUsedBytes !== record.manifest.logicalUsedBytes) {
      issues.push({
        code: 'MANIFEST_USAGE_MISMATCH',
        severity: 'error',
        message: `Manifest logicalUsedBytes is ${record.manifest.logicalUsedBytes}, but computed usage is ${logicalUsedBytes}.`,
      });
    }

    const entryCount = Object.keys(record.state.entries).length;
    if (entryCount !== record.manifest.entryCount) {
      issues.push({
        code: 'MANIFEST_ENTRY_COUNT_MISMATCH',
        severity: 'error',
        message: `Manifest entryCount is ${record.manifest.entryCount}, but computed count is ${entryCount}.`,
      });
    }

    return issues;
  }

  private collectMaintenanceDoctorIssues(
    volumeId: string,
    maintenance: StorageDoctorMaintenanceStats,
  ): StorageDoctorIssue[] {
    if (!maintenance.compactionRecommended) {
      return [];
    }

    return [
      {
        code: 'COMPACTION_RECOMMENDED',
        severity: 'warn',
        message: `Volume ${volumeId} has ${maintenance.freelistCount} free SQLite page(s), about ${maintenance.freeBytes} bytes (${(maintenance.freeRatio * 100).toFixed(1)}%) reclaimable via compaction.`,
      },
    ];
  }

  private async persistVolumeToDatabase(
    database: SqliteVolumeDatabase,
    record: VolumeRecord,
  ): Promise<void> {
    const now = new Date().toISOString();
    const expectedRevision = record.manifest.revision ?? 0;
    let nextRevision: number;

    record.manifest.logicalUsedBytes = this.getLogicalUsedBytes(record.state);
    record.manifest.entryCount = Object.keys(record.state.entries).length;
    record.manifest.updatedAt = now;

    const persistedManifest = await database.get<{
      id: string;
      revision: number;
    }>(
      `SELECT
         id,
         revision
       FROM manifest
       LIMIT 1`,
    );

    if (persistedManifest) {
      if (persistedManifest.id !== record.manifest.id) {
        throw new VolumeError(
          'CONCURRENT_MODIFICATION',
          `Volume ${record.manifest.id} no longer matches the persisted manifest.`,
          {
            volumeId: record.manifest.id,
            persistedVolumeId: persistedManifest.id,
          },
        );
      }

      if (persistedManifest.revision !== expectedRevision) {
        throw new VolumeError(
          'CONCURRENT_MODIFICATION',
          `Volume ${record.manifest.id} was modified concurrently. Reload the volume and retry.`,
          {
            volumeId: record.manifest.id,
            expectedRevision,
            actualRevision: persistedManifest.revision,
          },
        );
      }

      nextRevision = persistedManifest.revision + 1;
    } else if (expectedRevision !== 0) {
      throw new VolumeError(
        'CONCURRENT_MODIFICATION',
        `Volume ${record.manifest.id} could not be initialized with revision ${expectedRevision}.`,
        {
          volumeId: record.manifest.id,
          expectedRevision,
        },
      );
    } else {
      nextRevision = 1;
    }

    await database.exec('DELETE FROM manifest');
    await database.run(
      `INSERT INTO manifest (
         id,
         name,
         description,
         quota_bytes,
         logical_used_bytes,
         entry_count,
         revision,
         created_at,
         updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      record.manifest.id,
      record.manifest.name,
      record.manifest.description,
      record.manifest.quotaBytes,
      record.manifest.logicalUsedBytes,
      record.manifest.entryCount,
      nextRevision,
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

    await this.syncBlobReferenceCounts(database);

    record.manifest.revision = nextRevision;
  }

  private async syncBlobReferenceCounts(
    database: SqliteVolumeDatabase,
  ): Promise<void> {
    await database.exec(`
      UPDATE blobs
         SET reference_count = COALESCE(
           (
             SELECT COUNT(*)
               FROM entries
              WHERE entries.content_ref = blobs.content_ref
           ),
           0
         )
    `);
  }
}
