/**
 * Ranger Brain paper policy.
 *
 * The decision policy is a small, deterministic gate. It is intentionally the
 * least clever part of the Brain: all of the evidence lives in `timing.ts`, and
 * this file only decides whether that evidence is strong enough to take a
 * *virtual* shot. Every branch produces reason codes and the numbers behind
 * them, so the pasture can explain itself without a language model.
 *
 * `wait` and `watch` are normal, expected outcomes. When in doubt the policy
 * abstains.
 */

import { BRAIN_MIN_MARKET_OUTCOMES, type TimingProfile } from './timing.ts';

export type BrainAction = 'paper_shoot' | 'watch' | 'wait';

export type BrainReasonCode =
  | 'FEED_MISSING'
  | 'FEED_STALE'
  | 'POSITION_OPEN'
  | 'INSUFFICIENT_EVIDENCE'
  | 'UNFAVORABLE_WINDOW'
  | 'NO_CANDIDATE'
  | 'EDGE_BELOW_THRESHOLD'
  | 'EDGE_BELOW_BREAKEVEN'
  | 'EDGE_CLEARS_BREAKEVEN'
  | 'FAVORABLE_WINDOW'
  | 'MIXED_WINDOW'
  | 'PAPER_ONLY';

export interface BrainSettings {
  minSamples: number;
  /** Minimum probability edge over break-even required to shoot. */
  minEstimatedEdge: number;
  /** A quote/tick older than this is not evidence. */
  maxTickAgeMs: number;
}

export const BRAIN_DEFAULT_SETTINGS: BrainSettings = {
  minSamples: BRAIN_MIN_MARKET_OUTCOMES,
  minEstimatedEdge: 0.01,
  maxTickAgeMs: 15_000,
};

/** Everything the policy may look at. All of it is knowable before the shot. */
export interface BrainDecisionContext {
  market: string | null;
  contractKind?: string | null;
  barrier?: number | null;
  feedConnected: boolean;
  /** Age of the newest public tick for this market, or null when unknown. */
  tickAgeMs: number | null;
  /** Model's probability that this contract wins, or null when no candidate. */
  candidateWinProbability: number | null;
  /** True when a virtual contract for this market is already unsettled. */
  hasOpenPaperContract: boolean;
  /** Timing evidence for the market/hour being considered. */
  timing: Pick<TimingProfile, 'outcomes' | 'breakeven' | 'verdict'> & {
    hourVerdict?: TimingProfile['verdict'];
  };
}

export interface BrainDecision {
  action: BrainAction;
  reasonCodes: BrainReasonCode[];
  /** Probability edge over break-even; null when there is no candidate. */
  edge: number | null;
  /** Human sentence built from the numbers above, never invented. */
  reason: string;
  evidence: Record<string, number | string | boolean | null>;
}

const percent = (value: number) => `${(value * 100).toFixed(1)}%`;

function build(action: BrainAction, reasonCodes: BrainReasonCode[], edge: number | null, reason: string, evidence: BrainDecision['evidence']): BrainDecision {
  return { action, reasonCodes: [...reasonCodes, 'PAPER_ONLY'], edge, reason, evidence };
}

/**
 * Decides between `paper_shoot`, `watch` and `wait`.
 *
 * The order of the gates matters: feed health, then position state, then
 * evidence size, then the hour verdict, then the candidate's own edge. A
 * missing number is never treated as a good number.
 */
export function decidePaperAction(
  context: BrainDecisionContext,
  settings: BrainSettings = BRAIN_DEFAULT_SETTINGS,
): BrainDecision {
  const breakeven = context.timing.breakeven;
  const probability = context.candidateWinProbability;
  const edge = probability != null && breakeven != null && Number.isFinite(probability)
    ? probability - breakeven
    : null;
  const evidence: BrainDecision['evidence'] = {
    market: context.market,
    outcomes: context.timing.outcomes,
    breakeven: breakeven == null ? null : Number(breakeven.toFixed(4)),
    candidateWinProbability: probability == null ? null : Number(probability.toFixed(4)),
    edge: edge == null ? null : Number(edge.toFixed(4)),
    minEstimatedEdge: settings.minEstimatedEdge,
    minSamples: settings.minSamples,
    tickAgeMs: context.tickAgeMs,
    windowVerdict: context.timing.hourVerdict ?? context.timing.verdict,
  };

  if (!context.feedConnected) {
    return build('wait', ['FEED_MISSING'], edge, 'Waiting for the public market feed.', evidence);
  }
  if (context.tickAgeMs == null || !Number.isFinite(context.tickAgeMs) || context.tickAgeMs > settings.maxTickAgeMs) {
    return build(
      'wait',
      ['FEED_STALE'],
      edge,
      context.tickAgeMs == null
        ? 'Waiting for a fresh tick timestamp.'
        : `Newest tick is ${Math.round(context.tickAgeMs / 1000)}s old; the feed must be fresh.`,
      evidence,
    );
  }
  if (context.hasOpenPaperContract) {
    return build('wait', ['POSITION_OPEN'], edge, 'A virtual contract in this market is still settling.', evidence);
  }
  if (context.timing.outcomes < settings.minSamples) {
    return build(
      'wait',
      ['INSUFFICIENT_EVIDENCE'],
      edge,
      `${context.timing.outcomes} settled outcomes; ${settings.minSamples} are needed before any shot.`,
      evidence,
    );
  }
  if (breakeven == null) {
    return build('wait', ['INSUFFICIENT_EVIDENCE'], edge, 'No settled payout to compare against.', evidence);
  }
  const windowVerdict = context.timing.hourVerdict ?? context.timing.verdict;
  if (windowVerdict === 'unfavorable') {
    return build('wait', ['UNFAVORABLE_WINDOW'], edge, 'This market\'s hour is measurably below break-even so far.', evidence);
  }
  if (probability == null || edge == null) {
    return build('watch', ['NO_CANDIDATE'], edge, 'Observing; no candidate has a model probability yet.', evidence);
  }
  if (edge < settings.minEstimatedEdge) {
    return build(
      'wait',
      ['EDGE_BELOW_THRESHOLD'],
      edge,
      `Edge ${percent(edge)} is under the ${percent(settings.minEstimatedEdge)} threshold.`,
      evidence,
    );
  }
  if (edge <= 0) {
    return build('wait', ['EDGE_BELOW_BREAKEVEN'], edge, 'Candidate does not clear break-even.', evidence);
  }
  return build(
    'paper_shoot',
    ['EDGE_CLEARS_BREAKEVEN', windowVerdict === 'favorable' ? 'FAVORABLE_WINDOW' : 'MIXED_WINDOW'],
    edge,
    `Edge ${percent(edge)} over break-even ${percent(breakeven)} on ${context.timing.outcomes} settled outcomes.`,
    evidence,
  );
}
