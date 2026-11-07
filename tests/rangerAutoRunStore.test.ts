import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import test from 'node:test';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'overunder-ranger-runs-'));
process.env.DATA_DIR = dataDir;
process.env.SESSION_SECRET = 'test-secret-test-secret-test-secret';

const baseRun = {
  accountId: 'CR1234',
  accountMode: 'demo' as const,
  currency: 'USD',
  startedAt: 1_700_000_000_000,
  endedAt: 1_700_000_600_000,
  outcome: 'take_profit',
  stopReason: 'Take profit reached: 10.40 USD. Automation stopped.',
  targetReached: true,
  takeProfit: 10,
  maxRunLoss: 10,
  startingBalance: 250,
  endingBalance: 260.4,
  realizedProfit: 10.4,
  peakProfit: 10.4,
  maxDrawdown: -1.25,
  trades: 6,
  wins: 5,
  losses: 1,
  avgWinProfit: 2.33,
  avgLossProfit: -1.25,
  largestLoss: 1.25,
  longestLossStreak: 1,
  cooldowns: 0,
  cooldownMs: 0,
  activeMs: 540_000,
  waitingMs: 60_000,
  wallMs: 600_000,
  avgTradeMs: 100_000,
  timeToTargetMs: 540_000,
  estimatedTimeToTargetMs: 480_000,
  settledStakes: 7.5,
  settings: { style: 'martingale', lossesToCooldown: 3, cooldownSeconds: 45 },
  tradesDetail: [
    { tradeId: '1', stake: 1, payout: 1.8, profit: 0.8, status: 'won', purchasedAt: 1_700_000_010_000, settledAt: 1_700_000_070_000 },
    { tradeId: '2', stake: 1.25, payout: 2.25, profit: -1.25, status: 'lost', purchasedAt: 1_700_000_080_000, settledAt: 1_700_000_140_000 },
  ],
  events: [{ ts: 1_700_000_000_000, type: 'run_start' }, { ts: 1_700_000_600_000, type: 'stop', detail: 'take_profit' }],
};

test('finished Ranger Auto runs are stored once per player and run id', async () => {
  const store = await import('../src/db/store.ts');
  const first = store.saveRangerAutoRun('player-a', { ...baseRun, runId: 'run-aaa-0001' });
  assert.equal(first.saved, true);
  const retry = store.saveRangerAutoRun('player-a', { ...baseRun, runId: 'run-aaa-0001', realizedProfit: 99 });
  assert.equal(retry.saved, false, 'a retried post is idempotent and cannot rewrite a settled report');

  const runs = store.listRangerAutoRuns('player-a');
  assert.equal(runs.length, 1);
  assert.equal(runs[0]!.realized_profit, 10.4);
  assert.equal(runs[0]!.avg_win_profit, 2.33, 'average win and loss amounts are stored with the run');
  assert.equal(runs[0]!.avg_loss_profit, -1.25);
  assert.equal(runs[0]!.target_reached, 1);
  assert.equal(store.listRangerAutoRunTrades('player-a', 'run-aaa-0001').length, 2);
});

test('run reports stay isolated per player and per account mode', async () => {
  const store = await import('../src/db/store.ts');
  store.saveRangerAutoRun('player-a', { ...baseRun, runId: 'run-aaa-0002', accountId: 'VRTC900', accountMode: 'demo' });
  store.saveRangerAutoRun('player-b', { ...baseRun, runId: 'run-bbb-0001', accountId: 'CR1234', accountMode: 'real', outcome: 'max_run_loss', targetReached: false });

  const playerA = store.listRangerAutoRuns('player-a');
  const playerB = store.listRangerAutoRuns('player-b');
  assert.equal(playerB.length, 1);
  assert.equal(playerB[0]!.account_mode, 'real');
  assert.equal(playerB[0]!.outcome, 'max_run_loss');
  assert.deepEqual(playerA.map((run) => run.run_id).sort(), ['run-aaa-0001', 'run-aaa-0002']);
  for (const run of playerA) {
    assert.equal(run.player_id, 'player-a');
    assert.equal(run.account_mode, 'demo');
  }
  assert.equal(store.listRangerAutoRuns('player-c').length, 0);
  assert.equal(store.listRangerAutoRuns('player-a', 1).length, 1);
});

test('timing evidence survives a reload because durations are persisted', async () => {
  const store = await import('../src/db/store.ts');
  store.saveRangerAutoRun('player-a', {
    ...baseRun,
    runId: 'run-aaa-0003',
    avgTradeMs: 75_000,
    wallMs: 450_000,
    targetReached: false,
    timeToTargetMs: null,
    outcome: 'manual_stop',
  });
  const runs = store.listRangerAutoRuns('player-a');
  const withTiming = runs.filter((run) => run.avg_trade_ms > 0);
  assert.equal(withTiming.length, 3);
  assert.ok(withTiming.every((run) => Number.isFinite(run.wall_ms) && run.wall_ms > 0));
});
