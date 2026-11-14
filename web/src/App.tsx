import { memo } from 'preact/compat';
import { useDialogFocus } from './useDialogFocus';
import { maySkipCowReview } from './realCowConsent';
import { nextPastureRoom } from './authState';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import type { Market, TradeRow, LedgerEntry, Settings, SignalCandidate, QuoteEvt, Decision, ContractEvt, Recovery, TestRunRow, TestLabActive, PatternRow, DerivAccountInfo, SessionInfo, AutomationState, MomentumScanMarket, MomentumScanSample, MomentumCandle, MomentumResearchRow, MomentumTradePurchase, MomentumTradeClose, PaperTrade, PaperPortfolio, MultiplierOptionsResult, EntryLabMethod, EntryLabProduct, ManualTradePreview, ManualTradeResult } from './store';
import { MomentumPriceChart } from './MomentumPriceChart';
import { PaperSimulationStage, type PaperSimulationPhase } from './PaperSimulationStage';
import { MarketPulseChart } from './MarketPulseChart';
import {
  useStore,
  connectWs,
  connectPat,
  unlockDashboard,
  oauthStart,
  logout,
  arm,
  disarmRangerAutomation,
  stopAutomation,
  selectMarket,
  manualTrade,
  previewManualTrade,
  confirmManualTrade,
  previewPlayerTrade,
  confirmPlayerTrade,
  refreshPlayerState,
  logoutPlayer,
  resetPerformance,
  updateSettings,
  loadTestRuns,
  loadPatternsData,
  loadEntryLabState,
  loadAutoBacktestStatus,
  runTestBacktest,
  runPatternScan,
  refreshTrades,
  fetchTradeHistoryPage,
  clearStuckTrade,
  syncCoreState,
  loadLedgerEntries,
  loadPaperTrade,
  loadPaperTrades,
  startPaperSimulation,
  resetPaperSimulation,
  loadDerivAccounts,
  loadPlayerAccounts,
  selectPlayerAccount,
  switchDerivAccount,
  cashOutAccountOpenContract,
  cashOutAllAccountOpenContracts,
  loadMomentumState,
  startMomentumResearch,
  stopMomentumResearch,
  focusMomentumMarket,
  placeMomentumDemoTrade,
  closeMomentumDemoTrade,
  loadMultiplierOptions,
} from './store';
import './marketChooser.css';
import { assessTimedManualEntry, confidenceForSetup, confirmedDigitTriggerProgress, exactCandidateForSetup, matchesDigitTrigger, priorityManualTargets, rankMarketsForSetup, strongestManualSetup, strongestManualSetupForBarrier, theoreticalWinForSetup, type ManualEntryMode, type ManualSetup } from './manualMarketRanking';
import { HowToPlayPage } from './HowToPlayPage';

type Page = 'home' | 'history' | 'backtest' | 'account' | 'howToPlay' | 'privacy' | 'terms' | 'refunds' | 'cookies';
type ActivitySource = 'manual' | 'bot' | 'paper' | 'backtest';
type ActivityDetail = { type: 'trade'; trade: TradeRow } | { type: 'run'; run: TestRunRow };

const PAGE_PATHS: Record<Page, string> = {
  home: '/',
  history: '/history',
  backtest: '/lab',
  account: '/account',
  privacy: '/privacy',
  howToPlay: '/how-to-play',
  terms: '/terms',
  refunds: '/refunds',
  cookies: '/cookies',
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

function multiplierTradeFamily(trade: TradeRow): 'Gold' | 'Multiplier' {
  return /gold/i.test(`${trade.reason ?? ''} ${trade.market ?? ''}`) ? 'Gold' : 'Multiplier';
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

/** Optional UI preferences never block rendering when storage is unavailable. */
function useViewPreference<T extends string>(key: string, fallback: T, allowed: readonly T[]): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const saved = localStorage.getItem(`zeronine:ui:${key}`) as T | null;
      return saved !== null && allowed.includes(saved) ? saved : fallback;
    } catch { return fallback; }
  });
  const update = (next: T) => {
    setValue(next);
    try { localStorage.setItem(`zeronine:ui:${key}`, next); } catch { /* Browser preference only. */ }
  };
  return [value, update];
}

function multiplierLimitPrice(entry: number | undefined, amount: number | undefined, stake: number, multiplier: number, side: 'up' | 'down' | 'BUY' | 'SELL', kind: 'takeProfit' | 'stopLoss'): number | undefined {
  if (!Number.isFinite(entry) || !Number.isFinite(amount) || !Number.isFinite(stake) || !Number.isFinite(multiplier) || entry! <= 0 || amount! <= 0 || stake <= 0 || multiplier <= 0) return undefined;
  const long = side === 'up' || side === 'BUY';
  const favourable = kind === 'takeProfit';
  const sign = (long === favourable) ? 1 : -1;
  return Math.max(Number.EPSILON, entry! * (1 + sign * (amount! / (stake * multiplier))));
}

function multiplierLimitAmount(entry: number | undefined, price: number, stake: number, multiplier: number): number | undefined {
  if (!Number.isFinite(entry) || !Number.isFinite(price) || !Number.isFinite(stake) || !Number.isFinite(multiplier) || entry! <= 0 || stake <= 0 || multiplier <= 0) return undefined;
  return Math.max(.01, Math.abs((price - entry!) / entry!) * stake * multiplier);
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
  menu: <path d="M4 6.5h16M4 12h16M4 17.5h16" />,
  bookOpen: (
    <>
      <path d="M12 7c-2.2-1.6-5.3-2-8-1v13c2.7-1 5.8-.6 8 1 2.2-1.6 5.3-2 8-1V6c-2.7-1-5.8-.6-8 1Z" />
      <path d="M12 7v13" />
    </>
  ),
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
  const s = useStore();
  const [page, setPage] = useState<Page>(() => pageFromPath(window.location.pathname));
  const [legalStripDismissed, setLegalStripDismissed] = useState(false);
  useEffect(() => { if (['/gold', '/bot'].includes(window.location.pathname.replace(/\/+$/, ''))) window.history.replaceState(null, '', '/'); }, []);
  const [enteringPasture, setEnteringPasture] = useState(false);
  const oauthReturn = useRef(new URLSearchParams(window.location.search).get('oauth') === 'ok');

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
  const dismissLegalStrip = useCallback(() => {
    setLegalStripDismissed(true);
  }, []);
  const enterPasture = useCallback(() => {
    setEnteringPasture(true);
    navigate('home');
  }, [navigate]);

  useEffect(() => {
    if (!oauthReturn.current || !s.session) return;
    oauthReturn.current = false;
    const url = new URL(window.location.href);
    url.searchParams.delete('oauth');
    window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
    enterPasture();
  }, [s.session, enterPasture]);

  useEffect(() => {
    if (!enteringPasture) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const timer = window.setTimeout(() => setEnteringPasture(false), reduced ? 400 : 2200);
    return () => window.clearTimeout(timer);
  }, [enteringPasture]);

  useEffect(() => {
    if (page === 'history') void refreshTrades(200);
  }, [page]);

  useEffect(() => {
    const labels: Record<Page, string> = {
      home: 'Deriv Cows', history: 'Trade history', backtest: 'Research lab', account: 'Account',
      privacy: 'Privacy policy', terms: 'Terms of use', refunds: 'Refund policy', cookies: 'Cookie and storage policy',
      howToPlay: 'How to play',
    };
    document.title = page === 'home' ? 'Deriv Cows' : `${labels[page]} | Deriv Cows`;
  }, [page]);

  return (
    <>
      <a class="skip-link" href="#main-content">Skip to main content</a>
      <main class="app" id="main-content" data-page={page === 'history' || page === 'account' ? 'home' : page} tabIndex={-1}>
        <div class="view view-home">
          <HomePage page={page} active={page === 'home' || page === 'history' || page === 'account'} onNavigate={navigate} />
        </div>
        <div class="desk-side">
          {page === 'backtest' && <div class="view view-backtest"><TestLabPage /></div>}
          {(['privacy', 'terms', 'refunds', 'cookies'] as const).includes(page as 'privacy' | 'terms' | 'refunds' | 'cookies') && <div class="view view-legal"><LegalPage page={page as LegalPageId} /></div>}
          {page === 'howToPlay' && <div class="view view-how-to-play"><HowToPlayPage onBack={() => navigate('home')} onConnect={() => navigate('account')} /></div>}
        </div>
        {(page === 'history' || page === 'account') && <aside class="pasture-detail-panel" aria-label={page === 'history' ? 'Trade history' : 'Account'}>
          <header class="pasture-detail-heading"><div><small>DERIV COWS</small><h2>{page === 'history' ? 'Trade history' : 'Account'}</h2></div><button type="button" aria-label="Close details" onClick={() => navigate('home')}><Icon name="x" size={19} /></button></header>
          <div class="pasture-detail-content">{page === 'history' ? <PastureHistory /> : <AccountPage onConnected={enterPasture} />}</div>
        </aside>}
        {!legalStripDismissed && <LegalQuickLinks onDismiss={dismissLegalStrip} />}
      </main>
      <BottomNav page={page} setPage={navigate} />
      {enteringPasture && <div class="pasture-enter" role="status" aria-live="polite"><div class="pasture-enter-sun" aria-hidden="true" /><div class="pasture-enter-land" aria-hidden="true" /><div class="pasture-enter-content"><span class="pasture-enter-cow"><PastureIcon kind="cow" /></span><span class="pasture-enter-kicker">ACCOUNT CONNECTED</span><strong>Welcome to the pasture.</strong><small>Getting your ranger ready…</small><span class="pasture-enter-track" aria-hidden="true"><i /></span></div></div>}
    </>
  );
}

function PastureIcon({ kind }: { kind: 'cow' | 'arrow' }): JSX.Element {
  return kind === 'arrow' ? <svg viewBox="0 0 32 32" aria-hidden="true"><path d="M4 27 25 6M20 5h7v7M5 20l7 7M6 25l-2 3 4-1" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" /></svg> : <svg viewBox="0 0 32 32" aria-hidden="true"><path d="M7 12 3 7l6 1m16 4 4-5-6 1" fill="#ba7950" stroke="#543323" stroke-width="1.5" stroke-linejoin="round" /><path d="M6 17c0-8 4-12 10-12s10 4 10 12v5c0 5-4 7-10 7S6 27 6 22z" fill="#fff0cf" stroke="#543323" stroke-width="1.5" /><circle cx="11" cy="16" r="1.5" fill="#35231d" /><circle cx="21" cy="16" r="1.5" fill="#35231d" /><ellipse cx="16" cy="23" rx="7" ry="4.5" fill="#f29891" /><circle cx="13" cy="23" r=".9" fill="#814c44" /><circle cx="19" cy="23" r=".9" fill="#814c44" /></svg>;
}

