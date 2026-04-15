import type {
  DirectoryListingItem,
  ExplorerSnapshot,
  VolumeManifest,
} from '../domain/types.js';
import { formatBytes } from '../utils/formatters.js';
import { fitSingleLine } from './presenters.js';
import { createActivityBar, createProgressBar, formatElapsedTime } from './status.js';

export type ScreenMode = 'dashboard' | 'explorer';
export type StatusTone = 'success' | 'error' | 'info';

export interface StatusToastState {
  tone: StatusTone;
  message: string;
  detail?: string;
}

export interface StatusPanelRenderOptions {
  availableWidth: number;
  mode: ScreenMode;
  volumes: VolumeManifest[];
  selectedVolumeIndex: number;
  currentSnapshot: ExplorerSnapshot | null;
  selectedEntry: DirectoryListingItem | null;
  logDir: string;
  busyLabel: string | null;
  busyDetail?: string | null;
  busyProgressCurrent: number | null;
  busyProgressTotal: number | null;
  elapsedMs: number;
  spinnerIndex: number;
  spinnerFrames: readonly string[];
  toast: StatusToastState | null;
}

export interface StatusPanelRenderResult {
  state: StatusTone | 'busy' | 'idle';
  label: string;
  lines: [string, string];
}

const getDashboardStatusContext = (
  volumes: VolumeManifest[],
  selectedVolumeIndex: number,
): string => {
  const selectedVolume = volumes[selectedVolumeIndex] ?? null;

  if (!selectedVolume) {
    return 'Press N to create your first volume. Use arrows to navigate when volumes are available.';
  }

  return `Selected volume ${selectedVolume.name}  Quota ${formatBytes(selectedVolume.quotaBytes)}  Used ${formatBytes(selectedVolume.logicalUsedBytes)}`;
};

const getExplorerStatusContext = (
  currentSnapshot: ExplorerSnapshot | null,
  selectedEntry: DirectoryListingItem | null,
): string => {
  if (!currentSnapshot) {
    return 'Open a volume to browse files and folders.';
  }

  if (!selectedEntry) {
    return `Volume ${currentSnapshot.volume.name}  Path ${currentSnapshot.currentPath}  Directory empty.`;
  }

  const selectionDetail =
    selectedEntry.kind === 'file'
      ? `Selected file ${selectedEntry.name}  ${formatBytes(selectedEntry.size)}`
      : `Selected folder ${selectedEntry.name}`;

  return `Volume ${currentSnapshot.volume.name}  Path ${currentSnapshot.currentPath}  ${selectionDetail}`;
};

export const getStatusContextLine = (options: {
  mode: ScreenMode;
  volumes: VolumeManifest[];
  selectedVolumeIndex: number;
  currentSnapshot: ExplorerSnapshot | null;
  selectedEntry: DirectoryListingItem | null;
  logDir: string;
  includeLogs: boolean;
}): string => {
  const baseContext =
    options.mode === 'dashboard'
      ? getDashboardStatusContext(options.volumes, options.selectedVolumeIndex)
      : getExplorerStatusContext(options.currentSnapshot, options.selectedEntry);

  if (!options.includeLogs) {
    return baseContext;
  }

  return `${baseContext}  Logs ${options.logDir}`;
};

const renderBusyStatusLines = (options: StatusPanelRenderOptions): [string, string] => {
  const elapsedLabel = formatElapsedTime(options.elapsedMs);
  const spinnerFrame = options.spinnerFrames[options.spinnerIndex] ?? options.spinnerFrames[0] ?? '|';
  const titleLine = fitSingleLine(
    `${spinnerFrame} ${options.busyLabel ?? ''}  ${elapsedLabel}`,
    options.availableWidth,
  );
  const detailLabel =
    options.busyDetail ??
    getStatusContextLine({
      mode: options.mode,
      volumes: options.volumes,
      selectedVolumeIndex: options.selectedVolumeIndex,
      currentSnapshot: options.currentSnapshot,
      selectedEntry: options.selectedEntry,
      logDir: options.logDir,
      includeLogs: false,
    });

  if (options.busyProgressTotal !== null && options.busyProgressTotal > 0) {
    const progressBarWidth = Math.max(
      10,
      Math.min(24, Math.floor(options.availableWidth * 0.24)),
    );
    const progressBar = createProgressBar(
      options.busyProgressCurrent ?? 0,
      options.busyProgressTotal,
      progressBarWidth,
    );
    const percentage = Math.min(
      100,
      Math.max(
        0,
        Math.floor(((options.busyProgressCurrent ?? 0) / options.busyProgressTotal) * 100),
      ),
    );

    return [
      titleLine,
      fitSingleLine(
        `${progressBar} ${String(percentage).padStart(3, ' ')}%  ${formatBytes(options.busyProgressCurrent ?? 0)} / ${formatBytes(options.busyProgressTotal)}  ${detailLabel}`,
        options.availableWidth,
      ),
    ];
  }

  const activityBarWidth = Math.max(
    10,
    Math.min(24, Math.floor(options.availableWidth * 0.24)),
  );
  const activityBar = createActivityBar(options.spinnerIndex, activityBarWidth);

  return [
    titleLine,
    fitSingleLine(`${activityBar} ${detailLabel}`, options.availableWidth),
  ];
};

const renderToastStatusLines = (options: StatusPanelRenderOptions): [string, string] => [
  fitSingleLine(
    `[${options.toast?.tone.toUpperCase()}] ${options.toast?.message ?? ''}`,
    options.availableWidth,
  ),
  fitSingleLine(
    options.toast?.detail ??
      getStatusContextLine({
        mode: options.mode,
        volumes: options.volumes,
        selectedVolumeIndex: options.selectedVolumeIndex,
        currentSnapshot: options.currentSnapshot,
        selectedEntry: options.selectedEntry,
        logDir: options.logDir,
        includeLogs: true,
      }),
    options.availableWidth,
  ),
];

const renderIdleStatusLines = (options: StatusPanelRenderOptions): [string, string] => {
  const headline =
    options.mode === 'dashboard'
      ? `Ready. Dashboard active with ${options.volumes.length} volumes available.`
      : `Ready. Explorer active in ${options.currentSnapshot?.currentPath ?? '/'}.`;

  return [
    fitSingleLine(headline, options.availableWidth),
    fitSingleLine(
      getStatusContextLine({
        mode: options.mode,
        volumes: options.volumes,
        selectedVolumeIndex: options.selectedVolumeIndex,
        currentSnapshot: options.currentSnapshot,
        selectedEntry: options.selectedEntry,
        logDir: options.logDir,
        includeLogs: true,
      }),
      options.availableWidth,
    ),
  ];
};

export const buildStatusPanel = (
  options: StatusPanelRenderOptions,
): StatusPanelRenderResult => {
  if (options.busyLabel) {
    return {
      state: 'busy',
      label: ' Status  Running ',
      lines: renderBusyStatusLines(options),
    };
  }

  if (options.toast) {
    return {
      state: options.toast.tone,
      label: ` Status  ${options.toast.tone.toUpperCase()} `,
      lines: renderToastStatusLines(options),
    };
  }

  return {
    state: 'idle',
    label: ' Status  Ready ',
    lines: renderIdleStatusLines(options),
  };
};
