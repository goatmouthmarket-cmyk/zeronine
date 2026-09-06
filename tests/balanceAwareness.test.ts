import assert from 'node:assert/strict';
import test from 'node:test';
import { assessBalanceAwareness } from '../src/strategy/balanceAwareness.ts';

test('balance awareness protects 75% of peak bot profit and reduces the next loss budget', () => {
  const state = assessBalanceAwareness({ startBalance: 1000, currentBalance: 1092, peakBalance: 1100, runProfit: 92, peakRunProfit: 100, baseStake: 10, maxDrawdownPct: 20 });
  assert.equal(state.protectedProfit, 75);
  assert.equal(state.maxLoss, 17);
  assert.equal(state.action, 'trade');
});

test('balance awareness holds once no profit remains above the protected floor', () => {
  const state = assessBalanceAwareness({ startBalance: 1000, currentBalance: 1075, peakBalance: 1100, runProfit: 75, peakRunProfit: 100, baseStake: 1, maxDrawdownPct: 20 });
  assert.equal(state.action, 'hold');
  assert.match(state.reason, /profit floor/);
});
