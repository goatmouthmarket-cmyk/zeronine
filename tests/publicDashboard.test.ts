import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import { randomBytes } from 'node:crypto';

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
  const playerSessions = new Map<string, { accountId: string; token: string; expiresAt: number }>();
  const multiplayerStore = {
    createSession: async (accountId: string, token: string, expiresAt: number) => {
      const secret = randomBytes(32).toString('base64url');
      playerSessions.set(secret, { accountId, token, expiresAt });
      return secret;
    },
    resolveSession: async (secret: string | null) => secret ? playerSessions.get(secret) ?? null : null,
    revokeSession: async (secret: string | null) => { if (secret) playerSessions.delete(secret); },
  };
  routesMod.registerApi(app, { registry, feed, client, hub, automation, paperSimulator, telemetry, multiplayerStore: multiplayerStore as never });

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
  const guestBrain = await app.inject({ method: 'GET', url: '/api/ranger-brain/status' });
  assert.equal(guestBrain.statusCode, 200, 'the paper brain is readable without owner access');
  assert.equal(guestBrain.json().report.mode, 'paper');
  assert.doesNotMatch(guestBrain.body, /loginid|balance|token/i);
  const guestLedger = await app.inject({ method: 'GET', url: '/api/ledger' });
  assert.deepEqual(guestLedger.json().entries, []);
  const guestPaper = await app.inject({ method: 'POST', url: '/api/paper/start' });
  assert.equal(guestPaper.statusCode, 403);
  assert.equal((await app.inject({ method: 'GET', url: '/api/telemetry/events' })).statusCode, 403);
  assert.equal((await app.inject({ method: 'POST', url: '/api/telemetry/paper', payload: {} })).statusCode, 403);

  const blockedOAuth = await app.inject({ method: 'GET', url: '/api/auth/oauth/start' });
  assert.equal(blockedOAuth.statusCode, 403);

  cfg.config.allowPublicDerivLogin = true;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL | Request, options?: RequestInit) => {
    if (String(url) === cfg.config.oauthTokenUrl) {
      const code = new URLSearchParams(String(options?.body)).get('code');
      return Response.json({ access_token: `token-${code}`, expires_in: 3600 });
    }
    if (String(url).includes('/accounts')) {
      const auth = (options?.headers as Record<string, string>).Authorization;
      const id = auth.endsWith('alice') ? 'VRTC111' : 'VRTC222';
      const accounts = [{ account_id: id, account_type: 'demo', currency: 'USD', balance: id === 'VRTC111' ? 111 : 222 }];
      if (id === 'VRTC111') accounts.push({ account_id: 'CR111', account_type: 'real', currency: 'USD', balance: 25 });
      return Response.json({ data: accounts });
    }
    throw new Error('unexpected request');
  }) as typeof fetch;
  const signIn = async (code: string): Promise<string> => {
    const start = await app.inject({ method: 'GET', url: '/api/auth/oauth/start' });
    assert.equal(start.statusCode, 200);
    const state = new URL(start.json().url).searchParams.get('state');
    const cookie = String(start.headers['set-cookie']).split(';', 1)[0];
    const callback = await app.inject({ method: 'GET', url: `/api/auth/oauth/callback?state=${state}&code=${code}`, headers: { cookie } });
    assert.equal(callback.headers.location, '/?oauth=player');
    const cookies = Array.isArray(callback.headers['set-cookie']) ? callback.headers['set-cookie'] : [String(callback.headers['set-cookie'])];
    const player = cookies.find(value => value.startsWith('deriv_cows_session='));
    assert.ok(player);
    assert.ok(!cookies.some(value => value.startsWith('zeronine_owner=')));
    return player.split(';', 1)[0];
  };
  const alice = await signIn('alice');
  const bob = await signIn('bob');
  const profileUrl = '/api/player/ranger-profile';
  const profile = (accountId: string, name: string) => ({ accountId, name, appearance: { outfit: 'hoodie', color: '#123456', accent: '#abcdef', headwear: 'hood', accessory: 'cape' } });
  assert.equal((await app.inject({ method: 'GET', url: profileUrl })).statusCode, 401);
  assert.equal((await app.inject({ method: 'PUT', url: profileUrl, payload: profile('VRTC111', 'Guest') })).statusCode, 401);
  assert.equal((await app.inject({ method: 'PUT', url: profileUrl, headers: { cookie: alice }, payload: profile('VRTC111', 'Alice') })).statusCode, 200);
  assert.equal((await app.inject({ method: 'PUT', url: profileUrl, headers: { cookie: bob }, payload: profile('VRTC222', 'Bob') })).statusCode, 200);
  const aliceRead = await app.inject({ method: 'GET', url: `${profileUrl}?accountId=VRTC222`, headers: { cookie: alice } });
  assert.equal(aliceRead.json().accountId, 'VRTC111');
  assert.equal(aliceRead.json().profile.name, 'Alice', 'a client-supplied account cannot select another profile');
  assert.match(String(aliceRead.headers['cache-control']), /no-store/);
  assert.equal((await app.inject({ method: 'PUT', url: profileUrl, headers: { cookie: alice }, payload: profile('VRTC222', 'Impostor') })).statusCode, 409);
  assert.equal((await app.inject({ method: 'PUT', url: profileUrl, headers: { cookie: alice, origin: 'https://attacker.example' }, payload: profile('VRTC111', 'Impostor') })).statusCode, 403);
  assert.equal((await app.inject({ method: 'GET', url: profileUrl, headers: { cookie: bob } })).json().profile.name, 'Bob');
  const profileUnlock = await app.inject({ method: 'POST', url: '/api/auth/owner', payload: { token: 'owner-test-token' } });
  const ownerCookie = String(profileUnlock.headers['set-cookie']).split(';', 1)[0];
  const bothCookies = `${ownerCookie}; ${alice}`;
  const ownerProfile = await app.inject({ method: 'GET', url: profileUrl, headers: { cookie: bothCookies } });
  assert.equal(ownerProfile.json().accountId, 'CR123', 'the owner session is the effective account when both cookies exist');
  assert.equal(ownerProfile.json().profile, null);
  assert.equal((await app.inject({ method: 'PUT', url: profileUrl, headers: { cookie: bothCookies }, payload: profile('VRTC111', 'Stale') })).statusCode, 409);
  assert.equal((await app.inject({ method: 'PUT', url: profileUrl, headers: { cookie: bothCookies }, payload: profile('CR123', 'Owner') })).statusCode, 200);
  assert.equal((await app.inject({ method: 'GET', url: profileUrl, headers: { cookie: alice } })).json().profile.name, 'Alice');
  assert.equal((await app.inject({ method: 'GET', url: '/api/player/session', headers: { cookie: alice } })).json().session.balance, 111);
  assert.equal((await app.inject({ method: 'GET', url: '/api/player/session', headers: { cookie: bob } })).json().session.balance, 222);
  assert.equal((await app.inject({ method: 'GET', url: '/api/state', headers: { cookie: alice } })).json().session, null);
  const options = await app.inject({ method: 'GET', url: '/api/player/accounts', headers: { cookie: alice } });
  assert.deepEqual(options.json().accounts.map((account: { accountId: string; mode: string }) => [account.accountId, account.mode]), [['VRTC111', 'demo'], ['CR111', 'real']]);
  const unauthorizedSwitch = await app.inject({ method: 'POST', url: '/api/player/accounts/select', headers: { cookie: alice }, payload: { accountId: 'VRTC222' } });
  assert.equal(unauthorizedSwitch.statusCode, 403, 'another player account must not be selectable');
  const selectedReal = await app.inject({ method: 'POST', url: '/api/player/accounts/select', headers: { cookie: alice }, payload: { accountId: 'CR111' } });
  assert.equal(selectedReal.statusCode, 200, selectedReal.body);
  const realCookie = String(selectedReal.headers['set-cookie']).split(';', 1)[0];
  assert.equal((await app.inject({ method: 'GET', url: '/api/player/session', headers: { cookie: alice } })).statusCode, 401, 'old player session is revoked');
  const realSession = await app.inject({ method: 'GET', url: '/api/player/session', headers: { cookie: realCookie } });
  assert.equal(realSession.json().session.loginid, 'CR111');
  assert.equal(realSession.json().session.mode, 'real');
  assert.equal((await app.inject({ method: 'GET', url: '/api/player/session', headers: { cookie: bob } })).json().session.loginid, 'VRTC222', 'another player remains isolated');
  const selectedDemo = await app.inject({ method: 'POST', url: '/api/player/accounts/select', headers: { cookie: realCookie }, payload: { accountId: 'VRTC111' } });
  assert.equal(selectedDemo.statusCode, 200, selectedDemo.body);
  const newAlice = String(selectedDemo.headers['set-cookie']).split(';', 1)[0];
  assert.equal((await app.inject({ method: 'GET', url: '/api/player/session', headers: { cookie: newAlice } })).json().session.mode, 'demo');
  assert.equal(store.getSession()?.loginid, 'CR123', 'player selection must not alter owner account');
  await app.inject({ method: 'POST', url: '/api/player/logout', headers: { cookie: newAlice } });
  assert.equal((await app.inject({ method: 'GET', url: '/api/player/session', headers: { cookie: alice } })).statusCode, 401);
  assert.equal((await app.inject({ method: 'GET', url: '/api/player/session', headers: { cookie: bob } })).statusCode, 200);
  assert.equal(store.getSession()?.loginid, 'CR123');
  globalThis.fetch = originalFetch;

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

  const epoch = Math.floor(Date.now() / 1000);
  store.appendPaperLedgerEntry({ id: 991, runId: 'memory-route-test', market: 'R_75', direction: 'over', barrier: 0, stake: 1, payoutRatio: 1.9, status: 'won', entryEpoch: epoch - 3, entryQuote: 100, entryDigit: 1, exitEpoch: epoch - 2, exitQuote: 101, exitDigit: 2, profit: .9, estWin: .9 }, 'settled');
  store.getDb().exec("CREATE TRIGGER fail_brain_memory BEFORE INSERT ON brain_memory_events BEGIN SELECT RAISE(FAIL, 'test write failure'); END");
  const memoryFailure = await app.inject({ method: 'GET', url: '/api/ranger-brain/status?market=R_75&lookbackDays=30' });
  assert.equal(memoryFailure.statusCode, 200, 'memory persistence failure must not prevent a paper report');
  assert.equal(memoryFailure.json().memoryAvailable, false);
  assert.equal(memoryFailure.json().report.mode, 'paper');
  store.getDb().exec('DROP TRIGGER fail_brain_memory');
  const memoryRecovered = await app.inject({ method: 'GET', url: '/api/ranger-brain/status?market=R_75' });
  assert.equal(memoryRecovered.statusCode, 200);
  assert.equal(memoryRecovered.json().memoryAvailable, true);
  assert.ok(memoryRecovered.json().memoryHistory.length > 0);
  assert.doesNotMatch(memoryRecovered.body, /loginid|balance|token/i);

  automation.dispose();
  await telemetry.close();
  await app.close();
  cfg.config.dashboardAdminToken = previousToken;
  cfg.config.allowPublicDerivLogin = previousPublicLogin;
});
