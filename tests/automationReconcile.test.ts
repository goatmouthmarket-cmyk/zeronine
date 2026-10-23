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

test('stopped watch cycles publish model candidates without requesting private proposals', async () => {
  const [hubMod, registryMod, autoMod] = await Promise.all([
    import('../src/api/hub.ts'),
    import('../src/core/marketState.ts'),
    import('../src/strategy/automation.ts'),
  ]);
  const registry = new registryMod.MarketRegistry({ onTick: () => undefined });
  registry.ensure('1HZ10V');
  const now = Math.floor(Date.now() / 1000) - 699;
  const digits = [7, 8, 9];
  for (let index = 0; index < 700; index += 1) {
    registry.push('1HZ10V', 1_000 + index / 100, now + index, digits[index % digits.length]);
  }
  let proposalCalls = 0;
  const client = {
    isConnected: true,
    getQuote: async () => {
      proposalCalls += 1;
      throw new Error('stopped watch mode must not request a proposal');
    },
  };
  const hub = new hubMod.Hub();
  let candidateCount = 0;
  hub.on((event) => {
    if (event.type === 'signal') candidateCount = ((event.signal as { candidates?: unknown[] })?.candidates ?? []).length;
  });
  const automation = new autoMod.Automation(registry, client as never, hub);

  const delay = await (automation as unknown as { cycle(epoch: number, startedRunning: boolean): Promise<number> }).cycle(0, false);

  assert.ok(candidateCount > 0, 'the public scanner should still publish manual candidates');
  assert.equal(proposalCalls, 0);
  assert.equal(delay, 1500);
  automation.dispose();
});
