import { config } from '../config.ts';
import type { Hub } from '../api/hub.ts';
import type { MarketRegistry } from '../core/marketState.ts';
import type { DerivPrivateClient, ContractUpdate } from '../deriv/privateClient.ts';
import type { LadderOption, RecoveryDecision } from '../strategy/recovery.ts';
import { planRecovery } from '../strategy/recovery.ts';
import { pickSignal } from '../strategy/signal.ts';
import { applyOutcome, buildRecoveryContext, riskCheck } from '../strategy/risk.ts';
import type { Direction } from '../core/digitMath.ts';
import type { TradeRow, SettingsRow } from '../db/store.ts';
import {
  getPendingTrades,
  getRecovery,
  getSession,
  getSettings,
  insertScannerLog,
  insertTrade,
  lastDigitEvents,
  listTrades,
  recordQuote,
  resetRecovery,
  resolveTrade,
  saveRecovery,
  setAutomation,
} from '../db/store.ts';

const HOLD = 'hold';

interface QuotedOption {
  market: string;
  direction: Direction;
  barrier: number;
  estWin: number;
  consistency: number;
  entropy: number;
  momentum: number;
  ask: number;
  payout: number;
  realEdge: number;
  realEV: number;
}

type RecoveryStake = RecoveryDecision & { market: string };

function recoveryHold(): RecoveryStake {
  return { stake: 0, direction: 'over', barrier: 1, reason: 'base', estWin: 0, payout: 0, holds: true, market: '' };
}

/**
 * Resolve the user's barrier preference into the concrete set of
 * (direction, barrier) contracts the strategy may quote and buy.
 *
 * - 'auto': every scanned barrier is eligible. Conservative is the exception:
 *   it never plays anything but the safe extremes (Over 0 / Under 9).
 * - 'over' / 'under': only that side is played, at the configured barrier.
 *   Conservative still locks to the safe extreme for that side (0 for Over,
 *   9 for Under).
 */
function barrierAllowed(settings: SettingsRow): Array<{ direction: Direction; barrier: number }> | null {
  const raw = settings.barrier_preference;
  const mode: 'auto' | 'over' | 'under' =
    raw === 'over' || raw.startsWith('over') ? 'over' : raw === 'under' || raw.startsWith('under') ? 'under' : 'auto';
  const barrier = settings.barrier_number ?? (mode === 'under' ? 9 : 0);

  if (settings.strategy_mode === 'conservative') {
    if (mode === 'over') return [{ direction: 'over', barrier: 0 }];
    if (mode === 'under') return [{ direction: 'under', barrier: 9 }];
    return [
      { direction: 'over', barrier: 0 },
      { direction: 'under', barrier: 9 },
    ];
  }
  if (mode === 'over') return [{ direction: 'over', barrier: Math.max(0, Math.min(8, Math.trunc(barrier))) }];
  if (mode === 'under') return [{ direction: 'under', barrier: Math.max(1, Math.min(9, Math.trunc(barrier))) }];
  return null;
}

/**
 * How easily the bot pulls the trigger.
 * - 'rapid': lower probability floor and half the edge bar — fires on thinner
 *   edges, so more bets land. Higher whipsaw risk.
 * - 'balanced': stock gates.
 * - 'strict': higher probability floor and double the edge bar — fewer, higher
 *   confidence trades.
 */
function modeGates(settings: SettingsRow): { minWin: number; minEdge: number } {
  switch (settings.bot_mode) {
    case 'rapid':
      return { minWin: 0.3, minEdge: Math.max(0.003, settings.min_edge * 0.5) };
    case 'strict':
      return { minWin: 0.4, minEdge: settings.min_edge * 2 };
    default:
      return { minWin: 0.35, minEdge: settings.min_edge };
  }
}

export class Automation {
  private running = false;
  private disposed = false;
  private timer: NodeJS.Timeout | null = null;
  private busiest = 0;
  private phase = 'idle';

  private registry: MarketRegistry;
  private client: DerivPrivateClient;
  private hub: Hub;

  private runTarget = 0;
  private runTrades = 0;

  constructor(registry: MarketRegistry, client: DerivPrivateClient, hub: Hub) {
    this.registry = registry;
    this.client = client;
    this.hub = hub;
  }

  isRunning(): boolean {
    return this.running;
  }

  state(): Record<string, unknown> {
    return {
      running: this.running,
      phase: this.phase,
      lastCompletedAt: this.lastCompletedAt(),
      runTarget: this.runTarget,
      runTrades: this.runTrades,
    };
  }