function ConnectView({ embedded = false, onConnected }: { embedded?: boolean; onConnected?: () => void }): JSX.Element {
  const s = useStore();
  const [token, setToken] = useState('');
  const [ownerToken, setOwnerToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [oauthBusy, setOauthBusy] = useState(false);
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [playerSession, setPlayerSession] = useState<{ loginid: string; balance: number; currency: string; mode: string } | null>(null);
  useEffect(() => {
    let active = true;
    fetch('/api/player/session', { credentials: 'same-origin' }).then(response => response.ok ? response.json() : null)
      .then(result => { if (active) setPlayerSession(result?.session ?? null); }).catch(() => {});
    return () => { active = false; };
  }, []);

  const content = (
    <>
      <div class="connect-hero">
        <div class="connect-kicker">
          <span class="connect-kicker-dot" aria-hidden="true" />
          <span>Your trading pasture</span>
        </div>
        <h1>Welcome to<br />the pasture.</h1>
        <p>Choose a market cow and send your ranger after it. Once Deriv is connected, defeating a target can start a trade. Enjoy the pasture during your break.</p>
        <div class="connect-features" aria-label="Ways to play">
          <span><PastureIcon kind="cow" /> Guest play: no bets</span>
          <span><PastureIcon kind="arrow" /> Connect Deriv to trade</span>
        </div>
        <div class="connect-scene" role="img" aria-label="Practice animation: a ranger shoots a cow, misses once, then a virtual trade wins. No real bet is placed.">
          <div class="practice-scene-label">PRACTICE <span>NO REAL BET</span></div>
          <div class="practice-market"><strong>VOL 100 · OVER 1</strong><span>$1.00 virtual</span><div class="practice-health"><i /></div></div>
          <div class="practice-balance" aria-hidden="true"><small>VIRTUAL BALANCE</small><strong class="practice-balance-before">$25.00</strong><strong class="practice-balance-after">$25.80</strong></div>
          <div class="practice-miss" aria-hidden="true">MISS</div>
          <div class="practice-result practice-open" aria-hidden="true"><small>VIRTUAL TRADE</small><strong>Digit 6 · Open</strong></div>
          <div class="practice-result practice-win" aria-hidden="true"><small>VIRTUAL RESULT</small><strong>Won +$0.80</strong></div>
          <svg class="connect-scene-art" viewBox="0 0 500 240" aria-hidden="true">
            <ellipse cx="310" cy="216" rx="140" ry="13" fill="#244e2b" opacity=".38" />
            <g class="practice-ranger"><ellipse cx="62" cy="218" rx="29" ry="7" fill="#244e2b" opacity=".35"/><path d="M44 175v35h13v-35m12 0v35h13v-35" fill="#393a3d" stroke="#28332f" stroke-width="3"/><path d="M40 205h20v9H40zm29 0h20v9H69z" fill="#5d4530"/><path d="M40 114h45l3 66H39z" fill="#326db1" stroke="#224470" stroke-width="4"/><path d="M40 165h47v7H40z" fill="#866338"/><path d="M37 111 27 82 16 100l8 24" fill="#7c4934"/><circle cx="63" cy="93" r="22" fill="#cba17d"/><path d="M41 88q2-24 22-24t22 22l-12-10-16 8z" fill="#4d3729"/><circle cx="65" cy="92" r="2" fill="#271f1d"/><circle cx="75" cy="92" r="2" fill="#271f1d"/><path d="M45 126 61 137l19-12M80 125l24-4" fill="none" stroke="#c69b75" stroke-width="9" stroke-linecap="round"/><g class="practice-bow"><path d="M101 93q30 26 0 58" fill="none" stroke="#925d32" stroke-width="6" stroke-linecap="round"/><path d="M101 93v58" fill="none" stroke="#fff0cb" stroke-width="2"/></g></g>
            <g transform="translate(0 35) scale(1.35)"><g class="connect-scene-cow">
              <path d="M157 97 147 133h17l7-31m75-1 5 32h17l-3-46" fill="#e4c99f" stroke="#553524" stroke-width="4" stroke-linejoin="round" />
              <path d="M144 71q-24 4-26 27-2 9-11 8" fill="none" stroke="#f4dfb6" stroke-width="6" stroke-linecap="round" />
              <ellipse cx="210" cy="76" rx="71" ry="46" fill="#fff0cb" stroke="#553524" stroke-width="4" />
              <path d="M170 41q-22 17-17 46l19 11 16-16-5-19 10-13zM238 36q22 8 32 25l-7 30-20 6-11-17 9-20z" fill="#895238" />
              <circle cx="203" cy="75" r="24" fill="#ed3544" /><circle cx="203" cy="75" r="15" fill="#fff1cf" /><circle cx="203" cy="75" r="7" fill="#ed3544" />
              <path d="M267 45 256 23l25 10m21 10 13-18-3 27" fill="#bd875a" stroke="#553524" stroke-width="3" stroke-linejoin="round" />
              <path d="M255 54q16-27 40-18 27 11 28 37l-12 28h-46q-20-10-10-47z" fill="#fff0cb" stroke="#553524" stroke-width="4" />
              <g class="practice-eyes"><circle cx="281" cy="61" r="4" fill="#39271d" /><circle cx="307" cy="62" r="4" fill="#39271d" /></g><g class="practice-dead-eyes" fill="none" stroke="#39271d" stroke-width="3" stroke-linecap="round"><path d="m277 57 8 8m0-8-8 8m26-7 8 8m0-8-8 8" /></g>
              <ellipse cx="298" cy="89" rx="26" ry="16" fill="#f49691" stroke="#a7625a" stroke-width="2" /><circle cx="289" cy="89" r="3" fill="#8b514b" /><circle cx="307" cy="89" r="3" fill="#8b514b" />
            </g></g>
            {[1, 2, 3, 4].map((shot) => <g class={`practice-arrow shot-${shot}`} key={shot}><path d="M0 0h52" stroke="#543624" stroke-width="4" stroke-linecap="round"/><path d="m52 0-12-7v14z" fill="#e92b43"/><path d="M11 0 2-7H-8L0 0l-8 7H2z" fill="#e92b43"/></g>)}
          </svg>
        </div>
        <a class="connect-play-link" href="/">← Back to the pasture</a>
      </div>

      <div class="connect-card">
        {s.publicDashboard && !s.owner && !s.publicDerivLogin && (
          <>
          <div class="connect-title">Owner access</div>
            <div class="connect-copy">This dashboard currently requires owner access to connect an account. Guest play is available without it.</div>
            <label class="form-label" for="owner-access-token">Dashboard owner token</label>
            <input
              id="owner-access-token"
              class="connect-input"
              type="password"
              autoComplete="off"
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
            <div class="connect-divider">then connect your account</div>
          </>
        )}
        <div class="connect-card-heading"><span class="connect-card-emblem"><PastureIcon kind="cow" /></span><div><div class="connect-eyebrow">READY WHEN YOU ARE</div><h2 class="connect-title">Connect your account</h2></div></div>
        {playerSession && <div class="connect-terms" role="status"><strong>Signed in · {playerSession.loginid}</strong><p>{playerSession.mode === 'demo' ? 'Demo' : 'Real'} account · {playerSession.currency} {playerSession.balance.toFixed(2)}</p><p>Your account stays private in the pasture.</p><button type="button" class="connect-btn" onClick={async () => { await logoutPlayer(); setPlayerSession(null); }}>Sign out</button></div>}
        <div class="connect-copy">Sign in to use your demo or real Deriv account. You can explore and shoot cows as a guest; guest shots never place bets.</div>
        <section class="connect-terms" aria-label="Trading information and terms">
          <strong>Before you enter the pasture</strong>
          <p>Trading can result in the loss of your investment. Signals, backtests and game visuals are informational and are not trading or financial advice; results are not guaranteed.</p>
          <p>Use only an account you are authorized to access and follow Deriv’s applicable rules.</p>
          <div class="connect-terms-links"><a href="/terms" target="_blank" rel="noopener noreferrer">Our terms</a><a href="https://deriv.com/terms-and-conditions/general-terms-of-use" target="_blank" rel="noopener noreferrer">Deriv terms</a><a href="https://deriv.com/terms-and-conditions/trading-terms" target="_blank" rel="noopener noreferrer">Trading rules</a><a href="https://deriv.com/terms-and-conditions/risk-disclosure" target="_blank" rel="noopener noreferrer">Risk disclosure</a></div>
          <label class="connect-terms-consent"><input type="checkbox" checked={acceptedTerms} onChange={(event) => setAcceptedTerms(event.currentTarget.checked)} /><span>I have read and agree to the terms and acknowledge the trading risks.</span></label>
        </section>
        <button
          class="connect-btn connect-btn--oauth"
          disabled={!acceptedTerms || oauthBusy || (s.publicDashboard && !s.owner && !s.publicDerivLogin)}
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
          <svg class="connect-deriv-mark" viewBox="0 0 32 32" aria-hidden="true"><path d="M3 4h13c3 0 5 1 7 4l6 8-6 8c-2 3-4 4-7 4H3l12-12z" fill="currentColor" /></svg>
          <span>{oauthBusy ? 'Opening Deriv…' : 'Continue with Deriv'}</span>
        </button>
        <div class="connect-oauth-note">You’ll securely sign in with Deriv, then return here.</div>
        <div class="connect-divider">or use an API token</div>
        <label class="form-label" for="deriv-api-token">Deriv API token</label>
        <input
          id="deriv-api-token"
          class="connect-input"
          type="password"
          autoComplete="off"
          placeholder="Paste your Deriv API token"
          value={token}
          onInput={(e: any) => setToken(e.currentTarget.value)}
        />
        <button
          class="connect-btn"
          disabled={!acceptedTerms || busy || !token.trim() || (s.publicDashboard && !s.owner)}
          onClick={async () => {
            setBusy(true);
            setError('');
            try {
              await connectPat(token.trim());
              setToken('');
              onConnected?.();
            } catch (e) {
              setError(String(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? 'Connecting…' : 'Connect with token'}
        </button>
        {error && <div class="connect-err" role="alert">{error}</div>}
        <div class="connect-hint">For token sign-in, use a Deriv API token with trading permission.</div>
        {s.ws === 'closed' && <div class="connect-err">Feed disconnected – reconnecting…</div>}
      </div>
    </>
  );
  return embedded ? <div class="connect-embedded">{content}</div> : <main class="app app--page">{content}</main>;
}

/* ---------------- home ---------------- */

interface TimedManualIntent extends ManualSetup {
  stake: number;
  entryMode: ManualEntryMode;
  armedAfterEpoch: number;
  expiresAt: number;
  twoPassStage?: 0 | 1 | 2 | 3;
  firstTriggerQuote?: number;
  firstTriggerDigit?: number;
  followThroughQuote?: number;
  followThroughDigit?: number;
  reentryQuote?: number;
  reentryDigit?: number;
  lastObservedEpoch?: number;
  lastObservedQuote?: number;
}

interface ManualExecutionView {
  stage: 'idle' | 'quoting' | 'review' | 'buying' | 'purchased' | 'settled' | 'failed';
  trade?: ManualTradeResult['trade'];
  message?: string;
}

type QuickAccountOption = Pick<DerivAccountInfo, 'accountId' | 'mode' | 'currency' | 'balance'>;

function QuickAccountMenu({ session, isPlayer, onNavigate }: { session: SessionInfo | null; isPlayer: boolean; onNavigate: (p: Page) => void }): JSX.Element {
  const [open, setOpen] = useState(false);
  const [accounts, setAccounts] = useState<QuickAccountOption[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const requestGeneration = useRef(0);
  useEffect(() => {
    requestGeneration.current++;
    setOpen(false);
    setAccounts([]);
    setBusy(false);
    setError('');
    return () => { requestGeneration.current++; };
  }, [session?.loginid, isPlayer]);
  const toggle = () => {
    if (open) { requestGeneration.current++; setOpen(false); setBusy(false); return; }
    setOpen(true);
    setError('');
    setAccounts([]);
    if (!session) return;
    setBusy(true);
    const generation = ++requestGeneration.current;
    const request = isPlayer ? loadPlayerAccounts() : loadDerivAccounts();
    void request.then((list) => { if (generation === requestGeneration.current) setAccounts(list); })
      .catch((err) => { if (generation === requestGeneration.current) setError(err instanceof Error ? err.message : String(err)); })
      .finally(() => { if (generation === requestGeneration.current) setBusy(false); });
  };
  const choose = async (account: QuickAccountOption) => {
    if (busy || account.accountId === session?.loginid) return;
    setBusy(true);
    setError('');
    const generation = ++requestGeneration.current;
    try {
      if (isPlayer) await selectPlayerAccount(account.accountId);
      else await switchDerivAccount(account.accountId);
      if (generation === requestGeneration.current) setOpen(false);
    }
    catch (err) { if (generation === requestGeneration.current) setError(err instanceof Error ? err.message : String(err)); }
    finally { if (generation === requestGeneration.current) setBusy(false); }
  };
  return <div class="balance quick-account">
    <div class="balance-amount">{fmtMoney(session?.balance ?? 0, session?.currency)}</div>
    <button class="balance-add" type="button" onClick={toggle} aria-label="Choose Deriv account" aria-expanded={open} aria-controls="quick-account-menu"><Icon name="plus" size={14} strokeWidth={2.2} /></button>
    {open && <div id="quick-account-menu" class="quick-account-menu" role="region" aria-label="Choose Deriv account">
      <div class="quick-account-heading">Switch account <button type="button" onClick={() => setOpen(false)} aria-label="Close account menu">×</button></div>
      {!session ? <button type="button" onClick={() => { setOpen(false); onNavigate('account'); }}>Connect Deriv</button> : <>
        {busy && <p role="status">Loading or switching account…</p>}
        {!busy && !accounts.length && !error && <p>No accounts available.</p>}
        {accounts.map(account => <button type="button" key={account.accountId} disabled={busy || account.accountId === session.loginid} onClick={() => void choose(account)}>
          <span><strong>{account.mode === 'real' ? 'Real' : 'Demo'}</strong><small>{account.accountId} · {account.currency}</small></span>
          <b>{account.accountId === session.loginid ? 'Current' : fmtMoney(account.balance, account.currency)}</b>
        </button>)}
        {error && <p role="alert">{error}</p>}
        <button type="button" class="quick-account-details" onClick={() => { setOpen(false); onNavigate('account'); }}>Account settings</button>
      </>}
    </div>}
  </div>;
}

function PastureQuoteReview({ preview, busy, error, onConfirm, onCancel }: { preview: ManualTradePreview; busy: boolean; error: string; onConfirm: (remember: boolean) => void; onCancel: () => void }): JSX.Element {
  const [confirmed, setConfirmed] = useState(false);
  const [remember, setRemember] = useState(false);
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 250); return () => window.clearInterval(timer); }, []);
  const seconds = Math.max(0, Math.ceil((preview.expiresAt - now) / 1000));
  return <div class="pasture-review-backdrop">
    <section class="pasture-review" role="dialog" aria-modal="true" aria-labelledby="pasture-review-title">
      <span class="pasture-review-kicker">{preview.account.mode === 'real' ? 'Real funds' : 'Demo funds'} · review required</span>
      <h2 id="pasture-review-title">{shortMarketName(preview.market.display)} · {sideLabel(preview.order.direction, preview.order.barrier)}</h2>
      <p>No bet has been placed. Review the live quote before confirming.</p>
      <div class="pasture-review-grid">
        <div><span>Stake</span><strong>{fmtMoney(preview.quote.ask, preview.account.currency)}</strong></div>
        <div><span>Payout</span><strong>{fmtMoney(preview.quote.payout, preview.account.currency)}</strong></div>
        <div><span>Potential profit</span><strong>{fmtMoney(preview.quote.potentialProfit, preview.account.currency)}</strong></div>
        <div><span>Quote</span><strong>{seconds ? `${seconds}s remaining` : 'Expired'}</strong></div>
      </div>
      <p>{preview.risk.reason}</p>
      {error && <p role="alert">{error}</p>}
      {preview.account.mode === 'real' && <label class="pasture-review-confirm"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed((event.currentTarget as HTMLInputElement).checked)} /> I understand this uses real funds.</label>}
      <label class="pasture-review-confirm"><input type="checkbox" checked={remember} onChange={(event) => setRemember((event.currentTarget as HTMLInputElement).checked)} /><span>Don't show this confirmation again on this account and browser.</span></label>
      <div class="pasture-review-actions"><button type="button" onClick={onCancel} disabled={busy}>Cancel</button><button type="button" onClick={() => onConfirm(remember)} disabled={busy || (preview.account.mode === 'real' && !confirmed) || !seconds}>{busy ? 'Confirming…' : preview.account.mode === 'real' ? 'Confirm real-money trade' : 'Confirm demo trade'}</button></div>
    </section>
  </div>;
}

function HomePage({ page, active, onNavigate }: { page: Page; active: boolean; onNavigate: (p: Page) => void }): JSX.Element {
  const base = useStore();
  const usePlayerTrading = Boolean(base.multiplayerEnabled);
  const ownerPlayerSession = base.playerSession?.loginid === base.session?.loginid ? base.playerSession : null;
  const s = { ...base, session: base.owner ? ownerPlayerSession ?? base.session : base.playerSession, trades: usePlayerTrading ? base.playerTrades : base.trades, recovery: usePlayerTrading ? base.playerRecovery : base.recovery };
  const [headerNavOpen, setHeaderNavOpen] = useState(false);
  const [rangerAutoMenuOpen, setRangerAutoMenuOpen] = useState(false);
  const [rangerAutoRunning, setRangerAutoRunning] = useState(false);
  const [settlementBusy, setSettlementBusy] = useState(false);
  const [manualBusy, setManualBusy] = useState(false);
  const [manualMsg, setManualMsg] = useState('');
  const [manualError, setManualError] = useState(false);
  const [resettingPerformance, setResettingPerformance] = useState(false);
  const [activityDetail, setActivityDetail] = useState<ActivityDetail | null>(null);
  const [roomActivity, setRoomActivity] = useState<'focus' | 'reset' | 'break'>('focus');
  const [marketChooserOpen, setMarketChooserOpen] = useState(false);
  const [manualDirection, setManualDirection] = useState<'over' | 'under'>('over');
  const [manualOverBarrier, setManualOverBarrier] = useState(0);
  const [manualUnderBarrier, setManualUnderBarrier] = useState(9);
  const [manualStakeText, setManualStakeText] = useState('');
  const [manualEntryMode, setManualEntryMode] = useState<ManualEntryMode>('model');
  const [timedManualSetup, setTimedManualSetup] = useState<ManualSetup | null>(null);
  const [pendingManualIntent, setPendingManualIntent] = useState<TimedManualIntent | null>(null);
  const [manualPreview, setManualPreview] = useState<ManualTradePreview | null>(null);
  const [rememberedAccount, setRememberedAccount] = useState<string | null>(null);
  const [showRealCowNotice, setShowRealCowNotice] = useState(false);
  const sessionRef = useRef(s.session);
  sessionRef.current = s.session;
  // The embedded pasture room follows confirmed authentication only. A 503 or
  // a reconnect must never flip the iframe to the public room (which would
  // remount it and spawn a second Ranger connection).
  const resolvedLoginId = s.session?.loginid ?? null;
  const [pastureRoom, setPastureRoom] = useState<string | null>(() => nextPastureRoom(null, resolvedLoginId, base.playerAuthStatus));
  useEffect(() => {
    setPastureRoom((previous) => nextPastureRoom(previous, resolvedLoginId, base.playerAuthStatus));
  }, [resolvedLoginId, base.playerAuthStatus]);
  useEffect(() => {
    const account = s.session?.loginid ?? null;
    const mode = s.session?.mode;
    const refreshPreference = () => {
      try {
        const key = `zeronine:${mode === 'real' ? 'real' : 'demo'}-cow-confirm:${account}`;
        setRememberedAccount(account && localStorage.getItem(key) === 'enabled' ? account : null);
      } catch { setRememberedAccount(null); }
    };
    refreshPreference();
    window.addEventListener('real-cow-preference', refreshPreference);
    window.addEventListener('storage', refreshPreference);
    return () => { window.removeEventListener('real-cow-preference', refreshPreference); window.removeEventListener('storage', refreshPreference); };
  }, [s.session?.loginid, s.session?.mode]);
  const rememberedReal = Boolean(s.session?.mode === 'real' && rememberedAccount === s.session.loginid);
  useEffect(() => { if (s.session) void refreshTrades(); }, [s.session?.loginid]);
  useEffect(() => {
    if (!active || !rememberedReal) { setShowRealCowNotice(false); return; }
    const noticeKey = `zeronine:real-cow-notice-seen:${s.session?.loginid ?? ''}`;
    try {
      if (localStorage.getItem(noticeKey) === 'seen') { setShowRealCowNotice(false); return; }
      localStorage.setItem(noticeKey, 'seen');
    } catch { /* If storage is unavailable, show the reminder for this visit only. */ }
    setShowRealCowNotice(true);
    const timer = window.setTimeout(() => setShowRealCowNotice(false), 10_000);
    return () => window.clearTimeout(timer);
  }, [active, rememberedReal, s.session?.loginid]);
  const [manualExecution, setManualExecution] = useState<ManualExecutionView>({ stage: 'idle' });
  const roomFrameRef = useRef<HTMLIFrameElement>(null);
  const syncDetailHud = useCallback(() => {
    const doc = roomFrameRef.current?.contentDocument;
    const hud = doc?.getElementById('playerHud');
    const quick = doc?.getElementById('marketHudQuick');
    const open = page === 'history' || page === 'account';
    if (open) { hud?.style.setProperty('display', 'none', 'important'); quick?.style.setProperty('visibility', 'hidden', 'important'); }
    else { hud?.style.removeProperty('display'); quick?.style.removeProperty('visibility'); }
  }, [page]);
  useLayoutEffect(() => { syncDetailHud(); }, [syncDetailHud]);
  const scoutReplayBusy = useRef(false);
  const timedManualExecuting = useRef(false);
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
  const performance = usePlayerTrading ? fallbackPerformance : s.performance ?? fallbackPerformance;

  const candidates = s.signal?.signal.candidates ?? [];
  const heroCandidates = decision ? candidates : (s.displaySignal?.candidates ?? candidates);
  const queuedMarket = pendingManualIntent
    ? s.markets.find((item) => item.symbol === pendingManualIntent.market) ?? null
    : null;
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
    if (!s.owner) return;
    void loadTestRuns().catch(() => undefined);
  }, [s.owner]);

  useEffect(() => {
    if (!s.owner || !active) return;
    const refresh = () => { if (document.visibilityState !== 'hidden') void loadPaperTrades(300); };
    refresh();
    const timer = window.setInterval(refresh, 15_000);
    return () => window.clearInterval(timer);
  }, [s.owner, active]);

  useEffect(() => {
    if (s.owner && s.paperSimulation?.phase !== 'running') void startPaperSimulation().catch(() => undefined);
  }, [s.owner, s.paperSimulation?.phase]);

  const recentItems = useMemo(() => digitTrades
    // Failed pre-purchase attempts remain in the audit trail, but they are
    // not account trades and do not belong in the operator's trade feed.
    .filter((trade) => trade.status !== 'error')
    .map((trade) => ({ type: 'trade' as const, ts: trade.ts, trade }))
    .sort((a, b) => b.ts - a.ts)
    .slice(0, 5), [digitTrades]);
  const manualExecutionTrade = manualExecution.trade
    ? digitTrades.find((trade) => trade.id === manualExecution.trade?.id) ?? null
    : null;
  useEffect(() => {
    if (!manualExecutionTrade || manualExecution.stage !== 'purchased') return;
    if (['won', 'lost', 'push', 'expired', 'timeout', 'error'].includes(manualExecutionTrade.status)) {
      setManualExecution((current) => ({
        ...current,
        stage: manualExecutionTrade.status === 'error' ? 'failed' : 'settled',
        message: manualExecutionTrade.status === 'error'
          ? 'The contract ended with an execution error.'
          : `Contract settled ${manualExecutionTrade.status}${manualExecutionTrade.profit ? ` · ${fmtMoney(manualExecutionTrade.profit, s.session?.currency)}` : ''}`,
      }));
    }
  }, [manualExecution.stage, manualExecutionTrade?.status, manualExecutionTrade?.profit]);
  const marketsBySymbol = useMemo(
    () => new Map(s.markets.map((item) => [item.symbol, item])),
    [s.markets],
  );
  const openMarketChooser = useCallback(() => setMarketChooserOpen(true), []);
  const closeMarketChooser = useCallback(() => setMarketChooserOpen(false), []);

  const executeManualNow = async (
    direction: 'over' | 'under',
    barrier = direction === 'under' ? 9 : 0,
    marketSymbol = market?.symbol,
    stakeOverride = manualStake,
    entryMode: ManualEntryMode = manualEntryMode,
    companionDemo = false,
    onFailure?: (message: string) => void,
    rangerAutomation = false,
    minEdge: number | null = null,
    onConfirmed?: (tradeId: string | number) => void,
  ): Promise<boolean> => {
    if (usePlayerTrading) return previewManualNow(direction, barrier, marketSymbol ?? '', stakeOverride, onFailure, rangerAutomation, minEdge, onConfirmed);
    if (guest || !marketSymbol) {
      onFailure?.('Connect Deriv and select a live market before placing a bet.');
      return false;
    }
    if (manualBusy) {
      onFailure?.('Another manual bet is already being processed. Wait for it to finish.');
      return false;
    }
    if (companionDemo && s.session?.mode !== 'demo') {
      setManualError(true);
      setManualMsg('Companion trades are available on a demo account only.');
      onFailure?.('Companion trades are available on a demo account only.');
      return false;
    }
    if (openAccountTrade) {
      setManualError(true);
      setManualMsg(accountLockMessage);
      onFailure?.(accountLockMessage);
      await syncCoreState();
      await refreshTrades();
      return false;
    }
    setManualBusy(true);
    setManualMsg('');
    setManualError(false);
    setManualExecution({ stage: 'buying', message: 'Risk approved · requesting a fresh Deriv proposal' });
    try {
      const stake = stakeOverride;
      const selectedMarket = s.markets.find((item) => item.symbol === marketSymbol);
      const exactCandidate = exactCandidateForSetup(heroCandidates, marketSymbol, direction, barrier);
      const estWin = exactCandidate?.estWin ?? (selectedMarket ? confidenceForSetup(selectedMarket, direction, barrier) : 0);
      const result = await manualTrade({ market: marketSymbol, direction, barrier, stake, estWin, entryMode, companionDemo, expectedAccountId: s.session?.loginid, rangerAutomation, minEdge });
      if (result.trade?.id != null && sessionRef.current?.loginid === s.session?.loginid) onConfirmed?.(result.trade.id);
      const label = shortMarketName(s.markets.find((item) => item.symbol === marketSymbol)?.display ?? marketSymbol);
      setManualMsg(`${label} · ${direction === 'under' ? 'Under' : 'Over'} ${barrier} placed @ ${stake}`);
      setManualExecution({ stage: 'purchased', trade: result.trade, message: 'Purchase confirmed · waiting for the settlement digit' });
      await refreshTrades();
      return true;
    } catch (e) {
      setManualError(true);
      setManualMsg(e instanceof Error ? e.message : String(e));
      setManualExecution({ stage: 'failed', message: e instanceof Error ? e.message : String(e) });
      onFailure?.(e instanceof Error ? e.message : String(e));
      return false;
    } finally {
      setManualBusy(false);
    }
  };

  const previewManualNow = async (
    direction: 'over' | 'under',
    barrier: number,
    marketSymbol: string,
    stakeOverride = manualStake,
    onFailure?: (message: string) => void,
    rangerAutomation = false,
    minEdge: number | null = null,
    onConfirmed?: (tradeId: string | number) => void,
  ): Promise<boolean> => {
    setManualBusy(true);
    setManualError(false);
    setManualMsg('Requesting a live quote...');
    setManualExecution({ stage: 'quoting', message: 'Checking feed, account risk, and live payout' });
    try {
      const selectedMarket = s.markets.find((item) => item.symbol === marketSymbol);
      const exactCandidate = exactCandidateForSetup(heroCandidates, marketSymbol, direction, barrier);
      const estWin = exactCandidate?.estWin ?? (selectedMarket ? confidenceForSetup(selectedMarket, direction, barrier) : 0);
      const preview = usePlayerTrading
        ? await previewPlayerTrade({ market: marketSymbol, direction, barrier, stake: stakeOverride, estWin, entryMode: 'instant', expectedAccountId: s.session?.loginid, rangerAutomation, minEdge })
        : await previewManualTrade({ market: marketSymbol, direction, barrier, stake: stakeOverride, estWin, entryMode: 'instant', expectedAccountId: s.session?.loginid, rangerAutomation, minEdge });
      if (sessionRef.current?.loginid !== s.session?.loginid || sessionRef.current?.mode !== s.session?.mode) throw new Error('Account changed while requesting the quote. No trade was submitted.');
      // Pasture targets are one operator action: the fresh quote is confirmed
      // immediately, so there is no per-trade review step. The server still
      // refreshes the quote and enforces trade/risk checks on confirmation.
      setManualExecution({ stage: 'buying', message: 'Checking the fresh quote and account safeguards' });
      const result = usePlayerTrading
        ? await confirmPlayerTrade(preview.previewId, preview.account.mode === 'real')
        : await confirmManualTrade(preview.previewId, crypto.randomUUID());
      if (result.trade?.id != null && sessionRef.current?.loginid === s.session?.loginid) onConfirmed?.(result.trade.id);
      setManualExecution({ stage: 'purchased', trade: result.trade, message: 'Purchase confirmed · waiting for settlement' });
      setManualMsg(`Contract purchased @ ${fmtMoney(result.trade.ask, preview.account.currency)} · payout ${fmtMoney(result.trade.payout, preview.account.currency)}`);
      roomFrameRef.current?.contentWindow?.postMessage({ type: 'zeronine:room-review-purchased' }, window.location.origin);
      void refreshTrades();
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setManualError(true);
      setManualMsg(message);
      setManualExecution({ stage: 'failed', message });
      onFailure?.(message);
      return false;
    } finally {
      setManualBusy(false);
    }
  };

  const playArenaTarget = async (
    direction: 'over' | 'under',
    barrier: number,
    marketSymbol: string,
    stakeOverride = manualStake,
    onFailure?: (message: string) => void,
    rangerAutomation = false,
    minEdge: number | null = null,
    onConfirmed?: (tradeId: string | number) => void,
  ): Promise<boolean> => {
    setManualDirection(direction);
    direction === 'over' ? setManualOverBarrier(barrier) : setManualUnderBarrier(barrier);
    selectMarket(marketSymbol);
    if (guest) {
      onNavigate('account');
      onFailure?.('Connect Deriv before placing a bet.');
      return false;
    }
    if (s.session?.mode === 'real') return previewManualNow(direction, barrier, marketSymbol, stakeOverride, onFailure, rangerAutomation, minEdge, onConfirmed);
    return executeManualNow(direction, barrier, marketSymbol, stakeOverride, 'instant', false, onFailure, rangerAutomation, minEdge, onConfirmed);
  };

  const placeManual = async (
    direction: 'over' | 'under',
    barrier = direction === 'under' ? 9 : 0,
    marketSymbol = market?.symbol,
    companionDemo = false,
  ): Promise<boolean> => {
    if (!marketSymbol) return false;
    if (usePlayerTrading) return previewManualNow(direction, barrier, marketSymbol, manualStake);
    // Companion prompts are an explicit instruction to trade now. They still
    // use the current best model setup and all normal account/lane safeguards.
    if (companionDemo) return executeManualNow(direction, barrier, marketSymbol, manualStake, 'model', true);
    if (manualEntryMode === 'instant') {
      setManualBusy(true);
      setManualError(false);
      setManualMsg('Requesting a live quote for review…');
      setManualExecution({ stage: 'quoting', message: 'Checking feed, account risk, and live payout' });
      try {
        const selectedMarket = s.markets.find((item) => item.symbol === marketSymbol);
        const exactCandidate = exactCandidateForSetup(heroCandidates, marketSymbol, direction, barrier);
        const estWin = exactCandidate?.estWin ?? (selectedMarket ? confidenceForSetup(selectedMarket, direction, barrier) : 0);
        const preview = await previewManualTrade({ market: marketSymbol, direction, barrier, stake: manualStake, estWin, entryMode: 'instant', expectedAccountId: s.session?.loginid });
        if (sessionRef.current?.loginid !== s.session?.loginid || sessionRef.current?.mode !== s.session?.mode) throw new Error('Account changed while requesting the quote. No trade was submitted.');
        const skipReview = rememberedAccount === s.session?.loginid
          && preview.account.mode === s.session?.mode
          && (preview.account.mode === 'demo'
            || maySkipCowReview(rememberedAccount, s.session, sessionRef.current, preview.account.mode));
        if (skipReview) {
          setManualExecution({ stage: 'buying', message: 'Refreshing the quote and reserving the digit lane' });
          const result = await confirmManualTrade(preview.previewId, crypto.randomUUID());
          setManualExecution({ stage: 'purchased', trade: result.trade, message: 'Purchase confirmed · waiting for settlement' });
          setManualMsg(`Contract purchased @ ${fmtMoney(result.trade.ask, preview.account.currency)} · payout ${fmtMoney(result.trade.payout, preview.account.currency)}`);
          void refreshTrades();
          return true;
        }
        setManualPreview(preview);
        setManualExecution({ stage: 'review', message: 'Quote ready · review every value before confirming' });
        setManualMsg('Live quote ready for review · no contract has been purchased');
        return true;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setManualError(true);
        setManualMsg(message);
        setManualExecution({ stage: 'failed', message });
        return false;
      } finally {
        setManualBusy(false);
      }
    }
    if (openAccountTrade) {
      setManualError(true);
      setManualMsg(accountLockMessage);
      return false;
    }
    const selectedMarket = s.markets.find((item) => item.symbol === marketSymbol);
    setPendingManualIntent({
      ...(timedManualSetup ?? {
        market: marketSymbol,
        direction,
        barrier,
        confidence: confidenceForSetup(selectedMarket ?? { symbol: marketSymbol, recentDigits: [] }, direction, barrier),
      }),
      stake: manualStake,
      entryMode: manualEntryMode,
      armedAfterEpoch: selectedMarket?.lastEpoch ?? 0,
      expiresAt: Date.now() + 3 * 60_000,
      twoPassStage: manualEntryMode === 'digit-trigger-confirmed' ? 0 : undefined,
      lastObservedEpoch: selectedMarket?.lastEpoch ?? 0,
      lastObservedQuote: selectedMarket?.lastQuote,
    });
    setManualError(false);
    setManualMsg(`${sideLabel(direction, barrier)} armed · waiting up to 3 minutes for a validated fresh entry digit`);
    return true;
  };

  const confirmManualPreview = async (remember = false): Promise<void> => {
    if (!manualPreview || manualBusy) return;
    if (Date.now() >= manualPreview.expiresAt) {
      setManualPreview(null);
      setManualError(true);
      setManualMsg('The quote review expired · request a fresh quote');
      setManualExecution({ stage: 'failed', message: 'Quote expired before confirmation' });
      return;
    }
    setManualBusy(true);
    setManualError(false);
    setManualExecution({ stage: 'buying', message: 'Refreshing the quote and reserving the digit lane' });
    try {
      const result = usePlayerTrading
        ? await confirmPlayerTrade(manualPreview.previewId, manualPreview.account.mode === 'real')
        : await confirmManualTrade(manualPreview.previewId, crypto.randomUUID());
      const account = s.session?.loginid ?? null;
      const mode = s.session?.mode;
      if (remember && account && sessionRef.current?.loginid === account && sessionRef.current?.mode === mode) {
        const key = `zeronine:${mode === 'real' ? 'real' : 'demo'}-cow-confirm:${account}`;
        try { localStorage.setItem(key, 'enabled'); setRememberedAccount(account); } catch { /* Continue with review on future trades if storage is unavailable. */ }
      }
      setManualPreview(null);
      setManualExecution({ stage: 'purchased', trade: result.trade, message: 'Purchase confirmed · waiting for the settlement digit' });
      setManualMsg(`Contract purchased @ ${fmtMoney(result.trade.ask, manualPreview.account.currency)} · payout ${fmtMoney(result.trade.payout, manualPreview.account.currency)}`);
      roomFrameRef.current?.contentWindow?.postMessage({ type: 'zeronine:room-review-purchased' }, window.location.origin);
      await refreshTrades();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setManualError(true);
      setManualMsg(message);
      setManualExecution({ stage: 'failed', message });
    } finally {
      setManualBusy(false);
    }
  };

  const cancelManualPreview = (): void => {
    setManualPreview(null);
    setManualError(false);
    setManualMsg('Quote review cancelled · no contract was purchased');
    setManualExecution({ stage: 'idle', message: 'No account order is active' });
    roomFrameRef.current?.contentWindow?.postMessage({ type: 'zeronine:room-review-cancelled' }, window.location.origin);
  };

  useEffect(() => {
    if (!pendingManualIntent || timedManualExecuting.current) return;
    if (Date.now() >= pendingManualIntent.expiresAt) {
      setPendingManualIntent(null);
      setManualError(true);
      setManualMsg('Timed entry expired without a validated setup · no contract was purchased');
      return;
    }
    if (openAccountTrade) {
      setPendingManualIntent(null);
      setManualError(true);
      setManualMsg(accountLockMessage);
      return;
    }
    const liveMarket = s.markets.find((item) => item.symbol === pendingManualIntent.market);
    const candidate = exactCandidateForSetup(
      s.signal?.signal.candidates ?? [],
      pendingManualIntent.market,
      pendingManualIntent.direction,
      pendingManualIntent.barrier,
    );
    const assessment = assessTimedManualEntry(candidate);
    const freshTick = Boolean(liveMarket && (
      liveMarket.lastEpoch > pendingManualIntent.armedAfterEpoch
      || (pendingManualIntent.entryMode === 'digit-trigger-confirmed' && (pendingManualIntent.twoPassStage ?? 0) > 0)
    ));
    const hasNewQuote = Boolean(liveMarket && (
      (liveMarket.lastEpoch ?? 0) > (pendingManualIntent.lastObservedEpoch ?? 0)
      || liveMarket.lastQuote !== pendingManualIntent.lastObservedQuote
    ));
    if (pendingManualIntent.entryMode === 'digit-trigger-confirmed' && liveMarket && hasNewQuote) {
      const digit = liveMarket.lastDigit;
      const isExtreme = matchesDigitTrigger(pendingManualIntent.direction, digit);
      const isFollowThrough = pendingManualIntent.direction === 'over' ? digit >= 6 : digit <= 3;
      const observed = { lastObservedEpoch: liveMarket.lastEpoch, lastObservedQuote: liveMarket.lastQuote };
      const stage = pendingManualIntent.twoPassStage ?? 0;
      if (stage === 0 && isExtreme) {
        setPendingManualIntent({ ...pendingManualIntent, ...observed, twoPassStage: 1, firstTriggerQuote: liveMarket.lastQuote, firstTriggerDigit: digit });
        setManualMsg(`First ${pendingManualIntent.direction === 'over' ? '8/9' : '0/1'} captured · waiting for follow-through`);
        return;
      }
      if (stage === 1) {
        if (isFollowThrough) {
          setPendingManualIntent({ ...pendingManualIntent, ...observed, twoPassStage: 2, followThroughQuote: liveMarket.lastQuote, followThroughDigit: digit });
          setManualMsg(`${pendingManualIntent.direction === 'over' ? 'High' : 'Low'} follow-through captured · waiting for a new ${pendingManualIntent.direction === 'over' ? '8/9' : '0/1'} entry`);
          return;
        }
        setPendingManualIntent({ ...pendingManualIntent, ...observed, twoPassStage: isExtreme ? 1 : 0, firstTriggerQuote: isExtreme ? liveMarket.lastQuote : undefined, firstTriggerDigit: isExtreme ? digit : undefined, followThroughQuote: undefined, followThroughDigit: undefined, reentryQuote: undefined, reentryDigit: undefined });
        setManualMsg(isExtreme ? 'New first extreme captured · waiting for follow-through' : 'Sequence reset · waiting for a fresh first extreme');
        return;
      }
      if (stage === 2 && isExtreme) {
        setPendingManualIntent({ ...pendingManualIntent, ...observed, twoPassStage: 3, reentryQuote: liveMarket.lastQuote, reentryDigit: digit });
        setManualMsg(`New ${pendingManualIntent.direction === 'over' ? '8/9' : '0/1'} captured · all entry checks are being confirmed`);
        return;
      }
      if (stage < 3) {
        setPendingManualIntent({ ...pendingManualIntent, ...observed });
        return;
      }
    }
    const triggerReady = pendingManualIntent.entryMode === 'model'
      || (pendingManualIntent.entryMode === 'digit-trigger-confirmed'
        ? pendingManualIntent.twoPassStage === 3
        : matchesDigitTrigger(pendingManualIntent.direction, liveMarket?.lastDigit));
    // A two-pass manual instruction is the operator's explicitly selected
    // entry rule. Once its three fresh quotes are captured, submit the Deriv
    // proposal/purchase flow rather than indefinitely waiting for a scanner
    // row that may not exist for the same market/barrier.
    const entryValidated = pendingManualIntent.entryMode === 'digit-trigger-confirmed' || assessment.ready;
    if (!freshTick || !triggerReady || !entryValidated) {
      const seconds = Math.max(0, Math.ceil((pendingManualIntent.expiresAt - Date.now()) / 1_000));
      setManualMsg(`${sideLabel(pendingManualIntent.direction, pendingManualIntent.barrier)} armed · ${freshTick ? assessment.reason : 'waiting for the next fresh digit'} · ${seconds}s left`);
      return;
    }
    timedManualExecuting.current = true;
    const intent = pendingManualIntent;
    setPendingManualIntent(null);
    setManualMsg(`${sideLabel(intent.direction, intent.barrier)} trigger confirmed · requesting live quote`);
    void executeManualNow(intent.direction, intent.barrier, intent.market, intent.stake, intent.entryMode)
      .finally(() => { timedManualExecuting.current = false; });
  }, [pendingManualIntent, openAccountTrade, s.markets, s.signal]);

  useEffect(() => {
    if (!pendingManualIntent) return;
    const timer = window.setInterval(() => {
      if (Date.now() < pendingManualIntent.expiresAt) return;
      setPendingManualIntent(null);
      setManualError(true);
      setManualMsg('Timed entry expired without a validated setup · no contract was purchased');
    }, 1_000);
    return () => window.clearInterval(timer);
  }, [pendingManualIntent]);

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
    setManualError(false);
    try {
      if (!usePlayerTrading && !openAccountTrade.contract_id) await clearStuckTrade();
      await syncCoreState();
      if (usePlayerTrading) await refreshPlayerState();
      else await refreshTrades();
    } catch (err) {
      setManualError(true);
      setManualMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setSettlementBusy(false);
    }
  };

  const roomState = useMemo(() => ({
    balance: s.session?.balance ?? 0,
    currency: s.session?.currency ?? 'USD',
    profit: performance.profit,
    feedConnected: s.feed?.connected ?? false,
    owner: Boolean(s.owner),
    accountMode: s.session?.mode ?? null,
    accountId: s.session?.loginid ?? null,
    authStatus: base.playerAuthStatus,
    wsStatus: s.ws,
    remainingLoss: usePlayerTrading ? { amount: s.playerRecovery?.debt ?? 0, lastSettledTradeId: null } : s.digitRemainingLoss,
    selected: market?.symbol ?? '',
    busy: manualBusy,
    status: manualMsg,
    canTrade: Boolean(s.session && s.feed?.connected && !openAccountTrade && !manualBusy),
    markets: s.markets.map((item) => ({
      symbol: item.symbol,
      display: item.display,
      lastQuote: item.lastQuote,
      lastDigit: item.lastDigit,
      lastEpoch: item.lastEpoch,
      fresh: item.fresh,
      recentQuotes: item.recentQuotes,
      recentDigits: item.recentDigits,
      recentTicks: item.recentTicks,
    })),
    candidates: s.signal?.signal.candidates ?? s.displaySignal?.candidates ?? [],
    marketScout: s.marketScout,
    digitTradeEvidence: s.digitTradeEvidence,
    paperTrades: s.paperTrades.slice(0, 100).map((trade) => ({
      market: trade.market,
      direction: trade.direction,
      barrier: trade.barrier,
      status: trade.status,
      profit: trade.profit,
    })),
    research: { latest: s.testRuns.find((run) => run.kind === 'backtest') ?? null, active: s.testlab?.kind === 'backtest' ? s.testlab : null, canRun: Boolean(s.owner && s.session) },
    paperSimulation: s.paperSimulation ? {
      phase: s.paperSimulation.phase,
      totalTrades: s.paperSimulation.totalTrades,
      wins: s.paperSimulation.wins,
      losses: s.paperSimulation.losses,
      netPnl: s.paperSimulation.netPnl,
      openContract: s.paperSimulation.openContract,
      lastSettled: s.paperSimulation.lastSettled,
      recentTrades: s.paperSimulation.recentTrades ?? [],
      lastTick: s.paperSimulation.lastTick,
    } : null,
    trades: digitTrades.slice(0, 30).map((trade) => ({
      id: trade.id,
      ts: trade.ts,
      market: trade.market,
      direction: trade.contract_type === 'DIGITUNDER' ? 'under' : 'over',
      barrier: trade.barrier,
      stake: trade.stake,
      profit: trade.profit,
      status: trade.status,
      origin: trade.origin,
      entrySpot: trade.entry_spot,
      exitDigit: trade.exit_digit,
    })),
  }), [base.playerAuthStatus, digitTrades, manualBusy, manualMsg, market?.symbol, openAccountTrade, performance.profit, s.displaySignal, s.feed?.connected, s.marketScout, s.digitTradeEvidence, s.digitRemainingLoss, s.markets, s.owner, s.paperSimulation, s.paperTrades, s.playerRecovery?.debt, s.session, s.signal, s.testRuns, s.testlab, usePlayerTrading]);

  const postRoomLayout = useCallback(() => {
    const header = document.querySelector('.app[data-page="home"] .view-home .header') as HTMLElement | null;
    const rect = header?.getBoundingClientRect();
    roomFrameRef.current?.contentWindow?.postMessage({
      type: 'zeronine:room-layout',
      headerHeight: rect ? Math.max(0, Math.round(rect.bottom)) : 56,
      bottomNavHeight: 0,
    }, window.location.origin);
  }, []);

  const lastLayoutPostAt = useRef(0);

  const postRoomState = useCallback(() => {
    const frame = roomFrameRef.current;
    frame?.contentWindow?.postMessage({ type: 'zeronine:room-state', state: roomState }, window.location.origin);
    frame?.contentWindow?.postMessage({
      type: 'zeronine:room-auto-menu',
      open: rangerAutoMenuOpen,
      controls: true,
    }, window.location.origin);
    const nowLayout = Date.now();
    if (nowLayout - lastLayoutPostAt.current > 1000) {
      lastLayoutPostAt.current = nowLayout;
      postRoomLayout();
    }
    const stakeInput = frame?.contentDocument?.getElementById('cowStake') as HTMLInputElement | null;
    const stakeHint = frame?.contentDocument?.getElementById('stakeHint');
    if (!stakeInput || !stakeHint) return;
    const stakeSignature = `${roomState.accountMode}|${roomState.balance}|${roomState.currency}`;
    if (stakeInput.dataset.stakeSync === stakeSignature) return;
    stakeInput.dataset.stakeSync = stakeSignature;

    const connected = roomState.accountMode === 'demo' || roomState.accountMode === 'real';
    const balanceLimit = roomState.balance > 0 ? Math.floor(roomState.balance * 0.9 * 100) / 100 : 0;
    const stakeLimit = balanceLimit;
    if (connected && stakeLimit > 0) stakeInput.max = String(stakeLimit);
    else stakeInput.removeAttribute('max');

    const updateStakeHint = () => {
      if (!connected) return;
      if (!(stakeLimit > 0)) {
        stakeHint.textContent = 'Account balance unavailable. No bet can be placed.';
        return;
      }
      const requested = Number(stakeInput.value);
      if (!Number.isFinite(requested) || requested <= 0) {
        stakeHint.textContent = `Enter a stake above zero. Maximum allowed: ${fmtMoney(stakeLimit, roomState.currency)}.`;
        return;
      }
      if (requested > stakeLimit) {
        stakeHint.textContent = `Final bet: ${fmtMoney(stakeLimit, roomState.currency)} (capped from ${fmtMoney(requested, roomState.currency)} by the 90% balance safeguard).`;
        return;
      }
      stakeHint.textContent = `Starting stake: ${fmtMoney(requested, roomState.currency)}. Recovery may raise it based on current debt and the selected target, up to ${fmtMoney(stakeLimit, roomState.currency)}.`;
    };
    stakeInput.oninput = updateStakeHint;
    stakeInput.onblur = () => {
      const requested = Number(stakeInput.value);
      if (connected && stakeLimit > 0 && Number.isFinite(requested) && requested > stakeLimit) {
        stakeInput.value = String(stakeLimit);
        stakeHint.textContent = `Stake adjusted to ${fmtMoney(stakeLimit, roomState.currency)} by the 90% balance safeguard. Recovery may raise it based on current debt and the selected target.`;
      }
    };
    updateStakeHint();
  }, [rangerAutoMenuOpen, roomState, postRoomLayout]);

  useEffect(() => {
    postRoomLayout();
    window.addEventListener("resize", postRoomLayout);
    return () => window.removeEventListener("resize", postRoomLayout);
  }, [postRoomLayout]);

  useEffect(() => {
    if (active && !marketChooserOpen) postRoomState();
  }, [active, marketChooserOpen, postRoomState]);

  useEffect(() => {
    if (!active || marketChooserOpen) {
      setRangerAutoMenuOpen(false);
      setRangerAutoRunning(false);
    }
  }, [active, marketChooserOpen]);

  useEffect(() => {
    const receiveRoomAction = (event: MessageEvent): void => {
      if (event.origin !== window.location.origin || event.source !== roomFrameRef.current?.contentWindow) return;
      const message = event.data as { type?: string; page?: Page; running?: boolean; payload?: { action?: string; direction?: string; barrier?: number; stake?: number; market?: string; rangerAutomation?: boolean; minEdge?: number | null; replayAttemptId?: string } } | null;
      if (!message?.type) return;
      if (message.type === 'zeronine:room-auto-dismiss') {
        setRangerAutoMenuOpen(false);
        return;
      }
      if (message.type === 'zeronine:room-auto-status' && typeof message.running === 'boolean') {
        setRangerAutoRunning(message.running);
        return;
      }
      if (message.type === 'zeronine:room-ready') {
        postRoomState();
        return;
      }
      if (message.type === 'zeronine:room-research-replay') {
        if (!s.owner || !s.session || s.testlab || scoutReplayBusy.current) {
          roomFrameRef.current?.contentWindow?.postMessage({ type: 'zeronine:room-research-result', ok: false, message: !s.owner || !s.session ? 'Connect an owner account to run a replay.' : 'Research is already running.' }, window.location.origin);
          return;
        }
        scoutReplayBusy.current = true;
        void runTestBacktest({ target: 200, configs: ALL_CONFIG_KEYS }).then(() => {
          roomFrameRef.current?.contentWindow?.postMessage({ type: 'zeronine:room-research-result', ok: true, message: 'Historical replay complete.' }, window.location.origin);
        }).catch((error) => {
          roomFrameRef.current?.contentWindow?.postMessage({ type: 'zeronine:room-research-result', ok: false, message: error instanceof Error ? error.message : 'Replay failed.' }, window.location.origin);
        }).finally(() => { scoutReplayBusy.current = false; });
        return;
      }
      if (message.type === 'zeronine:room-health-refresh') {
        connectWs();
        void syncCoreState();
        if (message.payload?.action === 'reconnect-deriv' && s.session) {
          void fetch('/api/auth/reconnect', { method: 'POST', credentials: 'same-origin' })
            .then(async (response) => {
              const body = await response.json().catch(() => ({})) as { error?: string };
              roomFrameRef.current?.contentWindow?.postMessage({
                type: 'zeronine:room-health-refresh-result',
                ok: response.ok,
                message: body.error ?? (response.ok ? '' : `Reconnect failed (${response.status}).`),
              }, window.location.origin);
            })
            .catch(() => roomFrameRef.current?.contentWindow?.postMessage({
              type: 'zeronine:room-health-refresh-result', ok: false, message: 'Could not reach the game server to reconnect Deriv.',
            }, window.location.origin))
            .finally(() => { void syncCoreState(); postRoomState(); });
        }
        return;
      }
      if (message.type === 'zeronine:room-select-market' && typeof message.payload?.market === 'string') {
        if (s.markets.some((item) => item.symbol === message.payload?.market)) selectMarket(message.payload.market);
        return;
      }
      if (message.type === 'zeronine:room-navigate' && message.page && ['history', 'account', 'howToPlay', 'backtest'].includes(message.page)) {
        onNavigate(message.page);
        return;
      }
      if (message.type === 'zeronine:room-layout-request') {
        const header = document.querySelector('.app[data-page="home"] .view-home .header') as HTMLElement | null;
        const rect = header?.getBoundingClientRect();
        roomFrameRef.current?.contentWindow?.postMessage({
          type: 'zeronine:room-layout',
          headerHeight: rect ? Math.max(0, Math.round(rect.bottom)) : 56,
          bottomNavHeight: 0,
        }, window.location.origin);
        return;
      }
      if (message.type === 'zeronine:room-auto-arm') {
        const respond = (ok: boolean, armedUntil?: number, messageText?: string): void => {
          roomFrameRef.current?.contentWindow?.postMessage({
            type: 'zeronine:room-auto-arm-result',
            ok,
            armedUntil,
            message: messageText,
          }, window.location.origin);
        };
        if (!s.session || s.session.mode !== 'real' || !s.owner) {
          respond(false, undefined, 'Connect an owner-authorized real account before arming ranger automation.');
          return;
        }
        void arm().then((armedUntil) => respond(true, armedUntil)).catch((error) => {
          respond(false, undefined, error instanceof Error ? error.message : String(error));
        });
        return;
      }
      if (message.type === 'zeronine:room-auto-disarm') {
        void disarmRangerAutomation().then(() => {
          roomFrameRef.current?.contentWindow?.postMessage({
            type: 'zeronine:room-auto-disarm-result',
            ok: true,
          }, window.location.origin);
        }).catch((error) => {
          roomFrameRef.current?.contentWindow?.postMessage({
            type: 'zeronine:room-auto-disarm-result',
            ok: false,
            message: error instanceof Error ? error.message : String(error),
          }, window.location.origin);
        });
        return;
      }
      if (message.type !== 'zeronine:room-trade') return;
      if (!s.session) {
        roomFrameRef.current?.contentWindow?.postMessage({ type: 'zeronine:room-trade-result', ok: false, message: 'Connect Deriv before placing a trade.' }, window.location.origin);
        return;
      }
      const { direction, barrier, stake, market: marketSymbol, rangerAutomation, minEdge, replayAttemptId } = message.payload ?? {};
      if ((direction !== 'over' && direction !== 'under') || typeof barrier !== 'number' || !Number.isInteger(barrier) || barrier < 0 || barrier > 9 || typeof stake !== 'number' || !Number.isFinite(stake) || stake <= 0 || typeof marketSymbol !== 'string' || !s.markets.some((item) => item.symbol === marketSymbol)) {
        roomFrameRef.current?.contentWindow?.postMessage({ type: 'zeronine:room-trade-result', ok: false, message: 'That game target is not valid.' }, window.location.origin);
        return;
      }
      setManualStakeText(String(stake));
      let failureMessage = 'Trade was not submitted. Check the game status for details.';
      const replayAccountId = s.session.loginid;
      let confirmedTradeId: string | number | null = null;
      const onConfirmed = (tradeId: string | number): void => {
        if (sessionRef.current?.loginid !== replayAccountId) return;
        confirmedTradeId = tradeId;
        roomFrameRef.current?.contentWindow?.postMessage({
          type: 'zeronine:replay-confirmed-trade', ok: true,
          replayAttemptId: typeof replayAttemptId === 'string' ? replayAttemptId : null,
          replayAccountId, confirmedTradeId: tradeId,
        }, window.location.origin);
      };
      void playArenaTarget(direction, barrier, marketSymbol, stake, (message) => { failureMessage = message; }, rangerAutomation === true, minEdge ?? null, onConfirmed).then((ok) => {
        roomFrameRef.current?.contentWindow?.postMessage({
          type: 'zeronine:room-trade-result',
          ok,
          replayAttemptId: typeof replayAttemptId === 'string' ? replayAttemptId : null,
          replayAccountId,
          confirmedTradeId,
          message: ok ? (s.session?.mode === 'real' ? 'Real-money order submitted.' : 'Deriv order submitted.') : failureMessage,
        }, window.location.origin);
      });
    };
    window.addEventListener('message', receiveRoomAction);
    return () => window.removeEventListener('message', receiveRoomAction);
  }, [arm, onNavigate, playArenaTarget, postRoomState, s.markets, s.owner, s.session, s.testlab]);

  return (
    <>
      <header class="header">
        <div class="header-top">
          <div class="brand">
            <button type="button" class="logo cow-logo" aria-label="Return to the pasture" onClick={() => { setMarketChooserOpen(false); setRangerAutoMenuOpen(false); setHeaderNavOpen(false); onNavigate('home'); }}><img src="/deriv-cows-logo.png" alt="" /></button>
            {active && !guest && <button
              type="button"
              class="room-header-how-to"
              onClick={() => { setRangerAutoMenuOpen(false); onNavigate('howToPlay'); }}
            >How to play</button>}
          </div>
          <nav id="home-header-navigation" class={`desktop-nav${headerNavOpen ? ' is-expanded' : ''}`} aria-label="Main navigation" aria-hidden={!headerNavOpen}>
            {(['home', 'history', 'account'] as const).map((destination) => (
              <button key={destination} type="button" tabIndex={headerNavOpen ? 0 : -1} aria-current={page === destination ? 'page' : undefined}
                aria-label={{ home: 'Home', backtest: 'Research lab', history: 'History', account: 'Account' }[destination]}
                title={{ home: 'Home', backtest: 'Research lab', history: 'History', account: 'Account' }[destination]}
                class={`nav-link${destination === 'history' || destination === 'account' ? ' icon-only' : ''}${page === destination ? ' active' : ''}`}
                onClick={() => { onNavigate(destination); setRangerAutoMenuOpen(false); setHeaderNavOpen(false); }}>
                <Icon name={{ home: 'home', backtest: 'stats', history: 'history', account: 'account' }[destination]} size={19} />
                <span class="sr-only">{{ home: 'Home', backtest: 'Research lab', history: 'History', account: 'Account' }[destination]}</span>
              </button>
            ))}
          </nav>
          {active && !marketChooserOpen && <button
            type="button"
            class={`room-header-action room-header-play${rangerAutoMenuOpen ? ' is-open' : ''}`}
            aria-label={rangerAutoMenuOpen ? 'Hide Ranger Auto controls' : rangerAutoRunning ? 'Ranger Auto running; show controls' : 'Show Ranger Auto controls'}
            aria-expanded={rangerAutoMenuOpen}
            title={rangerAutoMenuOpen ? 'Hide Ranger Auto controls' : 'Ranger Auto'}
            onClick={() => setRangerAutoMenuOpen((open) => !open)}
          ><svg class="room-auto-icon" viewBox="0 0 24 24" aria-hidden="true">{rangerAutoRunning ? <path d="M6 4h4v16H6zM14 4h4v16h-4z" /> : <path d="M6 3.5 20 12 6 20.5z" />}</svg>{rangerAutoRunning && <span class="room-auto-running">Running</span>}</button>}
          <button
            type="button"
            class={`header-nav-toggle${headerNavOpen ? ' is-open' : ''}`}
            aria-label={headerNavOpen ? 'Collapse navigation' : 'Show navigation'}
            aria-expanded={headerNavOpen}
            aria-controls="home-header-navigation"
            title={headerNavOpen ? 'Collapse navigation' : 'Show navigation'}
            onClick={() => setHeaderNavOpen((open) => !open)}
          ><Icon name={headerNavOpen ? 'x' : 'menu'} size={21} strokeWidth={2.2} /></button>
          <QuickAccountMenu session={s.session} isPlayer={!base.owner && !!base.playerSession} onNavigate={onNavigate} />
        </div>
        <div class="subtitle">Cow archery pasture · choose a live target · Deriv execution stays behind the game</div>
      </header>

      {active && base.playerAuthStatus === 'reconnecting' && base.playerAuthMessage && <div class="player-reconnect" role="status"><span>{base.playerAuthMessage}</span></div>}

      {active && rememberedReal && showRealCowNotice && <div class="real-cow-mode" role="status"><span>Manual real-money trades: confirmation off</span><button type="button" onClick={() => { try { localStorage.removeItem(`zeronine:real-cow-confirm:${s.session?.loginid}`); } catch { /* In-memory state still returns to review. */ } setRememberedAccount(null); window.dispatchEvent(new Event('real-cow-preference')); }}>Turn confirmation on</button></div>}

      {active && !marketChooserOpen && <section class="trading-room-frame-shell" aria-label="Interactive manual trading room">
        <iframe
          ref={roomFrameRef}
          class="trading-room-frame"
          src={`/trading-room.html${pastureRoom ? `?room=${encodeURIComponent(pastureRoom)}` : ''}`}
          title="Deriv Cows interactive trading pasture"
          onLoad={() => { postRoomState(); syncDetailHud(); }}
        />
      </section>}

      {active && !marketChooserOpen && manualPreview && <PastureQuoteReview key={manualPreview.previewId} preview={manualPreview} busy={manualBusy} error={manualError ? manualMsg : ''} onConfirm={(remember) => void confirmManualPreview(remember)} onCancel={cancelManualPreview} />}

      {active && marketChooserOpen && <section class={`trading-room-home room-${roomActivity}`} aria-label="Advanced manual trading controls">
        <TradingRoomEnvironment
          market={market ?? null}
          balance={s.session?.balance ?? 0}
          currency={s.session?.currency}
          profit={performance.profit}
          feedConnected={s.feed?.connected ?? false}
          activity={roomActivity}
        />
        <div class="room-action-rail" aria-label="Trading room activities">
          <button type="button" class={roomActivity === 'focus' ? 'active' : ''} onClick={() => setRoomActivity('focus')}><Icon name="crosshair" size={15} />Focus desk</button>
          <button type="button" class={roomActivity === 'reset' ? 'active' : ''} onClick={() => setRoomActivity('reset')}><Icon name="rotateCcw" size={15} />Reset corner</button>
          <button type="button" class={roomActivity === 'break' ? 'active' : ''} onClick={() => setRoomActivity('break')}><Icon name="square" size={15} />Cool down</button>
        </div>
        <div class="ticker room-ticker" aria-label="Live market ribbon">
        <div class="ticker-row">
          {s.markets.map((m) => (
            <TickerItem key={m.symbol} market={m} active={m.symbol === market?.symbol} prediction={tickerPredictions.get(m.symbol)} performance={tickerProfits.get(m.symbol)} />
          ))}
          {s.markets.map((m) => (
            <TickerItem key={`dup-${m.symbol}`} market={m} active={m.symbol === market?.symbol} prediction={tickerPredictions.get(m.symbol)} performance={tickerProfits.get(m.symbol)} />
          ))}
        </div>
      </div>

      <div class="dashboard room-dashboard">
        <div class="dash-main">
          <section class="trade-card">
            {!marketChooserOpen ? <ManualGameArena
              markets={s.markets}
              candidates={heroCandidates}
              paperTrades={s.paperTrades}
              stake={manualStakeText}
              currency={s.session?.currency}
              accountMode={s.session?.mode}
              feedConnected={s.feed?.connected ?? false}
              busy={manualBusy}
              locked={startLocked || roomActivity !== 'focus'}
              queued={Boolean(pendingManualIntent)}
              status={roomActivity === 'reset'
                ? 'Reset corner active · targets are paused while you review the room journal'
                : roomActivity === 'break'
                  ? 'Cooldown active · return to the focus desk when you are ready to trade'
                  : manualMsg}
              error={manualError}
              onStake={(stake) => { setPendingManualIntent(null); setManualPreview(null); setManualStakeText(stake); }}
              onPlay={playArenaTarget}
              onAdvanced={openMarketChooser}
            /> : <DecisionHero
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
              settings={s.settings}
              onChooseMarket={openMarketChooser}
              marketChooserOpen={marketChooserOpen}
              onCloseMarketChooser={closeMarketChooser}
              manualDirection={manualDirection}
              manualOverBarrier={manualOverBarrier}
              manualUnderBarrier={manualUnderBarrier}
              manualStake={manualStakeText}
              manualEntryMode={manualEntryMode}
              onManualStake={(stake) => {
                setPendingManualIntent(null);
                setManualPreview(null);
                setManualStakeText(stake);
              }}
              onManualDirection={(direction) => {
                setTimedManualSetup(null);
                setPendingManualIntent(null);
                setManualPreview(null);
                setManualDirection(direction);
              }}
              onManualBarrier={(direction, barrier) => {
                setTimedManualSetup(null);
                setPendingManualIntent(null);
                setManualPreview(null);
                direction === 'over' ? setManualOverBarrier(barrier) : setManualUnderBarrier(barrier);
              }}
              onManualMarket={(symbol) => {
                setTimedManualSetup(null);
                setPendingManualIntent(null);
                setManualPreview(null);
                selectMarket(symbol);
              }}
              onManualEntryMode={(entryMode) => {
                setPendingManualIntent(null);
                setManualPreview(null);
                setManualEntryMode(entryMode);
              }}
              onManualTimedSetup={setTimedManualSetup}
              onManualPlace={(direction, barrier, marketSymbol, companionDemo) => placeManual(direction, barrier, marketSymbol, companionDemo)}
              manualStatus={manualMsg}
              manualQueued={Boolean(pendingManualIntent)}
              queuedIntent={pendingManualIntent}
              queuedMarket={queuedMarket}
              manualPreview={manualPreview}
              manualExecution={manualExecution}
              manualBusy={manualBusy}
              onConfirmManualPreview={() => void confirmManualPreview()}
              onCancelManualPreview={cancelManualPreview}
              onCancelManualQueue={() => {
                setPendingManualIntent(null);
                setManualError(false);
                setManualMsg('Queued trade cancelled - no contract was purchased');
              }}
            />}

            {!marketChooserOpen && openAccountTrade && <button class="bot-inline-action" type="button" disabled={settlementBusy} onClick={() => void recoverOpenTrade()}>
              {settlementBusy ? 'Checking outcome...' : openAccountTrade.contract_id ? 'Refresh outcome' : 'Check submitted order'}
            </button>}
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
              {digitTrades.length === 0 && <div class="empty-hint">No Over/Under trades yet - choose a target in the arena</div>}
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
      </div>
      </section>}
      {active && activityDetail && <ActivityDetailModal detail={activityDetail} markets={s.markets} equity={s.testEquity} onClose={() => setActivityDetail(null)} />}
    </>
  );
}

