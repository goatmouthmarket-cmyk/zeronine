import { createCTraderGoldClient, type GoldMarketDataAdapter } from './ctrader.ts';
import { goldDiagnostics, loadGoldConfig, type GoldConfig, type GoldDiagnostics } from './config.ts';
import {
  type GoldCandle,
  type GoldQuote,
  type GoldSide,
  type GoldSymbol,
  type GoldTimeframe,
} from './domain.ts';
import { runGoldBacktest, type GoldBacktestConfig, type GoldBacktestResult, type GoldBacktestStrategy } from './backtest.ts';
import { GoldPaperEngine, type GoldPaperCloseResult, type GoldPaperOpenResult, type GoldPaperState } from './paper.ts';
import { GoldResearchService, type GoldResearchState } from './researchService.ts';
import type { GoldSignal } from './research.ts';
import type { GoldSentimentSnapshot } from './sentiment.ts';
import type { GoldSentimentWorker, GoldSentimentWorkerState } from './sentimentWorker.ts';
import { GoldOAuthOnboarding, type GoldConnectionState } from './onboarding.ts';
import type { CTraderAuthorizedAccount } from './ctraderAccountDiscovery.ts';

export interface GoldRuntimeReadiness {
  ready: boolean;
  reason: string | null;
}

export type { GoldConnectionState } from './onboarding.ts';

export interface GoldRuntimeState {
  diagnostics: GoldDiagnostics;
  connection: GoldConnectionState;
  research: GoldRuntimeReadiness & { state: GoldResearchState };
  paper: GoldRuntimeReadiness & { state: GoldPaperState };
  backtest: GoldRuntimeReadiness & { result: GoldBacktestResult | null };
  /** News/social sentiment worker status; null when no worker is attached. */
  sentiment: GoldSentimentWorkerState | null;
  paperAutomation: GoldPaperAutomationState;
}

export interface GoldPaperAutomationState {
  enabled: true;
  status: 'collecting' | 'waiting' | 'open' | 'cooldown';
  reason: string;
  attempts: number;
  opened: number;
  lastSignalId: string | null;
  lastAttemptAt: number;
  nextEligibleAt: number;
}

export interface GoldRuntimeOptions {
  config?: GoldConfig;
  adapter?: GoldMarketDataAdapter;
  research?: GoldResearchService;
  paper?: GoldPaperEngine;
  sentimentWorker?: GoldSentimentWorker;
  now?: () => number;
  predictionEvidence?: GoldPredictionEvidenceStore;
}

export interface PendingGoldPrediction {
  signal_id: string;
  direction: 'BUY' | 'SELL';
  entry_price: number;
  generated_at: number;
  evaluation_due_at: number;
}

export interface GoldPredictionEvidenceStore {
  record(signal: GoldSignal, evaluationDueAt: number): void;
  pending(symbol: string, dueAt: number): PendingGoldPrediction[];
  resolve(signalId: string, status: 'correct' | 'incorrect' | 'flat', exitPrice: number, evaluatedAt: number): void;
}

export class GoldRuntimeUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GoldRuntimeUnavailableError';
  }
}

/**
 * The only stateful coordinator for the Gold module. It deliberately owns a
 * virtual paper book only. There is no cTrader execution adapter or order
 * method in this class, so API wiring cannot accidentally create a broker
 * trade while the integration is still being built.
 */
export class GoldRuntime {
  private readonly adapter: GoldMarketDataAdapter;
  private readonly research: GoldResearchService;
  private readonly paper: GoldPaperEngine;
  private readonly onboarding: GoldOAuthOnboarding;
  private readonly sentimentWorker: GoldSentimentWorker | null;
  private readonly now: () => number;
  private readonly predictionEvidence: GoldPredictionEvidenceStore | null;
  private lastBacktest: GoldBacktestResult | null = null;
  private paperAutomation: GoldPaperAutomationState = {
    enabled: true, status: 'collecting', reason: 'Collecting candles for the first validated prediction',
    attempts: 0, opened: 0, lastSignalId: null, lastAttemptAt: 0, nextEligibleAt: 0,
  };

