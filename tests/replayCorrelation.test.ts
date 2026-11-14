import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

for (const copy of ['public', 'dist']) {
  test(`${copy}: replay result binds only an explicitly confirmed same-attempt, same-account purchase`, () => {
    const html = readFileSync(new URL(`../web/${copy}/trading-room.html`, import.meta.url), 'utf8');
    const start = html.indexOf('let replayAttempt=null;window.addEventListener');
    const end = html.indexOf('window.__zeronineBrainBridge=', start);
    assert.ok(start >= 0 && end > start);
    const listeners: Record<string, (event: unknown) => void> = {};
    const parent = {};
    const context: Record<string, any> = {
      parent, location: { origin: 'https://example.test' },
      window: { addEventListener(type: string, fn: (event: unknown) => void) { listeners[type] = fn; } },
      connectedAccount: true, activeAccountId: 'account-a', aimStartedAt: 101,
      lastRoomState: { accountMode: 'demo', trades: [{ id: 42, status: 'won', profit: 0.8, stake: 1 }] },
      rangerBet: { phase: 'open', market: 'R_50', direction: 'OVER', barrier: 2 },
      trackedTradeId: 99, betCurrency: 'USD',
    };
    vm.runInNewContext(html.slice(start, end) + ';globalThis.setAttempt = value => { replayAttempt = value; };', context);
    context.setAttempt({ id: 'attempt-a', accountId: 'account-a', aim: 101, confirmedId: null });
    const send = (overrides: Record<string, unknown> = {}) => listeners.message({ origin: 'https://example.test', source: parent, data: { type: 'zeronine:room-trade-result', ok: true, replayAttemptId: 'attempt-a', replayAccountId: 'account-a', confirmedTradeId: 42, ...overrides } });
    for (const change of [{ replayAttemptId: 'other' }, { replayAccountId: 'account-b' }, { ok: false }, { confirmedTradeId: null }]) {
      send(change);
      assert.equal(context.window.__zeronineReplaySnapshot().confirmedTradeId, null);
    }
    listeners.message({ origin: 'https://other.test', source: parent, data: { type: 'zeronine:room-trade-result', ok: true, replayAttemptId: 'attempt-a', replayAccountId: 'account-a', confirmedTradeId: 42 } });
    listeners.message({ origin: 'https://example.test', source: {}, data: { type: 'zeronine:room-trade-result', ok: true, replayAttemptId: 'attempt-a', replayAccountId: 'account-a', confirmedTradeId: 42 } });
    assert.equal(context.window.__zeronineReplaySnapshot().confirmedTradeId, null);
    send();
    assert.equal(context.window.__zeronineReplaySnapshot().confirmedTradeId, '42');
    assert.equal(context.window.__zeronineReplayResolve('42').outcome, 'won');
    assert.equal(context.window.__zeronineReplayResolve('99'), null);
    context.activeAccountId = 'account-b';
    assert.equal(context.window.__zeronineReplaySnapshot().confirmedTradeId, null);
    context.activeAccountId = 'account-a'; context.aimStartedAt = 102;
    assert.equal(context.window.__zeronineReplaySnapshot().confirmedTradeId, null);
    context.setAttempt({ id: 'attempt-b', accountId: 'account-a', aim: 102, confirmedId: null });
    send();
    assert.equal(context.window.__zeronineReplaySnapshot().confirmedTradeId, null);
    listeners.message({ origin: 'https://example.test', source: parent, data: { type: 'zeronine:replay-confirmed-trade', ok: true, replayAttemptId: 'attempt-b', replayAccountId: 'account-a', confirmedTradeId: 42 } });
    assert.equal(context.window.__zeronineReplaySnapshot().confirmedTradeId, '42');
  });
}

test('owner instant and player/owner quote-confirm flows return the purchased trade ID to the matching room attempt', () => {
  const source = readFileSync(new URL('../web/src/App.tsx', import.meta.url), 'utf8');
  assert.match(source, /await manualTrade\([\s\S]*?onConfirmed\?\.\(result\.trade\.id\)/);
  assert.match(source, /await confirmPlayerTrade\([\s\S]*?await confirmManualTrade\([\s\S]*?onConfirmed\?\.\(result\.trade\.id\)/);
  assert.match(source, /sessionRef\.current\?\.loginid !== replayAccountId/);
  assert.match(source, /replayAttemptId:[\s\S]*?replayAccountId,[\s\S]*?confirmedTradeId/);
});
