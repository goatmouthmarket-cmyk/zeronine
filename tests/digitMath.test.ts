import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  lastDigitOf,
  winDigits,
  estimateWinRate,
  breakevenWinRate,
  expectedProfit,
} from '../src/core/digitMath.ts';

test('lastDigitOf extracts the final digit', () => {
  assert.equal(lastDigitOf(1234.567), 7);
  assert.equal(lastDigitOf(1495.8765), 5);
  assert.equal(lastDigitOf(100.0001), 1);
  assert.equal(lastDigitOf(88.0), 8);
  assert.equal(lastDigitOf(-12.34), 4);
});

test('winDigits covers the correct digit sets', () => {
  assert.deepEqual(winDigits('over', 7), [8, 9]);
  assert.deepEqual(winDigits('over', 0), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.deepEqual(winDigits('under', 9), [0, 1, 2, 3, 4, 5, 6, 7, 8]);
  assert.deepEqual(winDigits('under', 1), [0]);
});

test('estimateWinRate sums the recent frequency over winning digits', () => {
  const allNine = Array.from({ length: 10 }, (_, i) => (i === 0 ? 0 : 0.1));
  assert.ok(Math.abs(estimateWinRate(allNine, 'over', 0) - 0.9) < 1e-9, 'over0 should be ~0.9');
  const dist = Array.from({ length: 10 }, () => 0.1);
  assert.equal(estimateWinRate(dist, 'under', 5), 0.5);
  assert.equal(estimateWinRate(dist, 'over', 5), 0.4);
});

test('breakevenWinRate and expectedProfit behave', () => {
  assert.equal(breakevenWinRate(1, 2), 0.5);
  const profit = expectedProfit(0.8, 1, 2);
  assert.ok(profit > 0, '80% win at 2x payout should be profitable');
  const loss = expectedProfit(0.2, 1, 2);
  assert.ok(loss < 0, '20% win at 2x payout should lose');
});