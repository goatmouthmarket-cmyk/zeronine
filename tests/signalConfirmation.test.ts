import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SignalConfirmationGate, confirmationTicksForMode } from '../src/strategy/signalConfirmation.ts';

const signal = (tickEpoch: number, market = 'R_25', direction: 'over' | 'under' = 'over', barrier = 4) => ({
  market,
  direction,
  barrier,
  tickEpoch,
});

test('confirmation advances only on distinct fresh ticks', () => {
  const gate = new SignalConfirmationGate();
  assert.equal(gate.observe(signal(100), 2).phase, 'watching');
  assert.equal(gate.observe(signal(100), 2).confirmations, 1, 'timer rescan must not count');
  const confirmed = gate.observe(signal(101), 2);
  assert.equal(confirmed.phase, 'confirmed');
  assert.equal(confirmed.confirmations, 2);
});

test('a changed strongest contract starts a new confirmation sequence', () => {
  const gate = new SignalConfirmationGate();
  gate.observe(signal(100), 3);
  gate.observe(signal(101), 3);
  const changedBarrier = gate.observe(signal(102, 'R_25', 'under', 6), 3);
  assert.equal(changedBarrier.phase, 'watching');
  assert.equal(changedBarrier.confirmations, 1);
  assert.equal(changedBarrier.key, 'R_25|under|6');
});

test('a rejected or stale signal decays immediately to observing', () => {
  const gate = new SignalConfirmationGate();
  gate.observe(signal(100), 2);
  assert.equal(gate.observe(null, 2).phase, 'observing');
  assert.equal(gate.observe(signal(99), 2).phase, 'watching', 'a new sequence may begin after reset');
  assert.equal(gate.observe(signal(98), 2).phase, 'observing', 'time moving backwards invalidates the sequence');
});

test('bot modes share the gate with different confirmation strictness', () => {
  assert.equal(confirmationTicksForMode('rapid'), 1);
  assert.equal(confirmationTicksForMode('balanced'), 2);
  assert.equal(confirmationTicksForMode('strict'), 3);
  assert.equal(confirmationTicksForMode('unknown'), 2);
});
