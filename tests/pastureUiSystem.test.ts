import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const read = (path: string) => readFileSync(new URL(`../web/public/${path}`, import.meta.url), 'utf8');

test('one stacking order keeps notifications below panels and modals above criticals', () => {
  const css = read('pasture-ui-system.css');
  const order = ['hud', 'notify', 'panel', 'critical', 'modal'].map((name) => css.indexOf(`--dc-z-${name}:`));
  assert.ok(order.every((index) => index >= 0), 'all layer tokens exist');
  for (let i = 1; i < order.length; i += 1) assert.ok(order[i] > order[i - 1], 'layers ascend');
  assert.ok(css.includes('--pasture-z-toast: var(--dc-z-notify)'), 'legacy toast token maps onto the shared order');
  assert.ok(css.includes('--pasture-z-menu: var(--dc-z-panel)'), 'legacy menu token maps onto the shared order');
});

test('one notification lane and one menu controller own coordination', () => {
  const refine = read('pasture-ui-refine.js');
  const system = read('pasture-ui-system.js');
  // The old per-file manager created another stack and patched menus from clicks.
  assert.equal(refine.includes('pasture-toast-stack'), false);
  assert.equal(refine.includes('closeOtherMajors'), false);
  assert.equal(refine.includes('majorPanels'), false);
  assert.ok(system.includes('dc-toast-lane'));
  assert.ok(system.includes('menus: {'));
  assert.ok(system.includes('menuObserver'));
  assert.ok(system.includes('dataset.dcMenu'));
});

test('legacy centered toast is retired and internal calls delegate to the manager', () => {
  const html = read('trading-room.html');
  assert.equal(html.includes('toast-refinement'), false);
  assert.equal(/#toast\s*\{/.test(html), false);
  assert.ok(html.includes('function legacyPastureNotify('));
  assert.ok(html.includes('window.notify(s,paperTrade)'));
  assert.ok(html.includes('id="pasture-ui-system-js"'));
  assert.ok(html.indexOf('pasture-ui-system.js') < html.indexOf('pasture-ui-refine.js'));
  assert.ok(html.indexOf('pasture-ui-system.js') < html.indexOf('pasture-brain-refine.js'));
});

test('all four major menus register with the shared controller', () => {
  const system = read('pasture-ui-system.js');
  for (const id of ['brain', 'auto', 'ghost', 'chat']) {
    assert.ok(system.includes(`id: '${id}'`), `${id} is registered`);
  }
  assert.ok(system.includes('closeMajors(id)'));
});

test('the Brain suggestion card avoids the target cow, ranger and visible panels', () => {
  const brain = read('pasture-brain-refine.js');
  const start = brain.indexOf('  function placeOverlay() {');
  const end = brain.indexOf('  function suggestionReason(', start);
  assert.ok(start >= 0 && end > start);
  const card = { offsetWidth: 224, offsetHeight: 132, style: { left: '', top: '', transform: '' } };
  const cow = { index: 3, sx: 500, sy: 320 };
  const snap = { herd: [cow], head: { x: 180, y: 300 }, feet: { x: 180, y: 355 }, zoom: 1 };
  const panel = { hidden: false, getClientRects: () => [1], getBoundingClientRect: () => ({ left: 700, right: 980, top: 200, bottom: 500 }) };
  const context = {
    bridge: () => ({ snapshot: () => snap }), activeSuggestion: { cowIndex: 3 },
    document: { querySelector: (selector: string) => selector === '#rangerBrainPanel' ? panel : null },
    $: () => null, tether: null, card, innerWidth: 1200, innerHeight: 800, clearSuggestion: () => {},
  };
  runInNewContext(`${brain.slice(start, end)}; placeOverlay()`, context);
  const left = Number.parseFloat(card.style.left), top = Number.parseFloat(card.style.top);
  assert.ok(Number.isFinite(left) && Number.isFinite(top), 'the card is positioned');
  const overlaps = (box: { left: number; right: number; top: number; bottom: number }) => left < box.right && left + card.offsetWidth > box.left && top < box.bottom && top + card.offsetHeight > box.top;
  assert.equal(overlaps({ left: 446, right: 554, top: 266, bottom: 374 }), false, 'target cow stays visible');
  assert.equal(overlaps({ left: 144, right: 216, top: 264, bottom: 383 }), false, 'ranger stays visible');
  assert.equal(overlaps(panel.getBoundingClientRect()), false, 'open panel stays visible');
});

