import WebSocket from 'ws';
import { config } from '../config.ts';
import { balanceSubscribe, getPrecision, ping, proposal, buy, proposalOpenContract, lastDigitOf } from '../core/digitMath.ts';
import type { Direction } from '../core/digitMath.ts';
import { updateSessionBalance } from '../db/store.ts';

const REST_BASE = 'https://api.derivws.com/trading/v1/options';

export interface SessionInfo {
  loginid: string;
  balance: number;
  currency: string;
  mode: 'demo' | 'real';
}

export interface DerivAccountInfo {
  account_id: string | number;
  account_type?: string;
  currency?: string;
  balance?: number;
  status?: string;
}

export async function listDerivAccounts(token: string): Promise<DerivAccountInfo[]> {
  const res = await fetch(`${REST_BASE}/accounts`, {
    headers: {
      Authorization: `Bearer ${token}`,
      'Deriv-App-ID': config.derivAppId,
      Accept: 'application/json',
      'User-Agent': 'overunder/0.1 (+local)',
    },
  });
  if (!res.ok) throw new Error(`accounts api HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const payload = (await res.json()) as { data?: DerivAccountInfo[] | DerivAccountInfo };
  const data = payload?.data;
  const list = Array.isArray(data) ? data : data ? [data] : [];
  return list.filter((a) => a && a.account_id != null);
}

async function restOtpUrl(accountId: string | number, token: string): Promise<string> {
  const res = await fetch(`${REST_BASE}/accounts/${encodeURIComponent(String(accountId))}/otp`, {
    method: 'POST',
    body: '',
    headers: {
      Authorization: `Bearer ${token}`,
      'Deriv-App-ID': config.derivAppId,
      Accept: 'application/json',
      'User-Agent': 'overunder/0.1 (+local)',
    },
  });
  if (!res.ok) throw new Error(`otp api HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const payload = (await res.json()) as { data?: { url?: string } };
  const url = payload?.data?.url;
  if (!url || !url.startsWith('wss://api.derivws.com/')) {
    throw new Error('Deriv returned an invalid account connection');
  }
  return url;
}

export interface QuoteResult {
  id: string;
  askPrice: number;
  payout: number;
  spot: number;
  barrier: number;
  direction: Direction;
}

export interface ContractUpdate {
  contractId: string;
  status: 'open' | 'won' | 'lost';
  profit: number;
  sellPrice: number;
  buyPrice: number;
  settled: boolean;
  exitSpot?: number;
  exitDigit?: number;
  entrySpot?: number;
  entryDigit?: number;
}

type Pending = {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
  type: string;
  timeout: NodeJS.Timeout;
};

const DEFAULT_TIMEOUT = 12000;

export class DerivPrivateClient {
  private ws: WebSocket | null = null;
  private reqCounter = 1000;
  private pending = new Map<number, Pending>();
  private contractSubs = new Map<string, Set<(u: ContractUpdate) => void>>();
  private pingTimer: NodeJS.Timeout | null = null;
  onSession: ((s: SessionInfo) => void) | null = null;
  onBalance: ((balance: number) => void) | null = null;
  onDisconnect: (() => void) | null = null;
  private connected = false;

  get isConnected(): boolean {
    return this.connected;
  }

  private nextReqId(): number {
    return this.reqCounter++;
  }

  async connect(token: string, accountId?: string): Promise<SessionInfo> {
    let lastErr: unknown = new Error('connect failed');
    for (let attempt = 1; attempt <= 4; attempt++) {
      try {
        const accounts = await listDerivAccounts(token);
        if (accounts.length === 0) throw new Error('no Deriv accounts available for this token');
        const requestedAccount = accountId || config.derivAccountId;
        const wanted = requestedAccount
          ? accounts.find((a) => String(a.account_id) === String(requestedAccount))
          : undefined;
        if (requestedAccount && !wanted) throw new Error('requested Deriv account is unavailable for this login');
        const demo = wanted ?? accounts.find((a) => String(a.account_type ?? '').toLowerCase().includes('demo'));
        const account = wanted ?? demo ?? accounts[0];
        const url = await restOtpUrl(account.account_id, token);
        return this.openSocket(url, account);
      } catch (err) {
        lastErr = err;
        if (attempt < 4) await new Promise((r) => setTimeout(r, 1500 * attempt));
      }
    }
    throw lastErr;
  }

  private openSocket(url: string, account: DerivAccountInfo): Promise<SessionInfo> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url, { perMessageDeflate: false, handshakeTimeout: 15000 });
      this.ws = ws;

      const handshakeTimer = setTimeout(() => {
        reject(new Error('private handshake timeout'));
        try {
          ws.close();
        } catch {
          // ignore
        }
      }, 20000);

      ws.on('open', () => {
        clearTimeout(handshakeTimer);
        this.connected = true;
        this.startPing();
        this.send({ balance: 1, subscribe: 1, req_id: this.nextReqId() });
        const info: SessionInfo = {
          loginid: String(account.account_id),
          balance: Number(account.balance ?? 0),
          currency: account.currency || 'USD',
          mode: String(account.account_type ?? '').toLowerCase().includes('demo') ? 'demo' : 'real',
        };
        this.onSession?.(info);
        resolve(info);
      });

      ws.on('message', (raw) => {
        try {
          this.handleMessage(JSON.parse(raw.toString()));
        } catch {
          // ignore malformed frames
        }
      });

      ws.on('error', (err) => {
        clearTimeout(handshakeTimer);
        reject(new Error(`private socket error: ${err.message}`));
      });

      ws.on('close', () => {
        this.connected = false;
        this.stopPing();
        for (const p of this.pending.values()) clearTimeout(p.timeout);
        this.pending.clear();
        this.onDisconnect?.();
      });
    });
  }

  private handleMessage(msg: Record<string, any>): void {
    if (msg.msg_type === 'ping') return;
    if (msg.msg_type === 'balance') {
      const balance = msg.balance?.balance;
      if (typeof balance === 'number') {
        updateSessionBalance(balance);
        this.onBalance?.(balance);
      }
      return;
    }
    if (msg.msg_type === 'proposal_open_contract') {
      const c = msg.proposal_open_contract;
      if (c?.contract_id) {
        const update = this.normalizeContract(c);
        const subs = this.contractSubs.get(String(c.contract_id));
        if (subs) for (const cb of subs) cb(update);
      }
      if (msg.req_id !== undefined && this.pending.has(msg.req_id)) {
        const p = this.pending.get(msg.req_id)!;
        this.pending.delete(msg.req_id);
        clearTimeout(p.timeout);
        p.resolve(msg);
      }
      return;
    }
    if (msg.error && msg.req_id !== undefined && this.pending.has(msg.req_id)) {
      const p = this.pending.get(msg.req_id)!;
      this.pending.delete(msg.req_id);
      clearTimeout(p.timeout);
      p.reject(new Error(`${p.type}: ${msg.error.message ?? 'unknown'}`));
      return;
    }
    if (msg.req_id !== undefined && this.pending.has(msg.req_id)) {
      const p = this.pending.get(msg.req_id)!;
      this.pending.delete(msg.req_id);
      clearTimeout(p.timeout);
      p.resolve(msg);
    }
  }

  private normalizeContract(c: any): ContractUpdate {
    let status: ContractUpdate['status'] = 'open';
    if (c.is_sold) {
      status = c.status === 'won' ? 'won' : 'lost';
    }
    const exitTick = c.exit_tick;
    const entryTick = c.entry_tick;
    const exitSpot = Number(exitTick?.quote ?? c.exit_spot ?? NaN);
    const entrySpot = Number(entryTick?.quote ?? c.entry_spot ?? NaN);
    const precision = getPrecision(c.underlying_symbol);
    return {
      contractId: String(c.contract_id),
      status,
      profit: Number(c.profit ?? 0),
      sellPrice: Number(c.sell_price ?? 0),
      buyPrice: Number(c.buy_price ?? 0),
      settled: !!c.is_sold,
      exitSpot: Number.isFinite(exitSpot) ? exitSpot : undefined,
      exitDigit: Number.isFinite(exitSpot) ? lastDigitOf(exitSpot, precision) : undefined,
      entrySpot: Number.isFinite(entrySpot) ? entrySpot : undefined,
      entryDigit: Number.isFinite(entrySpot) ? lastDigitOf(entrySpot, precision) : undefined,
    };
  }

  private request(payload: Record<string, unknown>, type: string, timeoutMs = DEFAULT_TIMEOUT): Promise<unknown> {
    const reqId = this.nextReqId();
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        reject(new Error('private socket not open'));
        return;
      }
      const timeout = setTimeout(() => {
        this.pending.delete(reqId);
        reject(new Error(`${type} timeout`));
      }, timeoutMs);
      this.pending.set(reqId, { resolve, reject, type, timeout });
      this.send({ ...payload, req_id: reqId });
    });
  }

  private send(msg: Record<string, unknown>): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  async getQuote(args: {
    direction: Direction;
    barrier: number;
    amount: number;
    currency: string;
    duration: number;
    durationUnit: 't' | 'm' | 's';
    symbol: string;
  }): Promise<QuoteResult> {
    const msg = (await this.request(
      proposal({
        ...args,
        reqId: 0,
      }),
      'proposal',
      10000,
    )) as any;
    const p = msg?.proposal;
    if (!p?.id) throw new Error('proposal unavailable');
    return {
      id: String(p.id),
      askPrice: Number(p.ask_price),
      payout: Number(p.payout),
      spot: Number(p.spot ?? 0),
      barrier: args.barrier,
      direction: args.direction,
    };
  }

  async placeBuy(proposalId: string, price: number): Promise<{ contractId: string; payout: number; buyPrice: number; purchaseTime: number }> {
    const msg = (await this.request(buy(proposalId, price, 0), 'buy', 12000)) as any;
    const b = msg?.buy;
    if (!b?.contract_id) throw new Error('buy rejected');
    return {
      contractId: String(b.contract_id),
      payout: Number(b.payout ?? 0),
      buyPrice: Number(b.buy_price ?? price),
      purchaseTime: Number(b.purchase_time ?? Math.floor(Date.now() / 1000)),
    };
  }

  async settleContract(contractId: string, onUpdate: (u: ContractUpdate) => void): Promise<ContractUpdate> {
    return new Promise((resolve) => {
      let done = false;
      const subs = this.contractSubs.get(contractId) ?? new Set();
      const wrapped = (update: ContractUpdate): void => finish(update);
      subs.add(wrapped);
      this.contractSubs.set(contractId, subs);

      const finish = (update: ContractUpdate): void => {
        if (done) return;
        if (update.settled) {
          done = true;
          clearTimeout(hard);
          subs.delete(wrapped);
          resolve(update);
        } else {
          onUpdate(update);
        }
      };

      // Never let a settlement hang forever: resolve as unsettled so the
      // automation can reconcile/expire the trade instead of stalling on it.
      const hard = setTimeout(() => {
        if (done) return;
        done = true;
        subs.delete(wrapped);
        resolve({ contractId, status: 'open', profit: 0, sellPrice: 0, buyPrice: 0, settled: false });
      }, 20000);

      this.request(proposalOpenContract(contractId, 0, true), 'proposal_open_contract', 60000)
        .then((msg) => {
          const c = (msg as any)?.proposal_open_contract;
          if (c?.contract_id) finish(this.normalizeContract(c));
        })
        .catch(() => {
          if (done) return;
          done = true;
          clearTimeout(hard);
          subs.delete(wrapped);
          resolve({ contractId, status: 'open', profit: 0, sellPrice: 0, buyPrice: 0, settled: false });
        });
    });
  }

  disconnect(): void {
    this.stopPing();
    this.connected = false;
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        // ignore
      }
      this.ws = null;
    }
    // Clear all pending requests
    for (const p of this.pending.values()) clearTimeout(p.timeout);
    this.pending.clear();
    this.contractSubs.clear();
  }

  async reconnect(token: string, accountId?: string): Promise<SessionInfo> {
    this.disconnect();
    // Small delay to ensure old socket is fully closed
    await new Promise((resolve) => setTimeout(resolve, 100));
    return this.connect(token, accountId);
  }

  private startPing(): void {
    this.stopPing();
    this.pingTimer = setInterval(() => {
      this.send(ping());
    }, 30000);
  }

  private stopPing(): void {
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
  }
}