  private lastCompletedAt(): number {
    const trades = listTrades(1);
    return trades.length ? trades[0].ts : 0;
  }

  start(opts: { maxTrades?: number } = {}): void {
    if (this.running) return;
    this.running = true;
    this.runTarget = Math.max(0, Math.floor(opts.maxTrades ?? 0) || 0);
    this.runTrades = 0;
    resetRecovery();
    setAutomation({
      running: 1,
      started_at: Date.now(),
      target_trades: this.runTarget,
      trades_done: 0,
      reason: 'started',
    });
    this.emit({ type: 'recovery', ts: Date.now(), recovery: getRecovery(), reset: true });
    this.emit({ type: 'status', ts: Date.now(), state: this.state() });
    this.schedule(50);
  }

  stop(reason = 'stopped'): void {
    if (!this.running) return;
    this.running = false;
    this.phase = 'standby';
    setAutomation({ running: 0, stopped_at: Date.now(), reason, trades_done: this.runTrades });
    this.emit({ type: 'status', ts: Date.now(), state: this.state(), reason });
  }

  /**
   * Watch mode: keep the scanner alive even when the bot is stopped so the
   * hero always shows a fresh entry (useful for manual bets). Scan + quote
   * run on every cycle, but purchases only happen while `this.running`.
   */
  watch(): void {
    if (this.timer) return;
    this.disposed = false;
    this.schedule(50);
  }

  dispose(): void {
    this.disposed = true;
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    setAutomation({ running: 0, stopped_at: Date.now(), reason: 'server shutdown', trades_done: this.runTrades });
  }

