import assert from 'node:assert/strict';
import test from 'node:test';
import { assessGoldProfitProtection } from '../src/gold/profitProtection.ts';

test('Gold profit protection arms from stake and balance awareness', () => {
  const guard = assessGoldProfitProtection({ stake: 1, balance: 1_725, previousPeak: 0, profit: 2 });
  assert.equal(guard.activation, 1.725);
  assert.equal(guard.armed, true);
  assert.equal(guard.floor, 1.8);
});

test('Gold profit protection trails ten percent below the accumulated peak', () => {
  const guard = assessGoldProfitProtection({ stake: 1, balance: 1_725, previousPeak: 770, profit: 690 });
  assert.equal(guard.peak, 770);
  assert.equal(guard.floor, 693);
  assert.equal(guard.shouldClose, true);
});

test('Gold profit protection never closes before meaningful profit is accumulated', () => {
  const guard = assessGoldProfitProtection({ stake: 10, balance: 1_725, previousPeak: 4, profit: 3 });
  assert.equal(guard.armed, false);
  assert.equal(guard.shouldClose, false);
});
