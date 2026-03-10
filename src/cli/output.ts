import path from 'node:path';

import { writeJsonAtomic } from '../utils/fs.js';

export const writeCliJsonArtifact = async (
  payload: unknown,
  outputPath: string,
): Promise<string> => {
  const absoluteOutputPath = path.resolve(outputPath);
  await writeJsonAtomic(absoluteOutputPath, payload);
  return absoluteOutputPath;
};

export const renderCliResult = <T>(
  payload: T,
  formatter: (result: T) => string,
  options: {
    artifactPath?: string | null;
    json?: boolean;
  } = {},
): string => {
  const renderedBody = options.json
    ? JSON.stringify(payload, null, 2)
    : formatter(payload);

  if (options.json || !options.artifactPath) {
    return renderedBody;
  }

  return `${renderedBody}\nArtifact path: ${options.artifactPath}`;
};
