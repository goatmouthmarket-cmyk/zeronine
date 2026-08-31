import assert from 'node:assert/strict';
import test from 'node:test';
import { assessExtremeEntryTiming } from '../src/strategy/entryTiming.ts';

test('extreme entry timing remains disabled until trigger and control samples validate it', () => {
  const sparse = assessExtremeEntryTiming('over', 5, { triggerTrades: 29, triggerWins: 25, otherTrades: 100, otherWins: 50 }, .55);
  assert.equal(sparse.triggerDigit, 9);
  assert.equal(sparse.validated, false);
  assert.match(sparse.reason, /needs 1 more trigger/);

  const validated = assessExtremeEntryTiming('over', 5, { triggerTrades: 50, triggerWins: 35, otherTrades: 100, otherWins: 52 }, .55);
  assert.equal(validated.validated, true);
  assert.match(validated.reason, /validated 9 trigger/);
});

test('zero timing targets Under 5 and rejects a pattern that does not beat control or price', () => {
  const wrongBarrier = assessExtremeEntryTiming('under', 6, { triggerTrades: 100, triggerWins: 80, otherTrades: 100, otherWins: 50 }, .55);
  assert.equal(wrongBarrier.triggerDigit, 0);
  assert.equal(wrongBarrier.validated, false);
  assert.match(wrongBarrier.reason, /Under 5/);

  const noLift = assessExtremeEntryTiming('under', 5, { triggerTrades: 50, triggerWins: 29, otherTrades: 100, otherWins: 57 }, .55);
  assert.equal(noLift.validated, false);
});
