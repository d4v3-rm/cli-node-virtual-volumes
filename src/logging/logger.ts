import path from 'node:path';

import pino, { type Logger, type StreamEntry } from 'pino';

import type { AppConfig } from '../config/env.js';

const buildLogFilePath = (config: AppConfig, date = new Date()): string => {
  const dayStamp = date.toISOString().slice(0, 10);
  return path.join(config.logDir, `cli-node-virtual-volumes-${dayStamp}.log`);
};

export const createAppLogger = (config: AppConfig): Logger => {
  const streams: StreamEntry[] = [
    {
      stream: pino.destination({
        dest: buildLogFilePath(config),
        mkdir: true,
        sync: false,
      }),
    },
  ];

  if (config.logToStdout) {
    streams.push({ stream: process.stderr });
  }

  return pino(
    {
      name: 'cli-node-virtual-volumes',
      level: config.logLevel,
      base: {
        pid: process.pid,
      },
      timestamp: pino.stdTimeFunctions.isoTime,
    },
    pino.multistream(streams),
  );
};
