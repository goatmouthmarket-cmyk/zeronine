import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MultiplayerStore, multiplayerConnectionString } from '../src/execution/multiplayerStore.ts';

test('session pooler override preserves the secret and requires the matching project user', () => {
  const direct = 'postgresql://postgres:sample%40secret@db.zxgyrueibonjcozbxnhr.supabase.co:5432/postgres';
  const pooler = multiplayerConnectionString(direct, 'aws-0-us-east-1.pooler.supabase.com', 'postgres.zxgyrueibonjcozbxnhr');
  const url = new URL(pooler);
  assert.equal(url.hostname, 'aws-0-us-east-1.pooler.supabase.com');
  assert.equal(url.username, 'postgres.zxgyrueibonjcozbxnhr');
  assert.equal(url.password, 'sample%40secret');
  assert.equal(url.port, '5432');
  assert.throws(() => multiplayerConnectionString(direct, 'evil.example.com', 'postgres.zxgyrueibonjcozbxnhr'));
  assert.throws(() => multiplayerConnectionString(direct, 'aws-0-us-east-1.pooler.supabase.com', 'postgres.anotherproject'));
  assert.throws(() => multiplayerConnectionString(`${direct}?sslmode=disable`));
});

test('risk preflight registers a verified owner account before its foreign-keyed risk row', async () => {
  const accounts = new Set<string>();
  const risks = new Map<string, number>();
  const store = Object.create(MultiplayerStore.prototype) as MultiplayerStore;
  Object.defineProperty(store, 'pool', { value: { query: async (sql: string, params: unknown[]) => {
    const accountId = String(params[0]);
    if (sql.startsWith('insert into multiplayer_private.accounts')) {
      accounts.add(accountId);
      return { rows: [] };
    }
    if (!accounts.has(accountId)) throw new Error('account_risk_account_id_fkey');
    risks.set(accountId, Math.max(risks.get(accountId) ?? 0, Number(params[1])));
    return { rows: [{ mode: 'base', streak: 0, debt: '0', attempts: 0, cycle_stake: '0', peak_balance: String(risks.get(accountId)) }] };
  } } });
  assert.equal((await store.riskSnapshot('DOT_OWNER', 100)).peakBalance, 100);
  assert.equal((await store.riskSnapshot('VRTC_PLAYER', 50)).peakBalance, 50);
  assert.equal((await store.riskSnapshot('DOT_OWNER', 80)).peakBalance, 100);
  assert.deepEqual([...accounts], ['DOT_OWNER', 'VRTC_PLAYER']);
});
