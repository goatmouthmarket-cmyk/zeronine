import type { DecisionAction, DecisionEventRow } from '../db/store.ts';
import { round2 } from './metrics.ts';

export type HealthBucket = 'excellent' | 'healthy' | 'weak' | 'avoid' | 'unclassified';

export interface EvidenceSummary {
  decisions: number;
  evaluated: number;
  wins: number;
  losses: number;
  expired: number;
  pending: number;
  win_rate: number | null;
  calibration: {
    samples: number;
    estimated_win_rate: number | null;
    actual_win_rate: number | null;
    gap_points: number | null;
  };
}

export interface EvidenceGroup extends EvidenceSummary {
  key: string;
}

export interface DecisionEvidenceReport extends EvidenceSummary {
  counterfactual: EvidenceSummary;
  executed: EvidenceSummary;
  by_health: EvidenceGroup[];
  by_regime: EvidenceGroup[];
  by_action: EvidenceGroup[];
}

const HEALTH_BUCKETS: HealthBucket[] = ['excellent', 'healthy', 'weak', 'avoid', 'unclassified'];
const COUNTERFACTUAL_ACTIONS = new Set<DecisionAction>(['wait', 'skip']);

function healthBucket(score: number | undefined): HealthBucket {
  if (score === undefined || !Number.isFinite(score)) return 'unclassified';
  if (score >= 80) return 'excellent';
  if (score >= 60) return 'healthy';
  if (score >= 40) return 'weak';
  return 'avoid';
}

function summarize(events: readonly DecisionEventRow[]): EvidenceSummary {
  let wins = 0;
  let losses = 0;
  let expired = 0;
  let pending = 0;
  const calibrated = events.filter((event) =>
    (event.outcome === 'won' || event.outcome === 'lost') && Number.isFinite(event.est_win),
  );

  for (const event of events) {
    if (event.outcome === 'won') wins += 1;
    else if (event.outcome === 'lost') losses += 1;
    else if (event.outcome === 'expired') expired += 1;
    else pending += 1;
  }

  const evaluated = wins + losses;
  const winRate = evaluated > 0 ? round2((wins / evaluated) * 100) : null;
  const calibratedWins = calibrated.filter((event) => event.outcome === 'won').length;
  const actualRate = calibrated.length > 0 ? round2((calibratedWins / calibrated.length) * 100) : null;
  const estimatedRate = calibrated.length > 0
    ? round2((calibrated.reduce((sum, event) => sum + Number(event.est_win), 0) / calibrated.length) * 100)
    : null;

  return {
    decisions: events.length,
    evaluated,
    wins,
    losses,
    expired,
    pending,
    win_rate: winRate,
    calibration: {
      samples: calibrated.length,
      estimated_win_rate: estimatedRate,
      actual_win_rate: actualRate,
      gap_points: actualRate != null && estimatedRate != null ? round2(actualRate - estimatedRate) : null,
    },
  };
}

function grouped(events: readonly DecisionEventRow[], keyFor: (event: DecisionEventRow) => string, keys?: readonly string[]): EvidenceGroup[] {
  const groups = new Map<string, DecisionEventRow[]>();
  for (const key of keys ?? []) groups.set(key, []);
  for (const event of events) {
    const key = keyFor(event);
    const group = groups.get(key);
    if (group) group.push(event);
    else groups.set(key, [event]);
  }
  return [...groups.entries()].map(([key, group]) => ({ key, ...summarize(group) }));
}

/**
 * Read-only Decision Memory analysis for Test Lab. Counterfactual evidence is
 * limited to WAIT/SKIP decisions because they are resolved against the next
 * matching tick; trade rows remain execution context until linked settlement
 * evidence is added in a later phase.
 */
export function buildDecisionEvidenceReport(events: readonly DecisionEventRow[]): DecisionEvidenceReport {
  const all = summarize(events);
  return {
    ...all,
    counterfactual: summarize(events.filter((event) => COUNTERFACTUAL_ACTIONS.has(event.action))),
    executed: summarize(events.filter((event) => event.action === 'trade')),
    by_health: grouped(events, (event) => healthBucket(event.health_score), HEALTH_BUCKETS),
    by_regime: grouped(events, (event) => event.regime || 'unclassified').sort((a, b) => a.key.localeCompare(b.key)),
    by_action: grouped(events, (event) => event.action).sort((a, b) => a.key.localeCompare(b.key)),
  };
}
