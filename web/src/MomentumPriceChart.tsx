import { useEffect, useMemo, useRef } from 'preact/hooks';
import { ColorType, LineSeries, createChart, type IChartApi, type ISeriesApi, type LineData, type Time } from 'lightweight-charts';
import type { MomentumScanSample } from './store';

export interface MomentumPriceChartProps {
  samples?: MomentumScanSample[];
  label: string;
  compact?: boolean;
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

export function MomentumPriceChart({ samples, label, compact = false }: MomentumPriceChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const points = useMemo(() => chartData(samples ?? []), [samples]);

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

  return <div class={`mom-price-chart${compact ? ' compact' : ''}`} role="img" aria-label={label}>
    <div class="mom-price-chart-canvas" ref={containerRef} />
    {points.length < 2 && <span class="mom-chart-empty">Awaiting ticks</span>}
  </div>;
}
