import type { GoldCandle, GoldSide, GoldTimeframe } from './domain.ts';

/**
 * A deliberately small, OHLC-only Gold backtest engine. It has no broker,
 * database, or digit-test dependencies. A strategy can inspect completed
 * predecessor candles only; an accepted signal fills at the next candle open.
 */

export type GoldBacktestExitReason = 'STOP_LOSS' | 'TAKE_PROFIT' | 'END_OF_DATA';

export interface GoldBacktestSignal {
  side: GoldSide;
  /** Executable price level. Exactly one stop representation is required. */
  stopLoss?: number;
  stopDistance?: number;
  /** Executable price level. Exactly one target representation is required. */
  takeProfit?: number;
  takeProfitDistance?: number;
  /** Units/contracts. It is deliberately explicit rather than stake-derived. */
  volume: number;
  reason?: string;
}

export interface GoldBacktestStrategyContext {
  /** Complete candles strictly before the candle on which the order can fill. */
  history: readonly GoldCandle[];
  nextCandle: Pick<GoldCandle, 'symbolId' | 'timeframe' | 'openTime'>;
}

export type GoldBacktestStrategy = (context: GoldBacktestStrategyContext) => GoldBacktestSignal | null;

export interface GoldBacktestCosts {
  /** Fixed bid/ask spread in price units, applied as half at each side of a fill. */
  spread: number;
  /** Adverse price movement in price units, applied to every fill. */
  slippage: number;
  /** Currency cost per volume unit for each entry or exit fill. */
  commissionPerUnitPerSide: number;
}

export interface GoldBacktestConfig {
  modelVersion: string;
  initialBalance: number;
  costs: GoldBacktestCosts;
  /** A signal needs at least this many completed predecessor candles. */
  minHistoryCandles: number;
}

export interface GoldBacktestTrade {
  id: string;
  side: GoldSide;
  volume: number;
  reason: string | null;
  openedAt: number;
  closedAt: number;
  barsHeld: number;
  entryMid: number;
  entryFill: number;
  stopLoss: number;
  takeProfit: number;
  exitMid: number;
  exitFill: number;
  exitReason: GoldBacktestExitReason;
  grossPnl: number;
  netPnl: number;
  spreadCost: number;
  slippageCost: number;
  commission: number;
  totalCost: number;
}

export interface GoldBacktestMetrics {
  modelVersion: string;
  initialBalance: number;
  finalBalance: number;
  grossPnl: number;
  netPnl: number;
  totalCost: number;
  spreadCost: number;
  slippageCost: number;
  commission: number;
  tradeCount: number;
  wins: number;
  losses: number;
  winRate: number | null;
  averageWin: number;
  averageLoss: number;
  profitFactor: number | null;
  expectancy: number;
  maxDrawdown: number;
  maxDrawdownPercent: number;
  exposurePercent: number;
  maxConsecutiveWins: number;
  maxConsecutiveLosses: number;
}

export interface GoldBacktestResult {
  modelVersion: string;
  symbolId: string;
  timeframe: GoldTimeframe;
  candlesProcessed: number;
  trades: GoldBacktestTrade[];
  metrics: GoldBacktestMetrics;
}

const DEFAULT_CONFIG: GoldBacktestConfig = {
  modelVersion: 'gold-backtest-v1',
  initialBalance: 10_000,
  costs: { spread: 0, slippage: 0, commissionPerUnitPerSide: 0 },
  minHistoryCandles: 30,
};

function finitePositive(value: number, name: string, allowZero = false): void {
  if (!Number.isFinite(value) || (allowZero ? value < 0 : value <= 0)) throw new Error(`${name} must be ${allowZero ? 'non-negative' : 'positive and finite'}`);
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100_000_000) / 100_000_000;
}

