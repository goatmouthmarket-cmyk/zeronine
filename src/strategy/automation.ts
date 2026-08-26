import { config } from '../config.ts';
import type { Hub } from '../api/hub.ts';
import type { MarketRegistry } from '../core/marketState.ts';
import type { DerivPrivateClient, ContractUpdate } from '../deriv/privateClient.ts';
import type { LadderOption, RecoveryDecision } from '../strategy/recovery.ts';
import { planRecovery } from '../strategy/recovery.ts';
import { pickSignalFromSnapshot } from '../strategy/signal.ts';
import { IntelligenceEngine } from '../intelligence/engine.ts';
import type { IntelligenceSnapshot } from '../intelligence/engine.ts';
import { DecisionMemory } from '../intelligence/decisionMemory.ts';
import { allocateCapital } from '../intelligence/capitalAllocation.ts';
import { patternRowsByPrev } from '../db/store.ts';
import { patternWeightForStrategy } from '../db/store.ts';
import type { PatternInput } from '../strategy/scanner.ts';
import { applyOutcome, buildRecoveryContext, riskCheck } from '../strategy/risk.ts';
import { contractProfit } from '../strategy/pnl.ts';
import type { Direction } from '../core/digitMath.ts';
import type { TradeRow, SettingsRow } from '../db/store.ts';
import {
  accountIdForLogin,
  getAutomation,
  getPerformanceSummary,
  getTrade,
  getPendingTrades,
  getRecovery,
  getSession,
  getSettings,
  insertScannerLog,
  insertTrade,
  lastDigitEvents,
  listTrades,
  markTradePurchased,
  recordQuote,
  resetRecovery,
  resolveTrade,
  saveRecovery,
  setAutomation,
} from '../db/store.ts';
import { calibrateResearchProbability } from '../intelligence/researchCalibration.ts';

const HOLD = 'hold';

/**
 * Learned-pattern hook for the live scanner. Returns null (no-op, identical to
 * pre-pattern behavior) until pattern_weight > 0, so enabling the setting is
 * the one switch that turns learned next-digit patterns into signal bias. Rows
 * are loaded from pattern_stats once per call and cached per market.
 */
function patternInput(): PatternInput | null {
  const settings = getSettings();
  const weight = patternWeightForStrategy(settings, settings.strategy_mode);
  if (!(weight > 0)) return null;
  const cache = new Map<string, Map<number, number[]> | null>();
  const rowFor = (symbol: string, prev: number): number[] | null => {
    if (!cache.has(symbol)) cache.set(symbol, patternRowsByPrev(symbol));
    return cache.get(symbol)?.get(prev) ?? null;
  };
  return { rowFor, weight: Math.min(1, Math.max(0, weight)) };
}

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

