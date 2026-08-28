import { useSyncExternalStore } from 'preact/compat';
import { SignalStabilizer } from './signalStability';

export interface Market {
  symbol: string;
  display: string;
  lastQuote: number;
  lastEpoch: number;
  lastDigit: number;
  fresh: boolean;
  ticksPerMin: number;
  recentDigits: number[];
  recentQuotes: number[];
  dist: number[];
  health?: MarketHealth;
  regime?: RegimeAssessment;
}

export interface MarketHealth {
  score: number;
  label: 'excellent' | 'healthy' | 'weak' | 'avoid';
  trend: 'improving' | 'stable' | 'deteriorating';
  reasons: string[];
}

export interface RegimeAssessment {
  regime: 'stable' | 'favorable' | 'transitioning' | 'volatile' | 'loss_cluster' | 'uncertain';
  confidence: number;
  since: number;
  reasons: string[];
}

export interface SessionInfo {
  loginid: string;
  balance: number;
  currency: string;
  mode: 'demo' | 'real';
  auth_kind?: string;
}

export interface DerivAccountInfo {
  accountId: string;
  mode: 'demo' | 'real';
  currency: string;
  balance: number;
  status: string;
}

export interface Recovery {
  mode: 'base' | 'recovering';
  streak: number;
  debt: number;
  attempts: number;
  cycleStake: number;
  peakBalance: number;
  last_win_epoch: number;
  updated_at: number;
}

