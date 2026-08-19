import { useEffect, useRef, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import type { Market, TradeRow, Settings, SignalCandidate, QuoteEvt, Decision } from './store';
import {
  useStore,
  connectPat,
  oauthStart,
  logout,
  startAutomation,
  stopAutomation,
  arm,
  selectMarket,
  manualTrade,
  updateSettings,
} from './store';

type Page = 'home' | 'bot' | 'history' | 'account';

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
  conservative: { label: 'Conservative', hint: 'Flat bet every round; only bets with a positive edge' },
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
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  arrowUpRight: <path d="M7 17 17 7M8.5 7H17v8.5" />,
  arrowUp: <path d="M12 19V5m0 0-5.5 5.5M12 5l5.5 5.5" />,
  arrowDown: <path d="M12 5v14m0 0 5.5-5.5M12 19 6.5 13.5" />,
  dots: <path d="M6 12h.01M12 12h.01M18 12h.01" />,
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
  const [page, setPage] = useState<Page>('home');

  if (!s.session) return <ConnectView />;

  return (
    <>
      <main class="app" data-page={page}>
        <div class="view view-home">
          <HomePage page={page} onNavigate={setPage} />
        </div>
        <div class="desk-side">
          <div class="view view-bot">
            <BotPage />
          </div>
          <div class="view view-history">
            <HistoryPage />
          </div>
          <div class="view view-account">
            <AccountPage />
          </div>
        </div>
      </main>
      <BottomNav page={page} setPage={setPage} />
    </>
  );
}

function ConnectView(): JSX.Element {
  const s = useStore();
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [oauthBusy, setOauthBusy] = useState(false);

  return (
    <main class="app app--page">
      <div class="header">
        <div class="brand">
          <div class="logo">
            <span class="logo-zero"></span>
            <span class="logo-nine"></span>
          </div>
          <div class="brand-title">
            <span class="zero">Zero</span><span class="nine">Nine</span>
          </div>
        </div>
        <div class="subtitle">Connect your Deriv account to start the bot</div>
      </div>

      <div class="connect-card">
        <div class="connect-title">API Token</div>
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
        <div class="connect-hint">Demo account • API token only</div>
        {s.ws === 'closed' && <div class="connect-err">Feed disconnected – reconnecting…</div>}
      </div>
    </main>
  );
}

/* ---------------- home ---------------- */

