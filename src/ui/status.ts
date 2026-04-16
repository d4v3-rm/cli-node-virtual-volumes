export const createProgressBar = (
  currentValue: number,
  totalValue: number,
  width: number,
): string => {
  const safeWidth = Math.max(6, width);
  if (totalValue <= 0) {
    return `[${'-'.repeat(safeWidth)}]`;
  }

  const ratio = Math.max(0, Math.min(1, currentValue / totalValue));
  const filledWidth = Math.max(0, Math.min(safeWidth, Math.round(ratio * safeWidth)));

  return `[${'#'.repeat(filledWidth)}${'-'.repeat(safeWidth - filledWidth)}]`;
};

export const createActivityBar = (frameIndex: number, width: number): string => {
  const safeWidth = Math.max(6, width);
  const blockWidth = Math.min(4, safeWidth);
  const travelWidth = Math.max(1, safeWidth - blockWidth + 1);
  const offset = Math.abs(frameIndex) % travelWidth;

  return `[${'.'.repeat(offset)}${'='.repeat(blockWidth)}${'.'.repeat(safeWidth - offset - blockWidth)}]`;
};

export const formatElapsedTime = (elapsedMs: number): string => {
  const elapsedSeconds = Math.max(0, Math.floor(elapsedMs / 1000));
  const hours = Math.floor(elapsedSeconds / 3600);
  const minutes = Math.floor((elapsedSeconds % 3600) / 60);
  const seconds = elapsedSeconds % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }

  return `${minutes}:${String(seconds).padStart(2, '0')}`;
};
