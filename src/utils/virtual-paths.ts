import path from 'node:path';

import { VolumeError } from '../domain/errors.js';

const virtualPath = path.posix;

export const normalizeVirtualPath = (input: string): string => {
  const candidate = input.trim().length === 0 ? '/' : input.trim();
  const normalized = virtualPath.normalize(
    candidate.startsWith('/') ? candidate : `/${candidate}`,
  );

  if (!normalized.startsWith('/')) {
    throw new VolumeError('INVALID_PATH', `Invalid virtual path: ${input}`);
  }

  return normalized === '.' ? '/' : normalized;
};

export const getPathSegments = (input: string): string[] =>
  normalizeVirtualPath(input).split('/').filter(Boolean);

export const getParentVirtualPath = (input: string): string => {
  const normalized = normalizeVirtualPath(input);
  if (normalized === '/') {
    return '/';
  }

  return virtualPath.dirname(normalized);
};

export const getBaseName = (input: string): string => {
  const normalized = normalizeVirtualPath(input);
  return normalized === '/' ? '/' : virtualPath.basename(normalized);
};

export const buildChildVirtualPath = (
  parentPath: string,
  childName: string,
): string => {
  const normalizedParent = normalizeVirtualPath(parentPath);
  return normalizeVirtualPath(
    normalizedParent === '/'
      ? `/${childName}`
      : `${normalizedParent}/${childName}`,
  );
};

export const assertValidEntryName = (input: string): string => {
  const candidate = input.trim();

  if (candidate.length === 0) {
    throw new VolumeError('INVALID_NAME', 'Entry name cannot be empty.');
  }

  if (candidate === '.' || candidate === '..') {
    throw new VolumeError('INVALID_NAME', 'Reserved entry names are not allowed.');
  }

  if (candidate.includes('/') || candidate.includes('\\')) {
    throw new VolumeError(
      'INVALID_NAME',
      'Entry names cannot contain path separators.',
    );
  }

  return candidate;
};
