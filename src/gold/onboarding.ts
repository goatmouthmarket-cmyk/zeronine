import { randomUUID } from 'node:crypto';
import { decryptGoldToken, encryptGoldToken } from '../db/crypto.ts';
import {
  deleteGoldDemoConnection,
  getGoldDemoConnection,
  upsertGoldDemoConnection,
  type GoldDemoConnectionRow,
} from '../db/store.ts';
import type { GoldConfig } from './config.ts';
import { CTraderDemoAccountDiscovery, type CTraderAuthorizedAccount } from './ctraderAccountDiscovery.ts';

const CTRADER_CONSENT_URL = 'https://id.ctrader.com/my/settings/openapi/grantingaccess/';
const CTRADER_TOKEN_URL = 'https://openapi.ctrader.com/apps/token';
const DEMO_OWNER_KEY = 'dashboard-owner';

export type GoldConnectionStatus = 'unconfigured' | 'ready' | 'authorizing' | 'authorized_demo_pending_account_discovery' | 'connected_demo' | 'error';

export interface GoldConnectionState {
  status: GoldConnectionStatus;
  mode: 'demo';
  configured: boolean;
  canDisconnect: boolean;
  authorizedAt: number | null;
  accountLabel?: string;
  message: string | null;
}

export interface CTraderTokenResponse {
  accessToken: string;
  refreshToken?: string;
  expiresIn: number | string;
  tokenType?: string;
  scope?: string;
}

export class GoldOAuthError extends Error {
  readonly statusCode: number;

  constructor(message: string, statusCode = 409) {
    super(message);
    this.name = 'GoldOAuthError';
    this.statusCode = statusCode;
  }
}

function configured(config: GoldConfig): string | null {
  if (!config.cTraderApiUrl || !config.cTraderClientId || !config.cTraderClientSecret || !config.cTraderRedirectUri) {
    return 'Configure CTRADER_API_URL, CTRADER_CLIENT_ID, CTRADER_CLIENT_SECRET, and CTRADER_REDIRECT_URI in Railway before connecting cTrader.';
  }
  if (!config.goldTokenEncryptionKey || config.goldTokenEncryptionKey.length < 32) {
    return 'Configure GOLD_TOKEN_ENCRYPTION_KEY as a Railway secret before connecting cTrader.';
  }
  if (config.accountMode !== 'demo' || config.liveEnabled) {
    return 'Gold onboarding is demo-only. Keep CTRADER_ACCOUNT_MODE=demo and GOLD_LIVE_ENABLED=0.';
  }
  return null;
}

/** The documented cTrader Open API consent grant. It intentionally has no PKCE parameters. */
export function buildCTraderConsentUrl(config: Pick<GoldConfig, 'cTraderClientId' | 'cTraderRedirectUri'>): string {
  const url = new URL(CTRADER_CONSENT_URL);
  url.searchParams.set('client_id', config.cTraderClientId);
  url.searchParams.set('redirect_uri', config.cTraderRedirectUri);
  url.searchParams.set('scope', 'accounts');
  url.searchParams.set('product', 'web');
  return url.toString();
}

export async function exchangeCTraderAuthorizationCode(
  config: Pick<GoldConfig, 'cTraderClientId' | 'cTraderClientSecret' | 'cTraderRedirectUri'>,
  code: string,
  fetcher: typeof fetch = fetch,
): Promise<CTraderTokenResponse> {
  const url = new URL(CTRADER_TOKEN_URL);
  url.searchParams.set('client_id', config.cTraderClientId);
  url.searchParams.set('client_secret', config.cTraderClientSecret);
  url.searchParams.set('grant_type', 'authorization_code');
  url.searchParams.set('code', code);
  url.searchParams.set('redirect_uri', config.cTraderRedirectUri);
  const response = await fetcher(url, { method: 'GET', headers: { accept: 'application/json' } });
  if (!response.ok) throw new GoldOAuthError(`cTrader authorization exchange failed (HTTP ${response.status}).`, 502);
  const raw = await response.json() as Partial<CTraderTokenResponse>;
  if (typeof raw.accessToken !== 'string' || !raw.accessToken || !Number.isFinite(Number(raw.expiresIn)) || Number(raw.expiresIn) <= 0) {
    throw new GoldOAuthError('cTrader authorization exchange returned an invalid token response.', 502);
  }
  return raw as CTraderTokenResponse;
}

export class GoldOAuthOnboarding {
  private readonly config: GoldConfig;
  private readonly now: () => number;
  private readonly exchange: (config: GoldConfig, code: string) => Promise<CTraderTokenResponse>;
  private readonly accounts: CTraderDemoAccountDiscovery;

