import { useEffect, useRef } from 'preact/hooks';
import { CandlestickSeries, ColorType, CrosshairMode, createChart, type CandlestickData, type IChartApi, type ISeriesApi, type Time } from 'lightweight-charts';

export interface MarketPulseChartProps {
  ticks: Array<{ epoch: number; quote: number }>;
  label: string;
}

export function buildCandles(ticks: Array<{ epoch: number; quote: number }>): CandlestickData<Time>[] {
  const clean = ticks.filter((tick) => Number.isFinite(tick.epoch) && Number.isFinite(tick.quote) && tick.quote > 0).sort((a, b) => a.epoch - b.epoch);
  if (!clean.length) return [];
  const span = Math.max(1, clean.at(-1)!.epoch - clean[0]!.epoch);
  const bucketSeconds = span > 900 ? 60 : span > 240 ? 15 : span > 80 ? 5 : 1;
  const candles = new Map<number, CandlestickData<Time>>();
  for (const tick of clean) {
    const bucket = Math.floor(tick.epoch / bucketSeconds) * bucketSeconds;
    const current = candles.get(bucket);
    if (!current) candles.set(bucket, { time: bucket as Time, open: tick.quote, high: tick.quote, low: tick.quote, close: tick.quote });
    else { current.high = Math.max(current.high, tick.quote); current.low = Math.min(current.low, tick.quote); current.close = tick.quote; }
  }
  return [...candles.values()];
}

function measuredSize(element: HTMLElement): { width: number; height: number } | null {
  const width = Math.floor(element.clientWidth);
  const height = Math.floor(element.clientHeight);
  return width > 0 && height > 0 ? { width, height } : null;
}

export function MarketPulseChart({ ticks, label }: MarketPulseChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const latestTicksRef = useRef(ticks);

  useEffect(() => { latestTicksRef.current = ticks; }, [ticks]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const mountChart = (size: { width: number; height: number }) => {
      if (chartRef.current) return;
      const chart = createChart(container, {
        width: size.width, height: size.height,
        layout: { background: { type: ColorType.Solid, color: 'transparent' }, textColor: 'rgba(255,255,255,0)', attributionLogo: false },
        grid: { vertLines: { color: 'rgba(255,255,255,.035)' }, horzLines: { color: 'rgba(255,255,255,.035)' } },
        crosshair: { mode: CrosshairMode.Normal, vertLine: { color: 'rgba(255,255,255,.16)', labelVisible: false }, horzLine: { color: 'rgba(255,255,255,.16)', labelVisible: false } },
        leftPriceScale: { visible: false }, rightPriceScale: { visible: false },
        timeScale: { visible: false, borderVisible: false, fixLeftEdge: true, fixRightEdge: true, rightOffset: 1 },
        handleScroll: false, handleScale: false,
      });
      const series = chart.addSeries(CandlestickSeries, {
        upColor: '#22c55e', downColor: '#ff5263', borderUpColor: '#22c55e', borderDownColor: '#ff5263',
        wickUpColor: '#75e8bd', wickDownColor: '#ff8290', priceLineVisible: false, lastValueVisible: false,
      });
      series.priceScale().applyOptions({ scaleMargins: { top: 0.12, bottom: 0.12 } });
      series.setData(buildCandles(latestTicksRef.current));
      chart.timeScale().fitContent();
      chartRef.current = chart; seriesRef.current = series;
    };
    const resize = () => {
      const size = measuredSize(container);
      if (!size) return;
      mountChart(size);
      chartRef.current?.resize(size.width, size.height);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(container);
    resize();
    return () => { observer.disconnect(); chartRef.current?.remove(); chartRef.current = null; seriesRef.current = null; };
  }, []);

  useEffect(() => {
    const series = seriesRef.current;
    const chart = chartRef.current;
    if (!series || !chart) return;
    series.setData(buildCandles(ticks));
    chart.timeScale().fitContent();
  }, [ticks]);

  return <div ref={containerRef} class="market-pulse-canvas" role="img" aria-label={`${label} recent OHLC candlestick chart with wicks`} />;
}
