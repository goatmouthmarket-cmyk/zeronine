import type { Hub } from '../api/hub.ts';
import type { MarketRegistry } from '../core/marketState.ts';
import type { DerivPrivateClient, QuoteResult } from '../deriv/privateClient.ts';
import {
  insertArbObservations, insertArbSession, stopArbSession,
  type ArbObservationRow, type ArbSessionRow,
} from '../db/store.ts';
import { arbPairKey, calculateArbitrage, isComplementaryPair, type ArbPair, type ArbQuote } from './core.ts';

const MIN_SCAN_INTERVAL_MS = 1_500;
const WRITE_FLUSH_MS = 250;

export interface ArbObserveConfig {
  symbol: string;
  marketDisplay: string;
  pair: ArbPair;
  targetPayout: number;
  currency: string;
  duration?: number;
  durationUnit?: 't' | 'm' | 's';
}

export interface ArbObserverState {
  running: boolean;
  session: ArbSessionRow | null;
  config: Omit<ArbObserveConfig, 'pair'> & { pair: ArbPair } | null;
  latest: ArbObservationRow | null;
  diagnostics: { requests: number; proposalErrors: number; timeouts: number; rateLimitEvents: number; reconnects: number; requestsPerMinute: number };
  edgeStats: { best: number | null; average: number | null };
}

/** Stable, browser-facing shape. Database names remain private to the API. */
export function arbObservationForApi(row: ArbObservationRow): Record<string, unknown> {
  const status = row.status === 'incomplete_pair' ? 'incomplete' : row.status === 'invalid_pair' ? 'invalid' : 'valid';
  return {
    id: row.id || -row.timestamp, sessionId: row.session_id, ts: row.timestamp, market: row.symbol,
    pair: `U${row.under_barrier}/O${row.over_barrier}`, payout: row.target_payout, currency: row.currency,
    lower: { contractType: 'DIGITUNDER', barrier: row.under_barrier, askPrice: row.under_ask, payout: row.under_payout, proposalId: row.under_proposal_id ?? undefined, requestedAt: row.under_request_sent_at, receivedAt: row.under_received_at, latencyMs: row.under_round_trip_ms, error: row.under_ask == null ? row.reason : null },
    upper: { contractType: 'DIGITOVER', barrier: row.over_barrier, askPrice: row.over_ask, payout: row.over_payout, proposalId: row.over_proposal_id ?? undefined, requestedAt: row.over_request_sent_at, receivedAt: row.over_received_at, latencyMs: row.over_round_trip_ms, error: row.over_ask == null ? row.reason : null },
    totalCost: row.combined_cost, grossMargin: row.theoretical_profit, roi: row.theoretical_roi, edge: row.theoretical_roi,
    syncMs: row.quote_gap_ms, syncQuality: row.sync_quality ?? 'incomplete', status, diagnostic: row.reason,
  };
}

export function arbStateForApi(state: ArbObserverState): Record<string, unknown> {
  const s = state.session;
  const c = state.config;
  return {
    phase: state.running ? 'observing' : s ? 'stopped' : 'idle', running: state.running,
    market: c?.symbol ?? s?.symbol ?? '', pair: c ? arbPairKey(c.pair) : s?.pair_key ?? 'U5/O4', payout: c?.targetPayout ?? s?.target_payout ?? 10,
    currency: c?.currency ?? s?.currency ?? 'USD', sessionId: s?.id ?? null, latest: state.latest ? arbObservationForApi(state.latest) : null,
    observations: s?.observation_count ?? 0, validObservations: Math.max(0, (s?.observation_count ?? 0) - (s?.error_count ?? 0)),
    positiveObservations: s?.positive_count ?? 0, highQualityObservations: s?.high_quality_count ?? 0,
    errorObservations: s?.error_count ?? 0, bestEdge: state.edgeStats.best, averageEdge: state.edgeStats.average,
    lastActivityAt: state.latest?.timestamp, reason: state.latest?.reason ?? null, diagnostics: state.diagnostics,
  };
}

