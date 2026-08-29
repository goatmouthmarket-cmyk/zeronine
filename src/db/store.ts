import { DatabaseSync } from 'node:sqlite';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { config } from '../config.ts';

export interface SessionRow {
  id: string;
  loginid: string;
  balance: number;
  currency: string;
  mode: 'demo' | 'real';
  auth_kind: 'pat' | 'oauth';
  token_cipher: string;
  created_at: number;
  updated_at: number;
}

export interface TradeRow {
  id: number;
  account_id?: string;
  /** Account mode captured when the contract was requested. */
  account_mode?: 'demo' | 'real' | 'unknown';
  ts: number;
  market: string;
  contract_type: 'DIGITOVER' | 'DIGITUNDER';
  barrier: number;
  duration: number;
  duration_unit: string;
  stake: number;
  ask_price: number;
  payout: number;
  est_win: number;
  profit: number;
  status: 'purchasing' | 'pending' | 'won' | 'lost' | 'push' | 'expired' | 'timeout' | 'error';
  contract_id: string;
  purchase_id: string;
  reason: string;
  origin?: 'manual' | 'bot' | 'paper';
  resolved_at: number;
  entry_spot?: number;
  entry_digit?: number;
  exit_spot?: number;
  exit_digit?: number;
}

/**
 * Immutable audit entries. Account entries mirror Deriv contract lifecycle
 * events; paper entries are explicitly virtual and never belong to an account.
 */
export interface LedgerEntryRow {
  id: number;
  entry_key: string;
  ts: number;
  book: 'account' | 'paper';
  account_id: string | null;
  account_mode: 'demo' | 'real' | 'unknown' | 'not_applicable';
  event: 'requested' | 'purchased' | 'settled' | 'cancelled';
  source: 'manual' | 'bot' | 'paper';
  trade_id: number | null;
  contract_ref: string;
  market: string;
  contract_type: 'DIGITOVER' | 'DIGITUNDER';
  barrier: number;
  stake: number;
  payout: number;
  profit: number;
  status: string;
  reason: string;
  entry_spot: number | null;
  exit_spot: number | null;
  exit_digit: number | null;
  est_win: number | null;
}

export interface PaperLedgerContract {
  id: number;
  runId: string;
  market: string;
  direction: 'over' | 'under';
  barrier: number;
  stake: number;
  payoutRatio: number;
  status: 'open' | 'won' | 'lost' | 'cancelled';
  entryEpoch: number;
  entryQuote: number;
  entryDigit: number;
  exitEpoch?: number;
  exitQuote?: number;
  exitDigit?: number;
  profit?: number;
  estWin?: number;
}

/** Immutable scanner/configuration snapshot captured when virtual research opens. */
export interface PaperTradeContextRow {
  contract_ref: string;
  opened_at: number;
  strategy_mode: string;
  bot_mode: string;
  candidate_reason: string;
  signal_id: string;
  signal_at: number | null;
  evidence_json: string;
}

export interface PaperTradeContextInput {
  strategyMode?: string;
  botMode?: string;
  candidateReason?: string;
  signalId?: string;
  signalAt?: number;
  evidence?: Record<string, number | null>;
}

export interface PaperTradeStrategyContext extends Omit<PaperTradeContextRow, 'evidence_json'> {
  evidence: Record<string, number | null>;
}

export interface PaperTradeSummary {
  contract_ref: string;
  opened_at: number;
  updated_at: number;
  market: string;
  contract_type: 'DIGITOVER' | 'DIGITUNDER';
  direction: 'over' | 'under';
  barrier: number;
  stake: number;
  payout: number;
  est_win: number | null;
  status: string;
  profit: number;
  entry_spot: number | null;
  exit_spot: number | null;
  exit_digit: number | null;
  strategy: PaperTradeStrategyContext | null;
  possible_outcomes: { won: { profit: number; payout: number }; lost: { profit: number } };
}

export interface PerformanceSummary {
  wins: number;
  losses: number;
  pushes: number;
  profit: number;
  reset_at: number;
}

const LEGACY_ACCOUNT_ID = '__legacy__';
const LOCAL_ACCOUNT_ID = '__local__';

export interface RecoveryState {
  mode: 'base' | 'recovering';
  streak: number;
  debt: number;
  attempts: number;
  cycleStake: number;
  peakBalance: number;
  last_win_epoch: number;
  updated_at: number;
}

export interface SettingsRow {
  base_stake: number;
  max_stake: number;
  martingale_steps: number;
  max_consecutive_losses: number;
  min_edge: number;
  min_recovery_win: number;
  barrier_preference: string;
  barrier_number: number;
  strategy_mode: string;
  bot_mode: string;
  strategy_multiplier: number;
  recovery_buffer: number;
  chase_amortize: number;
  max_recovery_debt: number;
  max_recovery_exposure: number;
  max_drawdown_pct: number;
  pattern_weight: number;
  pattern_weight_conservative: number | null;
  pattern_weight_martingale: number | null;
  pattern_weight_boosted_martingale: number | null;
  pattern_weight_chase: number | null;
}

/** Immutable, global research evidence from the multiplier-momentum observer. */
export interface MomentumResearchRow {
  id: number;
  completed_at: number;
  symbol: string;
  market: string;
  direction: 'up' | 'down';
  confidence: number;
  score: number;
  return_15s: number | null;
  return_30s: number | null;
  return_60s: number | null;
  open_price: number;
  decision_price: number;
  exit_price: number;
  multiplier: number;
  stake: number;
  commission_rate: number;
  estimated_net: number;
  won: number;
}

export interface MomentumResearchSummary {
  windows: number;
  wins: number;
  losses: number;
  win_rate: number | null;
  estimated_net: number;
  maturity_target: number;
  samples_remaining: number;
  ready_for_virtual_paper: boolean;
  recent: MomentumResearchRow[];
}

export type StrategyMode = 'conservative' | 'martingale' | 'boosted_martingale' | 'chase';

/**
 * Resolve the learned-pattern blend weight for one strategy: a per-strategy
 * override wins, otherwise the global pattern_weight. 0 disables patterns.
 */
export function patternWeightForStrategy(
  settings: Pick<
    SettingsRow,
    | 'pattern_weight'
    | 'pattern_weight_conservative'
    | 'pattern_weight_martingale'
    | 'pattern_weight_boosted_martingale'
    | 'pattern_weight_chase'
  >,
  strategy: string,
): number {
  const overrides: Record<string, number | null> = {
    conservative: settings.pattern_weight_conservative,
    martingale: settings.pattern_weight_martingale,
    boosted_martingale: settings.pattern_weight_boosted_martingale,
    chase: settings.pattern_weight_chase,
  };
  const v = overrides[strategy] ?? settings.pattern_weight ?? 0;
  return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0;
}

export interface AutomationRow {
  running: number;
  armed_until: number;
  started_at: number;
  stopped_at: number;
  reason: string;
  target_trades: number;
  trades_done: number;
}

let db: DatabaseSync | null = null;

type PendingDigit = { market: string; epoch: number; quote: number; digit: number };
const DIGIT_FLUSH_DELAY_MS = 100;
const DIGIT_QUEUE_LIMIT = 50_000;
let pendingDigits: PendingDigit[] = [];
let digitFlushTimer: NodeJS.Timeout | null = null;
let digitFlushActive = false;

export function getDb(): DatabaseSync {
  if (db) return db;
  fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });
  db = new DatabaseSync(config.dbPath);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA busy_timeout = 10000;');
  db.exec('PRAGMA synchronous = NORMAL;');
  migrate(db);
  seedDefaults(db);
  return db;
}

