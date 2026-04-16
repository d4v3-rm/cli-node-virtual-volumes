export interface VisibleWindow<T> {
  items: T[];
  start: number;
  end: number;
}

export const VISIBLE_VOLUME_ROWS = 8;
export const VISIBLE_ENTRY_ROWS = 12;

export const clampIndex = (index: number, length: number): number => {
  if (length <= 0) {
    return 0;
  }

  return Math.max(0, Math.min(index, length - 1));
};

export const getPageOffset = (selectedIndex: number, pageSize: number): number => {
  if (pageSize <= 0) {
    return 0;
  }

  return Math.floor(Math.max(0, selectedIndex) / pageSize) * pageSize;
};

export const getVisibleWindow = <T,>(
  items: T[],
  selectedIndex: number,
  pageSize: number,
): VisibleWindow<T> => {
  const start = getPageOffset(selectedIndex, pageSize);
  const end = Math.min(items.length, start + Math.max(1, pageSize));

  return {
    items: items.slice(start, end),
    start,
    end,
  };
};

export const formatWindowSummary = (
  start: number,
  end: number,
  total: number,
): string => {
  if (total === 0) {
    return '0 of 0';
  }

  return `${start + 1}-${end} of ${total}`;
};