function toArbQuote(q: QuoteResult, config: ArbObserveConfig): ArbQuote {
  return {
    symbol: config.symbol, currency: config.currency, duration: config.duration ?? 1, durationUnit: config.durationUnit ?? 't', basis: 'payout', requestedPayout: config.targetPayout,
    askPrice: q.askPrice, payout: q.payout, proposalId: q.id, direction: q.direction, barrier: q.barrier,
    requestSentAt: q.requestSentAt, receivedAt: q.receivedAt, roundTripMs: q.roundTripMs,
  };
}

/**
 * Research-only quote sampler. Its only Deriv operation is getQuote(); no buy
 * method is accepted or called here, keeping observe mode structurally unable
 * to create an account contract.
 */
export class ArbitrageObserver {
  private running = false;
  private session: ArbSessionRow | null = null;
  private config: ArbObserveConfig | null = null;
  private timer: NodeJS.Timeout | null = null;
  private flushTimer: NodeJS.Timeout | null = null;
  private pending: Omit<ArbObservationRow, 'id'>[] = [];
  private latest: ArbObservationRow | null = null;
  private inFlight = false;
  private requestTimes: number[] = [];
  private diagnostics = { requests: 0, proposalErrors: 0, timeouts: 0, rateLimitEvents: 0, reconnects: 0 };
  private validEdgeCount = 0;
  private validEdgeSum = 0;
  private bestEdge: number | null = null;

  private readonly registry: MarketRegistry;
  private readonly client: Pick<DerivPrivateClient, 'getQuote' | 'isConnected'>;
  private readonly hub: Hub;

  constructor(registry: MarketRegistry, client: Pick<DerivPrivateClient, 'getQuote' | 'isConnected'>, hub: Hub) {
    this.registry = registry;
    this.client = client;
    this.hub = hub;
  }

  state(): ArbObserverState {
    const cutoff = Date.now() - 60_000;
    this.requestTimes = this.requestTimes.filter((t) => t >= cutoff);
    return { running: this.running, session: this.session, config: this.config, latest: this.latest,
      diagnostics: { ...this.diagnostics, requestsPerMinute: this.requestTimes.length },
      edgeStats: { best: this.bestEdge, average: this.validEdgeCount ? this.validEdgeSum / this.validEdgeCount : null } };
  }

  start(input: ArbObserveConfig): ArbObserverState {
    if (!isComplementaryPair(input.pair)) throw new Error('only adjacent complementary U1/O0 through U9/O8 pairs are valid');
    if (!this.registry.has(input.symbol)) throw new Error('selected market is not currently available');
    if (!Number.isFinite(input.targetPayout) || input.targetPayout <= 0) throw new Error('target payout must be positive');
    if (this.running) this.stop();
    const now = Date.now();
    const duration = input.duration ?? 1;
    const durationUnit = input.durationUnit ?? 't';
    this.config = { ...input, duration, durationUnit };
    this.session = insertArbSession({
      id: `arb-${now}-${Math.random().toString(36).slice(2, 8)}`, started_at: now, symbol: input.symbol, market_display: input.marketDisplay,
      pair_key: arbPairKey(input.pair), duration, duration_unit: durationUnit, basis: 'payout', target_payout: input.targetPayout, currency: input.currency,
    });
    this.running = true;
    this.latest = null;
    this.validEdgeCount = 0;
    this.validEdgeSum = 0;
    this.bestEdge = null;
    this.emitState();
    void this.scan();
    return this.state();
  }

  stop(): ArbObserverState {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.flush();
    if (this.session) this.session = stopArbSession(this.session.id);
    this.emitState();
    return this.state();
  }

  private schedule(): void {
    if (!this.running) return;
    this.timer = setTimeout(() => void this.scan(), MIN_SCAN_INTERVAL_MS);
    this.timer.unref();
  }

