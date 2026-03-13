#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packageJsonPath = path.join(rootDir, 'package.json');
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';

const assert = (condition, message) => {
  if (!condition) {
    throw new Error(message);
  }
};

const pathExists = async (targetPath) => {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
};

const readJson = async (filePath) =>
  JSON.parse(await fs.readFile(filePath, 'utf8'));

const quoteWindowsArg = (value) => {
  if (value.length === 0) {
    return '""';
  }

  if (!/[ \t"&()^<>|]/.test(value)) {
    return value;
  }

  return `"${value
    .replace(/(\\*)"/g, '$1$1\\"')
    .replace(/(\\+)$/g, '$1$1')}"`;
};

const runCommand = (command, args, options = {}) => {
  const isWindowsCmd = process.platform === 'win32' && command.endsWith('.cmd');
  const executable = isWindowsCmd ? 'cmd.exe' : command;
  const finalArgs = isWindowsCmd
    ? ['/d', '/s', '/c', [quoteWindowsArg(command), ...args.map(quoteWindowsArg)].join(' ')]
    : args;
  const result = spawnSync(executable, finalArgs, {
    cwd: rootDir,
    encoding: 'utf8',
    env: {
      ...process.env,
      NO_COLOR: '1',
      ...options.env,
    },
    ...options,
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(
      [
        `Command failed: ${command} ${args.join(' ')}`,
        result.stdout.trim(),
        result.stderr.trim(),
      ]
        .filter(Boolean)
        .join('\n'),
    );
  }

  return {
    stdout: result.stdout.trim(),
    stderr: result.stderr.trim(),
  };
};

const resolveTarballPath = async () => {
  const explicitPath = process.argv[2];
  if (explicitPath) {
    return path.resolve(explicitPath);
  }

  const entries = await fs.readdir(rootDir, { withFileTypes: true });
  const tarballs = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.tgz'))
    .map((entry) => path.join(rootDir, entry.name));

  if (tarballs.length > 0) {
    tarballs.sort();
    return tarballs[tarballs.length - 1];
  }

  const packRun = runCommand(npmCommand, ['pack', '--json']);
  const packResults = JSON.parse(packRun.stdout);
  const packedFile = packResults.at(0)?.filename;

  assert(typeof packedFile === 'string', 'npm pack did not produce a tarball.');
  return path.join(rootDir, packedFile);
};

let sandboxRoot = null;

try {
  const packageJson = await readJson(packageJsonPath);
  const tarballPath = await resolveTarballPath();

  assert(await pathExists(tarballPath), `Package tarball not found: ${tarballPath}`);

  sandboxRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), 'virtual-volumes-package-smoke-'),
  );

  const consumerRoot = path.join(sandboxRoot, 'consumer');
  const runtimeRoot = path.join(sandboxRoot, 'runtime');
  const dataDir = path.join(runtimeRoot, 'data');
  const logDir = path.join(runtimeRoot, 'logs');
  const doctorArtifactPath = path.join(runtimeRoot, 'doctor-report.json');
  const supportBundlePath = path.join(runtimeRoot, 'support-bundle');
  const supportBundleSummaryPath = path.join(
    runtimeRoot,
    'support-bundle-summary.json',
  );
  const supportBundleInspectionArtifactPath = path.join(
    runtimeRoot,
    'support-bundle-inspection.json',
  );

  await fs.mkdir(consumerRoot, { recursive: true });

  const consumerTarballPath = path.join(consumerRoot, path.basename(tarballPath));
  await fs.copyFile(tarballPath, consumerTarballPath);

  runCommand(npmCommand, ['init', '-y'], { cwd: consumerRoot });
  runCommand(
    npmCommand,
    ['install', '--no-package-lock', `./${path.basename(consumerTarballPath)}`],
    { cwd: consumerRoot },
  );

  const installedPackageRoot = path.join(consumerRoot, 'node_modules', packageJson.name);
  const installedPackageJson = await readJson(
    path.join(installedPackageRoot, 'package.json'),
  );
  const installedCliPath = path.join(
    installedPackageRoot,
    installedPackageJson.bin['virtual-volumes'],
  );

  assert(
    installedPackageJson.version === packageJson.version,
    'Installed tarball version does not match the repository version.',
  );
  assert(
    await pathExists(installedCliPath),
    'Installed package is missing the CLI entrypoint.',
  );

  const bootstrapRun = runCommand(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      [
        "import { createRuntime } from 'cli-node-virtual-volumes';",
        'const [dataDir, logDir] = process.argv.slice(-2);',
        "const runtime = await createRuntime({ dataDir, logDir, logLevel: 'silent' });",
        "const volume = await runtime.volumeService.createVolume({ name: 'Package Smoke' });",
        "await runtime.volumeService.writeTextFile(volume.id, '/package.txt', 'package smoke ok');",
        'process.stdout.write(volume.id);',
      ].join(' '),
      dataDir,
      logDir,
    ],
    { cwd: consumerRoot },
  );
  const volumeId = bootstrapRun.stdout.trim();

  assert(
    volumeId.startsWith('vol_'),
    'Installed package did not create a valid test volume.',
  );

  const doctorRun = runCommand(
    process.execPath,
    [
      installedCliPath,
      '--data-dir',
      dataDir,
      '--log-dir',
      logDir,
      '--log-level',
      'silent',
      'doctor',
      volumeId,
      '--json',
      '--output',
      doctorArtifactPath,
    ],
    { cwd: consumerRoot },
  );
  const doctorPayload = JSON.parse(doctorRun.stdout);
  const doctorArtifact = await readJson(doctorArtifactPath);

  assert(
    doctorPayload.healthy === true,
    'Installed CLI doctor command should report a healthy smoke volume.',
  );
  assert(
    doctorArtifact.command === 'doctor',
    'Installed CLI artifact should include the doctor command metadata.',
  );
  assert(
    doctorArtifact.cliVersion === packageJson.version,
    'Installed CLI artifact should use the packaged CLI version.',
  );
  assert(
    doctorArtifact.payload.volumes?.[0]?.volumeId === volumeId,
    'Installed CLI artifact should reference the smoke-test volume.',
  );

  const supportBundleRun = runCommand(
    process.execPath,
    [
      installedCliPath,
      '--data-dir',
      dataDir,
      '--log-dir',
      logDir,
      '--log-level',
      'silent',
      'support-bundle',
      supportBundlePath,
      volumeId,
      '--json',
      '--output',
      supportBundleSummaryPath,
    ],
    { cwd: consumerRoot },
  );
  const supportBundlePayload = JSON.parse(supportBundleRun.stdout);
  const supportBundleArtifact = await readJson(supportBundleSummaryPath);
  const supportBundleManifest = await readJson(
    path.join(supportBundlePath, 'manifest.json'),
  );
  const checksumManifest = await readJson(supportBundleManifest.checksumsPath);

  assert(
    supportBundlePayload.bundlePath === path.resolve(supportBundlePath),
    'Installed CLI support-bundle command should point to the generated bundle path.',
  );
  assert(
    supportBundleArtifact.command === 'support-bundle',
    'Installed CLI support-bundle artifact should include the command metadata.',
  );
  assert(
    supportBundleArtifact.payload.bundlePath === path.resolve(supportBundlePath),
    'Installed CLI support-bundle artifact should include the bundle path.',
  );
  assert(
    supportBundleManifest.doctorReportPath ===
      path.join(path.resolve(supportBundlePath), 'doctor-report.json'),
    'Installed CLI support bundle should include a doctor report path.',
  );
  assert(
    supportBundleManifest.checksumsPath ===
      path.join(path.resolve(supportBundlePath), 'checksums.json'),
    'Installed CLI support bundle should include a checksum manifest path.',
  );
  assert(
    supportBundleManifest.backupManifestCopyPath === null,
    'Installed CLI support bundle should not include a backup manifest copy without a backup path.',
  );
  assert(
    Array.isArray(checksumManifest.files) && checksumManifest.files.length >= 2,
    'Installed CLI support bundle should include checksum records.',
  );

  const supportBundleInspectRun = runCommand(
    process.execPath,
    [
      installedCliPath,
      'inspect-support-bundle',
      supportBundlePath,
      '--json',
      '--output',
      supportBundleInspectionArtifactPath,
    ],
    { cwd: consumerRoot },
  );
  const supportBundleInspection = JSON.parse(supportBundleInspectRun.stdout);
  const supportBundleInspectionArtifact = await readJson(
    supportBundleInspectionArtifactPath,
  );

  assert(
    supportBundleInspection.healthy === true,
    'Installed CLI inspect-support-bundle command should report a healthy bundle.',
  );
  assert(
    supportBundleInspectionArtifact.command === 'inspect-support-bundle',
    'Installed CLI support-bundle inspection artifact should include the command metadata.',
  );
  assert(
    supportBundleInspectionArtifact.payload.verifiedFiles >= 2,
    'Installed CLI support-bundle inspection artifact should report verified files.',
  );

  process.stdout.write(
    `[package-smoke] installed ${path.basename(tarballPath)} and verified package import + CLI doctor + support bundle + support bundle inspection flows\n`,
  );
} catch (error) {
  const message =
    error instanceof Error ? error.message : 'Unknown packaged smoke failure.';
  if (sandboxRoot) {
    process.stderr.write(`[package-smoke] sandbox preserved at ${sandboxRoot}\n`);
  }
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
} finally {
  if (sandboxRoot) {
    await fs.rm(sandboxRoot, { recursive: true, force: true }).catch(() => undefined);
  }
}
