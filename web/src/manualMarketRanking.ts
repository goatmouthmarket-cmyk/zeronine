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

export interface ManualSetup {
  market: string;
  direction: ManualDirection;
  barrier: number;
  confidence: number;
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

export function strongestManualSetup(
  markets: ManualMarket[],
  candidates: ManualSignalCandidate[],
): ManualSetup | null {
  const symbols = new Set(markets.map((market) => market.symbol));
  const candidate = [...candidates]
    .filter((item) => symbols.has(item.market))
    .sort((a, b) => b.estWin - a.estWin || b.edge - a.edge)[0];
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
        if (!strongest || confidence > strongest.confidence) {
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
    .sort((a, b) => b.estWin - a.estWin || b.edge - a.edge)[0];
  if (candidate) {
    return { market: candidate.market, direction: candidate.direction, barrier, confidence: candidate.estWin };
  }

  let strongest: ManualSetup | null = null;
  for (const market of markets) {
    for (const direction of directions) {
      const confidence = confidenceForSetup(market, direction, barrier);
      if (!strongest || confidence > strongest.confidence) {
        strongest = { market: market.symbol, direction, barrier, confidence };
      }
    }
  }
  return strongest;
}