  private async scan(): Promise<void> {
    if (!this.running || this.inFlight || !this.config || !this.session) return;
    this.inFlight = true;
    const started = Date.now();
    const config = this.config;
    const sessionId = this.session.id;
    let under: ArbQuote | undefined;
    let over: ArbQuote | undefined;
    let error = '';
    try {
      if (!this.client.isConnected) throw new Error('private quote socket is not connected');
      const common = { amount: config.targetPayout, currency: config.currency, duration: config.duration ?? 1, durationUnit: config.durationUnit ?? 't', symbol: config.symbol, basis: 'payout' as const };
      this.diagnostics.requests += 2;
      this.requestTimes.push(Date.now(), Date.now());
      const [underResult, overResult] = await Promise.allSettled([
        this.client.getQuote({ ...common, direction: 'under', barrier: config.pair.underBarrier }),
        this.client.getQuote({ ...common, direction: 'over', barrier: config.pair.overBarrier }),
      ]);
      if (underResult.status === 'fulfilled') under = toArbQuote(underResult.value, config);
      else error += `under: ${String(underResult.reason)}; `;
      if (overResult.status === 'fulfilled') over = toArbQuote(overResult.value, config);
      else error += `over: ${String(overResult.reason)}; `;
      if (error) {
        this.diagnostics.proposalErrors += 1;
        if (/timeout/i.test(error)) this.diagnostics.timeouts += 1;
        if (/rate/i.test(error)) this.diagnostics.rateLimitEvents += 1;
      }
    } catch (err) {
      error = String(err);
      this.diagnostics.proposalErrors += 1;
    }
    const calculation = calculateArbitrage(config.pair, under, over);
    const snapshot = this.registry.snapshot(config.symbol);
    const row: Omit<ArbObservationRow, 'id'> = {
      session_id: sessionId, timestamp: Date.now(), symbol: config.symbol, market_display: config.marketDisplay, duration: config.duration ?? 1, duration_unit: config.durationUnit ?? 't', basis: 'payout', target_payout: config.targetPayout, currency: config.currency,
      under_barrier: config.pair.underBarrier, over_barrier: config.pair.overBarrier,
      under_ask: under?.askPrice ?? null, under_payout: under?.payout ?? null, under_proposal_id: under?.proposalId ?? null,
      over_ask: over?.askPrice ?? null, over_payout: over?.payout ?? null, over_proposal_id: over?.proposalId ?? null,
      combined_cost: calculation.combinedCost ?? null, combined_cost_pct: calculation.combinedCostPct ?? null, theoretical_profit: calculation.theoreticalProfit ?? null, theoretical_roi: calculation.theoreticalRoi ?? null, house_margin_pct: calculation.houseMarginPct ?? null,
      under_request_sent_at: under?.requestSentAt ?? null, under_received_at: under?.receivedAt ?? null, over_request_sent_at: over?.requestSentAt ?? null, over_received_at: over?.receivedAt ?? null,
      under_round_trip_ms: under?.roundTripMs ?? null, over_round_trip_ms: over?.roundTripMs ?? null, quote_gap_ms: calculation.quoteGapMs ?? null, scan_duration_ms: Date.now() - started,
      sync_quality: calculation.syncQuality ?? null, status: calculation.status, reason: error || calculation.reason || null, is_positive: Number(calculation.isPositive), is_high_quality_candidate: Number(calculation.isHighQualityCandidate), last_digit: snapshot.lastDigit >= 0 ? snapshot.lastDigit : null,
    };
    this.pending.push(row);
    if (row.status === 'valid' && Number.isFinite(row.theoretical_roi)) {
      const edge = Number(row.theoretical_roi);
      this.validEdgeCount += 1;
      this.validEdgeSum += edge;
      this.bestEdge = this.bestEdge == null ? edge : Math.max(this.bestEdge, edge);
    }
    this.latest = { ...row, id: 0 };
    this.session = this.session ? {
      ...this.session,
      observation_count: this.session.observation_count + 1,
      positive_count: this.session.positive_count + row.is_positive,
      high_quality_count: this.session.high_quality_count + row.is_high_quality_candidate,
      error_count: this.session.error_count + (row.status === 'valid' ? 0 : 1),
    } : null;
    this.hub.emit({ type: 'arb_observation', ts: Date.now(), observation: arbObservationForApi(this.latest), state: arbStateForApi(this.state()) });
    this.emitState();
    if (!this.flushTimer) { this.flushTimer = setTimeout(() => this.flush(), WRITE_FLUSH_MS); this.flushTimer.unref(); }
    this.inFlight = false;
    this.schedule();
  }

  private flush(): void {
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = null;
    const rows = this.pending.splice(0);
    if (!rows.length) return;
    try { insertArbObservations(rows); }
    catch (err) { console.warn(`[arb] observation persistence failed: ${String(err)}`); }
  }

  private emitState(): void { this.hub.emit({ type: 'arb', ts: Date.now(), state: arbStateForApi(this.state()) }); }
}
