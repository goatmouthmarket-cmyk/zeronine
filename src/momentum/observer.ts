import WebSocket from 'ws';
import { config } from '../config.ts';
import type { Hub } from '../api/hub.ts';
import { getMomentumResearchSummary, insertMomentumResearch, type MomentumResearchSummary } from '../db/store.ts';

const WINDOW_SECONDS = 300;
const DECISION_AFTER_SECONDS = 60;
const MAX_TICKS = 1_200;
const SCAN_SECONDS = 60;
const MAX_SCAN_MARKETS = 12;
const MAX_DISCOVERY_MARKETS = 48;
const CONTRACT_CHECK_INTERVAL_MS = 350;
const CONTRACT_CHECK_RETRY_MS = 1_500;
const MULTIPLIER_SUPPORT_CACHE_MS = 10 * 60 * 1_000;
const MAX_SCAN_SAMPLES = 16;
const MAX_FOCUS_SAMPLES = 90;
const UI_EMIT_INTERVAL_MS = 250;
const AUTOMATIC_CONFIG = { multiplier: 20, stake: 10, commissionRate: .001 } as const;

export interface MomentumMarket { symbol: string; display: string; market: string }
export interface MomentumSample { epoch: number; quote: number }
export interface MomentumScanMarket extends MomentumMarket {
  sampleCount: number;
  progress: number;
  signal: MomentumSignal;
  samples: MomentumSample[];
}
export interface MomentumConfig { symbol: string; multiplier: number; stake: number; commissionRate: number }
export interface MomentumSignal {
  direction: 'up' | 'down' | 'wait';
  confidence: number;
  score: number;
  reason: string;
  return15s: number | null;
  return30s: number | null;
  return60s: number | null;
}
export interface MomentumWindow {
  startedAt: number;
  endsAt: number;
  openPrice: number;
  currentPrice: number;
  changePct: number;
  decisionAt: number | null;
  decisionPrice: number | null;
  direction: 'up' | 'down' | null;
  signal: MomentumSignal;
  decisionSignal: MomentumSignal | null;
  samples: MomentumSample[];
  estimatedGross: number;
  estimatedCommission: number;
  estimatedNet: number;
}
export interface MomentumState {
  phase: 'connecting' | 'scanning' | 'idle' | 'observing' | 'stopped' | 'error';
  running: boolean;
  markets: MomentumMarket[];
  config: MomentumConfig | null;
  window: MomentumWindow | null;
  completedWindows: number;
  signalledWindows: number;
  wins: number;
  losses: number;
  estimatedNet: number;
  lastOutcome: { direction: 'up' | 'down'; openPrice: number; decisionPrice: number; exitPrice: number; won: boolean; estimatedNet: number } | null;
  reason: string | null;
  scan: { candidates: number; startedAt: number; endsAt: number; markets: MomentumScanMarket[] } | null;
  research: MomentumResearchSummary;
}

type Tick = { epoch: number; quote: number };
type ContractAvailability = { contract_type?: string };
type MultiplierSupport = { checkedAt: number; supported: boolean };