function HomePage({ page, onNavigate }: { page: Page; onNavigate: (p: Page) => void }): JSX.Element {
  const s = useStore();
  const [startError, setStartError] = useState('');
  const [manualBusy, setManualBusy] = useState(false);
  const [manualMsg, setManualMsg] = useState('');
  const cooldownLeft = useBotCooldown();

  const market = s.markets.find((m) => m.symbol === s.selected) ?? s.markets[0];
  const marketIndex = s.markets.findIndex((m) => m.symbol === market?.symbol);
  const automation = s.automation?.running ?? false;
  const decision = s.decision?.decision;

  const winCount = s.trades.filter((t) => t.status === 'won').length;
  const lossCount = s.trades.filter((t) => t.status === 'lost').length;
  const pushCount = s.trades.filter((t) => t.status === 'push' || t.status === 'expired' || t.status === 'timeout').length;
  const profit = s.trades.reduce((acc, t) => acc + (t.profit ?? 0), 0);

  const activeDirection = decision?.direction ?? (s.settings?.barrier_preference === 'under' ? 'under' : 'over');
  const activeSide = decision ? sideLabel(decision.direction, decision.barrier) : activeDirection === 'under' ? 'Under 9' : 'Over 0';

  const odds = (() => {
    if (s.quote?.ask && s.quote?.payout) return s.quote.payout / s.quote.ask;
    if (decision) return (decision.estWin + decision.stake) / decision.stake;
    return null;
  })();
  const oddsText = odds ? odds.toFixed(2) : '—';

  const candidates = s.signal?.signal.candidates ?? [];
  const heroTarget = resolveTarget(candidates, s.quotes, decision);
  const showTargetCard = !!decision || (automation && !!heroTarget);
  const targetCard = showTargetCard ? heroTarget : null;

  const currentStreak = (() => {
    let streak = 0;
    for (const t of s.trades) {
      if (t.status === 'lost' || t.status === 'error') break;
      if (t.status === 'won') streak += 1;
    }
    return streak;
  })();

  const levelInfo = (() => {
    const level = Math.floor(winCount / 10) + 1;
    const inLevel = winCount % 10;
    return { level, inLevel, pct: (inLevel / 10) * 100 };
  })();

  const [reward, setReward] = useState<{ id: number; text: string } | null>(null);
  const lastSeenTradeRef = useRef<number | null>(null);
  useEffect(() => {
    const latest = s.trades[0];
    if (!latest) {
      lastSeenTradeRef.current = null;
      return;
    }
    const isNewWin = latest.id !== lastSeenTradeRef.current && latest.status === 'won';
    lastSeenTradeRef.current = latest.id;
    if (!isNewWin) return;
    setReward({ id: latest.id, text: `+10 XP · ${fmtSigned(latest.profit ?? 0, '$')}` });
    const timer = window.setTimeout(() => setReward(null), 2600);
    return () => window.clearTimeout(timer);
  }, [s.trades]);

  const toggleBot = async () => {
    setStartError('');
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
      if (s.session?.mode === 'real') await arm();
      await startAutomation({ strategyMode: s.settings?.strategy_mode ?? 'conservative', baseStake: stake });
    } catch (err) {
      setStartError(err instanceof Error ? err.message : String(err));
    }
  };

  const placeManual = async (direction: 'over' | 'under') => {
    if (!market || manualBusy) return;
    setManualBusy(true);
    setManualMsg('');
    try {
      const stake = s.settings?.base_stake ?? 1;
      const barrier = direction === 'under' ? 9 : 0;
      await manualTrade({ market: market.symbol, direction, barrier, stake });
      setManualMsg(`${direction === 'under' ? 'Under' : 'Over'} ${barrier} placed @ ${stake}`);
    } catch (e) {
      setManualMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setManualBusy(false);
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
            </div>
            <div class="brand-title">
              <span class="zero">Zero</span><span class="nine">Nine</span>
            </div>
          </div>
          <nav class="desktop-nav">
            <button class={`nav-link${page === 'home' ? ' active' : ''}`} onClick={() => onNavigate('home')}>Home</button>
            <button class={`nav-link${page === 'history' ? ' active' : ''}`} onClick={() => onNavigate('history')}>History</button>
            <button class={`nav-link${page === 'bot' ? ' active' : ''}`} onClick={() => onNavigate('bot')}>Bot</button>
            <button class={`nav-link${page === 'account' ? ' active' : ''}`} onClick={() => onNavigate('account')}>Account</button>
          </nav>
          <div class="balance">
            <div class="balance-amount">{fmtMoney(s.session?.balance ?? 0, s.session?.currency)}</div>
            <button class="balance-add">
              <Icon name="plus" size={14} strokeWidth={2.2} />
            </button>
          </div>
        </div>
        <div class="subtitle">{automation ? `Betting ${activeSide} or cycling` : 'Auto-cycling across markets'}</div>
      </header>

      <div class="ticker">
        <div class="ticker-row">
          {s.markets.map((m) => (
            <TickerItem key={m.symbol} market={m} active={m.symbol === market?.symbol} />
          ))}
          {s.markets.map((m) => (
            <TickerItem key={`dup-${m.symbol}`} market={m} active={m.symbol === market?.symbol} />
          ))}
        </div>
      </div>

      <div class="dashboard">
        <div class="dash-main">
          <section class="trade-card">
            <div class="market-head">
              <div class="live">
                <span class="live-dot"></span>
                {s.feed?.connected ? 'LIVE' : 'OFFLINE'}
              </div>
              <div class="market-position">
                {marketIndex >= 0 ? `Market ${marketIndex + 1} / ${s.markets.length}` : '—'}
              </div>
            </div>

            <div class="market-title-row">
              <div>
                <div class="market-name">{market ? shortMarketName(market.display) : 'Loading…'}</div>
                <div class="market-meta">
                  <Icon name="arrowUpRight" size={13} />
                  <span>Synthetic Index</span>
                </div>
              </div>
              {currentStreak > 0 && (
                <div class="streak-chip">
                  <span class="fire">♨</span>
                  <span>{currentStreak} STREAK</span>
                </div>
              )}
            </div>

<ScannerHero
              market={market}
              markets={s.markets}
              target={targetCard}
              digits={s.digits[market?.symbol ?? ''] ?? []}
              automation={automation}
              phase={s.automation?.phase}
              decision={decision}
              holdReason={automation && !decision ? (s.hold?.reason ?? null) : null}
            />

            {!targetCard && (
              <div class="side-selector">
                <button
                  class={`side-btn over${activeDirection === 'over' ? ' active' : ''}`}
                  disabled={!market || manualBusy}
                  onClick={() => placeManual('over')}
                >
                  <span class="side-name">Over 0</span>
                  <span class="side-odds">{oddsText}</span>
                </button>
                <button
                  class={`side-btn under${activeDirection === 'under' ? ' active' : ''}`}
                  disabled={!market || manualBusy}
                  onClick={() => placeManual('under')}
                >
                  <span class="side-name">Under 9</span>
                  <span class="side-odds">{oddsText}</span>
                </button>
                {manualMsg && <div class="manual-msg">{manualMsg}</div>}
              </div>
            )}

            <div class="xp-bar">
              <span class="xp-level">Lv {levelInfo.level}</span>
              <span class="xp-track">
                <span class="xp-fill" style={{ width: `${levelInfo.pct}%` }}></span>
              </span>
              <span class="xp-count">{levelInfo.inLevel}/10 XP</span>
            </div>

            {startError && <div class="bot-error">{startError}</div>}

            <button class={`bot-control${automation ? ' running' : ''}`} disabled={!automation && cooldownLeft > 0} onClick={() => void toggleBot()}>
              <Icon name={automation ? 'square' : 'play'} size={14} strokeWidth={2.2} />
              <span>{automation ? 'Stop Bot' : cooldownLeft > 0 ? `Start in ${cooldownLeft}s` : 'Start Bot'}</span>
            </button>
          </section>
        </div>

        <div class="dash-side">
          <section class="section">
            <div class="section-head">
              <div class="section-title">Recent Activity</div>
              <button class="section-action" onClick={() => onNavigate('history')}>View All</button>
            </div>
            <div class="activity">
              {s.trades.length === 0 && <div class="empty-hint">No trades yet – start the bot</div>}
              {s.trades.slice(0, 5).map((t) => (
                <ActivityRow key={t.id} trade={t} />
              ))}
            </div>
          </section>

          <section class="perf">
            <div class="perf-cell win">
              <div class="perf-value">{winCount}</div>
              <div class="perf-label">Wins</div>
            </div>
            <div class="perf-cell loss">
              <div class="perf-value">{lossCount}</div>
              <div class="perf-label">Losses</div>
            </div>
            <div class="perf-cell push">
              <div class="perf-value">{pushCount}</div>
              <div class="perf-label">Pushes</div>
            </div>
            <div class={`perf-cell profit${profit >= 0 ? '' : ' negative'}`}>
              <div class="perf-value">{fmtSigned(profit, s.session?.currency)}</div>
              <div class="perf-label">Profit</div>
            </div>
          </section>
        </div>
      </div>

      {reward && (
        <div class="reward-toast" key={reward.id}>
          <span class="reward-spark">✦</span>
          <span>{reward.text}</span>
        </div>
      )}
    </>
  );
}

