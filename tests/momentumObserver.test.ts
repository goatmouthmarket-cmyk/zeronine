import test from 'node:test';
import assert from 'node:assert/strict';
import {
  discoverMomentumMarkets,
  momentumSignal,
  momentumVerificationPool,
  rankMomentumMarkets,
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
