import assert from 'node:assert/strict';
import { test } from 'node:test';
import { calculateArbitrage, isComplementaryPair, syncQuality, type ArbQuote } from '../src/arbitrage/core.ts';

const quote = (direction: 'under' | 'over', barrier: number, askPrice: number, patch: Partial<ArbQuote> = {}): ArbQuote => ({
  symbol: 'R_50', currency: 'USD', duration: 1, durationUnit: 't', basis: 'payout', requestedPayout: 10,
  askPrice, payout: 10, proposalId: `${direction}-${barrier}`, direction, barrier,
  requestSentAt: 1000, receivedAt: direction === 'under' ? 1010 : 1030, roundTripMs: 10, ...patch,
});

test('calculates a positive complementary payout-basis quote precisely', () => {
  const result = calculateArbitrage({ underBarrier: 5, overBarrier: 4 }, quote('under', 5, 4.91), quote('over', 4, 5.05));
  assert.equal(result.status, 'valid');
  assert.equal(result.combinedCost, 9.96);
  assert.ok(Math.abs((result.theoreticalProfit ?? 0) - 0.04) < 0.0000001);
  assert.ok(Math.abs((result.theoreticalRoi ?? 0) - 0.4016064257) < 0.000001);
  assert.equal(result.isPositive, true);
  assert.equal(result.isHighQualityCandidate, true);
});

test('rejects non-complementary and mismatched quote parameters', () => {
  assert.equal(isComplementaryPair({ underBarrier: 5, overBarrier: 4 }), true);
  assert.equal(isComplementaryPair({ underBarrier: 5, overBarrier: 5 }), false);
  assert.equal(isComplementaryPair({ underBarrier: 9, overBarrier: 0 }), false);
  const result = calculateArbitrage({ underBarrier: 5, overBarrier: 4 }, quote('under', 5, 5.1), quote('over', 4, 5.2, { symbol: 'R_75' }));
  assert.equal(result.status, 'invalid_pair');
  const incomplete = calculateArbitrage({ underBarrier: 5, overBarrier: 4 }, quote('under', 5, 5.1));
  assert.equal(incomplete.status, 'incomplete_pair');
});

test('classifies synchronization and never calls a poor positive quote high quality', () => {
  assert.equal(syncQuality(25), 'excellent');
  assert.equal(syncQuality(50), 'good');
  assert.equal(syncQuality(100), 'fair');
  assert.equal(syncQuality(101), 'poor');
  const result = calculateArbitrage({ underBarrier: 5, overBarrier: 4 }, quote('under', 5, 4.91), quote('over', 4, 5.05, { receivedAt: 1200 }));
  assert.equal(result.quoteGapMs, 190);
  assert.equal(result.isPositive, true);
  assert.equal(result.isHighQualityCandidate, false);
});
