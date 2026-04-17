export const parseHostPathBatchInput = (input: string): string[] =>
  input
    .split(/[\n;,]+/u)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
