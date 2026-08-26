import { memo } from 'preact/compat';
import { useCallback, useEffect, useMemo, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import type { Market, TradeRow, LedgerEntry, Settings, SignalCandidate, QuoteEvt, Decision, ContractEvt, Recovery, TestRunRow, TestLabActive, PatternRow, DerivAccountInfo, AutomationState } from './store';
import { PaperSimulationStage, type PaperSimulationPhase } from './PaperSimulationStage';
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
  resetPerformance,
  updateSettings,
  loadTestRuns,
  loadPatternsData,
  loadAutoBacktestStatus,
  runTestBacktest,
  runPatternScan,
  refreshTrades,
  loadLedgerEntries,
  loadPaperLedgerEntries,
  startPaperSimulation,
  stopPaperSimulation,
  resetPaperSimulation,
  loadDerivAccounts,
  switchDerivAccount,
} from './store';
import './marketChooser.css';
import { confidenceForSetup, exactCandidateForSetup, rankMarketsForSetup, strongestManualSetup, strongestManualSetupForBarrier } from './manualMarketRanking';

type Page = 'home' | 'bot' | 'history' | 'backtest' | 'account';
type ActivitySource = 'manual' | 'bot' | 'paper' | 'backtest';
type ActivityDetail = { type: 'trade'; trade: TradeRow } | { type: 'run'; run: TestRunRow };

function sourceForTrade(trade: TradeRow): ActivitySource {
  if (trade.origin === 'manual' || trade.reason === 'manual') return 'manual';
  return trade.origin === 'paper' ? 'paper' : 'bot';
}