function TickerItem({ market, active }: { market: Market; active: boolean }): JSX.Element {
  const s = useStore();
  const digit = market.lastDigit >= 0 ? market.lastDigit : '–';
  const pred = (s.signal?.signal.candidates ?? []).find((c) => c.market === market.symbol);
  const trades = s.trades.filter((t) => t.market === market.symbol);
  const profit = trades.reduce((acc, t) => acc + (t.profit ?? 0), 0);

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
      <span class={`tick-pl${profit >= 0 ? ' pos' : ' neg'}`}>
        {trades.length ? fmtSigned(profit, '$') : '·'}
      </span>
    </div>
  );
}

function ActivityRow({ trade }: { trade: TradeRow }): JSX.Element {
  const win = trade.status === 'won';
  const loss = trade.status === 'lost';
  const exp = trade.status === 'expired' || trade.status === 'timeout';
  const err = trade.status === 'error';
  const pend = trade.status === 'pending';
  const label = trade.contract_type === 'DIGITOVER' ? `Over ${trade.barrier}` : `Under ${trade.barrier}`;
  const pnl = trade.profit ?? 0;
  const digit = trade.exit_digit != null && trade.exit_digit >= 0 ? trade.exit_digit : '–';

  const tone = win ? 'win' : loss ? 'loss' : 'push';
  const time = new Date(trade.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const resultText = win ? 'Won' : loss ? 'Lost' : exp ? 'Push' : err ? 'Error' : 'Open';

  return (
    <div class={`activity-row${pend ? ' pending' : ''}`}>
      <div class={`activity-digit ${tone}${pend ? ' pending' : ''}`}>{digit}</div>
      <div class="activity-main">
        <div class="activity-betline">
          <span class="activity-bet">{label}</span>
          <span class="activity-stake">${(trade.stake ?? 0).toFixed(2)}</span>
        </div>
        <div class={`activity-result ${tone}`}>
          {pend && <span class="live-dot"></span>}
          <span class="activity-outcome">{resultText}</span>
          {digit !== '–' && <span class="activity-exit">· exit {digit}</span>}
          <span class="activity-meta">· {time}</span>
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

/* ---------------- market scanner hero ---------------- */

interface HeroTarget {
  market: string;
  direction: 'over' | 'under';
  barrier: number;
  estWin: number;
  edge: number;
  breakeven: number;
  consistency: number;
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

function resolveTarget(
  candidates: SignalCandidate[],
  quotes: Record<string, QuoteEvt>,
  decision?: Decision,
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
    };
  }
  const c = candidates[0];
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
  };
}

function ScannerHero({
  market,
  markets,
  target,
  digits,
  automation,
  phase,
  decision,
  holdReason,
}: {
  market?: Market;
  markets: Market[];
  target: HeroTarget | null;
  digits: number[];
  automation: boolean;
  phase?: string;
  decision?: Decision;
  holdReason: string | null;
}): JSX.Element {
  const [pulseDigit, setPulseDigit] = useState(-1);
  const lastDigitRef = useRef<number | null>(null);

  useEffect(() => {
    const d = market?.lastDigit ?? -1;
    if (d >= 0 && lastDigitRef.current !== d) {
      lastDigitRef.current = d;
      setPulseDigit(d);
      const t = window.setTimeout(() => setPulseDigit(-1), 520);
      return () => window.clearTimeout(t);
    }
    if (lastDigitRef.current === null) lastDigitRef.current = d;
  }, [market?.lastDigit]);

  const counts = new Array(10).fill(0) as number[];
  for (const d of digits) {
    if (d >= 0 && d <= 9) counts[d] += 1;
  }
  const windowSize = digits.length;
  const pctOf = (i: number) => (windowSize > 0 ? Math.round((counts[i] / windowSize) * 100) : 0);

  const ranked = Array.from({ length: 10 }, (_, i) => ({ i, n: counts[i] })).sort((a, b) => b.n - a.n);
  const hotPurple = ranked[0] && ranked[0].n > 0 ? ranked[0].i : -1;
  const hotPink = ranked[1] && ranked[1].n > 0 && ranked[1].n < ranked[0]?.n ? ranked[1].i : -1;

  const stateLabel = !automation
    ? 'BOT IDLE'
    : decision
      ? 'TARGET ACQUIRED'
      : holdReason
        ? 'NO EDGE — KEEP SCANNING'
        : scannerPhaseLabel(phase);
  const stateTone = decision
    ? 'locked'
    : holdReason
      ? 'warn'
      : automation
        ? 'scan'
        : 'idle';

  const targetLabel = target
    ? (markets.find((m) => m.symbol === target.market)?.display ?? target.market)
    : '';
  const targetSub = target ? `${shortMarketName(targetLabel)} · ${target.market}` : '';

  return (
    <div class="scanner">
      <div class={`scanner-state ${stateTone}`}>
        <span class="scanner-dot"></span>
        <span class="scanner-label">{stateLabel}</span>
        {windowSize > 0 && <span class="scanner-window">· {windowSize} ticks</span>}
      </div>

      <div class="digit-grid">
        {Array.from({ length: 10 }, (_, i) => (
          <div
            key={i}
            class={[
              'digit-card',
              pulseDigit === i ? 'pulse' : '',
              hotPurple === i ? 'hot-purple' : '',
              hotPink === i && hotPink !== hotPurple ? 'hot-pink' : '',
              market?.lastDigit === i ? 'live' : '',
            ]
              .filter(Boolean)
              .join(' ')}
            style={{ animationDelay: `-${i * 0.6}s` }}
          >
            <span class="digit-number">{i}</span>
            <span class="digit-percent">{pctOf(i)}%</span>
          </div>
        ))}
      </div>

      {target && (
        <div class={`target-lock${decision ? ' acquired' : ' locked'}`}>
          <div class="target-icon">
            <span class="ring one"></span>
            <span class="ring two"></span>
            <span class="ring three"></span>
            <span class="cross horizontal"></span>
            <span class="cross vertical"></span>
            <span class="lock"></span>
          </div>
          <div class="target-copy">
            <div class="target-name">{sideLabel(target.direction, target.barrier).toUpperCase()}</div>
            <div class="target-score">{Math.round(target.estWin * 100)}%</div>
            <div class={`target-status${decision ? ' acquired' : ''}`}>
              {decision ? 'TARGET ACQUIRED' : 'TARGET LOCK'}
            </div>
            <div class="target-sub">{targetSub}</div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------------- bot settings ---------------- */

function BotPage(): JSX.Element {
  const s = useStore();
  const [stakeText, setStakeText] = useState(String(s.settings?.base_stake ?? 1));
  const [maxTradesText, setMaxTradesText] = useState('0');
  const [strategy, setStrategy] = useState<Settings['strategy_mode']>(s.settings?.strategy_mode ?? 'conservative');
  const [error, setError] = useState('');
  const cooldownLeft = useBotCooldown();
  const automation = s.automation?.running ?? false;

  const persistStake = (v: string) => {
    setStakeText(v);
    const n = Number(v);
    if (n > 0) void updateSettings({ base_stake: Math.max(0.1, n) });
  };

  const pickStrategy = (m: Settings['strategy_mode']) => {
    setStrategy(m);
    void updateSettings({ strategy_mode: m });
  };

  const toggleBot = async () => {
    setError('');
    try {
      if (automation) {
        await stopAutomation();
        return;
      }
      if (cooldownLeft > 0) return;
      if (s.session?.mode === 'real') await arm();
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

      <div class="section">
        <div class="set-group">
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

        <div class="set-group">
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

        <div class="set-group">
          <div class="set-label-top">Strategy</div>
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

        <div class="set-group">
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
  let run = 0;
  for (const t of ordered) {
    if (t.status === 'won') {
      run += 1;
      best = Math.max(best, run);
    } else if (t.status === 'lost') {
      worst = Math.max(worst, run);
      run = 0;
    }
  }
  worst = Math.max(worst, run === 0 ? 0 : 0);

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
          <ActivityRow key={t.id} trade={t} />
        ))}
      </div>
    </>
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

/* ---------------- account ---------------- */

function AccountPage(): JSX.Element {
  const s = useStore();
  const session = s.session;
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
        <button class={`nav-item${page === 'account' ? ' active' : ''}`} onClick={() => setPage('account')}>
          <Icon name="account" size={20} />
          Account
        </button>
      </nav>
    </div>
  );
}