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

const envSchema = z.object({
  VOLUME_DATA_DIR: z.preprocess(emptyStringToUndefined, z.string().optional()),
  VOLUME_LOG_DIR: z.preprocess(emptyStringToUndefined, z.string().optional()),
  VOLUME_DEFAULT_QUOTA_BYTES: z.preprocess(
    emptyStringToUndefined,
    z.coerce.number().int().positive().default(DEFAULT_QUOTA_BYTES),
  ),
  VOLUME_LOG_LEVEL: z.preprocess(
    emptyStringToUndefined,
    z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  ),
  VOLUME_LOG_TO_STDOUT: z.preprocess(
    emptyStringToUndefined,
    z.coerce.boolean().default(false),
  ),
  VOLUME_PREVIEW_BYTES: z.preprocess(
    emptyStringToUndefined,
    z.coerce.number().int().positive().default(DEFAULT_PREVIEW_BYTES),
  ),
});

export interface RuntimeOverrides {
  dataDir?: string;
  logDir?: string;
  logLevel?: AppConfig['logLevel'];
  logToStdout?: boolean;
}

export interface AppConfig {
  dataDir: string;
  logDir: string;
  defaultQuotaBytes: number;
  logLevel: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent';
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
  loadDotEnv();

  const parsed = envSchema.parse({
    ...inputEnvironment,
    VOLUME_DATA_DIR: overrides.dataDir ?? inputEnvironment.VOLUME_DATA_DIR,
    VOLUME_LOG_DIR: overrides.logDir ?? inputEnvironment.VOLUME_LOG_DIR,
    VOLUME_LOG_LEVEL: overrides.logLevel ?? inputEnvironment.VOLUME_LOG_LEVEL,
    VOLUME_LOG_TO_STDOUT:
      overrides.logToStdout ?? inputEnvironment.VOLUME_LOG_TO_STDOUT,
  });

  const dataDir = path.resolve(parsed.VOLUME_DATA_DIR ?? getDefaultDataDir());
  const logDir = path.resolve(parsed.VOLUME_LOG_DIR ?? path.join(dataDir, 'logs'));

  return {
    dataDir,
    logDir,
    defaultQuotaBytes: parsed.VOLUME_DEFAULT_QUOTA_BYTES,
    logLevel: parsed.VOLUME_LOG_LEVEL,
    logToStdout: parsed.VOLUME_LOG_TO_STDOUT,
    previewBytes: parsed.VOLUME_PREVIEW_BYTES,
  };
};