function resolveConfig(patch?: Partial<GoldBacktestConfig>): GoldBacktestConfig {
  const config: GoldBacktestConfig = {
    ...DEFAULT_CONFIG,
    ...patch,
    costs: { ...DEFAULT_CONFIG.costs, ...patch?.costs },
  };
  if (!config.modelVersion.trim()) throw new Error('modelVersion is required');
  finitePositive(config.initialBalance, 'initialBalance');
  if (!Number.isInteger(config.minHistoryCandles) || config.minHistoryCandles < 1) throw new Error('minHistoryCandles must be a positive integer');
  finitePositive(config.costs.spread, 'costs.spread', true);
  finitePositive(config.costs.slippage, 'costs.slippage', true);
  finitePositive(config.costs.commissionPerUnitPerSide, 'costs.commissionPerUnitPerSide', true);
  return config;
}

function validateCandles(candles: readonly GoldCandle[]): void {
  if (candles.length === 0) throw new Error('at least one candle is required');
  const first = candles[0]!;
  for (const [index, candle] of candles.entries()) {
    if (candle.symbolId !== first.symbolId || candle.timeframe !== first.timeframe) throw new Error('all candles must have one symbol and timeframe');
    if (!candle.complete) throw new Error('backtests require complete candles only');
    if (![candle.openTime, candle.closeTime, candle.open, candle.high, candle.low, candle.close].every(Number.isFinite)
      || candle.closeTime <= candle.openTime || candle.low > Math.min(candle.open, candle.close) || candle.high < Math.max(candle.open, candle.close)) {
      throw new Error(`invalid candle at index ${index}`);
    }
    if (index > 0 && candle.openTime <= candles[index - 1]!.openTime) throw new Error('candles must be chronological and unique');
  }
}

interface OpenPosition {
  signal: GoldBacktestSignal;
  openedAt: number;
  entryMid: number;
  entryFill: number;
  stopLoss: number;
  takeProfit: number;
  barsHeld: number;
}

function validateSignal(signal: GoldBacktestSignal): void {
  finitePositive(signal.volume, 'signal.volume');
  const stopCount = Number(signal.stopLoss !== undefined) + Number(signal.stopDistance !== undefined);
  const targetCount = Number(signal.takeProfit !== undefined) + Number(signal.takeProfitDistance !== undefined);
  if (stopCount !== 1 || targetCount !== 1) throw new Error('signal must specify exactly one stop and one target');
  if (signal.stopLoss !== undefined) finitePositive(signal.stopLoss, 'signal.stopLoss');
  if (signal.takeProfit !== undefined) finitePositive(signal.takeProfit, 'signal.takeProfit');
  if (signal.stopDistance !== undefined) finitePositive(signal.stopDistance, 'signal.stopDistance');
  if (signal.takeProfitDistance !== undefined) finitePositive(signal.takeProfitDistance, 'signal.takeProfitDistance');
}

function openPosition(signal: GoldBacktestSignal, candle: GoldCandle, costs: GoldBacktestCosts): OpenPosition {
  validateSignal(signal);
  const halfSpread = costs.spread / 2;
  const entryFill = signal.side === 'BUY'
    ? candle.open + halfSpread + costs.slippage
    : candle.open - halfSpread - costs.slippage;
  const stopLoss = signal.stopLoss ?? (signal.side === 'BUY' ? entryFill - signal.stopDistance! : entryFill + signal.stopDistance!);
  const takeProfit = signal.takeProfit ?? (signal.side === 'BUY' ? entryFill + signal.takeProfitDistance! : entryFill - signal.takeProfitDistance!);
  if ((signal.side === 'BUY' && (stopLoss >= entryFill || takeProfit <= entryFill))
    || (signal.side === 'SELL' && (stopLoss <= entryFill || takeProfit >= entryFill))) {
    throw new Error('signal stop/target must bracket the executable entry price');
  }
  return { signal, openedAt: candle.openTime, entryMid: candle.open, entryFill, stopLoss, takeProfit, barsHeld: 0 };
}

interface ExitFill { fill: number; mid: number; reason: GoldBacktestExitReason; }

