import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'overunder-'));
process.env.DATA_DIR = tmp;
process.env.SESSION_SECRET = 'test-secret-test-secret-test-secret';

test('HTTP shell boots and serves health + settings', async () => {
  const [{ default: Fastify }, hubMod, marketMod, feedMod, clientMod, autoMod, routesMod] =
    await Promise.all([
      import('fastify'),
      import('../src/api/hub.ts'),
      import('../src/core/marketState.ts'),
      import('../src/deriv/publicFeed.ts'),
      import('../src/deriv/privateClient.ts'),
      import('../src/strategy/automation.ts'),
      import('../src/api/routes.ts'),
    ]);

  const app = Fastify();
  const hub = new hubMod.Hub();
  const registry = new marketMod.MarketRegistry({ onTick: () => undefined });
  const feed = new feedMod.DerivPublicFeed(registry, () => undefined);
  const client = new clientMod.DerivPrivateClient();
  const automation = new autoMod.Automation(registry, client, hub);

  routesMod.registerApi(app, { registry, feed, client, hub, automation });

  const health = await app.inject({ method: 'GET', url: '/health' });
  assert.equal(health.statusCode, 200);
  const body = health.json();
  assert.equal(body.ok, true);
  assert.equal(typeof body.uptime, 'number');

  const state = await app.inject({ method: 'GET', url: '/api/state' });
  assert.equal(state.statusCode, 200);
  const stateBody = state.json();
  assert.equal(typeof stateBody.settings, 'object');
  assert.ok(Array.isArray(stateBody.markets ?? []));
  assert.ok(Array.isArray(stateBody.intelligence ?? []));

  const evidence = await app.inject({ method: 'GET', url: '/api/test/evidence?limit=10' });
  assert.equal(evidence.statusCode, 200);
  const evidenceBody = evidence.json();
  assert.equal(typeof evidenceBody.evidence, 'object');
  assert.ok(Array.isArray(evidenceBody.evidence.by_health));
  assert.ok(Array.isArray(evidenceBody.evidence.by_regime));
  assert.ok(Array.isArray(evidenceBody.evidence.by_action));

  const put = await app.inject({
    method: 'PUT',
    url: '/api/settings',
    payload: { base_stake: 2, max_stake: 40 },
  });
  assert.equal(put.statusCode, 200);
  const settings = put.json();
  assert.equal(settings.base_stake, 2);
  assert.equal(settings.max_stake, 40);

  await app.close();
});

test('app_meta round-trips and digit fingerprint counts stored ticks', async () => {
  const storeMod = await import('../src/db/store.ts');
  assert.equal(storeMod.getMeta('backtest_last_run_at'), null, 'unset meta is null');
  storeMod.setMeta('backtest_last_run_at', '1234');
  assert.equal(storeMod.getMeta('backtest_last_run_at'), '1234');
  storeMod.setMeta('backtest_last_run_at', '5678');
  assert.equal(storeMod.getMeta('backtest_last_run_at'), '5678', 'upsert overwrites');
  const before = storeMod.digitFingerprint();
  storeMod.insertDigit('X', before + 1, 0, 5);
  assert.ok(storeMod.digitFingerprint() > before, 'fingerprint grows with a new tick');
});