function TradingRoomEnvironment({
  market, balance, currency, profit, feedConnected, activity,
}: {
  market: Market | null;
  balance: number;
  currency?: string;
  profit: number;
  feedConnected: boolean;
  activity: 'focus' | 'reset' | 'break';
}): JSX.Element {
  const recentDigits = market?.recentDigits.slice(-10) ?? [];
  return <div class="room-environment" aria-hidden="true">
    <div class="room-ceiling"><i></i><i></i><i></i></div>
    <div class="room-wall room-wall-left"></div>
    <div class="room-wall room-wall-right"></div>
    <div class="room-window"><span></span><i></i><i></i><i></i></div>
    <div class="room-city"><i></i><i></i><i></i><i></i><i></i><i></i></div>
    <div class="room-floor-grid"></div>
    <div class="room-shelf"><i></i><i></i><i></i><span></span></div>
    <div class="room-plant"><i></i><i></i><i></i><b></b></div>
    <div class="room-lamp"><i></i><span></span></div>
    <div class="room-desk">
      <div class="room-monitor monitor-left"><span>MARKET FIELD</span><b>{market ? shortMarketName(market.display) : 'SCANNING'}</b></div>
      <div class="room-monitor monitor-main"><span>LIVE DIGITS</span><div>{recentDigits.map((digit, index) => <b class={index === recentDigits.length - 1 ? 'live' : ''} key={`${digit}-${index}`}>{digit}</b>)}</div></div>
      <div class="room-monitor monitor-right"><span>LAST QUOTE</span><b>{market?.lastQuote?.toFixed(2) ?? '--'}</b></div>
      <div class="room-desktop"></div><div class="room-desk-leg left"></div><div class="room-desk-leg right"></div>
    </div>
    <div class={`room-avatar ${activity}`}><i class="head"></i><i class="body"></i><i class="arm left"></i><i class="arm right"></i><i class="leg left"></i><i class="leg right"></i><span></span></div>
    <div class="room-chair"><i></i><span></span></div>
    <div class="room-gym"><span></span><i></i><b></b></div>
    <div class="room-hud">
      <div><span>Balance</span><b>{fmtMoney(balance, currency)}</b></div>
      <div><span>Session P/L</span><b class={profit < 0 ? 'down' : 'up'}>{fmtSigned(profit, currency)}</b></div>
      <div><span>Feed</span><b class={feedConnected ? 'up' : 'down'}>{feedConnected ? 'LIVE' : 'RECONNECTING'}</b></div>
    </div>
    <div class="room-mode-readout"><i></i><span>{activity === 'focus' ? 'At the desk · trade controls active' : activity === 'reset' ? 'Reset corner · slow down and review' : 'Cooldown · no room action submits a trade'}</span></div>
  </div>;
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
        {err && !trade.contract_id ? <div class="activity-order-failed">Order was not opened, so there is no entry or result to show.</div> : <div class="activity-track" aria-label={digitContract ? `Setup digit ${entryDigit}, ${currentLabel.toLowerCase()} digit ${currentDigit}` : `Entry spot ${entryMarker}, ${currentLabel.toLowerCase()} spot ${currentMarker}`}>
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
        </div>}
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
  const dialogRef = useDialogFocus();
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
      <section ref={dialogRef} tabIndex={-1} class="activity-detail" role="dialog" aria-modal="true" aria-label={`${title} details`} onClick={(event) => event.stopPropagation()}>
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
            <Detail label="Entry digit" value={trade.entry_digit != null ? String(trade.entry_digit) : '--'} />
            <Detail label="Exit" value={trade.exit_spot != null ? String(trade.exit_spot) : '--'} />
            <Detail label="Entry intent & wait" value={trade.reason || '--'} />
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
            <Detail label="Entry mode" value={run.entry_mode === 'digit_trigger' ? '8/9 · 0/1 trigger' : 'Model'} />
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
    ? `${observation.confirmations}/${observation.required} fresh ticks · ${Math.round((observation.confirmations / observation.required) * 100)}%`
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
  const activityBars = Array.from({ length: 16 }, (_, index) => 28 + ((index * 23 + activeIndex * 17) % 62));
  const visualState = !automation ? 'idle' : executing ? 'executing' : watching ? 'watching' : confirmed ? 'confirmed' : 'observing';

  return (
    <div class={`observe-rail${compact ? ' compact' : ''} state-${visualState}`} aria-live="polite" aria-label={`Automated decision state: ${steps[Math.max(0, activeIndex)]}`}>
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
        {automation && !executing && <i class="observe-state-beacon" aria-hidden="true"></i>}
        {watching && <span class="observe-mini-pulse" aria-hidden="true"></span>}
        <span>{message}</span>
        {automation && observation && !executing && <b>{progress}</b>}
      </div>
      {automation && !executing && compact && <div class={`observe-lens phase-${activeIndex}`} aria-hidden="true">
        <div class="observe-lens-bars">{activityBars.map((height, index) => <i key={index} style={{ height: `${height}%`, animationDelay: `${index * -0.11}s` }} />)}</div>
        <span>{observation?.key ? `Watching ${observation.key}` : 'Reading live market flow'}</span>
        <em>{observation?.lastTickEpoch ? `tick ${observation.lastTickEpoch}` : 'new ticks stream in here'}</em>
      </div>}
    </div>
  );
}

