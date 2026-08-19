import type { Direction } from '../core/digitMath.ts';

export interface LadderOption {
  direction: Direction;
  barrier: number;
  estWin: number;
  ask: number;
  payout: number;
}

export type StrategyMode = 'conservative' | 'martingale' | 'boosted_martingale' | 'chase';

export type RecoveryReason = 'base' | 'martingale' | 'boosted_martingale' | 'chase';

export interface RecoveryDecision {
  stake: number;
  direction: Direction;
  barrier: number;
  reason: RecoveryReason;
  estWin: number;
  payout: number;
  holds: boolean;
  holdReason?: string;
}

export interface RecoveryContext {
  mode: 'base' | 'recovering';
  streak: number;
  debt: number;
  attempts: number;
  cycleStake: number;
  peakBalance: number;
  baseStake: number;
  maxStake: number;
  minRecoveryWinRate: number;
  martingaleSteps: number;
  maxConsecutiveLosses: number;
  strategy: StrategyMode;
  multiplier: number;
  recoveryBuffer: number;
  chaseAmortize: number;
  maxRecoveryDebt: number;
  maxRecoveryExposure: number;
  maxDrawdownPct: number;
}

// Recovery scoring weights: expected value, win probability, capital efficiency.
const EDGE_W = 0.5;
const PROB_W = 0.3;
const EFF_W = 0.2;

// Recovery bets must be strictly positive expected value. Hit rate is never
// profitability; a bet below this line is never taken to chase debt.
export const RECOVERY_MIN_EDGE = 0;

function hold(reason: RecoveryReason, holdReason: string): RecoveryDecision {
  return { stake: 0, direction: 'over', barrier: 1, reason, estWin: 0, payout: 0, holds: true, holdReason };
}

// Per-profile recovery target. Martingale clears the whole debt in one win,
// Boosted adds a profit buffer so a win lands ahead, Chase amortizes the debt
// over several favorable bets (35% per bet by default).
function profileTarget(ctx: RecoveryContext): number {
  if (ctx.strategy === 'boosted_martingale') {
    return ctx.debt + ctx.baseStake * ctx.recoveryBuffer;
  }
  if (ctx.strategy === 'chase') {
    return Math.max(ctx.baseStake * 0.5, Math.min(ctx.debt, ctx.debt * ctx.chaseAmortize));
  }
  return ctx.debt;
}

export function planRecovery(
  ladder: LadderOption[],
  ctx: RecoveryContext,
  preference: { direction: Direction; barrier: number },
): RecoveryDecision {
  const preferred =
    ladder.find((o) => o.direction === preference.direction && o.barrier === preference.barrier) ?? ladder[0];

  const baseBet: RecoveryDecision = {
    stake: ctx.baseStake,
    direction: preferred?.direction ?? 'over',
    barrier: preferred?.barrier ?? 1,
    reason: 'base',
    estWin: preferred?.estWin ?? 0.8,
    payout: preferred?.payout ?? 0,
    holds: false,
  };

  // Conservative: flat bet every round, no stake escalation, no recovery.
  if (ctx.strategy === 'conservative') return baseBet;

  // No debt to recover - base bet at the flat stake.
  if (ctx.debt <= 0.005) return baseBet;

  // Cycle-level safety rails. These stop the run rather than trade through.
  if (ctx.debt >= ctx.maxRecoveryDebt) {
    return hold(ctx.strategy, `recovery debt cap (${ctx.maxRecoveryDebt}) reached`);
  }
  if (ctx.cycleStake + ctx.maxStake > ctx.maxRecoveryExposure) {
    return hold(ctx.strategy, `recovery exposure cap (${ctx.maxRecoveryExposure}) would be exceeded`);
  }
  if (ctx.streak + 1 > ctx.maxConsecutiveLosses) {
    return hold(ctx.strategy, `consecutive loss cap (${ctx.maxConsecutiveLosses}) reached`);
  }

  // Rescan the quoted ladder and pick the best positive-edge recovery contract
  // for the current debt, using REAL quote ratios (payout / ask).
  const target = profileTarget(ctx);
  let best: { o: LadderOption; stake: number; score: number } | null = null;

  for (const o of ladder) {
    const ratio = o.ask > 0 ? o.payout / o.ask : 0;
    const gain = ratio - 1;
    if (gain <= 1e-6) continue;                      // payout too low to recover
    if (o.estWin < ctx.minRecoveryWinRate) continue; // win probability too low

    const ev = o.estWin * ratio - 1;
    if (ev <= RECOVERY_MIN_EDGE) continue; // strict positive-EV gate

    const requiredStake = target / gain;
    // Never dribble sub-base bets: if the profitably-required stake is below
    // baseStake, fall back to a flat baseStake so the bet stays meaningful.
    const stake = requiredStake < ctx.baseStake ? ctx.baseStake : Math.min(requiredStake, ctx.maxStake);

    const efficiency = Math.min(1, (stake * gain) / Math.max(0.0001, ctx.debt));
    const score = EDGE_W * ev + PROB_W * o.estWin + EFF_W * efficiency;
    if (!best || score > best.score) best = { o, stake, score };
  }

  if (!best) {
    // No affordable contract clears the positive-EV bar right now. The market
    // can rotate onto a better barrier, so this is a wait-and-rescan HOLD, not
    // a stop - the delegated runner decides how to surface it.
    return hold(ctx.strategy, 'no positive-edge recovery contract available');
  }

  return {
    stake: best.stake,
    direction: best.o.direction,
    barrier: best.o.barrier,
    reason: ctx.strategy,
    estWin: best.o.estWin,
    payout: best.o.payout,
    holds: false,
  };
}