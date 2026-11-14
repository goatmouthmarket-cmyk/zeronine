import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';

for (const asset of ['public', 'dist']) {
  const html = readFileSync(new URL(`../web/${asset}/trading-room.html`, import.meta.url), 'utf8');
  const slice = (from: string, to: string): string => {
    const start = html.indexOf(from), end = html.indexOf(to, start);
    assert.ok(start >= 0 && end > start, `${from} exists in ${asset}`);
    return html.slice(start, end);
  };

  test(`${asset}: guest mouse and touch select safe paper; signed-in left click keeps its original path`, () => {
    const handlers = new Map<string, (event: any) => void>();
    const cow = { alive: true, x: 100, y: 100, hp: 3, contract: { symbol: 'R_100' } };
    const paper: unknown[] = [], orders: unknown[] = [], tasks: Array<() => void> = [];
    let now = 1000, authenticatedChecks = 0;
    const context: Record<string, any> = {
      canvas: { addEventListener: (name: string, handler: (event: any) => void) => handlers.set(name, handler) },
      cows: [cow], connectedAccount: false, camera: () => ({ x: 0, y: 0 }), zoom: 1,
      performance: { now: () => now }, suppressCanvasClickUntil: 0,
      ghostTraderAtClientPoint: () => false, setGhostPanelOpen() {},
      beginManualPaperTrade: (target: unknown) => { paper.push(target); return true; },
      selectedManualMinEdge: () => { authenticatedChecks++; return NaN; }, notify() {},
      parent: { postMessage: (message: unknown) => orders.push(message) },
      setTimeout: (fn: () => void) => { tasks.push(fn); return tasks.length; }, clearTimeout() {},
    };
    createContext(context);
    runInContext(slice('function findCowAtClientPoint(', 'function updateAutoPaperResearch('), context);
    runInContext(slice("canvas.addEventListener('click',e=>{", 'function selectRangerAutoCandidate('), context);
    const mouse = { clientX: 100, clientY: 100, preventDefault() {} };
    handlers.get('click')!(mouse);
    handlers.get('contextmenu')!(mouse);
    // A touch tap emits a normal click after pointerup.
    const touch = { ...mouse, pointerType: 'touch', pointerId: 1 };
    handlers.get('pointerdown')!(touch); handlers.get('pointerup')!(touch); handlers.get('click')!(touch);
    // A long press opens one paper trade and suppresses the following synthetic click.
    handlers.get('pointerdown')!(touch); tasks.at(-1)!(); handlers.get('click')!(touch);
    assert.equal(paper.length, 4); assert.equal(cow.hp, 3); assert.equal(cow.alive, true);
    assert.deepEqual(orders, []);
    context.connectedAccount = true; now += 1000;
    handlers.get('click')!(mouse);
    assert.equal(authenticatedChecks, 1, 'authenticated selection reaches the unchanged live-trade validation');
    assert.equal(paper.length, 4, 'authenticated left click does not become a paper trade');
  });

  test(`${asset}: guest Auto uses one paper trade per fresh tick and never submits an account order`, () => {
    let now = 1000, tick = { epoch: 1, quote: 10, digit: 0 };
    const opened: string[] = [], trades: Array<{ status: string }> = [], orders: unknown[] = [];
    const cow = { contract: { symbol: 'R_100', market: 'Volatility 100' } };
    const context: Record<string, any> = {
      performance: { now: () => now }, manualPaperTrades: trades,
      paperFreshEntryTick: () => tick, paperTickKey: (value: typeof tick) => `${value.epoch}|${value.quote}|${value.digit}`,
      beginManualPaperTrade: (_cow: unknown, source: string) => { opened.push(source); trades.push({ status: 'open' }); return true; },
      rangerAutoStatus: '', renderRangerAutoHud() {}, parent: { postMessage: (message: unknown) => orders.push(message) },
    };
    createContext(context);
    runInContext(slice('const guestAutoPaperLastTicks=', 'function beginRangerAutoAim(') + '\nthis.start = beginGuestAutoPaper;', context);
    context.start(cow); assert.deepEqual(opened, ['auto_paper']);
    now += 2000; context.start(cow); assert.equal(opened.length, 1, 'waits for open paper outcome');
    trades[0].status = 'won'; context.start(cow); assert.equal(opened.length, 1, 'does not re-enter the same tick');
    tick = { epoch: 2, quote: 11, digit: 1 }; context.start(cow); assert.equal(opened.length, 2);
    assert.deepEqual(orders, []);
  });

  test(`${asset}: guest Auto selection routes to paper before account order or cow aim`, () => {
    const selected: unknown[] = [], orders: unknown[] = [];
    const cow = { alive: true, hp: 3, contract: { symbol: 'R_100' } };
    const context: Record<string, any> = {
      connectedAccount: false, target: null,
      beginGuestAutoPaper: (target: unknown) => selected.push(target),
      parent: { postMessage: (message: unknown) => orders.push(message) },
    };
    createContext(context);
    runInContext(slice('function beginRangerAutoAim(', 'function updateRangerAutomation()') + '\nthis.aim = beginRangerAutoAim;', context);
    context.aim(cow, cow.contract);
    assert.deepEqual(selected, [cow]); assert.equal(context.target, null);
    assert.equal(cow.hp, 3); assert.equal(cow.alive, true); assert.deepEqual(orders, []);
  });

  test(`${asset}: a lingering arrow cannot damage or kill a cow after disconnect`, () => {
    const start = html.indexOf('for(let i=shots.length-1;i>=0;i--)');
    const end = html.indexOf('advanceFloatingEffects(now,dt);', start);
    assert.ok(start >= 0 && end > start);
    for (const authenticated of [false, true]) {
      const cow = { alive: true, x: 100, y: 100, hp: 3, max: 3 };
      let calls = 0;
      const context: Record<string, any> = {
        shots: [{ x: 100, y: 100, vx: 0, vy: 0, target: cow, edge: 0 }],
        connectedAccount: authenticated, now: 100, dt: 0, rangerManualShots: 3, aimLastProgressAt: 0,
        rangerDamageForShots: () => { calls++; return 1; }, fx: [], world: { w: 900, h: 900 },
      };
      createContext(context); runInContext(html.slice(start, end), context);
      assert.equal(calls, authenticated ? 1 : 0);
      assert.equal(cow.hp, authenticated ? 2 : 3); assert.equal(cow.alive, true);
    }
  });
}
