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
}

export function confidenceForSetup(market: ManualMarket, direction: ManualDirection, barrier: number): number {
  const digits = market.recentDigits.filter((digit) => Number.isInteger(digit) && digit >= 0 && digit <= 9);
  const theoretical = direction === 'over' ? (9 - barrier) / 10 : barrier / 10;
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
