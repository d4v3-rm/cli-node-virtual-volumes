import type {
  SupportBundleInspectionResult,
  SupportBundleSharingRecommendation,
  SupportBundleResult,
} from '../domain/types.js';
import { formatDateTime } from '../utils/formatters.js';

const supportBundleSharingRecommendationRank: Record<
  SupportBundleSharingRecommendation,
  number
> = {
  'internal-only': 0,
  'external-shareable': 1,
};

export interface SupportBundleSharingRequirementStatus {
  required: SupportBundleSharingRecommendation;
  satisfied: boolean;
  message: string | null;
}

export const isSupportBundleSharingRecommendation = (
  value: string,
): value is SupportBundleSharingRecommendation =>
  value === 'external-shareable' || value === 'internal-only';

export const parseSupportBundleSharingRecommendation = (
  value: string,
): SupportBundleSharingRecommendation => {
  if (isSupportBundleSharingRecommendation(value)) {
    return value;
  }

  throw new Error(
    `Unsupported support bundle sharing policy "${value}". Expected one of: external-shareable, internal-only.`,
  );
};

export const evaluateSupportBundleSharingRequirement = (
  result: Pick<SupportBundleInspectionResult, 'contentProfile'>,
  required: SupportBundleSharingRecommendation,
): SupportBundleSharingRequirementStatus => {
  const actual = result.contentProfile?.sharingRecommendation;

  if (!actual) {
    return {
      required,
      satisfied: false,
      message:
        'Support bundle sharing guidance is unknown, so the required sharing policy cannot be verified.',
    };
  }

  const satisfied =
    supportBundleSharingRecommendationRank[actual] >=
    supportBundleSharingRecommendationRank[required];

  return {
    required,
    satisfied,
    message: satisfied
      ? null
      : `Support bundle is recommended for ${actual} sharing, but ${required} was required.`,
  };
};

export const formatSupportBundleSharingRequirementStatus = (
  status: SupportBundleSharingRequirementStatus,
): string => {
  const lines = [
    `Required sharing: ${status.required}`,
    `Policy gate: ${status.satisfied ? 'PASSED' : 'FAILED'}`,
  ];

  if (status.message) {
    lines.push(`Policy note: ${status.message}`);
  }

  return lines.join('\n');
};

export const formatSupportBundleResult = (
  result: SupportBundleResult,
): string => {
  const lines = [
    'Support bundle: CREATED',
    `Bundle path: ${result.bundlePath}`,
    `Manifest: ${result.manifestPath}`,
    `Checksums: ${result.checksumsPath}`,
    `Correlation ID: ${result.correlationId}`,
    `Sensitivity: ${result.contentProfile.sensitivity}`,
    `Sharing: ${result.contentProfile.sharingRecommendation}`,
    `Retention: ${result.contentProfile.recommendedRetentionDays} days`,
    `Scope: ${result.volumeId ?? 'all volumes'}`,
    `Volumes checked: ${result.checkedVolumes}`,
    `Issues detected: ${result.issueCount}`,
    `Doctor report: ${result.doctorReportPath}`,
    `Backup inspection: ${result.backupInspectionReportPath ?? 'not included'}`,
    `Backup manifest copy: ${result.backupManifestCopyPath ?? 'not included'}`,
    `Audit log snapshot: ${result.auditLogSnapshotPath ?? 'not included'}`,
    `Log snapshot: ${result.logSnapshotPath ?? 'not included'}`,
    `CLI version: ${result.cliVersion}`,
    `Supported schema: ${result.supportedVolumeSchemaVersion}`,
    `Generated at: ${formatDateTime(result.generatedAt)}`,
  ];

  if (result.backupPath) {
    lines.splice(10, 0, `Backup path: ${result.backupPath}`);
  }

  if (result.contentProfile.sharingNotes.length > 0) {
    lines.push('Sharing notes:');
    lines.push(
      ...result.contentProfile.sharingNotes.map((note) => `- ${note}`),
    );
  }

  if (result.contentProfile.disposalNotes.length > 0) {
    lines.push('Disposal notes:');
    lines.push(
      ...result.contentProfile.disposalNotes.map((note) => `- ${note}`),
    );
  }

  return lines.join('\n');
};

export const formatSupportBundleInspectionResult = (
  result: SupportBundleInspectionResult,
): string => {
  const lines = [
    `Support bundle: ${result.healthy ? 'HEALTHY' : 'UNHEALTHY'}`,
    `Bundle path: ${result.bundlePath}`,
    `Manifest: ${result.manifestPath}`,
    `Checksums: ${result.checksumsPath}`,
    `Bundle version: ${result.bundleVersion ?? 'unknown'}`,
    `Created with: ${result.bundleCliVersion ?? 'unknown'}`,
    `Bundle correlation ID: ${result.bundleCorrelationId ?? 'unknown'}`,
    `Sensitivity: ${result.contentProfile?.sensitivity ?? 'unknown'}`,
    `Sharing: ${result.contentProfile?.sharingRecommendation ?? 'unknown'}`,
    `Retention: ${result.contentProfile?.recommendedRetentionDays ?? 'unknown'}${
      result.contentProfile ? ' days' : ''
    }`,
    `Bundle created at: ${
      result.bundleCreatedAt ? formatDateTime(result.bundleCreatedAt) : 'unknown'
    }`,
    `Scope: ${result.volumeId ?? 'all volumes'}`,
    `Verified files: ${result.verifiedFiles}/${result.expectedFiles}`,
    `Issues: ${result.issueCount}`,
    `Inspected at: ${formatDateTime(result.generatedAt)}`,
  ];

  if (result.issues.length > 0) {
    lines.push('Findings:');
    lines.push(
      ...result.issues.map((issue) => `- [${issue.code}] ${issue.message}`),
    );
  }

  if (result.contentProfile?.sharingNotes.length) {
    lines.push('Sharing notes:');
    lines.push(
      ...result.contentProfile.sharingNotes.map((note) => `- ${note}`),
    );
  }

  if (result.contentProfile?.disposalNotes.length) {
    lines.push('Disposal notes:');
    lines.push(
      ...result.contentProfile.disposalNotes.map((note) => `- ${note}`),
    );
  }

  return lines.join('\n');
};
