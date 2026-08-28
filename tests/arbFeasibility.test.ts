import assert from 'node:assert/strict';
import test from 'node:test';
import { assessDualLegFeasibility, canConsiderDualLegExecution } from '../src/arbitrage/feasibility.ts';

test('dual-leg feasibility confirms only identical provider settlement events', () => {
  const result = assessDualLegFeasibility(
    { leg: 'under', status: 'filled', buySentAt: 100, buyCompletedAt: 120, contractId: 'u', dateStart: 10, dateExpiry: 11, exitTickTime: 11 },
    { leg: 'over', status: 'filled', buySentAt: 102, buyCompletedAt: 124, contractId: 'o', dateStart: 10, dateExpiry: 11, exitTickTime: 11 },
  );
  assert.equal(result.status, 'both_filled');
  assert.equal(result.alignment, 'same_settlement_event');
  assert.equal(result.buyRequestGapMs, 2);
  assert.equal(canConsiderDualLegExecution(result), true);
});

test('a single fill remains partial and never becomes an arbitrage success', () => {
  const result = assessDualLegFeasibility(
    { leg: 'under', status: 'filled', buySentAt: 100, contractId: 'u' },
    { leg: 'over', status: 'rejected', buySentAt: 101, errorCode: 'ContractPurchaseError' },
  );
  assert.equal(result.status, 'partial_fill');
  assert.equal(result.alignment, 'unknown_settlement_alignment');
  assert.equal(canConsiderDualLegExecution(result), false);
});

test('different expiry ticks are not treated as aligned', () => {
  const result = assessDualLegFeasibility(
    { leg: 'under', status: 'filled', buySentAt: 100, contractId: 'u', dateStart: 10, dateExpiry: 11, exitTickTime: 11 },
    { leg: 'over', status: 'filled', buySentAt: 101, contractId: 'o', dateStart: 10, dateExpiry: 12, exitTickTime: 12 },
  );
  assert.equal(result.alignment, 'different_settlement_event');
});
