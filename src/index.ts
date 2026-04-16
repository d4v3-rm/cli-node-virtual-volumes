import { Command } from 'commander';

import { createRuntime } from './bootstrap/create-runtime.js';
import { loadAppConfig } from './config/env.js';
import {
  formatBackupInspectionResult,
  formatBackupResult,
  formatRestoreDrillResult,
  formatRestoreResult,
} from './cli/backup.js';
import { formatDoctorReport, formatRepairReport } from './cli/doctor.js';
import { renderCliResult, writeCliJsonArtifact } from './cli/output.js';
import {
  evaluateSupportBundleIntegrityRequirement,
  evaluateSupportBundleSharingRequirement,
  formatSupportBundleIntegrityRequirementStatus,
  formatSupportBundleSharingRequirementStatus,
  parseSupportBundleIntegrityDepth,
  parseSupportBundleSharingRecommendation,
  formatSupportBundleInspectionResult,
  formatSupportBundleResult,
} from './cli/support-bundle.js';
import {
  evaluateStorageRepairBatchPolicy,
  evaluateVolumeCompactionBatchPolicy,
  formatStorageRepairBatchPolicyStatus,
  formatStorageRepairBatchResult,
  formatVolumeCompactionBatchPolicyStatus,
  formatVolumeCompactionBatchResult,
  formatVolumeCompactionResult,
} from './cli/maintenance.js';
import { runRestoreDrill } from './ops/restore-drill.js';
import { createSupportBundle, inspectSupportBundle } from './ops/support-bundle.js';
import { TerminalApp } from './ui/terminal-app.js';
import { createCorrelationId } from './utils/correlation.js';
import { sanitizeObservabilityValue } from './utils/observability-redaction.js';