type CompanionSetup = { market: string; symbol: string; direction: 'over' | 'under'; barrier: number; confidence: number; edge: number };

function MarketScannerCompanion({ automation, phase, observation, market, recovery, lastResult, strategyMode, holdReason, forceSetup, gameSetups, onForceDemoTrade }: {
  automation: boolean;
  phase?: string;
  observation?: AutomationState['observation'];
  market: Market | null;
  recovery: Recovery | null;
  lastResult?: string | null;
  strategyMode?: Settings['strategy_mode'];
  holdReason?: string | null;
  forceSetup: { market: string; direction: 'over' | 'under'; barrier: number; confidence: number; eligible: boolean } | null;
  gameSetups: CompanionSetup[];
  onForceDemoTrade: (setup: CompanionSetup) => Promise<boolean>;
}): JSX.Element {
  const [customizerOpen, setCustomizerOpen] = useState(false);
  const [motionEnabled, setMotionEnabled] = useState(true);
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const [style, setStyle] = useState<'focus' | 'calm' | 'vivid'>('focus');
  const [promptIndex, setPromptIndex] = useState(0);
  const [promptVisible, setPromptVisible] = useState(false);
  const [promptReply, setPromptReply] = useState<string | null>(null);
  const [waitPromptEligible, setWaitPromptEligible] = useState(false);
  const [gameCountdown, setGameCountdown] = useState<number | null>(null);
  const [brainCheckIn, setBrainCheckIn] = useState<number | null>(null);
  const [miniGameShown, setMiniGameShown] = useState(false);
  const [checkInCycle, setCheckInCycle] = useState(0);
  const [gamePhase, setGamePhase] = useState<'offer' | 'spinning' | 'submitting' | 'result'>('offer');
  const [gameWinner, setGameWinner] = useState<CompanionSetup | null>(null);
  const automationRef = useRef(automation);
  useEffect(() => { automationRef.current = automation; }, [automation]);
  // This is deliberately independent of the entry-phase timer. The visual
  // belongs to the companion for the entire active run, so transient scanner
  // phases cannot make it flicker out of view.
  useEffect(() => {
    if (!automation) { setBrainCheckIn(null); return; }
    const started = Date.now();
    const update = () => setBrainCheckIn(Math.max(0, 30 - Math.floor((Date.now() - started) / 1_000)));
    update();
    const timer = window.setInterval(update, 1_000);
    return () => window.clearInterval(timer);
  }, [automation, checkInCycle]);
  const protectionHold = /profit lock|drawdown|balance-aware|risk budget/i.test(holdReason ?? '');
  // A stopped bot has no current analysis. Make that the first branch so a
  // recent settlement, old recovery record, or stale phase cannot speak as
  // though this run is still active.
  const state = !automation ? 'idle'
    : phase === 'buying' || phase === 'settling' || phase === 'settled' ? 'trading'
    : protectionHold ? 'protecting'
    : recovery?.mode === 'recovering' ? strategyMode === 'chase' ? 'chasing' : 'recovering'
    : lastResult === 'won' ? 'win'
    : lastResult === 'lost' ? 'loss'
      : observation?.phase === 'watching' || phase === 'watching-signal' ? 'confirming'
        : phase === 'waiting-edge' || phase === 'waiting-entry-trigger' ? 'waiting'
          : market?.lastEpoch ? 'scanning' : 'waiting';
  const label = state === 'recovering' || state === 'chasing' ? 'Trading robot is working toward recovery'
    : state === 'protecting' ? 'Trading robot is protecting account profit'
    : state === 'win' ? 'Trading robot recorded a win'
    : state === 'loss' ? 'Trading robot recorded a loss'
    : state === 'trading' ? 'Trading robot is monitoring the active order'
    : state === 'confirming' ? 'Trading robot is confirming a market setup'
      : state === 'waiting' ? 'Trading robot is waiting for a safe entry'
        : state === 'scanning' ? 'Trading robot is scanning the live market'
          : 'Trading robot is standing by';
  const insight = state === 'trading' ? 'I’m guarding the open order and tracking every tick.'
    : state === 'confirming' ? 'I found a lead. I’m checking the next live ticks.'
      : state === 'waiting' ? 'No clean entry yet. I’m keeping risk contained.'
        : state === 'scanning' ? 'I’m comparing the live rhythm with the model.'
          : 'I’m ready when you are.';

  const laymanInsight = state === 'trading' ? 'Your trade is open. I am watching it closely.'
    : state === 'recovering' ? `We are down ${fmtMoney(recovery?.debt ?? 0)}. I will only take a sensible chance to recover it.`
      : state === 'chasing' ? `We are working through ${fmtMoney(recovery?.debt ?? 0)} slowly. I will not try to win it all at once.`
        : state === 'protecting' ? 'We made progress. I am keeping most of that profit safe.'
          : state === 'win' ? 'That was a win. I am keeping the next move measured.'
            : state === 'loss' ? 'That one did not work. I am reassessing before the next move.'
    : state === 'confirming' ? 'This looks promising. I am waiting for one more check.'
      : state === 'waiting' ? 'I am waiting for a safer moment before using your money.'
        : state === 'scanning' ? 'I am looking for the best time to enter.'
          : 'I am ready when you are.';
  const nextStep = state === 'trading' ? 'Next: wait for the contract result.'
    : state === 'recovering' || state === 'chasing' ? 'Next: wait for a safer recovery chance.'
      : state === 'protecting' ? 'Next: keep the protected profit untouched.'
        : state === 'waiting' ? 'Next: keep checking until the numbers improve.'
          : state === 'confirming' ? 'Next: check one more live move.'
            : 'Next: compare the market price and payout.';
  const setupLabel = forceSetup ? `${forceSetup.direction === 'under' ? 'Under' : 'Over'} ${forceSetup.barrier}` : null;
  const confidenceLabel = forceSetup ? `${Math.round(forceSetup.confidence * 100)}%` : null;
  const promptContext = forceSetup && setupLabel ? `${forceSetup.market} · ${setupLabel} · ${confidenceLabel}` : null;
  const waitingForEntry = automation && state === 'waiting'
    && (phase === 'waiting-edge' || phase === 'waiting-entry-trigger')
    && !protectionHold && recovery?.mode !== 'recovering';
  // A game is a user-confirmed manual choice using the current displayed
  // prediction. It needs a live setup to explain, not a positive-edge bot
  // decision (the bot itself still keeps its stricter execution gates).
  const canOfferGame = automation && phase !== 'buying' && phase !== 'settling' && phase !== 'settled'
    && !protectionHold && recovery?.mode !== 'recovering' && gameSetups.length >= 2;
  const entryWaitRef = useRef(waitingForEntry);
  useEffect(() => { entryWaitRef.current = waitingForEntry; }, [waitingForEntry]);
  const prompts = gameSetups.length >= 2 ? [
    { kind: 'coin', question: 'Heads or tails?', choices: ['Heads', 'Tails'] },
    { kind: 'rps', question: 'Rock, paper, or scissors?', choices: ['Rock', 'Paper', 'Scissors'] },
  ] : [];
  const prompt = prompts[promptIndex % Math.max(prompts.length, 1)];

  useEffect(() => {
    if (!automation) {
      setPromptVisible(false);
      setPromptReply(null);
      setPromptIndex(0);
      setWaitPromptEligible(false);
      setGameCountdown(null);
      return;
    }
    if (!waitingForEntry) {
      setWaitPromptEligible(false);
      setGameCountdown(null);
      return;
    }
    const gameAt = Date.now() + 30_000;
    setGameCountdown(30);
    const ticker = window.setInterval(() => setGameCountdown(Math.max(0, Math.ceil((gameAt - Date.now()) / 1_000))), 1_000);
    const show = window.setTimeout(() => { setGameCountdown(0); setWaitPromptEligible(true); }, 30_000);
    const stop = window.setTimeout(() => setWaitPromptEligible(false), 120_000);
    return () => { window.clearInterval(ticker); window.clearTimeout(show); window.clearTimeout(stop); };
  }, [waitingForEntry]);

  useEffect(() => {
    if (!waitPromptEligible || !canOfferGame || !prompt) return;
    const show = window.setTimeout(() => setPromptVisible(true), 250);
    return () => window.clearTimeout(show);
  }, [waitPromptEligible, waitingForEntry, promptIndex, prompt]);

  // The visible top-left countdown is the companion's source of truth. Once
  // it reaches READY, offer one optional game for this wait—not a stream of
  // prompts—and never during an active trade or confirmation.
  useEffect(() => {
    if (!automation) { setMiniGameShown(false); return; }
    if (brainCheckIn !== 0 || !canOfferGame || miniGameShown || promptVisible) return;
    setPromptIndex(0);
    setGamePhase('offer');
    setGameWinner(null);
    setMiniGameShown(true);
    setPromptVisible(true);
  }, [automation, brainCheckIn, canOfferGame, miniGameShown, promptVisible]);

  const playGame = async () => {
    if (gamePhase !== 'offer' || gameSetups.length < 2) return;
    setGamePhase('spinning');
    setPromptReply(null);
    window.setTimeout(async () => {
      const winner = gameSetups[Math.floor(Math.random() * gameSetups.length)];
      setGameWinner(winner);
      setGamePhase('submitting');
      setPromptReply('Sending your demo trade…');
      const placed = await onForceDemoTrade(winner);
      // A stopped bot must not revive an old companion message after a
      // submitted prompt action resolves.
      if (!automationRef.current) return;
      setGamePhase('result');
      const gameLabel = `${winner.market} ${winner.direction === 'over' ? 'Over' : 'Under'} ${winner.barrier}`;
      setPromptReply(placed ? `${gameLabel} sent on demo. I am watching it now.` : `That ${gameLabel} demo trade could not be placed. I will keep scanning.`);
      window.setTimeout(() => {
        setPromptReply(null);
        setPromptVisible(false);
        setPromptIndex((index) => index + 1);
        setMiniGameShown(false);
        setCheckInCycle((cycle) => cycle + 1);
      }, 2_200);
    }, 900);
  };
  const answerPrompt = (_answer: string) => { void playGame(); };

  return (
    <div class={`market-scanner-companion state-${state} style-${style}${motionEnabled ? '' : ' motion-off'}`} role="group" aria-label={label} onClick={() => { if (customizerOpen) setCustomizerOpen(false); }}>
      <button class="scanner-gear" type="button" aria-label="Customize automation companion" aria-expanded={customizerOpen} onClick={(event) => { event.stopPropagation(); setCustomizerOpen((open) => !open); }}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Zm8.2 3.5 1.5-1.2-1.7-3-1.9.7a7.8 7.8 0 0 0-1.6-.9l-.3-2h-3.4l-.3 2a7.8 7.8 0 0 0-1.6.9L9 7.8l-1.7 3 1.5 1.2v.1l-1.5 1.2 1.7 3 1.9-.7c.5.4 1 .7 1.6.9l.3 2h3.4l.3-2c.6-.2 1.1-.5 1.6-.9l1.9.7 1.7-3-1.5-1.2V12Z" /></svg>
      </button>
      {customizerOpen && <div class="scanner-customizer" role="dialog" aria-label="Automation companion settings" onClick={(event) => event.stopPropagation()}>
        <strong>Automation companion</strong>
        <p>Live quote link is on.</p>
        <label><span>Motion</span><input type="checkbox" checked={motionEnabled} onInput={(event) => setMotionEnabled(event.currentTarget.checked)} /></label>
        <label><span>Insights</span><input type="checkbox" checked={voiceEnabled} onInput={(event) => setVoiceEnabled(event.currentTarget.checked)} /></label>
        <div class="scanner-style-picker" aria-label="Companion style">
          {(['focus', 'calm', 'vivid'] as const).map((option) => <button type="button" class={style === option ? 'selected' : ''} onClick={() => setStyle(option)}>{option}</button>)}
        </div>
      </div>}
      <svg viewBox="0 0 520 110" aria-hidden="true">
        <path class="scanner-ground" d="M20 88H238" />
        <path class="scanner-cable cable-a" d="M193 49C270 49 330 -88 380 -88S461 -94 520 -94" />
        <path class="scanner-cable cable-b" d="M190 57C272 78 340 -48 395 -48S466 -48 520 -48" />
        <path class="scanner-cable cable-c" d="M185 65C274 108 349 -8 404 -8S471 -8 520 -8" />
        <path class="scanner-wire wire-a" d="M193 49C270 49 330 -88 380 -88S461 -94 520 -94" />
        <path class="scanner-wire wire-b" d="M190 57C272 78 340 -48 395 -48S466 -48 520 -48" />
        <path class="scanner-wire wire-c" d="M185 65C274 108 349 -8 404 -8S471 -8 520 -8" />
        {automation && brainCheckIn != null && !promptVisible && <g class="scanner-svg-checkin" aria-label={`Check-in ${brainCheckIn > 0 ? `${brainCheckIn} seconds` : 'ready'}`}>
          <circle cx="18" cy="16" r="3" /><text x="27" y="19">CHECK-IN</text><text class="scanner-svg-checkin-value" x="27" y="30">{brainCheckIn > 0 ? `${brainCheckIn}s` : 'READY'}</text>
        </g>}
        <g class="scanner-brain">
          <path class="brain-shell" d="M78 64C62 62 56 48 63 36C66 24 78 19 90 23C101 12 122 15 130 27C149 23 164 37 160 52C170 66 160 82 145 82C135 92 116 91 106 84C92 89 77 80 78 64Z" />
          <path class="brain-folds" d="M74 43C87 35 91 50 103 42C113 31 123 46 131 38C141 30 151 43 146 55M78 59C91 49 97 66 108 57C118 47 126 66 138 57C147 50 155 60 151 70M92 25C88 36 102 32 100 48M119 22C112 34 126 37 121 52M145 32C135 42 149 47 142 59" />
          <path class="brain-circuit" d="M68 70H94L103 61H121L132 71H159M106 84V96M135 82V96" />
          <g class="brain-nerves">
            <path class="brain-nerve nerve-a" d="M121 52C110 43 106 31 91 27M110 45L98 37M106 40L105 25" />
            <path class="brain-nerve nerve-b" d="M121 52C133 44 142 36 151 39M137 43L148 29M142 48L158 51" />
            <path class="brain-nerve nerve-c" d="M121 52C111 61 103 71 89 70M105 64L91 79M113 67L112 84" />
            <path class="brain-nerve nerve-d" d="M121 52C131 61 141 71 153 69M141 65L145 80M147 61L162 59" />
          </g>
          <circle class="brain-node n1" cx="94" cy="70" r="4" /><circle class="brain-node n2" cx="121" cy="52" r="4" /><circle class="brain-node n3" cx="132" cy="71" r="4" /><circle class="brain-node n4" cx="160" cy="70" r="4" />
        </g>
      </svg>
      {automation && voiceEnabled && <div class="scanner-thought"><i></i><div><span>{laymanInsight}</span><small>{gameCountdown != null && !promptVisible ? `Coin flip available in ${gameCountdown}s — still prioritizing a trade.` : nextStep}</small></div></div>}
      {automation && promptVisible && <div class="scanner-prompt" role="status">
        <span>{promptReply ?? prompt.question}</span>
        {gamePhase === 'offer' && <>
          <div class="scanner-game-setups">{gameSetups.slice(0, 2).map((setup) => <small key={`${setup.symbol}-${setup.direction}-${setup.barrier}`}><b>{setup.market}</b> · {setup.direction === 'over' ? 'Over' : 'Under'} {setup.barrier}<em>{Math.round(setup.confidence * 100)}% · {setup.edge >= 0 ? '+' : ''}{(setup.edge * 100).toFixed(1)}%</em></small>)}</div>
        </>}
        {!promptReply && prompt.kind === 'coin' && <svg class="scanner-game-stage coin-stage" viewBox="0 0 56 32" aria-label="Coin flip ready"><ellipse cx="28" cy="16" rx="13" ry="13" /><path d="M28 5V27M19 16H37" /><text x="28" y="19" text-anchor="middle">H/T</text></svg>}
        {!promptReply && prompt.kind === 'rps' && <svg class="scanner-game-stage rps-stage" viewBox="0 0 56 32" aria-label="Rock paper scissors ready"><path d="M10 23C10 17 14 12 20 12H27C32 12 36 16 36 21V23H10Z" /><path d="M38 9L45 16M45 9L38 16" /><circle cx="27" cy="8" r="3" /></svg>}
        {!promptReply && promptContext && <div class="scanner-option-contexts" aria-hidden="true">{prompt.choices.map((choice) => <small>{choice} · {promptContext}</small>)}</div>}
        {!promptReply && <div>{prompt.question.includes('heads or tails') && <i class="scanner-game coin">◒</i>}{prompt.question.includes('rock, paper') && <i class="scanner-game rps">✊</i>}{prompt.choices.map((choice) => <button type="button" onClick={(event) => { event.stopPropagation(); void answerPrompt(choice); }}>{choice}</button>)}</div>}
      </div>}
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

function MarketPulse({ market, onChoose, automation = false, phase, observation }: { market: Market | null; onChoose: () => void; automation?: boolean; phase?: string; observation?: AutomationState['observation'] }): JSX.Element {
  const quotes = (market?.recentQuotes ?? []).filter((quote) => Number.isFinite(quote) && quote > 0);
  const first = quotes[0] ?? 0;
  const last = quotes[quotes.length - 1] ?? market?.lastQuote ?? 0;
  const changePct = first > 0 ? ((last - first) / first) * 100 : 0;
  const up = last >= first;
  const label = shortMarketName(market?.display ?? 'Selected market');
  const scanning = automation && !['buying', 'settling', 'settled'].includes(phase ?? '');
  const required = Math.max(1, observation?.required ?? 3);
  const progress = Math.min(100, Math.round(((observation?.confirmations ?? 0) / required) * 100));

  return (
    <div class="market-pulse-shell">
      <button id="market-pulse-trigger" type="button" class={`market-pulse${up ? ' up' : ' down'}${market ? ' selected' : ''}`} aria-label="Choose a market and manual barrier from the live quote chart" onClick={onChoose}>
        <div class="market-pulse-head">
          <span class="market-pulse-label">Live quote</span>
          <span class={`market-pulse-change${up ? ' up' : ' down'}`}>{quotes.length > 1 ? `${up ? '+' : ''}${changePct.toFixed(2)}%` : '--'}</span>
        </div>
        <div class={`market-pulse-chart${scanning ? ' scanning' : ''}`}>
          {quotes.length > 1 ? <MarketPulseChart quotes={quotes} lastEpoch={market?.lastEpoch ?? 0} up={up} label={label} /> : <span class="market-pulse-empty">Awaiting ticks</span>}
          {scanning && <div class="market-pulse-analysis" aria-hidden="true"><i class="analysis-sweep"></i><i class="analysis-lock a"></i><i class="analysis-lock b"></i></div>}
        </div>
        <div class="market-pulse-foot">
          <span>{label}</span>
          <b>{last > 0 ? last.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '--'}</b>
        </div>
      </button>
      <a class="market-pulse-attribution" href="https://www.tradingview.com/" target="_blank" rel="noopener noreferrer">Charts by TradingView</a>
    </div>
  );
}

function QueueQuote({ quote, digit }: { quote: number; digit: number }): JSX.Element {
  const formatted = quote.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 });
  // Number values lose trailing zeroes, while Deriv supplies the canonical last
  // digit separately. Replace the displayed final decimal with that canonical digit.
  const text = `${formatted.slice(0, -1)}${digit}`;
  const index = text.length - 1;
  return <span class="queue-live-quote" aria-label={`Live quote ${text}, final digit ${digit}`}>
    <small>Live quote</small>
    <b>{text.slice(0, index)}<mark>{text.charAt(index)}</mark></b>
  </span>;
}

