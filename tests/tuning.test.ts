import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { TestRunRow } from '../src/db/store.ts';
import { realizedEdge, bestAgreeing, adjust, type TuningCandidate } from '../src/strategy/tuning.ts';

function run(strategy: string, mode: string, trades: number, netPnl: number, avgStake: number, ageMs: number): TestRunRow {
  const finishedAt = Date.now() - ageMs;
  return {
    id: 0,
    kind: 'backtest',
    source: 'manual',
    strategy_mode: strategy,
    bot_mode: mode,
    base_stake: 1,
    target: trades,
    trades,
    wins: 0,
    losses: 0,
    net_pnl: netPnl,
    win_rate: null,
    avg_stake: avgStake,
    max_drawdown_pct: null,
    best_streak: null,
    worst_streak: null,
    final_balance: null,
    started_at: finishedAt - 1000,
    finished_at: finishedAt,
  };
}

function cand(strategy: TuningCandidate['strategy'], mode: TuningCandidate['mode'], bt: TestRunRow, paper: TestRunRow): TuningCandidate {
  return { strategy, mode, bt, paper };
}

function A(bt = run('martingale', 'rapid', 30, 6, 1, 1000), paper = run('martingale', 'rapid', 30, 6, 1, 1000)): TuningCandidate {
  // default edge 0.2
  return cand('martingale', 'rapid', bt, paper);
}

function B(bt = run('chase', 'strict', 30, 15, 10, 1000), paper = run('chase', 'strict', 30, 15, 10, 1000)): TuningCandidate {
  // default edge 0.05
  return cand('chase', 'strict', bt, paper);
}

test('realizedEdge is ROI per staked dollar and guards bad input', () => {
  assert.equal(realizedEdge(null), 0);
  assert.equal(realizedEdge(run('x', 'rapid', 0, 100, 1, 0)), 0);
  assert.equal(realizedEdge(run('x', 'rapid', 10, 0, 1, 0)), 0);
  assert.equal(realizedEdge(run('x', 'rapid', 10, 5, 0, 0)), 0, 'avg_stake must be present');
  assert.equal(realizedEdge(run('x', 'rapid', 10, 5, 1, 0)), 0.5);
  assert.equal(realizedEdge(run('x', 'rapid', 10, -2, 1, 0)), -0.2);
});

test('bestAgreeing requires both columns, fresh runs, and enough trades', () => {
  const champ = bestAgreeing([A(), B()], 20, 60_000);
  assert.ok(champ, 'a champion that wins both columns qualifies');
  assert.equal(champ.strategy, 'martingale');
  assert.equal(champ.mode, 'rapid');
  assert.equal(bestAgreeing([A(), B()], 40, 60_000), null, 'under the trade floor nothing counts');
  assert.equal(bestAgreeing([A(run('martingale', 'rapid', 30, 6, 1, 500_000))], 20, 60_000), null, 'stale runs are excluded');
  assert.equal(bestAgreeing([], 20, 60_000), null, 'no runs -> null');
});

test('bestAgreeing refuses disagreement, ties, and all-negative columns', () => {
  const agree = bestAgreeing(
    [
      A(run('martingale', 'rapid', 30, 3, 1, 1000)), // backtest edge 0.1
      B(run('chase', 'strict', 30, 12, 1, 1000), run('chase', 'strict', 30, 12, 1, 1000)), // edge 0.4 both columns
    ],
    20,
    60_000,
  );
  assert.ok(agree && agree.strategy === 'chase' && agree.mode === 'strict', 'both columns crown the same champion');

  const disagree = bestAgreeing(
    [
      A(run('martingale', 'rapid', 30, 12, 1, 1000)), // backtest crowns this (0.4)
      B(undefined, run('chase', 'strict', 30, 30, 1, 1000)), // paper crowns this (1.0)
    ],
    20,
    60_000,
  );
  assert.equal(disagree, null, 'columns crown different champions -> hold');

  assert.equal(bestAgreeing([A(run('martingale', 'rapid', 30, -6, 1, 1000))], 20, 60_000), null, 'a negative edge can never champion');

  const tied = bestAgreeing(
    [
      A(), // edge 0.2
      B(run('chase', 'strict', 30, 6, 1, 1000), run('chase', 'strict', 30, 6, 1, 1000)), // edge 0.2 too
    ],
    20,
    60_000,
  );
  assert.equal(tied, null, 'a tie for the top is ambiguous and must not act on a coin flip');
});

test('adjust tightens min_edge toward half the proven edge, capped at 5%', () => {
  const low = adjust({ min_edge: 0.001, base_stake: 1, max_stake: 50 }, 0.02, 500);
  assert.equal(low.minEdge, 0.01, 'half of 2% edge, never below the 0.1% floor');
  const high = adjust({ min_edge: 0.02, base_stake: 1, max_stake: 50 }, 0.2, 500);
  assert.equal(high.minEdge, 0.05, 'capped at 5%');
});

test('adjust scales stake by edge tier, clamped by max_stake and a 2% balance cap', () => {
  assert.equal(adjust({ min_edge: 0.001, base_stake: 1, max_stake: 50 }, 0.05, 500).baseStake, 1.3, 'edge >= 3% -> 1.3x');
  assert.equal(adjust({ min_edge: 0.001, base_stake: 5, max_stake: 2 }, 0.05, 500).baseStake, 2, 'never exceeds max_stake');
  assert.equal(adjust({ min_edge: 0.001, base_stake: 5, max_stake: 50 }, 0.05, 20).baseStake, 0.4, '2% of a $20 balance');
  assert.equal(adjust({ min_edge: 0.001, base_stake: 10, max_stake: 50 }, 0.001, 500).baseStake, 8, 'edge below 0.2% -> 0.8x');
  assert.equal(adjust({ min_edge: 0.001, base_stake: 0.1, max_stake: 50 }, 0.001, 500).baseStake, 0.1, 'never below the $0.10 floor');
});