import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

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

test('the Brain suggestion card uses the shared collision placement', () => {
  const brain = read('pasture-brain-refine.js');
  assert.ok(brain.includes('sharedUi.placeFloating(card'));
  assert.ok(brain.includes("avoid: ['#rangerBrainPanel'"));
});
