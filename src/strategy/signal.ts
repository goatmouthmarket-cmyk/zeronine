import type { MarketRegistry, MarketSnapshot } from '../core/marketState.ts';
import type { Direction } from '../core/digitMath.ts';
import { breakevenWinRate, estimatePayoutRatio } from '../core/digitMath.ts';
import type { BarrierFeatures, PatternInput } from './scanner.ts';
import { IntelligenceEngine } from '../intelligence/engine.ts';
import type { IntelligenceSnapshot } from '../intelligence/engine.ts';

export type DigitProvider = (symbol: string, count: number) => number[];

export interface SignalCandidate {
  market: string;
  direction: Direction;
  barrier: number;
  estWin: number;
  estPayout: number;
  edge: number;
  expectedROI: number;
  consistency: number;
  entropy: number;
  momentum: number;
  shortLongDeviation: number;
  transitionProb: number;
  learnedWin: number | null;
}

export interface SignalPick {
  candidates: SignalCandidate[];
  holds: boolean;
  reason: string;
}

export interface QuotePlanOption {
  market: string;
  direction: Direction;
  barrier: number;
}

export function clampBarrier(direction: Direction, barrier: number): number {
  if (direction === 'over') return Math.max(0, Math.min(8, barrier));
  return Math.max(1, Math.min(9, barrier));
}

function toCandidate(
  symbol: string,
  display: string,
  f: BarrierFeatures,
): SignalCandidate {
  const estPayout = estimatePayoutRatio(f.direction, f.barrier);
  return {
    market: symbol,
    direction: f.direction,
    barrier: f.barrier,
    estWin: f.estimatedWin,
    estPayout,
    edge: f.estimatedWin - breakevenWinRate(1, estPayout),
    expectedROI: f.estimatedWin * estPayout - 1,
    consistency: f.consistency,
    entropy: f.entropy,
    momentum: f.momentum,
    shortLongDeviation: f.shortLongDeviation,
    transitionProb: f.transitionCond,
    learnedWin: f.learnedWin,
  };
}

export function normalizedDist(snap: MarketSnapshot): number[] {
  const sum = snap.dist.reduce((a, b) => a + b, 0);
  if (sum < 50) return Array.from({ length: 10 }, () => 0.1);
  return snap.dist.map((c) => c / sum);
}

/**
 * Scan every fresh market across all rolling windows and return the top-N
 * shortlist of (market, direction, barrier) candidates ranked by edge.
 * Hit-rate is never profitability: probability above the floor alone is not
 * enough - the model edge must clear minEdge to be eligible for a quote.
 */
export function pickSignal(
  registry: MarketRegistry,
  minWin: number,
  minEdge: number,
  digits: DigitProvider,
  maxCandidates = 5,
  allowed?: Array<{ direction: Direction; barrier: number }> | null,
  pattern?: PatternInput | null,
): SignalPick {
  const intelligence = new IntelligenceEngine(registry, digits).snapshot(pattern);
  return pickSignalFromSnapshot(intelligence, minWin, minEdge, maxCandidates, allowed);
}

/**
 * Rank candidates from the shared calculation pass. New intelligence modules
 * must consume this snapshot instead of rerunning scanner windows themselves.
 */
export function pickSignalFromSnapshot(
  intelligence: IntelligenceSnapshot,
  minWin: number,
  minEdge: number,
  maxCandidates = 5,
  allowed?: Array<{ direction: Direction; barrier: number }> | null,
): SignalPick {
  const all: SignalCandidate[] = [];
  for (const { scan } of intelligence.markets.values()) {
    for (const f of scan.features) {
      if (f.estimatedWin < minWin) continue;
      if (allowed && !allowed.some((a) => a.direction === f.direction && a.barrier === f.barrier)) continue;
      all.push(toCandidate(scan.symbol, scan.display, f));
    }
  }
  if (all.length === 0) {
    return { candidates: [], holds: true, reason: 'no candidate above the probability floor' };
  }
  all.sort((a, b) => b.edge - a.edge || b.expectedROI - a.expectedROI || b.estWin - a.estWin);
  const candidates = all.slice(0, maxCandidates);
  const best = candidates[0];
  if (best.edge < minEdge) {
    // The best candidate is not credible enough yet. WAIT is a valid outcome:
    // the bot is under no obligation to trade every scan. Keep the shortlist
    // attached so the UI can show the near-miss it chose not to take.
    return { candidates, holds: true, reason: 'edge below threshold' };
  }
  return { candidates, holds: false, reason: 'signal' };
}

export function buildQuotePlan(pick: SignalPick): QuotePlanOption[] {
  const out: QuotePlanOption[] = [];
  for (const c of pick.candidates) {
    const b = clampBarrier(c.direction, c.barrier);
    if (c.direction !== 'over' && c.direction !== 'under') continue;
    const key = `${c.market}|${c.direction}|${b}`;
    if (!out.some((x) => `${x.market}|${x.direction}|${x.barrier}` === key)) {
      out.push({ market: c.market, direction: c.direction, barrier: b });
    }
    if (out.length >= 6) break;
  }
  return out;
}