function migrate(d: DatabaseSync): void {
  d.exec(`
    CREATE TABLE IF NOT EXISTS markets (
      symbol TEXT PRIMARY KEY,
      display TEXT,
      active INTEGER DEFAULT 1,
      last_digit INTEGER,
      last_quote REAL,
      last_epoch INTEGER,
      updated_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS digits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      market TEXT NOT NULL,
      epoch INTEGER NOT NULL,
      quote REAL,
      digit INTEGER,
      UNIQUE(market, epoch)
    );
    CREATE INDEX IF NOT EXISTS idx_digits_market_epoch ON digits(market, epoch DESC);
    CREATE TABLE IF NOT EXISTS app_meta (
      key TEXT PRIMARY KEY,
      value TEXT
    );
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      loginid TEXT,
      balance REAL DEFAULT 0,
      currency TEXT,
      mode TEXT DEFAULT 'demo',
      auth_kind TEXT DEFAULT 'pat',
      token_cipher TEXT,
      created_at INTEGER,
      updated_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS trades (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id TEXT NOT NULL DEFAULT '__legacy__',
      account_mode TEXT NOT NULL DEFAULT 'unknown',
      ts INTEGER,
      market TEXT,
      contract_type TEXT,
      barrier INTEGER,
      duration INTEGER,
      duration_unit TEXT,
      stake REAL,
      ask_price REAL,
      payout REAL,
      est_win REAL,
      profit REAL,
      status TEXT,
      contract_id TEXT,
      purchase_id TEXT,
      reason TEXT,
      origin TEXT NOT NULL DEFAULT 'bot',
      resolved_at INTEGER,
      entry_spot REAL,
      entry_digit INTEGER,
      exit_spot REAL,
      exit_digit INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_trades_ts ON trades(ts DESC);
    CREATE TABLE IF NOT EXISTS trade_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entry_key TEXT NOT NULL UNIQUE,
      ts INTEGER NOT NULL,
      book TEXT NOT NULL CHECK (book IN ('account', 'paper')),
      account_id TEXT,
      account_mode TEXT NOT NULL CHECK (account_mode IN ('demo', 'real', 'unknown', 'not_applicable')),
      event TEXT NOT NULL CHECK (event IN ('requested', 'purchased', 'settled', 'cancelled')),
      source TEXT NOT NULL CHECK (source IN ('manual', 'bot', 'paper')),
      trade_id INTEGER,
      contract_ref TEXT NOT NULL DEFAULT '',
      market TEXT NOT NULL,
      contract_type TEXT NOT NULL,
      barrier INTEGER NOT NULL,
      stake REAL NOT NULL DEFAULT 0,
      payout REAL NOT NULL DEFAULT 0,
      profit REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL,
      reason TEXT NOT NULL DEFAULT '',
      entry_spot REAL,
      exit_spot REAL,
      exit_digit INTEGER,
      est_win REAL,
      CHECK (
        (book = 'account' AND account_id IS NOT NULL AND account_mode IN ('demo', 'real', 'unknown'))
        OR (book = 'paper' AND account_id IS NULL AND account_mode = 'not_applicable')
      )
    );
    CREATE INDEX IF NOT EXISTS idx_trade_ledger_account_id ON trade_ledger(account_id, id DESC);
    CREATE INDEX IF NOT EXISTS idx_trade_ledger_book_id ON trade_ledger(book, id DESC);
    CREATE TABLE IF NOT EXISTS paper_trade_context (
      contract_ref TEXT PRIMARY KEY,
      opened_at INTEGER NOT NULL,
      strategy_mode TEXT NOT NULL,
      bot_mode TEXT NOT NULL,
      candidate_reason TEXT NOT NULL,
      signal_id TEXT NOT NULL,
      signal_at INTEGER,
      evidence_json TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_paper_trade_context_opened ON paper_trade_context(opened_at DESC);
    CREATE TABLE IF NOT EXISTS performance_baseline (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      wins INTEGER NOT NULL DEFAULT 0,
      losses INTEGER NOT NULL DEFAULT 0,
      pushes INTEGER NOT NULL DEFAULT 0,
      profit REAL NOT NULL DEFAULT 0,
      reset_at INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS account_performance_baselines (
      account_id TEXT PRIMARY KEY,
      wins INTEGER NOT NULL DEFAULT 0,
      losses INTEGER NOT NULL DEFAULT 0,
      pushes INTEGER NOT NULL DEFAULT 0,
      profit REAL NOT NULL DEFAULT 0,
      reset_at INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS recovery_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      mode TEXT DEFAULT 'base',
      streak INTEGER DEFAULT 0,
      lost REAL DEFAULT 0,
      debt REAL DEFAULT 0,
      attempts INTEGER DEFAULT 0,
      cycle_stake REAL DEFAULT 0,
      peak_balance REAL DEFAULT 0,
      last_win_epoch INTEGER DEFAULT 0,
      updated_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS quote_stats (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      market TEXT NOT NULL,
      direction TEXT NOT NULL,
      barrier INTEGER NOT NULL,
      samples INTEGER NOT NULL DEFAULT 0,
      sum_ratio REAL NOT NULL DEFAULT 0,
      min_ratio REAL,
      max_ratio REAL,
      updated_at INTEGER,
      UNIQUE(market, direction, barrier)
    );
    CREATE TABLE IF NOT EXISTS scanner_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      trade_id INTEGER,
      ts INTEGER,
      market TEXT,
      direction TEXT,
      barrier INTEGER,
      est_win REAL,
      ask REAL,
      payout REAL,
      ratio REAL,
      breakeven REAL,
      edge REAL,
      prev_digit INTEGER,
      consistency REAL,
      entropy REAL,
      momentum REAL,
      result TEXT,
      profit REAL
    );
    CREATE INDEX IF NOT EXISTS idx_scanner_trade ON scanner_logs(trade_id);
    CREATE INDEX IF NOT EXISTS idx_scanner_ts ON scanner_logs(ts DESC);
    CREATE TABLE IF NOT EXISTS decision_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts INTEGER NOT NULL,
      market TEXT NOT NULL,
      direction TEXT,
      barrier INTEGER,
      action TEXT NOT NULL,
      reason TEXT NOT NULL,
      est_win REAL,
      health_score REAL,
      regime TEXT,
      deception_score REAL,
      requested_stake REAL,
      outcome TEXT,
      resolved_at INTEGER,
      expires_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS account_recovery_state (
      account_id TEXT PRIMARY KEY,
      mode TEXT DEFAULT 'base',
      streak INTEGER DEFAULT 0,
      debt REAL DEFAULT 0,
      attempts INTEGER DEFAULT 0,
      cycle_stake REAL DEFAULT 0,
      peak_balance REAL DEFAULT 0,
      last_win_epoch INTEGER DEFAULT 0,
      updated_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_decision_events_market_pending ON decision_events(market, outcome, expires_at);
    CREATE INDEX IF NOT EXISTS idx_decision_events_action_market_ts ON decision_events(action, market, ts DESC);
    CREATE TABLE IF NOT EXISTS settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      base_stake REAL,
      max_stake REAL,
      martingale_steps INTEGER,
      max_consecutive_losses INTEGER,
      min_edge REAL,
      min_recovery_win REAL,
      barrier_preference TEXT,
      barrier_number REAL,
      strategy_mode TEXT,
      bot_mode TEXT,
      strategy_multiplier REAL,
      recovery_buffer REAL,
      chase_amortize REAL,
      max_recovery_debt REAL,
      max_recovery_exposure REAL,
      max_drawdown_pct REAL
    );
    CREATE TABLE IF NOT EXISTS automation (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      running INTEGER DEFAULT 0,
      armed_until INTEGER DEFAULT 0,
      started_at INTEGER,
      stopped_at INTEGER,
      reason TEXT,
      target_trades INTEGER DEFAULT 0,
      trades_done INTEGER DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS test_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kind TEXT NOT NULL,
      strategy_mode TEXT NOT NULL,
      bot_mode TEXT NOT NULL,
      base_stake REAL NOT NULL DEFAULT 1,
      target INTEGER NOT NULL DEFAULT 0,
      trades INTEGER NOT NULL DEFAULT 0,
      wins INTEGER NOT NULL DEFAULT 0,
      losses INTEGER NOT NULL DEFAULT 0,
      net_pnl REAL NOT NULL DEFAULT 0,
      win_rate REAL,
      avg_stake REAL,
      max_drawdown_pct REAL,
      best_streak INTEGER,
      worst_streak INTEGER,
      final_balance REAL,
      started_at INTEGER,
      finished_at INTEGER,
      source TEXT NOT NULL DEFAULT 'manual'
    );
    CREATE INDEX IF NOT EXISTS idx_test_runs_kind ON test_runs(kind, id DESC);
    CREATE TABLE IF NOT EXISTS momentum_research (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      completed_at INTEGER NOT NULL,
      symbol TEXT NOT NULL,
      market TEXT NOT NULL,
      direction TEXT NOT NULL CHECK (direction IN ('up', 'down')),
      confidence REAL NOT NULL,
      score REAL NOT NULL,
      return_15s REAL,
      return_30s REAL,
      return_60s REAL,
      open_price REAL NOT NULL,
      decision_price REAL NOT NULL,
      exit_price REAL NOT NULL,
      multiplier REAL NOT NULL,
      stake REAL NOT NULL,
      commission_rate REAL NOT NULL,
      estimated_net REAL NOT NULL,
      won INTEGER NOT NULL CHECK (won IN (0, 1))
    );
    CREATE INDEX IF NOT EXISTS idx_momentum_research_completed ON momentum_research(completed_at DESC);
    CREATE INDEX IF NOT EXISTS idx_momentum_research_symbol ON momentum_research(symbol, completed_at DESC);
    CREATE TABLE IF NOT EXISTS pattern_stats (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      market TEXT NOT NULL,
      prev_digit INTEGER NOT NULL,
      next_digit INTEGER NOT NULL,
      count INTEGER NOT NULL,
      frequency REAL NOT NULL,
      expected REAL NOT NULL,
      lift REAL NOT NULL,
      window INTEGER NOT NULL DEFAULT 5000,
      scanned_at INTEGER,
      UNIQUE(market, prev_digit, next_digit, window)
    );
    CREATE INDEX IF NOT EXISTS idx_pattern_stats_market ON pattern_stats(market);
    CREATE INDEX IF NOT EXISTS idx_digits_market_id ON digits(market, id DESC);
  `);

  // Migration: add exit detail columns if missing
  const cols = new Set(
    (d.prepare(`PRAGMA table_info(trades)`).all() as Array<{ name: string }>).map((c) => c.name),
  );
  if (!cols.has('entry_spot')) d.exec(`ALTER TABLE trades ADD COLUMN entry_spot REAL`);
  if (!cols.has('entry_digit')) d.exec(`ALTER TABLE trades ADD COLUMN entry_digit INTEGER`);
  if (!cols.has('exit_spot')) d.exec(`ALTER TABLE trades ADD COLUMN exit_spot REAL`);
  if (!cols.has('exit_digit')) d.exec(`ALTER TABLE trades ADD COLUMN exit_digit INTEGER`);
  if (!cols.has('resolved_at')) d.exec(`ALTER TABLE trades ADD COLUMN resolved_at INTEGER`);
  if (!cols.has('account_id')) d.exec(`ALTER TABLE trades ADD COLUMN account_id TEXT NOT NULL DEFAULT '__legacy__'`);
  if (!cols.has('account_mode')) d.exec(`ALTER TABLE trades ADD COLUMN account_mode TEXT NOT NULL DEFAULT 'unknown'`);
  if (!cols.has('origin')) d.exec(`ALTER TABLE trades ADD COLUMN origin TEXT NOT NULL DEFAULT 'bot'`);
  d.exec(`UPDATE trades SET account_id = '${LEGACY_ACCOUNT_ID}' WHERE account_id IS NULL OR account_id = ''`);
  d.exec(`CREATE INDEX IF NOT EXISTS idx_trades_account_id ON trades(account_id, id DESC)`);
  const ledgerCols = new Set(
    (d.prepare(`PRAGMA table_info(trade_ledger)`).all() as Array<{ name: string }>).map((c) => c.name),
  );
  if (!ledgerCols.has('entry_key')) {
    d.exec(`ALTER TABLE trade_ledger ADD COLUMN entry_key TEXT`);
    d.exec(`UPDATE trade_ledger SET entry_key = 'legacy:' || id WHERE entry_key IS NULL OR entry_key = ''`);
  }
  if (!ledgerCols.has('est_win')) d.exec(`ALTER TABLE trade_ledger ADD COLUMN est_win REAL`);
  d.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_trade_ledger_entry_key ON trade_ledger(entry_key)`);
  backfillTradeLedger(d);
  void cols;

  const settingsCols = new Set(
    (d.prepare(`PRAGMA table_info(settings)`).all() as Array<{ name: string }>).map((c) => c.name),
  );
  if (!settingsCols.has('strategy_mode')) d.exec(`ALTER TABLE settings ADD COLUMN strategy_mode TEXT`);
  if (!settingsCols.has('barrier_number')) d.exec(`ALTER TABLE settings ADD COLUMN barrier_number REAL`);
  if (!settingsCols.has('strategy_multiplier')) d.exec(`ALTER TABLE settings ADD COLUMN strategy_multiplier REAL`);
  if (!settingsCols.has('recovery_buffer')) d.exec(`ALTER TABLE settings ADD COLUMN recovery_buffer REAL`);
  if (!settingsCols.has('chase_amortize')) d.exec(`ALTER TABLE settings ADD COLUMN chase_amortize REAL`);
  if (!settingsCols.has('max_recovery_debt')) d.exec(`ALTER TABLE settings ADD COLUMN max_recovery_debt REAL`);
  if (!settingsCols.has('max_recovery_exposure')) d.exec(`ALTER TABLE settings ADD COLUMN max_recovery_exposure REAL`);
  if (!settingsCols.has('max_drawdown_pct')) d.exec(`ALTER TABLE settings ADD COLUMN max_drawdown_pct REAL`);
  if (!settingsCols.has('bot_mode')) d.exec(`ALTER TABLE settings ADD COLUMN bot_mode TEXT DEFAULT 'balanced'`);
  if (!settingsCols.has('pattern_weight')) d.exec(`ALTER TABLE settings ADD COLUMN pattern_weight REAL NOT NULL DEFAULT 0`);
  if (!settingsCols.has('pattern_weight_conservative')) d.exec(`ALTER TABLE settings ADD COLUMN pattern_weight_conservative REAL`);
  if (!settingsCols.has('pattern_weight_martingale')) d.exec(`ALTER TABLE settings ADD COLUMN pattern_weight_martingale REAL`);
  if (!settingsCols.has('pattern_weight_boosted_martingale')) d.exec(`ALTER TABLE settings ADD COLUMN pattern_weight_boosted_martingale REAL`);
  if (!settingsCols.has('pattern_weight_chase')) d.exec(`ALTER TABLE settings ADD COLUMN pattern_weight_chase REAL`);
  void settingsCols;

  const recoveryCols = new Set(
    (d.prepare(`PRAGMA table_info(recovery_state)`).all() as Array<{ name: string }>).map((c) => c.name),
  );
  if (!recoveryCols.has('debt')) d.exec(`ALTER TABLE recovery_state ADD COLUMN debt REAL DEFAULT 0`);
  if (!recoveryCols.has('attempts')) d.exec(`ALTER TABLE recovery_state ADD COLUMN attempts INTEGER DEFAULT 0`);
  if (!recoveryCols.has('cycle_stake')) d.exec(`ALTER TABLE recovery_state ADD COLUMN cycle_stake REAL DEFAULT 0`);
  if (!recoveryCols.has('peak_balance')) d.exec(`ALTER TABLE recovery_state ADD COLUMN peak_balance REAL DEFAULT 0`);
  void recoveryCols;

  const automationCols = new Set(
    (d.prepare(`PRAGMA table_info(automation)`).all() as Array<{ name: string }>).map((c) => c.name),
  );
  if (!automationCols.has('target_trades')) d.exec(`ALTER TABLE automation ADD COLUMN target_trades INTEGER DEFAULT 0`);
  if (!automationCols.has('trades_done')) d.exec(`ALTER TABLE automation ADD COLUMN trades_done INTEGER DEFAULT 0`);
  void automationCols;

  const runCols = new Set(
    (d.prepare(`PRAGMA table_info(test_runs)`).all() as Array<{ name: string }>).map((c) => c.name),
  );
  if (!runCols.has('source')) d.exec(`ALTER TABLE test_runs ADD COLUMN source TEXT NOT NULL DEFAULT 'manual'`);
  void runCols;

  // Earlier versions kept one global baseline and recovery row. Preserve it
  // explicitly as legacy data rather than attributing it to whichever account
  // happens to log in after this migration.
  d.exec(`
    INSERT OR IGNORE INTO account_performance_baselines (account_id, wins, losses, pushes, profit, reset_at)
    SELECT '${LEGACY_ACCOUNT_ID}', wins, losses, pushes, profit, reset_at FROM performance_baseline WHERE id = 1;
    INSERT OR IGNORE INTO account_recovery_state
      (account_id, mode, streak, debt, attempts, cycle_stake, peak_balance, last_win_epoch, updated_at)
    SELECT '${LEGACY_ACCOUNT_ID}', mode, streak, debt, attempts, cycle_stake, peak_balance, last_win_epoch, updated_at
      FROM recovery_state WHERE id = 1;
  `);
}

/** Build immutable lifecycle rows for contracts created before the ledger. */
function backfillTradeLedger(d: DatabaseSync): void {
  const source = "CASE WHEN origin IN ('manual', 'bot', 'paper') THEN origin WHEN reason = 'manual' THEN 'manual' ELSE 'bot' END";
  const mode = "CASE WHEN account_mode IN ('demo', 'real') THEN account_mode ELSE 'unknown' END";
  d.exec(`
    INSERT OR IGNORE INTO trade_ledger
      (entry_key, ts, book, account_id, account_mode, event, source, trade_id, contract_ref, market, contract_type,
       barrier, stake, payout, profit, status, reason, entry_spot, exit_spot, exit_digit)
    SELECT
      'account:' || id || ':requested', COALESCE(ts, 0), 'account', account_id, ${mode}, 'requested', ${source}, id,
      COALESCE(NULLIF(purchase_id, ''), 'trade:' || id), market, contract_type, barrier, stake, payout, 0, status,
      COALESCE(reason, ''), entry_spot, exit_spot, exit_digit
    FROM trades;

    INSERT OR IGNORE INTO trade_ledger
      (entry_key, ts, book, account_id, account_mode, event, source, trade_id, contract_ref, market, contract_type,
       barrier, stake, payout, profit, status, reason, entry_spot, exit_spot, exit_digit)
    SELECT
      'account:' || id || ':purchased', COALESCE(ts, 0), 'account', account_id, ${mode}, 'purchased', ${source}, id,
      contract_id, market, contract_type, barrier, stake, payout, 0, status,
      COALESCE(reason, ''), entry_spot, exit_spot, exit_digit
    FROM trades WHERE contract_id IS NOT NULL AND contract_id <> '';

    INSERT OR IGNORE INTO trade_ledger
      (entry_key, ts, book, account_id, account_mode, event, source, trade_id, contract_ref, market, contract_type,
       barrier, stake, payout, profit, status, reason, entry_spot, exit_spot, exit_digit)
    SELECT
      'account:' || id || ':settled', COALESCE(resolved_at, ts, 0), 'account', account_id, ${mode}, 'settled', ${source}, id,
      contract_id, market, contract_type, barrier, stake, payout, profit, status,
      COALESCE(reason, ''), entry_spot, exit_spot, exit_digit
    FROM trades
    WHERE status <> 'pending' AND contract_id IS NOT NULL AND contract_id <> '';
  `);
}

function seedDefaults(d: DatabaseSync): void {
  d.exec(`
INSERT OR IGNORE INTO recovery_state (id, mode, streak, lost, debt, attempts, cycle_stake, peak_balance, last_win_epoch, updated_at)
      VALUES (1, 'base', 0, 0, 0, 0, 0, 0, 0, 0);
    INSERT OR IGNORE INTO performance_baseline (id, wins, losses, pushes, profit, reset_at)
      VALUES (1, 0, 0, 0, 0, 0);
    INSERT OR IGNORE INTO settings (id, base_stake, max_stake, martingale_steps,
      max_consecutive_losses, min_edge, min_recovery_win, barrier_preference,
      barrier_number, strategy_mode, bot_mode, strategy_multiplier, recovery_buffer, chase_amortize,
      max_recovery_debt, max_recovery_exposure, max_drawdown_pct)
      VALUES (1, ${config.baseStake}, ${config.maxStake}, ${config.martingaleSteps},
        ${config.maxConsecutiveLosses}, ${config.minEdge},
        ${config.minRecoveryWinRate}, '${config.barrierPreference}', ${config.barrierNumber},
        '${config.strategyMode}', '${config.botMode}',
        ${config.strategyMultiplier}, ${config.recoveryBuffer}, ${config.chaseAmortize},
        ${config.maxRecoveryDebt}, ${config.maxRecoveryExposure},
        ${config.maxDrawdownPct});
    INSERT OR IGNORE INTO automation (id, running, armed_until, started_at, stopped_at, reason,
      target_trades, trades_done)
      VALUES (1, 0, 0, 0, 0, '', 0, 0);
  `);
}

export function getSettings(): SettingsRow {
  const row = getDb()
    .prepare('SELECT * FROM settings WHERE id = 1')
    .get() as unknown as Record<string, unknown>;
  const rawMode = String(row.strategy_mode ?? 'conservative');
  const strategy_mode =
    rawMode === 'martingale' || rawMode === 'boosted_martingale' || rawMode === 'chase' || rawMode === 'conservative'
      ? rawMode
      : 'conservative';
  const rawPref = String(row.barrier_preference ?? 'auto');
  const barrier_preference =
    rawPref === 'auto' || rawPref === 'over' || rawPref === 'under'
      ? rawPref
      : rawPref.startsWith('over')
        ? 'over'
        : rawPref.startsWith('under')
          ? 'under'
          : 'auto';
  const legacyMatch = rawPref.match(/(\d+)/);
  const storedBarrier = Number(row.barrier_number ?? NaN);
  const barrier_number = Number.isFinite(storedBarrier)
    ? storedBarrier
    : legacyMatch
      ? Number(legacyMatch[1])
      : barrier_preference === 'under'
        ? 9
        : 0;
  const numOrNull = (k: string): number | null => {
    const v = (row as Record<string, unknown>)[k];
    if (v == null || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  return {
    base_stake: Number(row.base_stake),
    max_stake: Number(row.max_stake),
    martingale_steps: Number(row.martingale_steps),
    max_consecutive_losses: Number(row.max_consecutive_losses),
    min_edge: Number(row.min_edge),
    min_recovery_win: Number(row.min_recovery_win),
    barrier_preference,
    barrier_number,
    strategy_mode,
    bot_mode: ['rapid', 'balanced', 'strict'].includes(String(row.bot_mode)) ? String(row.bot_mode) : 'balanced',
    strategy_multiplier: Number(row.strategy_multiplier ?? 3),
    recovery_buffer: Number(row.recovery_buffer ?? 0.5),
    chase_amortize: Number(row.chase_amortize ?? 0.35),
    max_recovery_debt: Number(row.max_recovery_debt ?? 50),
    max_recovery_exposure: Number(row.max_recovery_exposure ?? 100),
    max_drawdown_pct: Number(row.max_drawdown_pct ?? 20),
    pattern_weight: Number(row.pattern_weight ?? 0),
    pattern_weight_conservative: numOrNull('pattern_weight_conservative'),
    pattern_weight_martingale: numOrNull('pattern_weight_martingale'),
    pattern_weight_boosted_martingale: numOrNull('pattern_weight_boosted_martingale'),
    pattern_weight_chase: numOrNull('pattern_weight_chase'),
  };
}

export function updateSettings(patch: Partial<SettingsRow>): SettingsRow {
  const cur = getSettings();
  const next = { ...cur, ...patch };
  getDb()
    .prepare(
      `UPDATE settings SET base_stake=?, max_stake=?, martingale_steps=?, max_consecutive_losses=?,
       min_edge=?, min_recovery_win=?, barrier_preference=?, barrier_number=?,
       strategy_mode=?, bot_mode=?,
       strategy_multiplier=?, recovery_buffer=?, chase_amortize=?, max_recovery_debt=?, max_recovery_exposure=?, max_drawdown_pct=?, pattern_weight=?, pattern_weight_conservative=?, pattern_weight_martingale=?, pattern_weight_boosted_martingale=?, pattern_weight_chase=? WHERE id=1`,
    )
    .run(
      next.base_stake,
      next.max_stake,
      next.martingale_steps,
      next.max_consecutive_losses,
      next.min_edge,
      next.min_recovery_win,
      next.barrier_preference,
      next.barrier_number,
      next.strategy_mode,
      next.bot_mode,
      next.strategy_multiplier,
      next.recovery_buffer,
      next.chase_amortize,
      next.max_recovery_debt,
      next.max_recovery_exposure,
      next.max_drawdown_pct,
      next.pattern_weight,
      next.pattern_weight_conservative,
      next.pattern_weight_martingale,
      next.pattern_weight_boosted_martingale,
      next.pattern_weight_chase,
    );
  return next;
}

export function accountIdForLogin(loginid: string | null | undefined): string {
  return loginid ? `deriv:${loginid}` : LOCAL_ACCOUNT_ID;
}

function currentAccountId(): string {
  return accountIdForLogin(getSession()?.loginid);
}

function ensureAccountState(accountId = currentAccountId()): void {
  const db = getDb();
  db.prepare(
    `INSERT OR IGNORE INTO account_recovery_state
      (account_id, mode, streak, debt, attempts, cycle_stake, peak_balance, last_win_epoch, updated_at)
     VALUES (?, 'base', 0, 0, 0, 0, 0, 0, 0)`,
  ).run(accountId);
  db.prepare(
    `INSERT OR IGNORE INTO account_performance_baselines
      (account_id, wins, losses, pushes, profit, reset_at)
     VALUES (?, 0, 0, 0, 0, 0)`,
  ).run(accountId);
}

export function getRecovery(accountId = currentAccountId()): RecoveryState {
  ensureAccountState(accountId);
  const row = getDb()
    .prepare('SELECT * FROM account_recovery_state WHERE account_id = ?')
    .get(accountId) as unknown as Record<string, unknown>;
  return {
    mode: row.mode as RecoveryState['mode'],
    streak: Number(row.streak),
    debt: Number(row.debt ?? row.lost ?? 0),
    attempts: Number(row.attempts ?? 0),
    cycleStake: Number(row.cycle_stake ?? 0),
    peakBalance: Number(row.peak_balance ?? 0),
    last_win_epoch: Number(row.last_win_epoch),
    updated_at: Number(row.updated_at),
  };
}

export function saveRecovery(r: RecoveryState, accountId = currentAccountId()): void {
  ensureAccountState(accountId);
  getDb()
    .prepare(
      `UPDATE account_recovery_state
       SET mode=?, streak=?, debt=?, attempts=?, cycle_stake=?, peak_balance=?, last_win_epoch=?, updated_at=?
       WHERE account_id=?`,
    )
    .run(r.mode, r.streak, r.debt, r.attempts, r.cycleStake, r.peakBalance, r.last_win_epoch, Date.now(), accountId);
}

export function resetRecovery(accountId = currentAccountId()): void {
  saveRecovery({
    mode: 'base',
    streak: 0,
    debt: 0,
    attempts: 0,
    cycleStake: 0,
    peakBalance: getRecovery(accountId).peakBalance,
    last_win_epoch: Date.now(),
    updated_at: Date.now(),
  }, accountId);
}

export function recordQuote(
  market: string,
  direction: string,
  barrier: number,
  ratio: number,
): void {
  if (!Number.isFinite(ratio) || ratio <= 0) return;
  try {
    getDb()
      .prepare(
        `INSERT INTO quote_stats (market, direction, barrier, samples, sum_ratio, min_ratio, max_ratio, updated_at)
         VALUES (?, ?, ?, 1, ?, ?, ?, ?)
         ON CONFLICT(market, direction, barrier) DO UPDATE SET
           samples = samples + 1,
           sum_ratio = sum_ratio + excluded.sum_ratio,
           min_ratio = MIN(min_ratio, excluded.min_ratio),
           max_ratio = MAX(max_ratio, excluded.max_ratio),
           updated_at = excluded.updated_at`,
      )
      .run(market, direction, barrier, ratio, ratio, ratio, Date.now());
  } catch {
    // best-effort: quote observations must never break the trade loop
  }
}

export interface ScannerLogRow {
  trade_id: number;
  ts: number;
  market: string;
  direction: string;
  barrier: number;
  est_win: number;
  ask: number;
  payout: number;
  ratio: number;
  breakeven: number;
  edge: number;
  prev_digit: number | null;
  consistency: number;
  entropy: number;
  momentum: number;
}

export function insertScannerLog(t: ScannerLogRow): number {
  const info = getDb()
    .prepare(
      `INSERT INTO scanner_logs (trade_id, ts, market, direction, barrier, est_win, ask, payout,
        ratio, breakeven, edge, prev_digit, consistency, entropy, momentum)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      t.trade_id,
      t.ts,
      t.market,
      t.direction,
      t.barrier,
      t.est_win,
      t.ask,
      t.payout,
      t.ratio,
      t.breakeven,
      t.edge,
      t.prev_digit,
      t.consistency,
      t.entropy,
      t.momentum,
    );
  return Number(info.lastInsertRowid);
}