export interface Settings {
  base_stake: number;
  max_stake: number;
  martingale_steps: number;
  max_consecutive_losses: number;
  min_edge: number;
  min_recovery_win: number;
  barrier_preference: string;
  barrier_number: number;
  strategy_mode: 'conservative' | 'martingale' | 'boosted_martingale' | 'chase';
  bot_mode: 'rapid' | 'balanced' | 'strict';
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

/** Immutable lifecycle record. Paper rows are virtual research, never account money. */
export interface LedgerEntry {
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
}

export interface PerformanceSummary {
  wins: number;
  losses: number;
  pushes: number;
  profit: number;
  reset_at: number;
}

export interface FeedStatus {
  connected: boolean;
  markets?: number;
  error?: string;
  lastActivity?: number;
}

export interface SignalCandidate {
  market: string;
  direction: 'over' | 'under';
  barrier: number;
  estWin: number;
  estPayout: number;
  edge: number;
  expectedROI: number;
  consistency: number;
  entropy: number;
  momentum: number;
  shortLongDeviation: number;
  transitionProb: number;
  learnedWin: number | null;
}

export interface SignalPick {
  candidates: SignalCandidate[];
  holds: boolean;
  reason: string;
}

export interface Decision {
  market: string;
  direction: 'over' | 'under';
  barrier: number;
  stake: number;
  estWin: number;
  payout?: number;
  reason: string;
}

export interface AutomationState {
  running: boolean;
  phase: string;
  lastCompletedAt: number;
  runTarget?: number;
  runTrades?: number;
  reason?: string;
  observation?: {
    phase: 'observing' | 'watching' | 'confirmed';
    key: string | null;
    confirmations: number;
    required: number;
    lastTickEpoch: number | null;
  };
}

export interface QuoteEvt {
  market?: string;
  direction?: string;
  barrier?: number;
  ask?: number;
  payout?: number;
  estWin?: number;
  realEdge?: number;
}

export interface ContractEvt {
  contractId?: string;
  result?: string;
  profit?: number;
  phase?: string;
  error?: string;
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

export interface PatternRow {
  market: string;
  prev_digit: number;
  next_digit: number;
  count: number;
  frequency: number;
  expected: number;
  lift: number;
  window: number;
}

export interface CalibrationBucket {
  bucket: string;
  lo: number;
  hi: number;
  n: number;
  wins: number;
  rate: number | null;
}

export interface CalibrationReport {
  buckets: CalibrationBucket[];
  total: number;
  byBarrier: Array<{ market: string; direction: 'over' | 'under'; barrier: number; trades: number; wins: number; win_rate: number | null }>;
  byStrategy: Array<{ strategy: string; mode: string; kind: string; trades: number; wins: number; win_rate: number | null }>;
}

export interface TestLabActive {
  kind: 'backtest' | 'paper' | 'patterns';
  phase: string;
  configIndex?: number;
  totalConfigs?: number;
  config?: string;
  tradesDone?: number;
  tradesTarget?: number;
  done?: number;
  total?: number;
  message: string;
}

export interface PaperSimulationContract {
  id: number;
  market: string;
  direction: 'over' | 'under';
  barrier: number;
  stake: number;
  payoutRatio: number;
  entryEpoch: number;
  entryQuote: number;
  entryDigit: number;
  estWin?: number;
  edge?: number;
  status: 'open' | 'won' | 'lost' | 'cancelled';
  exitEpoch?: number;
  exitQuote?: number;
  exitDigit?: number;
  profit?: number;
}

export interface PaperSimulationState {
  phase: 'idle' | 'running' | 'stopped' | 'completed';
  reason: string | null;
  initialBalance: number;
  balance: number;
  availableBalance: number;
  reservedStake: number;
  netPnl: number;
  wins: number;
  losses: number;
  totalTrades: number;
  equity: number[];
  openContract: PaperSimulationContract | null;
  lastSettled: PaperSimulationContract | null;
  lastTick: { market: string; quote: number; digit: number; epoch: number } | null;
}

/** Research-only paired quote state. It never represents a Deriv purchase. */
export interface ArbLegQuote {
  contractType: 'DIGITOVER' | 'DIGITUNDER' | string;
  barrier: number;
  askPrice: number | null;
  payout: number | null;
  proposalId?: string;
  requestedAt?: number;
  receivedAt?: number;
  latencyMs?: number;
  error?: string | null;
}

export interface ArbObservation {
  id: number;
  sessionId: string;
  ts: number;
  market: string;
  pair: string;
  payout: number;
  currency: string;
  lower: ArbLegQuote;
  upper: ArbLegQuote;
  totalCost: number | null;
  grossMargin: number | null;
  roi: number | null;
  edge: number | null;
  syncMs: number | null;
  syncQuality: 'good' | 'fair' | 'poor' | 'incomplete' | string;
  status: 'valid' | 'incomplete' | 'invalid' | string;
  diagnostic?: string | null;
}

export interface ArbSessionSummary {
  id: string;
  startedAt: number;
  stoppedAt: number | null;
  market: string;
  pair: string;
  payout: number;
  currency: string;
  observations: number;
  validObservations: number;
  bestEdge: number | null;
  avgEdge: number | null;
  reason?: string | null;
}

export interface ArbResearchState {
  phase: 'idle' | 'observing' | 'stopped' | 'error' | string;
  running: boolean;
  market: string;
  pair: string;
  payout: number;
  currency: string;
  sessionId: string | null;
  latest: ArbObservation | null;
  observations: number;
  validObservations: number;
  lastActivityAt?: number;
  reason?: string | null;
}

export interface ArbDemoExecutionState {
  execution: {
    id: string;
    status: string;
    feasibility_status: string | null;
    settlement_alignment: string | null;
    symbol: string;
    pair_key: string;
    target_payout: number;
    reason: string | null;
  };
  legs: Array<{
    leg: 'under' | 'over';
    status: string;
    contract_id: string | null;
    settlement_status: string | null;
  }>;
}

export interface State {
  publicDashboard?: boolean;
  owner?: boolean;
  ws: 'connecting' | 'open' | 'closed';
  feed: FeedStatus | null;
  markets: Market[];
  session: SessionInfo | null;
  recovery: Recovery | null;
  settings: Settings | null;
  automation: AutomationState | null;
  trades: TradeRow[];
  ledgerEntries: LedgerEntry[];
  paperLedgerEntries: LedgerEntry[];
  performance: PerformanceSummary | null;
  selected: string | null;
  signal: { signal: SignalPick; phase: string } | null;
  displaySignal: SignalPick | null;
  quotes: Record<string, QuoteEvt>;
  quote: QuoteEvt | null;
  digits: Record<string, number[]>;
  decision: { decision: Decision; streak: number; debt: number; attempts: number; cycleStake: number } | null;
  hold: { reason: string } | null;
  contract: ContractEvt | null;
  botCooldownUntil: number;
  testlab: TestLabActive | null;
  testRuns: TestRunRow[];
  testEquity: Record<string, number[]>;
  autoBacktest: { intervalMs: number; lastRunAt: number; nextRunAt: number; lastFingerprint: number; minNewDigits: number } | null;
  autoPaper: { enabled: boolean; intervalMs: number; lastRunAt: number; nextRunAt: number | null } | null;
  paperSimulation: PaperSimulationState | null;
  patterns: { patterns: PatternRow[]; calibration: CalibrationReport | null } | null;
  arb: ArbResearchState | null;
  arbSessions: ArbSessionSummary[];
  arbObservations: ArbObservation[];
  arbDemoExecution: ArbDemoExecutionState | null;
}

const initial: State = {
  ws: 'connecting',
  feed: null,
  markets: [],
  session: null,
  recovery: null,
  settings: null,
  automation: null,
  trades: [],
  ledgerEntries: [],
  paperLedgerEntries: [],
  performance: null,
  selected: null,
  signal: null,
  displaySignal: null,
  quotes: {},
  quote: null,
  digits: {},
  decision: null,
  hold: null,
  contract: null,
  botCooldownUntil: 0,
  testlab: null,
  testRuns: [],
  testEquity: {},
  autoBacktest: null,
  autoPaper: null,
  paperSimulation: null,
  patterns: null,
  arb: null,
  arbSessions: [],
  arbObservations: [],
  arbDemoExecution: null,
};

let state: State = initial;
const signalStabilizer = new SignalStabilizer<SignalCandidate>();
const listeners = new Set<() => void>();
const PUBLIC_MARKET_CACHE_KEY = 'zeronine:public-markets:v1';
const PUBLIC_MARKET_CACHE_MAX_AGE_MS = 2 * 60_000;

function cachePublicMarkets(markets: Market[]): void {
  try {
    sessionStorage.setItem(PUBLIC_MARKET_CACHE_KEY, JSON.stringify({ ts: Date.now(), markets }));
  } catch {
    // Storage is an optional warm-start optimization.
  }
}

function readCachedPublicMarkets(): Market[] {
  try {
    const cached = JSON.parse(sessionStorage.getItem(PUBLIC_MARKET_CACHE_KEY) ?? 'null') as { ts?: number; markets?: Market[] } | null;
    if (!cached?.ts || Date.now() - cached.ts > PUBLIC_MARKET_CACHE_MAX_AGE_MS || !Array.isArray(cached.markets)) return [];
    return cached.markets;
  } catch {
    return [];
  }
}

function notifyListeners(): void {
  for (const cb of listeners) cb();
}

function set(patch: Partial<State>, notify = true): void {
  state = { ...state, ...patch };
  if (notify) notifyListeners();
}

export function useStore(): State {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => state,
  );
}

export async function api<T = unknown>(path: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = { ...((init?.headers as Record<string, string>) ?? {}) };
  if (init?.body != null) headers['Content-Type'] = 'application/json';
  const res = await fetch(path, { ...init, cache: 'no-store', headers });
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    // non-json response
  }
  if (!res.ok) {
    const msg = (body as { error?: string })?.error ?? `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return body as T;
}

function applyEvent(evt: Record<string, unknown>, notify = true): void {
  const type = String(evt.type ?? '');

  const seedDigits = (markets: Market[]): Record<string, number[]> => {
    const out: Record<string, number[]> = {};
    for (const m of markets) {
      if (m.recentDigits.length) out[m.symbol] = m.recentDigits.slice(-1000);
    }
    return out;
  };

  const patch: Partial<State> = {};
  switch (type) {
    case 'hello': {
      const markets = (evt.markets as Market[]) ?? [];
      cachePublicMarkets(markets);
      patch.markets = markets;
      patch.digits = seedDigits(markets);
      if (!state.selected && markets.length) patch.selected = markets[0]?.symbol ?? null;
      break;
    }
    case 'feed':
      patch.feed = evt.status as FeedStatus;
      break;
    case 'tick': {
      const symbol = String(evt.symbol ?? '');
      const m: Market = {
        symbol,
        display: String(evt.display ?? symbol),
        lastQuote: Number(evt.quote ?? 0),
        lastEpoch: Number(evt.epoch ?? 0),
        lastDigit: Number(evt.digit ?? -1),
        fresh: Boolean(evt.fresh),
        ticksPerMin: 0,
        recentDigits: (evt.recentDigits as number[]) ?? [],
        recentQuotes: (evt.recentQuotes as number[]) ?? [],
        dist: [],
      };
      const idx = state.markets.findIndex((x) => x.symbol === symbol);
      const markets = state.markets.slice();
      if (idx >= 0) {
        const prev = markets[idx];
        markets[idx] = {
          ...prev,
          ...m,
          ticksPerMin: m.recentDigits.length >= 2 ? m.recentDigits.length : prev.ticksPerMin,
          recentDigits: m.recentDigits.length ? m.recentDigits : prev.recentDigits,
          recentQuotes: m.recentQuotes.length ? m.recentQuotes : prev.recentQuotes,
        };
      } else {
        markets.push(m);
      }
      patch.markets = markets;
      // A tick must never replace the market explicitly selected by the
      // operator. Only seed a selection while the store has none.
      if (!state.selected) patch.selected = symbol;
      const nd = m.lastDigit;
      const hist = state.digits[symbol] ?? [];
      if (nd >= 0 && m.recentDigits.length && hist.length === 0) {
        patch.digits = { ...state.digits, [symbol]: m.recentDigits.slice(-1000) };
      } else if (nd >= 0 && hist.length > 0 && hist[hist.length - 1] !== nd) {
        patch.digits = { ...state.digits, [symbol]: [...hist, nd].slice(-1000) };
      }
      break;
    }
    case 'session':
      patch.session = evt.session ? (evt.session as SessionInfo) : null;
      break;
    case 'balance':
      patch.session = state.session ? { ...state.session, balance: Number(evt.balance ?? 0) } : state.session;
      break;
    case 'status':
      patch.automation = evt.state as AutomationState;
      if (evt.state && (evt.state as AutomationState).running === false) {
        patch.decision = null;
      }
      break;
    case 'signal': {
      const raw = evt.signal as Partial<SignalPick> | null | undefined;
      const signal: SignalPick = {
        candidates: Array.isArray(raw?.candidates) ? (raw.candidates as SignalCandidate[]) : [],
        holds: Boolean(raw?.holds),
        reason: String(raw?.reason ?? ''),
      };
      patch.signal = {
        signal,
        phase: String(evt.phase ?? ''),
      };
      patch.displaySignal = signalStabilizer.update(signal);
      patch.quotes = {};
      patch.hold = null;
      break;
    }
    case 'intelligence': {
      const assessments = new Map(
        ((evt.markets as Array<{ symbol?: string; health?: MarketHealth; regime?: RegimeAssessment }>) ?? [])
          .filter((item) => item.symbol)
          .map((item) => [String(item.symbol), item]),
      );
      patch.markets = state.markets.map((market) => {
        const assessment = assessments.get(market.symbol);
        return assessment ? { ...market, health: assessment.health, regime: assessment.regime } : market;
      });
      break;
    }
    case 'quote': {
      const q = evt as QuoteEvt;
      patch.quote = q;
      const key = [q.market, q.direction, q.barrier].join('|');
      if (key && !key.includes('|undefined')) patch.quotes = { ...state.quotes, [key]: q };
      break;
    }
    case 'quote_error':
      patch.quote = null;
      patch.quotes = {};
      break;
    case 'decision':
      patch.decision = {
        decision: evt.decision as Decision,
        streak: Number(evt.streak ?? 0),
        debt: Number(evt.debt ?? 0),
        attempts: Number(evt.attempts ?? 0),
        cycleStake: Number(evt.cycleStake ?? 0),
      };
      patch.hold = null;
      break;
    case 'hold':
      patch.hold = { reason: String(evt.reason ?? '') };
      break;
    case 'cooldown':
      patch.botCooldownUntil = Date.now() + Number(evt.seconds ?? 60) * 1000;
      break;
    case 'trade': {
      const t = evt.trade as TradeRow;
      if (t) patch.trades = [t, ...state.trades.filter((x) => x.id !== t.id)].slice(0, 50);
      const performance = evt.performance as PerformanceSummary | undefined;
      if (performance && typeof performance.profit === 'number') patch.performance = performance;
      break;
    }
    case 'contract': {
      const c: ContractEvt = {
        contractId: evt.contractId as string | undefined,
        result: evt.result as string | undefined,
        profit: evt.profit as number | undefined,
        phase: evt.phase as string | undefined,
        error: evt.error as string | undefined,
      };
      patch.contract = c;
      if (c.result) {
        const contractId = String(evt.contractId ?? '');
        const tradeId = Number(evt.tradeId ?? 0);
        const update = (evt.update ?? {}) as Record<string, unknown>;
        patch.trades = state.trades.map((trade) => {
          if (!(tradeId > 0 ? trade.id === tradeId : contractId && trade.contract_id === contractId)) return trade;
          return {
            ...trade,
            status: c.result as TradeRow['status'],
            profit: Number(c.profit ?? trade.profit ?? 0),
            resolved_at: Date.now(),
            entry_spot: Number.isFinite(Number(update.entrySpot)) ? Number(update.entrySpot) : trade.entry_spot,
            entry_digit: Number.isFinite(Number(update.entryDigit)) ? Number(update.entryDigit) : trade.entry_digit,
            exit_spot: Number.isFinite(Number(update.exitSpot)) ? Number(update.exitSpot) : trade.exit_spot,
            exit_digit: Number.isFinite(Number(update.exitDigit)) ? Number(update.exitDigit) : trade.exit_digit,
          };
        });
        if (c.phase !== 'purchased') {
          void refreshTrades();
        }
      }
      break;
    }
    case 'recovery': {
      patch.recovery = evt.recovery as Recovery;
      if (evt.reset) patch.contract = null;
      break;
    }
    case 'testlab': {
      const kind = evt.kind as TestLabActive['kind'];
      if (!kind) break;
      patch.testlab = {
        kind,
        phase: String(evt.phase ?? 'running'),
        configIndex: evt.configIndex !== undefined ? Number(evt.configIndex) : undefined,
        totalConfigs: evt.totalConfigs !== undefined ? Number(evt.totalConfigs) : undefined,
        config: evt.config ? String(evt.config) : undefined,
        tradesDone: evt.tradesDone !== undefined ? Number(evt.tradesDone) : undefined,
        tradesTarget: evt.tradesTarget !== undefined ? Number(evt.tradesTarget) : undefined,
        done: evt.done !== undefined ? Number(evt.done) : undefined,
        total: evt.total !== undefined ? Number(evt.total) : undefined,
        message: String(evt.message ?? ''),
      };
      break;
    }
    case 'paper_simulation':
      patch.paperSimulation = (evt.state as PaperSimulationState | null) ?? null;
      break;
    case 'arb':
      patch.arb = unwrapArbState(evt.state);
      break;
    case 'arb_observation': {
      const observation = normalizeArbObservation(evt.observation);
      const researchState = unwrapArbState(evt.state);
      if (researchState) patch.arb = researchState;
      if (observation) {
        patch.arbObservations = [observation, ...state.arbObservations.filter((item) => item.id !== observation.id)].slice(0, 250);
        if (!researchState && state.arb) {
          patch.arb = {
            ...state.arb,
            latest: observation,
            observations: Math.max(state.arb.observations, state.arb.observations + 1),
            validObservations: state.arb.validObservations + (observation.status === 'valid' ? 1 : 0),
            lastActivityAt: observation.ts,
          };
        }
      }
      break;
    }
    case 'arb_execution':
      patch.arbDemoExecution = (evt.state as ArbDemoExecutionState | null) ?? null;
      break;
    case 'error':
      break;
    default:
      return;
  }
  set(patch, notify);
}

// Market feeds can deliver several symbols in the same paint interval. Retain
// the newest tick for every symbol, then publish the combined result once so a
// burst cannot force the entire dashboard to render for every WebSocket frame.
const pendingTicks = new Map<string, Record<string, unknown>>();
let tickFrame: number | null = null;

function flushPendingTicks(): void {
  if (tickFrame !== null) {
    window.cancelAnimationFrame(tickFrame);
    tickFrame = null;
  }
  if (pendingTicks.size === 0) return;
  const ticks = [...pendingTicks.values()];
  pendingTicks.clear();
  for (const tick of ticks) applyEvent(tick, false);
  notifyListeners();
}

function dispatchEvent(evt: Record<string, unknown>): void {
  if (String(evt.type ?? '') === 'tick') {
    const symbol = String(evt.symbol ?? '');
    if (!symbol) return;
    pendingTicks.set(symbol, evt);
    if (tickFrame === null) {
      tickFrame = window.requestAnimationFrame(() => {
        tickFrame = null;
        flushPendingTicks();
      });
    }
    return;
  }

  // A control/trade event must observe every tick that arrived before it and
  // must remain immediately visible to subscribers.
  flushPendingTicks();
  applyEvent(evt);
}

let ws: WebSocket | null = null;
let wsTimer: number | null = null;
let retry = 0;
let lastWsMessageAt = 0;
let lastStateSyncAt = 0;
let stateRefresh: Promise<void> | null = null;

function resetWsConnection(): void {
  if (wsTimer) window.clearTimeout(wsTimer);
  wsTimer = null;
  if (ws) {
    ws.onopen = null;
    ws.onmessage = null;
    ws.onerror = null;
    ws.onclose = null;
    try { ws.close(); } catch { /* already closing */ }
  }
  ws = null;
  retry = 0;
  connectWs();
}

export function connectWs(): void {
  if (ws) return;
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}/ws`);
  set({ ws: 'connecting' });

