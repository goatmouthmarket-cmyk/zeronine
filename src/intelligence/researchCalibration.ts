import type { Direction } from '../core/digitMath.ts';

export interface ResearchOutcome {
  market: string;
  direction: Direction;
  barrier: number;
  predicted: number;
  won: boolean;
}

export interface ResearchCalibration {
  probability: number;
  correction: number;
  samples: number;
  applied: boolean;
}

const outcomes = new Map<string, ResearchOutcome[]>();

function keyOf(market: string, direction: Direction, barrier: number): string {
  return `${market}|${direction}|${barrier}`;
}

export function observeResearchOutcome(outcome: ResearchOutcome): void {
  if (!Number.isFinite(outcome.predicted) || outcome.predicted <= 0 || outcome.predicted >= 1) return;
  const key = keyOf(outcome.market, outcome.direction, outcome.barrier);
  const rows = outcomes.get(key) ?? [];
  rows.push({ ...outcome });
  if (rows.length > 500) rows.splice(0, rows.length - 500);
  outcomes.set(key, rows);
}

/**
 * Two interleaved folds must agree on the direction of prediction error. The
 * agreed correction is sample-shrunk. Positive boosts stay capped at three
 * percentage points; negative corrections are allowed to be stronger so a
 * repeatedly losing setup is downgraded during the run instead of being
 * selected again on stale confidence.
 * No P&L, balance, stake, recovery, or account data enters this model.
 */
export function calibrateResearchProbability(
  market: string,
  direction: Direction,
  barrier: number,
  probability: number,
): ResearchCalibration {
  const rows = outcomes.get(keyOf(market, direction, barrier)) ?? [];
  if (rows.length < 12) return { probability, correction: 0, samples: rows.length, applied: false };
  const errors = [0, 1].map((fold) => {
    const sample = rows.filter((_, index) => index % 2 === fold);
    const actual = sample.reduce((sum, row) => sum + (row.won ? 1 : 0), 0) / sample.length;
    const predicted = sample.reduce((sum, row) => sum + row.predicted, 0) / sample.length;
    return actual - predicted;
  });
  if (errors[0] === 0 || errors[1] === 0 || Math.sign(errors[0]) !== Math.sign(errors[1])) {
    return { probability, correction: 0, samples: rows.length, applied: false };
  }
  const agreed = Math.sign(errors[0]) * Math.min(Math.abs(errors[0]), Math.abs(errors[1]));
  const rawCorrection = agreed * (rows.length / (rows.length + 60));
  const correction = rawCorrection < 0
    ? Math.max(-0.12, rawCorrection)
    : Math.min(0.03, rawCorrection);
  return {
    probability: Math.max(0.01, Math.min(0.99, probability + correction)),
    correction,
    samples: rows.length,
    applied: true,
  };
}

export function resetResearchCalibrationForTests(): void {
  outcomes.clear();
}
