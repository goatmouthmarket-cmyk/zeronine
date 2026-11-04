import { useEffect, useRef, useState } from 'preact/hooks';
import type { JSX } from 'preact';

type Lesson = {
  title: string;
  body: string;
  tip?: string;
  exercise?: 'move' | 'cow' | 'aim' | 'paper' | 'markets' | 'auto' | 'start';
};

const LESSONS: Lesson[] = [
  { title: 'Welcome to the pasture', body: 'Each cow represents a possible digit trade. Let’s learn the controls in a safe practice pasture.', tip: 'Everything here is simulated. No account, live ticks, or money are used.' },
  { title: 'Move your ranger', body: 'Click or tap an open patch of grass to walk there. On a keyboard, use WASD or the arrow keys.', tip: 'On desktop, scroll to zoom. On touchscreens, pinch to zoom.', exercise: 'move' },
  { title: 'Meet the markets', body: 'Each cow shows a market, such as Volatility 50. A market has its own changing stream of prices and final digits.', tip: 'Volatility 50 (1s) and Volatility 50 are different markets. Tap a cow to inspect its example.', exercise: 'cow' },
  { title: 'Read the cow’s bubble', body: 'OVER 2 means the final digit must be greater than 2. UNDER 7 means it must be less than 7. The barrier itself loses.', tip: 'Confidence is an estimate. L and H count recent low digits (0–4) and high digits (5–9).' },
  { title: 'Understand edge', body: 'Edge compares the estimated chance of winning with the chance needed to break even at the estimated payout.', tip: 'Positive edge is a model estimate, not a promise of profit. Estimates and quotes can change.' },
  { title: 'What the rings mean', body: 'Green marks the strongest fresh positive edge. Gold marks the highest confidence-weighted return estimate.', tip: 'A red ring marks a fresh entry signal. A cow can have more than one highlight; none guarantees a win.' },
  { title: 'Aim at a cow', body: 'Left-click or tap a cow. The ranger moves into position and shoots automatically; the health bar shows progress.', tip: 'In guest play this is practice. When connected, defeating a cow can submit the selected contract, subject to account and risk checks.', exercise: 'aim' },
  { title: 'Read the ranger’s bubble', body: 'The bubble shows status, market, direction, barrier, stake and style, plus the quote freshness and estimated edge when available.', tip: 'After settlement, the digit and WON or LOST result appear with profit or loss and any remaining session loss. Tap the bubble to dismiss it.' },
  { title: 'Try a paper shot', body: 'Right-click a cow, or press and hold it on touch, to make a paper trade. Try it on the highlighted cow.', tip: 'In the game, a fresh live market tick is needed; the result uses the next tick. No account money is used.', exercise: 'paper' },
  { title: 'Set your trade', body: 'Open Markets to choose your stake and bet style, see live targets and recent bets, and review the account balance.', tip: 'Base keeps the stake flat. Recovery styles can increase the next stake after losses and carry additional risk.', exercise: 'markets' },
  { title: 'Meet Ranger Auto', body: 'Use the play icon to open automation controls. The icon shows pause and “Running” when Auto is active; opening it does not pause trading.', tip: 'Ranger Auto selects eligible highlighted cows after three fresh confirming ticks. Signals can disappear or change.', exercise: 'auto' },
  { title: 'Set limits first', body: 'Choose your stake, bet style, losses before cooldown, cooldown duration and optional take-profit target.', tip: 'Take profit stops new trades after the current contract settles. It is a target, not a guaranteed maximum or profit.' },
  { title: 'Start and pause Auto', body: 'Try the start control in this simulation. In the game the same control pauses the running ranger.', tip: 'Real-account automation requires owner authorization and arming. Account, risk, quote and single-open-contract safeguards still apply.', exercise: 'start' },
  { title: 'Follow the run', body: 'While Auto runs, current-run P&L and its latest automatic trades appear in the pasture.', tip: 'The ghost scout and paper results are virtual research. They do not change your Deriv balance or account P&L.' },
  { title: 'Explore the pasture', body: 'Use the level and mission panel to see progress, and the heart icon to check connection health or recover a stuck view.', tip: 'The gold mine opens Gold research and demo trading. Cooldowns give you a break between eligible trades.' },
  { title: 'You’re ready', body: 'Take your time, check the market and stake, and use paper practice when you want to explore.', tip: 'You can return to this guide from How to play whenever you need it.' },
];

