export type ManualDirection = 'over' | 'under';

export interface ManualMarket {
  symbol: string;
  recentDigits: number[];
  health?: { score: number };
}

export interface ManualSignalCandidate {
  market: string;
  direction: ManualDirection;
  barrier: number;
  estWin: number;
  edge: number;
  expectedROI?: number;
  consistency?: number;
  transitionProb?: number;
  transitionSamples?: number;
}

export interface TimedManualEntryAssessment {
  ready: boolean;
  reason: string;
}

/**
 * Manual "best" selections are rankings, not immediate entry permission.
 * A timed entry requires a sampled current-digit transition row plus quoted
 * positive edge/ROI. This deliberately avoids hard-coded digit folklore.
 */
export function assessTimedManualEntry(candidate: ManualSignalCandidate | null | undefined): TimedManualEntryAssessment {
  if (!candidate) return { ready: false, reason: 'waiting for an exact live scanner candidate' };
  const base = theoreticalWinForSetup(candidate.direction, candidate.barrier);
  const samples = candidate.transitionSamples ?? 0;
  if (samples < 20) return { ready: false, reason: `learning this entry digit (${samples}/20 transition samples)` };
  if ((candidate.transitionProb ?? 0) < base + .03) return { ready: false, reason: 'current entry digit has no validated lift over baseline' };
  if (candidate.edge < .01) return { ready: false, reason: 'quoted edge is below 1%' };
  if ((candidate.expectedROI ?? 0) < .01) return { ready: false, reason: 'expected return is below 1%' };
  if ((candidate.consistency ?? 0) < .55) return { ready: false, reason: 'short and long evidence are not consistent yet' };
  return { ready: true, reason: `entry row validated across ${samples} transitions` };
}

export interface ManualSetup {
  market: string;
  direction: ManualDirection;
  barrier: number;
  confidence: number;
}

const MIN_SENSIBLE_BASE_WIN = 0.45;
const LOW_BASE_EXCEPTION_WIN = 0.62;
const LOW_BASE_EXCEPTION_EDGE = 0.08;

export function theoreticalWinForSetup(direction: ManualDirection, barrier: number): number {
  const safeBarrier = direction === 'over'
    ? Math.max(0, Math.min(8, Math.trunc(barrier)))
    : Math.max(1, Math.min(9, Math.trunc(barrier)));
  return direction === 'over' ? (9 - safeBarrier) / 10 : safeBarrier / 10;
}

export function isSensibleManualSetup(direction: ManualDirection, barrier: number, estWin: number, edge = 0): boolean {
  const base = theoreticalWinForSetup(direction, barrier);
  if (base >= MIN_SENSIBLE_BASE_WIN) return true;
  return estWin >= LOW_BASE_EXCEPTION_WIN && edge >= LOW_BASE_EXCEPTION_EDGE;
}

export function manualSetupScore(direction: ManualDirection, barrier: number, estWin: number, edge = 0): number {
  const base = theoreticalWinForSetup(direction, barrier);
  const lowBaseGap = Math.max(0, MIN_SENSIBLE_BASE_WIN - base);
  const lowBasePenalty = isSensibleManualSetup(direction, barrier, estWin, edge) ? lowBaseGap * 0.45 : lowBaseGap * 6.5;
  const lift = Math.max(-0.1, Math.min(0.1, estWin - base));
  return (edge * 0.9) + (estWin * 0.35) + (lift * 0.45) - lowBasePenalty;
}

export function strongestManualSetups(
  markets: ManualMarket[],
  candidates: ManualSignalCandidate[],
  limit = 5,
): ManualSetup[] {
  return markets
    .map((market) => strongestManualSetup([market], candidates))
    .filter((setup): setup is ManualSetup => Boolean(setup))
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, Math.max(0, limit));
}

export function confidenceForSetup(market: ManualMarket, direction: ManualDirection, barrier: number): number {
  const digits = market.recentDigits.filter((digit) => Number.isInteger(digit) && digit >= 0 && digit <= 9);
  const theoretical = theoreticalWinForSetup(direction, barrier);
  if (!digits.length) return theoretical;
  const wins = digits.filter((digit) => direction === 'over' ? digit > barrier : digit < barrier).length;
  return (wins + theoretical * 20) / (digits.length + 20);
}