export function updateScannerLogResult(tradeId: number, result: string, profit: number): void {
  try {
    getDb()
      .prepare('UPDATE scanner_logs SET result = ?, profit = ? WHERE trade_id = ?')
      .run(result, profit, tradeId);
  } catch {
    // best-effort calibration bookkeeping
  }
}

export interface CalibrationBucket {
  bucket: string;
  lo: number;
  hi: number;
  n: number;
  wins: number;
  rate: number | null;
}

const CALIB_BUCKET = 0.02;

export function getCalibration(): { buckets: CalibrationBucket[]; total: number } {
  const rows = getDb()
    .prepare(
      `SELECT est_win AS e, result AS r, profit AS p FROM scanner_logs
       WHERE est_win IS NOT NULL AND result IN ('won','lost')`,
    )
    .all() as unknown as Array<{ e: number; r: string; p: number }>;
  const width = CALIB_BUCKET;
  const map = new Map<number, { n: number; wins: number; profit: number }>();
  for (const row of rows) {
    const bucket = Math.floor(row.e / width) * width;
    const b = map.get(bucket) ?? { n: 0, wins: 0, profit: 0 };
    b.n += 1;
    if (row.r === 'won') b.wins += 1;
    b.profit += row.p ?? 0;
    map.set(bucket, b);
  }
  const buckets: CalibrationBucket[] = [...map.entries()]
    .map(([lo, b]) => ({
      bucket: `${(lo * 100).toFixed(0)}–${((lo + width) * 100).toFixed(0)}%`,
      lo,
      hi: lo + width,
      n: b.n,
      wins: b.wins,
      rate: b.n > 0 ? b.wins / b.n : null,
    }))
    .sort((a, b) => a.lo - b.lo);
  const total = rows.length;
  return { buckets, total };
}

