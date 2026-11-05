import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'pasture-player-sessions-'));
process.env.SESSION_SECRET = 'test-player-session-secret-32-characters';

test('player sessions are opaque, account-bound, expiring and individually revocable', async () => {
  const { createPlayerSession, playerForSession, revokePlayerSession } = await import('../src/api/playerSessions.ts');
  const { getDb } = await import('../src/db/store.ts');
  const now = Date.now();
  const first = createPlayerSession('VRTC001', 'private-token-one', now + 60_000, now);
  const second = createPlayerSession('VRTC002', 'private-token-two', now + 30_000, now);
  assert.equal(playerForSession(first, now), 'VRTC001');
  assert.equal(playerForSession(second, now), 'VRTC002');
  assert.equal(playerForSession('VRTC001', now), null);
  assert.equal(playerForSession(second, now + 30_000), null);
  const stored = JSON.stringify(getDb().prepare('SELECT * FROM player_accounts').all());
  assert.doesNotMatch(stored, /private-token/);
  const sessions = JSON.stringify(getDb().prepare('SELECT * FROM player_sessions').all());
  assert.ok(!sessions.includes(first));
  revokePlayerSession(first);
  assert.equal(playerForSession(first, now), null);
  assert.equal(playerForSession(second, now), 'VRTC002');
  assert.throws(() => createPlayerSession('VRTC003', 'token', now, now));
});
