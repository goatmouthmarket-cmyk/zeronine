import type { JSX } from 'preact';
import { useMemo, useRef, useState } from 'preact/hooks';

export interface TradePositionToolProps {
  side: 'long' | 'short';
  entry: number;
  takeProfit?: number | null;
  stopLoss?: number | null;
  values: number[];
  /** Pixel geometry from the chart's live time scale: last five candles. */
  zoneGeometry?: { left: number; width: number } | null;
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
  const surfaceRef = useRef<HTMLDivElement>(null);
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
  const top = (price: number) => `${Math.max(1, Math.min(99, ((range.high - price) / span) * 100))}%`;
  const zone = (from: number | null | undefined, to: number | null | undefined) => {
    if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
    const a = Number(from); const b = Number(to);
    const first = Math.min(a, b); const last = Math.max(a, b);
    return { top: top(last), height: `${Math.max(1.5, ((last - first) / span) * 100)}%` };
  };
  const targetZone = zone(entry, takeProfit);
  const riskZone = zone(entry, stopLoss);
  const zoneStyle = zoneGeometry ?? {};
  const move = (kind: 'takeProfit' | 'stopLoss', event: { clientY: number }) => {
    const rect = surfaceRef.current?.getBoundingClientRect();
    if (!rect || !onLevelChange) return;
    const ratio = Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height));
    onLevelChange(kind, range.high - ratio * span);
  };
  const start = (kind: 'takeProfit' | 'stopLoss', event: JSX.TargetedPointerEvent<HTMLElement>) => {
    if (!editable || !onLevelChange) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(kind);
    move(kind, event);
  };

  return <div
    ref={surfaceRef}
    class={`position-tool ${side}${editable ? ' editable' : ''}${dragging ? ' dragging' : ''}`}
    aria-label={`${side === 'long' ? 'Long' : 'Short'} position tool`}
  >
    {targetZone && <div class="position-zone profit" style={{ ...targetZone, ...zoneStyle }}><span>Target {targetPnl ?? ''}</span></div>}
    {riskZone && <div class="position-zone risk" style={{ ...riskZone, ...zoneStyle }}><span>Risk {riskPnl ?? ''}</span></div>}
    <div class={`position-level entry ${side}`} style={{ top: top(entry), ...zoneStyle }}><span>{side === 'long' ? 'Long entry' : 'Short entry'}</span><b title={`Entry price ${priceText(entry)}`}>{priceText(entry)}</b></div>
    {takeProfit != null && <div class="position-level target" style={{ top: top(takeProfit), ...zoneStyle }} onPointerDown={(event) => start('takeProfit', event)} onPointerMove={(event) => dragging === 'takeProfit' && move('takeProfit', event)} onPointerUp={() => setDragging(null)}>
      <span>Take profit</span><b title={`Target price ${priceText(takeProfit)}`}>{targetPnl ?? priceText(takeProfit)}</b>
      {editable && <button type="button" aria-label="Drag take-profit level" onPointerDown={(event) => start('takeProfit', event)} onPointerMove={(event) => dragging === 'takeProfit' && move('takeProfit', event)} onPointerUp={() => setDragging(null)}>↕</button>}
    </div>}
    {stopLoss != null && <div class="position-level stop" style={{ top: top(stopLoss), ...zoneStyle }} onPointerDown={(event) => start('stopLoss', event)} onPointerMove={(event) => dragging === 'stopLoss' && move('stopLoss', event)} onPointerUp={() => setDragging(null)}>
      <span>Stop loss</span><b title={`Stop price ${priceText(stopLoss)}`}>{riskPnl ?? priceText(stopLoss)}</b>
      {editable && <button type="button" aria-label="Drag stop-loss level" onPointerDown={(event) => start('stopLoss', event)} onPointerMove={(event) => dragging === 'stopLoss' && move('stopLoss', event)} onPointerUp={() => setDragging(null)}>↕</button>}
    </div>}
    {currentPrice != null && Number.isFinite(currentPrice) && <div class="position-level current" style={{ top: top(currentPrice), ...zoneStyle }}>
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
