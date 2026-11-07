import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildLossLadder,
  buildRiskPreview,
  describeWorstCase,
  expectedTradesToTarget,
  netReturnPerUnit,
  planStake,
  projectTakeProfit,
  recoveryTarget,
  roundStake,
} from '../web/public/ranger-auto-risk.js';

const PAYOUT = 1.8; // net 0.80 per unit of stake

test('base stake with one, two and three consecutive losses stays flat', () => {
  for (const losses of [1, 2, 3]) {
    const ladder = buildLossLadder({ baseStake: 1, style: 'base', losses, payout: PAYOUT, balance: 100 });
    assert.equal(ladder.steps.length, losses);
    for (const [index, step] of ladder.steps.entries()) {
      assert.equal(step.stake, 1);
      assert.equal(step.cumulativeLoss, index + 1);
      assert.equal(step.remainingBalance, 100 - (index + 1));
      assert.equal(step.status, 'executable');
      assert.equal(step.recoveryTarget, 0);
    }
    assert.equal(ladder.exposure, losses);
    assert.equal(ladder.complete, true);
    assert.equal(ladder.blockedAt, null);
  }
});

test('martingale sizes each step from accumulated debt and live payout', () => {
  const ladder = buildLossLadder({ baseStake: 1, style: 'martingale', losses: 3, payout: PAYOUT, balance: 100 });
  assert.deepEqual(ladder.steps.map((step) => step.stake), [1, 1.25, 2.81]);
  assert.deepEqual(ladder.steps.map((step) => step.cumulativeLoss), [1, 2.25, 5.06]);
  assert.equal(ladder.steps[0].projectedNextStake, 1.25);
  assert.equal(ladder.steps[1].projectedNextStake, 2.81);
  // Nearest-cent rounding can leave a cent of debt uncovered; the ladder says so
  // rather than claiming the win clears it.
  assert.equal(ladder.steps[2].coversTarget, false);
  assert.equal(ladder.steps[2].clearingStake, 2.82);
  assert.ok((ladder.steps[2].coverageShortfall ?? 0) > 0);
  assert.equal(ladder.endDebt, 5.06);
  assert.equal(ladder.winsToRecover, 2, 'the cent-rounded recovery stake covers the debt in two wins, not one');
});

test('boosted recovery adds the profit buffer to existing debt', () => {
  const ladder = buildLossLadder({ baseStake: 1, style: 'boosted', losses: 1, payout: PAYOUT, balance: 100, startDebt: 5 });
  const step = ladder.steps[0];
  assert.equal(step.recoveryTarget, 5.5);
  assert.equal(step.stake, 6.88);
  assert.equal(step.coversTarget, true);
  assert.equal(ladder.exposure, 6.88);
});

test('chase repays a partial slice of debt per win', () => {
  assert.equal(recoveryTarget({ style: 'chase', debt: 5, baseStake: 1 }), 1.75);
  const plan = planStake({ baseStake: 1, style: 'chase', debt: 5, payout: PAYOUT, balance: 100 });
  assert.equal(plan.stake, 2.19);
  assert.equal(plan.recoveryTarget, 1.75);
  assert.equal(plan.blocked, false);
});

test('an unaffordable recovery stake is blocked, never shrunk silently', () => {
  const plan = planStake({ baseStake: 1, style: 'martingale', debt: 50, payout: PAYOUT, balance: 2 });
  assert.equal(plan.blocked, true);
  assert.equal(plan.stake, 0);
  assert.match(plan.reason, /above the executable limit/);
  const ladder = buildLossLadder({ baseStake: 1, style: 'base', losses: 3, payout: PAYOUT, balance: 1.5 });
  assert.equal(ladder.blockedAt, 2);
  assert.equal(ladder.steps[1].status, 'blocked');
  assert.equal(ladder.complete, false);
});

test('a stricter backend stake cap overrides the frontend estimate', () => {
  const plan = planStake({ baseStake: 1, style: 'martingale', debt: 5, payout: PAYOUT, balance: 100, serverMaxStake: 5 });
  assert.equal(plan.blocked, true);
  assert.equal(plan.limit, 5);
  assert.equal(plan.requiredStake, 6.25);
  const permitted = planStake({ baseStake: 1, style: 'martingale', debt: 5, payout: PAYOUT, balance: 100, serverMaxStake: 20 });
  assert.equal(permitted.blocked, false);
});