function ManualGameArena({
  markets, candidates, paperTrades, stake, currency, accountMode, feedConnected,
  busy, locked, queued, status, error, onStake, onPlay, onAdvanced,
}: {
  markets: Market[];
  candidates: SignalCandidate[];
  paperTrades: PaperTrade[];
  stake: string;
  currency?: string;
  accountMode?: 'demo' | 'real';
  feedConnected: boolean;
  busy: boolean;
  locked: boolean;
  queued: boolean;
  status: string;
  error: boolean;
  onStake: (stake: string) => void;
  onPlay: (direction: 'over' | 'under', barrier: number, market: string) => Promise<boolean>;
  onAdvanced: () => void;
}): JSX.Element {
  const targets = priorityManualTargets(markets, candidates, paperTrades);
  const bestScore = Math.max(...targets.map((target) => target.score), -Infinity);
  const settledPaper = paperTrades.filter((trade) => trade.status === 'won' || trade.status === 'lost');
  const paperWins = settledPaper.filter((trade) => trade.status === 'won').length;
  const playAmount = Math.max(.1, Number(stake) || 1);

  return (
    <section class="manual-arena" aria-label="Manual trade arena">
      <header class="arena-head">
        <div>
          <span class="arena-eyebrow"><i class={feedConnected ? 'online' : ''}></i>{feedConnected ? 'Live market field' : 'Reconnecting market field'}</span>
          <h1>Pick a power play.</h1>
          <p>Each target locks onto the strongest market for that contract. Pressing it is the trade action.</p>
        </div>
        <div class="arena-wallet">
          <label><span>Play amount</span><input type="number" min="0.1" step="0.1" inputMode="decimal" value={stake} onInput={(event) => onStake((event.currentTarget as HTMLInputElement).value)} /></label>
          <small>{accountMode === 'real' ? 'Real account · review required' : accountMode === 'demo' ? 'Demo account · one-press play' : 'Connect to play'}</small>
        </div>
      </header>

      <div class="arena-field">
        <div class="arena-field-lines" aria-hidden="true"><i></i><i></i><i></i></div>
        {targets.length === 0 && [
          ['Over 1', 'over'], ['Over 2', 'over'], ['Under 7', 'under'], ['Under 8', 'under'],
        ].map(([label, tone], index) => (
          <div class={`arena-target arena-target-loading ${tone}`} key={label}>
            <span class="arena-rank">ZONE 0{index + 1}</span>
            <span class="arena-orb"><b>·</b><i></i></span>
            <span class="arena-contract">{label}</span>
            <strong>Scanning markets</strong>
            <span class="arena-signal"><i></i>Waiting for live ticks</span>
            <span class="arena-launch">LOCKING TARGET...</span>
          </div>
        ))}
        {targets.map((target, index) => {
          const paperTotal = target.paperWins + target.paperLosses;
          const highDigits = target.market.recentDigits.filter((digit) => digit >= 5).length;
          const highMix = target.market.recentDigits.length ? highDigits / target.market.recentDigits.length : .5;
          const lift = target.score * 100;
          const isBest = target.score === bestScore;
          const tone = target.direction === 'over' ? 'over' : 'under';
          const strength = lift >= 3 ? 'Hot' : lift >= 1 ? 'Ready' : 'Watch';
          return (
            <button
              type="button"
              class={`arena-target ${tone}${isBest ? ' best' : ''}`}
              style={{ '--arena-delay': `${index * 80}ms` } as JSX.CSSProperties}
              disabled={busy || locked || queued || !feedConnected}
              onClick={() => void onPlay(target.direction, target.barrier, target.market.symbol)}
              key={`${target.direction}-${target.barrier}`}
              aria-label={`Play ${target.label} on ${shortMarketName(target.market.display)} for ${fmtMoney(playAmount, currency)}`}
            >
              <span class="arena-rank">{isBest ? 'BEST NOW' : `ZONE 0${index + 1}`}</span>
              <span class="arena-orb"><b>{target.market.lastDigit}</b><i></i></span>
              <span class="arena-contract">{target.label}</span>
              <strong>{shortMarketName(target.market.display)}</strong>
              <span class="arena-signal"><i></i>{strength} · {lift >= 0 ? '+' : ''}{lift.toFixed(1)} research score</span>
              <span class="arena-evidence">
                <small>Recent {Math.round(target.observedWin * 100)}%</small>
                <small>High digits {Math.round(highMix * 100)}%</small>
                <small>Paper {paperTotal ? `${target.paperWins}–${target.paperLosses}` : 'learning'}</small>
              </span>
              <span class="arena-launch">{busy ? 'SENDING...' : `PLAY ${fmtMoney(playAmount, currency)}`}</span>
            </button>
          );
        })}
      </div>

      <footer class="arena-foot">
        <div class="arena-paper"><span><i></i>Paper scout runs continuously</span><b>{settledPaper.length ? `${paperWins}/${settledPaper.length} wins observed` : 'Building the first evidence sample'}</b></div>
        <div class={`arena-message${error ? ' error' : ''}`} aria-live="polite">{status || 'Targets use public ticks and delayed-entry evidence. A live quote is requested only when you play.'}</div>
        <button type="button" class="arena-advanced" onClick={onAdvanced}>Open control console <Icon name="chevronRight" size={14} /></button>
      </footer>
    </section>
  );
}

