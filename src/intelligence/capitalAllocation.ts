import type { MarketHealth } from './health.ts';
import type { RegimeAssessment } from './regime.ts';

export interface AllocationRecoveryContext {
  /** Consecutive losses in the active recovery cycle. */
  streak?: number;
}

/**
 * Context used to reduce a stake proposed by the signal or recovery planner.
 * The proposal remains the source of truth for recovery debt math; this module
 * only determines how much of it is prudent to expose on this contract.
 */
export interface CapitalAllocationInput {
  proposedStake: number;
  balance?: number;
  maxStake?: number;
  maxBalanceFraction?: number;
  health?: Pick<MarketHealth, 'score'>;
  regime?: Pick<RegimeAssessment, 'regime'>;
  deceptionScore?: number;
  recovery?: AllocationRecoveryContext;
  /** Current peak-to-balance drawdown, expressed as a percentage. */
  drawdownPct?: number;
}

export interface CapitalAllocation {
  /** The stake supplied by the signal or recovery planner, unchanged. */
  requestedStake: number;
  /** Executable stake after conservative reductions and explicit caps. */
  stake: number;
  /** stake / requestedStake, always in the inclusive range 0..1. */
  multiplier: number;
  reasons: string[];
}

const DEFAULT_MAX_BALANCE_FRACTION = 0.02;

function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, value));
}

function healthMultiplier(score: number | undefined): { value: number; reason?: string } {
  if (score == null || !Number.isFinite(score)) return { value: 1 };
  if (score < 40) return { value: 0.5, reason: 'avoid health' };
  if (score < 60) return { value: 0.75, reason: 'weak health' };
  return { value: 1 };
}

function regimeMultiplier(regime: RegimeAssessment['regime'] | undefined): { value: number; reason?: string } {
  switch (regime) {
    case 'transitioning': return { value: 0.85, reason: 'transitioning regime' };
    case 'volatile': return { value: 0.65, reason: 'volatile regime' };
    case 'loss_cluster': return { value: 0.6, reason: 'loss-cluster regime' };
    case 'uncertain': return { value: 0.7, reason: 'uncertain regime' };
    default: return { value: 1 };
  }
}

function lossMultiplier(streak: number | undefined): { value: number; reason?: string } {
  if (streak == null || !Number.isFinite(streak) || streak <= 0) return { value: 1 };
  if (streak >= 5) return { value: 0.5, reason: 'extended loss streak' };
  if (streak >= 3) return { value: 0.7, reason: 'loss streak' };
  return { value: 0.85, reason: 'recent loss' };
}

function drawdownMultiplier(drawdownPct: number | undefined): { value: number; reason?: string } {
  if (drawdownPct == null || !Number.isFinite(drawdownPct) || drawdownPct < 5) return { value: 1 };
  if (drawdownPct >= 25) return { value: 0.5, reason: 'deep drawdown' };
  if (drawdownPct >= 15) return { value: 0.65, reason: 'drawdown' };
  return { value: 0.8, reason: 'moderate drawdown' };
}

function reduce(
  current: number,
  adjustment: { value: number; reason?: string },
  reasons: string[],
): number {
  if (adjustment.reason) reasons.push(adjustment.reason);
  return current * adjustment.value;
}

function floorCents(value: number): number {
  // Rounding down keeps the cent normalization from creating extra exposure.
  return Math.floor((value + Number.EPSILON) * 100) / 100;
}

/**
 * Produces a conservative stake from a proposal without making an eligibility
 * decision. `riskCheck()` must still run after allocation as the authoritative
 * final safety gate.
 */
export function allocateCapital(input: CapitalAllocationInput): CapitalAllocation {
  const requestedStake = input.proposedStake;
  if (!Number.isFinite(requestedStake) || requestedStake <= 0) {
    return { requestedStake, stake: 0, multiplier: 0, reasons: ['invalid proposed stake'] };
  }

  const reasons: string[] = [];
  let stake = requestedStake;
  stake = reduce(stake, healthMultiplier(input.health?.score), reasons);
  stake = reduce(stake, regimeMultiplier(input.regime?.regime), reasons);

  if (input.deceptionScore != null && Number.isFinite(input.deceptionScore)) {
    const deception = clamp(input.deceptionScore, 0, 100);
    const reduction = 1 - deception * 0.005;
    stake = reduce(stake, { value: reduction, reason: deception > 0 ? 'deception caution' : undefined }, reasons);
  }

  stake = reduce(stake, lossMultiplier(input.recovery?.streak), reasons);
  stake = reduce(stake, drawdownMultiplier(input.drawdownPct), reasons);

  if (input.maxStake != null && Number.isFinite(input.maxStake) && input.maxStake > 0 && stake > input.maxStake) {
    stake = input.maxStake;
    reasons.push('max stake cap');
  }

  if (input.balance != null && Number.isFinite(input.balance) && input.balance > 0) {
    const fraction = input.maxBalanceFraction == null
      ? DEFAULT_MAX_BALANCE_FRACTION
      : clamp(input.maxBalanceFraction, 0, 1);
    const balanceCap = input.balance * fraction;
    if (stake > balanceCap) {
      stake = balanceCap;
      reasons.push('balance allocation cap');
    }
  }

  stake = floorCents(clamp(stake, 0, requestedStake));
  return {
    requestedStake,
    stake,
    multiplier: stake / requestedStake,
    reasons,
  };
}
