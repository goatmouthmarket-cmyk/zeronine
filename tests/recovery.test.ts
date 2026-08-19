import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planRecovery, type LadderOption, type RecoveryContext } from '../src/strategy/recovery.ts';

// Real-quote ladder: ratios are payout/ask, win rates slightly above the
// break-even so positive-EV candidates exist on the mid barriers.
function ladder(): LadderOption[] {
  return [
    { direction: 'over', barrier: 1, estWin: 0.84, ask: 1, payout: 1.2 }, // ev +0.008
    { direction: 'over', barrier: 3, estWin: 0.66, ask: 1, payout: 1.63 }, // ev +0.076
    { direction: 'over', barrier: 5, estWin: 0.44, ask: 1, payout: 2.4 }, // ev +0.056 (best score)
    { direction: 'over', barrier: 7, estWin: 0.2, ask: 1, payout: 4.5 },
    { direction: 'under', barrier: 9, estWin: 0.85, ask: 1, payout: 1.2 }, // ev +0.02
  ];
}

function ctx(patch: Partial<RecoveryContext> = {}): RecoveryContext {
  return {
    mode: 'base',
    streak: 0,
    debt: 0,
    attempts: 0,
    cycleStake: 0,
    peakBalance: 0,
    baseStake: 1,
    maxStake: 25,
    minRecoveryWinRate: 0.3,
    minExtremeWin: 0.75,
    martingaleSteps: 5,
    maxConsecutiveLosses: 10,
    strategy: 'conservative',
    multiplier: 3,
    recoveryBuffer: 0.5,
    chaseAmortize: 0.35,
    maxRecoveryDebt: 50,
    maxRecoveryExposure: 100,
    maxDrawdownPct: 20,
    ...patch,
  };
}

const pref = { direction: 'over', barrier: 1 } as const;

test('base state (no debt) uses base stake and preferred barrier for every strategy', () => {
  for (const strategy of ['conservative', 'martingale', 'boosted_martingale', 'chase'] as const) {
    const d = planRecovery(ladder(), ctx({ strategy }), pref);
    assert.equal(d.stake, 1, `stake (${strategy})`);
    assert.equal(d.barrier, 1, `barrier (${strategy})`);
    assert.equal(d.reason, 'base', `reason (${strategy})`);
    assert.equal(d.holds, false);
  }
});

test('conservative recovers the lost amount with one win, not flat bets', () => {
  // Conservative only plays the safe extremes (Over 0 / Under 9) and skips a
  // side when its losing digit is hot: Over 0 at 0.62 fails the 0.75 gate.
  const conservativeLadder: LadderOption[] = [
    { direction: 'over', barrier: 0, estWin: 0.62, ask: 1, payout: 1.6 },
    { direction: 'over', barrier: 0, estWin: 0.93, ask: 1, payout: 1.6 },
    { direction: 'under', barrier: 9, estWin: 0.9, ask: 1, payout: 1.8 }, // gain 0.8 -> 6/0.8 = 7.5
  ];
  const d = planRecovery(conservativeLadder, ctx({ strategy: 'conservative', mode: 'recovering', streak: 4, debt: 6 }), {
    direction: 'over',
    barrier: 0,
  });
  assert.equal(d.reason, 'conservative');
  assert.equal(d.barrier, 9);
  assert.ok(Math.abs(d.stake - 6 / 0.8) < 1e-6, `stake ${d.stake}`);
});

test('martingale clears the whole debt on one winning bet', () => {
  // With no max-stake cap the deepest-probability Under 9 wins the score
  // (full required stake, efficiency 1). debt 7 / 0.2 = 35.
  const d = planRecovery(ladder(), ctx({ strategy: 'martingale', mode: 'recovering', streak: 1, debt: 7 }), pref);
  assert.equal(d.reason, 'martingale');
  assert.equal(d.barrier, 9);
  assert.ok(Math.abs(d.stake - 7 / 0.2) < 1e-6, `stake ${d.stake}`);
});

