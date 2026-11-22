import { randomUUID } from 'node:crypto';
import { getPrecision } from './digitMath.ts';
export interface MarketSnapshot {
  symbol: string;
  display: string;
  lastQuote: number;
  lastEpoch: number;
  lastDigit: number;
  fresh: boolean;
  ticksPerMin: number;
  recentDigits: number[];
  recentQuotes: number[];
  recentTicks: Array<{ epoch: number; quote: number; digit: number }>;
  dist: number[];
}

export interface FeedCallbacks {
  onTick: (snapshot: MarketSnapshot) => void;
}

const RECENT_WINDOW = 60;
// Additional in-memory history is reserved for trade replay and never enters signal math.
const CAPTURE_WINDOW = 1000;

export class MarketRegistry {
  private readonly segment = randomUUID();
  private readonly segments = new Map<string,string>();
  private readonly sequences = new Map<string, number>();
  private buffers = new Map<string, Array<{ quote: number; epoch: number; digit: number; sequence?: number; segment?: string }>>();
  private displays = new Map<string, string>();
  private captureBuffers = new Map<string, Array<{ quote: number; epoch: number; digit: number; sequence?: number; segment?: string }>>();
  private cb: FeedCallbacks;

  constructor(cb: FeedCallbacks) {
    this.cb = cb;
  }

  setDisplay(symbol: string, display: string): void {
    this.displays.set(symbol, display);
  }

  has(symbol: string): boolean {
    return this.buffers.has(symbol);
  }

  ensure(symbol: string): void {
    if (!this.buffers.has(symbol)) this.buffers.set(symbol, []);
    if (!this.captureBuffers.has(symbol)) this.captureBuffers.set(symbol, []);
  }

  push(symbol: string, quote: number, epoch: number, digit: number): void {
    const sequence = (this.sequences.get(symbol) ?? 0) + 1;
    this.sequences.set(symbol, sequence);
    const buf = this.buffers.get(symbol);
    if (!buf) return;
    buf.push({ quote, epoch, digit });
    const capture = this.captureBuffers.get(symbol);
    const previous=capture?.[capture.length-1];
    if(!this.segments.has(symbol)||(previous&&(epoch<previous.epoch||epoch-previous.epoch>15)))this.segments.set(symbol,randomUUID());
    if (capture) { capture.push({ quote, epoch, digit, sequence, segment: this.segments.get(symbol)||this.segment }); if (capture.length > CAPTURE_WINDOW) capture.shift(); }
    if (buf.length > RECENT_WINDOW) buf.shift();
    this.cb.onTick(this.snapshot(symbol));
  }

  seed(symbol: string, ticks: Array<{ quote: number; epoch: number; digit: number }>): void {
    if (!this.buffers.has(symbol) || ticks.length === 0) return;
    const clean = ticks.filter((tick) => Number.isFinite(tick.quote) && Number.isFinite(tick.epoch)).sort((a, b) => a.epoch - b.epoch);
    this.buffers.set(symbol, clean.slice(-RECENT_WINDOW));
    // Preserve live ticks that arrived while history was being requested.
    // Same-second history is excluded because arrival ordering is ambiguous.
    const live = this.captureBuffers.get(symbol) ?? [];
    const older = live.length ? clean.filter(tick => tick.epoch < live[0].epoch) : clean;
    this.captureBuffers.set(symbol, [...older, ...live].slice(-CAPTURE_WINDOW));
    this.cb.onTick(this.snapshot(symbol));
  }

  captureTicks(symbol: string): Array<{ epoch: number; quote: number; digit: number; sequence?: number; segment?: string }> {
    return (this.captureBuffers.get(symbol) ?? []).map(tick => ({ ...tick }));
  }

  coreMarkets() {
    return this.allSnapshots().map(market => ({ symbol:market.symbol, display:market.display, fresh:market.fresh, precision:getPrecision(market.symbol), recentTicks:this.captureTicks(market.symbol).filter(tick=>tick.sequence!==undefined) }));
  }

  snapshot(symbol: string): MarketSnapshot {
    const buf = this.buffers.get(symbol) ?? [];
    const last = buf[buf.length - 1];
    const now = Date.now() / 1000;
    const fresh = last ? now - last.epoch < 15 : false;
    const windowStart = last ? last.epoch - 60 : 0;
    const recentWindow = buf.filter((t) => t.epoch >= windowStart);
    const dist = Array.from({ length: 10 }, () => 0);
    for (const t of buf) dist[t.digit]++;
    return {
      symbol,
      display: this.displays.get(symbol) ?? symbol,
      lastQuote: last?.quote ?? 0,
      lastEpoch: last?.epoch ?? 0,
      lastDigit: last?.digit ?? -1,
      fresh,
      ticksPerMin: recentWindow.length,
      recentDigits: buf.slice(-60).map((t) => t.digit),
      recentQuotes: buf.slice(-40).map((t) => t.quote),
      recentTicks: buf.slice(-60).map((t) => ({ epoch: t.epoch, quote: t.quote, digit: t.digit })),
      dist,
    };
  }

  symbols(): string[] {
    return [...this.buffers.keys()];
  }

  allSnapshots(): MarketSnapshot[] {
    return this.symbols().map((s) => this.snapshot(s));
  }
}

