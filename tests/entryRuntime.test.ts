import assert from 'node:assert/strict';
import test from 'node:test';
import { EntryResearchRuntime } from '../src/testlab/entryRuntime.ts';

test('entry research records only pending virtual outcomes and promotes independently per product', () => {
  let now = 1_000;
  const runtime = new EntryResearchRuntime({ now: () => now, minSamples: 1, challengerMargin: 0 });
  const observation = { product: 'digits' as const, market: 'R_10', signalId: 'signal-1', direction: 'up' as const, epoch: 1 };
  runtime.observe(observation);
  assert.equal(runtime.recordOutcome({ product: 'digits', methodId: 'instant', signalId: 'missing', pnl: 5 }), false);
  now += 1_000;
  assert.equal(runtime.recordOutcome({ product: 'digits', methodId: 'instant', signalId: 'signal-1', pnl: 5 }), true);
  const state = runtime.state();
  const digits = state.products.find((row) => row.product === 'digits')!;
  const instant = digits.methods.find((row) => row.methodId === 'instant')!;
  assert.equal(instant.samples, 1);
  assert.equal(instant.netPnl, 5);
  assert.equal(instant.wins, 1);
  assert.equal(digits.champion.methodId, 'instant');
  assert.equal(state.products.find((row) => row.product === 'gold')!.methods.every((row) => row.samples === 0), true);
});

test('entry research ignores duplicate readiness and never lets observer failures escape', () => {
  const runtime = new EntryResearchRuntime({ minSamples: 1, onState: () => { throw new Error('dashboard offline'); } });
  const observation = { product: 'multipliers' as const, market: 'BOOM300N', signalId: 'signal-1', direction: 'up' as const, epoch: 1 };
  runtime.observe(observation);
  runtime.observe(observation);
  const state = runtime.state().products.find((row) => row.product === 'multipliers')!;
  assert.equal(state.methods.find((row) => row.methodId === 'instant')!.openSamples, 1);
});

test('entry research restores resolved evidence and its champion after restart', () => {
  let now = 10;
  const first = new EntryResearchRuntime({ now: () => now, minSamples: 1, challengerMargin: 0 });
  first.observe({ product: 'digits', market: 'R_10', signalId: 'persist-1', direction: 'up', epoch: 1 });
  now += 1_000;
  assert.equal(first.recordOutcome({ product: 'digits', methodId: 'instant', signalId: 'persist-1', pnl: 3 }), true);
  const restored = new EntryResearchRuntime({ now: () => now, minSamples: 1, challengerMargin: 0, initialState: first.state() });
  const method = restored.state().products.find((product) => product.product === 'digits')!.methods.find((row) => row.methodId === 'instant')!;
  assert.equal(method.samples, 1);
  assert.equal(method.netPnl, 3);
  assert.equal(restored.state().products.find((product) => product.product === 'digits')!.champion.methodId, 'instant');
});
