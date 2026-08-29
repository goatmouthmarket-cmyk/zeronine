import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import test from 'node:test';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'overunder-momentum-trade-'));
process.env.SESSION_SECRET = 'test-secret-test-secret-test-secret';

test('Momentum multiplier proposal uses a multiplier contract without a digit barrier', async () => {
  const { multiplierProposal } = await import('../src/core/digitMath.ts');
  assert.deepEqual(multiplierProposal({
    direction: 'down', amount: 3.25, currency: 'USD', symbol: 'R_100', multiplier: 20, reqId: 44,
  }), {
    proposal: 1, req_id: 44, amount: 3.25, basis: 'stake', contract_type: 'MULTDOWN',
    currency: 'USD', underlying_symbol: 'R_100', multiplier: 20,
  });
});

test('explicit Momentum trade is demo-only and records the selected research contract', async () => {
  const [{ default: Fastify }, hubMod, marketMod, feedMod, autoMod, paperMod, routesMod, store, cfg] = await Promise.all([
    import('fastify'),
    import('../src/api/hub.ts'),
    import('../src/core/marketState.ts'),
    import('../src/deriv/publicFeed.ts'),
    import('../src/strategy/automation.ts'),
    import('../src/simulation/paperSimulator.ts'),
    import('../src/api/routes.ts'),
    import('../src/db/store.ts'),
    import('../src/config.ts'),
  ]);
  cfg.config.dashboardAdminToken = '';
  store.setSession({
    id: 'momentum-demo', loginid: 'VRTC_MOMENTUM', balance: 250, currency: 'USD', mode: 'demo', auth_kind: 'pat',
    token_cipher: 'x', created_at: Date.now(), updated_at: Date.now(),
  });

  const hub = new hubMod.Hub();
  const events: Array<Record<string, unknown>> = [];
  hub.on((event) => events.push(event));
  const registry = new marketMod.MarketRegistry({ onTick: () => undefined });
  registry.ensure('R_100');
  const feed = new feedMod.DerivPublicFeed(registry, () => undefined);
  let quoteArgs: Record<string, unknown> | undefined;
  let boughtProposal: string | undefined;
  const client = {
    isConnected: true,
    getQuote: async () => { throw new Error('digit quote must not be used'); },
    getMultiplierQuote: async (args: Record<string, unknown>) => {
      quoteArgs = args;
      return { id: 'multiplier-proposal', askPrice: 3, payout: 6, spot: 750.5, direction: 'up', multiplier: 20 };
    },
    placeBuy: async (proposalId: string) => {
      boughtProposal = proposalId;
      return { contractId: 'momentum-contract', buyPrice: 3, payout: 6 };
    },
    settleContract: async (contractId: string, onUpdate: (update: Record<string, unknown>) => void) => {
      onUpdate({
        contractId,
        status: 'open',
        profit: 0.42,
        sellPrice: 3.42,
        buyPrice: 3,
        settled: false,
      });
      return new Promise(() => undefined);
    },
  };
  const automation = new autoMod.Automation(registry, client as never, hub);
  const momentum = {
    state: () => ({
      running: true,
      phase: 'observing',
      config: { symbol: 'R_100', multiplier: 20, stake: 10, commissionRate: .001 },
      window: {
        signal: { direction: 'up', confidence: 72, reason: 'Upward returns agree across 3 of 3 horizons' },
        decisionSignal: null,
      },
    }),
  };
  const app = Fastify();
  routesMod.registerApi(app, {
    registry, feed, client: client as never, hub, automation,
    paperSimulator: new paperMod.PaperSimulator(), momentum: momentum as never,
  });

  const response = await app.inject({ method: 'POST', url: '/api/momentum/trade', payload: { direction: 'up', stake: 3 } });
  assert.equal(response.statusCode, 200);
  assert.equal(boughtProposal, 'multiplier-proposal');
  assert.deepEqual(quoteArgs, {
    direction: 'up', amount: 3, currency: 'USD', symbol: 'R_100', multiplier: 20,
  });
  const trade = store.getOpenTrade();
  assert.ok(trade);
  assert.equal(trade.contract_type, 'MULTUP');
  assert.equal(trade.account_mode, 'demo');
  assert.equal(trade.duration, 5);
  assert.equal(trade.duration_unit, 'm');
  assert.match(trade.reason, /momentum manual UP/i);
  assert.match(trade.reason, /research UP 72%/i);
  assert.deepEqual(store.listLedgerEntries(10).map((entry) => entry.event), ['purchased', 'requested']);
  const liveContractEvent = events.find((event) => event.type === 'contract' && event.contractId === 'momentum-contract');
  assert.ok(liveContractEvent);
  assert.equal(liveContractEvent.tradeId, trade.id);
  assert.equal(liveContractEvent.profit, 0.42);
  assert.equal(liveContractEvent.sellPrice, 3.42);
  assert.equal(liveContractEvent.phase, 'open');

  const blockedByOpen = await app.inject({ method: 'POST', url: '/api/momentum/trade', payload: { direction: 'down', stake: 3 } });
  assert.equal(blockedByOpen.statusCode, 409);
  assert.match(blockedByOpen.json().error, /open contract/i);

  automation.dispose();
  await app.close();
});

