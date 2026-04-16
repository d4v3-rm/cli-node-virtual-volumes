import fs from 'node:fs/promises';
import path from 'node:path';

import { nanoid } from 'nanoid';
import type { Logger } from 'pino';

import type { AppConfig } from '../config/env.js';
import { isVolumeError, VolumeError } from '../domain/errors.js';
import type {
  CreateVolumeInput,
  DirectoryEntry,
  DirectoryListingItem,
  ExportProgress,
  ExportSummary,
  ExportVolumeEntryInput,
  ExplorerSnapshot,
  ExplorerSnapshotOptions,
  FileEntry,
  FilePreview,
  ImportHostPathsInput,
  ImportProgress,
  ImportSummary,
  MoveEntryInput,
  RestoreVolumeBackupOptions,
  StorageDoctorReport,
  StorageRepairReport,
  VolumeCompactionBatchResult,
  VolumeCompactionBatchItem,
  VolumeCompactionResult,
  VolumeBackupInspectionResult,
  VolumeEntry,
  VolumeBackupResult,
  VolumeManifest,
  VolumeRecord,
  VolumeRestoreResult,
  VolumeState,
} from '../domain/types.js';
import { BlobStore } from '../storage/blob-store.js';
import type { SqliteVolumeDatabase } from '../storage/sqlite-volume.js';
import type { VolumeRepository } from '../storage/volume-repository.js';
import {
  sanitizeObservabilityMessage,
  sanitizeObservabilityValue,
} from '../utils/observability-redaction.js';
import {
  assertValidEntryName,
  buildChildVirtualPath,
  getBaseName,
  getPathSegments,
  normalizeVirtualPath,
} from '../utils/virtual-paths.js';

interface ServiceConfig {
  defaultQuotaBytes: AppConfig['defaultQuotaBytes'];
  hostAllowPaths: AppConfig['hostAllowPaths'];
  hostDenyPaths: AppConfig['hostDenyPaths'];
  previewBytes: AppConfig['previewBytes'];
  redactSensitiveDetails: AppConfig['redactSensitiveDetails'];
}

interface ImportTraversalContext {
  processedNodes: number;
  onProgress?: ImportHostPathsInput['onProgress'];
}

interface ExportTraversalContext {
  processedNodes: number;
  onProgress?: ExportVolumeEntryInput['onProgress'];
}

type AuditEventType =
  | 'volume.create'
  | 'volume.delete'
  | 'volume.backup'
  | 'volume.restore'
  | 'volume.backup.inspect'
  | 'volume.compact'
  | 'volume.compact.batch'
  | 'storage.doctor'
  | 'storage.repair'
  | 'entry.directory.create'
  | 'entry.file.write'
  | 'entry.move'
  | 'entry.delete'
  | 'host.import'
  | 'host.export';

type AuditResourceType = 'backup' | 'entry' | 'host-transfer' | 'storage' | 'volume';

interface AuditOperationOptions {
  eventType: AuditEventType;
  resourceType: AuditResourceType;
  volumeId?: string;
  details?: Record<string, unknown>;
}

export class VolumeService {
  public constructor(
    private readonly repository: VolumeRepository,
    private readonly config: ServiceConfig,
    private readonly logger: Logger,
    private readonly auditLogger: Logger,
  ) {}

  public async listVolumes(): Promise<VolumeManifest[]> {
    return this.repository.listVolumes();
  }

  private sanitizeObservabilityPayload<T>(value: T): T {
    return sanitizeObservabilityValue(value, this.config.redactSensitiveDetails);
  }

  private sanitizeObservabilityText(message: string, context: unknown): string {
    return sanitizeObservabilityMessage(
      message,
      context,
      this.config.redactSensitiveDetails,
    );
  }

  public async createVolume(input: CreateVolumeInput): Promise<VolumeManifest> {
    return this.runAuditedOperation(
      {
        eventType: 'volume.create',
        resourceType: 'volume',
        details: {
          requestedName: input.name.trim(),
          quotaBytes: input.quotaBytes ?? this.config.defaultQuotaBytes,
        },
      },
      async () => {
        const name = input.name.trim();
        if (name.length === 0) {
          throw new VolumeError('INVALID_NAME', 'Volume name cannot be empty.');
        }

        const record = await this.repository.createVolume({
          name,
          description: input.description?.trim() ?? '',
          quotaBytes: input.quotaBytes ?? this.config.defaultQuotaBytes,
        });

        return record.manifest;
      },
      (manifest) => ({
        volumeId: manifest.id,
        volumeName: manifest.name,
        revision: manifest.revision,
      }),
    );
  }

  public async deleteVolume(volumeId: string): Promise<void> {
    await this.runAuditedOperation(
      {
        eventType: 'volume.delete',
        resourceType: 'volume',
        volumeId,
      },
      async () => {
        await this.repository.deleteVolume(volumeId);
      },
    );
  }

  public async backupVolume(
    volumeId: string,
    destinationPath: string,
    options: { overwrite?: boolean } = {},
  ): Promise<VolumeBackupResult> {
    return this.runAuditedOperation(
      {
        eventType: 'volume.backup',
        resourceType: 'backup',
        volumeId,
        details: {
          destinationPath: path.resolve(destinationPath),
          overwrite: options.overwrite === true,
        },
      },
      () => this.repository.backupVolume(volumeId, destinationPath, options),
      (result) => ({
        backupPath: result.backupPath,
        revision: result.revision,
        validatedWithManifest: true,
      }),
    );
  }

  public async restoreVolumeBackup(
    backupPath: string,
    options: RestoreVolumeBackupOptions = {},
  ): Promise<VolumeRestoreResult> {
    return this.runAuditedOperation(
      {
        eventType: 'volume.restore',
        resourceType: 'backup',
        details: {
          backupPath: path.resolve(backupPath),
          overwrite: options.overwrite === true,
        },
      },
      () => this.repository.restoreVolumeBackup(backupPath, options),
      (result) => ({
        volumeId: result.volumeId,
        volumeName: result.volumeName,
        revision: result.revision,
        validatedWithManifest: result.validatedWithManifest,
      }),
    );
  }

  public async inspectVolumeBackup(
    backupPath: string,
  ): Promise<VolumeBackupInspectionResult> {
    return this.runAuditedOperation(
      {
        eventType: 'volume.backup.inspect',
        resourceType: 'backup',
        details: {
          backupPath: path.resolve(backupPath),
        },
      },
      () => this.repository.inspectVolumeBackup(backupPath),
      (result) => ({
        volumeId: result.volumeId,
        revision: result.revision,
        validatedWithManifest: result.validatedWithManifest,
      }),
    );
  }

