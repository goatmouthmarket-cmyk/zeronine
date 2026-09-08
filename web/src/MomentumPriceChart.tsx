import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import {
  ColorType,
  LineSeries,
  LineStyle,
  createChart,
  type AutoscaleInfo,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type LineData,
  type Time,
} from 'lightweight-charts';
import type { MomentumScanSample } from './store';
import { TradePositionTool, type TradePositionToolProps } from './TradePositionTool';
import { calculateChartIndicators } from './chartIndicators';

export interface MomentumPriceChartProps {
  samples?: MomentumScanSample[];
  label: string;
  compact?: boolean;
  /** Exact price at which the active research window began. */
  entryPrice?: number;
  /** Visible context for the research-window entry reference. */
  entryLabel?: string;
  entryDirection?: 'up' | 'down';
  positionTool?: Omit<TradePositionToolProps, 'values'> | null;
}

function chartData(samples: MomentumScanSample[], compact: boolean): LineData<Time>[] {
  let previousTime = 0;
  const ticks = samples
    .filter((sample) => Number.isFinite(sample.epoch) && Number.isFinite(sample.quote))
    .slice(compact ? -72 : -1_800);
  const points: LineData<Time>[] = [];
  for (const tick of ticks) {
    // Momentum is a quote stream, not a candle feed. Preserve every live
    // movement and only make duplicate provider timestamps monotonic.
    const time = Math.max(Math.trunc(tick.epoch), previousTime + 1);
    previousTime = time;
    points.push({ time: time as Time, value: tick.quote });
  }
  return points;
}

function displayPrice(value: number) {
  return value.toLocaleString(undefined, { maximumFractionDigits: 8 });
}

function measuredSize(element: HTMLElement): { width: number; height: number } | null {
  const width = Math.floor(element.clientWidth);
  const height = Math.floor(element.clientHeight);
  return width > 0 && height > 0 ? { width, height } : null;
}

