import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'overunder-reconcile-'));
process.env.SESSION_SECRET = 'test-secret-test-secret-test-secret';

test('reconciliation records the real settled result and restores automation recovery', async () => {
  const [store, hubMod, registryMod, autoMod] = await Promise.all([
    import('../src/db/store.ts'),
    import('../src/api/hub.ts'),
    import('../src/core/marketState.ts'),
    import('../src/strategy/automation.ts'),
  ]);
  store.resetRecovery();
  const trade = store.insertTrade({
    ts: Date.now() - 61_000,
    market: 'R_10',
    contract_type: 'DIGITOVER',
    barrier: 0,
    duration: 1,
    duration_unit: 't',
    stake: 2,
    ask_price: 2,
    payout: 3.8,
    est_win: 0.8,
    profit: 0,
    status: 'pending',
    contract_id: '12345',
    purchase_id: 'auto-reconcile',
    reason: 'base',
  });
  const client = {
    isConnected: true,
    settleContract: async () => ({
      contractId: '12345', status: 'lost' as const, settled: true, profit: -2,
      sellPrice: 0, buyPrice: 2, entrySpot: 100, exitSpot: 101, exitDigit: 1,
    }),
  };
  const automation = new autoMod.Automation(
    new registryMod.MarketRegistry({ onTick: () => undefined }),
    client as never,
    new hubMod.Hub(),
  );

  await (automation as unknown as { reconcilePending(rows: typeof trade[]): Promise<void> }).reconcilePending([trade]);

  const resolved = store.getTrade(trade.id);
  assert.equal(resolved?.status, 'lost');
  assert.equal(resolved?.profit, -2);
  assert.equal(store.getRecovery().debt, 2);
  assert.equal(store.getRecovery().streak, 1);
  automation.dispose();
});
