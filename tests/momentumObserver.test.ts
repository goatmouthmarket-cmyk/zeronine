import test from 'node:test';
import assert from 'node:assert/strict';
import { momentumSignal } from '../src/momentum/observer.ts';

function series(values: number[]): Array<{ epoch: number; quote: number }> {
  return values.map((quote, index) => ({ epoch: index * 15, quote }));
}

test('momentum signal waits until all three horizons have evidence', () => {
  const signal = momentumSignal(series([100, 101]), 15);
  assert.equal(signal.direction, 'wait');
  assert.match(signal.reason, /60 seconds/i);
});

test('momentum signal identifies aligned upward and downward returns', () => {
  const up = momentumSignal(series([100, 100.1, 100.2, 100.3, 100.5]), 60);
  const down = momentumSignal(series([100, 99.9, 99.8, 99.7, 99.5]), 60);
  assert.equal(up.direction, 'up');
  assert.equal(down.direction, 'down');
  assert.ok(up.confidence >= 65);
  assert.ok(down.confidence >= 65);
});

test('momentum signal rejects mixed short-horizon movement', () => {
  const signal = momentumSignal(series([100, 100.2, 99.9, 100.2, 100]), 60);
  assert.equal(signal.direction, 'wait');
});
