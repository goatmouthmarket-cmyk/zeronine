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
  const instrumented = script.replace(/\}\)\(\);\s*$/, 'globalThis.testDefeat = onCowDefeated; globalThis.testMission = recordMission; globalThis.testSplit = splitDigits; globalThis.testSubmit = submitContract; globalThis.testConnect = (id) => { connectedAccount = true; activeAccountId = id; }; globalThis.testSpacing = () => { for (const cow of cows) cow.alive = false; cows[0].alive = cows[1].alive = true; cows[0].x = cows[1].x = ghost.x = 400; cows[0].y = cows[1].y = ghost.y = 400; ghostCow = null; separatePastureActors(); return { cows: cows.slice(0, 2), ghost, spot: findGhostCowSpot(cows[0]) }; };})();');
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
  const spacing = context.testSpacing();
  assert.ok(Math.hypot(spacing.cows[0].x - spacing.cows[1].x, spacing.cows[0].y - spacing.cows[1].y) >= 124, 'overlapping cows are separated');
  for (const cow of spacing.cows) {
    assert.ok(Math.hypot(cow.x - spacing.ghost.x, cow.y - spacing.ghost.y) >= 94, 'ghost keeps clear of cows');
    assert.ok(Math.hypot(cow.x - spacing.spot.x, cow.y - spacing.spot.y) >= 125, 'ghost cow spawns in an open spot');
  }
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

test('pasture recovery sizes from the entered base stake without the bot max stake', () => {
  const html = readFileSync(new URL('../web/public/trading-room.html', import.meta.url), 'utf8');
  const script = html.split('<script>')[1]?.split('</script>')[0];
  assert.ok(script);
  const plannerStart = script.indexOf('function plannedCowStake(');
  const plannerEnd = script.indexOf('function moveToward(', plannerStart);
  assert.ok(plannerStart >= 0 && plannerEnd > plannerStart, 'the pasture stake planner exists');
  const planner = script.slice(plannerStart, plannerEnd).trim();
  const context = runInNewContext(`
    let sessionRecovery = { amount: 0, planDebt: 0, winsApplied: 0 };
    ${planner}
    ({
      planCowStake: plannedCowStake,
      setRecovery: (amount, planDebt, winsApplied) => { sessionRecovery = { amount, planDebt, winsApplied }; },
    })
  `) as {
    planCowStake: (base: number, contract: Record<string, number | string>, state: { balance: number }) => { stake: number } | null;
    setRecovery: (amount: number, planDebt: number, winsApplied: number) => void;
  };
  const target = { kind: 'OVER', barrier: 1, payout: 2 };
  const account = { balance: 100 };

  assert.equal(context.planCowStake(4, target, account)?.stake, 4);
  context.setRecovery(10, 10, 0);
  assert.equal(context.planCowStake(4, target, account)?.stake, 4, 'recovery does not reduce the entered base stake');
  assert.equal(context.planCowStake(1, target, account)?.stake, 3.33, 'debt recovery raises a smaller base stake');
});

test('pasture background is rendered once and reused', () => {
  const html = readFileSync(new URL('../web/public/trading-room.html', import.meta.url), 'utf8');
  const script = html.split('<script>')[1]?.split('</script>')[0];
  assert.ok(script);
  const start = script.indexOf('function getPastureBackground(');
  const end = script.indexOf('function advanceFloatingEffects(', start);
  assert.ok(start >= 0 && end > start, 'the pasture background cache exists');
  const cache = script.slice(start, end);
  const result = runInNewContext(`
    let pastureBackground = null;
    const world = { w: 1300, h: 850 };
    let renderCount = 0;
    const createdCanvas = { getContext: () => ({}) };
    const document = { createElement: () => createdCanvas };
    function paintPastureBackground() { renderCount += 1; }
    ${cache}
    ({ first: getPastureBackground(), second: getPastureBackground(), renderCount, width: createdCanvas.width, height: createdCanvas.height })
  `) as { first: object; second: object; renderCount: number; width: number; height: number };

  assert.equal(result.first, result.second);
  assert.equal(result.renderCount, 1, 'static scenery is painted once');
  assert.equal(result.width, 1300);
  assert.equal(result.height, 850);
});

