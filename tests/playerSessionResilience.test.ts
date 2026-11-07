import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { ApiError, isTransientFailure, isVerifiedAuthFailure } from '../web/src/http.ts';
import { classifyPlayerStateFailure, nextPastureRoom, PLAYER_RECONNECTING_MESSAGE } from '../web/src/authState.ts';

test('a player session survives a 503 instead of appearing logged out', () => {
  const decision = classifyPlayerStateFailure(new ApiError('account or trading state unavailable', { status: 503, code: 'trading_state_unavailable' }));
  assert.equal(decision.clearSession, false, 'a server outage must not clear the session');
  assert.equal(decision.status, 'reconnecting');
  assert.equal(decision.message, PLAYER_RECONNECTING_MESSAGE);
  assert.match(decision.message, /Reconnecting/);
  assert.doesNotMatch(decision.message, /logged out/i);
});

test('a network timeout and a dropped connection keep the session', () => {
  for (const error of [
    new ApiError('request timed out', { status: 0, code: 'timeout', kind: 'timeout' }),
    new ApiError('fetch failed', { status: 0, code: 'network_error', kind: 'network' }),
    new TypeError('Failed to fetch'),
  ]) {
    const decision = classifyPlayerStateFailure(error);
    assert.equal(decision.clearSession, false, `${String(error)} must not sign the player out`);
    assert.equal(decision.status, 'reconnecting');
    assert.equal(isTransientFailure(error), true);
    assert.equal(isVerifiedAuthFailure(error), false);
  }
});

test('only a verified 401 clears the authenticated player state', () => {
  const first = classifyPlayerStateFailure(new ApiError('player session required', { status: 401 }));
  assert.equal(first.clearSession, true);
  assert.equal(first.status, 'signed-out');
  const revoked = classifyPlayerStateFailure(new ApiError('session revoked', { status: 401, code: 'session_revoked' }));
  assert.equal(revoked.clearSession, true);
  assert.equal(isVerifiedAuthFailure(revoked as never), false, 'a plain decision is not an error');
  assert.equal(isVerifiedAuthFailure(new ApiError('session revoked', { status: 401, code: 'session_revoked' })), true);
});

test('a forbidden or invalid request is reported but never treated as a logout', () => {
  const forbidden = classifyPlayerStateFailure(new ApiError('dashboard owner access required', { status: 403 }));
  assert.equal(forbidden.clearSession, false);
  assert.equal(forbidden.status, 'reconnecting');
  const clientError = classifyPlayerStateFailure(new ApiError('invalid stake or minimum edge', { status: 400 }));
  assert.equal(clientError.clearSession, false);
  assert.equal(isTransientFailure(new ApiError('bad request', { status: 400 })), false);
});

test('HTTP errors keep their status, code and transport kind', () => {
  const http = new ApiError('rate limited', { status: 429, code: 'too_many' });
  assert.equal(http.status, 429);
  assert.equal(http.code, 'too_many');
  assert.equal(http.kind, 'http');
  assert.equal(http.name, 'ApiError');
  assert.ok(http instanceof Error);
  assert.equal(isTransientFailure(http), true, '429 is retryable');
  const timeout = new ApiError('request timed out', { status: 0, code: 'timeout', kind: 'timeout' });
  assert.equal(timeout.status, 0);
  assert.equal(timeout.kind, 'timeout');
  assert.notEqual(timeout.kind, http.kind, 'timeouts stay distinguishable from HTTP errors');
});

test('the pasture iframe keeps its authenticated room through transient failures', () => {
  assert.equal(nextPastureRoom(null, 'CR1234', 'live'), 'main');
  assert.equal(nextPastureRoom(null, 'CR1234', 'reconnecting'), 'main', 'a login always opens the private room');
  assert.equal(nextPastureRoom('main', null, 'reconnecting'), 'main', 'a refresh failure must not remount the pasture into the public room');
  assert.equal(nextPastureRoom('main', null, 'idle'), 'main');
  assert.equal(nextPastureRoom('main', null, 'signed-out'), null, 'a confirmed logout leaves the private room');
  assert.equal(nextPastureRoom(null, null, 'signed-out'), null);
  assert.equal(nextPastureRoom(null, null, 'reconnecting'), null);
});

test('the pasture client reconnects with bounded backoff and stops on auth rejection', () => {
  const html = readFileSync(new URL('../web/public/trading-room.html', import.meta.url), 'utf8');
  assert.doesNotMatch(html, /zeronine:pasture-player-id|set-pasture-self-id/, 'the browser no longer claims a Ranger identity');
  assert.match(html, /pastureConnectionGeneration/, 'stale socket callbacks are generation guarded');
  assert.match(html, /addEventListener\('pagehide'/, 'a destroyed iframe closes its pasture socket');

  const policy = (name: string): string => {
    const start = html.indexOf(`function ${name}(`);
    assert.ok(start >= 0, `${name} exists`);
    const end = html.indexOf('\nfunction ', start + 1);
    return html.slice(start, end < 0 ? undefined : end);
  };
  const helpers = runInNewContext(`${policy('pastureReconnectDelayMs')}\n${policy('pastureClosePlan')}\n({ pastureReconnectDelayMs, pastureClosePlan })`) as {
    pastureReconnectDelayMs: (attempts: number) => number;
    pastureClosePlan: (code: number) => { stop: boolean; status: string };
  };
  const delays = [0, 1, 2, 3, 4, 5].map((attempt) => helpers.pastureReconnectDelayMs(attempt));
  assert.deepEqual(delays, [1000, 2000, 4000, 8000, 15000, 15000], 'reconnects back off exponentially and stay bounded');
  assert.equal(helpers.pastureReconnectDelayMs(-3), 1000);

  assert.deepEqual({ ...helpers.pastureClosePlan(1008) }, { stop: true, status: 'Pasture access ended. Sign in again to reconnect.' });
  assert.equal(helpers.pastureClosePlan(4001).stop, true, 'a second tab takes over instead of duplicating the Ranger');
  assert.equal(helpers.pastureClosePlan(1006).stop, false, 'a dropped connection retries');
  assert.equal(helpers.pastureClosePlan(1011).stop, false);
  assert.equal(helpers.pastureClosePlan(1000).stop, false);
});

test('guests never request owner-only test history', () => {
  const app = readFileSync(new URL('../web/src/App.tsx', import.meta.url), 'utf8');
  const guarded = app.match(/useEffect\(\(\) => \{\s*(?:\/\/[^\n]*\n\s*)*if \(!s\.owner\) return;\s*void loadTestRuns\(\)/g) ?? [];
  assert.equal(guarded.length, 2, 'both the home page and Cow Lab guard the initial history request');
  assert.equal((app.match(/setInterval\(\(\) => void loadTestRuns\(\)\.catch\(\(\) => undefined\), 60_000\)/g) ?? []).length, 1);
  assert.match(app, /if \(!s\.owner\) return;\s*void loadTestRuns\(\)\.catch\(\(\) => undefined\);\s*const timer = window\.setInterval/, 'the polling timer is owner-scoped and cleaned up');
  assert.equal(!/useEffect\(\(\) => \{\s*void loadTestRuns\(\);/.test(app), true, 'no unguarded loadTestRuns effect remains');
  assert.match(app, /const \[\s*pastureRoom/, 'the iframe room is derived from confirmed authentication');
  assert.doesNotMatch(app, /src=\{`\/trading-room\.html\$\{s\.session \? '\?room=main'/, 'the iframe no longer flips rooms on a transient session');
});
