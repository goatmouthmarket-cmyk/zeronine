import {
  isNewerGoldQuote,
  normalizeGoldQuote,
  type GoldCandle,
  type GoldQuote,
  type GoldSymbol,
  type GoldTimeframe,
} from './domain.ts';
import { evaluateGoldResearch, type GoldResearchConfig, type GoldSignal } from './research.ts';
import type { GoldSentimentSnapshot } from './sentiment.ts';

export interface GoldResearchState {
  mode: 'research';
  symbol: GoldSymbol | null;
  timeframe: GoldTimeframe;
  quote: GoldQuote | null;
  candles: Partial<Record<GoldTimeframe, GoldCandle[]>>;
  signal: GoldSignal | null;
  recentSignals: GoldSignal[];
  lastRejectedTick: string | null;
  sentiment: GoldSentimentSnapshot | null;
  updatedAt: number;
}

export interface GoldResearchServiceOptions {
  timeframe?: GoldTimeframe;
  config?: Partial<GoldResearchConfig>;
  now?: () => number;
  tradeKnowledge?: (symbolId: string, direction: 'BUY' | 'SELL') => { samples: number; winRate: number | null };
  confirmationCandles?: 1 | 2;
  minActionableConfidence?: number;
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

function cloneSentiment(snapshot: GoldSentimentSnapshot | null): GoldSentimentSnapshot | null {
  return snapshot
    ? { ...snapshot, topItems: [...snapshot.topItems], sources: [...snapshot.sources] }
    : null;
}

/**
 * Stateful, broker-neutral research coordinator. Adapters feed normalized
 * market data into this service; it never connects to a broker or submits an
 * order. That boundary prevents research updates from becoming execution.
 */
export class GoldResearchService {
  private readonly now: () => number;
  private readonly config?: Partial<GoldResearchConfig>;
  private readonly tradeKnowledge?: GoldResearchServiceOptions['tradeKnowledge'];
  private readonly confirmationCandles: 1 | 2;
  private readonly minActionableConfidence: number;
  private timeframe: GoldTimeframe;
  private symbol: GoldSymbol | null = null;
  private quote: GoldQuote | null = null;
  private candles: Partial<Record<GoldTimeframe, GoldCandle[]>> = {};
  private signal: GoldSignal | null = null;
  private recentSignals: GoldSignal[] = [];
  private lastRejectedTick: string | null = null;
  private sentiment: GoldSentimentSnapshot | null = null;
  private updatedAt = 0;
  private candidateDirection: 'BUY' | 'SELL' | 'WAIT' = 'WAIT';
  private candidateConfirmations = 0;
  private lastDecisionCandleClose = 0;

  constructor(options: GoldResearchServiceOptions = {}) {
    this.timeframe = options.timeframe ?? '5m';
    this.config = options.config;
    this.now = options.now ?? Date.now;
    this.tradeKnowledge = options.tradeKnowledge;
    this.confirmationCandles = options.confirmationCandles ?? 2;
    this.minActionableConfidence = Math.max(0, Math.min(100, options.minActionableConfidence ?? 0));
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
      sentiment: cloneSentiment(this.sentiment),
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
      this.candidateDirection = 'WAIT';
      this.candidateConfirmations = 0;
      this.lastDecisionCandleClose = 0;
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

  /** Sentiment ingress from the news/social worker. It never fetches alone. */
  setSentiment(snapshot: GoldSentimentSnapshot | null): GoldResearchState {
    this.sentiment = cloneSentiment(snapshot);
    this.recompute();
    return this.state();
  }

  private recompute(): void {
    this.updatedAt = this.now();
    if (!this.symbol) return;
    let next = evaluateGoldResearch({
      symbol: this.symbol,
      quote: this.quote,
      timeframe: this.timeframe,
      candles: this.candles,
      now: this.updatedAt,
      config: this.config,
      sentiment: this.sentiment,
    });
    const decisionCandleClose = (this.candles[this.timeframe] ?? [])
      .filter((candle) => candle.complete && candle.closeTime <= this.updatedAt)
      .at(-1)?.closeTime ?? 0;

    // Produce at most one decision per completed primary candle. Two
    // consecutive candles must independently support the same side before it
    // becomes actionable. Live quotes may update P&L, but cannot rewrite this
    // forward forecast inside its candle window.
    if (this.quote && decisionCandleClose > this.lastDecisionCandleClose) {
      this.lastDecisionCandleClose = decisionCandleClose;
      if (next.direction === 'BUY' || next.direction === 'SELL') {
        if (next.direction === this.candidateDirection) this.candidateConfirmations += 1;
        else {
          this.candidateDirection = next.direction;
          this.candidateConfirmations = 1;
        }
      } else {
        this.candidateDirection = 'WAIT';
        this.candidateConfirmations = 0;
      }
    }
    if (next.direction === 'BUY' || next.direction === 'SELL') {
      const confirmed = this.candidateConfirmations >= this.confirmationCandles;
      const strongEnough = next.confidence >= this.minActionableConfidence;
      next = {
        ...next,
        actionable: confirmed && strongEnough,
        confirmationCount: this.candidateConfirmations,
        confirmationRequired: this.confirmationCandles,
        blockers: [
          ...next.blockers,
          ...(!confirmed ? [`Forecast needs ${this.confirmationCandles} completed-candle confirmations (${this.candidateConfirmations}/${this.confirmationCandles})`] : []),
          ...(!strongEnough ? [`Forecast confidence ${next.confidence}% is below the ${this.minActionableConfidence}% confirmation gate`] : []),
        ],
        reasons: [...next.reasons, ...(confirmed && strongEnough ? [] : [`${next.direction} forecast is forming for the next five minutes`])],
      };
    }
    if (this.signal?.id === next.id) {
      // Keep the issued forecast immutable until the next completed candle.
      return;
    }
    if (next.direction === 'BUY' || next.direction === 'SELL') {
      try {
        const profile = this.tradeKnowledge?.(next.symbolId, next.direction);
        if (profile && profile.samples >= 20 && profile.winRate != null) {
          // Outcomes from the operator's own Gold contracts calibrate the
          // displayed strength only after a meaningful sample. The bounded
          // adjustment cannot invent or reverse a direction on its own.
          const adjustment = Math.max(-8, Math.min(8, Math.round((profile.winRate - .5) * 20)));
          next = {
            ...next,
            confidence: Math.max(0, Math.min(100, next.confidence + adjustment)),
            reasons: [...next.reasons, `Own-trade evidence: ${(profile.winRate * 100).toFixed(1)}% wins across ${profile.samples} ${next.direction} contracts (${adjustment >= 0 ? '+' : ''}${adjustment} confidence)`],
          };
        }
      } catch {
        // Knowledge telemetry must never interrupt live research updates.
      }
    }
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