function sourceLabel(source: ActivitySource): string {
  return source === 'backtest' ? 'Backtest' : source === 'paper' ? 'Paper' : source === 'manual' ? 'Manual' : 'Bot';
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
  const [page, setPage] = useState<Page>('home');

  useEffect(() => {
    if (page === 'history') void refreshTrades(200);
  }, [page]);

  return (
    <>
      <main class="app" data-page={page}>
        <div class="view view-home">
          <HomePage page={page} active={page === 'home'} onNavigate={setPage} />
        </div>
        <div class="desk-side">
          {page === 'bot' && <div class="view view-bot"><BotPage /></div>}
          {page === 'history' && <div class="view view-history"><HistoryPage /></div>}
          {page === 'backtest' && <div class="view view-backtest"><TestLabPage /></div>}
          {page === 'account' && <div class="view view-account"><AccountPage /></div>}
        </div>
      </main>
      <BottomNav page={page} setPage={setPage} />
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

  const fallbackPerformance = useMemo(() => ({
    wins: s.trades.filter((t) => t.status === 'won').length,
    losses: s.trades.filter((t) => t.status === 'lost').length,
    pushes: s.trades.filter((t) => t.status === 'push' || t.status === 'expired' || t.status === 'timeout').length,
    profit: s.trades.reduce((acc, t) => acc + (t.profit ?? 0), 0),
  }), [s.trades]);
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
    for (const trade of s.trades) {
      const current = totals.get(trade.market) ?? { count: 0, profit: 0 };
      current.count += 1;
      current.profit += trade.profit ?? 0;
      totals.set(trade.market, current);
    }
    return totals;
  }, [s.trades]);

  const currentStreak = useMemo(() => {
    let streak = 0;
    for (const t of s.trades) {
      if (t.status === 'lost' || t.status === 'error') break;
      if (t.status === 'won') streak += 1;
    }
    return streak;
  }, [s.trades]);

  useEffect(() => {
    void loadTestRuns();
  }, []);

  const recentItems = useMemo(() => s.trades
    .map((trade) => ({ type: 'trade' as const, ts: trade.ts, trade }))
    .sort((a, b) => b.ts - a.ts)
    .slice(0, 5), [s.trades]);
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

  const resetPerformanceTotals = async () => {
    if (resettingPerformance || !window.confirm('Reset dashboard performance totals? Trade history will be kept.')) return;
    setResettingPerformance(true);
    try {
      await resetPerformance();
    } finally {
      setResettingPerformance(false);
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
            <button class={`nav-link${page === 'bot' ? ' active' : ''}`} onClick={() => onNavigate('bot')}>Bot</button>
            <button class={`nav-link${page === 'backtest' ? ' active' : ''}`} onClick={() => onNavigate('backtest')}>Backtest</button>
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
            />

            <div class="manual-slot">
              {!automation && !decision && (
                <div class="side-selector">
                  <button
                    class={`side-btn over${manualDirection === 'over' ? ' active' : ''}`}
                    disabled={guest || !market || manualBusy}
                    onClick={() => void placeManual('over', manualOverBarrier)}
                  >
                    <span class="side-name">Over {manualOverBarrier}</span>
                    <span class="side-odds">{shortMarketName(market?.display ?? market?.symbol ?? '')} · Entry {fmtMoney(manualStake, s.session?.currency)}</span>
                  </button>
                  <button
                    class={`side-btn under${manualDirection === 'under' ? ' active' : ''}`}
                    disabled={guest || !market || manualBusy}
                    onClick={() => void placeManual('under', manualUnderBarrier)}
                  >
                    <span class="side-name">Under {manualUnderBarrier}</span>
                    <span class="side-odds">{shortMarketName(market?.display ?? market?.symbol ?? '')} · Entry {fmtMoney(manualStake, s.session?.currency)}</span>
                  </button>
                  <div class={`manual-msg${manualError ? ' error' : ''}`} aria-live="polite">{manualMsg}</div>
                </div>
              )}
            </div>

            <div class="bot-feedback" aria-live="polite">{startError && <div class="bot-error">{startError}</div>}</div>

            <button class={`bot-control${automation ? ' running' : ''}`} disabled={!automation && cooldownLeft > 0 && !guest} onClick={() => void toggleBot()}>
              <Icon name={automation ? 'square' : 'play'} size={14} strokeWidth={2.2} />
              <span>{automation ? 'Stop Bot' : guest ? 'Connect Deriv to trade' : cooldownLeft > 0 ? `Start in ${cooldownLeft}s` : 'Start Bot'}</span>
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
              {s.trades.length === 0 && <div class="empty-hint">No trades yet – start the bot</div>}
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
  const label = trade.contract_type === 'DIGITOVER' ? `Over ${trade.barrier}` : `Under ${trade.barrier}`;
  const pnl = trade.profit ?? 0;
  const liveDigit = market?.lastDigit != null && market.lastDigit >= 0 ? market.lastDigit : null;
  const entryDigit = trade.entry_digit != null && trade.entry_digit >= 0 ? trade.entry_digit : '–';
  const currentDigit = pend && liveDigit != null ? liveDigit : trade.exit_digit != null && trade.exit_digit >= 0 ? trade.exit_digit : '–';
  const currentLabel = pend ? 'Live' : 'Exit';
  const currentSpot = pend ? market?.lastQuote : trade.exit_spot;
  const formatSpot = (value?: number | null) => value != null && Number.isFinite(value)
    ? value.toLocaleString(undefined, { maximumFractionDigits: 5 })
    : '--';

  const tone = win ? 'win' : loss ? 'loss' : 'push';
  const time = new Date(trade.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const resultText = win ? 'Won' : loss ? 'Lost' : exp ? 'Push' : err ? 'Error' : 'Open';
  const source = sourceForTrade(trade);

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
        <div class="activity-track" aria-label={`Entry digit ${entryDigit}, ${currentLabel.toLowerCase()} digit ${currentDigit}`}>
          <div class="activity-point">
            <span class="activity-point-label">Entry</span>
            <strong class="activity-point-digit">{entryDigit}</strong>
            <span class="activity-point-quote">{formatSpot(trade.entry_spot)}</span>
          </div>
          <span class="activity-track-arrow" aria-hidden="true">→</span>
          <div class={`activity-point ${pend ? 'live' : tone}`}>
            <span class="activity-point-label">{currentLabel}</span>
            <strong class="activity-point-digit">{currentDigit}</strong>
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
  const exactPath = trade?.entry_spot != null && trade.exit_spot != null;
  const path = trade ? (exactPath ? [trade.entry_spot!, trade.exit_spot!] : market?.recentQuotes ?? []) : equity[`${run?.kind}-${run?.strategy_mode}-${run?.bot_mode}`] ?? [0, run?.net_pnl ?? 0];
  const title = trade ? `${trade.contract_type === 'DIGITOVER' ? 'Over' : 'Under'} ${trade.barrier}` : run?.kind === 'backtest' ? 'Backtest run' : 'Paper sweep';
  const storedEstimate = trade != null && Number.isFinite(trade.est_win) && trade.est_win > 0 && trade.est_win < 1;
  const baselineEstimate = trade
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
            <Detail label="Estimated win" value={`${(estimatedWin * 100).toFixed(1)}%${storedEstimate ? '' : ' baseline'}`} />
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
  const chart = useMemo(() => {
    const quotes = (market?.recentQuotes ?? []).filter((quote) => Number.isFinite(quote) && quote > 0);
    const first = quotes[0] ?? 0;
    const last = quotes[quotes.length - 1] ?? market?.lastQuote ?? 0;
    const change = last - first;
    const width = 260;
    const height = 146;
    const pad = 7;
    const min = quotes.length ? Math.min(...quotes) : 0;
    const range = quotes.length ? Math.max(...quotes) - min || 1 : 1;
    const stepX = quotes.length > 1 ? (width - pad * 2) / (quotes.length - 1) : 0;
    const line = quotes.map((quote, index) => {
      const x = pad + index * stepX;
      const y = height - pad - ((quote - min) / range) * (height - pad * 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    });
    return {
      area: line.length ? `M${line.join(' L')} L${width - pad},${height - pad} L${pad},${height - pad} Z` : '',
      changePct: first > 0 ? (change / first) * 100 : 0,
      height,
      last,
      line,
      quotesLength: quotes.length,
      up: change >= 0,
      width,
    };
  }, [market?.recentQuotes, market?.lastQuote]);
  const { area, changePct, height, last, line, quotesLength, up, width } = chart;

  return (
    <button id="market-pulse-trigger" type="button" class={`market-pulse${up ? ' up' : ' down'}`} aria-label="Choose a market and manual barrier from the live quote chart" onClick={onChoose}>
      <div class="market-pulse-head">
        <span class="market-pulse-label">Live quote</span>
        <span class={`market-pulse-change${up ? ' up' : ' down'}`}>{quotesLength > 1 ? `${up ? '+' : ''}${changePct.toFixed(2)}%` : '--'}</span>
      </div>
      <div class="market-pulse-chart">
        {line.length > 1 ? (
          <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label={`${shortMarketName(market?.display ?? 'market')} recent quote movement`}>
            <defs>
              <linearGradient id="market-pulse-fill" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0" stopColor="currentColor" stopOpacity=".22" />
                <stop offset="1" stopColor="currentColor" stopOpacity="0" />
              </linearGradient>
            </defs>
            <path class="market-pulse-area" d={area} />
            <path class="market-pulse-line" d={`M${line.join(' L')}`} />
            <circle class="market-pulse-dot" cx={line[line.length - 1]?.split(',')[0]} cy={line[line.length - 1]?.split(',')[1]} r="3" />
          </svg>
        ) : (
          <span class="market-pulse-empty">Awaiting ticks</span>
        )}
      </div>
      <div class="market-pulse-foot">
        <span>{shortMarketName(market?.display ?? 'Selected market')}</span>
        <b>{last > 0 ? last.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '--'}</b>
      </div>
    </button>
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
  onClose: () => void;
}): JSX.Element {
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

  return (
    <section class="inline-market-chooser" aria-label="Manual market and barrier setup">
      <div class="inline-chooser-head">
        <span>Manual setup</span>
        <button type="button" onClick={onClose} aria-label="Return to live chart">×</button>
      </div>
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
          <button type="button" onClick={useStrongestForBarrier} disabled={!ranked.length}>Best for barrier {barrier}</button>
          <button type="button" class="secondary" onClick={useStrongest} disabled={!ranked.length}>Best overall</button>
        </div>
      </div>
      <p>Use the existing buttons below to place this setup.</p>
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
  const cooldownLeft = useBotCooldown();
  const automation = s.automation?.running ?? false;

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

        {error && <div class="bot-error">{error}</div>}

        <button class="bot-control" disabled={!automation && cooldownLeft > 0} onClick={() => void toggleBot()}>
          <Icon name={automation ? 'square' : 'play'} size={14} strokeWidth={2.2} />
          <span>{automation ? 'Stop Bot' : cooldownLeft > 0 ? `Start in ${cooldownLeft}s` : 'Start Bot'}</span>
        </button>
      </div>
    </>
  );
}

/* ---------------- history ---------------- */

type Filter = 'all' | 'wins' | 'losses' | 'over' | 'under';

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
  const wins = trades.filter((t) => t.status === 'won').length;
  const losses = trades.filter((t) => t.status === 'lost').length;
  const total = trades.length;
  const winRate = wins + losses > 0 ? (wins / (wins + losses)) * 100 : 0;
  const netProfit = trades.reduce((acc, t) => acc + (t.profit ?? 0), 0);
  const totalStaked = trades.reduce((acc, t) => acc + (t.stake ?? 0), 0);
  const paid = trades.filter((t) => t.payout != null);
  const avgPayout = paid.length ? paid.reduce((acc, t) => acc + (t.payout ?? 0), 0) / paid.length : 0;
  const currency = s.session?.currency ?? '';

  const ordered = [...trades].reverse();
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

  const over = trades.filter((t) => t.contract_type === 'DIGITOVER');
  const under = trades.filter((t) => t.contract_type === 'DIGITUNDER');
  const overWins = over.filter((t) => t.status === 'won').length;
  const underWins = under.filter((t) => t.status === 'won').length;
  const overRate = over.length ? (overWins / over.length) * 100 : 0;
  const underRate = under.length ? (underWins / under.length) * 100 : 0;

  const byMarket = new Map<string, { count: number; wins: number; net: number }>();
  for (const t of trades) {
    const e = byMarket.get(t.market) ?? { count: 0, wins: 0, net: 0 };
    e.count += 1;
    if (t.status === 'won') e.wins += 1;
    e.net += t.profit ?? 0;
    byMarket.set(t.market, e);
  }

  const filtered = trades.filter((t) => {
    if (filter === 'wins') return t.status === 'won';
    if (filter === 'losses') return t.status === 'lost';
    if (filter === 'over') return t.contract_type === 'DIGITOVER';
    if (filter === 'under') return t.contract_type === 'DIGITUNDER';
    return true;
  });

  const chips: { key: Filter; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'wins', label: 'Wins' },
    { key: 'losses', label: 'Losses' },
    { key: 'over', label: 'Over 0' },
    { key: 'under', label: 'Under 9' },
  ];

  return (
    <>
      <header class="header">
        <div class="page-title">History</div>
      </header>

      <div class="metric-grid">
        <Metric label="Win Rate" value={`${winRate.toFixed(1)}%`} tone={winRate >= 50 ? 'up' : 'down'} />
        <Metric label="Total Trades" value={String(total)} />
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
        <div class="section-title">Over / Under</div>
        <Bar label="Over 0" rate={overRate} count={over.length} tone="over" />
        <Bar label="Under 9" rate={underRate} count={under.length} tone="under" />
      </div>

      <div class="section">
        <div class="section-title">Markets</div>
        {byMarket.size === 0 && <div class="empty-hint">No trades yet</div>}
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
        {filtered.length === 0 && <div class="empty-hint">No trades yet</div>}
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
    if (owner) void loadPaperLedgerEntries(300);
  }, [owner, paperSimulation?.totalTrades]);

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
      <LedgerSection entries={s.paperLedgerEntries} currency="V$" />
      {runs.length === 0 && !busy && <div class="empty-hint">No global paper research runs have been recorded yet.</div>}
      <LabCards runs={runs} equity={s.testEquity} kind="paper" busy={busy} />
    </>
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
        <div class="subtitle">Backtest the replay · sweep the demo · learn the patterns</div>
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
        <button class={`nav-item bot${page === 'bot' ? ' active' : ''}`} onClick={() => setPage('bot')}>
          <span class="nav-bot-circle">
            <Icon name={automation ? 'square' : 'play'} size={15} strokeWidth={2.4} />
          </span>
          Bot
        </button>
        <button class={`nav-item${page === 'backtest' ? ' active' : ''}`} onClick={() => setPage('backtest')}>
          <Icon name="stats" size={20} />
          Backtest
        </button>
        <button class={`nav-item${page === 'account' ? ' active' : ''}`} onClick={() => setPage('account')}>
          <Icon name="account" size={20} />
          Account
        </button>
      </nav>
    </div>
  );
}
