import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'overunder-public-dashboard-'));
process.env.SESSION_SECRET = 'test-secret-test-secret-test-secret';

test('public dashboard exposes global market data but protects the connected account', async () => {
  const [{ default: Fastify }, { default: cookie }, hubMod, marketMod, feedMod, clientMod, autoMod, paperMod, routesMod, store, cfg, telemetryMod] =
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
      import('../src/telemetry/service.ts'),
    ]);
  const previousToken = cfg.config.dashboardAdminToken;
  const previousPublicLogin = cfg.config.allowPublicDerivLogin;
  cfg.config.dashboardAdminToken = 'owner-test-token';
  cfg.config.allowPublicDerivLogin = false;

  const app = Fastify();
  await app.register(cookie, { secret: cfg.config.sessionSecret });
  const hub = new hubMod.Hub();
  const registry = new marketMod.MarketRegistry({ onTick: () => undefined });
  const feed = new feedMod.DerivPublicFeed(registry, () => undefined);
  const client = new clientMod.DerivPrivateClient();
  const automation = new autoMod.Automation(registry, client, hub);
  const paperSimulator = new paperMod.PaperSimulator();
  const telemetry = new telemetryMod.TelemetryService(path.join(cfg.config.dataDir, 'test-telemetry.db'), 30);
  routesMod.registerApi(app, { registry, feed, client, hub, automation, paperSimulator, telemetry });

  store.setSession({
    id: 'public-test-session', loginid: 'CR123', balance: 123.45, currency: 'USD', mode: 'demo', auth_kind: 'pat',
    token_cipher: 'private', created_at: Date.now(), updated_at: Date.now(),
  });
  store.insertTrade({
    ts: Date.now(), market: 'R_10', contract_type: 'DIGITOVER', barrier: 0, duration: 1, duration_unit: 't',
    stake: 2, ask_price: 2, payout: 3.8, est_win: 0.8, profit: 1.8, status: 'won',
    contract_id: 'private-contract', purchase_id: 'private-trade', reason: 'test',
  });

  const priorEnv = cfg.config.nodeEnv;
  cfg.config.nodeEnv = 'production';
  cfg.config.dashboardAdminToken = '';
  const unconfiguredGuest = await app.inject({ method: 'GET', url: '/api/state' });
  assert.equal(unconfiguredGuest.json().session, null, 'production without an owner token must fail closed');
  assert.equal(unconfiguredGuest.json().owner, false);
  const emptyUnlock = await app.inject({ method: 'POST', url: '/api/auth/owner', payload: { token: '' } });
  assert.equal(emptyUnlock.statusCode, 401, 'an empty token must not unlock the owner account');
  cfg.config.nodeEnv = priorEnv;
  cfg.config.dashboardAdminToken = 'owner-test-token';

  const guest = await app.inject({ method: 'GET', url: '/api/state' });
  assert.equal(guest.statusCode, 200);
  assert.equal(guest.json().session, null);
  assert.equal(guest.json().settings, null);
  assert.equal(guest.json().gold, null);
  assert.equal(guest.json().momentum, null);
  assert.equal((await app.inject({ method: 'GET', url: '/api/settings' })).statusCode, 403);
  assert.equal((await app.inject({ method: 'GET', url: '/api/calibration' })).statusCode, 403);
  assert.equal((await app.inject({ method: 'GET', url: '/api/test/evidence' })).statusCode, 403);
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
  assert.equal((await app.inject({ method: 'GET', url: '/api/telemetry/events' })).statusCode, 403);
  assert.equal((await app.inject({ method: 'POST', url: '/api/telemetry/paper', payload: {} })).statusCode, 403);

  const blockedOAuth = await app.inject({ method: 'GET', url: '/api/auth/oauth/start' });
  assert.equal(blockedOAuth.statusCode, 403);

  cfg.config.allowPublicDerivLogin = true;
  const oauthStart = await app.inject({ method: 'GET', url: '/api/auth/oauth/start' });
  assert.equal(oauthStart.statusCode, 200);
  const oauthUrl = new URL(oauthStart.json().url);
  const oauthState = oauthUrl.searchParams.get('state');
  assert.ok(oauthState);
  const oauthCookie = String(oauthStart.headers['set-cookie']).split(';', 1)[0];
  client.connect = async () => ({ loginid: 'VRTC123', balance: 100, currency: 'USD', mode: 'demo' });
  const oauthCallback = await app.inject({
    method: 'GET',
    url: `/api/auth/oauth/callback?state=${oauthState}&token1=oauth-test-token`,
    headers: { cookie: oauthCookie },
  });
  assert.equal(oauthCallback.statusCode, 302);
  assert.equal(oauthCallback.headers.location, '/?oauth=ok');
  assert.match(String(oauthCallback.headers['set-cookie']), /zeronine_owner=/);
  store.setSession({
    id: 'public-test-session', loginid: 'CR123', balance: 123.45, currency: 'USD', mode: 'demo', auth_kind: 'pat',
    token_cipher: 'private', created_at: Date.now(), updated_at: Date.now(),
  });

  const unlock = await app.inject({ method: 'POST', url: '/api/auth/owner', payload: { token: 'owner-test-token' } });
  assert.equal(unlock.statusCode, 200);
  const cookieHeader = String(unlock.headers['set-cookie']).split(';', 1)[0];
  const owner = await app.inject({ method: 'GET', url: '/api/state', headers: { cookie: cookieHeader } });
  assert.equal(owner.json().session.loginid, 'CR123');
  assert.equal(owner.json().trades.length, 1);
  const ownerLedger = await app.inject({ method: 'GET', url: '/api/ledger', headers: { cookie: cookieHeader } });
  assert.equal(ownerLedger.json().entries.length, 1);
  assert.equal(ownerLedger.json().entries[0].book, 'account');
  const paperEvent = { eventId: 'session:trade-1', source: 'manual_paper', market: 'R_10', direction: 'over', barrier: 2, status: 'won', entryDigit: 1, exitDigit: 5, entryEpoch: 100, entryQuote: 100.1, estWin: .75, edge: .03, exitEpoch: 101, token: 'must-not-be-recorded' };
  assert.equal((await app.inject({ method: 'POST', url: '/api/telemetry/paper', headers: { cookie: cookieHeader }, payload: paperEvent })).statusCode, 200);
  assert.equal((await app.inject({ method: 'POST', url: '/api/telemetry/paper', headers: { cookie: cookieHeader }, payload: { ...paperEvent, exitDigit: 15 } })).statusCode, 400);
  const batch = await app.inject({ method: 'POST', url: '/api/telemetry/paper', headers: { cookie: cookieHeader }, payload: { events: [paperEvent, { ...paperEvent, eventId: 'session:trade-2' }] } });
  assert.equal(batch.statusCode, 200);
  assert.equal(batch.json().accepted, 2);
  const deadline = Date.now() + 5000;
  while (telemetry.status().written < 3 && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 20));
  const exported = await app.inject({ method: 'GET', url: '/api/telemetry/events?limit=1', headers: { cookie: cookieHeader } });
  assert.equal(exported.statusCode, 200);
  assert.equal(exported.json().events[0].source, 'manual_paper');
  assert.doesNotMatch(exported.body, /must-not-be-recorded/);

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
  await telemetry.close();
  await app.close();
  cfg.config.dashboardAdminToken = previousToken;
  cfg.config.allowPublicDerivLogin = previousPublicLogin;
});
