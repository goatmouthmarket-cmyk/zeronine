import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'overunder-account-scope-'));
process.env.SESSION_SECRET = 'test-secret-test-secret-test-secret';

test('financial history, performance, pending trades, and recovery are isolated by Deriv login', async () => {
  const store = await import('../src/db/store.ts');
  const session = (loginid: string) => store.setSession({
    id: `session-${loginid}`,
    loginid,
    balance: 100,
    currency: 'USD',
    mode: 'demo',
    auth_kind: 'pat',
    token_cipher: 'x',
    created_at: Date.now(),
    updated_at: Date.now(),
  });
  const add = (status: 'pending' | 'won' | 'lost', profit: number, suffix: string) =>
    store.insertTrade({
      ts: Date.now(), market: 'R_10', contract_type: 'DIGITOVER', barrier: 0, duration: 1, duration_unit: 't',
      stake: 2, ask_price: 2, payout: 3.8, est_win: 0.8, profit, status,
      contract_id: status === 'pending' ? `open-${suffix}` : `settled-${suffix}`,
      purchase_id: `scope-${suffix}`, reason: 'test',
    });

  session('A');
  add('won', 1.8, 'a-win');
  add('pending', 0, 'a-open');
  store.saveRecovery({ mode: 'recovering', streak: 1, debt: 2, attempts: 1, cycleStake: 2, peakBalance: 100, last_win_epoch: 0, updated_at: Date.now() });
  assert.equal(store.listTrades().length, 2);
  assert.equal(store.getOpenTrade()?.purchase_id, 'scope-a-open');
  assert.equal(store.getPerformanceSummary().profit, 1.8);
  assert.equal(store.getRecovery().debt, 2);

  session('B');
  assert.deepEqual(store.listTrades(), []);
  assert.equal(store.getOpenTrade(), null);
  assert.deepEqual(store.getPerformanceSummary(), { wins: 0, losses: 0, pushes: 0, profit: 0, reset_at: 0 });
  assert.equal(store.getRecovery().debt, 0);
  add('lost', -2, 'b-loss');
  store.resetPerformanceSummary();
  assert.deepEqual(store.getPerformanceSummary(), { wins: 0, losses: 0, pushes: 0, profit: 0, reset_at: store.getPerformanceSummary().reset_at });

  session('A');
  assert.equal(store.listTrades().length, 2);
  assert.equal(store.getPerformanceSummary().profit, 1.8, 'B reset must not alter A dashboard totals');
  assert.equal(store.getRecovery().debt, 2, 'B recovery must not alter A debt');

  session('B');
  assert.equal(store.getDigitRemainingLoss().amount, 2);
  for (let i = 0; i < 35; i++) add('won', 0.01, `b-small-win-${i}`);
  assert.equal(store.getDigitRemainingLoss().amount, 1.65, 'wins beyond the recent display window reduce the earlier loss');
  add('won', 2, 'b-clear');
  assert.equal(store.getDigitRemainingLoss().amount, 0, 'the remaining loss never becomes negative');
  const latestLoss = add('lost', -3, 'b-new-loss');
  assert.deepEqual(store.getDigitRemainingLoss(), { amount: 3, lastSettledTradeId: latestLoss.id });
  session('A');
  assert.equal(store.getDigitRemainingLoss().amount, 0, 'other accounts cannot contribute to this counter');
});