/**
 * OHLC cannot tell which extreme happened first. When both stop and target are
 * touched in a candle, the engine deterministically exits at the stop first.
 * That conservative convention is fixed to keep repeated runs comparable.
 */
function resolveExit(position: OpenPosition, candle: GoldCandle, costs: GoldBacktestCosts, finalCandle: boolean): ExitFill | null {
  const halfSpread = costs.spread / 2;
  const bidOpen = candle.open - halfSpread;
  const askOpen = candle.open + halfSpread;
  const bidLow = candle.low - halfSpread;
  const bidHigh = candle.high - halfSpread;
  const askLow = candle.low + halfSpread;
  const askHigh = candle.high + halfSpread;
  if (position.signal.side === 'BUY') {
    if (bidLow <= position.stopLoss) {
      const fill = Math.min(position.stopLoss, bidOpen) - costs.slippage;
      return { fill, mid: fill + halfSpread + costs.slippage, reason: 'STOP_LOSS' };
    }
    if (bidHigh >= position.takeProfit) {
      const fill = position.takeProfit - costs.slippage;
      return { fill, mid: fill + halfSpread + costs.slippage, reason: 'TAKE_PROFIT' };
    }
    if (finalCandle) {
      const fill = candle.close - halfSpread - costs.slippage;
      return { fill, mid: candle.close, reason: 'END_OF_DATA' };
    }
  } else {
    if (askHigh >= position.stopLoss) {
      const fill = Math.max(position.stopLoss, askOpen) + costs.slippage;
      return { fill, mid: fill - halfSpread - costs.slippage, reason: 'STOP_LOSS' };
    }
    if (askLow <= position.takeProfit) {
      const fill = position.takeProfit + costs.slippage;
      return { fill, mid: fill - halfSpread - costs.slippage, reason: 'TAKE_PROFIT' };
    }
    if (finalCandle) {
      const fill = candle.close + halfSpread + costs.slippage;
      return { fill, mid: candle.close, reason: 'END_OF_DATA' };
    }
  }
  return null;
}

function settle(position: OpenPosition, exit: ExitFill, closedAt: number, costs: GoldBacktestCosts, id: string): GoldBacktestTrade {
  const direction = position.signal.side === 'BUY' ? 1 : -1;
  const volume = position.signal.volume;
  const spreadCost = costs.spread * volume;
  const slippageCost = costs.slippage * 2 * volume;
  const commission = costs.commissionPerUnitPerSide * 2 * volume;
  const grossPnl = roundMoney((exit.mid - position.entryMid) * direction * volume);
  const netPnl = roundMoney((exit.fill - position.entryFill) * direction * volume - commission);
  return {
    id,
    side: position.signal.side,
    volume,
    reason: position.signal.reason?.trim() || null,
    openedAt: position.openedAt,
    closedAt,
    barsHeld: position.barsHeld,
    entryMid: position.entryMid,
    entryFill: position.entryFill,
    stopLoss: position.stopLoss,
    takeProfit: position.takeProfit,
    exitMid: exit.mid,
    exitFill: exit.fill,
    exitReason: exit.reason,
    grossPnl,
    netPnl,
    spreadCost: roundMoney(spreadCost),
    slippageCost: roundMoney(slippageCost),
    commission: roundMoney(commission),
    totalCost: roundMoney(spreadCost + slippageCost + commission),
  };
}