const main = async (): Promise<void> => {
  const program = new Command()
    .name('virtual-volumes')
    .description('Node-only virtual volumes with a rich terminal UI.')
    .option('--data-dir <path>', 'Override the application data directory')
    .option('--log-dir <path>', 'Override the log output directory')
    .option('--log-level <level>', 'Override the log level')
    .option(
      '--stdout-logs',
      'Mirror logs to the terminal stream (not recommended while the fullscreen UI is active)',
    );

  const getRuntimeOverrides = (): {
    dataDir?: string;
    logDir?: string;
    logLevel?: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent';
    logToStdout?: boolean;
  } => {
    const options = program.opts<{
      dataDir?: string;
      logDir?: string;
      logLevel?: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent';
      stdoutLogs?: boolean;
    }>();
    const logLevelSource = program.getOptionValueSource('logLevel');
    const stdoutLogsSource = program.getOptionValueSource('stdoutLogs');

    return {
      dataDir: options.dataDir,
      logDir: options.logDir,
      logLevel: logLevelSource === 'cli' ? options.logLevel : undefined,
      logToStdout: stdoutLogsSource === 'cli' ? options.stdoutLogs : undefined,
    };
  };

  const sanitizeArtifactPayload = <T>(
    payload: T,
    redactSensitiveDetails: boolean,
  ): T => sanitizeObservabilityValue(payload, redactSensitiveDetails);

  const withRuntime = async <T>(
    action: (runtime: Awaited<ReturnType<typeof createRuntime>>) => Promise<T>,
  ): Promise<T> => {
    const runtime = await createRuntime(getRuntimeOverrides());

    try {
      return await action(runtime);
    } finally {
      await runtime.close();
    }
  };

  program.action(async () => {
    await withRuntime(async (runtime) => {
      const app = new TerminalApp(runtime);
      await app.start();
    });
  });

  program
    .command('backup')
    .description('Create a consistent SQLite backup for a specific volume.')
    .argument('<volumeId>', 'Back up a specific volume by id')
    .argument('<destinationPath>', 'Write the backup snapshot to this path')
    .option('--json', 'Output the result as JSON')
    .option('--output <path>', 'Write the structured JSON result to this file')
    .option('--force', 'Overwrite the destination file if it already exists')
    .action(
      async (
        volumeId: string,
        destinationPath: string,
        options: { json?: boolean; output?: string; force?: boolean },
      ) => {
        await withRuntime(async (runtime) => {
          const correlationId = runtime.correlationId;
          const result = await runtime.volumeService.backupVolume(volumeId, destinationPath, {
            overwrite: options.force,
          });
          const artifactPath = options.output
            ? await writeCliJsonArtifact(
                'backup',
                sanitizeArtifactPayload(result, runtime.config.redactSensitiveDetails),
                options.output,
                {
                  correlationId,
                },
              )
            : null;

          console.log(
            renderCliResult(result, formatBackupResult, {
              artifactPath,
              correlationId,
              json: options.json,
            }),
          );
        });
      },
    );

  program
    .command('restore')
    .description('Restore a volume SQLite backup into the managed data directory.')
    .argument('<backupPath>', 'Restore a backup snapshot previously created by the CLI')
    .option('--json', 'Output the result as JSON')
    .option('--output <path>', 'Write the structured JSON result to this file')
    .option('--force', 'Overwrite an existing volume with the same id')
    .action(
      async (
        backupPath: string,
        options: { json?: boolean; output?: string; force?: boolean },
      ) => {
        await withRuntime(async (runtime) => {
          const correlationId = runtime.correlationId;
          const result = await runtime.volumeService.restoreVolumeBackup(backupPath, {
            overwrite: options.force,
          });
          const artifactPath = options.output
            ? await writeCliJsonArtifact(
                'restore',
                sanitizeArtifactPayload(result, runtime.config.redactSensitiveDetails),
                options.output,
                {
                  correlationId,
                },
              )
            : null;

          console.log(
            renderCliResult(result, formatRestoreResult, {
              artifactPath,
              correlationId,
              json: options.json,
            }),
          );
        });
      },
    );

  program
    .command('inspect-backup')
    .description('Inspect a backup artifact and validate its manifest when present.')
    .argument('<backupPath>', 'Inspect a backup snapshot previously created by the CLI')
    .option('--json', 'Output the result as JSON')
    .option('--output <path>', 'Write the structured JSON result to this file')
    .action(
      async (
        backupPath: string,
        options: { json?: boolean; output?: string },
      ) => {
        await withRuntime(async (runtime) => {
          const correlationId = runtime.correlationId;
          const result = await runtime.volumeService.inspectVolumeBackup(backupPath);
          const artifactPath = options.output
            ? await writeCliJsonArtifact(
                'inspect-backup',
                sanitizeArtifactPayload(result, runtime.config.redactSensitiveDetails),
                options.output,
                {
                  correlationId,
                },
              )
            : null;

          console.log(
            renderCliResult(result, formatBackupInspectionResult, {
              artifactPath,
              correlationId,
              json: options.json,
            }),
          );
        });
      },
    );

  program
    .command('restore-drill')
    .description(
      'Run an isolated inspect, restore, and doctor drill for a backup without touching the live data directory.',
    )
    .argument('<backupPath>', 'Run a restore drill against this backup snapshot')
    .option('--json', 'Output the drill result as JSON')
    .option('--output <path>', 'Write the structured JSON result to this file')
    .option(
      '--keep-sandbox',
      'Preserve the temporary sandbox data directory after a successful drill',
    )
    .action(
      async (
        backupPath: string,
        options: { json?: boolean; output?: string; keepSandbox?: boolean },
      ) => {
        await withRuntime(async (runtime) => {
          const correlationId = runtime.correlationId;
          const result = await runRestoreDrill(runtime, {
            backupPath,
            keepSandbox: options.keepSandbox,
          });
          const artifactPath = options.output
            ? await writeCliJsonArtifact(
                'restore-drill',
                sanitizeArtifactPayload(result, runtime.config.redactSensitiveDetails),
                options.output,
                {
                  correlationId,
                },
              )
            : null;

          console.log(
            renderCliResult(result, formatRestoreDrillResult, {
              artifactPath,
              correlationId,
              json: options.json,
            }),
          );

          if (!result.healthy) {
            process.exitCode = 1;
          }
        });
      },
    );

  program
    .command('compact')
    .description('Compact a managed volume database and reclaim SQLite free pages.')
    .argument('<volumeId>', 'Compact a specific volume by id')
    .option('--json', 'Output the compaction result as JSON')
    .option('--output <path>', 'Write the structured JSON result to this file')
    .action(
      async (
        volumeId: string,
        options: { json?: boolean; output?: string },
      ) => {
        await withRuntime(async (runtime) => {
          const correlationId = runtime.correlationId;
          const result = await runtime.volumeService.compactVolume(volumeId);
          const artifactPath = options.output
            ? await writeCliJsonArtifact(
                'compact',
                sanitizeArtifactPayload(result, runtime.config.redactSensitiveDetails),
                options.output,
                {
                  correlationId,
                },
              )
            : null;

          console.log(
            renderCliResult(result, formatVolumeCompactionResult, {
              artifactPath,
              correlationId,
              json: options.json,
            }),
          );
        });
      },
    );

  program
    .command('compact-recommended')
    .description(
      'Compact all managed volumes currently flagged by doctor as needing SQLite compaction.',
    )
    .option('--dry-run', 'Report which volumes would be compacted without mutating them')
    .option(
      '--include-unsafe',
      'Allow batch compaction even when a recommended volume also has non-compaction doctor issues',
    )
    .option(
      '--limit <count>',
      'Only process the top N recommended volumes, ordered by reclaimable free bytes',
      (value: string) => {
        const parsed = Number.parseInt(value, 10);
        if (!Number.isInteger(parsed) || parsed <= 0) {
          throw new Error('--limit must be a positive integer');
        }

        return parsed;
      },
    )
    .option(
      '--min-free-bytes <bytes>',
      'Only include recommended volumes with at least this many reclaimable free bytes',
      (value: string) => {
        const parsed = Number.parseInt(value, 10);
        if (!Number.isInteger(parsed) || parsed <= 0) {
          throw new Error('--min-free-bytes must be a positive integer');
        }

        return parsed;
      },
    )
    .option(
      '--min-free-ratio <ratio>',
      'Only include recommended volumes with at least this reclaimable free-page ratio (0-1)',
      (value: string) => {
        const parsed = Number.parseFloat(value);
        if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
          throw new Error('--min-free-ratio must be a number between 0 and 1');
        }

        return parsed;
      },
    )
    .option(
      '--max-reclaimable-bytes <bytes>',
      'Only plan compactions while the cumulative reclaimable free-byte budget stays within this cap',
      (value: string) => {
        const parsed = Number.parseInt(value, 10);
        if (!Number.isInteger(parsed) || parsed <= 0) {
          throw new Error('--max-reclaimable-bytes must be a positive integer');
        }

        return parsed;
      },
    )
    .option(
      '--strict-plan',
      'Fail with a non-zero exit code when the batch still contains blocked, filtered, deferred, or failed volumes',
    )
    .option('--json', 'Output the batch result as JSON')
    .option('--output <path>', 'Write the structured JSON result to this file')
    .action(
      async (
        options: {
          dryRun?: boolean;
          includeUnsafe?: boolean;
          json?: boolean;
          limit?: number;
          minFreeBytes?: number;
          minFreeRatio?: number;
          maxReclaimableBytes?: number;
          output?: string;
          strictPlan?: boolean;
        },
      ) => {
        await withRuntime(async (runtime) => {
          const correlationId = runtime.correlationId;
          const result = await runtime.volumeService.compactRecommendedVolumes({
            dryRun: options.dryRun,
            includeUnsafe: options.includeUnsafe,
            limit: options.limit,
            minFreeBytes: options.minFreeBytes,
            minFreeRatio: options.minFreeRatio,
            maxReclaimableBytes: options.maxReclaimableBytes,
          });
          const artifactPath = options.output
            ? await writeCliJsonArtifact(
                'compact-recommended',
                sanitizeArtifactPayload(result, runtime.config.redactSensitiveDetails),
                options.output,
                {
                  correlationId,
                },
              )
            : null;

          console.log(
            renderCliResult(result, formatVolumeCompactionBatchResult, {
              artifactPath,
              correlationId,
              json: options.json,
            }),
          );

          const policyStatus = evaluateVolumeCompactionBatchPolicy(result, {
            strictPlan: options.strictPlan,
          });
          if (options.strictPlan) {
            console.error(formatVolumeCompactionBatchPolicyStatus(policyStatus));
          }

          if (!options.dryRun && result.failedVolumes > 0) {
            process.exitCode = 1;
          }
          if (!policyStatus.satisfied) {
            process.exitCode = 1;
          }
        });
      },
    );

  program
    .command('repair-safe')
    .description(
      'Repair all managed volumes that only expose safe doctor drifts and are ready for automated batch repair.',
    )
    .option('--dry-run', 'Report which volumes would be repaired without mutating them')
    .option(
      '--verify-blobs',
      'Hash and verify referenced blob payloads while planning and executing batch repairs',
    )
    .option(
      '--limit <count>',
      'Only process the first N repairable volumes in the current batch plan',
      (value: string) => {
        const parsed = Number.parseInt(value, 10);
        if (!Number.isInteger(parsed) || parsed <= 0) {
          throw new Error('--limit must be a positive integer');
        }

        return parsed;
      },
    )
    .option(
      '--strict-plan',
      'Fail with a non-zero exit code when the batch still contains blocked, deferred, or failed volumes',
    )
    .option('--json', 'Output the batch result as JSON')
    .option('--output <path>', 'Write the structured JSON result to this file')
    .action(
      async (
        options: {
          dryRun?: boolean;
          verifyBlobs?: boolean;
          strictPlan?: boolean;
          json?: boolean;
          output?: string;
          limit?: number;
        },
      ) => {
        await withRuntime(async (runtime) => {
          const correlationId = runtime.correlationId;
          const result = await runtime.volumeService.repairSafeVolumes({
            dryRun: options.dryRun,
            verifyBlobPayloads: options.verifyBlobs,
            limit: options.limit,
          });
          const artifactPath = options.output
            ? await writeCliJsonArtifact(
                'repair-safe',
                sanitizeArtifactPayload(result, runtime.config.redactSensitiveDetails),
                options.output,
                {
                  correlationId,
                },
              )
            : null;

          console.log(
            renderCliResult(result, formatStorageRepairBatchResult, {
              artifactPath,
              correlationId,
              json: options.json,
            }),
          );

          const policyStatus = evaluateStorageRepairBatchPolicy(result, {
            strictPlan: options.strictPlan,
          });
          if (options.strictPlan) {
            console.error(formatStorageRepairBatchPolicyStatus(policyStatus));
          }

          if (!options.dryRun && result.failedVolumes > 0) {
            process.exitCode = 1;
          }
          if (!policyStatus.satisfied) {
            process.exitCode = 1;
          }
        });
      },
    );

  program
    .command('doctor')
    .description('Run storage diagnostics across all volumes or a specific volume.')
    .argument('[volumeId]', 'Diagnose a specific volume by id')
    .option('--json', 'Output the report as JSON')
    .option('--output <path>', 'Write the structured JSON report to this file')
    .option(
      '--verify-blobs',
      'Hash and verify referenced blob payloads during the doctor run',
    )
    .option('--fix', 'Apply safe automatic repairs for supported issues')
    .action(
      async (
        volumeId: string | undefined,
        options: {
          json?: boolean;
          output?: string;
          verifyBlobs?: boolean;
          fix?: boolean;
        },
      ) => {
        await withRuntime(async (runtime) => {
          const correlationId = runtime.correlationId;
          if (options.fix) {
            const report = await runtime.volumeService.runRepair(volumeId, {
              verifyBlobPayloads: options.verifyBlobs,
            });
            const artifactPath = options.output
              ? await writeCliJsonArtifact(
                  'doctor --fix',
                  sanitizeArtifactPayload(report, runtime.config.redactSensitiveDetails),
                  options.output,
                  {
                    correlationId,
                  },
                )
              : null;

            console.log(
              renderCliResult(report, formatRepairReport, {
                artifactPath,
                correlationId,
                json: options.json,
              }),
            );

            if (!report.healthy) {
              process.exitCode = 1;
            }
          } else {
            const report = await runtime.volumeService.runDoctor(volumeId, {
              verifyBlobPayloads: options.verifyBlobs,
            });
            const artifactPath = options.output
              ? await writeCliJsonArtifact(
                  'doctor',
                  sanitizeArtifactPayload(report, runtime.config.redactSensitiveDetails),
                  options.output,
                  {
                    correlationId,
                  },
                )
              : null;

            console.log(
              renderCliResult(report, formatDoctorReport, {
                artifactPath,
                correlationId,
                json: options.json,
              }),
            );

            if (!report.healthy) {
              process.exitCode = 1;
            }
          }
        });
      },
    );

  program
    .command('support-bundle')
    .description(
      'Create a diagnostic bundle with doctor output, runtime metadata, and optional backup inspection.',
    )
    .argument('<destinationPath>', 'Write the support bundle directory to this path')
    .argument('[volumeId]', 'Limit the doctor report to a specific volume id')
    .option('--backup-path <path>', 'Inspect this backup and include the report')
    .option('--no-logs', 'Skip app and audit log snapshots inside the support bundle')
    .option(
      '--verify-blobs',
      'Hash and verify referenced blob payloads while generating the embedded doctor report',
    )
    .option('--json', 'Output the bundle summary as JSON')
    .option('--output <path>', 'Write the structured JSON result to this file')
    .option('--force', 'Overwrite an existing destination directory')
    .action(
      async (
        destinationPath: string,
        volumeId: string | undefined,
        options: {
          backupPath?: string;
          noLogs?: boolean;
          verifyBlobs?: boolean;
          json?: boolean;
          output?: string;
          force?: boolean;
        },
      ) => {
        await withRuntime(async (runtime) => {
          const correlationId = runtime.correlationId;
          const result = await createSupportBundle(runtime, {
            destinationPath,
            volumeId,
            backupPath: options.backupPath,
            includeLogs: !options.noLogs,
            verifyBlobPayloads: options.verifyBlobs,
            overwrite: options.force,
          });
          const artifactPath = options.output
            ? await writeCliJsonArtifact(
                'support-bundle',
                sanitizeArtifactPayload(result, runtime.config.redactSensitiveDetails),
                options.output,
                {
                  correlationId,
                },
              )
            : null;

          console.log(
            renderCliResult(result, formatSupportBundleResult, {
              artifactPath,
              correlationId,
              json: options.json,
            }),
          );
        });
      },
    );

  program
    .command('inspect-support-bundle')
    .description(
      'Inspect a support bundle and verify its manifest, inventory, and checksums.',
    )
    .argument('<bundlePath>', 'Inspect a support bundle directory')
    .option(
      '--require-sharing <policy>',
      'Require the bundle to be suitable for this sharing audience (internal-only or external-shareable)',
      parseSupportBundleSharingRecommendation,
    )
    .option(
      '--require-integrity-depth <depth>',
      'Require the bundle to have been generated with at least this doctor integrity depth (metadata or deep)',
      parseSupportBundleIntegrityDepth,
    )
    .option('--json', 'Output the inspection result as JSON')
    .option('--output <path>', 'Write the structured JSON result to this file')
    .action(
      async (
        bundlePath: string,
        options: {
          json?: boolean;
          output?: string;
          requireSharing?: 'external-shareable' | 'internal-only';
          requireIntegrityDepth?: 'metadata' | 'deep';
        },
      ) => {
        const correlationId = createCorrelationId();
        const redactSensitiveDetails = loadAppConfig(getRuntimeOverrides()).redactSensitiveDetails;
        const result = await inspectSupportBundle(bundlePath);
        const sharingRequirement = options.requireSharing
          ? evaluateSupportBundleSharingRequirement(result, options.requireSharing)
          : null;
        const integrityRequirement = options.requireIntegrityDepth
          ? evaluateSupportBundleIntegrityRequirement(
              result,
              options.requireIntegrityDepth,
            )
          : null;
        const artifactPath = options.output
          ? await writeCliJsonArtifact(
              'inspect-support-bundle',
              sanitizeArtifactPayload(result, redactSensitiveDetails),
              options.output,
              {
                correlationId,
              },
            )
          : null;

        console.log(
          renderCliResult(
            result,
            (inspectionResult) => {
              const renderedInspection = formatSupportBundleInspectionResult(inspectionResult);
              const requirementStatuses = [
                sharingRequirement
                  ? formatSupportBundleSharingRequirementStatus(sharingRequirement)
                  : null,
                integrityRequirement
                  ? formatSupportBundleIntegrityRequirementStatus(integrityRequirement)
                  : null,
              ].filter((entry): entry is string => entry !== null);

              return requirementStatuses.length > 0
                ? `${renderedInspection}\n${requirementStatuses.join('\n')}`
                : renderedInspection;
            },
            {
              artifactPath,
              correlationId,
              json: options.json,
            },
          ),
        );

        if (
          !result.healthy ||
          (sharingRequirement && !sharingRequirement.satisfied) ||
          (integrityRequirement && !integrityRequirement.satisfied)
        ) {
          process.exitCode = 1;
        }
      },
    );

  await program.parseAsync(process.argv);
};

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Unknown startup failure.';
  console.error(message);
  process.exitCode = 1;
});
