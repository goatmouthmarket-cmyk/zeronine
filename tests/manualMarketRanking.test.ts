import assert from 'node:assert/strict';
import test from 'node:test';
import { confidenceForSetup, rankMarketsForSetup } from '../web/src/manualMarketRanking.ts';
import type { ManualMarket, ManualSignalCandidate } from '../web/src/manualMarketRanking.ts';

function market(symbol: string, digits: number[]): ManualMarket {
  return {
    symbol, recentDigits: digits,
  };
}

test('manual market confidence and ranking change with direction and barrier', () => {
  const high = market('HIGH', [8, 9, 8, 9, 7, 9, 8, 9]);
  const low = market('LOW', [0, 1, 0, 1, 2, 0, 1, 0]);
  assert.ok(confidenceForSetup(high, 'over', 7) > confidenceForSetup(low, 'over', 7));
  assert.ok(confidenceForSetup(low, 'under', 2) > confidenceForSetup(high, 'under', 2));
  assert.equal(rankMarketsForSetup([low, high], [], 'over', 7)[0]?.symbol, 'HIGH');
  assert.equal(rankMarketsForSetup([low, high], [], 'under', 2)[0]?.symbol, 'LOW');
});

test('an exact scanner candidate outranks empirical fallback for the same barrier', () => {
  const a = market('A', [9, 9, 9, 9]);
  const b = market('B', [0, 0, 0, 0]);
  const candidate = {
    market: 'B', direction: 'over', barrier: 7, estWin: 0.95, edge: 0.1,
  } satisfies ManualSignalCandidate;
  assert.equal(rankMarketsForSetup([a, b], [candidate], 'over', 7)[0]?.symbol, 'B');
});
