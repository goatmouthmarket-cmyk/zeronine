export type CTraderAccountMode = 'demo' | 'live';

export interface GoldConfig {
  provider: 'ctrader';
  symbol: string;
  cTraderApiUrl: string;
  cTraderClientId: string;
  cTraderClientSecret: string;
  cTraderAccessToken: string;
  cTraderAccountId: string;
  accountMode: CTraderAccountMode;
  /** Requires the exact `GOLD_LIVE_ENABLED=1` opt-in. */
  liveEnabled: boolean;
  validationErrors: string[];
}

export type GoldDiagnosticStatus = 'disabled' | 'invalid_configuration' | 'unconfigured' | 'read_only_stub';

export interface GoldDiagnostics {
  provider: 'ctrader';
  status: GoldDiagnosticStatus;
  symbol: string;
  requestedAccountMode: CTraderAccountMode;
  liveEnabled: boolean;
  marketDataCapable: false;
  executionCapable: false;
  configured: boolean;
  missing: string[];
  validationErrors: string[];
  reason: string;
}

type Env = NodeJS.ProcessEnv | Record<string, string | undefined>;

function text(env: Env, key: string): string {
  return String(env[key] ?? '').trim();
}

function parseLiveEnabled(raw: string, errors: string[]): boolean {
  if (!raw || raw === '0') return false;
  if (raw === '1') return true;
  errors.push('GOLD_LIVE_ENABLED must be exactly 0 or 1');
  return false;
}

function parseAccountMode(raw: string, errors: string[]): CTraderAccountMode {
  if (!raw || raw === 'demo') return 'demo';
  if (raw === 'live') return 'live';
  errors.push('CTRADER_ACCOUNT_MODE must be demo or live');
  return 'demo';
}

function validHttpsUrl(raw: string): boolean {
  try {
    return new URL(raw).protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Isolated cTrader configuration. It does not modify the application config
 * because Gold connectivity is not wired into the running service yet.
 */
export function loadGoldConfig(env: Env = process.env): GoldConfig {
  const validationErrors: string[] = [];
  const cTraderApiUrl = text(env, 'CTRADER_API_URL');
  const accountMode = parseAccountMode(text(env, 'CTRADER_ACCOUNT_MODE'), validationErrors);
  const liveEnabled = parseLiveEnabled(text(env, 'GOLD_LIVE_ENABLED'), validationErrors);
  if (cTraderApiUrl && !validHttpsUrl(cTraderApiUrl)) {
    validationErrors.push('CTRADER_API_URL must be an absolute https URL');
  }
  if (liveEnabled && accountMode !== 'live') {
    validationErrors.push('GOLD_LIVE_ENABLED=1 requires CTRADER_ACCOUNT_MODE=live');
  }

  return {
    provider: 'ctrader',
    symbol: text(env, 'GOLD_SYMBOL') || 'XAUUSD',
    cTraderApiUrl,
    cTraderClientId: text(env, 'CTRADER_CLIENT_ID'),
    cTraderClientSecret: text(env, 'CTRADER_CLIENT_SECRET'),
    cTraderAccessToken: text(env, 'CTRADER_ACCESS_TOKEN'),
    cTraderAccountId: text(env, 'CTRADER_ACCOUNT_ID'),
    accountMode,
    liveEnabled,
    validationErrors,
  };
}

/**
 * Safe, serializable readiness report for a future API. Secrets are never
 * represented here. A configured Gold integration remains read-only until an
 * execution adapter has been implemented and reviewed separately.
 */
export function goldDiagnostics(config = loadGoldConfig()): GoldDiagnostics {
  const missing = [
    ['CTRADER_API_URL', config.cTraderApiUrl],
    ['CTRADER_CLIENT_ID', config.cTraderClientId],
    ['CTRADER_CLIENT_SECRET', config.cTraderClientSecret],
    ['CTRADER_ACCESS_TOKEN', config.cTraderAccessToken],
    ['CTRADER_ACCOUNT_ID', config.cTraderAccountId],
  ].filter(([, value]) => !value).map(([name]) => name);

  if (config.validationErrors.length > 0) {
    return {
      provider: 'ctrader', status: 'invalid_configuration', symbol: config.symbol,
      requestedAccountMode: config.accountMode, liveEnabled: config.liveEnabled,
      marketDataCapable: false, executionCapable: false, configured: false, missing,
      validationErrors: [...config.validationErrors],
      reason: 'Gold integration configuration is invalid; no provider connection was attempted.',
    };
  }
  if (missing.length > 0) {
    return {
      provider: 'ctrader', status: 'unconfigured', symbol: config.symbol,
      requestedAccountMode: config.accountMode, liveEnabled: config.liveEnabled,
      marketDataCapable: false, executionCapable: false, configured: false, missing,
      validationErrors: [],
      reason: 'cTrader credentials are not configured; Gold integration is inactive.',
    };
  }
  return {
    provider: 'ctrader',
    status: config.liveEnabled ? 'disabled' : 'read_only_stub',
    symbol: config.symbol,
    requestedAccountMode: config.accountMode,
    liveEnabled: config.liveEnabled,
    marketDataCapable: false,
    executionCapable: false,
    configured: true,
    missing: [],
    validationErrors: [],
    reason: config.liveEnabled
      ? 'Live Gold execution is locked: no cTrader execution adapter is installed.'
      : 'cTrader configuration is present, but the Gold adapter is a read-only stub.',
  };
}
