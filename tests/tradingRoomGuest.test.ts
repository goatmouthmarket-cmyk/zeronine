import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

test('guest cow defeat is practice and does not send a trade request', () => {
  const html = readFileSync(new URL('../web/public/trading-room.html', import.meta.url), 'utf8');
  const script = html.split('<script>')[1]?.split('</script>')[0];
  assert.ok(script);
  const messages: Array<{ type: string }> = [];
  const elements = new Map<string, any>();
  const element = (id: string): any => {
    if (!elements.has(id)) elements.set(id, { style: {}, classList: { add() {}, remove() {}, toggle() {} }, addEventListener() {}, replaceChildren() {}, appendChild() {}, getContext: () => ({ setTransform() {} }) });
    return elements.get(id);
  };
  const context: Record<string, any> = {
    document: { querySelector: () => element('canvas'), getElementById: element, createElement: () => element('child') },
    parent: { postMessage: (message: { type: string }) => messages.push(message) },
    location: { origin: 'https://example.test' },
    window: { addEventListener() {} }, addEventListener() {}, requestAnimationFrame() {},
    innerWidth: 800, innerHeight: 600, devicePixelRatio: 1,
    performance: { now: () => 100 }, setTimeout: () => 1, clearTimeout() {},
  };
  const instrumented = script.replace(/\}\)\(\);\s*$/, 'globalThis.testDefeat = onCowDefeated;})();');
  assert.notEqual(instrumented, script);
  runInNewContext(instrumented, context);
  context.testDefeat({ contract: { market: 'Test market', symbol: 'TEST', kind: 'OVER', barrier: 1 } });
  assert.equal(messages.some((message) => message.type === 'zeronine:room-trade'), false);
  assert.match(elements.get('toast').textContent, /no bet placed/i);
});