  ws.onopen = () => {
    retry = 0;
    lastWsMessageAt = Date.now();
    set({ ws: 'open' });
  };

  ws.onmessage = (msg) => {
    lastWsMessageAt = Date.now();
    try {
      dispatchEvent(JSON.parse(String(msg.data)));
    } catch {
      // ignore malformed frames
    }
  };

  ws.onclose = () => {
    ws = null;
    set({ ws: 'closed' });
    const delay = Math.min(15000, 1000 * 2 ** retry) + Math.floor(Math.random() * 350);
    retry += 1;
    if (wsTimer) window.clearTimeout(wsTimer);
    wsTimer = window.setTimeout(connectWs, delay);
  };

  ws.onerror = () => {
    try {
      ws?.close();
    } catch {
      // ignore
    }
  };
}

window.addEventListener('pageshow', (ev) => {
  if (ev.persisted) {
    resetWsConnection();
    void refreshCoreState();
  }
});

function resumeFreshness(): void {
  if (document.visibilityState === 'hidden' || !navigator.onLine) return;
  if (!ws || ws.readyState !== WebSocket.OPEN || Date.now() - lastWsMessageAt > 35_000) resetWsConnection();
  if (Date.now() - lastStateSyncAt > 15_000) void refreshCoreState();
}

window.addEventListener('online', resumeFreshness);
document.addEventListener('visibilitychange', resumeFreshness);
window.setInterval(() => {
  if (document.visibilityState === 'hidden' || !navigator.onLine) return;
  if (ws?.readyState === WebSocket.OPEN && Date.now() - lastWsMessageAt > 35_000) resetWsConnection();
  if (Date.now() - lastStateSyncAt > 60_000) void refreshCoreState();
}, 15_000);

