import fs from 'node:fs/promises';
import path from 'node:path';

import pino, { type Logger, type StreamEntry } from 'pino';

import type { AppConfig } from '../config/env.js';

interface LoggerContext {
  correlationId?: string;
}

export interface LogPruneResult {
  appDeletedFiles: string[];
  auditDeletedFiles: string[];
}

const APP_LOG_FILE_PATTERN = /^cli-node-virtual-volumes-(\d{4}-\d{2}-\d{2})\.log$/u;
const AUDIT_LOG_FILE_PATTERN =
  /^cli-node-virtual-volumes-audit-(\d{4}-\d{2}-\d{2})\.log$/u;

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

const getRetentionCutoffStamp = (retentionDays: number, now: Date): string => {
  const cutoff = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  cutoff.setUTCDate(cutoff.getUTCDate() - (retentionDays - 1));
  return cutoff.toISOString().slice(0, 10);
};

const pruneLogDirectory = async (
  directoryPath: string,
  filePattern: RegExp,
  cutoffStamp: string,
): Promise<string[]> => {
  const entries = await fs.readdir(directoryPath, { withFileTypes: true }).catch(() => null);

  if (!entries) {
    return [];
  }

  const deletedFiles: string[] = [];

  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }

    const match = entry.name.match(filePattern);
    if (!match || typeof match[1] !== 'string' || match[1] >= cutoffStamp) {
      continue;
    }

    const absolutePath = path.join(directoryPath, entry.name);
    await fs.rm(absolutePath, { force: true });
    deletedFiles.push(absolutePath);
  }

  return deletedFiles;
};

export const pruneRetainedLogFiles = async (
  config: AppConfig,
  now = new Date(),
): Promise<LogPruneResult> => {
  if (!config.logRetentionDays) {
    return {
      appDeletedFiles: [],
      auditDeletedFiles: [],
    };
  }

  const cutoffStamp = getRetentionCutoffStamp(config.logRetentionDays, now);

  return {
    appDeletedFiles: await pruneLogDirectory(
      config.logDir,
      APP_LOG_FILE_PATTERN,
      cutoffStamp,
    ),
    auditDeletedFiles: await pruneLogDirectory(
      config.auditLogDir,
      AUDIT_LOG_FILE_PATTERN,
      cutoffStamp,
    ),
  };
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
