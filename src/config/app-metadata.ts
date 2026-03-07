import packageJson from '../../package.json';

interface SemanticVersion {
  major: number;
  minor: number;
  patch: number;
}

const SEMANTIC_VERSION_PATTERN = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/u;

export const APP_VERSION =
  typeof packageJson.version === 'string' ? packageJson.version : '0.0.0';

export const parseSemanticVersion = (
  value: string,
): SemanticVersion | null => {
  const match = SEMANTIC_VERSION_PATTERN.exec(value);
  if (!match) {
    return null;
  }

  const major = Number.parseInt(match[1] ?? '', 10);
  const minor = Number.parseInt(match[2] ?? '', 10);
  const patch = Number.parseInt(match[3] ?? '', 10);

  if ([major, minor, patch].some((part) => Number.isNaN(part))) {
    return null;
  }

  return {
    major,
    minor,
    patch,
  };
};

export const isCompatibleBackupRuntimeVersion = (
  backupCreatedWithVersion: string,
  runtimeVersion = APP_VERSION,
): boolean => {
  const backupVersion = parseSemanticVersion(backupCreatedWithVersion);
  const currentVersion = parseSemanticVersion(runtimeVersion);

  if (!backupVersion || !currentVersion) {
    return false;
  }

  return backupVersion.major <= currentVersion.major;
};
