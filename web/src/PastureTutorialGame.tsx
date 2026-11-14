import { useEffect, useRef, useState } from 'preact/hooks';
import type { JSX } from 'preact';

type Lesson = {
  title: string;
  body: string;
  tip?: string;
  links?: Array<{ label: string; href: string }>;
  connect?: boolean;
  exercise?: 'move' | 'cow' | 'aim' | 'paper' | 'markets' | 'auto' | 'start' | 'ghost' | 'brain' | 'chat';
};

const LESSONS: Lesson[] = [
  { title: 'Welcome to the pasture', body: 'Each cow represents a possible digit trade. Let’s learn the controls in a safe practice pasture.', tip: 'Everything here is simulated. No account, live ticks, or money are used.' },
  { title: 'Move your ranger', body: 'Click or tap an open patch of grass to walk there. On a keyboard, use WASD or the arrow keys.', tip: 'On desktop, scroll to zoom. On touchscreens, pinch to zoom.', exercise: 'move' },
  { title: 'Meet the markets', body: 'Each cow shows a market, such as Volatility 50. A market has its own changing stream of prices and final digits.', tip: 'Volatility 50 (1s) and Volatility 50 are different markets. Tap a cow to inspect its example.', exercise: 'cow' },
  { title: 'Read the cow’s bubble', body: 'OVER 2 means the final digit must be greater than 2. UNDER 7 means it must be less than 7. The barrier itself loses.', tip: 'Confidence is an estimate. L and H count recent low digits (0–4) and high digits (5–9).' },
  { title: 'Understand edge', body: 'Edge compares the estimated chance of winning with the chance needed to break even at the estimated payout.', tip: 'Compare the green positive edge with the weaker red negative example. Both are estimates, not promises, and can change.' },
  { title: 'What the rings mean', body: 'Green marks the strongest fresh positive edge. A yellow ring marks the highest confidence-weighted return estimate.', tip: 'A red ring marks a fresh entry signal. A cow can have more than one highlight; none guarantees a win.' },
  { title: 'Aim at a cow', body: 'When signed in, left-click or tap a cow. The ranger moves into position and shoots automatically; the health bar shows progress.', tip: 'As a guest, both click types make paper trades and leave the cow unharmed. When signed in, defeating a cow can submit the selected contract, subject to account and risk checks.', exercise: 'aim' },
  { title: 'Read the ranger’s bubble', body: 'The bubble shows status, market, direction, barrier, stake and style, plus the quote freshness and estimated edge when available.', tip: 'After settlement, the digit and WON or LOST result appear with profit or loss and any remaining session loss. Tap the bubble to dismiss it.' },
  { title: 'Try a paper shot', body: 'As a guest, left-click, right-click or tap a cow to make a paper trade. When signed in, use right-click or press and hold on touch.', tip: 'In the game, a fresh live market tick is needed; the result uses the next tick. Paper trades leave the cow unharmed and use no account money.', exercise: 'paper' },
  { title: 'Set your trade', body: 'Open Markets to choose your stake, bet style, manual shot count, and minimum edge, and see live targets and recent bets.', tip: 'The cow setup and edge are locked on the first fresh shooting tick. The feed must be fresh, and the actual Deriv quote can still change. Recovery styles can increase stakes after losses.', exercise: 'markets' },
  { title: 'Meet Ranger Auto', body: 'Use the play icon to open automation controls. The icon shows pause and “Running” when Auto is active; opening it does not pause trading.', tip: 'Ranger Auto selects eligible highlighted cows after three fresh confirming ticks. Signals can disappear or change.', exercise: 'auto' },
  { title: 'Set limits first', body: 'Choose your stake, bet style and limits. Entry settings also control minimum edge, ring colors, shot counts and optional paper tests.', tip: 'Auto checks three fresh ticks before shooting. Paper-test results are research only and do not change account trades.' },
  { title: 'Start and pause Auto', body: 'Try the start control in this simulation. In the game the same control pauses the running ranger.', tip: 'Real-account automation requires owner authorization and arming. Account, risk, quote and single-open-contract safeguards still apply.', exercise: 'start' },
  { title: 'Follow the run', body: 'While Auto runs, current-run P&L and its latest automatic trades appear in the pasture.', tip: 'The ghost scout and paper results are virtual research. They do not change your Deriv balance or account P&L.' },
  { title: 'Explore the pasture', body: 'Use the level and mission panel to see progress, and the heart icon to check connection health or recover a stuck view.', tip: 'Levels and missions track game progress. Cooldowns give you a break between eligible trades.' },
  { title: 'Meet the ghost scout', body: 'Click or tap the ghost to open its research menu. It follows virtual paper trades and shows its recent wins and losses.', tip: 'The scout menu includes historical replay and deeper research. Paper results do not use account funds.', exercise: 'ghost' },
  { title: 'Watch the scout work', body: 'The scout watches a market signal and fires a ghost arrow at the matching cow. The ghostly cow shows a paper trade; the real cow stays in the pasture.', tip: 'The example opens on one tick and settles on the next. No account order is placed.' },
  { title: 'Read scout research', body: 'The scout menu shows wins, losses, win rate, recent virtual trades and the latest signal details. Historical replay uses past ticks.', tip: 'Auto paper tests, when enabled, show samples for each setup. Research is not a guarantee and does not decide account trades.' },
  { title: 'Where the markets come from', body: 'Deriv is an online broker that offers markets and trading accounts. The pasture’s Volatility markets are algorithm-generated synthetic indices; each cow represents a market and an example contract.', tip: 'Deriv supplies the quotes and executes account trades. Availability depends on your location and account.', links: [{ label: 'Learn about synthetic indices', href: 'https://traders-academy.deriv.com/trading-guides/trade-synthetic-indices-tradingview' }] },
  { title: 'Deriv Over / Under', body: 'On Deriv, Digit Over/Under contracts predict whether the final digit of the contract’s last tick will be above or below your chosen number.', tip: 'For OVER 2, digits 3–9 win; 2 and below lose. For UNDER 7, digits 0–6 win; 7 and above lose. A tie loses. Real-money trades can lose your stake.', links: [{ label: 'Learn about Over / Under', href: 'https://legacy-docs.deriv.com/docs/digit-overunder' }] },
  { title: 'Connect your Deriv account', body: 'Choose Connect Deriv and sign in through Deriv, then return to the pasture and select an authorized account.', tip: 'Check the account label before trading. Demo uses virtual funds; Real uses real money and can lose your stake. Guest paper trades do not place account orders.', links: [{ label: 'Create a Deriv account', href: 'https://home.deriv.com/dashboard/signup' }, { label: 'Visit Deriv', href: 'https://deriv.com/' }], connect: true },
  { title: 'Meet the Ranger Brain', body: 'The Brain reviews paper evidence and can suggest a cow. Try the example Brain button to open its journal.', tip: 'In the pasture, left-click the Brain for a suggestion; right-click it, or press and hold on touch, for the menu. A suggestion is research, not an order or guarantee.', exercise: 'brain' },
  { title: 'See what the Brain remembers', body: 'Memories show recent paper evidence, current lessons, and recorded finding changes with the time each was observed.', tip: 'Short and long windows use recent same-market paper results; the journal records changes from when it was enabled. A device-only fallback is labeled. It does not change account trades.' },
  { title: 'Talk in the pasture', body: 'Chat appears as a simple line and open messages. On a laptop, press Enter to focus it; on mobile, tap the line.', tip: 'Try the example chat below. Your practice message stays in this tutorial and is not sent to other players.', exercise: 'chat' },
  { title: 'Read the header and cooldown', body: 'The header holds navigation and account controls. When a trading cooldown is active, its remaining time appears there.', tip: 'The timer counts down while new entries are paused. Waiting for it does not change a settled result or bypass any risk checks.' },
  { title: 'Review before Ranger Auto', body: 'The risk and reward preview shows the stake, account, recovery style, pause and loss settings before Auto starts.', tip: 'Open Advanced for the loss ladder and evidence. Illustrative figures are estimates; losses may exceed the amount shown before a pause, and real-money trading can lose your stake.' },
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

export function PastureTutorialGame({ onExit, onConnect }: { onExit: () => void; onConnect: () => void }): JSX.Element {
  const [step, setStep] = useState(0);
  const [player, setPlayer] = useState<Point>(START);
  const [done, setDone] = useState<Record<string, boolean>>({});
  const [marketsOpen, setMarketsOpen] = useState(false);
  const [autoOpen, setAutoOpen] = useState(false);
  const [autoRunning, setAutoRunning] = useState(false);
  const [paper, setPaper] = useState(false);
  const [paperSequence, setPaperSequence] = useState(0);
  const [paperSettled, setPaperSettled] = useState(false);
  const [aiming, setAiming] = useState(false);
  const [aimDone, setAimDone] = useState(false);
  const [hits, setHits] = useState(0);
  const [shotSequence, setShotSequence] = useState(0);
  const [autoSequence, setAutoSequence] = useState(0);
  const [autoPhase, setAutoPhase] = useState<'idle' | 'moving' | 'aiming' | 'result'>('idle');
  const [autoTarget, setAutoTarget] = useState(0);
  const [autoCompleted, setAutoCompleted] = useState(0);
  const [selected, setSelected] = useState(false);
  const [ghostOpen, setGhostOpen] = useState(false);
  const [brainDemoOpen, setBrainDemoOpen] = useState(false);
  const [brainDemoView, setBrainDemoView] = useState<'suggestion' | 'journal'>('suggestion');
  const [chatDraft, setChatDraft] = useState('');
  const [chatExample, setChatExample] = useState('');
  const [ghostPhase, setGhostPhase] = useState<'watching' | 'shooting' | 'settled'>('watching');
  const advanceTimer = useRef<number | null>(null);
  const [compact, setCompact] = useState(() => window.matchMedia('(max-width: 600px)').matches);
  const [reducedMotion, setReducedMotion] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const pressTimer = useRef<number | null>(null);
  const brainPressTimer = useRef<number | null>(null);
  const brainHoldHandled = useRef(false);
  const suppressClick = useRef(false);
  const lesson = LESSONS[step];
  const cow = compact ? { x: 585, y: 295 } : { x: 670, y: 295 };
  const secondCow = compact ? { x: 320, y: 235 } : { x: 250, y: 235 };
  const completed = !lesson.exercise || !!done[lesson.exercise];

  useEffect(() => () => {
    if (pressTimer.current !== null) window.clearTimeout(pressTimer.current);
    if (brainPressTimer.current !== null) window.clearTimeout(brainPressTimer.current);
    if (advanceTimer.current !== null) window.clearTimeout(advanceTimer.current);
  }, []);
  useEffect(() => {
    const media = window.matchMedia('(max-width: 600px)');
    const update = (): void => setCompact(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = (): void => setReducedMotion(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  useEffect(() => {
    if (advanceTimer.current !== null) { window.clearTimeout(advanceTimer.current); advanceTimer.current = null; }
    if (lesson.exercise !== 'brain') setBrainDemoOpen(false);
    if (lesson.exercise !== 'chat') { setChatDraft(''); setChatExample(''); }
    if (step !== 15 && step !== 17) setGhostOpen(false);
    if (step >= 14) setAutoRunning(false);
    if (step !== 8) { setPaper(false); setPaperSettled(false); }
    if (step !== 6 && step !== 7) { setAiming(false); setAimDone(false); setHits(0); }
    if (step === 11 || step === 12) { setMarketsOpen(false); setAutoOpen(true); }
    if (step === 13 || step === 14) { setMarketsOpen(false); setAutoOpen(false); }
  }, [step]);
  useEffect(() => {
    if (step !== 16) { setGhostPhase('watching'); return; }
    setGhostPhase('watching');
    const timers = [window.setTimeout(() => setGhostPhase('shooting'), 650), window.setTimeout(() => setGhostPhase('settled'), 2000)];
    return () => timers.forEach(window.clearTimeout);
  }, [step]);
  useEffect(() => {
    if (!aiming) return;
    const timers = [1, 2, 3].map((hit) => window.setTimeout(() => setHits(hit), 450 + hit * 500));
    timers.push(window.setTimeout(() => setAimDone(true), 2200));
    return () => timers.forEach(window.clearTimeout);
  }, [aiming, shotSequence]);
  useEffect(() => {
    if (!paper || paperSequence === 0) return;
    const timer = window.setTimeout(() => setPaperSettled(true), 1100);
    return () => window.clearTimeout(timer);
  }, [paper, paperSequence]);
  useEffect(() => {
    if (!autoRunning || !autoSequence) { setAutoPhase('idle'); return; }
    setAutoPhase('moving');
    setAutoTarget(0); setAutoCompleted(0);
    setHits(0);
    setPlayer({ x: cow.x - 135, y: cow.y + 85 });
    const timers = [
      window.setTimeout(() => setAutoPhase('aiming'), 650),
      ...[1, 2, 3].map((hit) => window.setTimeout(() => setHits(hit), 650 + hit * 500)),
      window.setTimeout(() => { setAutoPhase('result'); setAutoCompleted(1); }, 2400),
      window.setTimeout(() => { setAutoTarget(1); setHits(0); setAutoPhase('moving'); setPlayer({ x: secondCow.x + 135, y: secondCow.y + 85 }); }, 3000),
      window.setTimeout(() => setAutoPhase('aiming'), 3650),
      ...[1, 2, 3].map((hit) => window.setTimeout(() => setHits(hit), 3650 + hit * 500)),
      window.setTimeout(() => { setAutoPhase('result'); setAutoCompleted(2); }, 5400),
    ];
    return () => timers.forEach(window.clearTimeout);
  }, [autoRunning, autoSequence]);

  const complete = (exercise: NonNullable<Lesson['exercise']>): void => {
    if (lesson.exercise !== exercise || advanceTimer.current !== null) return;
    setDone((previous) => ({ ...previous, [exercise]: true }));
    const delay = exercise === 'aim' ? 2600 : exercise === 'paper' ? 1900 : exercise === 'start' ? 5900 : exercise === 'ghost' ? 1800 : exercise === 'brain' ? 3500 : exercise === 'chat' ? 2200 : 700;
    const currentStep = step;
    advanceTimer.current = window.setTimeout(() => {
      advanceTimer.current = null;
      setStep((value) => value === currentStep ? Math.min(LESSONS.length - 1, value + 1) : value);
    }, reducedMotion && !['start', 'brain', 'chat'].includes(exercise) ? Math.min(delay, 900) : delay);
  };
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
    if (lesson.exercise === 'paper') { paperShot(); return; }
    setSelected(true);
    if (lesson.exercise === 'cow') complete('cow');
    if (lesson.exercise === 'aim') {
      setAimDone(false); setHits(0); setPlayer({ x: cow.x - 135, y: cow.y + 85 }); setAiming(true); setShotSequence((value) => value + 1); complete('aim');
    }
  };
  const paperShot = (): void => {
    if (lesson.exercise !== 'paper') return;
    setPaper(true); setPaperSettled(false); setPaperSequence((value) => value + 1);
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
  useEffect(() => {
    const handleKey = (event: KeyboardEvent): void => {
      if (event.defaultPrevented || /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test((event.target as Element | null)?.tagName ?? '')) return;
      onKey(event);
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [step, player.x, player.y, compact, reducedMotion]);
  const startLongPress = (event: PointerEvent): void => {
    if (event.pointerType !== 'touch' || lesson.exercise !== 'paper') return;
    pressTimer.current = window.setTimeout(() => { suppressClick.current = true; paperShot(); pressTimer.current = null; }, 650);
  };
  const cancelLongPress = (): void => {
    if (pressTimer.current !== null) window.clearTimeout(pressTimer.current);
    pressTimer.current = null;
  };
  const shooting = (aiming && !aimDone) || (autoRunning && autoPhase === 'aiming');
  const shotTarget = autoRunning && autoTarget === 1 ? secondCow : cow;
  const arrowPath = `M${player.x + 15} ${player.y - 8} L${shotTarget.x} ${shotTarget.y}`;
  const ghostPoint = compact ? { x: 430, y: 275 } : { x: 455, y: 275 };
  const ghostArrowPath = `M${ghostPoint.x + 15} ${ghostPoint.y - 8} L${cow.x} ${cow.y}`;

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
        {step === 5 && <ellipse cx={cow.x} cy={cow.y + 20} rx="65" ry="31" fill="none" stroke="#ff4057" stroke-width="4" />}
        {!(autoRunning && autoTarget === 1 && autoPhase === 'result') && <g key={`second-${hits}-${autoPhase}`} class={autoRunning && autoTarget === 1 && hits > 0 ? 'guide-cow-impact' : ''}><Cow point={secondCow} highlight={autoRunning && autoTarget === 1} /></g>}
        {!(autoRunning && autoCompleted >= 1) && <g key={`hit-${hits}-${autoPhase}`} class={hits > 0 && !aimDone && (!autoRunning || autoTarget === 0) || autoRunning && autoTarget === 0 && autoPhase === 'result' ? 'guide-cow-impact' : ''}><Cow point={cow} highlight /></g>}
        {[2, 5, 6, 8].includes(step) && <g class="guide-svg-highlight" pointer-events="none">
          <ellipse cx={cow.x} cy={cow.y + 4} rx={step === 5 ? 72 : 66} ry={step === 5 ? 43 : 52} />
          <text x={cow.x - 46} y={cow.y + 67}>{step === 5 ? 'RINGS' : step === 8 ? 'PAPER TARGET' : 'COW'}</text>
        </g>}
        {step === 6 && !aiming && <g pointer-events="none"><rect x={cow.x - 25} y={cow.y - 48} width="50" height="5" fill="#382c27" /><rect x={cow.x - 24} y={cow.y - 47} width="48" height="3" fill="#76cb78" /></g>}
        {shooting && <g pointer-events="none" key={`shoot-${shotSequence}-${autoSequence}`}>
          <path class="guide-aim-line" d={arrowPath} stroke="#f4d17f" stroke-width="2" stroke-dasharray="8 5" />
          <rect x={shotTarget.x - 25} y={shotTarget.y - 48} width="50" height="5" fill="#382c27" /><rect x={shotTarget.x - 24} y={shotTarget.y - 47} width={48 * (3 - hits) / 3} height="3" fill="#76cb78" />
          {!reducedMotion && <g class="guide-arrow-flight" style={{ offsetPath: `path("${arrowPath}")` }}><path d="M-12 0H7M2-4 8 0 2 4" fill="none" stroke="#fff4cf" stroke-width="3" stroke-linecap="round" /></g>}
        </g>}
        {paper && <g key={paperSequence} class="guide-paper-ghost" pointer-events="none">
          <path class="guide-paper-line" d={arrowPath} pathLength="1" stroke="#f4d17f" stroke-width="3" />
          <g transform={`translate(${cow.x} ${cow.y})`}><g class="guide-paper-cow"><Cow point={{ x: 0, y: 0 }} /></g></g>
        </g>}
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
        <g class="guide-weak-card" transform={`translate(${Math.max(compact ? 255 : 0, secondCow.x - 85)} 118)`} aria-label={autoRunning ? 'Second example signal: Volatility 10, positive edge' : 'Weaker example: Volatility 10, 51 percent confidence and negative 4 percent edge'}>
          <rect width="170" height="61" rx="8" fill="#10271e" stroke="#b47d70" stroke-width="1" />
          <text x="9" y="15" fill="#fff4cf" font-size="10" font-weight="800">Volatility 10</text>
          <text x="9" y="31" fill="#f3c5b6" font-size="10" font-weight="900">↓ UNDER 7</text>
          <text x="105" y="31" fill="#e9efe3" font-size="8" font-weight="800">{autoRunning ? '74% CONF' : '51% CONF'}</text>
          <rect x="8" y="38" width="68" height="16" rx="4" fill={autoRunning ? '#165331' : '#742d35'} />
          <text x="12" y="50" fill={autoRunning ? '#8cf0a7' : '#ffb9b0'} font-size="9" font-weight="900">{autoRunning ? '▲ +3% EDGE' : '▼ -4% EDGE'}</text>
          <text x="96" y="50" fill="#e8eddf" font-size="8" font-weight="800">EXAMPLE</text>
          {step === 4 && <g class="guide-svg-highlight" pointer-events="none"><rect x="5" y="35" width="74" height="22" rx="5" /><text x="5" y="-7">WEAKER EDGE</text></g>}
        </g>
        {(step === 7 || aiming || autoRunning) && <g transform={`translate(${player.x - 92} ${player.y - 103})`} aria-label="Example ranger trade bubble">
          <rect width="184" height="56" rx="8" fill="#fff0d6" stroke="#a46437" stroke-width="2" />
          <text x="9" y="15" fill="#71533d" font-size="9" font-weight="900">{paper ? (paperSettled ? 'PAPER WON · EXAMPLE' : 'PAPER OPEN · NO MONEY') : aiming ? (aimDone ? 'PRACTICE COMPLETE' : 'AIMING') : autoRunning ? (autoPhase === 'result' ? 'AUTO WON · EXAMPLE' : 'AUTO · EXAMPLE') : 'WON  +0.19 USD · EXAMPLE'}</text>
          <text x="9" y="30" fill="#4e3826" font-size="9" font-weight="800">{paper ? 'Volatility 50 / OVER 2' : 'Volatility 50 / OVER 2 / 1.00 USD'}</text>
          <text x="9" y="45" fill="#27734a" font-size="9" font-weight="800">{paper ? (paperSettled ? 'ENTRY 1 → EXIT 5 · EXAMPLE' : 'ENTRY 1 · WAITING FOR NEXT TICK') : '▲ +4% EDGE · QUOTE FRESH'}</text>
          {step === 7 && <g class="guide-svg-highlight" pointer-events="none"><rect x="-4" y="-4" width="192" height="64" rx="10" /><text x="3" y="-10">RANGER BUBBLE</text></g>}
        </g>}
        {paper && <g transform={`translate(${player.x} ${player.y - 56})`} aria-label={paperSettled ? 'Example paper win' : 'Example paper trade waiting'} pointer-events="none"><path d={paperSettled ? 'M-9 0l6 6L10-8' : 'M-5-9H5M-5 9H5M-4-8Q-4-3 0 0Q4-3 4-8M-4 8Q-4 3 0 0Q4 3 4 8'} fill="none" stroke={paperSettled ? '#95ffc0' : '#ffe19a'} stroke-width="3" stroke-linecap="round" stroke-linejoin="round" /></g>}
        {step === 16 && ghostPhase !== 'watching' && <g key="ghost-shot-demo" class="guide-paper-ghost" pointer-events="none"><path class="guide-paper-line" d={ghostArrowPath} pathLength="1" stroke="#f4d17f" stroke-width="3" /><g transform={`translate(${cow.x} ${cow.y})`}><g class="guide-paper-cow"><Cow point={{ x: 0, y: 0 }} /></g></g></g>}
        {[15, 16, 17].includes(step) && <g class="guide-ghost-target" role="button" tabIndex={0} aria-label="Open ghost scout research" onClick={(event) => { event.stopPropagation(); setGhostOpen(true); complete('ghost'); }} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); setGhostOpen(true); complete('ghost'); } }} transform={`translate(${ghostPoint.x} ${ghostPoint.y})`}>
          <ellipse cx="0" cy="38" rx="26" ry="9" fill="none" stroke="#c8ffd5" stroke-width="3" />
          <path d="M-13-8Q-18 7-12 22Q-15 32-7 35Q-2 29 3 35Q8 29 14 35Q19 29 13 20Q16 7 12-8Z" fill="#c6e9bd" stroke="#769f82" stroke-width="2" />
          <circle cx="0" cy="-20" r="11" fill="#e4f4d5" /><circle cx="3" cy="-20" r="1.5" fill="#315747" /><circle cx="8" cy="-20" r="1.5" fill="#315747" />
          <path d="M15-24Q39-5 15 14M15-24V14" fill="none" stroke="#e9d9a7" stroke-width="3" />
          {step === 15 && <g class="guide-svg-highlight" pointer-events="none"><ellipse cx="0" cy="0" rx="43" ry="52" /><text x="-36" y="-60">GHOST SCOUT</text></g>}
        </g>}
      </svg>
      {paper && <div class="guide-paper-toast" role="status"><strong>{paperSettled ? 'PAPER WIN' : 'PAPER TRADE OPEN'}</strong><span>Volatility 50 (1s) · OVER 2</span><small>{paperSettled ? 'Entry 1 → exit 5' : 'Entry 1 · waiting for next tick'} · No money used</small></div>}
      {(ghostOpen && step === 15 || step === 17) && <aside class={`guide-demo-panel guide-ghost-panel${step === 17 ? ' guide-spot' : ''}`} aria-label="Example ghost scout research"><div><strong>GHOST SCOUT</strong></div><p><b>7 wins / 3 losses · 70% win rate</b></p><p>Recent: Volatility 50 · OVER 2 · WON</p><p>Signal details · Historical replay · Paper test samples</p><small>Example only · virtual results; no account funds used</small></aside>}
      {step === 16 && <div class="guide-ghost-status" role="status">{ghostPhase === 'watching' ? 'Scout watching an example signal' : ghostPhase === 'shooting' ? 'Paper shot · real cow stays' : 'Example paper result · WON · no money used'}</div>}
      <div class="guide-game-controls">
        <button type="button" class={`${marketsOpen ? 'is-active ' : ''}${step === 9 ? 'guide-spot' : ''}`} onClick={() => { setMarketsOpen(!marketsOpen); setAutoOpen(false); if (lesson.exercise === 'markets' && !marketsOpen) complete('markets'); }} aria-expanded={marketsOpen}>◎ <span>Markets</span></button>
        <button type="button" class={`${autoOpen ? 'is-active ' : ''}${step === 10 ? 'guide-spot' : ''}`} onClick={() => { setAutoOpen(!autoOpen); setMarketsOpen(false); if (lesson.exercise === 'auto' && !autoOpen) complete('auto'); }} aria-expanded={autoOpen}>{autoRunning ? '❚❚' : '▶'} <span>{autoRunning ? 'Running' : 'Auto'}</span></button>
        {lesson.exercise === 'brain' && <><button type="button" class="guide-spot" aria-expanded={brainDemoOpen} aria-label="Example Brain: click or tap for a suggestion; right-click or hold for the journal" onClick={() => { if (brainHoldHandled.current) { brainHoldHandled.current = false; return; } setBrainDemoView('suggestion'); setBrainDemoOpen(true); }} onContextMenu={(event) => { event.preventDefault(); setBrainDemoView('journal'); setBrainDemoOpen(true); complete('brain'); }} onPointerDown={(event) => { if (event.pointerType !== 'touch') return; brainHoldHandled.current = false; brainPressTimer.current = window.setTimeout(() => { brainPressTimer.current = null; brainHoldHandled.current = true; setBrainDemoView('journal'); setBrainDemoOpen(true); complete('brain'); }, 550); }} onPointerUp={() => { if (brainPressTimer.current !== null) { window.clearTimeout(brainPressTimer.current); brainPressTimer.current = null; } }} onPointerCancel={() => { if (brainPressTimer.current !== null) { window.clearTimeout(brainPressTimer.current); brainPressTimer.current = null; } }}><img src="/brain-brand.svg" width="28" height="28" alt="" /><span>Brain</span></button><button type="button" aria-label="Open example Brain journal" onClick={() => { setBrainDemoView('journal'); setBrainDemoOpen(true); complete('brain'); }}>☰ <span>Journal</span></button></>}
      </div>
      {[18, 19, 20].includes(step) && <aside class="guide-demo-panel guide-deriv-example" aria-label="Illustrated Deriv example"><div><strong>{step === 20 ? 'CONNECT · EXAMPLE' : step === 19 ? 'DIGIT CONTRACT · EXAMPLE' : 'DERIV · EXAMPLE'}</strong></div><svg viewBox="0 0 240 112" role="img" aria-label={step === 19 ? 'Example Over 2: digit 5 is above 2' : step === 20 ? 'Illustrated demo and real account choices' : 'A Deriv market represented by a pasture cow'}><rect x="2" y="3" width="236" height="106" rx="10" fill="#dceccc"/><path d="M0 80Q60 61 120 78T240 74V112H0Z" fill="#8cbe80"/><g transform="translate(38 15)"><path d="M0 0h18c4 0 7 2 10 5l8 11-8 11c-3 3-6 5-10 5H0l17-16Z" fill="#e9434f"/><text x="42" y="22" fill="#274b32" font-size="13" font-weight="900">Deriv</text></g>{step === 19 ? <g><text x="22" y="65" fill="#244d33" font-size="11" font-weight="800">OVER 2</text><text x="22" y="88" fill="#244d33" font-size="17" font-weight="900">5 &gt; 2</text><text x="122" y="90" fill="#395342" font-size="9" font-weight="700">EXAMPLE</text></g> : step === 20 ? <g><rect x="20" y="60" width="74" height="28" rx="6" fill="#236d46"/><text x="35" y="78" fill="#fff7df" font-size="10" font-weight="800">DEMO</text><rect x="100" y="60" width="74" height="28" rx="6" fill="#f5e4c7" stroke="#a66b42"/><text x="115" y="78" fill="#563b25" font-size="10" font-weight="800">REAL</text><Ranger point={{ x: 205, y: 74 }} /></g> : <g transform="translate(177 68) scale(.57)"><Cow point={{ x: 0, y: 0 }} highlight /></g>}</svg><small>Illustration only · no quote or order.</small></aside>}
      {brainDemoOpen && lesson.exercise === 'brain' && <aside class="guide-demo-panel guide-brain-example" aria-label={brainDemoView === 'journal' ? 'Example Ranger Brain journal' : 'Example Brain suggestion'}><div><strong>{brainDemoView === 'journal' ? 'RANGER BRAIN · JOURNAL' : 'BRAIN · EXAMPLE SUGGESTION'}</strong><button type="button" aria-label="Close example Brain" onClick={() => setBrainDemoOpen(false)}>×</button></div><img src="/brain-pasture-scene.svg" alt="" class="guide-brain-scene" />{brainDemoView === 'journal' ? <><p><b>My Brain · Lessons · Memories</b></p><p>Paper evidence and recorded plays, when available.</p></> : <><p><b>Volatility 50 · OVER 2</b></p><p>Illustrative suggestion, not an order.</p><button type="button" class="guide-brain-journal-link" onClick={() => { setBrainDemoView('journal'); complete('brain'); }}>Open example journal</button></>}<small>Click or tap Brain to suggest · right-click or hold to open the journal. Example only; no order.</small></aside>}
      {lesson.exercise === 'chat' && <aside class="guide-demo-panel" aria-label="Example pasture chat"><div><strong>PASTURE CHAT · EXAMPLE</strong></div>{chatExample && <p role="status"><b>Ranger:</b> {chatExample}</p>}<form onSubmit={(event) => { event.preventDefault(); const value = chatDraft.trim(); if (value) { setChatExample(value); setChatDraft(''); complete('chat'); } }}><label for="guide-chat-input">Practice message</label><input id="guide-chat-input" value={chatDraft} maxLength={80} placeholder="Type and press Enter" onInput={(event) => setChatDraft(event.currentTarget.value)} style={{ display: 'block', width: '100%', boxSizing: 'border-box', marginTop: '5px', padding: '7px', font: 'inherit' }} /><button type="submit">Send example</button></form><small>Example stays here · no message is sent.</small></aside>}
      {step === 24 && <aside class="guide-demo-panel" aria-label="Example header cooldown"><div><strong>HEADER · EXAMPLE</strong></div><p><b>COOLDOWN 0:45</b></p><small>Example timer only · counts down during a real cooldown.</small></aside>}
      {step === 25 && <aside class="guide-demo-panel" aria-label="Example risk preview"><div><strong>RISK &amp; REWARD · EXAMPLE</strong></div><p>Stake <b>1.00 USD</b> · Pause after <b>2 losses</b></p><p>Maximum run loss <b>Not set</b></p><small>Example settings only · no trade or guarantee.</small></aside>}
      {marketsOpen && <aside class={`guide-demo-panel${step === 9 ? ' guide-spot' : ''}`} aria-label="Example markets panel"><div><strong>Markets</strong><button onClick={() => setMarketsOpen(false)} aria-label="Close markets">×</button></div><p>Stake <b>1.00 USD</b> · Style <b>Base</b></p><p>Live targets · recent bets · balance</p><small>Example controls only</small></aside>}
      {autoOpen && <aside class="guide-demo-panel guide-auto-panel" aria-label="Example automation controls"><div><strong>RANGER AUTO</strong><button onClick={() => setAutoOpen(false)} aria-label="Close automation">×</button></div><p>{autoRunning ? 'ACTIVE · Looking for a fresh signal' : 'OFF · Ready to practise'}</p><div class={`guide-demo-settings${step === 11 ? ' guide-spot' : ''}`}><span>Stake <b>1.00</b></span><span>Style <b>Base</b></span><span>Losses <b>2</b></span><span>Cooldown <b>45s</b></span><span>Take profit <b>Off</b></span></div><button class={`guide-demo-start${step === 12 ? ' guide-spot' : ''}`} onClick={() => { if (!autoRunning) { setAutoSequence((value) => value + 1); setAutoOpen(false); } setAutoRunning(!autoRunning); if (lesson.exercise === 'start' && !autoRunning) complete('start'); }}>{autoRunning ? '❚❚  Pause practice' : '▶  Start practice'}</button><small>Simulation only · no trades</small></aside>}
      {step === 8 && <button class="guide-paper-accessible" type="button" onClick={paperShot}>Try paper shot</button>}
      {(autoRunning || step === 13) && <div class={`guide-run-status${step === 13 || (step === 12 && autoRunning && !autoOpen) ? ' guide-spot' : ''}`}><b>Current run P&amp;L · {autoCompleted === 2 ? '+0.38' : autoCompleted === 1 ? '+0.19' : '0.00'} EXAMPLE</b><span>{autoRunning && autoPhase === 'moving' ? `Moving to cow ${autoTarget + 1}` : autoRunning && autoPhase === 'aiming' ? `Shooting cow ${autoTarget + 1}` : autoRunning && autoPhase === 'result' ? `Example trade ${autoCompleted} · WON +0.19` : 'Example automatic trades'}</span>{step === 13 && <span>Ghost scout · paper only</span>}</div>}
      {step === 14 && <div class="guide-landmarks guide-spot" aria-label="Example pasture tools"><span>🏅 Level &amp; missions</span><span>♡ Connection health</span><span>Ghost scout research</span><small>Example tools in the pasture</small></div>}
    </div>
    <section class="guide-lesson" key={step} aria-live="polite">
      <div class="guide-progress"><span>LESSON {step + 1} OF {LESSONS.length}</span><div><i style={{ width: `${((step + 1) / LESSONS.length) * 100}%` }} /></div></div>
      <h1 style={{ display: 'flex', alignItems: 'center', gap: '8px' }}><img src={/brain|remember/i.test(lesson.title) ? '/brain-brand.svg' : /cow|market|over|under/i.test(lesson.title) ? '/brain-pasture-scene.svg' : '/brain-ranger.svg'} width="36" height="32" alt="" style={{ flex: '0 0 36px', objectFit: 'contain' }} /><span>{lesson.title}</span></h1><p>{lesson.body}</p>{lesson.tip && <p class="guide-tip">{lesson.tip}</p>}
      {(lesson.links || lesson.connect) && <div class="guide-links">{lesson.links?.map((link) => <a href={link.href} target="_blank" rel="noopener noreferrer" key={link.href}>{link.label} ↗</a>)}{lesson.connect && <button type="button" onClick={onConnect}>Connect Deriv in the pasture</button>}</div>}
      {lesson.exercise && <span class="guide-exercise">{completed ? '✓ Practice complete - continuing' : 'Try it in the pasture'}</span>}
      <div class="guide-navigation">
        <button type="button" onClick={previous} disabled={step === 0}>Back</button>
        {step < LESSONS.length - 1 ? <button type="button" class="guide-next" onClick={next}>{completed ? 'Next' : 'Skip for now'} →</button> : <button type="button" class="guide-next" onClick={onExit}>Enter the pasture →</button>}
      </div>
    </section>
  </section>;
}
