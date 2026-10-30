import { useEffect, useRef, useState } from 'preact/hooks';
import type { JSX } from 'preact';

type TutorialPhase = 'choose' | 'move' | 'aim' | 'shoot' | 'settling' | 'complete';

interface Point {
  x: number;
  y: number;
}

interface GrassBlade extends Point {
  height: number;
}

interface TutorialWorld {
  width: number;
  scale: number;
}

interface TutorialMarket {
  symbol: string;
  name: string;
  direction: 'OVER' | 'UNDER';
  barrier: number;
  baseQuote: number;
  payoutMultiplier: number;
}

interface MarketTick {
  quote: number;
  digit: number;
  change: number;
}

interface PracticeTrade {
  won: boolean;
  market: string;
  contract: string;
  digit: number;
  stake: number;
  payout: number;
  profit: number;
}

interface Arrow extends Point {
  startX: number;
  startY: number;
  progress: number;
  hit: boolean;
}

const WIDTH = 960;
const HEIGHT = 520;
const START: Point = { x: 220 / WIDTH, y: 335 };
const COW_HEALTH = 3;
const PRACTICE_STAKE = 1;
const STARTING_BALANCE = 100;
const TUTORIAL_COWS = [
  { point: { x: .34, y: 320 }, marketIndex: 0, rank: 2, confidence: 54 },
  { point: { x: .77, y: 320 }, marketIndex: 3, rank: 1, confidence: 78 },
] as const;
const TUTORIAL_MARKETS: TutorialMarket[] = [
  { symbol: 'R_10', name: 'Volatility 10', direction: 'OVER', barrier: 1, baseQuote: 100.12, payoutMultiplier: 1.22 },
  { symbol: 'R_25', name: 'Volatility 25', direction: 'UNDER', barrier: 8, baseQuote: 250.34, payoutMultiplier: 1.25 },
  { symbol: 'R_50', name: 'Volatility 50', direction: 'OVER', barrier: 2, baseQuote: 500.56, payoutMultiplier: 1.32 },
  { symbol: 'R_75', name: 'Volatility 75', direction: 'UNDER', barrier: 7, baseQuote: 750.78, payoutMultiplier: 1.38 },
];

const getLastDigit = (quote: number): number =>
  Number(quote.toFixed(2).replace('.', '').slice(-1));

const createInitialMarketTicks = (): MarketTick[] => TUTORIAL_MARKETS.map((market) => ({
  quote: market.baseQuote,
  digit: getLastDigit(market.baseQuote),
  change: 0,
}));

const pointForCow = (cowIndex: number, worldWidth: number): Point | null => {
  const cow = TUTORIAL_COWS[cowIndex];
  if (!cow) return null;
  if (worldWidth < 500) {
    return { x: worldWidth / 2, y: cowIndex === 0 ? 245 : 390 };
  }
  return { x: cow.point.x * worldWidth, y: cow.point.y };
};

const startForWorld = (worldWidth: number): Point => worldWidth < 500
  ? { x: worldWidth / 2, y: 455 }
  : { x: START.x * worldWidth, y: START.y };