function delay(ms: number): Promise<void> { return new Promise((resolve) => setTimeout(resolve, ms)); }
function pct(from: number, to: number): number { return from > 0 ? (to - from) / from : 0; }
function sampleTicks(ticks: Tick[], limit: number): MomentumSample[] {
  if (ticks.length <= limit) return ticks.map((tick) => ({ ...tick }));
  const step = (ticks.length - 1) / (limit - 1);
  return Array.from({ length: limit }, (_, index) => ({ ...ticks[Math.round(index * step)]! }));
}
function nearest(ticks: Tick[], epoch: number): Tick | undefined {
  for (let i = ticks.length - 1; i >= 0; i--) if (ticks[i]!.epoch <= epoch) return ticks[i];
  return ticks[0];
}
export function momentumSignal(ticks: Tick[], now: number): MomentumSignal {
  const latest = ticks[ticks.length - 1];
  if (!latest) return { direction: 'wait', confidence: 0, score: 0, reason: 'Waiting for real-market ticks', return15s: null, return30s: null, return60s: null };
  if (!ticks[0] || ticks[0].epoch > now - 60) return { direction: 'wait', confidence: 0, score: 0, reason: 'Building the first 60 seconds of evidence', return15s: null, return30s: null, return60s: null };
  const returns = [15, 30, 60].map((seconds) => {
    const prior = nearest(ticks, now - seconds);
    return prior ? pct(prior.quote, latest.quote) : null;
  });
  if (returns.some((value) => value == null)) return { direction: 'wait', confidence: 0, score: 0, reason: 'Building the first 60 seconds of evidence', return15s: returns[0]!, return30s: returns[1]!, return60s: returns[2]! };
  const [r15, r30, r60] = returns as [number, number, number];
  const score = r15 * .5 + r30 * .3 + r60 * .2;
  const agreement = [r15, r30, r60].filter((value) => Math.sign(value) === Math.sign(score)).length / 3;
  const magnitude = Math.min(1, Math.abs(score) / .0015);
  const confidence = Math.round((agreement * .65 + magnitude * .35) * 100);
  if (Math.abs(score) < .00015 || agreement < 2 / 3) return { direction: 'wait', confidence, score, reason: 'Returns are mixed or too small to justify a direction', return15s: r15, return30s: r30, return60s: r60 };
  const direction = score > 0 ? 'up' : 'down';
  return { direction, confidence, score, reason: `${direction === 'up' ? 'Upward' : 'Downward'} returns agree across ${Math.round(agreement * 3)} of 3 horizons`, return15s: r15, return30s: r30, return60s: r60 };
}

export function rankMomentumMarkets(markets: MomentumMarket[]): MomentumMarket[] {
  return [...markets].sort((a, b) => {
    const bitcoin = Number(/BTC|Bitcoin/i.test(b.display + b.symbol)) - Number(/BTC|Bitcoin/i.test(a.display + a.symbol));
    const crypto = Number(b.market === 'cryptocurrency') - Number(a.market === 'cryptocurrency');
    return bitcoin || crypto || a.display.localeCompare(b.display);
  });
}

/**
 * Deriv labels the open Volatility/Boom/Crash family as `synthetic_index`.
 * It is a market family, not proof that multiplier contracts are available;
 * that check remains in the bounded contracts_for verification below.
 */
export function discoverMomentumMarkets(rows: Array<Record<string, unknown>>): MomentumMarket[] {
  const supportedMarkets = new Set(['cryptocurrency', 'forex', 'indices', 'stock_index', 'commodities', 'synthetic_index']);
  const unique = new Map<string, MomentumMarket>();
  for (const row of rows) {
    const market = String(row.market ?? '');
    if (row.exchange_is_open !== 1 || row.is_trading_suspended !== 0 || !supportedMarkets.has(market)) continue;
    const symbol = String(row.underlying_symbol ?? '');
    if (!symbol || unique.has(symbol)) continue;
    unique.set(symbol, { symbol, display: String(row.underlying_symbol_name ?? symbol), market });
  }
  return rankMomentumMarkets([...unique.values()]);
}

export function supportsBothMultiplierDirections(available: ContractAvailability[]): boolean {
  return available.some((item) => item.contract_type === 'MULTUP')
    && available.some((item) => item.contract_type === 'MULTDOWN');
}

export class MomentumObserver {
  private readonly hub: Hub;
  private ws: WebSocket | null = null;
  private req = 1;
  private pending = new Map<number, { resolve: (value: Record<string, any>) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }>();
  private tickReq = 0;
  private markets: MomentumMarket[] = [];
  private ticks: Tick[] = [];
  private config: MomentumConfig | null = null;
  private window: MomentumWindow | null = null;
  private running = false;
  private phase: MomentumState['phase'] = 'idle';
  private reason: string | null = null;
  private completedWindows = 0;
  private signalledWindows = 0;
  private wins = 0;
  private losses = 0;
  private estimatedNet = 0;
  private lastOutcome: MomentumState['lastOutcome'] = null;
  private scanTicks = new Map<string, Tick[]>();
  private scanRequests = new Map<number, string>();
  private scanStartedAt = 0;
  private scanTimer: NodeJS.Timeout | null = null;
  private research: MomentumResearchSummary;
  private lastEmitAt = 0;
  private emitTimer: NodeJS.Timeout | null = null;
  private generation = 0;
  private multiplierSupport = new Map<string, MultiplierSupport>();
  private nextContractCheckAt = 0;