window.setInterval(() => {
  if (document.visibilityState === 'hidden' || !navigator.onLine) return;
  if (state.trades.some((trade) => trade.status === 'pending' || trade.status === 'purchasing')) void refreshTrades();
}, 2_000);

// ---- actions ----

function applyCoreState(s: State & { public_dashboard?: boolean; owner?: boolean }): void {
  const markets = Array.isArray(s.markets) ? s.markets : [];
  cachePublicMarkets(markets);
  set({
      feed: s.feed,
      markets,
      session: s.session,
      recovery: s.recovery,
      settings: s.settings,
      automation: s.automation,
      trades: s.trades,
      performance: s.performance,
      paperSimulation: s.paperSimulation ?? null,
      arb: s.arb ?? null,
      arbDemoExecution: s.arbDemoExecution ?? null,
      publicDashboard: Boolean(s.public_dashboard),
      owner: Boolean(s.owner),
      digits: (() => {
        const out: Record<string, number[]> = {};
        for (const m of markets) {
          if (m.recentDigits.length) out[m.symbol] = m.recentDigits.slice(-1000);
        }
        return out;
      })(),
      selected: state.selected && markets.some((market) => market.symbol === state.selected)
        ? state.selected
        : s.selected ?? markets[0]?.symbol ?? null,
  });
  lastStateSyncAt = Date.now();
}

