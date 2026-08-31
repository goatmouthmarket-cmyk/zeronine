import { memo } from 'preact/compat';
import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import type { Market, TradeRow, LedgerEntry, Settings, SignalCandidate, QuoteEvt, Decision, ContractEvt, Recovery, TestRunRow, TestLabActive, PatternRow, DerivAccountInfo, AutomationState, MomentumScanMarket, MomentumScanSample, MomentumResearchRow, MomentumTradePurchase, MomentumTradeClose, PaperTrade, PaperPortfolio, GoldModuleState, GoldDemoAccount, GoldSide, GoldTimeframe, GoldDerivTradePurchase, GoldDerivTradeClose, MultiplierOptionsResult } from './store';
import { MomentumPriceChart } from './MomentumPriceChart';
import { GoldTradeChart } from './GoldTradeChart';
import { PaperSimulationStage, type PaperSimulationPhase } from './PaperSimulationStage';
import { MarketPulseChart } from './MarketPulseChart';
import {
  useStore,
  connectPat,
  unlockDashboard,
  oauthStart,
  logout,
  startAutomation,
  stopAutomation,
  selectMarket,
  manualTrade,
  manualBasketTrade,
  resetPerformance,
  updateSettings,
  loadTestRuns,
  loadPatternsData,
  loadAutoBacktestStatus,
  runTestBacktest,
  runPatternScan,
  refreshTrades,
  clearStuckTrade,
  syncCoreState,
  loadLedgerEntries,
  loadPaperTrade,
  loadPaperTrades,
  startPaperSimulation,
  stopPaperSimulation,
  resetPaperSimulation,
  loadDerivAccounts,
  switchDerivAccount,
  loadMomentumState,
  startMomentumResearch,
  stopMomentumResearch,
  focusMomentumMarket,
  placeMomentumDemoTrade,
  closeMomentumDemoTrade,
  loadGoldState,
  startGoldOAuth,
  disconnectGoldOAuth,
  loadGoldDemoAccounts,
  selectGoldDemoAccount,
  openGoldPaperTrade,
  closeGoldPaperTrade,
  resetGoldPaperTrade,
  placeGoldDerivTrade,
  closeGoldDerivTrade,
  loadMultiplierOptions,
  runGoldBacktest,
} from './store';
import './marketChooser.css';
import { confidenceForSetup, exactCandidateForSetup, rankMarketsForSetup, strongestManualSetup, strongestManualSetupForBarrier, strongestManualSetups, type ManualSetup } from './manualMarketRanking';

type Page = 'home' | 'bot' | 'history' | 'backtest' | 'momentum' | 'gold' | 'account';
type ActivitySource = 'manual' | 'bot' | 'paper' | 'backtest';
type ActivityDetail = { type: 'trade'; trade: TradeRow } | { type: 'run'; run: TestRunRow };

const PAGE_PATHS: Record<Page, string> = {
  home: '/',
  history: '/history',
  backtest: '/lab',
  bot: '/bot',
  momentum: '/momentum',
  gold: '/gold',
  account: '/account',
};

function pageFromPath(pathname: string): Page {
  const normalized = pathname.replace(/\/+$/, '') || '/';
  return (Object.entries(PAGE_PATHS).find(([, path]) => path === normalized)?.[0] ?? 'home') as Page;
}

function sourceForTrade(trade: TradeRow): ActivitySource {
  if (trade.origin === 'manual' || trade.reason === 'manual') return 'manual';
  return trade.origin === 'paper' ? 'paper' : 'bot';
}

function sourceLabel(source: ActivitySource): string {
  return source === 'backtest' ? 'Backtest' : source === 'paper' ? 'Paper' : source === 'manual' ? 'Manual' : 'Bot';
}

function isDigitTrade(trade: TradeRow): boolean {
  return trade.contract_type === 'DIGITOVER' || trade.contract_type === 'DIGITUNDER';
}

function isMultiplierTrade(trade: TradeRow): boolean {
  return trade.contract_type === 'MULTUP' || trade.contract_type === 'MULTDOWN';
}

function multiplierTradeFamily(trade: TradeRow): 'Gold' | 'Momentum' {
  return /gold/i.test(`${trade.reason ?? ''} ${trade.market ?? ''}`) ? 'Gold' : 'Momentum';
}

function tradeContractLabel(trade: TradeRow): string {
  if (trade.contract_type === 'DIGITOVER') return `Over ${trade.barrier}`;
  if (trade.contract_type === 'DIGITUNDER') return `Under ${trade.barrier}`;
  if (trade.contract_type === 'MULTUP') return `${multiplierTradeFamily(trade)} Up`;
  return `${multiplierTradeFamily(trade)} Down`;
}

const CURRENCY_SYMBOL: Record<string, string> = {
  USD: '$',
  EUR: '€',
  GBP: '£',
  AUD: 'A$',
  CAD: 'C$',
  SGD: 'S$',
  MYR: 'RM',
  IDR: 'Rp',
  JPY: '¥',
};