  constructor(hub: Hub) { this.hub = hub; this.research = getMomentumResearchSummary(); }

  state(): MomentumState {
    const now = Math.floor(Date.now() / 1000);
    const scan = this.scanStartedAt ? {
      candidates: this.scanTicks.size,
      startedAt: this.scanStartedAt,
      endsAt: this.scanStartedAt + SCAN_SECONDS,
      markets: [...this.scanTicks.entries()].map(([symbol, ticks]) => {
        const market = this.markets.find((item) => item.symbol === symbol) ?? { symbol, display: symbol, market: 'unknown' };
        return {
          ...market,
          sampleCount: ticks.length,
          progress: Math.min(1, Math.max(0, (now - this.scanStartedAt) / SCAN_SECONDS)),
          signal: momentumSignal(ticks, now),
          samples: sampleTicks(ticks, MAX_SCAN_SAMPLES),
        };
      }).sort((a, b) => (b.signal.confidence * Math.abs(b.signal.score)) - (a.signal.confidence * Math.abs(a.signal.score))),
    } : null;
    const window = this.window ? { ...this.window, samples: sampleTicks(this.window.samples, MAX_FOCUS_SAMPLES) } : null;
    return { phase: this.phase, running: this.running, markets: this.markets, config: this.config, window,
      completedWindows: this.completedWindows, signalledWindows: this.signalledWindows, wins: this.wins, losses: this.losses,
      estimatedNet: this.estimatedNet, lastOutcome: this.lastOutcome, reason: this.reason,
      scan,
      research: this.research };
  }