async function refreshCoreState(): Promise<void> {
  if (stateRefresh) return stateRefresh;
  stateRefresh = (async () => {
    try {
      const snapshot = (await api('/api/state')) as State & { public_dashboard?: boolean; owner?: boolean };
      applyCoreState(snapshot);
    } catch {
      // Keep the last good state. WebSocket recovery continues independently.
    }
  })().finally(() => { stateRefresh = null; });
  return stateRefresh;
}

export async function bootstrap(): Promise<void> {
  signalStabilizer.reset();
  if (state.markets.length === 0) {
    const cachedMarkets = readCachedPublicMarkets();
    if (cachedMarkets.length > 0) set({ markets: cachedMarkets, selected: cachedMarkets[0]?.symbol ?? null });
  }
  try {
    await refreshCoreState();
  } catch (err) {
    // best-effort state load; the ws stream will repopulate
  }
  void loadAutoBacktestStatus();
  void loadAutoPaperStatus();
  void loadArbState();
  connectWs();
}

export async function loadAutoBacktestStatus(): Promise<void> {
  try {
    const res = await api<{
      intervalMs: number;
      lastRunAt: number;
      nextRunAt: number;
      lastFingerprint: number;
      minNewDigits: number;
    }>('/api/test/backtest/status');
    set({ autoBacktest: res });
  } catch {
    // server may not support it yet on older builds - ignore
  }
}

export async function loadAutoPaperStatus(): Promise<void> {
  try {
    const res = await api<{ enabled: boolean; intervalMs: number; lastRunAt: number; nextRunAt: number | null }>('/api/test/paper/status');
    set({ autoPaper: res });
  } catch {
    // server may not support it yet on older builds - ignore
  }
}

export async function connectPat(token: string): Promise<SessionInfo> {
  const res = await api<{ ok: boolean; session: SessionInfo }>('/api/auth/pat', {
    method: 'POST',
    body: JSON.stringify({ token }),
  });
  set({ session: res.session });
  return res.session;
}

export async function oauthStart(): Promise<string> {
  const res = await api<{ ok: boolean; url: string }>('/api/auth/oauth/start');
  if (!res.url) throw new Error('OAuth not configured');
  return res.url;
}

export async function logout(): Promise<void> {
  await api('/api/auth/logout', { method: 'POST' });
  signalStabilizer.reset();
  set({ session: null, automation: null, signal: null, displaySignal: null, quotes: {}, decision: null, hold: null, contract: null, ledgerEntries: [] });
}

