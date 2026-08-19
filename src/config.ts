import * as fs from 'node:fs';
import * as path from 'node:path';

export interface AppConfig {
  port: number;
  nodeEnv: string;
  dataDir: string;
  dbPath: string;
  derivPublicUrl: string;
  derivAuthUrl: string;
  derivAppId: string;
  derivPat: string;
  derivAccountId: string;
  oauthClientId: string;
  oauthRedirectUri: string;
  oauthAuthUrl: string;
  oauthTokenUrl: string;
  sessionSecret: string;
  baseStake: number;
  maxStake: number;
  martingaleSteps: number;
  maxConsecutiveLosses: number;
  dailyLossLimit: number;
  minEdge: number;
  minRecoveryWinRate: number;
  barrierPreference: string;
  barrierNumber: number;
  strategyMode: string;
  strategyMultiplier: number;
  recoveryBuffer: number;
  chaseAmortize: number;
  maxRecoveryDebt: number;
  maxRecoveryExposure: number;
  maxDrawdownPct: number;
  allowedMarkets: string[];
  tradeGapMs: number;
}

function loadEnvFile(file: string): void {
  if (!fs.existsSync(file)) return;
  const text = fs.readFileSync(file, 'utf8');
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || !line.includes('=')) continue;
    const eq = line.indexOf('=');
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

function num(name: string, fallback: number): number {
  const v = process.env[name];
  if (v === undefined || v === '') return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export function loadConfig(): AppConfig {
  const root = path.resolve(import.meta.dirname, '..');
  loadEnvFile(path.join(root, '.env'));

  const dataDir = path.resolve(root, process.env.DATA_DIR || 'data');
  fs.mkdirSync(dataDir, { recursive: true });

  return {
    port: num('PORT', 8010),
    nodeEnv: process.env.NODE_ENV || 'development',
    dataDir,
    dbPath: path.join(dataDir, 'overunder.db'),
    derivPublicUrl: process.env.DERIV_PUBLIC_URL || 'wss://api.derivws.com/trading/v1/options/ws/public',
    derivAuthUrl: process.env.DERIV_AUTH_URL || 'wss://ws.deriv.com/websockets/v3',
    derivAppId: process.env.DERIV_APP_ID || '1089',
    derivPat: process.env.DERIV_PAT || '',
    derivAccountId: process.env.DERIV_ACCOUNT_ID || '',
    oauthClientId: process.env.DERIV_OAUTH_CLIENT_ID || process.env.DERIV_APP_ID || '',
    oauthRedirectUri:
      process.env.DERIV_OAUTH_REDIRECT_URI || `http://127.0.0.1:${num('PORT', 8010)}/api/auth/oauth/callback`,
    oauthAuthUrl: process.env.DERIV_OAUTH_AUTH_URL || 'https://auth.deriv.com/oauth2/auth',
    oauthTokenUrl: process.env.DERIV_OAUTH_TOKEN_URL || 'https://auth.deriv.com/oauth2/token',
    sessionSecret: process.env.SESSION_SECRET || 'dev-insecure-secret',
    baseStake: num('BASE_STAKE', 1),
    maxStake: num('MAX_STAKE', 25),
    martingaleSteps: num('MARTINGALE_STEPS', 5),
    maxConsecutiveLosses: num('MAX_CONSECUTIVE_LOSSES', 10),
    dailyLossLimit: num('DAILY_LOSS_LIMIT', 100),
    minEdge: num('MIN_EDGE', 0.01),
    minRecoveryWinRate: num('MIN_RECOVERY_WIN_RATE', 0.3),
    barrierPreference: process.env.BARRIER_PREFERENCE || 'auto',
    barrierNumber: num('BARRIER_NUMBER', 0),
    strategyMode: process.env.STRATEGY_MODE || 'conservative',
    strategyMultiplier: num('STRATEGY_MULTIPLIER', 3),
    recoveryBuffer: num('RECOVERY_BUFFER', 0.5),
    chaseAmortize: num('CHASE_AMORTIZE', 0.35),
    maxRecoveryDebt: num('MAX_RECOVERY_DEBT', 50),
    maxRecoveryExposure: num('MAX_RECOVERY_EXPOSURE', 100),
    maxDrawdownPct: num('MAX_DRAWDOWN_PCT', 20),
    allowedMarkets: (process.env.ALLOWED_MARKETS || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    tradeGapMs: num('TRADE_GAP_MS', 1200),
  };
}

export const config = loadConfig();