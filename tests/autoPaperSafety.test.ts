import assert from 'node:assert/strict';
import { test } from 'node:test';
import { shouldScheduleAutoDemoPaperSweep } from '../src/config.ts';

test('automatic demo paper sweeps require an explicit opt-in and a positive interval', () => {
  assert.equal(
    shouldScheduleAutoDemoPaperSweep({ autoDemoPaperSweepsEnabled: false, autoPaperIntervalMs: 30 * 60 * 1000 }),
    false,
    'a configured interval alone must not purchase demo contracts',
  );
  assert.equal(
    shouldScheduleAutoDemoPaperSweep({ autoDemoPaperSweepsEnabled: true, autoPaperIntervalMs: 0 }),
    false,
    'zero means disabled, never every scheduler tick',
  );
  assert.equal(
    shouldScheduleAutoDemoPaperSweep({ autoDemoPaperSweepsEnabled: true, autoPaperIntervalMs: -1 }),
    false,
  );
  assert.equal(
    shouldScheduleAutoDemoPaperSweep({ autoDemoPaperSweepsEnabled: true, autoPaperIntervalMs: 60_000 }),
    true,
  );
});