  private schedule(delay: number): void {
    if (this.disposed) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.loop();
    }, delay);
  }

  private emit(evt: { type: string; ts: number; [k: string]: unknown }): void {
    this.hub.emit(evt as Parameters<Hub['emit']>[0]);
  }

  private async loop(): Promise<void> {
    if (this.disposed) return;
    let delay = 600;
    try {
      const result = await this.cycle();
      if (result && Number.isFinite(result)) delay = result;
    } catch (err) {
      this.emit({ type: 'error', ts: Date.now(), message: String(err) });
      delay = 1200;
    } finally {
      this.schedule(delay);
    }
  }

  private async cycle(): Promise<number> {
    this.busiest = Date.now();
    const settings = getSettings();

    if (!this.client.isConnected) {
      this.emit({ type: HOLD, ts: Date.now(), reason: 'account not connected' });
      this.phase = 'waiting-connection';
      return 1200;
    }

    const session = getSession();
    if (!session) {
      this.emit({ type: HOLD, ts: Date.now(), reason: 'no session' });
      return 1200;
    }

    // Auto-unstick stale pending bets (leftover after a restart, a failed buy,
    // or a settlement that never came back). Reconcile each one so the loop can
    // never stall forever waiting on an open contract.
    const pending = getPendingTrades();
    if (pending.length > 0) {
      await this.reconcilePending(pending);
      if (getPendingTrades().length > 0) {
        this.emit({ type: HOLD, ts: Date.now(), reason: 'waiting open contract to settle' });
        this.phase = 'waiting-settlement';
        return 350;
      }
    }

    const rec = getRecovery();
    const ctx = buildRecoveryContext(settings);

    // Betting-only guards. In watch mode (bot stopped) these would trip on a
    // burnt daily limit and spin forever, so they only apply once trading.
    if (this.running) {
      // Daily loss guard
      const guard = riskCheck({
        stake: settings.max_stake,
        settings,
        balance: session.balance,
        context: ctx,
        lastTradeAt: 0,
        tradeGapMs: 0,
        now: Date.now(),
      });
      if (!guard.ok && (guard.reason.includes('daily loss') || guard.reason.includes('drawdown'))) {
        this.emit({ type: HOLD, ts: Date.now(), reason: guard.reason });
        this.stop(guard.reason);
        return 0;
      }
    }

    this.phase = 'scanning';
    const { minWin, minEdge } = modeGates(settings);
    const signal = pickSignal(
      this.registry,
      minWin,
      minEdge,
      (symbol, count) =>
        lastDigitEvents(symbol, count)
          .reverse()
          .map((e) => e.digit),
      undefined,
      barrierAllowed(settings),
    );
    this.emit({ type: 'signal', ts: Date.now(), signal, phase: this.phase });
    if (signal.holds) {
      this.emit({ type: HOLD, ts: Date.now(), reason: signal.reason });
      this.phase = 'waiting-edge';
      return 1500; // WAIT is a valid outcome: no obligation to trade every scan
    }

    // Quote every shortlist candidate across markets. Real ratios (payout/ask)
    // give the actual breakeven / edge / EV that drive the pick.
    this.phase = 'quoting';
    const quotes: QuotedOption[] = [];
    for (const c of signal.candidates) {
      try {
        const q = await this.client.getQuote({
          direction: c.direction,
          barrier: c.barrier,
          amount: settings.base_stake,
          currency: session.currency || 'USD',
          duration: 1,
          durationUnit: 't',
          symbol: c.market,
        });
        const ratio = q.askPrice > 0 ? q.payout / q.askPrice : 0;
        quotes.push({
          market: c.market,
          direction: c.direction,
          barrier: c.barrier,
          estWin: c.estWin,
          consistency: c.consistency,
          entropy: c.entropy,
          momentum: c.momentum,
          ask: q.askPrice,
          payout: q.payout,
          realEdge: c.estWin - (ratio > 0 ? 1 / ratio : 0),
          realEV: c.estWin * ratio - 1,
        });
        recordQuote(c.market, c.direction, c.barrier, ratio);
        this.emit({
          type: 'quote',
          ts: Date.now(),
          market: c.market,
          direction: c.direction,
          barrier: c.barrier,
          ask: q.askPrice,
          payout: q.payout,
          estWin: c.estWin,
          realEdge: c.estWin - (ratio > 0 ? 1 / ratio : 0),
        });
      } catch (err) {
        this.emit({ type: 'quote_error', ts: Date.now(), option: { ...c }, message: String(err) });
      }
    }
    if (quotes.length === 0) {
      this.emit({ type: HOLD, ts: Date.now(), reason: 'no live quotes available' });
      this.phase = 'waiting-quotes';
      return 1500;
    }

    // Watch mode: bot is stopped but we still surface fresh signals so the
    // hero always has a target for manual bets. Nothing is ever purchased here.
    if (!this.running) {
      this.phase = 'standby';
      return 1500;
    }

    this.phase = 'deciding';
    await new Promise((r) => setTimeout(r, 80)); // let the market rotate onto the chosen barrier
    const top = quotes[0];
    if (this.client.isConnected && top) {
      try {
        const q = await this.client.getQuote({
          direction: top.direction,
          barrier: top.barrier,
          amount: settings.base_stake,
          currency: session.currency || 'USD',
          duration: 1,
          durationUnit: 't',
          symbol: top.market,
        });
        const ratio = q.askPrice > 0 ? q.payout / q.askPrice : 0;
        const idx = quotes.findIndex(
          (o) => o.market === top.market && o.direction === top.direction && o.barrier === top.barrier,
        );
        quotes[idx] = {
          ...quotes[idx],
          ask: q.askPrice,
          payout: q.payout,
          realEdge: quotes[idx].estWin - (ratio > 0 ? 1 / ratio : 0),
          realEV: quotes[idx].estWin * ratio - 1,
        };
        recordQuote(top.market, top.direction, top.barrier, ratio);
      } catch {
        // fresh top quote unavailable: the in-ladder proposal is still valid
      }
    }

    const recovering = ctx.debt > 0.005;
    let decision: RecoveryStake = recoveryHold();
    if (recovering) {
      const ladder: LadderOption[] = quotes.map((o) => ({
        direction: o.direction,
        barrier: o.barrier,
        estWin: o.estWin,
        ask: o.ask,
        payout: o.payout,
      }));
      const base = planRecovery(ladder, ctx, { direction: top?.direction ?? 'over', barrier: top?.barrier ?? 1 });
      if (base.holds) {
        this.emit({ type: HOLD, ts: Date.now(), reason: base.holdReason });
        if (base.holdReason?.includes('consecutive loss cap')) {
          this.emit({ type: 'cooldown', ts: Date.now(), seconds: 60, reason: base.holdReason });
          this.stop(base.holdReason);
          return 0;
        }
        // Caps breach -> stop the run. No positive-edge candidate -> Wait: the
        // market can rotate onto a better barrier, so keep scanning.
        if (base.holdReason?.includes('no positive-edge')) {
          this.phase = 'waiting-edge';
          return 1500;
        }
        this.stop(base.holdReason ?? 'recovery hold');
        return 0;
      }
      decision = {
        ...base,
        market: quotes.find((o) => o.direction === base.direction && o.barrier === base.barrier)?.market ?? top?.market ?? '',
      };
    } else {
      // Base bet: only the candidate with a real positive edge qualifies.
      const eligible = quotes
        .filter((o) => o.estWin >= minWin && o.realEdge >= minEdge)
        .sort((a, b) => b.realEV - a.realEV || b.realEdge - a.realEdge);
      if (eligible.length === 0) {
        this.emit({ type: HOLD, ts: Date.now(), reason: 'no positive live edge after quote' });
        this.phase = 'waiting-edge';
        return 1500;
      }
      decision = {
        stake: settings.base_stake,
        direction: eligible[0].direction,
        barrier: eligible[0].barrier,
        reason: 'base',
        estWin: eligible[0].estWin,
        payout: eligible[0].payout,
        holds: false,
        market: eligible[0].market,
      };
    }
    // Re-check the run state after the async quoting phase: the user may have
    // stopped the bot mid-span, and we must not broadcast (or buy) a bet once
    // we're no longer meant to trade.
    if (!this.running) {
      this.phase = 'standby';
      return 1500;
    }
    this.emit({
      type: 'decision',
      ts: Date.now(),
      decision,
      streak: rec.streak,
      debt: rec.debt,
      attempts: rec.attempts,
      cycleStake: rec.cycleStake,
    });

    const gate = riskCheck({
      stake: decision.stake,
      settings,
      balance: session.balance,
      context: ctx,
      lastTradeAt: this.lastCompletedAt(),
      tradeGapMs: config.tradeGapMs,
      now: Date.now(),
    });
    if (!gate.ok) {
      this.emit({ type: HOLD, ts: Date.now(), reason: gate.reason });
      if (gate.reason.includes('drawdown')) this.stop(gate.reason);
      return 900;
    }

    // Final gate before spending money — a stop can race this far in.
    if (!this.running) {
      this.phase = 'standby';
      return 900;
    }

    // Final quote at the planned stake so the proposal matches the buy.
    const finalQuote = await this.client.getQuote({
      direction: decision.direction,
      barrier: decision.barrier,
      amount: decision.stake,
      currency: session.currency || 'USD',
      duration: 1,
      durationUnit: 't',
      symbol: decision.market,
    });

    this.phase = 'buying';
    const trade = insertTrade({
      ts: Date.now(),
      market: decision.market,
      contract_type: finalQuote.direction === 'over' ? 'DIGITOVER' : 'DIGITUNDER',
      barrier: finalQuote.barrier,
      duration: 1,
      duration_unit: 't',
      stake: decision.stake,
      ask_price: finalQuote.askPrice,
      payout: finalQuote.payout,
      est_win: decision.estWin,
      profit: 0,
      status: 'pending',
      contract_id: '',
      purchase_id: `auto-${tradeSequence()}`,
      reason: decision.reason,
    });

    // Calibration snapshot: remember the scanner state at the buy instant so we
    // can later compare "when the scanner said X%, how often did it actually win?".
    const traded = quotes.find(
      (o) => o.market === decision.market && o.direction === decision.direction && o.barrier === decision.barrier,
    );
    if (traded) {
      const prev = lastDigitEvents(decision.market, 1);
      insertScannerLog({
        trade_id: trade.id,
        ts: Date.now(),
        market: decision.market,
        direction: decision.direction,
        barrier: decision.barrier,
        est_win: decision.estWin,
        ask: finalQuote.askPrice,
        payout: finalQuote.payout,
        ratio: finalQuote.askPrice > 0 ? finalQuote.payout / finalQuote.askPrice : 0,
        breakeven: finalQuote.askPrice > 0 ? finalQuote.askPrice / finalQuote.payout : 0,
        edge: decision.estWin - (finalQuote.askPrice > 0 ? finalQuote.askPrice / finalQuote.payout : 0),
        prev_digit: prev.length ? prev[0].digit : null,
        consistency: traded.consistency,
        entropy: traded.entropy,
        momentum: traded.momentum,
      });
    }
    this.emit({ type: 'trade', ts: Date.now(), trade });

    const bought = await this.client.placeBuy(finalQuote.id, finalQuote.askPrice);
    resolveTrade(trade.id, 'pending', 0, bought.contractId);
    this.emit({ type: 'contract', ts: Date.now(), contractId: bought.contractId, phase: 'purchased' });

    this.phase = 'settling';
    const outcome = await this.client.settleContract(bought.contractId, (u) =>
      this.emit({ type: 'contract', ts: Date.now(), contractId: u.contractId, update: u }),
    );

    if (outcome.settled) {
      const won = outcome.status === 'won';
      const status: TradeRow['status'] = won ? 'won' : 'lost';
      const profit = Number.isFinite(outcome.profit) ? outcome.profit : (won ? bought.payout - decision.stake : -decision.stake);
      const exitDetails = {
        entrySpot: outcome.entrySpot,
        exitSpot: outcome.exitSpot,
        exitDigit: outcome.exitDigit,
      };
      resolveTrade(trade.id, status, profit, bought.contractId, exitDetails);
      const next = applyOutcome(won, profit, settings, session.balance);
      saveRecovery({ ...next, last_win_epoch: won ? Date.now() : getRecovery().last_win_epoch, updated_at: Date.now() });
      this.emit({ type: 'recovery', ts: Date.now(), recovery: { ...next }, won });
      this.emit({
        type: 'contract',
        ts: Date.now(),
        contractId: bought.contractId,
        update: outcome,
        result: status,
        profit,
      });
    } else {
      resolveTrade(trade.id, 'expired', 0, bought.contractId);
      this.emit({ type: 'contract', ts: Date.now(), contractId: bought.contractId, result: 'expired' });
    }

    this.phase = 'settled';

    this.runTrades += 1;
    setAutomation({ trades_done: this.runTrades });
    this.emit({ type: 'status', ts: Date.now(), state: this.state() });
    if (this.runTarget > 0 && this.runTrades >= this.runTarget) {
      resetRecovery();
      this.emit({ type: 'recovery', ts: Date.now(), recovery: getRecovery(), reset: true });
      this.stop(`target of ${this.runTarget} trades completed`);
    }

    return config.tradeGapMs;
  }

  /**
   * Automatically resolve any stale 'pending' trades so the bot never gets
   * stuck. Bets with no contract id never reached Deriv and are expired
   * immediately; the rest are queried (with a hard timeout) and settled with
   * their real outcome when reachable, otherwise expired.
   */
  private async reconcilePending(pending: TradeRow[]): Promise<void> {
    const now = Date.now();
    for (const t of pending) {
      // Auto-void any bet still open after a minute - it can never settle now.
      if (now - t.ts > 60_000) {
        resolveTrade(t.id, 'expired', 0, t.contract_id);
        this.emit({
          type: 'contract',
          ts: Date.now(),
          contractId: t.contract_id,
          result: 'expired',
          reconciled: true,
          voided: true,
        });
        continue;
      }
      if (!t.contract_id) {
        resolveTrade(t.id, 'expired', 0, t.contract_id);
        this.emit({ type: 'contract', ts: Date.now(), contractId: '', result: 'expired', reconciled: true });
        continue;
      }
      try {
        const outcome = await this.client.settleContract(t.contract_id, () => undefined);
        if (outcome.settled) {
          const won = outcome.status === 'won';
          const status: TradeRow['status'] = won ? 'won' : 'lost';
          const profit = Number.isFinite(outcome.profit)
            ? outcome.profit
            : won
              ? (t.payout ?? 0) - (t.stake ?? 0)
              : -(t.stake ?? 0);
          resolveTrade(t.id, status, profit, t.contract_id, {
            entrySpot: outcome.entrySpot,
            exitSpot: outcome.exitSpot,
            exitDigit: outcome.exitDigit,
          });
          this.emit({
            type: 'contract',
            ts: Date.now(),
            contractId: t.contract_id,
            update: outcome,
            result: status,
            profit,
            reconciled: true,
          });
        } else {
          resolveTrade(t.id, 'expired', 0, t.contract_id);
          this.emit({ type: 'contract', ts: Date.now(), contractId: t.contract_id, result: 'expired', reconciled: true });
        }
      } catch (err) {
        this.emit({ type: 'error', ts: Date.now(), message: `reconcile ${t.contract_id}: ${String(err)}` });
        resolveTrade(t.id, 'expired', 0, t.contract_id);
      }
    }
  }
}

let seq = 0;
function tradeSequence(): number {
  return ++seq;
}

export function emergencyStop(hub: Hub, automation: Automation): void {
  automation.stop('emergency stop');
  resetRecovery();
  hub.emit({ type: 'recovery', ts: Date.now(), recovery: getRecovery(), reset: true });
}