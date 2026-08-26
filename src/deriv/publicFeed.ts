import WebSocket from 'ws';
import { config } from '../config.ts';
import { upsertMarket } from '../db/store.ts';
import type { MarketRegistry } from '../core/marketState.ts';
import { contractsFor, getPrecision, lastDigitOf, ping, setPrecision, subscribeTicks, ticksHistory } from '../core/digitMath.ts';

export interface DiscoveredMarket {
  symbol: string;
  display: string;
}

export interface FeedStatus {
  connected: boolean;
  since: number;
  symbols: string[];
}

const PING_INTERVAL_MS = 30000;
const BACKOFF_BASE_MS = 1000;
const BACKOFF_MAX_MS = 30000;

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void; type: string; timeout: NodeJS.Timeout };

export class DerivPublicFeed {
  private ws: WebSocket | null = null;
  private reqCounter = 1;
  private subSymbols = new Map<number, string>();
  private histSymbols = new Map<number, string>();
  private pending = new Map<number, Pending>();
  private discovered = new Map<string, DiscoveredMarket>();
  private connectedAt = 0;
  private reconnectAttempt = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private pingTimer: NodeJS.Timeout | null = null;
  private lastMessageAt = 0;
  private stopped = false;

  private registry: MarketRegistry;
  private onStatus: (status: FeedStatus) => void;

  constructor(registry: MarketRegistry, onStatus: (status: FeedStatus) => void) {
    this.registry = registry;
    this.onStatus = onStatus;
  }

  private nextReqId(): number {
    return this.reqCounter++;
  }

  async connect(): Promise<void> {
    this.stopped = false;
    this.ensureSocket();
    try {
      await this.waitForConnect();
    } catch (err) {
      console.error(`[feed] connect failed: ${err}`);
      this.scheduleReconnect();
    }
  }

  status(): FeedStatus {
    return {
      connected: !!this.ws && this.ws.readyState === WebSocket.OPEN,
      since: this.connectedAt,
      symbols: this.subSymbols.size ? [...this.subSymbols.values()] : this.registry.symbols(),
    };
  }

  private ensureSocket(): void {
    if (this.ws) return;
    const ws = new WebSocket(config.derivPublicUrl, {
      perMessageDeflate: false,
      handshakeTimeout: 15000,
    });
    this.ws = ws;

    ws.on('open', () => {
      void this.afterOpen();
    });

    ws.on('message', (raw) => {
      this.lastMessageAt = Date.now();
      try {
        this.handleMessage(JSON.parse(raw.toString()));
      } catch (err) {
        console.error(`[feed] message parse error: ${err}`);
      }
    });

    ws.on('error', (err) => {
      console.error(`[feed] socket error: ${err.message}`);
    });

    ws.on('close', () => {
      this.clearTimers();
      this.subSymbols.clear();
      this.histSymbols.clear();
      this.onStatus(this.status());
      this.scheduleReconnect();
    });
  }

  private async afterOpen(): Promise<void> {
    try {
      this.connectedAt = Date.now();
      this.lastMessageAt = Date.now();
      this.reconnectAttempt = 0;
      await this.discoverMarkets();
      this.subscribeAll();
      this.startPing();
      this.onStatus(this.status());
    } catch (err) {
      console.error(`[feed] open/refresh failed: ${err}`);
      this.scheduleReconnect();
    }
  }

  private handleMessage(msg: Record<string, any>): void {
    if (msg.msg_type === 'ping') return;
    const reqId = msg.req_id as number | undefined;

    if (msg.msg_type === 'history' && reqId !== undefined && this.histSymbols.has(reqId)) {
      const symbol = this.histSymbols.get(reqId)!;
      this.histSymbols.delete(reqId);
      if (typeof msg.pip_size === 'number') setPrecision(symbol, msg.pip_size);
      return;
    }

    if (msg.msg_type === 'tick' && reqId !== undefined && this.subSymbols.has(reqId)) {
      const symbol = this.subSymbols.get(reqId)!;
      const tick = msg.tick;
      if (tick && typeof tick.quote === 'number') {
        const epoch = typeof tick.epoch === 'number' ? tick.epoch : Math.floor(Date.now() / 1000);
        this.registry.push(symbol, tick.quote, epoch, lastDigitOf(tick.quote, getPrecision(symbol)));
      }
      return;
    }

    if (msg.error && reqId !== undefined && this.pending.has(reqId)) {
      const p = this.pending.get(reqId)!;
      this.pending.delete(reqId);
      clearTimeout(p.timeout);
      p.reject(new Error(`${p.type}: ${msg.error.message ?? 'unknown error'}`));
      return;
    }

    if (reqId !== undefined && this.pending.has(reqId)) {
      const p = this.pending.get(reqId)!;
      this.pending.delete(reqId);
      clearTimeout(p.timeout);
      p.resolve(msg);
    }
  }

