import { config } from '../config.ts';
import type { Hub } from '../api/hub.ts';
import type { MarketRegistry } from '../core/marketState.ts';
import type { DerivPrivateClient, ContractUpdate } from '../deriv/privateClient.ts';
import type { LadderOption } from '../strategy/recovery.ts';
import { planRecovery } from '../strategy/recovery.ts';
import { buildQuotePlan, pickSignal, normalizedDist } from '../strategy/signal.ts';
import { applyOutcome, buildRecoveryContext, riskCheck } from '../strategy/risk.ts';
import { estimateWinRate } from '../core/digitMath.ts';
import type { Direction } from '../core/digitMath.ts';
import type { TradeRow } from '../db/store.ts';
import {
  getPendingTrades,
  getRecovery,
  getSession,
  getSettings,
  insertTrade,
  listTrades,
  resetRecovery,
  resolveTrade,
  saveRecovery,
  setAutomation,
} from '../db/store.ts';

const HOLD = 'hold';

export class Automation {
  private running = false;
  private stopped = true;
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
    this.stopped = false;
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
    this.stopped = true;
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.phase = 'idle';
    setAutomation({ running: 0, stopped_at: Date.now(), reason, trades_done: this.runTrades });
    this.emit({ type: 'status', ts: Date.now(), state: this.state(), reason });
  }

  private schedule(delay: number): void {
    if (this.stopped) return;
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
    if (this.stopped) return;
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
    if (!guard.ok && guard.reason.includes('daily loss')) {
      this.emit({ type: HOLD, ts: Date.now(), reason: guard.reason });
      this.stop(guard.reason);
      return 0;
    }

    this.phase = 'scanning';
    const conservative = settings.strategy_mode === 'conservative';
    const signal = pickSignal(this.registry, 0.35, settings.min_edge, conservative);
    if (signal.holds) {
      this.emit({ type: HOLD, ts: Date.now(), reason: signal.reason });
      return 1000;
    }
    this.emit({ type: 'signal', ts: Date.now(), signal, phase: this.phase });

    const snap = this.registry.snapshot(signal.candidate.market);
    if (!snap.fresh) {
      this.emit({ type: HOLD, ts: Date.now(), reason: 'market feed stale' });
      return 800;
    }

    const preference = parsePreference(settings.barrier_preference);

    this.phase = 'quoting';
    const plan = buildQuotePlan(signal, preference, conservative);
    const ladder: LadderOption[] = [];
    for (const opt of plan) {
      try {
        const q = await this.client.getQuote({
          direction: opt.direction,
          barrier: opt.barrier,
          amount: settings.base_stake,
          currency: session.currency || 'USD',
          duration: 1,
          durationUnit: 't',
          symbol: signal.candidate.market,
        });
        const estWin = estimateWinRate(normalizedDist(snap), opt.direction, opt.barrier);
        ladder.push({ direction: opt.direction, barrier: opt.barrier, estWin, ask: q.askPrice, payout: q.payout });
        this.emit({ type: 'quote', ts: Date.now(), market: signal.candidate.market, ...opt, ask: q.askPrice, payout: q.payout, estWin });
      } catch (err) {
        this.emit({ type: 'quote_error', ts: Date.now(), option: opt, message: String(err) });
      }
    }
    if (ladder.length === 0) {
      this.emit({ type: HOLD, ts: Date.now(), reason: 'no live quotes available' });
      this.phase = 'waiting-quotes';
      return 1000;
    }

    this.phase = 'deciding';
    await new Promise((r) => setTimeout(r, 80)); // let market rotate onto the chosen barrier before exposing
    const bestQuote = this.client.isConnected
      ? await this.client.getQuote({
          direction: signal.candidate.direction,
          barrier: signal.candidate.barrier,
          amount: settings.base_stake,
          currency: session.currency || 'USD',
          duration: 1,
          durationUnit: 't',
          symbol: signal.candidate.market,
        })
      : null;
    if (bestQuote) {
      const estWin = estimateWinRate(normalizedDist(snap), signal.candidate.direction, signal.candidate.barrier);
      const idx = ladder.findIndex(
        (o) => o.direction === signal.candidate.direction && o.barrier === signal.candidate.barrier,
      );
      const refreshed: LadderOption = {
        direction: signal.candidate.direction,
        barrier: signal.candidate.barrier,
        estWin,
        ask: bestQuote.askPrice,
        payout: bestQuote.payout,
      };
      if (idx >= 0) ladder[idx] = refreshed;
      else ladder.push(refreshed);
    }

    const decision = planRecovery(ladder, ctx, {
      direction: signal.candidate.direction,
      barrier: signal.candidate.barrier,
    });
    if (decision.holds) {
      // Ten consecutive losses trigger a stop plus a 1-minute cooldown on the
      // Start button; the user can resume betting after it elapses (daily loss
      // limit remains the hard safety stop).
      if (decision.holdReason?.includes('consecutive loss cap')) {
        this.emit({ type: 'cooldown', ts: Date.now(), seconds: 60, reason: decision.holdReason });
        this.emit({ type: HOLD, ts: Date.now(), reason: decision.holdReason });
        this.stop(decision.holdReason);
        return 0;
      }
      this.emit({ type: HOLD, ts: Date.now(), reason: decision.holdReason });
      this.stop(decision.holdReason);
      return 0;
    }
    this.emit({ type: 'decision', ts: Date.now(), decision, streak: rec.streak, lost: rec.lost });

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
      symbol: signal.candidate.market,
    });

    this.phase = 'buying';
    const trade = insertTrade({
      ts: Date.now(),
      market: signal.candidate.market,
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
      const next = applyOutcome(won, profit, settings);
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
      this.emit({ type: 'recovery', ts: Date.now(), recovery: { mode: 'base', streak: 0, lost: 0 }, reset: true });
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

function parsePreference(p: string): { direction: Direction; barrier: number } {
  const m = /^(over|under)(\d)$/.exec(p.trim().toLowerCase());
  if (!m) return { direction: 'over', barrier: 1 };
  const direction: Direction = m[1] === 'under' ? 'under' : 'over';
  let barrier = Number(m[2]);
  if (direction === 'over') barrier = Math.max(0, Math.min(8, barrier));
  else barrier = Math.max(1, Math.min(9, barrier));
  return { direction, barrier };
}

let seq = 0;
function tradeSequence(): number {
  return ++seq;
}

export function emergencyStop(hub: Hub, automation: Automation): void {
  automation.stop('emergency stop');
  resetRecovery();
  hub.emit({ type: 'recovery', ts: Date.now(), recovery: { mode: 'base', streak: 0, lost: 0 }, reset: true });
}