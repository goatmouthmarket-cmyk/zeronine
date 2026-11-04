import { Worker } from 'node:worker_threads';
import type { AutomationEvent } from '../api/hub.ts';

type Fields = Record<string, string | number | boolean | null>;
export interface TelemetryEvent { observedAt: number; type: string; market: string | null; source: string; data: Fields }
type PendingQuery = { resolve: (rows: unknown[]) => void; reject: (error: Error) => void; timer: NodeJS.Timeout };

const obj = (value: unknown): Record<string, unknown> => value && typeof value === 'object' ? value as Record<string, unknown> : {};
const str = (value: unknown): string | null => typeof value === 'string' ? value.slice(0, 120) : null;
const num = (value: unknown): number | null => typeof value === 'number' && Number.isFinite(value) ? value : null;
const bool = (value: unknown): boolean | null => typeof value === 'boolean' ? value : null;

/** Explicit field selection prevents account credentials or arbitrary payloads entering research telemetry. */
export function telemetryFromHub(event: AutomationEvent): TelemetryEvent[] {
  const time = num(event.ts) ?? Date.now();
  const make = (type: string, market: unknown, source: string, data: Fields): TelemetryEvent => ({ observedAt: time, type, market: str(market), source, data });
  if (event.type === 'tick') return [make('tick', event.symbol, 'public_feed', { epoch: num(event.epoch), quote: num(event.quote), digit: num(event.digit), fresh: bool(event.fresh) })];
  if (event.type === 'intelligence') {
    const markets = Array.isArray(event.markets) ? event.markets.slice(0, 64) : [];
    return markets.map((raw) => {
      const market = obj(raw), health = obj(market.health), regime = obj(market.regime);
      return make('market_intelligence', market.symbol, 'scanner', { healthScore: num(health.score), healthLabel: str(health.label), healthTrend: str(health.trend), regime: str(regime.regime), regimeConfidence: num(regime.confidence), regimeSince: num(regime.since) });
    });
  }
  if (event.type === 'signal') {
    const signal = obj(event.signal);
    const candidates = Array.isArray(signal.candidates) ? signal.candidates.slice(0, 64) : [];
    return candidates.map((raw) => {
      const c = obj(raw);
      return make('signal_candidate', c.market, 'scanner', { direction: str(c.direction), barrier: num(c.barrier), estWin: num(c.estWin), baseWin: num(c.baseWin), edge: num(c.edge), expectedROI: num(c.expectedROI), estPayout: num(c.estPayout), consistency: num(c.consistency), entropy: num(c.entropy), momentum: num(c.momentum), transitionProb: num(c.transitionProb), holds: bool(signal.holds) });
    });
  }
  if (event.type === 'quote') return [make('quote', event.market, 'scanner', { direction: str(event.direction), barrier: num(event.barrier), ask: num(event.ask), payout: num(event.payout), estWin: num(event.estWin), edge: num(event.realEdge) })];
  if (event.type === 'decision') {
    const decision = obj(event.decision);
    return [make('decision', decision.market, 'automation', { direction: str(decision.direction), barrier: num(decision.barrier), stake: num(decision.stake), estWin: num(decision.estWin), edge: num(decision.edge), streak: num(event.streak) })];
  }
  if (event.type === 'paper_simulation') {
    const c = obj(event.contract);
    return [make('paper_' + (str(event.event) ?? 'unknown'), c.market, 'virtual_scout', { runId: str(c.runId), contractId: num(c.id), direction: str(c.direction), barrier: num(c.barrier), status: str(c.status), entryDigit: num(c.entryDigit), exitDigit: num(c.exitDigit), entryEpoch: num(c.entryEpoch), exitEpoch: num(c.exitEpoch), entryQuote: num(c.entryQuote), exitQuote: num(c.exitQuote), payoutRatio: num(c.payoutRatio), estWin: num(c.estWin), edge: num(c.edge), profit: num(c.profit) })];
  }
  if (event.type === 'trade') {
    const t = obj(event.trade);
    return [make('account_trade', t.market, 'account', { tradeId: num(t.id), accountMode: str(t.account_mode), origin: str(t.origin), contractType: str(t.contract_type), barrier: num(t.barrier), status: str(t.status), stake: num(t.stake), profit: num(t.profit), entrySpot: num(t.entry_spot), exitDigit: num(t.exit_digit), settled: bool(event.settled) })];
  }
  if (event.type === 'feed') {
    const status = obj(event.status);
    return [make('feed', null, 'public_feed', { connected: bool(status.connected), pingMs: num(status.pingMs) })];
  }
  if (event.type === 'testlab') return [make('research_progress', null, 'historical_replay', { kind: str(event.kind), phase: str(event.phase), done: num(event.done), total: num(event.total), tradesDone: num(event.tradesDone), tradesTarget: num(event.tradesTarget) })];
  return [];
}

