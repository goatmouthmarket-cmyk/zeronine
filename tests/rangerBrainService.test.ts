import test from 'node:test';
import assert from 'node:assert/strict';
import type { PaperTradeSummary } from '../src/db/store.ts';
import { brainLessons, buildBrainReport, dominantMarket, paperTradesToOutcomes } from '../src/brain/service.ts';
import { buildTimingProfile } from '../src/brain/timing.ts';

const NOW = Date.parse('2026-11-06T12:00:00Z');
const FOURTEEN = Date.parse('2026-11-05T14:00:00Z');

function trade(overrides: Partial<PaperTradeSummary> & { opened_at: number; status: string }): PaperTradeSummary {
  const won = overrides.status === 'won';
  return {
    contract_ref: `ref-${overrides.opened_at}-${Math.random().toString(16).slice(2, 8)}`,
    updated_at: overrides.opened_at + 60_000,
    market: 'Volatility 100',
    contract_type: 'DIGITOVER',
    direction: 'over',
    barrier: 5,
    stake: 1,
    payout: 1.95,
    est_win: 0.95,
    profit: won ? 0.95 : -1,
    entry_spot: null,
    exit_spot: null,
    exit_digit: null,
    strategy: null,
    possible_outcomes: { won: { profit: 0.95, payout: 1.95 }, lost: { profit: -1 } },
    ...overrides,
  } as PaperTradeSummary;
}

test('only settled virtual trades become evidence', () => {
  const outcomes = paperTradesToOutcomes([
    trade({ opened_at: FOURTEEN, status: 'won' }),
    trade({ opened_at: FOURTEEN, status: 'lost' }),
    trade({ opened_at: FOURTEEN, status: 'pending' }),
    trade({ opened_at: FOURTEEN, status: 'cancelled' }),
  ]);
  assert.equal(outcomes.length, 2);
  assert.equal(outcomes[0]?.won, true);
  assert.ok(Math.abs((outcomes[0]?.winProfit ?? 0) - 0.95) < 1e-9);
});

test('a report with no settled outcomes is offline and claims nothing', () => {
  const report = buildBrainReport({ now: NOW, trades: [] });
  assert.equal(report.mind, 'offline');
  assert.equal(report.mode, 'paper');
  assert.equal(report.outcomes, 0);
  assert.equal(report.winRate, null);
  assert.equal(report.bestHour, null);
  assert.equal(report.verdict, 'insufficient');
  assert.match(report.headline, /not claiming an edge/);
  assert.equal(report.lessons[0]?.outcomes, 0);
});

test('thin evidence reports a real sample count and stays observing', () => {
  const trades = Array.from({ length: 12 }, (_, index) => trade({ opened_at: FOURTEEN + index * 1000, status: index < 9 ? 'won' : 'lost' }));
  const report = buildBrainReport({ now: NOW, trades });
  assert.equal(report.mind, 'observing');
  assert.equal(report.outcomes, 12);
  assert.equal(report.lessons.find((lesson) => lesson.id === 'evidence-thin')?.outcomes, 12);
  assert.equal(report.bestHour, null);
});

test('a well-sampled favorable hour is reported with its evidence and no invented numbers', () => {
  const trades = [
    ...Array.from({ length: 40 }, (_, index) => trade({ opened_at: FOURTEEN + index * 1000, status: index < 33 ? 'won' : 'lost' })),
    ...Array.from({ length: 70 }, (_, index) => trade({ opened_at: NOW - 5 * 60 * 60 * 1000 + index * 1000, status: index < 30 ? 'won' : 'lost' })),
  ];
  const report = buildBrainReport({ now: NOW, trades });
  assert.equal(report.outcomes, 110);
  assert.equal(report.mind, 'paper_hunting');
  // Pooled across hours the record only overlaps break-even; the 14:00 bucket
  // is the one piece that separates, which is exactly what bestHour reports.
  assert.equal(report.verdict, 'mixed');
  assert.equal(report.bestHour?.key, 14);
  assert.equal(report.bestHour?.outcomes, 40);
  assert.ok(Math.abs((report.winRate ?? 0) - 63 / 110) < 1e-9);
  assert.ok(Math.abs((report.breakeven ?? 0) - 1 / 1.95) < 1e-9);
  const lesson = report.lessons.find((item) => item.id === 'hour-favorable-14');
  assert.ok(lesson);
  assert.equal(lesson.outcomes, 40);
  // The market itself has 110 settled outcomes, so the finding clears the
  // market-wide bar for "validated" even though the hour only has 40.
  assert.equal(lesson.validity, 'validated');
  assert.match(lesson.finding, /settled 33 of 40/);
});

