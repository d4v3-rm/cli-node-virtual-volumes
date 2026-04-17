const dateTimeFormatter = new Intl.DateTimeFormat('it-IT', {
  dateStyle: 'short',
  timeStyle: 'short',
});

export const formatBytes = (value: number): string => {
  if (value < 1024) {
    return `${value} B`;
  }

  const units = ['KB', 'MB', 'GB', 'TB', 'PB'];
  let amount = value;
  let unitIndex = -1;

  while (amount >= 1024 && unitIndex < units.length - 1) {
    amount /= 1024;
    unitIndex += 1;
  }

  return `${amount.toFixed(amount >= 100 ? 0 : 1)} ${units[unitIndex]}`;
};

export const formatDateTime = (value: string): string =>
  dateTimeFormatter.format(new Date(value));

export const truncate = (value: string, maxLength: number): string =>
  value.length <= maxLength ? value : `${value.slice(0, maxLength - 3)}...`;
