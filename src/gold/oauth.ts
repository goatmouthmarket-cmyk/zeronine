import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export const DEFAULT_CTRADER_OAUTH_STATE_TTL_MS = 10 * 60 * 1000;
export const DEFAULT_CTRADER_TOKEN_REFRESH_SKEW_MS = 5 * 60 * 1000;

export interface CTraderOAuthConfig {
  authorizationEndpoint: string;
  clientId: string;
  redirectUri: string;
  scopes?: readonly string[];
}

export interface CTraderPkcePair {
  verifier: string;
  challenge: string;
}

/**
 * This record is safe to store server-side. The state must be consumed in the
 * same database transaction that marks it used; a process-local map is not
 * replay-safe across Railway instances.
 */
export interface CTraderOAuthStateRecord {
  state: string;
  verifier: string;
  userId: string;
  createdAt: number;
  expiresAt: number;
  usedAt: number | null;
}

export type CTraderOAuthStateFailure = 'invalid' | 'wrong_user' | 'expired' | 'replayed';

export type CTraderOAuthStateValidation =
  | { ok: true; record: CTraderOAuthStateRecord }
  | { ok: false; reason: CTraderOAuthStateFailure };

/** Raw OAuth token response accepted from the token endpoint. Never send it to the browser. */
export interface CTraderOAuthTokenPayload {
  access_token: string;
  refresh_token?: string | null;
  token_type?: string;
  expires_in: number | string;
  scope?: string;
}

/** Server-only normalized token record. Encrypt before persistence. */
export interface CTraderOAuthTokenSet {
  accessToken: string;
  refreshToken: string | null;
  tokenType: string;
  scope: string | null;
  issuedAt: number;
  expiresAt: number;
}

function base64url(bytes: Buffer): string {
  return bytes.toString('base64url');
}

function nonEmpty(value: string, name: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${name} is required`);
  return trimmed;
}

function httpsUrl(value: string, name: string): URL {
  const url = new URL(nonEmpty(value, name));
  if (url.protocol !== 'https:') throw new Error(`${name} must be an https URL`);
  return url;
}

function secureEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

/** Creates an RFC 7636 S256 PKCE pair. The verifier is never browser storage. */
export function createCTraderPkce(): CTraderPkcePair {
  const verifier = base64url(randomBytes(48));
  return {
    verifier,
    challenge: base64url(createHash('sha256').update(verifier, 'ascii').digest()),
  };
}

export function createCTraderOAuthState(
  userId: string,
  options: { now?: number; ttlMs?: number; pkce?: CTraderPkcePair } = {},
): CTraderOAuthStateRecord {
  const now = options.now ?? Date.now();
  const ttlMs = options.ttlMs ?? DEFAULT_CTRADER_OAUTH_STATE_TTL_MS;
  if (!Number.isSafeInteger(now) || now <= 0) throw new Error('now must be a positive millisecond timestamp');
  if (!Number.isSafeInteger(ttlMs) || ttlMs <= 0) throw new Error('ttlMs must be a positive millisecond duration');
  const pkce = options.pkce ?? createCTraderPkce();
  if (!/^[A-Za-z0-9_-]{43,128}$/.test(pkce.verifier)) throw new Error('PKCE verifier is invalid');
  return {
    state: base64url(randomBytes(32)),
    verifier: pkce.verifier,
    userId: nonEmpty(userId, 'userId'),
    createdAt: now,
    expiresAt: now + ttlMs,
    usedAt: null,
  };
}

/**
 * Pure callback guard. Callers must persist the returned `usedAt` atomically
 * with connection creation, and reject the callback when that update affects
 * no unused state row.
 */
export function validateAndConsumeCTraderOAuthState(
  record: CTraderOAuthStateRecord | null | undefined,
  input: { state: string; userId: string; now?: number },
): CTraderOAuthStateValidation {
  if (!record || !secureEqual(record.state, input.state)) return { ok: false, reason: 'invalid' };
  if (!secureEqual(record.userId, input.userId)) return { ok: false, reason: 'wrong_user' };
  if (record.usedAt !== null) return { ok: false, reason: 'replayed' };
  const now = input.now ?? Date.now();
  if (!Number.isSafeInteger(now) || now > record.expiresAt) return { ok: false, reason: 'expired' };
  return { ok: true, record: { ...record, usedAt: now } };
}

export function buildCTraderAuthorizeUrl(config: CTraderOAuthConfig, state: CTraderOAuthStateRecord): string {
  const authorizationUrl = httpsUrl(config.authorizationEndpoint, 'authorizationEndpoint');
  authorizationUrl.searchParams.set('response_type', 'code');
  authorizationUrl.searchParams.set('client_id', nonEmpty(config.clientId, 'clientId'));
  authorizationUrl.searchParams.set('redirect_uri', httpsUrl(config.redirectUri, 'redirectUri').toString());
  authorizationUrl.searchParams.set('state', state.state);
  authorizationUrl.searchParams.set('code_challenge', state.verifier
    ? base64url(createHash('sha256').update(state.verifier, 'ascii').digest())
    : '');
  authorizationUrl.searchParams.set('code_challenge_method', 'S256');
  const scopes = config.scopes?.map((scope) => scope.trim()).filter(Boolean) ?? [];
  if (scopes.length > 0) authorizationUrl.searchParams.set('scope', scopes.join(' '));
  return authorizationUrl.toString();
}

export function normalizeCTraderTokenPayload(payload: CTraderOAuthTokenPayload, issuedAt = Date.now()): CTraderOAuthTokenSet {
  const expiresIn = typeof payload.expires_in === 'string' ? Number(payload.expires_in) : payload.expires_in;
  if (!Number.isSafeInteger(issuedAt) || issuedAt <= 0) throw new Error('issuedAt must be a positive millisecond timestamp');
  if (!Number.isFinite(expiresIn) || expiresIn <= 0 || !Number.isSafeInteger(expiresIn)) {
    throw new Error('OAuth token payload has an invalid expires_in value');
  }
  const accessToken = nonEmpty(payload.access_token, 'access_token');
  const refreshToken = payload.refresh_token == null ? null : nonEmpty(payload.refresh_token, 'refresh_token');
  const expiresAt = issuedAt + expiresIn * 1000;
  if (!Number.isSafeInteger(expiresAt)) throw new Error('OAuth token expiry exceeds supported timestamp range');
  return {
    accessToken,
    refreshToken,
    tokenType: (payload.token_type?.trim() || 'Bearer'),
    scope: payload.scope?.trim() || null,
    issuedAt,
    expiresAt,
  };
}

export function isCTraderTokenExpired(token: Pick<CTraderOAuthTokenSet, 'expiresAt'>, now = Date.now()): boolean {
  return now >= token.expiresAt;
}

export function shouldRefreshCTraderToken(
  token: Pick<CTraderOAuthTokenSet, 'expiresAt'>,
  now = Date.now(),
  skewMs = DEFAULT_CTRADER_TOKEN_REFRESH_SKEW_MS,
): boolean {
  if (!Number.isSafeInteger(skewMs) || skewMs < 0) throw new Error('skewMs must be a non-negative millisecond duration');
  return now + skewMs >= token.expiresAt;
}
