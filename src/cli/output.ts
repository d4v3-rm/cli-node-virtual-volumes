import path from 'node:path';

import { APP_VERSION } from '../config/app-metadata.js';
import { createCorrelationId } from '../utils/correlation.js';
import { writeJsonAtomic } from '../utils/fs.js';

export interface CliArtifactHandlingProfile {
  redacted: boolean;
  sensitivity: 'sanitized' | 'restricted';
  sharingRecommendation: 'external-shareable' | 'internal-only';
  recommendedRetentionDays: number;
  notes: string[];
}

export interface CliJsonArtifact<T> {
  cliVersion: string;
  command: string;
  correlationId: string;
  generatedAt: string;
  handling: CliArtifactHandlingProfile;
  payload: T;
}

export const buildCliArtifactHandlingProfile = (
  redacted: boolean,
): CliArtifactHandlingProfile =>
  redacted
    ? {
        redacted: true,
        sensitivity: 'sanitized',
        sharingRecommendation: 'external-shareable',
        recommendedRetentionDays: 30,
        notes: [
          'Artifact payload was redacted before export.',
          'External sharing is allowed only when the receiving process accepts sanitized operational data.',
        ],
      }
    : {
        redacted: false,
        sensitivity: 'restricted',
        sharingRecommendation: 'internal-only',
        recommendedRetentionDays: 7,
        notes: [
          'Artifact payload may contain sensitive operational paths or runtime details.',
          'Keep this artifact inside the organization unless it is regenerated with redaction enabled.',
        ],
      };

export const writeCliJsonArtifact = async (
  command: string,
  payload: unknown,
  outputPath: string,
  options: {
    correlationId?: string;
    redactSensitiveDetails?: boolean;
  } = {},
): Promise<string> => {
  const absoluteOutputPath = path.resolve(outputPath);
  const artifact: CliJsonArtifact<unknown> = {
    cliVersion: APP_VERSION,
    command,
    correlationId: options.correlationId ?? createCorrelationId(),
    generatedAt: new Date().toISOString(),
    handling: buildCliArtifactHandlingProfile(
      options.redactSensitiveDetails ?? false,
    ),
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
