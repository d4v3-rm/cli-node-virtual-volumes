export type OverlayFrameMode = 'help' | 'preview' | 'confirm' | 'input' | 'hostBrowser';
export type OverlayBorderTone =
  | 'info'
  | 'accentSecondary'
  | 'warning'
  | 'danger'
  | 'accentWarm'
  | 'success';

export interface OverlayFrameView {
  borderTone: OverlayBorderTone;
  height: number | string;
  label: string;
  left: number | string;
  mode: OverlayFrameMode;
  top: number | string;
  width: number | string;
}

export interface OverlayRegionLayout {
  bottom?: number;
  height?: number;
  left?: number;
  right?: number;
  top?: number;
}

export const formatOverlayLabel = (title: string): string => ` ${title.trim()} `;

const getCenteredOffset = (viewportSize: number, overlaySize: number, minimumOffset: number): number =>
  Math.max(minimumOffset, Math.floor((viewportSize - overlaySize) / 2));

export const buildOverlayFrame = (options: {
  borderTone: OverlayBorderTone;
  height: number | string;
  mode: OverlayFrameMode;
  title: string;
  viewportHeight?: number;
  viewportWidth?: number;
  width: number | string;
}): OverlayFrameView => ({
  borderTone: options.borderTone,
  height: options.height,
  label: formatOverlayLabel(options.title),
  left:
    typeof options.width === 'number' && typeof options.viewportWidth === 'number'
      ? getCenteredOffset(options.viewportWidth, options.width, 0)
      : 'center',
  mode: options.mode,
  top:
    typeof options.height === 'number' && typeof options.viewportHeight === 'number'
      ? getCenteredOffset(options.viewportHeight, options.height, 1)
      : 'center',
  width: options.width,
});

export const getScrollableOverlayLayout = (): {
  contentBox: OverlayRegionLayout;
  footerBox: OverlayRegionLayout;
} => ({
  contentBox: {
    top: 1,
    left: 1,
    right: 1,
    bottom: 2,
  },
  footerBox: {
    left: 1,
    right: 1,
    bottom: 0,
    height: 1,
  },
});

export const getConfirmOverlayLayout = (): {
  bodyBox: OverlayRegionLayout;
  buttonRow: OverlayRegionLayout;
} => ({
  bodyBox: {
    top: 1,
    left: 2,
    right: 2,
    height: 4,
  },
  buttonRow: {
    bottom: 1,
    left: 2,
    right: 2,
    height: 2,
  },
});

export const getPromptOverlayLayout = (): {
  descriptionBox: OverlayRegionLayout;
  footerBox: OverlayRegionLayout;
  inputBox: OverlayRegionLayout;
} => ({
  descriptionBox: {
    top: 1,
    left: 2,
    right: 2,
    height: 2,
  },
  inputBox: {
    top: 4,
    left: 2,
    right: 2,
    height: 3,
  },
  footerBox: {
    left: 2,
    right: 2,
    bottom: 0,
    height: 1,
  },
});
