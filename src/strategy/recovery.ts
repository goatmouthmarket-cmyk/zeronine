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
  lost: number;
  baseStake: number;
  maxStake: number;
  minRecoveryWinRate: number;
  martingaleSteps: number;
  maxConsecutiveLosses: number;
  strategy: StrategyMode;
  multiplier: number;
}

export function planRecovery(
  ladder: LadderOption[],
  ctx: RecoveryContext,
  preference: { direction: Direction; barrier: number },
): RecoveryDecision {
  const preferred =
    ladder.find((o) => o.direction === preference.direction && o.barrier === preference.barrier) ?? ladder[0];

  // Conservative: flat bet every round, never raise the stake and never change the barrier.
  if (ctx.strategy === 'conservative') {
    return {
      stake: ctx.baseStake,
      direction: preferred?.direction ?? 'over',
      barrier: preferred?.barrier ?? 1,
      reason: 'base',
      estWin: preferred?.estWin ?? 0.8,
      payout: preferred?.payout ?? 0,
      holds: false,
    };
  }

  // Martingale / Chase: after a loss, keep betting the SAME side/barrier (the
  // digit/prediction never changes) but raise the stake using the payout math
  // so a single win covers the whole amount lost so far:
  //     stake = lost / (payout - 1)
  // When that stake would exceed maxStake the recovery is SPLIT into 2+ bets,
  // each capped at maxStake, and every win pays the debt down until the lost
  // amount is fully won back.
  if (ctx.strategy === 'martingale' || ctx.strategy === 'chase') {
    if (ctx.mode !== 'recovering' || ctx.lost <= 0) {
      return {
        stake: ctx.baseStake,
        direction: preferred?.direction ?? 'over',
        barrier: preferred?.barrier ?? 1,
        reason: 'base',
        estWin: preferred?.estWin ?? 0.8,
        payout: preferred?.payout ?? 0,
        holds: false,
      };
    }
    if (ctx.streak + 1 > ctx.maxConsecutiveLosses) {
      return {
        stake: 0,
        direction: 'over',
        barrier: 1,
        reason: ctx.strategy,
        estWin: 0,
        payout: 0,
        holds: true,
        holdReason: `consecutive loss cap (${ctx.maxConsecutiveLosses}) reached`,
      };
    }
    const gain = (preferred?.payout ?? 0) - 1;
    let stake = gain > 0 ? ctx.lost / gain : ctx.baseStake;
    if (!Number.isFinite(stake) || stake <= 0) stake = ctx.baseStake;
    stake = Math.min(stake, ctx.maxStake);
    return {
      stake,
      direction: preferred?.direction ?? 'over',
      barrier: preferred?.barrier ?? 1,
      reason: ctx.strategy,
      estWin: preferred?.estWin ?? 0.8,
      payout: preferred?.payout ?? 0,
      holds: false,
    };
  }

  if (ctx.streak === 0) {
    return {
      stake: ctx.baseStake,
      direction: preferred?.direction ?? 'over',
      barrier: preferred?.barrier ?? 1,
      reason: 'base',
      estWin: preferred?.estWin ?? 0.8,
      payout: preferred?.payout ?? 0,
      holds: false,
    };
  }

  if (ctx.streak + 1 > ctx.maxConsecutiveLosses) {
    return {
      stake: 0,
      direction: 'over',
      barrier: 1,
      reason: 'boosted_martingale',
      estWin: 0,
      payout: 0,
      holds: true,
      holdReason: `consecutive loss cap (${ctx.maxConsecutiveLosses}) reached`,
    };
  }

  // Boosted martingale: redo the SAME barrier, raising the stake by the
  // configured multiplier each loss so a win covers the streak.
  const multiple = Math.max(2, ctx.multiplier);
  const step = Math.min(ctx.streak, ctx.martingaleSteps);
  const stake = Math.min(ctx.baseStake * multiple ** step, ctx.maxStake);
  return {
    stake,
    direction: preferred?.direction ?? 'over',
    barrier: preferred?.barrier ?? 1,
    reason: 'boosted_martingale',
    estWin: preferred?.estWin ?? 0.8,
    payout: preferred?.payout ?? 0,
    holds: false,
  };
}