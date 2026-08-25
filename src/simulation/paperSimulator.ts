import type { Direction } from '../core/digitMath.ts';
import { winDigits } from '../core/digitMath.ts';

export type PaperSimulationPhase = 'idle' | 'running' | 'stopped' | 'completed';

/** A public tick from the unauthenticated market feed. */
export interface PaperTick {
  market: string;
  quote: number;
  digit: number;
  epoch: number;
}

/**
 * A strategy recommendation. The simulator does not calculate signals: callers
 * can use the shared scanner or a deliberately simple guest strategy.
 */
export interface PaperSignal {
  market: string;
  direction: Direction;
  barrier: number;
  stake?: number;
  payoutRatio?: number;
  estWin?: number;
  edge?: number;
}

export interface PaperContract {
  id: number;
  market: string;
  direction: Direction;
  barrier: number;
  stake: number;
  payoutRatio: number;
  entryEpoch: number;
  entryQuote: number;
  entryDigit: number;
  entryTickSequence: number;
  estWin?: number;
  edge?: number;
  status: 'open' | 'won' | 'lost' | 'cancelled';
  exitEpoch?: number;
  exitQuote?: number;
  exitDigit?: number;
  profit?: number;
}

export interface PaperSimulationState {
  phase: PaperSimulationPhase;
  reason: string | null;
  initialBalance: number;
  balance: number;
  availableBalance: number;
  reservedStake: number;
  netPnl: number;
  wins: number;
  losses: number;
  totalTrades: number;
  equity: number[];
  openContract: PaperContract | null;
  lastSettled: PaperContract | null;
  lastTick: PaperTick | null;
}

export type PaperSimulationEvent =
  | { type: 'started'; state: PaperSimulationState }
  | { type: 'reset'; state: PaperSimulationState }
  | { type: 'stopped'; reason: string; state: PaperSimulationState }
  | { type: 'tick'; tick: PaperTick; state: PaperSimulationState }
  | { type: 'opened'; contract: PaperContract; state: PaperSimulationState }
  | { type: 'settled'; contract: PaperContract; state: PaperSimulationState }
  | { type: 'cancelled'; contract: PaperContract; reason: string; state: PaperSimulationState }
  | { type: 'skipped'; signal: PaperSignal; reason: string; state: PaperSimulationState };

export interface PaperSimulatorOptions {
  initialBalance?: number;
  defaultStake?: number;
  defaultPayoutRatio?: number;
  maxTrades?: number;
}

type Listener = (event: PaperSimulationEvent) => void;

const DEFAULT_INITIAL_BALANCE = 1_000;
const DEFAULT_STAKE = 2;
const DEFAULT_PAYOUT_RATIO = 1.9;

function rounded(value: number): number {
  return Math.round(value * 100) / 100;
}

