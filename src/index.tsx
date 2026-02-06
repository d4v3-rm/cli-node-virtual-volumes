import { Command } from 'commander';
import React from 'react';
import { render } from 'ink';

import { createRuntime } from './bootstrap/create-runtime.js';
import { App } from './ui/app.js';

const main = async (): Promise<void> => {
  const program = new Command()
    .name('virtual-volumes')
    .description('Node-only virtual volumes with a rich terminal UI.')
    .option('--data-dir <path>', 'Override the application data directory')
    .option('--log-dir <path>', 'Override the log output directory')
    .option(
      '--log-level <level>',
      'Override the log level',
      'info',
    )
    .option(
      '--stdout-logs',
      'Mirror logs to stdout as well as the filesystem log file',
      false,
    );

  await program.parseAsync(process.argv);

  const options = program.opts<{
    dataDir?: string;
    logDir?: string;
    logLevel?: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent';
    stdoutLogs?: boolean;
  }>();

  const runtime = await createRuntime({
    dataDir: options.dataDir,
    logDir: options.logDir,
    logLevel: options.logLevel,
    logToStdout: options.stdoutLogs,
  });

  const app = render(<App runtime={runtime} />);
  await app.waitUntilExit();
};

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Unknown startup failure.';
  console.error(message);
  process.exitCode = 1;
});
