import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_SIMULATIONS,
  MIN_RUNS_FOR_ESTIMATE,
  MIN_TRADES_FOR_RATE,
  estimateTimeToTarget,
  formatClock,
  formatDuration,
  seededRandom,
  summarizeRunEvidence,
} from '../web/public/ranger-auto-timing.js';

const run = (overrides: Record<string, unknown> = {}): Record<string, any> => ({
  runId: 'r1',
  accountId: 'CR1',
  accountMode: 'demo',
  trades: 10,
  wins: 6,
  losses: 4,
  avgTradeMs: 45_000,
  wallMs: 600_000,
  targetReached: true,
  takeProfit: 10,
  timeToTargetMs: 540_000,
  ...overrides,
});

const evidence = () => summarizeRunEvidence([
  run({ runId: 'a' }),
  run({ runId: 'b', avgTradeMs: 30_000, timeToTargetMs: 420_000 }),
  run({ runId: 'c', avgTradeMs: 60_000, timeToTargetMs: 720_000 }),
  run({ runId: 'd', wins: 5, losses: 5, avgTradeMs: 40_000, targetReached: false, timeToTargetMs: null }),
]);

test('evidence summarises cycles, rate and reach proportion', () => {
  const summary = evidence();
  assert.equal(summary.runs, 4);
  assert.equal(summary.enoughRuns, true);
  assert.equal(summary.cycles.length, 4);
  assert.equal(summary.wins, 23);
  assert.equal(summary.losses, 17);
  assert.equal(summary.winRate, 23 / 40);
  assert.equal(summary.enoughRate, true);
  assert.equal(summary.reachRate, 0.75);
  assert.equal(summary.medianCycleMs, 40_000, 'nearest-rank median over four observed cycles');
});

test('missing timing history is reported as unavailable, never guessed', () => {
  const empty = summarizeRunEvidence([]);
  assert.equal(empty.enoughRuns, false);
  const estimate = estimateTimeToTarget({ evidence: empty, target: 10, perWinProfit: 0.8 });
  assert.equal(estimate.available, false);
  assert.equal(estimate.reason, 'insufficient_runs');
  assert.match(estimate.message, /Not enough completed Ranger runs/);
  const noTarget = estimateTimeToTarget({ evidence: evidence(), target: 0, perWinProfit: 0.8 });
  assert.equal(noTarget.available, false);
  assert.equal(noTarget.reason, 'no_target');
  assert.equal(MIN_RUNS_FOR_ESTIMATE, 3);
});

test('a thin win-rate sample blocks the estimate even with runs on file', () => {
  const thin = summarizeRunEvidence([
    run({ trades: 2, wins: 1, losses: 1 }),
    run({ trades: 2, wins: 1, losses: 1 }),
    run({ trades: 2, wins: 1, losses: 1 }),
  ]);
  assert.equal(thin.enoughRuns, true);
  assert.equal(thin.enoughRate, false);
  const estimate = estimateTimeToTarget({ evidence: thin, target: 10, perWinProfit: 0.8 });
  assert.equal(estimate.available, false);
  assert.equal(estimate.reason, 'insufficient_trades');
  assert.ok(MIN_TRADES_FOR_RATE > 6);
});

test('the replay is deterministic for a seed and reports a distribution', () => {
  const summary = evidence();
  const first = estimateTimeToTarget({ evidence: summary, target: 10, perWinProfit: 0.8, avgLossAmount: 1, lossesToCooldown: 3, cooldownSeconds: 45, seed: 7 });
  const second = estimateTimeToTarget({ evidence: summary, target: 10, perWinProfit: 0.8, avgLossAmount: 1, lossesToCooldown: 3, cooldownSeconds: 45, seed: 7 });
  assert.equal(first.available, true);
  assert.equal(first.medianMs, second.medianMs);
  assert.equal(first.slowMs, second.slowMs);
  assert.ok(first.slowMs >= first.medianMs);
  assert.ok(first.fastMs <= first.medianMs);
  assert.ok(first.medianMs > Number(summary.medianCycleMs), 'a target needs several completed trades');
  assert.ok(first.assumptions.some((line: string) => /win rate/.test(line)));
  assert.ok(first.simulations <= MAX_SIMULATIONS);
});

test('cooldowns lengthen the estimate and low win rates reach less often', () => {
  const summary = evidence();
  const noCooldown = estimateTimeToTarget({ evidence: summary, target: 5, perWinProfit: 0.8, avgLossAmount: 1, lossesToCooldown: 3, cooldownSeconds: 0, seed: 11 });
  const withCooldown = estimateTimeToTarget({ evidence: summary, target: 5, perWinProfit: 0.8, avgLossAmount: 1, lossesToCooldown: 3, cooldownSeconds: 300, seed: 11 });
  assert.ok(withCooldown.medianMs > noCooldown.medianMs);
  const strong = estimateTimeToTarget({ evidence: summary, target: 5, perWinProfit: 0.8, avgLossAmount: 1, lossesToCooldown: 3, cooldownSeconds: 45, seed: 3 });
  const weak = estimateTimeToTarget({ evidence: summary, target: 5, perWinProfit: 0.8, avgLossAmount: 3, lossesToCooldown: 3, cooldownSeconds: 45, seed: 3 });
  assert.ok(weak.reachRate <= strong.reachRate);
});

test('a maximum run loss can stop every simulated run', () => {
  const summary = evidence();
  const estimate = estimateTimeToTarget({ evidence: summary, target: 500, perWinProfit: 0.8, avgLossAmount: 1, lossesToCooldown: 3, cooldownSeconds: 45, maxRunLoss: 1, seed: 5 });
  assert.equal(estimate.available, true);
  assert.equal(estimate.reason, 'never_reached');
  assert.ok(estimate.stoppedOut > 0);
  assert.match(estimate.message, /No simulated run reached take profit/);
});

test('duration and clock formatting stay readable', () => {
  assert.equal(formatClock(0), '00:00:00');
  assert.equal(formatClock(3_725_000), '01:02:05');
  assert.equal(formatDuration(45_000), '45s');
  assert.equal(formatDuration(200_000), '3m 20s');
  assert.equal(formatDuration(3_800_000), '1h 03m');
});

test('the PRNG is reproducible and bounded', () => {
  const a = seededRandom(42);
  const b = seededRandom(42);
  for (let index = 0; index < 5; index += 1) {
    const value = a();
    assert.equal(value, b());
    assert.ok(value >= 0 && value < 1);
  }
});
