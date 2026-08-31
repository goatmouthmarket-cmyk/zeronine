import assert from 'node:assert/strict';
import test from 'node:test';
import type { GoldCandle, GoldSymbol } from '../src/gold/domain.ts';
import { GoldResearchService } from '../src/gold/researchService.ts';

const NOW = 1_750_000_000_000;
const symbol: GoldSymbol = {
  id: 'gold', name: 'XAUUSD', displayName: 'Gold / US Dollar', digits: 2,
  pointSize: .01, pipSize: .01, minVolume: .01, maxVolume: 100, volumeStep: .01,
  minStopDistance: .1, marginRate: .02, tradingStatus: 'open', sessions: [],
};

function candles(timeframe: '5m' | '15m', slope: number): GoldCandle[] {
  const interval = timeframe === '5m' ? 300_000 : 900_000;
  return Array.from({ length: 36 }, (_, index) => {
    const open = 2_000 + index * slope;
    const close = open + slope * .75;
    return {
      symbolId: symbol.id, timeframe, openTime: NOW - (36 - index) * interval,
      closeTime: NOW - (35 - index) * interval, open, high: Math.max(open, close) + .2,
      low: Math.min(open, close) - .2, close, tickVolume: 100 + index, complete: true,
    };
  });
}

test('Gold research service accepts a symbol/candles/quote and publishes explainable state', () => {
  const service = new GoldResearchService({ now: () => NOW });
  service.setSymbol(symbol);
  service.replaceCandles('5m', candles('5m', .7));
  service.replaceCandles('15m', candles('15m', .7));
  const state = service.ingestQuote({ symbolId: symbol.id, bid: 2_025, ask: 2_025.1, timestamp: NOW - 50, receivedAt: NOW, sequence: 1 });
  assert.equal(state.mode, 'research');
  assert.equal(state.signal?.direction, 'BUY');
  assert.equal(state.recentSignals.length, 1);
  assert.equal(state.quote?.spread, .09999999999990905);
});

test('settled own-trade knowledge applies only a bounded sample-gated confidence adjustment', () => {
  const prepare = (service: GoldResearchService) => {
    service.setSymbol(symbol);
    service.replaceCandles('5m', candles('5m', .7));
    service.replaceCandles('15m', candles('15m', .7));
    return service.ingestQuote({ symbolId: symbol.id, bid: 2_025, ask: 2_025.1, timestamp: NOW - 50, receivedAt: NOW, sequence: 1 });
  };
  const baseline = prepare(new GoldResearchService({ now: () => NOW }));
  const calibrated = prepare(new GoldResearchService({ now: () => NOW, tradeKnowledge: () => ({ samples: 30, winRate: .9 }) }));
  assert.equal(calibrated.signal?.direction, baseline.signal?.direction);
  assert.equal(calibrated.signal?.confidence, Math.min(100, (baseline.signal?.confidence ?? 0) + 8));
  assert.match(calibrated.signal?.reasons.join(' ') ?? '', /Own-trade evidence.*30 BUY contracts.*\+8 confidence/);

  const sparse = prepare(new GoldResearchService({ now: () => NOW, tradeKnowledge: () => ({ samples: 19, winRate: 1 }) }));
  assert.equal(sparse.signal?.confidence, baseline.signal?.confidence);
});

test('Gold research service rejects duplicate/out-of-order quotes without replacing research state', () => {
  const service = new GoldResearchService({ now: () => NOW });
  service.setSymbol(symbol);
  service.replaceCandles('5m', candles('5m', .7));
  service.replaceCandles('15m', candles('15m', .7));
  service.ingestQuote({ symbolId: symbol.id, bid: 2_025, ask: 2_025.1, timestamp: NOW - 50, receivedAt: NOW, sequence: 2 });
  const rejected = service.ingestQuote({ symbolId: symbol.id, bid: 2_024, ask: 2_024.1, timestamp: NOW - 60, receivedAt: NOW, sequence: 1 });
  assert.equal(rejected.quote?.bid, 2_025);
  assert.match(rejected.lastRejectedTick ?? '', /out-of-order/);
});

test('changing an active Gold symbol clears cross-instrument market state', () => {
  const service = new GoldResearchService({ now: () => NOW });
  service.setSymbol(symbol);
  service.replaceCandles('5m', candles('5m', .7));
  service.setSymbol({ ...symbol, id: 'gold-2', name: 'XAUUSD.m' });
  const state = service.state();
  assert.equal(state.quote, null);
  assert.equal(state.signal, null);
  assert.deepEqual(state.candles, {});
});