export function MomentumPriceChart({
  samples,
  label,
  compact = false,
  entryPrice,
  entryLabel = 'Watch entry',
  entryDirection,
  positionTool,
}: MomentumPriceChartProps) {
  const containerRef = useRef<HTMLSpanElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const indicatorRefs = useRef<ISeriesApi<'Line'>[]>([]);
  const entryLineRef = useRef<IPriceLine | null>(null);
  const [zoneGeometry, setZoneGeometry] = useState<{ left: number; width: number } | null>(null);
  const [levelTops, setLevelTops] = useState<Partial<Record<'entry' | 'takeProfit' | 'stopLoss' | 'currentPrice', number>> | null>(null);
  const points = useMemo(() => chartData(samples ?? [], compact), [samples, compact]);
  const indicators = useMemo(() => calculateChartIndicators(points, 21, 55, 34), [points]);
  const pointsRef = useRef<LineData<Time>[]>(points);
  const fittedRef = useRef(false);
  const hasEntry = !compact && !positionTool && Number.isFinite(entryPrice);
  const entryViewport = useMemo(() => {
    if (!hasEntry || entryPrice == null || points.length < 2) {
      return { showLine: hasEntry, offscreen: false, side: 'onscreen' as const };
    }
    const values = points.map((point) => point.value).filter(Number.isFinite);
    if (values.length < 2) return { showLine: hasEntry, offscreen: false, side: 'onscreen' as const };
    const min = Math.min(...values);
    const max = Math.max(...values);
    const last = values[values.length - 1] ?? entryPrice;
    const visibleRange = Math.max(max - min, Math.abs(last) * 0.00001, 0.00001);
    const offscreenPadding = visibleRange * 0.85;
    if (entryPrice > max + offscreenPadding) return { showLine: false, offscreen: true, side: 'above' as const };
    if (entryPrice < min - offscreenPadding) return { showLine: false, offscreen: true, side: 'below' as const };
    return { showLine: true, offscreen: false, side: 'onscreen' as const };
  }, [entryPrice, hasEntry, points]);
  const showEntryLine = hasEntry && entryViewport.showLine;
  const entryRef = useRef({ showEntryLine, entryPrice, entryDirection, entryLabel });
  const tradeView = !compact;

  useEffect(() => {
    pointsRef.current = points;
  }, [points]);

  useEffect(() => {
    const chart = chartRef.current;
    const container = containerRef.current;
    if (!chart || !container || !positionTool || points.length < 2) {
      setZoneGeometry(null);
      return;
    }
    const updateZone = () => {
      const last = points.at(-1)!;
      const start = points[Math.max(0, points.length - 5)]!;
      const previous = points.at(-2) ?? start;
      const lastX = chart.timeScale().timeToCoordinate(last.time);
      const startX = chart.timeScale().timeToCoordinate(start.time);
      const previousX = chart.timeScale().timeToCoordinate(previous.time);
      if (lastX == null || startX == null) return;
      const halfBar = Math.max(5, Math.abs(lastX - (previousX ?? lastX - 10)) * .55);
      const left = Math.max(0, startX - halfBar);
      const width = Math.max(16, Math.min(container.clientWidth - left, lastX + halfBar - left));
      setZoneGeometry((old) => old && Math.abs(old.left - left) < .5 && Math.abs(old.width - width) < .5 ? old : { left, width });
    };
    updateZone();
    chart.timeScale().subscribeVisibleLogicalRangeChange(updateZone);
    return () => chart.timeScale().unsubscribeVisibleLogicalRangeChange(updateZone);
  }, [points, positionTool]);

  useEffect(() => {
    const series = seriesRef.current;
    if (!series || !positionTool) { setLevelTops(null); return; }
    const coordinate = (price: number | null | undefined) => {
      const value = Number.isFinite(price) ? series.priceToCoordinate(Number(price)) : null;
      return value == null ? undefined : value;
    };
    setLevelTops({
      entry: coordinate(positionTool.entry),
      takeProfit: coordinate(positionTool.takeProfit),
      stopLoss: coordinate(positionTool.stopLoss),
      currentPrice: coordinate(positionTool.currentPrice),
    });
  }, [points, positionTool]);

  useEffect(() => {
    entryRef.current = { showEntryLine, entryPrice, entryDirection, entryLabel };
  }, [entryDirection, entryLabel, entryPrice, showEntryLine]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const mountChart = (size: { width: number; height: number }) => {
      if (chartRef.current) return;
      const chart = createChart(container, {
        width: size.width,
        height: size.height,
        layout: {
          background: { type: ColorType.Solid, color: 'transparent' },
          textColor: tradeView ? 'rgba(219,235,255,.62)' : 'rgba(255,255,255,0)',
          attributionLogo: false,
        },
        grid: {
          vertLines: { visible: tradeView, color: 'rgba(255,255,255,.045)' },
          horzLines: { visible: tradeView, color: 'rgba(255,255,255,.06)' },
        },
        leftPriceScale: { visible: false },
        rightPriceScale: {
          visible: tradeView,
          borderVisible: false,
          textColor: 'rgba(219,235,255,.68)',
        },
        timeScale: {
          visible: tradeView,
          borderVisible: false,
          fixLeftEdge: true,
          fixRightEdge: false,
          // Keep room ahead of the live quote for the next movement and the
          // position planning tool instead of pinning it to the price axis.
          rightOffset: tradeView ? 72 : 0,
          timeVisible: tradeView,
          secondsVisible: tradeView,
        },
        crosshair: {
          vertLine: { visible: tradeView, labelVisible: tradeView, color: 'rgba(255,255,255,.18)' },
          horzLine: { visible: tradeView, labelVisible: tradeView, color: 'rgba(255,255,255,.18)' },
        },
        handleScroll: tradeView,
        handleScale: tradeView,
      });
      const series = chart.addSeries(LineSeries, {
        color: '#f8fafc',
        lineWidth: 3,
        crosshairMarkerVisible: true,
        crosshairMarkerRadius: 3,
        priceLineVisible: true,
        priceLineColor: 'rgba(117,232,189,.86)',
        lastValueVisible: true,
      });
      indicatorRefs.current = [
        chart.addSeries(LineSeries, { color: 'rgba(117,232,189,.45)', lineWidth: 1, lineStyle: LineStyle.Dashed, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false }),
        chart.addSeries(LineSeries, { color: 'rgba(255,130,144,.44)', lineWidth: 1, lineStyle: LineStyle.Dashed, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false }),
      ];
      series.priceScale().applyOptions({ scaleMargins: { top: compact ? .18 : .1, bottom: compact ? .18 : .14 } });
      chartRef.current = chart;
      seriesRef.current = series;
      series.setData(pointsRef.current);
      if (pointsRef.current.length > 1) {
        chart.timeScale().fitContent();
        fittedRef.current = true;
      }
      const entry = entryRef.current;
      if (entry.showEntryLine && entry.entryPrice != null) {
        entryLineRef.current = series.createPriceLine({
          price: entry.entryPrice,
          color: entry.entryDirection === 'down' ? 'rgba(255, 82, 99, .9)' : 'rgba(117, 232, 189, .9)',
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          lineVisible: true,
          axisLabelVisible: true,
          title: entry.entryLabel,
        });
      }
    };

    let animationFrame = 0;
    let lastWidth = 0;
    let lastHeight = 0;
    const resizeNow = () => {
      animationFrame = 0;
      const size = measuredSize(container);
      if (!size) return;
      mountChart(size);
      if (size.width === lastWidth && size.height === lastHeight) return;
      chartRef.current?.resize(size.width, size.height);
      lastWidth = size.width;
      lastHeight = size.height;
    };
    const resize = () => {
      if (animationFrame) return;
      animationFrame = window.requestAnimationFrame(resizeNow);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(container);
    resizeNow();

    return () => {
      if (animationFrame) window.cancelAnimationFrame(animationFrame);
      observer.disconnect();
      chartRef.current?.remove();
      chartRef.current = null;
      seriesRef.current = null;
      indicatorRefs.current = [];
      entryLineRef.current = null;
      fittedRef.current = false;
    };
  }, [compact, tradeView]);

  useEffect(() => {
    const chart = chartRef.current;
    const series = seriesRef.current;
    if (!chart || !series) return;

    series.setData(points);
    if (points.length > 1) {
      if (!fittedRef.current) {
        const last = points.length - 1;
        // Momentum is a tick stream. Start with a wide 15-minute-style
        // context rather than magnifying a handful of recent updates.
        chart.timeScale().setVisibleLogicalRange({ from: Math.max(0, last - 900), to: last + 14 });
        fittedRef.current = true;
      } else {
        const last = points.length - 1;
        const visible = chart.timeScale().getVisibleLogicalRange();
        const span = Math.max(96, (visible?.to ?? last) - (visible?.from ?? Math.max(0, last - 900)));
        chart.timeScale().setVisibleLogicalRange({ from: Math.max(0, last - Math.max(10, span - 14)), to: last + 14 });
      }
    } else {
      fittedRef.current = false;
    }
  }, [points]);

  useEffect(() => {
    const [upper, lower] = indicatorRefs.current;
    if (!upper || !lower) return;
    upper.setData(indicators.bandUpper);
    lower.setData(indicators.bandLower);
  }, [indicators]);

  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;

    // Price lines do not extend Lightweight Charts' automatic range by
    // themselves. Include the entry only while it is near the current move.
    // A far-away entry is shown as an out-of-view marker so live movement
    // stays readable instead of collapsing into a flat line.
    series.priceScale().applyOptions({ scaleMargins: { top: compact ? .18 : .1, bottom: compact ? .18 : .14 } });
    series.applyOptions({
      autoscaleInfoProvider: showEntryLine && entryPrice != null
        ? (baseImplementation: () => AutoscaleInfo | null) => {
          const base = baseImplementation();
          if (!base?.priceRange) return { priceRange: { minValue: entryPrice, maxValue: entryPrice } };
          return {
            ...base,
            priceRange: {
              minValue: Math.min(base.priceRange.minValue, entryPrice),
              maxValue: Math.max(base.priceRange.maxValue, entryPrice),
            },
          };
        }
        : undefined,
    });
  }, [compact, entryPrice, showEntryLine]);

  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;

    const previous = entryLineRef.current;
    if (previous) {
      series.removePriceLine(previous);
      entryLineRef.current = null;
    }
    if (!showEntryLine || entryPrice == null) return;

    const priceLine = series.createPriceLine({
      price: entryPrice,
      color: entryDirection === 'down' ? 'rgba(255, 82, 99, .9)' : 'rgba(117, 232, 189, .9)',
      lineWidth: 1,
      lineStyle: LineStyle.Dashed,
      lineVisible: true,
      axisLabelVisible: true,
      title: entryLabel,
    });
    entryLineRef.current = priceLine;

    return () => {
      if (entryLineRef.current === priceLine) {
        series.removePriceLine(priceLine);
        entryLineRef.current = null;
      }
    };
  }, [entryDirection, entryLabel, entryPrice, showEntryLine]);

  return <span class={`mom-price-chart${compact ? ' compact' : ' trade'}`} role="img" aria-label={hasEntry && entryPrice != null ? `${label}. ${entryLabel} ${displayPrice(entryPrice)}.` : label}>
    <span class="mom-price-chart-canvas" ref={containerRef} />
    {!compact && <span class="chart-indicator-legend" aria-label="Chart indicators"><span class="price">Live price</span><span class="bands">BB 34 · 2σ</span></span>}
    {positionTool && !compact && <TradePositionTool {...positionTool} values={points.map((point) => point.value)} zoneGeometry={zoneGeometry} levelTops={levelTops} />}
    {hasEntry && entryPrice != null && showEntryLine && <span class={`mom-chart-entry ${entryDirection ?? 'neutral'}`} aria-hidden="true"><i></i><b>{entryLabel}</b><small>{displayPrice(entryPrice)}</small></span>}
    {hasEntry && entryPrice != null && entryViewport.offscreen && <span class={`mom-chart-entry offscreen ${entryViewport.side} ${entryDirection ?? 'neutral'}`} aria-hidden="true"><em>{entryViewport.side === 'above' ? '↑' : '↓'}</em><b>{entryLabel} out of view</b><small>{displayPrice(entryPrice)}</small></span>}
    {points.length < 2 && <span class="mom-chart-empty">Awaiting ticks</span>}
  </span>;
}
