import { useEffect, useMemo, useRef } from 'preact/hooks';
import {
  CandlestickSeries,
  ColorType,
  LineSeries,
  LineStyle,
  createChart,
  type AutoscaleInfo,
  type CandlestickData,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type LineData,
  type Time,
} from 'lightweight-charts';
import type { MomentumScanSample } from './store';

export interface MomentumPriceChartProps {
  samples?: MomentumScanSample[];
  label: string;
  compact?: boolean;
  /** Exact price at which the active research window began. */
  entryPrice?: number;
  /** Visible context for the research-window entry reference. */
  entryLabel?: string;
  entryDirection?: 'up' | 'down';
}

function chartData(samples: MomentumScanSample[], compact: boolean): LineData<Time>[] {
  let previousTime = 0;
  return samples
    .filter((sample) => Number.isFinite(sample.epoch) && Number.isFinite(sample.quote))
    .slice(compact ? -90 : -180)
    .map((sample) => {
      // Lightweight Charts requires strictly ascending timestamps. Multiple ticks can share an epoch.
      const time = Math.max(Math.trunc(sample.epoch), previousTime + 1);
      previousTime = time;
      return { time: time as Time, value: sample.quote };
    });
}

function candleData(points: LineData<Time>[]): CandlestickData<Time>[] {
  const bucketSize = 5;
  const candles: CandlestickData<Time>[] = [];
  for (let i = 0; i < points.length; i += bucketSize) {
    const bucket = points.slice(i, i + bucketSize);
    if (!bucket.length) continue;
    const values = bucket.map((point) => point.value);
    candles.push({
      time: bucket[bucket.length - 1]!.time,
      open: values[0]!,
      high: Math.max(...values),
      low: Math.min(...values),
      close: values[values.length - 1]!,
    });
  }
  return candles;
}

function displayPrice(value: number) {
  return value.toLocaleString(undefined, { maximumFractionDigits: 8 });
}

function chartStats(points: LineData<Time>[]) {
  if (!points.length) return null;
  const first = points[0]!.value;
  const last = points[points.length - 1]!.value;
  const high = Math.max(...points.map((point) => point.value));
  const low = Math.min(...points.map((point) => point.value));
  return {
    change: last - first,
    high,
    low,
    ticks: points.length,
  };
}

