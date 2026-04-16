export type ToastTone = 'success' | 'error' | 'info';

export interface ToastState {
  tone: ToastTone;
  message: string;
  detail?: string;
}

export interface BusyState {
  label: string;
  detail: string | null;
  progressCurrent: number | null;
  progressTotal: number | null;
  startedAt: number;
  lastRefreshAt: number;
}

export interface BusyStateUpdate {
  label?: string;
  detail?: string;
  currentValue?: number | null;
  totalValue?: number | null;
}

export interface BusyStatePatchResult {
  state: BusyState;
  shouldRender: boolean;
}

export const createToastState = (
  tone: ToastTone,
  message: string,
  detail?: string,
): ToastState => ({
  tone,
  message,
  detail,
});

export const createBusyState = (
  label: string,
  detail: string | null,
  startedAt: number,
): BusyState => ({
  label,
  detail,
  progressCurrent: null,
  progressTotal: null,
  startedAt,
  lastRefreshAt: 0,
});

export const applyBusyStateUpdate = (
  state: BusyState,
  update: BusyStateUpdate,
  now: number,
  minimumRefreshIntervalMs = 80,
): BusyStatePatchResult => {
  const nextState: BusyState = {
    ...state,
    label: update.label ?? state.label,
    detail: update.detail ?? state.detail,
    progressCurrent:
      update.currentValue !== undefined ? update.currentValue : state.progressCurrent,
    progressTotal: update.totalValue !== undefined ? update.totalValue : state.progressTotal,
  };

  if (now - state.lastRefreshAt < minimumRefreshIntervalMs) {
    return {
      state: nextState,
      shouldRender: false,
    };
  }

  return {
    state: {
      ...nextState,
      lastRefreshAt: now,
    },
    shouldRender: true,
  };
};
