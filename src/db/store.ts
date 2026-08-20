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
  daily_loss_limit: number;
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
    CREATE TABLE IF NOT EXISTS settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      base_stake REAL,
      max_stake REAL,
      martingale_steps INTEGER,
      max_consecutive_losses INTEGER,
      daily_loss_limit REAL,
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
      finished_at INTEGER
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
}

function seedDefaults(d: DatabaseSync): void {
  d.exec(`
INSERT OR IGNORE INTO recovery_state (id, mode, streak, lost, debt, attempts, cycle_stake, peak_balance, last_win_epoch, updated_at)
      VALUES (1, 'base', 0, 0, 0, 0, 0, 0, 0, 0);
    INSERT OR IGNORE INTO settings (id, base_stake, max_stake, martingale_steps,
      max_consecutive_losses, daily_loss_limit, min_edge, min_recovery_win, barrier_preference,
      barrier_number, strategy_mode, bot_mode, strategy_multiplier, recovery_buffer, chase_amortize,
      max_recovery_debt, max_recovery_exposure, max_drawdown_pct)
      VALUES (1, ${config.baseStake}, ${config.maxStake}, ${config.martingaleSteps},
        ${config.maxConsecutiveLosses}, ${config.dailyLossLimit}, ${config.minEdge},
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
  return {
    base_stake: Number(row.base_stake),
    max_stake: Number(row.max_stake),
    martingale_steps: Number(row.martingale_steps),
    max_consecutive_losses: Number(row.max_consecutive_losses),
    daily_loss_limit: Number(row.daily_loss_limit),
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
  };
}

export function updateSettings(patch: Partial<SettingsRow>): SettingsRow {
  const cur = getSettings();
  const next = { ...cur, ...patch };
  getDb()
    .prepare(
      `UPDATE settings SET base_stake=?, max_stake=?, martingale_steps=?, max_consecutive_losses=?,
       daily_loss_limit=?, min_edge=?, min_recovery_win=?, barrier_preference=?, barrier_number=?,
       strategy_mode=?, bot_mode=?,
       strategy_multiplier=?, recovery_buffer=?, chase_amortize=?, max_recovery_debt=?,
       max_recovery_exposure=?, max_drawdown_pct=? WHERE id=1`,
    )
    .run(
      next.base_stake,
      next.max_stake,
      next.martingale_steps,
      next.max_consecutive_losses,
      next.daily_loss_limit,
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
    );
  return next;
}

export function getRecovery(): RecoveryState {
  const row = getDb().prepare('SELECT * FROM recovery_state WHERE id = 1').get() as unknown as Record<string, unknown>;
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

export function saveRecovery(r: RecoveryState): void {
  getDb()
    .prepare(
      'UPDATE recovery_state SET mode=?, streak=?, debt=?, attempts=?, cycle_stake=?, peak_balance=?, last_win_epoch=?, updated_at=? WHERE id=1',
    )
    .run(r.mode, r.streak, r.debt, r.attempts, r.cycleStake, r.peakBalance, r.last_win_epoch, Date.now());
}

export function resetRecovery(): void {
  saveRecovery({
    mode: 'base',
    streak: 0,
    debt: 0,
    attempts: 0,
    cycleStake: 0,
    peakBalance: getRecovery().peakBalance,
    last_win_epoch: Date.now(),
    updated_at: Date.now(),
  });
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
  const info = getDb()
    .prepare(
      `INSERT INTO trades (ts, market, contract_type, barrier, duration, duration_unit, stake,
        ask_price, payout, est_win, profit, status, contract_id, purchase_id, reason, resolved_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
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

export function getTrade(id: number): TradeRow | null {
  const row = getDb().prepare('SELECT * FROM trades WHERE id = ?').get(id);
  return row ? (row as unknown as TradeRow) : null;
}

export function getTradeByContractId(contractId: string): TradeRow | null {
  const row = getDb().prepare('SELECT * FROM trades WHERE contract_id = ?').get(contractId);
  return row ? (row as unknown as TradeRow) : null;
}

export function getOpenTrade(): TradeRow | null {
  const row = getDb()
    .prepare("SELECT * FROM trades WHERE status = 'pending' ORDER BY id DESC LIMIT 1")
    .get();
  return row ? (row as unknown as TradeRow) : null;
}

export function getPendingTrades(): TradeRow[] {
  return getDb()
    .prepare("SELECT * FROM trades WHERE status = 'pending' ORDER BY id ASC")
    .all() as unknown as TradeRow[];
}

export function resolveTrade(
  id: number,
  status: TradeRow['status'],
  profit: number,
  contractId: string,
  extra?: { entrySpot?: number; exitSpot?: number; exitDigit?: number },
): void {
  getDb()
    .prepare(
      `UPDATE trades SET status=?, profit=?, contract_id=?, resolved_at=?,
        entry_spot=?, exit_spot=?, exit_digit=?  WHERE id=?`,
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
    );
  updateScannerLogResult(id, status, profit);
}

export function listTrades(limit = 50): TradeRow[] {
  return getDb()
    .prepare('SELECT * FROM trades ORDER BY id DESC LIMIT ?')
    .all(limit) as unknown as TradeRow[];
}

export function tradesSince(ts: number): TradeRow[] {
  return getDb()
    .prepare('SELECT * FROM trades WHERE ts >= ? AND status IN (\'won\', \'lost\')')
    .all(ts) as unknown as TradeRow[];
}

export function runningPnlToday(): number {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const rows = tradesSince(startOfDay.getTime());
  return rows.reduce((sum, t) => sum + (t.profit || 0), 0);
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
      `INSERT INTO test_runs (kind, strategy_mode, bot_mode, base_stake, target, trades, wins, losses,
         net_pnl, win_rate, avg_stake, max_drawdown_pct, best_streak, worst_streak, final_balance, started_at, finished_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      r.kind,
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

export function maxTradeId(): number {
  const row = getDb().prepare('SELECT MAX(id) AS m FROM trades').get() as unknown as { m: number | null };
  return Number(row.m ?? 0);
}

export function tradesAfterId(id: number): TradeRow[] {
  return getDb()
    .prepare("SELECT * FROM trades WHERE id > ? AND status IN ('won','lost') ORDER BY id ASC")
    .all(id) as unknown as TradeRow[];
}

export function digitHistory(market: string, limit: number): Array<{ epoch: number; digit: number }> {
  return getDb()
    .prepare('SELECT epoch, digit FROM digits WHERE market = ? AND digit IS NOT NULL ORDER BY id DESC LIMIT ?')
    .all(market, limit)
    .reverse() as unknown as Array<{ epoch: number; digit: number }>;
}