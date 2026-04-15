import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { AppConfig } from '../src/config/env.js';
import { pruneRetainedLogFiles } from '../src/logging/logger.js';

const sandboxes: string[] = [];

const createConfig = (rootPath: string, logRetentionDays: number | null): AppConfig => ({
  auditLogDir: path.join(rootPath, 'logs', 'audit'),
  auditLogLevel: 'info',
  dataDir: path.join(rootPath, 'data'),
  hostAllowPaths: [],
  hostDenyPaths: [],
  logDir: path.join(rootPath, 'logs'),
  defaultQuotaBytes: 1024,
  logLevel: 'info',
  logRetentionDays,
  redactSensitiveDetails: false,
  logToStdout: false,
  previewBytes: 512,
});

afterEach(async () => {
  await Promise.all(
    sandboxes.splice(0, sandboxes.length).map((sandboxRoot) =>
      fs.rm(sandboxRoot, { recursive: true, force: true }),
    ),
  );
});

describe('log retention', () => {
  it('prunes app and audit logs older than the configured retention window', async () => {
    const sandboxRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'vv-log-retention-'));
    sandboxes.push(sandboxRoot);
    const config = createConfig(sandboxRoot, 2);
    const now = new Date('2026-04-15T10:00:00.000Z');

    await fs.mkdir(config.logDir, { recursive: true });
    await fs.mkdir(config.auditLogDir, { recursive: true });

    const currentAppLog = path.join(config.logDir, 'cli-node-virtual-volumes-2026-04-15.log');
    const retainedAppLog = path.join(config.logDir, 'cli-node-virtual-volumes-2026-04-14.log');
    const staleAppLog = path.join(config.logDir, 'cli-node-virtual-volumes-2026-04-13.log');
    const currentAuditLog = path.join(
      config.auditLogDir,
      'cli-node-virtual-volumes-audit-2026-04-15.log',
    );
    const staleAuditLog = path.join(
      config.auditLogDir,
      'cli-node-virtual-volumes-audit-2026-04-10.log',
    );
    const unrelatedFile = path.join(config.logDir, 'notes.txt');

    await Promise.all([
      fs.writeFile(currentAppLog, 'current app log', 'utf8'),
      fs.writeFile(retainedAppLog, 'retained app log', 'utf8'),
      fs.writeFile(staleAppLog, 'stale app log', 'utf8'),
      fs.writeFile(currentAuditLog, 'current audit log', 'utf8'),
      fs.writeFile(staleAuditLog, 'stale audit log', 'utf8'),
      fs.writeFile(unrelatedFile, 'keep me', 'utf8'),
    ]);

    const result = await pruneRetainedLogFiles(config, now);

    expect(result.appDeletedFiles).toEqual([staleAppLog]);
    expect(result.auditDeletedFiles).toEqual([staleAuditLog]);
    await expect(fs.access(currentAppLog)).resolves.toBeUndefined();
    await expect(fs.access(retainedAppLog)).resolves.toBeUndefined();
    await expect(fs.access(currentAuditLog)).resolves.toBeUndefined();
    await expect(fs.access(unrelatedFile)).resolves.toBeUndefined();
    await expect(fs.access(staleAppLog)).rejects.toThrow();
    await expect(fs.access(staleAuditLog)).rejects.toThrow();
  });

  it('does not delete log files when retention is not configured', async () => {
    const sandboxRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'vv-log-retention-'));
    sandboxes.push(sandboxRoot);
    const config = createConfig(sandboxRoot, null);
    const appLog = path.join(config.logDir, 'cli-node-virtual-volumes-2026-04-01.log');
    const auditLog = path.join(
      config.auditLogDir,
      'cli-node-virtual-volumes-audit-2026-04-01.log',
    );

    await fs.mkdir(config.logDir, { recursive: true });
    await fs.mkdir(config.auditLogDir, { recursive: true });
    await Promise.all([
      fs.writeFile(appLog, 'app log', 'utf8'),
      fs.writeFile(auditLog, 'audit log', 'utf8'),
    ]);

    const result = await pruneRetainedLogFiles(config, new Date('2026-04-15T10:00:00.000Z'));

    expect(result.appDeletedFiles).toEqual([]);
    expect(result.auditDeletedFiles).toEqual([]);
    await expect(fs.access(appLog)).resolves.toBeUndefined();
    await expect(fs.access(auditLog)).resolves.toBeUndefined();
  });
});
