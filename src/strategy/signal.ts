import type { MarketRegistry, MarketSnapshot } from '../core/marketState.ts';
import type { Direction } from '../core/digitMath.ts';
import { breakevenWinRate, estimatePayoutRatio, estimateWinRate } from '../core/digitMath.ts';

export interface SignalCandidate {
  market: string;
  direction: Direction;
  barrier: number;
  estWin: number;
  estPayout: number;
  edge: number;
}

export interface SignalPick {
  candidate: SignalCandidate;
  alternatives: SignalCandidate[];
  holds: boolean;
  reason: string;
}

function candidatesFor(snap: MarketSnapshot, minWin: number, extremesOnly: boolean): SignalCandidate[] {
  const dist = normalizedDist(snap);
  const candidates: SignalCandidate[] = [];
  // Conservative mode only ever considers the two extreme barriers:
  // Over 0 (digit > 0) and Under 9 (digit < 9) — the highest win-rate sides.
  const barriersOver = extremesOnly ? [0] : [1, 2, 3, 4, 5, 6, 7];
  const barriersUnder = extremesOnly ? [9] : [9, 8, 7, 6, 5, 4, 3];
  for (const barrier of barriersOver) {
    const estWin = estimateWinRate(dist, 'over', barrier);
    const estPayout = estimatePayoutRatio('over', barrier);
    const edge = estWin - breakevenWinRate(1, estPayout);
    candidates.push({ market: snap.symbol, direction: 'over', barrier, estWin, estPayout, edge });
  }
  for (const barrier of barriersUnder) {
    const estWin = estimateWinRate(dist, 'under', barrier);
    const estPayout = estimatePayoutRatio('under', barrier);
    const edge = estWin - breakevenWinRate(1, estPayout);
    candidates.push({ market: snap.symbol, direction: 'under', barrier, estWin, estPayout, edge });
  }
  return candidates.filter((c) => c.estWin >= minWin);
}

export function clampBarrier(direction: Direction, barrier: number): number {
  if (direction === 'over') return Math.max(0, Math.min(8, barrier));
  return Math.max(1, Math.min(9, barrier));
}

export interface QuotePlanOption {
  direction: Direction;
  barrier: number;
}

export function buildQuotePlan(
  pick: SignalPick,
  preference: { direction: Direction; barrier: number },
  extremesOnly = false,
): QuotePlanOption[] {
  const out: QuotePlanOption[] = [];
  const push = (direction: Direction, barrier: number): void => {
    const b = clampBarrier(direction, barrier);
    if (!out.some((x) => x.direction === direction && x.barrier === b)) out.push({ direction, barrier });
  };

  // Conservative mode: only ever quote the two extreme barriers the bot may trade.
  if (extremesOnly) {
    push(pick.candidate.direction, pick.candidate.barrier);
    push(pick.candidate.direction === 'over' ? 'under' : 'over', pick.candidate.direction === 'over' ? 9 : 0);
    return out;
  }

  // best-edge signal candidate first
  push(pick.candidate.direction, pick.candidate.barrier);
  // configured preference as a fallback family
  push(preference.direction, preference.barrier);
  // recovering upward (over) or downward (under) keeps the same family cheap to reach.
  push(pick.candidate.direction, pick.candidate.barrier + (pick.candidate.direction === 'over' ? 2 : -2));
  push(pick.candidate.direction, pick.candidate.barrier + (pick.candidate.direction === 'over' ? 4 : -4));
  // opposite family baseline for comparison
  push(pick.candidate.direction === 'over' ? 'under' : 'over', pick.candidate.direction === 'over' ? 9 : 1);
  // strongest alternates from signal ranking
  for (const alt of pick.alternatives) {
    push(alt.direction, alt.barrier);
    if (out.length >= 6) break;
  }
  return out.slice(0, 6);
}

export function normalizedDist(snap: MarketSnapshot): number[] {
  const sum = snap.dist.reduce((a, b) => a + b, 0);
  if (sum < 50) return Array.from({ length: 10 }, () => 0.1);
  return snap.dist.map((c) => c / sum);
}

export function pickSignal(
  registry: MarketRegistry,
  minWin: number,
  minEdge: number,
  extremesOnly = false,
): SignalPick {
  const all: SignalCandidate[] = [];
  for (const snap of registry.allSnapshots()) {
    if (!snap.fresh) continue;
    all.push(...candidatesFor(snap, minWin, extremesOnly));
  }
  if (all.length === 0) {
    return { candidate: null as unknown as SignalCandidate, alternatives: [], holds: true, reason: 'no fresh market' };
  }
  all.sort((a, b) => b.edge - a.edge || b.estWin - a.estWin);
  const bestEdge = all[0].edge;
  // When edges are effectively tied, alternate between over and under so the
  // bot doesn't permanently ride one side because of stable-sort insertion order.
  const tol = 0.004;
  const tied = all.filter((c) => bestEdge - c.edge < tol);
  let chosen = all[0];
  const rest = all.slice(1);
  if (tied.length > 1) {
    tieCounter += 1;
    const preferOver = tieCounter % 2 === 0;
    const side = tied.filter((c) => c.direction === (preferOver ? 'over' : 'under'));
    if (side.length > 0) chosen = side[0];
  }
  const alternatives = rest.filter((c) => c !== chosen).slice(0, 5);
  // Conservative mode trades the extreme barriers for consistent high win rate;
  // the edge model scores them slightly negative (low payout), so gate on win
  // rate only rather than blocking every trade on the min-edge threshold.
  if (chosen.edge < minEdge && !extremesOnly) {
    return { candidate: chosen, alternatives, holds: true, reason: 'edge below threshold' };
  }
  return { candidate: chosen, alternatives, holds: false, reason: 'signal' };
}

let tieCounter = 0;