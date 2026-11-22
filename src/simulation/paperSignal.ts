import type { PaperSignal } from './paperSimulator.ts';
import type { Direction } from '../core/digitMath.ts';

/** Public virtual research adapter; never quotes, buys or changes account state. */
export function paperSignalFromHubEvent(
  event: Record<string, unknown>,
  stake: number,
  strategyMode: string,
  botMode: string,
): PaperSignal | null {
  const raw = event.signal as { holds?: unknown; candidates?: unknown; reason?: unknown } | undefined;
  if (raw?.holds || !Array.isArray(raw?.candidates)) return null;
  const candidates = raw.candidates as Record<string, unknown>[];
  // Continuous virtual research concentrates on the four manual plays used in
  // the cockpit. This never changes live account execution or sizing.
  const candidate = candidates.find((item) => (
    (item.direction === 'over' && (item.barrier === 1 || item.barrier === 2))
    || (item.direction === 'under' && (item.barrier === 7 || item.barrier === 8))
  )) ?? candidates[0];
  if (!candidate) return null;
  const direction = candidate.direction;
  const market = candidate.market;
  const barrier = candidate.barrier;
  if (
    typeof market !== 'string'
    || (direction !== 'over' && direction !== 'under')
    || !Number.isInteger(barrier)
  ) return null;
  // An absent payout is missing research evidence, never permission to use a generic 1.9x return.
  const payoutRatio = candidate.estPayout;
  if (typeof payoutRatio !== 'number' || !Number.isFinite(payoutRatio) || payoutRatio <= 1) return null;
  return {
    market,
    direction: direction as Direction,
    barrier: barrier as number,
    stake,
    payoutRatio,
    estWin: typeof candidate.estWin === 'number' ? candidate.estWin : undefined,
    edge: typeof candidate.edge === 'number' ? candidate.edge : undefined,
    id: `${Number.isFinite(event.ts) ? event.ts : Date.now()}:${market}:${direction}:${barrier}`,
    issuedAt: Number.isFinite(event.ts) ? Number(event.ts) : Date.now(),
    reason: (typeof raw?.reason === 'string' ? raw.reason : 'shared configured scanner candidate')
      + (candidate.payoutSource === 'live_quote' ? ' (quoted virtual payout)' : ' (estimated virtual payout)'),
    strategyMode,
    botMode,
    evidence: {
      payout_verified: candidate.payoutSource === 'live_quote' ? 1 : 0,
      engine_core_v1: candidate.engineVersion === 'core-v1' ? 1 : null,
      est_win: typeof candidate.estWin === 'number' ? candidate.estWin : null,
      edge: typeof candidate.edge === 'number' ? candidate.edge : null,
      expected_roi: typeof candidate.expectedROI === 'number' ? candidate.expectedROI : null,
      consistency: typeof candidate.consistency === 'number' ? candidate.consistency : null,
      entropy: typeof candidate.entropy === 'number' ? candidate.entropy : null,
      momentum: typeof candidate.momentum === 'number' ? candidate.momentum : null,
      short_long_deviation: typeof candidate.shortLongDeviation === 'number' ? candidate.shortLongDeviation : null,
      transition_probability: typeof candidate.transitionProb === 'number' ? candidate.transitionProb : null,
      learned_win: typeof candidate.learnedWin === 'number' ? candidate.learnedWin : null,
    },
  };
}
