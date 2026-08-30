import { useEffect, useMemo, useRef } from 'preact/hooks';
import {
  CandlestickSeries,
  ColorType,
  LineStyle,
  createChart,
  type CandlestickData,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
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
}

function toChartTime(ms: number): Time {
  return Math.trunc(ms / 1000) as Time;
}

function candleData(candles: GoldCandleState[]): CandlestickData<Time>[] {
  return candles
    .filter((candle) => Number.isFinite(candle.openTime)
      && Number.isFinite(candle.open)
      && Number.isFinite(candle.high)
      && Number.isFinite(candle.low)
      && Number.isFinite(candle.close))
    .slice(-140)
    .map((candle) => ({
      time: toChartTime(candle.openTime),
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
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
}: GoldTradeChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const linesRef = useRef<IPriceLine[]>([]);
  const data = useMemo(() => candleData(candles ?? []), [candles]);
  const digits = Math.max(2, Math.min(5, String((quote?.mid ?? data.at(-1)?.close ?? 0).toFixed(5)).split('.')[1]?.length ?? 2));
  const lastPrice = quote?.mid ?? data.at(-1)?.close ?? null;
  const high = data.length ? Math.max(...data.map((point) => point.high)) : null;
  const low = data.length ? Math.min(...data.map((point) => point.low)) : null;

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
    const series = chart.addSeries(CandlestickSeries, {
      upColor: '#f4c96b',
      downColor: '#ff5263',
      borderUpColor: '#f4c96b',
      borderDownColor: '#ff5263',
      wickUpColor: 'rgba(244,201,107,.86)',
      wickDownColor: 'rgba(255,82,99,.82)',
      priceLineVisible: true,
      lastValueVisible: true,
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
    addLine(entryPrice, side ? `${side} entry` : 'Entry', side === 'SELL' ? 'rgba(255,82,99,.9)' : 'rgba(244,201,107,.95)', LineStyle.Dashed);
    addLine(takeProfit, 'TP', 'rgba(117,232,189,.9)', LineStyle.Dotted);
    addLine(stopLoss, 'SL', 'rgba(255,82,99,.9)', LineStyle.Dotted);
    linesRef.current = nextLines;
  }, [entryPrice, side, stopLoss, takeProfit]);

  return <div class="gold-trade-chart" role="img" aria-label={label}>
    <div class="gold-trade-chart-canvas" ref={containerRef} />
    <div class="gold-chart-kind" aria-hidden="true">Gold candlesticks / wicks / TradingView</div>
    <div class="gold-chart-readout" aria-hidden="true">
      <span>{lastPrice == null ? 'No live price' : displayPrice(lastPrice, digits)}</span>
      <small>{high == null || low == null ? 'Awaiting candles' : `H ${displayPrice(high, digits)} · L ${displayPrice(low, digits)}`}</small>
    </div>
    {data.length < 2 && <span class="gold-chart-empty">Awaiting validated Gold candles</span>}
  </div>;
}
