import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

for (const file of ['web/public/trading-room.html', 'web/dist/trading-room.html']) {
  test(`${file}: Brain menu stays near the ranger while avoiding the selected cow`, () => {
    const source = readFileSync(file, 'utf8');
    const start = source.indexOf('  function positionPanel() {');
    const end = source.indexOf('\n  function setOpen(', start);
    assert.ok(start >= 0 && end > start, 'panel positioning exists');
    let cow: object | null = null;
    const panel = { style: {} as Record<string, string>, getBoundingClientRect: () => ({ width: 320, height: 300 }) };
    const context = {
      innerWidth: 1280, innerHeight: 800, panel,
      window: {
        __zeronineRanger: { screen: () => ({ x: 500, y: 400 }) },
        __zeronineBrainBridge: { activeSnipe: () => cow ? { cowId: 1 } : null, snapshot: () => ({ zoom: 1, herd: cow ? [cow] : [] }) },
      },
    };
    const place = runInNewContext(source.slice(start, end) + '\npositionPanel;', context) as () => void;
    place();
    assert.equal(panel.style.left, '534px', 'near side is 34px from ranger center');
    cow = { index: 1, sx: 650, sy: 400 };
    place();
    assert.equal(panel.style.left, '146px', 'panel moves to the opposite side when a cow would be covered');
    context.innerWidth = 390;
    panel.style.left = 'mobile-sheet';
    place();
    assert.equal(panel.style.left, 'mobile-sheet', 'mobile sheet keeps its own placement');
  });
}