test('the loss ladder stops at a configured maximum run loss but still settles that trade', () => {
  const ladder = buildLossLadder({ baseStake: 1, style: 'martingale', losses: 6, payout: PAYOUT, balance: 100, maxRunLoss: 3 });
  assert.equal(ladder.runLossStopAt, 3, 'the third loss crosses $3.00 realized');
  assert.equal(ladder.steps.length, 6, 'the ladder still shows the full cooldown scenario');
  assert.ok(ladder.steps[2].cumulativeLoss >= 3);
});

test('take profit projection counts net wins, not payout', () => {
  const projection = projectTakeProfit({ target: 10, runProfit: 0, perWinProfit: 0.8 });
  assert.equal(projection.enabled, true);
  assert.equal(projection.winsNeeded, 13);
  assert.equal(projection.remaining, 10);
  assert.equal(projection.progressPct, 0);
  const partial = projectTakeProfit({ target: 10, runProfit: 2.4, perWinProfit: 0.8 });
  assert.equal(partial.winsNeeded, 10);
  assert.equal(partial.remaining, 7.6);
  assert.equal(Math.round(partial.progressPct), 24);
  const losing = projectTakeProfit({ target: 10, runProfit: -2.5, perWinProfit: 0.8 });
  assert.equal(losing.deficit, 2.5);
  assert.equal(losing.progressPct, 0);
  assert.equal(projection.winsNeeded * 0.8 >= 10, true);
});

test('take profit can be disabled', () => {
  const projection = projectTakeProfit({ target: 0, runProfit: 4, perWinProfit: 0.8 });
  assert.equal(projection.enabled, false);
  assert.equal(projection.winsNeeded, null);
  const preview = buildRiskPreview({ baseStake: 1, takeProfit: 0, payout: PAYOUT, balance: 100 });
  assert.equal(preview.takeProfit.enabled, false);
});

test('expected trades need a real sample before being quoted', () => {
  assert.equal(expectedTradesToTarget({ winsNeeded: 13, winRate: 0.55, sample: 12 }), null);
  const supported = expectedTradesToTarget({ winsNeeded: 13, winRate: 0.55, sample: 120 });
  assert.ok(supported);
  assert.equal(supported.trades, 24);
});

test('worst case is only bounded by an enforceable run loss', () => {
  const unbounded = describeWorstCase({ maxRunLoss: 0, lossesToCooldown: 3, ladderExposure: 3, currency: 'USD' });
  assert.equal(unbounded.bounded, false);
  assert.match(unbounded.reason, /unbounded/);
  const bounded = describeWorstCase({ maxRunLoss: 10, lossesToCooldown: 3, currency: 'USD' });
  assert.equal(bounded.bounded, true);
  assert.equal(bounded.boundary, 10);
  assert.match(bounded.reason, /settlement can cross that line/);
});

test('preview groups config, ladder and take profit from one model', () => {
  const preview = buildRiskPreview({
    baseStake: 1,
    style: 'martingale',
    accountMode: 'demo',
    balance: 250,
    currency: 'USD',
    lossesToCooldown: 3,
    cooldownSeconds: 45,
    takeProfit: 10,
    maxRunLoss: 10,
    payout: PAYOUT,
  });
  assert.equal(preview.config.lossesToCooldown, 3);
  assert.equal(preview.config.cooldownSeconds, 45);
  assert.equal(preview.config.netPerUnit, 0.8);
  assert.equal(preview.ladder.exposure, 5.06);
  assert.equal(preview.cooldownExposure, 5.06);
  assert.equal(preview.takeProfit.winsNeeded, 13);
  assert.equal(preview.worstCase.bounded, true);
  assert.equal(preview.config.balanceCap, 225);
});

test('payout data that is unavailable is labelled, not invented', () => {
  assert.deepEqual(netReturnPerUnit({ payout: null, winChance: null }), { net: 0, source: 'unavailable', authoritative: false });
  assert.equal(netReturnPerUnit({ payout: 1.9 }).source, 'payout');
  assert.equal(netReturnPerUnit({ winChance: 0.5 }).source, 'model');
  const blocked = planStake({ baseStake: 1, style: 'martingale', debt: 4, payout: null, winChance: null, balance: 100 });
  assert.equal(blocked.blocked, true);
  assert.equal(blocked.payoutDependent, true);
  const ladder = buildLossLadder({ baseStake: 1, style: 'martingale', losses: 3, payout: null, winChance: null, balance: 100, startDebt: 4 });
  assert.equal(ladder.payoutBlocked, true);
  assert.equal(ladder.steps[0].status, 'blocked');
});

