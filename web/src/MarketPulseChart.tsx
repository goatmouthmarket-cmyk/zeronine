import { useEffect, useRef } from 'preact/hooks';
import { AreaSeries, ColorType, CrosshairMode, createChart, type IChartApi, type ISeriesApi, type Time, type AreaData } from 'lightweight-charts';

export interface MarketPulseChartProps {
  quotes: number[];
  lastEpoch: number;
  up: boolean;
  label: string;
}

export function MarketPulseChart({ quotes, lastEpoch, up, label }: MarketPulseChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Area'> | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const chart = createChart(container, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: 'rgba(255,255,255,0)',
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: 'rgba(255,255,255,.035)' },
        horzLines: { color: 'rgba(255,255,255,.035)' },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { visible: false, labelVisible: false },
        horzLine: { visible: false, labelVisible: false },
      },
      leftPriceScale: { visible: false },
      rightPriceScale: { visible: false },
      timeScale: {
        visible: false,
        borderVisible: false,
        fixLeftEdge: true,
        fixRightEdge: true,
        rightOffset: 0,
      },
      handleScroll: false,
      handleScale: false,
    });
    const series = chart.addSeries(AreaSeries, {
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: true,
      crosshairMarkerRadius: 3,
      priceFormat: { type: 'price', precision: 5, minMove: 0.00001 },
    });
    series.priceScale().applyOptions({ scaleMargins: { top: 0.14, bottom: 0.14 } });
    chartRef.current = chart;
    seriesRef.current = series;
    return () => {
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, []);

  useEffect(() => {
    const series = seriesRef.current;
    const chart = chartRef.current;
    if (!series || !chart) return;
    const color = up ? '#22c55e' : '#ff5263';
    series.applyOptions({
      lineColor: color,
      topColor: up ? 'rgba(34,197,94,.20)' : 'rgba(255,82,99,.18)',
      bottomColor: up ? 'rgba(34,197,94,0)' : 'rgba(255,82,99,0)',
    });
    const baseTime = Math.max(quotes.length, Math.trunc(lastEpoch || Date.now() / 1000));
    const data: AreaData<Time>[] = quotes.map((value, index) => ({
      time: (baseTime - quotes.length + index + 1) as Time,
      value,
    }));
    series.setData(data);
    chart.timeScale().fitContent();
  }, [quotes, lastEpoch, up]);

  return <div ref={containerRef} class="market-pulse-canvas" role="img" aria-label={`${label} recent live quote movement`} />;
}
