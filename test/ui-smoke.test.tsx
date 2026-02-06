import pino from 'pino';
import React from 'react';

import { render } from 'ink-testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AppRuntime } from '../src/bootstrap/create-runtime.js';
import { App } from '../src/ui/app.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('App', () => {
  it('renders the dashboard with volumes loaded from the service', async () => {
    const now = new Date().toISOString();
    const listVolumes = vi.fn().mockResolvedValue([
      {
        id: 'vol_demo',
        name: 'Demo Volume',
        description: 'Smoke test volume',
        quotaBytes: 1024 * 1024,
        logicalUsedBytes: 512,
        entryCount: 1,
        createdAt: now,
        updatedAt: now,
      },
    ]);

    const runtime = {
      config: {
        dataDir: 'C:\\virtual-volumes\\data',
        logDir: 'C:\\virtual-volumes\\logs',
        defaultQuotaBytes: 1024 * 1024,
        logLevel: 'silent',
        logToStdout: false,
        previewBytes: 4096,
      },
      logger: pino({ enabled: false }),
      volumeService: {
        listVolumes,
      },
    } as unknown as AppRuntime;

    const app = render(<App runtime={runtime} />);

    await vi.waitFor(() => {
      expect(listVolumes).toHaveBeenCalledTimes(1);
      expect(app.lastFrame()).toContain('Demo Volume');
    });

    app.unmount();
  });
});