function coolKey(o: { market: string; direction: Direction; barrier: number }): string {
  return `${o.market}|${o.direction}|${o.barrier}`;
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
  private cycling = false;
  private busiest = 0;
  private phase = 'idle';
  // Every explicit start/stop invalidates prior async work. A quote can finish
  // after a button click, so `running` alone cannot prove it owns the run.
  private runEpoch = 0;
  private operatorStopped = false;

  private registry: MarketRegistry;
  private client: DerivPrivateClient;
  private hub: Hub;
  private intelligence: IntelligenceEngine;
  private latestIntelligence: IntelligenceSnapshot | null = null;
  private memory: DecisionMemory;

  private runTarget = 0;
  private runTrades = 0;
  private stopReason: string | null = null;
  private coolOffs = new Map<string, number>();
  private runOrigin: 'bot' | 'paper' = 'bot';

  constructor(registry: MarketRegistry, client: DerivPrivateClient, hub: Hub, memory = new DecisionMemory()) {
    this.registry = registry;
    this.client = client;
    this.hub = hub;
    this.memory = memory;
    const persistedReason = getAutomation().reason;
    this.stopReason = persistedReason && persistedReason !== 'server shutdown' ? persistedReason : null;
    this.operatorStopped = persistedReason === 'user stop' || persistedReason === 'emergency stop';
    this.intelligence = new IntelligenceEngine(registry, (symbol, count) =>
      lastDigitEvents(symbol, count)
        .reverse()
        .map((e) => e.digit),
    );
  }

  isRunning(): boolean {
    return this.running;
  }

  isOperatorStopped(): boolean {
    return this.operatorStopped;
  }

  acknowledgeUserStart(): void {
    this.operatorStopped = false;
  }

  state(): Record<string, unknown> {
    return {
      running: this.running,
      phase: this.phase,
      lastCompletedAt: this.lastCompletedAt(),
      runTarget: this.runTarget,
      runTrades: this.runTrades,
      reason: this.running ? undefined : this.stopReason ?? undefined,
    };
  }

  marketIntelligence(): Array<{ symbol: string; health: unknown; regime: unknown }> {
    if (!this.latestIntelligence) return [];
    return [...this.latestIntelligence.markets.entries()].map(([symbol, value]) => ({ symbol, health: value.health, regime: value.regime }));
  }

  private lastCompletedAt(accountId?: string): number {
    const trades = listTrades(1, accountId);
    return trades.length ? trades[0].ts : 0;
  }

  private cooled(o: { market: string; direction: Direction; barrier: number }, now = Date.now()): boolean {
    const until = this.coolOffs.get(coolKey(o));
    if (until === undefined) return false;
    if (until <= now) {
      this.coolOffs.delete(coolKey(o));
      return false;
    }
    return true;
  }

  private markLoss(market: string, direction: Direction, barrier: number): void {
    this.coolOffs.set(coolKey({ market, direction, barrier }), Date.now() + config.coolOffMs);
  }

  start(opts: { maxTrades?: number; origin?: 'bot' | 'paper' } = {}): void {
    if (this.running || this.operatorStopped) return;
    this.runEpoch += 1;
    this.running = true;
    this.stopReason = null;
    this.runTarget = Math.max(0, Math.floor(opts.maxTrades ?? 0) || 0);
    this.runTrades = 0;
    this.runOrigin = opts.origin ?? 'bot';
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
    this.runEpoch += 1;
    const explicitOperatorStop = reason === 'user stop' || reason === 'emergency stop';
    if (explicitOperatorStop) this.operatorStopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (!this.running) {
      this.phase = 'standby';
      if (explicitOperatorStop || !this.stopReason) this.stopReason = reason;
      this.emit({ type: 'status', ts: Date.now(), state: this.state(), reason: this.stopReason });
      return;
    }
    this.running = false;
    this.stopReason = reason;
    this.phase = 'standby';
    setAutomation({ running: 0, stopped_at: Date.now(), reason, trades_done: this.runTrades });
    this.emit({ type: 'status', ts: Date.now(), state: this.state(), reason });
    // Keep manual-bet signals fresh, but the scheduled pass is read-only.
    this.schedule(50);
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
    this.runEpoch += 1;
    this.running = false;
    this.stopReason = 'server shutdown';
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
    if (this.cycling) {
      this.schedule(100);
      return;
    }
    this.cycling = true;
    const cycleEpoch = this.runEpoch;
    const startedRunning = this.running;
    let delay = 600;
    try {
      const result = await this.cycle(cycleEpoch, startedRunning);
      if (result && Number.isFinite(result)) delay = result;
    } catch (err) {
      this.emit({ type: 'error', ts: Date.now(), message: String(err) });
      delay = 1200;
    } finally {
      this.cycling = false;
      // A newer start/stop owns the next timer. A stale completion must never
      // delay or revive that newer state.
      if (cycleEpoch === this.runEpoch) this.schedule(delay);
    }
  }

  private async cycle(cycleEpoch: number, startedRunning: boolean): Promise<number> {
    this.busiest = Date.now();
    const canBuy = (): boolean => startedRunning && this.running && cycleEpoch === this.runEpoch;
    const settings = getSettings();

    const session = getSession();

    // Scanning is entirely public-market work. Keeping it outside the private
    // account gate lets guests inspect current signals and drive the virtual
    // paper simulator without a Deriv token. Quotes and purchases remain gated
    // below.
    this.phase = 'scanning';
    this.emit({ type: 'status', ts: Date.now(), state: this.state() });
    const conservative = settings.strategy_mode === 'conservative';
    const { minWin, minEdge } = modeGates(settings);
    // Conservative is about the safe favorites (Over 0 / Under 9): the payout
    // edge gate is skipped so a ~90% win candidate is never priced out of a
    // $stake bet. That's the whole point of the profile.
    const scanMinWin = conservative ? 0 : minWin;
    const scanMinEdge = conservative ? -1 : minEdge;
    const intelligence = this.intelligence.snapshot(patternInput());
    this.latestIntelligence = intelligence;
    this.emit({ type: 'intelligence', ts: intelligence.at, markets: this.marketIntelligence() });
    const signal = pickSignalFromSnapshot(
      intelligence,
      scanMinWin,
      scanMinEdge,
      undefined,
      barrierAllowed(settings),
    );
    this.emit({ type: 'signal', ts: Date.now(), signal, phase: this.phase });
    if (signal.holds) {
      const candidate = signal.candidates[0];
      const market = candidate ? intelligence.markets.get(candidate.market) : undefined;
      if (candidate && market) {
        this.memory.remember({
          ts: Date.now(),
          action: 'wait',
          reason: signal.reason,
          market: candidate.market,
          direction: candidate.direction,
          barrier: candidate.barrier,
          est_win: candidate.estWin,
          health_score: market.health.score,
          regime: market.regime.regime,
          counterfactual: true,
        });
      }
      this.emit({ type: HOLD, ts: Date.now(), reason: signal.reason });
      this.phase = 'waiting-edge';
      return 1500; // WAIT is a valid outcome: no obligation to trade every scan
    }

    if (!this.client.isConnected || !session) {
      this.phase = 'standby';
      this.emit({ type: HOLD, ts: Date.now(), reason: 'Connect Deriv to request live quotes or trade' });
      return 1500;
    }
    const accountId = accountIdForLogin(session.loginid);

    // Reconcile pending bets left by a restart or delayed settlement. A real
    // contract remains pending until Deriv gives a terminal result; recording a
    // timeout as zero PnL would corrupt both history and recovery debt.
    const pending = getPendingTrades(accountId);
    if (pending.length > 0) {
      await this.reconcilePending(pending);
      if (getPendingTrades(accountId).length > 0) {
        this.emit({ type: HOLD, ts: Date.now(), reason: 'waiting open contract to settle' });
        this.phase = 'waiting-settlement';
        return 350;
      }
    }

    const rec = getRecovery(accountId);
    const ctx = buildRecoveryContext(settings, accountId);

    // The peak-drawdown rail only applies while the bot is actively trading.
    if (canBuy()) {
      const guard = riskCheck({
        stake: settings.max_stake,
        settings,
        balance: session.balance,
        context: ctx,
        lastTradeAt: 0,
        tradeGapMs: 0,
        now: Date.now(),
        accountId,
      });
      if (!guard.ok && guard.reason.includes('drawdown')) {
        this.emit({ type: HOLD, ts: Date.now(), reason: guard.reason });
        this.stop(guard.reason);
        return 0;
      }
    }

    // Quote every shortlist candidate across markets. Real ratios (payout/ask)
    // give the actual breakeven / edge / EV that drive the pick.
    this.phase = 'quoting';
    const quotes: QuotedOption[] = [];
    for (const c of signal.candidates) {
      try {
        const calibration = calibrateResearchProbability(c.market, c.direction, c.barrier, c.estWin);
        const estWin = calibration.probability;
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
          estWin,
          consistency: c.consistency,
          entropy: c.entropy,
          momentum: c.momentum,
          ask: q.askPrice,
          payout: q.payout,
          realEdge: estWin - (ratio > 0 ? 1 / ratio : 0),
          realEV: estWin * ratio - 1,
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
          estWin,
          realEdge: estWin - (ratio > 0 ? 1 / ratio : 0),
          researchCalibration: calibration,
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
    if (!canBuy()) {
      if (!this.running) this.phase = 'standby';
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
      const now = Date.now();
      const ladderSrc = conservative ? quotes.filter((o) => !this.cooled(o, now)) : quotes;
      const ladder: LadderOption[] = ladderSrc.map((o) => ({
        market: o.market,
        direction: o.direction,
        barrier: o.barrier,
        estWin: o.estWin,
        ask: o.ask,
        payout: o.payout,
      }));
      if (ladder.length === 0) {
        this.emit({ type: HOLD, ts: Date.now(), reason: 'cooling off after a loss' });
        this.phase = 'waiting-edge';
        return 1500;
      }
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
        market: base.market ?? top?.market ?? '',
      };
    } else {
      // Base bet: default modes only trade a candidate with a real positive
      // edge. Conservative fires on the safe extremes for their win rate
      // instead — the payout edge never prices out the $stake favorite, but
      // a hot extreme digit (0 for Over, 9 for Under) skips that side until
      // it cools off, and neither side is re-fired right after a loss.
      const now = Date.now();
      const eligible = conservative
        ? quotes
            .filter((o) => o.estWin >= Math.max(minWin, config.minExtremeWin) && !this.cooled(o, now))
            .sort((a, b) => b.estWin - a.estWin || b.realEV - a.realEV)
        : quotes
            .filter((o) => o.estWin >= minWin && o.realEdge >= minEdge)
            .sort((a, b) => b.realEV - a.realEV || b.realEdge - a.realEdge);
      if (eligible.length === 0) {
        this.emit({ type: HOLD, ts: Date.now(), reason: conservative ? 'extreme digit too hot' : 'no live quote available' });
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
    if (!canBuy()) {
      if (!this.running) this.phase = 'standby';
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

    const marketIntelligence = intelligence.markets.get(decision.market);
    const drawdownPct = ctx.peakBalance > 0 && session.balance > 0
      ? ((ctx.peakBalance - session.balance) / ctx.peakBalance) * 100
      : 0;
    const allocation = allocateCapital({
      proposedStake: decision.stake,
      balance: session.balance,
      maxStake: settings.max_stake,
      health: marketIntelligence?.health,
      regime: marketIntelligence?.regime,
      recovery: { streak: ctx.streak },
      drawdownPct,
    });
    if (!(allocation.stake > 0)) {
      this.emit({ type: HOLD, ts: Date.now(), reason: 'capital allocation produced no executable stake' });
      return 900;
    }
    decision = { ...decision, stake: allocation.stake };

    const gate = riskCheck({
      stake: decision.stake,
      settings,
      balance: session.balance,
      context: ctx,
      lastTradeAt: this.lastCompletedAt(accountId),
      tradeGapMs: config.tradeGapMs,
      now: Date.now(),
      accountId,
    });
    if (!gate.ok) {
      const market = intelligence.markets.get(decision.market);
      this.memory.remember({
        ts: Date.now(),
        action: 'skip',
        reason: gate.reason,
        market: decision.market,
        direction: decision.direction,
        barrier: decision.barrier,
        est_win: decision.estWin,
        health_score: market?.health.score,
        regime: market?.regime.regime,
        requested_stake: decision.stake,
        counterfactual: true,
      });
      this.emit({ type: HOLD, ts: Date.now(), reason: gate.reason });
      if (gate.reason.includes('drawdown')) this.stop(gate.reason);
      return 900;
    }

    // Final gate before spending money — a stop can race this far in.
    if (!canBuy()) {
      if (!this.running) this.phase = 'standby';
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

    // A stop can arrive while the final quote request is in flight.
    if (!canBuy()) {
      if (!this.running) this.phase = 'standby';
      return 900;
    }

    this.phase = 'buying';
    const market = intelligence.markets.get(decision.market);
    this.memory.remember({
      ts: Date.now(),
      action: 'trade',
      reason: decision.reason,
      market: decision.market,
      direction: decision.direction,
      barrier: decision.barrier,
      est_win: decision.estWin,
      health_score: market?.health.score,
      regime: market?.regime.regime,
      requested_stake: decision.stake,
    });
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
      origin: this.runOrigin,
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
    const actualStake = bought.buyPrice > 0 ? bought.buyPrice : finalQuote.askPrice > 0 ? finalQuote.askPrice : decision.stake;
    const actualPayout = bought.payout > 0 ? bought.payout : finalQuote.payout;
    const entrySnapshot = this.registry.snapshot(decision.market);
    markTradePurchased(trade.id, bought.contractId, actualStake, actualPayout, accountId, entrySnapshot.lastQuote, entrySnapshot.lastDigit);
    const purchasedTrade = getTrade(trade.id, accountId);
    if (purchasedTrade) this.emit({ type: 'trade', ts: Date.now(), trade: purchasedTrade });
    this.emit({ type: 'contract', ts: Date.now(), contractId: bought.contractId, phase: 'purchased' });

    this.phase = 'settling';
    const outcome = await this.client.settleContract(bought.contractId, (u) =>
      this.emit({ type: 'contract', ts: Date.now(), contractId: u.contractId, update: u }),
    );

    if (outcome.settled) {
      const won = outcome.status === 'won';
      const status: TradeRow['status'] = won ? 'won' : 'lost';
      const profit = contractProfit(won, actualStake, actualPayout, outcome);
      const exitDetails = {
        entrySpot: outcome.entrySpot,
        entryDigit: outcome.entryDigit,
        exitSpot: outcome.exitSpot,
        exitDigit: outcome.exitDigit,
      };
      resolveTrade(trade.id, status, profit, bought.contractId, exitDetails, accountId);
      const settledTrade = getTrade(trade.id, accountId);
      if (settledTrade) this.emit({ type: 'trade', ts: Date.now(), trade: settledTrade, performance: getPerformanceSummary(accountId), settled: true });
      if (!won && conservative) this.markLoss(decision.market, decision.direction, decision.barrier);
      const next = applyOutcome(won, profit, settings, session.balance, accountId);
      saveRecovery({ ...next, last_win_epoch: won ? Date.now() : getRecovery(accountId).last_win_epoch, updated_at: Date.now() }, accountId);
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
      resolveTrade(trade.id, 'expired', 0, bought.contractId, undefined, accountId);
      const expiredTrade = getTrade(trade.id, accountId);
      if (expiredTrade) this.emit({ type: 'trade', ts: Date.now(), trade: expiredTrade, performance: getPerformanceSummary(accountId), settled: true });
      this.emit({ type: 'contract', ts: Date.now(), contractId: bought.contractId, tradeId: trade.id, result: 'expired' });
    }

    this.phase = 'settled';

    if (canBuy()) {
      this.runTrades += 1;
      setAutomation({ trades_done: this.runTrades });
      this.emit({ type: 'status', ts: Date.now(), state: this.state() });
      if (this.runTarget > 0 && this.runTrades >= this.runTarget) {
        resetRecovery();
        this.emit({ type: 'recovery', ts: Date.now(), recovery: getRecovery(), reset: true });
        this.stop(`target of ${this.runTarget} trades completed`);
      }
    }

    return config.tradeGapMs;
  }

  /**
   * Reconcile pending contracts with Deriv. Bets with no contract id never
   * reached Deriv and become errors; real contracts remain pending until the
   * provider supplies a terminal outcome.
   */
  private async reconcilePending(pending: TradeRow[]): Promise<void> {
    for (const t of pending) {
      if (!t.contract_id) {
        resolveTrade(t.id, 'error', 0, t.contract_id, undefined, t.account_id);
        this.emit({ type: 'contract', ts: Date.now(), contractId: '', result: 'error', reconciled: true });
        continue;
      }
      try {
        const outcome = await this.client.settleContract(t.contract_id, () => undefined);
        if (outcome.settled) {
          const won = outcome.status === 'won';
          const status: TradeRow['status'] = won ? 'won' : 'lost';
          const profit = contractProfit(won, t.stake ?? 0, t.payout ?? 0, outcome);
          resolveTrade(t.id, status, profit, t.contract_id, {
            entrySpot: outcome.entrySpot,
            entryDigit: outcome.entryDigit,
            exitSpot: outcome.exitSpot,
            exitDigit: outcome.exitDigit,
          }, t.account_id);
          const settledTrade = getTrade(t.id, t.account_id);
          if (settledTrade) this.emit({ type: 'trade', ts: Date.now(), trade: settledTrade, performance: getPerformanceSummary(t.account_id), settled: true, reconciled: true });
          if (t.purchase_id.startsWith('auto-')) {
            const settings = getSettings();
            if (!won && settings.strategy_mode === 'conservative') {
              this.markLoss(t.market, t.contract_type === 'DIGITOVER' ? 'over' : 'under', t.barrier);
            }
            const accountId = t.account_id;
            const next = applyOutcome(won, profit, settings, getSession()?.balance, accountId);
            saveRecovery({ ...next, last_win_epoch: won ? Date.now() : getRecovery(accountId).last_win_epoch, updated_at: Date.now() }, accountId);
            this.emit({ type: 'recovery', ts: Date.now(), recovery: { ...next }, won, reconciled: true });
          }
          this.emit({
            type: 'contract',
            ts: Date.now(),
            contractId: t.contract_id,
            update: outcome,
            result: status,
            profit,
            tradeId: t.id,
            reconciled: true,
          });
        } else {
          this.emit({ type: 'contract', ts: Date.now(), contractId: t.contract_id, phase: 'awaiting settlement', reconciled: true });
        }
      } catch (err) {
        this.emit({ type: 'error', ts: Date.now(), message: `reconcile ${t.contract_id}: ${String(err)}` });
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
