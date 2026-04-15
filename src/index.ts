import { Command } from 'commander';

import { createRuntime } from './bootstrap/create-runtime.js';
import { formatDoctorReport, formatRepairReport } from './cli/doctor.js';
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
    .command('doctor')
    .description('Run storage diagnostics across all volumes or a specific volume.')
    .argument('[volumeId]', 'Diagnose a specific volume by id')
    .option('--json', 'Output the report as JSON')
    .option('--fix', 'Apply safe automatic repairs for supported issues')
    .action(
      async (
        volumeId: string | undefined,
        options: { json?: boolean; fix?: boolean },
      ) => {
      const runtime = await createRuntime(getRuntimeOverrides());
      if (options.fix) {
        const report = await runtime.volumeService.runRepair(volumeId);

        if (options.json) {
          console.log(JSON.stringify(report, null, 2));
        } else {
          console.log(formatRepairReport(report));
        }

        if (!report.healthy) {
          process.exitCode = 1;
        }
      } else {
        const report = await runtime.volumeService.runDoctor(volumeId);

        if (options.json) {
          console.log(JSON.stringify(report, null, 2));
        } else {
          console.log(formatDoctorReport(report));
        }

        if (!report.healthy) {
          process.exitCode = 1;
        }
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
