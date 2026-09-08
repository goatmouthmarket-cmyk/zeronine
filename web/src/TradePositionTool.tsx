import type { JSX } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';

export interface TradePositionToolProps {
  side: 'long' | 'short';
  entry: number;
  takeProfit?: number | null;
  stopLoss?: number | null;
  values: number[];
  /** Pixel geometry from the chart's live time scale: last five candles. */
  zoneGeometry?: { left: number; width: number } | null;
  /** Pixel y-coordinates supplied by the underlying chart price scale. */
  levelTops?: Partial<Record<'entry' | 'takeProfit' | 'stopLoss' | 'currentPrice', number>> | null;
  targetPnl?: string;
  riskPnl?: string;
  currentPrice?: number | null;
  currentPnl?: string;
  editable?: boolean;
  onLevelChange?: (kind: 'takeProfit' | 'stopLoss', price: number) => void;
  onSideChange?: (side: 'long' | 'short') => void;
  onClose?: () => void;
  closeDisabled?: boolean;
  stake?: string;
  onStakeChange?: (value: string) => void;
  stakeDisabled?: boolean;
  multiplier?: string;
  multiplierOptions?: number[];
  onMultiplierChange?: (value: string) => void;
  multiplierDisabled?: boolean;
  onPlaceLong?: () => void;
  onPlaceShort?: () => void;
  longActionDisabled?: boolean;
  shortActionDisabled?: boolean;
  placingSide?: 'long' | 'short' | null;
  liveTrade?: {
    pnl: string;
    side: string;
    stake: string;
    multiplier: string;
    elapsed: string;
    cashout?: string;
  } | null;
}

function priceText(value: number): string {
  return value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 5 });
}

/**
 * A deliberately chart-library-neutral position overlay. The price zones are
 * visual planning controls; parent desks convert their levels to Deriv's
 * monetary multiplier limits before an order is submitted.
 */
