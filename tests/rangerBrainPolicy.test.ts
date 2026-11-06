import test from 'node:test';
import assert from 'node:assert/strict';
import { BRAIN_DEFAULT_SETTINGS, decidePaperAction, type BrainDecisionContext } from '../src/brain/policy.ts';

const BREAKEVEN = 1 / 1.95;

function context(overrides: Partial<BrainDecisionContext> = {}): BrainDecisionContext {
  return {
    market: 'Volatility 100',
    contractKind: 'OVER',
    barrier: 5,
    feedConnected: true,
    tickAgeMs: 1_200,
    candidateWinProbability: BREAKEVEN + 0.03,
    hasOpenPaperContract: false,
    timing: { outcomes: 250, breakeven: BREAKEVEN, verdict: 'favorable', hourVerdict: 'favorable' },
    ...overrides,
  };
}

test('the policy only ever recommends virtual paper shots', () => {
  const decisions = [
    decidePaperAction(context()),
    decidePaperAction(context({ feedConnected: false })),
    decidePaperAction(context({ timing: { outcomes: 0, breakeven: null, verdict: 'insufficient' } })),
  ];
  for (const decision of decisions) {
    assert.ok(['paper_shoot', 'watch', 'wait'].includes(decision.action));
    assert.ok(decision.reasonCodes.includes('PAPER_ONLY'));
  }
  assert.equal(decidePaperAction(context()).action, 'paper_shoot');
});

test('a missing or stale feed abstains before any edge is considered', () => {
  const offline = decidePaperAction(context({ feedConnected: false }));
  assert.equal(offline.action, 'wait');
  assert.deepEqual(offline.reasonCodes, ['FEED_MISSING', 'PAPER_ONLY']);

  const stale = decidePaperAction(context({ tickAgeMs: 60_000 }));
  assert.equal(stale.action, 'wait');
  assert.ok(stale.reasonCodes.includes('FEED_STALE'));

  const unknown = decidePaperAction(context({ tickAgeMs: null }));
  assert.equal(unknown.action, 'wait');
  assert.match(unknown.reason, /fresh tick timestamp/);
});

test('an unsettled virtual contract blocks a second shot', () => {
  const decision = decidePaperAction(context({ hasOpenPaperContract: true }));
  assert.equal(decision.action, 'wait');
  assert.ok(decision.reasonCodes.includes('POSITION_OPEN'));
});

test('thin evidence abstains even with a large apparent edge', () => {
  const decision = decidePaperAction(context({
    candidateWinProbability: 0.95,
    timing: { outcomes: BRAIN_DEFAULT_SETTINGS.minSamples - 1, breakeven: BREAKEVEN, verdict: 'mixed', hourVerdict: 'favorable' },
  }));
  assert.equal(decision.action, 'wait');
  assert.ok(decision.reasonCodes.includes('INSUFFICIENT_EVIDENCE'));
  assert.match(decision.reason, /100 are needed/);
});

test('an unfavorable hour blocks the shot regardless of candidate edge', () => {
  const decision = decidePaperAction(context({
    timing: { outcomes: 400, breakeven: BREAKEVEN, verdict: 'mixed', hourVerdict: 'unfavorable' },
  }));
  assert.equal(decision.action, 'wait');
  assert.ok(decision.reasonCodes.includes('UNFAVORABLE_WINDOW'));
});

test('no candidate means watching, not shooting', () => {
  const decision = decidePaperAction(context({ candidateWinProbability: null }));
  assert.equal(decision.action, 'watch');
  assert.ok(decision.reasonCodes.includes('NO_CANDIDATE'));
  assert.equal(decision.edge, null);
});

test('the edge must clear both the configured threshold and break-even', () => {
  const small = decidePaperAction(context({ candidateWinProbability: BREAKEVEN + 0.005 }));
  assert.equal(small.action, 'wait');
  assert.ok(small.reasonCodes.includes('EDGE_BELOW_THRESHOLD'));

  const zero = decidePaperAction(context({ candidateWinProbability: BREAKEVEN }));
  assert.equal(zero.action, 'wait');
  assert.ok(zero.reasonCodes.includes('EDGE_BELOW_THRESHOLD'));

  const negative = decidePaperAction(context({ candidateWinProbability: BREAKEVEN - 0.02 }));
  assert.equal(negative.action, 'wait');
  assert.ok(negative.reasonCodes.includes('EDGE_BELOW_THRESHOLD'));
});

test('a cleared edge shoots and reports both the edge and the window verdict', () => {
  const favorable = decidePaperAction(context());
  assert.equal(favorable.action, 'paper_shoot');
  assert.ok(favorable.reasonCodes.includes('EDGE_CLEARS_BREAKEVEN'));
  assert.ok(favorable.reasonCodes.includes('FAVORABLE_WINDOW'));
  assert.ok(favorable.edge != null && Math.abs(favorable.edge - 0.03) < 1e-9);
  assert.equal(favorable.evidence.outcomes, 250);

  const mixed = decidePaperAction(context({
    timing: { outcomes: 250, breakeven: BREAKEVEN, verdict: 'mixed', hourVerdict: 'mixed' },
  }));
  assert.equal(mixed.action, 'paper_shoot');
  assert.ok(mixed.reasonCodes.includes('MIXED_WINDOW'));
});

test('a missing payout cannot be treated as a good payout', () => {
  const decision = decidePaperAction(context({
    candidateWinProbability: 0.9,
    timing: { outcomes: 500, breakeven: null, verdict: 'insufficient', hourVerdict: 'insufficient' },
  }));
  assert.equal(decision.action, 'wait');
  assert.ok(decision.reasonCodes.includes('INSUFFICIENT_EVIDENCE'));
  assert.equal(decision.edge, null);
});