interface Point { x: number; y: number }
const START: Point = { x: 355, y: 390 };

function Cow({ point, highlight = false }: { point: Point; highlight?: boolean }): JSX.Element {
  return <g transform={`translate(${point.x} ${point.y})`} aria-hidden="true">
    <ellipse cx="2" cy="23" rx="43" ry="13" fill="#1a3623" opacity=".4" />
    {highlight && <><ellipse cx="0" cy="20" rx="57" ry="25" fill="none" stroke="#38ed86" stroke-width="4" opacity=".9" /><ellipse cx="0" cy="20" rx="51" ry="19" fill="none" stroke="#ffe37b" stroke-width="3" opacity=".9" /></>}
    <path d="M-38 -4 Q-54 -10 -47 12" fill="none" stroke="#cbb99b" stroke-width="3" />
    <path d="M-30 5h9v34h-9zM18 5h10v34H18z" fill="#b9ac97" />
    <path d="M-30 35h11v5h-11zM17 35h12v5H17z" fill="#645044" />
    <ellipse cx="-2" cy="-4" rx="38" ry="23" fill="#f0e4ce" />
    <path d="M-30-15-16-25-3-19-6-4-20 5-33-3z" fill="#765140" />
    <path d="M8-24 30-16 26 3 15 8 4-7z" fill="#654638" />
    <ellipse cx="36" cy="-8" rx="19" ry="18" fill="#e9ddc6" />
    <path d="M25-21 16-27 19-12zM43-20 53-27 52-10z" fill="#b9a187" />
    <ellipse cx="45" cy="0" rx="13" ry="9" fill="#d9aaa2" />
    <circle cx="40" cy="0" r="1.7" fill="#775b55" /><circle cx="48" cy="0" r="1.7" fill="#775b55" />
    <circle cx="38" cy="-14" r="2" fill="#2a2823" /><circle cx="47" cy="-14" r="2" fill="#2a2823" />
  </g>;
}

function Ranger({ point }: { point: Point }): JSX.Element {
  return <g class="guide-ranger" style={{ transform: `translate(${point.x}px, ${point.y}px)` }} aria-hidden="true">
    <ellipse cx="2" cy="21" rx="18" ry="7" fill="#143625" opacity=".45" />
    <path d="M-10 20h7v18h-7zM3 20h7v18H3z" fill="#393a3d" />
    <path d="M-13-9H11L13 22H-12z" fill="#326db1" stroke="#224470" /><path d="M-12 17h25v5h-25z" fill="#866338" />
    <path d="M-15-15-21-27-14-36-7-25z" fill="#7c4934" />
    <circle cx="0" cy="-20" r="11" fill="#cba17d" />
    <path d="M-11-23-9-31 2-35 11-30 11-23 4-28-5-24z" fill="#4d3729" />
    <circle cx="2" cy="-20" r="1.3" fill="#271f1d" /><circle cx="7" cy="-20" r="1.3" fill="#271f1d" />
    <path d="M-16-3h6v20h-6zM11-3h6v18h-6z" fill="#c69b75" />
    <path d="M15-24 Q39-5 15 14" fill="none" stroke="#bb874e" stroke-width="3" /><path d="M15-24v38" stroke="#f5e8c8" />
  </g>;
}

