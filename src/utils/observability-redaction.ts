import { createHash } from 'node:crypto';
import path from 'node:path';

const REDACTED_PREFIX = '<redacted:';

const SENSITIVE_PATH_KEYS = new Set([
  'allowedRoots',
  'auditLogDir',
  'backupInspectionReportPath',
  'backupManifestCopyPath',
  'backupPath',
  'bundlePath',
  'checksumsPath',
  'currentHostPath',
  'cwd',
  'dataDir',
  'databasePath',
  'deniedRoot',
  'destinationHostDirectory',
  'destinationHostPath',
  'doctorReportPath',
  'hostAllowPaths',
  'hostDenyPaths',
  'hostPath',
  'hostPathsPreview',
  'legacyDirectoryPath',
  'logDir',
  'manifestPath',
  'path',
  'rollbackSnapshotPath',
  'targetDatabasePath',
  'temporaryDatabasePath',
]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const getRedactedPathLabel = (targetPath: string): string => {
  const withoutTrailingSeparators = targetPath.replace(/[\\/]+$/u, '');
  const normalizedPath = withoutTrailingSeparators.replace(/\\/gu, '/');
  const baseName = path.posix.basename(normalizedPath);

  if (baseName.length > 0 && baseName !== '.' && baseName !== path.sep) {
    return baseName;
  }

  if (/^[a-z]:/iu.test(targetPath)) {
    return `${targetPath[0]?.toUpperCase() ?? 'drive'}-drive`;
  }

  if (targetPath.startsWith('\\\\')) {
    return 'network-path';
  }

  return 'path';
};

export const redactFilesystemPath = (targetPath: string): string => {
  if (targetPath.startsWith(REDACTED_PREFIX) || targetPath.length === 0) {
    return targetPath;
  }

  const digest = createHash('sha256').update(targetPath).digest('hex').slice(0, 8);
  return `<redacted:${getRedactedPathLabel(targetPath)}#${digest}>`;
};

export const redactOpaqueValue = (
  targetValue: string,
  label = 'value',
): string => {
  if (targetValue.startsWith(REDACTED_PREFIX) || targetValue.length === 0) {
    return targetValue;
  }

  const digest = createHash('sha256').update(targetValue).digest('hex').slice(0, 8);
  const normalizedLabel = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '');

  return `<redacted:${normalizedLabel.length > 0 ? normalizedLabel : 'value'}#${digest}>`;
};

const sanitizeInternal = (
  value: unknown,
  forcePathRedaction: boolean,
): unknown => {
  if (typeof value === 'string') {
    return forcePathRedaction ? redactFilesystemPath(value) : value;
  }

  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeInternal(entry, forcePathRedaction));
  }

  if (!isRecord(value)) {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, entryValue]) => [
      key,
      sanitizeInternal(entryValue, forcePathRedaction || SENSITIVE_PATH_KEYS.has(key)),
    ]),
  );
};

const collectSensitivePathMappings = (
  value: unknown,
  mappings: Map<string, string>,
  forcePathRedaction: boolean,
): void => {
  if (typeof value === 'string') {
    if (forcePathRedaction) {
      mappings.set(value, redactFilesystemPath(value));
    }
    return;
  }

  if (Array.isArray(value)) {
    for (const entry of value) {
      collectSensitivePathMappings(entry, mappings, forcePathRedaction);
    }
    return;
  }

  if (!isRecord(value)) {
    return;
  }

  for (const [key, entryValue] of Object.entries(value)) {
    collectSensitivePathMappings(
      entryValue,
      mappings,
      forcePathRedaction || SENSITIVE_PATH_KEYS.has(key),
    );
  }
};

export const sanitizeObservabilityValue = <T>(
  value: T,
  redactSensitiveDetails: boolean,
): T => {
  if (!redactSensitiveDetails) {
    return value;
  }

  return sanitizeInternal(value, false) as T;
};

export const sanitizeObservabilityMessage = (
  message: string,
  context: unknown,
  redactSensitiveDetails: boolean,
): string => {
  if (!redactSensitiveDetails || message.length === 0) {
    return message;
  }

  const mappings = new Map<string, string>();
  collectSensitivePathMappings(context, mappings, false);

  return [...mappings.entries()]
    .sort(([left], [right]) => right.length - left.length)
    .reduce(
      (currentMessage, [originalValue, redactedValue]) =>
        currentMessage.split(originalValue).join(redactedValue),
      message,
    );
};
