import { useEffect, useRef, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import type { Market, TradeRow, Settings } from './store';
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

  const statusText = (() => {
    if (!automation) return 'Bot stopped';
    if (s.hold?.reason) return s.hold.reason;
    if (decision) return 'Waiting for result';
    if (s.quote || s.signal) return 'Analyzing digits';
    return 'Scanning market';
  })();

  const liveSignal = s.signal?.signal;
  const prediction =
    automation && liveSignal && liveSignal.winRate > 0
      ? {
          direction: liveSignal.direction,
          winRate: liveSignal.winRate,
          edge: liveSignal.edge,
          reason: liveSignal.reason,
          market: liveSignal.market,
        }
      : null;
  const predPct = prediction ? Math.round(prediction.winRate * 100) : null;
  const predMarker = prediction
    ? Math.min(
        96,
        Math.max(4, prediction.direction === 'over' ? 50 + (prediction.winRate - 0.5) * 100 : 50 - (prediction.winRate - 0.5) * 100),
      )
    : 50;
  const predReason = prediction?.reason ?? null;
  const holdReason = automation && !prediction ? (s.hold?.reason ?? null) : null;

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
            </div>

            <div class="prediction">
              <div class="prediction-head">
                <span class="prediction-label">Prediction</span>
                <span class={`prediction-value ${prediction ? prediction.direction : 'none'}`}>
                  {prediction
                    ? `${prediction.market && prediction.market !== market?.symbol ? `${shortMarketName(prediction.market)} · ` : ''}${prediction.direction === 'over' ? 'Over 0' : 'Under 9'} · ${predPct}%`
                    : automation
                      ? holdReason
                        ? 'Scanning…'
                        : 'Analyzing…'
                      : 'Bot idle'}
                </span>
              </div>
              <div class="prediction-track">
                <span class="prediction-half under">Under 9</span>
                <span class="prediction-rail">
                  {prediction && (
                    <span class={`prediction-marker ${prediction.direction}`} style={{ left: `${predMarker}%` }}></span>
                  )}
                </span>
                <span class="prediction-half over">Over 0</span>
              </div>
              {(predReason || holdReason) && <div class="prediction-reason">{predReason ?? holdReason}</div>}
            </div>

            <div class="chart-box">
              <ChartCanvas market={market} />
              <div class="tick-badge">{market?.lastQuote != null ? market.lastQuote.toFixed(2) : '--'}</div>
            </div>

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
            </div>

            <div class="betting-status">
              <span>Betting</span>
              <b class={`side-tag ${activeDirection}`}>{activeSide}</b>
              <span class="status-check">
                <Icon name="check" size={11} strokeWidth={2.6} />
              </span>
            </div>

            <div class={`status-line${automation ? '' : ' muted'}`}>
              {manualBusy ? 'Placing…' : manualMsg || statusText}
            </div>

            {s.hold?.reason && automation && <div class="bot-hold">{s.hold.reason}</div>}
            {startError && <div class="bot-error">{startError}</div>}

            <button class="bot-control" disabled={!automation && cooldownLeft > 0} onClick={() => void toggleBot()}>
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
    </>
  );
}

function TickerItem({ market, active }: { market: Market; active: boolean }): JSX.Element {
  const s = useStore();
  const digit = market.lastDigit >= 0 ? market.lastDigit : '–';
  const liveSignal = s.signal?.signal;
  const pred = liveSignal && liveSignal.market === market.symbol && liveSignal.winRate > 0 ? liveSignal : null;
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
        {pred ? `${pred.direction === 'over' ? 'O' : 'U'}${Math.round(pred.winRate * 100)}%` : '—'}
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

/* ---------------- chart ---------------- */

function ChartCanvas({ market }: { market?: Market }): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const valuesRef = useRef<number[]>([]);
  const lastQuote = market?.lastQuote;

  useEffect(() => {
    if (lastQuote == null) return;
    const arr = valuesRef.current;
    if (arr[arr.length - 1] !== lastQuote) {
      valuesRef.current = [...arr.slice(-44), lastQuote];
    }
  }, [lastQuote]);

  useEffect(() => {
    drawChart(canvasRef.current, valuesRef.current);
  }, [lastQuote]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    drawChart(canvas, valuesRef.current);

    const onResize = () => drawChart(canvasRef.current, valuesRef.current);
    window.addEventListener('resize', onResize);

    let observer: ResizeObserver | undefined;
    if (typeof ResizeObserver !== 'undefined' && canvas.parentElement) {
      observer = new ResizeObserver(() => drawChart(canvasRef.current, valuesRef.current));
      observer.observe(canvas.parentElement);
    }

    return () => {
      window.removeEventListener('resize', onResize);
      observer?.disconnect();
    };
  }, []);

  return <canvas ref={canvasRef}></canvas>;
}

function drawChart(canvas: HTMLCanvasElement | null, chartValues: number[]): void {
  if (!canvas) return;
  const rect = canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(rect.width * dpr);
  canvas.height = Math.round(rect.height * dpr);
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const width = rect.width;
  const height = rect.height;
  ctx.clearRect(0, 0, width, height);

  const values = chartValues.length >= 2 ? chartValues : [0, 0];
  const padding = 9;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;

  ctx.strokeStyle = 'rgba(255,255,255,.045)';
  ctx.lineWidth = 1;
  for (let i = 1; i < 4; i++) {
    const y = height * (i / 4);
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }

  const points = values.map((value, index) => {
    const x = padding + (index / (values.length - 1)) * (width - padding * 2);
    const y = padding + (1 - (value - min) / range) * (height - padding * 2);
    return { x, y };
  });

  const gradient = ctx.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, 'rgba(139,92,246,.16)');
  gradient.addColorStop(1, 'rgba(139,92,246,0)');
  ctx.beginPath();
  ctx.moveTo(points[0].x, height);
  points.forEach((p) => ctx.lineTo(p.x, p.y));
  ctx.lineTo(points[points.length - 1].x, height);
  ctx.closePath();
  ctx.fillStyle = gradient;
  ctx.fill();

  const lineGradient = ctx.createLinearGradient(0, 0, width, 0);
  lineGradient.addColorStop(0, '#7c5cff');
  lineGradient.addColorStop(0.7, '#8b5cf6');
  lineGradient.addColorStop(1, '#ff4d91');
  ctx.beginPath();
  points.forEach((p, index) => {
    if (index === 0) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  });
  ctx.strokeStyle = lineGradient;
  ctx.lineWidth = 2;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.stroke();

  const last = points[points.length - 1];
  ctx.beginPath();
  ctx.arc(last.x, last.y, 3.5, 0, Math.PI * 2);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.beginPath();
  ctx.arc(last.x, last.y, 6, 0, Math.PI * 2);
  ctx.strokeStyle = '#ff4d91';
  ctx.lineWidth = 2;
  ctx.stroke();
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