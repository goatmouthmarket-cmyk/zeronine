/**
 * Shared HTTP failure model.
 *
 * A failed request must never be confused with a signed-out player: only a
 * verified 401 (or an explicit revocation code) is authentication evidence.
 * Transport problems and server outages are retryable state, not identity.
 */
export type ApiErrorKind = 'http' | 'timeout' | 'network';

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly kind: ApiErrorKind;
  constructor(message: string, options: { status?: number; code?: string; kind?: ApiErrorKind } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = options.status ?? 0;
    this.code = options.code ?? (this.status ? `http_${this.status}` : 'network_error');
    this.kind = options.kind ?? (this.status ? 'http' : 'network');
  }
}

const REVOCATION_CODES = new Set(['session_revoked', 'session_expired', 'not_authenticated']);

/** True only for an authoritative rejection of the session itself. */
export function isVerifiedAuthFailure(error: unknown): boolean {
  return error instanceof ApiError && error.kind === 'http' && (error.status === 401 || REVOCATION_CODES.has(error.code));
}

/** True for outages, rate limits and transport failures that may recover. */
export function isTransientFailure(error: unknown): boolean {
  if (!(error instanceof ApiError)) return true;
  if (error.kind === 'timeout' || error.kind === 'network') return true;
  return error.status >= 500 || error.status === 408 || error.status === 425 || error.status === 429;
}

/** True when the server understood the request but refused this actor. */
export function isForbiddenFailure(error: unknown): boolean {
  return error instanceof ApiError && error.status === 403;
}

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return 'request failed';
}