export async function startAutomation(opts?: {
  strategyMode?: Settings['strategy_mode'];
  baseStake?: number;
  maxTrades?: number;
}): Promise<void> {
  try {
    const body: Record<string, unknown> = {};
    if (opts?.strategyMode !== undefined) body.strategy_mode = opts.strategyMode;
    if (opts?.baseStake !== undefined) body.base_stake = opts.baseStake;
    if (opts?.maxTrades !== undefined) body.max_trades = opts.maxTrades;
    const res = await api<{ state: AutomationState }>('/api/automation/start', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    set({ automation: res.state });
    return;
  } catch (err) {
    throw err;
  }
}

export async function stopAutomation(): Promise<void> {
  const res = await api<{ state: AutomationState }>('/api/automation/stop', { method: 'POST' });
  set({ automation: res.state, decision: null });
}

export async function startPaperSimulation(): Promise<PaperSimulationState> {
  const res = await api<{ ok: boolean; state: PaperSimulationState }>('/api/paper/start', { method: 'POST' });
  set({ paperSimulation: res.state });
  return res.state;
}

export async function stopPaperSimulation(): Promise<PaperSimulationState> {
  const res = await api<{ ok: boolean; state: PaperSimulationState }>('/api/paper/stop', { method: 'POST' });
  set({ paperSimulation: res.state });
  return res.state;
}

export async function resetPaperSimulation(): Promise<PaperSimulationState> {
  const res = await api<{ ok: boolean; state: PaperSimulationState }>('/api/paper/reset', { method: 'POST' });
  set({ paperSimulation: res.state });
  return res.state;
}

// ---- arbitrage research actions ----

function arbNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function arbText(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function normalizeArbObservation(raw: unknown): ArbObservation | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;
  const underBarrier = arbNumber(row.under_barrier) ?? arbNumber((row.lower as Record<string, unknown> | undefined)?.barrier) ?? 0;
  const overBarrier = arbNumber(row.over_barrier) ?? arbNumber((row.upper as Record<string, unknown> | undefined)?.barrier) ?? 0;
  const lowerRaw = row.lower as Record<string, unknown> | undefined;
  const upperRaw = row.upper as Record<string, unknown> | undefined;
  const statusRaw = arbText(row.status, 'incomplete');
  return {
    id: arbNumber(row.id) ?? 0,
    sessionId: arbText(row.session_id, arbText(row.sessionId)),
    ts: arbNumber(row.timestamp) ?? arbNumber(row.ts) ?? Date.now(),
    market: arbText(row.symbol, arbText(row.market)),
    pair: arbText(row.pair, `U${underBarrier}/O${overBarrier}`),
    payout: arbNumber(row.target_payout) ?? arbNumber(row.payout) ?? 0,
    currency: arbText(row.currency, 'USD'),
    lower: {
      contractType: arbText(lowerRaw?.contractType, 'DIGITUNDER'),
      barrier: underBarrier,
      askPrice: arbNumber(row.under_ask) ?? arbNumber(lowerRaw?.askPrice),
      payout: arbNumber(row.under_payout) ?? arbNumber(lowerRaw?.payout),
      proposalId: arbText(row.under_proposal_id, arbText(lowerRaw?.proposalId)) || undefined,
      requestedAt: arbNumber(row.under_request_sent_at) ?? arbNumber(lowerRaw?.requestedAt) ?? undefined,
      receivedAt: arbNumber(row.under_received_at) ?? arbNumber(lowerRaw?.receivedAt) ?? undefined,
      latencyMs: arbNumber(row.under_round_trip_ms) ?? arbNumber(lowerRaw?.latencyMs) ?? undefined,
    },
    upper: {
      contractType: arbText(upperRaw?.contractType, 'DIGITOVER'),
      barrier: overBarrier,
      askPrice: arbNumber(row.over_ask) ?? arbNumber(upperRaw?.askPrice),
      payout: arbNumber(row.over_payout) ?? arbNumber(upperRaw?.payout),
      proposalId: arbText(row.over_proposal_id, arbText(upperRaw?.proposalId)) || undefined,
      requestedAt: arbNumber(row.over_request_sent_at) ?? arbNumber(upperRaw?.requestedAt) ?? undefined,
      receivedAt: arbNumber(row.over_received_at) ?? arbNumber(upperRaw?.receivedAt) ?? undefined,
      latencyMs: arbNumber(row.over_round_trip_ms) ?? arbNumber(upperRaw?.latencyMs) ?? undefined,
    },
    totalCost: arbNumber(row.combined_cost) ?? arbNumber(row.totalCost),
    grossMargin: arbNumber(row.theoretical_profit) ?? arbNumber(row.grossMargin),
    roi: arbNumber(row.theoretical_roi) ?? arbNumber(row.roi),
    edge: arbNumber(row.theoretical_roi) ?? arbNumber(row.edge),
    syncMs: arbNumber(row.quote_gap_ms) ?? arbNumber(row.syncMs),
    syncQuality: arbText(row.sync_quality, arbText(row.syncQuality, 'incomplete')),
    status: statusRaw === 'incomplete_pair' ? 'incomplete' : statusRaw === 'invalid_pair' ? 'invalid' : statusRaw,
    diagnostic: arbText(row.reason, arbText(row.diagnostic)) || null,
  };
}

function normalizeArbSession(raw: unknown): ArbSessionSummary | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;
  return {
    id: arbText(row.id),
    startedAt: arbNumber(row.started_at) ?? arbNumber(row.startedAt) ?? Date.now(),
    stoppedAt: arbNumber(row.stopped_at) ?? arbNumber(row.stoppedAt),
    market: arbText(row.symbol, arbText(row.market)),
    pair: arbText(row.pair_key, arbText(row.pair)),
    payout: arbNumber(row.target_payout) ?? arbNumber(row.payout) ?? 0,
    currency: arbText(row.currency, 'USD'),
    observations: arbNumber(row.observation_count) ?? arbNumber(row.observations) ?? 0,
    validObservations: arbNumber(row.high_quality_count) ?? arbNumber(row.validObservations) ?? 0,
    bestEdge: arbNumber(row.bestEdge),
    avgEdge: arbNumber(row.avgEdge),
    reason: arbText(row.reason) || null,
  };
}

function unwrapArbState(res: unknown): ArbResearchState | null {
  const payload = res && typeof res === 'object' && Object.prototype.hasOwnProperty.call(res, 'state')
    ? (res as { state?: unknown }).state
    : res;
  if (!payload || typeof payload !== 'object') return null;
  const raw = payload as Record<string, unknown>;
  if (typeof raw.market === 'string' && typeof raw.phase === 'string') return raw as unknown as ArbResearchState;
  const config = raw.config as Record<string, unknown> | null | undefined;
  const pair = config?.pair as Record<string, unknown> | undefined;
  const session = raw.session as Record<string, unknown> | null | undefined;
  const latest = normalizeArbObservation(raw.latest);
  const under = arbNumber(pair?.underBarrier) ?? 0;
  const over = arbNumber(pair?.overBarrier) ?? 0;
  const running = Boolean(raw.running);
  return {
    phase: running ? 'observing' : session ? 'stopped' : 'idle',
    running,
    market: arbText(config?.symbol, arbText(session?.symbol)),
    pair: under > 0 ? `U${under}/O${over}` : arbText(session?.pair_key),
    payout: arbNumber(config?.targetPayout) ?? arbNumber(session?.target_payout) ?? 0,
    currency: arbText(config?.currency, arbText(session?.currency, 'USD')),
    sessionId: arbText(session?.id) || null,
    latest,
    observations: arbNumber(session?.observation_count) ?? 0,
    validObservations: arbNumber(session?.high_quality_count) ?? 0,
    lastActivityAt: latest?.ts,
    reason: latest?.diagnostic ?? null,
  };
}

