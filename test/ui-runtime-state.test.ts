import { describe, expect, it } from 'vitest';

import {
  applyBusyStateUpdate,
  createBusyState,
  createToastState,
} from '../src/ui/runtime-state.js';

describe('ui runtime state helpers', () => {
  it('creates toast and busy states with stable defaults', () => {
    expect(createToastState('success', 'Volume created.', 'Details')).toEqual({
      tone: 'success',
      message: 'Volume created.',
      detail: 'Details',
    });

    expect(createBusyState('Loading volumes', 'Initializing shell.', 1000)).toEqual({
      label: 'Loading volumes',
      detail: 'Initializing shell.',
      progressCurrent: null,
      progressTotal: null,
      startedAt: 1000,
      lastRefreshAt: 0,
    });
  });

  it('applies busy state updates and throttles render frequency', () => {
    const initialState = createBusyState('Importing', 'Preparing', 1000);

    const firstPatch = applyBusyStateUpdate(
      initialState,
      {
        currentValue: 128,
        detail: 'Copying report.txt',
        totalValue: 1024,
      },
      1100,
    );

    expect(firstPatch).toEqual({
      state: {
        label: 'Importing',
        detail: 'Copying report.txt',
        progressCurrent: 128,
        progressTotal: 1024,
        startedAt: 1000,
        lastRefreshAt: 1100,
      },
      shouldRender: true,
    });

    const throttledPatch = applyBusyStateUpdate(
      firstPatch.state,
      {
        currentValue: 256,
        label: 'Importing host paths',
      },
      1150,
    );

    expect(throttledPatch).toEqual({
      state: {
        label: 'Importing host paths',
        detail: 'Copying report.txt',
        progressCurrent: 256,
        progressTotal: 1024,
        startedAt: 1000,
        lastRefreshAt: 1100,
      },
      shouldRender: false,
    });

    const laterPatch = applyBusyStateUpdate(
      throttledPatch.state,
      {
        totalValue: null,
      },
      1200,
    );

    expect(laterPatch).toEqual({
      state: {
        label: 'Importing host paths',
        detail: 'Copying report.txt',
        progressCurrent: 256,
        progressTotal: null,
        startedAt: 1000,
        lastRefreshAt: 1200,
      },
      shouldRender: true,
    });
  });
});
