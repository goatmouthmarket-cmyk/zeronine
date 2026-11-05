import { createHash, randomBytes } from 'node:crypto';
import { getDb } from '../db/store.ts';
import { encryptToken } from '../db/crypto.ts';

const SESSION_LIFETIME_MS = 12 * 60 * 60 * 1000;
const hashSession = (secret: string): string => createHash('sha256').update(secret).digest('hex');

/** Persist an opaque browser session bound to the account proven by Deriv. */
export function createPlayerSession(loginid: string, accessToken: string, tokenExpiresAt: number, now = Date.now()): string {
  if (!loginid || !accessToken || !Number.isFinite(tokenExpiresAt) || tokenExpiresAt <= now) throw new Error('valid Deriv authorization required');
  const secret = randomBytes(32).toString('base64url');
  const db = getDb();
  const cipher = encryptToken(accessToken);
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare(`INSERT INTO player_accounts(loginid, token_cipher, token_expires_at, updated_at) VALUES (?, ?, ?, ?)
      ON CONFLICT(loginid) DO UPDATE SET token_cipher=excluded.token_cipher, token_expires_at=excluded.token_expires_at, updated_at=excluded.updated_at`)
      .run(loginid, cipher, tokenExpiresAt, now);
    db.prepare('INSERT INTO player_sessions(session_hash, loginid, expires_at, created_at) VALUES (?, ?, ?, ?)')
      .run(hashSession(secret), loginid, Math.min(now + SESSION_LIFETIME_MS, tokenExpiresAt), now);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  return secret;
}

/** Never returns a token or trusts the client to provide an account ID. */
export function playerForSession(secret: unknown, now = Date.now()): string | null {
  if (typeof secret !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(secret)) return null;
  const row = getDb().prepare(`SELECT s.loginid FROM player_sessions s JOIN player_accounts a ON a.loginid=s.loginid
    WHERE s.session_hash=? AND s.expires_at>? AND a.token_expires_at>?`).get(hashSession(secret), now, now) as { loginid: string } | undefined;
  return row?.loginid ?? null;
}

export function revokePlayerSession(secret: unknown): void {
  if (typeof secret === 'string' && /^[A-Za-z0-9_-]{43}$/.test(secret)) getDb().prepare('DELETE FROM player_sessions WHERE session_hash=?').run(hashSession(secret));
}
