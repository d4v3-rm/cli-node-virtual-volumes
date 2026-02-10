import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { pathExists } from '../utils/fs.js';

export type HostBrowserEntryKind = 'parent' | 'drive' | 'directory' | 'file';

export interface HostBrowserEntry {
  absolutePath: string | null;
  id: string;
  kind: HostBrowserEntryKind;
  name: string;
  navigable: boolean;
  selectable: boolean;
}

export interface HostBrowserSnapshot {
  currentPath: string | null;
  displayPath: string;
  entries: HostBrowserEntry[];
}

const WINDOWS_DRIVE_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

const sortHostEntries = (left: HostBrowserEntry, right: HostBrowserEntry): number => {
  const rank = (entry: HostBrowserEntry): number => {
    switch (entry.kind) {
      case 'parent':
        return 0;
      case 'drive':
        return 1;
      case 'directory':
        return 2;
      case 'file':
        return 3;
      default:
        return 4;
    }
  };

  const rankDifference = rank(left) - rank(right);
  if (rankDifference !== 0) {
    return rankDifference;
  }

  return left.name.localeCompare(right.name);
};

const getWindowsDriveEntries = async (): Promise<HostBrowserEntry[]> => {
  const drives = await Promise.all(
    WINDOWS_DRIVE_LETTERS.split('').map(async (letter) => {
      const absolutePath = `${letter}:\\`;
      if (!(await pathExists(absolutePath))) {
        return null;
      }

      return {
        absolutePath,
        id: `drive:${letter}`,
        kind: 'drive' as const,
        name: absolutePath,
        navigable: true,
        selectable: false,
      };
    }),
  );

  return drives.filter(
    (
      entry,
    ): entry is {
      absolutePath: string;
      id: string;
      kind: 'drive';
      name: string;
      navigable: boolean;
      selectable: boolean;
    } => entry !== null,
  );
};

export const getParentHostPath = (currentPath: string | null): string | null => {
  if (currentPath === null) {
    return null;
  }

  const resolvedPath = path.resolve(currentPath);
  const rootPath = path.parse(resolvedPath).root;

  if (process.platform === 'win32' && resolvedPath === rootPath) {
    return null;
  }

  if (resolvedPath === rootPath) {
    return rootPath;
  }

  return path.dirname(resolvedPath);
};

export const getDefaultHostPath = async (): Promise<string | null> => {
  const preferredRoots = [process.cwd(), os.homedir()];

  for (const preferredRoot of preferredRoots) {
    const resolvedRoot = path.resolve(preferredRoot);
    if (await pathExists(resolvedRoot)) {
      return resolvedRoot;
    }
  }

  return process.platform === 'win32' ? null : path.parse(process.cwd()).root;
};

export const listHostBrowserSnapshot = async (
  currentPath: string | null,
): Promise<HostBrowserSnapshot> => {
  if (process.platform === 'win32' && currentPath === null) {
    const entries = await getWindowsDriveEntries();
    return {
      currentPath: null,
      displayPath: 'This Computer',
      entries: entries.sort(sortHostEntries),
    };
  }

  const resolvedPath =
    currentPath === null
      ? path.parse(process.cwd()).root
      : path.resolve(currentPath);
  const directoryEntries = await fs.readdir(resolvedPath, {
    withFileTypes: true,
  });
  const entries: HostBrowserEntry[] = [];
  const parentPath = getParentHostPath(resolvedPath);

  if (parentPath !== resolvedPath) {
    entries.push({
      absolutePath: parentPath,
      id: `parent:${resolvedPath}`,
      kind: 'parent',
      name: '..',
      navigable: true,
      selectable: false,
    });
  }

  for (const directoryEntry of directoryEntries) {
    if (!directoryEntry.isDirectory() && !directoryEntry.isFile()) {
      continue;
    }

    const absolutePath = path.join(resolvedPath, directoryEntry.name);
    entries.push({
      absolutePath,
      id: absolutePath,
      kind: directoryEntry.isDirectory() ? 'directory' : 'file',
      name: directoryEntry.name,
      navigable: directoryEntry.isDirectory(),
      selectable: true,
    });
  }

  return {
    currentPath: resolvedPath,
    displayPath: resolvedPath,
    entries: entries.sort(sortHostEntries),
  };
};
