import WebSocket from 'ws';
import { config } from '../config.ts';
import { ping } from '../core/digitMath.ts';
import { GOLD_TIMEFRAME_MS, type GoldCandle, type GoldSymbol, type GoldTimeframe } from './domain.ts';
import type { GoldRuntime } from './runtime.ts';

interface GoldTick {
  quote: number;
  epochMs: number;
}

const GOLD_TIMEFRAMES: GoldTimeframe[] = ['1m', '5m'];
const HISTORY_COUNT = 2500;
const MAX_TICKS = 6000;
const PING_INTERVAL_MS = 30_000;
const BACKOFF_BASE_MS = 1_000;
const BACKOFF_MAX_MS = 30_000;

function goldSymbol(): GoldSymbol {
  return {
    id: config.goldDerivSymbol,
    name: config.goldDerivSymbol,
    displayName: config.goldDerivDisplay,
    digits: 2,
    pointSize: 0.01,
    pipSize: 0.01,
    minVolume: 0.35,
    maxVolume: 10_000,
    volumeStep: 0.01,
    minStopDistance: 0,
    marginRate: null,
    tradingStatus: 'open',
    sessions: [],
  };
}

function uniqueSortedTicks(ticks: GoldTick[]): GoldTick[] {
  const byEpoch = new Map<number, GoldTick>();
  for (const tick of ticks) {
    if (Number.isFinite(tick.quote) && tick.quote > 0 && Number.isFinite(tick.epochMs)) byEpoch.set(tick.epochMs, tick);
  }
  return [...byEpoch.values()].sort((left, right) => left.epochMs - right.epochMs).slice(-MAX_TICKS);
}

function candlesFromTicks(symbolId: string, timeframe: GoldTimeframe, ticks: GoldTick[], now = Date.now()): GoldCandle[] {
  const interval = GOLD_TIMEFRAME_MS[timeframe];
  const buckets = new Map<number, GoldCandle>();
  for (const tick of ticks) {
    const openTime = Math.floor(tick.epochMs / interval) * interval;
    const existing = buckets.get(openTime);
    if (!existing) {
      buckets.set(openTime, {
        symbolId,
        timeframe,
        openTime,
        closeTime: openTime + interval,
        open: tick.quote,
        high: tick.quote,
        low: tick.quote,
        close: tick.quote,
        tickVolume: 1,
        complete: openTime + interval <= now,
      });
      continue;
    }
    existing.high = Math.max(existing.high, tick.quote);
    existing.low = Math.min(existing.low, tick.quote);
    existing.close = tick.quote;
    existing.tickVolume = (existing.tickVolume ?? 0) + 1;
    existing.complete = existing.closeTime <= now;
  }
  return [...buckets.values()].sort((left, right) => left.openTime - right.openTime).slice(-500);
}

export class DerivGoldFeed {
  private readonly runtime: GoldRuntime;
  private ws: WebSocket | null = null;
  private req = 1;
  private historyReq = 0;
  private tickReq = 0;
  private sequence = 0;
  private ticks: GoldTick[] = [];
  private pingTimer: NodeJS.Timeout | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private reconnectAttempt = 0;
  private stopped = false;
  private lastMessageAt = 0;

  constructor(runtime: GoldRuntime) {
    this.runtime = runtime;
  }

  start(): void {
    this.stopped = false;
    this.runtime.setSymbol(goldSymbol());
    this.ensureSocket();
  }

  stop(): void {
    this.stopped = true;
    this.clearTimers();
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        // ignore
      }
      this.ws = null;
    }
  }

  private nextReqId(): number {
    return this.req++;
  }

  private ensureSocket(): void {
    if (this.ws) return;
    const ws = new WebSocket(config.derivPublicUrl, {
      perMessageDeflate: false,
      handshakeTimeout: 15_000,
    });
    this.ws = ws;

    ws.on('open', () => {
      this.reconnectAttempt = 0;
      this.lastMessageAt = Date.now();
      this.subscribe();
      this.startPing();
    });
    ws.on('message', (raw) => {
      this.lastMessageAt = Date.now();
      try {
        this.handleMessage(JSON.parse(raw.toString()));
      } catch (error) {
        console.warn(`[gold-deriv] malformed frame ignored: ${String(error)}`);
      }
    });
    ws.on('error', (error) => {
      console.warn(`[gold-deriv] socket error: ${error.message}`);
    });
    ws.on('close', () => {
      this.ws = null;
      this.clearTimers();
      this.scheduleReconnect();
    });
  }

  private subscribe(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.historyReq = this.nextReqId();
    this.tickReq = this.nextReqId();
    this.ws.send(JSON.stringify({
      ticks_history: config.goldDerivSymbol,
      style: 'ticks',
      count: HISTORY_COUNT,
      end: 'latest',
      req_id: this.historyReq,
    }));
    this.ws.send(JSON.stringify({ ticks: config.goldDerivSymbol, subscribe: 1, req_id: this.tickReq }));
  }

  private handleMessage(msg: Record<string, any>): void {
    if (msg.msg_type === 'ping') return;
    const reqId = Number(msg.req_id);
    if (msg.error) {
      if (reqId === this.historyReq || reqId === this.tickReq) {
        console.warn(`[gold-deriv] ${config.goldDerivSymbol} feed rejected: ${msg.error.message ?? msg.error.code ?? 'unknown error'}`);
      }
      return;
    }
    if (msg.msg_type === 'history' && reqId === this.historyReq) {
      const prices = Array.isArray(msg.history?.prices) ? msg.history.prices : [];
      const times = Array.isArray(msg.history?.times) ? msg.history.times : [];
      const next = prices.map((rawPrice: unknown, index: number) => ({
        quote: Number(rawPrice),
        epochMs: Number(times[index]) * 1000,
      }));
      this.ticks = uniqueSortedTicks([...this.ticks, ...next]);
      this.publish();
      return;
    }
    if (msg.msg_type === 'tick' && reqId === this.tickReq) {
      const quote = Number(msg.tick?.quote);
      const epochMs = Number(msg.tick?.epoch ?? Math.floor(Date.now() / 1000)) * 1000;
      this.ticks = uniqueSortedTicks([...this.ticks, { quote, epochMs }]);
      this.publish();
    }
  }

  private publish(): void {
    const symbolId = config.goldDerivSymbol;
    const latest = this.ticks.at(-1);
    if (!latest) return;
    for (const timeframe of GOLD_TIMEFRAMES) {
      this.runtime.replaceCandles(timeframe, candlesFromTicks(symbolId, timeframe, this.ticks));
    }
    this.runtime.ingestQuote({
      symbolId,
      bid: latest.quote,
      ask: latest.quote,
      timestamp: latest.epochMs,
      receivedAt: Date.now(),
      sequence: ++this.sequence,
    });
  }

  private startPing(): void {
    this.clearTimers();
    this.pingTimer = setInterval(() => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
      if (Date.now() - this.lastMessageAt > PING_INTERVAL_MS * 2) {
        console.warn('[gold-deriv] no inbound data for 60s; reconnecting stale feed');
        this.ws.close();
        return;
      }
      try {
        this.ws.send(JSON.stringify(ping()));
      } catch {
        // socket closing
      }
    }, PING_INTERVAL_MS);
  }

  private clearTimers(): void {
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  private scheduleReconnect(): void {
    if (this.stopped) return;
    this.reconnectAttempt += 1;
    const delay = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** Math.min(8, this.reconnectAttempt - 1));
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.ensureSocket();
    }, delay);
  }
}
