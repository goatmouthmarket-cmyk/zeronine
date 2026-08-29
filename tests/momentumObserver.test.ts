import test from 'node:test';
import assert from 'node:assert/strict';
import {
  discoverMomentumMarkets,
  momentumEntryGuard,
  momentumSignal,
  momentumVerificationPool,
  rankMomentumMarkets,
  scoreMomentumOpportunity,
  supportsBothMultiplierDirections,
} from '../src/momentum/observer.ts';

function series(values: number[]): Array<{ epoch: number; quote: number }> {
  return values.map((quote, index) => ({ epoch: index * 15, quote }));
}

test('momentum signal waits until all three horizons have evidence', () => {
  const signal = momentumSignal(series([100, 101]), 15);
  assert.equal(signal.direction, 'wait');
  assert.match(signal.reason, /60 seconds/i);
});

test('momentum signal identifies aligned upward and downward returns', () => {
  const up = momentumSignal(series([100, 100.1, 100.2, 100.3, 100.5]), 60);
  const down = momentumSignal(series([100, 99.9, 99.8, 99.7, 99.5]), 60);
  assert.equal(up.direction, 'up');
  assert.equal(down.direction, 'down');
  assert.ok(up.confidence >= 65);
  assert.ok(down.confidence >= 65);
});

test('momentum signal rejects mixed short-horizon movement', () => {
  const signal = momentumSignal(series([100, 100.2, 99.9, 100.2, 100]), 60);
  assert.equal(signal.direction, 'wait');
});

test('Boom and Crash native impulses carry reversal risk for momentum entries', () => {
  const boomTicks = series([100, 100.03, 100.05, 100.07, 100.08, 100.3]);
  const boomSignal = momentumSignal(boomTicks, 75);
  const boomGuard = momentumEntryGuard(
    { symbol: 'BOOM1000', display: 'Boom 1000 Index', market: 'synthetic_index' },
    boomSignal,
    boomTicks,
    null,
  );
  assert.equal(boomSignal.direction, 'up');
  assert.equal(boomGuard.ok, false);
  assert.match(boomGuard.reason ?? '', /Boom spike/i);

  const crashTicks = series([100, 99.97, 99.95, 99.93, 99.92, 99.7]);
  const crashSignal = momentumSignal(crashTicks, 75);
  const crashGuard = momentumEntryGuard(
    { symbol: 'CRASH1000', display: 'Crash 1000 Index', market: 'synthetic_index' },
    crashSignal,
    crashTicks,
    null,
  );
  assert.equal(crashSignal.direction, 'down');
  assert.equal(crashGuard.ok, false);
  assert.match(crashGuard.reason ?? '', /Crash drop/i);
});

test('historical profile can veto a live momentum opportunity', () => {
  const opportunity = scoreMomentumOpportunity(
    { symbol: 'R_BAD', display: 'Weak History', market: 'synthetic_index' },
    series([100, 100.1, 100.2, 100.3, 100.5]),
    60,
    {
      symbol: 'R_BAD',
      direction: 'up',
      windows: 12,
      wins: 3,
      losses: 9,
      win_rate: .25,
      estimated_net: -4.5,
      last_completed_at: Date.now(),
    },
  );
  assert.equal(opportunity.signal.direction, 'wait');
  assert.equal(opportunity.score, 0);
  assert.match(opportunity.entryRisk ?? '', /Historical UP research/i);
});

test('automatic market ranking prefers Bitcoin then other crypto markets', () => {
  const ranked = rankMomentumMarkets([
    { symbol: 'frxEURUSD', display: 'EUR/USD', market: 'forex' },
    { symbol: 'cryETHUSD', display: 'ETH/USD', market: 'cryptocurrency' },
    { symbol: 'cryBTCUSD', display: 'Bitcoin/USD', market: 'cryptocurrency' },
  ]);
  assert.deepEqual(ranked.map((market) => market.symbol), ['cryBTCUSD', 'cryETHUSD', 'frxEURUSD']);
});

test('verification pool interleaves market families instead of consuming one ranked family first', () => {
  const pool = momentumVerificationPool([
    { symbol: 'cryBTCUSD', display: 'Bitcoin/USD', market: 'cryptocurrency' },
    { symbol: 'cryETHUSD', display: 'ETH/USD', market: 'cryptocurrency' },
    { symbol: 'frxEURUSD', display: 'EUR/USD', market: 'forex' },
    { symbol: 'R_100', display: 'Volatility 100', market: 'synthetic_index' },
    { symbol: 'frxGBPUSD', display: 'GBP/USD', market: 'forex' },
  ], 5);
  assert.deepEqual(pool.map((market) => market.symbol), ['cryBTCUSD', 'frxEURUSD', 'R_100', 'cryETHUSD', 'frxGBPUSD']);
});

test('discovery includes open synthetic indices before contract verification', () => {
  const markets = discoverMomentumMarkets([
    { underlying_symbol: 'cryBTCUSD', underlying_symbol_name: 'BTC/USD', market: 'cryptocurrency', exchange_is_open: 1, is_trading_suspended: 0 },
    { underlying_symbol: 'R_100', underlying_symbol_name: 'Volatility 100', market: 'synthetic_index', exchange_is_open: 1, is_trading_suspended: 0 },
    { underlying_symbol: 'R_50', underlying_symbol_name: 'Volatility 50', market: 'synthetic_index', exchange_is_open: 1, is_trading_suspended: 1 },
    { underlying_symbol: 'frxEURUSD', underlying_symbol_name: 'EUR/USD', market: 'forex', exchange_is_open: 0, is_trading_suspended: 0 },
    { underlying_symbol: 'R_100', underlying_symbol_name: 'Duplicate', market: 'synthetic_index', exchange_is_open: 1, is_trading_suspended: 0 },
  ]);

  assert.deepEqual(markets.map((market) => market.symbol), ['cryBTCUSD', 'R_100']);
});

test('multiplier verification requires both actual contract directions', () => {
  assert.equal(supportsBothMultiplierDirections([{ contract_type: 'MULTUP' }, { contract_type: 'MULTDOWN' }]), true);
  assert.equal(supportsBothMultiplierDirections([{ contract_type: 'MULTUP' }, { contract_type: 'CALL' }]), false);
});