test('pasture win effects expire by elapsed time instead of frame count', () => {
  const html = readFileSync(new URL('../web/public/trading-room.html', import.meta.url), 'utf8');
  const script = html.split('<script>')[1]?.split('</script>')[0];
  assert.ok(script);
  const start = script.indexOf('function advanceFloatingEffects(');
  const end = script.indexOf('function draw(t)', start);
  assert.ok(start >= 0 && end > start, 'the floating-effect updater exists');
  const updateEffects = script.slice(start, end);
  const result = runInNewContext(`
    let fx = [{ life: 1.4, y: 0 }];
    ${updateEffects}
    advanceFloatingEffects(100, 0.016);
    advanceFloatingEffects(800, 0.05);
    const remainingLife = fx[0]?.life ?? null;
    advanceFloatingEffects(1600, 0.05);
    ({ remainingLife, remainingEffects: fx.length })
  `) as { remainingLife: number | null; remainingEffects: number };

  assert.equal(result.remainingLife, 0.7);
  assert.equal(result.remainingEffects, 0, 'the effect is removed once its wall-clock duration ends');
});

test('paper scout shows the matching market, ticket details, and virtual outcome', () => {
  const html = readFileSync(new URL('../web/public/trading-room.html', import.meta.url), 'utf8');
  const script = html.split('<script>')[1]?.split('</script>')[0];
  assert.ok(script);
  const start = script.indexOf('function renderPaper(state){');
  const end = script.indexOf('function estimateRecoveryWins(', start);
  assert.ok(start >= 0 && end > start, 'the paper scout renderer exists');
  const elements = new Map<string, { textContent: string; title: string; dataset: Record<string, string> }>();
  const element = (id: string) => {
    if (!elements.has(id)) elements.set(id, { textContent: '', title: '', dataset: {} });
    return elements.get(id)!;
  };
  const renderPaper = runInNewContext(`${script.slice(start, end)}; renderPaper`, {
    $: element,
    marketName: (symbol: string) => symbol === 'R_100' ? 'Volatility 100 Index' : symbol,
  }) as (state: Record<string, any>) => void;
  const openContract = {
    market: 'R_100', direction: 'over', barrier: 2, entryDigit: 1, stake: 2, status: 'open',
  };
  renderPaper({
    paperSimulation: {
      phase: 'running', totalTrades: 4, wins: 2, losses: 2, netPnl: 0,
      openContract, lastSettled: null,
    },
    markets: [{ symbol: 'R_100', fresh: true, lastEpoch: Date.now() / 1000, lastDigit: 3 }],
  });
  assert.equal(element('paperMiniStatus').textContent, 'OPEN | R_100 | OVER 2');
  assert.equal(element('paperMiniStats').textContent, 'Volatility 100 Index | ENTRY 1 > LIVE 3 | VIRTUAL $2.00');
  assert.equal(element('paperMini').dataset.phase, 'open');

  renderPaper({
    paperSimulation: {
      phase: 'running', totalTrades: 4, wins: 3, losses: 1, netPnl: 1.8,
      openContract: null,
      lastSettled: { ...openContract, status: 'won', exitDigit: 3, profit: 1.8 },
    },
    markets: [],
  });
  assert.equal(element('paperMiniStatus').textContent, 'WON | R_100 | OVER 2');
  assert.equal(element('paperMiniStats').textContent, 'Volatility 100 Index | ENTRY 1 > EXIT 3 | +$1.80 VIRTUAL');
});

test('fresh paper entry signals show a red bet-now marker without replacing other highlights', () => {
  const html = readFileSync(new URL('../web/public/trading-room.html', import.meta.url), 'utf8');
  const script = html.split('<script>')[1]?.split('</script>')[0];
  assert.ok(script);

  assert.match(script, /signalFeatured=v!==ghostCow&&v\.contract\?\.hitSignal===true/);
  assert.match(script, /if\(signalFeatured\)\{c\.save\(\);c\.strokeStyle='#ff4057'/);
  assert.match(script, /entryAlert=a\.hitSignal\?'<em class="entry-alert">BET NOW<\/em>':'/);
  assert.match(script, /v===ghostCow&&tag\.symbol\?String\(tag\.symbol\)/);
});
