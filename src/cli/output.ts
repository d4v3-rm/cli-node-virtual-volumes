import path from 'node:path';

import { APP_VERSION } from '../config/app-metadata.js';
import { writeJsonAtomic } from '../utils/fs.js';

export interface CliJsonArtifact<T> {
  cliVersion: string;
  command: string;
  generatedAt: string;
  payload: T;
}

export const writeCliJsonArtifact = async (
  command: string,
  payload: unknown,
  outputPath: string,
): Promise<string> => {
  const absoluteOutputPath = path.resolve(outputPath);
  const artifact: CliJsonArtifact<unknown> = {
    cliVersion: APP_VERSION,
    command,
    generatedAt: new Date().toISOString(),
    payload,
  };
  await writeJsonAtomic(absoluteOutputPath, artifact);
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