function metricsFor(config: GoldBacktestConfig, trades: readonly GoldBacktestTrade[], totalBars: number, heldBars: number): GoldBacktestMetrics {
  const netPnl = roundMoney(trades.reduce((sum, trade) => sum + trade.netPnl, 0));
  const grossPnl = roundMoney(trades.reduce((sum, trade) => sum + trade.grossPnl, 0));
  const spreadCost = roundMoney(trades.reduce((sum, trade) => sum + trade.spreadCost, 0));
  const slippageCost = roundMoney(trades.reduce((sum, trade) => sum + trade.slippageCost, 0));
  const commission = roundMoney(trades.reduce((sum, trade) => sum + trade.commission, 0));
  const wins = trades.filter((trade) => trade.netPnl > 0);
  const losses = trades.filter((trade) => trade.netPnl < 0);
  let balance = config.initialBalance;
  let peak = balance;
  let maxDrawdown = 0;
  let maxDrawdownPercent = 0;
  let runWins = 0;
  let runLosses = 0;
  let maxConsecutiveWins = 0;
  let maxConsecutiveLosses = 0;
  for (const trade of trades) {
    balance += trade.netPnl;
    peak = Math.max(peak, balance);
    const drawdown = peak - balance;
    maxDrawdown = Math.max(maxDrawdown, drawdown);
    maxDrawdownPercent = Math.max(maxDrawdownPercent, peak > 0 ? drawdown / peak : 0);
    if (trade.netPnl > 0) { runWins += 1; runLosses = 0; }
    else if (trade.netPnl < 0) { runLosses += 1; runWins = 0; }
    else { runWins = 0; runLosses = 0; }
    maxConsecutiveWins = Math.max(maxConsecutiveWins, runWins);
    maxConsecutiveLosses = Math.max(maxConsecutiveLosses, runLosses);
  }
  const winTotal = wins.reduce((sum, trade) => sum + trade.netPnl, 0);
  const lossTotal = losses.reduce((sum, trade) => sum + Math.abs(trade.netPnl), 0);
  return {
    modelVersion: config.modelVersion,
    initialBalance: config.initialBalance,
    finalBalance: roundMoney(config.initialBalance + netPnl),
    grossPnl,
    netPnl,
    totalCost: roundMoney(spreadCost + slippageCost + commission),
    spreadCost,
    slippageCost,
    commission,
    tradeCount: trades.length,
    wins: wins.length,
    losses: losses.length,
    winRate: trades.length > 0 ? wins.length / trades.length : null,
    averageWin: wins.length > 0 ? roundMoney(winTotal / wins.length) : 0,
    averageLoss: losses.length > 0 ? roundMoney(lossTotal / losses.length) : 0,
    profitFactor: lossTotal > 0 ? winTotal / lossTotal : null,
    expectancy: trades.length > 0 ? roundMoney(netPnl / trades.length) : 0,
    maxDrawdown: roundMoney(maxDrawdown),
    maxDrawdownPercent,
    exposurePercent: totalBars > 0 ? heldBars / totalBars : 0,
    maxConsecutiveWins,
    maxConsecutiveLosses,
  };
}

/** Runs one sequential, single-position OHLC replay. */
export function runGoldBacktest(candles: readonly GoldCandle[], strategy: GoldBacktestStrategy, patch?: Partial<GoldBacktestConfig>): GoldBacktestResult {
  validateCandles(candles);
  const config = resolveConfig(patch);
  const trades: GoldBacktestTrade[] = [];
  let position: OpenPosition | null = null;
  let heldBars = 0;
  for (let index = 0; index < candles.length; index += 1) {
    const candle = candles[index]!;
    if (position) {
      position.barsHeld += 1;
      heldBars += 1;
      const exit = resolveExit(position, candle, config.costs, index === candles.length - 1);
      if (exit) {
        trades.push(settle(position, exit, candle.closeTime, config.costs, `gold-bt-${trades.length + 1}`));
        position = null;
      }
      continue;
    }
    if (index < config.minHistoryCandles) continue;
    // history is intentionally a copy of candles before the executable bar.
    const signal = strategy({ history: candles.slice(0, index), nextCandle: { symbolId: candle.symbolId, timeframe: candle.timeframe, openTime: candle.openTime } });
    if (signal) position = openPosition(signal, candle, config.costs);
  }
  const first = candles[0]!;
  return {
    modelVersion: config.modelVersion,
    symbolId: first.symbolId,
    timeframe: first.timeframe,
    candlesProcessed: candles.length,
    trades,
    metrics: metricsFor(config, trades, candles.length, heldBars),
  };
}