export class TelemetryService {
  private worker: Worker | null = null;
  private ready = false;
  private busy = false;
  private inFlight = 0;
  private queue: TelemetryEvent[] = [];
  private queries = new Map<number, PendingQuery>();
  private nextQuery = 0;
  private timer: NodeJS.Timeout | null = null;
  private written = 0;
  private dropped = 0;
  private failures = 0;
  private state: 'disabled' | 'starting' | 'running' | 'failed';

  constructor(path: string, retentionDays: number, enabled = true) {
    this.state = enabled ? 'starting' : 'disabled';
    if (!enabled) return;
    try {
      this.worker = new Worker(new URL('./worker.mjs', import.meta.url), { workerData: { path, retentionDays } });
      this.worker.on('message', (message: Record<string, unknown>) => this.onMessage(message));
      this.worker.on('error', () => this.fail());
      this.worker.on('exit', (code) => { if (code !== 0 || this.state === 'starting' || this.state === 'running') this.fail(); });
      this.timer = setInterval(() => this.flush(), 500);
      this.timer.unref();
    } catch { this.fail(); }
  }

  private fail(): void {
    if (this.state === 'failed') return;
    this.state = 'failed'; this.ready = false; this.failures++; this.dropped += this.queue.length + this.inFlight; this.inFlight = 0; this.queue = [];
    if (this.timer) clearInterval(this.timer);
    for (const query of this.queries.values()) { clearTimeout(query.timer); query.reject(new Error('Telemetry unavailable')); }
    this.queries.clear();
  }

  private onMessage(message: Record<string, unknown>): void {
    if (message.type === 'ready') { this.ready = true; this.state = 'running'; this.flush(); }
    else if (message.type === 'written' || message.type === 'failed') {
      this.busy = false;
      this.inFlight = 0;
      if (message.type === 'written') this.written += Number(message.count) || 0;
      else { this.failures++; this.dropped += Number(message.count) || 0; }
      this.flush();
    } else if (message.type === 'startup-failed') this.fail();
    else if (message.type === 'query-result') {
      const id = Number(message.requestId), pending = this.queries.get(id);
      if (!pending) return;
      this.queries.delete(id); clearTimeout(pending.timer);
      if (message.error) pending.reject(new Error('Telemetry query failed'));
      else pending.resolve(Array.isArray(message.rows) ? message.rows : []);
    }
  }

  record(event: AutomationEvent): void {
    if (this.state === 'disabled' || this.state === 'failed') return;
    try {
      for (const item of telemetryFromHub(event)) this.recordResearch(item);
    } catch { this.failures++; }
  }

  recordResearch(item: TelemetryEvent): void {
    if (this.state === 'disabled' || this.state === 'failed') return;
    if (this.queue.length >= 5000) { this.dropped++; return; }
    this.queue.push(item);
    if (this.queue.length >= 200) this.flush();
  }

  private flush(): void {
    if (!this.worker || !this.ready || this.busy || !this.queue.length) return;
    const events = this.queue.splice(0, 200);
    this.busy = true; this.inFlight = events.length;
    try { this.worker.postMessage({ type: 'batch', events }); } catch { this.busy = false; this.fail(); }
  }

  status(): { state: string; queued: number; written: number; dropped: number; failures: number } {
    return { state: this.state, queued: this.queue.length + this.inFlight, written: this.written, dropped: this.dropped, failures: this.failures };
  }

  async query(after: number, limit: number): Promise<unknown[]> {
    if (!this.worker || !this.ready) throw new Error('Telemetry unavailable');
    if (this.queries.size >= 4) throw new Error('Too many telemetry queries');
    return new Promise((resolve, reject) => {
      const requestId = ++this.nextQuery;
      const timer = setTimeout(() => { this.queries.delete(requestId); reject(new Error('Telemetry query timed out')); }, 5000);
      this.queries.set(requestId, { resolve, reject, timer });
      try { this.worker!.postMessage({ type: 'query', requestId, after, limit }); }
      catch { clearTimeout(timer); this.queries.delete(requestId); reject(new Error('Telemetry unavailable')); }
    });
  }

  async close(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    const worker = this.worker;
    if (!worker) return;
    const deadline = Date.now() + 2000;
    while ((this.queue.length || this.busy) && this.ready && Date.now() < deadline) {
      this.flush(); await new Promise((resolve) => setTimeout(resolve, 20));
    }
    this.dropped += this.queue.length + this.inFlight; this.inFlight = 0; this.queue = [];
    this.state = 'disabled'; this.ready = false;
    await worker.terminate();
    this.worker = null;
  }
}