export function MomentumPriceChart({
  samples,
  label,
  compact = false,
  entryPrice,
  entryLabel = 'Watch entry',
  entryDirection,
}: MomentumPriceChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const entryLineRef = useRef<IPriceLine | null>(null);
  const points = useMemo(() => chartData(samples ?? [], compact), [samples, compact]);
  const candles = useMemo(() => candleData(points), [points]);
  const stats = useMemo(() => chartStats(points), [points]);
  const hasEntry = !compact && Number.isFinite(entryPrice);
  const detailed = !compact;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const chart = createChart(container, {
      width: Math.max(1, container.clientWidth),
      height: Math.max(1, container.clientHeight),
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: detailed ? 'rgba(219,235,255,.62)' : 'rgba(255,255,255,0)',
        attributionLogo: false,
      },
      grid: {
        vertLines: { visible: detailed, color: 'rgba(255,255,255,.045)' },
        horzLines: { visible: detailed, color: 'rgba(255,255,255,.06)' },
      },
      leftPriceScale: { visible: false },
      rightPriceScale: { visible: detailed, borderVisible: false },
      timeScale: {
        visible: detailed,
        borderVisible: false,
        fixLeftEdge: true,
        fixRightEdge: true,
        rightOffset: detailed ? 4 : 0,
        timeVisible: detailed,
        secondsVisible: detailed,
      },
      crosshair: {
        vertLine: { visible: detailed, labelVisible: detailed, color: 'rgba(255,255,255,.18)' },
        horzLine: { visible: detailed, labelVisible: detailed, color: 'rgba(255,255,255,.18)' },
      },
      handleScroll: detailed,
      handleScale: detailed,
    });
    const series = detailed
      ? chart.addSeries(CandlestickSeries, {
        upColor: '#75e8bd',
        downColor: '#ff5263',
        borderUpColor: '#75e8bd',
        borderDownColor: '#ff5263',
        wickUpColor: 'rgba(117,232,189,.82)',
        wickDownColor: 'rgba(255,82,99,.82)',
        priceLineVisible: true,
        lastValueVisible: true,
      })
      : chart.addSeries(LineSeries, {
        color: '#75e8bd',
        lineWidth: 1,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      });
    series.priceScale().applyOptions({ scaleMargins: { top: compact ? .18 : .14, bottom: compact ? .18 : .2 } });
    chartRef.current = chart;
    if (detailed) {
      candleSeriesRef.current = series as ISeriesApi<'Candlestick'>;
      seriesRef.current = null;
    } else {
      seriesRef.current = series as ISeriesApi<'Line'>;
      candleSeriesRef.current = null;
    }

    const resize = () => chart.resize(Math.max(1, container.clientWidth), Math.max(1, container.clientHeight));
    const observer = new ResizeObserver(resize);
    observer.observe(container);
    resize();

    return () => {
      observer.disconnect();
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      candleSeriesRef.current = null;
      entryLineRef.current = null;
    };
  }, [compact, detailed]);

  useEffect(() => {
    const chart = chartRef.current;
    const lineSeries = seriesRef.current;
    const candleSeries = candleSeriesRef.current;
    if (!chart) return;

    const rising = points.length < 2 || points[points.length - 1]!.value >= points[0]!.value;
    if (lineSeries) {
      lineSeries.applyOptions({ color: rising ? '#75e8bd' : '#ff5263' });
      lineSeries.setData(points);
    }
    if (candleSeries) {
      candleSeries.setData(candles);
    }
    if (points.length > 1) chart.timeScale().fitContent();
  }, [candles, points]);

  useEffect(() => {
    const series = seriesRef.current ?? candleSeriesRef.current;
    if (!series) return;

    // Price lines do not extend Lightweight Charts' automatic range by
    // themselves. Include the entry in autoscaling so the barrier remains
    // visible even after a sharp move away from the starting price.
    series.applyOptions({
      autoscaleInfoProvider: hasEntry && entryPrice != null
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
  }, [entryPrice, hasEntry]);

  useEffect(() => {
    const series = seriesRef.current ?? candleSeriesRef.current;
    if (!series) return;

    const previous = entryLineRef.current;
    if (previous) {
      series.removePriceLine(previous);
      entryLineRef.current = null;
    }
    if (!hasEntry || entryPrice == null) return;

    const priceLine = series.createPriceLine({
      price: entryPrice,
      color: entryDirection === 'down' ? 'rgba(255, 82, 99, .9)' : 'rgba(117, 232, 189, .9)',
      lineWidth: 1,
      lineStyle: LineStyle.Dashed,
      lineVisible: true,
      axisLabelVisible: false,
      title: entryLabel,
    });
    entryLineRef.current = priceLine;

    return () => {
      if (entryLineRef.current === priceLine) {
        series.removePriceLine(priceLine);
        entryLineRef.current = null;
      }
    };
  }, [entryDirection, entryLabel, entryPrice, hasEntry]);

  return <div class={`mom-price-chart${compact ? ' compact' : ''}`} role="img" aria-label={hasEntry && entryPrice != null ? `${label}. ${entryLabel} ${displayPrice(entryPrice)}.` : label}>
    <div class="mom-price-chart-canvas" ref={containerRef} />
    {detailed && stats && <span class={`mom-chart-stats ${stats.change >= 0 ? 'up' : 'down'}`} aria-hidden="true">
      <b>{stats.change >= 0 ? '+' : ''}{displayPrice(stats.change)}</b>
      <small>H {displayPrice(stats.high)} · L {displayPrice(stats.low)} · {stats.ticks} ticks</small>
    </span>}
    {hasEntry && entryPrice != null && <span class={`mom-chart-entry ${entryDirection ?? 'neutral'}`} aria-hidden="true"><i></i><b>{entryLabel}</b><small>{displayPrice(entryPrice)}</small></span>}
    {points.length < 2 && <span class="mom-chart-empty">Awaiting ticks</span>}
  </div>;
}