function fmtMoney(n: number, currency = ''): string {
  const symbol = CURRENCY_SYMBOL[currency] ?? (currency ? `${currency} ` : '');
  return `${symbol}${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtSigned(n: number, currency = ''): string {
  const symbol = CURRENCY_SYMBOL[currency] ?? (currency ? `${currency} ` : '');
  return `${n >= 0 ? '+' : '-'}${symbol}${Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtElapsed(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remaining = seconds % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(remaining).padStart(2, '0')}`
    : `${minutes}:${String(remaining).padStart(2, '0')}`;
}

function isOpenAccountTrade(trade: TradeRow): boolean {
  return trade.origin !== 'paper' && (trade.status === 'pending' || trade.status === 'purchasing');
}

function openTradeLockMessage(trade: TradeRow | null | undefined): string {
  if (!trade) return '';
  const label = tradeContractLabel(trade);
  const age = fmtElapsed(Date.now() - trade.ts);
  const reference = trade.contract_id || trade.purchase_id || String(trade.id);
  if (trade.contract_id) {
    return `${label} contract ${reference} is still open (${age} old); settlement recovery is active.`;
  }
  return `${label} order ${reference} is stuck locally (${age} old); verify no Deriv contract was created before clearing it.`;
}

function tradeDurationLabel(trade?: Pick<TradeRow, 'duration' | 'duration_unit'> | null): string {
  if (!trade || !(trade.duration > 0) || !trade.duration_unit) return '--';
  return `${trade.duration}${trade.duration_unit}`;
}

function shortMarketName(display: string): string {
  return display.split('(')[0].trim().replace(/\s*Index$/, '');
}

function sideLabel(direction: string, barrier: number): string {
  return direction === 'under' ? `Under ${barrier}` : `Over ${barrier}`;
}

const STRATEGY_META: Record<Settings['strategy_mode'], { label: string; hint: string }> = {
  conservative: {
    label: 'Conservative',
    hint: 'Only plays Over 0 / Under 9; on a loss it stakes to recover the lost amount',
  },
  martingale: {
    label: 'Martingale',
    hint: 'One-win recovery: stake sized to clear the whole debt on a determined barrier',
  },
  boosted_martingale: {
    label: 'Boosted Martingale',
    hint: 'One-win recovery plus a profit buffer; clears debt and a half base stake',
  },
  chase: {
    label: 'Chase',
    hint: 'Amortized recovery: each win pays a 35% chunk of the debt until cleared',
  },
};

const MODE_META: Record<Settings['bot_mode'], { label: string; hint: string }> = {
  rapid: {
    label: 'Rapid',
    hint: 'Fires on thinner edges — more bets, more often. Expect more volatility.',
  },
  balanced: {
    label: 'Balanced',
    hint: 'Default: only bets when the edge clearly clears the payout.',
  },
  strict: {
    label: 'Strict',
    hint: 'Waits for a wide edge — fewer trades, each with a big margin.',
  },
};

function useBotCooldown(): number {
  const s = useStore();
  const [left, setLeft] = useState(0);

  useEffect(() => {
    const tick = () => {
      setLeft(Math.max(0, Math.ceil((s.botCooldownUntil - Date.now()) / 1000)));
    };
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [s.botCooldownUntil]);

  return left;
}

/* ---------------- icons (thin line, one consistent set) ---------------- */

const ICON_PATHS: Record<string, JSX.Element> = {
  home: (
    <>
      <path d="M4 10.8 12 4l8 6.8" />
      <path d="M6.5 9.5V20h11V9.5" />
    </>
  ),
  history: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
      <path d="M9 3.5 6.5 5.5 9 7.5" />
    </>
  ),
  play: <path d="M7 5.5v13l11-6.5z" />,
  square: <rect x="6.5" y="6.5" width="11" height="11" rx="2" />,
  stats: (
    <>
      <path d="M4 20h16" />
      <path d="M7 16v-4" />
      <path d="M12 16V8" />
      <path d="M17 16v-7" />
    </>
  ),
  account: (
    <>
      <circle cx="12" cy="8" r="3.6" />
      <path d="M5.5 20c.8-3.4 3.4-5 6.5-5s5.7 1.6 6.5 5" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  rotateCcw: (
    <>
      <path d="M4 7v5h5" />
      <path d="M5.5 16.5A8 8 0 1 0 5 12" />
    </>
  ),
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  arrowUpRight: <path d="M7 17 17 7M8.5 7H17v8.5" />,
  arrowLeft: <path d="M19 12H5m6-6-6 6 6 6" />,
  arrowUp: <path d="M12 19V5m0 0-5.5 5.5M12 5l5.5 5.5" />,
  arrowDown: <path d="M12 5v14m0 0 5.5-5.5M12 19 6.5 13.5" />,
  dots: <path d="M6 12h.01M12 12h.01M18 12h.01" />,
  x: <path d="M6 6l12 12M18 6 6 18" />,
  crosshair: (
    <>
      <circle cx="12" cy="12" r="7" />
      <path d="M12 2.5v4M12 17.5v4M2.5 12h4M17.5 12h4" />
    </>
  ),
  chevronRight: <path d="M9 6l6 6-6 6" />,
  logout: (
    <>
      <path d="M9 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h3" />
      <path d="M15 8l4 4-4 4" />
      <path d="M19 12H9" />
    </>
  ),
  flame: (
    <>
      <path d="M12 3c1 2.5 3 3.5 3 6a3 3 0 0 1-6 0c0-1.5.7-2.3 1.3-3.4C9.9 4.8 10.4 3.6 12 3Z" />
      <path d="M12 4.5C13.5 6 15 7.8 15 10.2a3.6 3.6 0 0 1-7.2 0C7.8 8 9.4 6.2 12 4.5Z" />
      <path d="M10.6 15.8c-.4.9.1 1.9 1 2.2.5.2 1 0 1.3-.4" />
    </>
  ),
};

function Icon({
  name,
  size = 18,
  strokeWidth = 1.6,
}: {
  name: keyof typeof ICON_PATHS | string;
  size?: number;
  strokeWidth?: number;
}): JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {ICON_PATHS[name]}
    </svg>
  );
}

/* ---------------- app shell ---------------- */

export function App(): JSX.Element {
  const [page, setPage] = useState<Page>(() => pageFromPath(window.location.pathname));

  useEffect(() => {
    const handlePopState = () => setPage(pageFromPath(window.location.pathname));
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const navigate = useCallback((nextPage: Page) => {
    const nextPath = PAGE_PATHS[nextPage];
    if (window.location.pathname !== nextPath) window.history.pushState(null, '', nextPath);
    setPage(nextPage);
  }, []);

  useEffect(() => {
    if (page === 'history') void refreshTrades(200);
  }, [page]);

  return (
    <>
      <main class="app" data-page={page}>
        <div class="view view-home">
          <HomePage page={page} active={page === 'home'} onNavigate={navigate} />
        </div>
        <div class="desk-side">
          {page === 'bot' && <div class="view view-bot"><BotPage /></div>}
          {page === 'history' && <div class="view view-history"><HistoryPage /></div>}
          {page === 'backtest' && <div class="view view-backtest"><TestLabPage /></div>}
          {page === 'momentum' && <div class="view view-momentum"><MomentumPage /></div>}
          {page === 'gold' && <div class="view view-gold"><GoldPage /></div>}
          {page === 'account' && <div class="view view-account"><AccountPage /></div>}
        </div>
      </main>
      <BottomNav page={page} setPage={navigate} />
    </>
  );
}

function ConnectView({ embedded = false }: { embedded?: boolean }): JSX.Element {
  const s = useStore();
  const [token, setToken] = useState('');
  const [ownerToken, setOwnerToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [oauthBusy, setOauthBusy] = useState(false);

  const content = (
    <>
      <div class="connect-hero">
        <div class="brand connect-brand">
          <div class="logo">
            <span class="logo-zero"></span>
            <span class="logo-nine"></span>
          </div>
          <div class="brand-title">
            <span class="zero">Zero</span><span class="nine">Nine</span>
          </div>
        </div>
        <div class="connect-kicker">
          <span class="connect-hero-pulse" aria-hidden="true"><span></span><span></span><span></span></span>
          <span>ZeroNine trading workspace</span>
        </div>
        <h1>See the signal. Trade when you are ready.</h1>
        <p>Explore live market intelligence and shared research first. Connect Deriv only when you want to place a trade.</p>
      </div>

      <div class="connect-card">
        {s.publicDashboard && !s.owner && (
          <>
          <div class="connect-title">Owner access</div>
            <input
              class="connect-input"
              type="password"
              placeholder="Dashboard owner token"
              value={ownerToken}
              onInput={(e: any) => setOwnerToken(e.currentTarget.value)}
            />
            <button
              class="connect-btn"
              disabled={busy || !ownerToken.trim()}
              onClick={async () => {
                setBusy(true);
                setError('');
                try {
                  await unlockDashboard(ownerToken.trim());
                } catch (e) {
                  setError(String(e));
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? 'Unlocking...' : 'Unlock dashboard'}
            </button>
            <div class="connect-divider">or</div>
          </>
        )}
        <div class="connect-title">Connect Deriv</div>
        <div class="connect-copy">Use a trading-enabled token to activate manual trading and the bot.</div>
        <input
          class="connect-input"
          type="password"
          placeholder="Paste your Deriv API token"
          value={token}
          onInput={(e: any) => setToken(e.currentTarget.value)}
        />
        <button
          class="connect-btn"
          disabled={busy || !token.trim()}
          onClick={async () => {
            setBusy(true);
            setError('');
            try {
              await connectPat(token.trim());
            } catch (e) {
              setError(String(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? 'Connecting…' : 'Connect'}
        </button>
        {error && <div class="connect-err">{error}</div>}
        <div class="connect-divider">or</div>
        <button
          class="connect-btn connect-btn--oauth"
          disabled={oauthBusy}
          onClick={async () => {
            setOauthBusy(true);
            setError('');
            try {
              const url = await oauthStart();
              window.location.href = url;
            } catch (e) {
              setError(String(e));
              setOauthBusy(false);
            }
          }}
        >
          {oauthBusy ? 'Opening Deriv login…' : 'Sign in with Deriv'}
        </button>
        <div class="connect-hint">Demo or real account • trading-enabled API token</div>
        {s.ws === 'closed' && <div class="connect-err">Feed disconnected – reconnecting…</div>}
      </div>
    </>
  );
  return embedded ? <div class="connect-embedded">{content}</div> : <main class="app app--page">{content}</main>;
}

/* ---------------- home ---------------- */

function HomePage({ page, active, onNavigate }: { page: Page; active: boolean; onNavigate: (p: Page) => void }): JSX.Element {
  const s = useStore();
  const [startError, setStartError] = useState('');
  const [settlementBusy, setSettlementBusy] = useState(false);
  const [manualBusy, setManualBusy] = useState(false);
  const [manualMsg, setManualMsg] = useState('');
  const [manualError, setManualError] = useState(false);
  const [resettingPerformance, setResettingPerformance] = useState(false);
  const [activityDetail, setActivityDetail] = useState<ActivityDetail | null>(null);
  const [marketChooserOpen, setMarketChooserOpen] = useState(false);
  const [manualDirection, setManualDirection] = useState<'over' | 'under'>('over');
  const [manualOverBarrier, setManualOverBarrier] = useState(0);
  const [manualUnderBarrier, setManualUnderBarrier] = useState(9);
  const [manualStakeText, setManualStakeText] = useState('');
  const cooldownLeft = useBotCooldown();
  const manualStake = Math.max(0.1, Number(manualStakeText) || s.settings?.base_stake || 1);

  useEffect(() => {
    setManualStakeText((current) => current || String(s.settings?.base_stake ?? 1));
  }, [s.settings?.base_stake]);

  const market = s.markets.find((m) => m.symbol === s.selected) ?? s.markets[0];
  const automation = s.automation?.running ?? false;
  const guest = !s.session;
  const decision = automation ? s.decision?.decision : undefined;
  const digitTrades = useMemo(() => s.trades.filter(isDigitTrade), [s.trades]);
  const openAccountTrade = useMemo(() => s.trades.find((trade) => isOpenAccountTrade(trade) && isDigitTrade(trade)) ?? null, [s.trades]);
  const accountLockMessage = openTradeLockMessage(openAccountTrade);
  const startLocked = Boolean(openAccountTrade);

  const fallbackPerformance = useMemo(() => ({
    wins: digitTrades.filter((t) => t.status === 'won').length,
    losses: digitTrades.filter((t) => t.status === 'lost').length,
    pushes: digitTrades.filter((t) => t.status === 'push' || t.status === 'expired' || t.status === 'timeout').length,
    profit: digitTrades.reduce((acc, t) => acc + (t.profit ?? 0), 0),
  }), [digitTrades]);
  const performance = s.performance ?? fallbackPerformance;

  const activeDirection = decision?.direction ?? (s.settings?.barrier_preference === 'under' ? 'under' : 'over');
  const activeSide = decision ? sideLabel(decision.direction, decision.barrier) : activeDirection === 'under' ? 'Under 9' : 'Over 0';

  const candidates = s.signal?.signal.candidates ?? [];
  const heroCandidates = decision ? candidates : (s.displaySignal?.candidates ?? candidates);
  const tickerPredictions = useMemo(() => new Map(
    (s.signal?.signal.candidates ?? []).map((candidate) => [candidate.market, candidate]),
  ), [s.signal]);
  const tickerProfits = useMemo(() => {
    const totals = new Map<string, { count: number; profit: number }>();
    for (const trade of digitTrades) {
      const current = totals.get(trade.market) ?? { count: 0, profit: 0 };
      current.count += 1;
      current.profit += trade.profit ?? 0;
      totals.set(trade.market, current);
    }
    return totals;
  }, [digitTrades]);

  const currentStreak = useMemo(() => {
    let streak = 0;
    for (const t of digitTrades) {
      if (t.status === 'lost' || t.status === 'error') break;
      if (t.status === 'won') streak += 1;
    }
    return streak;
  }, [digitTrades]);

  useEffect(() => {
    void loadTestRuns();
  }, []);

  const recentItems = useMemo(() => digitTrades
    .map((trade) => ({ type: 'trade' as const, ts: trade.ts, trade }))
    .sort((a, b) => b.ts - a.ts)
    .slice(0, 5), [digitTrades]);
  const marketsBySymbol = useMemo(
    () => new Map(s.markets.map((item) => [item.symbol, item])),
    [s.markets],
  );
  const openMarketChooser = useCallback(() => setMarketChooserOpen(true), []);
  const closeMarketChooser = useCallback(() => setMarketChooserOpen(false), []);

  const toggleBot = async () => {
    setStartError('');
    if (guest) {
      onNavigate('account');
      return;
    }
    if (automation) {
      try {
        await stopAutomation();
      } catch (err) {
        setStartError(err instanceof Error ? err.message : String(err));
      }
      return;
    }
    if (cooldownLeft > 0) return;
    if (openAccountTrade) {
      setStartError(accountLockMessage);
      await syncCoreState();
      await refreshTrades();
      return;
    }
    try {
      const stake = Math.max(0.1, s.settings?.base_stake ?? 1);
      await startAutomation({ strategyMode: s.settings?.strategy_mode ?? 'conservative', baseStake: stake });
    } catch (err) {
      setStartError(err instanceof Error ? err.message : String(err));
    }
  };

  const placeManual = async (
    direction: 'over' | 'under',
    barrier = direction === 'under' ? 9 : 0,
    marketSymbol = market?.symbol,
  ): Promise<boolean> => {
    if (guest || !marketSymbol || manualBusy) return false;
    if (openAccountTrade) {
      setManualError(true);
      setManualMsg(accountLockMessage);
      await syncCoreState();
      await refreshTrades();
      return false;
    }
    setManualBusy(true);
    setManualMsg('');
    setManualError(false);
    try {
      const stake = manualStake;
      const selectedMarket = s.markets.find((item) => item.symbol === marketSymbol);
      const exactCandidate = exactCandidateForSetup(heroCandidates, marketSymbol, direction, barrier);
      const estWin = exactCandidate?.estWin ?? (selectedMarket ? confidenceForSetup(selectedMarket, direction, barrier) : 0);
      await manualTrade({ market: marketSymbol, direction, barrier, stake, estWin });
      const label = shortMarketName(s.markets.find((item) => item.symbol === marketSymbol)?.display ?? marketSymbol);
      setManualMsg(`${label} · ${direction === 'under' ? 'Under' : 'Over'} ${barrier} placed @ ${stake}`);
      return true;
    } catch (e) {
      setManualError(true);
      setManualMsg(e instanceof Error ? e.message : String(e));
      return false;
    } finally {
      setManualBusy(false);
    }
  };

  const placeManualBasket = async (setups: ManualSetup[]): Promise<boolean> => {
    if (guest || manualBusy || automation || setups.length !== 5) return false;
    if (openAccountTrade) {
      setManualError(true);
      setManualMsg(accountLockMessage);
      await syncCoreState();
      await refreshTrades();
      return false;
    }
    setManualBusy(true);
    setManualMsg('');
    setManualError(false);
    try {
      const stake = manualStake;
      const result = await manualBasketTrade(setups.map((setup) => ({
        market: setup.market,
        direction: setup.direction,
        barrier: setup.barrier,
        stake,
        estWin: setup.confidence,
      })));
      setManualMsg(`Basket placed · ${result.purchased}/5 contracts @ ${fmtMoney(stake, s.session?.currency)} each`);
      setManualError(result.failed > 0);
      return result.purchased > 0;
    } catch (e) {
      setManualError(true);
      setManualMsg(e instanceof Error ? e.message : String(e));
      return false;
    } finally {
      setManualBusy(false);
    }
  };

  const resetPerformanceTotals = async () => {
    if (resettingPerformance || !window.confirm('Reset dashboard performance totals? Trade history will be kept.')) return;
    setResettingPerformance(true);
    try {
      await resetPerformance();
    } finally {
      setResettingPerformance(false);
    }
  };

  const recoverOpenTrade = async () => {
    if (!openAccountTrade || settlementBusy) return;
    setSettlementBusy(true);
    setStartError('');
    try {
      if (!openAccountTrade.contract_id) await clearStuckTrade();
      await syncCoreState();
      await refreshTrades();
    } catch (err) {
      setStartError(err instanceof Error ? err.message : String(err));
    } finally {
      setSettlementBusy(false);
    }
  };

  return (
    <>
      <header class="header">
        <div class="header-top">
          <div class="brand">
            <div class="logo">
              <span class="logo-zero"></span>
              <span class="logo-nine"></span>
              <span class="logo-chart-arrow" aria-hidden="true">
                <svg viewBox="0 0 24 18" fill="none">
                  <path d="M2 15.5 8 10l4 3 8-9" />
                  <path d="M14.5 4H20v5.5" />
                </svg>
              </span>
            </div>
            <div class="brand-title">
              <span class="zero">Zero</span><span class="nine">Nine</span>
            </div>
          </div>
          <nav class="desktop-nav">
            <button class={`nav-link${page === 'home' ? ' active' : ''}`} onClick={() => onNavigate('home')}>Home</button>
            <button class={`nav-link${page === 'history' ? ' active' : ''}`} onClick={() => onNavigate('history')}>History</button>
            <button class={`nav-link${page === 'backtest' ? ' active' : ''}`} onClick={() => onNavigate('backtest')}>Lab</button>
            <button class={`nav-link${page === 'bot' ? ' active' : ''}`} onClick={() => onNavigate('bot')}>Bot</button>
            <button class={`nav-link${page === 'momentum' ? ' active' : ''}`} onClick={() => onNavigate('momentum')}>Momentum</button>
            <button class={`nav-link gold${page === 'gold' ? ' active' : ''}`} onClick={() => onNavigate('gold')}>Gold</button>
            <button class={`nav-link${page === 'account' ? ' active' : ''}`} onClick={() => onNavigate('account')}>Account</button>
          </nav>
          <div class="balance">
            <div class="balance-amount">{fmtMoney(s.session?.balance ?? 0, s.session?.currency)}</div>
            <button class="balance-add" type="button" onClick={() => onNavigate('account')} aria-label="Manage balance and switch Deriv account" title="Manage Deriv account">
              <Icon name="plus" size={14} strokeWidth={2.2} />
            </button>
          </div>
        </div>
        <div class="subtitle">{automation ? `Betting ${activeSide} or cycling` : 'Auto-cycling across markets'}</div>
      </header>

      {active && <div class="ticker">
        <div class="ticker-row">
          {s.markets.map((m) => (
            <TickerItem key={m.symbol} market={m} active={m.symbol === market?.symbol} prediction={tickerPredictions.get(m.symbol)} performance={tickerProfits.get(m.symbol)} />
          ))}
          {s.markets.map((m) => (
            <TickerItem key={`dup-${m.symbol}`} market={m} active={m.symbol === market?.symbol} prediction={tickerPredictions.get(m.symbol)} performance={tickerProfits.get(m.symbol)} />
          ))}
        </div>
      </div>}

      {active && <div class="dashboard">
        <div class="dash-main">
          <section class="trade-card">
            <DecisionHero
              markets={s.markets}
              selectedMarket={market ?? null}
              candidates={heroCandidates}
              quotes={s.quotes}
              decision={decision}
              automation={automation}
              phase={s.automation?.phase}
              observation={s.automation?.observation}
              holdReason={automation && !decision ? (s.hold?.reason ?? null) : null}
              stopReason={!automation ? (s.automation?.reason ?? null) : null}
              contract={s.contract}
              trades={s.trades}
              feedConnected={s.feed?.connected ?? false}
              recovery={s.recovery}
              onChooseMarket={openMarketChooser}
              marketChooserOpen={marketChooserOpen}
              onCloseMarketChooser={closeMarketChooser}
              manualDirection={manualDirection}
              manualOverBarrier={manualOverBarrier}
              manualUnderBarrier={manualUnderBarrier}
              manualStake={manualStakeText}
              onManualStake={setManualStakeText}
              onManualDirection={setManualDirection}
              onManualBarrier={(direction, barrier) => direction === 'over' ? setManualOverBarrier(barrier) : setManualUnderBarrier(barrier)}
              onManualMarket={selectMarket}
              onManualBasket={placeManualBasket}
            />

            <div class="manual-slot">
              {!automation && !decision && (
                <div class="side-selector">
                  <button
                    class={`side-btn over${manualDirection === 'over' ? ' active' : ''}`}
                    disabled={guest || !market || manualBusy || startLocked}
                    onClick={() => void placeManual('over', manualOverBarrier)}
                  >
                    <span class="side-name">Over {manualOverBarrier}</span>
                    <span class="side-odds">{shortMarketName(market?.display ?? market?.symbol ?? '')} · Entry {fmtMoney(manualStake, s.session?.currency)}</span>
                  </button>
                  <button
                    class={`side-btn under${manualDirection === 'under' ? ' active' : ''}`}
                    disabled={guest || !market || manualBusy || startLocked}
                    onClick={() => void placeManual('under', manualUnderBarrier)}
                  >
                    <span class="side-name">Under {manualUnderBarrier}</span>
                    <span class="side-odds">{shortMarketName(market?.display ?? market?.symbol ?? '')} · Entry {fmtMoney(manualStake, s.session?.currency)}</span>
                  </button>
                  <div class={`manual-msg${manualError ? ' error' : ''}`} aria-live="polite">{manualMsg}</div>
                </div>
              )}
            </div>

            {(startError || accountLockMessage) && (
              <div class="bot-feedback" aria-live="polite">
                <div class="bot-error">{startError || accountLockMessage}</div>
                {openAccountTrade && (
                  <button class="bot-inline-action" type="button" disabled={settlementBusy} onClick={() => void recoverOpenTrade()}>
                    {settlementBusy ? 'Checking...' : openAccountTrade.contract_id ? 'Refresh settlement' : 'Clear stuck local order'}
                  </button>
                )}
              </div>
            )}

            <button class={`bot-control${automation ? ' running' : ''}`} disabled={!automation && !guest && (cooldownLeft > 0 || startLocked)} onClick={() => void toggleBot()}>
              <Icon name={automation ? 'square' : 'play'} size={14} strokeWidth={2.2} />
              <span>{automation ? 'Stop Bot' : guest ? 'Connect Deriv to trade' : startLocked ? 'Settlement recovery active' : cooldownLeft > 0 ? `Start in ${cooldownLeft}s` : 'Start Bot'}</span>
            </button>
          </section>
        </div>

        <div class="dash-side">
          <section class="section">
            <div class="section-head">
              <div class="section-title">Recent Activity</div>
              <div class="perf perf-header" aria-label="Performance summary">
                <div class="perf-cell win"><div class="perf-value">{performance.wins}</div><div class="perf-label">W</div></div>
                <div class="perf-cell loss"><div class="perf-value">{performance.losses}</div><div class="perf-label">L</div></div>
                <div class="perf-cell push"><div class="perf-value">{performance.pushes}</div><div class="perf-label">P</div></div>
                <div class={`perf-cell profit${performance.profit >= 0 ? '' : ' negative'}`}>
                  <div class="perf-value">{fmtSigned(performance.profit, s.session?.currency)}</div>
                  <button class="perf-reset" type="button" disabled={resettingPerformance} onClick={() => void resetPerformanceTotals()} title="Reset dashboard performance" aria-label="Reset dashboard performance">
                    <Icon name="rotateCcw" size={10} strokeWidth={2} />
                  </button>
                </div>
              </div>
              {currentStreak > 0 && (
                <span class="activity-streak streak-up" key={currentStreak}>
                  <Icon name="flame" size={13} strokeWidth={1.8} />
                  {currentStreak} STREAK
                </span>
              )}
              <button class="section-action" onClick={() => onNavigate('history')}>View All</button>
            </div>
            <div class="activity">
              {digitTrades.length === 0 && <div class="empty-hint">No Over/Under trades yet - start the bot</div>}
              {recentItems.map((item) => (
                <ActivityRow key={`trade-${item.trade.id}`} trade={item.trade} market={marketsBySymbol.get(item.trade.market)} onOpen={() => setActivityDetail({ type: 'trade', trade: item.trade })} />
              ))}
            </div>
          </section>

          <section class="perf perf-footer">
            <div class="perf-cell win">
              <div class="perf-value">{performance.wins}</div>
              <div class="perf-label">Wins</div>
            </div>
            <div class="perf-cell loss">
              <div class="perf-value">{performance.losses}</div>
              <div class="perf-label">Losses</div>
            </div>
            <div class="perf-cell push">
              <div class="perf-value">{performance.pushes}</div>
              <div class="perf-label">Pushes</div>
            </div>
            <div class={`perf-cell profit${performance.profit >= 0 ? '' : ' negative'}`}>
              <div class="perf-value">{fmtSigned(performance.profit, s.session?.currency)}</div>
              <div class="perf-profit-meta">
                <div class="perf-label">Profit</div>
                <button class="perf-reset" type="button" disabled={resettingPerformance} onClick={() => void resetPerformanceTotals()} title="Reset dashboard performance" aria-label="Reset dashboard performance">
                  <Icon name="rotateCcw" size={11} strokeWidth={2} />
                </button>
              </div>
            </div>
          </section>
        </div>
      </div>}
      {active && activityDetail && <ActivityDetailModal detail={activityDetail} markets={s.markets} equity={s.testEquity} onClose={() => setActivityDetail(null)} />}
    </>
  );
}

const TickerItem = memo(function TickerItem({ market, active, prediction: pred, performance }: { market: Market; active: boolean; prediction?: SignalCandidate; performance?: { count: number; profit: number } }): JSX.Element {
  const digit = market.lastDigit >= 0 ? market.lastDigit : '–';
  const profit = performance?.profit ?? 0;

  return (
    <div
      class={`ticker-item${active ? ' active' : ''}`}
      onClick={() => selectMarket(market.symbol)}
    >
      <span class="tick-sym">{shortMarketName(market.display)}</span>
      <span class={`tick-digit${market.lastDigit === 0 ? ' zero' : market.lastDigit === 9 ? ' nine' : ''}`}>
        {digit}
      </span>
      <span class="tick-quote">{market.lastQuote != null ? market.lastQuote.toFixed(2) : '--'}</span>
      <span class={`tick-pred${pred ? ` ${pred.direction}` : ' none'}`}>
        {pred ? `${pred.direction === 'over' ? 'O' : 'U'}${Math.round(pred.estWin * 100)}%` : '—'}
      </span>
      {market.health && market.regime && (
        <span class={`tick-health ${market.health.label}`} title={market.health.reasons.join('; ')}>
          {market.health.score} {market.regime.regime.replace('_', ' ')}
        </span>
      )}
      <span class={`tick-pl${profit >= 0 ? ' pos' : ' neg'}`}>
        {performance?.count ? fmtSigned(profit, '$') : '·'}
      </span>
    </div>
  );
});

function ActivityRow({ trade, market, onOpen }: { trade: TradeRow; market?: Market; onOpen?: () => void }): JSX.Element {
  const win = trade.status === 'won';
  const loss = trade.status === 'lost';
  const exp = trade.status === 'expired' || trade.status === 'timeout';
  const err = trade.status === 'error';
  const pend = trade.status === 'pending' || trade.status === 'purchasing';
  const digitContract = isDigitTrade(trade);
  const label = tradeContractLabel(trade);
  const pnl = trade.profit ?? 0;
  const liveDigit = market?.lastDigit != null && market.lastDigit >= 0 ? market.lastDigit : null;
  const trustedDigitEntry = !digitContract || trade.entry_captured_at != null;
  const entryDigit = trustedDigitEntry && trade.entry_digit != null && trade.entry_digit >= 0 ? trade.entry_digit : '–';
  const currentDigit = pend && liveDigit != null ? liveDigit : trade.exit_digit != null && trade.exit_digit >= 0 ? trade.exit_digit : '–';
  const entryLabel = digitContract ? 'Setup' : 'Entry';
  const currentLabel = pend ? 'Live' : digitContract ? 'Result' : 'Exit';
  const currentSpot = pend ? market?.lastQuote : trade.exit_spot;
  const formatSpot = (value?: number | null) => value != null && Number.isFinite(value)
    ? value.toLocaleString(undefined, { maximumFractionDigits: 5 })
    : '--';

  const tone = win ? 'win' : loss ? 'loss' : 'push';
  const time = new Date(trade.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const resultText = win ? 'Won' : loss ? 'Lost' : exp ? 'Push' : err ? 'Error' : 'Open';
  const source = sourceForTrade(trade);
  const entryMarker = digitContract ? entryDigit : formatSpot(trade.entry_spot);
  const currentMarker = digitContract ? currentDigit : formatSpot(currentSpot);

  return (
    <div
      class={`activity-row trade-activity-row${onOpen ? ' activity-open' : ''}${pend ? ' pending' : ''}`}
      onClick={onOpen}
      onKeyDown={(event) => { if (onOpen && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); onOpen(); } }}
      role={onOpen ? 'button' : undefined}
      tabIndex={onOpen ? 0 : undefined}
    >
      <div class="activity-main">
        <div class="activity-betline">
          <span class="activity-bet">{shortMarketName(market?.display ?? trade.market)} · {label}</span>
          <span class="activity-stake">Entry ${(trade.stake ?? 0).toFixed(2)}</span>
          <span class={`activity-source ${source}`}>{sourceLabel(source)}</span>
        </div>
        <div class={`activity-result ${tone}`}>
          {pend && <span class="live-dot"></span>}
          <span class="activity-outcome">{resultText}</span>
          <span class="activity-meta">· {time}</span>
        </div>
        <div class="activity-track" aria-label={digitContract ? `Setup digit ${entryDigit}, ${currentLabel.toLowerCase()} digit ${currentDigit}` : `Entry spot ${entryMarker}, ${currentLabel.toLowerCase()} spot ${currentMarker}`}>
          <div class="activity-point">
            <span class="activity-point-label">{entryLabel}</span>
            <strong class="activity-point-digit">{entryMarker}</strong>
            <span class="activity-point-quote">{trustedDigitEntry ? formatSpot(trade.entry_spot) : 'legacy entry unavailable'}</span>
          </div>
          <span class="activity-track-arrow" aria-hidden="true">→</span>
          <div class={`activity-point ${pend ? 'live' : tone}`}>
            <span class="activity-point-label">{currentLabel}</span>
            <strong class="activity-point-digit">{currentMarker}</strong>
            <span class="activity-point-quote">{formatSpot(currentSpot)}</span>
          </div>
        </div>
      </div>
      <div class="activity-pnl">
        <div class={win ? 'pnl-win' : loss ? 'pnl-loss' : 'pnl-zero'}>
          {pend || exp || err ? '—' : fmtSigned(pnl, '$')}
        </div>
      </div>
    </div>
  );
}

function ActivityRunRow({ run, onOpen }: { run: TestRunRow; onOpen: () => void }): JSX.Element {
  const source: ActivitySource = run.kind === 'backtest' ? 'backtest' : 'paper';
  const pnl = run.net_pnl ?? 0;
  const tone = pnl > 0 ? 'win' : pnl < 0 ? 'loss' : 'push';
  const time = new Date(run.finished_at || run.started_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return (
    <button type="button" class="activity-row activity-open" onClick={onOpen}>
      <div class={`activity-digit ${tone}`}>{source === 'backtest' ? 'B' : 'P'}</div>
      <div class="activity-main">
        <div class="activity-betline">
          <span class="activity-bet">{source === 'backtest' ? 'Strategy replay' : 'Paper sweep'}</span>
          <span class={`activity-source ${source}`}>{sourceLabel(source)}</span>
        </div>
        <div class={`activity-result ${tone}`}>
          <span class="activity-outcome">{run.wins}/{run.trades} wins</span>
          <span class="activity-meta">{time}</span>
        </div>
      </div>
      <div class="activity-pnl"><div class={pnl > 0 ? 'pnl-win' : pnl < 0 ? 'pnl-loss' : 'pnl-zero'}>{fmtSigned(pnl, '$')}</div></div>
    </button>
  );
}

function DetailSparkline({ values }: { values: number[] }): JSX.Element {
  const points = values.filter(Number.isFinite);
  if (points.length < 2) return <div class="detail-chart-empty">No recorded path</div>;
  const width = 360;
  const height = 112;
  const pad = 9;
  const low = Math.min(...points);
  const high = Math.max(...points);
  const range = high - low || 1;
  const path = points.map((value, index) => {
    const x = pad + ((width - pad * 2) * index) / (points.length - 1);
    const y = height - pad - ((value - low) / range) * (height - pad * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const up = points.at(-1)! >= points[0];
  return <svg class={`detail-chart ${up ? 'up' : 'down'}`} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label="Trade price path"><path d={`M${path.join(' L')}`} /></svg>;
}

function ActivityDetailModal({ detail, markets, equity, onClose }: { detail: ActivityDetail; markets: Market[]; equity: Record<string, number[]>; onClose: () => void }): JSX.Element {
  useEffect(() => {
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [onClose]);

  const trade = detail.type === 'trade' ? detail.trade : null;
  const run = detail.type === 'run' ? detail.run : null;
  const source = trade ? sourceForTrade(trade) : (run?.kind === 'backtest' ? 'backtest' : 'paper');
  const market = trade ? markets.find((item) => item.symbol === trade.market) : null;
  const digitContract = trade ? isDigitTrade(trade) : false;
  const exactPath = trade?.entry_spot != null && trade.exit_spot != null;
  const path = trade ? (exactPath ? [trade.entry_spot!, trade.exit_spot!] : market?.recentQuotes ?? []) : equity[`${run?.kind}-${run?.strategy_mode}-${run?.bot_mode}`] ?? [0, run?.net_pnl ?? 0];
  const title = trade ? tradeContractLabel(trade) : run?.kind === 'backtest' ? 'Backtest run' : 'Paper sweep';
  const storedEstimate = trade != null && Number.isFinite(trade.est_win) && trade.est_win > 0 && trade.est_win < 1;
  const baselineEstimate = trade && digitContract
    ? trade.contract_type === 'DIGITOVER' ? (9 - trade.barrier) / 10 : trade.barrier / 10
    : 0;
  const estimatedWin = trade ? (storedEstimate ? trade.est_win : baselineEstimate) : 0;
  const settledForLearning = trade?.status === 'won' || trade?.status === 'lost';
  const learningText = trade
    ? settledForLearning
      ? `This ${trade.status} result is saved as calibration evidence for ${shortMarketName(market?.display ?? trade.market)} · ${title}. It helps measure whether the ${Math.round(estimatedWin * 100)}% forecast was too high or too low; future tuning uses a group of settled results so one bet cannot oversteer predictions.`
      : `Once this bet settles, its result will be compared with the ${Math.round(estimatedWin * 100)}% forecast and retained as calibration evidence for this exact market, direction, and barrier.`
    : '';

  return (
    <div class="detail-backdrop" role="presentation" onClick={onClose}>
      <section class="activity-detail" role="dialog" aria-modal="true" aria-label={`${title} details`} onClick={(event) => event.stopPropagation()}>
        <div class="detail-head">
          <div><span class={`activity-source ${source}`}>{sourceLabel(source)}</span><h2>{title}</h2></div>
          <button class="detail-close" type="button" onClick={onClose} aria-label="Close trade details"><Icon name="x" size={18} /></button>
        </div>
        <div class="detail-chart-wrap">
          <div class="detail-chart-label">{trade ? exactPath ? 'Entry to exit' : 'Current market context' : 'Run equity'}</div>
          <DetailSparkline values={path} />
        </div>
        {trade ? (
          <div class="detail-grid">
            <Detail label="Market" value={shortMarketName(market?.display ?? trade.market)} />
            <Detail label="Entry amount" value={fmtMoney(trade.stake, '$')} />
            <Detail label="Payout" value={fmtMoney(trade.payout, '$')} />
            <Detail label="Estimated win" value={digitContract ? `${(estimatedWin * 100).toFixed(1)}%${storedEstimate ? '' : ' baseline'}` : storedEstimate ? `${(estimatedWin * 100).toFixed(1)}%` : '--'} />
            <Detail label="Entry spot" value={trade.entry_spot != null ? String(trade.entry_spot) : '--'} />
            <Detail label="Exit" value={trade.exit_spot != null ? String(trade.exit_spot) : '--'} />
            <Detail label="Reason" value={trade.reason || '--'} />
            <Detail label="Result" value={trade.status} color={trade.status === 'won' ? 'green' : trade.status === 'lost' ? 'red' : undefined} />
            <div class={`detail-learning${settledForLearning ? ' settled' : ''}`}>
              <span class="detail-learning-label">Prediction learning</span>
              <p>{learningText}</p>
            </div>
          </div>
        ) : run ? (
          <div class="detail-grid">
            <Detail label="Strategy" value={run.strategy_mode.replace('_', ' ')} />
            <Detail label="Mode" value={run.bot_mode} />
            <Detail label="Trades" value={String(run.trades)} />
            <Detail label="Win rate" value={run.win_rate != null ? `${run.win_rate.toFixed(1)}%` : '--'} />
            <Detail label="Net PnL" value={fmtSigned(run.net_pnl, '$')} color={run.net_pnl >= 0 ? 'green' : 'red'} />
            <Detail label="Drawdown" value={run.max_drawdown_pct != null ? `${run.max_drawdown_pct.toFixed(1)}%` : '--'} />
          </div>
        ) : null}
      </section>
    </div>
  );
}

/* ---------------- market scanner hero ---------------- */

interface HeroTarget {
  market: string;
  direction: 'over' | 'under';
  barrier: number;
  estWin: number;
  edge: number;
  breakeven: number;
  consistency: number;
  learnedWin: number | null;
}

function scannerPhaseLabel(phase?: string): string {
  switch (phase) {
    case 'scanning':
      return 'SCANNING DIGITS';
    case 'waiting-edge':
      return 'NO EDGE — KEEP SCANNING';
    case 'quoting':
    case 'waiting-quotes':
      return 'CHECKING QUOTES';
    case 'deciding':
      return 'LOCKING TARGET';
    case 'observing':
      return 'RECALCULATING SIGNAL';
    case 'watching-signal':
      return 'CONFIRMING SIGNAL';
    case 'buying':
      return 'PLACING BET';
    case 'settling':
      return 'AWAITING RESULT';
    case 'settled':
      return 'ROUND COMPLETE';
    case 'waiting-connection':
      return 'RECONNECTING';
    case 'waiting-settlement':
      return 'AWAITING SETTLEMENT';
    default:
      return phase ? phase.toUpperCase().replace(/-/g, ' ') : 'SCANNING';
  }
}

function ObservationRail({
  automation,
  phase,
  observation,
  reason,
  compact = false,
}: {
  automation: boolean;
  phase?: string;
  observation?: AutomationState['observation'];
  reason?: string | null;
  compact?: boolean;
}): JSX.Element {
  const executing = phase === 'buying' || phase === 'settling' || phase === 'settled';
  const confirmed = observation?.phase === 'confirmed' || executing;
  const watching = observation?.phase === 'watching' || phase === 'watching-signal';
  const activeIndex = !automation ? -1 : executing ? 3 : confirmed ? 2 : watching ? 1 : 0;
  const progress = observation && observation.required > 1
    ? `${observation.confirmations}/${observation.required} fresh ticks`
    : observation?.required === 1
      ? '1 fresh tick required'
      : 'evaluating every market';
  const message = !automation
    ? 'Starts observing when the bot runs.'
    : executing
      ? phase === 'settling' ? 'Snipe placed — watching the next tick settle.' : 'Qualified setup passed every gate.'
      : watching
        ? `Strongest setup is holding · ${progress}`
        : reason || 'Comparing probability, payout edge, and market strength.';
  const steps = ['Observe', 'Watch', 'Confirm', 'Snipe'];

  return (
    <div class={`observe-rail${compact ? ' compact' : ''}`} aria-live="polite" aria-label={`Automated decision state: ${steps[Math.max(0, activeIndex)]}`}>
      <div class="observe-rail-top">
        <span class="observe-rail-kicker">Observe → Observe → Snipe</span>
        <span class={`observe-rail-mode${automation ? ' live' : ''}`}><i></i>{automation ? 'LIVE INTELLIGENCE' : 'STANDBY'}</span>
      </div>
      <div class="observe-rail-track">
        {steps.map((step, index) => (
          <div class={`observe-step${index < activeIndex ? ' passed' : index === activeIndex ? ' active' : ''}`}>
            <span>{index < activeIndex ? '✓' : String(index + 1).padStart(2, '0')}</span>
            <b>{step}</b>
          </div>
        ))}
      </div>
      <div class="observe-rail-message">
        {watching && <span class="observe-mini-pulse" aria-hidden="true"></span>}
        <span>{message}</span>
        {automation && observation && !executing && <b>{progress}</b>}
      </div>
    </div>
  );
}

function resolveTarget(
  candidates: SignalCandidate[],
  quotes: Record<string, QuoteEvt>,
  decision?: Decision,
  preferredMarket?: string | null,
): HeroTarget | null {
  const key = (m: string, d: string, b: number) => `${m}|${d}|${b}`;
  if (decision) {
    const q = quotes[key(decision.market, decision.direction, decision.barrier)];
    const ratio = q?.ask && q?.payout ? q.payout / q.ask : decision.payout ?? 0;
    const breakeven = ratio > 0 ? 1 / ratio : 0;
    const matched = candidates.find(
      (c) => c.market === decision.market && c.direction === decision.direction && c.barrier === decision.barrier,
    );
    return {
      market: decision.market,
      direction: decision.direction,
      barrier: decision.barrier,
      estWin: decision.estWin,
      edge: breakeven > 0 ? decision.estWin - breakeven : 0,
      breakeven,
      consistency: matched?.consistency ?? 0.5,
      learnedWin: matched?.learnedWin ?? null,
    };
  }
  const c = preferredMarket
    ? candidates.find((candidate) => candidate.market === preferredMarket)
    : candidates[0];
  if (!c) return null;
  const q = quotes[key(c.market, c.direction, c.barrier)];
  const ratio = q?.ask && q?.payout ? q.payout / q.ask : c.estPayout;
  const breakeven = ratio > 0 ? 1 / ratio : 0;
  return {
    market: c.market,
    direction: c.direction,
    barrier: c.barrier,
    estWin: c.estWin,
    edge: q?.realEdge ?? c.edge,
    breakeven,
    consistency: c.consistency,
    learnedWin: c.learnedWin ?? null,
  };
}

function MarketPulse({ market, onChoose }: { market: Market | null; onChoose: () => void }): JSX.Element {
  const quotes = (market?.recentQuotes ?? []).filter((quote) => Number.isFinite(quote) && quote > 0);
  const first = quotes[0] ?? 0;
  const last = quotes[quotes.length - 1] ?? market?.lastQuote ?? 0;
  const changePct = first > 0 ? ((last - first) / first) * 100 : 0;
  const up = last >= first;
  const label = shortMarketName(market?.display ?? 'Selected market');

  return (
    <div class="market-pulse-shell">
      <button id="market-pulse-trigger" type="button" class={`market-pulse${up ? ' up' : ' down'}`} aria-label="Choose a market and manual barrier from the live quote chart" onClick={onChoose}>
        <div class="market-pulse-head">
          <span class="market-pulse-label">Live quote</span>
          <span class={`market-pulse-change${up ? ' up' : ' down'}`}>{quotes.length > 1 ? `${up ? '+' : ''}${changePct.toFixed(2)}%` : '--'}</span>
        </div>
        <div class="market-pulse-chart">
          {quotes.length > 1 ? <MarketPulseChart quotes={quotes} lastEpoch={market?.lastEpoch ?? 0} up={up} label={label} /> : <span class="market-pulse-empty">Awaiting ticks</span>}
        </div>
        <div class="market-pulse-foot">
          <span>{label}</span>
          <b>{last > 0 ? last.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '--'}</b>
        </div>
      </button>
      <a class="market-pulse-attribution" href="https://www.tradingview.com/" target="_blank" rel="noreferrer">Charts by TradingView</a>
    </div>
  );
}

function InlineMarketChooser({
  markets,
  candidates,
  selectedMarket,
  direction,
  barrier,
  stake,
  onDirection,
  onBarrier,
  onMarket,
  onStake,
  onBasket,
  onClose,
}: {
  markets: Market[];
  candidates: SignalCandidate[];
  selectedMarket: Market | null;
  direction: 'over' | 'under';
  barrier: number;
  stake: string;
  onDirection: (direction: 'over' | 'under') => void;
  onBarrier: (direction: 'over' | 'under', barrier: number) => void;
  onMarket: (symbol: string) => void;
  onStake: (stake: string) => void;
  onBasket: (setups: ManualSetup[]) => Promise<boolean>;
  onClose: () => void;
}): JSX.Element {
  const [execution, setExecution] = useState<'single' | 'basket'>('single');
  const calculateRanking = () => rankMarketsForSetup(markets, candidates, direction, barrier);
  const [rankedSymbols, setRankedSymbols] = useState<string[]>(() => calculateRanking().map((market) => market.symbol));
  useEffect(() => {
    setRankedSymbols(calculateRanking().map((market) => market.symbol));
  }, [direction, barrier]);
  useEffect(() => {
    if (rankedSymbols.length === 0 && markets.length > 0) {
      setRankedSymbols(calculateRanking().map((market) => market.symbol));
    }
  }, [markets.length, rankedSymbols.length]);
  const ranked = rankedSymbols
    .map((symbol) => markets.find((market) => market.symbol === symbol))
    .filter((market): market is Market => Boolean(market));
  const exact = selectedMarket ? exactCandidateForSetup(candidates, selectedMarket.symbol, direction, barrier) ?? null : null;
  const selectedConfidence = selectedMarket ? exact?.estWin ?? confidenceForSetup(selectedMarket, direction, barrier) : null;
  const basket = strongestManualSetups(markets, candidates, 5);
  const basketStake = Math.max(0.1, Number(stake) || 1);
  const min = direction === 'over' ? 0 : 1;
  const max = direction === 'over' ? 8 : 9;
  const setDirection = (next: 'over' | 'under') => {
    onDirection(next);
    const nextMin = next === 'over' ? 0 : 1;
    const nextMax = next === 'over' ? 8 : 9;
    onBarrier(next, Math.max(nextMin, Math.min(nextMax, barrier)));
  };
  const useStrongestForBarrier = () => {
    const strongest = strongestManualSetupForBarrier(markets, candidates, barrier);
    if (!strongest) return;
    onDirection(strongest.direction);
    onBarrier(strongest.direction, barrier);
    onMarket(strongest.market);
    setRankedSymbols(
      rankMarketsForSetup(markets, candidates, strongest.direction, barrier)
        .map((market) => market.symbol),
    );
  };
  const useStrongest = () => {
    const strongest = strongestManualSetup(markets, candidates);
    if (!strongest) return;
    onDirection(strongest.direction);
    onBarrier(strongest.direction, strongest.barrier);
    onMarket(strongest.market);
    setRankedSymbols(
      rankMarketsForSetup(markets, candidates, strongest.direction, strongest.barrier)
        .map((market) => market.symbol),
    );
  };
  const placeBasket = async () => {
    if (basket.length !== 5) return;
    if (await onBasket(basket)) onClose();
  };

  return (
    <section class="inline-market-chooser" aria-label="Manual market and barrier setup">
      <div class="inline-chooser-head">
        <span>Manual setup</span>
        <button type="button" onClick={onClose} aria-label="Return to live chart">×</button>
      </div>
      <div class="inline-execution" role="group" aria-label="Manual execution mode">
        <button type="button" class={execution === 'single' ? 'active' : ''} onClick={() => setExecution('single')}>Single</button>
        <button type="button" class={execution === 'basket' ? 'active' : ''} onClick={() => setExecution('basket')}>5 at once</button>
      </div>
      {execution === 'single' ? <>
      <label class="inline-market-select">
        <span>Market · strongest first</span>
        <select value={selectedMarket?.symbol ?? ''} onChange={(event) => {
          const symbol = (event.currentTarget as HTMLSelectElement).value;
          onMarket(symbol);
        }}>
          {ranked.map((market, index) => {
            const candidate = exactCandidateForSetup(candidates, market.symbol, direction, barrier);
            const confidence = candidate?.estWin ?? confidenceForSetup(market, direction, barrier);
            return <option value={market.symbol} key={market.symbol}>{index + 1}. {shortMarketName(market.display)} · {Math.round(confidence * 100)}%</option>;
          })}
        </select>
      </label>
      <div class="inline-direction" role="group" aria-label="Manual direction">
        <button type="button" class={direction === 'over' ? 'active over' : ''} onClick={() => setDirection('over')}>Over</button>
        <button type="button" class={direction === 'under' ? 'active under' : ''} onClick={() => setDirection('under')}>Under</button>
      </div>
      <div class="inline-barrier">
        <span>Barrier</span>
        <button type="button" onClick={() => onBarrier(direction, Math.max(min, barrier - 1))} aria-label="Decrease barrier">−</button>
        <input type="number" inputMode="numeric" min={min} max={max} step={1} value={barrier} onInput={(event) => onBarrier(direction, Math.max(min, Math.min(max, Number((event.currentTarget as HTMLInputElement).value))))} />
        <button type="button" onClick={() => onBarrier(direction, Math.min(max, barrier + 1))} aria-label="Increase barrier">+</button>
      </div>
      <label class="inline-stake">
        <span>Amount</span>
        <input type="number" inputMode="decimal" min="0.1" step="0.1" value={stake} onInput={(event) => onStake((event.currentTarget as HTMLInputElement).value)} />
      </label>
      <div class="inline-confidence">
        <div><span>Confidence</span><b>{selectedConfidence != null ? `${(selectedConfidence * 100).toFixed(1)}%` : '—'}</b></div>
        <div><span>Edge</span><b class={exact && exact.edge >= 0 ? 'positive' : ''}>{exact ? `${exact.edge >= 0 ? '+' : ''}${(exact.edge * 100).toFixed(1)}%` : '—'}</b></div>
        <div class="inline-confidence-actions">
          <button type="button" title={`Choose the strongest Over/Under prediction for barrier ${barrier}`} onClick={useStrongestForBarrier} disabled={!ranked.length}>Best for {barrier}</button>
          <button type="button" class="secondary" onClick={useStrongest} disabled={!ranked.length}>Best overall</button>
        </div>
      </div>
      <p>Use the existing buttons below to place this setup.</p>
      </> : <>
        <div class="inline-basket-list" aria-label="Five basket predictions">
          {basket.map((setup, index) => {
            const basketMarket = markets.find((item) => item.symbol === setup.market);
            return <div class="inline-basket-leg" key={setup.market}>
              <span>{index + 1}</span>
              <b>{shortMarketName(basketMarket?.display ?? setup.market)}</b>
              <em>{sideLabel(setup.direction, setup.barrier)}</em>
              <strong>{Math.round(setup.confidence * 100)}%</strong>
            </div>;
          })}
        </div>
        <label class="inline-stake basket-stake">
          <span>Stake per trade</span>
          <input type="number" inputMode="decimal" min="0.1" step="0.1" value={stake} onInput={(event) => onStake((event.currentTarget as HTMLInputElement).value)} />
        </label>
        <div class="inline-basket-total"><span>Total exposure</span><b>{fmtMoney(basketStake * 5)}</b></div>
        <button class="inline-basket-place" type="button" disabled={basket.length !== 5} onClick={() => void placeBasket()}>Place 5 predictions together</button>
      </>}
    </section>
  );
}

function MarketConfidenceChooser({
  markets,
  candidates,
  selectedMarket,
  stake,
  busy,
  guest,
  onClose,
  onSelect,
  onPlace,
}: {
  markets: Market[];
  candidates: SignalCandidate[];
  selectedMarket: string | null;
  stake: number;
  busy: boolean;
  guest: boolean;
  onClose: () => void;
  onSelect: (symbol: string) => void;
  onPlace: (direction: 'over' | 'under', barrier: number, market: string) => Promise<boolean>;
}): JSX.Element {
  const strongest = [...candidates].sort((a, b) => b.estWin - a.estWin || b.edge - a.edge)[0] ?? null;
  const initialCandidate = candidates.find((candidate) => candidate.market === selectedMarket) ?? strongest;
  const [marketSymbol, setMarketSymbol] = useState(selectedMarket ?? strongest?.market ?? markets[0]?.symbol ?? '');
  const [direction, setDirection] = useState<'over' | 'under'>(initialCandidate?.direction ?? 'over');
  const [barrier, setBarrier] = useState(initialCandidate?.barrier ?? 0);
  const [error, setError] = useState('');

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const bestByMarket = new Map<string, SignalCandidate>();
  for (const candidate of candidates) {
    const current = bestByMarket.get(candidate.market);
    if (!current || candidate.estWin > current.estWin || (candidate.estWin === current.estWin && candidate.edge > current.edge)) {
      bestByMarket.set(candidate.market, candidate);
    }
  }
  const ranked = [...markets].sort((a, b) => {
    const aCandidate = bestByMarket.get(a.symbol);
    const bCandidate = bestByMarket.get(b.symbol);
    return (bCandidate?.estWin ?? -1) - (aCandidate?.estWin ?? -1)
      || (bCandidate?.edge ?? -1) - (aCandidate?.edge ?? -1)
      || (b.health?.score ?? 0) - (a.health?.score ?? 0);
  });
  const selected = markets.find((market) => market.symbol === marketSymbol) ?? null;
  const recommendation = bestByMarket.get(marketSymbol) ?? null;
  const exactRecommendation = recommendation?.direction === direction && recommendation.barrier === barrier ? recommendation : null;
  const ratio = exactRecommendation?.estPayout ?? 0;
  const breakeven = ratio > 0 ? 1 / ratio : null;

  const chooseMarket = (symbol: string) => {
    setMarketSymbol(symbol);
    onSelect(symbol);
    const recommended = bestByMarket.get(symbol);
    if (recommended) {
      setDirection(recommended.direction);
      setBarrier(recommended.barrier);
    }
  };
  const chooseDirection = (next: 'over' | 'under') => {
    setDirection(next);
    setBarrier((current) => next === 'over' ? Math.max(0, Math.min(8, current)) : Math.max(1, Math.min(9, current || 9)));
  };
  const useStrongest = () => {
    if (!strongest) return;
    chooseMarket(strongest.market);
    setDirection(strongest.direction);
    setBarrier(strongest.barrier);
  };
  const place = async () => {
    setError('');
    const valid = Number.isInteger(barrier) && (direction === 'over' ? barrier >= 0 && barrier <= 8 : barrier >= 1 && barrier <= 9);
    if (!valid) {
      setError(direction === 'over' ? 'Over barrier must be from 0 to 8.' : 'Under barrier must be from 1 to 9.');
      return;
    }
    if (await onPlace(direction, barrier, marketSymbol)) onClose();
    else setError('The order was not placed. Check the account message and try again.');
  };

  return (
    <div class="market-chooser-backdrop" role="presentation" onClick={onClose}>
      <section class="market-chooser" role="dialog" aria-modal="true" aria-labelledby="market-chooser-title" onClick={(event) => event.stopPropagation()}>
        <header class="market-chooser-head">
          <div>
            <span class="market-chooser-kicker">Manual setup</span>
            <h2 id="market-chooser-title">Choose the strongest market</h2>
            <p>Selecting a setup never places a trade.</p>
          </div>
          <button type="button" class="market-chooser-close" onClick={onClose} aria-label="Close market chooser">×</button>
        </header>

        <div class="market-rank" aria-label="Markets ranked by confidence">
          {ranked.map((market, index) => {
            const candidate = bestByMarket.get(market.symbol);
            return (
              <button type="button" class={`market-rank-row${market.symbol === marketSymbol ? ' selected' : ''}`} onClick={() => chooseMarket(market.symbol)} key={market.symbol}>
                <span class="market-rank-number">{String(index + 1).padStart(2, '0')}</span>
                <span class="market-rank-name"><b>{shortMarketName(market.display)}</b><small>{market.regime?.regime.replace('_', ' ') ?? 'scanning'}</small></span>
                <span class="market-rank-call">{candidate ? sideLabel(candidate.direction, candidate.barrier) : 'No signal'}</span>
                <span class="market-rank-confidence">{candidate ? `${Math.round(candidate.estWin * 100)}%` : '—'}</span>
                <span class={`market-rank-health ${market.health?.label ?? 'weak'}`}>{market.health?.score ?? 0}</span>
              </button>
            );
          })}
        </div>

        <div class="manual-builder">
          <div class="manual-builder-title">
            <div><span>Selected market</span><b>{shortMarketName(selected?.display ?? marketSymbol)}</b></div>
            <button type="button" onClick={useStrongest} disabled={!strongest}>Use strongest setup</button>
          </div>
          <div class="manual-direction" role="group" aria-label="Contract direction">
            <button type="button" class={direction === 'over' ? 'active over' : ''} onClick={() => chooseDirection('over')}>Over</button>
            <button type="button" class={direction === 'under' ? 'active under' : ''} onClick={() => chooseDirection('under')}>Under</button>
          </div>
          <label class="manual-barrier">
            <span>Barrier <small>{direction === 'over' ? '0–8' : '1–9'}</small></span>
            <input type="number" inputMode="numeric" min={direction === 'over' ? 0 : 1} max={direction === 'over' ? 8 : 9} step={1} value={barrier} onInput={(event) => setBarrier(Number((event.currentTarget as HTMLInputElement).value))} />
          </label>
          <div class="manual-readout">
            <div><span>Model confidence</span><b>{exactRecommendation ? `${(exactRecommendation.estWin * 100).toFixed(1)}%` : 'Custom setup'}</b></div>
            <div><span>Break-even</span><b>{breakeven != null ? `${(breakeven * 100).toFixed(1)}%` : 'Awaiting quote'}</b></div>
            <div><span>Estimated edge</span><b class={exactRecommendation && exactRecommendation.edge >= 0 ? 'positive' : ''}>{exactRecommendation ? `${exactRecommendation.edge >= 0 ? '+' : ''}${(exactRecommendation.edge * 100).toFixed(1)}%` : '—'}</b></div>
            <div><span>Stake</span><b>{fmtMoney(stake)}</b></div>
          </div>
          {!exactRecommendation && <p class="manual-custom-note">This custom barrier has no current model score. Deriv will provide the live quote before purchase.</p>}
          {error && <div class="manual-builder-error" role="alert">{error}</div>}
          <button type="button" class="manual-place" disabled={guest || busy || !marketSymbol} onClick={() => void place()}>
            {guest ? 'Connect Deriv to place bet' : busy ? 'Placing…' : `Place ${sideLabel(direction, barrier)} on ${shortMarketName(selected?.display ?? marketSymbol)}`}
          </button>
        </div>
      </section>
    </div>
  );
}

function DecisionHero({
  markets,
  selectedMarket,
  candidates,
  quotes,
  decision,
  automation,
  phase,
  observation,
  holdReason,
  stopReason,
  contract,
  trades,
  feedConnected,
  recovery,
  onChooseMarket,
  marketChooserOpen,
  onCloseMarketChooser,
  manualDirection,
  manualOverBarrier,
  manualUnderBarrier,
  manualStake,
  onManualDirection,
  onManualBarrier,
  onManualMarket,
  onManualStake,
  onManualBasket,
}: {
  markets: Market[];
  selectedMarket: Market | null;
  candidates: SignalCandidate[];
  quotes: Record<string, QuoteEvt>;
  decision?: Decision;
  automation: boolean;
  phase?: string;
  observation?: AutomationState['observation'];
  holdReason: string | null;
  stopReason: string | null;
  contract: ContractEvt | null;
  trades: TradeRow[];
  feedConnected: boolean;
  recovery: Recovery | null;
  onChooseMarket: () => void;
  marketChooserOpen: boolean;
  onCloseMarketChooser: () => void;
  manualDirection: 'over' | 'under';
  manualOverBarrier: number;
  manualUnderBarrier: number;
  manualStake: string;
  onManualDirection: (direction: 'over' | 'under') => void;
  onManualBarrier: (direction: 'over' | 'under', barrier: number) => void;
  onManualMarket: (symbol: string) => void;
  onManualStake: (stake: string) => void;
  onManualBasket: (setups: ManualSetup[]) => Promise<boolean>;
}): JSX.Element {
  // Manual mode stays pinned to the operator's chosen market. Automation may
  // scan broadly until it emits a decision, after which the decision itself
  // locks this display to the market that will actually be purchased.
  const scannerBest = resolveTarget(candidates, quotes, decision, !automation ? selectedMarket?.symbol : null);
  const manualBarrier = manualDirection === 'over' ? manualOverBarrier : manualUnderBarrier;
  const manualConfidence = selectedMarket ? confidenceForSetup(selectedMarket, manualDirection, manualBarrier) : 0;
  const best = scannerBest ?? (!automation && selectedMarket ? {
    market: selectedMarket.symbol,
    direction: manualDirection,
    barrier: manualBarrier,
    estWin: manualConfidence,
    edge: 0,
    breakeven: manualDirection === 'over' ? (9 - manualBarrier) / 10 : manualBarrier / 10,
    consistency: 0.5,
    learnedWin: null,
  } : null);

  const status = !automation
    ? stopReason
      ? { label: 'BOT STOPPED', tone: 'warn' }
      : { label: 'BOT IDLE', tone: 'idle' }
    : decision
      ? { label: 'TRADE ACTIVE', tone: 'go' }
      : holdReason
        ? { label: holdReason.toUpperCase().slice(0, 32), tone: 'warn' }
        : { label: (phase ? scannerPhaseLabel(phase) : 'SCANNING'), tone: 'scan' };

  const bestLabel = best
    ? shortMarketName(markets.find((m) => m.symbol === best.market)?.display ?? best.market)
    : markets[0]
      ? shortMarketName(markets[0].display)
      : '—';

  const lastResult = contract?.result ?? trades[0]?.status;
  const winFlash = lastResult === 'won';
  const note = (() => {
    if (!feedConnected) {
      return `Feed down — checking ${markets.length} cached markets, will resume betting when it reconnects`;
    }
    if (!automation) {
      if (stopReason) return `Stopped - ${stopReason}.`;
      return `Idle — press START and I'll hunt ${markets.length} markets for an easy win`;
    }
    if (decision && best) {
      return `Betting ${fmtMoney(decision.stake)} on ${bestLabel} ${sideLabel(best.direction, best.barrier)}${decision.reason ? ` — ${decision.reason}` : ''}`;
    }
    if (recovery?.mode === 'recovering') {
      return `Trying to win back the loss — recovery attempt ${recovery.attempts} · debt ${fmtMoney(recovery.debt)} · staking ${fmtMoney(recovery.cycleStake)}`;
    }
    if (holdReason) {
      if (best && Math.round(best.estWin * 100) >= 70) {
        const edgePct = Math.round(best.edge * 1000) / 10;
        return `Holding — ${bestLabel} ${sideLabel(best.direction, best.barrier)} wins ~${Math.round(best.estWin * 100)}% of the time but only banks ${edgePct >= 0 ? '+' : ''}${edgePct}% after the payout. Not worth risking cash yet — waiting for a real edge.`;
      }
      return `Holding — no bet is worth the risk right now (${holdReason}). Keep scanning for a genuinely profitable shot.`;
    }
    if (best) {
      return `Watching ${bestLabel} — leaning ${best.direction} ${best.barrier} because it's looking like a ${Math.round(best.estWin * 100)}% easy win`;
    }
    return `Scanning ${markets.length} markets for an easy win — ${candidates.length} candidates in play`;
  })();

  return (
    <div class="cockpit">
      <div class="cockpit-primary">
      <div class="cockpit-market">{bestLabel}</div>

      <div class="cockpit-pick">
        <div class="cockpit-side">{best ? sideLabel(best.direction, best.barrier) : 'AWAITING SIGNAL'}</div>
        {best && <div class="cockpit-pct">{Math.round(best.estWin * 100)}%</div>}
      </div>

      <div class={`cockpit-status ${status.tone}${winFlash ? ' win' : ''}`}>
        <span class="cockpit-status-dot"></span>
        <span>{winFlash ? 'WIN RECORDED' : status.label}</span>
      </div>

      <div class="cockpit-note">{note}</div>

      <ObservationRail automation={automation} phase={phase} observation={observation} reason={holdReason} />

      <div class="cockpit-metrics">
        <div class="ckm">
          <span class="ckm-label">Model</span>
          <b>{best ? `${(best.estWin * 100).toFixed(1)}%` : '—'}</b>
        </div>
        <div class="ckm">
          <span class="ckm-label">Break-even</span>
          <b>{best ? `${Math.round(best.breakeven * 100)}%` : '—'}</b>
        </div>
        <div class="ckm">
          <span class="ckm-label">Pattern</span>
          <b>{best?.learnedWin != null ? `${Math.round(best.learnedWin * 100)}%` : '--'}</b>
        </div>
        <div class={`ckm ckm-edge${best && best.edge < 0 ? ' neg' : ''}`}>
          <span class="ckm-label">EDGE</span>
          <b>{best ? `${best.edge >= 0 ? '+' : ''}${(best.edge * 100).toFixed(1)}%` : '—'}</b>
        </div>
      </div>
      </div>
      {marketChooserOpen ? (
        <InlineMarketChooser
          markets={markets}
          candidates={candidates}
          selectedMarket={selectedMarket}
          direction={manualDirection}
          barrier={manualDirection === 'over' ? manualOverBarrier : manualUnderBarrier}
          stake={manualStake}
          onDirection={onManualDirection}
          onBarrier={onManualBarrier}
          onMarket={onManualMarket}
          onStake={onManualStake}
          onBasket={onManualBasket}
          onClose={onCloseMarketChooser}
        />
      ) : <MarketPulse market={selectedMarket} onChoose={onChooseMarket} />}
    </div>
  );
}

