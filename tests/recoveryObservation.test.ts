import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { MarketIntelligence, IntelligenceSnapshot } from '../src/intelligence/engine.ts';
import {
  evaluateRecoveryObservation,
  startRecoveryObservation,
  transitionRecoveryObservation,
} from '../src/intelligence/recoveryObservation.ts';
import { scanMarket } from '../src/strategy/scanner.ts';

function market(
  symbol: string,
  patch: Partial<Pick<MarketIntelligence['health'], 'score' | 'trend'>> & {
    regime?: MarketIntelligence['regime']['regime'];
    consistency?: number;
    previousDigit?: number;
    estimatedWin?: number;
  } = {},
): MarketIntelligence {
  const scan = scanMarket(symbol, symbol, Array.from({ length: 300 }, (_, i) => i % 10));
  return {
    scan: {
      ...scan,
      previousDigit: patch.previousDigit ?? 5,
      features: scan.features.map((feature) => ({
        ...feature,
        consistency: patch.consistency ?? 0.82,
        estimatedWin: patch.estimatedWin ?? 0.8,
      })),
    },
    health: {
      score: patch.score ?? 85,
      label: (patch.score ?? 85) >= 80 ? 'excellent' : 'healthy',
      trend: patch.trend ?? 'stable',
      reasons: [],
    },
    regime: { regime: patch.regime ?? 'stable', confidence: 80, since: 1, reasons: [] },
  };
}

function snapshot(...markets: MarketIntelligence[]): IntelligenceSnapshot {
  return { at: 1, markets: new Map(markets.map((value) => [value.scan.symbol, value])) };
}

function input(patch: Partial<Parameters<typeof evaluateRecoveryObservation>[0]> = {}) {
  return {
    market: 'R_10',
    intelligence: snapshot(market('R_10')),
    recovery: { debt: 4, streak: 1 },
    ticksSinceLoss: 0,
    lastLoss: { direction: 'over' as const, barrier: 0, digit: 0 },
    ...patch,
  };
}

test('normal recovery observes the minimum window then allows recovery', () => {
  const waiting = evaluateRecoveryObservation(input());
  assert.equal(waiting.action, 'observe');
  assert.equal(waiting.observedTicks, 0);

  const ready = evaluateRecoveryObservation(input({ ticksSinceLoss: 3 }));
  assert.equal(ready.action, 'recover');
  assert.ok(ready.readinessScore >= 55);
});

test('an immediate repeated losing digit raises deception and delays recovery', () => {
  const result = evaluateRecoveryObservation(input({
    intelligence: snapshot(market('R_10', { previousDigit: 0 })),
    ticksSinceLoss: 1,
  }));
  assert.equal(result.action, 'observe');
  assert.ok(result.deceptionScore >= 32);
  assert.ok(result.readinessScore < 100);
});

test('a safe-looking observation becomes recoverable after the configured window', () => {
  const result = evaluateRecoveryObservation(input({
    intelligence: snapshot(market('R_10', { previousDigit: 7, score: 92, consistency: 0.9 })),
    ticksSinceLoss: 3,
  }));
  assert.equal(result.action, 'recover');
  assert.ok(result.deceptionScore < 45);
});

test('dangerous conditions keep observation active when no safer market exists', () => {
  const result = evaluateRecoveryObservation(input({
    intelligence: snapshot(market('R_10', {
      score: 28,
      trend: 'deteriorating',
      regime: 'loss_cluster',
      consistency: 0.3,
      previousDigit: 0,
      estimatedWin: 0.4,
    })),
    ticksSinceLoss: 6,
  }));
  assert.equal(result.action, 'observe');
  assert.ok(result.deceptionScore >= 70);
  assert.match(result.reason, /no materially safer/);
});

test('consecutive recovery failures accumulate in pure observation state', () => {
  let state = startRecoveryObservation('R_10', { direction: 'over', barrier: 0, digit: 0 });
  state = transitionRecoveryObservation(state, { type: 'tick' });
  state = transitionRecoveryObservation(state, { type: 'recovery_lost' });
  state = transitionRecoveryObservation(state, { type: 'recovery_lost' });
  assert.equal(state.observedTicks, 0);
  assert.equal(state.recoveryFailures, 2);

  const result = evaluateRecoveryObservation(input({ ticksSinceLoss: 3, recoveryFailures: state.recoveryFailures }));
  assert.ok(result.deceptionScore >= 16);
  assert.equal(result.action, 'recover');
  assert.equal(state.market, 'R_10');
});

test('high deception switches to a materially safer market after observation', () => {
  const result = evaluateRecoveryObservation(input({
    intelligence: snapshot(
      market('R_10', { score: 28, trend: 'deteriorating', regime: 'volatile', consistency: 0.3, previousDigit: 0, estimatedWin: 0.4 }),
      market('R_25', { score: 92, regime: 'stable', consistency: 0.9, previousDigit: 7 }),
    ),
    ticksSinceLoss: 5,
  }));
  assert.equal(result.action, 'switch_market');
  assert.equal(result.switchMarket, 'R_25');
});

test('state transitions are immutable and reset only the relevant counters', () => {
  const state = startRecoveryObservation('R_10');
  const ticked = transitionRecoveryObservation(state, { type: 'tick' });
  const switched = transitionRecoveryObservation(ticked, { type: 'switch_market', market: 'R_25' });
  assert.equal(state.observedTicks, 0);
  assert.equal(ticked.observedTicks, 1);
  assert.equal(switched.observedTicks, 0);
  assert.equal(switched.market, 'R_25');
});
