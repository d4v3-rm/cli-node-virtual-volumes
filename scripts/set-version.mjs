#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { CommitParser } from 'conventional-commits-parser';
import { readJson, writeJson } from 'fs-extra/esm';
import semver from 'semver';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packageJsonPath = path.join(rootDir, 'package.json');
const packageLockPath = path.join(rootDir, 'package-lock.json');
const readmePath = path.join(rootDir, 'README.md');
const changelogPath = path.join(rootDir, 'CHANGELOG.md');
const RELEASE_COMMIT_PATTERN = /^build\(release\): v(\d+\.\d+\.\d+)$/u;

const parser = new CommitParser();

const runGitCapture = (args) =>
  execFileSync('git', args, {
    cwd: rootDir,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  }).trim();

const runGit = (args) =>
  execFileSync('git', args, {
    cwd: rootDir,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  }).trim();

const hasStagedChanges = () => {
  try {
    runGit(['diff', '--cached', '--quiet', '--exit-code']);
    return false;
  } catch (error) {
    return Boolean(error && typeof error === 'object' && 'status' in error && error.status === 1);
  }
};

const getLatestReleaseCommit = () => {
  try {
    const output = runGitCapture([
      'log',
      '--grep',
      '^build(release): v[0-9]*\\.[0-9]*\\.[0-9]*$',
      '--format=%H|%s',
      '-n',
      '1',
      'HEAD'
    ]);

    if (!output) {
      return null;
    }

    const [sha, subject] = output.split('|');
    const version = RELEASE_COMMIT_PATTERN.exec(subject ?? '')?.[1] ?? null;

    if (!sha || !version) {
      return null;
    }

    return {
      ref: sha,
      version
    };
  } catch {
    return null;
  }
};

const getLatestMergedVersionTag = () => {
  try {
    const output = runGitCapture([
      'tag',
      '--merged',
      'HEAD',
      '--list',
      'v[0-9]*.[0-9]*.[0-9]*',
      '--sort=-v:refname'
    ]);
    return output.split(/\r?\n/).map((value) => value.trim()).find(Boolean) ?? null;
  } catch {
    return null;
  }
};

const getLatestVersionBaseRef = () => {
  const latestReleaseCommit = getLatestReleaseCommit();
  if (latestReleaseCommit) {
    return latestReleaseCommit.ref;
  }

  return getLatestMergedVersionTag();
};

const getCommitMessagesSince = (baseRef) => {
  try {
    const rangeArgs = baseRef
      ? ['log', '--no-merges', '--format=%H|%s%n%b%x00', `${baseRef}..HEAD`]
      : ['log', '--no-merges', '--format=%H|%s%n%b%x00'];
    const output = runGitCapture(rangeArgs);
    if (!output) {
      return [];
    }

    return output
      .split('\u0000')
      .map((chunk) => chunk.trim())
      .filter(Boolean)
      .map((entry) => {
        const [headerLine, ...bodyLines] = entry.split(/\r?\n/);
        const separatorIndex = headerLine.indexOf('|');
        const sha = headerLine.slice(0, separatorIndex);
        const subject = headerLine.slice(separatorIndex + 1);
        return {
          sha,
          raw: [subject, ...bodyLines].join('\n').trim()
        };
      });
  } catch {
    return [];
  }
};

const getReleaseType = (commitEntries) => {
  let nextType = null;

  for (const entry of commitEntries) {
    const parsed = parser.parse(entry.raw);

    if ((parsed.notes?.length ?? 0) > 0 || parsed.header?.includes('!:')) {
      return 'major';
    }

    if (parsed.type === 'feat') {
      nextType = nextType === 'major' ? nextType : 'minor';
      continue;
    }

    if (!nextType && parsed.type) {
      nextType = 'patch';
    }
  }

  return nextType;
};

const packageJson = await readJson(packageJsonPath);
const packageLock = await readJson(packageLockPath);
const currentVersion = packageJson.version;

if (!semver.valid(currentVersion)) {
  throw new Error(`Current package version is not valid semver: ${currentVersion}`);
}

const latestVersionBaseRef = getLatestVersionBaseRef();
const commitEntries = getCommitMessagesSince(latestVersionBaseRef);
const releaseType = getReleaseType(commitEntries);

if (!releaseType) {
  process.stdout.write(`[set:version] no conventional commits found, keeping ${currentVersion}\n`);
  process.exit(0);
}

const nextVersion = semver.inc(currentVersion, releaseType);

if (!nextVersion) {
  throw new Error(`Unable to compute next version from ${currentVersion} (${releaseType})`);
}

packageJson.version = nextVersion;
packageLock.version = nextVersion;
if (packageLock.packages?.['']) {
  packageLock.packages[''].version = nextVersion;
}

await writeJson(packageJsonPath, packageJson, { spaces: 2 });
await writeJson(packageLockPath, packageLock, { spaces: 2 });

const readme = await readFile(readmePath, 'utf8');
const updatedReadme = readme.replace(
  /(https:\/\/img\.shields\.io\/badge\/version-)([\d.]+)(-[0-9A-Za-z]+\.svg)/,
  `$1${nextVersion}$3`
);
await writeFile(readmePath, updatedReadme);

const today = new Date().toISOString().slice(0, 10);
const changelog = await readFile(changelogPath, 'utf8');
const bullets = commitEntries
  .map((entry) => {
    const parsed = parser.parse(entry.raw);
    const label = parsed.type ? `${parsed.type}: ` : '';
    return `- ${label}${parsed.subject ?? entry.raw.split('\n')[0]} (\`${entry.sha.slice(0, 7)}\`)`;
  })
  .join('\n');

const nextSection = `## ${nextVersion} - ${today}\n\n${bullets}\n\n`;
const updatedChangelog = changelog.startsWith('# Changelog')
  ? changelog.replace('# Changelog\n\n', `# Changelog\n\n${nextSection}`)
  : `# Changelog\n\n${nextSection}${changelog}`;

await writeFile(changelogPath, updatedChangelog);

process.stdout.write(`[set:version] ${currentVersion} -> ${nextVersion}\n`);

runGit(['add', '--', 'package.json', 'package-lock.json', 'README.md', 'CHANGELOG.md']);

if (!hasStagedChanges()) {
  process.stdout.write('[set:version] no managed file changed, skipping auto-commit\n');
  process.exit(0);
}

runGit(['commit', '-m', `build(release): v${nextVersion}`]);
process.stdout.write(`[set:version] committed build(release): v${nextVersion}\n`);