/* ---------------- barrier picker ---------------- */

function BarrierPicker({ settings, showLabel = true }: { settings: Settings | null; showLabel?: boolean }): JSX.Element {
  const isConservative = (settings?.strategy_mode ?? 'conservative') === 'conservative';
  const raw = settings?.barrier_preference;
  const mode: 'auto' | 'over' | 'under' =
    raw === 'over' || raw?.startsWith('over') ? 'over' : raw === 'under' || raw?.startsWith('under') ? 'under' : 'auto';
  const [draft, setDraft] = useState(String(settings?.barrier_number ?? (mode === 'under' ? 9 : 0)));

  const commit = (m: 'auto' | 'over' | 'under', n: number) => {
    let barrier = n;
    if (m === 'over') barrier = Math.round(Math.max(0, Math.min(8, n)));
    else if (m === 'under') barrier = Math.round(Math.max(1, Math.min(9, n)));
    else barrier = 0;
    if (isConservative && m !== 'auto') barrier = m === 'under' ? 9 : 0;
    void updateSettings({ barrier_preference: m, barrier_number: barrier });
    setDraft(String(barrier));
  };

  const canEditNumber = !isConservative && mode !== 'auto';
  const guard = (e: KeyboardEvent) => {
    if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
  };
  const clampDraft = () => {
    const parsed = Math.round(Number(draft));
    const max = mode === 'over' ? 8 : 9;
    const min = mode === 'over' ? 0 : 1;
    commit(mode, Number.isFinite(parsed) ? parsed : min);
  };

  return (
    <div class="barrier-pick">
      {showLabel && <span class="barrier-pick-label">BET ON</span>}
      <div class="barrier-seg">
        <button class={`bseg${mode === 'auto' ? ' active' : ''}`} onClick={() => commit('auto', 0)}>
          Auto
        </button>
        <button class={`bseg over${mode === 'over' ? ' active' : ''}`} onClick={() => commit('over', isConservative ? 0 : settings?.barrier_number ?? 0)}>
          Over
        </button>
        <button class={`bseg under${mode === 'under' ? ' active' : ''}`} onClick={() => commit('under', isConservative ? 9 : settings?.barrier_number ?? 9)}>
          Under
        </button>
      </div>
      {mode !== 'auto' && (
        <div class="barrier-num">
          {canEditNumber ? (
            <>
              <button class="bstep" onClick={() => commit(mode, (settings?.barrier_number ?? 0) - 1)}>−</button>
              <input
                class="bnum"
                type="number"
                value={isConservative ? (mode === 'under' ? 9 : 0) : draft}
                disabled={isConservative}
                onInput={(e) => setDraft((e.target as HTMLInputElement).value)}
                onBlur={clampDraft}
                onKeyDown={guard}
              />
              <button class="bstep" onClick={() => commit(mode, (settings?.barrier_number ?? 0) + 1)}>+</button>
            </>
          ) : (
            <span class="bnum-locked">{mode === 'under' ? '9' : '0'}</span>
          )}
          {isConservative && <span class="barrier-safe">SAFE LOCK — OVER 0 / UNDER 9 ONLY</span>}
        </div>
      )}
    </div>
  );
}

