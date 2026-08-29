import assert from 'node:assert/strict';
import test from 'node:test';
import { runGoldBacktest, type GoldBacktestStrategy } from '../src/gold/backtest.ts';
import type { GoldCandle } from '../src/gold/domain.ts';

function candle(index: number, open: number, high: number, low: number, close: number): GoldCandle {
  return { symbolId: 'XAUUSD', timeframe: '5m', openTime: index * 300_000, closeTime: (index + 1) * 300_000, open, high, low, close, tickVolume: 1, complete: true };
}

const buy: GoldBacktestStrategy = () => ({ side: 'BUY', volume: 2, stopDistance: 2, takeProfitDistance: 3, reason: 'test signal' });

test('Gold backtest gives a strategy only predecessor candles and fills on the next open', () => {
  const seen: number[] = [];
  const result = runGoldBacktest([
    candle(0, 100, 101, 99, 100),
    candle(1, 101, 102, 100, 101),
    candle(2, 102, 103, 101, 102),
    candle(3, 102, 106, 101.5, 105),
  ], (context) => {
    seen.push(context.history.length);
    assert.equal(context.history.at(-1)?.close, 101);
    return { side: 'BUY', volume: 1, stopDistance: 1, takeProfitDistance: 2 };
  }, { minHistoryCandles: 2, costs: { spread: 0, slippage: 0, commissionPerUnitPerSide: 0 } });
  assert.deepEqual(seen, [2]);
  assert.equal(result.trades[0]?.entryFill, 102);
  assert.equal(result.trades[0]?.exitReason, 'TAKE_PROFIT');
  assert.equal(result.trades[0]?.netPnl, 2);
});

test('Gold backtest applies spread, adverse slippage, commission and reports reconciled costs', () => {
  const result = runGoldBacktest([
    candle(0, 100, 100, 100, 100),
    candle(1, 100, 100, 100, 100),
    candle(2, 100, 106, 100, 105),
  ], buy, { minHistoryCandles: 1, initialBalance: 100, costs: { spread: 1, slippage: .25, commissionPerUnitPerSide: .1 } });
  const trade = result.trades[0]!;
  assert.equal(trade.entryFill, 100.75);
  assert.equal(trade.exitFill, 103.5);
  assert.equal(trade.grossPnl, 8.5);
  assert.equal(trade.netPnl, 5.1);
  assert.equal(trade.totalCost, 3.4);
  assert.equal(result.metrics.finalBalance, 105.1);
  assert.equal(result.metrics.spreadCost, 2);
  assert.equal(result.metrics.slippageCost, 1);
  assert.equal(result.metrics.commission, .4);
});

test('Gold backtest uses documented conservative stop-first resolution for an ambiguous OHLC bar', () => {
  const result = runGoldBacktest([
    candle(0, 100, 100, 100, 100),
    candle(1, 100, 100, 100, 100),
    candle(2, 100, 104, 96, 100),
  ], buy, { minHistoryCandles: 1 });
  assert.equal(result.trades[0]?.exitReason, 'STOP_LOSS');
  assert.equal(result.trades[0]?.netPnl, -4);
});

test('Gold backtest calculates drawdown, win/loss streaks and closes an open trade at end of data', () => {
  let calls = 0;
  const strategy: GoldBacktestStrategy = () => {
    calls += 1;
    if (calls > 2) return null;
    return { side: 'BUY', volume: 1, stopDistance: 1, takeProfitDistance: 1 };
  };
  const result = runGoldBacktest([
    candle(0, 10, 10, 10, 10),
    candle(1, 10, 12, 9, 11),
    candle(2, 11, 11, 11, 11),
    candle(3, 11, 12, 9, 10),
    candle(4, 10, 10.5, 9.5, 10.25),
  ], strategy, { minHistoryCandles: 1, initialBalance: 100 });
  assert.equal(result.trades.length, 2);
  assert.equal(result.metrics.wins, 1);
  assert.equal(result.metrics.losses, 1);
  assert.equal(result.metrics.maxConsecutiveWins, 1);
  assert.equal(result.metrics.maxConsecutiveLosses, 1);
  assert.equal(result.metrics.maxDrawdown, 1);
  assert.equal(result.metrics.exposurePercent, .4);
});

test('Gold backtest rejects incomplete or unordered historical candles', () => {
  assert.throws(() => runGoldBacktest([candle(1, 1, 1, 1, 1), candle(0, 1, 1, 1, 1)], buy), /chronological/);
  assert.throws(() => runGoldBacktest([{ ...candle(0, 1, 1, 1, 1), complete: false }], buy), /complete/);
});
