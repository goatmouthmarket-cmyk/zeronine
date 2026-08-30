import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'overunder-performance-'));

test('performance reset zeroes the dashboard baseline without deleting history', async () => {
  const { getPerformanceSummary, insertTrade, listTrades, resetPerformanceSummary } = await import('../src/db/store.ts');
  const add = (status: 'won' | 'lost' | 'push', profit: number, suffix: string): void => {
    insertTrade({
      ts: Date.now(),
      market: 'R_10',
      contract_type: 'DIGITOVER',
      barrier: 0,
      duration: 1,
      duration_unit: 't',
      stake: 1,
      ask_price: 1,
      payout: 2,
      est_win: 0.5,
      profit,
      status,
      contract_id: `performance-${suffix}`,
      purchase_id: `performance-${suffix}`,
      reason: 'test',
    });
  };

  add('won', 1, 'won-before');
  add('lost', -1, 'lost-before');
  add('push', 0, 'push-before');
  insertTrade({
    ts: Date.now(),
    market: 'R_10',
    contract_type: 'MULTUP',
    barrier: 0,
    duration: 0,
    duration_unit: '',
    stake: 1,
    ask_price: 1,
    payout: 0,
    est_win: 0,
    profit: 3,
    status: 'won',
    contract_id: 'performance-momentum',
    purchase_id: 'performance-momentum',
    reason: 'momentum manual UP',
  });
  assert.deepEqual(getPerformanceSummary(), { wins: 1, losses: 1, pushes: 1, profit: 0, reset_at: 0 });

  const reset = resetPerformanceSummary();
  assert.deepEqual({ wins: reset.wins, losses: reset.losses, pushes: reset.pushes, profit: reset.profit }, { wins: 0, losses: 0, pushes: 0, profit: 0 });
  assert.equal(listTrades().length, 4, 'history remains intact');

  add('won', 0.5, 'won-after');
  const summary = getPerformanceSummary();
  assert.deepEqual({ wins: summary.wins, losses: summary.losses, pushes: summary.pushes, profit: summary.profit }, { wins: 1, losses: 0, pushes: 0, profit: 0.5 });
});
