import { randomUUID } from 'node:crypto';
import WebSocket from 'ws';

/** cTrader Open API JSON endpoint for demo accounts only. */
export const CTRADER_DEMO_JSON_WS_URL = 'wss://demo.ctraderapi.com:5036';

const APPLICATION_AUTH_REQUEST = 2100;
const APPLICATION_AUTH_RESPONSE = 2101;
const GET_ACCOUNTS_BY_ACCESS_TOKEN_REQUEST = 2149;
const GET_ACCOUNTS_BY_ACCESS_TOKEN_RESPONSE = 2150;
const ERROR_RESPONSE = 2142;

export interface CTraderAuthorizedAccount {
  /** Provider account ID. It is server-verified before selection. */
  id: string;
  isLive: boolean;
  broker: string | null;
  traderLogin: string | null;
}

export interface CTraderDemoAccountDiscoveryInput {
  clientId: string;
  clientSecret: string;
  accessToken: string;
}

export interface CTraderAccountDiscoveryTransport {
  listAuthorizedAccounts(input: CTraderDemoAccountDiscoveryInput): Promise<CTraderAuthorizedAccount[]>;
}

type CTraderFrame = {
  clientMsgId?: unknown;
  payloadType?: unknown;
  payload?: unknown;
};

type CTraderAccountPayload = {
  ctidTraderAccountId?: unknown;
  isLive?: unknown;
  brokerTitleShort?: unknown;
  traderLogin?: unknown;
};

