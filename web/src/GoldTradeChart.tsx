import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import {
  ColorType,
  CandlestickSeries,
  LineStyle,
  createChart,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type CandlestickData,
  type Time,
} from 'lightweight-charts';
import type { GoldCandleState, GoldQuoteState, GoldSide } from './store';
import { TradePositionTool, type TradePositionToolProps } from './TradePositionTool';

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
  positionTool?: Omit<TradePositionToolProps, 'values'> | null;
}

function toChartTime(ms: number): Time {
  return Math.trunc(ms / 1000) as Time;
}

function candleData(candles: GoldCandleState[]): CandlestickData<Time>[] {
  return candles
    .filter((candle) => Number.isFinite(candle.openTime)
      && Number.isFinite(candle.open) && Number.isFinite(candle.high)
      && Number.isFinite(candle.low) && Number.isFinite(candle.close))
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
  muted = false,
  lockLabel,
  positionTool,
}: GoldTradeChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const linesRef = useRef<IPriceLine[]>([]);
  const [zoneGeometry, setZoneGeometry] = useState<{ left: number; width: number } | null>(null);
  const [levelTops, setLevelTops] = useState<Partial<Record<'entry' | 'takeProfit' | 'stopLoss' | 'currentPrice', number>> | null>(null);
  const initialViewportSetRef = useRef(false);
  const followLiveRef = useRef(true);
  const dataLengthRef = useRef(0);
  const latestCandleTimeRef = useRef<Time | null>(null);
  const data = useMemo(() => {
    const historical = candleData(candles ?? []);
    if (!historical.length || !Number.isFinite(quote?.mid)) return historical;
    // Candles arrive on their timeframe cadence while Deriv quotes arrive on
    // every tick. Keep the active candle's close/high/low synchronized to the
    // quote so the chart marker and the live position line never disagree.
    const last = historical[historical.length - 1]!;
    return [...historical.slice(0, -1), {
      ...last,
      high: Math.max(last.high, Number(quote!.mid)),
      low: Math.min(last.low, Number(quote!.mid)),
      close: Number(quote!.mid),
    }];
  }, [candles, quote?.mid]);
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
        // A locked right edge cancels rightOffset; leave it free so the
        // planned future area is actually visible.
        fixRightEdge: false,
        // Reserve future chart space so the active candle and planning tool
        // never sit against the price scale at the right edge.
        rightOffset: 14,
        barSpacing: 13,
        minBarSpacing: 4,
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
      upColor: '#22c55e',
      downColor: '#ff5263',
      borderUpColor: '#75e8bd',
      borderDownColor: '#ff5263',
      wickUpColor: '#75e8bd',
      wickDownColor: '#ff8290',
      priceLineVisible: false,
      lastValueVisible: false,
    });
    series.priceScale().applyOptions({ scaleMargins: { top: .1, bottom: .14 } });
    const trackViewport = (range: { to: number } | null) => {
      if (range) followLiveRef.current = range.to >= dataLengthRef.current - 1.5;
    };
    chart.timeScale().subscribeVisibleLogicalRangeChange(trackViewport);
    chartRef.current = chart;
    seriesRef.current = series;
    const resize = () => chart.resize(Math.max(1, container.clientWidth), Math.max(1, container.clientHeight));
    const observer = new ResizeObserver(resize);
    observer.observe(container);
    resize();
    return () => {
      observer.disconnect();
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(trackViewport);
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      linesRef.current = [];
      initialViewportSetRef.current = false;
      followLiveRef.current = true;
      dataLengthRef.current = 0;
      latestCandleTimeRef.current = null;
    };
  }, []);

  useEffect(() => {
    const chart = chartRef.current;
    const series = seriesRef.current;
    if (!chart || !series) return;
    const previousLatestTime = latestCandleTimeRef.current;
    series.setData(data);
    dataLengthRef.current = data.length;
    // Establish a useful live-trading viewport once. Calling fitContent on
    // every candle update overwrote the operator's manual wheel/pinch zoom.
    // Subsequent updates change only the data, so the selected zoom survives.
    if (data.length > 1 && !initialViewportSetRef.current) {
      const last = data.length - 1;
      chart.timeScale().setVisibleLogicalRange({
        from: Math.max(0, last - 31),
        to: last + 14,
      });
      initialViewportSetRef.current = true;
    } else if (data.length > 1 && followLiveRef.current && previousLatestTime !== data.at(-1)?.time) {
      // Keep following newly-opened candles only while the operator is still
      // at the live edge, while preserving a meaningful blank future area.
      const last = data.length - 1;
      const visible = chart.timeScale().getVisibleLogicalRange();
      const span = Math.max(24, (visible?.to ?? last) - (visible?.from ?? Math.max(0, last - 31)));
      chart.timeScale().setVisibleLogicalRange({
        from: Math.max(0, last - Math.max(10, span - 14)),
        to: last + 14,
      });
    }
    latestCandleTimeRef.current = data.at(-1)?.time ?? null;
  }, [data]);

  useEffect(() => {
    const series = seriesRef.current;
    if (!series || !positionTool) { setLevelTops(null); return; }
    const coordinate = (price: number | null | undefined) => {
      const value = Number.isFinite(price) ? series.priceToCoordinate(Number(price)) : null;
      return value == null ? undefined : value;
    };
    const next = {
      entry: coordinate(positionTool.entry),
      takeProfit: coordinate(positionTool.takeProfit),
      stopLoss: coordinate(positionTool.stopLoss),
      currentPrice: coordinate(positionTool.currentPrice),
    };
    setLevelTops(next);
  }, [data, positionTool]);

  useEffect(() => {
    const chart = chartRef.current;
    const container = containerRef.current;
    if (!chart || !container || !positionTool || data.length < 2) {
      setZoneGeometry(null);
      return;
    }
    const updateZone = () => {
      const last = data.at(-1)!;
      const start = data[Math.max(0, data.length - 5)]!;
      const previous = data.at(-2) ?? start;
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
  }, [data, positionTool]);

  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;
    series.priceScale().applyOptions({ scaleMargins: { top: .1, bottom: .14 } });
    series.applyOptions({ autoscaleInfoProvider: undefined });
  }, [data]);

  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;
    series.applyOptions(muted
      ? { upColor: 'rgba(170,176,190,.38)', downColor: 'rgba(130,136,150,.38)', borderUpColor: 'rgba(170,176,190,.55)', borderDownColor: 'rgba(130,136,150,.55)', wickUpColor: 'rgba(170,176,190,.5)', wickDownColor: 'rgba(130,136,150,.5)' }
      : { upColor: '#22c55e', downColor: '#ff5263', borderUpColor: '#75e8bd', borderDownColor: '#ff5263', wickUpColor: '#75e8bd', wickDownColor: '#ff8290' });
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
    if (!positionTool) {
      addLine(entryPrice, side ? `${side} entry` : 'Entry', muted ? 'rgba(170,176,190,.7)' : side === 'SELL' ? 'rgba(255,82,99,.9)' : 'rgba(244,201,107,.95)', LineStyle.Dashed);
      addLine(takeProfit, 'TP', muted ? 'rgba(170,176,190,.55)' : 'rgba(117,232,189,.9)', LineStyle.Dotted);
      addLine(stopLoss, 'SL', muted ? 'rgba(170,176,190,.55)' : 'rgba(255,82,99,.9)', LineStyle.Dotted);
    }
    linesRef.current = nextLines;
  }, [entryPrice, muted, positionTool, side, stopLoss, takeProfit]);

  return <div class="gold-trade-chart" role="img" aria-label={label}>
    <div class="gold-trade-chart-canvas" ref={containerRef} />
    {positionTool && <TradePositionTool {...positionTool} values={data.flatMap((candle) => [candle.high, candle.low])} zoneGeometry={zoneGeometry} levelTops={levelTops} />}
    {lockLabel && <div class="gold-chart-lock-badge" role="status">Locked · {lockLabel}</div>}
    <div class="gold-chart-readout" aria-hidden="true">
      <span>{lastPrice == null ? 'No live price' : displayPrice(lastPrice, digits)}</span>
      <small>{high == null || low == null ? 'Awaiting candles' : `H ${displayPrice(high, digits)} · L ${displayPrice(low, digits)}`}</small>
    </div>
    {data.length < 2 && <span class="gold-chart-empty">Awaiting Gold price data</span>}
  </div>;
}
