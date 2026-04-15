import path from 'node:path';

import pino, { type Logger, type StreamEntry } from 'pino';

import type { AppConfig } from '../config/env.js';

interface LoggerContext {
  correlationId?: string;
}

const createFileDestination = (destinationPath: string, sync: boolean) =>
  pino.destination({
    dest: destinationPath,
    mkdir: true,
    sync,
  });

const createLoggerBase = (
  baseContext: LoggerContext,
  extraContext: Record<string, unknown> = {},
): Record<string, unknown> => ({
  pid: process.pid,
  ...extraContext,
  ...(baseContext.correlationId ? { correlationId: baseContext.correlationId } : {}),
});

export const resolveAppLogFilePath = (
  config: AppConfig,
  date = new Date(),
): string => {
  const dayStamp = date.toISOString().slice(0, 10);
  return path.join(config.logDir, `cli-node-virtual-volumes-${dayStamp}.log`);
};

export const resolveAuditLogFilePath = (
  config: AppConfig,
  date = new Date(),
): string => {
  const dayStamp = date.toISOString().slice(0, 10);
  return path.join(config.auditLogDir, `cli-node-virtual-volumes-audit-${dayStamp}.log`);
};

export const createAppLogger = (
  config: AppConfig,
  baseContext: LoggerContext = {},
): Logger => {
  const streams: StreamEntry[] = [
    {
      stream: createFileDestination(resolveAppLogFilePath(config), false),
    },
  ];

  if (config.logToStdout) {
    streams.push({ stream: process.stderr });
  }

  return pino(
    {
      name: 'cli-node-virtual-volumes',
      level: config.logLevel,
      base: createLoggerBase(baseContext),
      timestamp: pino.stdTimeFunctions.isoTime,
    },
    pino.multistream(streams),
  );
};

export const createAuditLogger = (
  config: AppConfig,
  baseContext: LoggerContext = {},
): Logger =>
  pino(
    {
      name: 'cli-node-virtual-volumes-audit',
      level: config.auditLogLevel,
      base: createLoggerBase(baseContext, { channel: 'audit' }),
      timestamp: pino.stdTimeFunctions.isoTime,
    },
    createFileDestination(resolveAuditLogFilePath(config), true),
  );
