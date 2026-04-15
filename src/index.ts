import { Command } from 'commander';

import { createRuntime } from './bootstrap/create-runtime.js';
import {
  formatBackupInspectionResult,
  formatBackupResult,
  formatRestoreResult,
} from './cli/backup.js';
import { formatDoctorReport, formatRepairReport } from './cli/doctor.js';
import { renderCliResult, writeCliJsonArtifact } from './cli/output.js';
import { formatSupportBundleResult } from './cli/support-bundle.js';
import { createSupportBundle } from './ops/support-bundle.js';
import { TerminalApp } from './ui/terminal-app.js';

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

  program.action(async () => {
    const runtime = await createRuntime(getRuntimeOverrides());
    const app = new TerminalApp(runtime);
    await app.start();
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
        const runtime = await createRuntime(getRuntimeOverrides());
        const result = await runtime.volumeService.backupVolume(volumeId, destinationPath, {
          overwrite: options.force,
        });
        const artifactPath = options.output
          ? await writeCliJsonArtifact('backup', result, options.output)
          : null;

        console.log(
          renderCliResult(result, formatBackupResult, {
            artifactPath,
            json: options.json,
          }),
        );
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
        const runtime = await createRuntime(getRuntimeOverrides());
        const result = await runtime.volumeService.restoreVolumeBackup(backupPath, {
          overwrite: options.force,
        });
        const artifactPath = options.output
          ? await writeCliJsonArtifact('restore', result, options.output)
          : null;

        console.log(
          renderCliResult(result, formatRestoreResult, {
            artifactPath,
            json: options.json,
          }),
        );
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
        const runtime = await createRuntime(getRuntimeOverrides());
        const result = await runtime.volumeService.inspectVolumeBackup(backupPath);
        const artifactPath = options.output
          ? await writeCliJsonArtifact('inspect-backup', result, options.output)
          : null;

        console.log(
          renderCliResult(result, formatBackupInspectionResult, {
            artifactPath,
            json: options.json,
          }),
        );
      },
    );

  program
    .command('doctor')
    .description('Run storage diagnostics across all volumes or a specific volume.')
    .argument('[volumeId]', 'Diagnose a specific volume by id')
    .option('--json', 'Output the report as JSON')
    .option('--output <path>', 'Write the structured JSON report to this file')
    .option('--fix', 'Apply safe automatic repairs for supported issues')
    .action(
      async (
        volumeId: string | undefined,
        options: { json?: boolean; output?: string; fix?: boolean },
      ) => {
      const runtime = await createRuntime(getRuntimeOverrides());
      if (options.fix) {
        const report = await runtime.volumeService.runRepair(volumeId);
        const artifactPath = options.output
          ? await writeCliJsonArtifact('doctor --fix', report, options.output)
          : null;

        console.log(
          renderCliResult(report, formatRepairReport, {
            artifactPath,
            json: options.json,
          }),
        );

        if (!report.healthy) {
          process.exitCode = 1;
        }
      } else {
        const report = await runtime.volumeService.runDoctor(volumeId);
        const artifactPath = options.output
          ? await writeCliJsonArtifact('doctor', report, options.output)
          : null;

        console.log(
          renderCliResult(report, formatDoctorReport, {
            artifactPath,
            json: options.json,
          }),
        );

        if (!report.healthy) {
          process.exitCode = 1;
        }
      }
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
    .option('--json', 'Output the bundle summary as JSON')
    .option('--force', 'Overwrite an existing destination directory')
    .action(
      async (
        destinationPath: string,
        volumeId: string | undefined,
        options: { backupPath?: string; json?: boolean; force?: boolean },
      ) => {
        const runtime = await createRuntime(getRuntimeOverrides());
        const result = await createSupportBundle(runtime, {
          destinationPath,
          volumeId,
          backupPath: options.backupPath,
          overwrite: options.force,
        });

        console.log(
          renderCliResult(result, formatSupportBundleResult, {
            json: options.json,
          }),
        );
      },
    );

  await program.parseAsync(process.argv);
};

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Unknown startup failure.';
  console.error(message);
  process.exitCode = 1;
});
