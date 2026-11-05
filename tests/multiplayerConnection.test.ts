import assert from 'node:assert/strict';
import { test } from 'node:test';
import { multiplayerConnectionString } from '../src/execution/multiplayerStore.ts';

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
