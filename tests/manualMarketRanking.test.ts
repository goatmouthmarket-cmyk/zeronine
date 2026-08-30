import assert from 'node:assert/strict';
import test from 'node:test';
import { confidenceForSetup, isSensibleManualSetup, manualSetupScore, rankMarketsForSetup, strongestManualSetup, strongestManualSetupForBarrier, strongestManualSetups } from '../web/src/manualMarketRanking.ts';
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

test('strongest setup selects market, direction, and barrier together', () => {
  const markets = [market('A', [9, 9, 9]), market('B', [0, 0, 0])];
  const candidates: ManualSignalCandidate[] = [
    { market: 'A', direction: 'over', barrier: 4, estWin: 0.72, edge: 0.04 },
    { market: 'B', direction: 'under', barrier: 5, estWin: 0.84, edge: 0.06 },
  ];
  assert.deepEqual(strongestManualSetup(markets, candidates), {
    market: 'B', direction: 'under', barrier: 5, confidence: 0.84,
  });
});

test('best overall skips low-base Over 6 unless the scanner evidence is exceptional', () => {
  const markets = [market('A', [9, 9, 9, 9]), market('B', [4, 5, 6, 4])];
  const candidates: ManualSignalCandidate[] = [
    { market: 'A', direction: 'over', barrier: 6, estWin: 0.58, edge: 0.26 },
    { market: 'B', direction: 'over', barrier: 4, estWin: 0.57, edge: 0.04 },
  ];
  assert.equal(isSensibleManualSetup('over', 6, 0.58, 0.26), false);
  assert.ok(manualSetupScore('over', 4, 0.57, 0.04) > manualSetupScore('over', 6, 0.58, 0.26));
  assert.deepEqual(strongestManualSetup(markets, candidates), {
    market: 'B', direction: 'over', barrier: 4, confidence: 0.57,
  });
});

test('strongest setup for a barrier chooses direction and market but preserves barrier', () => {
  const markets = [market('HIGH', [9, 8, 7, 9]), market('LOW', [0, 1, 2, 0])];
  const setup = strongestManualSetupForBarrier(markets, [], 4);
  assert.deepEqual(setup, {
    market: 'HIGH', direction: 'over', barrier: 4, confidence: confidenceForSetup(markets[0]!, 'over', 4),
  });
  assert.equal(strongestManualSetupForBarrier(markets, [], 0)?.direction, 'over');
  assert.equal(strongestManualSetupForBarrier(markets, [], 9)?.direction, 'under');
});

test('an exact scanner candidate outranks empirical fallback for the same barrier', () => {
  const a = market('A', [9, 9, 9, 9]);
  const b = market('B', [0, 0, 0, 0]);
  const candidate = {
    market: 'B', direction: 'over', barrier: 7, estWin: 0.95, edge: 0.1,
  } satisfies ManualSignalCandidate;
  assert.equal(rankMarketsForSetup([a, b], [candidate], 'over', 7)[0]?.symbol, 'B');
});

test('five-at-once selection returns one strongest prediction per distinct market', () => {
  const markets = Array.from({ length: 6 }, (_, index) => market(`M${index}`, [index, index, 9 - index]));
  const candidates: ManualSignalCandidate[] = markets.flatMap((item, index) => [
    { market: item.symbol, direction: 'over' as const, barrier: 4, estWin: 0.9 - index * 0.02, edge: 0.1 },
    { market: item.symbol, direction: 'under' as const, barrier: 5, estWin: 0.5, edge: 0.01 },
  ]);
  const basket = strongestManualSetups(markets, candidates, 5);
  assert.equal(basket.length, 5);
  assert.equal(new Set(basket.map((setup) => setup.market)).size, 5);
  assert.deepEqual(basket.map((setup) => setup.market), ['M0', 'M1', 'M2', 'M3', 'M4']);
  assert.ok(basket.every((setup) => setup.direction === 'over' && setup.barrier === 4));
});
