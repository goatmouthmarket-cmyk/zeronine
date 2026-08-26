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
  let finishSettlement: ((value: {
    contractId: string; settled: true; status: 'won'; profit: number; sellPrice: number; buyPrice: number;
    entrySpot: number; exitSpot: number; exitDigit: number;
  }) => void) | undefined;
  const events: Array<Record<string, unknown>> = [];
  hub.on((event) => events.push(event));
  const client = {
    isConnected: true,
    getQuote: async () => ({ id: 'proposal-1', direction: 'over' as const, barrier: 0, askPrice: 2, payout: 3.8 }),
    placeBuy: async () => {
      buyCalls += 1;
      purchasingWasHidden = store.getPendingTrades().length === 0;
      return { contractId: 'manual-contract-1', buyPrice: 2, payout: 3.8 };
    },
    settleContract: async () => new Promise((resolve) => { finishSettlement = resolve; }),
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
    payload: { market: 'R_10', direction: 'over', barrier: 0, stake: 2, estWin: 0.73 },
  });
  assert.equal(response.statusCode, 200);
  assert.equal(buyCalls, 1);
  assert.equal(purchasingWasHidden, true, 'watch reconciliation must not see a row before contract purchase');
  assert.equal(store.getPendingTrades().length, 1);
  assert.equal(store.getPendingTrades()[0]?.contract_id, 'manual-contract-1');
  assert.equal(store.getPendingTrades()[0]?.est_win, 0.73, 'manual confidence snapshot must be retained');
  const purchaseEvent = events.find((event) => event.type === 'trade')?.trade as { status?: string; contract_id?: string } | undefined;
  assert.equal(purchaseEvent?.status, 'pending');
  assert.equal(purchaseEvent?.contract_id, 'manual-contract-1');

  finishSettlement?.({
    contractId: 'manual-contract-1', settled: true, status: 'won', profit: 1.8,
    sellPrice: 3.8, buyPrice: 2, entrySpot: 100.1, exitSpot: 100.9, exitDigit: 9,
  });
  await assert.doesNotReject(async () => {
    for (let attempt = 0; attempt < 20 && store.getPendingTrades().length > 0; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(store.getPendingTrades().length, 0);
  });
  const settledEvent = events.find((event) => event.type === 'trade' && event.settled === true);
  assert.equal((settledEvent?.trade as { status?: string } | undefined)?.status, 'won');

  store.setSession({
    id: 'manual-real', loginid: 'CR_REAL', balance: 100, currency: 'USD', mode: 'real', auth_kind: 'pat',
    token_cipher: 'x', created_at: Date.now(), updated_at: Date.now(),
  });
  const directReal = await app.inject({
    method: 'POST',
    url: '/api/trade/manual',
    payload: { market: 'R_10', direction: 'over', barrier: 0, stake: 2, estWin: 0.73 },
  });
  assert.equal(directReal.statusCode, 200);
  assert.equal(buyCalls, 2, 'real manual orders should not require a separate arming request');
  const pendingReal = store.getPendingTrades()[0];
  assert.ok(pendingReal);
  store.getDb().prepare('UPDATE trades SET ts = ? WHERE id = ?').run(Date.now() - 120_000, pendingReal.id);
  const blockedByOldOpenContract = await app.inject({
    method: 'POST', url: '/api/trade/manual',
    payload: { market: 'R_10', direction: 'over', barrier: 0, stake: 2, estWin: 0.73 },
  });
  assert.equal(blockedByOldOpenContract.statusCode, 409);
  assert.match(blockedByOldOpenContract.json().error, /settlement recovery is active/i);
  assert.equal(buyCalls, 2, 'elapsed time must never unlock a still-open provider contract');

  automation.dispose();
  await app.close();
});