export async function loadArbState(): Promise<void> {
  try {
    const res = await api<{ state?: ArbResearchState } | ArbResearchState>('/api/arb/state');
    const next = unwrapArbState(res);
    set({ arb: next });
  } catch {
    // The research module is optional on older deployments.
  }
}

export async function startArbResearch(opts: { market: string; pair: string; payout: number; currency?: string }): Promise<ArbResearchState> {
  const pair = /^U([1-9])\/O([0-8])$/.exec(opts.pair);
  if (!pair) throw new Error('Choose an adjacent U1/O0 through U9/O8 pair');
  const res = await api<{ state?: ArbResearchState } | ArbResearchState>('/api/arb/start', {
    method: 'POST',
    body: JSON.stringify({
      symbol: opts.market,
      under_barrier: Number(pair[1]),
      over_barrier: Number(pair[2]),
      target_payout: opts.payout,
    }),
  });
  const next = unwrapArbState(res);
  if (!next) throw new Error('Research engine did not return state');
  set({ arb: next, arbObservations: [] });
  return next;
}

export async function stopArbResearch(): Promise<ArbResearchState> {
  const res = await api<{ state?: ArbResearchState } | ArbResearchState>('/api/arb/stop', { method: 'POST' });
  const next = unwrapArbState(res);
  if (!next) throw new Error('Research engine did not return state');
  set({ arb: next });
  return next;
}

/** Explicit Demo-only paired-contract feasibility experiment. Never automatic. */
export async function runArbDemoFeasibility(input: { market: string; pair: string; payout: number }): Promise<ArbDemoExecutionState> {
  const res = await api<{ state: ArbDemoExecutionState }>('/api/arb/feasibility/demo', {
    method: 'POST',
    body: JSON.stringify({
      confirm_demo_execution: true,
      market: input.market,
      pair: input.pair,
      payout: input.payout,
    }),
  });
  set({ arbDemoExecution: res.state });
  return res.state;
}

export async function loadArbSessions(): Promise<ArbSessionSummary[]> {
  const res = await api<{ sessions?: unknown[] } | unknown[]>('/api/arb/research/sessions');
  const rows = Array.isArray(res) ? res : res.sessions ?? [];
  const sessions = rows.map(normalizeArbSession).filter((item): item is ArbSessionSummary => item !== null);
  set({ arbSessions: sessions });
  return sessions;
}

export async function loadArbObservations(opts?: { sessionId?: string; limit?: number; offset?: number; market?: string; pair?: string }): Promise<ArbObservation[]> {
  const params = new URLSearchParams();
  if (opts?.sessionId) params.set('session_id', opts.sessionId);
  if (opts?.limit) params.set('limit', String(opts.limit));
  if (opts?.offset) params.set('offset', String(opts.offset));
  if (opts?.market) params.set('symbol', opts.market);
  if (opts?.pair) params.set('pair', opts.pair);
  const suffix = params.size ? `?${params}` : '';
  const res = await api<{ observations?: unknown[] } | unknown[]>(`/api/arb/research/observations${suffix}`);
  const rows = Array.isArray(res) ? res : res.observations ?? [];
  const observations = rows.map(normalizeArbObservation).filter((item): item is ArbObservation => item !== null);
  set({ arbObservations: observations });
  return observations;
}

export async function deleteArbSession(sessionId: string): Promise<void> {
  await api(`/api/arb/research/sessions/${sessionId}`, { method: 'DELETE' });
  set({ arbSessions: state.arbSessions.filter((session) => session.id !== sessionId) });
}

export function arbReportUrl(sessionId: string): string {
  return `/api/arb/research/report?session_id=${encodeURIComponent(sessionId)}`;
}

export function arbExportUrl(sessionId: string): string {
  return `/api/arb/research/export?session_id=${encodeURIComponent(sessionId)}`;
}

export async function unlockDashboard(token: string): Promise<void> {
  await api('/api/auth/owner', { method: 'POST', body: JSON.stringify({ token }) });
  await bootstrap();
}

export async function arm(): Promise<void> {
  await api('/api/automation/arm', { method: 'POST' });
  return;
}

export async function loadDerivAccounts(): Promise<DerivAccountInfo[]> {
  const res = await api<{ accounts: DerivAccountInfo[] }>('/api/auth/accounts');
  return Array.isArray(res.accounts) ? res.accounts : [];
}

export async function switchDerivAccount(accountId: string): Promise<SessionInfo> {
  const res = await api<{ ok: boolean; session: SessionInfo }>('/api/auth/switch-account', {
    method: 'POST',
    body: JSON.stringify({ accountId }),
  });
  signalStabilizer.reset();
  set({ session: res.session, trades: [], performance: null, recovery: null, contract: null, decision: null });
  await refreshTrades();
  return res.session;
}

export interface ManualOrder {
  market: string;
  direction: 'over' | 'under';
  barrier: number;
  stake: number;
  estWin: number;
}

export interface ManualBasketResult {
  ok: boolean;
  batchId: string;
  purchased: number;
  failed: number;
}

