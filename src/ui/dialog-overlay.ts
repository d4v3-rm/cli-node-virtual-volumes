export type ScrollableOverlayMode = 'help' | 'preview';
export type ConfirmButton = 'confirm' | 'cancel';

export interface ScrollableOverlayOptions {
  title: string;
  content: string;
  footer: string;
}

export interface PromptOverlayOptions {
  title: string;
  description: string;
  initialValue: string;
  footer: string;
}

export interface ConfirmOverlayOptions {
  title: string;
  body: string;
  confirmLabel: string;
}

export interface ScrollableOverlayView {
  borderTone: 'info' | 'accentSecondary';
  content: string;
  footer: string;
  height: string;
  mode: ScrollableOverlayMode;
  title: string;
  width: string;
}

export interface PromptOverlayView extends PromptOverlayOptions {
  borderTone: 'accentWarm';
  height: number;
  mode: 'input';
  width: string;
}

export interface ConfirmOverlayView extends ConfirmOverlayOptions {
  borderTone: 'danger' | 'warning';
  buttonContent: string;
  height: number;
  isDangerAction: boolean;
  mode: 'confirm';
  width: string;
}

export const getScrollableOverlayMode = (title: string): ScrollableOverlayMode =>
  title.startsWith('Preview') ? 'preview' : 'help';

export const buildScrollableOverlayView = (
  options: ScrollableOverlayOptions,
): ScrollableOverlayView => {
  const mode = getScrollableOverlayMode(options.title);

  return {
    borderTone: mode === 'preview' ? 'accentSecondary' : 'info',
    content: options.content,
    footer: options.footer,
    height: '72%',
    mode,
    title: options.title,
    width: '78%',
  };
};

export const isDangerConfirmAction = (options: ConfirmOverlayOptions): boolean =>
  /delete/i.test(options.title) || /delete/i.test(options.confirmLabel);

export const toggleConfirmButton = (selectedButton: ConfirmButton): ConfirmButton =>
  selectedButton === 'confirm' ? 'cancel' : 'confirm';

export const buildConfirmButtonRow = (
  confirmLabel: string,
  selectedButton: ConfirmButton,
): string => {
  const confirmText =
    selectedButton === 'confirm' ? `[ ${confirmLabel} ]` : `  ${confirmLabel}  `;
  const cancelText = selectedButton === 'cancel' ? '[ Cancel ]' : '  Cancel  ';

  return `${confirmText}    ${cancelText}\nLeft/Right switch. Enter confirms. Y/N and Esc also work.`;
};

export const buildConfirmOverlayView = (
  options: ConfirmOverlayOptions,
  selectedButton: ConfirmButton,
): ConfirmOverlayView => {
  const danger = isDangerConfirmAction(options);

  return {
    ...options,
    borderTone: danger ? 'danger' : 'warning',
    buttonContent: buildConfirmButtonRow(options.confirmLabel, selectedButton),
    height: 11,
    isDangerAction: danger,
    mode: 'confirm',
    width: '64%',
  };
};

export const buildPromptOverlayView = (
  options: PromptOverlayOptions,
): PromptOverlayView => ({
  ...options,
  borderTone: 'accentWarm',
  height: 11,
  mode: 'input',
  width: '68%',
});

export const resolvePromptValue = (
  submittedValue: string | null | undefined,
  fallbackValue: string,
): string => submittedValue ?? fallbackValue;
