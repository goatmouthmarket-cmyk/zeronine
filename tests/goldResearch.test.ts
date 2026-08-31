import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeGoldQuote, type GoldCandle, type GoldSymbol, type GoldTimeframe } from '../src/gold/domain.ts';
import { DEFAULT_GOLD_RESEARCH_CONFIG, evaluateGoldResearch } from '../src/gold/research.ts';

const NOW = 1_750_000_000_000;

const symbol: GoldSymbol = {
  id: 'xau-1', name: 'XAUUSD', displayName: 'Gold / US Dollar', digits: 2,
  pointSize: .01, pipSize: .01, minVolume: .01, maxVolume: 100, volumeStep: .01,
  minStopDistance: .1, marginRate: .02, tradingStatus: 'open', sessions: [],
};

function candles(timeframe: GoldTimeframe, slope: number, count = 36): GoldCandle[] {
  const ms = { '1m': 60_000, '5m': 300_000, '15m': 900_000, '1h': 3_600_000 }[timeframe];
  return Array.from({ length: count }, (_, index) => {
    const open = 2_000 + slope * index;
    const close = open + slope * .75;
    return {
      symbolId: symbol.id, timeframe, openTime: NOW - (count - index) * ms, closeTime: NOW - (count - index - 1) * ms,
      open, high: Math.max(open, close) + .25, low: Math.min(open, close) - .25, close,
      tickVolume: 100 + index * 2, complete: true,
    };
  });
}

function input(slope: number) {
  const primary = candles('5m', slope);
  const latest = primary.at(-1)!.close;
  return {
    symbol,
    quote: normalizeGoldQuote({ symbolId: symbol.id, bid: latest - .05, ask: latest + .05, timestamp: NOW - 500, receivedAt: NOW - 300 }),
    timeframe: '5m' as const,
    candles: { '5m': primary, '15m': candles('15m', slope) },
    now: NOW,
  };
}

test('Gold research emits an explainable BUY from aligned rising candles', () => {
  const signal = evaluateGoldResearch(input(.7));
  assert.equal(signal.direction, 'BUY');
  assert.ok(signal.score >= DEFAULT_GOLD_RESEARCH_CONFIG.buyThreshold);
  assert.ok(signal.confidence > 0);
  assert.equal(signal.modelVersion, 'gold-scalp-v2');
  assert.ok(signal.reasons.some((reason) => /agree|breaking|buyers/i.test(reason)));
  assert.ok(signal.proposedStopLoss! < signal.entryReference);
  assert.ok(signal.proposedTakeProfit! > signal.entryReference);
});

test('Gold research emits an explainable SELL from aligned falling candles', () => {
  const signal = evaluateGoldResearch(input(-.7));
  assert.equal(signal.direction, 'SELL');
  assert.ok(signal.score <= DEFAULT_GOLD_RESEARCH_CONFIG.sellThreshold);
  assert.ok(signal.proposedStopLoss! > signal.entryReference);
  assert.ok(signal.proposedTakeProfit! < signal.entryReference);
});

test('a stale quote is a hard WAIT blocker regardless of candle score', () => {
  const candidate = input(.7);
  candidate.quote.timestamp = NOW - 11_000;
  const signal = evaluateGoldResearch(candidate);
  assert.equal(signal.direction, 'WAIT');
  assert.match(signal.blockers.join(' '), /stale/i);
  assert.equal(signal.confidence, 0);
});

test('wide spreads and missing candle intervals are hard research blockers', () => {
  const candidate = input(.7);
  candidate.quote.ask = candidate.quote.bid + 10;
  candidate.quote.spread = 10;
  candidate.quote.mid = (candidate.quote.ask + candidate.quote.bid) / 2;
  for (const candle of candidate.candles['5m']!.slice(15)) {
    candle.openTime += 10 * 60_000;
    candle.closeTime += 10 * 60_000;
  }
  const signal = evaluateGoldResearch(candidate);
  assert.equal(signal.direction, 'WAIT');
  assert.match(signal.blockers.join(' '), /Missing 5m candle intervals/i);
});

test('an older Gold session closure does not block a continuous current analysis window', () => {
  const candidate = input(.7);
  candidate.candles['5m'] = candles('5m', .7, 60);
  for (const candle of candidate.candles['5m'].slice(0, 10)) {
    candle.openTime -= 2 * 24 * 60 * 60_000;
    candle.closeTime -= 2 * 24 * 60 * 60_000;
  }
  const latest = candidate.candles['5m'].at(-1)!.close;
  candidate.quote = normalizeGoldQuote({ symbolId: symbol.id, bid: latest - .05, ask: latest + .05, timestamp: NOW - 500, receivedAt: NOW - 300 });

  const signal = evaluateGoldResearch(candidate);
  assert.equal(signal.direction, 'BUY');
  assert.doesNotMatch(signal.blockers.join(' '), /Missing 5m candle intervals/i);
});

test('research requires both primary and confirmation history and stays deterministic', () => {
  const candidate = input(.7);
  candidate.candles['15m'] = candidate.candles['15m']!.slice(0, 10);
  const blocked = evaluateGoldResearch(candidate);
  assert.equal(blocked.direction, 'WAIT');
  assert.match(blocked.blockers.join(' '), /Insufficient 15m candle history/);

  const first = evaluateGoldResearch(input(.7));
  const second = evaluateGoldResearch(input(.7));
  assert.deepEqual(second, first);
});

test('an unfinished candle cannot flip a completed-candle forecast', () => {
  const candidate = input(.7);
  const baseline = evaluateGoldResearch(candidate);
  candidate.candles['5m']!.push({
    ...candidate.candles['5m']!.at(-1)!,
    openTime: NOW,
    closeTime: NOW + 300_000,
    open: 2_050,
    high: 2_051,
    low: 1_900,
    close: 1_901,
    complete: false,
  });
  const withLiveReversal = evaluateGoldResearch(candidate);
  assert.equal(withLiveReversal.direction, baseline.direction);
  assert.equal(withLiveReversal.score, baseline.score);
  assert.equal(withLiveReversal.id, baseline.id);
});
