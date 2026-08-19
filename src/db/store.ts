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
  lost: number;
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
  strategy_mode: string;
  strategy_multiplier: number;
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
      last_win_epoch INTEGER DEFAULT 0,
      updated_at INTEGER
    );
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
      strategy_mode TEXT,
      strategy_multiplier REAL
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
  if (!settingsCols.has('strategy_multiplier')) d.exec(`ALTER TABLE settings ADD COLUMN strategy_multiplier REAL`);
  void settingsCols;

  const automationCols = new Set(
    (d.prepare(`PRAGMA table_info(automation)`).all() as Array<{ name: string }>).map((c) => c.name),
  );
  if (!automationCols.has('target_trades')) d.exec(`ALTER TABLE automation ADD COLUMN target_trades INTEGER DEFAULT 0`);
  if (!automationCols.has('trades_done')) d.exec(`ALTER TABLE automation ADD COLUMN trades_done INTEGER DEFAULT 0`);
  void automationCols;
}

function seedDefaults(d: DatabaseSync): void {
  d.exec(`
    INSERT OR IGNORE INTO recovery_state (id, mode, streak, lost, last_win_epoch, updated_at)
      VALUES (1, 'base', 0, 0, 0, 0);
    INSERT OR IGNORE INTO settings (id, base_stake, max_stake, martingale_steps,
      max_consecutive_losses, daily_loss_limit, min_edge, min_recovery_win, barrier_preference,
      strategy_mode, strategy_multiplier)
      VALUES (1, ${config.baseStake}, ${config.maxStake}, ${config.martingaleSteps},
        ${config.maxConsecutiveLosses}, ${config.dailyLossLimit}, ${config.minEdge},
        ${config.minRecoveryWinRate}, '${config.barrierPreference}', '${config.strategyMode}',
        ${config.strategyMultiplier});
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
  return {
    base_stake: Number(row.base_stake),
    max_stake: Number(row.max_stake),
    martingale_steps: Number(row.martingale_steps),
    max_consecutive_losses: Number(row.max_consecutive_losses),
    daily_loss_limit: Number(row.daily_loss_limit),
    min_edge: Number(row.min_edge),
    min_recovery_win: Number(row.min_recovery_win),
    barrier_preference: String(row.barrier_preference),
    strategy_mode,
    strategy_multiplier: Number(row.strategy_multiplier ?? 3),
  };
}

export function updateSettings(patch: Partial<SettingsRow>): SettingsRow {
  const cur = getSettings();
  const next = { ...cur, ...patch };
  getDb()
    .prepare(
      `UPDATE settings SET base_stake=?, max_stake=?, martingale_steps=?, max_consecutive_losses=?,
       daily_loss_limit=?, min_edge=?, min_recovery_win=?, barrier_preference=?, strategy_mode=?,
       strategy_multiplier=? WHERE id=1`,
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
      next.strategy_mode,
      next.strategy_multiplier,
    );
  return next;
}

export function getRecovery(): RecoveryState {
  const row = getDb().prepare('SELECT * FROM recovery_state WHERE id = 1').get() as unknown as Record<string, unknown>;
  return {
    mode: row.mode as RecoveryState['mode'],
    streak: Number(row.streak),
    lost: Number(row.lost),
    last_win_epoch: Number(row.last_win_epoch),
    updated_at: Number(row.updated_at),
  };
}

export function saveRecovery(r: RecoveryState): void {
  getDb()
    .prepare('UPDATE recovery_state SET mode=?, streak=?, lost=?, last_win_epoch=?, updated_at=? WHERE id=1')
    .run(r.mode, r.streak, r.lost, r.last_win_epoch, Date.now());
}

export function resetRecovery(): void {
  saveRecovery({ mode: 'base', streak: 0, lost: 0, last_win_epoch: Date.now(), updated_at: Date.now() });
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