test('boosted martingale adds a half base-stake buffer to the recovery target', () => {
  // target = debt + baseStake * recoveryBuffer = 10.5; 10.5 / 0.2 = 52.5.
  const d = planRecovery(
    ladder(),
    ctx({ strategy: 'boosted_martingale', mode: 'recovering', streak: 2, debt: 10 }),
    pref,
  );
  assert.equal(d.reason, 'boosted_martingale');
  assert.ok(Math.abs(d.stake - 10.5 / 0.2) < 1e-6, `stake ${d.stake}`);
});

test('chase amortizes the debt at 35% per winning bet', () => {
  // target = min(10, 10 * 0.35) = 3.5. With a partial target the scoring is
  // dominated by win probability, so the deepest-probability Under 9 is
  // chosen: 3.5 / 0.2 = 17.5.
  const d = planRecovery(ladder(), ctx({ strategy: 'chase', mode: 'recovering', streak: 1, debt: 10 }), pref);
  assert.equal(d.reason, 'chase');
  assert.equal(d.barrier, 9);
  assert.ok(Math.abs(d.stake - 3.5 / 0.2) < 1e-6, `stake ${d.stake}`);
});

test('stake never drops below the flat base stake', () => {
  // Tiny debt still bets at least the base stake on the best candidate.
  const d = planRecovery(ladder(), ctx({ strategy: 'martingale', mode: 'recovering', streak: 1, debt: 0.3 }), pref);
  assert.ok(d.stake >= 1, `stake ${d.stake}`);
});

test('no stake cap: full required stake is bet even when it exceeds max_stake', () => {
  const d = planRecovery(
    ladder(),
    ctx({ strategy: 'martingale', mode: 'recovering', streak: 1, debt: 40, maxStake: 25 }),
    pref,
  );
  assert.equal(d.holds, false);
  assert.ok(Math.abs(d.stake - 40 / 0.2) < 1e-6, `stake ${d.stake} (should not be capped)`);
});

test('chase keeps escalating beyond max_stake when the required stake overflows', () => {
  const d = planRecovery(ladder(), ctx({ strategy: 'chase', mode: 'recovering', streak: 1, debt: 10, maxStake: 2 }), pref);
  assert.ok(Math.abs(d.stake - 3.5 / 0.2) < 1e-6, `stake ${d.stake} (should not be capped)`);
});

test('holds when debt cap is reached', () => {
  const d = planRecovery(
    ladder(),
    ctx({ strategy: 'martingale', mode: 'recovering', streak: 0, debt: 60, maxRecoveryDebt: 50 }),
    pref,
  );
  assert.equal(d.holds, true);
  assert.match(d.holdReason ?? '', /debt cap/);
});

test('holds when exposure cap would be exceeded', () => {
  const d = planRecovery(
    ladder(),
    ctx({ strategy: 'martingale', mode: 'recovering', streak: 0, debt: 30, cycleStake: 90, maxRecoveryExposure: 100 }),
    pref,
  );
  assert.equal(d.holds, true);
  assert.match(d.holdReason ?? '', /exposure cap/);
});

test('holds when consecutive loss cap is reached (stop + cooldown rail)', () => {
  const d = planRecovery(
    ladder(),
    ctx({ strategy: 'martingale', mode: 'recovering', streak: 10, debt: 10, maxConsecutiveLosses: 10 }),
    pref,
  );
  assert.equal(d.holds, true);
  assert.match(d.holdReason ?? '', /consecutive loss cap/);
});

test('holds with no positive-edge when nothing clears the EV gate', () => {
  const badLadder = ladder().map((o) => ({ ...o, estWin: o.estWin * 0.75 }));
  const d = planRecovery(badLadder, ctx({ strategy: 'martingale', mode: 'recovering', streak: 1, debt: 5 }), pref);
  assert.equal(d.holds, true);
  assert.match(d.holdReason ?? '', /no positive-edge/);
});

test('rejects candidates whose win probability is too low regardless of score', () => {
  // estWin 0.2 below minRecoveryWinRate 0.3 - must not drive a deep Over 7.
  const d = planRecovery(ladder(), ctx({ strategy: 'martingale', mode: 'recovering', streak: 1, debt: 7 }), pref);
  assert.notEqual(d.barrier, 7);
});