export function exactCandidateForSetup(
  candidates: ManualSignalCandidate[],
  symbol: string,
  direction: ManualDirection,
  barrier: number,
): ManualSignalCandidate | undefined {
  return candidates.find(
    (candidate) => candidate.market === symbol && candidate.direction === direction && candidate.barrier === barrier,
  );
}

export function rankMarketsForSetup<M extends ManualMarket>(
  markets: M[],
  candidates: ManualSignalCandidate[],
  direction: ManualDirection,
  barrier: number,
): M[] {
  return [...markets].sort((a, b) => {
    const ac = exactCandidateForSetup(candidates, a.symbol, direction, barrier);
    const bc = exactCandidateForSetup(candidates, b.symbol, direction, barrier);
    return (bc?.estWin ?? confidenceForSetup(b, direction, barrier)) - (ac?.estWin ?? confidenceForSetup(a, direction, barrier))
      || (bc?.edge ?? -1) - (ac?.edge ?? -1)
      || (b.health?.score ?? 0) - (a.health?.score ?? 0);
  });
}

export function strongestManualSetup(
  markets: ManualMarket[],
  candidates: ManualSignalCandidate[],
): ManualSetup | null {
  const symbols = new Set(markets.map((market) => market.symbol));
  const candidate = [...candidates]
    .filter((item) => symbols.has(item.market) && isSensibleManualSetup(item.direction, item.barrier, item.estWin, item.edge))
    .sort((a, b) => manualSetupScore(b.direction, b.barrier, b.estWin, b.edge) - manualSetupScore(a.direction, a.barrier, a.estWin, a.edge)
      || b.estWin - a.estWin
      || b.edge - a.edge)[0];
  if (candidate) {
    return {
      market: candidate.market,
      direction: candidate.direction,
      barrier: candidate.barrier,
      confidence: candidate.estWin,
    };
  }

  let strongest: ManualSetup | null = null;
  for (const market of markets) {
    for (const direction of ['over', 'under'] as const) {
      const barriers = direction === 'over'
        ? [0, 1, 2, 3, 4, 5, 6, 7, 8]
        : [1, 2, 3, 4, 5, 6, 7, 8, 9];
      for (const candidateBarrier of barriers) {
        const confidence = confidenceForSetup(market, direction, candidateBarrier);
        if (!isSensibleManualSetup(direction, candidateBarrier, confidence)) continue;
        const score = manualSetupScore(direction, candidateBarrier, confidence);
        const strongestScore = strongest ? manualSetupScore(strongest.direction, strongest.barrier, strongest.confidence) : -Infinity;
        if (!strongest || score > strongestScore || (score === strongestScore && confidence > strongest.confidence)) {
          strongest = { market: market.symbol, direction, barrier: candidateBarrier, confidence };
        }
      }
    }
  }
  return strongest;
}

export function strongestManualSetupForBarrier(
  markets: ManualMarket[],
  candidates: ManualSignalCandidate[],
  barrier: number,
): ManualSetup | null {
  const directions: ManualDirection[] = [
    ...(barrier >= 0 && barrier <= 8 ? ['over' as const] : []),
    ...(barrier >= 1 && barrier <= 9 ? ['under' as const] : []),
  ];
  const symbols = new Set(markets.map((market) => market.symbol));
  const candidate = [...candidates]
    .filter((item) => symbols.has(item.market) && item.barrier === barrier && directions.includes(item.direction))
    .sort((a, b) => manualSetupScore(b.direction, b.barrier, b.estWin, b.edge) - manualSetupScore(a.direction, a.barrier, a.estWin, a.edge)
      || b.estWin - a.estWin
      || b.edge - a.edge)[0];
  if (candidate) {
    return { market: candidate.market, direction: candidate.direction, barrier, confidence: candidate.estWin };
  }

  let strongest: ManualSetup | null = null;
  for (const market of markets) {
    for (const direction of directions) {
      const confidence = confidenceForSetup(market, direction, barrier);
      const score = manualSetupScore(direction, barrier, confidence);
      const strongestScore = strongest ? manualSetupScore(strongest.direction, strongest.barrier, strongest.confidence) : -Infinity;
      if (!strongest || score > strongestScore || (score === strongestScore && confidence > strongest.confidence)) {
        strongest = { market: market.symbol, direction, barrier, confidence };
      }
    }
  }
  return strongest;
}
