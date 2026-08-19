import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contractProfit } from '../src/strategy/pnl.ts';

test('win returns payout minus stake (net profit, not payout)', () => {
  assert.equal(contractProfit(true, 25, 42.5), 17.5);
  assert.ok(Math.abs(contractProfit(true, 1, 1.2) - 0.2) < 1e-9);
});

test('loss returns the negative stake', () => {
  assert.equal(contractProfit(false, 25, 42.5), -25);
});

test('ignores a bogus API profit style value (payout) instead of doubling it', () => {
  // The indicator must never show the full payout on a win.
  assert.ok(contractProfit(true, 10, 18.5) < 18.5);
  assert.equal(contractProfit(true, 10, 18.5), 8.5);
});

test('guards against missing or non-finite inputs', () => {
  assert.equal(contractProfit(true, NaN, 2), 0);
  assert.equal(contractProfit(true, 0, 2), 0);
  assert.equal(contractProfit(true, 2.5, NaN), 0);
  assert.equal(contractProfit(true, 2.5, 0), 0);
  assert.equal(contractProfit(false, 2.5, undefined as unknown as number), -2.5);
});