export async function manualTrade(order: ManualOrder): Promise<void> {
  try {
    const res = await api<{ ok: boolean; trade: unknown }>('/api/trade/manual', {
      method: 'POST',
      body: JSON.stringify(order),
    });
    if (res.ok) {
      return;
    }
  } catch (err) {
    throw err;
  }
}

export async function updateSettings(patch: Partial<Settings>): Promise<Settings> {
  const res = await api<Settings>('/api/settings', {
    method: 'PUT',
    body: JSON.stringify(patch),
  });
  set({ settings: res });
  return res;
}

export function selectMarket(symbol: string | null): void {
  set({ selected: symbol });
}

export async function clearStuckTrade(): Promise<void> {
  try {
    const res = await api<{ ok: boolean; message: string }>('/api/trade/clear-stuck', { method: 'POST' });
    return;
  } catch (err) {
    throw err;
  }
}

const tradeRefreshes = new Map<number, Promise<void>>();

export async function refreshTrades(limit = 50): Promise<void> {
  const current = tradeRefreshes.get(limit);
  if (current) return current;
  const refresh = (async () => { try {
    const res = await api<{ trades: TradeRow[]; performance?: PerformanceSummary }>(`/api/history?limit=${limit}`);
    if (Array.isArray(res.trades)) set({ trades: res.trades.slice(0, limit), performance: res.performance ?? state.performance });
  } catch {
    // best-effort refresh; stale list is fine
  } })().finally(() => tradeRefreshes.delete(limit));
  tradeRefreshes.set(limit, refresh);
  return refresh;
}

export async function manualBasketTrade(orders: ManualOrder[]): Promise<ManualBasketResult> {
  return api<ManualBasketResult>('/api/trade/manual-basket', {
    method: 'POST',
    body: JSON.stringify({ orders }),
  });
}

/** Owner-only audit history. The API scopes account rows to the active login. */
export async function loadLedgerEntries(limit = 200): Promise<void> {
  try {
    const res = await api<{ entries: LedgerEntry[] }>(`/api/ledger?limit=${limit}`);
    set({ ledgerEntries: Array.isArray(res.entries) ? res.entries.slice(0, limit) : [] });
  } catch {
    // Keep the audit view empty when the dashboard is locked or an older server is running.
    set({ ledgerEntries: [] });
  }
}

/** Owner-only virtual paper history, intentionally separate from account audit rows. */
export async function loadPaperLedgerEntries(limit = 200): Promise<void> {
  try {
    const res = await api<{ entries: LedgerEntry[] }>(`/api/paper/history?limit=${limit}`);
    set({ paperLedgerEntries: Array.isArray(res.entries) ? res.entries.slice(0, limit) : [] });
  } catch {
    set({ paperLedgerEntries: [] });
  }
}

export async function resetPerformance(): Promise<void> {
  const performance = await api<PerformanceSummary>('/api/performance/reset', { method: 'POST' });
  set({ performance });
}

// ---- testlab actions ----

export async function loadTestRuns(kind?: 'backtest' | 'paper'): Promise<TestRunRow[]> {
  const qs = kind ? `?kind=${kind}` : '';
  const res = await api<{ runs: TestRunRow[] }>(`/api/test/runs${qs}`);
  const runs = Array.isArray(res.runs) ? res.runs : [];
  set({
    testRuns: kind ? [...runs, ...state.testRuns.filter((r) => r.kind !== kind)].sort((a, b) => b.id - a.id) : runs,
  });
  return runs;
}

export async function loadPatternsData(): Promise<void> {
  try {
    const res = await api<{ patterns: PatternRow[]; calibration: CalibrationReport }>('/api/patterns');
    set({ patterns: { patterns: res.patterns ?? [], calibration: res.calibration ?? null } });
  } catch {
    // best-effort
  }
}

export interface BacktestDetail {
  runs: TestRunRow[];
  results: Array<{ config: { strategyMode: string; botMode: string }; equity: number[] }>;
}

export async function runTestBacktest(opts?: { target?: number; configs?: string[] }): Promise<void> {
  const body: Record<string, unknown> = {};
  if (opts?.target !== undefined) body.target = opts.target;
  if (opts?.configs?.length) body.configs = opts.configs;
  const res = await api<{ ok: boolean } & BacktestDetail>('/api/test/backtest', {
    method: 'POST',
    body: JSON.stringify(body),
  });
  if (res.ok) {
    const equity: Record<string, number[]> = {};
    for (const r of res.results ?? []) {
      equity[`backtest-${r.config.strategyMode}-${r.config.botMode}`] = r.equity;
    }
    set({
      testRuns: [...(res.runs ?? []), ...state.testRuns.filter((r) => r.kind !== 'backtest')].sort((a, b) => b.id - a.id),
      testEquity: { ...state.testEquity, ...equity },
      testlab: null,
    });
  }
}

export async function runTestPaper(opts?: { tradesPerConfig?: number; configs?: string[] }): Promise<void> {
  const body: Record<string, unknown> = {};
  if (opts?.tradesPerConfig !== undefined) body.trades_per_config = opts.tradesPerConfig;
  if (opts?.configs?.length) body.configs = opts.configs;
  const res = await api<{ ok: boolean; result: { runs: TestRunRow[]; completed: number; failed: number } }>('/api/test/paper', {
    method: 'POST',
    body: JSON.stringify(body),
  });
  if (res.ok) {
    set({ testRuns: [...(res.result?.runs ?? []), ...state.testRuns.filter((r) => r.kind !== 'paper')].sort((a, b) => b.id - a.id), testlab: null });
  }
}

export async function runPatternScan(): Promise<void> {
  const res = await api<{ ok: boolean; result: { inserted: number; confirmed: number; noise: number } }>('/api/patterns/scan', {
    method: 'POST',
    body: JSON.stringify({}),
  });
  if (res.ok) {
    set({ testlab: null });
    await loadPatternsData();
  }
}
