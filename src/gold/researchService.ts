import {
  isNewerGoldQuote,
  normalizeGoldQuote,
  type GoldCandle,
  type GoldQuote,
  type GoldSymbol,
  type GoldTimeframe,
} from './domain.ts';
import { evaluateGoldResearch, type GoldResearchConfig, type GoldSignal } from './research.ts';

export interface GoldResearchState {
  mode: 'research';
  symbol: GoldSymbol | null;
  timeframe: GoldTimeframe;
  quote: GoldQuote | null;
  candles: Partial<Record<GoldTimeframe, GoldCandle[]>>;
  signal: GoldSignal | null;
  recentSignals: GoldSignal[];
  lastRejectedTick: string | null;
  updatedAt: number;
}

export interface GoldResearchServiceOptions {
  timeframe?: GoldTimeframe;
  config?: Partial<GoldResearchConfig>;
  now?: () => number;
}

const MAX_CANDLES_PER_TIMEFRAME = 500;
const MAX_RECENT_SIGNALS = 40;

function cloneCandles(candles: Partial<Record<GoldTimeframe, GoldCandle[]>>): Partial<Record<GoldTimeframe, GoldCandle[]>> {
  return Object.fromEntries(
    Object.entries(candles).map(([timeframe, rows]) => [timeframe, rows.map((row) => ({ ...row }))]),
  ) as Partial<Record<GoldTimeframe, GoldCandle[]>>;
}

function cloneSignal(signal: GoldSignal | null): GoldSignal | null {
  return signal ? { ...signal, reasons: [...signal.reasons], blockers: [...signal.blockers] } : null;
}

/**
 * Stateful, broker-neutral research coordinator. Adapters feed normalized
 * market data into this service; it never connects to a broker or submits an
 * order. That boundary prevents research updates from becoming execution.
 */
export class GoldResearchService {
  private readonly now: () => number;
  private readonly config?: Partial<GoldResearchConfig>;
  private timeframe: GoldTimeframe;
  private symbol: GoldSymbol | null = null;
  private quote: GoldQuote | null = null;
  private candles: Partial<Record<GoldTimeframe, GoldCandle[]>> = {};
  private signal: GoldSignal | null = null;
  private recentSignals: GoldSignal[] = [];
  private lastRejectedTick: string | null = null;
  private updatedAt = 0;

  constructor(options: GoldResearchServiceOptions = {}) {
    this.timeframe = options.timeframe ?? '5m';
    this.config = options.config;
    this.now = options.now ?? Date.now;
  }

  state(): GoldResearchState {
    return {
      mode: 'research',
      symbol: this.symbol ? { ...this.symbol, sessions: this.symbol.sessions.map((session) => ({ ...session })) } : null,
      timeframe: this.timeframe,
      quote: this.quote ? { ...this.quote } : null,
      candles: cloneCandles(this.candles),
      signal: cloneSignal(this.signal),
      recentSignals: this.recentSignals.map((signal) => cloneSignal(signal)!),
      lastRejectedTick: this.lastRejectedTick,
      updatedAt: this.updatedAt,
    };
  }

  setSymbol(symbol: GoldSymbol): GoldResearchState {
    if (!symbol.id || !Number.isInteger(symbol.digits) || symbol.digits < 0 || !Number.isFinite(symbol.pointSize) || symbol.pointSize <= 0) {
      throw new Error('invalid Gold symbol metadata');
    }
    const changed = this.symbol?.id !== symbol.id;
    this.symbol = { ...symbol, sessions: symbol.sessions.map((session) => ({ ...session })) };
    if (changed) {
      this.quote = null;
      this.candles = {};
      this.signal = null;
      this.recentSignals = [];
      this.lastRejectedTick = null;
    }
    this.updatedAt = this.now();
    return this.state();
  }

  setTimeframe(timeframe: GoldTimeframe): GoldResearchState {
    this.timeframe = timeframe;
    this.recompute();
    return this.state();
  }

  replaceCandles(timeframe: GoldTimeframe, rows: GoldCandle[]): GoldResearchState {
    const symbol = this.requireSymbol();
    if (rows.some((row) => row.symbolId !== symbol.id || row.timeframe !== timeframe)) {
      throw new Error('Gold candles do not match the active symbol/timeframe');
    }
    const ordered = [...rows].sort((left, right) => left.openTime - right.openTime);
    if (ordered.some((row, index) => index > 0 && row.openTime <= ordered[index - 1]!.openTime)) {
      throw new Error('Gold candles must have strictly increasing open times');
    }
    this.candles[timeframe] = ordered.slice(-MAX_CANDLES_PER_TIMEFRAME).map((row) => ({ ...row }));
    this.recompute();
    return this.state();
  }

  ingestQuote(input: Omit<GoldQuote, 'mid' | 'spread'> & Partial<Pick<GoldQuote, 'mid' | 'spread'>>): GoldResearchState {
    const symbol = this.requireSymbol();
    if (input.symbolId !== symbol.id) throw new Error('Gold quote does not match the active symbol');
    const quote = normalizeGoldQuote(input);
    if (!isNewerGoldQuote(this.quote, quote)) {
      this.lastRejectedTick = 'duplicate or out-of-order quote';
      this.updatedAt = this.now();
      return this.state();
    }
    this.quote = quote;
    this.lastRejectedTick = null;
    this.recompute();
    return this.state();
  }

  private recompute(): void {
    this.updatedAt = this.now();
    if (!this.symbol) return;
    const next = evaluateGoldResearch({
      symbol: this.symbol,
      quote: this.quote,
      timeframe: this.timeframe,
      candles: this.candles,
      now: this.updatedAt,
      config: this.config,
    });
    // A signal history starts only once there is a market quote to anchor its
    // entry reference. Candle loading alone may produce a provisional WAIT.
    if (this.quote && next.id !== this.signal?.id) {
      this.recentSignals = [next, ...this.recentSignals].slice(0, MAX_RECENT_SIGNALS);
    }
    this.signal = next;
  }

  private requireSymbol(): GoldSymbol {
    if (!this.symbol) throw new Error('set an active Gold symbol before supplying market data');
    return this.symbol;
  }
}
