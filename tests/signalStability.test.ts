import assert from 'node:assert/strict';
import test from 'node:test';
import { SignalStabilizer, type SignalEnvelope } from '../web/src/signalStability.ts';

interface Candidate {
  market: string;
  direction: string;
  barrier: number;
  edge: number;
}

function signal(...candidates: Candidate[]): SignalEnvelope<Candidate> {
  return { candidates, holds: candidates.length === 0, reason: candidates.length === 0 ? 'no edge' : '' };
}

function candidate(market: string, edge: number): Candidate {
  return { market, direction: 'over', barrier: 0, edge };
}

test('signal stabilizer changes only after six sustained materially better rankings', () => {
  const stabilizer = new SignalStabilizer<Candidate>();
  assert.equal(stabilizer.update(signal(candidate('A', 0.04)), 0)?.candidates[0]?.market, 'A');
  assert.equal(stabilizer.update(signal(candidate('B', 0.08)), 1_500)?.candidates[0]?.market, 'A');
  assert.equal(stabilizer.update(signal(candidate('B', 0.08)), 3_000)?.candidates[0]?.market, 'A');
  assert.equal(stabilizer.update(signal(candidate('B', 0.08)), 4_500)?.candidates[0]?.market, 'A');
  assert.equal(stabilizer.update(signal(candidate('B', 0.08)), 6_000)?.candidates[0]?.market, 'A');
  assert.equal(stabilizer.update(signal(candidate('B', 0.08)), 7_500)?.candidates[0]?.market, 'A');
  assert.equal(stabilizer.update(signal(candidate('B', 0.08)), 9_000)?.candidates[0]?.market, 'B');
});

test('signal stabilizer ignores minor rank changes and transient empty frames', () => {
  const stabilizer = new SignalStabilizer<Candidate>();
  stabilizer.update(signal(candidate('A', 0.04)), 0);
  assert.equal(stabilizer.update(signal(candidate('B', 0.06)), 1_500)?.candidates[0]?.market, 'A');
  assert.equal(stabilizer.update(signal(), 3_000)?.candidates[0]?.market, 'A');
  assert.equal(stabilizer.update(signal(), 18_000), null);
});

test('signal stabilizer promotes a persistent challenger after the current signal disappears', () => {
  const stabilizer = new SignalStabilizer<Candidate>();
  stabilizer.update(signal(candidate('A', 0.08)), 0);
  stabilizer.update(signal(candidate('B', 0.04)), 1_000);
  stabilizer.update(signal(candidate('B', 0.04)), 16_000);
  stabilizer.update(signal(candidate('B', 0.04)), 17_500);
  stabilizer.update(signal(candidate('B', 0.04)), 19_000);
  stabilizer.update(signal(candidate('B', 0.04)), 20_500);
  stabilizer.update(signal(candidate('B', 0.04)), 22_000);
  assert.equal(stabilizer.update(signal(candidate('B', 0.04)), 23_500)?.candidates[0]?.market, 'B');
});