  constructor(
    config: GoldConfig,
    now: () => number = Date.now,
    exchange: (config: GoldConfig, code: string) => Promise<CTraderTokenResponse> = exchangeCTraderAuthorizationCode,
    accounts: CTraderDemoAccountDiscovery = new CTraderDemoAccountDiscovery(),
  ) {
    this.config = config;
    this.now = now;
    this.exchange = exchange;
    this.accounts = accounts;
  }

  state(ownerKey = DEMO_OWNER_KEY): GoldConnectionState {
    const problem = configured(this.config);
    if (problem) return { status: 'unconfigured', mode: 'demo', configured: false, canDisconnect: false, authorizedAt: null, message: problem };
    const connection = getGoldDemoConnection(ownerKey);
    if (connection?.account_id) {
      return {
        status: 'connected_demo', mode: 'demo', configured: true, canDisconnect: true,
        authorizedAt: connection.authorized_at,
        accountLabel: connection.account_label ?? `Demo account ${connection.account_id}`,
        message: 'The selected cTrader demo account is verified. Account data is read-only; market data and trading remain unavailable.',
      };
    }
    if (connection) {
      return {
        status: 'authorized_demo_pending_account_discovery',
        mode: 'demo',
        configured: true,
        canDisconnect: true,
        authorizedAt: connection.authorized_at,
        message: 'cTrader demo authorization is stored securely. Demo account discovery is the next required step; trading remains unavailable.',
      };
    }
    return { status: 'ready', mode: 'demo', configured: true, canDisconnect: false, authorizedAt: null, message: 'Connect a cTrader demo account to authorize Gold market access.' };
  }

  begin(ownerKey = DEMO_OWNER_KEY): { url: string; nonce: string } {
    const state = this.state(ownerKey);
    if (state.status !== 'ready') throw new GoldOAuthError(state.message ?? 'Gold OAuth is unavailable.');
    return { url: buildCTraderConsentUrl(this.config), nonce: randomUUID() };
  }

  async complete(code: string, ownerKey = DEMO_OWNER_KEY): Promise<GoldConnectionState> {
    if (!code.trim()) throw new GoldOAuthError('cTrader authorization did not return a code.');
    const problem = configured(this.config);
    if (problem) throw new GoldOAuthError(problem);
    const token = await this.exchange(this.config, code);
    const now = this.now();
    const expiresIn = Number(token.expiresIn);
    const row: GoldDemoConnectionRow = {
      owner_key: ownerKey,
      status: 'authorized_demo_pending_account_discovery',
      token_cipher: encryptGoldToken(JSON.stringify({
        accessToken: token.accessToken,
        refreshToken: token.refreshToken ?? null,
        tokenType: token.tokenType ?? 'Bearer',
        scope: token.scope ?? null,
        expiresAt: now + expiresIn * 1000,
      }), this.config.goldTokenEncryptionKey),
      token_expires_at: now + expiresIn * 1000,
      authorized_at: now,
      updated_at: now,
      account_id: null,
      account_label: null,
    };
    upsertGoldDemoConnection(row);
    return this.state(ownerKey);
  }

  disconnect(ownerKey = DEMO_OWNER_KEY): GoldConnectionState {
    deleteGoldDemoConnection(ownerKey);
    return this.state(ownerKey);
  }

  async listDemoAccounts(ownerKey = DEMO_OWNER_KEY): Promise<CTraderAuthorizedAccount[]> {
    return this.accounts.list(this.discoveryInput(ownerKey));
  }

  async selectDemoAccount(accountId: string, ownerKey = DEMO_OWNER_KEY): Promise<GoldConnectionState> {
    const selected = await this.accounts.verifySelection(this.discoveryInput(ownerKey), accountId);
    const row = getGoldDemoConnection(ownerKey);
    if (!row) throw new GoldOAuthError('Connect cTrader before selecting a demo account.');
    upsertGoldDemoConnection({
      ...row,
      account_id: selected.id,
      account_label: selected.broker ? `${selected.broker} - ${selected.id}` : `Demo account ${selected.id}`,
      updated_at: this.now(),
    });
    return this.state(ownerKey);
  }

  private discoveryInput(ownerKey: string): { clientId: string; clientSecret: string; accessToken: string } {
    const row = getGoldDemoConnection(ownerKey);
    if (!row) throw new GoldOAuthError('Connect cTrader before loading demo accounts.');
    if (row.token_expires_at <= this.now()) {
      throw new GoldOAuthError('The cTrader authorization has expired. Disconnect and authorize again.', 409);
    }
    try {
      const token = JSON.parse(decryptGoldToken(row.token_cipher, this.config.goldTokenEncryptionKey)) as { accessToken?: unknown };
      if (typeof token.accessToken !== 'string' || !token.accessToken) throw new Error('missing token');
      return { clientId: this.config.cTraderClientId, clientSecret: this.config.cTraderClientSecret, accessToken: token.accessToken };
    } catch {
      throw new GoldOAuthError('The stored cTrader authorization cannot be read. Disconnect and authorize again.', 409);
    }
  }
}