export interface BarrierCalibrationRow {
  market: string;
  direction: string;
  barrier: number;
  trades: number;
  wins: number;
  win_rate: number | null;
}

export function scannerStatsByBarrier(): BarrierCalibrationRow[] {
  return getDb()
    .prepare(
      `SELECT market, direction, barrier,
              COUNT(*) AS trades,
              SUM(CASE WHEN result = 'won' THEN 1 ELSE 0 END) AS wins,
              AVG(CASE WHEN result IN ('won','lost') THEN CASE WHEN result = 'won' THEN 1.0 ELSE 0.0 END END) AS win_rate
       FROM scanner_logs
       WHERE result IN ('won','lost')
       GROUP BY market, direction, barrier
       ORDER BY trades DESC`,
    )
    .all() as unknown as BarrierCalibrationRow[];
}

export function getQuoteStats(market?: string): Array<Record<string, unknown>> {
  const sql = market
    ? 'SELECT * FROM quote_stats WHERE market = ? ORDER BY barrier'
    : 'SELECT * FROM quote_stats ORDER BY market, barrier';
  return (market ? getDb().prepare(sql).all(market) : getDb().prepare(sql).all()) as Array<Record<string, unknown>>;
}

export function getAutomation(): AutomationRow {
  const row = getDb().prepare('SELECT * FROM automation WHERE id = 1').get() as unknown as Record<string, unknown>;
  return {
    running: Number(row.running),
    armed_until: Number(row.armed_until),
    started_at: Number(row.started_at),
    stopped_at: Number(row.stopped_at),
    reason: String(row.reason),
    target_trades: Number(row.target_trades ?? 0),
    trades_done: Number(row.trades_done ?? 0),
  };
}

