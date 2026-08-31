import assert from 'node:assert/strict';
import test from 'node:test';
import { candlesFromHistoryRows } from '../src/gold/derivFeed.ts';

test('Deriv Gold native 15m history becomes ordered confirmation candles', () => {
  const rows = Array.from({ length: 20 }, (_, index) => ({
    epoch: 1_700_000_000 + index * 900,
    open: 2_000 + index,
    high: 2_001 + index,
    low: 1_999 + index,
    close: 2_000.5 + index,
    tick_count: 120 + index,
  })).reverse();
  const candles = candlesFromHistoryRows('frxXAUUSD', '15m', rows, (1_700_000_000 + 21 * 900) * 1000);
  assert.equal(candles.length, 20);
  assert.equal(candles[0]?.timeframe, '15m');
  assert.equal(candles[0]?.complete, true);
  assert.ok(candles.every((candle, index) => index === 0 || candle.openTime > candles[index - 1]!.openTime));
});
