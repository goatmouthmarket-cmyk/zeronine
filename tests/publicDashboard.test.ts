import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'overunder-public-dashboard-'));
process.env.SESSION_SECRET = 'test-secret-test-secret-test-secret';

test('public dashboard exposes global market data but protects the connected account', async () => {
  const [{ default: Fastify }, { default: cookie }, hubMod, marketMod, feedMod, clientMod, autoMod, paperMod, routesMod, store, cfg] =
    await Promise.all([
      import('fastify'),
      import('@fastify/cookie'),
      import('../src/api/hub.ts'),
      import('../src/core/marketState.ts'),
      import('../src/deriv/publicFeed.ts'),
      import('../src/deriv/privateClient.ts'),
      import('../src/strategy/automation.ts'),
      import('../src/simulation/paperSimulator.ts'),
      import('../src/api/routes.ts'),
      import('../src/db/store.ts'),
      import('../src/config.ts'),
    ]);
  const previousToken = cfg.config.dashboardAdminToken;
  cfg.config.dashboardAdminToken = 'owner-test-token';

  const app = Fastify();
  await app.register(cookie, { secret: cfg.config.sessionSecret });
  const hub = new hubMod.Hub();
  const registry = new marketMod.MarketRegistry({ onTick: () => undefined });
  const feed = new feedMod.DerivPublicFeed(registry, () => undefined);
  const client = new clientMod.DerivPrivateClient();
  const automation = new autoMod.Automation(registry, client, hub);
  const paperSimulator = new paperMod.PaperSimulator();
  routesMod.registerApi(app, { registry, feed, client, hub, automation, paperSimulator });

  store.setSession({
    id: 'public-test-session', loginid: 'CR123', balance: 123.45, currency: 'USD', mode: 'demo', auth_kind: 'pat',
    token_cipher: 'private', created_at: Date.now(), updated_at: Date.now(),
  });
  store.insertTrade({
    ts: Date.now(), market: 'R_10', contract_type: 'DIGITOVER', barrier: 0, duration: 1, duration_unit: 't',
    stake: 2, ask_price: 2, payout: 3.8, est_win: 0.8, profit: 1.8, status: 'won',
    contract_id: 'private-contract', purchase_id: 'private-trade', reason: 'test',
  });

  const guest = await app.inject({ method: 'GET', url: '/api/state' });
  assert.equal(guest.statusCode, 200);
  assert.equal(guest.json().session, null);
  assert.deepEqual(guest.json().trades, []);
  assert.equal(guest.json().performance.profit, 0);
  assert.equal(guest.json().public_dashboard, true);
  assert.equal(guest.json().paperSimulation.phase, 'idle');

  const guestWrite = await app.inject({ method: 'PUT', url: '/api/settings', payload: { base_stake: 99 } });
  assert.equal(guestWrite.statusCode, 403);
  const guestLedger = await app.inject({ method: 'GET', url: '/api/ledger' });
  assert.deepEqual(guestLedger.json().entries, []);
  const guestPaper = await app.inject({ method: 'POST', url: '/api/paper/start' });
  assert.equal(guestPaper.statusCode, 403);

  const unlock = await app.inject({ method: 'POST', url: '/api/auth/owner', payload: { token: 'owner-test-token' } });
  assert.equal(unlock.statusCode, 200);
  const cookieHeader = String(unlock.headers['set-cookie']).split(';', 1)[0];
  const owner = await app.inject({ method: 'GET', url: '/api/state', headers: { cookie: cookieHeader } });
  assert.equal(owner.json().session.loginid, 'CR123');
  assert.equal(owner.json().trades.length, 1);
  const ownerLedger = await app.inject({ method: 'GET', url: '/api/ledger', headers: { cookie: cookieHeader } });
  assert.equal(ownerLedger.json().entries.length, 1);
  assert.equal(ownerLedger.json().entries[0].book, 'account');

  const invalidOver = await app.inject({
    method: 'POST', url: '/api/trade/manual', headers: { cookie: cookieHeader },
    payload: { market: 'R_10', direction: 'over', barrier: 9, stake: 1 },
  });
  assert.equal(invalidOver.statusCode, 400);
  assert.match(invalidOver.json().error, /0 to 8/);
  const invalidUnder = await app.inject({
    method: 'POST', url: '/api/trade/manual', headers: { cookie: cookieHeader },
    payload: { market: 'R_10', direction: 'under', barrier: 0, stake: 1 },
  });
  assert.equal(invalidUnder.statusCode, 400);
  assert.match(invalidUnder.json().error, /1 to 9/);

  const startPaper = await app.inject({ method: 'POST', url: '/api/paper/start', headers: { cookie: cookieHeader } });
  assert.equal(startPaper.statusCode, 200);
  assert.equal(startPaper.json().state.phase, 'running');
  assert.equal(client.isConnected, false, 'pure paper start must not open a private account session');
  const oldSweep = await app.inject({ method: 'POST', url: '/api/test/paper', headers: { cookie: cookieHeader } });
  assert.equal(oldSweep.statusCode, 410);

  automation.dispose();
  await app.close();
  cfg.config.dashboardAdminToken = previousToken;
});