  constructor(options: GoldRuntimeOptions = {}) {
    const config = options.config ?? loadGoldConfig();
    this.adapter = options.adapter ?? createCTraderGoldClient(config);
    this.research = options.research ?? new GoldResearchService({ now: options.now });
    this.paper = options.paper ?? new GoldPaperEngine({ initialBalance: 10_000 });
    this.onboarding = new GoldOAuthOnboarding(config);
    this.sentimentWorker = options.sentimentWorker ?? null;
    // The runtime is the wiring point: worker snapshots become research input.
    // Starting/stopping the worker stays with the process lifecycle in main.
    this.sentimentWorker?.setOnSnapshot((snapshot) => this.ingestSentiment(snapshot));
    this.now = options.now ?? Date.now;
    this.predictionEvidence = options.predictionEvidence ?? null;
  }

  state(): GoldRuntimeState {
    const readiness = this.marketDataReadiness();
    const researchState = this.research.state();
    const backtestReadiness = this.backtestReadiness(researchState);
    return {
      diagnostics: this.diagnostics(),
      connection: this.connectionState(),
      research: { ...readiness, state: researchState },
      paper: { ...readiness, state: this.paper.state() },
      backtest: { ...backtestReadiness, result: this.lastBacktest },
      sentiment: this.sentimentWorker?.state() ?? null,
      paperAutomation: { ...this.paperAutomation },
    };
  }

  connectionState(): GoldConnectionState {
    return this.onboarding.state();
  }

  beginOAuthAuthorization(): { url: string; nonce: string } {
    return this.onboarding.begin();
  }

  completeOAuthAuthorization(code: string): Promise<GoldConnectionState> {
    return this.onboarding.complete(code);
  }

  disconnectOAuthAuthorization(): GoldConnectionState {
    return this.onboarding.disconnect();
  }

  listOAuthDemoAccounts(): Promise<CTraderAuthorizedAccount[]> {
    return this.onboarding.listDemoAccounts();
  }

  selectOAuthDemoAccount(accountId: string): Promise<GoldConnectionState> {
    return this.onboarding.selectDemoAccount(accountId);
  }

  /** Adapter ingress only. It does not cause any order or connection attempt. */
  setSymbol(symbol: GoldSymbol): GoldResearchState {
    return this.research.setSymbol(symbol);
  }

  /** Adapter ingress only. Historical candles remain separate from live ticks. */
  replaceCandles(timeframe: GoldTimeframe, candles: GoldCandle[]): GoldResearchState {
    const next = this.research.replaceCandles(timeframe, candles);
    this.evaluateMaturePredictions(next);
    return next;
  }

  /** Adapter ingress only. Paper positions receive a mark only after this call. */
  ingestQuote(quote: Omit<GoldQuote, 'mid' | 'spread'> & Partial<Pick<GoldQuote, 'mid' | 'spread'>>): GoldResearchState {
    const next = this.research.ingestQuote(quote);
    // The virtual book reserves its first executable quote for entry. Once a
    // position exists, every newer research quote marks or settles it.
    if (next.quote && this.paper.state().positions.length > 0) this.paper.onQuote(next.quote);
    if (next.symbol && next.quote) this.runAutomaticPaperResearch(next);
    this.evaluateMaturePredictions(next);
    return next;
  }

  /** Sentiment-worker ingress only. It never places, gates, or blocks an order. */
  ingestSentiment(snapshot: GoldSentimentSnapshot): GoldResearchState {
    return this.research.setSentiment(snapshot);
  }

