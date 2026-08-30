import { getOpenTrade, getRecovery } from '../db/store.ts';
import type { SettingsRow } from '../db/store.ts';
import type { RecoveryContext, StrategyMode } from '../strategy/recovery.ts';
import { config } from '../config.ts';

export interface RiskCheck {
  ok: boolean;
  reason: string;
}

export function buildRecoveryContext(settings: SettingsRow, accountId?: string): RecoveryContext {
  const rec = getRecovery(accountId);
  const strategy: StrategyMode =
    settings.strategy_mode === 'martingale' ||
    settings.strategy_mode === 'boosted_martingale' ||
    settings.strategy_mode === 'chase'
      ? settings.strategy_mode
      : 'conservative';
  return {
    mode: rec.mode,
    streak: rec.streak,
    debt: rec.debt,
    attempts: rec.attempts,
    cycleStake: rec.cycleStake,
    peakBalance: rec.peakBalance,
    baseStake: settings.base_stake,
    maxStake: settings.max_stake,
    minRecoveryWinRate: settings.min_recovery_win,
    minExtremeWin: config.minExtremeWin,
    martingaleSteps: settings.martingale_steps,
    maxConsecutiveLosses: settings.max_consecutive_losses,
    strategy,
    multiplier: settings.strategy_multiplier,
    recoveryBuffer: settings.recovery_buffer,
    chaseAmortize: settings.chase_amortize,
    maxRecoveryDebt: settings.max_recovery_debt,
    maxRecoveryExposure: settings.max_recovery_exposure,
    maxDrawdownPct: settings.max_drawdown_pct,
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
  accountId?: string;
  skipRecoveryDebtCap?: boolean;
}): RiskCheck {
  const { stake, settings, balance, context, lastTradeAt, tradeGapMs } = params;

  if (!Number.isFinite(stake) || stake <= 0) return { ok: false, reason: 'invalid stake' };
  if (balance > 0 && stake > balance * 0.9) return { ok: false, reason: 'insufficient balance' };

  // Peak-drawdown rail: once the account drops maxDrawdownPct below its peak,
  // no further trades are permitted until a manual reset of the run.
  const drawdownPct = settings.max_drawdown_pct > 0 ? settings.max_drawdown_pct / 100 : 0;
  if (
    drawdownPct > 0 &&
    context.peakBalance > 0 &&
    balance > 0 &&
    (context.peakBalance - balance) / context.peakBalance >= drawdownPct
  ) {
    return { ok: false, reason: `max drawdown (${settings.max_drawdown_pct}%) reached` };
  }

  if (context.streak + 1 > settings.max_consecutive_losses) {
    return { ok: false, reason: `consecutive loss cap (${settings.max_consecutive_losses}) reached` };
  }

  // Cycle-limit rails are only active while recovering debt.
  if (context.debt > 0.005) {
    if (context.cycleStake + stake > settings.max_recovery_exposure) {
      return { ok: false, reason: `recovery exposure cap (${settings.max_recovery_exposure}) would be exceeded` };
    }
    if (!params.skipRecoveryDebtCap && context.debt >= settings.max_recovery_debt) {
      return { ok: false, reason: `recovery debt cap (${settings.max_recovery_debt}) reached` };
    }
  }

  const open = getOpenTrade(params.accountId);
  if (open) return { ok: false, reason: `open contract still settling (${open.status})` };

  if (tradeGapMs > 0 && lastTradeAt > 0 && params.now - lastTradeAt < tradeGapMs) {
    return { ok: false, reason: 'trade gap not elapsed' };
  }

  return { ok: true, reason: 'ok' };
}

/**
 * Debt-based recovery state machine. A loss pushes the bot into recovery and
 * accumulates the lost amount as debt; wins pay the debt down. The bot only
 * returns to base once the whole debt is cleared.
 *
 * - conservative: flat ~90% bets (Over 0 / Under 9); on a loss it recovers
 *   the lost amount the same way martingale does.
 * - martingale / boosted_martingale: a win should clear the whole debt.
 * - chase: a win clears the amortized chunk and keeps hunting until debt is 0.
 */
/**
 * Pure form of the recovery state transition so the test lab can replay
 * strategies against historical data without touching the live recovery row.
 */
export function nextRecovery(
  cur: { mode: 'base' | 'recovering'; streak: number; debt: number; attempts: number; cycleStake: number; peakBalance: number },
  won: boolean,
  profit: number,
  balance?: number,
): { mode: 'base' | 'recovering'; streak: number; debt: number; attempts: number; cycleStake: number; peakBalance: number } {
  const peakBalance = balance != null && balance > 0 ? Math.max(cur.peakBalance || balance, balance) : cur.peakBalance;

  if (won) {
    const debt = cur.debt - Math.max(0, profit);
    if (debt <= 0.005) {
      return { mode: 'base', streak: 0, debt: 0, attempts: cur.attempts, cycleStake: 0, peakBalance };
    }
    return { mode: 'recovering', streak: 0, debt, attempts: cur.attempts, cycleStake: cur.cycleStake, peakBalance };
  }

  const loss = Math.max(0, -profit) || 0;
  return {
    mode: 'recovering',
    streak: cur.streak + 1,
    debt: cur.debt + loss,
    attempts: cur.attempts + 1,
    cycleStake: cur.cycleStake + loss,
    peakBalance,
  };
}

export function applyOutcome(
  won: boolean,
  profit: number,
  settings: SettingsRow,
  balance?: number,
  accountId?: string,
): { mode: 'base' | 'recovering'; streak: number; debt: number; attempts: number; cycleStake: number; peakBalance: number } {
  const cur = getRecovery(accountId);
  return nextRecovery(cur, won, profit, balance);
}
