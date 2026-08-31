import { useEffect, useRef } from 'preact/hooks';
import { AreaSeries, ColorType, CrosshairMode, createChart, type IChartApi, type ISeriesApi, type Time, type AreaData } from 'lightweight-charts';

export interface MarketPulseChartProps {
  quotes: number[];
  lastEpoch: number;
  up: boolean;
  label: string;
}

function measuredSize(element: HTMLElement): { width: number; height: number } | null {
  const width = Math.floor(element.clientWidth);
  const height = Math.floor(element.clientHeight);
  return width > 0 && height > 0 ? { width, height } : null;
}

function applyMarketPulseData(chart: IChartApi, series: ISeriesApi<'Area'>, quotes: number[], lastEpoch: number, up: boolean): void {
  const color = up ? '#22c55e' : '#ff5263';
  series.applyOptions({
    lineColor: color,
    topColor: up ? 'rgba(34,197,94,.20)' : 'rgba(255,82,99,.18)',
    bottomColor: up ? 'rgba(34,197,94,0)' : 'rgba(255,82,99,0)',
  });
  const baseTime = Math.max(quotes.length, Math.trunc(lastEpoch || Date.now() / 1000));
  const data: AreaData<Time>[] = quotes.map((value, index) => ({ time: (baseTime - quotes.length + index + 1) as Time, value }));
  series.setData(data);
  chart.timeScale().fitContent();
}

export function MarketPulseChart({ quotes, lastEpoch, up, label }: MarketPulseChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Area'> | null>(null);
  const latestRef = useRef({ quotes, lastEpoch, up });

  useEffect(() => { latestRef.current = { quotes, lastEpoch, up }; }, [quotes, lastEpoch, up]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const mountChart = (size: { width: number; height: number }) => {
      if (chartRef.current) return;
      const chart = createChart(container, {
        width: size.width, height: size.height,
        layout: { background: { type: ColorType.Solid, color: 'transparent' }, textColor: 'rgba(255,255,255,0)', attributionLogo: false },
        grid: { vertLines: { color: 'rgba(255,255,255,.035)' }, horzLines: { color: 'rgba(255,255,255,.035)' } },
        crosshair: { mode: CrosshairMode.Normal, vertLine: { visible: false, labelVisible: false }, horzLine: { visible: false, labelVisible: false } },
        leftPriceScale: { visible: false }, rightPriceScale: { visible: false },
        timeScale: { visible: false, borderVisible: false, fixLeftEdge: true, fixRightEdge: true, rightOffset: 0 },
        handleScroll: false, handleScale: false,
      });
      const series = chart.addSeries(AreaSeries, {
        lineWidth: 2, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: true,
        crosshairMarkerRadius: 3, priceFormat: { type: 'price', precision: 5, minMove: 0.00001 },
      });
      series.priceScale().applyOptions({ scaleMargins: { top: 0.14, bottom: 0.14 } });
      chartRef.current = chart; seriesRef.current = series;
      applyMarketPulseData(chart, series, latestRef.current.quotes, latestRef.current.lastEpoch, latestRef.current.up);
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
    applyMarketPulseData(chart, series, quotes, lastEpoch, up);
  }, [quotes, lastEpoch, up]);

  return <div ref={containerRef} class="market-pulse-canvas" role="img" aria-label={`${label} recent live quote movement`} />;
}
