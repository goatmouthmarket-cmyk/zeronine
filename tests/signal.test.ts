import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MarketRegistry } from '../src/core/marketState.ts';
import { digitCandidateQuality, isSensibleDigitCandidate, pickSignal, buildQuotePlan } from '../src/strategy/signal.ts';
import { scanMarket, featureFor } from '../src/strategy/scanner.ts';
import type { PatternInput } from '../src/strategy/scanner.ts';
import { patternWeightForStrategy } from '../src/db/store.ts';

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

test('market snapshots retain a bounded recent quote series for the dashboard chart', () => {
  const registry = new MarketRegistry({ onTick: () => undefined });
  registry.ensure('R_10');
  const epoch = Math.floor(Date.now() / 1000);
  for (let index = 0; index < 45; index++) registry.push('R_10', 100 + index, epoch + index, index % 10);

  const snapshot = registry.snapshot('R_10');
  assert.equal(snapshot.recentQuotes.length, 40);
  assert.equal(snapshot.recentQuotes[0], 105);
  assert.equal(snapshot.recentQuotes.at(-1), 144);
  assert.equal(snapshot.recentTicks.length, 45);
  assert.deepEqual(snapshot.recentTicks.at(-1), { epoch: epoch + 44, quote: 144 });
});

test('historical ticks can seed a market snapshot in one bounded update', () => {
  let updates = 0;
  const registry = new MarketRegistry({ onTick: () => { updates += 1; } });
  registry.ensure('frxXAUUSD');
  registry.seed('frxXAUUSD', Array.from({ length: 80 }, (_, index) => ({ quote: 2300 + index / 10, epoch: 1000 + index, digit: index % 10 })));
  const snapshot = registry.snapshot('frxXAUUSD');
  assert.equal(updates, 1);
  assert.equal(snapshot.recentTicks.length, 60);
  assert.deepEqual(snapshot.recentTicks[0], { epoch: 1020, quote: 2302 });
});

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
  const sorted = [...pick.candidates].sort((a, b) => b.quality - a.quality);
  assert.equal(pick.candidates[0].quality, sorted[0].quality);
  assert.ok(pick.candidates.length <= 5);
});

