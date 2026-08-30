import { useEffect, useMemo, useRef } from 'preact/hooks';
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
}: MomentumPriceChartProps) {
  const containerRef = useRef<HTMLSpanElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const entryLineRef = useRef<IPriceLine | null>(null);
  const points = useMemo(() => chartData(samples ?? [], compact), [samples, compact]);
  const pointsRef = useRef<LineData<Time>[]>(points);
  const fittedRef = useRef(false);
  const hasEntry = !compact && Number.isFinite(entryPrice);
  const entryRef = useRef({ hasEntry, entryPrice, entryDirection, entryLabel });
  const tradeView = !compact;

  useEffect(() => {
    pointsRef.current = points;
  }, [points]);

  useEffect(() => {
    entryRef.current = { hasEntry, entryPrice, entryDirection, entryLabel };
  }, [entryDirection, entryLabel, entryPrice, hasEntry]);

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
          fixRightEdge: true,
          rightOffset: tradeView ? 4 : 0,
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
        color: '#75e8bd',
        lineWidth: tradeView ? 2 : 1,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: tradeView,
      });
      series.priceScale().applyOptions({ scaleMargins: { top: compact ? .18 : .1, bottom: compact ? .18 : .14 } });
      chartRef.current = chart;
      seriesRef.current = series;
      series.setData(pointsRef.current);
      if (pointsRef.current.length > 1) {
        chart.timeScale().fitContent();
        fittedRef.current = true;
      }
      const entry = entryRef.current;
      if (entry.hasEntry && entry.entryPrice != null) {
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
      entryLineRef.current = null;
      fittedRef.current = false;
    };
  }, [compact, tradeView]);

  useEffect(() => {
    const chart = chartRef.current;
    const series = seriesRef.current;
    if (!chart || !series) return;

    const rising = points.length < 2 || points[points.length - 1]!.value >= points[0]!.value;
    series.applyOptions({ color: rising ? '#75e8bd' : '#ff5263' });
    series.setData(points);
    if (points.length > 1) {
      if (!fittedRef.current) {
        chart.timeScale().fitContent();
        fittedRef.current = true;
      } else {
        chart.timeScale().scrollToRealTime();
      }
    } else {
      fittedRef.current = false;
    }
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
  }, [entryDirection, entryLabel, entryPrice, hasEntry]);

  return <span class={`mom-price-chart${compact ? ' compact' : ' trade'}`} role="img" aria-label={hasEntry && entryPrice != null ? `${label}. ${entryLabel} ${displayPrice(entryPrice)}.` : label}>
    <span class="mom-price-chart-canvas" ref={containerRef} />
    {hasEntry && entryPrice != null && <span class={`mom-chart-entry ${entryDirection ?? 'neutral'}`} aria-hidden="true"><i></i><b>{entryLabel}</b><small>{displayPrice(entryPrice)}</small></span>}
    {points.length < 2 && <span class="mom-chart-empty">Awaiting ticks</span>}
  </span>;
}
