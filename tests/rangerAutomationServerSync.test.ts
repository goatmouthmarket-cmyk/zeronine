import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';

const core = readFileSync(new URL('../web/public/trading-room-core.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../web/public/trading-room.html', import.meta.url), 'utf8');

type MockElement = {
  hidden: boolean;
  textContent: string;
  className: string;
  dataset: Record<string, string>;
  children: MockElement[];
  append(...children: MockElement[]): void;
  replaceChildren(): void;
};

function element(): MockElement {
  return {
    hidden: false,
    textContent: '',
    className: '',
    dataset: {} as Record<string, string>,
    children: [],
    append(...children: MockElement[]) { this.children.push(...children); },
    replaceChildren() { this.children = []; },
  };
}

test('server Ranger state drives the displayed realized P&L and settlement summary', () => {
  const start = core.indexOf('function renderRangerAutoActivity(');
  const end = core.indexOf('function ', start + 9);
  assert.ok(start >= 0 && end > start, 'Ranger activity renderer exists in the served game script');

  const elements = new Map<string, MockElement>();
  for (const id of ['rangerAutoActivity', 'rangerAutoPnl', 'rangerAutoRecent', 'rangerAutoMobilePnl', 'rangerAutoMobilePnlValue']) {
    elements.set(id, element());
  }
  const context = {
    $: (id: string) => elements.get(id),
    document: { createElement: () => element() },
    rangerAutoActive: true,
    rangerAutoServerOwned: true,
    rangerAutoServerState: { phase: 'waiting-settlement', startedAt: 100, runProfit: 2.5, tradesDone: 6, wins: 6, losses: 0 },
    rangerAutoTradeIds: new Set<number>(),
    rangerAutoRunTradeIds: new Set<number>(),
    rangerAutoTrackedTrades: () => [],
    rangerAutoRunProfit: () => 0,
    positionRangerAutoMobilePnl() {},
    positionRangerAutoActivity() {},
    marketName: (symbol: string) => symbol,
    rangerAutoMenuOpen: false,
    innerHeight: 800,
  };
  const render = runInNewContext(`${core.slice(start, end)}; renderRangerAutoActivity`, context) as (state: unknown) => void;
  const state = {
    currency: 'USD',
    trades: Array.from({ length: 6 }, (_, index) => ({
      id: index + 1, origin: 'bot', ts: 100 + index, market: `R_${index}`, direction: 'over',
      barrier: index, stake: 1, profit: 2, status: 'won',
    })),
  };

  render(state);
  assert.equal(elements.get('rangerAutoPnl')?.textContent, '+2.50 USD');
  assert.equal(elements.get('rangerAutoRecent')?.children.length, 5);
  assert.equal(elements.get('rangerAutoRecent')?.children[0]?.children[0]?.textContent, 'R_5 OVER 5 · 1.00');
  assert.equal(elements.get('rangerAutoRecent')?.children[0]?.children[1]?.textContent, '+2.00 USD');

  context.rangerAutoServerState.runProfit = 3.25;
  context.rangerAutoServerState.tradesDone = 7;
  context.rangerAutoServerState.wins = 7;
  render(state);
  assert.equal(elements.get('rangerAutoPnl')?.textContent, '+3.25 USD');
  assert.equal(elements.get('rangerAutoRecent')?.children[0]?.children[0]?.textContent, 'R_5 OVER 5 · 1.00');
  assert.equal(elements.get('rangerAutoRecent')?.children[0]?.children[1]?.textContent, '+2.00 USD');
});

test('Ranger only kills one cow for the market and contract actually submitted by the server', () => {
  const start = core.indexOf('function updateRangerServerVisual(');
  const end = core.indexOf('function updateRangerAutomation(', start);
  assert.ok(start >= 0 && end > start, 'server visual controller exists');

  const target = { x: 500, y: 400, alive: true, serverAutoVisual: false, tradeIntent: undefined, contract: { symbol: 'R_100', kind: 'over', barrier: 1 } };
  const context = {
    rangerAutoServerState: { running: true, phase: 'waiting-settlement', candidate: { market: 'R_100', direction: 'over', barrier: 1 }, lastSubmittedTrade: { contractId: 'contract-1', market: 'R_100', direction: 'over', barrier: 1 } },
    rangerAutoServerVisualTarget: null as typeof target | null,
    rangerAutoServerVisualConsumedId: '',
    target: null as typeof target | null,
    rangerAutoShots: 3,
    cows: [target],
    ghostCow: null,
    player: { x: 100, y: 100, tx: 100, ty: 100 },
    world: { w: 1300, h: 850 },
    rangerAnim: { patrolWaiting: true, inspectCow: target },
  };
  const update = runInNewContext(`${core.slice(start, end)}; updateRangerServerVisual`, context) as () => void;

  update();

  assert.equal(context.player.tx, 395);
  assert.equal(context.player.ty, 470);
  assert.equal(context.rangerAutoServerVisualTarget, target);
  assert.equal(context.target, target);
  assert.equal(target.serverAutoVisual, true);
  assert.equal(target.tradeIntent, undefined);
  assert.equal(context.rangerAnim.patrolWaiting, false);
  assert.equal(context.rangerAnim.inspectCow, null);
  context.rangerAutoServerVisualConsumedId = 'contract-1';
  update();
  assert.equal(context.target, null, 'the same submitted contract cannot trigger another cow kill');
  assert.equal(context.rangerAutoServerVisualTarget, null);
  context.rangerAutoServerVisualConsumedId = '';
  context.rangerAutoServerState = { running: true, phase: 'confirming-signal', candidate: { market: 'R_100', direction: 'over', barrier: 1 } };
  update();
  assert.equal(context.target, null, 'a market candidate without a submitted contract cannot trigger a kill');
  assert.match(core, /if\(rangerAutoServerOwned\)\{updateRangerServerVisual\(\);return\}/);
  assert.match(core, /sendPasture\(\{type:"shot",x:target\.x,y:target\.y\}\)/);
  assert.match(core, /serverAutoVisual=true/);
  assert.match(core, /if\(!s\.target\.serverAutoVisual\)onCowDefeated\(s\.target\)/);
  assert.match(core, /lastSubmittedTrade/);
  assert.match(core, /run\.lastSubmittedTrade = \{ contractId: bought\.contractId/);
  assert.match(core, /playerConnectionReady!==true/);
});

test('the automatic trade list uses a bounded vertical layout without horizontal scrolling', () => {
  assert.match(html, /#rangerAutoRecent\{[^}]*overflow-y:auto;overflow-x:hidden/);
  assert.match(html, /#rangerAutoRecent li\{display:grid;grid-template-columns:minmax\(0,1fr\) auto/);
});
