import { runningPnlToday, getOpenTrade } from '../db/store.ts';
import type { SettingsRow } from '../db/store.ts';
import { getRecovery } from '../db/store.ts';
import type { RecoveryContext, StrategyMode } from '../strategy/recovery.ts';

export interface RiskCheck {
  ok: boolean;
  reason: string;
}

export function buildRecoveryContext(settings: SettingsRow): RecoveryContext {
  const rec = getRecovery();
  const strategy: StrategyMode =
    settings.strategy_mode === 'martingale' ||
    settings.strategy_mode === 'boosted_martingale' ||
    settings.strategy_mode === 'chase'
      ? settings.strategy_mode
      : 'conservative';
  return {
    mode: rec.mode,
    streak: rec.streak,
    lost: rec.lost,
    baseStake: settings.base_stake,
    maxStake: settings.max_stake,
    minRecoveryWinRate: settings.min_recovery_win,
    martingaleSteps: settings.martingale_steps,
    maxConsecutiveLosses: settings.max_consecutive_losses,
    strategy,
    multiplier: settings.strategy_multiplier,
  };
}

export function riskCheck(params: {
  stake: number;
  settings: SettingsRow;
  balance: number;
  context: RecoveryContext;
  lastTradeAt: number;
  tradeGapMs: number;
  now: number;
}): RiskCheck {
  const { stake, settings, balance, context, lastTradeAt, tradeGapMs } = params;

  if (!Number.isFinite(stake) || stake <= 0) return { ok: false, reason: 'invalid stake' };
  if (stake > settings.max_stake) return { ok: false, reason: 'stake exceeds max stake' };
  if (balance > 0 && stake > balance * 0.9) return { ok: false, reason: 'insufficient balance' };

  const dailyLoss = runningPnlToday();
  if (dailyLoss - stake < -settings.daily_loss_limit) {
    return { ok: false, reason: `daily loss limit would be breached (pnl ${dailyLoss.toFixed(2)})` };
  }

  if (context.streak + 1 > settings.max_consecutive_losses) {
    return { ok: false, reason: `consecutive loss cap (${settings.max_consecutive_losses}) reached` };
  }

  const open = getOpenTrade();
  if (open) return { ok: false, reason: `open contract still settling (${open.status})` };

  if (tradeGapMs > 0 && lastTradeAt > 0 && params.now - lastTradeAt < tradeGapMs) {
    return { ok: false, reason: 'trade gap not elapsed' };
  }

  return { ok: true, reason: 'ok' };
}

export function applyOutcome(
  won: boolean,
  profit: number,
  settings: SettingsRow,
): { mode: 'base' | 'recovering'; streak: number; lost: number } {
  const ctx = buildRecoveryContext(settings);
  if (won) {
    // Martingale/Chase: a win pays the debt down and only returns to base once
    // the whole lost amount is recovered (the chase is split across several bets).
    if ((ctx.strategy === 'martingale' || ctx.strategy === 'chase') && ctx.lost > 0) {
      const debt = ctx.lost - Math.max(0, profit);
      if (debt > 0.005) {
        return { mode: 'recovering', streak: 0, lost: debt };
      }
    }
    return { mode: 'base', streak: 0, lost: 0 };
  }
  const next = {
    mode: 'recovering' as const,
    streak: ctx.streak + 1,
    lost: ctx.lost + Math.max(0, -profit),
  };
  return next;
}