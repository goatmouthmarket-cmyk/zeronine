export type ArbLeg = 'under' | 'over';
export type LegBuyStatus = 'filled' | 'rejected' | 'unknown';
export type SettlementAlignment = 'same_settlement_event' | 'different_settlement_event' | 'unknown_settlement_alignment';
export type FeasibilityStatus = 'both_filled' | 'partial_fill' | 'both_failed' | 'unknown_execution';

export interface DualLegResult {
  leg: ArbLeg;
  status: LegBuyStatus;
  buySentAt: number;
  buyCompletedAt?: number;
  contractId?: string;
  errorCode?: string;
  errorMessage?: string;
  dateStart?: number;
  dateExpiry?: number;
  entryTickTime?: number;
  exitTickTime?: number;
}

export interface FeasibilityResult {
  status: FeasibilityStatus;
  alignment: SettlementAlignment;
  bothOpen: boolean;
  buyRequestGapMs: number | null;
  buyFillGapMs: number | null;
  errorCodes: string[];
}

function finitePair(a?: number, b?: number): number | null {
  return Number.isFinite(a) && Number.isFinite(b) ? Math.abs(Number(a) - Number(b)) : null;
}

/**
 * Classifies a paired DEMO experiment without inferring facts that the provider
 * did not return. It is deliberately independent from the normal bot's single
 * contract lifecycle.
 */
export function assessDualLegFeasibility(under: DualLegResult, over: DualLegResult): FeasibilityResult {
  const filled = [under, over].filter((leg) => leg.status === 'filled');
  const unknown = [under, over].some((leg) => leg.status === 'unknown');
  const status: FeasibilityStatus = unknown
    ? 'unknown_execution'
    : filled.length === 2
      ? 'both_filled'
      : filled.length === 1
        ? 'partial_fill'
        : 'both_failed';

  let alignment: SettlementAlignment = 'unknown_settlement_alignment';
  if (filled.length === 2) {
    const hasSettlementTicks = Number.isFinite(under.exitTickTime) && Number.isFinite(over.exitTickTime);
    const sameStart = Number.isFinite(under.dateStart) && under.dateStart === over.dateStart;
    const sameExpiry = Number.isFinite(under.dateExpiry) && under.dateExpiry === over.dateExpiry;
    if (hasSettlementTicks) {
      alignment = under.exitTickTime === over.exitTickTime && sameStart && sameExpiry
        ? 'same_settlement_event'
        : 'different_settlement_event';
    }
  }

  return {
    status,
    alignment,
    bothOpen: status === 'both_filled' && Boolean(under.contractId && over.contractId),
    buyRequestGapMs: finitePair(under.buySentAt, over.buySentAt),
    buyFillGapMs: finitePair(under.buyCompletedAt, over.buyCompletedAt),
    errorCodes: [under.errorCode, over.errorCode].filter((value): value is string => Boolean(value)),
  };
}

export function canConsiderDualLegExecution(result: FeasibilityResult): boolean {
  return result.status === 'both_filled' && result.alignment === 'same_settlement_event';
}
