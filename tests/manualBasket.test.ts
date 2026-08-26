import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import test from 'node:test';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'overunder-manual-basket-'));
process.env.SESSION_SECRET = 'test-secret-test-secret-test-secret';

test('manual basket quotes first and launches five distinct purchases concurrently', async () => {
  const [{ default: Fastify }, hubMod, marketMod, feedMod, autoMod, routesMod, store, cfg, paperMod] = await Promise.all([
    import('fastify'),
    import('../src/api/hub.ts'),
    import('../src/core/marketState.ts'),
    import('../src/deriv/publicFeed.ts'),
    import('../src/strategy/automation.ts'),
    import('../src/api/routes.ts'),
    import('../src/db/store.ts'),
    import('../src/config.ts'),
    import('../src/simulation/paperSimulator.ts'),
  ]);
  cfg.config.dashboardAdminToken = '';
  store.setSession({
    id: 'manual-basket', loginid: 'CR_BASKET', balance: 100, currency: 'USD', mode: 'demo', auth_kind: 'pat',
    token_cipher: 'x', created_at: Date.now(), updated_at: Date.now(),
  });

  const symbols = ['R_10', 'R_25', 'R_50', 'R_75', 'R_100'];
  const hub = new hubMod.Hub();
  const registry = new marketMod.MarketRegistry({ onTick: () => undefined });
  symbols.forEach((symbol) => registry.ensure(symbol));
  const feed = new feedMod.DerivPublicFeed(registry, () => undefined);
  let quoteCalls = 0;
  let buyCalls = 0;
  let releaseBuys: (() => void) | undefined;
  const buyGate = new Promise<void>((resolve) => { releaseBuys = resolve; });
  const client = {
    isConnected: true,
    getQuote: async (request: { symbol: string; direction: 'over' | 'under'; barrier: number; amount: number }) => {
      quoteCalls += 1;
      return { id: `proposal-${request.symbol}`, direction: request.direction, barrier: request.barrier, askPrice: request.amount, payout: request.amount * 1.8 };
    },
    placeBuy: async (proposalId: string, askPrice: number) => {
      buyCalls += 1;
      if (buyCalls === 5) releaseBuys?.();
      await buyGate;
      return { contractId: `contract-${proposalId}`, buyPrice: askPrice, payout: askPrice * 1.8 };
    },
    settleContract: async () => new Promise(() => undefined),
  };
  const automation = new autoMod.Automation(registry, client as never, hub);
  const app = Fastify();
  routesMod.registerApi(app, {
    registry, feed, client: client as never, hub, automation, paperSimulator: new paperMod.PaperSimulator(),
  });

  const orders = symbols.map((market, index) => ({
    market,
    direction: index % 2 === 0 ? 'over' : 'under',
    barrier: index % 2 === 0 ? 4 : 5,
    stake: 1,
    estWin: 0.7,
  }));
  const response = await app.inject({ method: 'POST', url: '/api/trade/manual-basket', payload: { orders } });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().purchased, 5);
  assert.equal(response.json().failed, 0);
  assert.equal(quoteCalls, 5);
  assert.equal(buyCalls, 5, 'all purchases must begin before any one purchase resolves');
  const pending = store.getPendingTrades();
  assert.equal(pending.length, 5);
  assert.equal(new Set(pending.map((trade) => trade.market)).size, 5);
  assert.ok(pending.every((trade) => trade.origin === 'manual' && trade.reason.includes(response.json().batchId)));

  const blocked = await app.inject({ method: 'POST', url: '/api/trade/manual-basket', payload: { orders } });
  assert.equal(blocked.statusCode, 409);
  assert.equal(buyCalls, 5);

  const wrongCount = await app.inject({ method: 'POST', url: '/api/trade/manual-basket', payload: { orders: orders.slice(0, 4) } });
  assert.equal(wrongCount.statusCode, 400);

  automation.dispose();
  await app.close();
});