  openPaper(input: { side: GoldSide; volume: number; stopLoss?: number | null; takeProfit?: number | null }): GoldPaperOpenResult {
    const { symbol, quote } = this.requireMarketData();
    return this.paper.open({ ...input, symbol, quote, now: this.now(), origin: 'manual' });
  }

  closePaper(positionId: string): GoldPaperCloseResult {
    const { quote } = this.requireMarketData();
    return this.paper.close(positionId, quote, this.now());
  }

  resetPaper(): GoldPaperState {
    this.requireMarketData();
    return this.paper.reset();
  }

  runBacktest(strategy: GoldBacktestStrategy, patch?: Partial<GoldBacktestConfig>): GoldBacktestResult {
    const research = this.requireBacktestData();
    const candles = research.candles[research.timeframe] ?? [];
    this.lastBacktest = runGoldBacktest(candles, strategy, patch);
    return this.lastBacktest;
  }

  /**
   * A deterministic, intentionally modest baseline for the first Gold
   * workspace. It uses completed predecessor candles only; users cannot send
   * arbitrary strategy code through the HTTP API.
   */
  runBaselineBacktest(): GoldBacktestResult {
    return this.runBacktest((context) => {
      const latest = context.history.at(-1);
      const prior = context.history.at(-2);
      if (!latest || !prior || latest.close === prior.close) return null;
      const range = Math.max(latest.high - latest.low, Number.EPSILON);
      return {
        side: latest.close > prior.close ? 'BUY' : 'SELL',
        volume: 1,
        stopDistance: range * 1.5,
        takeProfitDistance: range * 2.25,
        reason: 'baseline completed-candle direction',
      };
    });
  }

  private diagnostics(): GoldDiagnostics {
    // The adapter owns its own configuration and must never leak credentials.
    return this.adapter.diagnostics() ?? goldDiagnostics();
  }

  private runAutomaticPaperResearch(research: GoldResearchState): void {
    const paper = this.paper.state();
    if (paper.positions.length > 0) {
      this.paperAutomation.status = 'open';
      this.paperAutomation.reason = 'Tracking the open virtual prediction against live Gold prices';
      return;
    }
    const signal = research.signal;
    const now = this.now();
    if (!signal || (signal.direction !== 'BUY' && signal.direction !== 'SELL')) {
      this.paperAutomation.status = 'collecting';
      this.paperAutomation.reason = signal?.blockers.join(' · ') || 'Collecting candle, trend, volatility, and sentiment evidence';
      return;
    }
    // BUY/SELL has already cleared the research model's directional threshold.
    // Paper evidence should sample every validated signal instead of applying a
    // second, stricter confidence gate that hides most of the model's calls.
    if (now < this.paperAutomation.nextEligibleAt) {
      this.paperAutomation.status = 'cooldown';
      this.paperAutomation.reason = 'Waiting five minutes before testing another prediction';
      return;
    }
    if (signal.id === this.paperAutomation.lastSignalId) return;
    this.paperAutomation.attempts += 1;
    this.paperAutomation.lastSignalId = signal.id;
    this.paperAutomation.lastAttemptAt = now;
    const opened = this.paper.open({
      symbol: research.symbol!, quote: research.quote!, side: signal.direction,
      volume: research.symbol!.minVolume, stopLoss: signal.proposedStopLoss, takeProfit: signal.proposedTakeProfit,
      now, origin: 'automatic_research', researchSignalId: signal.id,
    });
    if (opened.accepted) {
      this.paperAutomation.opened += 1;
      this.paperAutomation.status = 'open';
      this.paperAutomation.reason = `${signal.direction} prediction opened virtually at ${signal.confidence}% confidence`;
      this.paperAutomation.nextEligibleAt = now + 5 * 60_000;
      this.recordPrediction(signal);
    } else {
      this.paperAutomation.status = 'waiting';
      this.paperAutomation.reason = opened.reason;
    }
  }

