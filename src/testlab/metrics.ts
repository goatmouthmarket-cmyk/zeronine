import type { TradeRow } from '../db/store.ts';
import type { TestRunRow } from '../db/store.ts';

export interface Aggregate {
  trades: number;
  wins: number;
  losses: number;
  net_pnl: number;
  win_rate: number | null;
  avg_stake: number | null;
  max_drawdown_pct: number | null;
  best_streak: number | null;
  worst_streak: number | null;
  final_balance: number | null;
}

/**
 * Aggregate a sequence of settled trades into the shared metric shape used by
 * both backtest and paper runs (and the "winner" comparison).
 */
export function computeMetrics(
  trades: Array<{ status?: string; won?: boolean; profit: number; stake: number }>,
  startBalance: number,
): Aggregate {
  const win = (t: { status?: string; won?: boolean }): boolean => t.won !== undefined ? t.won : t.status === 'won';
  const wins = trades.filter(win).length;
  const losses = trades.length - wins;
  const net_pnl = trades.reduce((sum, t) => sum + (Number.isFinite(t.profit) ? t.profit : 0), 0);
  const totalStake = trades.reduce((sum, t) => sum + (Number.isFinite(t.stake) ? t.stake : 0), 0);

  let balance = startBalance;
  let peak = startBalance;
  let maxDrawdownPct = 0;
  let winRun = 0;
  let lossRun = 0;
  let best = 0;
  let worst = 0;

  for (const t of trades) {
    const profit = Number.isFinite(t.profit) ? t.profit : 0;
    balance += profit;
    if (win(t)) {
      winRun += 1;
      lossRun = 0;
      best = Math.max(best, winRun);
    } else {
      lossRun += 1;
      winRun = 0;
      worst = Math.max(worst, lossRun);
    }
    peak = Math.max(peak, balance);
    if (peak > 0) maxDrawdownPct = Math.max(maxDrawdownPct, ((peak - balance) / peak) * 100);
  }

  return {
    trades: trades.length,
    wins,
    losses,
    net_pnl: round2(net_pnl),
    win_rate: trades.length > 0 ? (wins / trades.length) * 100 : null,
    avg_stake: trades.length > 0 ? round2(totalStake / trades.length) : null,
    max_drawdown_pct: maxDrawdownPct,
    best_streak: best,
    worst_streak: worst,
    final_balance: round2(balance),
  };
}

export function runRow(
  kind: TestRunRow['kind'],
  strategy_mode: string,
  bot_mode: string,
  baseStake: number,
  target: number,
  agg: Aggregate,
  startedAt: number,
): Omit<TestRunRow, 'id'> {
  return {
    kind,
    source: 'manual',
    strategy_mode,
    bot_mode,
    base_stake: baseStake,
    target,
    trades: agg.trades,
    wins: agg.wins,
    losses: agg.losses,
    net_pnl: agg.net_pnl,
    win_rate: agg.win_rate != null ? round2(agg.win_rate) : null,
    avg_stake: agg.avg_stake,
    max_drawdown_pct: agg.max_drawdown_pct != null ? round2(agg.max_drawdown_pct) : null,
    best_streak: agg.best_streak,
    worst_streak: agg.worst_streak,
    final_balance: agg.final_balance,
    started_at: startedAt,
    finished_at: Date.now(),
  };
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}