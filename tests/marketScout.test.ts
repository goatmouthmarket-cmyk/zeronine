import test from 'node:test';
import assert from 'node:assert/strict';
import { MarketScout } from '../src/simulation/marketScout.ts';

test('scouts each market on subsequent ticks and ignores duplicate or stale ticks', () => {
  const scout = new MarketScout();
  scout.onTick({ market: 'A', quote: 10, digit: 9, epoch: 1 });
  scout.onTick({ market: 'B', quote: 10, digit: 1, epoch: 1 });
  assert.equal(scout.snapshot().every(row => row.samples === 0), true);
  scout.onTick({ market: 'A', quote: 10, digit: 0, epoch: 1 });
  scout.onTick({ market: 'A', quote: 10, digit: 8, epoch: 2 });
  scout.onTick({ market: 'B', quote: 10, digit: 9, epoch: 2 });
  const a = scout.snapshot().find(row => row.market === 'A' && row.direction === 'over' && row.barrier === 1)!;
  const b = scout.snapshot().find(row => row.market === 'B' && row.direction === 'under' && row.barrier === 8)!;
  assert.deepEqual([a.samples, a.wins, a.losses], [1, 1, 0]);
  assert.deepEqual([b.samples, b.wins, b.losses], [1, 0, 1]);
});

test('research window remains bounded', () => {
  const scout = new MarketScout();
  for (let epoch = 0; epoch <= 600; epoch++) scout.onTick({ market: 'A', quote: 1, digit: epoch % 10, epoch });
  assert.equal(scout.snapshot().every(row => row.samples === 500), true);
});