export function PastureTutorialGame({ onExit }: { onExit: () => void }): JSX.Element {
  const [step, setStep] = useState(0);
  const [player, setPlayer] = useState<Point>(START);
  const [done, setDone] = useState<Record<string, boolean>>({});
  const [marketsOpen, setMarketsOpen] = useState(false);
  const [autoOpen, setAutoOpen] = useState(false);
  const [autoRunning, setAutoRunning] = useState(false);
  const [paper, setPaper] = useState(false);
  const [aiming, setAiming] = useState(false);
  const [aimDone, setAimDone] = useState(false);
  const [selected, setSelected] = useState(false);
  const [compact, setCompact] = useState(() => window.matchMedia('(max-width: 600px)').matches);
  const pressTimer = useRef<number | null>(null);
  const suppressClick = useRef(false);
  const lesson = LESSONS[step];
  const cow = compact ? { x: 585, y: 295 } : { x: 670, y: 295 };
  const secondCow = compact ? { x: 320, y: 235 } : { x: 250, y: 235 };
  const completed = !lesson.exercise || !!done[lesson.exercise];

  useEffect(() => () => {
    if (pressTimer.current !== null) window.clearTimeout(pressTimer.current);
  }, []);
  useEffect(() => {
    const media = window.matchMedia('(max-width: 600px)');
    const update = (): void => setCompact(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  useEffect(() => {
    if (step !== 8) setPaper(false);
    if (step !== 6 && step !== 7) { setAiming(false); setAimDone(false); }
    if (step === 11 || step === 12) { setMarketsOpen(false); setAutoOpen(true); }
    if (step === 13 || step === 14) { setMarketsOpen(false); setAutoOpen(false); }
  }, [step]);
  useEffect(() => {
    if (!aiming) return;
    const timer = window.setTimeout(() => setAimDone(true), 1800);
    return () => window.clearTimeout(timer);
  }, [aiming]);

  const complete = (exercise: NonNullable<Lesson['exercise']>): void => setDone((previous) => ({ ...previous, [exercise]: true }));
  const next = (): void => setStep((value) => Math.min(LESSONS.length - 1, value + 1));
  const previous = (): void => setStep((value) => Math.max(0, value - 1));
  const move = (point: Point): void => {
    if (lesson.exercise !== 'move') return;
    const next = { x: Math.max(compact ? 285 : 70, Math.min(compact ? 630 : 830, point.x)), y: Math.max(150, Math.min(435, point.y)) };
    for (const animal of [cow, secondCow]) {
      const dx = next.x - animal.x, dy = next.y - animal.y, distance = Math.hypot(dx, dy);
      if (distance < 75) {
        const angle = distance > 0 ? Math.atan2(dy, dx) : Math.PI / 2;
        next.x = animal.x + Math.cos(angle) * 75;
        next.y = animal.y + Math.sin(angle) * 75;
      }
    }
    setPlayer(next);
    complete('move');
  };
  const selectCow = (): void => {
    if (suppressClick.current) { suppressClick.current = false; return; }
    setSelected(true);
    if (lesson.exercise === 'cow') complete('cow');
    if (lesson.exercise === 'aim') { setAimDone(false); setAiming(true); complete('aim'); }
  };
  const paperShot = (): void => {
    if (lesson.exercise !== 'paper') return;
    setPaper(true);
    complete('paper');
  };
  const onGrass = (event: MouseEvent): void => {
    const svg = event.currentTarget as SVGSVGElement;
    const point = svg.createSVGPoint();
    point.x = event.clientX; point.y = event.clientY;
    const matrix = svg.getScreenCTM();
    if (matrix) move(point.matrixTransform(matrix.inverse()));
  };
  const onKey = (event: KeyboardEvent): void => {
    const keys: Record<string, Point> = { arrowleft: { x: -35, y: 0 }, a: { x: -35, y: 0 }, arrowright: { x: 35, y: 0 }, d: { x: 35, y: 0 }, arrowup: { x: 0, y: -35 }, w: { x: 0, y: -35 }, arrowdown: { x: 0, y: 35 }, s: { x: 0, y: 35 } };
    const delta = keys[event.key.toLowerCase()];
    if (delta && lesson.exercise === 'move') { event.preventDefault(); move({ x: player.x + delta.x, y: player.y + delta.y }); }
  };
  const startLongPress = (event: PointerEvent): void => {
    if (event.pointerType !== 'touch' || lesson.exercise !== 'paper') return;
    pressTimer.current = window.setTimeout(() => { suppressClick.current = true; paperShot(); pressTimer.current = null; }, 650);
  };
  const cancelLongPress = (): void => {
    if (pressTimer.current !== null) window.clearTimeout(pressTimer.current);
    pressTimer.current = null;
  };

  return <section class="pasture-guide" aria-label="Interactive practice pasture">
    <header class="guide-top">
      <button class="guide-exit" type="button" onClick={onExit} aria-label="Exit tutorial">← <span>Pasture</span></button>
      <div class="guide-brand"><strong>HOW TO PLAY</strong><span>Practice pasture · no money used</span></div>
      <span class="guide-count">{step + 1} / {LESSONS.length}</span>
    </header>
    <div class="guide-scene">
      <svg class="guide-pasture" viewBox={compact ? '250 60 420 420' : '0 0 900 500'} preserveAspectRatio="xMidYMid meet" role="application" tabIndex={0}
        aria-label="Practice pasture. Use arrow keys to move during the movement lesson." onClick={onGrass} onKeyDown={onKey}>
        <rect width="900" height="500" fill="#53894b" />
        <path d="M0 33h900M0 465h900" stroke="#795c3e" stroke-width="8" />
        {Array.from({ length: 15 }, (_, index) => <path key={index} d={`M${index * 65 + 20} 20v32 M${index * 65 + 20} 450v32`} stroke="#775336" stroke-width="8" />)}
        {Array.from({ length: 65 }, (_, index) => <circle key={index} cx={(index * 139 + 55) % 900} cy={(index * 79 + 70) % 360 + 55} r={index % 3 === 0 ? 2 : 1} fill={index % 4 === 0 ? '#f5e6bb' : '#93ad65'} />)}
        <path d="M775 32h125v430H750q-18-100 12-215t13-215" fill="#c9ad78" opacity=".72" />
        {step === 1 && <g class="guide-svg-highlight" pointer-events="none">
          <circle cx={player.x} cy={player.y - 5} r="48" />
          <path d={`M${player.x + 50} ${player.y + 15}l35 15`} />
          <circle cx={player.x + 98} cy={player.y + 35} r="12" />
          <text x={player.x + 60} y={player.y + 58}>TAP GRASS</text>
        </g>}
        {step === 5 && <ellipse cx={secondCow.x} cy={secondCow.y + 20} rx="65" ry="31" fill="none" stroke="#ff4057" stroke-width="4" />}
        {step === 5 && <g class="guide-svg-highlight" pointer-events="none"><ellipse cx={secondCow.x} cy={secondCow.y + 20} rx="73" ry="39" /><text x={secondCow.x - 42} y={secondCow.y + 70}>RED SIGNAL</text></g>}
        <Cow point={secondCow} /><Cow point={cow} highlight />
        {[2, 5, 6, 8].includes(step) && <g class="guide-svg-highlight" pointer-events="none">
          <ellipse cx={cow.x} cy={cow.y + 4} rx={step === 5 ? 72 : 66} ry={step === 5 ? 43 : 52} />
          <text x={cow.x - 46} y={cow.y + 67}>{step === 5 ? 'RINGS' : step === 8 ? 'PAPER TARGET' : 'COW'}</text>
        </g>}
        {step === 6 && !aiming && <g pointer-events="none"><rect x={cow.x - 25} y={cow.y - 48} width="50" height="5" fill="#382c27" /><rect x={cow.x - 24} y={cow.y - 47} width="48" height="3" fill="#76cb78" /></g>}
        {aiming && !aimDone && <g><path class="guide-aim-line" d={`M${player.x + 15} ${player.y - 8} L${cow.x} ${cow.y}`} stroke="#f4d17f" stroke-width="3" stroke-dasharray="8 5" /><rect x={cow.x - 25} y={cow.y - 48} width="50" height="5" fill="#382c27" /><rect x={cow.x - 24} y={cow.y - 47} width="32" height="3" fill="#76cb78" /></g>}
        {paper && <g class="guide-paper-ghost"><path d={`M${player.x + 15} ${player.y - 8} L${cow.x} ${cow.y}`} stroke="#f4d17f" stroke-width="3" /><g opacity=".5"><Cow point={cow} /></g></g>}
        <Ranger point={player} />
        <g class="guide-cow-target" role="button" tabIndex={0} aria-label="Practice cow: Volatility 50, over 2" onClick={(event) => { event.stopPropagation(); selectCow(); }}
          onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); selectCow(); } }}
          onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); cancelLongPress(); paperShot(); }}
          onPointerDown={startLongPress} onPointerUp={cancelLongPress} onPointerCancel={cancelLongPress} onPointerLeave={cancelLongPress}>
          <rect x={cow.x - 56} y={cow.y - 40} width="125" height="90" fill="transparent" />
        </g>
        <g class="guide-market-card" transform={`translate(${cow.x - 85} 174)`} role="button" tabIndex={0} aria-label="Inspect Volatility 50 market bubble" onClick={(event) => { event.stopPropagation(); selectCow(); }} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); selectCow(); } }}>
          <rect width="170" height="68" rx="8" fill="#10271e" stroke={selected ? '#ffe37b' : '#38ed86'} stroke-width="2" />
          <text x="9" y="16" fill="#fff4cf" font-size="10" font-weight="800">Volatility 50 (1s)</text>
          <text x="9" y="33" fill="#90ed9e" font-size="11" font-weight="900">↑ OVER 2</text>
          <text x="105" y="33" fill="#e9efe3" font-size="8" font-weight="800">76% CONF</text>
          <rect x="8" y="40" width="68" height="17" rx="4" fill="#165331" />
          <text x="12" y="52" fill="#8cf0a7" font-size="9" font-weight="900">▲ +4% EDGE</text>
          <text x="101" y="52" fill="#e8eddf" font-size="8" font-weight="800">L 24 · H 26</text>
          {step === 3 && <g class="guide-svg-highlight" pointer-events="none"><rect x="3" y="3" width="164" height="62" rx="6" /><text x="7" y="-7">COW BUBBLE</text></g>}
          {step === 4 && <g class="guide-svg-highlight" pointer-events="none"><rect x="5" y="37" width="74" height="23" rx="5" /><text x="5" y="-7">EDGE</text></g>}
        </g>
        {(step === 7 || paper || aiming) && <g transform={`translate(${player.x - 92} ${player.y - 103})`} aria-label="Example ranger trade bubble">
          <rect width="184" height="56" rx="8" fill="#fff0d6" stroke="#a46437" stroke-width="2" />
          <text x="9" y="15" fill="#71533d" font-size="9" font-weight="900">{paper ? 'PAPER · NO MONEY' : aiming ? (aimDone ? 'PRACTICE COMPLETE' : 'AIMING') : 'WON  +0.19 USD · EXAMPLE'}</text>
          <text x="9" y="30" fill="#4e3826" font-size="9" font-weight="800">{paper ? 'Volatility 50 / OVER 2' : 'Volatility 50 / OVER 2 / 1.00 USD'}</text>
          <text x="9" y="45" fill="#27734a" font-size="9" font-weight="800">{paper ? 'ENTRY 1 → EXIT 5 · EXAMPLE' : '▲ +4% EDGE · QUOTE FRESH'}</text>
          {step === 7 && <g class="guide-svg-highlight" pointer-events="none"><rect x="-4" y="-4" width="192" height="64" rx="10" /><text x="3" y="-10">RANGER BUBBLE</text></g>}
        </g>}
      </svg>
      <div class="guide-game-controls">
        <button type="button" class={`${marketsOpen ? 'is-active ' : ''}${step === 9 ? 'guide-spot' : ''}`} onClick={() => { setMarketsOpen(!marketsOpen); setAutoOpen(false); if (lesson.exercise === 'markets') complete('markets'); }} aria-expanded={marketsOpen}>◎ <span>Markets</span></button>
        <button type="button" class={`${autoOpen ? 'is-active ' : ''}${step === 10 ? 'guide-spot' : ''}`} onClick={() => { setAutoOpen(!autoOpen); setMarketsOpen(false); if (lesson.exercise === 'auto') complete('auto'); }} aria-expanded={autoOpen}>{autoRunning ? '❚❚' : '▶'} <span>{autoRunning ? 'Running' : 'Auto'}</span></button>
      </div>
      {marketsOpen && <aside class={`guide-demo-panel${step === 9 ? ' guide-spot' : ''}`} aria-label="Example markets panel"><div><strong>Markets</strong><button onClick={() => setMarketsOpen(false)} aria-label="Close markets">×</button></div><p>Stake <b>1.00 USD</b> · Style <b>Base</b></p><p>Live targets · recent bets · balance</p><small>Example controls only</small></aside>}
      {autoOpen && <aside class="guide-demo-panel guide-auto-panel" aria-label="Example automation controls"><div><strong>RANGER AUTO</strong><button onClick={() => setAutoOpen(false)} aria-label="Close automation">×</button></div><p>{autoRunning ? 'ACTIVE · Looking for a fresh signal' : 'OFF · Ready to practise'}</p><div class={`guide-demo-settings${step === 11 ? ' guide-spot' : ''}`}><span>Stake <b>1.00</b></span><span>Style <b>Base</b></span><span>Losses <b>2</b></span><span>Cooldown <b>45s</b></span><span>Take profit <b>Off</b></span></div><button class={`guide-demo-start${step === 12 ? ' guide-spot' : ''}`} onClick={() => { setAutoRunning(!autoRunning); if (lesson.exercise === 'start') complete('start'); }}>{autoRunning ? '❚❚  Pause practice' : '▶  Start practice'}</button><small>Simulation only · no trades</small></aside>}
      {step === 8 && <button class="guide-paper-accessible" type="button" onClick={paperShot}>Try paper shot</button>}
      {(autoRunning || step === 13) && <div class={`guide-run-status${step === 13 ? ' guide-spot' : ''}`}><b>Current run P&amp;L · 0.00</b><span>Example automatic trades</span>{step === 13 && <span>Ghost scout · paper only</span>}</div>}
      {step === 14 && <div class="guide-landmarks guide-spot" aria-label="Example pasture tools"><span>🎯 Level &amp; missions</span><span>♡ Connection health</span><span>◆ Gold mine</span><small>Example tools in the pasture</small></div>}
    </div>
    <section class="guide-lesson" key={step} aria-live="polite">
      <div class="guide-progress"><span>LESSON {step + 1} OF {LESSONS.length}</span><div><i style={{ width: `${((step + 1) / LESSONS.length) * 100}%` }} /></div></div>
      <h1>{lesson.title}</h1><p>{lesson.body}</p>{lesson.tip && <p class="guide-tip">{lesson.tip}</p>}
      {lesson.exercise && <span class="guide-exercise">{completed ? '✓ Practice complete' : 'Try it in the pasture'}</span>}
      <div class="guide-navigation">
        <button type="button" onClick={previous} disabled={step === 0}>Back</button>
        {step < LESSONS.length - 1 ? <button type="button" class="guide-next" onClick={next}>{completed ? 'Next' : 'Skip for now'} →</button> : <button type="button" class="guide-next" onClick={onExit}>Enter the pasture →</button>}
      </div>
    </section>
  </section>;
}