  public async compactVolume(volumeId: string): Promise<VolumeCompactionResult> {
    return this.runAuditedOperation(
      {
        eventType: 'volume.compact',
        resourceType: 'storage',
        volumeId,
      },
      () => this.repository.compactVolume(volumeId),
      (result) => ({
        volumeId: result.volumeId,
        volumeName: result.volumeName,
        revision: result.revision,
        reclaimedBytes: result.reclaimedBytes,
        bytesBefore: result.bytesBefore,
        bytesAfter: result.bytesAfter,
      }),
    );
  }

  public async compactRecommendedVolumes(
    options: {
      dryRun?: boolean;
      includeUnsafe?: boolean;
      limit?: number;
      minFreeBytes?: number;
      minFreeRatio?: number;
    } = {},
  ): Promise<VolumeCompactionBatchResult> {
    return this.runAuditedOperation(
      {
        eventType: 'volume.compact.batch',
        resourceType: 'storage',
        details: {
          dryRun: options.dryRun === true,
          includeUnsafe: options.includeUnsafe === true,
          limit: options.limit ?? null,
          minFreeBytes: options.minFreeBytes ?? null,
          minFreeRatio: options.minFreeRatio ?? null,
        },
      },
      async () => {
        const doctorReport = await this.repository.runDoctor();
        const recommendedVolumes = doctorReport.volumes
          .filter((report) => report.maintenance?.compactionRecommended)
          .sort(
            (left, right) =>
              (right.maintenance?.freeBytes ?? 0) - (left.maintenance?.freeBytes ?? 0),
          );
        const volumes: VolumeCompactionBatchItem[] = [];
        let eligibleVolumes = 0;
        let eligibleReclaimableBytes = 0;
        let blockedVolumes = 0;
        let blockedReclaimableBytes = 0;
        let filteredVolumes = 0;
        let filteredReclaimableBytes = 0;
        let deferredVolumes = 0;
        let deferredReclaimableBytes = 0;
        let plannedVolumes = 0;
        let plannedReclaimableBytes = 0;
        let compactedVolumes = 0;
        let failedVolumes = 0;
        let totalReclaimedBytes = 0;

        for (const report of recommendedVolumes) {
          const maintenance = report.maintenance;
          if (!maintenance) {
            continue;
          }

          const thresholdFilterReason = this.getCompactionThresholdFilterReason(
            maintenance.freeBytes,
            maintenance.freeRatio,
            options,
          );
          if (thresholdFilterReason) {
            filteredVolumes += 1;
            filteredReclaimableBytes += maintenance.freeBytes;
            volumes.push({
              volumeId: report.volumeId,
              volumeName: report.volumeName,
              revision: report.revision,
              issueCount: report.issueCount,
              artifactBytes: maintenance.artifactBytes,
              freeBytes: maintenance.freeBytes,
              freeRatio: maintenance.freeRatio,
              status: 'filtered',
              reason: thresholdFilterReason,
            });
            continue;
          }

          eligibleVolumes += 1;
          eligibleReclaimableBytes += maintenance.freeBytes;

          if (!options.includeUnsafe && !this.isSafeForBatchCompaction(report.issues)) {
            blockedVolumes += 1;
            blockedReclaimableBytes += maintenance.freeBytes;
            volumes.push({
              volumeId: report.volumeId,
              volumeName: report.volumeName,
              revision: report.revision,
              issueCount: report.issueCount,
              artifactBytes: maintenance.artifactBytes,
              freeBytes: maintenance.freeBytes,
              freeRatio: maintenance.freeRatio,
              status: 'blocked',
              blockingIssueCodes: report.issues
                .filter((issue) => issue.code !== 'COMPACTION_RECOMMENDED')
                .map((issue) => issue.code),
              reason: 'Additional doctor findings must be cleared before batch compaction.',
            });
            continue;
          }

          if (options.limit !== undefined && plannedVolumes >= options.limit) {
            deferredVolumes += 1;
            deferredReclaimableBytes += maintenance.freeBytes;
            volumes.push({
              volumeId: report.volumeId,
              volumeName: report.volumeName,
              revision: report.revision,
              issueCount: report.issueCount,
              artifactBytes: maintenance.artifactBytes,
              freeBytes: maintenance.freeBytes,
              freeRatio: maintenance.freeRatio,
              status: 'deferred',
              reason: `Deferred by --limit ${options.limit}.`,
            });
            continue;
          }

          plannedVolumes += 1;
          plannedReclaimableBytes += maintenance.freeBytes;

          if (options.dryRun) {
            volumes.push({
              volumeId: report.volumeId,
              volumeName: report.volumeName,
              revision: report.revision,
              issueCount: report.issueCount,
              artifactBytes: maintenance.artifactBytes,
              freeBytes: maintenance.freeBytes,
              freeRatio: maintenance.freeRatio,
              status: 'planned',
            });
            continue;
          }

          try {
            const compaction = await this.compactVolume(report.volumeId);
            compactedVolumes += 1;
            totalReclaimedBytes += compaction.reclaimedBytes;
            volumes.push({
              volumeId: report.volumeId,
              volumeName: report.volumeName,
              revision: report.revision,
              issueCount: report.issueCount,
              artifactBytes: maintenance.artifactBytes,
              freeBytes: maintenance.freeBytes,
              freeRatio: maintenance.freeRatio,
              status: 'compacted',
              compaction,
            });
          } catch (error) {
            failedVolumes += 1;
            volumes.push({
              volumeId: report.volumeId,
              volumeName: report.volumeName,
              revision: report.revision,
              issueCount: report.issueCount,
              artifactBytes: maintenance.artifactBytes,
              freeBytes: maintenance.freeBytes,
              freeRatio: maintenance.freeRatio,
              status: 'failed',
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }

        return {
          generatedAt: new Date().toISOString(),
          dryRun: options.dryRun === true,
          includeUnsafe: options.includeUnsafe === true,
          checkedVolumes: doctorReport.checkedVolumes,
          recommendedVolumes: recommendedVolumes.length,
          eligibleVolumes,
          eligibleReclaimableBytes,
          plannedVolumes,
          plannedReclaimableBytes,
          blockedVolumes,
          blockedReclaimableBytes,
          compactedVolumes,
          failedVolumes,
          skippedVolumes: Math.max(0, doctorReport.checkedVolumes - recommendedVolumes.length),
          filteredVolumes,
          filteredReclaimableBytes,
          deferredVolumes,
          deferredReclaimableBytes,
          minimumFreeBytes: options.minFreeBytes ?? null,
          minimumFreeRatio: options.minFreeRatio ?? null,
          totalReclaimedBytes,
          volumes,
        };
      },
      (result) => ({
        checkedVolumes: result.checkedVolumes,
        recommendedVolumes: result.recommendedVolumes,
        eligibleVolumes: result.eligibleVolumes,
        plannedVolumes: result.plannedVolumes,
        blockedVolumes: result.blockedVolumes,
        compactedVolumes: result.compactedVolumes,
        failedVolumes: result.failedVolumes,
        dryRun: result.dryRun,
        includeUnsafe: result.includeUnsafe,
        filteredVolumes: result.filteredVolumes,
        deferredVolumes: result.deferredVolumes,
        minimumFreeBytes: result.minimumFreeBytes,
        minimumFreeRatio: result.minimumFreeRatio,
        totalReclaimedBytes: result.totalReclaimedBytes,
      }),
    );
  }

  private isSafeForBatchCompaction(
    issues: StorageDoctorReport['volumes'][number]['issues'],
  ): boolean {
    return issues.every((issue) => issue.code === 'COMPACTION_RECOMMENDED');
  }

  private getCompactionThresholdFilterReason(
    freeBytes: number,
    freeRatio: number,
    options: {
      minFreeBytes?: number;
      minFreeRatio?: number;
    },
  ): string | null {
    const requiresFreeBytes =
      options.minFreeBytes !== undefined && freeBytes < options.minFreeBytes;
    const requiresFreeRatio =
      options.minFreeRatio !== undefined && freeRatio < options.minFreeRatio;

    if (!requiresFreeBytes && !requiresFreeRatio) {
      return null;
    }

    if (requiresFreeBytes && requiresFreeRatio) {
      return `Below both thresholds: requires at least ${options.minFreeBytes} B and ${(options.minFreeRatio! * 100).toFixed(1)}%.`;
    }

    if (requiresFreeBytes) {
      return `Below --min-free-bytes threshold of ${options.minFreeBytes} B.`;
    }

    return `Below --min-free-ratio threshold of ${(options.minFreeRatio! * 100).toFixed(1)}%.`;
  }

  public async runDoctor(volumeId?: string): Promise<StorageDoctorReport> {
    return this.runAuditedOperation(
      {
        eventType: 'storage.doctor',
        resourceType: 'storage',
        volumeId,
      },
      () => this.repository.runDoctor(volumeId),
      (report) => ({
        checkedVolumes: report.checkedVolumes,
        issueCount: report.issueCount,
        healthy: report.healthy,
      }),
    );
  }

  public async runRepair(volumeId?: string): Promise<StorageRepairReport> {
    return this.runAuditedOperation(
      {
        eventType: 'storage.repair',
        resourceType: 'storage',
        volumeId,
      },
      () => this.repository.runRepair(volumeId),
      (report) => ({
        checkedVolumes: report.checkedVolumes,
        actionsApplied: report.actionsApplied,
        healthy: report.healthy,
      }),
    );
  }

  public async getExplorerSnapshot(
    volumeId: string,
    currentPath = '/',
    options: ExplorerSnapshotOptions = {},
  ): Promise<ExplorerSnapshot> {
    const record = await this.repository.loadVolume(volumeId);
    const directory = this.requireDirectoryByPath(record.state, currentPath);

    const sortedEntries = directory.childIds
      .map((childId) => record.state.entries[childId])
      .filter((entry): entry is VolumeEntry => entry !== undefined)
      .sort((left, right) => this.sortEntries(left, right));

    const totalEntries = sortedEntries.length;
    const requestedOffset = Math.max(0, options.offset ?? 0);
    const windowSize =
      options.limit === undefined ? totalEntries : Math.max(1, options.limit);
    const windowOffset = Math.min(
      requestedOffset,
      Math.max(0, totalEntries - windowSize),
    );
    const entries = sortedEntries
      .slice(windowOffset, windowOffset + windowSize)
      .map((entry) => this.toDirectoryListingItem(record.state, entry));

    return {
      volume: record.manifest,
      currentPath: normalizeVirtualPath(currentPath),
      breadcrumbs: ['/', ...getPathSegments(currentPath)],
      entries,
      totalEntries,
      windowOffset,
      windowSize,
      usageBytes: record.manifest.logicalUsedBytes,
      remainingBytes: Math.max(
        0,
        record.manifest.quotaBytes - record.manifest.logicalUsedBytes,
      ),
    };
  }

  public async createDirectory(
    volumeId: string,
    parentPath: string,
    directoryName: string,
  ): Promise<DirectoryEntry> {
    return this.runAuditedOperation(
      {
        eventType: 'entry.directory.create',
        resourceType: 'entry',
        volumeId,
        details: {
          parentPath,
          directoryName: directoryName.trim(),
        },
      },
      async () => {
        const name = assertValidEntryName(directoryName);
        const createdDirectory = await this.repository.mutateVolume(
          volumeId,
          (record) => {
            const parentDirectory = this.requireDirectoryByPath(record.state, parentPath);

            if (this.findChildByName(record.state, parentDirectory.id, name)) {
              throw new VolumeError(
                'ALREADY_EXISTS',
                `An entry named "${name}" already exists in ${parentPath}.`,
              );
            }

            return this.createDirectoryEntry(record.state, parentDirectory.id, name);
          },
        );
        this.logger.info(
          this.sanitizeObservabilityPayload({ volumeId, parentPath, directoryName: name }),
          'Directory created.',
        );

        return createdDirectory;
      },
      (entry) => ({
        entryId: entry.id,
        entryName: entry.name,
      }),
    );
  }

  public async importHostPaths(
    volumeId: string,
    input: ImportHostPathsInput,
  ): Promise<ImportSummary> {
    return this.runAuditedOperation(
      {
        eventType: 'host.import',
        resourceType: 'host-transfer',
        volumeId,
        details: {
          destinationPath: input.destinationPath,
          hostPathCount: input.hostPaths.length,
          hostPathsPreview: input.hostPaths
            .slice(0, 10)
            .map((hostPath) => path.resolve(hostPath)),
        },
      },
      async () => {
        if (input.hostPaths.length === 0) {
          throw new VolumeError('INVALID_OPERATION', 'No host paths were provided.');
        }

        const summary = await this.repository.mutateVolume(
          volumeId,
          async (record, database) => {
            const destinationDirectory = this.requireDirectoryByPath(
              record.state,
              input.destinationPath,
            );
            const blobStore = new BlobStore(
              this.repository.getVolumeDatabasePath(volumeId),
              this.logger.child({ scope: 'blob-store', volumeId }),
              this.config.redactSensitiveDetails,
            );
            const nextSummary: ImportSummary = {
              filesImported: 0,
              directoriesImported: 0,
              bytesImported: 0,
              conflictsResolved: 0,
              integrityChecksPassed: 0,
            };
            const traversalContext: ImportTraversalContext = {
              processedNodes: 0,
              onProgress: input.onProgress,
            };

            for (const rawHostPath of input.hostPaths) {
              const absoluteHostPath = path.resolve(rawHostPath);
              this.assertHostPathAllowed(absoluteHostPath, 'import');
              await this.importHostPath(
                database,
                record,
                blobStore,
                absoluteHostPath,
                destinationDirectory.id,
                nextSummary,
                traversalContext,
              );
            }

            return nextSummary;
          },
        );
        this.logger.info(
          this.sanitizeObservabilityPayload({
            volumeId,
            destinationPath: input.destinationPath,
            summary,
          }),
          'Host paths imported.',
        );

        return summary;
      },
      (summary) => ({
        filesImported: summary.filesImported,
        directoriesImported: summary.directoriesImported,
        bytesImported: summary.bytesImported,
        conflictsResolved: summary.conflictsResolved,
        integrityChecksPassed: summary.integrityChecksPassed,
      }),
    );
  }

  public async exportEntryToHost(
    volumeId: string,
    input: ExportVolumeEntryInput,
  ): Promise<ExportSummary> {
    return this.runAuditedOperation(
      {
        eventType: 'host.export',
        resourceType: 'host-transfer',
        volumeId,
        details: {
          sourcePath: input.sourcePath,
          destinationHostDirectory: path.resolve(input.destinationHostDirectory),
        },
      },
      async () => {
        const record = await this.repository.loadVolume(volumeId);
        const normalizedSourcePath = normalizeVirtualPath(input.sourcePath);
        const destinationHostDirectory = path.resolve(input.destinationHostDirectory);

        this.assertHostPathAllowed(destinationHostDirectory, 'export');
        const destinationStats = await fs.stat(destinationHostDirectory).catch(() => null);

        if (destinationStats && !destinationStats.isDirectory()) {
          throw new VolumeError(
            'INVALID_OPERATION',
            `The host destination must be a directory: ${destinationHostDirectory}`,
          );
        }

        await fs.mkdir(destinationHostDirectory, { recursive: true });

        const blobStore = new BlobStore(
          this.repository.getVolumeDatabasePath(volumeId),
          this.logger.child({ scope: 'blob-store', volumeId }),
          this.config.redactSensitiveDetails,
        );
        const summary: ExportSummary = {
          filesExported: 0,
          directoriesExported: 0,
          bytesExported: 0,
          conflictsResolved: 0,
          integrityChecksPassed: 0,
        };
        const traversalContext: ExportTraversalContext = {
          processedNodes: 0,
          onProgress: input.onProgress,
        };

        if (normalizedSourcePath === '/') {
          const rootDirectory = this.requireDirectoryById(record.state, record.state.rootId);
          const childEntries = rootDirectory.childIds
            .map((childId) => record.state.entries[childId])
            .filter((entry): entry is VolumeEntry => entry !== undefined)
            .sort((left, right) => this.sortEntries(left, right));

          for (const childEntry of childEntries) {
            await this.exportEntry(
              record.state,
              blobStore,
              childEntry,
              destinationHostDirectory,
              summary,
              traversalContext,
            );
          }
        } else {
          const sourceEntry = this.requireEntryByPath(record.state, normalizedSourcePath);
          await this.exportEntry(
            record.state,
            blobStore,
            sourceEntry,
            destinationHostDirectory,
            summary,
            traversalContext,
          );
        }

        this.logger.info(
          this.sanitizeObservabilityPayload({
            volumeId,
            sourcePath: normalizedSourcePath,
            destinationHostDirectory,
            summary,
          }),
          'Virtual entry exported to host.',
        );

        return summary;
      },
      (summary) => ({
        filesExported: summary.filesExported,
        directoriesExported: summary.directoriesExported,
        bytesExported: summary.bytesExported,
        conflictsResolved: summary.conflictsResolved,
        integrityChecksPassed: summary.integrityChecksPassed,
      }),
    );
  }

  public async moveEntry(
    volumeId: string,
    input: MoveEntryInput,
  ): Promise<string> {
    return this.runAuditedOperation(
      {
        eventType: 'entry.move',
        resourceType: 'entry',
        volumeId,
        details: {
          sourcePath: input.sourcePath,
          destinationDirectoryPath: input.destinationDirectoryPath,
          newName:
            input.newName?.trim() && input.newName.trim().length > 0
              ? input.newName.trim()
              : null,
        },
      },
      async () => {
        const sourcePath = normalizeVirtualPath(input.sourcePath);

        if (sourcePath === '/') {
          throw new VolumeError('INVALID_OPERATION', 'The root directory cannot be moved.');
        }
        const updatedPath = await this.repository.mutateVolume(
          volumeId,
          (record) => {
            const sourceEntry = this.requireEntryByPath(record.state, sourcePath);
            const sourceParent = this.requireDirectoryById(record.state, sourceEntry.parentId);
            const destinationDirectory = this.requireDirectoryByPath(
              record.state,
              input.destinationDirectoryPath,
            );

            if (
              sourceEntry.kind === 'directory' &&
              this.isAncestor(record.state, sourceEntry.id, destinationDirectory.id)
            ) {
              throw new VolumeError(
                'INVALID_OPERATION',
                'A directory cannot be moved into one of its descendants.',
              );
            }

            const candidateName = input.newName?.trim();
            const nextName =
              candidateName && candidateName.length > 0
                ? assertValidEntryName(candidateName)
                : sourceEntry.name;

            const conflictingEntry = this.findChildByName(
              record.state,
              destinationDirectory.id,
              nextName,
            );

            if (conflictingEntry && conflictingEntry.id !== sourceEntry.id) {
              throw new VolumeError(
                'ALREADY_EXISTS',
                `An entry named "${nextName}" already exists in ${input.destinationDirectoryPath}.`,
              );
            }

            const now = new Date().toISOString();
            sourceParent.childIds = sourceParent.childIds.filter(
              (childId) => childId !== sourceEntry.id,
            );
            destinationDirectory.childIds.push(sourceEntry.id);
            sourceParent.updatedAt = now;
            destinationDirectory.updatedAt = now;
            sourceEntry.parentId = destinationDirectory.id;
            sourceEntry.name = nextName;
            sourceEntry.updatedAt = now;

            return this.getPathForEntry(record.state, sourceEntry.id);
          },
        );
        this.logger.info(
          this.sanitizeObservabilityPayload({ volumeId, sourcePath, updatedPath }),
          'Entry moved.',
        );

        return updatedPath;
      },
      (updatedPath) => ({
        updatedPath,
      }),
    );
  }

  public async deleteEntry(volumeId: string, targetPath: string): Promise<number> {
    return this.runAuditedOperation(
      {
        eventType: 'entry.delete',
        resourceType: 'entry',
        volumeId,
        details: {
          targetPath,
        },
      },
      async () => {
        const normalizedPath = normalizeVirtualPath(targetPath);

        if (normalizedPath === '/') {
          throw new VolumeError('INVALID_OPERATION', 'The root directory cannot be deleted.');
        }
        const deletedEntries = await this.repository.mutateVolume(
          volumeId,
          async (record, database) => {
            const targetEntry = this.requireEntryByPath(record.state, normalizedPath);
            const parentDirectory = this.requireDirectoryById(record.state, targetEntry.parentId);
            const idsToDelete = this.collectDescendantIds(record.state, targetEntry.id);
            const contentRefsToDelete = this.collectContentRefs(record.state, idsToDelete);
            const blobStore = new BlobStore(
              this.repository.getVolumeDatabasePath(volumeId),
              this.logger.child({ scope: 'blob-store', volumeId }),
              this.config.redactSensitiveDetails,
            );

            parentDirectory.childIds = parentDirectory.childIds.filter(
              (childId) => childId !== targetEntry.id,
            );
            parentDirectory.updatedAt = new Date().toISOString();

            for (const entryId of idsToDelete) {
              delete record.state.entries[entryId];
            }

            await this.deleteOrphanedBlobsInDatabase(
              database,
              blobStore,
              record.state,
              contentRefsToDelete,
            );

            return idsToDelete.length;
          },
        );
        this.logger.info(
          this.sanitizeObservabilityPayload({ volumeId, targetPath: normalizedPath, deletedEntries }),
          'Entry deleted.',
        );

        return deletedEntries;
      },
      (deletedEntries) => ({
        deletedEntries,
      }),
    );
  }

  public async previewFile(volumeId: string, filePath: string): Promise<FilePreview> {
    const record = await this.repository.loadVolume(volumeId);
    const fileEntry = this.requireFileByPath(record.state, filePath);
    const blobStore = new BlobStore(
      this.repository.getVolumeDatabasePath(volumeId),
      this.logger.child({ scope: 'blob-store', volumeId }),
      this.config.redactSensitiveDetails,
    );

    const rawPreview = await blobStore.readPreview(
      fileEntry.contentRef,
      this.config.previewBytes + 1,
    );
    const truncated = rawPreview.byteLength > this.config.previewBytes;
    const previewSlice = truncated
      ? rawPreview.subarray(0, this.config.previewBytes)
      : rawPreview;

    if (!this.looksLikeText(previewSlice)) {
      return {
        path: normalizeVirtualPath(filePath),
        size: fileEntry.size,
        kind: 'binary',
        content: '[binary preview unavailable]',
        truncated,
      };
    }

    return {
      path: normalizeVirtualPath(filePath),
      size: fileEntry.size,
      kind: 'text',
      content: previewSlice.toString('utf8'),
      truncated,
    };
  }

  public async writeTextFile(
    volumeId: string,
    filePath: string,
    content: string,
  ): Promise<void> {
    await this.runAuditedOperation(
      {
        eventType: 'entry.file.write',
        resourceType: 'entry',
        volumeId,
        details: {
          filePath,
          bytesWritten: Buffer.byteLength(content, 'utf8'),
        },
      },
      async () => {
        const normalizedPath = normalizeVirtualPath(filePath);
        const fileName = assertValidEntryName(getBaseName(normalizedPath));
        await this.repository.mutateVolume(volumeId, async (record, database) => {
          const parentDirectory = this.requireDirectoryByPath(
            record.state,
            path.posix.dirname(normalizedPath),
          );
          const existing = this.findChildByName(record.state, parentDirectory.id, fileName);
          const blobStore = new BlobStore(
            this.repository.getVolumeDatabasePath(volumeId),
            this.logger.child({ scope: 'blob-store', volumeId }),
            this.config.redactSensitiveDetails,
          );

          const descriptor = await blobStore.putBufferInDatabase(
            database,
            Buffer.from(content, 'utf8'),
          );
          const now = new Date().toISOString();
          const staleContentRefs: string[] = [];

          if (existing?.kind === 'file') {
            const projectedUsage =
              record.manifest.logicalUsedBytes - existing.size + descriptor.size;
            this.ensureWithinQuota(record, projectedUsage);

            if (existing.contentRef !== descriptor.contentRef) {
              staleContentRefs.push(existing.contentRef);
            }

            existing.contentRef = descriptor.contentRef;
            existing.size = descriptor.size;
            existing.updatedAt = now;
            existing.importedFromHostPath = null;
          } else {
            if (existing) {
              throw new VolumeError(
                'ALREADY_EXISTS',
                `A directory named "${fileName}" already exists in ${parentDirectory.name}.`,
              );
            }

            this.ensureWithinQuota(
              record,
              record.manifest.logicalUsedBytes + descriptor.size,
            );

            this.createFileEntry(
              record.state,
              parentDirectory.id,
              fileName,
              descriptor.contentRef,
              descriptor.size,
              null,
            );
          }

          await this.deleteOrphanedBlobsInDatabase(
            database,
            blobStore,
            record.state,
            staleContentRefs,
          );
        });
        this.logger.info(
          this.sanitizeObservabilityPayload({ volumeId, filePath: normalizedPath }),
          'Text file written.',
        );
      },
    );
  }

  private async importHostPath(
    database: SqliteVolumeDatabase,
    record: VolumeRecord,
    blobStore: BlobStore,
    absoluteHostPath: string,
    destinationDirectoryId: string,
    summary: ImportSummary,
    traversalContext: ImportTraversalContext,
  ): Promise<void> {
    this.assertHostPathAllowed(absoluteHostPath, 'import');
    const hostEntryStats = await fs.lstat(absoluteHostPath);

    if (hostEntryStats.isSymbolicLink()) {
      throw new VolumeError(
        'UNSUPPORTED_HOST_ENTRY',
        `Symbolic links are not supported: ${absoluteHostPath}`,
      );
    }

    if (hostEntryStats.isDirectory()) {
      const desiredName = path.basename(absoluteHostPath);
      const directoryName = this.resolveAvailableName(
        record.state,
        destinationDirectoryId,
        desiredName,
      );

      if (directoryName !== desiredName) {
        summary.conflictsResolved += 1;
      }

      const directoryEntry = this.createDirectoryEntry(
        record.state,
        destinationDirectoryId,
        directoryName,
      );
      summary.directoriesImported += 1;
      await this.reportImportProgress(
        traversalContext,
        absoluteHostPath,
        'directory',
        summary,
        0,
        null,
      );

      const childNames = await fs.readdir(absoluteHostPath);
      childNames.sort((left, right) => left.localeCompare(right));

      for (const childName of childNames) {
        await this.importHostPath(
          database,
          record,
          blobStore,
          path.join(absoluteHostPath, childName),
          directoryEntry.id,
          summary,
          traversalContext,
        );
      }

      return;
    }

    if (hostEntryStats.isFile()) {
      const desiredName = path.basename(absoluteHostPath);
      const fileName = this.resolveAvailableName(
        record.state,
        destinationDirectoryId,
        desiredName,
      );

      if (fileName !== desiredName) {
        summary.conflictsResolved += 1;
      }

      this.ensureWithinQuota(
        record,
        record.manifest.logicalUsedBytes + summary.bytesImported + hostEntryStats.size,
      );

      const descriptor = await blobStore.putHostFileInDatabase(database, absoluteHostPath, {
        totalBytes: hostEntryStats.size,
        onProgress: ({ bytesTransferred, totalBytes, phase }) => {
          this.emitImportProgress(
            traversalContext,
            absoluteHostPath,
            phase === 'integrity' ? 'integrity' : 'file',
            summary,
            bytesTransferred,
            totalBytes,
          );
        },
      });

      this.createFileEntry(
        record.state,
        destinationDirectoryId,
        fileName,
        descriptor.contentRef,
        descriptor.size,
        absoluteHostPath,
      );

      summary.filesImported += 1;
      summary.bytesImported += descriptor.size;
      summary.integrityChecksPassed += 1;
      await this.reportImportProgress(
        traversalContext,
        absoluteHostPath,
        'integrity',
        summary,
        descriptor.size,
        descriptor.size,
      );
      return;
    }

    throw new VolumeError(
      'UNSUPPORTED_HOST_ENTRY',
      `Unsupported host entry type: ${absoluteHostPath}`,
    );
  }

  private async exportEntry(
    state: VolumeState,
    blobStore: BlobStore,
    entry: VolumeEntry,
    destinationHostDirectory: string,
    summary: ExportSummary,
    traversalContext: ExportTraversalContext,
  ): Promise<void> {
    const sourceVirtualPath = this.getPathForEntry(state, entry.id);

    if (entry.kind === 'directory') {
      const destinationDirectoryPath = await this.resolveAvailableHostPath(
        destinationHostDirectory,
        entry.name,
      );

      if (path.basename(destinationDirectoryPath) !== entry.name) {
        summary.conflictsResolved += 1;
      }

      await fs.mkdir(destinationDirectoryPath, { recursive: false });
      summary.directoriesExported += 1;
      await this.reportExportProgress(
        traversalContext,
        sourceVirtualPath,
        destinationDirectoryPath,
        'directory',
        summary,
        0,
        null,
      );

      const childEntries = entry.childIds
        .map((childId) => state.entries[childId])
        .filter((childEntry): childEntry is VolumeEntry => childEntry !== undefined)
        .sort((left, right) => this.sortEntries(left, right));

      for (const childEntry of childEntries) {
        await this.exportEntry(
          state,
          blobStore,
          childEntry,
          destinationDirectoryPath,
          summary,
          traversalContext,
        );
      }

      return;
    }

    const destinationFilePath = await this.resolveAvailableHostPath(
      destinationHostDirectory,
      entry.name,
    );

    if (path.basename(destinationFilePath) !== entry.name) {
      summary.conflictsResolved += 1;
    }

    await blobStore.exportBlobToHost(entry.contentRef, destinationFilePath, {
      totalBytes: entry.size,
      onProgress: ({ bytesTransferred, totalBytes, phase }) => {
        this.emitExportProgress(
          traversalContext,
          sourceVirtualPath,
          destinationFilePath,
          phase === 'integrity' ? 'integrity' : 'file',
          summary,
          bytesTransferred,
          totalBytes,
        );
      },
    });

    summary.filesExported += 1;
    summary.bytesExported += entry.size;
    summary.integrityChecksPassed += 1;
    await this.reportExportProgress(
      traversalContext,
      sourceVirtualPath,
      destinationFilePath,
      'integrity',
      summary,
      entry.size,
      entry.size,
    );
  }

  private createDirectoryEntry(
    state: VolumeState,
    parentId: string,
    name: string,
  ): DirectoryEntry {
    const parentDirectory = this.requireDirectoryById(state, parentId);
    const now = new Date().toISOString();

    const directoryEntry: DirectoryEntry = {
      id: `dir_${nanoid(10)}`,
      kind: 'directory',
      name,
      parentId,
      childIds: [],
      createdAt: now,
      updatedAt: now,
    };

    state.entries[directoryEntry.id] = directoryEntry;
    parentDirectory.childIds.push(directoryEntry.id);
    parentDirectory.updatedAt = now;

    return directoryEntry;
  }

  private createFileEntry(
    state: VolumeState,
    parentId: string,
    name: string,
    contentRef: string,
    size: number,
    importedFromHostPath: string | null,
  ): FileEntry {
    const parentDirectory = this.requireDirectoryById(state, parentId);
    const now = new Date().toISOString();

    const fileEntry: FileEntry = {
      id: `file_${nanoid(10)}`,
      kind: 'file',
      name,
      parentId,
      createdAt: now,
      updatedAt: now,
      size,
      contentRef,
      importedFromHostPath,
    };

    state.entries[fileEntry.id] = fileEntry;
    parentDirectory.childIds.push(fileEntry.id);
    parentDirectory.updatedAt = now;

    return fileEntry;
  }

  private requireDirectoryByPath(
    state: VolumeState,
    virtualPath: string,
  ): DirectoryEntry {
    const entry = this.requireEntryByPath(state, virtualPath);
    if (entry.kind !== 'directory') {
      throw new VolumeError(
        'INVALID_OPERATION',
        `${virtualPath} is not a directory.`,
      );
    }

    return entry;
  }

  private requireFileByPath(state: VolumeState, virtualPath: string): FileEntry {
    const entry = this.requireEntryByPath(state, virtualPath);
    if (entry.kind !== 'file') {
      throw new VolumeError('INVALID_OPERATION', `${virtualPath} is not a file.`);
    }

    return entry;
  }

  private requireEntryByPath(state: VolumeState, virtualPath: string): VolumeEntry {
    const normalizedPath = normalizeVirtualPath(virtualPath);
    if (normalizedPath === '/') {
      return this.requireDirectoryById(state, state.rootId);
    }

    let currentEntry: VolumeEntry = this.requireDirectoryById(state, state.rootId);

    for (const segment of getPathSegments(normalizedPath)) {
      if (currentEntry.kind !== 'directory') {
        throw new VolumeError(
          'INVALID_PATH',
          `Cannot descend into non-directory entry: ${currentEntry.name}`,
        );
      }

      const currentDirectory: DirectoryEntry = currentEntry;
      const childEntries: VolumeEntry[] = currentDirectory.childIds.flatMap(
        (childId) => {
          const entry = state.entries[childId];
          return entry ? [entry] : [];
        },
      );

      const nextEntry: VolumeEntry | undefined = childEntries.find(
        (entry: VolumeEntry) => entry.name === segment,
      );

      if (!nextEntry) {
        throw new VolumeError('NOT_FOUND', `Virtual path does not exist: ${virtualPath}`);
      }

      currentEntry = nextEntry;
    }

    return currentEntry;
  }

  private requireDirectoryById(
    state: VolumeState,
    directoryId: string | null,
  ): DirectoryEntry {
    if (!directoryId) {
      throw new VolumeError('INVALID_PATH', 'Directory id is missing.');
    }

    const entry = state.entries[directoryId];
    if (entry?.kind !== 'directory') {
      throw new VolumeError('NOT_FOUND', `Directory ${directoryId} does not exist.`);
    }

    return entry;
  }

  private findChildByName(
    state: VolumeState,
    parentId: string,
    name: string,
  ): VolumeEntry | undefined {
    const parentDirectory = this.requireDirectoryById(state, parentId);

    return parentDirectory.childIds
      .map((childId) => state.entries[childId])
      .find((entry) => entry?.name === name);
  }

  private collectDescendantIds(state: VolumeState, entryId: string): string[] {
    const entry = state.entries[entryId];
    if (!entry) {
      return [];
    }

    if (entry.kind === 'file') {
      return [entry.id];
    }

    return [
      entry.id,
      ...entry.childIds.flatMap((childId) =>
        this.collectDescendantIds(state, childId),
      ),
    ];
  }

  private isAncestor(
    state: VolumeState,
    candidateAncestorId: string,
    nodeId: string,
  ): boolean {
    let currentNode: VolumeEntry | undefined = state.entries[nodeId];

    while (currentNode) {
      if (currentNode.id === candidateAncestorId) {
        return true;
      }

      currentNode =
        currentNode.parentId === null
          ? undefined
          : state.entries[currentNode.parentId];
    }

    return false;
  }

  private getPathForEntry(state: VolumeState, entryId: string): string {
    const segments: string[] = [];
    let currentNode: VolumeEntry | undefined = state.entries[entryId];

    while (currentNode && currentNode.parentId !== null) {
      segments.push(currentNode.name);
      currentNode = state.entries[currentNode.parentId];
    }

    return buildChildVirtualPath('/', segments.reverse().join('/'));
  }

  private resolveAvailableName(
    state: VolumeState,
    parentId: string,
    preferredName: string,
  ): string {
    const sanitizedName = assertValidEntryName(preferredName);
    if (!this.findChildByName(state, parentId, sanitizedName)) {
      return sanitizedName;
    }

    const extension = path.extname(sanitizedName);
    const baseName = sanitizedName.slice(0, sanitizedName.length - extension.length);
    let attempt = 2;

    while (true) {
      const candidate = `${baseName} (${attempt})${extension}`;
      if (!this.findChildByName(state, parentId, candidate)) {
        return candidate;
      }

      attempt += 1;
    }
  }

  private async resolveAvailableHostPath(
    parentDirectory: string,
    preferredName: string,
  ): Promise<string> {
    const sanitizedName = assertValidEntryName(preferredName);
    let candidatePath = path.join(parentDirectory, sanitizedName);

    if (!(await this.hostPathExists(candidatePath))) {
      return candidatePath;
    }

    const extension = path.extname(sanitizedName);
    const baseName = sanitizedName.slice(0, sanitizedName.length - extension.length);
    let attempt = 2;

    while (true) {
      candidatePath = path.join(parentDirectory, `${baseName} (${attempt})${extension}`);
      if (!(await this.hostPathExists(candidatePath))) {
        return candidatePath;
      }

      attempt += 1;
    }
  }

  private sortEntries(left: VolumeEntry, right: VolumeEntry): number {
    if (left.kind !== right.kind) {
      return left.kind === 'directory' ? -1 : 1;
    }

    return left.name.localeCompare(right.name);
  }

  private toDirectoryListingItem(
    state: VolumeState,
    entry: VolumeEntry,
  ): DirectoryListingItem {
    return {
      id: entry.id,
      name: entry.name,
      path: this.getPathForEntry(state, entry.id),
      kind: entry.kind,
      size: entry.kind === 'file' ? entry.size : 0,
      updatedAt: entry.updatedAt,
    };
  }

  private ensureWithinQuota(record: VolumeRecord, projectedUsage: number): void {
    if (projectedUsage > record.manifest.quotaBytes) {
      throw new VolumeError(
        'QUOTA_EXCEEDED',
        `Volume quota exceeded. Projected usage ${projectedUsage} bytes exceeds ${record.manifest.quotaBytes} bytes.`,
      );
    }
  }

  private async deleteOrphanedBlobs(
    blobStore: BlobStore,
    state: VolumeState,
    candidateContentRefs: string[],
  ): Promise<void> {
    if (candidateContentRefs.length === 0) {
      return;
    }

    const referencedContentRefs = this.getReferencedContentRefs(state);

    for (const contentRef of new Set(candidateContentRefs)) {
      if (referencedContentRefs.has(contentRef)) {
        continue;
      }

      await blobStore.deleteBlob(contentRef);
    }
  }

  private async deleteOrphanedBlobsInDatabase(
    database: SqliteVolumeDatabase,
    blobStore: BlobStore,
    state: VolumeState,
    candidateContentRefs: string[],
  ): Promise<void> {
    if (candidateContentRefs.length === 0) {
      return;
    }

    const referencedContentRefs = this.getReferencedContentRefs(state);

    for (const contentRef of new Set(candidateContentRefs)) {
      if (referencedContentRefs.has(contentRef)) {
        continue;
      }

      await blobStore.deleteBlobInDatabase(database, contentRef);
    }
  }

  private collectContentRefs(state: VolumeState, entryIds: string[]): string[] {
    return entryIds.flatMap((entryId) => {
      const entry = state.entries[entryId];
      if (entry?.kind !== 'file') {
        return [];
      }

      return [entry.contentRef];
    });
  }

  private getReferencedContentRefs(state: VolumeState): Set<string> {
    return new Set(
      Object.values(state.entries).flatMap((entry) =>
        entry.kind === 'file' ? [entry.contentRef] : [],
      ),
    );
  }

  private async reportImportProgress(
    context: ImportTraversalContext,
    currentHostPath: string,
    phase: ImportProgress['phase'],
    summary: ImportSummary,
    currentBytes: number,
    currentTotalBytes: number | null,
  ): Promise<void> {
    context.processedNodes += 1;

    if (context.onProgress) {
      await context.onProgress({
        currentHostPath,
        phase,
        summary: { ...summary },
        currentBytes,
        currentTotalBytes,
      });
    }

    if (context.processedNodes % 25 === 0) {
      await this.yieldToEventLoop();
    }
  }

  private emitImportProgress(
    context: ImportTraversalContext,
    currentHostPath: string,
    phase: ImportProgress['phase'],
    summary: ImportSummary,
    currentBytes: number,
    currentTotalBytes: number | null,
  ): void {
    if (!context.onProgress) {
      return;
    }

    void context.onProgress({
      currentHostPath,
      phase,
      summary: { ...summary },
      currentBytes,
      currentTotalBytes,
    });
  }

  private async reportExportProgress(
    context: ExportTraversalContext,
    currentVirtualPath: string,
    destinationHostPath: string,
    phase: ExportProgress['phase'],
    summary: ExportSummary,
    currentBytes: number,
    currentTotalBytes: number | null,
  ): Promise<void> {
    context.processedNodes += 1;

    if (context.onProgress) {
      await context.onProgress({
        currentVirtualPath,
        destinationHostPath,
        phase,
        summary: { ...summary },
        currentBytes,
        currentTotalBytes,
      });
    }

    if (context.processedNodes % 25 === 0) {
      await this.yieldToEventLoop();
    }
  }

  private emitExportProgress(
    context: ExportTraversalContext,
    currentVirtualPath: string,
    destinationHostPath: string,
    phase: ExportProgress['phase'],
    summary: ExportSummary,
    currentBytes: number,
    currentTotalBytes: number | null,
  ): void {
    if (!context.onProgress) {
      return;
    }

    void context.onProgress({
      currentVirtualPath,
      destinationHostPath,
      phase,
      summary: { ...summary },
      currentBytes,
      currentTotalBytes,
    });
  }

  private async hostPathExists(targetPath: string): Promise<boolean> {
    try {
      await fs.access(targetPath);
      return true;
    } catch {
      return false;
    }
  }

  private async yieldToEventLoop(): Promise<void> {
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });
  }

  private looksLikeText(buffer: Buffer): boolean {
    if (buffer.byteLength === 0) {
      return true;
    }

    let suspiciousBytes = 0;
    for (const value of buffer.values()) {
      const isNullByte = value === 0;
      const isControlCharacter = value < 8 || (value > 13 && value < 32);
      if (isNullByte || isControlCharacter) {
        suspiciousBytes += 1;
      }
    }

    return suspiciousBytes / buffer.byteLength < 0.2;
  }

  private async runAuditedOperation<T>(
    options: AuditOperationOptions,
    operation: () => Promise<T>,
    getSuccessDetails?: (result: T) => Record<string, unknown> | undefined,
    ): Promise<T> {
      const operationId = `audit_${nanoid(10)}`;
      const startedAt = Date.now();
      const startedAtIso = new Date(startedAt).toISOString();

      try {
        const result = await operation();
        const completedAt = Date.now();
        const details = this.sanitizeObservabilityPayload({
          ...(options.details ?? {}),
          ...(getSuccessDetails?.(result) ?? {}),
        });
        this.auditLogger.info(
          {
            category: 'audit',
          operationId,
          eventType: options.eventType,
          resourceType: options.resourceType,
          outcome: 'success',
            volumeId: options.volumeId,
            startedAt: startedAtIso,
            completedAt: new Date(completedAt).toISOString(),
            durationMs: completedAt - startedAt,
            details,
          },
          'Audit event recorded.',
        );

      return result;
      } catch (error) {
        const completedAt = Date.now();
        const auditError = this.serializeAuditError(error);
        const details = this.sanitizeObservabilityPayload(options.details ?? {});
        const errorPayload = this.sanitizeObservabilityPayload(auditError.payload);

        if (auditError.severity === 'error') {
          this.auditLogger.error(
          {
            category: 'audit',
            operationId,
            eventType: options.eventType,
            resourceType: options.resourceType,
            outcome: 'failure',
              volumeId: options.volumeId,
              startedAt: startedAtIso,
              completedAt: new Date(completedAt).toISOString(),
              durationMs: completedAt - startedAt,
              details,
              error: errorPayload,
            },
            'Audit event recorded.',
          );
      } else {
        this.auditLogger.warn(
          {
            category: 'audit',
            operationId,
            eventType: options.eventType,
            resourceType: options.resourceType,
            outcome: 'failure',
              volumeId: options.volumeId,
              startedAt: startedAtIso,
              completedAt: new Date(completedAt).toISOString(),
              durationMs: completedAt - startedAt,
              details,
              error: errorPayload,
            },
            'Audit event recorded.',
          );
      }

      throw error;
    }
  }

  private serializeAuditError(error: unknown): {
    payload: Record<string, unknown>;
    severity: 'error' | 'warn';
  } {
      if (isVolumeError(error)) {
        const details = error.details ?? null;
        return {
          severity: 'warn',
          payload: {
            code: error.code,
            message: this.sanitizeObservabilityText(error.message, details),
            details,
          },
        };
      }

    if (error instanceof Error) {
      return {
        severity: 'error',
        payload: {
          code: 'UNEXPECTED_ERROR',
          message: error.message,
        },
      };
    }

    return {
      severity: 'error',
      payload: {
        code: 'UNKNOWN_ERROR',
        message: 'Unknown runtime failure.',
      },
    };
  }

  private assertHostPathAllowed(
    absoluteHostPath: string,
    operation: 'export' | 'import',
  ): void {
    const normalizedPath = this.normalizeHostPolicyPath(absoluteHostPath);

    const blockedRoot = this.config.hostDenyPaths.find((rootPath) =>
      this.isPathWithinHostRoot(normalizedPath, rootPath),
    );
    if (blockedRoot) {
      throw new VolumeError(
        'INVALID_OPERATION',
        `${operation === 'import' ? 'Import' : 'Export'} path is blocked by configured host denylist: ${absoluteHostPath}`,
        {
          deniedRoot: blockedRoot,
          hostPath: absoluteHostPath,
          operation,
        },
      );
    }

    if (
      this.config.hostAllowPaths.length > 0 &&
      !this.config.hostAllowPaths.some((rootPath) =>
        this.isPathWithinHostRoot(normalizedPath, rootPath),
      )
    ) {
      throw new VolumeError(
        'INVALID_OPERATION',
        `${operation === 'import' ? 'Import' : 'Export'} path is outside the configured host allowlist: ${absoluteHostPath}`,
        {
          allowedRoots: [...this.config.hostAllowPaths],
          hostPath: absoluteHostPath,
          operation,
        },
      );
    }
  }

  private isPathWithinHostRoot(targetPath: string, rootPath: string): boolean {
    const normalizedRoot = this.normalizeHostPolicyPath(rootPath);
    const relativePath = path.relative(normalizedRoot, targetPath);

    return (
      relativePath.length === 0 ||
      (!relativePath.startsWith('..') && !path.isAbsolute(relativePath))
    );
  }

  private normalizeHostPolicyPath(targetPath: string): string {
    const resolvedPath = path.resolve(targetPath);
    return process.platform === 'win32' ? resolvedPath.toLowerCase() : resolvedPath;
  }
}
