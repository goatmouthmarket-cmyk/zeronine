import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildDecisionEvidenceReport } from '../src/testlab/evidence.ts';
import type { DecisionEventRow } from '../src/db/store.ts';

function event(overrides: Partial<DecisionEventRow>): DecisionEventRow {
  return {
    id: 1,
    ts: 1,
    market: 'R_50',
    action: 'wait',
    reason: 'edge',
    outcome: null,
    resolved_at: null,
    ...overrides,
  };
}

test('Decision Memory evidence groups outcome and calibration by health and regime', () => {
  const report = buildDecisionEvidenceReport([
    event({ id: 1, health_score: 80, regime: 'stable', est_win: 0.8, outcome: 'won' }),
    event({ id: 2, action: 'skip', health_score: 60, regime: 'volatile', est_win: 0.7, outcome: 'lost' }),
    event({ id: 3, health_score: 40, regime: 'volatile', est_win: 0.4, outcome: 'expired' }),
    event({ id: 4, health_score: 39, est_win: 0.2 }),
    event({ id: 5, action: 'trade', est_win: 0.6, outcome: 'won' }),
  ]);

  assert.deepEqual(
    { decisions: report.decisions, evaluated: report.evaluated, wins: report.wins, losses: report.losses, expired: report.expired, pending: report.pending, win_rate: report.win_rate },
    { decisions: 5, evaluated: 3, wins: 2, losses: 1, expired: 1, pending: 1, win_rate: 66.67 },
  );
  assert.deepEqual(report.counterfactual, {
    decisions: 4,
    evaluated: 2,
    wins: 1,
    losses: 1,
    expired: 1,
    pending: 1,
    win_rate: 50,
    calibration: { samples: 2, estimated_win_rate: 75, actual_win_rate: 50, gap_points: -25 },
  });
  assert.equal(report.executed.decisions, 1);
  assert.equal(report.executed.win_rate, 100);
  assert.deepEqual(report.by_health.map((group) => [group.key, group.decisions]), [
    ['excellent', 1], ['healthy', 1], ['weak', 1], ['avoid', 1], ['unclassified', 1],
  ]);
  assert.equal(report.by_regime.find((group) => group.key === 'volatile')?.win_rate, 0);
  assert.equal(report.by_health[0].calibration.gap_points, 20);
});