export function TradePositionTool({
  side,
  entry,
  takeProfit,
  stopLoss,
  values,
  zoneGeometry,
  levelTops,
  targetPnl,
  riskPnl,
  currentPrice,
  currentPnl,
  editable = false,
  onLevelChange,
  onSideChange,
  onClose,
  closeDisabled = false,
  stake,
  onStakeChange,
  stakeDisabled = false,
  multiplier,
  multiplierOptions,
  onMultiplierChange,
  multiplierDisabled = false,
  onPlaceLong,
  onPlaceShort,
  longActionDisabled = false,
  shortActionDisabled = false,
  placingSide,
  liveTrade,
}: TradePositionToolProps): JSX.Element | null {
  const [dragging, setDragging] = useState<'takeProfit' | 'stopLoss' | null>(null);
  const [resizingZone, setResizingZone] = useState(false);
  const [horizontalZone, setHorizontalZone] = useState<{ left: number; width: number } | null>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const dragOriginRef = useRef<{ kind: 'takeProfit' | 'stopLoss'; y: number; price: number } | null>(null);
  const zoneDragOriginRef = useRef<{ x: number; right: number } | null>(null);
  const zoneManuallySizedRef = useRef(false);
  const range = useMemo(() => {
    // Keep the price mapping tied to what the candles are actually doing.
    // A monetary TP/SL can be far from the market; letting it define the
    // viewport flattens the live candles into a misleading straight line.
    const valid = [...values, entry, currentPrice].filter((value): value is number => Number.isFinite(value));
    if (!valid.length) return null;
    const min = Math.min(...valid);
    const max = Math.max(...valid);
    const padding = Math.max((max - min) * .14, Math.abs(entry) * .00012, .00001);
    return { low: min - padding, high: max + padding };
  }, [entry, stopLoss, takeProfit, values]);
  if (!range || !Number.isFinite(entry)) return null;

  const span = Math.max(range.high - range.low, Number.EPSILON);
  const chartY = (price: number, key?: 'entry' | 'takeProfit' | 'stopLoss' | 'currentPrice') => {
    const raw = key ? levelTops?.[key] : undefined;
    if (!Number.isFinite(raw)) return undefined;
    const entryY = levelTops?.entry;
    // With a larger stake, the same cash target is legitimately closer to
    // entry. Keep a small visual gap so both planning controls remain usable.
    if ((key === 'takeProfit' || key === 'stopLoss') && Number.isFinite(entryY) && Math.abs(Number(raw) - Number(entryY)) < 26) {
      const aboveEntry = price >= entry;
      return Number(entryY) + (aboveEntry ? -26 : 26);
    }
    return Number(raw);
  };
  const top = (price: number, key?: 'entry' | 'takeProfit' | 'stopLoss' | 'currentPrice') => {
    const y = chartY(price, key);
    // Levels carry labels above the line, so leave enough headroom for the
    // label itself rather than merely keeping the 1px line on-screen.
    return y != null ? `clamp(24px, ${y}px, calc(100% - 18px))` : `${Math.max(3, Math.min(97, ((range.high - price) / span) * 100))}%`;
  };
  const zone = (from: number | null | undefined, to: number | null | undefined, fromKey: 'entry' | 'takeProfit' | 'stopLoss' | 'currentPrice', toKey: 'entry' | 'takeProfit' | 'stopLoss' | 'currentPrice') => {
    if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
    const fromTop = chartY(Number(from), fromKey); const toTop = chartY(Number(to), toKey);
    if (Number.isFinite(fromTop) && Number.isFinite(toTop)) {
      return { top: `${Math.min(Number(fromTop), Number(toTop))}px`, height: `${Math.max(1.5, Math.abs(Number(fromTop) - Number(toTop)))}px` };
    }
    const a = Number(from); const b = Number(to);
    const first = Math.min(a, b); const last = Math.max(a, b);
    return { top: top(last), height: `${Math.max(1.5, ((last - first) / span) * 100)}%` };
  };
  useEffect(() => {
    if (!zoneManuallySizedRef.current) setHorizontalZone(zoneGeometry ?? null);
  }, [zoneGeometry?.left, zoneGeometry?.width]);
  const targetZone = zone(entry, takeProfit, 'entry', 'takeProfit');
  const riskZone = zone(entry, stopLoss, 'entry', 'stopLoss');
  const zoneStyle = horizontalZone ?? zoneGeometry ?? {};
  const move = (kind: 'takeProfit' | 'stopLoss', event: { clientY: number }) => {
    const rect = surfaceRef.current?.getBoundingClientRect();
    const origin = dragOriginRef.current;
    if (!rect || !onLevelChange || !origin || origin.kind !== kind) return;
    // Fine relative drag: a pointer grab never jumps the level to the cursor,
    // and one full chart-height sweep changes only a modest part of its range.
    const delta = event.clientY - origin.y;
    const sensitivity = .16;
    const next = origin.price - delta * (span / Math.max(1, rect.height)) * sensitivity;
    onLevelChange(kind, Math.max(range.low, Math.min(range.high, next)));
  };
  const start = (kind: 'takeProfit' | 'stopLoss', event: JSX.TargetedPointerEvent<HTMLElement>) => {
    if (!editable || !onLevelChange) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const price = kind === 'takeProfit' ? takeProfit : stopLoss;
    if (!Number.isFinite(price)) return;
    dragOriginRef.current = { kind, y: event.clientY, price: Number(price) };
    setDragging(kind);
  };
  const startZoneResize = (event: JSX.TargetedPointerEvent<HTMLElement>) => {
    const current = horizontalZone ?? zoneGeometry;
    if (!current) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    zoneManuallySizedRef.current = true;
    zoneDragOriginRef.current = { x: event.clientX, right: current.left + current.width };
    setResizingZone(true);
  };
  const resizeZone = (event: JSX.TargetedPointerEvent<HTMLElement>) => {
    const origin = zoneDragOriginRef.current;
    const rect = surfaceRef.current?.getBoundingClientRect();
    if (!origin || !rect) return;
    const left = Math.max(0, Math.min(origin.right - 42, event.clientX - rect.left));
    setHorizontalZone({ left, width: origin.right - left });
  };

  return <div
    ref={surfaceRef}
    class={`position-tool ${side}${editable ? ' editable' : ''}${dragging ? ' dragging' : ''}`}
    aria-label={`${side === 'long' ? 'Long' : 'Short'} position tool`}
  >
    {targetZone && <div class="position-zone profit" style={{ ...targetZone, ...zoneStyle }}><span>Target {targetPnl ?? ''}</span></div>}
    {riskZone && <div class="position-zone risk" style={{ ...riskZone, ...zoneStyle }}><span>Risk {riskPnl ?? ''}</span></div>}
    {horizontalZone && <div class="position-zone-resizer" style={{ left: `${horizontalZone.left}px` }} role="slider" aria-label="Resize profit and risk zones" aria-orientation="horizontal" tabIndex={0} onPointerDown={startZoneResize} onPointerMove={resizingZone ? resizeZone : undefined} onPointerUp={() => { zoneDragOriginRef.current = null; setResizingZone(false); }} />}
    <div class={`position-level entry ${side}`} style={{ top: top(entry, 'entry'), ...zoneStyle }}><span>{side === 'long' ? 'Long entry' : 'Short entry'}</span><b title={`Entry price ${priceText(entry)}`}>{priceText(entry)}</b></div>
    {takeProfit != null && <div class="position-level target" style={{ top: top(takeProfit, 'takeProfit'), ...zoneStyle }} onPointerDown={(event) => start('takeProfit', event)} onPointerMove={(event) => dragging === 'takeProfit' && move('takeProfit', event)} onPointerUp={() => { dragOriginRef.current = null; setDragging(null); }}>
      <span>Take profit</span><b title={`Target price ${priceText(takeProfit)}`}>{targetPnl ?? priceText(takeProfit)}</b>
      {editable && <button type="button" aria-label="Drag take-profit level" onPointerDown={(event) => start('takeProfit', event)} onPointerMove={(event) => dragging === 'takeProfit' && move('takeProfit', event)} onPointerUp={() => setDragging(null)}>↕</button>}
    </div>}
    {stopLoss != null && <div class="position-level stop" style={{ top: top(stopLoss, 'stopLoss'), ...zoneStyle }} onPointerDown={(event) => start('stopLoss', event)} onPointerMove={(event) => dragging === 'stopLoss' && move('stopLoss', event)} onPointerUp={() => { dragOriginRef.current = null; setDragging(null); }}>
      <span>Stop loss</span><b title={`Stop price ${priceText(stopLoss)}`}>{riskPnl ?? priceText(stopLoss)}</b>
      {editable && <button type="button" aria-label="Drag stop-loss level" onPointerDown={(event) => start('stopLoss', event)} onPointerMove={(event) => dragging === 'stopLoss' && move('stopLoss', event)} onPointerUp={() => setDragging(null)}>↕</button>}
    </div>}
    {currentPrice != null && Number.isFinite(currentPrice) && <div class="position-level current" style={{ top: top(currentPrice, 'currentPrice'), ...zoneStyle }}>
      <span>Live</span><b>{priceText(currentPrice)}{currentPnl ? ` · ${currentPnl}` : ''}</b>
    </div>}
    <div class="position-tool-controls">
      {onSideChange && <div class="position-side-switch" aria-label="Position direction">
        <button type="button" class={side === 'long' ? 'active long' : ''} onClick={() => onSideChange('long')}>Long</button>
        <button type="button" class={side === 'short' ? 'active short' : ''} onClick={() => onSideChange('short')}>Short</button>
      </div>}
      {onStakeChange && <label class="position-stake"><span>Stake</span><input type="number" inputMode="decimal" min="0.35" step="0.01" value={stake ?? ''} disabled={stakeDisabled} onInput={(event) => onStakeChange(event.currentTarget.value)} /></label>}
      {onMultiplierChange && multiplierOptions && <label class="position-stake"><span>Multiplier</span><select value={multiplier ?? ''} disabled={multiplierDisabled} onChange={(event) => onMultiplierChange(event.currentTarget.value)}>{multiplierOptions.map((value) => <option value={value} key={value}>x{value}</option>)}</select></label>}
      {(onPlaceLong || onPlaceShort) && <div class="position-place-actions">
        {onPlaceLong && <button class="long" type="button" disabled={longActionDisabled} onClick={onPlaceLong}>{placingSide === 'long' ? 'Buying…' : 'Buy'}</button>}
        {onPlaceShort && <button class="short" type="button" disabled={shortActionDisabled} onClick={onPlaceShort}>{placingSide === 'short' ? 'Selling…' : 'Sell'}</button>}
      </div>}
      {liveTrade && <section class="position-live-card" aria-live="polite" aria-label="Live contract details">
        <span>Live contract P&amp;L</span>
        <strong>{liveTrade.pnl}</strong>
        <div><span>Side <b>{liveTrade.side}</b></span><span>Elapsed <b>{liveTrade.elapsed}</b></span></div>
        <div><span>Stake <b>{liveTrade.stake}</b></span><span>Multiplier <b>{liveTrade.multiplier}</b></span></div>
        {liveTrade.cashout && <small>Cash-out {liveTrade.cashout}</small>}
      </section>}
      {onClose && <button class="position-close" type="button" disabled={closeDisabled} onClick={onClose}>× Close / cash out</button>}
    </div>
    <div class="position-tool-note">{editable ? 'Drag any TP / SL line to set risk' : onClose ? 'Live contract levels' : 'Levels lock after order submission'}</div>
  </div>;
}