function required(value: string, name: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${name} is required`);
  return trimmed;
}

function providerAccountId(value: unknown): string | null {
  const id = typeof value === 'string' ? value.trim() : typeof value === 'number' ? String(value) : '';
  return /^\d{1,20}$/.test(id) ? id : null;
}

function optionalText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/**
 * Normalizes only the account identifiers cTrader returned for the OAuth
 * access token. It intentionally discards provider fields not needed by the
 * account chooser and does not infer account ownership from browser input.
 */
export function parseCTraderAuthorizedAccounts(payload: unknown): CTraderAuthorizedAccount[] {
  if (!payload || typeof payload !== 'object') return [];
  const rows = (payload as { ctidTraderAccount?: unknown }).ctidTraderAccount;
  if (!Array.isArray(rows)) return [];
  const seen = new Set<string>();
  const accounts: CTraderAuthorizedAccount[] = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const account = row as CTraderAccountPayload;
    const id = providerAccountId(account.ctidTraderAccountId);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    accounts.push({
      id,
      isLive: account.isLive === true,
      broker: optionalText(account.brokerTitleShort),
      traderLogin: providerAccountId(account.traderLogin),
    });
  }
  return accounts;
}

/**
 * Read-only cTrader JSON transport. Its message set is deliberately limited
 * to application authentication and access-token account discovery; it has no
 * account-session, market-data, or order request method.
 */
export class CTraderJsonAccountDiscoveryTransport implements CTraderAccountDiscoveryTransport {
  private readonly timeoutMs: number;

  constructor(timeoutMs = 12_000) {
    this.timeoutMs = timeoutMs;
  }

  async listAuthorizedAccounts(input: CTraderDemoAccountDiscoveryInput): Promise<CTraderAuthorizedAccount[]> {
    const clientId = required(input.clientId, 'cTrader client ID');
    const clientSecret = required(input.clientSecret, 'cTrader client secret');
    const accessToken = required(input.accessToken, 'cTrader access token');
    const socket = await this.open();
    try {
      await this.request(socket, APPLICATION_AUTH_REQUEST, APPLICATION_AUTH_RESPONSE, { clientId, clientSecret });
      const response = await this.request(socket, GET_ACCOUNTS_BY_ACCESS_TOKEN_REQUEST, GET_ACCOUNTS_BY_ACCESS_TOKEN_RESPONSE, { accessToken });
      return parseCTraderAuthorizedAccounts(response);
    } finally {
      socket.close();
    }
  }

  private async open(): Promise<WebSocket> {
    return new Promise<WebSocket>((resolve, reject) => {
      const socket = new WebSocket(CTRADER_DEMO_JSON_WS_URL, { handshakeTimeout: this.timeoutMs, perMessageDeflate: false });
      const timer = setTimeout(() => fail(new Error('cTrader demo connection timed out')), this.timeoutMs);
      const cleanup = (): void => {
        clearTimeout(timer);
        socket.off('open', opened);
        socket.off('error', failed);
      };
      const opened = (): void => { cleanup(); resolve(socket); };
      const failed = (): void => { cleanup(); reject(new Error('cTrader demo connection failed')); };
      const fail = (error: Error): void => { cleanup(); socket.close(); reject(error); };
      socket.once('open', opened);
      socket.once('error', failed);
    });
  }

  private async request(
    socket: WebSocket,
    payloadType: number,
    expectedPayloadType: number,
    payload: Record<string, string>,
  ): Promise<Record<string, unknown>> {
    const clientMsgId = randomUUID();
    return new Promise<Record<string, unknown>>((resolve, reject) => {
      let complete = false;
      const timer = setTimeout(() => done(new Error('cTrader account discovery timed out')), this.timeoutMs);
      const cleanup = (): void => {
        clearTimeout(timer);
        socket.off('message', received);
        socket.off('error', failed);
        socket.off('close', closed);
      };
      const done = (error: Error | null, result?: Record<string, unknown>): void => {
        if (complete) return;
        complete = true;
        cleanup();
        if (error) reject(error);
        else resolve(result ?? {});
      };
      const failed = (): void => done(new Error('cTrader account discovery connection failed'));
      const closed = (): void => done(new Error('cTrader account discovery connection closed'));
      const received = (data: WebSocket.RawData): void => {
        let frame: CTraderFrame;
        try {
          frame = JSON.parse(data.toString()) as CTraderFrame;
        } catch {
          return;
        }
        if (frame.clientMsgId !== clientMsgId) return;
        if (frame.payloadType === ERROR_RESPONSE) {
          const code = frame.payload && typeof frame.payload === 'object'
            ? optionalText((frame.payload as { errorCode?: unknown }).errorCode)
            : null;
          done(new Error(`cTrader account discovery was rejected${code ? ` (${code})` : ''}`));
          return;
        }
        if (frame.payloadType !== expectedPayloadType || !frame.payload || typeof frame.payload !== 'object') return;
        done(null, frame.payload as Record<string, unknown>);
      };
      socket.on('message', received);
      socket.once('error', failed);
      socket.once('close', closed);
      socket.send(JSON.stringify({ clientMsgId, payloadType, payload }), (error) => {
        if (error) done(new Error('cTrader account discovery request could not be sent'));
      });
    });
  }
}

/**
 * The onboarding service owns encrypted token retrieval. This selector merely
 * verifies that a browser-supplied account ID is one of the demo accounts
 * cTrader returned for that server-held access token.
 */
export class CTraderDemoAccountDiscovery {
  private readonly transport: CTraderAccountDiscoveryTransport;

  constructor(transport: CTraderAccountDiscoveryTransport = new CTraderJsonAccountDiscoveryTransport()) {
    this.transport = transport;
  }

  async list(input: CTraderDemoAccountDiscoveryInput): Promise<CTraderAuthorizedAccount[]> {
    const accounts = await this.transport.listAuthorizedAccounts(input);
    return accounts.filter((account) => !account.isLive);
  }

  async verifySelection(input: CTraderDemoAccountDiscoveryInput, accountId: string): Promise<CTraderAuthorizedAccount> {
    const normalizedId = providerAccountId(accountId);
    if (!normalizedId) throw new Error('cTrader demo account selection is invalid');
    const account = (await this.list(input)).find((candidate) => candidate.id === normalizedId);
    if (!account) throw new Error('selected account is not an authorized cTrader demo account');
    return account;
  }
}
