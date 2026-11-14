import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

for (const file of ['../web/public/pasture-ui-system.js', '../web/dist/pasture-ui-system.js']) {
  test(`${file}: paper notices stay concise and never invent profit`, () => {
    const source = readFileSync(new URL(file, import.meta.url), 'utf8');
    const classifyStart = source.indexOf('  function classifyLegacy(');
    const classifyEnd = source.indexOf('  function renderToast(', classifyStart);
    const notifyStart = source.indexOf('  function notifyLegacy(');
    const notifyEnd = source.indexOf('  const legacyNotify', notifyStart);
    assert.ok(classifyStart >= 0 && classifyEnd > classifyStart && notifyStart >= 0 && notifyEnd > notifyStart);
    const emitted: Array<Record<string, unknown>> = [];
    const context = vm.createContext({
      document: { querySelector: () => null },
      notifications: { history: [] },
      normalize: (entry: unknown) => entry,
      enqueue: (entry: Record<string, unknown>) => emitted.push(entry),
    });
    vm.runInContext(source.slice(classifyStart, classifyEnd) + source.slice(notifyStart, notifyEnd), context);
    const notify = context.notifyLegacy as (message: string, trade?: Record<string, unknown>) => void;
    notify('Verbose opening details', { id: 'one', status: 'open', market: 'Volatility 50', direction: 'over', barrier: 2 });
    assert.equal(emitted.length, 0, 'the existing paper hourglass covers the open state');
    notify('Verbose settlement details', { id: 'one', status: 'won', market: 'Volatility 50', direction: 'over', barrier: 2, profit: null });
    assert.equal(emitted[0]?.title, 'PAPER · WIN');
    assert.equal(emitted[0]?.message, 'Volatility 50 · OVER 2');
    assert.equal(emitted[0]?.detail, 'Virtual P&L unavailable');
    notify('Verbose loss details', { id: 'two', status: 'lost', market: 'Volatility 25', direction: 'under', barrier: 7, profit: -1.25 });
    assert.equal(emitted[1]?.title, 'PAPER · LOSS');
    assert.equal(emitted[1]?.message, 'Volatility 25 · UNDER 7');
    assert.equal(emitted[1]?.detail, 'Virtual P&L -1.25');
    notify('Account trade won');
    assert.equal(emitted[2]?.type, 'trade_result', 'account results never become paper notices');
  });
}