export function setAutomation(patch: Partial<AutomationRow>): AutomationRow {
  const cur = getAutomation();
  const next = { ...cur, ...patch };
  getDb()
    .prepare(
      'UPDATE automation SET running=?, armed_until=?, started_at=?, stopped_at=?, reason=?, target_trades=?, trades_done=? WHERE id=1',
    )
    .run(next.running, next.armed_until, next.started_at, next.stopped_at, next.reason, next.target_trades, next.trades_done);
  return next;
}

export function getSession(): SessionRow | null {
  const row = getDb().prepare('SELECT * FROM sessions LIMIT 1').get();
  if (!row) return null;
  return row as unknown as SessionRow;
}

export function setSession(s: SessionRow): void {
  getDb().prepare('DELETE FROM sessions').run();
  getDb()
    .prepare(
      `INSERT INTO sessions (id, loginid, balance, currency, mode, auth_kind, token_cipher, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(s.id, s.loginid, s.balance, s.currency, s.mode, s.auth_kind, s.token_cipher, s.created_at, s.updated_at);
}

export function updateSessionBalance(balance: number): void {
  const s = getSession();
  if (!s) return;
  getDb()
    .prepare('UPDATE sessions SET balance=?, updated_at=? WHERE id=?')
    .run(balance, Date.now(), s.id);
}

export function updateSessionToken(cipher: string): void {
  const s = getSession();
  if (!s) return;
  getDb()
    .prepare('UPDATE sessions SET token_cipher=?, updated_at=? WHERE id=?')
    .run(cipher, Date.now(), s.id);
}

export function clearSession(): void {
  getDb().prepare('DELETE FROM sessions').run();
}

export function upsertMarket(symbol: string, display: string): void {
  getDb()
    .prepare('INSERT OR IGNORE INTO markets (symbol, display, active, updated_at) VALUES (?, ?, 1, ?)')
    .run(symbol, display, Date.now());
}

export function touchMarket(symbol: string, quote: number, epoch: number, digit: number): void {
  getDb()
    .prepare('UPDATE markets SET last_quote=?, last_epoch=?, last_digit=?, updated_at=? WHERE symbol=?')
    .run(quote, epoch, digit, Date.now(), symbol);
}

export function listMarkets(): Array<Record<string, unknown>> {
  return getDb().prepare('SELECT * FROM markets ORDER BY symbol').all() as unknown as Array<Record<string, unknown>>;
}

export function insertDigit(market: string, epoch: number, quote: number, digit: number): void {
  try {
    getDb()
      .prepare('INSERT OR IGNORE INTO digits (market, epoch, quote, digit) VALUES (?, ?, ?, ?)')
      .run(market, epoch, quote, digit);
  } catch {
    // contention guard: a busy write must never break the feed
  }
}

export function digitDistribution(market: string, limit: number): Array<{ digit: number; count: number }> {
  const rows = getDb()
    .prepare('SELECT digit, COUNT(*) AS c FROM digits WHERE market = ? ORDER BY id DESC LIMIT ?')
    .all(market, limit) as unknown as Array<{ digit: number; c: number }>;
  const dist = Array.from({ length: 10 }, (_, d) => ({ digit: d, count: 0 }));
  for (const r of rows) dist[r.digit].count += r.c;
  return dist;
}

export function insertTrade(t: Omit<TradeRow, 'id' | 'resolved_at'> & { resolved_at?: number }): TradeRow {
  const accountId = currentAccountId();
  const accountMode: TradeRow['account_mode'] = getSession()?.mode ?? 'unknown';
  const info = getDb()
    .prepare(
      `INSERT INTO trades (account_id, account_mode, ts, market, contract_type, barrier, duration, duration_unit, stake,
        ask_price, payout, est_win, profit, status, contract_id, purchase_id, reason, origin, resolved_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      accountId,
      accountMode,
      t.ts,
      t.market,
      t.contract_type,
      t.barrier,
      t.duration,
      t.duration_unit,
      t.stake,
      t.ask_price,
      t.payout,
      t.est_win,
      t.profit,
      t.status,
      t.contract_id,
      t.purchase_id,
      t.reason,
      t.origin ?? (t.reason === 'manual' ? 'manual' : 'bot'),
      t.resolved_at ?? null,
    );
  const row = getDb()
    .prepare('SELECT * FROM trades WHERE id = ?')
    .get(Number(info.lastInsertRowid)) as unknown as TradeRow;
  appendAccountLedgerEntrySafely(row, 'requested');
  return row;
}

export function getTrade(id: number, accountId = currentAccountId()): TradeRow | null {
  const row = getDb().prepare('SELECT * FROM trades WHERE id = ? AND account_id = ?').get(id, accountId);
  return row ? (row as unknown as TradeRow) : null;
}

export function getTradeByContractId(contractId: string, accountId = currentAccountId()): TradeRow | null {
  const row = getDb().prepare('SELECT * FROM trades WHERE contract_id = ? AND account_id = ?').get(contractId, accountId);
  return row ? (row as unknown as TradeRow) : null;
}

export function getOpenTrade(accountId = currentAccountId()): TradeRow | null {
  const row = getDb()
    .prepare("SELECT * FROM trades WHERE account_id = ? AND status IN ('purchasing', 'pending') ORDER BY id DESC LIMIT 1")
    .get(accountId);
  return row ? (row as unknown as TradeRow) : null;
}

export function getPendingTrades(accountId = currentAccountId()): TradeRow[] {
  return getDb()
    .prepare("SELECT * FROM trades WHERE account_id = ? AND status = 'pending' ORDER BY id ASC")
    .all(accountId) as unknown as TradeRow[];
}

export function resolveTrade(
  id: number,
  status: TradeRow['status'],
  profit: number,
  contractId: string,
  extra?: { entrySpot?: number; entryDigit?: number; exitSpot?: number; exitDigit?: number },
  accountId = currentAccountId(),
): void {
  const before = getTrade(id, accountId);
  if (!before) return;
  // Settlement callbacks can be replayed after reconnect. Preserve the first
  // terminal result so both the trade row and immutable ledger stay aligned.
  if (before.status !== 'pending' && before.status !== 'purchasing') return;
  getDb()
    .prepare(
      `UPDATE trades SET status=?, profit=?, contract_id=?, resolved_at=?,
        entry_spot=COALESCE(?, entry_spot), entry_digit=COALESCE(?, entry_digit), exit_spot=?, exit_digit=? WHERE id=? AND account_id=?`,
    )
    .run(
      status,
      profit,
      contractId,
      Date.now(),
      extra?.entrySpot ?? null,
      extra?.entryDigit ?? null,
      extra?.exitSpot ?? null,
      extra?.exitDigit ?? null,
      id,
      accountId,
    );
  const settled = getTrade(id, accountId);
  if (settled) appendAccountLedgerEntrySafely(settled, 'settled');
  updateScannerLogResult(id, status, profit);
}

export function markTradePurchased(
  id: number,
  contractId: string,
  stake: number,
  payout: number,
  accountId = currentAccountId(),
  entrySpot?: number,
  entryDigit?: number,
): void {
  const before = getTrade(id, accountId);
  if (!before) return;
  getDb()
    .prepare("UPDATE trades SET contract_id=?, stake=?, ask_price=?, payout=?, status='pending', entry_spot=COALESCE(entry_spot, ?), entry_digit=COALESCE(entry_digit, ?) WHERE id=? AND account_id=?")
    .run(contractId, stake, stake, payout, typeof entrySpot === 'number' && Number.isFinite(entrySpot) ? entrySpot : null, typeof entryDigit === 'number' && Number.isInteger(entryDigit) ? entryDigit : null, id, accountId);
  if (!before.contract_id && contractId) {
    const purchased = getTrade(id, accountId);
    if (purchased) appendAccountLedgerEntrySafely(purchased, 'purchased');
  }
}

export function listTrades(limit = 50, accountId = currentAccountId()): TradeRow[] {
  return getDb()
    .prepare('SELECT * FROM trades WHERE account_id = ? ORDER BY id DESC LIMIT ?')
    .all(accountId, limit) as unknown as TradeRow[];
}

function normalizeAccountMode(mode: TradeRow['account_mode']): LedgerEntryRow['account_mode'] {
  return mode === 'demo' || mode === 'real' ? mode : 'unknown';
}

/** Append an immutable account lifecycle entry. This never mutates balances. */
function appendAccountLedgerEntry(
  trade: TradeRow,
  event: Extract<LedgerEntryRow['event'], 'requested' | 'purchased' | 'settled'>,
): LedgerEntryRow {
  const contractRef = trade.contract_id || trade.purchase_id || `trade:${trade.id}`;
  getDb()
    .prepare(
      `INSERT OR IGNORE INTO trade_ledger
       (entry_key, ts, book, account_id, account_mode, event, source, trade_id, contract_ref, market, contract_type,
        barrier, stake, payout, profit, status, reason, entry_spot, exit_spot, exit_digit, est_win)
       VALUES (?, ?, 'account', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      `account:${trade.id}:${event}`,
      event === 'settled' ? (trade.resolved_at || Date.now()) : trade.ts,
      trade.account_id ?? currentAccountId(),
      normalizeAccountMode(trade.account_mode),
      event,
      trade.origin ?? (trade.reason === 'manual' ? 'manual' : 'bot'),
      trade.id,
      contractRef,
      trade.market,
      trade.contract_type,
      trade.barrier,
      trade.stake,
      trade.payout,
      event === 'settled' ? trade.profit : 0,
      trade.status,
      trade.reason,
      trade.entry_spot ?? null,
      trade.exit_spot ?? null,
      trade.exit_digit ?? null,
      trade.est_win ?? null,
    );
  return getDb().prepare('SELECT * FROM trade_ledger WHERE entry_key = ?').get(`account:${trade.id}:${event}`) as unknown as LedgerEntryRow;
}

/** Audit persistence must never block a Deriv order or settlement. */
function appendAccountLedgerEntrySafely(
  trade: TradeRow,
  event: Extract<LedgerEntryRow['event'], 'requested' | 'purchased' | 'settled'>,
): LedgerEntryRow | null {
  try {
    return appendAccountLedgerEntry(trade, event);
  } catch (err) {
    console.warn(`[ledger] failed to record account ${event} for trade ${trade.id}: ${String(err)}`);
    return null;
  }
}

/**
 * Record a virtual contract event. It intentionally has no account scope and
 * cannot affect account P&L, balances, recovery, tuning, or execution.
 */
export function appendPaperLedgerEntry(
  contract: PaperLedgerContract,
  event: Extract<LedgerEntryRow['event'], 'purchased' | 'settled' | 'cancelled'>,
  reason = '',
): LedgerEntryRow {
  const status = event === 'purchased' ? 'open' : contract.status;
  const ts = event === 'purchased'
    ? contract.entryEpoch * 1_000
    : contract.exitEpoch !== undefined ? contract.exitEpoch * 1_000 : Date.now();
  getDb()
    .prepare(
      `INSERT OR IGNORE INTO trade_ledger
       (entry_key, ts, book, account_id, account_mode, event, source, trade_id, contract_ref, market, contract_type,
        barrier, stake, payout, profit, status, reason, entry_spot, exit_spot, exit_digit, est_win)
       VALUES (?, ?, 'paper', NULL, 'not_applicable', ?, 'paper', NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      `paper:${contract.runId}:${contract.id}:${event}`,
      ts,
      event,
      `paper:${contract.runId}:${contract.id}`,
      contract.market,
      contract.direction === 'over' ? 'DIGITOVER' : 'DIGITUNDER',
      contract.barrier,
      contract.stake,
      Math.round(contract.stake * contract.payoutRatio * 100) / 100,
      event === 'settled' ? (contract.profit ?? 0) : 0,
      status,
      reason || 'virtual research contract; assumed payout only',
      contract.entryQuote,
      contract.exitQuote ?? null,
      contract.exitDigit ?? null,
      contract.estWin ?? null,
    );
  return getDb()
    .prepare('SELECT * FROM trade_ledger WHERE entry_key = ?')
    .get(`paper:${contract.runId}:${contract.id}:${event}`) as unknown as LedgerEntryRow;
}

/**
 * Persist the scanner configuration that opened a virtual position. Context is
 * insert-only: later setting changes must never rewrite historical evidence.
 */
export function appendPaperTradeContext(
  contract: Pick<PaperLedgerContract, 'id' | 'runId' | 'entryEpoch'>,
  context: PaperTradeContextInput,
): PaperTradeContextRow {
  const contractRef = `paper:${contract.runId}:${contract.id}`;
  getDb().prepare(
    `INSERT OR IGNORE INTO paper_trade_context
      (contract_ref, opened_at, strategy_mode, bot_mode, candidate_reason, signal_id, signal_at, evidence_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    contractRef,
    contract.entryEpoch * 1_000,
    context.strategyMode || 'configured_scanner',
    context.botMode || 'configured_mode',
    context.candidateReason || 'shared scanner candidate',
    context.signalId || '',
    typeof context.signalAt === 'number' && Number.isFinite(context.signalAt) ? context.signalAt : null,
    JSON.stringify(context.evidence ?? {}),
  );
  return getDb().prepare('SELECT * FROM paper_trade_context WHERE contract_ref = ?').get(contractRef) as unknown as PaperTradeContextRow;
}

/** Paper research telemetry must never interrupt a public feed callback. */
export function appendPaperTradeContextSafely(
  contract: Pick<PaperLedgerContract, 'id' | 'runId' | 'entryEpoch'>,
  context: PaperTradeContextInput,
): PaperTradeContextRow | null {
  try {
    return appendPaperTradeContext(contract, context);
  } catch (err) {
    console.warn(`[paper-ledger] failed to record strategy context: ${String(err)}`);
    return null;
  }
}

/** Paper research telemetry must never interrupt a public feed callback. */
export function appendPaperLedgerEntrySafely(
  contract: PaperLedgerContract,
  event: Extract<LedgerEntryRow['event'], 'purchased' | 'settled' | 'cancelled'>,
  reason = '',
): LedgerEntryRow | null {
  try {
    return appendPaperLedgerEntry(contract, event, reason);
  } catch (err) {
    console.warn(`[paper-ledger] failed to record ${event}: ${String(err)}`);
    return null;
  }
}

/** Current-account financial events only. */
export function listLedgerEntries(limit = 100, accountId = currentAccountId()): LedgerEntryRow[] {
  return getDb()
    .prepare(
      `SELECT * FROM trade_ledger
       WHERE book = 'account' AND account_id = ?
       ORDER BY id DESC LIMIT ?`,
    )
    .all(accountId, limit) as unknown as LedgerEntryRow[];
}

/**
 * Queue feed telemetry for a short batched transaction. Unlike execution and
 * settlement writes, digit history is research data and must not block the
 * live tick callback on a synchronous SQLite commit for every market update.
 */
export function enqueueDigit(market: string, epoch: number, quote: number, digit: number): void {
  pendingDigits.push({ market, epoch, quote, digit });
  if (pendingDigits.length > DIGIT_QUEUE_LIMIT) {
    pendingDigits.splice(0, pendingDigits.length - DIGIT_QUEUE_LIMIT);
  }
  if (digitFlushTimer) return;
  digitFlushTimer = setTimeout(() => flushDigitQueue(), DIGIT_FLUSH_DELAY_MS);
  digitFlushTimer.unref();
}

/** Flush queued research ticks synchronously; used by the timer and shutdown. */
export function flushDigitQueue(): number {
  if (digitFlushTimer) {
    clearTimeout(digitFlushTimer);
    digitFlushTimer = null;
  }
  if (digitFlushActive || pendingDigits.length === 0) return 0;

  digitFlushActive = true;
  const batch = pendingDigits;
  pendingDigits = [];
  const database = getDb();
  try {
    const insert = database.prepare('INSERT OR IGNORE INTO digits (market, epoch, quote, digit) VALUES (?, ?, ?, ?)');
    database.exec('BEGIN IMMEDIATE');
    for (const item of batch) insert.run(item.market, item.epoch, item.quote, item.digit);
    database.exec('COMMIT');
    return batch.length;
  } catch {
    try { database.exec('ROLLBACK'); } catch { /* no active transaction */ }
    // Preserve telemetry for a later retry without ever failing the feed.
    pendingDigits = [...batch, ...pendingDigits].slice(-DIGIT_QUEUE_LIMIT);
    if (!digitFlushTimer) {
      digitFlushTimer = setTimeout(() => flushDigitQueue(), DIGIT_FLUSH_DELAY_MS * 5);
      digitFlushTimer.unref();
    }
    return 0;
  } finally {
    digitFlushActive = false;
  }
}

export function pendingDigitCount(): number {
  return pendingDigits.length;
}

/** Virtual paper lifecycle only; never joins an account book. */
export function listPaperLedgerEntries(limit = 100): LedgerEntryRow[] {
  return getDb()
    .prepare("SELECT * FROM trade_ledger WHERE book = 'paper' ORDER BY id DESC LIMIT ?")
    .all(limit) as unknown as LedgerEntryRow[];
}

function possiblePaperOutcomes(stake: number, payout: number): PaperTradeSummary['possible_outcomes'] {
  const safeStake = Number.isFinite(stake) ? stake : 0;
  const safePayout = Number.isFinite(payout) ? payout : 0;
  return {
    won: { profit: Math.round((safePayout - safeStake) * 100) / 100, payout: safePayout },
    lost: { profit: -Math.round(safeStake * 100) / 100 },
  };
}

function paperTradeStrategyContext(row: PaperTradeContextRow | undefined): PaperTradeStrategyContext | null {
  if (!row) return null;
  let evidence: Record<string, number | null> = {};
  try {
    const parsed = JSON.parse(row.evidence_json) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      evidence = Object.fromEntries(
        Object.entries(parsed).filter(([, value]) => value === null || (typeof value === 'number' && Number.isFinite(value))),
      );
    }
  } catch { /* historical context can remain readable even if malformed */ }
  const { evidence_json: _ignored, ...context } = row;
  return { ...context, evidence };
}

function paperTradeSummary(
  row: LedgerEntryRow & { opened_at: number; updated_at: number },
  context?: PaperTradeContextRow,
): PaperTradeSummary {
  return {
    contract_ref: row.contract_ref,
    opened_at: row.opened_at,
    updated_at: row.updated_at,
    market: row.market,
    contract_type: row.contract_type,
    direction: row.contract_type === 'DIGITOVER' ? 'over' : 'under',
    barrier: row.barrier,
    stake: row.stake,
    payout: row.payout,
    est_win: row.est_win,
    status: row.status,
    profit: row.profit,
    entry_spot: row.entry_spot,
    exit_spot: row.exit_spot,
    exit_digit: row.exit_digit,
    strategy: paperTradeStrategyContext(context),
    possible_outcomes: possiblePaperOutcomes(row.stake, row.payout),
  };
}

/** Logical virtual contracts, grouped independently from their lifecycle rows. */
export function listPaperTrades(limit = 100): PaperTradeSummary[] {
  const rows = getDb().prepare(
    `SELECT latest.*, grouped.opened_at, grouped.updated_at
     FROM (
       SELECT contract_ref, MIN(ts) AS opened_at, MAX(ts) AS updated_at, MAX(id) AS latest_id
       FROM trade_ledger WHERE book = 'paper' GROUP BY contract_ref
     ) grouped
     JOIN trade_ledger latest ON latest.id = grouped.latest_id
     ORDER BY grouped.updated_at DESC, latest.id DESC LIMIT ?`,
  ).all(limit) as unknown as Array<LedgerEntryRow & { opened_at: number; updated_at: number }>;
  if (!rows.length) return [];
  const refs = rows.map((row) => row.contract_ref);
  const placeholders = refs.map(() => '?').join(',');
  const contexts = getDb().prepare(`SELECT * FROM paper_trade_context WHERE contract_ref IN (${placeholders})`)
    .all(...refs) as unknown as PaperTradeContextRow[];
  const byRef = new Map(contexts.map((context) => [context.contract_ref, context]));
  return rows.map((row) => paperTradeSummary(row, byRef.get(row.contract_ref)));
}

export function getPaperTrade(contractRef: string): (PaperTradeSummary & { lifecycle: LedgerEntryRow[] }) | null {
  const entries = getDb().prepare(
    `SELECT * FROM trade_ledger WHERE book = 'paper' AND contract_ref = ? ORDER BY id ASC`,
  ).all(contractRef) as unknown as LedgerEntryRow[];
  if (!entries.length) return null;
  const openedAt = Math.min(...entries.map((entry) => entry.ts));
  const updatedAt = Math.max(...entries.map((entry) => entry.ts));
  const latest = entries[entries.length - 1];
  const context = getDb().prepare('SELECT * FROM paper_trade_context WHERE contract_ref = ?')
    .get(contractRef) as unknown as PaperTradeContextRow | undefined;
  return { ...paperTradeSummary({ ...latest, opened_at: openedAt, updated_at: updatedAt }, context), lifecycle: entries };
}

interface PerformanceTotals {
  wins: number;
  losses: number;
  pushes: number;
  profit: number;
}

function getPerformanceTotals(accountId = currentAccountId()): PerformanceTotals {
  const row = getDb()
    .prepare(
      `SELECT
        COALESCE(SUM(CASE WHEN status = 'won' THEN 1 ELSE 0 END), 0) AS wins,
        COALESCE(SUM(CASE WHEN status = 'lost' THEN 1 ELSE 0 END), 0) AS losses,
        COALESCE(SUM(CASE WHEN status IN ('push', 'expired', 'timeout') THEN 1 ELSE 0 END), 0) AS pushes,
        COALESCE(SUM(CASE WHEN status IN ('won', 'lost', 'push', 'expired', 'timeout') THEN profit ELSE 0 END), 0) AS profit
       FROM trades WHERE account_id = ?`,
    )
    .get(accountId) as unknown as PerformanceTotals;
  return {
    wins: Number(row.wins) || 0,
    losses: Number(row.losses) || 0,
    pushes: Number(row.pushes) || 0,
    profit: Number(row.profit) || 0,
  };
}

export function getPerformanceSummary(accountId = currentAccountId()): PerformanceSummary {
  ensureAccountState(accountId);
  const totals = getPerformanceTotals(accountId);
  const baseline = getDb()
    .prepare('SELECT wins, losses, pushes, profit, reset_at FROM account_performance_baselines WHERE account_id = ?')
    .get(accountId) as unknown as PerformanceSummary;
  return {
    wins: Math.max(0, totals.wins - Number(baseline.wins || 0)),
    losses: Math.max(0, totals.losses - Number(baseline.losses || 0)),
    pushes: Math.max(0, totals.pushes - Number(baseline.pushes || 0)),
    profit: totals.profit - Number(baseline.profit || 0),
    reset_at: Number(baseline.reset_at || 0),
  };
}

export function resetPerformanceSummary(accountId = currentAccountId()): PerformanceSummary {
  ensureAccountState(accountId);
  const totals = getPerformanceTotals(accountId);
  const resetAt = Date.now();
  getDb()
    .prepare('UPDATE account_performance_baselines SET wins=?, losses=?, pushes=?, profit=?, reset_at=? WHERE account_id=?')
    .run(totals.wins, totals.losses, totals.pushes, totals.profit, resetAt, accountId);
  return { wins: 0, losses: 0, pushes: 0, profit: 0, reset_at: resetAt };
}


export function lastDigitEvents(market: string, limit: number): Array<{ epoch: number; quote: number; digit: number }> {
  return getDb()
    .prepare('SELECT epoch, quote, digit FROM digits WHERE market = ? ORDER BY id DESC LIMIT ?')
    .all(market, limit) as unknown as Array<{ epoch: number; quote: number; digit: number }>;
}

export function pruneDigits(maxRows = 200000): void {
  try {
    getDb().prepare(`DELETE FROM digits WHERE id NOT IN (SELECT id FROM digits ORDER BY id DESC LIMIT ?)`).run(maxRows);
  } catch {
    // best-effort retention
  }
}

export interface TestRunRow {
  id: number;
  kind: 'backtest' | 'paper';
  source: 'manual' | 'auto';
  strategy_mode: string;
  bot_mode: string;
  base_stake: number;
  target: number;
  trades: number;
  wins: number;
  losses: number;
  net_pnl: number;
  win_rate: number | null;
  avg_stake: number | null;
  max_drawdown_pct: number | null;
  best_streak: number | null;
  worst_streak: number | null;
  final_balance: number | null;
  started_at: number;
  finished_at: number;
}

export function insertTestRun(r: Omit<TestRunRow, 'id'>): TestRunRow {
  const info = getDb()
    .prepare(
      `INSERT INTO test_runs (kind, source, strategy_mode, bot_mode, base_stake, target, trades, wins, losses,
         net_pnl, win_rate, avg_stake, max_drawdown_pct, best_streak, worst_streak, final_balance, started_at, finished_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      r.kind,
      r.source,
      r.strategy_mode,
      r.bot_mode,
      r.base_stake,
      r.target,
      r.trades,
      r.wins,
      r.losses,
      r.net_pnl,
      r.win_rate,
      r.avg_stake,
      r.max_drawdown_pct,
      r.best_streak,
      r.worst_streak,
      r.final_balance,
      r.started_at,
      r.finished_at,
    );
  return getDb().prepare('SELECT * FROM test_runs WHERE id = ?').get(Number(info.lastInsertRowid)) as unknown as TestRunRow;
}

export function insertMomentumResearch(row: Omit<MomentumResearchRow, 'id'>): void {
  getDb().prepare(
    `INSERT INTO momentum_research (
      completed_at, symbol, market, direction, confidence, score, return_15s, return_30s, return_60s,
      open_price, decision_price, exit_price, multiplier, stake, commission_rate, estimated_net, won
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    row.completed_at, row.symbol, row.market, row.direction, row.confidence, row.score,
    row.return_15s, row.return_30s, row.return_60s, row.open_price, row.decision_price,
    row.exit_price, row.multiplier, row.stake, row.commission_rate, row.estimated_net, row.won,
  );
}

export function getMomentumResearchSummary(maturityTarget = 30): MomentumResearchSummary {
  const row = getDb().prepare(
    `SELECT COUNT(*) AS windows,
      COALESCE(SUM(won), 0) AS wins,
      COALESCE(SUM(CASE WHEN won = 0 THEN 1 ELSE 0 END), 0) AS losses,
      COALESCE(SUM(estimated_net), 0) AS estimated_net
     FROM momentum_research`,
  ).get() as unknown as { windows: number; wins: number; losses: number; estimated_net: number };
  const windows = Number(row.windows ?? 0);
  const wins = Number(row.wins ?? 0);
  const recent = getDb().prepare('SELECT * FROM momentum_research ORDER BY completed_at DESC LIMIT 12').all() as unknown as MomentumResearchRow[];
  return {
    windows,
    wins,
    losses: Number(row.losses ?? 0),
    win_rate: windows > 0 ? wins / windows : null,
    estimated_net: Math.round(Number(row.estimated_net ?? 0) * 100) / 100,
    maturity_target: maturityTarget,
    samples_remaining: Math.max(0, maturityTarget - windows),
    ready_for_virtual_paper: windows >= maturityTarget,
    recent,
  };
}

export function getMeta(key: string): string | null {
  const row = getDb().prepare('SELECT value FROM app_meta WHERE key = ?').get(key) as unknown as { value: string } | null;
  return row?.value ?? null;
}

export function setMeta(key: string, value: string): void {
  getDb()
    .prepare('INSERT INTO app_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, value);
}

/** Monotonic fingerprint of stored tick history used to detect "enough new data". */
export function digitFingerprint(): number {
  const row = getDb().prepare('SELECT MAX(id) AS m FROM digits').get() as unknown as { m: number | null };
  return Number(row.m ?? 0);
}

export function listTestRuns(kind?: string, limit = 200): TestRunRow[] {
  const rows = kind
    ? getDb().prepare('SELECT * FROM test_runs WHERE kind = ? ORDER BY id DESC LIMIT ?').all(kind, limit)
    : getDb().prepare('SELECT * FROM test_runs ORDER BY id DESC LIMIT ?').all(limit);
  return rows as unknown as TestRunRow[];
}

export function latestTestRun(kind: string, strategy_mode: string, bot_mode: string): TestRunRow | null {
  const row = getDb()
    .prepare(
      'SELECT * FROM test_runs WHERE kind = ? AND strategy_mode = ? AND bot_mode = ? ORDER BY id DESC LIMIT 1',
    )
    .get(kind, strategy_mode, bot_mode);
  return row ? (row as unknown as TestRunRow) : null;
}

export interface PatternRow {
  id: number;
  market: string;
  prev_digit: number;
  next_digit: number;
  count: number;
  frequency: number;
  expected: number;
  lift: number;
  window: number;
  scanned_at: number;
}

export function replacePatterns(rows: Omit<PatternRow, 'id' | 'scanned_at'>[]): void {
  const d = getDb();
  d.prepare('DELETE FROM pattern_stats').run();
  const ins = d.prepare(
    `INSERT INTO pattern_stats (market, prev_digit, next_digit, count, frequency, expected, lift, window, scanned_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const now = Date.now();
  for (const r of rows) {
    ins.run(r.market, r.prev_digit, r.next_digit, r.count, r.frequency, r.expected, r.lift, r.window, now);
  }
}

export function listPatterns(): PatternRow[] {
  return getDb()
    .prepare('SELECT * FROM pattern_stats ORDER BY ABS(lift - 1) DESC LIMIT 500')
    .all() as unknown as PatternRow[];
}

/**
 * Per prev-digit, the confirmed next-digit conditional frequencies from
 * pattern_stats for one market. Rows are renomalized so each prev-digit is a
 * full probability distribution over 0-9; missing next-digits keep a 0.1
 * baseline. Returns null when the market has no confirmed rows.
 */
export function patternRowsByPrev(market: string): Map<number, number[]> | null {
  const rows = getDb()
    .prepare('SELECT prev_digit, next_digit, frequency FROM pattern_stats WHERE market = ? ORDER BY prev_digit')
    .all(market) as unknown as Array<{ prev_digit: number; next_digit: number; frequency: number }>;
  if (rows.length === 0) return null;
  const map = new Map<number, number[]>();
  for (const r of rows) {
    let row = map.get(r.prev_digit);
    if (!row) {
      row = Array.from({ length: 10 }, () => 0.1);
      map.set(r.prev_digit, row);
    }
    const f = Number(r.frequency);
    if (Number.isFinite(f)) row[r.next_digit] = f;
  }
  for (const row of map.values()) {
    const sum = row.reduce((a, b) => a + b, 0);
    if (sum > 0) for (let i = 0; i < 10; i++) row[i] = row[i] / sum;
  }
  return map;
}

export function maxTradeId(accountId = currentAccountId()): number {
  const row = getDb().prepare('SELECT MAX(id) AS m FROM trades WHERE account_id = ?').get(accountId) as unknown as { m: number | null };
  return Number(row.m ?? 0);
}

export function tradesAfterId(id: number, accountId = currentAccountId()): TradeRow[] {
  return getDb()
    .prepare("SELECT * FROM trades WHERE account_id = ? AND id > ? AND status IN ('won','lost') ORDER BY id ASC")
    .all(accountId, id) as unknown as TradeRow[];
}

export function digitHistory(market: string, limit: number): Array<{ epoch: number; digit: number }> {
  return getDb()
    .prepare('SELECT epoch, digit FROM digits WHERE market = ? AND digit IS NOT NULL ORDER BY id DESC LIMIT ?')
    .all(market, limit)
    .reverse() as unknown as Array<{ epoch: number; digit: number }>;
}

export type DecisionAction = 'trade' | 'wait' | 'skip' | 'observe' | 'recover' | 'switch';

export interface DecisionEventInput {
  ts: number;
  market: string;
  direction?: string;
  barrier?: number;
  action: DecisionAction;
  reason: string;
  est_win?: number;
  health_score?: number;
  regime?: string;
  deception_score?: number;
  requested_stake?: number;
  expires_at?: number;
}

export interface DecisionEventRow extends DecisionEventInput {
  id: number;
  outcome: 'won' | 'lost' | 'expired' | null;
  resolved_at: number | null;
}

export function insertDecisionEvent(event: DecisionEventInput): number {
  const info = getDb()
    .prepare(
      `INSERT INTO decision_events (ts, market, direction, barrier, action, reason, est_win, health_score,
        regime, deception_score, requested_stake, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      event.ts,
      event.market,
      event.direction ?? null,
      event.barrier ?? null,
      event.action,
      event.reason,
      event.est_win ?? null,
      event.health_score ?? null,
      event.regime ?? null,
      event.deception_score ?? null,
      event.requested_stake ?? null,
      event.expires_at ?? null,
    );
  return Number(info.lastInsertRowid);
}

export function resolveDecisionEvent(id: number, outcome: 'won' | 'lost' | 'expired', resolvedAt = Date.now()): void {
  getDb()
    .prepare(`UPDATE decision_events SET outcome=?, resolved_at=? WHERE id=? AND outcome IS NULL`)
    .run(outcome, resolvedAt, id);
}

export function pruneDecisionEvents(maxRows = 10000, now = Date.now()): void {
  getDb().prepare(`UPDATE decision_events SET outcome='expired', resolved_at=? WHERE outcome IS NULL AND expires_at IS NOT NULL AND expires_at < ?`).run(now, now);
  getDb().prepare(`DELETE FROM decision_events WHERE id NOT IN (SELECT id FROM decision_events ORDER BY id DESC LIMIT ?)`).run(maxRows);
}

export function listDecisionEvents(limit = 100): DecisionEventRow[] {
  return getDb()
    .prepare(`SELECT * FROM decision_events ORDER BY id DESC LIMIT ?`)
    .all(Math.max(1, Math.min(1000, limit))) as unknown as DecisionEventRow[];
}
