import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const html = readFileSync(new URL('../web/public/trading-room.html', import.meta.url), 'utf8');
const journal = readFileSync(new URL('../web/public/pasture-brain-refine.js', import.meta.url), 'utf8');

function between(startMarker: string, endMarker: string): string {
  const start = html.indexOf(startMarker);
  const end = html.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start, `${startMarker} .. ${endMarker}`);
  return html.slice(start, end);
}

test('a target only qualifies with fresh data, a real edge and ranked evidence', () => {
  const eligible = runInNewContext(
    `${between('function brainCandidateEligible(', 'function brainScan(')}; brainCandidateEligible`,
    {},
  ) as (tag: unknown, opts?: unknown) => { ok: boolean; code?: string; reason?: string };
  const good = { symbol: 'R_100', market: 'Vol 100', kind: 'OVER', barrier: 2, fresh: true, edge: 0.04, p: 0.61, payout: 1.92, score: 2.4 };
  assert.equal(eligible(good, { feedConnected: true, quoteFresh: true }).ok, true);
  assert.equal(eligible({ ...good, fresh: false }, { feedConnected: true, quoteFresh: true }).code, 'stale');
  assert.equal(eligible({ ...good, fresh: true }, { feedConnected: true, quoteFresh: false }).code, 'stale');
  assert.equal(eligible(good, { feedConnected: false, quoteFresh: true }).code, 'feed');
  assert.equal(eligible({ ...good, edge: -0.01 }, {}).code, 'no_edge');
  assert.equal(eligible({ ...good, p: 0.42 }, {}).code, 'low_chance');
  assert.equal(eligible({ ...good, payout: 1 }, {}).code, 'no_payout');
  // No ranked evidence means no positive recommendation.
  assert.equal(eligible({ ...good, score: undefined }, {}).code, 'no_evidence');
  assert.equal(eligible(null, {}).code, 'no_herd');
});

test('the scanner returns no pick instead of falling back to the first ranked cow', () => {
  const eligibleSrc = between('function brainCandidateEligible(', 'function brainScan(');
  const scanSrc = between('function brainScan(', 'function brainSniperCandidate(');
  const tag = { symbol: 'R_100', market: 'Vol 100', kind: 'OVER', barrier: 2, fresh: true, edge: -0.02, p: 0.6, payout: 1.9, score: 1 };
  const context: Record<string, unknown> = {
    lastRoomState: { feedConnected: true },
    cows: [{ alive: true, contract: tag }],
    ghostCow: null,
    brainCowScore: () => 1,
    quoteFreshness: () => ({ fresh: true }),
    brainFactorList: () => [],
    globalThis: undefined,
  };
  const scan = runInNewContext(`${eligibleSrc}${scanSrc}; brainScan`, context) as () => { pick: unknown; code: string; reason: string; ranked: unknown[] };
  const empty = scan();
  assert.equal(empty.pick, null);
  assert.equal(empty.code, 'no_edge');
  assert.equal(empty.ranked.length, 1);
  assert.ok(empty.reason.length > 0);

  context.cows = [];
  const herdless = scan();
  assert.equal(herdless.pick, null);
  assert.equal(herdless.code, 'no_herd');
});

test('a suggestion expires at the countdown, stale feed and account change', () => {
  const alive = runInNewContext(
    `${between('function brainSnipeAlive(', 'function brainSnipeFor(')}; brainSnipeAlive`,
    {
      performance: { now: () => 1000 },
      activeAccountId: 'acct-a',
      quoteFreshness: () => ({ fresh: true }),
    },
  ) as (snipe: unknown) => boolean;
  const snipe = { until: 2000, accountId: 'acct-a', symbol: 'R_100' };
  assert.equal(alive(snipe), true);
  assert.equal(alive({ ...snipe, until: 900 }), false);
  assert.equal(alive({ ...snipe, accountId: 'acct-b' }), false);
  assert.equal(alive(null), false);
});

test('a stale feed invalidates a live suggestion', () => {
  const alive = runInNewContext(
    `${between('function brainSnipeAlive(', 'function brainSnipeFor(')}; brainSnipeAlive`,
    {
      performance: { now: () => 1000 },
      activeAccountId: 'acct-a',
      quoteFreshness: () => ({ fresh: false }),
    },
  ) as (snipe: unknown) => boolean;
  assert.equal(alive({ until: 2000, accountId: 'acct-a', symbol: 'R_100' }), false);
});

test('brain-assisted Auto keeps the three fresh-tick sequence instead of prefilling it', () => {
  // The branch used to force confirmations immediately, firing without the
  // normal tick sequence.
  assert.equal(/confirmations\s*:\s*3/.test(html), false);
  assert.ok(html.includes("brainWait?'Brain is waiting: '+brainWait"));
  assert.ok(html.includes('brainAutoSnipe&&!brainPick?(brainScan().reason'));
});

test('settled trades are reviewed once, per account, and never announced as "+1 learned"', () => {
  const start = journal.indexOf('function noteLearning(');
  const end = journal.indexOf('function pulseLearned(', start);
  assert.ok(start >= 0 && end > start);
  const note = journal.slice(start, end);
  assert.ok(note.includes('seenTrades.has(id)'));
  assert.ok(note.includes('account: currentAccount()'));
  assert.ok(note.includes('kind: \'trade_review\''));
  assert.ok(journal.includes('trade reviewed'));
  assert.equal(journal.includes('+1 learned'), false);
  // "New lesson" belongs to the validated paper lessons, not to settlements.
  const lesson = journal.slice(journal.indexOf('function noteLessonChange('), journal.indexOf('function renderLearnedCards('));
  assert.ok(lesson.includes("pop.textContent = 'New lesson'"));
});
