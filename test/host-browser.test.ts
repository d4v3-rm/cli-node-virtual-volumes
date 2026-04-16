import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  getParentHostPath,
  listHostBrowserSnapshot,
} from '../src/ui/host-browser.js';

const sandboxes: string[] = [];

afterEach(async () => {
  await Promise.all(
    sandboxes.splice(0, sandboxes.length).map((sandboxRoot) =>
      fs.rm(sandboxRoot, { recursive: true, force: true }),
    ),
  );
});

describe('host browser', () => {
  it('lists directories before files and includes a parent entry when available', async () => {
    const sandboxRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'virtual-host-browser-'));
    sandboxes.push(sandboxRoot);

    await fs.mkdir(path.join(sandboxRoot, 'nested'), { recursive: true });
    await fs.writeFile(path.join(sandboxRoot, 'alpha.txt'), 'alpha');

    const snapshot = await listHostBrowserSnapshot(sandboxRoot);

    expect(snapshot.currentPath).toBe(path.resolve(sandboxRoot));
    expect(snapshot.entries[0]).toMatchObject({
      kind: 'parent',
      name: '..',
      navigable: true,
      selectable: false,
    });
    expect(snapshot.entries.slice(1).map((entry) => `${entry.kind}:${entry.name}`)).toEqual([
      'directory:nested',
      'file:alpha.txt',
    ]);
  });

  it('returns the parent path until the filesystem root', async () => {
    const sandboxRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'virtual-host-parent-'));
    sandboxes.push(sandboxRoot);

    const resolvedRoot = path.resolve(sandboxRoot);
    const parentPath = getParentHostPath(resolvedRoot);
    const filesystemRoot = path.parse(resolvedRoot).root;

    expect(parentPath).toBe(path.dirname(resolvedRoot));
    expect(getParentHostPath(filesystemRoot)).toBe(
      process.platform === 'win32' ? null : filesystemRoot,
    );
  });
});
