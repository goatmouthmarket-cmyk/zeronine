import assert from 'node:assert/strict';
import test from 'node:test';
import { scanMarket } from '../src/strategy/scanner.ts';
import { chronologicalReplayEvents } from '../src/testlab/backtest.ts';
import type { MarketData } from '../src/testlab/backtest.ts';

function market(symbol: string, epochs: number[]): MarketData {
  return {
    symbol,
    digits: Array.from({ length: 1002 }, (_, index) => index % 10),
    sampled: epochs.map((epoch, index) => ({
      k: 1000 + index,
      epoch,
      settleEpoch: epoch + 1,
      scan: scanMarket(symbol, symbol, Array.from({ length: 1001 + index }, (_, digit) => digit % 10)),
    })),
  };
}

test('chronological replay merges markets by epoch instead of replaying one market at a time', () => {
  const events = chronologicalReplayEvents([
    market('R_50', [20, 40]),
    market('R_10', [10, 30]),
  ]);

  assert.deepEqual(events.map((event) => `${event.market}@${event.epoch}`), [
    'R_10@10',
    'R_50@20',
    'R_10@30',
    'R_50@40',
  ]);
});