test('signal quality avoids spammy low-base Over 6 unless evidence is exceptional', () => {
  const sensible = {
    baseWin: 0.5,
    estWin: 0.57,
    edge: 0.044,
    expectedROI: 0.083,
    consistency: 0.8,
    entropy: 0.95,
    momentum: 0.56,
    learnedWin: null,
  };
  const lowBase = {
    baseWin: 0.3,
    estWin: 0.58,
    edge: 0.264,
    expectedROI: 0.837,
    consistency: 0.7,
    entropy: 0.9,
    momentum: 0.58,
    learnedWin: null,
  };
  assert.equal(isSensibleDigitCandidate(lowBase), false);
  assert.ok(digitCandidateQuality(sensible) > digitCandidateQuality(lowBase));
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

test('pattern_weight = 0 means learned rows change nothing (A/B control)', () => {
  const { registry, digits } = pushingRegistry([7, 8, 9]);
  const off = pickSignal(registry, 0.35, 0.01, (sym) => digits.get(sym) ?? []);
  const pattern: PatternInput = {
    weight: 0,
    rowFor: (symbol, prev) => (prev === 9 ? Array.from({ length: 10 }, (_, d) => (d === 0 ? 0.8 : 0.2 / 9)) : null),
  };
  const on = pickSignal(registry, 0.35, 0.01, (sym) => digits.get(sym) ?? [], 5, null, pattern);
  assert.deepEqual(on.candidates, off.candidates, 'weight 0 must be byte-identical');
});

test('confirmed learned rows shift estimatedWin only when weight > 0', () => {
  const digits: number[] = [];
  const rnd = (() => {
    let a = 123456789;
    return () => {
      a = (a * 1664525 + 1013904223) >>> 0;
      return a / 4294967296;
    };
  })();
  for (let k = 0; k < 1000; k++) digits.push(Math.floor(rnd() * 10));
  // the row is aligned to the CURRENT last digit (prev), so craft it to say:
  // "when the last digit is 9, next is 5 with probability 0.9" -> Over 0 wins.
  // Row must be a proper distribution; the rest of the mass sits on digit 0
  // which is a LOSS for Over 0 (wins are digits 1-9).
  const learned = Array.from({ length: 10 }, () => 0);
  learned[0] = 0.1;
  learned[5] = 0.9;
  const plain = featureFor(digits, 'over', 0);
  const blended = featureFor(digits, 'over', 0, { row: learned, weight: 1 });
  assert.notEqual(blended.estimatedWin, plain.estimatedWin, 'blend should move the estimate');
  const w50 = featureFor(digits, 'over', 0, { row: learned, weight: 0.5 });
  const mid = (blended.estimatedWin + plain.estimatedWin) / 2;
  assert.ok(Math.abs(w50.estimatedWin - mid) < 1e-9, 'half weight lands midway');
  assert.equal(blended.learnedWin, 0.9);
  const scan = scanMarket('1HZ10V', 'Volatility 10 (1s) Index', [...digits.slice(0, -1), 9], {
    weight: 1,
    rowFor: () => learned,
  });
  const over0 = scan.features.find((f) => f.direction === 'over' && f.barrier === 0)!;
  assert.equal(over0.learnedWin, 0.9);
});

test('patternWeightForStrategy: override wins, then global, clamped 0..1', () => {
  const base = {
    pattern_weight: 0,
    pattern_weight_conservative: null,
    pattern_weight_martingale: null,
    pattern_weight_boosted_martingale: null,
    pattern_weight_chase: null,
  };
  assert.equal(patternWeightForStrategy(base, 'conservative'), 0, 'global default used');
  assert.equal(patternWeightForStrategy({ ...base, pattern_weight: 0.75 }, 'martingale'), 0.75);
  assert.equal(
    patternWeightForStrategy({ ...base, pattern_weight: 0.5, pattern_weight_chase: null }, 'chase'),
    0.5,
    'null override falls back to global',
  );
  assert.equal(
    patternWeightForStrategy({ ...base, pattern_weight: 0, pattern_weight_conservative: 1 }, 'conservative'),
    1,
    'override beats global',
  );
  assert.equal(
    patternWeightForStrategy({ ...base, pattern_weight: 1, pattern_weight_martingale: 0 }, 'martingale'),
    0,
    'explicit zero override turns patterns off for that strategy only',
  );
  assert.equal(
    patternWeightForStrategy({ ...base, pattern_weight: 0.2, pattern_weight_chase: 40 }, 'chase'),
    1,
    'clamped to 1',
  );
  assert.equal(
    patternWeightForStrategy({ ...base, pattern_weight: 0, pattern_weight_boosted_martingale: -3 }, 'boosted_martingale'),
    0,
    'clamped to 0',
  );
});

test('per-strategy overrides produce per-strategy signal mixes', () => {
  const { digits } = pushingRegistry([7, 8, 9]);
  const d = digits.get('1HZ10V')!;
  const learned = Array.from({ length: 10 }, () => 0);
  learned[8] = 1; // last digit is 9; next is ~always 8 -> Over 7 wins
  const plain = scanMarket('1HZ10V', 'Volatility 10 (1s) Index', d);
  const into = scanMarket('1HZ10V', 'Volatility 10 (1s) Index', d, { weight: 1, rowFor: () => learned });
  assert.ok(
    plain.features.some((f, i) => f.estimatedWin !== into.features[i].estimatedWin),
    'ON vs OFF mixes must differ somewhere',
  );
  const boosted = into.features.filter((f) => (f.learnedWin ?? 0) > 0.5);
  assert.ok(boosted.length > 0, 'ON applies the learned row');
  assert.ok(
    into.features.every((f) => f.estimatedWin >= 0.02 && f.estimatedWin <= 0.98),
    'still clamped',
  );
});
