import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { createRuntime, type AppRuntime } from '../bootstrap/create-runtime.js';
import { VolumeError } from '../domain/errors.js';
import type { VolumeRestoreDrillResult } from '../domain/types.js';
import { sanitizeObservabilityValue } from '../utils/observability-redaction.js';

export interface RunRestoreDrillInput {
  backupPath: string;
  keepSandbox?: boolean;
}

export const runRestoreDrill = async (
  runtime: AppRuntime,
  input: RunRestoreDrillInput,
): Promise<VolumeRestoreDrillResult> => {
  const absoluteBackupPath = path.resolve(input.backupPath);
  const sandboxRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), 'cli-node-virtual-volumes-restore-drill-'),
  );
  const sandboxDataDir = path.join(sandboxRoot, 'data');
  const sandboxLogDir = path.join(sandboxRoot, 'logs');
  let drillRuntime: AppRuntime | null = null;
  let preservedSandbox = input.keepSandbox === true;

  try {
    const inspection = await runtime.volumeService.inspectVolumeBackup(absoluteBackupPath);

    drillRuntime = await createRuntime({
      auditLogLevel: 'silent',
      correlationId: `${runtime.correlationId}:restore-drill`,
      dataDir: sandboxDataDir,
      hostAllowPaths: runtime.config.hostAllowPaths,
      hostDenyPaths: runtime.config.hostDenyPaths,
      logDir: sandboxLogDir,
      logLevel: 'silent',
      logRetentionDays: null,
      logToStdout: false,
      redactSensitiveDetails: runtime.config.redactSensitiveDetails,
      supportBundleLogTailLines: runtime.config.supportBundleLogTailLines,
    });

    const restore = await drillRuntime.volumeService.restoreVolumeBackup(absoluteBackupPath);
    const doctor = await drillRuntime.volumeService.runDoctor(restore.volumeId);
    const result: VolumeRestoreDrillResult = {
      generatedAt: new Date().toISOString(),
      backupPath: absoluteBackupPath,
      sandboxPath: preservedSandbox ? sandboxRoot : null,
      keptSandbox: preservedSandbox,
      healthy: doctor.healthy,
      inspection,
      restore,
      doctor,
    };

    runtime.logger.info(
      sanitizeObservabilityValue(
        {
          backupPath: absoluteBackupPath,
          sandboxPath: preservedSandbox ? sandboxRoot : '<cleaned>',
          volumeId: restore.volumeId,
          revision: restore.revision,
          keptSandbox: preservedSandbox,
          healthy: doctor.healthy,
          issueCount: doctor.issueCount,
        },
        runtime.config.redactSensitiveDetails,
      ),
      'Restore drill completed.',
    );

    runtime.auditLogger.info(
      sanitizeObservabilityValue(
        {
          eventType: 'volume.restore.drill',
          resourceType: 'backup',
          outcome: doctor.healthy ? 'success' : 'failure',
          backupPath: absoluteBackupPath,
          volumeId: restore.volumeId,
          revision: restore.revision,
          keptSandbox: preservedSandbox,
          issueCount: doctor.issueCount,
        },
        runtime.config.redactSensitiveDetails,
      ),
      'Restore drill completed.',
    );

    return result;
  } catch (error) {
    preservedSandbox = true;

    runtime.logger.error(
      sanitizeObservabilityValue(
        {
          backupPath: absoluteBackupPath,
          sandboxPath: sandboxRoot,
          error,
        },
        runtime.config.redactSensitiveDetails,
      ),
      'Restore drill failed.',
    );

    runtime.auditLogger.info(
      sanitizeObservabilityValue(
        {
          eventType: 'volume.restore.drill',
          resourceType: 'backup',
          outcome: 'failure',
          backupPath: absoluteBackupPath,
          sandboxPath: sandboxRoot,
        },
        runtime.config.redactSensitiveDetails,
      ),
      'Restore drill failed.',
    );

    throw new VolumeError(
      'INVALID_OPERATION',
      `Restore drill failed. Sandbox preserved at ${sandboxRoot}.`,
      {
        backupPath: absoluteBackupPath,
        sandboxPath: sandboxRoot,
        cause: error instanceof Error ? error.message : String(error),
      },
    );
  } finally {
    if (drillRuntime) {
      await drillRuntime.close().catch(() => undefined);
    }

    if (!preservedSandbox) {
      await fs.rm(sandboxRoot, { recursive: true, force: true }).catch(() => undefined);
    }
  }
};