test('Momentum execution rejects real accounts and unfocused research before a proposal', async () => {
  const [{ default: Fastify }, hubMod, marketMod, feedMod, autoMod, paperMod, routesMod, store, cfg] = await Promise.all([
    import('fastify'),
    import('../src/api/hub.ts'),
    import('../src/core/marketState.ts'),
    import('../src/deriv/publicFeed.ts'),
    import('../src/strategy/automation.ts'),
    import('../src/simulation/paperSimulator.ts'),
    import('../src/api/routes.ts'),
    import('../src/db/store.ts'),
    import('../src/config.ts'),
  ]);
  cfg.config.dashboardAdminToken = '';
  const hub = new hubMod.Hub();
  const registry = new marketMod.MarketRegistry({ onTick: () => undefined });
  registry.ensure('R_100');
  const feed = new feedMod.DerivPublicFeed(registry, () => undefined);
  let quoteCalls = 0;
  const client = {
    isConnected: true,
    getQuote: async () => ({ id: 'unused' }),
    getMultiplierQuote: async () => { quoteCalls += 1; return { id: 'unused', askPrice: 1, payout: 2, spot: 1 }; },
    placeBuy: async () => ({ contractId: 'unused', buyPrice: 1, payout: 2 }),
    settleContract: async () => new Promise(() => undefined),
  };
  const automation = new autoMod.Automation(registry, client as never, hub);
  const momentum = { state: () => ({ running: false, phase: 'stopped', config: null, window: null }) };
  const app = Fastify();
  routesMod.registerApi(app, {
    registry, feed, client: client as never, hub, automation,
    paperSimulator: new paperMod.PaperSimulator(), momentum: momentum as never,
  });

  store.setSession({
    id: 'momentum-real', loginid: 'CR_MOMENTUM', balance: 250, currency: 'USD', mode: 'real', auth_kind: 'pat',
    token_cipher: 'x', created_at: Date.now(), updated_at: Date.now(),
  });
  const real = await app.inject({ method: 'POST', url: '/api/momentum/trade', payload: { direction: 'up', stake: 3 } });
  assert.equal(real.statusCode, 403);

  store.setSession({
    id: 'momentum-demo-unfocused', loginid: 'VRTC_UNFOCUSED', balance: 250, currency: 'USD', mode: 'demo', auth_kind: 'pat',
    token_cipher: 'x', created_at: Date.now(), updated_at: Date.now(),
  });
  const unfocused = await app.inject({ method: 'POST', url: '/api/momentum/trade', payload: { direction: 'up', stake: 3 } });
  assert.equal(unfocused.statusCode, 409);
  assert.equal(quoteCalls, 0);

  automation.dispose();
  await app.close();
});

