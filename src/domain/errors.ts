export type VolumeErrorCode =
  | 'ALREADY_EXISTS'
  | 'INTEGRITY_CHECK_FAILED'
  | 'INVALID_NAME'
  | 'INVALID_OPERATION'
  | 'INVALID_PATH'
  | 'NOT_FOUND'
  | 'QUOTA_EXCEEDED'
  | 'UNSUPPORTED_HOST_ENTRY';

export class VolumeError extends Error {
  public readonly code: VolumeErrorCode;

  public readonly details?: Record<string, unknown>;

  public constructor(
    code: VolumeErrorCode,
    message: string,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.code = code;
    this.details = details;
    this.name = 'VolumeError';
  }
}

export const isVolumeError = (error: unknown): error is VolumeError =>
  error instanceof VolumeError;
