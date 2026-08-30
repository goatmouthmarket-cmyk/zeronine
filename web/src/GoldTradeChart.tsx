import { useEffect, useMemo, useRef } from 'preact/hooks';
import {
  ColorType,
  LineSeries,
  LineStyle,
  createChart,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type LineData,
  type Time,
} from 'lightweight-charts';
import type { GoldCandleState, GoldQuoteState, GoldSide } from './store';

export interface GoldTradeChartProps {
  candles?: GoldCandleState[];
  quote?: GoldQuoteState | null;
  label: string;
  entryPrice?: number | null;
  stopLoss?: number | null;
  takeProfit?: number | null;
  side?: GoldSide | null;
  muted?: boolean;
  lockLabel?: string | null;
}

function toChartTime(ms: number): Time {
  return Math.trunc(ms / 1000) as Time;
}

function lineData(candles: GoldCandleState[]): LineData<Time>[] {
  return candles
    .filter((candle) => Number.isFinite(candle.openTime)
      && Number.isFinite(candle.close))
    .slice(-140)
    .map((candle) => ({
      time: toChartTime(candle.openTime),
      value: candle.close,
    }));
}

function displayPrice(value: number, digits = 2): string {
  return value.toLocaleString(undefined, { minimumFractionDigits: Math.min(2, digits), maximumFractionDigits: Math.max(2, digits) });
}

export function GoldTradeChart({
  candles,
  quote,
  label,
  entryPrice,
  stopLoss,
  takeProfit,
  side,
  muted = false,
  lockLabel,
}: GoldTradeChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const linesRef = useRef<IPriceLine[]>([]);
  const data = useMemo(() => lineData(candles ?? []), [candles]);
  const digits = Math.max(2, Math.min(5, String((quote?.mid ?? data.at(-1)?.value ?? 0).toFixed(5)).split('.')[1]?.length ?? 2));
  const lastPrice = quote?.mid ?? data.at(-1)?.value ?? null;
  const high = data.length ? Math.max(...data.map((point) => point.value)) : null;
  const low = data.length ? Math.min(...data.map((point) => point.value)) : null;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const chart = createChart(container, {
      width: Math.max(1, container.clientWidth),
      height: Math.max(1, container.clientHeight),
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: 'rgba(219,235,255,.68)',
        attributionLogo: false,
      },
      grid: {
        vertLines: { visible: true, color: 'rgba(255,255,255,.045)' },
        horzLines: { visible: true, color: 'rgba(255,255,255,.06)' },
      },
      leftPriceScale: { visible: false },
      rightPriceScale: { visible: true, borderVisible: false },
      timeScale: {
        visible: true,
        borderVisible: false,
        fixLeftEdge: true,
        fixRightEdge: true,
        rightOffset: 6,
        timeVisible: true,
      },
      crosshair: {
        vertLine: { visible: true, labelVisible: true, color: 'rgba(255,255,255,.18)' },
        horzLine: { visible: true, labelVisible: true, color: 'rgba(255,255,255,.18)' },
      },
      handleScroll: true,
      handleScale: true,
    });
    const series = chart.addSeries(LineSeries, {
      color: '#f4c96b',
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: true,
    });
    series.priceScale().applyOptions({ scaleMargins: { top: .1, bottom: .14 } });
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
      linesRef.current = [];
    };
  }, []);

  useEffect(() => {
    const chart = chartRef.current;
    const series = seriesRef.current;
    if (!chart || !series) return;
    series.setData(data);
    if (data.length > 1) chart.timeScale().fitContent();
  }, [data]);

  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;
    series.applyOptions(muted ? {
      color: 'rgba(244,201,107,.4)',
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
    } : {
      color: '#f4c96b',
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: false,
    });
  }, [muted]);

  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;
    for (const line of linesRef.current) series.removePriceLine(line);
    const nextLines: IPriceLine[] = [];
    const addLine = (price: number | null | undefined, title: string, color: string, style: LineStyle) => {
      if (!Number.isFinite(price)) return;
      nextLines.push(series.createPriceLine({
        price: Number(price),
        title,
        color,
        lineWidth: 1,
        lineStyle: style,
        axisLabelVisible: true,
        lineVisible: true,
      }));
    };
    addLine(entryPrice, side ? `${side} entry` : 'Entry', muted ? 'rgba(170,176,190,.7)' : side === 'SELL' ? 'rgba(255,82,99,.9)' : 'rgba(244,201,107,.95)', LineStyle.Dashed);
    addLine(takeProfit, 'TP', muted ? 'rgba(170,176,190,.55)' : 'rgba(117,232,189,.9)', LineStyle.Dotted);
    addLine(stopLoss, 'SL', muted ? 'rgba(170,176,190,.55)' : 'rgba(255,82,99,.9)', LineStyle.Dotted);
    linesRef.current = nextLines;
  }, [entryPrice, muted, side, stopLoss, takeProfit]);

  return <div class="gold-trade-chart" role="img" aria-label={label}>
    <div class="gold-trade-chart-canvas" ref={containerRef} />
    {lockLabel && <div class="gold-chart-lock-badge" role="status">Locked · {lockLabel}</div>}
    <div class="gold-chart-readout" aria-hidden="true">
      <span>{lastPrice == null ? 'No live price' : displayPrice(lastPrice, digits)}</span>
      <small>{high == null || low == null ? 'Awaiting candles' : `H ${displayPrice(high, digits)} · L ${displayPrice(low, digits)}`}</small>
    </div>
    {data.length < 2 && <span class="gold-chart-empty">Awaiting Gold price data</span>}
  </div>;
}
