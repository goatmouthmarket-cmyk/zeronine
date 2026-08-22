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
  status: 'pending' | 'won' | 'lost' | 'push' | 'expired' | 'timeout' | 'error';
  contract_id: string;
  purchase_id: string;
  reason: string;
  resolved_at: number;
  entry_spot?: number;
  exit_spot?: number;
  exit_digit?: number;
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
      resolved_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_trades_ts ON trades(ts DESC);
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
  `);

  // Migration: add exit detail columns if missing
  const cols = new Set(
    (d.prepare(`PRAGMA table_info(trades)`).all() as Array<{ name: string }>).map((c) => c.name),
  );
  if (!cols.has('entry_spot')) d.exec(`ALTER TABLE trades ADD COLUMN entry_spot REAL`);
  if (!cols.has('exit_spot')) d.exec(`ALTER TABLE trades ADD COLUMN exit_spot REAL`);
  if (!cols.has('exit_digit')) d.exec(`ALTER TABLE trades ADD COLUMN exit_digit INTEGER`);
  if (!cols.has('account_id')) d.exec(`ALTER TABLE trades ADD COLUMN account_id TEXT NOT NULL DEFAULT '__legacy__'`);
  d.exec(`UPDATE trades SET account_id = '${LEGACY_ACCOUNT_ID}' WHERE account_id IS NULL OR account_id = ''`);
  d.exec(`CREATE INDEX IF NOT EXISTS idx_trades_account_id ON trades(account_id, id DESC)`);
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
  const info = getDb()
    .prepare(
      `INSERT INTO trades (account_id, ts, market, contract_type, barrier, duration, duration_unit, stake,
        ask_price, payout, est_win, profit, status, contract_id, purchase_id, reason, resolved_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      accountId,
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
      t.resolved_at ?? null,
    );
  return getDb()
    .prepare('SELECT * FROM trades WHERE id = ?')
    .get(Number(info.lastInsertRowid)) as unknown as TradeRow;
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
    .prepare("SELECT * FROM trades WHERE account_id = ? AND status = 'pending' ORDER BY id DESC LIMIT 1")
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
  extra?: { entrySpot?: number; exitSpot?: number; exitDigit?: number },
  accountId = currentAccountId(),
): void {
  getDb()
    .prepare(
      `UPDATE trades SET status=?, profit=?, contract_id=?, resolved_at=?,
        entry_spot=?, exit_spot=?, exit_digit=? WHERE id=? AND account_id=?`,
    )
    .run(
      status,
      profit,
      contractId,
      Date.now(),
      extra?.entrySpot ?? null,
      extra?.exitSpot ?? null,
      extra?.exitDigit ?? null,
      id,
      accountId,
    );
  updateScannerLogResult(id, status, profit);
}

export function markTradePurchased(id: number, contractId: string, stake: number, payout: number, accountId = currentAccountId()): void {
  getDb()
    .prepare('UPDATE trades SET contract_id=?, stake=?, ask_price=?, payout=? WHERE id=? AND account_id=?')
    .run(contractId, stake, stake, payout, id, accountId);
}

export function listTrades(limit = 50, accountId = currentAccountId()): TradeRow[] {
  return getDb()
    .prepare('SELECT * FROM trades WHERE account_id = ? ORDER BY id DESC LIMIT ?')
    .all(accountId, limit) as unknown as TradeRow[];
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
