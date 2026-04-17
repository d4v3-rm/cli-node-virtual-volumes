#!/usr/bin/env node
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import fg from 'fast-glob';
import { pathExists } from 'fs-extra/esm';
import { rimraf } from 'rimraf';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const patterns = [
  '*.tgz',
  'dist/package',
  'dist/**/*.tgz',
  'dist/**/SHA256SUMS.txt'
];

const matches = await fg(patterns, {
  cwd: rootDir,
  dot: true,
  onlyFiles: false,
  unique: true,
  absolute: true
});

if (!matches.length) {
  process.exit(0);
}

for (const targetPath of matches) {
  if (!(await pathExists(targetPath))) {
    continue;
  }

  await rimraf(targetPath);
  process.stdout.write(`[clean:package-artifacts] removed ${path.relative(rootDir, targetPath)}\n`);
}