  private async discoverMarkets(): Promise<void> {
    const resp = (await this.request({ active_symbols: 'brief' }, 'active_symbols')) as any;
    const symbols: Array<{
      underlying_symbol: string;
      underlying_symbol_name: string;
      market: string;
      exchange_is_open: number;
      is_trading_suspended: number;
    }> = resp?.active_symbols ?? [];

    const candidates = symbols.filter(
      (s) =>
        s.market === 'synthetic_index' &&
        s.exchange_is_open === 1 &&
        s.is_trading_suspended === 0 &&
        /^\d+/.test(s.underlying_symbol),
    );
    const preferred = new Set<string>(config.allowedMarkets);

    for (const s of candidates) {
      const symbol = s.underlying_symbol;
      if (preferred.size > 0 && !preferred.has(symbol)) continue;
      try {
        const cf = (await this.request({ contracts_for: symbol }, 'contracts_for')) as any;
        const available = (cf?.contracts_for?.available ?? []) as Array<{ contract_type: string }>;
        const hasOver = available.some((c) => c.contract_type === 'DIGITOVER');
        const hasUnder = available.some((c) => c.contract_type === 'DIGITUNDER');
        if (hasOver && hasUnder) {
          this.discovered.set(symbol, { symbol, display: s.underlying_symbol_name });
          this.registry.ensure(symbol);
          this.registry.setDisplay(symbol, s.underlying_symbol_name);
          upsertMarket(symbol, s.underlying_symbol_name);
        }
      } catch (err) {
        console.error(`[feed] skip ${symbol}: ${err}`);
      }
    }
    console.info(`[feed] discovered ${this.discovered.size} Over/Under markets`);
  }

  private request(payload: Record<string, unknown>, type: string): Promise<unknown> {
    const reqId = this.nextReqId();
    const msg = { ...payload, req_id: reqId };
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        reject(new Error('socket not open'));
        return;
      }
      const timeout = setTimeout(() => {
        this.pending.delete(reqId);
        reject(new Error(`${type} request timeout`));
      }, 12000);
      this.pending.set(reqId, { resolve, reject, type, timeout });
      this.ws.send(JSON.stringify(msg));
    });
  }

  private subscribeAll(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    for (const [symbol] of this.discovered) {
      this.subscribeSymbol(symbol);
    }
  }

  private subscribeSymbol(symbol: string): void {
    if (!this.ws) return;
    const histReq = this.nextReqId();
    const subReq = this.nextReqId();
    this.subSymbols.set(subReq, symbol);
    this.histSymbols.set(histReq, symbol);
    try {
      this.ws.send(JSON.stringify(ticksHistory(symbol, 250, histReq)));
      this.ws.send(JSON.stringify(subscribeTicks(symbol, subReq)));
    } catch (err) {
      console.error(`[feed] subscribe ${symbol} failed: ${err}`);
    }
  }

  private startPing(): void {
    this.clearTimers();
    this.pingTimer = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        if (Date.now() - this.lastMessageAt > PING_INTERVAL_MS * 2) {
          console.warn('[feed] no inbound data for 60s; reconnecting stale feed');
          this.ws.close();
          return;
        }
        try {
          this.ws.send(JSON.stringify(ping()));
        } catch {
          // socket closing
        }
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
    this.reconnectAttempt++;
    const delay = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** (this.reconnectAttempt - 1));
    console.info(`[feed] reconnect in ${delay}ms (attempt ${this.reconnectAttempt})`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.ws) {
        try {
          this.ws.close();
        } catch {
          // ignore
        }
      }
      this.ws = null;
      this.ensureSocket();
    }, delay);
  }

  private waitForConnect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = this.ws!;
      const to = setTimeout(() => reject(new Error('handshake timeout')), 15000);
      ws.on('open', () => {
        clearTimeout(to);
        resolve();
      });
      ws.on('error', (e) => {
        clearTimeout(to);
        reject(e);
      });
    });
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
}
