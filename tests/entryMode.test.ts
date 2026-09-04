import test from 'node:test';
import assert from 'node:assert/strict';
import { entryIntent, matchesDigitTrigger, triggerDigitsFor } from '../src/strategy/entryMode.ts';

test('digit trigger mode is directional and deliberately narrow', () => {
  assert.deepEqual(triggerDigitsFor('over'), [8, 9]);
  assert.deepEqual(triggerDigitsFor('under'), [0, 1]);
  assert.equal(matchesDigitTrigger('over', 8), true);
  assert.equal(matchesDigitTrigger('over', 7), false);
  assert.equal(matchesDigitTrigger('under', 1), true);
  assert.equal(matchesDigitTrigger('under', 2), false);
});

test('entry intent states that trigger mode retains the normal gates', () => {
  assert.match(entryIntent('digit_trigger', 'over', 9), /model and price gates/);
  assert.match(entryIntent('model', 'under', 0), /model-ranked/);
});
