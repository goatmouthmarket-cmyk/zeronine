import { useEffect, useMemo, useRef } from 'preact/hooks';
import { ColorType, LineSeries, LineStyle, createChart, type AutoscaleInfo, type IChartApi, type IPriceLine, type ISeriesApi, type LineData, type Time } from 'lightweight-charts';
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

function chartData(samples: MomentumScanSample[]): LineData<Time>[] {
  let previousTime = 0;
  return samples
    .filter((sample) => Number.isFinite(sample.epoch) && Number.isFinite(sample.quote))
    .slice(-90)
    .map((sample) => {
      // Lightweight Charts requires strictly ascending timestamps. Multiple ticks can share an epoch.
      const time = Math.max(Math.trunc(sample.epoch), previousTime + 1);
      previousTime = time;
      return { time: time as Time, value: sample.quote };
    });
}

function displayPrice(value: number) {
  return value.toLocaleString(undefined, { maximumFractionDigits: 8 });
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
  const entryLineRef = useRef<IPriceLine | null>(null);
  const points = useMemo(() => chartData(samples ?? []), [samples]);
  const hasEntry = !compact && Number.isFinite(entryPrice);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const chart = createChart(container, {
      width: Math.max(1, container.clientWidth),
      height: Math.max(1, container.clientHeight),
      layout: { background: { type: ColorType.Solid, color: 'transparent' }, textColor: 'rgba(255,255,255,0)', attributionLogo: false },
      grid: {
        vertLines: { visible: false },
        horzLines: { visible: false },
      },
      leftPriceScale: { visible: false },
      rightPriceScale: { visible: false },
      timeScale: { visible: false, borderVisible: false, fixLeftEdge: true, fixRightEdge: true, rightOffset: 0 },
      crosshair: { vertLine: { visible: false, labelVisible: false }, horzLine: { visible: false, labelVisible: false } },
      handleScroll: false,
      handleScale: false,
    });
    const series = chart.addSeries(LineSeries, {
      color: '#75e8bd',
      lineWidth: compact ? 1 : 2,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    });
    series.priceScale().applyOptions({ scaleMargins: { top: compact ? .18 : .12, bottom: compact ? .18 : .12 } });
    chartRef.current = chart;
    seriesRef.current = series;

    const resize = () => chart.resize(Math.max(1, container.clientWidth), Math.max(1, container.clientHeight));
    const observer = new ResizeObserver(resize);
    observer.observe(container);
    resize();

    return () => {
      observer.disconnect();
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      entryLineRef.current = null;
    };
  }, [compact]);

  useEffect(() => {
    const chart = chartRef.current;
    const series = seriesRef.current;
    if (!chart || !series) return;

    const rising = points.length < 2 || points[points.length - 1]!.value >= points[0]!.value;
    series.applyOptions({ color: rising ? '#75e8bd' : '#ff5263' });
    series.setData(points);
    if (points.length > 1) chart.timeScale().fitContent();
  }, [points]);

  useEffect(() => {
    const series = seriesRef.current;
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
    const series = seriesRef.current;
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
    {hasEntry && entryPrice != null && <span class={`mom-chart-entry ${entryDirection ?? 'neutral'}`} aria-hidden="true"><i></i><b>{entryLabel}</b><small>{displayPrice(entryPrice)}</small></span>}
    {points.length < 2 && <span class="mom-chart-empty">Awaiting ticks</span>}
  </div>;
}
