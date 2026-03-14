import path from 'node:path';

import { APP_VERSION } from '../config/app-metadata.js';
import { createCorrelationId } from '../utils/correlation.js';
import { writeJsonAtomic } from '../utils/fs.js';

export interface CliJsonArtifact<T> {
  cliVersion: string;
  command: string;
  correlationId: string;
  generatedAt: string;
  payload: T;
}

export const writeCliJsonArtifact = async (
  command: string,
  payload: unknown,
  outputPath: string,
  options: {
    correlationId?: string;
  } = {},
): Promise<string> => {
  const absoluteOutputPath = path.resolve(outputPath);
  const artifact: CliJsonArtifact<unknown> = {
    cliVersion: APP_VERSION,
    command,
    correlationId: options.correlationId ?? createCorrelationId(),
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
    correlationId?: string | null;
    json?: boolean;
  } = {},
): string => {
  const renderedBody = options.json
    ? JSON.stringify(payload, null, 2)
    : formatter(payload);

  if (options.json) {
    return renderedBody;
  }

  const footerLines = [
    ...(options.correlationId ? [`Correlation ID: ${options.correlationId}`] : []),
    ...(options.artifactPath ? [`Artifact path: ${options.artifactPath}`] : []),
  ];

  return footerLines.length > 0
    ? `${renderedBody}\n${footerLines.join('\n')}`
    : renderedBody;
};