test('theoretical estimate payouts model recovery scenarios but are never labelled authoritative quotes', () => {
  const net = netReturnPerUnit({ estimatePayout: 1.8 });
  assert.equal(net.source, 'estimate');
  assert.equal(net.authoritative, false);
  assert.equal(Math.round(net.net * 100) / 100, 0.8);
  const plan = planStake({ baseStake: 1, style: 'martingale', debt: 4, estimatePayout: 1.8, balance: 100 });
  assert.equal(plan.blocked, false);
  assert.equal(plan.authoritative, false);
  assert.equal(plan.illustrative, true);
  assert.equal(plan.netSource, 'estimate');
  assert.match(plan.reason, /Illustrative scenario/);
  const ladder = buildLossLadder({ baseStake: 1, style: 'martingale', losses: 3, estimatePayout: 1.8, balance: 100, startDebt: 4 });
  assert.equal(ladder.payoutBlocked, false, 'a valid estimate allows modeling; it is not missing payout data');
  assert.equal(ladder.usesEstimate, true);
  assert.equal(ladder.hasVerifiedPayout, false);
  assert.equal(ladder.steps[0].status, 'executable');
  assert.equal(ladder.steps[0].illustrative, true);
  const preview = buildRiskPreview({ baseStake: 1, style: 'martingale', estimatePayout: 1.8, balance: 100, startDebt: 4, takeProfit: 10 });
  assert.equal(preview.config.netSource, 'estimate');
  assert.equal(preview.config.authoritative, false);
  assert.equal(preview.config.illustrative, true);
  assert.equal(preview.config.payout, null, 'estimates must never be reported as verified/live payout');
  assert.equal(preview.config.estimatePayout, 1.8);
});

test('explicit authoritative payout remains the verified quote source', () => {
  const net = netReturnPerUnit({ payout: 1.9, payoutAuthoritative: true });
  assert.equal(net.source, 'payout');
  assert.equal(net.authoritative, true);
  const preview = buildRiskPreview({ baseStake: 1, style: 'base', payout: 1.9, payoutAuthoritative: true, balance: 100 });
  assert.equal(preview.config.netSource, 'payout');
  assert.equal(preview.config.authoritative, true);
  assert.equal(preview.config.payout, 1.9);
});

test('estimate modeling preserves Base, Martingale, Boosted and Chase recovery math', () => {
  const cases: Array<[string, number, number[]]> = [
    ['base', 0, [1, 1, 1]],
    ['martingale', 0, [1, 1.25, 2.81]],
    ['boosted', 5, [6.88]],
    ['chase', 5, [2.19]],
  ];
  for (const [style, startDebt, expected] of cases) {
    const ladder = buildLossLadder({ baseStake: 1, style, losses: expected.length, estimatePayout: 1.8, balance: 100, startDebt });
    assert.deepEqual(ladder.steps.map((s) => s.stake), expected, `${style} stakes changed under estimate modeling`);
    assert.equal(ladder.payoutBlocked, false);
    assert.equal(ladder.usesEstimate, true, `${style} should report estimate-based modeling`);
    assert.equal(ladder.hasVerifiedPayout, false, `${style} must not claim a verified quote`);
  }
});

test('changing estimate payout changes modeled recovery sizing without inventing a live quote', () => {
  const low = buildLossLadder({ baseStake: 1, style: 'martingale', losses: 2, estimatePayout: 1.5, balance: 100 });
  const high = buildLossLadder({ baseStake: 1, style: 'martingale', losses: 2, estimatePayout: 2.2, balance: 100 });
  assert.deepEqual(low.steps.map((s) => s.stake), [1, 2]);
  assert.deepEqual(high.steps.map((s) => s.stake), [1, 1]);
  assert.notEqual(low.steps[1].net, high.steps[1].net);
  assert.equal(low.hasVerifiedPayout, false);
  assert.equal(high.hasVerifiedPayout, false);
});

test('rounding keeps cents and never returns a zero wager for a positive stake', () => {
  assert.equal(roundStake(1.005), 1.01);
  assert.equal(roundStake(2.8125), 2.81);
  assert.equal(roundStake(0), 0);
  assert.equal(roundStake(Number.NaN), 0);
});
