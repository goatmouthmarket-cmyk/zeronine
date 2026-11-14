import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import WebSocket from 'ws';
import type { DerivPrivateClient as PrivateClientType } from '../src/deriv/privateClient.ts';

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'pasture-player-trading-'));
process.env.SESSION_SECRET = 'test-player-trading-secret-32-characters';

test('two signed players and the owner trade only their accounts, including manual recovery debt at its cap', async () => {
  const [{ default: Fastify }, { default: cookie }, { default: websocket }, { registerPlayerTrading }, { DerivPrivateClient }, { MarketRegistry }, { config }, { setSession, updateSettings }, { encryptToken }] = await Promise.all([
    import('fastify'), import('@fastify/cookie'), import('@fastify/websocket'),
    import('../src/api/playerTrading.ts'), import('../src/deriv/privateClient.ts'), import('../src/core/marketState.ts'),
    import('../src/config.ts'), import('../src/db/store.ts'), import('../src/db/crypto.ts'),
  ]);
  const originalAdminToken = config.dashboardAdminToken;
  config.dashboardAdminToken = 'test-owner-dashboard-token';
  updateSettings({ max_recovery_debt: 1, max_recovery_exposure: 1, max_consecutive_losses: 1, max_drawdown_pct: 1 });
  const originalFetch = globalThis.fetch;
  const originalConnect = DerivPrivateClient.prototype.connect;
  const originalQuote = DerivPrivateClient.prototype.getQuote;
  const originalBuy = DerivPrivateClient.prototype.placeBuy;
  const originalPortfolio = DerivPrivateClient.prototype.getOpenContractIds;
  const originalSnapshot = DerivPrivateClient.prototype.getContractSnapshot;
  const connected = new WeakMap<PrivateClientType, string>();
  const bought: string[] = [];
  let bobBalance = 100;
  let quotes = 0;
  const active = new Map<string, { id: string; status: string; provider_contract_id: string | null }>();
  const sessions = new Map([['secret-alice', { accountId: 'VRTC111', token: 'token-alice' }], ['secret-bob', { accountId: 'VRTC222', token: 'token-bob' }]]);
  const store = {
    resolveSession: async (secret: string) => sessions.get(secret) ?? null,
    riskSnapshot: async () => ({ mode: 'recovering', streak: 1, debt: 1, attempts: 1, cycleStake: 1, peakBalance: 200 }),
    activeContract: async (accountId: string) => active.get(accountId) ?? null,
    listTrades: async (accountId: string) => [...active.entries()].filter(([id]) => id === accountId).map(([id, row]) => ({ ...row, account_id: id })),
    reserve: async (accountId: string, key: string) => {
      if (active.has(accountId)) throw new Error('account already reserved');
      const id = `${accountId}-${key}`;
      active.set(accountId, { id, status: 'purchasing', provider_contract_id: null });
      return id;
    },
    markPurchased: async (accountId: string, id: string, contractId: string) => {
      assert.equal(active.get(accountId)?.id, id);
      active.set(accountId, { id, status: 'open', provider_contract_id: contractId });
    },
    markUnknown: async (accountId: string, id: string) => { active.set(accountId, { id, status: 'unknown', provider_contract_id: null }); },
    cancelBeforeBuy: async (accountId: string) => { active.delete(accountId); },
    recordSettlement: async (accountId: string) => { active.delete(accountId); },
  };
  globalThis.fetch = (async (_url: unknown, options?: RequestInit) => {
    const token = (options?.headers as Record<string, string>).Authorization;
    const accountId = token.endsWith('alice') ? 'VRTC111' : token.endsWith('owner') ? 'VRTC333' : 'VRTC222';
    return Response.json({ data: [{ account_id: accountId, account_type: 'demo', currency: 'USD', balance: accountId === 'VRTC222' ? bobBalance : 100 }] });
  }) as typeof fetch;
  DerivPrivateClient.prototype.connect = async function (_token, accountId) { connected.set(this, accountId!); return { loginid: accountId!, balance: 100, currency: 'USD', mode: 'demo' }; };
  Object.defineProperty(DerivPrivateClient.prototype, 'isConnected', { configurable: true, get() { return connected.has(this); } });
  Object.defineProperty(DerivPrivateClient.prototype, 'connectedAccountId', { configurable: true, get() { return connected.get(this) ?? null; } });
  DerivPrivateClient.prototype.getOpenContractIds = async () => new Set();
  DerivPrivateClient.prototype.getQuote = async function (args) { quotes++; return { id: `quote-${args.symbol}`, askPrice: args.amount, payout: args.amount * 2, spot: 100, barrier: args.barrier, direction: args.direction, requestSentAt: Date.now(), receivedAt: Date.now(), roundTripMs: 1, basis: 'stake' }; };
  DerivPrivateClient.prototype.placeBuy = async function () { const id = connected.get(this)!; bought.push(id); return { contractId: `${id}-contract`, buyPrice: 1, payout: 2, purchaseTime: Date.now() }; };
  DerivPrivateClient.prototype.getContractSnapshot = async () => ({ contractId: 'open', status: 'open', profit: 0, sellPrice: 0, buyPrice: 1, settled: false });

  const app = Fastify();
  let aliceSocket: WebSocket | null = null;
  let bobSocket: WebSocket | null = null;
  try {
    await app.register(cookie, { secret: process.env.SESSION_SECRET });
    await app.register(websocket);
    app.get('/test/cookie/:name', (req, reply) => { const name = (req.params as { name: string }).name; reply.setCookie('deriv_cows_session', `secret-${name}`, { signed: true, path: '/' }); return { ok: true }; });
    app.get('/test/owner-cookie', (_req, reply) => { reply.setCookie('zeronine_owner', config.dashboardAdminToken, { signed: true, path: '/' }); return { ok: true }; });
    const registry = new MarketRegistry({ onTick: () => undefined });
    // The shared market is fresh and has a known digit sample.
    (registry as unknown as { has: (symbol: string) => boolean; snapshot: (symbol: string) => unknown }).has = () => true;
    (registry as unknown as { snapshot: (symbol: string) => unknown }).snapshot = () => ({ fresh: true, recentDigits: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], dist: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1] });
    registerPlayerTrading(app, store as never, registry);
    const cookieFor = async (name: string) => String((await app.inject({ method: 'GET', url: `/test/cookie/${name}` })).headers['set-cookie']).split(';', 1)[0];
    const alice = await cookieFor('alice'), bob = await cookieFor('bob');
    await app.listen({ port: 0, host: '127.0.0.1' });
    const address = app.server.address();
    assert.ok(address && typeof address !== 'string');
    const receivedAlice: string[] = [], receivedBob: string[] = [];
    const connectPlayer = async (cookieHeader: string, received: string[]) => {
      const socket = new WebSocket(`ws://127.0.0.1:${address.port}/player-ws`, { headers: { cookie: cookieHeader } });
      await new Promise<void>((resolve, reject) => {
        socket.on('message', data => { const type = JSON.parse(data.toString()).type; received.push(type); if (type === 'hello') resolve(); });
        socket.once('error', reject);
      });
      return socket;
    };
    aliceSocket = await connectPlayer(alice, receivedAlice);
    bobSocket = await connectPlayer(bob, receivedBob);
    const order = { market: 'R_10', direction: 'over', barrier: 0, stake: 1, minEdge: 0 };
    const beforeZero = await app.inject({ method: 'POST', url: '/api/player/trade/preview', headers: { cookie: bob }, payload: order });
    assert.equal(beforeZero.statusCode, 200, beforeZero.body);
    bobBalance = 0;
    const zeroState = await app.inject({ method: 'GET', url: '/api/player/trading/state', headers: { cookie: bob } });
    assert.equal(zeroState.statusCode, 200, zeroState.body);
    assert.equal(zeroState.json().session.balance, 0, 'zero-balance account remains visible');
    const previousQuotes = quotes;
    const zeroPreview = await app.inject({ method: 'POST', url: '/api/player/trade/preview', headers: { cookie: bob }, payload: order });
    assert.notEqual(zeroPreview.statusCode, 200, 'zero-balance account cannot obtain a trade quote');
    const zeroConfirm = await app.inject({ method: 'POST', url: '/api/player/trade/confirm', headers: { cookie: bob }, payload: { previewId: beforeZero.json().previewId, idempotencyKey: 'zero-balance-0001' } });
    assert.notEqual(zeroConfirm.statusCode, 200, 'a previous quote cannot be purchased after balance falls to zero');
    assert.equal(quotes, previousQuotes, 'zero balance stops both paths before requesting a quote');
    assert.deepEqual(bought, [], 'zero balance never places an order');
    bobBalance = 100;
    const preview = await app.inject({ method: 'POST', url: '/api/player/trade/preview', headers: { cookie: alice }, payload: order });
    assert.equal(preview.statusCode, 200, preview.body);
    const previewId = preview.json().previewId;
    const stolen = await app.inject({ method: 'POST', url: '/api/player/trade/confirm', headers: { cookie: bob }, payload: { previewId, idempotencyKey: 'bob-request-0001' } });
    assert.equal(stolen.statusCode, 403);
    assert.deepEqual(bought, []);
    const own = await app.inject({ method: 'POST', url: '/api/player/trade/confirm', headers: { cookie: alice }, payload: { previewId, idempotencyKey: 'alice-request-0001' } });
    assert.equal(own.statusCode, 200, own.body);
    assert.deepEqual(bought, ['VRTC111']);
    await new Promise(resolve => setTimeout(resolve, 30));
    assert.deepEqual(receivedAlice, ['hello', 'trade']);
    assert.deepEqual(receivedBob, ['hello']);
    const duplicate = await app.inject({ method: 'POST', url: '/api/player/trade/preview', headers: { cookie: alice }, payload: order });
    assert.equal(duplicate.statusCode, 409);
    const bobPreview = await app.inject({ method: 'POST', url: '/api/player/trade/preview', headers: { cookie: bob }, payload: order });
    assert.equal(bobPreview.statusCode, 200, bobPreview.body);
    // MAX_STAKE sizes automation only; an explicit pasture order is held to the
    // account balance rail instead of the bot's stake cap.
    const aboveBotCap = await app.inject({ method: 'POST', url: '/api/player/trade/preview', headers: { cookie: bob }, payload: { ...order, stake: 26 } });
    assert.equal(aboveBotCap.statusCode, 200, aboveBotCap.body);
    const bobState = await app.inject({ method: 'GET', url: '/api/player/trading/state', headers: { cookie: bob } });
    assert.equal(bobState.json().session.loginid, 'VRTC222');
    assert.equal(bobState.json().risk.debt, 1);
    assert.deepEqual(bobState.json().trades, []);
    setSession({ id: 'owner-test', loginid: 'VRTC333', balance: 100, currency: 'USD', mode: 'demo', auth_kind: 'pat', token_cipher: encryptToken('token-owner'), created_at: Date.now(), updated_at: Date.now() });
    const ownerCookie = String((await app.inject({ method: 'GET', url: '/test/owner-cookie' })).headers['set-cookie']).split(';', 1)[0];
    const ownerState = await app.inject({ method: 'GET', url: '/api/player/trading/state', headers: { cookie: ownerCookie } });
    assert.equal(ownerState.statusCode, 200, ownerState.body);
    assert.equal(ownerState.json().session.loginid, 'VRTC333');
    assert.equal(ownerState.json().risk.debt, 1);
    const ownerPreview = await app.inject({ method: 'POST', url: '/api/player/trade/preview', headers: { cookie: ownerCookie }, payload: order });
    assert.equal(ownerPreview.statusCode, 200, ownerPreview.body);
    const ownerStolen = await app.inject({ method: 'POST', url: '/api/player/trade/confirm', headers: { cookie: alice }, payload: { previewId: ownerPreview.json().previewId, idempotencyKey: 'alice-request-0002' } });
    assert.equal(ownerStolen.statusCode, 403);
    const ownerBuy = await app.inject({ method: 'POST', url: '/api/player/trade/confirm', headers: { cookie: ownerCookie }, payload: { previewId: ownerPreview.json().previewId, idempotencyKey: 'owner-request-0001' } });
    assert.equal(ownerBuy.statusCode, 200, ownerBuy.body);
    assert.deepEqual(bought, ['VRTC111', 'VRTC333']);
    setSession({ id: 'owner-switched', loginid: 'VRTC222', balance: 100, currency: 'USD', mode: 'demo', auth_kind: 'pat', token_cipher: encryptToken('token-bob'), created_at: Date.now(), updated_at: Date.now() });
    const switchedState = await app.inject({ method: 'GET', url: '/api/player/trading/state', headers: { cookie: ownerCookie } });
    assert.equal(switchedState.json().session.loginid, 'VRTC222');
    const switchedOwnerPreview = await app.inject({ method: 'POST', url: '/api/player/trade/preview', headers: { cookie: ownerCookie }, payload: order });
    assert.equal(switchedOwnerPreview.statusCode, 200, switchedOwnerPreview.body);
    setSession({ id: 'owner-switched-back', loginid: 'VRTC333', balance: 100, currency: 'USD', mode: 'demo', auth_kind: 'pat', token_cipher: encryptToken('token-owner'), created_at: Date.now(), updated_at: Date.now() });
    const staleOwnerConfirm = await app.inject({ method: 'POST', url: '/api/player/trade/confirm', headers: { cookie: ownerCookie }, payload: { previewId: switchedOwnerPreview.json().previewId, idempotencyKey: 'owner-request-0002' } });
    assert.equal(staleOwnerConfirm.statusCode, 403);
    assert.deepEqual(bought, ['VRTC111', 'VRTC333']);
  } finally {
    aliceSocket?.close();
    bobSocket?.close();
    await app.close();
    globalThis.fetch = originalFetch;
    DerivPrivateClient.prototype.connect = originalConnect;
    DerivPrivateClient.prototype.getQuote = originalQuote;
    DerivPrivateClient.prototype.placeBuy = originalBuy;
    DerivPrivateClient.prototype.getOpenContractIds = originalPortfolio;
    DerivPrivateClient.prototype.getContractSnapshot = originalSnapshot;
    config.dashboardAdminToken = originalAdminToken;
  }
});
