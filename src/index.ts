import { Command } from 'commander';

import { createRuntime } from './bootstrap/create-runtime.js';
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

  await program.parseAsync(process.argv);

  const options = program.opts<{
    dataDir?: string;
    logDir?: string;
    logLevel?: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent';
    stdoutLogs?: boolean;
  }>();
  const logLevelSource = program.getOptionValueSource('logLevel');
  const stdoutLogsSource = program.getOptionValueSource('stdoutLogs');

  const runtime = await createRuntime({
    dataDir: options.dataDir,
    logDir: options.logDir,
    logLevel: logLevelSource === 'cli' ? options.logLevel : undefined,
    logToStdout: stdoutLogsSource === 'cli' ? options.stdoutLogs : undefined,
  });

  const app = new TerminalApp(runtime);
  await app.start();
};

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Unknown startup failure.';
  console.error(message);
  process.exitCode = 1;
});
