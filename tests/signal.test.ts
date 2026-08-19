import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MarketRegistry } from '../src/core/marketState.ts';
import { pickSignal, buildQuotePlan } from '../src/strategy/signal.ts';

function pushingRegistry(digitPattern: number[]): { registry: MarketRegistry; digits: Map<string, number[]> } {
  const registry = new MarketRegistry({ onTick: () => undefined });
  registry.ensure('1HZ10V');
  registry.setDisplay('1HZ10V', 'Volatility 10 (1s) Index');
  registry.ensure('1HZ25V');
  registry.setDisplay('1HZ25V', 'Volatility 25 (1s) Index');
  const now = Math.floor(Date.now() / 1000) - 120;
  const digits = new Map<string, number[]>();
  for (const sym of ['1HZ10V', '1HZ25V']) digits.set(sym, []);
  for (let i = 0; i < 700; i++) {
    const d = digitPattern[i % digitPattern.length];
    registry.push('1HZ10V', 1000 + i / 100, now + i, d);
    digits.get('1HZ10V')!.push(d);
    registry.push('1HZ25V', 3000 + i / 100, now + i, (9 - d) % 10);
    digits.get('1HZ25V')!.push((9 - d) % 10);
  }
  return { registry, digits };
}

test('pickSignal holds (WAIT) when no market has a credible edge', () => {
  // Near-uniform digits: no barrier shows a regime tilt worth betting.
  const { registry, digits } = pushingRegistry([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  const pick = pickSignal(registry, 0.35, 0.01, (sym) => digits.get(sym) ?? []);
  assert.equal(pick.holds, true);
  assert.ok(pick.candidates.length <= 5);
});

test('pickSignal shortlists an edge candidate when the regime is skewed', () => {
  // Digits stuck around 7-9: Over barriers clearly above baseline.
  const { registry, digits } = pushingRegistry([7, 8, 9]);
  const pick = pickSignal(registry, 0.35, 0.01, (sym) => digits.get(sym) ?? []);
  assert.equal(pick.holds, false);
  assert.ok(pick.candidates.length > 0, 'expected a shortlist');
  const best = pick.candidates[0];
  assert.ok(best.edge > 0, `expected positive edge, got ${best.edge}`);
  assert.equal(best.direction, 'over');
  assert.ok(best.estWin > 0.5);
  assert.ok(Number.isFinite(best.expectedROI));
});

test('pickSignal ranks best candidate first and caps the shortlist', () => {
  const { registry, digits } = pushingRegistry([7, 8, 9]);
  const pick = pickSignal(registry, 0.35, 0.01, (sym) => digits.get(sym) ?? []);
  const sorted = [...pick.candidates].sort((a, b) => b.edge - a.edge);
  assert.equal(pick.candidates[0].edge, sorted[0].edge);
  assert.ok(pick.candidates.length <= 5);
});

test('buildQuotePlan covers the shortlist with unique per-market options', () => {
  const { registry, digits } = pushingRegistry([7, 8, 9]);
  const pick = pickSignal(registry, 0.35, 0.01, (sym) => digits.get(sym) ?? []);
  const plan = buildQuotePlan(pick);
  assert.ok(plan.length > 0 && plan.length <= 6);
  assert.ok(
    plan.some((o) => o.market === pick.candidates[0].market && o.barrier === pick.candidates[0].barrier),
    'best candidate present',
  );
  const keys = new Set(plan.map((o) => `${o.market}|${o.direction}|${o.barrier}`));
  assert.equal(keys.size, plan.length, 'no duplicate options');
});