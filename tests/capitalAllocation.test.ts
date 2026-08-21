import assert from 'node:assert/strict';
import { test } from 'node:test';
import { allocateCapital } from '../src/intelligence/capitalAllocation.ts';

test('healthy stable context preserves a normal proposed stake', () => {
  const allocation = allocateCapital({
    proposedStake: 1,
    balance: 100,
    health: { score: 86 },
    regime: { regime: 'stable' },
  });
  assert.deepEqual(allocation, { requestedStake: 1, stake: 1, multiplier: 1, reasons: [] });
});

test('weak health and dangerous deception reduce exposure without changing the proposal', () => {
  const allocation = allocateCapital({
    proposedStake: 10,
    balance: 1_000,
    health: { score: 45 },
    regime: { regime: 'stable' },
    deceptionScore: 80,
  });
  assert.equal(allocation.requestedStake, 10);
  assert.equal(allocation.stake, 4.5);
  assert.equal(allocation.multiplier, 0.45);
  assert.deepEqual(allocation.reasons, ['weak health', 'deception caution']);
});

test('loss streaks and drawdown stack only as reductions', () => {
  const allocation = allocateCapital({
    proposedStake: 10,
    balance: 1_000,
    recovery: { streak: 5 },
    drawdownPct: 15,
  });
  assert.equal(allocation.stake, 3.25);
  assert.equal(allocation.multiplier, 0.325);
  assert.deepEqual(allocation.reasons, ['extended loss streak', 'drawdown']);
});

test('explicit stake and balance allocation caps can only lower exposure', () => {
  const allocation = allocateCapital({ proposedStake: 50, balance: 100, maxStake: 12 });
  assert.equal(allocation.stake, 2, 'the default allocation cap is 2% of balance');
  assert.ok(allocation.stake <= 12);
  assert.ok(allocation.stake <= allocation.requestedStake);
  assert.deepEqual(allocation.reasons, ['max stake cap', 'balance allocation cap']);
});

test('recovery target is preserved while the executable stake can be reduced', () => {
  const allocation = allocateCapital({
    proposedStake: 52.5,
    balance: 1_000,
    maxStake: 50,
    recovery: { streak: 3 },
  });
  assert.equal(allocation.requestedStake, 52.5);
  assert.equal(allocation.stake, 20, 'the planner proposal is not rewritten or increased');
  assert.ok(allocation.stake < allocation.requestedStake);
});

test('invalid proposals become non-tradable and every valid allocation is bounded by its proposal', () => {
  assert.deepEqual(allocateCapital({ proposedStake: Number.NaN }), {
    requestedStake: Number.NaN,
    stake: 0,
    multiplier: 0,
    reasons: ['invalid proposed stake'],
  });
  for (const proposedStake of [0.01, 1, 2.349, 100]) {
    const allocation = allocateCapital({
      proposedStake,
      health: { score: 0 },
      regime: { regime: 'loss_cluster' },
      deceptionScore: 100,
      recovery: { streak: 10 },
      drawdownPct: 30,
    });
    assert.ok(allocation.stake >= 0 && allocation.stake <= proposedStake);
    assert.ok(allocation.multiplier >= 0 && allocation.multiplier <= 1);
  }
});
