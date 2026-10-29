import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

test('guest cow defeat is practice and does not send a trade request', () => {
  const html = readFileSync(new URL('../web/public/trading-room.html', import.meta.url), 'utf8');
  const script = html.split('<script>')[1]?.split('</script>')[0];
  assert.ok(script);
  const messages: Array<{ type: string; payload?: { stake?: number; market?: string; barrier?: number } }> = [];
  const elements = new Map<string, any>();
  const element = (id: string): any => {
    if (!elements.has(id)) elements.set(id, { style: {}, classList: { add() {}, remove() {}, toggle() {} }, addEventListener() {}, replaceChildren() {}, appendChild() {}, getContext: () => ({ setTransform() {} }) });
    return elements.get(id);
  };
  const context: Record<string, any> = {
    document: { querySelector: () => element('canvas'), getElementById: element, createElement: () => element('child') },
    parent: { postMessage: (message: { type: string; payload?: { stake?: number; market?: string; barrier?: number } }) => messages.push(message) },
    location: { origin: 'https://example.test' },
    window: { addEventListener() {} }, addEventListener() {}, requestAnimationFrame() {},
    innerWidth: 800, innerHeight: 600, devicePixelRatio: 1,
    performance: { now: () => 100 }, setTimeout: () => 1, clearTimeout() {},
  };
  const instrumented = script.replace(/\}\)\(\);\s*$/, 'globalThis.testDefeat = onCowDefeated; globalThis.testMission = recordMission; globalThis.testSplit = splitDigits; globalThis.testSubmit = submitContract; globalThis.testConnect = (id) => { connectedAccount = true; activeAccountId = id; };})();');
  assert.notEqual(instrumented, script);
  runInNewContext(instrumented, context);
  context.testDefeat({ contract: { market: 'Test market', symbol: 'TEST', kind: 'OVER', barrier: 1 } });
  assert.equal(messages.some((message) => message.type === 'zeronine:room-trade'), false);
  assert.match(elements.get('toast').textContent, /no bet placed/i);
  context.testMission('kills');
  context.testMission('kills');
  assert.equal(elements.get('missionProgress').textContent, '2 / 3');
  context.testMission('kills');
  assert.equal(elements.get('missionTitle').textContent, 'Defeat 5 cows');
  assert.equal(elements.get('missionProgress').textContent, '0 / 5');
  const observed = context.testSplit([0, 4, 5, 9, -1, 10, 2.5]);
  assert.equal(observed.low, 2);
  assert.equal(observed.high, 2);
  assert.equal(observed.n, 4, 'invalid values must not become market evidence');
  assert.equal(context.testSplit(Array.from({ length: 80 }, () => 9)).n, 50, 'every market uses the same latest 50 observations');
  context.testConnect('REAL_A');
  element('cowStake').value = '2.50';
  context.testDefeat({ contract: { market: 'Changed', symbol: 'CHANGED', kind: 'UNDER', barrier: 8 }, tradeIntent: { accountId: 'REAL_A', stake: 1.75, contract: { market: 'Selected', symbol: 'SELECTED', kind: 'OVER', barrier: 1 } } });
  const trade = messages.find((message) => message.type === 'zeronine:room-trade');
  assert.equal(trade?.payload?.stake, 1.75, 'the amount selected when targeting is used');
  assert.equal(trade?.payload?.market, 'SELECTED', 'the contract selected when targeting is preserved');
  element('cowStake').value = '0';
  context.testSubmit({ market: 'Test', symbol: 'TEST', kind: 'OVER', barrier: 1 });
  assert.equal(messages.filter((message) => message.type === 'zeronine:room-trade').length, 1, 'an invalid stake never submits a trade');
  context.testDefeat({ contract: { market: 'Test', symbol: 'TEST', kind: 'OVER', barrier: 1 }, tradeIntent: { accountId: 'OTHER_ACCOUNT', stake: 2, contract: { market: 'Test', symbol: 'TEST', kind: 'OVER', barrier: 1 } } });
  assert.equal(messages.filter((message) => message.type === 'zeronine:room-trade').length, 1, 'switching accounts after aiming never submits a trade');
});