function finitePositive(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function cloneTick(tick: PaperTick | null): PaperTick | null {
  return tick ? { ...tick } : null;
}

function cloneContract(contract: PaperContract | null): PaperContract | null {
  return contract ? { ...contract } : null;
}

/**
 * A one-tick virtual-contract engine. It has no database, private Deriv
 * client, account balance, quote, or purchase dependency. Consumers feed it
 * public ticks and signal recommendations, then persist/broadcast its events
 * in their own layer if desired.
 */
export class PaperSimulator {
  private readonly initialBalance: number;
  private readonly defaultStake: number;
  private readonly defaultPayoutRatio: number;
  private readonly maxTrades: number | null;
  private phase: PaperSimulationPhase = 'idle';
  private reason: string | null = null;
  private balance: number;
  private wins = 0;
  private losses = 0;
  private totalTrades = 0;
  private equity: number[];
  private nextId = 1;
  private openContract: PaperContract | null = null;
  private lastSettled: PaperContract | null = null;
  private lastTick: PaperTick | null = null;
  private readonly ticks = new Map<string, { tick: PaperTick; sequence: number }>();
  private nextTickSequence = 1;
  private readonly listeners = new Set<Listener>();

  constructor(options: PaperSimulatorOptions = {}) {
    this.initialBalance = finitePositive(options.initialBalance ?? DEFAULT_INITIAL_BALANCE)
      ? rounded(options.initialBalance ?? DEFAULT_INITIAL_BALANCE)
      : DEFAULT_INITIAL_BALANCE;
    this.defaultStake = finitePositive(options.defaultStake ?? DEFAULT_STAKE)
      ? rounded(options.defaultStake ?? DEFAULT_STAKE)
      : DEFAULT_STAKE;
    this.defaultPayoutRatio = finitePositive(options.defaultPayoutRatio ?? DEFAULT_PAYOUT_RATIO)
      ? options.defaultPayoutRatio ?? DEFAULT_PAYOUT_RATIO
      : DEFAULT_PAYOUT_RATIO;
    this.maxTrades = Number.isInteger(options.maxTrades) && Number(options.maxTrades) > 0
      ? Number(options.maxTrades)
      : null;
    this.balance = this.initialBalance;
    this.equity = [this.initialBalance];
  }

  on(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  state(): PaperSimulationState {
    const reservedStake = this.openContract?.stake ?? 0;
    return {
      phase: this.phase,
      reason: this.reason,
      initialBalance: this.initialBalance,
      balance: rounded(this.balance),
      availableBalance: rounded(this.balance - reservedStake),
      reservedStake,
      netPnl: rounded(this.balance - this.initialBalance),
      wins: this.wins,
      losses: this.losses,
      totalTrades: this.totalTrades,
      equity: [...this.equity],
      openContract: cloneContract(this.openContract),
      lastSettled: cloneContract(this.lastSettled),
      lastTick: cloneTick(this.lastTick),
    };
  }

  start(): boolean {
    if (this.phase === 'running') return false;
    if (this.maxTrades !== null && this.totalTrades >= this.maxTrades) {
      this.phase = 'completed';
      this.reason = 'trade target complete';
      this.emit({ type: 'stopped', reason: this.reason, state: this.state() });
      return false;
    }
    this.phase = 'running';
    this.reason = null;
    this.emit({ type: 'started', state: this.state() });
    return true;
  }

  /** Stop accepts no further orders and cancels an unsettled virtual contract. */
  stop(reason = 'stopped by operator'): void {
    if (this.openContract) {
      const cancelled: PaperContract = { ...this.openContract, status: 'cancelled' };
      this.openContract = null;
      this.emit({ type: 'cancelled', contract: cloneContract(cancelled)!, reason, state: this.state() });
    }
    if (this.phase === 'stopped' && this.reason === reason) return;
    this.phase = 'stopped';
    this.reason = reason;
    this.emit({ type: 'stopped', reason, state: this.state() });
  }

  /** Reset virtual money and history while retaining the public tick cache. */
  reset(): void {
    this.phase = 'idle';
    this.reason = null;
    this.balance = this.initialBalance;
    this.wins = 0;
    this.losses = 0;
    this.totalTrades = 0;
    this.equity = [this.initialBalance];
    this.nextId = 1;
    this.openContract = null;
    this.lastSettled = null;
    this.emit({ type: 'reset', state: this.state() });
  }

  /** Feed every public market tick. The next tick for an open contract settles it. */
  onTick(tick: PaperTick, signal?: PaperSignal | null): void {
    if (!this.validTick(tick)) return;
    const next = { ...tick };
    const sequence = this.nextTickSequence++;
    this.ticks.set(next.market, { tick: next, sequence });
    this.lastTick = next;
    this.emit({ type: 'tick', tick: next, state: this.state() });

    if (this.openContract && this.openContract.market === next.market && sequence > this.openContract.entryTickSequence) {
      this.settle(next);
    }
    if (signal) this.offer(signal);
  }

  /** Offer a signal using the latest public tick for its market as entry context. */
  offer(signal: PaperSignal): PaperContract | null {
    if (this.phase !== 'running') return this.skip(signal, 'simulation is not running');
    if (this.openContract) return this.skip(signal, 'one virtual contract is already open');
    if (this.maxTrades !== null && this.totalTrades >= this.maxTrades) {
      this.complete();
      return this.skip(signal, 'trade target complete');
    }
    if (!this.validSignal(signal)) return this.skip(signal, 'invalid paper signal');

    const entry = this.ticks.get(signal.market);
    if (!entry) return this.skip(signal, 'market has no public tick yet');
    const stake = rounded(signal.stake ?? this.defaultStake);
    if (!finitePositive(stake) || stake > this.balance) return this.skip(signal, 'insufficient virtual balance');
    const payoutRatio = signal.payoutRatio ?? this.defaultPayoutRatio;
    if (!finitePositive(payoutRatio)) return this.skip(signal, 'invalid virtual payout ratio');

    const contract: PaperContract = {
      id: this.nextId++,
      market: signal.market,
      direction: signal.direction,
      barrier: signal.barrier,
      stake,
      payoutRatio,
      entryEpoch: entry.tick.epoch,
      entryQuote: entry.tick.quote,
      entryDigit: entry.tick.digit,
      entryTickSequence: entry.sequence,
      ...(Number.isFinite(signal.estWin) ? { estWin: signal.estWin } : {}),
      ...(Number.isFinite(signal.edge) ? { edge: signal.edge } : {}),
      status: 'open',
    };
    this.openContract = contract;
    this.emit({ type: 'opened', contract: cloneContract(contract)!, state: this.state() });
    return cloneContract(contract);
  }

  private settle(tick: PaperTick): void {
    const open = this.openContract;
    if (!open) return;
    const won = winDigits(open.direction, open.barrier).includes(tick.digit);
    const profit = rounded(won ? open.stake * (open.payoutRatio - 1) : -open.stake);
    const settled: PaperContract = {
      ...open,
      status: won ? 'won' : 'lost',
      exitEpoch: tick.epoch,
      exitQuote: tick.quote,
      exitDigit: tick.digit,
      profit,
    };
    this.openContract = null;
    this.lastSettled = settled;
    this.totalTrades += 1;
    if (won) this.wins += 1;
    else this.losses += 1;
    this.balance = rounded(this.balance + profit);
    this.equity.push(this.balance);
    if (this.equity.length > 40) this.equity.shift();
    this.emit({ type: 'settled', contract: cloneContract(settled)!, state: this.state() });
    if (this.maxTrades !== null && this.totalTrades >= this.maxTrades) this.complete();
  }

  private complete(): void {
    if (this.phase === 'completed') return;
    this.phase = 'completed';
    this.reason = 'trade target complete';
    this.emit({ type: 'stopped', reason: this.reason, state: this.state() });
  }

  private skip(signal: PaperSignal, reason: string): null {
    this.emit({ type: 'skipped', signal: { ...signal }, reason, state: this.state() });
    return null;
  }

  private emit(event: PaperSimulationEvent): void {
    for (const listener of this.listeners) listener(event);
  }

  private validTick(tick: PaperTick): boolean {
    return Boolean(tick.market)
      && Number.isFinite(tick.quote)
      && Number.isInteger(tick.digit)
      && tick.digit >= 0
      && tick.digit <= 9
      && Number.isFinite(tick.epoch);
  }

  private validSignal(signal: PaperSignal): boolean {
    if (!signal.market || (signal.direction !== 'over' && signal.direction !== 'under') || !Number.isInteger(signal.barrier)) return false;
    return signal.direction === 'over'
      ? signal.barrier >= 0 && signal.barrier <= 8
      : signal.barrier >= 1 && signal.barrier <= 9;
  }
}
