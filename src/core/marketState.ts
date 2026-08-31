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
  recentTicks: Array<{ epoch: number; quote: number }>;
  dist: number[];
}

export interface FeedCallbacks {
  onTick: (snapshot: MarketSnapshot) => void;
}

const RECENT_WINDOW = 60;

export class MarketRegistry {
  private buffers = new Map<string, Array<{ quote: number; epoch: number; digit: number }>>();
  private displays = new Map<string, string>();
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
  }

  push(symbol: string, quote: number, epoch: number, digit: number): void {
    const buf = this.buffers.get(symbol);
    if (!buf) return;
    buf.push({ quote, epoch, digit });
    if (buf.length > RECENT_WINDOW) buf.shift();
    this.cb.onTick(this.snapshot(symbol));
  }

  seed(symbol: string, ticks: Array<{ quote: number; epoch: number; digit: number }>): void {
    if (!this.buffers.has(symbol) || ticks.length === 0) return;
    const clean = ticks.filter((tick) => Number.isFinite(tick.quote) && Number.isFinite(tick.epoch)).sort((a, b) => a.epoch - b.epoch);
    this.buffers.set(symbol, clean.slice(-RECENT_WINDOW));
    this.cb.onTick(this.snapshot(symbol));
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
      recentTicks: buf.slice(-60).map((t) => ({ epoch: t.epoch, quote: t.quote })),
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