function InlineMarketChooser({
  markets,
  candidates,
  selectedMarket,
  trades,
  direction,
  barrier,
  stake,
  entryMode,
  onDirection,
  onBarrier,
  onMarket,
  onEntryMode,
  onTimedSetup,
  onStake,
  onPlace,
  onClose,
  manualStatus,
  manualQueued,
  queuedIntent,
  queuedMarket,
  manualPreview,
  manualExecution,
  busy,
  onConfirmPreview,
  onCancelPreview,
  onCancelManualQueue,
}: {
  markets: Market[];
  candidates: SignalCandidate[];
  selectedMarket: Market | null;
  trades: TradeRow[];
  direction: 'over' | 'under';
  barrier: number;
  stake: string;
  entryMode: ManualEntryMode;
  onDirection: (direction: 'over' | 'under') => void;
  onBarrier: (direction: 'over' | 'under', barrier: number) => void;
  onMarket: (symbol: string) => void;
  onEntryMode: (mode: ManualEntryMode) => void;
  onTimedSetup: (setup: ManualSetup) => void;
  onStake: (stake: string) => void;
  onPlace: (direction: 'over' | 'under', barrier: number, market?: string) => Promise<boolean>;
  onClose: () => void;
  manualStatus: string;
  manualQueued: boolean;
  queuedIntent: TimedManualIntent | null;
  queuedMarket: Market | null;
  manualPreview: ManualTradePreview | null;
  manualExecution: ManualExecutionView;
  busy: boolean;
  onConfirmPreview: () => void;
  onCancelPreview: () => void;
  onCancelManualQueue: () => void;
}): JSX.Element {
  const [realFundsConfirmed, setRealFundsConfirmed] = useState(false);
  const [clock, setClock] = useState(Date.now());
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
  const settledManual = trades.filter((trade) => trade.origin === 'manual' && (trade.status === 'won' || trade.status === 'lost'));
  const setupHistory = settledManual.filter((trade) => trade.market === selectedMarket?.symbol
    && trade.barrier === barrier
    && trade.contract_type === (direction === 'over' ? 'DIGITOVER' : 'DIGITUNDER'));
  const modeMarker = entryMode === 'instant' ? 'trade-now' : entryMode === 'model' ? 'validated-model' : 'pattern';
  const modeHistory = settledManual.filter((trade) => trade.reason.includes(modeMarker));
  const setupWins = setupHistory.filter((trade) => trade.status === 'won').length;
  const modeWins = modeHistory.filter((trade) => trade.status === 'won').length;
  const twoPass = confirmedDigitTriggerProgress(direction, selectedMarket?.recentDigits ?? []);
  const queueDirection = queuedIntent?.direction ?? direction;
  const queueStage = queuedIntent?.twoPassStage ?? 0;
  const queueProgress = queuedIntent?.entryMode === 'digit-trigger-confirmed'
    ? { first: queueStage >= 1, follow: queueStage >= 2, reentry: queueStage >= 3 }
    : twoPass;
  const previewSeconds = manualPreview ? Math.max(0, Math.ceil((manualPreview.expiresAt - clock) / 1_000)) : 0;
  const executionStep = ({ idle: 0, quoting: 1, review: 2, buying: 3, purchased: 4, settled: 5, failed: -1 } as const)[manualExecution.stage];
  useEffect(() => {
    setRealFundsConfirmed(false);
    if (!manualPreview) return;
    setClock(Date.now());
    const timer = window.setInterval(() => setClock(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [manualPreview?.previewId]);
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
    onTimedSetup(strongest);
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
    onTimedSetup(strongest);
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
      <div class={`inline-entry-status${manualQueued ? ' queued' : ''}`} aria-live="polite">
        <span>{manualQueued ? 'Queued trade · waiting for entry' : 'Trade queue · idle'}</span>
        <b>{manualStatus || 'Choose Best for barrier or Best overall to arm a setup. It will wait for the required live entry checks before sending a contract.'}</b>
        {queuedIntent && queuedMarket && <small class="queue-market-watch">Watching {shortMarketName(queuedMarket.display)} live ticks</small>}
        {(queuedIntent?.entryMode === 'digit-trigger-confirmed' || (!manualQueued && entryMode === 'digit-trigger-confirmed')) && <div class="queue-trigger-progress" aria-label="Two-pass trigger progress">
          <div class={`queue-trigger-step${queueProgress.first ? ' pass' : ''}${queueStage === 0 ? ' active' : ''}`}>
            <span>1. First {queueDirection === 'over' ? '8/9' : '0/1'}</span>
            {queuedIntent?.firstTriggerQuote != null && queuedIntent.firstTriggerDigit != null && <QueueQuote quote={queuedIntent.firstTriggerQuote} digit={queuedIntent.firstTriggerDigit} />}
          </div>
          <div class={`queue-trigger-step${queueProgress.follow ? ' pass' : ''}${queueStage === 1 ? ' active' : ''}`}>
            <span>2. {queueDirection === 'over' ? 'High' : 'Low'} follow-through</span>
            {queuedIntent?.followThroughQuote != null && queuedIntent.followThroughDigit != null && <QueueQuote quote={queuedIntent.followThroughQuote} digit={queuedIntent.followThroughDigit} />}
          </div>
          <div class={`queue-trigger-step${queueProgress.reentry ? ' pass' : ''}${queueStage === 2 ? ' active' : ''}`}>
            <span>3. New {queueDirection === 'over' ? '8/9' : '0/1'} entry</span>
            {queuedIntent?.reentryQuote != null && queuedIntent.reentryDigit != null && <QueueQuote quote={queuedIntent.reentryQuote} digit={queuedIntent.reentryDigit} />}
          </div>
        </div>}
        {manualQueued && <button type="button" onClick={onCancelManualQueue}>Cancel queue</button>}
      </div>
      <>
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
      <label class="inline-entry-mode">
        <span>Entry instruction</span>
        <select value={entryMode} onChange={(event) => onEntryMode((event.currentTarget as HTMLSelectElement).value as ManualEntryMode)}>
          <option value="instant">Trade now — review quote, then confirm</option>
          <option value="model">Wait for model — quality gates</option>
          <option value="digit-trigger-confirmed">Wait for pattern — two-pass sequence</option>
        </select>
        <small>{entryMode === 'instant'
          ? 'Gets a live proposal and shows its payout, break-even, account impact, and risk checks. Nothing is purchased until you confirm.'
          : entryMode === 'model'
            ? 'Arms this exact setup for up to three minutes and buys only after the model, quote edge, return, consistency, and fresh-tick checks pass.'
            : 'Waits for extreme, follow-through, and a fresh extreme before requesting the final proposal. Keep this tab open while armed.'}</small>
      </label>
      <div class="inline-confidence">
        <div><span>Confidence</span><b>{selectedConfidence != null ? `${(selectedConfidence * 100).toFixed(1)}%` : '—'}</b></div>
        <div><span>Edge</span><b class={exact && exact.edge >= 0 ? 'positive' : ''}>{exact ? `${exact.edge >= 0 ? '+' : ''}${(exact.edge * 100).toFixed(1)}%` : '—'}</b></div>
        <div class="inline-confidence-actions">
          <button type="button" title={`Choose the strongest Over/Under prediction for barrier ${barrier}`} onClick={useStrongestForBarrier} disabled={!ranked.length}>Best for {barrier}</button>
          <button type="button" class="secondary" onClick={useStrongest} disabled={!ranked.length}>Best overall</button>
        </div>
      </div>
      <div class="manual-evidence-strip" aria-label="Settled manual trade evidence">
        <div><span>This setup</span><b>{setupHistory.length ? `${setupWins}/${setupHistory.length} wins` : 'No settled sample'}</b></div>
        <div><span>Setup P&amp;L</span><b class={setupHistory.reduce((sum, trade) => sum + trade.profit, 0) >= 0 ? 'positive' : 'negative'}>{fmtMoney(setupHistory.reduce((sum, trade) => sum + trade.profit, 0))}</b></div>
        <div><span>This instruction</span><b>{modeHistory.length ? `${Math.round((modeWins / modeHistory.length) * 100)}% · ${modeHistory.length} trades` : 'No settled sample'}</b></div>
      </div>
      <p>{entryMode === 'instant' ? 'A second fresh proposal is checked at confirmation. If price or payout worsens by more than 2%, purchase stops and asks for another review.' : 'The armed instruction belongs to this browser tab. Closing or refreshing the tab cancels it safely.'}</p>
      <button class="inline-place-single" type="button" disabled={!selectedMarket || busy || manualQueued || Boolean(manualPreview)} onClick={() => void onPlace(direction, barrier, selectedMarket?.symbol)}>
        {entryMode === 'instant' ? `Review ${sideLabel(direction, barrier)}` : entryMode === 'model' ? `Arm model for ${sideLabel(direction, barrier)}` : `Arm pattern for ${sideLabel(direction, barrier)}`}
      </button>
      {manualPreview && <section class={`manual-review-ticket ${manualPreview.account.mode}`} aria-label="Manual trade review">
        <header>
          <div><span>{manualPreview.account.mode === 'real' ? 'Real funds' : 'Demo funds'} · review required</span><h3>{shortMarketName(manualPreview.market.display)} · {sideLabel(manualPreview.order.direction, manualPreview.order.barrier)}</h3></div>
          <b>{previewSeconds}s</b>
        </header>
        <div class="manual-review-grid">
          <div><span>Stake</span><b>{fmtMoney(manualPreview.quote.ask, manualPreview.account.currency)}</b></div>
          <div><span>Payout</span><b>{fmtMoney(manualPreview.quote.payout, manualPreview.account.currency)}</b></div>
          <div><span>Potential profit</span><b>{fmtMoney(manualPreview.quote.potentialProfit, manualPreview.account.currency)}</b></div>
          <div><span>Break-even</span><b>{(manualPreview.quote.breakeven * 100).toFixed(1)}%</b></div>
          <div><span>Model estimate</span><b>{(manualPreview.model.estimatedWin * 100).toFixed(1)}%</b></div>
          <div><span>Estimated edge</span><b class={manualPreview.model.edge >= 0 ? 'positive' : 'negative'}>{manualPreview.model.edge >= 0 ? '+' : ''}{(manualPreview.model.edge * 100).toFixed(1)}%</b></div>
          <div><span>Balance after stake</span><b>{fmtMoney(manualPreview.account.balanceAfter, manualPreview.account.currency)}</b></div>
          <div><span>Quote status</span><b>{previewSeconds > 0 ? 'Fresh' : 'Expired'}</b></div>
        </div>
        <p class="manual-review-risk"><i aria-hidden="true">✓</i>{manualPreview.risk.reason}</p>
        {manualPreview.account.mode === 'real' && <label class="manual-real-confirm"><input type="checkbox" checked={realFundsConfirmed} onChange={(event) => setRealFundsConfirmed((event.currentTarget as HTMLInputElement).checked)} /><span>I understand this purchase uses real funds.</span></label>}
        <div class="manual-review-actions">
          <button type="button" class="cancel" onClick={onCancelPreview} disabled={busy}>Cancel</button>
          <button type="button" class="confirm" onClick={onConfirmPreview} disabled={busy || previewSeconds <= 0 || (manualPreview.account.mode === 'real' && !realFundsConfirmed)}>{busy ? 'Confirming…' : manualPreview.account.mode === 'real' ? 'Confirm real-money trade' : 'Confirm demo trade'}</button>
        </div>
      </section>}
      {manualExecution.stage !== 'idle' && <div class={`manual-execution-track ${manualExecution.stage}`} aria-live="polite">
        <div class={executionStep >= 1 ? 'pass' : ''}><i>1</i><span>Quote</span></div>
        <div class={executionStep >= 2 ? 'pass' : ''}><i>2</i><span>Risk review</span></div>
        <div class={executionStep >= 4 ? 'pass' : executionStep === 3 ? 'active' : ''}><i>3</i><span>Purchase</span></div>
        <div class={executionStep >= 5 ? 'pass' : executionStep === 4 ? 'active' : ''}><i>4</i><span>Settlement</span></div>
        <p>{manualExecution.message}</p>
        {manualExecution.trade && <small>Contract {manualExecution.trade.contractId} · entry {fmtMoney(manualExecution.trade.ask)} · payout {fmtMoney(manualExecution.trade.payout)}</small>}
      </div>}
      </>
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
  settings,
  onChooseMarket,
  marketChooserOpen,
  onCloseMarketChooser,
  manualDirection,
  manualOverBarrier,
  manualUnderBarrier,
  manualStake,
  manualEntryMode,
  onManualDirection,
  onManualBarrier,
  onManualMarket,
  onManualEntryMode,
  onManualTimedSetup,
  onManualStake,
  onManualPlace,
  manualStatus,
  manualQueued,
  queuedIntent,
  queuedMarket,
  manualPreview,
  manualExecution,
  manualBusy,
  onConfirmManualPreview,
  onCancelManualPreview,
  onCancelManualQueue,
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
  settings: Settings | null;
  onChooseMarket: () => void;
  marketChooserOpen: boolean;
  onCloseMarketChooser: () => void;
  manualDirection: 'over' | 'under';
  manualOverBarrier: number;
  manualUnderBarrier: number;
  manualStake: string;
  manualEntryMode: ManualEntryMode;
  onManualDirection: (direction: 'over' | 'under') => void;
  onManualBarrier: (direction: 'over' | 'under', barrier: number) => void;
  onManualMarket: (symbol: string) => void;
  onManualEntryMode: (mode: ManualEntryMode) => void;
  onManualTimedSetup: (setup: ManualSetup) => void;
  onManualStake: (stake: string) => void;
  onManualPlace: (direction: 'over' | 'under', barrier: number, market?: string, companionDemo?: boolean) => Promise<boolean>;
  manualStatus: string;
  manualQueued: boolean;
  queuedIntent: TimedManualIntent | null;
  queuedMarket: Market | null;
  manualPreview: ManualTradePreview | null;
  manualExecution: ManualExecutionView;
  manualBusy: boolean;
  onConfirmManualPreview: () => void;
  onCancelManualPreview: () => void;
  onCancelManualQueue: () => void;
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
  // A companion game never invents a trade. It compares two distinct,
  // positive-edge live setups already ranked by the signal engine.
  const companionGameSetups = candidates
    .filter((candidate) => candidate.edge > 0)
    .sort((a, b) => b.estWin - a.estWin || b.edge - a.edge)
    .filter((candidate, index, list) => list.findIndex((other) => other.market === candidate.market) === index)
    .slice(0, 2)
    .map((candidate) => ({
      market: shortMarketName(markets.find((market) => market.symbol === candidate.market)?.display ?? candidate.market),
      symbol: candidate.market,
      direction: candidate.direction,
      barrier: candidate.barrier,
      confidence: candidate.estWin,
      edge: candidate.edge,
    }));

  const status = !automation
    ? stopReason
      ? { label: 'BOT STOPPED', tone: 'warn' }
      : { label: 'BOT IDLE', tone: 'idle' }
    : decision
      ? { label: 'TRADE ACTIVE', tone: 'go' }
      : holdReason
        ? { label: 'WAITING FOR EDGE', tone: 'warn' }
        : { label: (phase === 'watching' ? 'CONFIRMING SETUP' : 'SCANNING LIVE'), tone: 'scan' };

  const bestLabel = best
    ? shortMarketName(markets.find((m) => m.symbol === best.market)?.display ?? best.market)
    : markets[0]
      ? shortMarketName(markets[0].display)
      : '—';

  const mostRecentSettlement = trades.find((trade) => trade.status === 'won' || trade.status === 'lost');
  const lastResult = automation && mostRecentSettlement && Date.now() - mostRecentSettlement.resolved_at < 12_000
    ? mostRecentSettlement.status
    : null;
  const winFlash = lastResult === 'won';
  const outcomeTrade = trades.find((trade) => isOpenAccountTrade(trade) && isDigitTrade(trade)) ?? null;
  const note = (() => {
    if (outcomeTrade) {
      const side = outcomeTrade.contract_type === 'DIGITUNDER' ? 'Under' : 'Over';
      const marketName = shortMarketName(markets.find((market) => market.symbol === outcomeTrade.market)?.display ?? outcomeTrade.market);
      const elapsed = fmtElapsed(Date.now() - outcomeTrade.ts);
      return `Waiting for Deriv to confirm the outcome: ${marketName} ${side} ${outcomeTrade.barrier} was submitted ${elapsed} ago. The digit lane stays protected until the result arrives; no additional manual order will be sent.`;
    }
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
    <div class={`cockpit${marketChooserOpen ? ' manual-open' : ''}${automation && !marketChooserOpen ? ' automation-active' : ''}`}>
      {!marketChooserOpen && <div class="cockpit-primary">
      <div class="cockpit-market">{bestLabel}</div>

      <div class="cockpit-pick">
        <div class="cockpit-side">{best ? sideLabel(best.direction, best.barrier) : 'AWAITING SIGNAL'}</div>
        {best && <div class="cockpit-pct">{Math.round(best.estWin * 100)}%</div>}
      </div>

      <div class={`cockpit-status ${status.tone}${winFlash ? ' win' : ''}`}>
        <span class="cockpit-status-dot"></span>
        <span>{winFlash ? 'WIN RECORDED' : status.label}</span>
      </div>

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
        <MarketScannerCompanion automation={automation} phase={phase} observation={observation} market={(best ? markets.find((market) => market.symbol === best.market) : null) ?? selectedMarket} recovery={recovery} lastResult={lastResult} strategyMode={settings?.strategy_mode} holdReason={holdReason} forceSetup={best ? { market: shortMarketName(markets.find((market) => market.symbol === best.market)?.display ?? best.market), direction: best.direction, barrier: best.barrier, confidence: best.estWin, eligible: best.edge > 0 && best.estWin >= best.breakeven } : null} gameSetups={companionGameSetups} onForceDemoTrade={(setup) => onManualPlace(setup.direction, setup.barrier, setup.symbol, true)} />
      </div>}
      {marketChooserOpen ? (
        <div class="manual-cockpit-takeover">
          <InlineMarketChooser
          markets={markets}
          candidates={candidates}
          selectedMarket={selectedMarket}
          trades={trades}
          direction={manualDirection}
          barrier={manualDirection === 'over' ? manualOverBarrier : manualUnderBarrier}
          stake={manualStake}
          entryMode={manualEntryMode}
          onDirection={onManualDirection}
          onBarrier={onManualBarrier}
          onMarket={onManualMarket}
          onEntryMode={onManualEntryMode}
          onTimedSetup={onManualTimedSetup}
          onStake={onManualStake}
          onPlace={onManualPlace}
          manualStatus={manualStatus}
          manualQueued={manualQueued}
          queuedIntent={queuedIntent}
          queuedMarket={queuedMarket}
          manualPreview={manualPreview}
          manualExecution={manualExecution}
          busy={manualBusy}
          onConfirmPreview={onConfirmManualPreview}
          onCancelPreview={onCancelManualPreview}
          onCancelManualQueue={onCancelManualQueue}
            onClose={onCloseMarketChooser}
          />
        </div>
      ) : <MarketPulse market={selectedMarket} onChoose={onChooseMarket} automation={automation} phase={phase} observation={observation} />}
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

function CowConfirmationSettings({ session }: { session: SessionInfo }): JSX.Element | null {
  const [disabled, setDisabled] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    const refresh = () => {
      try { setDisabled(session.mode === 'real' && localStorage.getItem(`zeronine:real-cow-confirm:${session.loginid}`) === 'enabled'); }
      catch { setDisabled(false); }
    };
    refresh();
    window.addEventListener('real-cow-preference', refresh);
    window.addEventListener('storage', refresh);
    return () => { window.removeEventListener('real-cow-preference', refresh); window.removeEventListener('storage', refresh); };
  }, [session.loginid, session.mode]);
  if (session.mode !== 'real') return null;
  return <section class="cow-confirm-settings" aria-label="Real-money manual trade confirmation"><div><span>PASTURE SETTINGS</span><h2>Real-money confirmation</h2><p>{disabled ? 'Confirmation is off for manual trades on this account in this browser.' : 'You will review and confirm real-money manual trades before they are placed.'}</p></div><button type="button" disabled={!disabled} onClick={() => { try { localStorage.removeItem(`zeronine:real-cow-confirm:${session.loginid}`); setError(''); window.dispatchEvent(new Event('real-cow-preference')); } catch { setError('Could not update this browser setting. Please try again.'); } }}>{disabled ? 'Turn confirmation on' : 'Confirmation on'}</button>{error && <small role="alert">{error}</small>}</section>;
}

/* ---------------- history ---------------- */

type Filter = 'all' | 'wins' | 'losses' | 'over' | 'under' | 'multipliers';

function PastureHistory(): JSX.Element {
  const s = useStore();
  const [trades, setTrades] = useState<TradeRow[]>([]);
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const generation = useRef(0);
  useEffect(() => {
    const token = ++generation.current;
    setTrades([]); setMore(false); setError('');
    if (!s.owner || !s.session) { setBusy(false); return; }
    setBusy(true);
    void fetchTradeHistoryPage().then(rows => { if (token === generation.current) { setTrades(rows); setMore(rows.length === 50); } }).catch(() => { if (token === generation.current) setError('Could not load history. Try reopening this panel.'); }).finally(() => { if (token === generation.current) setBusy(false); });
    return () => { generation.current++; };
  }, [s.owner, s.session?.loginid]);
  const loadMore = async () => {
    if (busy || !trades.length) return;
    const token = generation.current;
    setBusy(true); setError('');
    try {
      const rows = await fetchTradeHistoryPage(trades[trades.length - 1].id);
      if (token === generation.current) { setTrades(current => [...current, ...rows]); setMore(rows.length === 50); }
    } catch { if (token === generation.current) setError('Could not load older trades. Please try again.'); }
    finally { if (token === generation.current) setBusy(false); }
  };
  if (s.multiplayerEnabled && !s.playerSession) return <p class="pasture-detail-empty">Connect Deriv to see your account trades.</p>;
  if (s.multiplayerEnabled && s.playerSession) return <section class="pasture-history" aria-label="Your account trades">
    <p class="pasture-detail-intro">Account trades for <strong>{s.playerSession.loginid}</strong></p>
    <div class="pasture-history-list">{s.playerTrades.map(trade => <article class="pasture-history-row" key={trade.id}>
      <div><strong>{shortMarketName(s.markets.find(market => market.symbol === trade.market)?.display ?? trade.market)}</strong><small>{tradeContractLabel(trade)} · {new Date(trade.ts).toLocaleString()}</small></div>
      <div><b class={trade.status === 'won' ? 'win' : trade.status === 'lost' ? 'loss' : ''}>{trade.status.toUpperCase()}</b><small>{fmtSigned(trade.profit, s.playerSession?.currency ?? '')}</small></div>
    </article>)}</div>
    {!s.playerTrades.length && <p class="pasture-detail-empty">No account trades yet.</p>}
  </section>;
  if (!s.owner) return <p class="pasture-detail-empty">Unlock the dashboard to view your trade history.</p>;
  if (!s.session) return <p class="pasture-detail-empty">Connect Deriv to see your account trade history.</p>;
  return <section class="pasture-history" aria-label="Account trades">
    <p class="pasture-detail-intro">Account trades for <strong>{s.session.loginid}</strong></p>
    <div class="pasture-history-list">{trades.map(trade => <article class="pasture-history-row" key={trade.id}>
      <div><strong>{shortMarketName(s.markets.find(market => market.symbol === trade.market)?.display ?? trade.market)}</strong><small>{tradeContractLabel(trade)} ? {new Date(trade.ts).toLocaleString()}</small></div>
      <div><b class={trade.status === 'won' ? 'win' : trade.status === 'lost' ? 'loss' : ''}>{trade.status.toUpperCase()}</b><small>{trade.profit == null ? 'Pending' : fmtSigned(trade.profit, s.session?.currency ?? '')}</small></div>
    </article>)}</div>
    {!trades.length && !busy && !error && <p class="pasture-detail-empty">No account trades yet.</p>}
    {error && <p role="alert">{error}</p>}
    {more && <button class="pasture-detail-action" type="button" onClick={() => void loadMore()} disabled={busy}>{busy ? 'Loading?' : 'Load older trades'}</button>}
    {busy && !trades.length && <p class="pasture-detail-empty">Loading history?</p>}
  </section>;
}

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
        {multiplierTrades.length === 0 && <div class="empty-hint">No Gold or legacy multiplier trades yet</div>}
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

function mergeMomentumSamples(samples: MomentumScanSample[], next: MomentumScanSample | null, limit = 1_800): MomentumScanSample[] {
  const valid = samples.filter((sample) => Number.isFinite(sample.epoch) && Number.isFinite(sample.quote));
  if (next && Number.isFinite(next.epoch) && Number.isFinite(next.quote)) valid.push(next);
  const deduped = new Map<string, MomentumScanSample>();
  for (const sample of valid) deduped.set(`${Math.trunc(sample.epoch)}:${sample.quote}`, sample);
  return [...deduped.values()].sort((a, b) => a.epoch - b.epoch).slice(-limit);
}

const MOMENTUM_CHART_CACHE_PREFIX = 'zeronine:momentum-chart:';
const MOMENTUM_CHART_CACHE_MAX_AGE_MS = 30 * 60_000;

function cachedMomentumSamples(symbol: string): MomentumScanSample[] {
  try {
    const cached = JSON.parse(localStorage.getItem(`${MOMENTUM_CHART_CACHE_PREFIX}${symbol}`) ?? '{}') as { savedAt?: unknown; samples?: unknown };
    if (!Number.isFinite(Number(cached.savedAt)) || Date.now() - Number(cached.savedAt) > MOMENTUM_CHART_CACHE_MAX_AGE_MS || !Array.isArray(cached.samples)) return [];
    return mergeMomentumSamples(cached.samples as MomentumScanSample[], null, 900);
  } catch {
    return [];
  }
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

function SectionTradeHistory({ trades, currency, empty }: { trades: TradeRow[]; currency: string; empty: string }): JSX.Element {
  return <section class="section-ledger-card" aria-label="Stored contract history">
    <div class="mom-watchboard-head"><div><span class="mom-kicker">Contract ledger</span><strong>Stored trade history</strong></div><span>{trades.length} records</span></div>
    <div class="section-trade-ledger">
      {trades.length === 0 && <div class="section-ledger-empty">{empty}</div>}
      {trades.slice(0, 40).map((trade) => {
        const side = trade.contract_type === 'MULTDOWN' ? 'SELL' : 'BUY';
        const settled = trade.status === 'won' || trade.status === 'lost' || trade.status === 'push';
        const tone = settled ? Number(trade.profit) > 0 ? 'up' : Number(trade.profit) < 0 ? 'down' : '' : '';
        return <div class={`section-trade-row ${tone}`} key={trade.id}>
          <span class={`section-trade-side ${side.toLowerCase()}`}>{side}</span>
          <span><b>{trade.market}</b><small>{new Date(trade.ts).toLocaleString()} · {trade.status}</small></span>
          <span><small>Stake</small><b>{fmtMoney(trade.stake, currency)}</b></span>
          <strong>{settled ? fmtSigned(Number(trade.profit ?? 0), currency) : 'OPEN'}</strong>
        </div>;
      })}
    </div>
  </section>;
}

function MomentumLedgerWorkspace({ rows, trades, currency }: { rows?: MomentumResearchRow[]; trades: TradeRow[]; currency: string }): JSX.Element {
  const momentumTrades = trades.filter((trade) => isMultiplierTrade(trade) && multiplierTradeFamily(trade) === 'Multiplier');
  const settled = momentumTrades.filter((trade) => trade.status === 'won' || trade.status === 'lost' || trade.status === 'push');
  const pnl = settled.reduce((sum, trade) => sum + Number(trade.profit ?? 0), 0);
  return <div class="section-ledger-page">
    <section class="section-ledger-summary" aria-label="Momentum ledger summary">
      <div><span>Research windows</span><strong>{rows?.length ?? 0}</strong></div>
      <div><span>Contracts</span><strong>{momentumTrades.length}</strong></div>
      <div><span>Settled</span><strong>{settled.length}</strong></div>
      <div><span>Realized P&amp;L</span><strong class={pnl >= 0 ? 'up' : 'down'}>{fmtSigned(pnl, currency)}</strong></div>
    </section>
    <MomentumResearchLedger rows={rows} currency={currency} />
    <SectionTradeHistory trades={momentumTrades} currency={currency} empty="No Momentum contracts stored yet." />
  </div>;
}

function MomentumTradeDesk({
  symbol,
  display,
  samples,
  candles,
  previewing = false,
  entryPrice,
  configuredMultiplier,
  session,
  owner,
  suggestedDirection,
  suggestedConfidence,
  suggestedReason,
  chartView = 'line',
  candlePeriod = 60,
  trades,
  contract,
  contracts,
}: {
  symbol?: string;
  display?: string;
  samples?: MomentumScanSample[];
  candles?: MomentumCandle[];
  previewing?: boolean;
  entryPrice?: number;
  configuredMultiplier?: number | null;
  session: ReturnType<typeof useStore>['session'];
  owner?: boolean;
  suggestedDirection?: 'up' | 'down' | null;
  suggestedConfidence?: number | null;
  suggestedReason?: string | null;
  chartView?: 'line' | 'candles';
  candlePeriod?: 60 | 300;
  trades: TradeRow[];
  contract: ContractEvt | null;
  contracts: Record<string, ContractEvt>;
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
  const [plannerRestored, setPlannerRestored] = useState(false);
  const manualMultiplierRef = useRef(false);
  const localPurchaseTimeRef = useRef<number | null>(null);
  const incomingSamples = useMemo(() => samples ?? [], [samples]);
  const stake = Number(stakeText);
  const selectedMultiplier = Number(multiplierText);
  const takeProfit = takeProfitText.trim() ? Number(takeProfitText) : undefined;
  const stopLoss = stopLossText.trim() ? Number(stopLossText) : undefined;
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('zeronine:momentum-planner') ?? '{}') as Record<string, string>;
      if (saved.direction === 'up' || saved.direction === 'down') setDirection(saved.direction);
      if (saved.stake) setStakeText(saved.stake);
      if (saved.multiplier) setMultiplierText(saved.multiplier);
      if (saved.takeProfit != null) setTakeProfitText(saved.takeProfit);
      if (saved.stopLoss != null) setStopLossText(saved.stopLoss);
    } catch { /* Local preferences are optional. */ }
    setPlannerRestored(true);
  }, []);
  useEffect(() => {
    if (!plannerRestored) return;
    try { localStorage.setItem('zeronine:momentum-planner', JSON.stringify({ direction, stake: stakeText, multiplier: multiplierText, takeProfit: takeProfitText, stopLoss: stopLossText })); } catch { /* Optional storage. */ }
  }, [direction, multiplierText, plannerRestored, stakeText, stopLossText, takeProfitText]);
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
  const openMomentumTrades = trades.filter((trade) =>
    isOpenAccountTrade(trade) && isMultiplierTrade(trade) && multiplierTradeFamily(trade) === 'Multiplier'
  );
  const openMomentumTrade = openMomentumTrades[0] ?? null;
  const closableMomentumTrade = openMomentumTrade;
  const closedMomentumTrade = closed?.contractId
    ? trades.find((item) => item.contract_id === closed.contractId) ?? null
    : null;
  const canPlace = canQuote && multiplierWithinLiveMax && Boolean(suggestedDirection) && openMomentumTrades.length < 4;
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
  // Keep the full local five-minute trace when the server sends a short
  // incremental tick batch. Replacing it with that batch caused the trade
  // chart to zoom into only a few seconds of movement.
  const chartSamples = chartSnapshot?.symbol === chartSymbol && (hasActiveTradeEntry || chartSnapshot.samples.length >= incomingSamples.length)
    ? chartSnapshot.samples
    : incomingSamples;
  const chartDisplay = chartSnapshot?.symbol === chartSymbol && (hasActiveTradeEntry || !display) ? chartSnapshot.display : display ?? trade?.market ?? 'Momentum market';
  const chartFrozenEntry = chartSnapshot?.symbol === chartSymbol && chartSnapshot.entryPrice != null ? chartSnapshot.entryPrice : chartEntryPrice;
  const chartDirection = (chartSnapshot?.symbol === chartSymbol && chartSnapshot.direction ? chartSnapshot.direction : suggestedDirection) ?? undefined;
  const plannerSide = (hasActiveTradeEntry ? chartDirection : direction) ?? 'up';
  const plannerEntry = chartFrozenEntry ?? chartSamples.at(-1)?.quote;
  const plannerStake = hasActiveTradeEntry ? tradeStake : stake;
  const plannerMultiplier = hasActiveTradeEntry ? tradeMultiplier : selectedMultiplier;
  const plannerTargetAmount = detailTakeProfit ?? Math.max(.01, (Number.isFinite(plannerStake) ? plannerStake : 1) * .5);
  const plannerRiskAmount = detailStopLoss ?? Math.max(.01, (Number.isFinite(plannerStake) ? plannerStake : 1) * .25);

  useEffect(() => {
    if (!chartSnapshot?.symbol || chartSnapshot.samples.length < 80) return;
    try {
      localStorage.setItem(`${MOMENTUM_CHART_CACHE_PREFIX}${chartSnapshot.symbol}`, JSON.stringify({ savedAt: Date.now(), samples: chartSnapshot.samples.slice(-900) }));
    } catch { /* Chart history is an optional visual cache. */ }
  }, [chartSnapshot]);
  const plannerTargetPrice = multiplierLimitPrice(plannerEntry, plannerTargetAmount, plannerStake, plannerMultiplier, plannerSide, 'takeProfit');
  const plannerStopPrice = multiplierLimitPrice(plannerEntry, plannerRiskAmount, plannerStake, plannerMultiplier, plannerSide, 'stopLoss');
  const updatePlannerLimit = (kind: 'takeProfit' | 'stopLoss', price: number) => {
    const amount = multiplierLimitAmount(plannerEntry, price, plannerStake, plannerMultiplier);
    if (amount == null) return;
    if (kind === 'takeProfit') setTakeProfitText(amount.toFixed(2));
    else setStopLossText(amount.toFixed(2));
  };
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
            ? 'Contract submitted'
            : 'No open contract';
  const potentialProfit = closed?.profit ?? (purchase?.payout != null && purchase.ask != null ? purchase.payout - purchase.ask : null);
  const suggestionTone = suggestedDirection ?? 'wait';
  const suggestionText = suggestedDirection
    ? `${suggestedDirection.toUpperCase()}${Number.isFinite(Number(suggestedConfidence)) ? ` - ${suggestedConfidence}%` : ''}`
    : 'WAIT';
  const actionNote = busy
    ? 'Sending order'
    : closing
      ? 'Closing contract'
    : settlementOverdue
      ? `Provider still reports contract ${trackedContractId || ''} open after scheduled expiry; waiting for settlement recovery`
    : openMomentumTrades.length >= 4
      ? 'Momentum lot limit reached (4 open)'
      : openMomentumTrades.length
        ? `${openMomentumTrades.length}/4 Momentum lots open`
      : !(Number.isFinite(stake) && stake > 0)
        ? 'Enter a positive stake'
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
    if (!symbol || !owner || !isDemo || !suggestedDirection || !(Number.isFinite(stake) && stake > 0) || openMomentumTrades.length >= 4) {
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
  }, [isDemo, openMomentumTrades.length, owner, selectedMultiplier, stake, suggestedDirection, symbol]);

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
      const rememberedSamples = sameTrade ? current?.samples ?? [] : cachedMomentumSamples(nextSymbol);
      const seededSamples = hasActiveTradeEntry
        ? mergeMomentumSamples([...rememberedSamples, ...activeFeedSamples], null)
        : mergeMomentumSamples([...rememberedSamples, ...incomingSamples], null);
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
        samples: nextSamples,
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

  const closeOpenTrade = async (target = closableMomentumTrade) => {
    if (!canClose) return;
    setClosing(true);
    setError('');
    try {
      setClosed(await closeMomentumDemoTrade({ tradeId: target?.id, contractId: target?.contract_id || undefined }));
      setPurchase(null);
      await refreshTrades();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setClosing(false);
    }
  };

  const unavailableReason = !symbol
    ? 'Focus a research market before placing a trade.'
    : !session
      ? 'Connect your Deriv account to request a live quote.'
      : !isDemo
        ? 'Momentum execution is unavailable for the selected account.'
      : !owner
        ? 'Unlock the dashboard owner controls to place a trade.'
        : openMomentumTrades.length >= 4
          ? 'Four Momentum lots are open. Close one before placing another.'
          : null;

  return <section class="mom-trade-desk" aria-label="Momentum trade">
    <div class="mom-trade-head">
      <div>
        <span class="mom-kicker">Momentum trade</span>
        <strong>{chartDisplay ?? 'No focused market'}</strong>
        <small>{hasActiveTradeEntry ? 'Pinned to the active Momentum contract' : previewing ? 'Live scan preview - orders unlock after validation' : symbol ? 'Live market selected from current research' : 'Research selection required'}</small>
      </div>
      <div class="mom-trade-badges">
        <span class={`mom-trade-suggestion ${suggestionTone}`} title={suggestedReason ?? undefined}>
          <Icon name={suggestedDirection === 'down' ? 'arrowDown' : suggestedDirection === 'up' ? 'arrowUp' : 'history'} size={13} />
          <span>Early forecast</span>
          <strong>{suggestionText}</strong>
        </span>
      </div>
    </div>

    <div class="mom-trade-live">
      <div class="mom-trade-chart">
        <MomentumPriceChart chartView={chartView} candlePeriod={candlePeriod} candleHistory={candles} samples={chartSamples} label={`${chartDisplay ?? 'Momentum market'} live trade chart`} entryPrice={chartFrozenEntry} entryDirection={chartDirection} entryLabel={chartEntryLabel} positionTool={plannerEntry != null ? {
          side: plannerSide === 'down' ? 'short' : 'long', entry: plannerEntry, takeProfit: plannerTargetPrice, stopLoss: plannerStopPrice,
          layoutStorageKey: `momentum:${chartSymbol || 'market'}`,
          targetPnl: fmtSigned(plannerTargetAmount, session?.currency ?? 'USD'), riskPnl: fmtSigned(-plannerRiskAmount, session?.currency ?? 'USD'),
          currentPrice: contractCurrentSpot ?? chartSamples.at(-1)?.quote,
          currentPnl: displayContractPnl == null ? undefined : fmtSigned(displayContractPnl, purchase?.currency ?? session?.currency ?? 'USD'),
          editable: !hasActiveTradeEntry && !busy, onLevelChange: updatePlannerLimit,
          onSideChange: (nextSide) => setDirection(nextSide === 'long' ? 'up' : 'down'),
          onClose: closableMomentumTrade ? () => void closeOpenTrade() : undefined,
          closeDisabled: !canClose,
          stake: stakeText,
          onStakeChange: setStakeText,
          stakeDisabled: busy || openMomentumTrades.length >= 4,
          multiplier: multiplierText,
          multiplierOptions,
          onMultiplierChange: (value) => { manualMultiplierRef.current = true; setMultiplierText(value); },
          multiplierDisabled: busy || openMomentumTrades.length >= 4,
          onPlaceLong: () => void place('up'),
          onPlaceShort: () => void place('down'),
          longActionDisabled: !canPlace || suggestedDirection !== 'up' || busy,
          shortActionDisabled: !canPlace || suggestedDirection !== 'down' || busy,
          placingSide: busy ? direction === 'up' ? 'long' : 'short' : null,
          forecast: <span class={`position-forecast-card ${suggestionTone}`} title={suggestedReason ?? undefined}>
            <span>Early forecast</span><strong>{suggestionText}</strong>
          </span>,
          liveTrade: closableMomentumTrade ? {
            pnl: displayContractPnl == null ? 'Updating' : fmtSigned(displayContractPnl, purchase?.currency ?? session?.currency ?? 'USD'),
            pnlTone: displayContractPnl != null && displayContractPnl < 0 ? 'down' : 'up',
            side: plannerSide.toUpperCase(), stake: fmtMoney(tradeStake, purchase?.currency ?? session?.currency ?? 'USD'), multiplier: `x${tradeMultiplier || '--'}`,
            elapsed: elapsedText, cashout: liveSellPrice == null ? undefined : fmtMoney(liveSellPrice, purchase?.currency ?? session?.currency ?? 'USD'),
          } : null,
          settledTrade: settledTrade ? {
            outcome: settledTrade.status === 'won' ? 'win' : settledTrade.status === 'lost' ? 'loss' : 'flat',
            pnl: fmtSigned(Number(settledTrade.profit ?? 0), purchase?.currency ?? session?.currency ?? 'USD'),
            side: settledTrade.contract_type === 'MULTDOWN' ? 'SHORT' : 'LONG', stake: fmtMoney(settledTrade.stake, purchase?.currency ?? session?.currency ?? 'USD'),
            multiplier: `x${tradeMultiplier || '--'}`,
            entry: Number.isFinite(Number(settledTrade.entry_spot)) ? Number(settledTrade.entry_spot).toLocaleString(undefined, { maximumFractionDigits: 8 }) : undefined,
            exit: Number.isFinite(Number(settledTrade.exit_spot)) ? Number(settledTrade.exit_spot).toLocaleString(undefined, { maximumFractionDigits: 8 }) : undefined,
            reason: settledTrade.reason,
          } : null,
        } : null} />
      </div>
      <div class="mom-trade-readout" aria-live="polite">
        <span>Account balance</span>
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
        <small>{closed?.soldFor != null ? `Sold ${fmtMoney(closed.soldFor, purchase?.currency ?? session?.currency ?? 'USD')}` : liveSellPrice == null ? trackedContractId || 'Awaiting order' : `Sell ${fmtMoney(liveSellPrice, purchase?.currency ?? session?.currency ?? 'USD')}`}</small>
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

    {openMomentumTrades.length > 1 && <section class="mom-open-lots" aria-label="Open Momentum lots">
      <div class="mom-open-lots-head"><span>Open Momentum lots</span><strong>{openMomentumTrades.length}/4</strong></div>
      {openMomentumTrades.map((lot) => {
        const lotContract = lot.contract_id ? contracts[lot.contract_id] ?? (contract?.contractId === lot.contract_id ? contract : null) : null;
        const lotPnl = Number.isFinite(Number(lotContract?.profit)) ? Number(lotContract?.profit) : null;
        const lotSell = Number.isFinite(Number(lotContract?.sellPrice ?? lotContract?.update?.sellPrice))
          ? Number(lotContract?.sellPrice ?? lotContract?.update?.sellPrice)
          : null;
        const lotMultiplier = Number((lot.reason ?? '').match(/multiplier x(\d+)/i)?.[1] ?? NaN);
        return <article class={`mom-open-lot ${lotPnl == null ? '' : lotPnl >= 0 ? 'up' : 'down'}`} key={lot.id}>
          <div><span>{lot.contract_type === 'MULTDOWN' ? 'Down' : 'Up'} · x{Number.isFinite(lotMultiplier) ? lotMultiplier : '--'}</span><strong>{fmtSigned(lotPnl ?? 0, session?.currency ?? 'USD')}</strong><small>{lotPnl == null ? 'P&L updating' : `Stake ${fmtMoney(lot.stake, session?.currency ?? 'USD')}`}</small></div>
          <div><span>Contract</span><strong>{lot.contract_id || 'Submitting'}</strong><small>{lotSell == null ? 'Cash-out updating' : `Sell ${fmtMoney(lotSell, session?.currency ?? 'USD')}`}</small></div>
          <button class="mom-trade-close mini" type="button" disabled={!lot.contract_id || closing} onClick={() => void closeOpenTrade(lot)}><Icon name="x" size={13} />{closing ? 'Closing' : 'Close'}</button>
        </article>;
      })}
    </section>}

    <div class="mom-trade-order">
      <div class="mom-trade-direction" aria-label="Place a trade">
        <button class={`up ${direction === 'up' ? 'active' : ''}${suggestedDirection === 'up' ? ' suggested' : ''}`} type="button" disabled={!canPlace || suggestedDirection !== 'up' || busy} onClick={() => void place('up')} aria-label={suggestedDirection === 'up' ? 'Place suggested up trade' : 'Place up trade'}><Icon name="arrowUp" size={15} />{busy && direction === 'up' ? 'Placing' : 'Up'}</button>
        <button class={`down ${direction === 'down' ? 'active' : ''}${suggestedDirection === 'down' ? ' suggested' : ''}`} type="button" disabled={!canPlace || suggestedDirection !== 'down' || busy} onClick={() => void place('down')} aria-label={suggestedDirection === 'down' ? 'Place suggested down trade' : 'Place down trade'}><Icon name="arrowDown" size={15} />{busy && direction === 'down' ? 'Placing' : 'Down'}</button>
      </div>
      <label class="mom-trade-multiplier"><span>{maxMultiplier ? `Multiplier max x${maxMultiplier}` : multiplierProbeStatus === 'checking' ? 'Multiplier checking max' : 'Multiplier'}</span><select value={multiplierText} disabled={busy || openMomentumTrades.length >= 4} onChange={(event) => { manualMultiplierRef.current = true; setMultiplierText((event.currentTarget as HTMLSelectElement).value); }}>{multiplierOptions.map((value) => <option value={value} key={value}>x{value}{maxMultiplier === value ? ' max' : ''}</option>)}</select></label>
      <label class="mom-trade-limit"><span>TP profit</span><input type="number" inputMode="decimal" min="0.01" step="0.01" placeholder="optional" value={takeProfitText} disabled={busy || openMomentumTrades.length >= 4} onInput={(event) => setTakeProfitText((event.currentTarget as HTMLInputElement).value)} /></label>
      <label class="mom-trade-limit"><span>Stop loss</span><input type="number" inputMode="decimal" min="0.01" step="0.01" placeholder="optional" value={stopLossText} disabled={busy || openMomentumTrades.length >= 4} onInput={(event) => setStopLossText((event.currentTarget as HTMLInputElement).value)} /></label>
      <div class="mom-trade-quote">
        <span>{purchase ? 'Last order potential' : 'Live proposal at order time'}</span>
        <strong>{potentialProfit == null ? '—' : fmtSigned(potentialProfit, session?.currency ?? 'USD')}</strong>
      </div>
      <span class="mom-trade-action-note">{actionNote}</span>
    </div>

    {settlementOverdue && <div class="mom-trade-note warning">Scheduled duration has passed, but Deriv still reports this contract as open. New Momentum orders stay locked until settlement recovery or a successful close confirms the final result.</div>}
    {unavailableReason && <div class="mom-trade-note">{unavailableReason}</div>}
    {(purchase || closableMomentumTrade) && <div class="mom-trade-note">Contract {trackedContractId || 'submitted'} is tracked against this account balance.</div>}
    {error && <div class="tl-err">{error}</div>}
  </section>;
}

function MomentumPage(): JSX.Element {
  const s = useStore();
  const momentum = s.momentum;
  const [activeTab, setActiveTab] = useState<'research' | 'trade' | 'ledger'>('trade');
  const [chartView, setChartView] = useState<'line' | 'candles'>(() => {
    try { return localStorage.getItem('zeronine:momentum-chart-view') === 'candles' ? 'candles' : 'line'; } catch { return 'line'; }
  });
  const [candlePeriod, setCandlePeriod] = useState<60 | 300>(() => {
    try { return localStorage.getItem('zeronine:momentum-candle-period') === '300' ? 300 : 60; } catch { return 60; }
  });
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
  const selectChartView = (view: 'line' | 'candles') => {
    setChartView(view);
    try { localStorage.setItem('zeronine:momentum-chart-view', view); } catch { /* Optional display preference. */ }
  };
  const selectCandlePeriod = (period: 60 | 300) => {
    setCandlePeriod(period);
    try { localStorage.setItem('zeronine:momentum-candle-period', String(period)); } catch { /* Optional display preference. */ }
  };

  const w = momentum?.window;
  const signal = w?.signal;
  const tradeSignal = w?.direction && w.decisionSignal ? w.decisionSignal : signal;
  const market = momentum?.markets.find((item) => item.symbol === momentum.config?.symbol);
  const watchedMarkets = momentum?.scan?.markets ?? [];
  const focusedMarket = watchedMarkets.find((item) => item.symbol === momentum?.config?.symbol) ?? null;
  const scanPreview = !momentum?.config?.symbol
    ? [...watchedMarkets]
      .filter((item) => item.samples?.length)
      .sort((left, right) => (right.opportunityScore ?? 0) - (left.opportunityScore ?? 0)
        || right.sampleCount - left.sampleCount)[0] ?? null
    : null;
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
    <header class={`header mom-page-header${activeTab === 'trade' ? ' trade-mode' : ''}`}>
      <div class="mom-page-heading">
      {activeTab === 'trade' ? <div class="trade-market-strip" aria-label="Momentum market context">
        <span>Market</span><strong>{focusedMarket?.display ?? market?.display ?? scanPreview?.display ?? 'Awaiting selected market'}</strong>
        <small>{currentPrice > 0 ? currentPrice.toLocaleString(undefined, { maximumFractionDigits: 8 }) : 'Waiting for live price'} · 5 minute watch · <b class={`trade-prediction ${tradeSignal?.direction === 'up' ? 'up' : tradeSignal?.direction === 'down' ? 'down' : 'wait'}`}>{tradeSignal?.direction === 'wait' || !tradeSignal?.direction ? 'Scanning' : `${tradeSignal.direction.toUpperCase()} ${tradeSignal.confidence}%`}</b></small>
      </div> : <>
      <img class="mom-brand-logo" src="/multiplier-logo.png" alt="Multiplier" />
      <div class="subtitle">Automatic real-market scanning · five-minute research · no purchases</div>
      </>}
      </div>
      <div class="mom-tabs" role="tablist" aria-label="Momentum workspace">
        <button class={activeTab === 'trade' ? 'active' : ''} type="button" role="tab" aria-selected={activeTab === 'trade'} onClick={() => setActiveTab('trade')}>Trade</button>
        <button class={activeTab === 'research' ? 'active' : ''} type="button" role="tab" aria-selected={activeTab === 'research'} onClick={() => setActiveTab('research')}>Research</button>
        <button class={activeTab === 'ledger' ? 'active' : ''} type="button" role="tab" aria-selected={activeTab === 'ledger'} onClick={() => setActiveTab('ledger')}>Ledger</button>
      </div>
      {activeTab !== 'ledger' && <div class="mom-chart-view" role="group" aria-label="Momentum chart view">
        <button type="button" class={chartView === 'line' ? 'active' : ''} aria-pressed={chartView === 'line'} onClick={() => selectChartView('line')}>Line</button>
        <button type="button" class={chartView === 'candles' ? 'active' : ''} aria-pressed={chartView === 'candles'} onClick={() => selectChartView('candles')}>Candles</button>
        {chartView === 'candles' && <><button type="button" class={candlePeriod === 60 ? 'active' : ''} aria-pressed={candlePeriod === 60} onClick={() => selectCandlePeriod(60)}>1m</button><button type="button" class={candlePeriod === 300 ? 'active' : ''} aria-pressed={candlePeriod === 300} onClick={() => selectCandlePeriod(300)}>5m</button></>}
      </div>}
    </header>
    {activeTab === 'ledger' ? <MomentumLedgerWorkspace rows={research?.recent} trades={s.trades} currency={s.session?.currency ?? 'USD'} /> : activeTab === 'trade' ? <MomentumTradeDesk
      symbol={momentum?.config?.symbol ?? scanPreview?.symbol}
      display={focusedMarket?.display ?? market?.display ?? scanPreview?.display}
      samples={w?.samples ?? focusedMarket?.samples ?? scanPreview?.samples}
      candles={w?.candles}
      previewing={Boolean(scanPreview && !momentum?.config?.symbol)}
      entryPrice={w?.openPrice}
      configuredMultiplier={momentum?.config?.multiplier}
      session={s.session}
      owner={s.owner}
      suggestedDirection={w?.direction ?? (signal?.direction === 'wait' ? null : signal?.direction)}
      suggestedConfidence={tradeSignal?.direction === 'wait' ? null : tradeSignal?.confidence}
      suggestedReason={tradeSignal?.reason}
      trades={s.trades}
      contract={s.contract}
      contracts={s.contracts}
      chartView={chartView}
      candlePeriod={candlePeriod}
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
        <div class="mom-focus-chart"><MomentumPriceChart chartView={chartView} candlePeriod={candlePeriod} candleHistory={w?.candles} samples={w?.samples ?? focusedMarket?.samples} label={`${focusedMarket?.display ?? market?.display ?? 'Focused market'} full research chart`} entryPrice={w?.openPrice} entryDirection={w?.direction ?? undefined} entryLabel={w?.direction ? `Watch entry \u00b7 ${w.direction.toUpperCase()}` : 'Watch entry'} /></div>
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
        <small>Saved globally. It does not alter digit signals, account balances, or account trading.</small>
      </section>
      <div class="mom-disclaimer"><strong>Research estimate, not account P&amp;L.</strong> The 0.10% cost hurdle is a fixed assumption. Before execution, the system must capture Deriv’s actual proposal commission and live sell price; spot movement alone is not sufficient evidence of profitability.</div>
    </div>}
  </>;
}

/* ---------------- test lab ---------------- */

const STRATEGY_KEYS = ['conservative', 'martingale', 'boosted_martingale', 'chase'] as const;
const MODE_KEYS = ['rapid', 'balanced', 'strict'] as const;
const ALL_CONFIG_KEYS: string[] = STRATEGY_KEYS.flatMap((s) => MODE_KEYS.map((m) => `${s}-${m}`));

type LabTab = 'backtest' | 'paper' | 'compare' | 'patterns' | 'entry';

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
      if (paperSimulation?.phase !== 'running') await startPaperSimulation();
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
        disabled={!owner || paperSimulation?.phase === 'running'}
        onRun={run}
        runLabel={!owner ? 'Unlock dashboard to view research' : paperSimulation?.phase === 'running' ? 'Continuous paper scout is on' : 'Resume paper scout'}
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
  const dialogRef = useDialogFocus();
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
      <section ref={dialogRef} tabIndex={-1} class="activity-detail paper-trade-detail" role="dialog" aria-modal="true" aria-label="Virtual contract details" onClick={(event) => event.stopPropagation()}>
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

type EntryProductTab = 'digits' | 'gold';

const ENTRY_PRODUCT_COPY: Record<EntryProductTab, { label: string; kicker: string; empty: string }> = {
  digits: { label: 'Over / Under', kicker: 'Digit entry race', empty: 'Waiting for tick-safe entry evidence.' },
  gold: { label: 'Gold', kicker: 'Candle entry race', empty: 'Waiting for closed-candle entry evidence.' },
};

function entryProduct(s: ReturnType<typeof useStore>, product: EntryProductTab): EntryLabProduct | null {
  return s.entryLab?.products?.find((item) => item.product === product) ?? null;
}

function EntryTrace({ product, method }: { product: EntryProductTab; method: EntryLabMethod | null }): JSX.Element {
  const points = method?.equity?.length ? method.equity : [];
  const fallback = product === 'gold' ? [42, 38, 55, 48, 68, 61, 78, 70, 88] : [48, 43, 51, 47, 56, 53, 63, 58, 67];
  const values = points.length > 1 ? points : fallback;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const spread = Math.max(1, max - min);
  const coords = values.map((value, index) => `${(index / Math.max(1, values.length - 1)) * 100},${86 - ((value - min) / spread) * 68}`).join(' ');
  return <svg class={`entry-trace ${product}`} viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><polyline points={coords} /></svg>;
}

function EntryLiveVisual({ product, candidate }: { product: EntryProductTab; candidate: EntryLabMethod | null }): JSX.Element {
  const values = candidate?.equity?.length ? candidate.equity.slice(-12) : [];
  return <div class={`entry-live-visual ${product}`} aria-hidden="true">
    <div class="entry-live-grid"></div>
    {product === 'gold' ? <div class="entry-candles">{(values.length ? values : [4, 7, 5, 8, 6, 9, 7, 10]).map((value, index) => <i key={index} style={{ '--candle-size': `${Math.max(24, Math.min(82, value * 7))}%`, '--candle-delay': `${index * 95}ms` } as JSX.CSSProperties} />)}</div> : <div class="entry-tick-ribbon">{(values.length ? values : [9, 5, 2, 8, 1, 6, 3, 7, 4, 0]).map((value, index) => <i key={index} style={{ '--tick-delay': `${index * 75}ms` } as JSX.CSSProperties}>{Math.abs(Math.round(value)) % 10}</i>)}</div>}
    <span class="entry-live-scan"></span><span class="entry-live-marker">ENTRY</span>
  </div>;
}

function EntryTab(): JSX.Element {
  const s = useStore();
  const product: EntryProductTab = 'digits';
  const data = entryProduct(s, product);
  const methods = data?.methods ?? [];
  const proven = methods.find((item) => item.id === data?.provenMethodId) ?? methods.find((item) => item.status === 'promoted') ?? null;
  const liveMethod = methods.find((item) => item.status === 'testing') ?? proven ?? methods[0] ?? null;
  const running = data?.state === 'testing';
  const sampleCount = methods.reduce((total, item) => total + (item.samples ?? 0), 0);
  const copy = ENTRY_PRODUCT_COPY[product];

  useEffect(() => {
    void loadEntryLabState();
    const timer = window.setInterval(() => void loadEntryLabState(), 15_000);
    return () => window.clearInterval(timer);
  }, []);

  return <section class="entry-lab" aria-label="Continuous entry research">
    <div class="entry-lab-intro">
      <div><span class="entry-kicker">Continuous entry intelligence</span><h2>Find the moment the prediction is worth taking.</h2><p>Free Agent compares entry timing in isolated research lanes. Promotion needs enough settled evidence, a positive risk-adjusted result, and a meaningful lead.</p></div>
      <div class={`entry-engine-state ${running ? 'live' : ''}`}><i></i><span>{running ? 'Testing live' : data?.state === 'unavailable' ? 'Service unavailable' : 'Warming evidence'}</span><small>{sampleCount ? `${sampleCount} settled samples` : 'No live orders from this screen'}</small></div>
    </div>
    <div class="entry-lab-stage">
      <div class="entry-stage-main"><div class="entry-stage-head"><div><span>{copy.kicker}</span><strong>{liveMethod?.label ?? 'Free Agent is waiting'}</strong></div><small>{liveMethod?.reason ?? data?.note ?? copy.empty}</small></div><EntryLiveVisual product={product} candidate={liveMethod} /><div class="entry-stage-foot"><span>{liveMethod?.status === 'testing' ? 'Watching for confirmation' : 'No entry forced'}</span><b>{liveMethod?.confidence != null ? `${Math.round(liveMethod.confidence)}% confidence` : 'Evidence first'}</b></div></div>
      <aside class="entry-proven-card"><span>Current proven best</span><strong>{proven?.label ?? 'Not promoted yet'}</strong><div class="entry-proven-score"><b>{proven?.netPnl == null ? '--' : fmtSigned(proven.netPnl, '$')}</b><small>{proven?.samples ?? 0} settled · {proven?.confidence != null ? `${Math.round(proven.confidence)}% confidence` : 'calibrating'}</small></div><p>{proven?.reason ?? 'The Bot keeps its current protected method until a candidate earns promotion.'}</p></aside>
    </div>
    <div class="entry-method-list" aria-live="polite">
      {methods.length === 0 && <div class="entry-empty"><EntryTrace product={product} method={null} /><div><strong>Building the first comparison set</strong><span>{copy.empty} The visualization is ready; it will replace placeholders with settled research as soon as the runner reports.</span></div></div>}
      {methods.map((method) => { const resolved = (method.wins ?? 0) + Math.max(0, (method.samples ?? 0) - (method.wins ?? 0)); const winRate = method.samples ? Math.round(((method.wins ?? 0) / method.samples) * 100) : null; return <article class={`entry-method ${method.status ?? 'waiting'}`} key={method.id}><div class="entry-method-name"><span class="entry-method-dot"></span><strong>{method.label}</strong><small>{method.status === 'promoted' ? 'PROVEN' : method.status === 'testing' ? 'TESTING' : method.status ?? 'WAITING'}</small></div><EntryTrace product={product} method={method} /><div class="entry-method-metric"><span>Net P&L</span><b class={method.netPnl != null && method.netPnl < 0 ? 'down' : 'up'}>{method.netPnl == null ? '--' : fmtSigned(method.netPnl, '$')}</b></div><div class="entry-method-metric"><span>Win rate</span><b>{winRate == null ? '--' : `${winRate}%`}</b></div><div class="entry-method-metric"><span>Evidence</span><b>{method.samples ?? resolved} <small>settled</small></b></div></article>; })}
    </div>
    <div class="entry-lab-note"><strong>Research guardrails</strong><span>Entry tests are separated by product. They are rate-limited, stale/out-of-order frames are ignored, and a method cannot become the default from a short lucky run.</span></div>
  </section>;
}

function TestLabPage(): JSX.Element {
  const s = useStore();
  const [tab, setTab] = useViewPreference<LabTab>('lab-tab', 'backtest', ['backtest', 'paper', 'compare', 'patterns', 'entry']);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const latest = s.testRuns.find((run) => run.kind === 'backtest');
  const running = busy || s.testlab?.kind === 'backtest';
  const paper = s.paperSimulation;
  const paperContract = paper?.openContract ?? paper?.lastSettled;

  useEffect(() => {
    // Owner-only endpoints: guests must never generate 403s every minute, and
    // the timer starts as soon as owner access is granted.
    if (!s.owner) return;
    void loadTestRuns().catch(() => undefined);
    const timer = window.setInterval(() => void loadTestRuns().catch(() => undefined), 60_000);
    return () => window.clearInterval(timer);
  }, [s.owner]);
  useEffect(() => {
    if (tab === 'patterns') void loadPatternsData();
  }, [tab]);

  return (
    <>
      <section class="cow-lab" aria-label="Cow research laboratory">
        <div class="cow-lab-intro"><div><span class="cow-lab-kicker">THE PASTURE LAB</span><h1>The Cow Lab</h1><p>Replay past market ticks, then watch the paper scout test new signals in the background.</p></div><span class={`cow-lab-status${running ? ' live' : ''}`}><i />{running ? 'Replaying history' : 'Ready to experiment'}</span></div>
        <div class={`cow-lab-stage${running ? ' is-replaying' : ''}`}>
          <div class="cow-lab-stage-title"><span>HISTORICAL REPLAY</span><strong>{running ? 'Experiment in progress' : 'A fresh start, every test'}</strong></div>
          <div class="cow-lab-machine" aria-hidden="true">
            <div class="cow-lab-lamp lamp-left" /><div class="cow-lab-lamp lamp-right" /><div class="cow-lab-beam" /><div class="cow-lab-impact" />
            <div class="cow-lab-chamber"><div class="cow-lab-bubbles"><i /><i /><i /></div>
              <svg class="cow-lab-cow-art" viewBox="0 0 240 155"><ellipse cx="122" cy="135" rx="90" ry="10" fill="#163f39" opacity=".3" /><g class="cow-lab-cow"><path d="M48 100 42 135h18l7-30m89 0 5 30h18l-5-43" fill="#e4c99f" stroke="#563725" stroke-width="4" stroke-linejoin="round" /><path d="M39 76Q13 78 16 100" fill="none" stroke="#ffe7bd" stroke-width="6" stroke-linecap="round" /><ellipse cx="106" cy="73" rx="68" ry="46" fill="#fff0cd" stroke="#563725" stroke-width="4" /><path d="M71 40Q47 54 48 83l17 14 19-17-5-20 13-14zm61-10q24 6 34 25l-6 29-21 10-11-17 9-19z" fill="#88543a" /><circle cx="104" cy="73" r="24" fill="#f03346" /><circle cx="104" cy="73" r="15" fill="#fff0cd" /><circle cx="104" cy="73" r="7" fill="#f03346" /><path d="M161 50 153 25l24 10m22 12 13-18-3 29" fill="#bd875a" stroke="#563725" stroke-width="3" stroke-linejoin="round" /><path d="M155 55q14-26 37-19 25 9 27 36l-11 27h-42q-19-10-11-44z" fill="#fff0cd" stroke="#563725" stroke-width="4" /><g class="cow-lab-eyes"><circle cx="180" cy="62" r="4" fill="#39271d" /><circle cx="203" cy="63" r="4" fill="#39271d" /></g><g class="cow-lab-dead-eyes" fill="none" stroke="#39271d" stroke-width="3" stroke-linecap="round"><path d="m176 58 8 8m0-8-8 8m23-7 8 8m0-8-8 8" /></g><ellipse cx="196" cy="88" rx="23" ry="14" fill="#f39992" /><circle cx="188" cy="88" r="3" fill="#8b514b" /><circle cx="204" cy="88" r="3" fill="#8b514b" /></g></svg>
            </div><div class="cow-lab-platform"><span /><b>REPLAY CHAMBER</b><span /></div>
          </div>
          <div class="cow-lab-stage-foot"><span>Illustration of a historical replay</span><strong>{running ? (s.testlab?.message || 'Preparing experiment…') : 'No real trades in this experiment'}</strong></div>
          <div class="cow-lab-stage-results" aria-label="Latest completed backtest configuration">
            <div><span>LAST COMPLETED CONFIGURATION</span><strong>{latest ? `${latest.strategy_mode} / ${latest.bot_mode}` : 'No completed replay yet'}</strong></div>
            <div><span>SIMULATED P&amp;L</span><strong class={latest && latest.net_pnl < 0 ? 'negative' : ''}>{latest ? fmtSigned(latest.net_pnl, '$') : '—'}</strong></div>
            <div><span>RESULTS</span><strong>{latest ? `${latest.wins}W / ${latest.losses}L · ${latest.trades} trades` : 'Waiting'}</strong></div>
          </div>
        </div>
        <div class="cow-lab-readouts">
          <article><span>LAST BACKTEST</span><strong>{latest ? `${latest.wins} wins · ${latest.losses} losses` : 'No replay yet'}</strong><small>{latest ? `${latest.trades} simulated trades · ${latest.strategy_mode} / ${latest.bot_mode}` : 'Run a replay using your saved market history.'}</small>{latest && <b>{latest.win_rate == null ? 'Win rate unavailable' : `${latest.win_rate.toFixed(1)}% win rate`} · {fmtSigned(latest.net_pnl, '$')} simulated</b>}</article>
          <article><span>BACKGROUND PAPER SCOUT</span><strong>{paper ? (paper.phase === 'running' ? 'Watching the market' : `Scout ${paper.phase}`) : 'Waiting for scout'}</strong><small>{paper ? `${paper.totalTrades} virtual trades this run · ${paper.wins} wins / ${paper.losses} losses` : 'Paper activity appears when the simulator reports in.'}</small><b>{paperContract ? `${paperContract.market} · ${paperContract.direction.toUpperCase()} ${paperContract.barrier} · ${paperContract.status.toUpperCase()}` : 'No virtual contract yet'}</b></article>
        </div>
        <div class="cow-lab-actions"><button type="button" disabled={running || !s.owner || !s.session} onClick={async () => { setError(''); setBusy(true); try { await runTestBacktest({ target: 200, configs: ALL_CONFIG_KEYS }); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); } }}>{running ? 'Running experiment…' : 'Run backtest'}</button><span>{!s.owner ? 'Owner access is required to start a replay.' : !s.session ? 'Connect an account to start a replay.' : '200 simulated trades per configuration · no account funds used'}</span></div>
        {error && <p class="cow-lab-error" role="alert">{error}</p>}
      </section>
      <details class="cow-lab-details"><summary>More research &amp; controls</summary>
      <div class="seg tl-tabs">
        {(['backtest', 'paper', 'compare', 'patterns', 'entry'] as LabTab[]).map((t) => (
          <button
            class={`seg-btn${tab === t ? ' active' : ''}`}
            aria-pressed={tab === t}
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
      {tab === 'entry' && <EntryTab />}
      </details>
    </>
  );
}

/* ---------------- account ---------------- */

type RangerAppearance = { outfit: 'classic' | 'vest' | 'scout' | 'jacket' | 'hoodie'; color: string; accent: string; headwear: 'none' | 'cap' | 'bandana' | 'hat' | 'hood'; accessory: 'none' | 'scarf' | 'badge' | 'glasses' | 'cape' };
const defaultRangerAppearance: RangerAppearance = { outfit: 'classic', color: '#326db1', accent: '#a65b38', headwear: 'none', accessory: 'none' };
function readRangerAppearance(): RangerAppearance {
  try {
    const value = JSON.parse(localStorage.getItem('pasture-ranger-appearance') || '{}');
    return {
      outfit: ['classic', 'vest', 'scout', 'jacket', 'hoodie'].includes(value.outfit) ? value.outfit : 'classic',
      color: /^#[0-9a-f]{6}$/i.test(value.color) ? value.color : defaultRangerAppearance.color,
      accent: /^#[0-9a-f]{6}$/i.test(value.accent) ? value.accent : defaultRangerAppearance.accent,
      headwear: ['none', 'cap', 'bandana', 'hat', 'hood'].includes(value.headwear) ? value.headwear : 'none',
      accessory: ['none', 'scarf', 'badge', 'glasses', 'cape'].includes(value.accessory) ? value.accessory : 'none',
    };
  } catch { return { ...defaultRangerAppearance }; }
}
function RangerWardrobe({ accountId }: { accountId: string | null }): JSX.Element {
  const [appearance, setAppearance] = useState<RangerAppearance>(readRangerAppearance);
  const [name, setName] = useState('');
  const [profileStatus, setProfileStatus] = useState('');
  const [profileReady, setProfileReady] = useState(!accountId);
  const [saving, setSaving] = useState(false);
  const accountRef = useRef(accountId);
  accountRef.current = accountId;
  useEffect(() => {
    let cancelled = false;
    setSaving(false);
    if (!accountId) {
      setAppearance(readRangerAppearance());
      try { setName(localStorage.getItem('pasture-chat-name') || ''); } catch { setName(''); }
      setProfileReady(true);
      setProfileStatus('Guest appearance is saved on this browser.');
      return () => { cancelled = true; };
    }
    setAppearance({ ...defaultRangerAppearance });
    setName('');
    setProfileReady(false);
    setProfileStatus('Loading your ranger…');
    void fetch('/api/player/ranger-profile', { credentials: 'same-origin', cache: 'no-store' })
      .then(async response => { if (!response.ok) throw new Error('Could not load your ranger.'); return response.json(); })
      .then(data => {
        if (cancelled || accountRef.current !== accountId || data.accountId !== accountId) return;
        if (data.profile) { setName(String(data.profile.name || '').slice(0, 24)); setAppearance({ ...defaultRangerAppearance, ...data.profile.appearance }); }
        setProfileReady(true);
        setProfileStatus(data.profile ? 'Saved to this Deriv account.' : 'Choose your name and outfit, then save.');
      }).catch(() => { if (!cancelled && accountRef.current === accountId) setProfileStatus('Could not load your ranger. Refresh to try again.'); });
    return () => { cancelled = true; };
  }, [accountId]);
  const update = (patch: Partial<RangerAppearance>) => {
    const next = { ...appearance, ...patch };
    setAppearance(next);
    if (!accountId) try { localStorage.setItem('pasture-ranger-appearance', JSON.stringify(next)); } catch { /* Guest appearance remains available for this session. */ }
    if (accountId) setProfileStatus('Changes not saved yet.');
    document.querySelector<HTMLIFrameElement>('iframe.trading-room-frame')?.contentWindow?.postMessage({ type: 'zeronine:ranger-appearance', appearance: next }, window.location.origin);
  };
  const save = async () => {
    if (!accountId || !profileReady || saving) return;
    setSaving(true); setProfileStatus('Saving your ranger…');
    try {
      const response = await fetch('/api/player/ranger-profile', { method: 'PUT', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ accountId, name, appearance }) });
      if (!response.ok) throw new Error('Save failed');
      const result = await response.json();
      if (accountRef.current !== accountId || result.accountId !== accountId) return;
      setName(result.profile.name); setAppearance(result.profile.appearance); setProfileStatus('Saved to this Deriv account.');
      document.querySelector<HTMLIFrameElement>('iframe.trading-room-frame')?.contentWindow?.postMessage({ type: 'zeronine:ranger-profile', profile: result.profile }, window.location.origin);
    } catch { if (accountRef.current === accountId) setProfileStatus('Could not save. Please try again.'); }
    finally { if (accountRef.current === accountId) setSaving(false); }
  };
  return <section class="ranger-wardrobe" aria-labelledby="ranger-wardrobe-title">
    <div class="wardrobe-heading"><div><small>YOUR RANGER</small><h3 id="ranger-wardrobe-title">Outfit &amp; accessories</h3></div><button type="button" class="wardrobe-reset" disabled={saving || (!!accountId && !profileReady)} onClick={() => update(defaultRangerAppearance)}>Reset</button></div>
    <label class="wardrobe-name-field">Ranger name<input disabled={saving || (!!accountId && !profileReady)} maxLength={24} value={name} onInput={e => { const value = e.currentTarget.value; setName(value); if (accountId) setProfileStatus('Changes not saved yet.'); else { try { localStorage.setItem('pasture-chat-name', value); } catch {} document.querySelector<HTMLIFrameElement>('iframe.trading-room-frame')?.contentWindow?.postMessage({ type: 'zeronine:ranger-profile', profile: { name: value, appearance } }, window.location.origin); } }} placeholder="Choose a name" /></label>
    <div class="wardrobe-layout"><div class="wardrobe-preview" aria-label="Ranger appearance preview">
      <svg viewBox="0 0 100 130" aria-hidden="true"><ellipse cx="50" cy="116" rx="30" ry="7" fill="#254c3450"/><path d="M35 87v25h12V87m7 0v25h12V87" fill="#393a3d"/><path d="M32 107h16v8H32m21-8h16v8H53" fill="#5d4530"/><g class="wardrobe-breathe">{appearance.accessory === 'cape' && <path d="M33 52h34l12 46H22z" fill={appearance.accent}/>}<path d="M29 52 25 36 34 27 41 42" fill="#7c4934"/><path d="M33 52h34l3 39H32z" fill={appearance.color} stroke="#334b45" stroke-width="2"/>{appearance.outfit === 'vest' && <path d="M35 53h9l6 29 6-29h9l-4 32H39Z" fill={appearance.accent} opacity=".9"/>}{appearance.outfit === 'scout' && <path d="M34 56 62 84M42 53l26 25" stroke={appearance.accent} stroke-width="5"/>}{(appearance.outfit === 'jacket' || appearance.outfit === 'hoodie') && <path d="M49 53v35M34 55l10 10 6-12 6 12 10-10" fill="none" stroke={appearance.accent} stroke-width="3"/>}{appearance.accessory === 'scarf' && <path d="M34 54q16 8 32 0v6q-16 8-32 0zM54 59h7l-1 16h-7z" fill={appearance.accent}/>} {appearance.accessory === 'badge' && <circle cx="60" cy="62" r="4" fill={appearance.accent} stroke="#ffebb5" stroke-width="1"/>}<path d="M33 83h35v7H33z" fill="#866338"/><path d="M29 57v24m42-24v24" stroke="#c69b75" stroke-width="8" stroke-linecap="round"/><circle cx="50" cy="36" r="15" fill="#cba17d"/><path d="M35 34q0-17 15-17t15 17l-9-7-15 6Z" fill="#4d3729"/>{appearance.headwear === 'cap' && <path d="M34 27q3-14 16-14t16 14H34m-3 1h39" fill={appearance.accent} stroke={appearance.accent} stroke-width="3"/>}{appearance.headwear === 'bandana' && <path d="M35 29q15-5 30 0v5q-15-5-30 0z" fill={appearance.accent}/>}{appearance.headwear === 'hat' && <path d="M35 27l4-14h22l4 14m-36 1h42" fill={appearance.accent} stroke={appearance.accent} stroke-width="3"/>}{appearance.headwear === 'hood' && <path d="M33 40q-3-27 17-27t17 27l-5-10q-12-16-24 0z" fill={appearance.accent}/>}<circle cx="51" cy="36" r="1.7" fill="#271f1d"/><circle cx="59" cy="36" r="1.7" fill="#271f1d"/>{appearance.accessory === 'glasses' && <path d="M46 33h9v7h-9zm10 0h9v7h-9zm-1 3h1" fill="none" stroke={appearance.accent} stroke-width="2"/>}<path d="M75 48q24 20 0 42M75 48v42" fill="none" stroke="#a87643" stroke-width="3"/></g></svg>
    </div><fieldset class="wardrobe-fields" disabled={saving || (!!accountId && !profileReady)}><label>Outfit<select value={appearance.outfit} onChange={e => update({ outfit: e.currentTarget.value as RangerAppearance['outfit'] })}><option value="classic">Classic</option><option value="vest">Vest</option><option value="scout">Scout</option><option value="jacket">Jacket</option><option value="hoodie">Hoodie</option></select></label><label>Headwear<select value={appearance.headwear} onChange={e => update({ headwear: e.currentTarget.value as RangerAppearance['headwear'] })}><option value="none">None</option><option value="cap">Ranger cap</option><option value="bandana">Bandana</option><option value="hat">Wide-brim hat</option><option value="hood">Hood</option></select></label><label>Accessory<select value={appearance.accessory} onChange={e => update({ accessory: e.currentTarget.value as RangerAppearance['accessory'] })}><option value="none">None</option><option value="scarf">Scarf</option><option value="badge">Badge</option><option value="glasses">Glasses</option><option value="cape">Cape</option></select></label><label>Outfit color<input type="color" value={appearance.color} onInput={e => update({ color: e.currentTarget.value })} /></label><label>Accent color<input type="color" value={appearance.accent} onInput={e => update({ accent: e.currentTarget.value })} /></label></fieldset></div>
    {accountId && <button type="button" class="connect-btn" onClick={() => void save()} disabled={!profileReady || saving}>{saving ? 'Saving…' : 'Save ranger'}</button>}
    <small class="wardrobe-note wardrobe-save-status" role="status">{profileStatus}</small>
  </section>;
}

function AccountPage({ onConnected }: { onConnected: () => void }): JSX.Element {
  const s = useStore();
  const session = s.session;
  const [accounts, setAccounts] = useState<DerivAccountInfo[]>([]);
  const [loadingAccounts, setLoadingAccounts] = useState(false);
  const [switchingAccount, setSwitchingAccount] = useState('');
  const [cashingOut, setCashingOut] = useState(false);
  const [cashingOutAll, setCashingOutAll] = useState(false);
  const [accountError, setAccountError] = useState('');
  const [disconnecting, setDisconnecting] = useState(false);
  const [playerAccounts, setPlayerAccounts] = useState<Array<{ accountId: string; mode: 'demo' | 'real'; currency: string; balance: number }>>([]);
  useEffect(() => {
    if (!s.playerSession || s.owner) return;
    void loadPlayerAccounts().then(setPlayerAccounts).catch((error) => setAccountError(error instanceof Error ? error.message : String(error)));
  }, [s.playerSession?.loginid, s.owner]);
  useEffect(() => {
    if (!session) return;
    setLoadingAccounts(true);
    setAccountError('');
    void loadDerivAccounts()
      .then(setAccounts)
      .catch((error) => setAccountError(error instanceof Error ? error.message : String(error)))
      .finally(() => setLoadingAccounts(false));
  }, [session?.loginid]);
  if (!s.owner && s.playerSession) return <><RangerWardrobe accountId={s.playerSession.loginid} /><section class="connect-card" aria-label="Your Deriv account"><h2 class="connect-title">Your Deriv account</h2><p>{s.playerSession.loginid} · {s.playerSession.mode === 'real' ? 'Real' : 'Demo'}</p><p>Balance: {fmtMoney(s.playerSession.balance, s.playerSession.currency)}</p><p>Market signals and research are shared. Trades and balance belong to this account.</p>{playerAccounts.length > 1 && <div class="player-account-list" aria-label="Authorized Deriv accounts">{playerAccounts.map(account => <button class="connect-btn" type="button" key={account.accountId} disabled={switchingAccount !== '' || account.accountId === s.playerSession?.loginid} onClick={async () => { setSwitchingAccount(account.accountId); setAccountError(''); try { await selectPlayerAccount(account.accountId); } catch (error) { setAccountError(error instanceof Error ? error.message : String(error)); } finally { setSwitchingAccount(''); } }}>{account.mode === 'demo' ? 'Demo' : 'Real'} · {account.accountId} · {fmtMoney(account.balance, account.currency)}</button>)}</div>}{accountError && <p role="alert">{accountError}</p>}<button class="connect-btn" type="button" onClick={() => void refreshPlayerState()}>Refresh account</button><button class="connect-btn" type="button" onClick={() => void logoutPlayer()}>Sign out</button></section></>;
  if (!session) return <><RangerWardrobe accountId={null} /><ConnectView embedded onConnected={onConnected} /></>;
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
  const disconnectDeriv = async (): Promise<void> => {
    if (disconnecting || cashingOut || cashingOutAll || switchingAccount) return;
    setDisconnecting(true);
    setAccountError('');
    try {
      await logout();
    } catch (error) {
      setAccountError(error instanceof Error ? error.message : 'Could not disconnect Deriv. Please try again.');
    } finally {
      setDisconnecting(false);
    }
  };
  const cashOutOpenContract = async (): Promise<void> => {
    setCashingOut(true);
    setAccountError('');
    try {
      await cashOutAccountOpenContract();
      await refreshTrades();
      setAccountError('Contract was cashed out. You can now switch accounts.');
    } catch (error) {
      setAccountError(error instanceof Error ? error.message : String(error));
    } finally {
      setCashingOut(false);
    }
  };
  const cashOutAllOpenContracts = async (): Promise<void> => {
    const confirmed = window.confirm('Cash out every open contract on this account? This sends a sell request for each cash-out eligible Deriv contract and cannot be undone.');
    if (!confirmed) return;
    setCashingOutAll(true);
    setAccountError('');
    try {
      const result = await cashOutAllAccountOpenContracts();
      await refreshTrades();
      if (result.failed.length) {
        setAccountError(`${result.closed.length} contract${result.closed.length === 1 ? '' : 's'} cashed out. ${result.failed.length} could not be closed: ${result.failed.map((item) => item.contractId).join(', ')}.`);
      } else {
        setAccountError(result.message ?? `${result.closed.length} open contract${result.closed.length === 1 ? '' : 's'} cashed out. You can now switch accounts.`);
      }
    } catch (error) {
      setAccountError(error instanceof Error ? error.message : String(error));
    } finally {
      setCashingOutAll(false);
    }
  };
  return (
    <>
      <header class="header">
        <div class="page-title">Account</div>
      </header>
      <RangerWardrobe accountId={session.loginid} />
      <div class="section account-overview">
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
      <CowConfirmationSettings session={session} />
      {s.automation?.running && <button class="logout-btn" type="button" onClick={() => void stopAutomation().catch((error) => setAccountError(error instanceof Error ? error.message : String(error)))}>Stop legacy bot</button>}
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
        <button class="logout-btn account-cashout account-cashout-all" type="button" disabled={cashingOutAll || cashingOut || !!switchingAccount} onClick={() => void cashOutAllOpenContracts()}>
          {cashingOutAll ? 'Cashing out open contractsâ€¦' : 'Cash out all open contracts'}
        </button>
        <small class="account-cashout-note">Closes every cash-out eligible contract on this account before you switch. You will be asked to confirm.</small>
        {accountError.includes('Deriv confirms contract') && <button class="logout-btn account-cashout" type="button" disabled={cashingOut} onClick={() => void cashOutOpenContract()}>
          {cashingOut ? 'Cashing out contract…' : 'Cash out open contract'}
        </button>}
      </div>
      <button class="logout-btn" type="button" disabled={disconnecting || cashingOut || cashingOutAll || !!switchingAccount} onClick={() => void disconnectDeriv()}>
        <Icon name="logout" size={15} strokeWidth={1.8} />
        {disconnecting ? 'Disconnecting…' : 'Disconnect'}
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

/* ---------------- legal & privacy ---------------- */

type LegalPageId = 'privacy' | 'terms' | 'refunds' | 'cookies';

const LEGAL_UPDATED = '11 September 2026';
const LEGAL_CONTACT = { name: 'Ruel McNeil', phone: '+1 876 395 3333', telephone: '+18763953333', email: 'mcneilruel@gmail.com' };

const LEGAL_COPY: Record<LegalPageId, { eyebrow: string; title: string; intro: string; sections: Array<{ heading: string; body: string }> }> = {
  privacy: {
    eyebrow: 'Privacy', title: 'Privacy policy',
    intro: 'This policy describes the data handled by this self-hosted trading dashboard based on the features in this codebase.',
    sections: [
      { heading: 'Information handled', body: 'The dashboard handles a Deriv API token or OAuth authorization needed to connect an account, the selected Deriv account identifier and balance, market quotes, trade and contract records, trading settings, and research or backtest results.' },
      { heading: 'Why it is used', body: 'This information is used to authenticate the selected account, request quotes and proposals, place or close owner-authorized trades, display trading history, and retain research and calibration evidence. It is not used for advertising or behavioural profiling by this application.' },
      { heading: 'Storage and retention', body: 'Server-side application data is stored in the configured SQLite data directory. Sensitive authorization material follows the application’s existing encrypted session and crypto flow. Browser storage is limited to optional chart and planner preferences and a short-lived public-market cache; see the Cookie and storage policy.' },
      { heading: 'Service providers', body: 'Deriv provides account, contract, and market services. Optional cTrader OAuth support and Gold research sources may be enabled by the operator. Google Fonts is requested by the web interface. The application contains no Google Analytics, advertising pixel, or session-replay integration.' },
      { heading: 'Your choices and requests', body: 'You may disconnect the dashboard, clear browser preferences, and ask the operator for access, correction, or deletion of locally stored dashboard data. Account and transaction records held by Deriv are subject to Deriv’s own policies and controls.' },
      { heading: 'Children and updates', body: 'This dashboard is not designed for children. The operator may update this policy when the product or its data practices change; the date above identifies the current version.' },
    ],
  },
  terms: {
    eyebrow: 'Terms', title: 'Terms of use',
    intro: 'These terms describe the use of the ZeroNine trading dashboard and do not replace the terms of any broker or market-data provider.',
    sections: [
      { heading: 'Acceptance and eligibility', body: 'By using the dashboard, you agree to use it lawfully and only with accounts and credentials you are authorized to use. You remain responsible for determining whether trading is permitted where you live and for complying with your agreement with Deriv.' },
      { heading: 'Trading risk and research', body: 'Market research, forecasts, backtests, paper results, and interface signals are informational tools. They are not investment advice and do not guarantee an outcome. Trading can result in losses, including loss of the amount committed to a contract.' },
      { heading: 'Accounts and credentials', body: 'Keep account credentials private. Do not attempt to bypass owner access, risk gates, account limits, or broker safeguards. Do not use the dashboard to interfere with its services, other users, or third-party systems.' },
      { heading: 'Third-party services and availability', body: 'Trading and market data rely on Deriv and, where configured, optional third-party services. Availability, pricing, execution, settlement, and account decisions remain controlled by those providers. The dashboard may be unavailable during maintenance, network, or provider interruptions.' },
      { heading: 'Intellectual property and changes', body: 'The dashboard software, marks, and interface remain subject to their applicable ownership and licence terms. The operator may change, suspend, or end access and may update these terms. Contact the operator for questions or to report misuse.' },
    ],
  },
  refunds: {
    eyebrow: 'Refunds', title: 'Refund policy',
    intro: 'This dashboard codebase does not contain a checkout, subscription, payment processor, or paid digital-delivery flow, so it cannot promise or process refunds itself.',
    sections: [
      { heading: 'Scope', body: 'This policy applies only if the dashboard operator separately charges for access or related services. It does not apply to Deriv deposits, withdrawals, contract payouts, fees, or other broker transactions.' },
      { heading: 'Requests and eligibility', body: 'Where a separate access charge exists, send a request to the operator with the purchase date, amount, and the access issue. Eligibility, if any, depends on the operator’s separately communicated commercial terms; no outcome or refund period is implied by this dashboard.' },
      { heading: 'Cancellations and disputes', body: 'You may request cancellation of future access from the operator. Raise broker-contract questions directly with Deriv. Before opening a payment dispute or chargeback, contact the relevant merchant or payment provider so the issue can be reviewed using the applicable payment terms.' },
      { heading: 'Processing', body: 'If an operator approves a refund, any processing time and return method depend on the original payment provider. This application does not store payment-card details or control payment settlement.' },
    ],
  },
  cookies: {
    eyebrow: 'Storage', title: 'Cookie and storage policy',
    intro: 'This application does not load advertising or analytics trackers. It uses only the storage needed for authentication, service operation, and optional interface preferences.',
    sections: [
      { heading: 'Essential cookies', body: 'When owner access is configured, a signed, HTTP-only zeronine_owner cookie keeps the owner session active for up to 12 hours. The optional Gold OAuth flow uses a short-lived signed nonce cookie to validate the authorization callback.' },
      { heading: 'Browser storage', body: 'sessionStorage temporarily caches public market data for a faster reload. localStorage may remember chart zone width and Gold trading-planner choices. These preferences stay in the browser and are not used for advertising.' },
      { heading: 'No optional tracking consent banner', body: 'Because this build contains no non-essential analytics, advertising, or fingerprinting storage, it does not show a misleading accept/reject tracking banner. If the operator adds such a service, it must be blocked until a meaningful consent choice is made and this policy must be updated.' },
    ],
  },
};

function LegalPage({ page }: { page: LegalPageId }): JSX.Element {
  const content = LEGAL_COPY[page];
  const [storageMessage, setStorageMessage] = useState('');
  const clearPreferences = (): void => {
    const confirmed = window.confirm('Clear saved chart layouts, trade-planner preferences, and the temporary market cache from this browser? This will not close contracts or remove server-side trade history.');
    if (!confirmed) return;
    try {
      for (let index = localStorage.length - 1; index >= 0; index -= 1) {
        const key = localStorage.key(index);
        if (key?.startsWith('zeronine:')) localStorage.removeItem(key);
      }
      sessionStorage.removeItem('zeronine:public-markets:v1');
      setStorageMessage('Saved browser preferences and the temporary market cache were cleared.');
    } catch {
      setStorageMessage('Browser storage could not be cleared here. Use your browser’s site-data controls.');
    }
  };
  return <article class="legal-page" aria-labelledby={`legal-${page}-title`}>
    <header class="legal-header"><span>{content.eyebrow}</span><h1 id={`legal-${page}-title`}>{content.title}</h1><p>{content.intro}</p><small>Last updated {LEGAL_UPDATED}</small></header>
    <div class="legal-sections">
      {content.sections.map((section) => <section key={section.heading}><h2>{section.heading}</h2><p>{section.body}</p></section>)}
    </div>
    {page === 'cookies' && <section class="legal-storage-control" aria-labelledby="clear-browser-storage"><h2 id="clear-browser-storage">Clear saved browser preferences</h2><p>This removes local chart/planner preferences and the temporary market cache only. It does not change a Deriv account, open contract, or server-side trading history.</p><button type="button" onClick={clearPreferences}>Clear saved browser preferences</button><p class="legal-status" role="status" aria-live="polite">{storageMessage}</p></section>}
    <section class="legal-contact"><h2>Contact</h2><p>For questions about this dashboard or a data request, contact {LEGAL_CONTACT.name}.</p><p><a href={`tel:${LEGAL_CONTACT.telephone}`}>{LEGAL_CONTACT.phone}</a><br /><a href={`mailto:${LEGAL_CONTACT.email}`}>{LEGAL_CONTACT.email}</a></p></section>
  </article>;
}

function SiteFooter({ onNavigate }: { onNavigate: (page: Page) => void }): JSX.Element {
  return <footer class="site-footer" aria-label="Legal information">
    <span>ZeroNine · Trading tools carry risk.</span>
    <nav aria-label="Legal links">
      <button type="button" onClick={() => onNavigate('privacy')}>Privacy</button>
      <button type="button" onClick={() => onNavigate('terms')}>Terms</button>
      <button type="button" onClick={() => onNavigate('refunds')}>Refunds</button>
      <button type="button" onClick={() => onNavigate('cookies')}>Cookies & preferences</button>
    </nav>
  </footer>;
}

/* ---------------- bottom nav ---------------- */

function LegalQuickLinks({ onDismiss }: { onDismiss: () => void }): JSX.Element {
  return <aside class="legal-quick-links global" aria-label="Legal and privacy information">
    <span>Legal</span>
    <div>
      <a href="/privacy">Privacy</a>
      <a href="/terms">Terms</a>
      <a href="/refunds">Refunds</a>
      <a href="/cookies">Cookies</a>
      <button type="button" onClick={onDismiss} aria-label="Hide legal links"><Icon name="x" size={12} /></button>
    </div>
  </aside>;
}

function BottomNav({ page, setPage }: { page: Page; setPage: (p: Page) => void }): JSX.Element {
  const [open, setOpen] = useState(false);
  useEffect(() => { setOpen(false); }, [page]);

  const inPasture = page === 'home' || page === 'history' || page === 'account';
  return (
    <div class={`bottom-nav-wrap${inPasture ? ' pasture-nav' : ''}${open ? ' is-open' : ''}`}>
      {inPasture && <button type="button" class="pasture-nav-toggle" aria-label={open ? 'Close game menu' : 'Open game menu'} aria-expanded={open} aria-controls="mobile-game-navigation" onClick={() => setOpen((value) => !value)}><Icon name={open ? 'x' : 'menu'} size={22} strokeWidth={2.2} /></button>}
      <nav id="mobile-game-navigation" class="bottom-nav" aria-label="Main navigation">
        <button class={`nav-item${page === 'home' ? ' active' : ''}`} aria-current={page === 'home' ? 'page' : undefined} onClick={() => setPage('home')}>
          <Icon name="home" size={20} />
          Home
        </button>
        <button class={`nav-item${page === 'history' ? ' active' : ''}`} aria-current={page === 'history' ? 'page' : undefined} onClick={() => setPage('history')}>
          <Icon name="history" size={20} />
          History
        </button>
        <button class={`nav-item${page === 'account' ? ' active' : ''}`} aria-current={page === 'account' ? 'page' : undefined} onClick={() => setPage('account')}>
          <Icon name="account" size={20} />
          Account
        </button>
      </nav>
    </div>
  );
}