export function PastureTutorialGame({ onExit }: { onExit: () => void }): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const speechBubbleRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<TutorialWorld>({ width: WIDTH, scale: 1 });
  const phaseRef = useRef<TutorialPhase>('choose');
  const playerRef = useRef<Point>({ x: START.x * WIDTH, y: START.y });
  const moveGoalRef = useRef<Point | null>(null);
  const arrowsRef = useRef<Arrow[]>([]);
  const selectedCowRef = useRef<number | null>(null);
  const hpRef = useRef(COW_HEALTH);
  const lastShotRef = useRef(0);
  const selectedMarketRef = useRef(0);
  const roundRef = useRef(0);
  const marketTicksRef = useRef(createInitialMarketTicks());
  const speechRef = useRef('Choose rank #1.');
  const [phase, setPhase] = useState<TutorialPhase>('choose');
  const [worldWidth, setWorldWidth] = useState(WIDTH);
  const [marketTicks, setMarketTicks] = useState(marketTicksRef.current);
  const [demoBalance, setDemoBalance] = useState(STARTING_BALANCE);
  const [netProfit, setNetProfit] = useState(0);
  const [lastTrade, setLastTrade] = useState<PracticeTrade | null>(null);
  const [speech, setSpeech] = useState('Choose rank #1.');

  const changePhase = (next: TutorialPhase): void => {
    phaseRef.current = next;
    setPhase(next);
  };

  const speak = (message: string): void => {
    speechRef.current = message;
    setSpeech(message);
  };

  const reset = (): void => {
    playerRef.current = startForWorld(worldRef.current.width);
    moveGoalRef.current = null;
    arrowsRef.current = [];
    selectedCowRef.current = null;
    hpRef.current = COW_HEALTH;
    lastShotRef.current = 0;
    roundRef.current += 1;
    setLastTrade(null);
    selectedMarketRef.current = 0;
    selectedCowRef.current = null;
    speak('Choose the rank #1 cow.');
    changePhase('choose');
  };

  const selectMarket = (marketIndex: number): void => {
    if (!TUTORIAL_MARKETS[marketIndex]) return;
    selectedMarketRef.current = marketIndex;
  };

  const chooseCow = (cowIndex: number): void => {
    if (phaseRef.current !== 'choose') return;
    const cow = TUTORIAL_COWS[cowIndex];
    if (!cow) return;
    if (cow.rank !== 1) {
      speak('Rank #2 is lower. Choose rank #1.');
      return;
    }
    selectedCowRef.current = cowIndex;
    selectMarket(cow.marketIndex);
    speak('Step 2 · Tap the grass inside the marked range.');
    changePhase('move');
    canvasRef.current?.focus();
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return;

    let raf = 0;
    let previousAt = performance.now();
    let lastDamageAt = 0;
    let tickPhase = 0;
    const marketTimer = window.setInterval(() => {
      tickPhase += 1;
      const nextTicks = TUTORIAL_MARKETS.map((market, index) => {
        const previous = marketTicksRef.current[index];
        const wave = Math.sin(tickPhase * .91 + index * 1.7) * .17
          + Math.cos(tickPhase * .37 + index) * .08;
        const quote = Number((market.baseQuote + wave).toFixed(2));
        return {
          quote,
          digit: getLastDigit(quote),
          change: Number((quote - previous.quote).toFixed(2)),
        };
      });
      marketTicksRef.current = nextTicks;
      setMarketTicks(nextTicks);
    }, 900);
    let grass: GrassBlade[] = [];
    const makeGrass = (worldWidth: number): GrassBlade[] => Array.from({ length: 76 }, (_, index) => ({
      x: (index * 157 + 39) % worldWidth,
      y: (index * 83 + 47) % HEIGHT,
      height: 5 + (index % 4),
    }));
    const resizeCanvas = (): void => {
      const bounds = canvas.getBoundingClientRect();
      if (bounds.width === 0 || bounds.height === 0) return;
      const scale = bounds.height / HEIGHT;
      const width = bounds.width / scale;
      const previousWidth = worldRef.current.width;
      const widthRatio = width / previousWidth;
      if (phaseRef.current === 'choose' && selectedCowRef.current === null) {
        playerRef.current = startForWorld(width);
      } else {
        playerRef.current.x *= widthRatio;
        if (moveGoalRef.current) moveGoalRef.current.x *= widthRatio;
        for (const arrow of arrowsRef.current) {
          arrow.x *= widthRatio;
          arrow.startX *= widthRatio;
        }
      }
      worldRef.current = { width, scale };
      setWorldWidth(width);
      const pixelRatio = window.devicePixelRatio || 1;
      const backingWidth = Math.round(bounds.width * pixelRatio);
      const backingHeight = Math.round(bounds.height * pixelRatio);
      if (canvas.width !== backingWidth || canvas.height !== backingHeight) {
        canvas.width = backingWidth;
        canvas.height = backingHeight;
      }
      context.setTransform(pixelRatio * scale, 0, 0, pixelRatio * scale, 0, 0);
      grass = makeGrass(width);
    };
    const resizeObserver = new ResizeObserver(resizeCanvas);
    resizeObserver.observe(canvas);
    resizeCanvas();

    const pointFromEvent = (event: PointerEvent): Point => {
      const bounds = canvas.getBoundingClientRect();
      const worldWidth = worldRef.current.width;
      return {
        x: ((event.clientX - bounds.left) / bounds.width) * worldWidth,
        y: ((event.clientY - bounds.top) / bounds.height) * HEIGHT,
      };
    };

    const onPointerDown = (event: PointerEvent): void => {
      const point = pointFromEvent(event);
      const currentPhase = phaseRef.current;

      if (currentPhase === 'choose') {
        const cowIndex = TUTORIAL_COWS.findIndex((cow, index) => {
          const target = pointForCow(index, worldRef.current.width);
          return target !== null && Math.hypot(point.x - target.x, point.y - target.y) < 82;
        });
        if (cowIndex !== -1) chooseCow(cowIndex);
        canvas.focus();
        return;
      }

      if (currentPhase === 'move') {
        const target = selectedCowRef.current === null ? null : pointForCow(selectedCowRef.current, worldRef.current.width);
        const moveRange = worldRef.current.width * (250 / WIDTH);
        if (!target || Math.hypot(point.x - target.x, point.y - target.y) > moveRange) {
          speak('Tap inside the circle around the rank #1 cow.');
          return;
        }
            const destination = {
              x: Math.max(50, Math.min(worldRef.current.width - 50, point.x)),
              y: Math.max(100, Math.min(HEIGHT - 55, point.y)),
            };
            const selectedCowIndex = selectedCowRef.current;
            const selectedCowPoint = selectedCowIndex === null ? null : pointForCow(selectedCowIndex, worldRef.current.width);
            if (selectedCowPoint && Math.hypot(destination.x - selectedCowPoint.x, destination.y - selectedCowPoint.y) < worldRef.current.width * (74 / WIDTH)) {
          speak('Choose a clear spot near the cow.');
          return;
        }
        moveGoalRef.current = destination;
        speak('Moving to the marked spot.');
        canvas.focus();
        return;
      }

      const selectedCowPoint = selectedCowRef.current === null ? null : pointForCow(selectedCowRef.current, worldRef.current.width);
      if (currentPhase === 'aim' && selectedCowPoint && Math.hypot(point.x - selectedCowPoint.x, point.y - (selectedCowPoint.y - 7)) < 82) {
        lastShotRef.current = performance.now();
        speak('Step 4 · Arrows fire automatically.');
        changePhase('shoot');
        canvas.focus();
        return;
      }
      if (currentPhase === 'aim') speak('Tap the rank #1 cow to aim.');
    };

    const onKeyDown = (event: KeyboardEvent): void => {
      if (phaseRef.current !== 'move') return;
      const deltas: Record<string, Point> = {
        arrowup: { x: 0, y: -70 }, w: { x: 0, y: -70 },
        arrowdown: { x: 0, y: 70 }, s: { x: 0, y: 70 },
        arrowleft: { x: -70, y: 0 }, a: { x: -70, y: 0 },
        arrowright: { x: 70, y: 0 }, d: { x: 70, y: 0 },
      };
      const delta = deltas[event.key.toLowerCase()];
      if (!delta) return;
      event.preventDefault();
      const player = playerRef.current;
      const worldWidth = worldRef.current.width;
      moveGoalRef.current = {
        x: Math.max(50, Math.min(worldWidth - 50, player.x + delta.x)),
        y: Math.max(100, Math.min(HEIGHT - 55, player.y + delta.y)),
      };
    };

    const drawCow = (cow: Point, damaged: boolean): void => {
      const x = cow.x;
      const y = cow.y;
      context.fillStyle = 'rgba(5, 17, 10, .35)';
      context.beginPath();
      context.ellipse(x, y + 22, 43, 12, 0, 0, Math.PI * 2);
      context.fill();
      context.fillStyle = '#f0e5c7';
      context.beginPath();
      context.ellipse(x - 5, y - 4, 39, 27, 0, 0, Math.PI * 2);
      context.fill();
      context.fillStyle = '#705340';
      context.beginPath();
      context.ellipse(x - 16, y - 8, 12, 16, -.25, 0, Math.PI * 2);
      context.ellipse(x + 13, y + 1, 13, 12, .25, 0, Math.PI * 2);
      context.fill();
      context.fillStyle = '#f0e5c7';
      context.beginPath();
      context.ellipse(x + 32, y - 19, 18, 19, 0, 0, Math.PI * 2);
      context.fill();
      context.fillStyle = '#d99b93';
      context.beginPath();
      context.ellipse(x + 41, y - 13, 12, 8, 0, 0, Math.PI * 2);
      context.fill();
      context.fillStyle = '#30271f';
      context.beginPath();
      context.arc(x + 35, y - 22, 2.2, 0, Math.PI * 2);
      context.fill();
      context.strokeStyle = '#594631';
      context.lineWidth = 6;
      for (const legX of [x - 24, x + 12]) {
        context.beginPath();
        context.moveTo(legX, y + 13);
        context.lineTo(legX - 2, y + 34);
        context.stroke();
      }
      if (damaged) {
        context.strokeStyle = '#ffdb8d';
        context.lineWidth = 3;
        context.beginPath();
        context.arc(x, y - 1, 53, 0, Math.PI * 2);
        context.stroke();
      }
    };

    const drawRanger = (player: Point): void => {
      context.fillStyle = 'rgba(5, 17, 10, .38)';
      context.beginPath();
      context.ellipse(player.x, player.y + 16, 22, 8, 0, 0, Math.PI * 2);
      context.fill();
      context.fillStyle = '#343b38';
      context.fillRect(player.x - 12, player.y - 6, 9, 24);
      context.fillRect(player.x + 4, player.y - 6, 9, 24);
      context.fillStyle = '#54789b';
      context.beginPath();
      context.ellipse(player.x, player.y - 25, 17, 23, 0, 0, Math.PI * 2);
      context.fill();
      context.fillStyle = '#d6aa81';
      context.beginPath();
      context.arc(player.x, player.y - 53, 13, 0, Math.PI * 2);
      context.fill();
      context.fillStyle = '#46362b';
      context.beginPath();
      context.ellipse(player.x, player.y - 61, 15, 5, 0, Math.PI, Math.PI * 2);
      context.fill();
      context.strokeStyle = '#bd925e';
      context.lineWidth = 4;
      context.beginPath();
      context.arc(player.x + 16, player.y - 28, 12, -Math.PI / 2, Math.PI / 2);
      context.stroke();
    };

    const render = (now: number): void => {
      const dt = Math.min(.05, (now - previousAt) / 1000);
      previousAt = now;
      const { width: worldWidth, scale } = worldRef.current;
      const pixelRatio = window.devicePixelRatio || 1;
      context.setTransform(pixelRatio * scale, 0, 0, pixelRatio * scale, 0, 0);
      const player = playerRef.current;
      const goal = moveGoalRef.current;
      const currentPhase = phaseRef.current;

      if (goal && currentPhase === 'move') {
        const dx = goal.x - player.x;
        const dy = goal.y - player.y;
        const distance = Math.hypot(dx, dy);
        if (distance > 4) {
          const step = Math.min(distance, 155 * dt);
          player.x += (dx / distance) * step;
          player.y += (dy / distance) * step;
        } else {
          moveGoalRef.current = null;
          const target = selectedCowRef.current === null ? null : pointForCow(selectedCowRef.current, worldWidth);
          if (target && Math.hypot(player.x - target.x, player.y - target.y) <= worldWidth * (250 / WIDTH)) {
            speak('Step 3 · Tap the rank #1 cow to aim.');
            changePhase('aim');
          }
        }
      }

      const target = selectedCowRef.current === null ? null : pointForCow(selectedCowRef.current, worldWidth);
      if (currentPhase === 'shoot' && target && now - lastShotRef.current >= 820) {
        lastShotRef.current = now;
        arrowsRef.current.push({
          startX: player.x + 12,
          startY: player.y - 29,
          x: player.x + 12,
          y: player.y - 29,
          progress: 0,
          hit: Math.random() < .94,
        });
      }

      context.clearRect(0, 0, worldWidth, HEIGHT);
      context.fillStyle = '#56894d';
      context.fillRect(0, 0, worldWidth, HEIGHT);
      context.fillStyle = 'rgba(34, 83, 44, .23)';
      for (let row = 0; row < 10; row += 1) {
        context.fillRect(0, row * 60 + 15, worldWidth, 2);
      }
      for (const blade of grass) {
        context.strokeStyle = '#3f7444';
        context.lineWidth = 2;
        context.beginPath();
        context.moveTo(blade.x, blade.y + 4);
        context.lineTo(blade.x - 2, blade.y - blade.height);
        context.lineTo(blade.x + 4, blade.y + 2);
        context.stroke();
      }

      context.fillStyle = '#856343';
      for (let x = 26; x < worldWidth; x += 62) {
        context.fillRect(x, 38, 6, 26);
        context.fillRect(x, HEIGHT - 48, 6, 26);
      }
      context.fillStyle = '#b28a5d';
      context.fillRect(25, 45, worldWidth - 50, 5);
      context.fillRect(25, HEIGHT - 37, worldWidth - 50, 5);

      for (let index = 0; index < TUTORIAL_COWS.length; index += 1) {
        const cow = TUTORIAL_COWS[index];
        const cowPosition = pointForCow(index, worldWidth);
        if (!cowPosition) continue;
        const selected = selectedCowRef.current === index;
        const active = selected && currentPhase !== 'complete';
        const hp = active ? hpRef.current : COW_HEALTH;
        context.strokeStyle = selected ? '#ffe091' : index === 1 ? '#92d99a' : 'rgba(255,255,255,.44)';
        context.lineWidth = selected ? 3 : 2;
        context.setLineDash(selected ? [] : [6, 6]);
        context.beginPath();
        context.ellipse(cowPosition.x, cowPosition.y - 2, 57, 38, 0, 0, Math.PI * 2);
        context.stroke();
        context.setLineDash([]);
        drawCow(cowPosition, active && hp < COW_HEALTH);

        if (selected) {
          if (currentPhase === 'move') {
            context.strokeStyle = 'rgba(255, 244, 207, .74)';
            context.lineWidth = 2;
            context.setLineDash([10, 8]);
            context.beginPath();
            context.arc(cowPosition.x, cowPosition.y, worldWidth * (250 / WIDTH), 0, Math.PI * 2);
            context.stroke();
            context.setLineDash([]);
          }
          context.fillStyle = '#382c27';
          context.fillRect(cowPosition.x - 31, cowPosition.y - 58, 62, 7);
          context.fillStyle = '#8ed47d';
          context.fillRect(cowPosition.x - 31, cowPosition.y - 58, 62 * Math.max(0, hp) / COW_HEALTH, 7);
        }
      }

      if (goal && currentPhase === 'move') {
        context.strokeStyle = 'rgba(255,255,255,.55)';
        context.lineWidth = 2;
        context.beginPath();
        context.arc(goal.x, goal.y, 10 + Math.sin(now / 130) * 2, 0, Math.PI * 2);
        context.stroke();
      }
      drawRanger(player);
      const speechBubble = speechBubbleRef.current;
      if (speechBubble) {
        const bounds = canvas.getBoundingClientRect();
        const bubbleHeight = speechBubble.offsetHeight;
        const anchorX = (player.x / worldWidth) * bounds.width;
        const anchorY = (player.y / HEIGHT) * bounds.height;
        const above = anchorY > bubbleHeight + 72;
        speechBubble.style.left = `${Math.max(8 + speechBubble.offsetWidth / 2, Math.min(bounds.width - 8 - speechBubble.offsetWidth / 2, anchorX))}px`;
        speechBubble.style.top = `${above ? anchorY - 72 : anchorY + 12}px`;
        speechBubble.dataset.placement = above ? 'above' : 'below';
      }

      const arrows = arrowsRef.current;
      for (let index = arrows.length - 1; index >= 0; index -= 1) {
        const arrow = arrows[index];
        arrow.progress = Math.min(1, arrow.progress + dt * 1.75);
        const arrowTarget = selectedCowRef.current === null ? null : pointForCow(selectedCowRef.current, worldWidth);
        if (!arrowTarget) continue;
        const endX = arrowTarget.x - 45;
        const endY = arrowTarget.y - 16;
        arrow.x = arrow.startX + (endX - arrow.startX) * arrow.progress;
        arrow.y = arrow.startY + (endY - arrow.startY) * arrow.progress;
        context.save();
        context.translate(arrow.x, arrow.y);
        context.rotate(Math.atan2(endY - arrow.startY, endX - arrow.startX));
        context.strokeStyle = '#f5e1a5';
        context.lineWidth = 3;
        context.beginPath();
        context.moveTo(-12, 0);
        context.lineTo(9, 0);
        context.stroke();
        context.fillStyle = '#fff5db';
        context.beginPath();
        context.moveTo(10, 0);
        context.lineTo(3, -4);
        context.lineTo(3, 4);
        context.fill();
        context.restore();

        if (arrow.progress < 1) continue;
        arrows.splice(index, 1);
        if (!arrow.hit || hpRef.current <= 0 || phaseRef.current !== 'shoot') {
          if (!arrow.hit && phaseRef.current === 'shoot') speak('Missed. Keep aiming, ranger.');
          continue;
        }
        hpRef.current -= 1;
        lastDamageAt = now;
        if (hpRef.current <= 0) {
          changePhase('settling');
          speak('Step 5 · Settling the $1 practice contract.');
          const round = roundRef.current;
          window.setTimeout(() => {
            if (round !== roundRef.current || phaseRef.current !== 'settling') return;
            const market = TUTORIAL_MARKETS[selectedMarketRef.current] ?? TUTORIAL_MARKETS[0];
            const digit = marketTicksRef.current[selectedMarketRef.current]?.digit ?? getLastDigit(market.baseQuote);
            const won = market.direction === 'OVER' ? digit > market.barrier : digit < market.barrier;
            const payout = won ? Number((PRACTICE_STAKE * market.payoutMultiplier).toFixed(2)) : 0;
            const profit = won ? Number((payout - PRACTICE_STAKE).toFixed(2)) : -PRACTICE_STAKE;
            const result: PracticeTrade = {
              won,
              market: market.name,
              contract: `${market.direction} ${market.barrier}`,
              digit,
              stake: PRACTICE_STAKE,
              payout,
              profit,
            };
            setLastTrade(result);
            setDemoBalance((balance) => Number((balance + profit).toFixed(2)));
            setNetProfit((profitTotal) => Number((profitTotal + profit).toFixed(2)));
            speak(`${won ? 'WIN' : 'LOSS'} · payout $${payout.toFixed(2)} · profit ${profit >= 0 ? '+' : '−'}$${Math.abs(profit).toFixed(2)}`);
            changePhase('complete');
          }, 1000);
        }
      }

      if (now - lastDamageAt < 200) {
        context.fillStyle = '#fff0bd';
        context.font = '900 17px system-ui';
        if (target) context.fillText('HIT!', target.x, target.y - 88);
      }

      raf = requestAnimationFrame(render);
    };

    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('keydown', onKeyDown);
    raf = requestAnimationFrame(render);
    return () => {
      roundRef.current += 1;
      window.clearInterval(marketTimer);
      resizeObserver.disconnect();
      cancelAnimationFrame(raf);
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  const currentStep = phase === 'choose' ? 1
    : phase === 'move' ? 2
      : phase === 'aim' ? 3
        : phase === 'shoot' ? 4
          : 5;
  const stepInstruction = phase === 'choose' ? 'Choose rank #1'
    : phase === 'move' ? 'Move inside the ring'
      : phase === 'aim' ? 'Tap the cow to aim'
        : phase === 'shoot' ? 'Watch the arrows'
          : 'See the contract result';

  return (
    <section class="how-to-simulator" aria-label="Guided pasture tutorial">
      <div class="tutorial-game">
        <canvas
          ref={canvasRef}
          class="tutorial-game-canvas"
          width={WIDTH}
          height={HEIGHT}
          tabIndex={0}
          aria-label={`Step ${currentStep} of 5: ${stepInstruction}.`}
        />
        <div class="tutorial-hud">
          <button type="button" class="how-to-back" onClick={onExit} aria-label="Exit tutorial">←</button>
          <div class="tutorial-step-guide" role="status" aria-live="polite">
            <span>STEP {currentStep} / 5</span>
            <strong>{stepInstruction}</strong>
            <div class="tutorial-step-track" aria-hidden="true">
              <span style={{ width: `${(currentStep / 5) * 100}%` }} />
            </div>
          </div>
          <div class="tutorial-money" aria-label={`Practice balance $${demoBalance.toFixed(2)}, net profit ${netProfit.toFixed(2)}`}>
            <small>PRACTICE</small>
            <strong>${demoBalance.toFixed(2)}</strong>
            <span>{netProfit < 0 ? '−' : '+'}${Math.abs(netProfit).toFixed(2)}</span>
          </div>
        </div>
        <div ref={speechBubbleRef} class="tutorial-ranger-speech" data-placement="above" aria-hidden="true">
          {speech}
        </div>
        <div class="tutorial-market-bubbles" role="group" aria-label="Cow market rankings">
          {TUTORIAL_COWS.map((cow, index) => {
            const market = TUTORIAL_MARKETS[cow.marketIndex];
            const cowPosition = pointForCow(index, worldWidth);
            const selected = selectedCowRef.current === index;
            const tick = marketTicks[cow.marketIndex] ?? marketTicksRef.current[cow.marketIndex];
            const edge = (cow.confidence / 100) - (1 / market.payoutMultiplier);
            const tickDirection = tick.change > 0 ? 'up' : tick.change < 0 ? 'down' : 'flat';
            const tickArrow = tick.change > 0 ? '↑' : tick.change < 0 ? '↓' : '→';
            return (
              <button
                type="button"
                key={market.symbol}
                class={`tutorial-market-bubble${cow.rank === 1 ? ' top-rank' : ' lower-rank'}${selected ? ' selected' : ''}${phase === 'choose' && cow.rank === 1 ? ' guide-target' : ''}`}
                style={{
                  left: `${((cowPosition?.x ?? 0) / worldWidth) * 100}%`,
                  top: `${(Math.max(4, (cowPosition?.y ?? 0) - 178) / HEIGHT) * 100}%`,
                }}
                aria-label={`${cow.rank === 1 ? 'High rank one' : 'Low rank two'}, ${market.name}, ${market.direction} ${market.barrier}, ${cow.confidence} percent confidence, ${edge >= 0 ? 'positive' : 'negative'} ${Math.abs(edge * 100).toFixed(1)} percent edge, quote ${tick.quote.toFixed(2)} ${tick.change > 0 ? 'up' : tick.change < 0 ? 'down' : 'unchanged'}. Select cow.`}
                aria-pressed={selected}
                disabled={phase !== 'choose'}
                onClick={() => chooseCow(index)}
              >
                <span class="tutorial-bubble-top">
                  <b>{cow.rank === 1 ? 'RANK #1' : 'RANK #2'}</b>
                  <strong>{cow.confidence}%</strong>
                </span>
                <span class={`tutorial-bubble-edge ${edge >= 0 ? 'positive' : 'negative'}`}>
                  {edge >= 0 ? '▲' : '▼'} {edge >= 0 ? '+' : '−'}{Math.abs(edge * 100).toFixed(1)}% EDGE
                </span>
                <span class="tutorial-bubble-contract">{market.name} · {market.direction} {market.barrier}</span>
                <span class="tutorial-bubble-quote">
                  <small>{market.symbol} · {tick.quote.toFixed(2)}</small>
                  <strong class={`tutorial-tick ${tickDirection}`} aria-label={`Quote ${tickDirection}`}>
                    {tickArrow} {tick.change === 0 ? '—' : `${tick.change > 0 ? '+' : '−'}${Math.abs(tick.change).toFixed(2)}`}
                  </strong>
                </span>
              </button>
            );
          })}
        </div>
        {phase === 'complete' && lastTrade && (
          <div class={`tutorial-result ${lastTrade.won ? 'won' : 'lost'}`} role="status" aria-live="polite">
            <strong>{lastTrade.won ? 'WIN' : 'LOSS'}</strong>
            <span>PAYOUT ${lastTrade.payout.toFixed(2)} · PROFIT {lastTrade.profit < 0 ? '−' : '+'}${Math.abs(lastTrade.profit).toFixed(2)}</span>
            <button type="button" onClick={reset}>AGAIN</button>
          </div>
        )}
      </div>
      <span class="tutorial-speech-live" aria-live="polite">{speech}</span>
    </section>
  );
}
