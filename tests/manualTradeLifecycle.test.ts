import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import test from 'node:test';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'overunder-manual-lifecycle-'));
process.env.SESSION_SECRET = 'test-secret-test-secret-test-secret';

test('manual buy is protected from reconciliation and ledger failures', async () => {
  const [{ default: Fastify }, hubMod, marketMod, feedMod, autoMod, routesMod, store, cfg] = await Promise.all([
    import('fastify'),
    import('../src/api/hub.ts'),
    import('../src/core/marketState.ts'),
    import('../src/deriv/publicFeed.ts'),
    import('../src/strategy/automation.ts'),
    import('../src/api/routes.ts'),
    import('../src/db/store.ts'),
    import('../src/config.ts'),
  ]);
  cfg.config.dashboardAdminToken = '';
  store.setSession({
    id: 'manual-lifecycle', loginid: 'CR_MANUAL', balance: 100, currency: 'USD', mode: 'demo', auth_kind: 'pat',
    token_cipher: 'x', created_at: Date.now(), updated_at: Date.now(),
  });

  const hub = new hubMod.Hub();
  const registry = new marketMod.MarketRegistry({ onTick: () => undefined });
  registry.ensure('R_10');
  const feed = new feedMod.DerivPublicFeed(registry, () => undefined);
  let buyCalls = 0;
  let purchasingWasHidden = false;
  const client = {
    isConnected: true,
    getQuote: async () => ({ id: 'proposal-1', direction: 'over' as const, barrier: 0, askPrice: 2, payout: 3.8 }),
    placeBuy: async () => {
      buyCalls += 1;
      purchasingWasHidden = store.getPendingTrades().length === 0;
      return { contractId: 'manual-contract-1', buyPrice: 2, payout: 3.8 };
    },
    settleContract: async () => ({ contractId: 'manual-contract-1', settled: false, status: 'unknown' as const }),
  };
  const automation = new autoMod.Automation(registry, client as never, hub);
  const paperSimulator = new (await import('../src/simulation/paperSimulator.ts')).PaperSimulator();
  const app = Fastify();
  routesMod.registerApi(app, { registry, feed, client: client as never, hub, automation, paperSimulator });

  // Auditing is useful, but a damaged audit table must not block an account order.
  store.getDb().exec('DROP TABLE trade_ledger');
  const response = await app.inject({
    method: 'POST',
    url: '/api/trade/manual',
    payload: { market: 'R_10', direction: 'over', barrier: 0, stake: 2 },
  });
  assert.equal(response.statusCode, 200);
  assert.equal(buyCalls, 1);
  assert.equal(purchasingWasHidden, true, 'watch reconciliation must not see a row before contract purchase');
  assert.equal(store.getPendingTrades().length, 1);
  assert.equal(store.getPendingTrades()[0]?.contract_id, 'manual-contract-1');

  automation.dispose();
  await app.close();
});
