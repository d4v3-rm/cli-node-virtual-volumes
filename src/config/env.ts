import path from 'node:path';

import { config as loadDotEnv } from 'dotenv';
import { z } from 'zod';

const DEFAULT_QUOTA_BYTES = 10 * 1024 ** 4;
const DEFAULT_PREVIEW_BYTES = 4 * 1024;

const emptyStringToUndefined = (value: unknown): unknown => {
  if (typeof value !== 'string') {
    return value;
  }

  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
};

const booleanStringToValue = (value: unknown): unknown => {
  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value !== 'string') {
    return value;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized.length === 0) {
    return undefined;
  }

  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true;
  }

  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }

  return value;
};

const pathListStringToValue = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value;
  }

  if (typeof value !== 'string') {
    return value;
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return [];
  }

  return trimmed
    .split(path.delimiter)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
};

const envSchema = z.object({
  VOLUME_DATA_DIR: z.preprocess(emptyStringToUndefined, z.string().optional()),
  VOLUME_AUDIT_LOG_DIR: z.preprocess(emptyStringToUndefined, z.string().optional()),
  VOLUME_AUDIT_LOG_LEVEL: z.preprocess(
    emptyStringToUndefined,
    z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  ),
  VOLUME_HOST_ALLOW_PATHS: z.preprocess(
    pathListStringToValue,
    z.array(z.string()).default([]),
  ),
  VOLUME_HOST_DENY_PATHS: z.preprocess(
    pathListStringToValue,
    z.array(z.string()).default([]),
  ),
  VOLUME_LOG_DIR: z.preprocess(emptyStringToUndefined, z.string().optional()),
  VOLUME_REDACT_SENSITIVE_DETAILS: z.preprocess(
    booleanStringToValue,
    z.boolean().default(false),
  ),
  VOLUME_LOG_RETENTION_DAYS: z.preprocess(
    emptyStringToUndefined,
    z.coerce.number().int().positive().optional(),
  ),
  VOLUME_DEFAULT_QUOTA_BYTES: z.preprocess(
    emptyStringToUndefined,
    z.coerce.number().int().positive().default(DEFAULT_QUOTA_BYTES),
  ),
  VOLUME_LOG_LEVEL: z.preprocess(
    emptyStringToUndefined,
    z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  ),
  VOLUME_LOG_TO_STDOUT: z.preprocess(
    booleanStringToValue,
    z.boolean().default(false),
  ),
  VOLUME_PREVIEW_BYTES: z.preprocess(
    emptyStringToUndefined,
    z.coerce.number().int().positive().default(DEFAULT_PREVIEW_BYTES),
  ),
});

export interface RuntimeOverrides {
  auditLogDir?: string;
  auditLogLevel?: AppConfig['auditLogLevel'];
  correlationId?: string;
  dataDir?: string;
  hostAllowPaths?: string[];
  hostDenyPaths?: string[];
  logDir?: string;
  logLevel?: AppConfig['logLevel'];
  logRetentionDays?: number | null;
  redactSensitiveDetails?: boolean;
  logToStdout?: boolean;
}

export interface AppConfig {
  auditLogDir: string;
  auditLogLevel: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent';
  dataDir: string;
  hostAllowPaths: string[];
  hostDenyPaths: string[];
  logDir: string;
  defaultQuotaBytes: number;
  logLevel: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent';
  logRetentionDays: number | null;
  redactSensitiveDetails: boolean;
  logToStdout: boolean;
  previewBytes: number;
}

const getDefaultDataDir = (): string => {
  return process.cwd();
};

export const loadAppConfig = (
  overrides: RuntimeOverrides = {},
  inputEnvironment: NodeJS.ProcessEnv = process.env,
): AppConfig => {
  loadDotEnv({ quiet: true });

  const parsed = envSchema.parse({
    ...inputEnvironment,
    VOLUME_AUDIT_LOG_DIR: overrides.auditLogDir ?? inputEnvironment.VOLUME_AUDIT_LOG_DIR,
    VOLUME_AUDIT_LOG_LEVEL:
      overrides.auditLogLevel ?? inputEnvironment.VOLUME_AUDIT_LOG_LEVEL,
    VOLUME_DATA_DIR: overrides.dataDir ?? inputEnvironment.VOLUME_DATA_DIR,
    VOLUME_HOST_ALLOW_PATHS:
      overrides.hostAllowPaths ?? inputEnvironment.VOLUME_HOST_ALLOW_PATHS,
    VOLUME_HOST_DENY_PATHS:
      overrides.hostDenyPaths ?? inputEnvironment.VOLUME_HOST_DENY_PATHS,
    VOLUME_LOG_DIR: overrides.logDir ?? inputEnvironment.VOLUME_LOG_DIR,
    VOLUME_LOG_LEVEL: overrides.logLevel ?? inputEnvironment.VOLUME_LOG_LEVEL,
    VOLUME_LOG_RETENTION_DAYS:
      overrides.logRetentionDays ?? inputEnvironment.VOLUME_LOG_RETENTION_DAYS,
    VOLUME_REDACT_SENSITIVE_DETAILS:
      overrides.redactSensitiveDetails ?? inputEnvironment.VOLUME_REDACT_SENSITIVE_DETAILS,
    VOLUME_LOG_TO_STDOUT:
      overrides.logToStdout ?? inputEnvironment.VOLUME_LOG_TO_STDOUT,
  });

  const dataDir = path.resolve(parsed.VOLUME_DATA_DIR ?? getDefaultDataDir());
  const hostAllowPaths = Array.from(
    new Set(parsed.VOLUME_HOST_ALLOW_PATHS.map((entry) => path.resolve(entry))),
  );
  const hostDenyPaths = Array.from(
    new Set(parsed.VOLUME_HOST_DENY_PATHS.map((entry) => path.resolve(entry))),
  );
  const logDir = path.resolve(parsed.VOLUME_LOG_DIR ?? path.join(dataDir, 'logs'));
  const auditLogDir = path.resolve(parsed.VOLUME_AUDIT_LOG_DIR ?? path.join(logDir, 'audit'));

  return {
    auditLogDir,
    auditLogLevel: parsed.VOLUME_AUDIT_LOG_LEVEL,
    dataDir,
    hostAllowPaths,
    hostDenyPaths,
    logDir,
    defaultQuotaBytes: parsed.VOLUME_DEFAULT_QUOTA_BYTES,
    logLevel: parsed.VOLUME_LOG_LEVEL,
    logRetentionDays: parsed.VOLUME_LOG_RETENTION_DAYS ?? null,
    redactSensitiveDetails: parsed.VOLUME_REDACT_SENSITIVE_DETAILS,
    logToStdout: parsed.VOLUME_LOG_TO_STDOUT,
    previewBytes: parsed.VOLUME_PREVIEW_BYTES,
  };
};