function PatternSplit({
  settings,
  onSet,
}: {
  settings: Settings | null;
  onSet: (strategy: string, weight: number | null) => void;
}): JSX.Element {
  const strategies: { key: string; label: string }[] = [
    { key: 'conservative', label: 'Safe' },
    { key: 'martingale', label: 'Martingale' },
    { key: 'boosted_martingale', label: 'Boosted' },
    { key: 'chase', label: 'Chase' },
  ];
  const options: { value: number | null; label: string }[] = [
    { value: null, label: 'Global' },
    { value: 0, label: 'Off' },
    { value: 0.5, label: 'Half' },
    { value: 1, label: 'On' },
  ];
  const current = (key: string): number | null => (settings as unknown as Record<string, number | null>)[`pattern_weight_${key}`] ?? null;
  return (
    <div class="pattern-split">
      {strategies.map((st) => (
        <div class="pattern-split-row" key={st.key}>
          <span class="pattern-split-label">{st.label}</span>
          <div class="seg seg-sm">
            {options.map((o) => (
              <button
                key={o.label}
                class={`seg-btn${(current(st.key) ?? null) === o.value ? ' active' : ''}`}
                onClick={() => onSet(st.key, o.value)}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/* ---------------- bot settings ---------------- */

type BotLimitField =
  | 'max_stake'
  | 'max_drawdown_pct'
  | 'max_consecutive_losses'
  | 'max_recovery_debt'
  | 'max_recovery_exposure'
  | 'min_edge'
  | 'min_recovery_win';

function BotLimitInput({
  label,
  field,
  value,
  min,
  step,
  suffix,
  scale = 1,
}: {
  label: string;
  field: BotLimitField;
  value: number;
  min: number;
  step: number;
  suffix?: string;
  scale?: number;
}): JSX.Element {
  const [text, setText] = useState(String(value * scale));
  useEffect(() => setText(String(value * scale)), [value, scale]);

  const commit = () => {
    const next = Number(text);
    if (!Number.isFinite(next) || next < min) {
      setText(String(value));
      return;
    }
    void updateSettings({ [field]: next / scale } as Partial<Settings>);
  };

  return (
    <div class="set-row">
      <span class="set-label">{label}</span>
      <label class="bot-limit-value">
        <input
          class="set-input inline"
          type="number"
          min={min}
          step={step}
          value={text}
          onInput={(e) => setText((e.target as HTMLInputElement).value)}
          onBlur={commit}
        />
        {suffix && <span>{suffix}</span>}
      </label>
    </div>
  );
}

function BotPage(): JSX.Element {
  const s = useStore();
  const [stakeText, setStakeText] = useState(String(s.settings?.base_stake ?? 1));
  const [maxTradesText, setMaxTradesText] = useState('0');
  const [strategy, setStrategy] = useState<Settings['strategy_mode']>(s.settings?.strategy_mode ?? 'conservative');
  const [mode, setMode] = useState<Settings['bot_mode']>(s.settings?.bot_mode ?? 'balanced');
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [error, setError] = useState('');
  const [settlementBusy, setSettlementBusy] = useState(false);
  const cooldownLeft = useBotCooldown();
  const automation = s.automation?.running ?? false;
  const openAccountTrade = useMemo(() => s.trades.find((trade) => isOpenAccountTrade(trade) && isDigitTrade(trade)) ?? null, [s.trades]);
  const accountLockMessage = openTradeLockMessage(openAccountTrade);
  const startLocked = Boolean(openAccountTrade);

  if (!s.session) {
    return (
      <>
        <header class="header"><div class="page-title">Bot Settings</div><div class="subtitle">Read-only while exploring the public dashboard</div></header>
        <div class="section">
          <Detail label="Strategy" value={s.settings?.strategy_mode ?? 'conservative'} />
          <Detail label="Mode" value={s.settings?.bot_mode ?? 'balanced'} />
          <Detail label="Base stake" value={fmtMoney(s.settings?.base_stake ?? 0, '$')} />
          <Detail label="Minimum edge" value={`${((s.settings?.min_edge ?? 0) * 100).toFixed(1)}%`} />
        </div>
        <div class="empty-hint">Connect a Deriv account from Account to change settings or place trades.</div>
      </>
    );
  }

  const persistStake = (v: string) => {
    setStakeText(v);
    const n = Number(v);
    if (n > 0) void updateSettings({ base_stake: Math.max(0.1, n) });
  };

  const pickStrategy = (m: Settings['strategy_mode']) => {
    setStrategy(m);
    void updateSettings({ strategy_mode: m });
  };

  const pickMode = (m: Settings['bot_mode']) => {
    setMode(m);
    void updateSettings({ bot_mode: m });
  };

  const restoreRecommended = () => {
    setMode('balanced');
    setStrategy('conservative');
    setStakeText('1');
    setMaxTradesText('0');
    void updateSettings({
      bot_mode: 'balanced', strategy_mode: 'conservative', base_stake: 1,
      max_stake: 5, min_edge: 0.02, min_recovery_win: 0.6,
      max_consecutive_losses: 3, max_drawdown_pct: 10,
      max_recovery_debt: 10, max_recovery_exposure: 15,
      barrier_preference: 'auto', barrier_number: 0, pattern_weight: 0,
    });
  };

  const toggleBot = async () => {
    setError('');
    try {
      if (automation) {
        await stopAutomation();
        return;
      }
      if (cooldownLeft > 0) return;
      if (openAccountTrade) {
        setError(accountLockMessage);
        await syncCoreState();
        await refreshTrades();
        return;
      }
      const stake = Math.max(0.1, Number(stakeText) || 0);
      const maxTrades = Math.max(0, Math.floor(Number(maxTradesText) || 0));
      await startAutomation({
        strategyMode: strategy,
        baseStake: stake,
        maxTrades: maxTrades > 0 ? maxTrades : undefined,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const recoverOpenTrade = async () => {
    if (!openAccountTrade || settlementBusy) return;
    setSettlementBusy(true);
    setError('');
    try {
      if (!openAccountTrade.contract_id) await clearStuckTrade();
      await syncCoreState();
      await refreshTrades();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSettlementBusy(false);
    }
  };

  return (
    <>
      <header class="header">
        <div class="page-title">Bot Settings</div>
        <div class="subtitle">{automation ? 'Bot is running' : 'Bot is stopped'}</div>
      </header>

      <ObservationRail
        automation={automation}
        phase={s.automation?.phase}
        observation={s.automation?.observation}
        reason={s.hold?.reason}
        compact
      />

      <div class={`section bot-settings-section${advancedOpen ? ' advanced-open' : ''}`}>
        <div class="set-group bot-account">
          <div class="set-row">
            <span class="set-label">Account</span>
            <span class={`set-value${s.session?.mode === 'demo' ? '' : ' real'}`}>
              {s.session?.mode === 'demo' ? 'Demo' : 'Real'}
            </span>
          </div>
          <div class="set-row">
            <span class="set-label">Balance</span>
            <span class="set-value">{fmtMoney(s.session?.balance ?? 0, s.session?.currency)}</span>
          </div>
        </div>

        <div class="set-group bot-stake">
          <div class="set-label-top">Stake</div>
          <input
            class="set-input"
            type="number"
            min="0.1"
            step="0.1"
            value={stakeText}
            onInput={(e) => persistStake((e.target as HTMLInputElement).value)}
          />
        </div>

        <div class="set-group bot-mode">
          <div class="set-label-top">Trading style</div>
          <div class="seg">
            {(Object.keys(MODE_META) as Settings['bot_mode'][]).map((key) => (
              <button
                key={key}
                class={`seg-btn${mode === key ? ' active' : ''}`}
                onClick={() => pickMode(key)}
              >
                {key === 'strict' ? 'Safe' : MODE_META[key].label}
              </button>
            ))}
          </div>
          <div class="set-hint">{MODE_META[mode].hint}</div>
        </div>

        <div class="bot-advanced-toggle-wrap">
          <button class="bot-advanced-toggle" type="button" onClick={() => setAdvancedOpen((open) => !open)} aria-expanded={advancedOpen}>
            <span><b>Advanced settings</b><small>Strategy, barriers, patterns, and limits</small></span>
            <Icon name="chevronRight" size={15} strokeWidth={2} />
          </button>
        </div>

        <div class="set-group bot-tuning">
          <div class="set-label-top">Recovery strategy</div>
          <div class="seg">
            {(Object.keys(STRATEGY_META) as Settings['strategy_mode'][]).map((key) => (
              <button
                key={key}
                class={`seg-btn${strategy === key ? ' active' : ''}`}
                onClick={() => pickStrategy(key)}
              >
                {STRATEGY_META[key].label}
              </button>
            ))}
          </div>
          <div class="set-hint">{STRATEGY_META[strategy].hint}</div>
        </div>

        <div class="set-group bot-tuning">
          <div class="set-label-top">Automated barrier</div>
          <BarrierPicker settings={s.settings} showLabel={false} />
          <div class="set-hint">
            Auto scans every barrier. Conservative is locked to Over 0 / Under 9.
          </div>
        </div>

        <div class="set-group bot-tuning">
          <div class="set-label-top">Learned patterns</div>
          <div class="seg">
            {[0, 1].map((w) => (
              <button
                key={w}
                class={`seg-btn${(s.settings?.pattern_weight ?? 0) > 0 ? (w === 1 ? ' active' : '') : w === 0 ? ' active' : ''}`}
                onClick={() => void updateSettings({ pattern_weight: w })}
              >
                {w === 1 ? 'On' : 'Off'}
              </button>
            ))}
          </div>
          <div class="set-hint">
            Blends confirmed next-digit patterns (pattern_stats) into signal edge. Global default for every strategy.
          </div>
          <PatternSplit settings={s.settings} onSet={(strategy, w) => void updateSettings({ [`pattern_weight_${strategy}`]: w })} />
          <div class="set-hint">Per-strategy override — Global uses the default above. A/B: compare extreme spread and moderate aggressives with patterns off.</div>
        </div>

        <div class="set-group bot-trades">
          <div class="set-row">
            <span class="set-label">Max trades</span>
            <input
              class="set-input inline"
              type="number"
              min="0"
              step="1"
              value={maxTradesText}
              onInput={(e) => setMaxTradesText((e.target as HTMLInputElement).value)}
            />
          </div>
          <div class="set-hint">0 = unlimited run</div>
        </div>

        {s.settings && (
          <div class="bot-protection">
            <div><span>Protection</span><strong>Configured</strong></div>
            <p>Stops at {s.settings.max_drawdown_pct}% drawdown or {s.settings.max_consecutive_losses} consecutive losses. Recovery is limited by its debt and exposure controls.</p>
          </div>
        )}

        {s.settings && (
          <div class="set-group bot-tuning">
            <div class="set-label-top">Risk and execution limits</div>
            <div class="risk-grid">
              <BotLimitInput label="Maximum stake" field="max_stake" value={s.settings.max_stake} min={0} step={0.1} suffix="$" />
              <BotLimitInput label="Maximum drawdown" field="max_drawdown_pct" value={s.settings.max_drawdown_pct} min={0} step={0.5} suffix="%" />
              <BotLimitInput label="Losses before stop" field="max_consecutive_losses" value={s.settings.max_consecutive_losses} min={1} step={1} />
              <BotLimitInput label="Recovery debt limit" field="max_recovery_debt" value={s.settings.max_recovery_debt} min={0} step={1} suffix="$" />
              <BotLimitInput label="Recovery exposure limit" field="max_recovery_exposure" value={s.settings.max_recovery_exposure} min={0} step={1} suffix="$" />
              <BotLimitInput label="Minimum payout edge" field="min_edge" value={s.settings.min_edge} min={0} step={0.1} suffix="%" scale={100} />
              <BotLimitInput label="Recovery win probability" field="min_recovery_win" value={s.settings.min_recovery_win} min={0} step={1} suffix="%" scale={100} />
            </div>
            <button class="bot-restore" type="button" onClick={restoreRecommended}>Restore recommended settings</button>
          </div>
        )}

        {(error || accountLockMessage) && (
          <div class="bot-feedback bot-settings-feedback" aria-live="polite">
            <div class="bot-error">{error || accountLockMessage}</div>
            {openAccountTrade && (
              <button class="bot-inline-action" type="button" disabled={settlementBusy} onClick={() => void recoverOpenTrade()}>
                {settlementBusy ? 'Checking...' : openAccountTrade.contract_id ? 'Refresh settlement' : 'Clear stuck local order'}
              </button>
            )}
          </div>
        )}

        <button class="bot-control" disabled={!automation && (cooldownLeft > 0 || startLocked)} onClick={() => void toggleBot()}>
          <Icon name={automation ? 'square' : 'play'} size={14} strokeWidth={2.2} />
          <span>{automation ? 'Stop Bot' : startLocked ? 'Settlement recovery active' : cooldownLeft > 0 ? `Start in ${cooldownLeft}s` : 'Start Bot'}</span>
        </button>
      </div>
    </>
  );
}

/* ---------------- history ---------------- */

type Filter = 'all' | 'wins' | 'losses' | 'over' | 'under' | 'multipliers';

function HistoryPage(): JSX.Element {
  const s = useStore();
  const [filter, setFilter] = useState<Filter>('all');

  useEffect(() => {
    if (s.owner) void loadLedgerEntries(300);
  }, [s.owner, s.trades.length]);

  if (!s.owner) {
    return <><header class="header"><div class="page-title">History</div></header><div class="empty-hint">Unlock the dashboard to view the private trade ledger.</div></>;
  }

  if (!s.session) {
    return (
      <>
        <header class="header"><div class="page-title">History</div></header>
        <LedgerSection entries={s.ledgerEntries} />
        <div class="empty-hint">Connect a Deriv account to view account trade history.</div>
      </>
    );
  }

  const trades = s.trades;
  const digitTrades = trades.filter(isDigitTrade);
  const multiplierTrades = trades.filter(isMultiplierTrade);
  const wins = digitTrades.filter((t) => t.status === 'won').length;
  const losses = digitTrades.filter((t) => t.status === 'lost').length;
  const total = digitTrades.length;
  const winRate = wins + losses > 0 ? (wins / (wins + losses)) * 100 : 0;
  const netProfit = digitTrades.reduce((acc, t) => acc + (t.profit ?? 0), 0);
  const totalStaked = digitTrades.reduce((acc, t) => acc + (t.stake ?? 0), 0);
  const paid = digitTrades.filter((t) => t.payout != null);
  const avgPayout = paid.length ? paid.reduce((acc, t) => acc + (t.payout ?? 0), 0) / paid.length : 0;
  const currency = s.session?.currency ?? '';

  const ordered = [...digitTrades].reverse();
  let best = 0;
  let worst = 0;
  let winRun = 0;
  let lossRun = 0;
  for (const t of ordered) {
    if (t.status === 'won') {
      winRun += 1;
      lossRun = 0;
      best = Math.max(best, winRun);
    } else if (t.status === 'lost') {
      lossRun += 1;
      winRun = 0;
      worst = Math.max(worst, lossRun);
    } else {
      winRun = 0;
      lossRun = 0;
    }
  }

  const over = digitTrades.filter((t) => t.contract_type === 'DIGITOVER');
  const under = digitTrades.filter((t) => t.contract_type === 'DIGITUNDER');
  const overWins = over.filter((t) => t.status === 'won').length;
  const underWins = under.filter((t) => t.status === 'won').length;
  const overRate = over.length ? (overWins / over.length) * 100 : 0;
  const underRate = under.length ? (underWins / under.length) * 100 : 0;
  const multiplierUp = multiplierTrades.filter((t) => t.contract_type === 'MULTUP');
  const multiplierDown = multiplierTrades.filter((t) => t.contract_type === 'MULTDOWN');
  const multiplierUpWins = multiplierUp.filter((t) => t.status === 'won').length;
  const multiplierDownWins = multiplierDown.filter((t) => t.status === 'won').length;
  const multiplierNet = multiplierTrades.reduce((acc, t) => acc + (t.profit ?? 0), 0);
  const multiplierWins = multiplierTrades.filter((t) => t.status === 'won').length;
  const multiplierUpRate = multiplierUp.length ? (multiplierUpWins / multiplierUp.length) * 100 : 0;
  const multiplierDownRate = multiplierDown.length ? (multiplierDownWins / multiplierDown.length) * 100 : 0;

  const byMarket = new Map<string, { count: number; wins: number; net: number }>();
  for (const t of digitTrades) {
    const e = byMarket.get(t.market) ?? { count: 0, wins: 0, net: 0 };
    e.count += 1;
    if (t.status === 'won') e.wins += 1;
    e.net += t.profit ?? 0;
    byMarket.set(t.market, e);
  }

  const filtered = (filter === 'multipliers' ? multiplierTrades : digitTrades).filter((t) => {
    if (filter === 'wins') return t.status === 'won';
    if (filter === 'losses') return t.status === 'lost';
    if (filter === 'over') return t.contract_type === 'DIGITOVER';
    if (filter === 'under') return t.contract_type === 'DIGITUNDER';
    if (filter === 'multipliers') return true;
    return true;
  });

  const chips: { key: Filter; label: string }[] = [
    { key: 'all', label: 'All digits' },
    { key: 'wins', label: 'Wins' },
    { key: 'losses', label: 'Losses' },
    { key: 'over', label: 'Over 0' },
    { key: 'under', label: 'Under 9' },
    { key: 'multipliers', label: 'Multipliers' },
  ];

  return (
    <>
      <header class="header">
        <div class="page-title">History</div>
      </header>

      <div class="metric-grid">
        <Metric label="Win Rate" value={`${winRate.toFixed(1)}%`} tone={winRate >= 50 ? 'up' : 'down'} />
        <Metric label="Digit Trades" value={String(total)} />
        <Metric label="Net Profit" value={fmtSigned(netProfit, currency)} tone={netProfit >= 0 ? 'up' : 'down'} />
        <Metric label="Total Staked" value={fmtMoney(totalStaked, currency)} />
        <Metric label="Avg Payout" value={avgPayout ? avgPayout.toFixed(2) : '—'} />
        <Metric label="Best Streak" value={String(best)} tone="up" />
        <Metric label="Worst Streak" value={String(worst)} tone="down" />
        <Metric
          label="Recovery"
          value={
            s.recovery?.mode === 'recovering'
              ? `Active · debt ${fmtMoney(s.recovery.debt ?? 0, currency)}`
              : 'Idle'
          }
        />
      </div>

      <div class="section">
        <div class="section-title">Digit Over / Under</div>
        <Bar label="Over 0" rate={overRate} count={over.length} tone="over" />
        <Bar label="Under 9" rate={underRate} count={under.length} tone="under" />
      </div>

      <div class="section">
        <div class="section-title">Multiplier trades</div>
        {multiplierTrades.length === 0 && <div class="empty-hint">No Momentum or Gold multiplier trades yet</div>}
        {multiplierTrades.length > 0 && <>
          <Bar label="Up / Buy" rate={multiplierUpRate} count={multiplierUp.length} tone="over" />
          <Bar label="Down / Sell" rate={multiplierDownRate} count={multiplierDown.length} tone="under" />
          <div class="market-stat">
            <span class="market-stat-name">Multiplier P&amp;L</span>
            <span class="market-stat-nums">
              {multiplierWins}/{multiplierTrades.length} • <b class={multiplierNet >= 0 ? 'green' : 'red'}>{fmtSigned(multiplierNet, currency)}</b>
            </span>
          </div>
        </>}
      </div>

      <div class="section">
        <div class="section-title">Markets</div>
        {byMarket.size === 0 && <div class="empty-hint">No Over/Under trades yet</div>}
        {[...byMarket.entries()].map(([market, e]) => (
          <div class="market-stat" key={market}>
            <span class="market-stat-name">{shortMarketName(market)}</span>
            <span class="market-stat-nums">
              {e.wins}/{e.count} • <b class={e.net >= 0 ? 'green' : 'red'}>{fmtSigned(e.net, currency)}</b>
            </span>
          </div>
        ))}
      </div>

      <div class="filters">
        {chips.map((c) => (
          <button
            key={c.key}
            class={`chip${filter === c.key ? ' active' : ''}`}
            onClick={() => setFilter(c.key)}
          >
            {c.label}
          </button>
        ))}
      </div>

      <div class="section activity">
        {filtered.length === 0 && <div class="empty-hint">{filter === 'multipliers' ? 'No multiplier trades yet' : 'No Over/Under trades yet'}</div>}
        {filtered.map((t) => (
          <ActivityRow key={t.id} trade={t} market={s.markets.find((market) => market.symbol === t.market)} />
        ))}
      </div>

      <LedgerSection entries={s.ledgerEntries} currency={currency} />
    </>
  );
}

const LEDGER_EVENT_LABEL: Record<LedgerEntry['event'], string> = {
  requested: 'Requested',
  purchased: 'Purchased',
  settled: 'Settled',
  cancelled: 'Cancelled',
};

function ledgerBookLabel(entry: LedgerEntry): string {
  if (entry.book === 'paper') return 'Virtual research';
  if (entry.account_mode === 'real') return 'Real account';
  if (entry.account_mode === 'demo') return 'Demo account';
  return 'Account';
}

function LedgerSection({ entries, currency = '' }: { entries: LedgerEntry[]; currency?: string }): JSX.Element {
  return (
    <section class="section ledger">
      <div class="section-head">
        <div class="section-title">Trade Ledger</div>
        <span class="ledger-count">{entries.length} events</span>
      </div>
      <div class="ledger-caption">Immutable lifecycle records. Virtual research is not account money.</div>
      <div class="ledger-list">
        {entries.length === 0 && <div class="empty-hint">No ledger entries yet</div>}
        {entries.map((entry) => <LedgerRow key={entry.id} entry={entry} currency={currency} />)}
      </div>
    </section>
  );
}

function LedgerRow({ entry, currency }: { entry: LedgerEntry; currency: string }): JSX.Element {
  const settled = entry.event === 'settled';
  const profit = entry.profit ?? 0;
  const tone = settled ? (profit > 0 ? 'win' : profit < 0 ? 'loss' : 'push') : entry.event === 'cancelled' ? 'loss' : 'push';
  const letter = entry.book === 'paper' ? 'P' : entry.account_mode === 'real' ? 'R' : 'D';
  const contract = entry.contract_type === 'DIGITUNDER' ? `Under ${entry.barrier}` : `Over ${entry.barrier}`;
  const date = new Date(entry.ts < 100_000_000_000 ? entry.ts * 1000 : entry.ts);
  const time = Number.isNaN(date.getTime()) ? '' : date.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  const outcome = entry.event === 'settled'
    ? entry.status === 'won' ? 'Won' : entry.status === 'lost' ? 'Lost' : 'Settled'
    : LEDGER_EVENT_LABEL[entry.event];
  const profitText = entry.book === 'paper'
    ? `V${fmtSigned(profit, '$')}`
    : fmtSigned(profit, currency);

  return (
    <div class={`ledger-row ${tone}`}>
      <div class={`ledger-mark ${entry.book === 'paper' ? 'paper' : entry.account_mode}`}>{letter}</div>
      <div class="ledger-main">
        <div class="ledger-line">
          <span class="ledger-contract">{contract}</span>
          <span class={`ledger-book ${entry.book === 'paper' ? 'paper' : entry.account_mode}`}>{ledgerBookLabel(entry)}</span>
          <span class={`activity-source ${entry.source}`}>{sourceLabel(entry.source)}</span>
        </div>
        <div class={`ledger-meta ${tone}`}>
          <span>{outcome}</span>
          <span>{LEDGER_EVENT_LABEL[entry.event].toLowerCase()}</span>
          <span>{fmtMoney(entry.stake, entry.book === 'paper' ? '$' : currency)} stake</span>
          {time && <span>{time}</span>}
        </div>
      </div>
      <div class="ledger-pnl">
        {settled ? <span class={profit > 0 ? 'pnl-win' : profit < 0 ? 'pnl-loss' : 'pnl-zero'}>{profitText}</span> : <span class="pnl-zero">-</span>}
      </div>
    </div>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: 'up' | 'down' }): JSX.Element {
  return (
    <div class="metric">
      <div class={`metric-value${tone === 'up' ? ' up' : tone === 'down' ? ' down' : ''}`}>{value}</div>
      <div class="metric-label">{label}</div>
    </div>
  );
}

function Bar({ label, rate, count, tone }: { label: string; rate: number; count: number; tone: 'over' | 'under' }): JSX.Element {
  return (
    <div class="bar-row">
      <div class="bar-head">
        <span class={`bar-label ${tone}`}>{label}</span>
        <span class="bar-nums">
          {rate.toFixed(1)}% • {count} trades
        </span>
      </div>
      <div class="bar-track">
        <div class={`bar-fill ${tone}`} style={{ width: `${Math.min(100, rate)}%` }}></div>
      </div>
    </div>
  );
}

/* ---------------- real-market multiplier momentum ---------------- */

const MOMENTUM_LAUNCH_SEEN_KEY = 'zeronine:momentum-launch-seen:v1';

function hasSeenMomentumLaunch(): boolean {
  try {
    return window.localStorage.getItem(MOMENTUM_LAUNCH_SEEN_KEY) === '1';
  } catch {
    return false;
  }
}

function rememberMomentumLaunch(): void {
  try {
    window.localStorage.setItem(MOMENTUM_LAUNCH_SEEN_KEY, '1');
  } catch {
    // Storage may be unavailable in a private or restricted browser context.
  }
}

function momentumPct(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return `${value >= 0 ? '+' : ''}${(value * 100).toFixed(3)}%`;
}

function momentumPrice(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value) || value <= 0) return '--';
  const maximumFractionDigits = value >= 10_000 ? 2 : value >= 100 ? 3 : value >= 1 ? 5 : 8;
  return value.toLocaleString(undefined, { maximumFractionDigits });
}

function momentumProgress(value: number | null | undefined): number {
  if (!Number.isFinite(value)) return 0;
  const normalized = Number(value) <= 1 ? Number(value) * 100 : Number(value);
  return Math.max(0, Math.min(100, normalized));
}

function durationUnitMs(unit: string | undefined): number {
  if (unit === 's') return 1_000;
  if (unit === 'm') return 60_000;
  if (unit === 'h') return 3_600_000;
  if (unit === 'd') return 86_400_000;
  if (unit === 't') return 0;
  return 0;
}

function expectedTradeDurationMs(trade?: Pick<TradeRow, 'duration' | 'duration_unit'> | null): number {
  if (!trade || !(trade.duration > 0)) return 0;
  return trade.duration * durationUnitMs(trade.duration_unit);
}

function providerEpochMs(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n * 1000 : 0;
}

function mergeMomentumSamples(samples: MomentumScanSample[], next: MomentumScanSample | null, limit = 180): MomentumScanSample[] {
  const valid = samples.filter((sample) => Number.isFinite(sample.epoch) && Number.isFinite(sample.quote));
  if (next && Number.isFinite(next.epoch) && Number.isFinite(next.quote)) valid.push(next);
  const deduped = new Map<string, MomentumScanSample>();
  for (const sample of valid) deduped.set(`${Math.trunc(sample.epoch)}:${sample.quote}`, sample);
  return [...deduped.values()].sort((a, b) => a.epoch - b.epoch).slice(-limit);
}

function MomentumWatchboard({
  markets,
  selected,
  onFocus,
  focusing,
}: {
  markets: MomentumScanMarket[];
  selected: string | null | undefined;
  onFocus: (symbol: string) => void;
  focusing: string | null;
}): JSX.Element | null {
  if (markets.length === 0) return null;
  return <section class="mom-watchboard" aria-label="Live market watchboard">
    <div class="mom-watchboard-head"><div><span class="mom-kicker">Live watchboard</span><strong>{markets.length} markets collecting evidence</strong></div><span>Click a market to focus its full research view</span></div>
    <div class="mom-watchboard-list">
      {markets.map((item) => {
        const active = item.symbol === selected;
        const direction = item.signal?.direction ?? 'wait';
        const progress = momentumProgress(item.progress);
        return <button class={`mom-watch-row${active ? ' active' : ''}`} type="button" key={item.symbol} onClick={() => onFocus(item.symbol)} disabled={Boolean(focusing)}>
          <span class={`mom-watch-signal ${direction}`}>{direction === 'up' ? 'UP' : direction === 'down' ? 'DOWN' : 'WAIT'}</span>
          <span class="mom-watch-market"><b>{item.display}</b><small>{item.market.replace('_', ' ')} · {item.sampleCount} ticks</small></span>
          <span class="mom-watch-chart"><MomentumPriceChart compact samples={item.samples} label={`${item.display} recent quotes`} /></span>
          <span class="mom-watch-progress"><i><em style={{ width: `${progress}%` }}></em></i><small>{Math.round(progress)}%</small></span>
          <span class={`mom-watch-read ${direction}`}><b>{item.signal?.confidence != null ? `${item.signal.confidence}%` : '--'}</b><small>{focusing === item.symbol ? 'Focusing' : active ? 'Focused' : direction}</small></span>
        </button>;
      })}
    </div>
  </section>;
}

function MomentumResearchLedger({ rows, currency }: { rows?: MomentumResearchRow[]; currency: string }): JSX.Element | null {
  if (!rows?.length) return null;
  return <section class="mom-research-ledger" aria-label="Recent stored momentum research">
    <div class="mom-watchboard-head"><div><span class="mom-kicker">Stored research</span><strong>Recent settled windows</strong></div><span>Research only</span></div>
    <div class="mom-ledger-list">
      {rows.slice(0, 5).map((row, index) => {
        const net = Number(row.estimated_net ?? 0);
        const won = row.won === true || row.won === 1;
        return <div class="mom-ledger-row" key={row.id ?? `${row.symbol ?? row.market}-${index}`}>
          <span class={`mom-watch-signal ${row.direction ?? 'wait'}`}>{row.direction?.toUpperCase() ?? 'WAIT'}</span>
          <span><b>{row.display ?? row.symbol ?? row.market ?? 'Market window'}</b><small>{row.open_price != null && row.exit_price != null ? `${row.open_price.toLocaleString()} to ${row.exit_price.toLocaleString()}` : 'Stored observation'}</small></span>
          <span class={won ? 'up' : 'down'}>{won ? 'Directional win' : 'Directional loss'}</span>
          <strong class={net >= 0 ? 'up' : 'down'}>{fmtSigned(net, currency)}</strong>
        </div>;
      })}
    </div>
  </section>;
}

function MomentumTradeDesk({
  symbol,
  display,
  samples,
  entryPrice,
  configuredMultiplier,
  session,
  owner,
  suggestedDirection,
  suggestedConfidence,
  suggestedReason,
  trades,
  contract,
}: {
  symbol?: string;
  display?: string;
  samples?: MomentumScanSample[];
  entryPrice?: number;
  configuredMultiplier?: number | null;
  session: ReturnType<typeof useStore>['session'];
  owner?: boolean;
  suggestedDirection?: 'up' | 'down' | null;
  suggestedConfidence?: number | null;
  suggestedReason?: string | null;
  trades: TradeRow[];
  contract: ContractEvt | null;
}): JSX.Element {
  const [direction, setDirection] = useState<'up' | 'down'>(suggestedDirection ?? 'up');
  const [stakeText, setStakeText] = useState('1');
  const [multiplierText, setMultiplierText] = useState(String(configuredMultiplier ?? 20));
  const [multiplierProbe, setMultiplierProbe] = useState<MultiplierOptionsResult | null>(null);
  const [multiplierProbeStatus, setMultiplierProbeStatus] = useState<'idle' | 'checking' | 'error'>('idle');
  const [takeProfitText, setTakeProfitText] = useState('');
  const [stopLossText, setStopLossText] = useState('');
  const [purchase, setPurchase] = useState<MomentumTradePurchase | null>(null);
  const [closed, setClosed] = useState<MomentumTradeClose | null>(null);
  const [chartSnapshot, setChartSnapshot] = useState<{ symbol: string; display: string; samples: MomentumScanSample[]; entryPrice?: number; direction?: 'up' | 'down' | null } | null>(null);
  const [lastKnownPnl, setLastKnownPnl] = useState<number | null>(null);
  const [nowMs, setNowMs] = useState(Date.now());
  const [busy, setBusy] = useState(false);
  const [closing, setClosing] = useState(false);
  const [error, setError] = useState('');
  const manualMultiplierRef = useRef(false);
  const localPurchaseTimeRef = useRef<number | null>(null);
  const incomingSamples = useMemo(() => samples ?? [], [samples]);
  const stake = Number(stakeText);
  const selectedMultiplier = Number(multiplierText);
  const takeProfit = takeProfitText.trim() ? Number(takeProfitText) : undefined;
  const stopLoss = stopLossText.trim() ? Number(stopLossText) : undefined;
  const isDemo = session?.mode === 'demo';
  const hasValidLimits = (takeProfit === undefined || (Number.isFinite(takeProfit) && takeProfit > 0))
    && (stopLoss === undefined || (Number.isFinite(stopLoss) && stopLoss > 0));
  const canQuote = Boolean(symbol && owner && isDemo && Number.isFinite(stake) && stake > 0 && Number.isFinite(selectedMultiplier) && selectedMultiplier > 0 && hasValidLimits);
  const activeMultiplierProbe = multiplierProbe?.symbol === symbol ? multiplierProbe : null;
  const multiplierOptions = activeMultiplierProbe?.options.length
    ? activeMultiplierProbe.options
    : [10, 20, 30, 50, 100, 200, 500, 1000];
  const maxMultiplier = activeMultiplierProbe?.max ?? null;
  const multiplierWithinLiveMax = maxMultiplier == null || selectedMultiplier <= maxMultiplier;
  const openAccountTrade = trades.find((trade) => isOpenAccountTrade(trade) && isMultiplierTrade(trade)) ?? null;
  const openMomentumTrade = trades.find((item) =>
    (item.contract_type === 'MULTUP' || item.contract_type === 'MULTDOWN')
    && /momentum manual/i.test(item.reason ?? '')
    && (item.status === 'pending' || item.status === 'purchasing')
  ) ?? null;
  const openMultiplierTrade = openAccountTrade
    && (openAccountTrade.contract_type === 'MULTUP' || openAccountTrade.contract_type === 'MULTDOWN')
    && multiplierTradeFamily(openAccountTrade) === 'Momentum'
    ? openAccountTrade
    : null;
  const closableMomentumTrade = openMomentumTrade ?? openMultiplierTrade;
  const closedMomentumTrade = closed?.contractId
    ? trades.find((item) => item.contract_id === closed.contractId) ?? null
    : null;
  const canPlace = canQuote && multiplierWithinLiveMax && Boolean(suggestedDirection) && !openAccountTrade;
  const trade = purchase?.id == null
    ? closableMomentumTrade ?? closedMomentumTrade
    : trades.find((item) => item.id === purchase.id) ?? closableMomentumTrade ?? closedMomentumTrade;
  const trackedContractId = purchase?.contractId ?? purchase?.contract_id ?? closed?.contractId ?? trade?.contract_id ?? closableMomentumTrade?.contract_id ?? '';
  const matchingContract = trackedContractId && contract?.contractId === trackedContractId ? contract : null;
  const settledTrade = trade && ['won', 'lost', 'push'].includes(trade.status) ? trade : null;
  const liveContractProfit = Number.isFinite(Number(matchingContract?.profit)) ? Number(matchingContract?.profit) : undefined;
  const canClose = Boolean(closableMomentumTrade?.contract_id && !closing);
  const hasActiveTradeEntry = Boolean(closableMomentumTrade || (purchase && !closed && !settledTrade));
  const contractPnl = settledTrade?.profit ?? closed?.profit ?? liveContractProfit ?? (hasActiveTradeEntry ? undefined : purchase?.pnl ?? purchase?.profit);
  const displayContractPnl = contractPnl ?? (hasActiveTradeEntry ? lastKnownPnl : purchase?.pnl ?? purchase?.profit);
  const reasonMultiplier = Number((trade?.reason ?? '').match(/multiplier x(\d+)/i)?.[1] ?? NaN);
  const tradeMultiplier = purchase?.multiplier ?? (Number.isFinite(reasonMultiplier) ? reasonMultiplier : selectedMultiplier);
  const tradeStake = trade?.stake ?? purchase?.ask ?? stake;
  const tradePayout = trade?.payout ?? purchase?.payout ?? null;
  const tradePotential = tradePayout != null && Number.isFinite(tradePayout) ? tradePayout - tradeStake : null;
  const tradeExposure = Number.isFinite(tradeMultiplier) && Number.isFinite(tradeStake) ? tradeStake * tradeMultiplier : null;
  const reasonTakeProfit = Number((trade?.reason ?? '').match(/TP ([0-9.]+)/i)?.[1] ?? NaN);
  const reasonStopLoss = Number((trade?.reason ?? '').match(/SL ([0-9.]+)/i)?.[1] ?? NaN);
  const detailTakeProfit = takeProfit ?? (Number.isFinite(reasonTakeProfit) ? reasonTakeProfit : undefined);
  const detailStopLoss = stopLoss ?? (Number.isFinite(reasonStopLoss) ? reasonStopLoss : undefined);
  if (purchase && localPurchaseTimeRef.current == null) localPurchaseTimeRef.current = Date.now();
  if (!purchase && !hasActiveTradeEntry) localPurchaseTimeRef.current = null;
  const providerStartMs = providerEpochMs(matchingContract?.dateStart ?? matchingContract?.update?.dateStart);
  const providerExpiryMs = providerEpochMs(matchingContract?.dateExpiry ?? matchingContract?.update?.dateExpiry);
  const openedAt = providerStartMs || trade?.ts || localPurchaseTimeRef.current || 0;
  const scheduledDurationMs = expectedTradeDurationMs(trade) || (providerStartMs && providerExpiryMs ? providerExpiryMs - providerStartMs : 0);
  const expectedExpiryMs = providerExpiryMs || (openedAt && scheduledDurationMs ? openedAt + scheduledDurationMs : 0);
  const settlementOverdue = Boolean(hasActiveTradeEntry && !settledTrade && expectedExpiryMs && nowMs - expectedExpiryMs > 30_000);
  const rawElapsedMs = openedAt ? (settledTrade?.resolved_at ?? nowMs) - openedAt : 0;
  const displayElapsedMs = settlementOverdue && scheduledDurationMs ? Math.min(rawElapsedMs, scheduledDurationMs) : rawElapsedMs;
  const elapsedText = openedAt ? `${fmtElapsed(displayElapsedMs)}${settlementOverdue ? '+' : ''}` : '--';
  const openedText = openedAt ? new Date(openedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '--';
  const evidenceStatus = settledTrade
    ? 'Added to Momentum model evidence'
    : settlementOverdue
      ? 'Settlement pending; provider lock still active'
      : hasActiveTradeEntry
      ? 'Will feed model after settlement'
      : closed
        ? 'Close result is being refreshed into history'
        : 'No tracked bet yet';
  const actualEntryPrice = Number.isFinite(Number(trade?.entry_spot)) && Number(trade?.entry_spot) > 0
    ? Number(trade?.entry_spot)
    : Number.isFinite(Number(purchase?.entryPrice)) && Number(purchase?.entryPrice) > 0
      ? Number(purchase?.entryPrice)
      : undefined;
  const chartEntryPrice = hasActiveTradeEntry ? actualEntryPrice ?? entryPrice : undefined;
  const chartEntryLabel = 'Trade entry';
  const chartSymbol = hasActiveTradeEntry ? trade?.market ?? purchase?.market ?? symbol ?? '' : symbol ?? '';
  const chartSamples = chartSnapshot?.symbol === chartSymbol && (hasActiveTradeEntry || !incomingSamples.length) ? chartSnapshot.samples : incomingSamples;
  const chartDisplay = chartSnapshot?.symbol === chartSymbol && (hasActiveTradeEntry || !display) ? chartSnapshot.display : display ?? trade?.market ?? 'Momentum market';
  const chartFrozenEntry = chartSnapshot?.symbol === chartSymbol && chartSnapshot.entryPrice != null ? chartSnapshot.entryPrice : chartEntryPrice;
  const chartDirection = (chartSnapshot?.symbol === chartSymbol && chartSnapshot.direction ? chartSnapshot.direction : suggestedDirection) ?? undefined;
  const contractCurrentSpot = Number.isFinite(Number(matchingContract?.currentSpot ?? matchingContract?.update?.currentSpot))
    ? Number(matchingContract?.currentSpot ?? matchingContract?.update?.currentSpot)
    : undefined;
  const contractCurrentEpoch = Number.isFinite(Number(matchingContract?.currentSpotTime ?? matchingContract?.update?.currentSpotTime))
    ? Number(matchingContract?.currentSpotTime ?? matchingContract?.update?.currentSpotTime)
    : Math.floor(nowMs / 1000);
  const liveSellPrice = Number.isFinite(Number(matchingContract?.sellPrice ?? matchingContract?.update?.sellPrice))
    ? Number(matchingContract?.sellPrice ?? matchingContract?.update?.sellPrice)
    : undefined;
  const contractPhase = settledTrade
    ? `Contract ${settledTrade.status}`
    : settlementOverdue
      ? 'Settlement overdue'
    : matchingContract?.result
      ? `Contract ${matchingContract.result}`
      : matchingContract?.phase
        ? `Contract ${matchingContract.phase}`
        : closed
          ? 'Contract closed'
        : trade
          ? `Contract ${trade.status}`
          : purchase
            ? 'Demo contract submitted'
            : 'No open demo contract';
  const potentialProfit = closed?.profit ?? (purchase?.payout != null && purchase.ask != null ? purchase.payout - purchase.ask : null);
  const suggestionTone = suggestedDirection ?? 'wait';
  const suggestionText = suggestedDirection
    ? `${suggestedDirection.toUpperCase()}${Number.isFinite(Number(suggestedConfidence)) ? ` - ${suggestedConfidence}%` : ''}`
    : 'WAIT';
  const actionNote = busy
    ? 'Sending demo order'
    : closing
      ? 'Closing demo contract'
    : settlementOverdue
      ? `Provider still reports contract ${trackedContractId || ''} open after scheduled expiry; waiting for settlement recovery`
    : openAccountTrade
      ? `Waiting for contract ${openAccountTrade.contract_id || openAccountTrade.id} to settle`
      : !(Number.isFinite(stake) && stake > 0)
        ? 'Enter a positive demo stake'
      : !(Number.isFinite(selectedMultiplier) && selectedMultiplier > 0)
        ? 'Select a valid multiplier'
      : !multiplierWithinLiveMax
        ? `Selected multiplier exceeds live max x${maxMultiplier}`
      : !hasValidLimits
        ? 'TP and stop loss must be positive when set'
      : suggestedDirection
      ? `${suggestedDirection.toUpperCase()} is the active Momentum side`
      : 'Waiting for a validated research direction';

  useEffect(() => {
    setPurchase(null);
    setClosed(null);
    setError('');
  }, [symbol, direction, stakeText, multiplierText, takeProfitText, stopLossText]);

  useEffect(() => {
    if (suggestedDirection) setDirection(suggestedDirection);
  }, [suggestedDirection]);

  useEffect(() => {
    if (configuredMultiplier) setMultiplierText(String(configuredMultiplier));
  }, [configuredMultiplier]);

  useEffect(() => {
    manualMultiplierRef.current = false;
  }, [symbol]);

  useEffect(() => {
    if (!symbol || !owner || !isDemo || !suggestedDirection || !(Number.isFinite(stake) && stake > 0) || openAccountTrade) {
      setMultiplierProbe(null);
      setMultiplierProbeStatus('idle');
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setMultiplierProbeStatus('checking');
      void loadMultiplierOptions({
        symbol,
        direction: suggestedDirection,
        stake,
        signal: controller.signal,
      }).then((result) => {
        if (controller.signal.aborted) return;
        setMultiplierProbe(result);
        setMultiplierProbeStatus('idle');
        if (result.max && selectedMultiplier !== result.max && (!manualMultiplierRef.current || !result.options.includes(selectedMultiplier))) {
          setMultiplierText(String(result.max));
        }
      }).catch((cause) => {
        if (controller.signal.aborted) return;
        setMultiplierProbe(null);
        setMultiplierProbeStatus('error');
        console.warn('[momentum] multiplier limit check failed', cause);
      });
    }, 350);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [isDemo, openAccountTrade, owner, selectedMultiplier, stake, suggestedDirection, symbol]);

  useEffect(() => {
    if (contractPnl != null && Number.isFinite(contractPnl)) setLastKnownPnl(contractPnl);
    if (!hasActiveTradeEntry && closed) setLastKnownPnl(null);
  }, [closed, contractPnl, hasActiveTradeEntry]);

  useEffect(() => {
    if (!hasActiveTradeEntry) return;
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [hasActiveTradeEntry]);

  useEffect(() => {
    const nextSymbol = chartSymbol;
    if (!nextSymbol) {
      if (!hasActiveTradeEntry) setChartSnapshot(null);
      return;
    }
    setChartSnapshot((current) => {
      const sameTrade = current?.symbol === nextSymbol;
      const openedEpoch = openedAt ? Math.floor(openedAt / 1000) : 0;
      const currentSpotSample = hasActiveTradeEntry && contractCurrentSpot != null
        ? { epoch: contractCurrentEpoch, quote: contractCurrentSpot }
        : null;
      const incomingMatchesChart = !hasActiveTradeEntry || !symbol || symbol === nextSymbol;
      const activeFeedSamples = hasActiveTradeEntry && incomingMatchesChart
        ? incomingSamples.filter((sample) => !openedEpoch || sample.epoch >= openedEpoch - 5)
        : hasActiveTradeEntry ? [] : incomingSamples;
      const seededSamples = hasActiveTradeEntry
        ? mergeMomentumSamples(sameTrade ? [...current.samples, ...activeFeedSamples] : activeFeedSamples, null)
        : incomingSamples;
      const nextSamples = mergeMomentumSamples(
        seededSamples,
        currentSpotSample,
      );
      if (hasActiveTradeEntry) {
        return {
          symbol: nextSymbol,
          display: sameTrade ? current.display : display ?? trade?.market ?? nextSymbol,
          samples: nextSamples,
          entryPrice: sameTrade && current.entryPrice != null ? current.entryPrice : chartEntryPrice,
          direction: sameTrade && current.direction ? current.direction : suggestedDirection,
        };
      }
      return {
        symbol: nextSymbol,
        display: display ?? nextSymbol,
        samples: incomingSamples,
        entryPrice: chartEntryPrice,
        direction: suggestedDirection,
      };
    });
  }, [chartEntryPrice, chartSymbol, contractCurrentEpoch, contractCurrentSpot, display, hasActiveTradeEntry, incomingSamples, openedAt, suggestedDirection, symbol, trade?.market]);

  const place = async (nextDirection: 'up' | 'down') => {
    if (!canQuote) return;
    if (!suggestedDirection) {
      setError('Momentum research has no validated direction yet; keep observing before trading.');
      return;
    }
    if (nextDirection !== suggestedDirection) {
      setDirection(suggestedDirection);
      setError(`Momentum research recommends ${suggestedDirection.toUpperCase()}; the opposite side is disabled.`);
      return;
    }
    setDirection(nextDirection);
    setBusy(true);
    setError('');
    try {
      setPurchase(await placeMomentumDemoTrade({
        direction: nextDirection,
        stake,
        multiplier: selectedMultiplier,
        takeProfit,
        stopLoss,
      }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const closeOpenTrade = async () => {
    if (!canClose) return;
    setClosing(true);
    setError('');
    try {
      setClosed(await closeMomentumDemoTrade());
      setPurchase(null);
      await refreshTrades();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setClosing(false);
    }
  };

  const unavailableReason = !symbol
    ? 'Focus a research market before placing a demo trade.'
    : !session
      ? 'Connect a Deriv demo account to request a live quote.'
      : !isDemo
        ? 'Momentum execution is available on demo accounts only. Switch to demo to continue.'
      : !owner
        ? 'Unlock the dashboard owner controls to place a demo trade.'
        : openAccountTrade
          ? `Wait for open contract ${openAccountTrade.contract_id || openAccountTrade.id} to settle before placing another Momentum trade.`
          : null;

  return <section class="mom-trade-desk" aria-label="Momentum demo trade">
    <div class="mom-trade-head">
      <div>
        <span class="mom-kicker">Momentum trade</span>
        <strong>{chartDisplay ?? 'No focused market'}</strong>
        <small>{hasActiveTradeEntry ? 'Pinned to the active Momentum contract' : symbol ? 'Live market selected from current research' : 'Research selection required'}</small>
      </div>
      <div class="mom-trade-badges">
        <span class={`mom-trade-suggestion ${suggestionTone}`} title={suggestedReason ?? undefined}>
          <Icon name={suggestedDirection === 'down' ? 'arrowDown' : suggestedDirection === 'up' ? 'arrowUp' : 'history'} size={13} />
          <span>Suggested side</span>
          <strong>{suggestionText}</strong>
        </span>
      </div>
    </div>

    <div class="mom-trade-live">
      <div class="mom-trade-chart">
        <MomentumPriceChart samples={chartSamples} label={`${chartDisplay ?? 'Momentum market'} live demo trade chart`} entryPrice={chartFrozenEntry} entryDirection={chartDirection} entryLabel={chartEntryLabel} />
      </div>
      <div class="mom-trade-readout" aria-live="polite">
        <span>Demo balance</span>
        <strong>{isDemo && session ? fmtMoney(session.balance, session.currency) : '—'}</strong>
        <small>{contractPhase}</small>
      </div>
      <div class={`mom-trade-readout mom-trade-panel ${displayContractPnl == null ? '' : displayContractPnl >= 0 ? 'up' : 'down'}`} aria-live="polite">
        <div class="mom-contract-line">
          <span>{closableMomentumTrade ? 'Open contract' : 'Contract'}</span>
          {closableMomentumTrade && <button class="mom-trade-close mini" type="button" disabled={!canClose} onClick={() => void closeOpenTrade()}><Icon name="x" size={13} />{closing ? 'Closing' : 'Close'}</button>}
        </div>
        <small>{contractPhase}{trackedContractId ? ` · ${trackedContractId}` : ''}</small>
        <span class="mom-panel-label">Live contract P&amp;L</span>
        <strong>{displayContractPnl == null ? '—' : fmtSigned(displayContractPnl, purchase?.currency ?? session?.currency ?? 'USD')}</strong>
        <small>{closed?.soldFor != null ? `Sold ${fmtMoney(closed.soldFor, purchase?.currency ?? session?.currency ?? 'USD')}` : liveSellPrice == null ? trackedContractId || 'Awaiting a demo order' : `Sell ${fmtMoney(liveSellPrice, purchase?.currency ?? session?.currency ?? 'USD')}`}</small>
        {(trade || purchase || closed) && <div class="mom-trade-mini-details" aria-label="Active Momentum bet details">
          <div><span>Stake</span><strong>{fmtMoney(tradeStake, purchase?.currency ?? session?.currency ?? 'USD')}</strong></div>
          <div><span>Opened</span><strong>{openedText}</strong></div>
          <div><span>Elapsed</span><strong>{elapsedText}</strong></div>
          <div><span>Duration</span><strong>{tradeDurationLabel(trade) || '5m'}</strong></div>
          <div><span>Multiplier</span><strong>x{tradeMultiplier || '--'}</strong></div>
          <div><span>Exposure</span><strong>{tradeExposure == null ? '--' : fmtMoney(tradeExposure, purchase?.currency ?? session?.currency ?? 'USD')}</strong></div>
          <div><span>Potential</span><strong>{tradePotential == null ? '--' : fmtSigned(tradePotential, purchase?.currency ?? session?.currency ?? 'USD')}</strong></div>
          <div><span>TP / SL</span><strong>{detailTakeProfit ? fmtMoney(detailTakeProfit, purchase?.currency ?? session?.currency ?? 'USD') : '--'} / {detailStopLoss ? fmtMoney(detailStopLoss, purchase?.currency ?? session?.currency ?? 'USD') : '--'}</strong></div>
          <div><span>Entry</span><strong>{chartFrozenEntry == null ? '--' : chartFrozenEntry.toLocaleString(undefined, { maximumFractionDigits: 8 })}</strong></div>
          <div class="mom-evidence-detail"><span>Evidence</span><strong title={evidenceStatus}>{evidenceStatus}</strong></div>
        </div>}
      </div>
    </div>

    <div class="mom-trade-order">
      <div class="mom-trade-direction" aria-label="Place a demo trade">
        <button class={`up ${direction === 'up' ? 'active' : ''}${suggestedDirection === 'up' ? ' suggested' : ''}`} type="button" disabled={!canPlace || suggestedDirection !== 'up' || busy} onClick={() => void place('up')} aria-label={suggestedDirection === 'up' ? 'Place suggested up demo trade' : 'Place up demo trade'}><Icon name="arrowUp" size={15} />{busy && direction === 'up' ? 'Placing' : 'Up'}</button>
        <button class={`down ${direction === 'down' ? 'active' : ''}${suggestedDirection === 'down' ? ' suggested' : ''}`} type="button" disabled={!canPlace || suggestedDirection !== 'down' || busy} onClick={() => void place('down')} aria-label={suggestedDirection === 'down' ? 'Place suggested down demo trade' : 'Place down demo trade'}><Icon name="arrowDown" size={15} />{busy && direction === 'down' ? 'Placing' : 'Down'}</button>
      </div>
      <label class="mom-trade-stake"><span>Demo stake</span><input type="number" inputMode="decimal" min="0.35" step="0.01" value={stakeText} disabled={busy || Boolean(openAccountTrade)} onInput={(event) => setStakeText((event.currentTarget as HTMLInputElement).value)} /></label>
      <label class="mom-trade-multiplier"><span>{maxMultiplier ? `Multiplier max x${maxMultiplier}` : multiplierProbeStatus === 'checking' ? 'Multiplier checking max' : 'Multiplier'}</span><select value={multiplierText} disabled={busy || Boolean(openAccountTrade)} onChange={(event) => { manualMultiplierRef.current = true; setMultiplierText((event.currentTarget as HTMLSelectElement).value); }}>{multiplierOptions.map((value) => <option value={value} key={value}>x{value}{maxMultiplier === value ? ' max' : ''}</option>)}</select></label>
      <label class="mom-trade-limit"><span>TP profit</span><input type="number" inputMode="decimal" min="0.01" step="0.01" placeholder="optional" value={takeProfitText} disabled={busy || Boolean(openAccountTrade)} onInput={(event) => setTakeProfitText((event.currentTarget as HTMLInputElement).value)} /></label>
      <label class="mom-trade-limit"><span>Stop loss</span><input type="number" inputMode="decimal" min="0.01" step="0.01" placeholder="optional" value={stopLossText} disabled={busy || Boolean(openAccountTrade)} onInput={(event) => setStopLossText((event.currentTarget as HTMLInputElement).value)} /></label>
      <div class="mom-trade-quote">
        <span>{purchase ? 'Last order potential' : 'Live proposal at order time'}</span>
        <strong>{potentialProfit == null ? '—' : fmtSigned(potentialProfit, session?.currency ?? 'USD')}</strong>
      </div>
      <span class="mom-trade-action-note">{actionNote}</span>
    </div>

    {settlementOverdue && <div class="mom-trade-note warning">Scheduled duration has passed, but Deriv still reports this contract as open. New Momentum orders stay locked until settlement recovery or a successful close confirms the final result.</div>}
    {unavailableReason && <div class="mom-trade-note">{unavailableReason}</div>}
    {(purchase || closableMomentumTrade) && <div class="mom-trade-note">Demo contract {trackedContractId || 'submitted'} is tracked against this account balance.</div>}
    {error && <div class="tl-err">{error}</div>}
  </section>;
}

function MomentumPage(): JSX.Element {
  const s = useStore();
  const momentum = s.momentum;
  const [activeTab, setActiveTab] = useState<'research' | 'trade'>('research');
  const [busy, setBusy] = useState(false);
  const [focusing, setFocusing] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [momentumLoaded, setMomentumLoaded] = useState(Boolean(momentum));
  const [firstLaunchVisit] = useState(() => !hasSeenMomentumLaunch());

  useEffect(() => {
    let mounted = true;
    if (firstLaunchVisit) rememberMomentumLaunch();
    void loadMomentumState()
      .catch((cause) => {
        if (mounted) setError(cause instanceof Error ? cause.message : String(cause));
      })
      .finally(() => {
        if (mounted) setMomentumLoaded(true);
      });
    return () => { mounted = false; };
  }, [firstLaunchVisit]);
  const toggle = async () => {
    setBusy(true); setError('');
    try {
      if (momentum?.running) await stopMomentumResearch();
      else await startMomentumResearch();
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  };
  const focus = async (symbol: string) => {
    setFocusing(symbol); setError('');
    try { await focusMomentumMarket(symbol); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setFocusing(null); }
  };
  const returnToWatchboard = async () => {
    setBusy(true); setError('');
    try { await startMomentumResearch(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  };

  const w = momentum?.window;
  const signal = w?.signal;
  const tradeSignal = w?.direction && w.decisionSignal ? w.decisionSignal : signal;
  const market = momentum?.markets.find((item) => item.symbol === momentum.config?.symbol);
  const watchedMarkets = momentum?.scan?.markets ?? [];
  const focusedMarket = watchedMarkets.find((item) => item.symbol === momentum?.config?.symbol) ?? null;
  const canReturnToWatchboard = Boolean(momentum?.running && momentum.phase === 'observing' && momentum.config?.symbol);
  const secondsLeft = w ? Math.max(0, w.endsAt - Math.floor(Date.now() / 1000)) : 300;
  const elapsed = w ? Math.max(0, 300 - secondsLeft) : 0;
  const settledSignals = (momentum?.wins ?? 0) + (momentum?.losses ?? 0);
  const winRate = momentum && settledSignals ? momentum.wins / settledSignals : null;
  const breakEvenMove = (momentum?.config?.commissionRate ?? .001);
  const research = momentum?.research;
  const observedPrices = [
    w?.openPrice,
    ...(w?.samples ?? focusedMarket?.samples ?? []).map((sample) => sample.quote),
    w?.currentPrice,
  ].filter((price): price is number => price != null && Number.isFinite(price) && price > 0);
  const watchEntry = (w?.openPrice && w.openPrice > 0) ? w.openPrice : observedPrices[0] ?? 0;
  const currentPrice = (w?.currentPrice && w.currentPrice > 0) ? w.currentPrice : observedPrices.at(-1) ?? watchEntry;
  const highestPrice = observedPrices.length ? Math.max(...observedPrices) : watchEntry;
  const lowestPrice = observedPrices.length ? Math.min(...observedPrices) : watchEntry;
  const relativeMove = (price: number): number => watchEntry > 0 ? (price - watchEntry) / watchEntry : 0;
  const currentMove = relativeMove(currentPrice);
  const priceRange = highestPrice - lowestPrice;
  const currentPosition = observedPrices.length < 2
    ? 'Collecting prices'
    : priceRange <= Math.max(watchEntry * .000001, .00000001)
      ? 'At watch entry'
      : currentPrice >= highestPrice - priceRange * .2
        ? 'Near the high'
        : currentPrice <= lowestPrice + priceRange * .2
          ? 'Near the low'
          : currentMove >= 0 ? 'Above entry' : 'Below entry';
  const priceStory = [
    { label: 'Watch entry', price: watchEntry, detail: 'Starting price', tone: 'neutral' },
    { label: 'Highest since', price: highestPrice, detail: `${momentumPct(relativeMove(highestPrice))} from entry`, tone: 'up' },
    { label: 'Current position', price: currentPrice, detail: currentPosition, tone: currentMove >= 0 ? 'up' : 'down' },
    { label: 'Lowest since', price: lowestPrice, detail: `${momentumPct(relativeMove(lowestPrice))} from entry`, tone: 'down' },
  ];
  const movementScale = Math.max(...priceStory.map((point) => Math.abs(relativeMove(point.price))), .0001);
  const researchState = !momentum?.running
    ? 'idle'
    : momentum.phase === 'connecting' || momentum.phase === 'scanning'
      ? 'starting'
      : 'active';
  const stateReady = momentumLoaded || Boolean(momentum);
  const showRestoring = !stateReady && !firstLaunchVisit;
  // The welcome surface is only for a genuinely untouched idle workspace.
  // A later paused or failed server run must remain actionable, not look like
  // a first visit because this component still has its initial storage value.
  const showLaunch = firstLaunchVisit && (!stateReady || (!momentum?.running && momentum?.phase === 'idle'));
  const showPaused = stateReady && !momentum?.running && !showLaunch;

  return <>
    <header class="header mom-page-header">
      <div class="mom-page-heading">
      <img class="mom-brand-logo" src="/multiplier-logo.png" alt="Multiplier" />
      <div class="subtitle">Automatic real-market scanning · five-minute research · no purchases</div>
      </div>
      <div class="mom-tabs" role="tablist" aria-label="Momentum workspace">
        <button class={activeTab === 'research' ? 'active' : ''} type="button" role="tab" aria-selected={activeTab === 'research'} onClick={() => setActiveTab('research')}>Research</button>
        <button class={activeTab === 'trade' ? 'active' : ''} type="button" role="tab" aria-selected={activeTab === 'trade'} onClick={() => setActiveTab('trade')}>Trade</button>
      </div>
    </header>
    {activeTab === 'trade' ? <MomentumTradeDesk
      symbol={momentum?.config?.symbol}
      display={focusedMarket?.display ?? market?.display}
      samples={w?.samples ?? focusedMarket?.samples}
      entryPrice={w?.openPrice}
      configuredMultiplier={momentum?.config?.multiplier}
      session={s.session}
      owner={s.owner}
      suggestedDirection={w?.direction ?? (signal?.direction === 'wait' ? null : signal?.direction)}
      suggestedConfidence={tradeSignal?.direction === 'wait' ? null : tradeSignal?.confidence}
      suggestedReason={tradeSignal?.reason}
      trades={s.trades}
      contract={s.contract}
    /> : showRestoring ? <section class="mom-restoring" aria-live="polite" aria-busy="true">
      <span class="mom-restoring-mark" aria-hidden="true"><i></i><i></i><i></i></span>
      <div><span class="mom-kicker">Momentum workspace</span><strong>Restoring live research state</strong><small>Checking the latest scanner status.</small></div>
    </section> : showLaunch ? <section class="mom-launch" aria-live="polite">
      <div class="mom-launch-mark" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></div>
      <span class="mom-kicker">Research workspace</span>
      <h2>Ready to watch live momentum.</h2>
      <p>Start a fresh comparison across verified multiplier markets. The scanner checks availability, measures aligned moves, and focuses the strongest direction for a five-minute research window.</p>
      <div class="mom-launch-facts" aria-label="Research setup"><span><Icon name="stats" size={14} />Up to 12 verified markets</span><span><Icon name="history" size={14} />Five-minute windows</span><span><Icon name="check" size={14} />{momentumPct(breakEvenMove)} cost hurdle</span><span><Icon name="check" size={14} />No purchases</span></div>
      <button class="mom-launch-action" disabled={busy || !s.owner} onClick={() => void toggle()}><Icon name="play" size={16} />Start research</button>
      {!s.owner && <small>Research is controlled by the dashboard owner.</small>}
      {error && <div class="tl-err">{error}</div>}
    </section> : showPaused ? <section class="mom-paused" aria-live="polite">
      <span class="mom-paused-mark" aria-hidden="true"><Icon name="stats" size={18} /></span>
      <div><span class="mom-kicker">Momentum workspace</span><strong>{momentum?.phase === 'error' ? 'Research needs attention' : 'Research is paused'}</strong><small>{momentum?.reason ?? 'Start a new verified market comparison when you are ready.'}</small></div>
      <button class="mom-paused-action" disabled={busy || !s.owner} onClick={() => void toggle()}><Icon name="play" size={15} />Start research</button>
      {!s.owner && <small class="mom-paused-owner">Research is controlled by the dashboard owner.</small>}
      {error && <div class="tl-err">{error}</div>}
    </section> : <div class={`mom-layout ${researchState}`}>
      <section class="mom-evidence mom-evidence-primary">
        <div class="mom-live-trace" aria-label="Price story since this market watch began">
          <div class="mom-live-trace-head"><span>Price story since watch began</span><small>Start, high, current position, and low. Not a forecast.</small></div>
          <div class="mom-live-trace-bars">
            {priceStory.map((point) => {
              const height = 18 + Math.round((Math.abs(relativeMove(point.price)) / movementScale) * 82);
              return <div class={`mom-trace-bar ${point.tone}`} key={point.label}>
                <i style={{ height: `${height}%` }}></i><b>{momentumPrice(point.price)}</b><span>{point.label}</span><small>{point.detail}</small>
              </div>;
            })}
          </div>
        </div>
        <div class="mom-evidence-head">
          <div><span class="mom-kicker">Why this direction</span><strong>{signal?.reason ?? momentum?.reason ?? 'Building live cross-market evidence'}</strong></div>
          <div class="mom-evidence-actions">
            <span class={`mom-status ${momentum?.phase ?? 'idle'}`}><i></i>{momentum?.phase ?? 'idle'}</span>
            {w?.direction && <span class={`mom-locked ${w.direction}`}>Research entry locked · {w.direction}</span>}
            <button class={`mom-toggle ${momentum?.running ? 'stop' : ''}`} disabled={busy || !s.owner} onClick={() => void toggle()}><Icon name={momentum?.running ? 'square' : 'play'} size={15} />{momentum?.running ? 'Pause' : 'Resume scan'}</button>
          </div>
        </div>
        <div class="mom-horizons"><div><span>15 sec</span><strong class={(signal?.return15s ?? 0) >= 0 ? 'up' : 'down'}>{momentumPct(signal?.return15s)}</strong></div><div><span>30 sec</span><strong class={(signal?.return30s ?? 0) >= 0 ? 'up' : 'down'}>{momentumPct(signal?.return30s)}</strong></div><div><span>60 sec</span><strong class={(signal?.return60s ?? 0) >= 0 ? 'up' : 'down'}>{momentumPct(signal?.return60s)}</strong></div><div><span>Cost hurdle</span><strong>{momentumPct(breakEvenMove)}</strong></div></div>
      </section>
      <MomentumWatchboard markets={watchedMarkets} selected={momentum?.config?.symbol} onFocus={(symbol) => void focus(symbol)} focusing={focusing} />
      {!s.owner && <div class="tl-note">Research starts automatically on the server. Unlock only if you need to pause or resume it.</div>}
      {error && <div class="tl-err">{error}</div>}

      {(focusedMarket || w?.samples?.length) && <section class="mom-focus-stage" aria-label="Focused momentum market">
        <div><span class="mom-kicker">Focused research</span><strong>{focusedMarket?.display ?? market?.display ?? 'Current market'}</strong><small>{focusedMarket ? `${focusedMarket.sampleCount} ticks observed · ${Math.round(momentumProgress(focusedMarket.progress))}% scan complete` : 'Live window samples'}</small></div>
        {canReturnToWatchboard && <button class="mom-return-watch" type="button" disabled={busy || !s.owner} onClick={() => void returnToWatchboard()} aria-label="Return to full market watchboard and begin a new scan" title="Return to market watchboard"><Icon name="arrowLeft" size={13} />Back to watchboard</button>}
        <div class="mom-focus-chart"><MomentumPriceChart samples={w?.samples ?? focusedMarket?.samples} label={`${focusedMarket?.display ?? market?.display ?? 'Focused market'} full research chart`} entryPrice={w?.openPrice} entryDirection={w?.direction ?? undefined} entryLabel={w?.direction ? `Watch entry \u00b7 ${w.direction.toUpperCase()}` : 'Watch entry'} /></div>
      </section>}

      <section class="mom-window" aria-live="polite">
        <div class="mom-clock"><span>Current rolling window</span><strong>{String(Math.floor(secondsLeft / 60)).padStart(2, '0')}:{String(secondsLeft % 60).padStart(2, '0')}</strong><div><i style={{ width: `${Math.min(100, elapsed / 3)}%` }}></i></div></div>
        <div class="mom-price"><span>Window open</span><strong>{w?.openPrice?.toLocaleString(undefined, { maximumFractionDigits: 8 }) ?? '—'}</strong></div>
        <div class="mom-price"><span>Live price</span><strong>{w?.currentPrice?.toLocaleString(undefined, { maximumFractionDigits: 8 }) ?? '—'}</strong><small class={(w?.changePct ?? 0) >= 0 ? 'up' : 'down'}>{momentumPct(w?.changePct)}</small></div>
        <div class={`mom-call ${signal?.direction ?? 'wait'}`}><span>Current read</span><strong>{signal?.direction === 'up' ? 'UP' : signal?.direction === 'down' ? 'DOWN' : 'WAIT'}</strong><small>{signal?.confidence ?? 0}% confidence</small></div>
      </section>

      <section class="mom-pnl">
        <div><span>Estimated gross</span><strong>{fmtSigned(w?.estimatedGross ?? 0, s.session?.currency ?? 'USD')}</strong></div><div><span>Estimated commission</span><strong class="down">−{fmtMoney(w?.estimatedCommission ?? 0, s.session?.currency ?? 'USD')}</strong></div><div><span>Estimated net</span><strong class={(w?.estimatedNet ?? 0) >= 0 ? 'up' : 'down'}>{fmtSigned(w?.estimatedNet ?? 0, s.session?.currency ?? 'USD')}</strong></div><div><span>All-window estimate</span><strong class={(momentum?.estimatedNet ?? 0) >= 0 ? 'up' : 'down'}>{fmtSigned(momentum?.estimatedNet ?? 0, s.session?.currency ?? 'USD')}</strong></div>
      </section>

      <section class="mom-scoreboard"><div><span>Windows completed</span><strong>{momentum?.completedWindows ?? 0}</strong></div><div><span>Signals taken</span><strong>{momentum?.signalledWindows ?? 0}</strong></div><div><span>Directional wins</span><strong>{momentum?.wins ?? 0}</strong></div><div><span>Observed win rate</span><strong>{winRate == null ? '—' : `${(winRate * 100).toFixed(1)}%`}</strong></div></section>
      <MomentumResearchLedger rows={research?.recent} currency={s.session?.currency ?? 'USD'} />
      <section class={`mom-research-rail${research?.ready_for_virtual_paper ? ' mature' : ''}`}>
        <div><span class="mom-kicker">Stored research</span><strong>{research ? `${research.windows}/${research.maturity_target} signal windows` : 'Loading stored evidence'}</strong></div>
        <span>{research?.ready_for_virtual_paper ? 'Maturity reached. Review before any separate virtual-paper design.' : `${research?.samples_remaining ?? 30} more directional windows needed for a virtual-paper review.`}</span>
        <small>Saved globally. It does not alter digit signals, account balances, or real/demo trading.</small>
      </section>
      <div class="mom-disclaimer"><strong>Research estimate, not account P&amp;L.</strong> The 0.10% cost hurdle is a fixed assumption. Before demo execution, the system must capture Deriv’s actual proposal commission and live sell price; spot movement alone is not sufficient evidence of profitability.</div>
    </div>}
  </>;
}

/* ---------------- test lab ---------------- */

const STRATEGY_KEYS = ['conservative', 'martingale', 'boosted_martingale', 'chase'] as const;
const MODE_KEYS = ['rapid', 'balanced', 'strict'] as const;
const ALL_CONFIG_KEYS: string[] = STRATEGY_KEYS.flatMap((s) => MODE_KEYS.map((m) => `${s}-${m}`));

type LabTab = 'backtest' | 'paper' | 'compare' | 'patterns';

function configKey(strategy: string, mode: string): string {
  return `${strategy}-${mode}`;
}

function useCountUp(target: number, active = true): number {
  const [val, setVal] = useState(0);
  useEffect(() => {
    if (!active) {
      setVal(target);
      return;
    }
    let raf = 0;
    const start = performance.now();
    const dur = 750;
    const step = (t: number) => {
      const p = Math.min(1, (t - start) / dur);
      const eased = 1 - Math.pow(1 - p, 3);
      setVal(target * eased);
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, active]);
  return val;
}

function Sparkline({ points }: { points: number[] }): JSX.Element {
  if (points.length < 2) return <div class="tl-spark tl-spark-empty">—</div>;
  const w = 240;
  const h = 60;
  const pad = 5;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = max - min || 1;
  const stepX = (w - pad * 2) / (points.length - 1);
  const coords = points.map(
    (p, i) => `${(pad + i * stepX).toFixed(1)},${(h - pad - ((p - min) / range) * (h - pad * 2)).toFixed(1)}`,
  );
  const up = points[points.length - 1] >= points[0];
  return (
    <svg class={`tl-spark${up ? ' up' : ' down'}`} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden="true">
      <path d={`M${coords.join(' L')}`} class="tl-spark-line" pathLength={100} />
    </svg>
  );
}

function TlPnlBar({ pnl, scale }: { pnl: number; scale: number }): JSX.Element {
  const mag = Math.min(100, (Math.abs(pnl) / Math.max(1, scale)) * 100);
  return (
    <div class="tl-bar-track">
      <div
        class={`tl-bar-fill ${pnl >= 0 ? 'up' : 'down'}`}
        style={{ width: `${Math.max(2, Math.round(mag))}%` }}
      ></div>
    </div>
  );
}

function UseCountNum({ value, pct = false, money = false, currency = '$' }: { value: number | null; pct?: boolean; money?: boolean; currency?: string }): JSX.Element {
  const v = useCountUp(value ?? 0, value !== null);
  const text = pct
    ? `${v.toFixed(1)}%`
    : money
      ? fmtSigned(v, currency)
      : Math.round(v).toString();
  const cls = money ? (value !== null && value > 0 ? ' up' : value !== null && value < 0 ? ' down' : '') : '';
  return <span class={`tl-num${cls}`}>{text}</span>;
}

function LabActive({ active }: { active: TestLabActive | null }): JSX.Element | null {
  if (!active) return null;
  const label = active.kind === 'backtest' ? 'Backtest' : active.kind === 'paper' ? 'Paper sweep' : 'Pattern scan';
  const idx = active.configIndex !== undefined ? active.configIndex + 1 : active.done !== undefined ? active.done : null;
  const total = active.totalConfigs !== undefined ? active.totalConfigs : active.total;
  return (
    <div class="tl-active">
      <span class="tl-active-pulse"></span>
      <span class="tl-active-label">{label}</span>
      <span class="tl-active-phase">{active.message}</span>
      {idx != null && total != null && (
        <span class="tl-active-count">
          {idx}/{total}
          {active.tradesTarget ? ` · trade ${active.tradesDone ?? 0}/${active.tradesTarget}` : ''}
        </span>
      )}
    </div>
  );
}

function LabControls({
  busy,
  disabled,
  onRun,
  runLabel,
  children,
}: {
  busy: boolean;
  disabled: boolean;
  onRun: () => void;
  runLabel: string;
  children?: JSX.Element;
}): JSX.Element {
  return (
    <div class="tl-controls">
      <div class="tl-subset">{children}</div>
      <button class={`tl-run${busy ? ' busy' : ''}`} disabled={disabled || busy} onClick={onRun}>
        {busy ? 'Running…' : runLabel}
      </button>
    </div>
  );
}

function TlErr({ err }: { err: string }): JSX.Element | null {
  if (!err) return null;
  return <div class="tl-err">{err}</div>;
}

function useLatestRun(runs: TestRunRow[], kind: 'backtest' | 'paper', key: string): TestRunRow | null {
  const [strategy, mode] = key.split('-');
  const hit = runs.find((r) => r.kind === kind && r.strategy_mode === strategy && r.bot_mode === mode);
  return hit ?? null;
}

function bestConfigKey(runs: TestRunRow[], kind: 'backtest' | 'paper'): string | null {
  let best: TestRunRow | null = null;
  for (const r of runs) {
    if (r.kind !== kind || r.trades === 0) continue;
    if (!best || r.net_pnl > best.net_pnl) best = r;
  }
  return best ? configKey(best.strategy_mode, best.bot_mode) : null;
}

function LabCards({
  runs,
  equity,
  kind,
  busy,
  wide,
}: {
  runs: TestRunRow[];
  equity: Record<string, number[]>;
  kind: 'backtest' | 'paper';
  busy: boolean;
  wide?: boolean;
}): JSX.Element {
  const [open, setOpen] = useState<string | null>(null);
  const best = bestConfigKey(runs, kind);

  return (
    <div class={`tl-cards${wide ? ' tl-cards--wide' : ''}`}>
      {STRATEGY_KEYS.map((strategy, si) => (
        <article class="tl-card" style={{ animationDelay: `${si * 70}ms` }}>
          <div class="tl-card-head">
            <span class="tl-card-name">{STRATEGY_META[strategy].label}</span>
            <span class="tl-card-hint">{STRATEGY_META[strategy].hint}</span>
          </div>
          <div class="tl-modes">
            {MODE_KEYS.map((mode) => {
              const key = configKey(strategy, mode);
              const run = useLatestRun(runs, kind, key);
              const openKey = `${kind}-${key}`;
              const expanded = open === openKey;
              const pnl = run?.net_pnl ?? 0;
              const wins = run?.wins ?? 0;
              const loss = run?.losses ?? 0;
              const scale = Math.max(1, ...runs.filter((r) => r.kind === kind).map((r) => Math.abs(r.net_pnl ?? 0)));
              return (
                <button
                  class={`tl-mode${run && run.trades > 0 ? '' : ' empty'}${best === key ? ' best' : ''}${expanded ? ' open' : ''}`}
                  onClick={() => setOpen(expanded ? null : openKey)}
                  disabled={busy}
                >
                  {best === key && <span class="tl-badge">Best</span>}
                  {run?.source === 'auto' && <span class="tl-badge auto">Auto</span>}
                  <span class="tl-mode-name">{MODE_META[mode].label}</span>
                  {run && run.trades > 0 ? (
                    <>
                      <div class="tl-mode-nums">
                        <span class="tl-mode-trades">{run.trades} trades</span>
                        <span class={`tl-mode-pnl${pnl >= 0 ? ' up' : ' down'}`}>
                          {fmtSigned(pnl, '$')}
                        </span>
                      </div>
                      <div class="tl-cells">
                        <span class="tl-cell">
                          <span class="tl-cell-v"><UseCountNum value={run.win_rate} pct /></span>
                          <span class="tl-cell-l">win</span>
                        </span>
                        <span class="tl-cell">
                          <span class={`tl-cell-v${run.wins >= run.losses ? ' up' : ' down'}`}>{wins}W {loss}L</span>
                          <span class="tl-cell-l">w/l</span>
                        </span>
                      </div>
                      <div class="tl-wr">
                        <div class="tl-wr-track">
                          <div class="tl-wr-fill" style={{ width: `${Math.min(100, run.win_rate ?? 0)}%` }}></div>
                        </div>
                      </div>
                      {expanded && (
                        <div class="tl-mode-detail">
                          <Sparkline points={equity[`${kind}-${key}`] ?? []} />
                          <div class="tl-metrics">
                            <span class="tl-minute"><b>{fmtSigned(run.net_pnl ?? 0, '$')}</b> pnl</span>
                            <span class="tl-minute"><b>{run.max_drawdown_pct?.toFixed(1) ?? '—'}%</b> max dd</span>
                            <span class="tl-minute"><b>{run.best_streak ?? 0}</b> win streak</span>
                            <span class="tl-minute"><b>{run.worst_streak ?? 0}</b> loss streak</span>
                            <span class="tl-minute"><b>{run.final_balance != null ? fmtMoney(run.final_balance, '$') : '—'}</b> end bal</span>
                          </div>
                        </div>
                      )}
                    </>
                  ) : (
                    <span class="tl-mode-empty">{busy ? 'running…' : 'no run yet'}</span>
                  )}
                  <TlPnlBar pnl={pnl} scale={scale} />
                </button>
              );
            })}
          </div>
        </article>
      ))}
    </div>
  );
}

function ConfigPicker({
  selected,
  onToggle,
  onToggleAll,
}: {
  selected: Set<string>;
  onToggle: (key: string) => void;
  onToggleAll: (selectAll: boolean) => void;
}): JSX.Element {
  const all = selected.size === ALL_CONFIG_KEYS.length;
  return (
    <div class="tl-picker">
      <div class="tl-picker-head">
        <span class="tl-picker-label">Configs</span>
        <span class="tl-picker-count">
          {selected.size}/{ALL_CONFIG_KEYS.length} selected
        </span>
        <button class={`tl-pickall${all ? ' on' : ''}`} onClick={() => onToggleAll(!all)}>
          {all ? 'Clear' : 'All'}
        </button>
      </div>
      <div class="tl-picker-grid">
        {ALL_CONFIG_KEYS.map((key) => {
          const [s, m] = key.split('-');
          return (
            <button
              class={`tl-pick${selected.has(key) ? ' on' : ''}`}
              onClick={() => onToggle(key)}
            >
              <span class={`tl-pick-s${selected.has(key) ? ' on' : ''}`}>{STRATEGY_META[s as Settings['strategy_mode']].label}</span>
              <span class={`tl-pick-m${selected.has(key) ? ' on' : ''}`}>{MODE_META[m as Settings['bot_mode']].label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function BacktestSimulationStage({
  active,
  runs,
  selectedCount,
  target,
}: {
  active: TestLabActive | null;
  runs: TestRunRow[];
  selectedCount: number;
  target: number;
}): JSX.Element {
  const running = active?.kind === 'backtest';
  const configIndex = running ? Math.min(active.configIndex ?? 0, Math.max(0, selectedCount - 1)) : 0;
  const tradesDone = running ? active.tradesDone ?? 0 : 0;
  const tradesTarget = running ? active.tradesTarget ?? target : target;
  const configProgress = selectedCount > 0 ? configIndex / selectedCount : 0;
  const tradeProgress = tradesTarget > 0 ? tradesDone / tradesTarget / Math.max(1, selectedCount) : 0;
  const progress = running ? Math.min(100, Math.max(2, (configProgress + tradeProgress) * 100)) : runs.length ? 100 : 0;
  const bestKey = bestConfigKey(runs, 'backtest');
  const bestRun = bestKey ? useLatestRun(runs, 'backtest', bestKey) : null;
  const [activeStrategy, activeMode] = (active?.config ?? bestKey ?? 'adaptive-balanced').split('-');
  const strategyLabel = STRATEGY_META[activeStrategy as Settings['strategy_mode']]?.label ?? 'Strategy replay';
  const modeLabel = MODE_META[activeMode as Settings['bot_mode']]?.label ?? 'Balanced';
  const stateLabel = running ? 'Replaying history' : bestRun ? 'Replay complete' : 'Ready to simulate';

  return (
    <section class={`backtest-stage${running ? ' is-running' : runs.length ? ' is-complete' : ''}`} aria-label="Backtest simulation visualizer">
      <div class="backtest-stage-glow" aria-hidden="true"></div>
      <div class="backtest-stage-head">
        <div>
          <span class="backtest-stage-kicker">Historical replay engine</span>
          <h2>{running ? 'Testing every decision.' : bestRun ? 'Replay intelligence ready.' : 'Turn history into an edge.'}</h2>
          <p>{running ? active.message : bestRun ? 'Your strongest configuration is surfaced from the latest replay.' : 'Run selected strategies across recorded ticks in a fast visual simulation.'}</p>
        </div>
        <span class={`backtest-stage-state${running ? ' live' : runs.length ? ' complete' : ''}`}><i></i>{stateLabel}</span>
      </div>

      <div class="backtest-replay" aria-hidden="true">
        <div class="backtest-grid"></div>
        <div class="backtest-tick-ribbon">
          {[7, 2, 9, 4, 1, 8, 3, 6, 0, 5, 9, 2, 7, 4].map((digit, index) => (
            <span style={{ '--tick-index': index } as JSX.CSSProperties}>{digit}</span>
          ))}
        </div>
        <svg viewBox="0 0 720 130" preserveAspectRatio="none">
          <defs>
            <linearGradient id="backtestLine" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0" stop-color="#8b5cf6" stop-opacity=".15" />
              <stop offset=".55" stop-color="#a78bfa" />
              <stop offset="1" stop-color="#ff4d91" />
            </linearGradient>
          </defs>
          <path class="backtest-replay-line" pathLength="100" d="M0 88 C42 74 58 102 101 78 S165 31 207 57 S271 109 314 74 S374 36 416 65 S479 98 522 51 S584 80 625 42 S681 58 720 24" />
        </svg>
        <span class="backtest-scanner"></span>
        <span class="backtest-cursor"></span>
      </div>

      <div class="backtest-stage-console">
        <div class="backtest-stage-config">
          <span class="backtest-stage-index">{running ? String(configIndex + 1).padStart(2, '0') : '01'}</span>
          <div><small>{running ? 'Now testing' : bestRun ? 'Best result' : 'First pass'}</small><strong>{strategyLabel} · {modeLabel}</strong></div>
        </div>
        <div class="backtest-stage-metric"><small>Replay size</small><strong>{target} <span>/ config</span></strong></div>
        <div class="backtest-stage-metric"><small>Strategies</small><strong>{selectedCount}</strong></div>
        <div class="backtest-stage-metric result"><small>{bestRun && !running ? 'Net result' : 'Simulated only'}</small><strong class={bestRun && bestRun.net_pnl >= 0 ? 'up' : bestRun ? 'down' : ''}>{bestRun && !running ? fmtSigned(bestRun.net_pnl, '$') : 'No funds'}</strong></div>
      </div>

      <div class="backtest-stage-progress" role="progressbar" aria-label="Backtest progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress)}>
        <span style={{ width: `${progress}%` }}></span>
      </div>
      <div class="backtest-stage-foot">
        <span>{running ? `Config ${configIndex + 1} of ${selectedCount}` : runs.length ? 'Latest replay complete' : `${selectedCount} configurations queued`}</span>
        <strong>{running ? `${tradesDone}/${tradesTarget} trades` : `${Math.round(progress)}%`}</strong>
      </div>
    </section>
  );
}

function BacktestTab({ busy, onBusy }: { busy: boolean; onBusy: (b: boolean) => void }): JSX.Element {
  const s = useStore();
  const guest = !s.session;
  const [target, setTarget] = useState(200);
  const [err, setErr] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set(ALL_CONFIG_KEYS));
  const runs = s.testRuns.filter((r) => r.kind === 'backtest').slice(0, 500);

  useEffect(() => {
    void loadAutoBacktestStatus();
    const t = setInterval(() => void loadAutoBacktestStatus(), 60_000);
    return () => clearInterval(t);
  }, []);

  const toggle = (key: string) => {
    const next = new Set(selected);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setSelected(next);
  };

  const toggleAll = (selectAll: boolean) => {
    setSelected(selectAll ? new Set(ALL_CONFIG_KEYS) : new Set());
  };

  const run = async () => {
    setErr('');
    onBusy(true);
    try {
      await runTestBacktest({ target, configs: [...selected] });
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      onBusy(false);
    }
  };

  const patternInfo = (() => {
    const g = (s.settings?.pattern_weight ?? 0) > 0 ? 'global ON' : 'global OFF';
    const parts = [
      ((s.settings?.pattern_weight_conservative ?? null) != null) ? `safe=${s.settings?.pattern_weight_conservative}` : null,
      ((s.settings?.pattern_weight_martingale ?? null) != null) ? `martingale=${s.settings?.pattern_weight_martingale}` : null,
      ((s.settings?.pattern_weight_boosted_martingale ?? null) != null) ? `boosted=${s.settings?.pattern_weight_boosted_martingale}` : null,
      ((s.settings?.pattern_weight_chase ?? null) != null) ? `chase=${s.settings?.pattern_weight_chase}` : null,
    ].filter((x): x is string => x != null);
    return parts.length ? `${g} · ${parts.join(' · ')}` : g;
  })();

  return (
    <>
      <LabControls busy={busy} disabled={guest} onRun={run} runLabel={guest ? 'Connect to run backtest' : 'Run backtest'}>
        <label class="tl-field">
          <span class="tl-field-label">Target trades / config</span>
          <input
            class="tl-input"
            type="number"
            min={10}
            max={200}
            step={10}
            value={target}
            disabled={guest}
            onInput={(e: any) => setTarget(Number(e.currentTarget.value) || 200)}
          />
        </label>
      </LabControls>
      <BacktestSimulationStage
        active={s.testlab?.kind === 'backtest' ? s.testlab : null}
        runs={runs}
        selectedCount={selected.size}
        target={target}
      />
      <LabActive active={s.testlab?.kind === 'backtest' ? s.testlab : null} />
      <TlErr err={err} />
      <div class="tl-statusbar">
        <div class="tl-status">
          <span class="tl-status-key">Patterns</span>
          <span class="tl-status-val">{patternInfo}</span>
        </div>
        {s.autoBacktest && (
          <div class="tl-status auto">
            <span class="tl-status-key">Auto</span>
            <span class="tl-status-val">
              every {Math.round(s.autoBacktest.intervalMs / 3_600_000)}h
              {s.autoBacktest.lastRunAt > 0
                ? ` · last ${new Date(s.autoBacktest.lastRunAt).toLocaleString()} · next ${new Date(s.autoBacktest.nextRunAt).toLocaleTimeString()}`
                : ` · first run scheduled shortly after boot`}
              · needs ≥{s.autoBacktest.minNewDigits.toLocaleString()} new ticks
            </span>
          </div>
        )}
      </div>
      <ConfigPicker selected={selected} onToggle={toggle} onToggleAll={toggleAll} />
      <div class="tl-note">Estimated payouts from recorded quote averages — not real Deriv prices.</div>
      {runs.length === 0 && !busy && <div class="empty-hint">No backtest runs yet — run one to see every config side by side.</div>}
      <LabCards runs={runs} equity={s.testEquity} kind="backtest" busy={busy} />
    </>
  );
}

function PaperTab({ busy, onBusy }: { busy: boolean; onBusy: (b: boolean) => void }): JSX.Element {
  const s = useStore();
  const [err, setErr] = useState('');
  const [selectedPaperTrade, setSelectedPaperTrade] = useState<PaperTrade | null>(null);
  const [paperDetailLoading, setPaperDetailLoading] = useState(false);
  const paperDetailRequest = useRef(0);
  const runs = s.testRuns.filter((r) => r.kind === 'paper').slice(0, 500);
  const owner = Boolean(s.owner);
  const paperSimulation = s.paperSimulation;
  const paperContract = paperSimulation?.openContract ?? paperSimulation?.lastSettled ?? null;
  const selectedMarket = s.markets.find((market) => market.symbol === paperContract?.market)
    ?? s.markets.find((market) => market.symbol === s.selected)
    ?? s.markets[0]
    ?? null;
  const scannerCandidate = s.displaySignal?.candidates.find((pick) => pick.market === selectedMarket?.symbol) ?? s.displaySignal?.candidates[0] ?? null;
  const candidate = paperContract
    ? { direction: paperContract.direction, barrier: paperContract.barrier, estWin: paperContract.estWin ?? 0 }
    : scannerCandidate;
  const paperStagePhase: PaperSimulationPhase = paperSimulation?.openContract
    ? 'open'
    : paperSimulation?.lastSettled && (paperSimulation.phase === 'completed' || paperSimulation.phase === 'stopped')
      ? 'settled'
      : paperSimulation?.phase === 'running'
        ? candidate
          ? 'signal-locked'
          : 'scanning'
        : candidate
          ? 'signal-locked'
          : s.feed?.connected
            ? 'scanning'
            : 'idle';
  const paperEquity = paperSimulation
    ? paperSimulation.equity
    : [];

  useEffect(() => {
    if (owner) void loadPaperTrades(300);
  }, [owner, paperSimulation?.totalTrades, paperSimulation?.openContract?.id]);

  const openPaperTrade = async (trade: PaperTrade) => {
    const request = ++paperDetailRequest.current;
    setSelectedPaperTrade(trade);
    setPaperDetailLoading(true);
    const detail = await loadPaperTrade(trade.contractRef);
    if (paperDetailRequest.current !== request) return;
    if (detail) setSelectedPaperTrade(detail);
    setPaperDetailLoading(false);
  };

  const portfolio: PaperPortfolio | null = s.paperPortfolio ?? (paperSimulation ? {
    initialBalance: paperSimulation.initialBalance,
    balance: paperSimulation.balance,
    availableBalance: paperSimulation.availableBalance,
    reservedStake: paperSimulation.reservedStake,
    netPnl: paperSimulation.netPnl,
    wins: paperSimulation.wins,
    losses: paperSimulation.losses,
    totalTrades: paperSimulation.totalTrades,
    openTrades: paperSimulation.openContract ? 1 : 0,
  } : null);

  const run = async () => {
    setErr('');
    onBusy(true);
    try {
      if (paperSimulation?.phase === 'running') await stopPaperSimulation();
      else await startPaperSimulation();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      onBusy(false);
    }
  };

  return (
    <>
      <LabControls
        busy={busy}
        disabled={!owner}
        onRun={run}
        runLabel={!owner ? 'Unlock dashboard to run simulation' : paperSimulation?.phase === 'running' ? 'Stop paper simulation' : 'Start paper simulation'}
      />
      <PaperSimulationStage
        market={selectedMarket}
        candidate={candidate}
        phase={paperStagePhase}
        equity={paperEquity}
        latestContract={paperSimulation?.lastSettled ?? null}
        virtualBalance={paperSimulation?.balance ?? null}
      />
      <PaperPortfolioStrip portfolio={portfolio} running={paperSimulation?.phase === 'running'} />
      <div class="paper-sim-summary">
        <span>Uses public market ticks and a virtual ledger. No Deriv balance, quote, or purchase request is used.</span>
        {paperSimulation && <span>{paperSimulation.totalTrades} virtual trades · {paperSimulation.wins}W {paperSimulation.losses}L</span>}
        <button
          class="paper-sim-reset"
          type="button"
          disabled={!owner || busy || paperSimulation?.phase === 'running'}
          onClick={() => {
            setErr('');
            onBusy(true);
            void resetPaperSimulation()
              .catch((error) => setErr(error instanceof Error ? error.message : String(error)))
              .finally(() => onBusy(false));
          }}
        >
          Reset virtual balance
        </button>
      </div>
      {!owner && <div class="tl-note">Simulation controls belong to the dashboard owner. You can still watch the public tick, signal, and virtual-contract stage above.</div>}
      <TlErr err={err} />
      <PaperTradeLedger trades={s.paperTrades} onOpen={openPaperTrade} />
      {runs.length === 0 && !busy && <div class="empty-hint">No global paper research runs have been recorded yet.</div>}
      <LabCards runs={runs} equity={s.testEquity} kind="paper" busy={busy} />
      {selectedPaperTrade && <PaperTradeDetailModal trade={selectedPaperTrade} loading={paperDetailLoading} onClose={() => { paperDetailRequest.current += 1; setSelectedPaperTrade(null); setPaperDetailLoading(false); }} />}
    </>
  );
}

function PaperPortfolioStrip({ portfolio, running }: { portfolio: PaperPortfolio | null; running: boolean }): JSX.Element {
  if (!portfolio) {
    return <div class="paper-portfolio paper-portfolio--empty"><span class="paper-portfolio-kicker">Virtual portfolio</span><span>Start the simulator to initialize virtual-only funds.</span></div>;
  }
  const pnlTone = portfolio.netPnl > 0 ? 'up' : portfolio.netPnl < 0 ? 'down' : undefined;
  const resolved = portfolio.wins + portfolio.losses;
  const winRate = resolved > 0 ? `${((portfolio.wins / resolved) * 100).toFixed(0)}%` : '--';
  return (
    <section class={`paper-portfolio${running ? ' running' : ''}`} aria-label="Virtual paper portfolio">
      <div class="paper-portfolio-title"><Icon name="stats" size={15} /><span>Virtual portfolio</span><small>{running ? 'LIVE' : 'PAUSED'}</small></div>
      <Metric label="Simulated balance" value={fmtMoney(portfolio.balance, '$')} />
      <Metric label="Net PnL" value={fmtSigned(portfolio.netPnl, '$')} tone={pnlTone} />
      <Metric label="Available" value={fmtMoney(portfolio.availableBalance, '$')} />
      <Metric label="Reserved" value={fmtMoney(portfolio.reservedStake, '$')} />
      <Metric label="Open" value={String(portfolio.openTrades)} />
      <Metric label="W / L" value={`${portfolio.wins} / ${portfolio.losses}${winRate === '--' ? '' : ` - ${winRate}`}`} />
    </section>
  );
}

function paperContractLabel(trade: PaperTrade): string {
  return `${trade.direction === 'under' ? 'Under' : 'Over'} ${trade.barrier}`;
}

function paperStatusLabel(status: PaperTrade['status']): string {
  return status === 'open' ? 'Open' : status === 'won' ? 'Won' : status === 'lost' ? 'Lost' : 'Cancelled';
}

function paperTradeTime(epoch: number | null): string {
  if (!epoch) return '--';
  const value = epoch < 100_000_000_000 ? epoch * 1000 : epoch;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '--' : date.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function PaperTradeLedger({ trades, onOpen }: { trades: PaperTrade[]; onOpen: (trade: PaperTrade) => void }): JSX.Element {
  return (
    <section class="section paper-contract-ledger">
      <div class="section-head">
        <div><div class="section-title">Virtual Contract Ledger</div><div class="paper-ledger-caption">One row per simulated contract. Research evidence only, never account activity.</div></div>
        <span class="ledger-count">{trades.length} contracts</span>
      </div>
      <div class="paper-contract-list">
        {trades.length === 0 && <div class="empty-hint">No virtual contracts recorded yet. Start the paper simulator to observe its first research trade.</div>}
        {trades.map((trade) => {
          const profit = trade.profit;
          const tone = trade.status === 'won' ? 'win' : trade.status === 'lost' || trade.status === 'cancelled' ? 'loss' : 'open';
          return (
            <button class={`paper-contract-row ${tone}`} type="button" onClick={() => void onOpen(trade)} key={trade.contractRef}>
              <span class={`paper-contract-mark ${tone}`}>{trade.status === 'open' ? 'P' : trade.status === 'won' ? 'W' : trade.status === 'lost' ? 'L' : 'C'}</span>
              <span class="paper-contract-main">
                <span class="paper-contract-line"><strong>{shortMarketName(trade.market)}</strong><span>{paperContractLabel(trade)}</span><span class="paper-contract-strategy">{trade.strategy || 'Scanner strategy'}</span></span>
                <span class="paper-contract-meta"><span>{paperStatusLabel(trade.status)}</span><span>{fmtMoney(trade.stake, '$')} virtual stake</span><span>{paperTradeTime(trade.entryEpoch)}</span></span>
              </span>
              <span class="paper-contract-potential"><small>Potential</small><strong>+{fmtMoney(Math.max(0, trade.payout - trade.stake), '$')}</strong><span>-{fmtMoney(trade.stake, '$')}</span></span>
              <span class={`paper-contract-pnl ${tone}`}>{profit == null ? 'Open' : fmtSigned(profit, '$')}<Icon name="arrowUpRight" size={14} /></span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function PaperTradeDetailModal({ trade, loading, onClose }: { trade: PaperTrade; loading: boolean; onClose: () => void }): JSX.Element {
  useEffect(() => {
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [onClose]);

  const potentialWin = Math.max(0, trade.payout - trade.stake);
  const settled = trade.profit != null;
  const strategy = trade.strategy || 'Scanner strategy';
  const fallbackLifecycle: Array<[string, string]> = [
    ['Signal read', trade.reason || 'Scanner context unavailable'],
    ['Virtual entry', `${paperTradeTime(trade.entryEpoch)}${trade.entryQuote != null ? ` at ${trade.entryQuote}` : ''}`],
    ['Virtual outcome', settled ? `${paperStatusLabel(trade.status)} ${fmtSigned(trade.profit ?? 0, '$')}` : 'Contract remains open'],
  ];
  const lifecycle: Array<[string, string]> = trade.lifecycle?.length
    ? trade.lifecycle.map((entry) => [
      entry.event.replaceAll('_', ' '),
      `${paperTradeTime(entry.ts)}${entry.status ? ` - ${entry.status}` : ''}${entry.profit != null ? ` ${fmtSigned(entry.profit, '$')}` : ''}${entry.reason ? ` - ${entry.reason}` : ''}`,
    ])
    : fallbackLifecycle;

  return (
    <div class="detail-backdrop" role="presentation" onClick={onClose}>
      <section class="activity-detail paper-trade-detail" role="dialog" aria-modal="true" aria-label="Virtual contract details" onClick={(event) => event.stopPropagation()}>
        <div class="detail-head">
          <div><span class="activity-source paper">Virtual paper</span><h2>{shortMarketName(trade.market)} - {paperContractLabel(trade)}</h2></div>
          <button class="detail-close" type="button" onClick={onClose} aria-label="Close virtual contract details"><Icon name="x" size={18} /></button>
        </div>
        <div class="paper-detail-outcome">
          <div><span>Virtual result</span><strong class={trade.status === 'won' ? 'won' : trade.status === 'lost' ? 'lost' : ''}>{settled ? fmtSigned(trade.profit ?? 0, '$') : 'Open'}</strong></div>
          <div><span>Potential win</span><strong class="won">+{fmtMoney(potentialWin, '$')}</strong></div>
          <div><span>Potential loss</span><strong class="lost">-{fmtMoney(trade.stake, '$')}</strong></div>
        </div>
        <div class="detail-grid">
          <Detail label="Virtual stake" value={fmtMoney(trade.stake, '$')} />
          <Detail label="Virtual payout" value={fmtMoney(trade.payout, '$')} />
          <Detail label="Forecast" value={trade.estimatedWin == null ? '--' : `${(trade.estimatedWin * 100).toFixed(1)}%`} />
          <Detail label="Model edge" value={trade.edge == null ? '--' : `${(trade.edge * 100).toFixed(1)}%`} />
          <Detail label="Entry" value={trade.entryQuote == null ? '--' : String(trade.entryQuote)} />
          <Detail label="Exit" value={trade.exitQuote == null ? '--' : String(trade.exitQuote)} />
        </div>
        <div class="paper-detail-section">
          <span class="paper-detail-label">Strategy snapshot</span>
          <strong>{strategy}</strong>
          <p>{trade.strategySnapshot || 'No additional scanner snapshot was stored for this virtual contract.'}</p>
        </div>
        <div class="paper-detail-section">
          <span class="paper-detail-label">Why and evidence</span>
          <strong>{trade.reason || 'Scanner decision detail unavailable'}</strong>
          <p>{trade.evidence || 'This record retains only the contract fields available at the time it was simulated.'}</p>
        </div>
        <div class="paper-detail-section paper-detail-lifecycle">
          <span class="paper-detail-label">Lifecycle</span>
          {lifecycle.map(([label, value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}
        </div>
        {loading && <div class="paper-detail-loading">Loading additional virtual research evidence...</div>}
      </section>
    </div>
  );
}

function CompareTab({ busy }: { busy: boolean }): JSX.Element {
  const s = useStore();
  const rows = ALL_CONFIG_KEYS.map((key) => {
    const bt = useLatestRun(s.testRuns, 'backtest', key);
    const pp = useLatestRun(s.testRuns, 'paper', key);
    return { key, bt, pp };
  });

  return (
    <>
      <div class="tl-note">
        A config only earns the <b>better</b> verdict when backtest and paper agree on direction — no cherry-picking a single method.
      </div>
      {s.testRuns.length === 0 && <div class="empty-hint">Run a backtest and a paper sweep to compare.</div>}
      <div class="cmp-head">
        <span>Config</span>
        <span>Backtest</span>
        <span>Paper</span>
        <span>Verdict</span>
      </div>
      <div class="cmp-grid">
        {rows.map(({ key, bt, pp }) => {
          const [strategy, mode] = key.split('-');
          const btSigned = bt && bt.trades > 0;
          const ppSigned = pp && pp.trades > 0;
          let verdict: { text: string; tone: string } | null = null;
          if (btSigned && ppSigned) {
            const agree = (bt!.net_pnl >= 0) === (pp!.net_pnl >= 0) && bt!.net_pnl !== 0 && pp!.net_pnl !== 0;
            if (agree) {
              const winner = bt!.net_pnl >= 0 ? 'gains' : 'draws down';
              verdict = { text: `Agree · ${winner}`, tone: 'agree' };
            } else {
              verdict = { text: 'Disagree · needs more data', tone: 'disagree' };
            }
          } else if (btSigned && !ppSigned) {
            verdict = { text: 'Backtest only', tone: 'partial' };
          } else if (!btSigned && ppSigned) {
            verdict = { text: 'Paper only', tone: 'partial' };
          } else {
            verdict = null;
          }
          return (
            <div class="cmp-row" key={key}>
              <span class="cmp-config">
                <span class="cmp-strategy">{STRATEGY_META[strategy as Settings['strategy_mode']].label}</span>
                <span class="cmp-mode">{MODE_META[mode as Settings['bot_mode']].label}</span>
              </span>
              <span class={`cmp-num${btSigned ? (bt!.net_pnl >= 0 ? ' up' : ' down') : ''}`}>
                {btSigned ? fmtSigned(bt!.net_pnl, '$') : '—'}
                {btSigned && <span class="cmp-sub">{bt!.trades} trades · {bt!.win_rate?.toFixed(0) ?? '—'}%</span>}
              </span>
              <span class={`cmp-num${ppSigned ? (pp!.net_pnl >= 0 ? ' up' : ' down') : ''}`}>
                {ppSigned ? fmtSigned(pp!.net_pnl, '$') : '—'}
                {ppSigned && <span class="cmp-sub">{pp!.trades} trades · {pp!.win_rate?.toFixed(0) ?? '—'}%</span>}
              </span>
              <span class={`cmp-verdict ${verdict?.tone ?? 'na'}`}>{verdict ? verdict.text : '—'}</span>
            </div>
          );
        })}
      </div>
      {busy && <div class="empty-hint">Running…</div>}
    </>
  );
}

function PatternsTab({ busy }: { busy: boolean }): JSX.Element {
  const s = useStore();
  const data = s.patterns;
  const patterns = data?.patterns ?? [];
  const cal = data?.calibration;
  const [scanBusy, setScanBusy] = useState(false);
  const guest = !s.session;

  const scan = async () => {
    setScanBusy(true);
    try {
      await runPatternScan();
    } finally {
      setScanBusy(false);
    }
  };

  const bars = [...patterns]
    .sort((a, b) => Math.abs(b.lift - 1) - Math.abs(a.lift - 1))
    .slice(0, 18);

  return (
    <>
      <div class="tl-controls">
        <div class="tl-note">
          Confirmed transitions need ≥120 samples in the market's history and lift ≥1.30 (over) or ≤0.77 (under) in both the last 2k and 5k ticks.
        </div>
        <button class={`tl-run${scanBusy ? ' busy' : ''}`} disabled={scanBusy || guest} onClick={scan}>
          {scanBusy ? 'Scanning…' : 'Scan pattern-lift'}
        </button>
      </div>
      <LabActive active={s.testlab?.kind === 'patterns' ? s.testlab : null} />
      {patterns.length === 0 && !scanBusy && <div class="empty-hint">No confirmed transitions yet — scan the digit history.</div>}
      {bars.length > 0 && (
        <div class="section">
          <div class="section-head">
            <span class="section-title">{bars.length} strongest transitions</span>
          </div>
          <div class="pat-list">
            {bars.map((p) => {
              const over = p.lift >= 1.3;
              const width = Math.min(100, Math.abs(p.lift - 1) * 100 * 2.2);
              return (
                <div class="pat-row" key={`${p.market}-${p.prev_digit}-${p.next_digit}`}>
                  <span class={`pat-dir ${over ? 'over' : 'under'}`}>{over ? 'O' : 'U'}</span>
                  <span class="pat-label">
                    {shortMarketName(p.market)} · {p.prev_digit}→{p.next_digit}
                  </span>
                  <span class={`pat-pct${over ? ' over' : ' under'}`}>
                    {over ? '+' : ''}
                    {((p.lift - 1) * 100).toFixed(0)}%
                  </span>
                  <div class="bar-track pat-track">
                    <div class={`bar-fill ${over ? 'over' : 'under'}`} style={{ width: `${width}%` }}></div>
                  </div>
                  <span class="pat-n">n={p.count}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
      {cal && cal.buckets.length > 0 && (
        <div class="section">
          <div class="section-head">
            <span class="section-title">Scanner calibration {cal.total > 0 ? `· ${cal.total} settled` : ''}</span>
          </div>
          {cal.buckets.map((b) => (
            <Bar key={b.bucket} label={`est ${b.bucket}`} rate={((b.rate ?? 0) * 100)} count={b.n} tone={b.rate != null && b.rate >= (b.lo + b.hi) / 2 ? 'over' : 'under'} />
          ))}
        </div>
      )}
      {cal && cal.byStrategy.length > 0 && (
        <div class="section">
          <div class="section-head">
            <span class="section-title">Actual win rate by config</span>
          </div>
          {cal.byStrategy.slice(0, 12).map((r) => (
            <div class="pat-row" key={`${r.kind}-${r.strategy}-${r.mode}`}>
              <span class={`pat-dir ${r.kind === 'paper' ? 'under' : 'over'}`}>{r.kind === 'paper' ? 'P' : 'B'}</span>
              <span class="pat-label">{STRATEGY_META[r.strategy as Settings['strategy_mode']]?.label ?? r.strategy} · {MODE_META[r.mode as Settings['bot_mode']]?.label ?? r.mode}</span>
              <span class={`pat-pct${r.win_rate != null && r.win_rate >= 35 ? ' over' : ''}`}>
                {r.win_rate != null ? `${r.win_rate.toFixed(1)}%` : '—'}
              </span>
              <div class="bar-track pat-track">
                <div class={`bar-fill ${r.win_rate != null && r.win_rate >= 35 ? 'over' : 'under'}`} style={{ width: `${Math.min(100, r.win_rate ?? 0)}%` }}></div>
              </div>
              <span class="pat-n">{r.trades} tr</span>
            </div>
          ))}
        </div>
      )}
      {busy && <div class="empty-hint">Waiting…</div>}
    </>
  );
}

function TestLabPage(): JSX.Element {
  const s = useStore();
  const [tab, setTab] = useState<LabTab>('backtest');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void loadTestRuns();
  }, []);
  useEffect(() => {
    if (tab === 'patterns') void loadPatternsData();
  }, [tab]);

  return (
    <>
      <header class="header">
        <div class="page-title">Test Lab</div>
        <div class="subtitle">Backtest the replay · sweep the demo · retain research evidence</div>
      </header>
      <div class="seg tl-tabs">
        {(['backtest', 'paper', 'compare', 'patterns'] as LabTab[]).map((t) => (
          <button
            class={`seg-btn${tab === t ? ' active' : ''}`}
            onClick={() => setTab(t)}
            key={t}
          >
            {t[0].toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>
      {tab === 'backtest' && <BacktestTab busy={busy} onBusy={setBusy} />}
      {tab === 'paper' && <PaperTab busy={busy} onBusy={setBusy} />}
      {tab === 'compare' && <CompareTab busy={busy} />}
      {tab === 'patterns' && <PatternsTab busy={busy} />}
    </>
  );
}

/* ---------------- account ---------------- */

function AccountPage(): JSX.Element {
  const s = useStore();
  const session = s.session;
  const [accounts, setAccounts] = useState<DerivAccountInfo[]>([]);
  const [loadingAccounts, setLoadingAccounts] = useState(false);
  const [switchingAccount, setSwitchingAccount] = useState('');
  const [accountError, setAccountError] = useState('');
  useEffect(() => {
    if (!session) return;
    setLoadingAccounts(true);
    setAccountError('');
    void loadDerivAccounts()
      .then(setAccounts)
      .catch((error) => setAccountError(error instanceof Error ? error.message : String(error)))
      .finally(() => setLoadingAccounts(false));
  }, [session?.loginid]);
  if (!session) return <ConnectView embedded />;
  const switchAccount = async (account: DerivAccountInfo): Promise<void> => {
    setAccountError('');
    setSwitchingAccount(account.accountId);
    try {
      await switchDerivAccount(account.accountId);
    } catch (error) {
      setAccountError(error instanceof Error ? error.message : String(error));
    } finally {
      setSwitchingAccount('');
    }
  };
  return (
    <>
      <header class="header">
        <div class="page-title">Account</div>
      </header>
      <div class="section">
        <div class="detail-row">
          <span class="detail-label">Login ID</span>
          <span class="detail-value">{session?.loginid ?? '—'}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Balance</span>
          <span class="detail-value">{fmtMoney(session?.balance ?? 0, session?.currency)}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Currency</span>
          <span class="detail-value">{session?.currency ?? '—'}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Mode</span>
          <span class="detail-value">{session?.mode === 'demo' ? 'Demo' : 'Real'}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Connection</span>
          <span class={`detail-value${s.feed?.connected ? ' green' : ' red'}`}>
            {s.feed?.connected ? 'Connected' : 'Disconnected'}
          </span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Bot</span>
          <span class={`detail-value${s.automation?.running ? ' green' : ' red'}`}>
            {s.automation?.running ? 'Running' : 'Stopped'}
          </span>
        </div>
      </div>
      <div class="account-switcher">
        <div class="account-switcher-head">
          <div><span class="detail-label">Trading account</span><h3>Choose demo or real</h3></div>
          {loadingAccounts && <span class="account-loading">Loading…</span>}
        </div>
        <p class="account-switcher-copy">The header + opens this account manager. Switching is blocked while a contract is open. A selected real account is clearly marked and trades immediately through the same risk gates as demo.</p>
        <div class="account-options">
          {accounts.map((account) => {
            const current = account.accountId === session.loginid;
            return (
              <div class={`account-option ${account.mode}${current ? ' current' : ''}`} key={account.accountId}>
                <div class="account-option-main">
                  <span class={`account-mode ${account.mode}`}>{account.mode === 'real' ? 'Real money' : 'Demo'}</span>
                  <strong>{account.accountId}</strong>
                  <span>{fmtMoney(account.balance, account.currency || session.currency)}</span>
                </div>
                {current ? <span class="account-current">Current</span> : (
                  <button class={account.mode === 'real' ? 'danger' : ''} type="button" disabled={!!switchingAccount} onClick={() => void switchAccount(account)}>
                    {switchingAccount === account.accountId ? 'Switching…' : `Use ${account.mode}`}
                  </button>
                )}
              </div>
            );
          })}
        </div>
        {!loadingAccounts && accounts.length === 0 && !accountError && <div class="account-empty">No additional Deriv accounts are available for this login.</div>}
        {accountError && <div class="connect-err">{accountError}</div>}
      </div>
      <button class="logout-btn" onClick={() => void logout()}>
        <Icon name="logout" size={15} strokeWidth={1.8} />
        Disconnect
      </button>
    </>
  );
}

type GoldTab = 'research' | 'trade';

function GoldPage(): JSX.Element {
  const store = useStore();
  const [tab, setTab] = useState<GoldTab>('trade');

  useEffect(() => {
    void loadGoldState();
    void refreshTrades();
    if (store.owner) void loadLedgerEntries(80);
    const refresh = window.setInterval(() => { void loadGoldState(); }, 1_000);
    return () => window.clearInterval(refresh);
  }, [store.owner]);

  return <section class="gold-page" aria-label="Gold workspace">
    <header class="header gold-page-header">
      <div>
        <img class="gold-brand-logo" src="/gold-logo.png" alt="Gold" />
        <div class="subtitle">Active market watch · Deriv Gold demo contracts · demo-first safeguards</div>
      </div>
      <div class="gold-tabs" role="tablist" aria-label="Gold workspace modes">
        <button class={tab === 'research' ? 'active' : ''} type="button" role="tab" aria-selected={tab === 'research'} onClick={() => setTab('research')}>Research</button>
        <button class={tab === 'trade' ? 'active' : ''} type="button" role="tab" aria-selected={tab === 'trade'} onClick={() => setTab('trade')}>Trade</button>
      </div>
    </header>

    <div class="gold-workspace">
      {tab === 'research'
        ? <GoldResearchWorkspace
          state={store.gold}
          settings={store.settings}
          automation={store.automation}
          owner={store.owner === true}
        />
        : <GoldDerivTradeWorkspace
          state={store.gold}
          session={store.session}
          trades={store.trades}
          ledgerEntries={store.ledgerEntries}
          automation={store.automation}
          settings={store.settings}
          contract={store.contract}
          owner={store.owner === true}
        />}
    </div>
  </section>;
}

function parseOptionalGoldPrice(value: string): number | null | undefined {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function goldPrice(value: number | null | undefined, digits = 2): string {
  if (!Number.isFinite(value)) return '—';
  return Number(value).toLocaleString(undefined, { minimumFractionDigits: Math.min(2, digits), maximumFractionDigits: Math.max(2, digits) });
}

function UnusedGoldDerivTradeWorkspace({
  state,
  session,
  trades,
  contract,
  owner,
  onOpenConnection,
}: {
  state: GoldModuleState | null;
  session: ReturnType<typeof useStore>['session'];
  trades: TradeRow[];
  contract: ContractEvt | null;
  owner: boolean;
  onOpenConnection: () => void;
}): JSX.Element {
  const diagnostics = state?.diagnostics ?? null;
  const deriv = state?.deriv ?? null;
  const research = state?.research.state ?? null;
  const symbol = research?.symbol ?? null;
  const quote = research?.quote ?? null;
  const signal = research?.signal ?? null;
  const sideFromSignal: GoldSide | null = signal?.direction === 'BUY' || signal?.direction === 'SELL' ? signal.direction : null;
  const candles = research?.candles?.[research.timeframe ?? '5m'] ?? [];
  const digits = Math.max(2, Math.min(5, symbol?.digits ?? 2));
  const [side, setSide] = useState<GoldSide>(sideFromSignal ?? 'BUY');
  const [stakeText, setStakeText] = useState('1');
  const [multiplierText, setMultiplierText] = useState(String(deriv?.defaultMultiplier ?? 20));
  const [tpText, setTpText] = useState('');
  const [slText, setSlText] = useState('');
  const [purchase, setPurchase] = useState<GoldDerivTradePurchase | null>(null);
  const [closed, setClosed] = useState<GoldDerivTradeClose | null>(null);
  const [busy, setBusy] = useState(false);
  const [closing, setClosing] = useState(false);
  const [error, setError] = useState('');
  const stake = Number(stakeText);
  const selectedMultiplier = Number(multiplierText);
  const takeProfit = parseOptionalGoldPrice(tpText);
  const stopLoss = parseOptionalGoldPrice(slText);
  const validLimits = takeProfit !== undefined && stopLoss !== undefined;
  const marketReady = state?.research.ready === true;
  const isDemo = session?.mode === 'demo';
  const openAccountTrade = trades.find((item) => isMultiplierTrade(item) && (item.status === 'pending' || item.status === 'purchasing')) ?? null;
  const openGoldTrade = trades.find((item) =>
    (item.contract_type === 'MULTUP' || item.contract_type === 'MULTDOWN')
    && /gold deriv manual/i.test(item.reason ?? '')
    && (item.status === 'pending' || item.status === 'purchasing')
  ) ?? null;
  const lastGoldTrade = trades.find((item) =>
    (item.contract_type === 'MULTUP' || item.contract_type === 'MULTDOWN')
    && /gold deriv manual/i.test(item.reason ?? '')
    && item.status !== 'pending'
    && item.status !== 'purchasing'
  ) ?? null;
  const canOpen = owner && marketReady && isDemo && Boolean(sideFromSignal) && !openAccountTrade
    && Number.isFinite(stake) && stake > 0 && Number.isFinite(selectedMultiplier) && selectedMultiplier > 0 && validLimits;
  const canClose = owner && isDemo && Boolean(openGoldTrade?.contract_id) && !closing;
  const trackedContractId = purchase?.contractId ?? purchase?.contract_id ?? closed?.contractId ?? openGoldTrade?.contract_id ?? lastGoldTrade?.contract_id ?? '';
  const matchingContract = trackedContractId && contract?.contractId === trackedContractId ? contract : null;
  const settledTrade = lastGoldTrade && trackedContractId === lastGoldTrade.contract_id ? lastGoldTrade : null;
  const liveContractProfit = Number.isFinite(Number(matchingContract?.profit)) ? Number(matchingContract?.profit) : undefined;
  const contractPnl = settledTrade?.profit ?? closed?.profit ?? liveContractProfit ?? purchase?.pnl ?? purchase?.profit ?? null;
  const liveSellPrice = Number.isFinite(Number(matchingContract?.sellPrice ?? matchingContract?.update?.sellPrice))
    ? Number(matchingContract?.sellPrice ?? matchingContract?.update?.sellPrice)
    : undefined;
  const hasActiveTradeEntry = Boolean(openGoldTrade || (purchase && !closed && !settledTrade));
  const actualEntryPrice = Number.isFinite(Number(openGoldTrade?.entry_spot)) && Number(openGoldTrade?.entry_spot) > 0
    ? Number(openGoldTrade?.entry_spot)
    : Number.isFinite(Number(purchase?.entryPrice)) && Number(purchase?.entryPrice) > 0
      ? Number(purchase?.entryPrice)
      : undefined;
  const entryPrice = hasActiveTradeEntry ? actualEntryPrice ?? signal?.entryReference ?? quote?.mid ?? null : null;
  const chartSide: GoldSide = openGoldTrade?.contract_type === 'MULTDOWN' ? 'SELL' : openGoldTrade?.contract_type === 'MULTUP' ? 'BUY' : sideFromSignal ?? side;
  const chartStopLoss = null;
  const chartTakeProfit = null;
  const quoteAge = quote ? Math.max(0, Date.now() - quote.receivedAt) : null;
  const spreadText = quote ? goldPrice(quote.spread, digits) : '—';
  const readinessReason = state?.research.reason ?? diagnostics?.reason ?? 'Gold state has not loaded yet.';
  const contractPhase = settledTrade
    ? `Contract ${settledTrade.status}`
    : matchingContract?.result
      ? `Contract ${matchingContract.result}`
      : matchingContract?.phase
        ? `Contract ${matchingContract.phase}`
        : closed
          ? 'Contract closed'
          : openGoldTrade
            ? `Contract ${openGoldTrade.status}`
            : purchase
              ? 'Demo contract submitted'
              : 'No open demo contract';
  const potentialProfit = closed?.profit ?? (purchase?.payout != null && purchase.ask != null ? purchase.payout - purchase.ask : null);
  const actionNote = busy
    ? 'Sending Gold demo order'
    : closing
      ? 'Closing Gold demo contract'
      : !owner
        ? 'Unlock dashboard owner controls'
        : !session
          ? 'Connect Deriv first'
          : !isDemo
            ? 'Switch to Deriv demo'
            : !marketReady
              ? readinessReason
              : openAccountTrade
                ? `Waiting for contract ${openAccountTrade.contract_id || openAccountTrade.id} to settle`
                : !(Number.isFinite(stake) && stake > 0)
                  ? 'Enter a positive demo stake'
                  : !(Number.isFinite(selectedMultiplier) && selectedMultiplier > 0)
                    ? 'Select a valid multiplier'
                    : !validLimits
                      ? 'TP profit and stop loss must be positive when set'
                      : sideFromSignal
                        ? `${sideFromSignal} is the current Deriv Gold side`
                        : 'No validated Gold direction yet';

  useEffect(() => {
    if (sideFromSignal) setSide(sideFromSignal);
  }, [sideFromSignal]);

  useEffect(() => {
    if (deriv?.defaultMultiplier) setMultiplierText(String(deriv.defaultMultiplier));
  }, [deriv?.defaultMultiplier]);

  useEffect(() => {
    setPurchase(null);
    setClosed(null);
    setError('');
  }, [symbol?.id, side, stakeText, multiplierText, tpText, slText]);

  const open = async (nextSide: GoldSide) => {
    if (!owner || !session || !isDemo) {
      setError('Connect or switch to a Deriv demo account before placing a Gold trade.');
      return;
    }
    if (!canOpen) return;
    if (sideFromSignal && nextSide !== sideFromSignal) {
      setSide(sideFromSignal);
      setError(`Gold research recommends ${sideFromSignal}; the opposite side is disabled.`);
      return;
    }
    setBusy(true);
    setError('');
    setSide(nextSide);
    try {
      setPurchase(await placeGoldDerivTrade({
        side: nextSide,
        stake,
        multiplier: selectedMultiplier,
        stopLoss: stopLoss ?? null,
        takeProfit: takeProfit ?? null,
      }));
      await loadGoldState();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const close = async () => {
    if (!canClose) return;
    setClosing(true);
    setError('');
    try {
      setClosed(await closeGoldDerivTrade());
      setPurchase(null);
      await refreshTrades();
      await loadGoldState();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setClosing(false);
    }
  };

  const unavailableReason = !session
    ? 'Connect a Deriv demo account to request a live Gold contract.'
    : !isDemo
      ? 'Gold execution is available on Deriv demo accounts only. Switch to demo to continue.'
      : !owner
        ? 'Unlock the dashboard owner controls to place a demo trade.'
        : openAccountTrade && !openGoldTrade
          ? `Wait for open contract ${openAccountTrade.contract_id || openAccountTrade.id} to settle before placing a Gold trade.`
          : null;

  return <>
    <section class="gold-trade-desk" aria-label="Gold active trade desk">
      <div class="gold-trade-head">
        <div>
          <span class="gold-kicker">Gold trade</span>
          <strong>{symbol?.displayName || diagnostics?.symbol || 'Gold market'}</strong>
          <small>{marketReady ? `${research?.timeframe ?? '5m'} watch · Deriv demo multiplier enabled` : readinessReason}</small>
        </div>
        <div class="gold-trade-badges">
          <span class={`gold-trade-suggestion ${(sideFromSignal ?? 'WAIT').toLowerCase()}`}>
            <Icon name={sideFromSignal === 'SELL' ? 'arrowDown' : sideFromSignal === 'BUY' ? 'arrowUp' : 'history'} size={13} />
            <span>Suggested side</span>
            <strong>{sideFromSignal ? `${sideFromSignal} - ${signal?.confidence ?? 0}%` : 'WAIT'}</strong>
          </span>
          <button class="gold-link-button" type="button" onClick={onOpenConnection}>Connection</button>
        </div>
      </div>

      <div class="gold-trade-live">
        <div class="gold-trade-chart-wrap">
          <GoldTradeChart
            candles={candles}
            quote={quote}
            label={`${symbol?.displayName || 'Gold'} active trade chart`}
            entryPrice={entryPrice}
            side={chartSide}
            stopLoss={chartStopLoss}
            takeProfit={chartTakeProfit}
          />
        </div>
        <div class="gold-trade-readout">
          <span>Demo balance</span>
          <strong>{isDemo && session ? fmtMoney(session.balance, session.currency) : '—'}</strong>
          <small>{contractPhase}</small>
        </div>
        <div class={`gold-trade-readout ${contractPnl == null ? '' : contractPnl >= 0 ? 'up' : 'down'}`}>
          <span>Live contract P&amp;L</span>
          <strong>{contractPnl == null ? '—' : fmtSigned(contractPnl, purchase?.currency ?? session?.currency ?? 'USD')}</strong>
          <small>{closed?.soldFor != null ? `Sold ${fmtMoney(closed.soldFor, purchase?.currency ?? session?.currency ?? 'USD')}` : liveSellPrice == null ? trackedContractId || 'Awaiting a demo order' : `Sell ${fmtMoney(liveSellPrice, purchase?.currency ?? session?.currency ?? 'USD')}`}</small>
        </div>
      </div>

      <div class="gold-trade-order">
        <div class="gold-trade-direction" aria-label="Place a Gold demo trade">
          <button class={`buy ${side === 'BUY' ? 'active' : ''}${sideFromSignal === 'BUY' ? ' suggested' : ''}`} type="button" disabled={!canOpen || sideFromSignal !== 'BUY' || busy} onClick={() => void open('BUY')}><Icon name="arrowUp" size={15} />{busy && side === 'BUY' ? 'Opening' : 'Buy'}</button>
          <button class={`sell ${side === 'SELL' ? 'active' : ''}${sideFromSignal === 'SELL' ? ' suggested' : ''}`} type="button" disabled={!canOpen || sideFromSignal !== 'SELL' || busy} onClick={() => void open('SELL')}><Icon name="arrowDown" size={15} />{busy && side === 'SELL' ? 'Opening' : 'Sell'}</button>
        </div>
        <label class="gold-trade-field"><span>Demo stake</span><input type="number" inputMode="decimal" min="0.35" step="0.01" value={stakeText} disabled={busy || Boolean(openAccountTrade)} onInput={(event) => setStakeText((event.currentTarget as HTMLInputElement).value)} /></label>
        <label class="gold-trade-field"><span>Multiplier</span><select value={multiplierText} disabled={busy || Boolean(openAccountTrade)} onChange={(event) => setMultiplierText((event.currentTarget as HTMLSelectElement).value)}><option value="10">x10</option><option value="20">x20</option><option value="30">x30</option><option value="50">x50</option><option value="100">x100</option><option value="200">x200</option><option value="500">x500</option></select></label>
        <label class="gold-trade-field"><span>TP profit</span><input type="number" inputMode="decimal" min="0.01" step="0.01" placeholder="optional" value={tpText} disabled={busy || Boolean(openAccountTrade)} onInput={(event) => setTpText((event.currentTarget as HTMLInputElement).value)} /></label>
        <label class="gold-trade-field"><span>Stop loss</span><input type="number" inputMode="decimal" min="0.01" step="0.01" placeholder="optional" value={slText} disabled={busy || Boolean(openAccountTrade)} onInput={(event) => setSlText((event.currentTarget as HTMLInputElement).value)} /></label>
        <div class="gold-trade-quote">
          <span>{purchase ? 'Last order potential' : 'Gold quote'}</span>
          <strong>{potentialProfit == null ? quote ? `${goldPrice(quote.bid, digits)} / ${goldPrice(quote.ask, digits)}` : '—' : fmtSigned(potentialProfit, session?.currency ?? 'USD')}</strong>
          <small>Spread {spreadText}{quoteAge == null ? '' : ` · ${Math.round(quoteAge / 1000)}s ago`}</small>
        </div>
        <span class="gold-trade-action-note">{actionNote}</span>
        {openGoldTrade && <button class="gold-trade-close" type="button" disabled={!canClose} onClick={() => void close()}>{closing ? 'Closing' : 'Close trade'}</button>}
      </div>

      {signal && <div class="gold-trade-note">{signal.reasons.length ? signal.reasons.join(' · ') : signal.blockers.join(' · ') || 'Gold research is waiting for stronger evidence.'}</div>}
      {unavailableReason && <div class="gold-trade-note">{unavailableReason}</div>}
      {(purchase || openGoldTrade) && <div class="gold-trade-note">Deriv Gold demo contract {trackedContractId || 'submitted'} is tracked against this account balance.</div>}
      {error && <div class="tl-err">{error}</div>}
    </section>

    <section class="gold-facts" aria-label="Gold active trade safeguards">
      <div><span>Market data</span><strong>{state?.research.ready ? 'Validated' : 'Waiting'}</strong><small>{state?.research.reason ?? 'Live quote accepted'}</small></div>
      <div><span>Demo trading</span><strong>{isDemo ? 'Ready' : 'Locked'}</strong><small>{isDemo ? 'Deriv demo session connected' : 'Switch/connect Deriv demo'}</small></div>
      <div><span>Execution adapter</span><strong>{diagnostics?.executionCapable ? 'Deriv multipliers' : 'Checking'}</strong><small>MT5/cTrader CFD orders are not used</small></div>
      <div><span>Account lock</span><strong>{openAccountTrade ? 'Open contract' : 'Clear'}</strong><small>{openAccountTrade ? `Contract ${openAccountTrade.contract_id || openAccountTrade.id}` : 'One account contract at a time'}</small></div>
    </section>
  </>;
}

function UnusedGoldDerivConnectionOnboarding({ state, session, owner }: { state: GoldModuleState | null; session: ReturnType<typeof useStore>['session']; owner: boolean }): JSX.Element {
  const diagnostics = state?.diagnostics ?? null;
  const marketReady = state?.research.ready === true;
  const isDemo = session?.mode === 'demo';
  const status = isDemo ? 'Deriv demo connected' : session ? 'Real account connected' : 'Deriv demo required';
  const detail = isDemo
    ? `Gold demo contracts will use ${session.loginid}.`
    : session
      ? 'Gold trading is locked on real accounts. Switch to a Deriv demo account.'
      : 'Connect Deriv from the Account page, then choose a demo account.';
  const steps: Array<{ label: string; detail: string; complete: boolean; active?: boolean }> = [
    {
      label: 'Deriv session',
      detail: session ? 'Deriv OAuth/session is connected.' : 'Connect Deriv using the main account flow.',
      complete: Boolean(session),
      active: !session,
    },
    {
      label: 'Demo account',
      detail: isDemo ? 'The active account is demo.' : 'Switch away from live before Gold execution is enabled.',
      complete: isDemo,
      active: Boolean(session) && !isDemo,
    },
    {
      label: 'Gold market data',
      detail: marketReady ? 'Deriv Gold feed is streaming into the trade chart.' : diagnostics?.reason ?? 'Waiting for Deriv Gold market data.',
      complete: marketReady,
      active: isDemo && !marketReady,
    },
  ];

  return <section class="gold-connection" aria-label="Deriv Gold account onboarding">
    <div class="gold-connection-intro">
      <div>
        <span class="gold-kicker">Deriv account connection</span>
        <h2>{isDemo ? 'Deriv demo ready for Gold' : session ? 'Switch to Deriv demo' : 'Connect Deriv demo access'}</h2>
        <p>Gold now uses Deriv API multiplier contracts when they are available for the active Gold symbol. MT5 and cTrader CFD accounts are not used by this route.</p>
      </div>
      <div class={`gold-connection-state${isDemo ? ' is-connected' : ''}`} role="status" aria-live="polite">
        <span>Connection status</span>
        <strong>{status}</strong>
        <small>{detail}</small>
      </div>
    </div>

    <div class="gold-connection-body">
      <div class="gold-onboard-steps" aria-label="Connection steps">
        {steps.map((step, index) => <div class={`gold-onboard-step${step.complete ? ' complete' : ''}${step.active ? ' active' : ''}`} key={step.label}>
          <span class="gold-step-number">{step.complete ? <Icon name="check" size={13} strokeWidth={2.3} /> : index + 1}</span>
          <div><strong>{step.label}</strong><small>{step.detail}</small></div>
        </div>)}
      </div>

      <aside class="gold-auth-action" aria-label="Deriv Gold account action">
        {isDemo ? <>
          <span class="gold-kicker">Demo-first authorization</span>
          <strong>Gold can use this Deriv demo account</strong>
          <small>Orders stay locked to demo, use Deriv multiplier contracts, and remain subject to the shared one-open-contract account guard.</small>
        </> : session ? <>
          <span class="gold-kicker">Demo-only protection</span>
          <strong>Real account blocked</strong>
          <small>Open the Account page and switch to a Deriv demo account before using Gold execution.</small>
          <button class="gold-connect-button" type="button" onClick={() => { window.location.href = '/account'; }}>
            <Icon name="arrowUpRight" size={15} strokeWidth={2} /> Switch account
          </button>
        </> : <>
          <span class="gold-kicker">Deriv OAuth</span>
          <strong>Connect Deriv first</strong>
          <small>Use the existing Deriv connection. No MT5 password, cTrader secret, or broker token is entered on the Gold page.</small>
          <button class="gold-connect-button" type="button" disabled={!owner} onClick={() => { window.location.href = '/account'; }}>
            <Icon name="arrowUpRight" size={15} strokeWidth={2} /> Open account page
          </button>
        </>}
      </aside>
    </div>

    {!marketReady && <section class="gold-config-guide" aria-label="Gold market data status">
      <div><span class="gold-kicker">Before users can trade</span><strong>Deriv Gold contract availability is checked server-side</strong><small>If the active account or region does not expose Gold multipliers, the order route rejects before purchase.</small></div>
      <div class="gold-config-list">
        {['DERIV_DEMO_SESSION', diagnostics?.symbol ?? 'XAUUSD', diagnostics?.status ?? 'market_data_connecting'].map((setting) => <span key={setting}>{setting}</span>)}
      </div>
    </section>}

    <section class="gold-connection-facts" aria-label="Connection safeguards">
      <div><span>Provider</span><strong>Deriv API</strong></div>
      <div><span>Account path</span><strong>Demo only</strong></div>
      <div><span>Product</span><strong>Gold multipliers</strong></div>
      <div><span>MT5/cTrader</span><strong>Not used</strong></div>
    </section>
  </section>;
}

function unusedGoldDerivIsOpenTrade(row: TradeRow | null | undefined): boolean {
  return Boolean(row && (row.status === 'pending' || row.status === 'purchasing'));
}

function unusedGoldDerivIsGoldTrade(row: TradeRow | null | undefined): boolean {
  return Boolean(row && (row.contract_type === 'MULTUP' || row.contract_type === 'MULTDOWN') && /gold deriv manual/i.test(row.reason ?? ''));
}

function GoldLedgerRow({ entry, currency }: { entry: LedgerEntry; currency: string }): JSX.Element {
  const side = entry.contract_type === 'MULTDOWN' ? 'SELL' : 'BUY';
  const date = new Date(entry.ts < 100_000_000_000 ? entry.ts * 1000 : entry.ts);
  const time = Number.isNaN(date.getTime()) ? '' : date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const settled = entry.event === 'settled';
  const profit = Number(entry.profit ?? 0);
  const tone = settled ? profit > 0 ? 'up' : profit < 0 ? 'down' : '' : '';
  return <div class={`gold-ledger-row ${tone}`}>
    <span>{side}</span>
    <b>{LEDGER_EVENT_LABEL[entry.event] ?? entry.event}</b>
    <small>{entry.contract_ref || entry.market}{time ? ` - ${time}` : ''}</small>
    <strong>{settled ? fmtSigned(profit, currency) : fmtMoney(entry.stake, currency)}</strong>
  </div>;
}

function GoldResearchWorkspace({
  state,
  settings,
  automation,
  owner,
}: {
  state: GoldModuleState | null;
  settings: Settings | null;
  automation: AutomationState | null;
  owner: boolean;
}): JSX.Element {
  const diagnostics = state?.diagnostics ?? null;
  const deriv = state?.deriv ?? null;
  const research = state?.research.state ?? null;
  const symbol = research?.symbol ?? null;
  const quote = research?.quote ?? null;
  const signal = research?.signal ?? null;
  const sideFromSignal: GoldSide | null = signal?.direction === 'BUY' || signal?.direction === 'SELL' ? signal.direction : null;
  const [chartTimeframe, setChartTimeframe] = useState<Extract<GoldTimeframe, '1m' | '5m'>>('1m');
  const [backtestBusy, setBacktestBusy] = useState(false);
  const [error, setError] = useState('');
  const candles = research?.candles?.[chartTimeframe] ?? [];
  const digits = Math.max(2, Math.min(5, symbol?.digits ?? 2));
  const marketClosed = symbol?.tradingStatus === 'closed' || symbol?.tradingStatus === 'suspended' || symbol?.tradingStatus === 'unavailable';
  const quoteAge = quote ? Math.max(0, Date.now() - quote.receivedAt) : null;
  const backtest = state?.backtest.result;
  const recentSignals = research?.recentSignals ?? [];
  const paper = state?.paper.state;
  const paperTrades = paper?.closedTrades ?? [];
  const paperWins = paperTrades.filter((trade) => trade.netPnl > 0).length;
  const paperLosses = paperTrades.filter((trade) => trade.netPnl < 0).length;
  const paperWinRate = paperTrades.length ? paperWins / paperTrades.length : null;
  const paperPosition = paper?.positions[0] ?? null;
  const paperAutomation = state?.paperAutomation;
  const activeStrategy = settings ? STRATEGY_META[settings.strategy_mode]?.label ?? settings.strategy_mode : 'Manual guarded';
  const botModel = settings ? MODE_META[settings.bot_mode]?.label ?? settings.bot_mode : 'Manual';
  const modelWeights = [
    ['Momentum', .25],
    ['Timeframe agreement', .20],
    ['EMA alignment', .15],
    ['Structure', .15],
    ['Candle bodies', .10],
    ['Volatility fit', .10],
    ['Tick volume', .05],
  ];
  const predictionState = marketClosed ? 'Market closed' : sideFromSignal ? `${sideFromSignal} - ${signal?.confidence ?? 0}%` : 'WAIT';
  const predictionDetail = signal?.reasons.length
    ? signal.reasons.join(' / ')
    : signal?.blockers.join(' / ') || state?.research.reason || diagnostics?.reason || 'Collecting Gold candles and ticks.';

  const runGoldModelBacktest = async () => {
    if (!owner || backtestBusy || state?.backtest.ready !== true) return;
    setBacktestBusy(true);
    setError('');
    try {
      await runGoldBacktest();
      await loadGoldState();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBacktestBusy(false);
    }
  };

  return <section class="gold-research-desk" aria-label="Gold research prediction workspace">
    <div class="gold-research-hero">
      <div>
        <span class="gold-kicker">Gold research</span>
        <strong>Future prediction watch</strong>
        <small>Collecting Deriv Gold candles, trend structure, volatility, spread, and recent signal outcomes before trade decisions.</small>
      </div>
      <div class={`gold-prediction ${(sideFromSignal ?? 'wait').toLowerCase()}${marketClosed ? ' locked' : ''}`}>
        <span>{marketClosed ? 'Market lock' : 'Current prediction'}</span>
        <strong>{predictionState}</strong>
        <small>{predictionDetail}</small>
      </div>
    </div>

    <div class="gold-research-main">
      <div class="gold-trade-chart-wrap gold-research-chart">
        <div class="gold-chart-tools" aria-label="Gold research chart timeframe">
          {(['1m', '5m'] as const).map((timeframe) => <button
            key={timeframe}
            class={chartTimeframe === timeframe ? 'active' : ''}
            type="button"
            onClick={() => setChartTimeframe(timeframe)}
          >{timeframe}</button>)}
          <span>{marketClosed ? 'Closed market history' : 'Live TradingView candlesticks'}</span>
        </div>
        <GoldTradeChart
          candles={candles}
          quote={quote}
          label={`${symbol?.displayName || 'Gold'} research prediction chart`}
          entryPrice={marketClosed ? null : sideFromSignal ? signal?.entryReference : null}
          side={marketClosed ? null : sideFromSignal}
          muted={marketClosed}
          lockLabel={marketClosed ? symbol?.tradingStatus ?? 'market closed' : null}
        />
      </div>
      <div class="gold-research-card">
        <span>Market feed</span>
        <strong>{symbol?.displayName || deriv?.display || diagnostics?.symbol || 'Gold / US Dollar'}</strong>
        <small>{symbol?.tradingStatus ? `Status: ${symbol.tradingStatus}` : state?.research.reason ?? 'Waiting for feed'}</small>
        <div class="gold-intel-stats">
          <span>Mid <b>{quote ? goldPrice(quote.mid, digits) : '--'}</b></span>
          <span>Spread <b>{quote ? goldPrice(quote.spread, digits) : '--'}</b></span>
          <span>Quote age <b>{quoteAge == null ? '--' : `${Math.round(quoteAge / 1000)}s`}</b></span>
        </div>
      </div>
      <div class="gold-research-card">
        <span>Research depth</span>
        <strong>{(research?.candles?.['1m']?.length ?? 0) + (research?.candles?.['5m']?.length ?? 0)} candles</strong>
        <small>Stored candle history is used for future prediction checks and backtest validation.</small>
        <div class="gold-intel-stats">
          <span>1m <b>{research?.candles?.['1m']?.length ?? 0}</b></span>
          <span>5m <b>{research?.candles?.['5m']?.length ?? 0}</b></span>
          <span>Signals <b>{recentSignals.length}</b></span>
        </div>
      </div>
    </div>

    <section class="mom-pnl gold-pnl" aria-label="Gold virtual paper profit and loss">
      <div><span>Virtual balance</span><strong>{fmtMoney(paper?.balance ?? 10_000, paper?.currency ?? 'USD')}</strong></div>
      <div><span>Open paper P&amp;L</span><strong class={(paper?.unrealizedPnl ?? 0) >= 0 ? 'up' : 'down'}>{fmtSigned(paper?.unrealizedPnl ?? 0, paper?.currency ?? 'USD')}</strong></div>
      <div><span>Realized paper P&amp;L</span><strong class={(paper?.realizedPnl ?? 0) >= 0 ? 'up' : 'down'}>{fmtSigned(paper?.realizedPnl ?? 0, paper?.currency ?? 'USD')}</strong></div>
      <div><span>Paper drawdown</span><strong class={(paper?.drawdown ?? 0) > 0 ? 'down' : ''}>{fmtMoney(paper?.drawdown ?? 0, paper?.currency ?? 'USD')}</strong></div>
    </section>
    <section class="mom-scoreboard gold-scoreboard" aria-label="Gold prediction paper results">
      <div><span>Predictions tested</span><strong>{paperTrades.length + (paperPosition ? 1 : 0)}</strong></div>
      <div><span>Paper wins</span><strong>{paperWins}</strong></div>
      <div><span>Paper losses</span><strong>{paperLosses}</strong></div>
      <div><span>Paper win rate</span><strong>{paperWinRate == null ? '—' : `${(paperWinRate * 100).toFixed(1)}%`}</strong></div>
    </section>
    <div class={`gold-paper-auto ${paperAutomation?.status ?? 'collecting'}`} aria-live="polite">
      <span><i></i> Automatic virtual research</span>
      <strong>{paperPosition ? `${paperPosition.side} paper position · ${paperPosition.origin === 'automatic_research' ? 'model prediction' : 'manual paper'}` : paperAutomation?.status ?? 'collecting'}</strong>
      <small>{paperAutomation?.reason ?? 'Collecting enough evidence for the first virtual prediction trade.'}</small>
    </div>

    <section class="gold-intel-grid gold-research-intel" aria-label="Gold research model evidence">
      <div class="gold-intel-card">
        <span class="gold-kicker">Bot model</span>
        <strong>{signal?.modelVersion ?? 'gold-momentum-v1'}</strong>
        <small>{botModel} posture - {activeStrategy} strategy - global bot {automation?.running ? 'running' : 'stopped'}. Gold execution stays manual demo-only.</small>
        <div class="gold-intel-stats">
          <span>Regime <b>{signal?.regime ?? 'WAITING'}</b></span>
          <span>Score <b>{signal ? `${Math.round(signal.score * 100)}%` : '--'}</b></span>
          <span>ATR <b>{signal ? goldPrice(signal.atr, digits) : '--'}</b></span>
        </div>
      </div>
      <div class="gold-intel-card">
        <span class="gold-kicker">Pattern watching</span>
        <strong>{sideFromSignal ? `${sideFromSignal} setup under watch` : 'No validated setup'}</strong>
        <small>{predictionDetail}</small>
        <div class="gold-model-bars">
          {modelWeights.map(([label, weight]) => <span key={label}><b>{label}</b><i><em style={{ width: `${Number(weight) * 100}%` }}></em></i></span>)}
        </div>
      </div>
      <div class="gold-intel-card">
        <span class="gold-kicker">Historical test</span>
        <strong>{backtest ? `${backtest.metrics.tradeCount} tested trades` : 'Not run yet'}</strong>
        <small>{backtest ? `Win rate ${backtest.metrics.winRate == null ? '--' : `${(backtest.metrics.winRate * 100).toFixed(1)}%`} - net ${fmtSigned(backtest.metrics.netPnl, 'USD')}` : state?.backtest.reason ?? 'Run history test after candles load.'}</small>
        <div class="gold-intel-stats">
          <span>Processed <b>{backtest?.candlesProcessed ?? 0}</b></span>
          <span>Expectancy <b>{backtest ? fmtSigned(backtest.metrics.expectancy, 'USD') : '--'}</b></span>
          <span>Max DD <b>{backtest ? fmtMoney(backtest.metrics.maxDrawdown, 'USD') : '--'}</b></span>
        </div>
        <button class="gold-backtest-button" type="button" disabled={!owner || backtestBusy || state?.backtest.ready !== true} onClick={() => void runGoldModelBacktest()}>
          <Icon name={backtestBusy ? 'dots' : 'stats'} size={13} />
          {backtestBusy ? 'Testing history' : 'Run history test'}
        </button>
      </div>
      <div class="gold-intel-card">
        <span class="gold-kicker">Recent predictions</span>
        <strong>{recentSignals.length ? `${recentSignals.length} retained` : 'No retained signals yet'}</strong>
        <small>Newest generated signals are kept as research evidence for future tuning.</small>
        <div class="gold-research-signals">
          {recentSignals.slice(0, 5).map((item) => <div class="gold-signal-row" key={item.id}>
            <span class={item.direction.toLowerCase()}>{item.direction}</span>
            <b>{item.confidence}%</b>
            <small>{new Date(item.generatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</small>
          </div>)}
          {recentSignals.length === 0 && <span class="gold-ledger-empty">Waiting for enough market data</span>}
        </div>
      </div>
    </section>

    {error && <div class="tl-err">{error}</div>}
  </section>;
}

function GoldDerivTradeWorkspace({
  state,
  owner,
  session,
  trades,
  ledgerEntries,
  automation,
  settings,
  contract,
}: {
  state: GoldModuleState | null;
  owner: boolean;
  session: ReturnType<typeof useStore>['session'];
  trades: TradeRow[];
  ledgerEntries: LedgerEntry[];
  automation: AutomationState | null;
  settings: Settings | null;
  contract: ContractEvt | null;
}): JSX.Element {
  const diagnostics = state?.diagnostics ?? null;
  const deriv = state?.deriv ?? null;
  const research = state?.research.state ?? null;
  const symbol = research?.symbol ?? null;
  const quote = research?.quote ?? null;
  const signal = research?.signal ?? null;
  const sideFromSignal: GoldSide | null = signal?.direction === 'BUY' || signal?.direction === 'SELL' ? signal.direction : null;
  const serverOpenGoldTrade = deriv?.openTrade ?? null;
  const localOpenGoldTrade = trades.find((trade) => unusedGoldDerivIsGoldTrade(trade) && unusedGoldDerivIsOpenTrade(trade)) ?? null;
  const openGoldTrade = serverOpenGoldTrade ?? localOpenGoldTrade;
  const openAnyTrade = deriv?.blockedByOpenTrade ?? trades.find((trade) => unusedGoldDerivIsOpenTrade(trade) && isMultiplierTrade(trade)) ?? null;
  const [side, setSide] = useState<GoldSide>(sideFromSignal ?? 'BUY');
  const [stakeText, setStakeText] = useState('1');
  const [multiplierText, setMultiplierText] = useState(String(deriv?.defaultMultiplier ?? 20));
  const [multiplierProbe, setMultiplierProbe] = useState<MultiplierOptionsResult | null>(null);
  const [multiplierProbeStatus, setMultiplierProbeStatus] = useState<'idle' | 'checking' | 'error'>('idle');
  const [takeProfitText, setTakeProfitText] = useState('');
  const [stopLossText, setStopLossText] = useState('');
  const [purchase, setPurchase] = useState<GoldDerivTradePurchase | null>(null);
  const [closed, setClosed] = useState<GoldDerivTradeClose | null>(null);
  const [chartTimeframe, setChartTimeframe] = useState<Extract<GoldTimeframe, '1m' | '5m'>>('1m');
  const [busy, setBusy] = useState(false);
  const [closing, setClosing] = useState(false);
  const [backtestBusy, setBacktestBusy] = useState(false);
  const [error, setError] = useState('');
  const [contractClock, setContractClock] = useState(Date.now());
  const manualMultiplierRef = useRef(false);
  const stake = Number(stakeText);
  const selectedMultiplier = Number(multiplierText);
  const takeProfit = takeProfitText.trim() ? Number(takeProfitText) : undefined;
  const stopLoss = stopLossText.trim() ? Number(stopLossText) : undefined;
  const limitsValid = (takeProfit === undefined || (Number.isFinite(takeProfit) && takeProfit > 0))
    && (stopLoss === undefined || (Number.isFinite(stopLoss) && stopLoss > 0));
  const marketReady = state?.research.ready === true && Boolean(quote);
  const marketClosed = symbol?.tradingStatus === 'closed' || symbol?.tradingStatus === 'suspended' || symbol?.tradingStatus === 'unavailable';
  const probeSide: GoldSide = sideFromSignal ?? side;
  const demoConnected = deriv?.demoConnected === true || session?.mode === 'demo';
  const accountBlocked = Boolean(openAnyTrade && !unusedGoldDerivIsGoldTrade(openAnyTrade));
  const goldProbeSymbol = deriv?.symbol ?? symbol?.id ?? '';
  const activeMultiplierProbe = multiplierProbe?.symbol === goldProbeSymbol ? multiplierProbe : null;
  const probedGoldOptions = activeMultiplierProbe?.options.length ? activeMultiplierProbe.options : null;
  const multiplierOptions = probedGoldOptions ?? deriv?.multiplierOptions?.filter((value) => value <= 1000) ?? [10, 20, 30, 50, 100, 200, 500, 1000];
  const maxMultiplier = activeMultiplierProbe?.max ?? null;
  const multiplierWithinLiveMax = maxMultiplier == null || selectedMultiplier <= maxMultiplier;
  const canPlace = owner && demoConnected && marketReady && !marketClosed && !automation?.running && !openAnyTrade && Number.isFinite(stake) && stake > 0
    && Number.isFinite(selectedMultiplier) && selectedMultiplier > 0 && multiplierWithinLiveMax && limitsValid && !busy;
  const canClose = owner && demoConnected && Boolean(openGoldTrade?.contract_id) && !closing;
  const activeTrade = openGoldTrade ?? (purchase?.id ? trades.find((trade) => trade.id === purchase.id) ?? null : null);
  const trackedContractId = activeTrade?.contract_id || purchase?.contractId || purchase?.contract_id || closed?.contractId || '';
  const matchingContract = trackedContractId && contract?.contractId === trackedContractId ? contract : null;
  const liveContractProfit = Number.isFinite(Number(matchingContract?.profit)) ? Number(matchingContract?.profit) : undefined;
  const contractPnl = activeTrade && ['won', 'lost', 'push'].includes(activeTrade.status)
    ? activeTrade.profit
    : closed?.profit ?? liveContractProfit ?? purchase?.pnl ?? purchase?.profit ?? null;
  const liveSellPrice = Number.isFinite(Number(matchingContract?.sellPrice ?? matchingContract?.update?.sellPrice))
    ? Number(matchingContract?.sellPrice ?? matchingContract?.update?.sellPrice)
    : undefined;
  const entryPrice = Number.isFinite(Number(activeTrade?.entry_spot)) && Number(activeTrade?.entry_spot) > 0
    ? Number(activeTrade?.entry_spot)
    : Number.isFinite(Number(purchase?.entryPrice)) && Number(purchase?.entryPrice) > 0
      ? Number(purchase?.entryPrice)
      : undefined;
  const reasonMultiplier = Number((activeTrade?.reason ?? '').match(/multiplier x(\d+)/i)?.[1] ?? NaN);
  const contractMultiplier = purchase?.multiplier ?? (Number.isFinite(reasonMultiplier) ? reasonMultiplier : selectedMultiplier);
  const contractStake = activeTrade?.stake ?? purchase?.ask ?? stake;
  const contractSide = activeTrade?.contract_type === 'MULTDOWN' ? 'SELL' : activeTrade?.contract_type === 'MULTUP' ? 'BUY' : purchase ? side : null;
  const contractOpenedAt = activeTrade?.ts ?? 0;
  const contractElapsed = contractOpenedAt ? fmtElapsed(Math.max(0, contractClock - contractOpenedAt)) : '--';
  const candles = research?.candles?.[chartTimeframe] ?? research?.candles?.[research.timeframe ?? '1m'] ?? [];
  const digits = Math.max(2, Math.min(5, symbol?.digits ?? 2));
  const currency = purchase?.currency ?? session?.currency ?? 'USD';
  const exposure = Number.isFinite(stake) && stake > 0 && Number.isFinite(selectedMultiplier) && selectedMultiplier > 0 ? stake * selectedMultiplier : 0;
  const exposureText = exposure > 0 ? `${fmtMoney(stake, currency)} controls about ${fmtMoney(exposure, currency)}` : 'Enter stake and multiplier';
  const tpPreview = takeProfit === undefined ? 'No TP' : fmtMoney(takeProfit, currency);
  const slPreview = stopLoss === undefined ? 'No SL' : fmtMoney(stopLoss, currency);
  const goldTrades = trades.filter(unusedGoldDerivIsGoldTrade);
  const goldLedger = ledgerEntries.filter((entry) => entry.contract_type === 'MULTUP' || entry.contract_type === 'MULTDOWN')
    .filter((entry) => entry.market === deriv?.symbol || /gold/i.test(entry.reason ?? '') || entry.market === symbol?.id)
    .slice(0, 8);
  const settledGoldTrades = goldTrades.filter((trade) => trade.status === 'won' || trade.status === 'lost' || trade.status === 'push');
  const goldRealizedPnl = settledGoldTrades.reduce((sum, trade) => sum + Number(trade.profit ?? 0), 0);
  const goldWinRate = settledGoldTrades.length
    ? (settledGoldTrades.filter((trade) => trade.status === 'won' || Number(trade.profit ?? 0) > 0).length / settledGoldTrades.length) * 100
    : null;
  const backtest = state?.backtest.result;
const modelWeights = [
    ['Momentum', .25],
    ['Timeframe agreement', .20],
    ['EMA alignment', .15],
    ['Structure', .15],
    ['Candle bodies', .10],
    ['Volatility fit', .10],
    ['Tick volume', .05],
    ['News sentiment', .10],
    ['Social sentiment', .05],
];
  const activeStrategy = settings ? STRATEGY_META[settings.strategy_mode]?.label ?? settings.strategy_mode : 'Manual guarded';
  const botModel = settings ? MODE_META[settings.bot_mode]?.label ?? settings.bot_mode : 'Manual';
  const suggestionText = sideFromSignal ? `${sideFromSignal} - ${signal?.confidence ?? 0}%` : 'WAIT';
  const actionNote = busy
    ? 'Sending Deriv demo order'
    : closing
      ? 'Closing Deriv Gold contract'
      : !owner
        ? 'Unlock owner controls to trade Gold'
        : !session
          ? 'Connect a Deriv demo account to trade Gold'
          : !demoConnected
            ? 'Switch to a Deriv demo account'
            : automation?.running
              ? 'Stop the main bot before placing a Gold trade'
            : marketClosed
              ? `Gold market is ${symbol?.tradingStatus ?? 'unavailable'}`
            : openAnyTrade
              ? `Wait for open contract ${openAnyTrade.contract_id || openAnyTrade.id} to settle`
              : !marketReady
                ? state?.research.reason ?? diagnostics?.reason ?? 'Waiting for live Deriv Gold prices'
                : !multiplierWithinLiveMax
                  ? `Selected multiplier exceeds live max x${maxMultiplier}`
                : !limitsValid
                  ? 'TP profit and stop loss must be positive amounts when set'
                  : sideFromSignal
                    ? `Manual demo order ready · model currently suggests ${sideFromSignal}`
                    : 'Manual demo order ready · model currently says WAIT';

  useEffect(() => {
    if (sideFromSignal) setSide(sideFromSignal);
  }, [sideFromSignal]);

  useEffect(() => {
    if (!openGoldTrade) return;
    setContractClock(Date.now());
    const timer = window.setInterval(() => setContractClock(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [openGoldTrade?.id]);

  useEffect(() => {
    if (deriv?.defaultMultiplier) setMultiplierText(String(deriv.defaultMultiplier));
  }, [deriv?.defaultMultiplier]);

  useEffect(() => {
    manualMultiplierRef.current = false;
  }, [goldProbeSymbol]);

  useEffect(() => {
    if (!goldProbeSymbol || !owner || !demoConnected || !(Number.isFinite(stake) && stake > 0) || openAnyTrade) {
      setMultiplierProbe(null);
      setMultiplierProbeStatus('idle');
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setMultiplierProbeStatus('checking');
      void loadMultiplierOptions({
        symbol: goldProbeSymbol,
        direction: probeSide,
        stake,
        signal: controller.signal,
      }).then((result) => {
        if (controller.signal.aborted) return;
        setMultiplierProbe(result);
        setMultiplierProbeStatus('idle');
        if (result.max && selectedMultiplier !== result.max && (!manualMultiplierRef.current || !result.options.includes(selectedMultiplier))) {
          setMultiplierText(String(result.max));
        }
      }).catch((cause) => {
        if (controller.signal.aborted) return;
        setMultiplierProbe(null);
        setMultiplierProbeStatus('error');
        console.warn('[gold] multiplier limit check failed', cause);
      });
    }, 350);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [demoConnected, goldProbeSymbol, openAnyTrade, owner, probeSide, selectedMultiplier, stake]);

  useEffect(() => {
    setPurchase(null);
    setClosed(null);
    setError('');
  }, [symbol?.id, stakeText, multiplierText, takeProfitText, stopLossText]);

  const place = async (nextSide: GoldSide) => {
    if (!canPlace) return;
    setSide(nextSide);
    setBusy(true);
    setError('');
    try {
      setPurchase(await placeGoldDerivTrade({
        side: nextSide,
        stake,
        multiplier: selectedMultiplier,
        takeProfit,
        stopLoss,
      }));
      await loadGoldState();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const close = async () => {
    if (!canClose) return;
    setClosing(true);
    setError('');
    try {
      setClosed(await closeGoldDerivTrade());
      setPurchase(null);
      await refreshTrades();
      await loadGoldState();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setClosing(false);
    }
  };

  const runGoldModelBacktest = async () => {
    if (!owner || backtestBusy || state?.backtest.ready !== true) return;
    setBacktestBusy(true);
    setError('');
    try {
      await runGoldBacktest();
      await loadGoldState();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBacktestBusy(false);
    }
  };

  return <>
    <section class="gold-trade-desk" aria-label="Deriv Gold trade desk">
      <div class="gold-trade-head">
        <div>
          <span class="gold-kicker">Deriv Gold trade</span>
          <strong>{symbol?.displayName || deriv?.display || 'Gold / US Dollar'}</strong>
          <small>{marketReady ? `${chartTimeframe} candlestick watch - Deriv demo multipliers` : state?.research.reason ?? 'Waiting for Deriv Gold feed'}</small>
        </div>
<div class="gold-trade-badges">
          <span class={`gold-trade-suggestion ${(sideFromSignal ?? 'WAIT').toLowerCase()}`}>
            <Icon name={sideFromSignal === 'SELL' ? 'arrowDown' : sideFromSignal === 'BUY' ? 'arrowUp' : 'history'} size={13} />
            <span>Suggested side</span>
            <strong>{suggestionText}</strong>
          </span>
          {signal?.sentiment?.perfectSetup && (
            <span class="gold-perfect-badge" title="Price, news, and social sentiment fully align">
              <Icon name="award" size={12} /><span>Perfect setup</span>
            </span>
          )}
        </div>
      </div>

      <div class="gold-trade-live">
        <div class="gold-trade-chart-wrap">
          <div class="gold-chart-tools" aria-label="Gold chart timeframe">
            {(['1m', '5m'] as const).map((timeframe) => <button
              key={timeframe}
              class={chartTimeframe === timeframe ? 'active' : ''}
              type="button"
              onClick={() => setChartTimeframe(timeframe)}
            >{timeframe}</button>)}
            <span>TradingView candlesticks with wicks</span>
          </div>
          <GoldTradeChart
            candles={candles}
            quote={quote}
            label={`${symbol?.displayName || 'Gold'} Deriv live trade chart`}
            entryPrice={entryPrice}
            side={activeTrade?.contract_type === 'MULTDOWN' ? 'SELL' : activeTrade ? 'BUY' : sideFromSignal ?? side}
            muted={marketClosed}
            lockLabel={marketClosed ? symbol?.tradingStatus ?? 'market closed' : null}
          />
        </div>
        <div class={`gold-trade-readout ${contractPnl == null ? '' : contractPnl >= 0 ? 'up' : 'down'}`}>
          <span>Live contract P&L</span>
          <strong aria-live="polite">{contractPnl == null ? '—' : fmtSigned(contractPnl, currency)}</strong>
          <small>{closed?.soldFor != null ? `Sold ${fmtMoney(closed.soldFor, currency)}` : liveSellPrice == null ? trackedContractId || 'Awaiting order' : `Sell ${fmtMoney(liveSellPrice, currency)}`}</small>
          <div class="gold-trade-direction gold-live-actions" aria-label="Place a Deriv Gold demo trade">
            <button class={`buy ${side === 'BUY' ? 'active' : ''}${sideFromSignal === 'BUY' ? ' suggested' : ''}`} type="button" disabled={!canPlace} onClick={() => void place('BUY')}><Icon name="arrowUp" size={15} />{busy && side === 'BUY' ? 'Placing' : 'Buy'}</button>
            <button class={`sell ${side === 'SELL' ? 'active' : ''}${sideFromSignal === 'SELL' ? ' suggested' : ''}`} type="button" disabled={!canPlace} onClick={() => void place('SELL')}><Icon name="arrowDown" size={15} />{busy && side === 'SELL' ? 'Placing' : 'Sell'}</button>
          </div>
          <button class="gold-live-close" type="button" disabled={!canClose} onClick={() => void close()}>
            <Icon name="x" size={14} />{closing ? 'Cashing out' : openGoldTrade ? 'Close / Cash out' : 'No open trade'}
          </button>
          <div class="gold-contract-details" aria-label="Gold contract details">
            <div><span>Side</span><b class={contractSide === 'SELL' ? 'sell' : contractSide === 'BUY' ? 'buy' : ''}>{contractSide ?? '—'}</b></div>
            <div><span>Stake</span><b>{activeTrade || purchase ? fmtMoney(contractStake, currency) : '—'}</b></div>
            <div><span>Multiplier</span><b>{activeTrade || purchase ? `x${contractMultiplier}` : '—'}</b></div>
            <div><span>Elapsed</span><b>{contractElapsed}</b></div>
            <div><span>Entry</span><b>{entryPrice == null ? '—' : goldPrice(entryPrice, digits)}</b></div>
            <div><span>Cash-out value</span><b>{liveSellPrice == null ? '—' : fmtMoney(liveSellPrice, currency)}</b></div>
            <div class="contract-id"><span>Contract</span><b title={trackedContractId}>{trackedContractId || '—'}</b></div>
            <div><span>Status</span><b>{activeTrade?.status ?? (purchase ? 'pending' : '—')}</b></div>
          </div>
        </div>
      </div>

      <div class="gold-trade-order gold-deriv-order">
        <label class="gold-trade-field"><span>Demo stake</span><input type="number" inputMode="decimal" min="0.35" step="0.01" value={stakeText} disabled={busy || Boolean(openAnyTrade)} onInput={(event) => setStakeText((event.currentTarget as HTMLInputElement).value)} /></label>
        <label class="gold-trade-field"><span>{maxMultiplier ? `Multiplier max x${maxMultiplier}` : multiplierProbeStatus === 'checking' ? 'Multiplier checking max' : 'Multiplier'}</span><select value={multiplierText} disabled={busy || Boolean(openAnyTrade)} onChange={(event) => { manualMultiplierRef.current = true; setMultiplierText((event.currentTarget as HTMLSelectElement).value); }}>{multiplierOptions.map((value) => <option value={value} key={value}>x{value}{maxMultiplier === value ? ' max' : ''}</option>)}</select></label>
        <label class="gold-trade-field"><span>TP profit</span><input type="number" inputMode="decimal" min="0.01" step="0.01" placeholder="optional" value={takeProfitText} disabled={busy || Boolean(openAnyTrade)} onInput={(event) => setTakeProfitText((event.currentTarget as HTMLInputElement).value)} /></label>
        <label class="gold-trade-field"><span>Stop loss</span><input type="number" inputMode="decimal" min="0.01" step="0.01" placeholder="optional" value={stopLossText} disabled={busy || Boolean(openAnyTrade)} onInput={(event) => setStopLossText((event.currentTarget as HTMLInputElement).value)} /></label>
        <div class="gold-trade-quote">
          <span>Live price</span>
          <strong>{quote ? goldPrice(quote.mid, digits) : '—'}</strong>
          <small>{quote ? `${deriv?.symbol ?? symbol?.id ?? 'Gold'} · ${Math.round(Math.max(0, Date.now() - quote.receivedAt) / 1000)}s ago` : 'Waiting for Deriv tick'}</small>
        </div>
        <div class="gold-trade-quote gold-exposure-card">
          <span>Exposure</span>
          <strong>{exposureText}</strong>
          <small>x{selectedMultiplier || '--'} multiplier - TP {tpPreview} - SL {slPreview}</small>
        </div>
        <span class="gold-trade-action-note">{actionNote}</span>
      </div>

      <GoldSentimentPanel state={state} />

      {signal && <div class="gold-trade-note">{signal.reasons.length ? signal.reasons.join(' · ') : signal.blockers.join(' · ') || 'Gold research is waiting for stronger evidence.'}</div>}
      {(purchase || openGoldTrade) && <div class="gold-trade-note">Deriv demo contract {trackedContractId || 'submitted'} is tracked against this account balance.</div>}
      {accountBlocked && <div class="gold-trade-note">Another account contract is open. Gold waits for the shared account lock to clear.</div>}
      {error && <div class="tl-err">{error}</div>}
    </section>

    <section class="mom-pnl gold-pnl" aria-label="Gold Deriv demo profit and loss">
      <div><span>Contract stake</span><strong>{activeTrade ? fmtMoney(activeTrade.stake, currency) : Number.isFinite(stake) && stake > 0 ? fmtMoney(stake, currency) : '—'}</strong></div>
      <div><span>Open contract P&amp;L</span><strong class={(contractPnl ?? 0) >= 0 ? 'up' : 'down'}>{contractPnl == null ? '—' : fmtSigned(contractPnl, currency)}</strong></div>
      <div><span>Realized Gold P&amp;L</span><strong class={goldRealizedPnl >= 0 ? 'up' : 'down'}>{fmtSigned(goldRealizedPnl, currency)}</strong></div>
      <div><span>Current exposure</span><strong>{exposure > 0 ? fmtMoney(exposure, currency) : '—'}</strong></div>
    </section>
    <section class="mom-scoreboard gold-scoreboard" aria-label="Gold Deriv demo results">
      <div><span>Demo bets settled</span><strong>{settledGoldTrades.length}</strong></div>
      <div><span>Demo wins</span><strong>{settledGoldTrades.filter((trade) => trade.status === 'won' || Number(trade.profit ?? 0) > 0).length}</strong></div>
      <div><span>Demo losses</span><strong>{settledGoldTrades.filter((trade) => trade.status === 'lost' || Number(trade.profit ?? 0) < 0).length}</strong></div>
      <div><span>Demo win rate</span><strong>{goldWinRate == null ? '—' : `${goldWinRate.toFixed(1)}%`}</strong></div>
    </section>

    <section class="gold-intel-grid" aria-label="Gold trade intelligence">
      <div class="gold-intel-card">
        <span class="gold-kicker">Bot model</span>
        <strong>{signal?.modelVersion ?? 'gold-momentum-v1'}</strong>
        <small>{botModel} bot posture - {activeStrategy} money strategy - global bot {automation?.running ? 'running' : 'stopped'}. Gold auto-execution remains manual demo-only.</small>
        <div class="gold-intel-stats">
          <span>Regime <b>{signal?.regime ?? 'WAITING'}</b></span>
          <span>Score <b>{signal ? `${Math.round(signal.score * 100)}%` : '--'}</b></span>
          <span>ATR <b>{signal ? goldPrice(signal.atr, digits) : '--'}</b></span>
        </div>
      </div>
      <div class="gold-intel-card">
        <span class="gold-kicker">Pattern watch</span>
        <strong>{sideFromSignal ? `${sideFromSignal} setup under watch` : 'No trade setup yet'}</strong>
        <small>{signal?.reasons.length ? signal.reasons.join(' / ') : signal?.blockers.join(' / ') || 'Waiting for candle and timeframe agreement.'}</small>
        <div class="gold-model-bars">
          {modelWeights.map(([label, weight]) => <span key={label}><b>{label}</b><i><em style={{ width: `${Number(weight) * 100}%` }}></em></i></span>)}
        </div>
      </div>
      <div class="gold-intel-card">
        <span class="gold-kicker">Historical edge</span>
        <strong>{backtest ? `${backtest.metrics.tradeCount} tested trades` : `${candles.length} candles loaded`}</strong>
        <small>{backtest ? `Win rate ${backtest.metrics.winRate == null ? '--' : `${(backtest.metrics.winRate * 100).toFixed(1)}%`} - net ${fmtSigned(backtest.metrics.netPnl, currency)}` : state?.backtest.reason ?? 'Completed Gold candles are ready for historical testing.'}</small>
        <div class="gold-intel-stats">
          <span>1m <b>{research?.candles?.['1m']?.length ?? 0}</b></span>
          <span>5m <b>{research?.candles?.['5m']?.length ?? 0}</b></span>
          <span>Spread/ATR <b>{signal && Number.isFinite(signal.spreadToAtr) ? signal.spreadToAtr.toFixed(3) : '--'}</b></span>
          <span>EOD accuracy <b>{state?.predictionEvaluation?.accuracy == null ? '--' : `${(state.predictionEvaluation.accuracy * 100).toFixed(1)}%`}</b></span>
          <span>Awaiting review <b>{state?.predictionEvaluation?.pending ?? 0}</b></span>
          <span>Own trades learned <b>{(state?.predictionEvaluation?.tradeOutcomes.won ?? 0) + (state?.predictionEvaluation?.tradeOutcomes.lost ?? 0)}</b></span>
        </div>
        <button class="gold-backtest-button" type="button" title={state?.backtest.ready === false ? state.backtest.reason ?? undefined : undefined} disabled={!owner || backtestBusy || state?.backtest.ready !== true} onClick={() => void runGoldModelBacktest()}>
          <Icon name={backtestBusy ? 'dots' : 'stats'} size={13} />
          {backtestBusy ? 'Testing history' : 'Run history test'}
        </button>
      </div>
      <div class="gold-intel-card">
        <span class="gold-kicker">Gold P&amp;L ledger</span>
        <strong>{settledGoldTrades.length ? fmtSigned(goldRealizedPnl, currency) : 'No settled Gold trades'}</strong>
        <small>{goldWinRate == null ? 'Ledger starts after Deriv Gold orders are requested.' : `${settledGoldTrades.length} settled - ${goldWinRate.toFixed(1)}% win rate`}</small>
        <div class="gold-mini-ledger">
          {goldLedger.length === 0 && <span class="gold-ledger-empty">No Gold ledger events yet</span>}
          {goldLedger.map((entry) => <GoldLedgerRow entry={entry} currency={currency} key={entry.id} />)}
        </div>
      </div>
    </section>

    <section class="gold-facts" aria-label="Deriv Gold safeguards">
      <div><span>Provider</span><strong>Deriv API</strong><small>Not MT5/cTrader execution</small></div>
      <div><span>Market data</span><strong>{state?.research.ready ? 'Live' : 'Waiting'}</strong><small>{state?.research.reason ?? diagnostics?.reason ?? 'Deriv Gold feed'}</small></div>
      <div><span>Trading</span><strong>{demoConnected ? 'Demo enabled' : 'Demo locked'}</strong><small>{deriv?.message ?? 'Connect Deriv demo'}</small></div>
      <div><span>Multiplier lane</span><strong>{openAnyTrade ? 'Busy' : 'Clear'}</strong><small>{openAnyTrade ? `Open multiplier ${openAnyTrade.contract_id || openAnyTrade.id}` : 'Digit lane remains independent'}</small></div>
    </section>
  </>;
}

function GoldDerivConnectionOnboarding({
  state,
  owner,
  session,
}: {
  state: GoldModuleState | null;
  owner: boolean;
  session: ReturnType<typeof useStore>['session'];
}): JSX.Element {
  const deriv = state?.deriv ?? null;
  if (!session) return <ConnectView embedded />;
  return <section class="gold-connection" aria-label="Deriv Gold trade readiness">
    <div class="gold-connection-intro">
      <div>
        <span class="gold-kicker">Gold trade readiness</span>
        <h2>{session.mode === 'demo' ? 'Deriv demo ready for Gold trades' : 'Switch to demo for Gold trades'}</h2>
        <p>Gold trading uses Deriv API multiplier contracts with demo-first controls, server-side contract checks, and the shared one-open-contract account guard.</p>
      </div>
      <div class={`gold-connection-state${session.mode === 'demo' ? ' is-connected' : ''}`} role="status" aria-live="polite">
        <span>Trade status</span>
        <strong>{session.mode === 'demo' ? 'Demo connected' : 'Real account selected'}</strong>
        <small>{deriv?.message ?? 'Deriv account connected.'}</small>
      </div>
    </div>
    <section class="gold-connection-facts" aria-label="Deriv Gold trade facts">
      <div><span>Provider</span><strong>Deriv API</strong></div>
      <div><span>Account</span><strong>{owner ? session.loginid : 'Owner locked'}</strong></div>
      <div><span>Mode</span><strong>{session.mode === 'demo' ? 'Demo' : 'Real blocked'}</strong></div>
      <div><span>Symbol</span><strong>{deriv?.symbol ?? state?.diagnostics.symbol ?? 'frxXAUUSD'}</strong></div>
    </section>
    {session.mode !== 'demo' && <div class="tl-err">Gold API trading is demo-only. Open Account and switch to a demo account before placing a Gold trade.</div>}
  </section>;
}

function GoldSentimentPanel({ state }: { state: GoldModuleState | null }): JSX.Element | null {
  const worker = state?.sentiment ?? null;
  const snapshot = worker?.snapshot ?? state?.research.state?.sentiment ?? null;
  const signalSentiment = state?.research.state?.signal?.sentiment ?? null;
  if (!snapshot && !worker) return null;
  const lean = snapshot?.combinedScore ? (snapshot.combinedScore >= 0.15 ? 'BULLISH' : snapshot.combinedScore <= -0.15 ? 'BEARISH' : 'NEUTRAL') : 'NEUTRAL';
  const leanClass = lean.toLowerCase();

  const formatAge = (ms: number): string => {
    if (!Number.isFinite(ms)) return '—';
    const mins = Math.round(ms / 60_000);
    if (mins < 1) return '< 1m';
    if (mins < 60) return `${mins}m`;
    const hours = Math.round(mins / 60);
    if (hours < 24) return `${hours}h`;
    return `${Math.round(hours / 24)}d`;
  };

  const formatScore = (score: number): string => `${score >= 0 ? '+' : ''}${(score * 100).toFixed(1)}%`;

  const alignment = signalSentiment?.alignment ?? 'NEUTRAL';
  const perfectSetup = signalSentiment?.perfectSetup ?? false;

  return (
    <section class="gold-sentiment-panel" aria-label="Gold news and social sentiment">
      <div class="gold-sentiment-head">
        <span class="gold-kicker">News & social sentiment</span>
        <span class={`gold-sentiment-lean ${leanClass}`}>{lean}</span>
        <span class="gold-sentiment-freshness">{worker ? `worker ${worker.running ? 'running' : 'stopped'}` : 'from research'} · updated {formatAge(Date.now() - (snapshot?.generatedAt ?? Date.now()))} ago</span>
      </div>
      <div class="gold-sentiment-grid">
        <div class="gold-sentiment-score">
          <span class="gold-sentiment-label">Combined</span>
          <strong>{formatScore(snapshot?.combinedScore ?? 0)}</strong>
        </div>
        <div class="gold-sentiment-score">
          <span class="gold-sentiment-label">News ({snapshot?.newsCount ?? 0})</span>
          <strong>{formatScore(snapshot?.newsScore ?? 0)}</strong>
          <small>{formatAge(snapshot?.newsFreshnessMs ?? 0)} ago</small>
        </div>
        <div class="gold-sentiment-score">
          <span class="gold-sentiment-label">Social ({snapshot?.socialCount ?? 0})</span>
          <strong>{formatScore(snapshot?.socialScore ?? 0)}</strong>
          <small>{formatAge(snapshot?.socialFreshnessMs ?? 0)} ago</small>
        </div>
        <div class="gold-sentiment-score">
          <span class="gold-sentiment-label">Alignment</span>
          <strong>{alignment}</strong>
          {perfectSetup && <span class="gold-perfect-inline">Perfect setup</span>}
        </div>
      </div>
      {snapshot?.topItems?.length && (
        <div class="gold-sentiment-headlines">
          <span class="gold-kicker">Latest headlines</span>
          {snapshot.topItems.slice(0, 4).map((item, index) => (
            <div key={index} class="gold-sentiment-item">
              <a href={item.url ?? '#'} target="_blank" rel="noopener noreferrer" class="gold-sentiment-title">{item.title}</a>
              <div class="gold-sentiment-meta">
                <span class="gold-sentiment-source">{item.source}</span>
                <span class="gold-sentiment-age">{formatAge(Date.now() - item.publishedAt)}</span>
                <span class="gold-sentiment-score" style={{ color: item.score >= 0.1 ? 'var(--green)' : item.score <= -0.1 ? 'var(--red)' : 'var(--muted)' }}>
                  {formatScore(item.score)}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
      {worker && (
        <details class="gold-sentiment-sources">
          <summary>Sources & status</summary>
          <div class="gold-sources-list">
            {worker.sources.map((src, index) => (
              <div key={index} class={`gold-source ${src.ok ? 'ok' : 'error'}`}>
                <span class="gold-source-kind">{src.kind}</span>
                <span class="gold-source-name">{src.source}</span>
                <span class="gold-source-items">{src.items} items</span>
                <span class="gold-source-time">{src.lastFetchAt ? formatAge(Date.now() - src.lastFetchAt) : '—'}</span>
                {src.error && <span class="gold-source-error" title={src.error}>⚠</span>}
              </div>
            ))}
          </div>
        </details>
      )}
    </section>
  );
}

function GoldTradeWorkspace({
  state,
  owner,
  onOpenConnection,
}: {
  state: GoldModuleState | null;
  owner: boolean;
  onOpenConnection: () => void;
}): JSX.Element {
  const diagnostics = state?.diagnostics ?? null;
  const research = state?.research.state ?? null;
  const paper = state?.paper.state ?? null;
  const symbol = research?.symbol ?? null;
  const quote = research?.quote ?? null;
  const signal = research?.signal ?? null;
  const sideFromSignal: GoldSide | null = signal?.direction === 'BUY' || signal?.direction === 'SELL' ? signal.direction : null;
  const position = paper?.positions[0] ?? null;
  const lastClosed = paper?.closedTrades.at(-1) ?? null;
  const candles = research?.candles?.[research.timeframe ?? '5m'] ?? [];
  const digits = Math.max(2, Math.min(5, symbol?.digits ?? 2));
  const [side, setSide] = useState<GoldSide>(sideFromSignal ?? 'BUY');
  const [volumeText, setVolumeText] = useState('1');
  const [tpText, setTpText] = useState('');
  const [slText, setSlText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const volume = Number(volumeText);
  const takeProfit = parseOptionalGoldPrice(tpText);
  const stopLoss = parseOptionalGoldPrice(slText);
  const validStops = takeProfit !== undefined && stopLoss !== undefined;
  const marketReady = state?.paper.ready === true;
  const hasPosition = Boolean(position);
  const canOpen = owner && marketReady && Boolean(sideFromSignal) && !hasPosition && Number.isFinite(volume) && volume > 0 && validStops;
  const canClose = owner && marketReady && Boolean(position?.id) && !busy;
  const entryPrice = position?.entryPrice ?? signal?.entryReference ?? quote?.mid ?? null;
  const chartSide = position?.side ?? sideFromSignal ?? side;
  const chartStopLoss = position?.stopLoss ?? (stopLoss === undefined ? null : stopLoss);
  const chartTakeProfit = position?.takeProfit ?? (takeProfit === undefined ? null : takeProfit);
  const positionPnl = position?.unrealizedPnl ?? lastClosed?.netPnl ?? null;
  const quoteAge = quote ? Math.max(0, Date.now() - quote.receivedAt) : null;
  const spreadText = quote ? goldPrice(quote.spread, digits) : '—';
  const readinessReason = state?.paper.reason ?? state?.research.reason ?? diagnostics?.reason ?? 'Gold state has not loaded yet.';
  const actionNote = busy
    ? 'Processing Gold paper action'
    : !owner
      ? 'Unlock dashboard owner controls'
      : !marketReady
        ? readinessReason
        : hasPosition
          ? `Watching ${position?.side} paper position`
          : !validStops
            ? 'TP and SL must be positive prices when set'
            : sideFromSignal
              ? `${sideFromSignal} is the current Gold research side`
              : 'No validated Gold direction yet';

  useEffect(() => {
    if (sideFromSignal) setSide(sideFromSignal);
  }, [sideFromSignal]);

  useEffect(() => {
    if (symbol?.minVolume && Number(volumeText) <= 0) setVolumeText(String(symbol.minVolume));
  }, [symbol?.minVolume, volumeText]);

  useEffect(() => {
    if (!position && sideFromSignal && signal?.proposedTakeProfit != null && signal?.proposedStopLoss != null) {
      setTpText(String(signal.proposedTakeProfit));
      setSlText(String(signal.proposedStopLoss));
    }
  }, [position, sideFromSignal, signal?.id, signal?.proposedStopLoss, signal?.proposedTakeProfit]);

  const open = async (nextSide: GoldSide) => {
    if (!canOpen) return;
    if (sideFromSignal && nextSide !== sideFromSignal) {
      setSide(sideFromSignal);
      setError(`Gold research recommends ${sideFromSignal}; the opposite side is disabled.`);
      return;
    }
    setBusy(true);
    setError('');
    setSide(nextSide);
    try {
      const result = await openGoldPaperTrade({
        side: nextSide,
        volume,
        stopLoss: stopLoss ?? null,
        takeProfit: takeProfit ?? null,
      });
      if (!result.accepted) setError(result.reason);
      await loadGoldState();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const close = async () => {
    if (!position?.id || !canClose) return;
    setBusy(true);
    setError('');
    try {
      const result = await closeGoldPaperTrade(position.id);
      if (!result.closed) setError(result.reason);
      await loadGoldState();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const reset = async () => {
    if (!owner || busy || hasPosition) return;
    setBusy(true);
    setError('');
    try {
      await resetGoldPaperTrade();
      await loadGoldState();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  return <>
    <section class="gold-trade-desk" aria-label="Gold active trade desk">
      <div class="gold-trade-head">
        <div>
          <span class="gold-kicker">Gold trade</span>
          <strong>{symbol?.displayName || diagnostics?.symbol || 'Gold market'}</strong>
          <small>{marketReady ? `${research?.timeframe ?? '5m'} watch · paper trade enabled` : readinessReason}</small>
        </div>
        <div class="gold-trade-badges">
          <span class={`gold-trade-suggestion ${(sideFromSignal ?? 'WAIT').toLowerCase()}`}>
            <Icon name={sideFromSignal === 'SELL' ? 'arrowDown' : sideFromSignal === 'BUY' ? 'arrowUp' : 'history'} size={13} />
            <span>Suggested side</span>
            <strong>{sideFromSignal ? `${sideFromSignal} - ${signal?.confidence ?? 0}%` : 'WAIT'}</strong>
          </span>
          <button class="gold-link-button" type="button" onClick={onOpenConnection}>Connection</button>
        </div>
      </div>

      <div class="gold-trade-live">
        <div class="gold-trade-chart-wrap">
          <GoldTradeChart
            candles={candles}
            quote={quote}
            label={`${symbol?.displayName || 'Gold'} active trade chart`}
            entryPrice={entryPrice}
            side={chartSide}
            stopLoss={chartStopLoss}
            takeProfit={chartTakeProfit}
          />
        </div>
        <div class="gold-trade-readout">
          <span>Paper equity</span>
          <strong>{paper ? fmtMoney(paper.equity, paper.currency) : '—'}</strong>
          <small>{paper ? `${fmtMoney(paper.freeMargin, paper.currency)} free margin` : 'Virtual book unavailable'}</small>
        </div>
        <div class={`gold-trade-readout ${positionPnl == null ? '' : positionPnl >= 0 ? 'up' : 'down'}`}>
          <span>{position ? 'Live paper P&L' : 'Last paper P&L'}</span>
          <strong>{positionPnl == null ? '—' : fmtSigned(positionPnl, paper?.currency ?? 'USD')}</strong>
          <small>{position ? `${position.side} ${position.volume} @ ${goldPrice(position.entryPrice, digits)}` : lastClosed ? `${lastClosed.closeReason.replace('_', ' ')} @ ${goldPrice(lastClosed.exitPrice, digits)}` : 'No open Gold paper position'}</small>
        </div>
      </div>

      <div class="gold-trade-order">
        <div class="gold-trade-direction" aria-label="Place a Gold paper trade">
          <button class={`buy ${side === 'BUY' ? 'active' : ''}${sideFromSignal === 'BUY' ? ' suggested' : ''}`} type="button" disabled={!canOpen || sideFromSignal !== 'BUY' || busy} onClick={() => void open('BUY')}><Icon name="arrowUp" size={15} />{busy && side === 'BUY' ? 'Opening' : 'Buy'}</button>
          <button class={`sell ${side === 'SELL' ? 'active' : ''}${sideFromSignal === 'SELL' ? ' suggested' : ''}`} type="button" disabled={!canOpen || sideFromSignal !== 'SELL' || busy} onClick={() => void open('SELL')}><Icon name="arrowDown" size={15} />{busy && side === 'SELL' ? 'Opening' : 'Sell'}</button>
        </div>
        <label class="gold-trade-field"><span>Volume</span><input type="number" inputMode="decimal" min={symbol?.minVolume ?? 0.01} max={symbol?.maxVolume ?? undefined} step={symbol?.volumeStep ?? 0.01} value={volumeText} disabled={busy || hasPosition} onInput={(event) => setVolumeText((event.currentTarget as HTMLInputElement).value)} /></label>
        <label class="gold-trade-field"><span>TP price</span><input type="number" inputMode="decimal" min="0.01" step={symbol?.pointSize ?? 0.01} placeholder="optional" value={tpText} disabled={busy || hasPosition} onInput={(event) => setTpText((event.currentTarget as HTMLInputElement).value)} /></label>
        <label class="gold-trade-field"><span>Stop loss</span><input type="number" inputMode="decimal" min="0.01" step={symbol?.pointSize ?? 0.01} placeholder="optional" value={slText} disabled={busy || hasPosition} onInput={(event) => setSlText((event.currentTarget as HTMLInputElement).value)} /></label>
        <div class="gold-trade-quote">
          <span>Bid / Ask</span>
          <strong>{quote ? `${goldPrice(quote.bid, digits)} / ${goldPrice(quote.ask, digits)}` : '—'}</strong>
          <small>Spread {spreadText}{quoteAge == null ? '' : ` · ${Math.round(quoteAge / 1000)}s ago`}</small>
        </div>
        <span class="gold-trade-action-note">{actionNote}</span>
        {position && <button class="gold-trade-close" type="button" disabled={!canClose} onClick={() => void close()}>{busy ? 'Closing' : 'Close position'}</button>}
        {!position && paper && paper.closedTrades.length > 0 && <button class="gold-trade-reset" type="button" disabled={!owner || busy} onClick={() => void reset()}>Reset paper</button>}
      </div>

      {signal && <div class="gold-trade-note">{signal.reasons.length ? signal.reasons.join(' · ') : signal.blockers.join(' · ') || 'Gold research is waiting for stronger evidence.'}</div>}
      {error && <div class="tl-err">{error}</div>}
    </section>

    <section class="gold-facts" aria-label="Gold active trade safeguards">
      <div><span>Market data</span><strong>{state?.research.ready ? 'Validated' : 'Waiting'}</strong><small>{state?.research.reason ?? 'Live quote accepted'}</small></div>
      <div><span>Paper trading</span><strong>{state?.paper.ready ? 'Enabled' : 'Locked'}</strong><small>{state?.paper.reason ?? 'Virtual book only'}</small></div>
      <div><span>Execution adapter</span><strong>{diagnostics?.executionCapable ? 'Available' : 'Not live'}</strong><small>cTrader live orders remain separate</small></div>
      <div><span>Connection</span><strong>{state?.connection?.status === 'connected_demo' ? 'Demo selected' : 'Setup'}</strong><small>{state?.connection?.message ?? diagnostics?.reason ?? 'Check connection'}</small></div>
    </section>
  </>;
}

function GoldConnectionOnboarding({ state }: { state: GoldModuleState | null }): JSX.Element {
  const diagnostics = state?.diagnostics ?? null;
  const connection = state?.connection;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [accounts, setAccounts] = useState<GoldDemoAccount[]>([]);
  const [accountsLoading, setAccountsLoading] = useState(false);
  const [selectingAccountId, setSelectingAccountId] = useState<string | null>(null);
  const [authWindowOpen, setAuthWindowOpen] = useState(false);
  const configured = connection?.configured ?? Boolean(diagnostics?.configured);
  const authorizedDemo = connection?.status === 'authorized_demo_pending_account_discovery';
  const connectedDemo = connection?.status === 'connected_demo';
  const authorizing = connection?.status === 'authorizing' || busy || authWindowOpen;
  const connectionError = connection?.status === 'error';
  const status = connectedDemo ? 'Demo account selected' : authorizedDemo ? 'Demo access authorized' : authorizing ? 'Authorization in progress' : connectionError ? 'Connection needs attention' : configured ? 'Ready to authorize' : 'Provider setup needed';
  const detail = connection?.message ?? diagnostics?.reason ?? 'Checking cTrader connection readiness.';
  const missing = diagnostics?.missing ?? [];
  const invalid = diagnostics?.validationErrors ?? [];
  const canStart = connection?.status === 'ready' && !authorizing;
  const canDisconnect = (authorizedDemo || connectedDemo) && connection?.canDisconnect === true && !authorizing && !selectingAccountId;

  const refreshAccounts = async () => {
    setAccountsLoading(true);
    setError('');
    try {
      setAccounts(await loadGoldDemoAccounts());
    } catch (err) {
      setAccounts([]);
      setError(String(err));
    } finally {
      setAccountsLoading(false);
    }
  };

  useEffect(() => {
    if (!authorizedDemo) {
      setAccounts([]);
      return;
    }
    void refreshAccounts();
  }, [authorizedDemo]);

  const beginAuthorization = async () => {
    let authWindow: Window | null = null;
    setBusy(true);
    setError('');
    setAuthWindowOpen(false);
    try {
      authWindow = window.open('', '_blank');
      if (authWindow) {
        authWindow.opener = null;
        authWindow.document.title = 'Opening cTrader authorization';
      }
      const url = await startGoldOAuth();
      if (authWindow && !authWindow.closed) {
        authWindow.location.assign(url);
        setAuthWindowOpen(true);
        setBusy(false);
        return;
      }
      window.location.assign(url);
    } catch (err) {
      if (authWindow && !authWindow.closed) authWindow.close();
      setError(String(err));
      setBusy(false);
    }
  };

  const disconnectAuthorization = async () => {
    if (!window.confirm('Disconnect cTrader demo authorization? Gold research and trading remain unavailable until it is authorized again.')) return;
    setBusy(true);
    setError('');
    try {
      await disconnectGoldOAuth();
      await loadGoldState();
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  };

  const selectDemoAccount = async (account: GoldDemoAccount) => {
    const label = account.broker ? `${account.broker} demo account ${account.id}` : `demo account ${account.id}`;
    if (!window.confirm(`Use ${label}? ZeroNine will verify this server-discovered demo account. No live account or Gold order path will be enabled.`)) return;
    setSelectingAccountId(account.id);
    setError('');
    try {
      await selectGoldDemoAccount(account.id);
      await loadGoldState();
    } catch (err) {
      setError(String(err));
    } finally {
      setSelectingAccountId(null);
    }
  };

  const steps: Array<{ label: string; detail: string; complete: boolean; active?: boolean }> = [
    {
      label: 'Provider setup',
      detail: configured ? 'OAuth application is configured on the server.' : 'A workspace administrator must configure the cTrader OAuth application.',
      complete: configured,
      active: !configured,
    },
    {
      label: 'Secure authorization',
      detail: authorizedDemo || connectedDemo ? 'Demo access is stored server-side with encrypted credentials.' : authorizing ? 'Waiting for cTrader to return to ZeroNine.' : 'Authorize with cTrader in a separate secure window.',
      complete: authorizedDemo || connectedDemo,
      active: configured && !authorizedDemo && !connectedDemo,
    },
    {
      label: 'Demo account verification',
      detail: connectedDemo ? 'The selected server-verified demo account remains read-only.' : authorizedDemo ? 'Choose a verified demo account to continue the guarded setup.' : 'Account discovery and verification occur after authorization.',
      complete: connectedDemo,
      active: authorizedDemo,
    },
  ];

  return <section class="gold-connection" aria-label="cTrader account onboarding">
    <div class="gold-connection-intro">
      <div>
        <span class="gold-kicker">cTrader account connection</span>
        <h2>{connectedDemo ? 'Demo account selected' : authorizedDemo ? 'Choose a cTrader demo account' : configured ? 'Authorize cTrader demo access' : 'Prepare cTrader authorization'}</h2>
        <p>{connectedDemo
          ? 'This demo account was returned and verified by cTrader. It is connected for read-only setup only; no Gold order path is enabled.'
          : authorizedDemo
          ? 'Your broker authorization is stored securely. No trading account has been selected and no Gold order path is enabled.'
          : configured
            ? 'Authorize directly with cTrader. ZeroNine never asks for or displays your broker password, access token, or account number.'
            : 'OAuth is the right connection method, but the server needs its cTrader application settings before any user can begin authorization.'}</p>
      </div>
      <div class={`gold-connection-state${authorizedDemo || connectedDemo ? ' is-connected' : ''}`} role="status" aria-live="polite">
        <span>{authorizedDemo || connectedDemo ? 'Authorization' : 'Connection status'}</span>
        <strong>{status}</strong>
        <small>{detail}</small>
      </div>
    </div>

    <div class="gold-connection-body">
      <div class="gold-onboard-steps" aria-label="Connection steps">
        {steps.map((step, index) => <div class={`gold-onboard-step${step.complete ? ' complete' : ''}${step.active ? ' active' : ''}`} key={step.label}>
          <span class="gold-step-number">{step.complete ? <Icon name="check" size={13} strokeWidth={2.3} /> : index + 1}</span>
          <div><strong>{step.label}</strong><small>{step.detail}</small></div>
        </div>)}
      </div>

      <aside class="gold-auth-action" aria-label="cTrader authorization action">
        {canStart ? <>
          <span class="gold-kicker">Demo-first authorization</span>
          <strong>Continue to cTrader</strong>
          <small>You will return here when authorization is complete.</small>
          <button class="gold-connect-button" type="button" onClick={() => void beginAuthorization()}>
            <Icon name="arrowUpRight" size={15} strokeWidth={2} /> Authorize cTrader demo access
          </button>
        </> : configured && authorizing ? <>
          <span class="gold-kicker">Authorization open</span>
          <strong>Complete sign-in with cTrader</strong>
          <small>Keep this tab open. The status updates after cTrader redirects you back.</small>
        </> : authorizedDemo ? <>
          <span class="gold-kicker">Demo-only protection</span>
          <strong>Choose a verified demo account</strong>
          <small>Only cTrader accounts returned for this authorization can be selected. Live accounts are excluded.</small>
          <div class="gold-account-choices" aria-live="polite">
            <div class="gold-account-choices-head"><span>{accountsLoading ? 'Loading demo accounts' : accounts.length ? 'Available demo accounts' : 'No demo accounts found'}</span><button type="button" onClick={() => void refreshAccounts()} disabled={accountsLoading || selectingAccountId !== null}>Refresh</button></div>
            {accounts.map((account) => <button class="gold-account-option" type="button" key={account.id} disabled={selectingAccountId !== null} onClick={() => void selectDemoAccount(account)}>
              <span><strong>{account.broker || 'cTrader demo account'}</strong><small>Demo account {account.id}</small></span>
              <span class="gold-account-select">{selectingAccountId === account.id ? 'Verifying' : 'Select'} <Icon name="chevronRight" size={13} strokeWidth={2} /></span>
            </button>)}
            {!accountsLoading && accounts.length === 0 && <small class="gold-account-empty">Refresh to retry account discovery, or disconnect and authorize again if cTrader access changed.</small>}
          </div>
          {canDisconnect && <button class="gold-disconnect-button" type="button" onClick={() => void disconnectAuthorization()}>
            Disconnect demo access
          </button>}
        </> : connectedDemo ? <>
          <span class="gold-kicker">Demo-only protection</span>
          <strong>{connection?.accountLabel || 'Demo account selected'}</strong>
          <small>Verified demo account. Market data and trading remain unavailable until their independent safeguards are complete.</small>
          {canDisconnect && <button class="gold-disconnect-button" type="button" onClick={() => void disconnectAuthorization()}>
            Disconnect demo access
          </button>}
        </> : connectionError ? <>
          <span class="gold-kicker">Connection unavailable</span>
          <strong>Authorization cannot start yet</strong>
          <small>{detail}</small>
        </> : <>
          <span class="gold-kicker">Administrator setup</span>
          <strong>OAuth app details are missing</strong>
          <small>Set the required cTrader configuration in Railway, then refresh this page to enable secure authorization.</small>
        </>}
        {error && <p class="gold-connect-error" role="alert">{error}</p>}
      </aside>
    </div>

    {!configured && <section class="gold-config-guide" aria-label="Required cTrader provider configuration">
      <div><span class="gold-kicker">Before users can connect</span><strong>Configure cTrader OAuth in Railway</strong><small>These are server environment settings. They are not entered by users and are never returned to the dashboard.</small></div>
      <div class="gold-config-list">
        {(invalid.length > 0 ? invalid : missing.length > 0 ? missing : ['GOLD_TOKEN_ENCRYPTION_KEY']).map((setting) => <span key={setting}>{setting}</span>)}
      </div>
    </section>}

    <section class="gold-connection-facts" aria-label="Connection safeguards">
      <div><span>Provider</span><strong>cTrader</strong></div>
      <div><span>Account path</span><strong>Demo first</strong></div>
      <div><span>Credential storage</span><strong>Encrypted server-side</strong></div>
      <div><span>Live orders</span><strong>Locked</strong></div>
    </section>
  </section>;
}

function Detail({ label, value, color }: { label: string; value: string; color?: 'green' | 'red' }): JSX.Element {
  return (
    <div class="detail-row">
      <span class="detail-label">{label}</span>
      <span class={`detail-value${color ? ` ${color}` : ''}`}>{value}</span>
    </div>
  );
}

/* ---------------- bottom nav ---------------- */

function BottomNav({ page, setPage }: { page: Page; setPage: (p: Page) => void }): JSX.Element {
  const s = useStore();
  const automation = s.automation?.running ?? false;

  return (
    <div class="bottom-nav-wrap">
      <nav class="bottom-nav">
        <button class={`nav-item${page === 'home' ? ' active' : ''}`} onClick={() => setPage('home')}>
          <Icon name="home" size={20} />
          Home
        </button>
        <button class={`nav-item${page === 'history' ? ' active' : ''}`} onClick={() => setPage('history')}>
          <Icon name="history" size={20} />
          History
        </button>
        <button class={`nav-item${page === 'backtest' ? ' active' : ''}`} onClick={() => setPage('backtest')}>
          <Icon name="stats" size={20} />
          Lab
        </button>
        <button class={`nav-item bot${page === 'bot' ? ' active' : ''}`} onClick={() => setPage('bot')}>
          <span class="nav-bot-circle">
            <Icon name={automation ? 'square' : 'play'} size={15} strokeWidth={2.4} />
          </span>
          Bot
        </button>
        <button class={`nav-item${page === 'momentum' ? ' active' : ''}`} onClick={() => setPage('momentum')}>
          <Icon name="crosshair" size={20} />
          Momentum
        </button>
        <button class={`nav-item gold${page === 'gold' ? ' active' : ''}`} onClick={() => setPage('gold')}>
          <span class="gold-nav-logo" aria-hidden="true"><img src="/gold-logo.png" alt="" /></span>
          Gold
        </button>
        <button class={`nav-item${page === 'account' ? ' active' : ''}`} onClick={() => setPage('account')}>
          <Icon name="account" size={20} />
          Account
        </button>
      </nav>
    </div>
  );
}
