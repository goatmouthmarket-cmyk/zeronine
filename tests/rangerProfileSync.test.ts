import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

test('profile synchronization rejects stale accounts and propagates saved names', async () => {
  const applied: any[] = [], pending: Array<(value: any) => void> = [];
  let listener: (event: any) => void = () => {};
  const parent = {};
  const window = { addEventListener: (_: string, fn: (event: any) => void) => { listener = fn; }, __applyRangerProfile: (profile: any) => applied.push(profile) };
  const context = { window, parent, location: { origin: 'https://game.test' }, localStorage: { getItem: () => null }, Date, fetch: () => new Promise(resolve => pending.push(resolve)) };
  vm.runInNewContext(fs.readFileSync('web/public/ranger-profile-sync.js', 'utf8'), context);
  const send = (data: any) => listener({ origin: 'https://game.test', source: parent, data });
  send({ type: 'zeronine:room-state', state: { accountId: 'A', accountMode: 'demo' } });
  send({ type: 'zeronine:room-state', state: { accountId: 'B', accountMode: 'demo' } });
  pending[0]!({ ok: true, json: async () => ({ accountId: 'A', profile: { name: 'Alice' } }) });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(applied.some(p => p.name === 'Alice'), false);
  send({ type: 'zeronine:ranger-profile', profile: { name: 'Bob', appearance: {} } });
  pending[1]!({ ok: true, json: async () => ({ accountId: 'B', profile: { name: 'Old Bob' } }) });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(applied.at(-1).name, 'Bob');
});
