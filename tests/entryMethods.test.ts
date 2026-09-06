import assert from 'node:assert/strict';
import test from 'node:test';
import { EntryMethodGate, chooseEntryChampion } from '../src/testlab/entry.ts';

test('entry gates only advance on fresh ordered ticks', () => {
  const gate = new EntryMethodGate('digits', 'confirm_2');
  const base = { product: 'digits' as const, market: 'R_10', signalId: 'signal-a', direction: 'up' as const };
  assert.equal(gate.observe({ ...base, epoch: 10 }).state, 'waiting');
  assert.equal(gate.observe({ ...base, epoch: 10 }).state, 'waiting', 'duplicate frame must not create confirmation');
  assert.equal(gate.observe({ ...base, epoch: 11 }).state, 'waiting');
  assert.equal(gate.observe({ ...base, epoch: 12 }).state, 'ready');
  assert.equal(gate.observe({ ...base, epoch: 9 }).state, 'skip', 'out-of-order data must never be accepted');
});

test('entry methods reject unsafe multiplier chase/rug-pull conditions', () => {
  const gate = new EntryMethodGate('multipliers', 'rug_pull_guard');
  const result = gate.observe({
    product: 'multipliers', market: 'BOOM300N', signalId: 'boom', epoch: 1,
    direction: 'up', rugRisk: 0.8, extension: 0.1,
  });
  assert.equal(result.state, 'skip');
  assert.match(result.reason, /rug-pull/);
});

test('gold entry waits for a completed candle and a valid wick', () => {
  const gate = new EntryMethodGate('gold', 'wick_reject');
  const base = { product: 'gold' as const, market: 'frxXAUUSD', signalId: 'gold', direction: 'up' as const, wickRejection: 0.8 };
  assert.equal(gate.observe({ ...base, epoch: 1, completedCandle: false }).state, 'waiting');
  assert.equal(gate.observe({ ...base, epoch: 2, completedCandle: true }).state, 'ready');
});

test('free agent requires meaningful fresh evidence and respects incumbent hysteresis', () => {
  const now = 1_000_000;
  const rows = [
    { product: 'digits' as const, methodId: 'instant' as const, samples: 80, netPnl: 8, maxDrawdown: 2, averageDelay: 0, updatedAt: now },
    { product: 'digits' as const, methodId: 'confirm_1' as const, samples: 80, netPnl: 8.01, maxDrawdown: 2, averageDelay: 1, updatedAt: now },
  ];
  const held = chooseEntryChampion(rows, { product: 'digits', incumbent: 'instant', now, challengerMargin: 0.05 });
  assert.equal(held.methodId, 'instant');
  const promoted = chooseEntryChampion([{ ...rows[1], netPnl: 20 }], { product: 'digits', incumbent: 'instant', now });
  assert.equal(promoted.methodId, 'confirm_1');
  const stale = chooseEntryChampion([{ ...rows[1], updatedAt: 0 }], { product: 'digits', now, freshnessMs: 10 });
  assert.equal(stale.methodId, null);
});
