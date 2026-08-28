import type { Direction } from '../core/digitMath.ts';

export type ArbPair = { underBarrier: number; overBarrier: number };
export type SyncQuality = 'excellent' | 'good' | 'fair' | 'poor';
export type ObservationStatus = 'valid' | 'incomplete_pair' | 'invalid_pair';

export const ARB_PAIRS: readonly ArbPair[] = Object.freeze(
  Array.from({ length: 9 }, (_, i) => ({ underBarrier: i + 1, overBarrier: i })),
);

export function arbPairKey(pair: ArbPair): string {
  return `U${pair.underBarrier}/O${pair.overBarrier}`;
}

export function isComplementaryPair(pair: ArbPair): boolean {
  return Number.isInteger(pair.underBarrier)
    && Number.isInteger(pair.overBarrier)
    && pair.underBarrier >= 1
    && pair.underBarrier <= 9
    && pair.overBarrier >= 0
    && pair.overBarrier <= 8
    && pair.underBarrier === pair.overBarrier + 1;
}

export function syncQuality(quoteGapMs: number): SyncQuality {
  if (quoteGapMs <= 25) return 'excellent';
  if (quoteGapMs <= 50) return 'good';
  if (quoteGapMs <= 100) return 'fair';
  return 'poor';
}

export interface ArbQuote {
  symbol: string;
  currency: string;
  duration: number;
  durationUnit: 't' | 'm' | 's';
  basis: 'payout';
  requestedPayout: number;
  askPrice: number;
  payout: number;
  proposalId: string;
  direction: Direction;
  barrier: number;
  requestSentAt: number;
  receivedAt: number;
  roundTripMs: number;
}

export interface ArbCalculation {
  status: ObservationStatus;
  reason?: string;
  quoteGapMs?: number;
  syncQuality?: SyncQuality;
  combinedCost?: number;
  combinedCostPct?: number;
  theoreticalProfit?: number;
  theoreticalRoi?: number;
  houseMarginPct?: number;
  isPositive: boolean;
  isHighQualityCandidate: boolean;
}

/** Validates exactly the paired contracts whose outcome sets partition digits 0-9. */
export function calculateArbitrage(pair: ArbPair, under?: ArbQuote, over?: ArbQuote): ArbCalculation {
  if (!under || !over) return { status: 'incomplete_pair', reason: 'both real proposal responses are required', isPositive: false, isHighQualityCandidate: false };
  if (!isComplementaryPair(pair) || under.direction !== 'under' || over.direction !== 'over'
    || under.barrier !== pair.underBarrier || over.barrier !== pair.overBarrier) {
    return { status: 'invalid_pair', reason: 'contracts are not an adjacent complementary under/over pair', isPositive: false, isHighQualityCandidate: false };
  }
  if (under.symbol !== over.symbol || under.duration !== over.duration || under.durationUnit !== over.durationUnit
    || under.currency !== over.currency || under.basis !== 'payout' || over.basis !== 'payout'
    || under.requestedPayout !== over.requestedPayout || under.payout !== over.payout) {
    return { status: 'invalid_pair', reason: 'proposal parameters do not match', isPositive: false, isHighQualityCandidate: false };
  }
  const payout = under.payout;
  const combinedCost = under.askPrice + over.askPrice;
  if (!Number.isFinite(combinedCost) || !Number.isFinite(payout) || payout <= 0 || combinedCost <= 0) {
    return { status: 'invalid_pair', reason: 'proposal price or payout is invalid', isPositive: false, isHighQualityCandidate: false };
  }
  const quoteGapMs = Math.abs(under.receivedAt - over.receivedAt);
  const quality = syncQuality(quoteGapMs);
  const theoreticalProfit = payout - combinedCost;
  return {
    status: 'valid', quoteGapMs, syncQuality: quality, combinedCost,
    combinedCostPct: (combinedCost / payout) * 100,
    theoreticalProfit,
    theoreticalRoi: (theoreticalProfit / combinedCost) * 100,
    houseMarginPct: ((combinedCost - payout) / payout) * 100,
    isPositive: theoreticalProfit > 0,
    isHighQualityCandidate: theoreticalProfit > 0 && quality !== 'poor',
  };
}
