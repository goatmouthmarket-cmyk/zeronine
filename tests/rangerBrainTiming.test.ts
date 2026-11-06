import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BRAIN_MIN_BUCKET_OUTCOMES,
  buildTimingProfile,
  classifyBucket,
  impliedBreakeven,
  shrunkWinRate,
  verdictLabel,
  wilsonInterval,
  type BrainOutcome,
} from '../src/brain/timing.ts';

const HOUR = 60 * 60 * 1000;
const NOW = Date.parse('2026-11-06T12:00:00Z');

function outcome(overrides: Partial<BrainOutcome> & { won: boolean; openedAt: number }): BrainOutcome {
  return {
    settledAt: overrides.openedAt + 60_000,
    market: 'Volatility 100',
    direction: 'over',
    barrier: 5,
    netPnl: overrides.won ? 0.95 : -1,
    stake: 1,
    winProfit: 0.95,
    ...overrides,
  };
}

test('wilson interval widens for small samples and is null without outcomes', () => {
  assert.equal(wilsonInterval(0, 0), null);
  const mid = wilsonInterval(10, 20)!;
  assert.ok(Math.abs(mid.low - 0.2993) < 0.001, `low ${mid.low}`);
  assert.ok(Math.abs(mid.high - 0.7007) < 0.001, `high ${mid.high}`);
  const small = wilsonInterval(2, 4)!;
  assert.ok(small.high - small.low > mid.high - mid.low);
  const perfect = wilsonInterval(4, 4)!;
  assert.ok(perfect.low > 0.5 && perfect.low < 0.52, String(perfect.low));
  assert.equal(perfect.high, 1);
});

test('shrinkage pulls thin buckets toward the market rate', () => {
  const thin = shrunkWinRate(3, 3, 0.5)!;
  const thick = shrunkWinRate(300, 300, 0.5)!;
  assert.ok(thin > 0.5 && thin < 0.6, `thin ${thin}`);
  assert.ok(thick > 0.95 && thick < 1, `thick ${thick}`);
  assert.equal(shrunkWinRate(0, 0, 0.52), 0.52);
});

test('break-even derives from stake and win profit', () => {
  const breakeven = impliedBreakeven([{ stake: 1, winProfit: 0.95 }, { stake: 2, winProfit: 1.9 }])!;
  assert.ok(Math.abs(breakeven - 1 / 1.95) < 1e-9, String(breakeven));
  assert.equal(impliedBreakeven([{ stake: 0, winProfit: 1 }]), null);
});

test('a bucket claim needs samples and a confidence bound beyond break-even', () => {
  assert.equal(classifyBucket(BRAIN_MIN_BUCKET_OUTCOMES - 1, 1, wilsonInterval(29, 29), 0.5128).verdict, 'insufficient');
  assert.equal(classifyBucket(BRAIN_MIN_BUCKET_OUTCOMES, 1, wilsonInterval(30, 30), 0.5128).verdict, 'favorable');
  assert.equal(classifyBucket(BRAIN_MIN_BUCKET_OUTCOMES, 0, wilsonInterval(0, 30), 0.5128).verdict, 'unfavorable');
  const mixed = classifyBucket(BRAIN_MIN_BUCKET_OUTCOMES, 16 / 30, wilsonInterval(16, 30), 0.5128);
  assert.equal(mixed.verdict, 'mixed');
  assert.match(mixed.reason, /overlaps break-even/);
  assert.equal(classifyBucket(0, null, null, null).verdict, 'insufficient');
});

test('timing profile buckets by the UTC hour of the decision, never the settlement', () => {
  const outcomes: BrainOutcome[] = [];
  const fourteen = Date.parse('2026-11-05T14:00:00Z');
  for (let index = 0; index < 40; index += 1) {
    // Opened at 14:xx UTC, settled the same day. Bucketing by settlement would
    // move these into a different hour, so this pins the decision clock.
    outcomes.push(outcome({ won: index < 32, openedAt: fourteen + index * 1000 }));
  }
  const profile = buildTimingProfile(outcomes, { now: NOW });
  assert.equal(profile.outcomes, 40);
  assert.equal(profile.hours[14]?.outcomes, 40);
  assert.equal(profile.hours[15]?.outcomes, 0);
  assert.equal(profile.verdict, 'favorable');
  assert.equal(profile.bestHour?.key, 14);
  assert.ok(Math.abs((profile.breakeven ?? 0) - 1 / 1.95) < 1e-9);
});

test('outcomes settled after now are excluded so evaluation cannot see the future', () => {
  const settledInFuture = outcome({ won: true, openedAt: NOW - HOUR, settledAt: NOW + 1 });
  const pendingSettlement = outcome({ won: false, openedAt: NOW - 2 * HOUR, settledAt: NOW - 2 * HOUR + 1000 });
  const profile = buildTimingProfile([settledInFuture, pendingSettlement], { now: NOW });
  assert.equal(profile.outcomes, 1);
  assert.equal(profile.wins, 0);
});

test('lookback window and market filter both apply', () => {
  const old = outcome({ won: true, openedAt: NOW - 40 * 24 * HOUR });
  const otherMarket = outcome({ won: true, openedAt: NOW - HOUR, market: 'Volatility 75' });
  const current = outcome({ won: false, openedAt: NOW - HOUR });
  const filtered = buildTimingProfile([old, otherMarket, current], { now: NOW, market: 'Volatility 100' });
  assert.equal(filtered.outcomes, 1);
  const everything = buildTimingProfile([old, otherMarket, current], { now: NOW, lookbackDays: 60 });
  assert.equal(everything.outcomes, 3);
});

test('an hour below break-even is reported as unfavorable, never as a best hour', () => {
  const outcomes: BrainOutcome[] = [];
  for (let index = 0; index < 35; index += 1) outcomes.push(outcome({ won: index < 6, openedAt: NOW - 2 * HOUR }));
  const profile = buildTimingProfile(outcomes, { now: NOW });
  assert.equal(profile.verdict, 'unfavorable');
  assert.equal(profile.bestHour, null);
  assert.equal(verdictLabel(profile.verdict), 'Unfavorable');
  assert.equal(verdictLabel('insufficient'), 'Insufficient data');
});

test('empty evidence stays insufficient and never invents a rate', () => {
  const profile = buildTimingProfile([], { now: NOW });
  assert.equal(profile.outcomes, 0);
  assert.equal(profile.winRate, null);
  assert.equal(profile.verdict, 'insufficient');
  assert.equal(profile.bestHour, null);
  assert.equal(profile.hours.length, 24);
  assert.equal(profile.weekdays.length, 7);
});