test('a losing market holds the Brain in WAIT instead of hunting', () => {
  const trades = Array.from({ length: 120 }, (_, index) => trade({ opened_at: FOURTEEN + index * 1000, status: index < 18 ? 'won' : 'lost' }));
  const report = buildBrainReport({ now: NOW, trades });
  assert.equal(report.mind, 'waiting');
  assert.equal(report.verdict, 'unfavorable');
  assert.equal(report.bestHour, null);
  assert.match(report.headline, /Waiting/);
  // 120 outcomes clear the market-wide bar, but nothing here is favorable.
  assert.ok(report.lessons.every((lesson) => lesson.validity === 'provisional'));
});

test('markets are analysed separately and never pooled', () => {
  const trades = [
    ...Array.from({ length: 40 }, (_, index) => trade({ opened_at: FOURTEEN + index * 1000, status: index < 34 ? 'won' : 'lost' })),
    ...Array.from({ length: 120 }, (_, index) => trade({ opened_at: FOURTEEN + index * 1000, status: 'lost', market: 'Volatility 75' })),
  ];
  const automatic = buildBrainReport({ now: NOW, trades });
  const only100 = buildBrainReport({ now: NOW, trades, market: 'Volatility 100' });
  const only75 = buildBrainReport({ now: NOW, trades, market: 'Volatility 75' });
  // Without an explicit market the report describes one real market instead of
  // blending two instruments into an average.
  assert.equal(automatic.market, 'Volatility 75');
  assert.equal(automatic.outcomes, 120);
  assert.equal(only100.outcomes, 40);
  assert.equal(only75.outcomes, 120);
  assert.equal(dominantMarket(paperTradesToOutcomes(trades), NOW, 30), automatic.market);
  assert.equal(only75.mind, 'waiting');
  assert.notEqual(only100.winRate, only75.winRate);
});

test('lessons are empty-safe and always carry a sample count', () => {
  const report = buildBrainReport({ now: NOW, trades: [trade({ opened_at: FOURTEEN, status: 'won' })] });
  assert.ok(report.lessons.length > 0);
  for (const lesson of report.lessons) {
    assert.ok(Number.isInteger(lesson.outcomes) && lesson.outcomes >= 0);
    assert.match(lesson.finding, /\d/);
    assert.ok(['provisional', 'validated'].includes(lesson.validity));
  }
  const emptyProfile = buildTimingProfile([], { now: NOW });
  const emptyLessons = brainLessons(emptyProfile, NOW);
  assert.equal(emptyLessons.length, 1);
  assert.match(emptyLessons[0]!.finding, /no measurable edge yet/);
});

test('the default market is the best-sampled one, never a pooled blend', () => {
  const trades = [
    ...Array.from({ length: 5 }, (_, index) => trade({ opened_at: FOURTEEN + index * 1000, status: 'won' })),
    ...Array.from({ length: 45 }, (_, index) => trade({ opened_at: FOURTEEN + index * 1000, status: index < 10 ? 'won' : 'lost', market: 'Volatility 75' })),
  ];
  const report = buildBrainReport({ now: NOW, trades });
  assert.equal(report.market, 'Volatility 75');
  assert.equal(report.outcomes, 45);
  assert.equal(dominantMarket(paperTradesToOutcomes([]), NOW, 30), null);
});

test('a strong hour below the market evidence bar keeps the Brain observing', () => {
  const trades = Array.from({ length: 81 }, (_, index) => trade({ opened_at: FOURTEEN + index * 1000, status: index < 62 ? 'won' : 'lost' }));
  const report = buildBrainReport({ now: NOW, trades });
  assert.equal(report.outcomes, 81);
  assert.equal(report.bestHour?.key, 14);
  assert.equal(report.mind, 'observing');
  assert.match(report.headline, /81 of 100 settled outcomes/);
  assert.doesNotMatch(report.headline, /shots allowed/);
});