test('Momentum execution rejects a direction that differs from the validated signal', async () => {
  const [{ default: Fastify }, hubMod, marketMod, feedMod, autoMod, paperMod, routesMod, store, cfg] = await Promise.all([
    import('fastify'),
    import('../src/api/hub.ts'),
    import('../src/core/marketState.ts'),
    import('../src/deriv/publicFeed.ts'),
    import('../src/strategy/automation.ts'),
    import('../src/simulation/paperSimulator.ts'),
    import('../src/api/routes.ts'),
    import('../src/db/store.ts'),
    import('../src/config.ts'),
  ]);
  cfg.config.dashboardAdminToken = '';
  store.setSession({
    id: 'momentum-demo-direction', loginid: 'VRTC_DIRECTION', balance: 250, currency: 'USD', mode: 'demo', auth_kind: 'pat',
    token_cipher: 'x', created_at: Date.now(), updated_at: Date.now(),
  });

  const hub = new hubMod.Hub();
  const registry = new marketMod.MarketRegistry({ onTick: () => undefined });
  registry.ensure('R_100');
  const feed = new feedMod.DerivPublicFeed(registry, () => undefined);
  let quoteCalls = 0;
  const client = {
    isConnected: true,
    getQuote: async () => ({ id: 'unused' }),
    getMultiplierQuote: async () => { quoteCalls += 1; return { id: 'unused', askPrice: 1, payout: 2, spot: 1 }; },
    placeBuy: async () => ({ contractId: 'unused', buyPrice: 1, payout: 2 }),
    settleContract: async () => new Promise(() => undefined),
  };
  const automation = new autoMod.Automation(registry, client as never, hub);
  const momentum = {
    state: () => ({
      running: true,
      phase: 'observing',
      config: { symbol: 'R_100', multiplier: 20, stake: 10, commissionRate: .001 },
      window: {
        signal: { direction: 'up', confidence: 72, reason: 'Upward returns agree across 3 of 3 horizons' },
        decisionSignal: null,
      },
    }),
  };
  const app = Fastify();
  routesMod.registerApi(app, {
    registry, feed, client: client as never, hub, automation,
    paperSimulator: new paperMod.PaperSimulator(), momentum: momentum as never,
  });

  const response = await app.inject({ method: 'POST', url: '/api/momentum/trade', payload: { direction: 'down', stake: 3 } });
  assert.equal(response.statusCode, 409);
  assert.match(response.json().error, /recommends UP/i);
  assert.equal(quoteCalls, 0);

  automation.dispose();
  await app.close();
});

test('an uncertain Momentum buy remains locked and cannot be retried or locally cleared', async () => {
  const [{ default: Fastify }, hubMod, marketMod, feedMod, autoMod, paperMod, routesMod, store, cfg] = await Promise.all([
    import('fastify'),
    import('../src/api/hub.ts'),
    import('../src/core/marketState.ts'),
    import('../src/deriv/publicFeed.ts'),
    import('../src/strategy/automation.ts'),
    import('../src/simulation/paperSimulator.ts'),
    import('../src/api/routes.ts'),
    import('../src/db/store.ts'),
    import('../src/config.ts'),
  ]);
  cfg.config.dashboardAdminToken = '';
  store.setSession({
    id: 'momentum-demo-unknown', loginid: 'VRTC_UNKNOWN_BUY', balance: 250, currency: 'USD', mode: 'demo', auth_kind: 'pat',
    token_cipher: 'x', created_at: Date.now(), updated_at: Date.now(),
  });

  const hub = new hubMod.Hub();
  const registry = new marketMod.MarketRegistry({ onTick: () => undefined });
  registry.ensure('R_100');
  const feed = new feedMod.DerivPublicFeed(registry, () => undefined);
  let buyCalls = 0;
  const client = {
    isConnected: true,
    getQuote: async () => ({ id: 'unused' }),
    getMultiplierQuote: async () => ({ id: 'uncertain-proposal', askPrice: 3, payout: 6, spot: 750.5 }),
    placeBuy: async () => {
      buyCalls += 1;
      throw new Error('buy timeout');
    },
    settleContract: async () => new Promise(() => undefined),
  };
  const automation = new autoMod.Automation(registry, client as never, hub);
  const momentum = {
    state: () => ({
      running: true,
      phase: 'observing',
      config: { symbol: 'R_100', multiplier: 20, stake: 10, commissionRate: .001 },
      window: {
        signal: { direction: 'up', confidence: 72, reason: 'Upward returns agree across 3 of 3 horizons' },
        decisionSignal: null,
      },
    }),
  };
  const app = Fastify();
  routesMod.registerApi(app, {
    registry, feed, client: client as never, hub, automation,
    paperSimulator: new paperMod.PaperSimulator(), momentum: momentum as never,
  });

  const first = await app.inject({ method: 'POST', url: '/api/momentum/trade', payload: { direction: 'up', stake: 3 } });
  assert.equal(first.statusCode, 503);
  assert.equal(first.json().code, 'purchase_outcome_unknown');
  assert.equal(buyCalls, 1);
  const uncertain = store.getOpenTrade();
  assert.ok(uncertain);
  assert.equal(uncertain.status, 'purchasing');
  assert.match(uncertain.reason, /purchase outcome unknown/i);

  const retry = await app.inject({ method: 'POST', url: '/api/momentum/trade', payload: { direction: 'up', stake: 3 } });
  assert.equal(retry.statusCode, 409);
  assert.equal(buyCalls, 1);
  const clear = await app.inject({ method: 'POST', url: '/api/trade/clear-stuck' });
  assert.equal(clear.statusCode, 409);
  assert.match(clear.json().error, /unknown at Deriv/i);

  automation.dispose();
  await app.close();
});
