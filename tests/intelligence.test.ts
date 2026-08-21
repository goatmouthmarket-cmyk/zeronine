import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MarketRegistry } from '../src/core/marketState.ts';
import { intelligenceFromScans } from '../src/intelligence/engine.ts';
import { featureFor, featureFromPrecompute, precomputeMarket, scanMarket } from '../src/strategy/scanner.ts';
import { pickSignal, pickSignalFromSnapshot } from '../src/strategy/signal.ts';
import { assessMarketHealth } from '../src/intelligence/health.ts';
import { assessRegime } from '../src/intelligence/regime.ts';

test('shared intelligence preserves scanner features and signal ranking', () => {
  const digits = Array.from({ length: 300 }, (_, i) => (i * 7 + Math.floor(i / 9)) % 10);
  const scan = scanMarket('R_50', 'Volatility 50', digits);
  const snapshot = intelligenceFromScans([scan], 1);

  assert.equal(snapshot.markets.get('R_50')?.scan, scan);
  const pick = pickSignalFromSnapshot(snapshot, 0, -1, 5);
  assert.equal(pick.holds, false);
  assert.equal(pick.candidates.length, 5);

  const registry = new MarketRegistry({ onTick: () => undefined });
  registry.ensure('R_50');
  registry.setDisplay('R_50', 'Volatility 50');
  registry.push('R_50', 100, Math.floor(Date.now() / 1000), digits.at(-1) ?? 0);
  const legacy = pickSignal(registry, 0, -1, () => digits, 5);
  assert.deepEqual(pick.candidates, legacy.candidates);
});

test('market precompute derives the same barrier features as the compatibility path', () => {
  const digits = Array.from({ length: 1001 }, (_, i) => (i * i + i * 3) % 10);
  const precompute = precomputeMarket(digits);
  for (const direction of ['over', 'under'] as const) {
    for (const barrier of direction === 'over' ? [0, 1, 3, 7] : [9, 8, 5, 3]) {
      assert.deepEqual(
        featureFromPrecompute(precompute, direction, barrier),
        featureFor(digits, direction, barrier),
      );
    }
  }
});

test('health and regime are deterministic descriptions of shared scanner data', () => {
  const scan = scanMarket('R_10', 'Volatility 10', Array.from({ length: 300 }, (_, i) => i % 10));
  const health = assessMarketHealth(scan);
  const regime = assessRegime(scan, undefined, 123);
  assert.ok(health.score >= 0 && health.score <= 100);
  assert.equal(regime.since, 123);
  assert.equal(regime.regime, 'favorable');
});