  async connect(): Promise<void> {
    if (this.ws) return;
    this.phase = 'connecting'; this.emit();
    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(config.derivPublicUrl, { perMessageDeflate: false, handshakeTimeout: 15_000 });
      this.ws = ws;
      const timer = setTimeout(() => { this.ws = null; ws.terminate(); reject(new Error('momentum market discovery timed out')); }, 15_000);
      ws.on('open', () => ws.send(JSON.stringify({ active_symbols: 'brief', req_id: this.req++ })));
      ws.on('message', (raw) => {
        try {
          const msg = JSON.parse(raw.toString()) as Record<string, any>;
          const requestId = Number(msg.req_id);
          const pending = this.pending.get(requestId);
          if (pending) {
            this.pending.delete(requestId); clearTimeout(pending.timer);
            if (msg.error) pending.reject(new Error(String(msg.error.message ?? 'Deriv request failed'))); else pending.resolve(msg);
            return;
          }
          if (msg.error) { this.reason = String(msg.error.message ?? 'Deriv market error'); this.phase = 'error'; this.emit(); return; }
          if (msg.msg_type === 'active_symbols') {
            const rows = (msg.active_symbols ?? []) as Array<Record<string, any>>;
            this.markets = discoverMomentumMarkets(rows);
            clearTimeout(timer); this.phase = this.running ? 'observing' : 'idle'; this.emit(); resolve();
          } else if (msg.msg_type === 'tick' && msg.tick) {
            const scanSymbol = this.scanRequests.get(Number(msg.req_id));
            if (scanSymbol) this.onScanTick(scanSymbol, Number(msg.tick.quote), Number(msg.tick.epoch));
            else if (msg.req_id === this.tickReq) this.onTick(Number(msg.tick.quote), Number(msg.tick.epoch));
          }
        } catch { /* malformed provider frame */ }
      });
      ws.on('error', (error) => { clearTimeout(timer); this.ws = null; this.reason = error.message; this.phase = 'error'; this.emit(); reject(error); });
      ws.on('close', () => {
        this.ws = null;
        for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(new Error('real-market feed disconnected')); }
        this.pending.clear();
        if (this.running) { this.phase = 'error'; this.reason = 'Real-market feed disconnected'; this.emit(); }
      });
    });
  }

  async start(input: MomentumConfig): Promise<MomentumState> {
    const generation = ++this.generation;
    await this.connect();
    if (generation !== this.generation) {
      if (!this.running) this.phase = 'stopped';
      return this.state();
    }
    if (!this.markets.some((market) => market.symbol === input.symbol)) throw new Error('selected real market is unavailable');
    if (!(input.multiplier > 0 && input.stake > 0 && input.commissionRate >= 0)) throw new Error('stake, multiplier, and commission must be valid');
    const contracts = await this.request({ contracts_for: input.symbol });
    const available = (contracts.contracts_for?.available ?? []) as ContractAvailability[];
    if (!supportsBothMultiplierDirections(available)) {
      throw new Error('this market does not currently offer both Multiplier Up and Multiplier Down');
    }
    return this.begin(input);
  }

  private begin(input: MomentumConfig, seed: Tick[] = []): MomentumState {
    this.stopSubscription();
    this.config = input; this.ticks = [...seed]; this.window = null; this.running = true; this.phase = 'observing'; this.reason = null;
    if (seed.length > 0) {
      const latest = seed.at(-1)!;
      this.window = this.newWindow(latest.quote, latest.epoch);
      this.window.samples = [...seed];
    }
    this.tickReq = this.req++;
    this.ws!.send(JSON.stringify({ ticks: input.symbol, subscribe: 1, req_id: this.tickReq }));
    this.emit(); return this.state();
  }

  async startAutomatic(): Promise<MomentumState> {
    const generation = ++this.generation;
    await this.connect();
    if (generation !== this.generation) {
      if (!this.running) this.phase = 'stopped';
      return this.state();
    }
    this.stopSubscription();
    const candidates = (await this.verifyMultiplierMarkets(momentumVerificationPool(this.markets), generation)).slice(0, MAX_SCAN_MARKETS);
    if (generation !== this.generation) return this.state();
    if (!candidates.length) throw new Error('No open real market currently offers both multiplier directions');
    this.running = true; this.phase = 'scanning'; this.reason = 'Comparing live momentum across verified real markets';
    this.config = null; this.window = null; this.scanStartedAt = Math.floor(Date.now() / 1000);
    for (const market of candidates) {
      this.scanTicks.set(market.symbol, []);
      const requestId = this.req++; this.scanRequests.set(requestId, market.symbol);
      this.ws!.send(JSON.stringify({ ticks: market.symbol, subscribe: 1, req_id: requestId }));
    }
    this.scanTimer = setTimeout(() => this.finishScan(generation), SCAN_SECONDS * 1_000); this.scanTimer.unref();
    this.emit(); return this.state();
  }

  /** Focus consumes the selected scan series then drops every other market feed. */
  focus(symbol: string): MomentumState {
    if (!this.running || this.phase !== 'scanning') throw new Error('market focus is only available while the watchboard is scanning');
    const seed = this.scanTicks.get(symbol);
    if (!seed?.length) throw new Error('wait for at least one live tick before focusing this market');
    if (!this.markets.some((market) => market.symbol === symbol)) throw new Error('unknown momentum market');
    return this.begin({ symbol, ...AUTOMATIC_CONFIG }, seed);
  }

  stop(): MomentumState { this.generation += 1; this.running = false; this.phase = 'stopped'; this.stopSubscription(); this.emit(); return this.state(); }

  private stopSubscription(): void {
    if (this.scanTimer) clearTimeout(this.scanTimer);
    this.scanTimer = null; this.scanStartedAt = 0; this.scanTicks.clear(); this.scanRequests.clear();
    if (this.ws && this.tickReq) this.ws.send(JSON.stringify({ forget_all: 'ticks', req_id: this.req++ }));
    else if (this.ws) this.ws.send(JSON.stringify({ forget_all: 'ticks', req_id: this.req++ }));
    this.tickReq = 0;
  }

  private onScanTick(symbol: string, quote: number, epoch: number): void {
    const ticks = this.scanTicks.get(symbol);
    if (!ticks || !Number.isFinite(quote) || !Number.isFinite(epoch)) return;
    ticks.push({ quote, epoch });
    const earliest = epoch - 70;
    while (ticks[0] && ticks[0]!.epoch < earliest) ticks.shift();
    while (ticks.length > 2_000) ticks.shift();
    this.emit();
  }

  private finishScan(generation: number): void {
    if (generation !== this.generation || !this.running || this.phase !== 'scanning') return;
    const now = Math.floor(Date.now() / 1000);
    const ranked = [...this.scanTicks.entries()].map(([symbol, ticks]) => ({ symbol, signal: momentumSignal(ticks, now) }))
      .filter((item) => item.signal.direction !== 'wait')
      .sort((a, b) => (b.signal.confidence * Math.abs(b.signal.score)) - (a.signal.confidence * Math.abs(a.signal.score)));
    const selected = ranked[0]?.symbol;
    if (!selected) { this.running = false; this.phase = 'error'; this.reason = 'No market formed aligned 15/30/60-second evidence during the scan'; this.stopSubscription(); this.emit(); return; }
    this.begin({ symbol: selected, ...AUTOMATIC_CONFIG }, this.scanTicks.get(selected) ?? []);
  }

  private async verifyMultiplierMarkets(markets: MomentumMarket[], generation: number): Promise<MomentumMarket[]> {
    const verified: MomentumMarket[] = [];
    for (const market of markets) {
      if (generation !== this.generation || verified.length >= MAX_SCAN_MARKETS) break;
      const cached = this.multiplierSupport.get(market.symbol);
      let supported = cached && Date.now() - cached.checkedAt < MULTIPLIER_SUPPORT_CACHE_MS
        ? cached.supported
        : null;
      if (supported == null) {
        try {
          supported = await this.checkMultiplierSupport(market.symbol, generation);
          if (generation !== this.generation) break;
          this.multiplierSupport.set(market.symbol, { checkedAt: Date.now(), supported });
        } catch {
          // A transient feed/rate-limit error is unknown, not proof that this
          // market lacks multiplier contracts. It remains eligible next scan.
          continue;
        }
      }
      if (supported) verified.push(market);
    }
    return verified;
  }

  private async checkMultiplierSupport(symbol: string, generation: number): Promise<boolean> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await this.paceContractCheck();
      try {
        const contracts = await this.request({ contracts_for: symbol });
        return supportsBothMultiplierDirections((contracts.contracts_for?.available ?? []) as ContractAvailability[]);
      } catch (error) {
        if (generation !== this.generation || attempt > 0 || !/rate limit/i.test(String(error))) throw error;
        await delay(CONTRACT_CHECK_RETRY_MS);
      }
    }
    return false;
  }

  private async paceContractCheck(): Promise<void> {
    const wait = this.nextContractCheckAt - Date.now();
    if (wait > 0) await delay(wait);
    this.nextContractCheckAt = Date.now() + CONTRACT_CHECK_INTERVAL_MS;
  }

  private request(payload: Record<string, unknown>): Promise<Record<string, any>> {
    const requestId = this.req++;
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) { reject(new Error('real-market feed is not connected')); return; }
      const timer = setTimeout(() => { this.pending.delete(requestId); reject(new Error('Deriv contract check timed out')); }, 12_000);
      this.pending.set(requestId, { resolve, reject, timer });
      this.ws.send(JSON.stringify({ ...payload, req_id: requestId }));
    });
  }

  private onTick(quote: number, epoch: number): void {
    if (!this.running || !this.config || !Number.isFinite(quote) || !Number.isFinite(epoch)) return;
    this.ticks.push({ quote, epoch }); if (this.ticks.length > MAX_TICKS) this.ticks.shift();
    if (!this.window) this.window = this.newWindow(quote, epoch);
    else {
      this.window.samples.push({ quote, epoch });
      while (this.window.samples.length > MAX_TICKS) this.window.samples.shift();
    }
    if (epoch >= this.window.endsAt) {
      this.completeWindow(quote);
      this.running = false; this.phase = 'connecting'; this.reason = 'Re-scanning for the strongest next five-minute opportunity'; this.emit();
      void this.startAutomatic().catch((error) => { this.phase = 'error'; this.reason = String(error); this.emit(); });
      return;
    }
    const elapsed = epoch - this.window.startedAt;
    const signal = momentumSignal(this.ticks, epoch);
    this.window.currentPrice = quote; this.window.changePct = pct(this.window.openPrice, quote); this.window.signal = signal;
    if (!this.window.direction && elapsed >= DECISION_AFTER_SECONDS && signal.direction !== 'wait') {
      this.window.direction = signal.direction; this.window.decisionAt = epoch; this.window.decisionPrice = quote; this.window.decisionSignal = signal; this.signalledWindows += 1;
    }
    if (this.window.direction && this.window.decisionPrice) {
      const signedMove = pct(this.window.decisionPrice, quote) * (this.window.direction === 'up' ? 1 : -1);
      this.window.estimatedGross = signedMove * this.config.multiplier * this.config.stake;
      this.window.estimatedCommission = this.config.stake * this.config.multiplier * this.config.commissionRate;
      this.window.estimatedNet = this.window.estimatedGross - this.window.estimatedCommission;
    }
    this.emit();
  }

  private newWindow(quote: number, epoch: number): MomentumWindow {
    return { startedAt: epoch, endsAt: epoch + WINDOW_SECONDS, openPrice: quote, currentPrice: quote, changePct: 0,
      decisionAt: null, decisionPrice: null, direction: null, signal: momentumSignal(this.ticks, epoch), decisionSignal: null,
      samples: [{ quote, epoch }], estimatedGross: 0, estimatedCommission: 0, estimatedNet: 0 };
  }

  private completeWindow(exitPrice: number): void {
    if (!this.window) return;
    this.completedWindows += 1;
    if (this.window.direction && this.window.decisionPrice != null) {
      const won = this.window.direction === 'up' ? exitPrice > this.window.decisionPrice : exitPrice < this.window.decisionPrice;
      if (won) this.wins += 1; else this.losses += 1;
      this.estimatedNet += this.window.estimatedNet;
      this.lastOutcome = { direction: this.window.direction, openPrice: this.window.openPrice, decisionPrice: this.window.decisionPrice, exitPrice, won, estimatedNet: this.window.estimatedNet };
      const signal = this.window.decisionSignal ?? this.window.signal;
      const market = this.markets.find((item) => item.symbol === this.config?.symbol);
      try {
        insertMomentumResearch({
          completed_at: Date.now(), symbol: this.config?.symbol ?? 'unknown', market: market?.market ?? 'unknown',
          direction: this.window.direction, confidence: signal.confidence, score: signal.score,
          return_15s: signal.return15s, return_30s: signal.return30s, return_60s: signal.return60s,
          open_price: this.window.openPrice, decision_price: this.window.decisionPrice, exit_price: exitPrice,
          multiplier: this.config?.multiplier ?? 0, stake: this.config?.stake ?? 0,
          commission_rate: this.config?.commissionRate ?? 0, estimated_net: this.window.estimatedNet, won: won ? 1 : 0,
        });
        this.research = getMomentumResearchSummary();
      } catch (error) {
        console.warn(`[momentum] failed to persist research window: ${String(error)}`);
      }
    }
  }

  private emit(): void {
    const now = Date.now();
    const wait = UI_EMIT_INTERVAL_MS - (now - this.lastEmitAt);
    if (wait <= 0) {
      this.publish();
      return;
    }
    if (!this.emitTimer) this.emitTimer = setTimeout(() => this.publish(), wait);
  }

  private publish(): void {
    if (this.emitTimer) clearTimeout(this.emitTimer);
    this.emitTimer = null;
    this.lastEmitAt = Date.now();
    this.hub.emit({ type: 'momentum', ts: this.lastEmitAt, state: this.state() });
  }
}

/** Build a bounded, cross-market discovery set instead of consuming crypto first. */
export function momentumVerificationPool(markets: MomentumMarket[], limit = MAX_DISCOVERY_MARKETS): MomentumMarket[] {
  const groups = new Map<string, MomentumMarket[]>();
  for (const market of markets) {
    const group = groups.get(market.market) ?? [];
    group.push(market);
    groups.set(market.market, group);
  }
  const pool: MomentumMarket[] = [];
  for (let index = 0; pool.length < limit; index += 1) {
    let added = false;
    for (const group of groups.values()) {
      const market = group[index];
      if (!market) continue;
      pool.push(market);
      added = true;
      if (pool.length >= limit) break;
    }
    if (!added) break;
  }
  return pool;
}
