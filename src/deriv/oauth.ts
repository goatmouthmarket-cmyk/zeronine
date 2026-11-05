import { createHash, randomBytes } from 'node:crypto';
import { config } from '../config.ts';
import { getSession, updateSessionToken } from '../db/store.ts';
import { decryptToken, encryptToken as encrypt } from '../db/crypto.ts';

const base64url = (buf: Buffer): string => buf.toString('base64url');

export interface TokenSet {
  accessToken: string;
  refreshToken: string | null;
  expiresIn: number;
}

export function newPkce(): { verifier: string; challenge: string } {
  const verifier = base64url(randomBytes(32));
  const challenge = base64url(createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

export function buildAuthorizeUrl(state: string, challenge: string): string {
  const u = new URL(config.oauthAuthUrl);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('client_id', config.oauthClientId);
  u.searchParams.set('redirect_uri', config.oauthRedirectUri);
  u.searchParams.set('scope', 'trade account_manage');
  u.searchParams.set('state', state);
  u.searchParams.set('code_challenge', challenge);
  u.searchParams.set('code_challenge_method', 'S256');
  u.searchParams.set('l', 'EN');
  return u.toString();
}

async function tokenPost(body: URLSearchParams): Promise<TokenSet> {
  const res = await fetch(config.oauthTokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const j = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok || !j.access_token) {
    throw new Error(`OAuth token request failed (HTTP ${res.status}): ${JSON.stringify(j).slice(0, 240)}`);
  }
  return {
    accessToken: String(j.access_token),
    refreshToken: j.refresh_token ? String(j.refresh_token) : null,
    expiresIn: Number(j.expires_in) || 0,
  };
}

export async function exchangeOauthCode(code: string, verifier: string): Promise<TokenSet> {
  return tokenPost(
    new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: config.oauthClientId,
      code,
      code_verifier: verifier,
      redirect_uri: config.oauthRedirectUri,
    }),
  );
}

export async function refreshOauthToken(refreshToken: string): Promise<TokenSet> {
  return tokenPost(
    new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: config.oauthClientId,
    }),
  );
}

export interface StoredOAuth {
  kind: 'oauth';
  token: string;
  refresh_token: string | null;
  expires_at: number | null;
}

export function serializeOAuth(ts: TokenSet): string {
  const payload: StoredOAuth = {
    kind: 'oauth',
    token: ts.accessToken,
    refresh_token: ts.refreshToken,
    expires_at: ts.expiresIn > 0 ? Date.now() + ts.expiresIn * 1000 : null,
  };
  return JSON.stringify(payload);
}

export function isStoredOAuth(raw: string): StoredOAuth | null {
  try {
    const p = JSON.parse(raw) as StoredOAuth;
    if (p && p.kind === 'oauth' && typeof p.token === 'string') {
      return {
        kind: 'oauth',
        token: p.token,
        refresh_token: p.refresh_token ?? null,
        expires_at: typeof p.expires_at === 'number' ? p.expires_at : null,
      };
    }
  } catch {
    // not JSON → legacy PAT cipher
  }
  return null;
}

export async function resolveStoredToken(): Promise<string> {
  const session = getSession();
  if (!session) throw new Error('no session');
  const raw = decryptToken(session.token_cipher);
  const oauth = isStoredOAuth(raw);
  if (!oauth) return raw;

  const expiresAt = oauth.expires_at ?? 0;
  if (oauth.refresh_token && expiresAt > 0 && expiresAt - Date.now() < 10 * 60 * 1000) {
    const ts = await refreshOauthToken(oauth.refresh_token);
    updateSessionToken(encrypt(serializeOAuth(ts)));
    return ts.accessToken;
  }
  return oauth.token;
}