  private recordPrediction(signal: GoldSignal): void {
    const store = this.predictionEvidence;
    if (!store || (signal.direction !== 'BUY' && signal.direction !== 'SELL')) return;
    try {
      const generated = new Date(signal.generatedAt);
      const evaluationDueAt = Date.UTC(generated.getUTCFullYear(), generated.getUTCMonth(), generated.getUTCDate() + 1);
      store.record(signal, evaluationDueAt);
    } catch (error) {
      console.warn(`[gold prediction evidence] ${String(error)}`);
    }
  }

  private evaluateMaturePredictions(research: GoldResearchState): void {
    const store = this.predictionEvidence;
    if (!store || !research.symbol) return;
    try {
      const now = this.now();
      const pending = store.pending(research.symbol.id, now);
      if (!pending.length) return;
      const completed = Object.values(research.candles).flat().filter((candle): candle is GoldCandle => Boolean(candle?.complete));
      for (const prediction of pending) {
        const closingCandle = completed
          .filter((candle) => candle.symbolId === research.symbol!.id && candle.closeTime > prediction.generated_at && candle.closeTime <= prediction.evaluation_due_at)
          .sort((a, b) => b.closeTime - a.closeTime)[0];
        if (!closingCandle) continue;
        const movement = closingCandle.close - prediction.entry_price;
        const status = Math.abs(movement) < Number.EPSILON
          ? 'flat'
          : prediction.direction === 'BUY' ? movement > 0 ? 'correct' : 'incorrect' : movement < 0 ? 'correct' : 'incorrect';
        store.resolve(prediction.signal_id, status, closingCandle.close, now);
      }
    } catch (error) {
      // Research evidence is telemetry: persistence must never block quotes,
      // paper testing, demo orders, settlement, or stop requests.
      console.warn(`[gold prediction evidence] ${String(error)}`);
    }
  }

  private marketDataReadiness(): GoldRuntimeReadiness {
    const diagnostics = this.diagnostics();
    if (!diagnostics.marketDataCapable) {
      return { ready: false, reason: 'Gold market data is not validated: the cTrader adapter is read-only.' };
    }
    const research = this.research.state();
    if (!research.symbol) return { ready: false, reason: 'Gold market data is not validated: no broker symbol is active.' };
    if (!research.quote) return { ready: false, reason: 'Gold market data is not validated: no live quote is available.' };
    if (this.now() - research.quote.receivedAt > 10_000) {
      return { ready: false, reason: 'Gold market data is not validated: the live quote is stale.' };
    }
    return { ready: true, reason: null };
  }

  private backtestReadiness(research: GoldResearchState): GoldRuntimeReadiness {
    const candles = research.candles[research.timeframe] ?? [];
    const completed = candles.filter((candle) => candle.complete);
    if (completed.length === 0) return { ready: false, reason: 'Gold backtest is not validated: no completed historical candles are loaded.' };
    if (completed.length < 30) return { ready: false, reason: `Gold backtest needs 30 completed candles (${completed.length} loaded).` };
    return { ready: true, reason: null };
  }

  private requireMarketData(): { symbol: GoldSymbol; quote: GoldQuote } {
    const readiness = this.marketDataReadiness();
    if (!readiness.ready) throw new GoldRuntimeUnavailableError(readiness.reason ?? 'Gold market data is unavailable');
    const state = this.research.state();
    if (!state.symbol || !state.quote) throw new GoldRuntimeUnavailableError('Gold market data is unavailable');
    return { symbol: state.symbol, quote: state.quote };
  }

  private requireBacktestData(): GoldResearchState {
    const state = this.research.state();
    const readiness = this.backtestReadiness(state);
    if (!readiness.ready) throw new GoldRuntimeUnavailableError(readiness.reason ?? 'Gold backtest is unavailable');
    return {
      ...state,
      candles: {
        ...state.candles,
        [state.timeframe]: (state.candles[state.timeframe] ?? []).filter((candle) => candle.complete),
      },
    };
  }
}
