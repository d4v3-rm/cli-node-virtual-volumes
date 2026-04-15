import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { APP_VERSION } from '../src/config/app-metadata.js';
import { renderCliResult, writeCliJsonArtifact } from '../src/cli/output.js';

const sandboxes: string[] = [];

afterEach(async () => {
  await Promise.all(
    sandboxes.splice(0, sandboxes.length).map((sandboxRoot) =>
      fs.rm(sandboxRoot, { recursive: true, force: true }),
    ),
  );
});

describe('cli output helpers', () => {
  it('writes structured JSON artifacts atomically and returns an absolute path', async () => {
    const sandboxRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'virtual-cli-output-'));
    sandboxes.push(sandboxRoot);
    const outputPath = path.join(sandboxRoot, 'reports', 'doctor.json');
    const payload = {
      healthy: true,
      checkedVolumes: 1,
    };

    const artifactPath = await writeCliJsonArtifact('doctor', payload, outputPath);
    const artifactContent = JSON.parse(await fs.readFile(artifactPath, 'utf8')) as {
      cliVersion: string;
      command: string;
      generatedAt: string;
      payload: {
        healthy: boolean;
        checkedVolumes: number;
      };
    };

    expect(artifactPath).toBe(path.resolve(outputPath));
    expect(artifactContent.command).toBe('doctor');
    expect(artifactContent.cliVersion).toBe(APP_VERSION);
    expect(Date.parse(artifactContent.generatedAt)).not.toBeNaN();
    expect(artifactContent.payload).toEqual(payload);
  });

  it('appends the artifact path to human-readable output', () => {
    const payload = {
      healthy: true,
    };
    const rendered = renderCliResult(
      payload,
      () => 'Storage doctor: HEALTHY',
      {
        artifactPath: 'C:\\reports\\doctor.json',
      },
    );

    expect(rendered).toBe(
      ['Storage doctor: HEALTHY', 'Artifact path: C:\\reports\\doctor.json'].join('\n'),
    );
  });

  it('keeps JSON stdout pure when an artifact path is also requested', () => {
    const payload = {
      healthy: true,
      checkedVolumes: 1,
    };
    const rendered = renderCliResult(
      payload,
      () => 'ignored',
      {
        artifactPath: 'C:\\reports\\doctor.json',
        json: true,
      },
    );

    expect(rendered).toBe(JSON.stringify(payload, null, 2));
  });
});
