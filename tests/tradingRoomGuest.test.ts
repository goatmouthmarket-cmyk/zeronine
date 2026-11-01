import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

test('guest cow defeat is practice and does not send a trade request', () => {
  const html = readFileSync(new URL('../web/public/trading-room.html', import.meta.url), 'utf8');
  const script = html.split('<script>')[1]?.split('</script>')[0];
  assert.ok(script);
  const messages: Array<{ type: string; payload?: { stake?: number; market?: string; barrier?: number } }> = [];
  const listeners = new Map<string, Map<string, () => void>>();
  const savedStyles = new Map<string, string>();
  const elements = new Map<string, any>();
  const element = (id: string): any => {
    if (!elements.has(id)) elements.set(id, {
      style: {},
      dataset: {},
      classList: { add() {}, remove() {}, toggle() {} },
      addEventListener: (type: string, listener: () => void) => {
        if (!listeners.has(id)) listeners.set(id, new Map());
        listeners.get(id)!.set(type, listener);
      },
      setAttribute() {},
      querySelector: (selector: string) => selector === 'svg path' ? { setAttribute() {} } : null,
      removeAttribute() {},
      replaceChildren() {},
      appendChild() {},
      getContext: () => ({ setTransform() {} }),
    });
    return elements.get(id);
  };
  const context: Record<string, any> = {
    document: { querySelector: () => element('canvas'), getElementById: element, createElement: () => element('child'), addEventListener() {} },
    parent: { postMessage: (message: { type: string; payload?: { stake?: number; market?: string; barrier?: number } }) => messages.push(message) },
    location: { origin: 'https://example.test' },
    window: { addEventListener() {} }, addEventListener() {}, requestAnimationFrame() {},
    setInterval: () => 1, clearInterval() {},
    AbortController: class { signal = {}; abort() {} },
    innerWidth: 800, innerHeight: 600, devicePixelRatio: 1,
    performance: { now: () => 100 }, setTimeout: () => 1, clearTimeout() {},
    fetch: () => new Promise(() => {}),
    crypto: { randomUUID: () => 'test-event-id' },
    localStorage: {
      getItem: () => null,
      setItem: (key: string, value: string) => savedStyles.set(key, value),
    },
  };
  const instrumented = script.replace(/\}\)\(\);\s*$/, 'globalThis.testDefeat = onCowDefeated; globalThis.testMission = recordMission; globalThis.testSplit = splitDigits; globalThis.testSubmit = submitContract; globalThis.testConnect = (id) => { connectedAccount = true; activeAccountId = id; liveMarkets = [{ symbol: "SELECTED", fresh: true, lastEpoch: Date.now() / 1000 }]; }; globalThis.testStyle = () => cowBetStyle; globalThis.testSpacing = () => { for (const cow of cows) cow.alive = false; cows[0].alive = cows[1].alive = true; cows[0].x = cows[1].x = 400; cows[0].y = cows[1].y = 400; ghost.x = 600; ghost.y = 400; ghostCow = null; separatePastureActors(); return { cows: cows.slice(0, 2), ghost, spot: findGhostCowSpot(cows[0]) }; };})();');
  assert.notEqual(instrumented, script);
  runInNewContext(instrumented, context);
  const rangerPanel = elements.get('rangerAutoHud');
  const rangerToggle = listeners.get('rangerAutoToggle')?.get('click');
  assert.equal(rangerPanel.hidden, true, 'automation controls start hidden behind the Play icon');
  assert.ok(rangerToggle);
  rangerToggle();
  assert.equal(rangerPanel.hidden, false, 'Play opens the Ranger controls');
  rangerToggle();
  assert.equal(rangerPanel.hidden, true, 'the same control hides the Ranger menu');
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
  const styleControl = element('cowBetStyle');
  styleControl.value = 'chase';
  listeners.get('cowBetStyle')?.get('change')?.();
  assert.equal(context.testStyle(), 'chase', 'the pasture selector changes the active recovery plan');
  assert.equal(savedStyles.get('pasture-manual-bet-style'), 'chase', 'the selected style is persisted');
});

test('pasture base and martingale styles calculate from the entered stake', () => {
  const html = readFileSync(new URL('../web/public/trading-room.html', import.meta.url), 'utf8');
  const script = html.split('<script>')[1]?.split('</script>')[0];
  assert.ok(script);
  const plannerStart = script.indexOf('function plannedCowStake(');
  const plannerEnd = script.indexOf('function moveToward(', plannerStart);
  assert.ok(plannerStart >= 0 && plannerEnd > plannerStart, 'the pasture stake planner exists');
  const planner = script.slice(plannerStart, plannerEnd).trim();
  const context = runInNewContext(`
    let sessionRecovery = { amount: 0, planDebt: 0, winsApplied: 0 };
    let cowBetStyle = 'base';
    ${planner}
    ({
      planCowStake: plannedCowStake,
      setRecovery: (amount, planDebt, winsApplied) => { sessionRecovery = { amount, planDebt, winsApplied }; },
      setStyle: (style) => { cowBetStyle = style; },
    })
  `) as {
    planCowStake: (base: number, contract: Record<string, number | string>, state: { balance: number; maxStake?: number }, style?: string) => { stake: number; recoveryTarget?: number; reason?: string } | null;
    setRecovery: (amount: number, planDebt: number, winsApplied: number) => void;
    setStyle: (style: string) => void;
  };
  const target = { kind: 'OVER', barrier: 1, payout: 2 };
  const account = { balance: 100 };

  assert.equal(context.planCowStake(4, target, account)?.stake, 4);
  context.setRecovery(10, 10, 0);
  assert.equal(context.planCowStake(4, target, account, 'base')?.stake, 4, 'base style stays flat during recovery');
  assert.equal(context.planCowStake(1, target, account, 'martingale')?.stake, 10, 'martingale sizes to recover the full debt in one win');
});

test('pasture recovery styles scale from large base stakes and report balance limits', () => {
  const html = readFileSync(new URL('../web/public/trading-room.html', import.meta.url), 'utf8');
  const script = html.split('<script>')[1]?.split('</script>')[0];
  assert.ok(script);
  const start = script.indexOf('function plannedCowStake(');
  const end = script.indexOf('function moveToward(', start);
  assert.ok(start >= 0 && end > start, 'the pasture stake planner exists');
  const planner = script.slice(start, end).trim();
  const context = runInNewContext(`
    let sessionRecovery = { amount: 100, planDebt: 100, winsApplied: 0 };
    let cowBetStyle = 'martingale';
    ${planner}
    ({ planCowStake: plannedCowStake })
  `) as {
    planCowStake: (base: number, contract: Record<string, number | string>, state: { balance: number; maxStake?: number }, style?: string) => { stake: number; recoveryTarget?: number; reason?: string } | null;
  };
  const contract = { kind: 'OVER', barrier: 1, payout: 1.8 };

  assert.equal(context.planCowStake(100, contract, { balance: 1_000, maxStake: 25 }, 'martingale')?.stake, 125);
  assert.equal(context.planCowStake(10, contract, { balance: 1_000 }, 'boosted')?.stake, 131.25);
  assert.equal(context.planCowStake(10, contract, { balance: 1_000 }, 'chase')?.stake, 43.75);
  assert.equal(context.planCowStake(10, contract, { balance: 1_000 }, 'base')?.stake, 10);
  const blocked = context.planCowStake(100, contract, { balance: 130 }, 'martingale');
  assert.equal(blocked?.stake, 0, 'a required recovery stake is not silently reduced');
  assert.match(blocked?.reason ?? '', /90% balance limit/i);
});

test('pasture recovery tracks tagged cow losses without counting other manual or bot trades', () => {
  const html = readFileSync(new URL('../web/public/trading-room.html', import.meta.url), 'utf8');
  const script = html.split('<script>')[1]?.split('</script>')[0];
  assert.ok(script);
  const start = script.indexOf('function updateSessionRecovery(');
  const end = script.indexOf('function renderAccountHud(', start);
  assert.ok(start >= 0 && end > start, 'the session recovery tracker exists');
  const tracker = script.slice(start, end);
  const saved = new Map<string, string>([
    ['deriv-cows-session-recovery-v2:DEMO123', JSON.stringify({ amount: 0, planDebt: 0, winsApplied: 0, processed: ['1'], cowTradeIds: [] })],
  ]);
  const context = runInNewContext(`
    let sessionRecovery = { amount: 0, planDebt: 0, winsApplied: 0, processed: [] };
    let activeAccountId = 'DEMO123';
    function updateCowBetStyleHint() {}
    ${tracker}
    ({ updateSessionRecovery, registerCowTrade, getRecovery: () => sessionRecovery })
  `, {
    sessionStorage: {
      getItem: (key: string) => saved.get(key) ?? null,
      setItem: (key: string, value: string) => saved.set(key, value),
    },
  }) as {
    updateSessionRecovery: (state: Record<string, unknown>) => void;
    registerCowTrade: (id: number) => void;
    getRecovery: () => { amount: number };
  };

  context.registerCowTrade(1);
  context.updateSessionRecovery({
    accountId: 'DEMO123',
    trades: [
      { id: 1, status: 'lost', stake: 25, profit: -25, origin: 'manual' },
      { id: 2, status: 'lost', stake: 75, profit: -75, origin: 'bot' },
      { id: 3, status: 'lost', stake: 50, profit: -50, origin: 'manual' },
    ],
  });
  assert.equal(context.getRecovery().amount, 25);
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

test('paper ghost shows its result without a floating popup', () => {
  const html = readFileSync(new URL('../web/public/trading-room.html', import.meta.url), 'utf8');
  const script = html.split('<script>')[1]?.split('</script>')[0];
  assert.ok(script);
  const start = script.indexOf('function syncGhostPaper(state){');
  const end = script.indexOf('function renderPaper(state){', start);
  assert.ok(start >= 0 && end > start, 'the paper ghost synchronizer exists');
  const syncGhostPaper = runInNewContext(`
    let ghostPaperState = null;
    let ghostPaperContractId = null;
    let ghostPaperResultId = null;
    let ghostPaperResultUntil = 0;
    let ghostLastTickSeq = 0;
    let ghostCow = { alive: false, hp: 1, contract: { symbol: 'R_100' } };
    let ghost = { target: {} };
    let ghostArrows = [{ x: 0, y: 0 }];
    const fx = [];
    const performance = { now: () => 100 };
    function ghostContractKey(contract) { return String(contract.runId || '') + ':' + String(contract.id); }
    ${script.slice(start, end)}
    ({ syncGhostPaper, getState: () => ({ ghostCow, fx }) })
  `) as {
    syncGhostPaper: (state: Record<string, any>) => void;
    getState: () => { ghostCow: { alive: boolean; hp: number }; fx: unknown[] };
  };

  syncGhostPaper.syncGhostPaper({
    paperSimulation: {
      phase: 'running',
      openContract: null,
      lastSettled: { id: 8, runId: 'run-1', market: 'R_100', status: 'won' },
    },
    markets: [],
  });
  assert.equal(syncGhostPaper.getState().ghostCow.alive, true);
  assert.equal(syncGhostPaper.getState().ghostCow.hp, 0, 'a paper win stays visible on the ghost');
  assert.equal(syncGhostPaper.getState().fx.length, 0, 'paper results never create a floating popup');
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

test('cooldown timer is centered in the header across viewport sizes', () => {
  const html = readFileSync(new URL('../web/public/trading-room.html', import.meta.url), 'utf8');

  assert.match(html, /#breakTimer\.visible\{top:12px!important;left:50%!important;right:auto!important;transform:translateX\(-50%\)/);
  assert.match(html, /#breakTimer\.visible\{top:12px!important;font-size:10px!important\}/);
});

test('ranger auto chooses only fresh positive-edge highlighted contracts', () => {
  const html = readFileSync(new URL('../web/public/trading-room.html', import.meta.url), 'utf8');
  const script = html.split('<script>')[1]?.split('</script>')[0];
  assert.ok(script);
  const start = script.indexOf('function selectRangerAutoCandidate(');
  const end = script.indexOf('function updateRangerAutoProgress(', start);
  assert.ok(start >= 0 && end > start, 'the ranger candidate selector exists');
  const selectCandidate = runInNewContext(`${script.slice(start, end)}; selectRangerAutoCandidate`) as (items: Array<Record<string, unknown>>) => Record<string, unknown> | null;
  const valid = {
    fresh: true, edge: 0.02, score: 0.08, p: 0.72, digitSamples: 35, riseSamples: 14,
    alignedRise: 0.8, alignedRate: 0.65, hitSignal: false, payout: 1.5,
  };
  const bestConfidence = { ...valid, symbol: 'YELLOW', score: 0.2 };
  const bestEdge = { ...valid, symbol: 'GREEN', edge: 0.09, score: 0.1 };
  const stale = { ...valid, symbol: 'STALE', score: 0.01, fresh: false };
  const selection = selectCandidate([bestConfidence, bestEdge, stale]);

  assert.equal(selection?.symbol, 'YELLOW', 'the best scored highlighted cow wins the selection');
  assert.equal(selectCandidate([{ ...valid, edge: 0 }]), null, 'non-positive edge is never eligible');
  assert.equal(selectCandidate([
    { ...valid, symbol: 'GREEN-TOO-UNCERTAIN', edge: 0.1, p: 0.6 },
    { ...valid, symbol: 'YELLOW-TOO-UNCERTAIN', score: 0.3, p: 0.6 },
    { ...valid, symbol: 'NOT-HIGHLIGHTED', edge: 0.03, score: 0.1 },
  ]), null, 'an eligible but unhighlighted cow is not selected');
  assert.equal(selectCandidate([{ ...valid, symbol: 'BET-NOW', hitSignal: true }])?.symbol, 'BET-NOW');
});

test('ranger auto requires three distinct fresh ticks for one contract', () => {
  const html = readFileSync(new URL('../web/public/trading-room.html', import.meta.url), 'utf8');
  const script = html.split('<script>')[1]?.split('</script>')[0];
  assert.ok(script);
  const start = script.indexOf('function updateRangerAutoProgress(');
  const end = script.indexOf('function renderRangerAutoHud(', start);
  assert.ok(start >= 0 && end > start, 'the ranger tick confirmation tracker exists');
  const updateProgress = runInNewContext(`${script.slice(start, end)}; updateRangerAutoProgress`) as (
    progress: { key: string | null; lastSeq: number; confirmations: number },
    candidate: { symbol: string; kind: string; barrier: number; tickSeq: number } | null,
  ) => { key: string | null; lastSeq: number; confirmations: number };
  const candidate = { symbol: 'R_100', kind: 'OVER', barrier: 2, tickSeq: 50 };
  let progress = updateProgress({ key: null, lastSeq: -1, confirmations: 0 }, candidate);
  assert.equal(progress.confirmations, 1);
  progress = updateProgress(progress, candidate);
  assert.equal(progress.confirmations, 1, 'repeated state without a new tick does not count');
  progress = updateProgress(progress, { ...candidate, tickSeq: 51 });
  assert.equal(progress.confirmations, 2);
  progress = updateProgress(progress, { ...candidate, tickSeq: 52 });
  assert.equal(progress.confirmations, 3);
  progress = updateProgress(progress, { ...candidate, barrier: 3, tickSeq: 53 });
  assert.equal(progress.confirmations, 1, 'a changed contract starts a fresh confirmation sequence');
});

test('ranger auto controls open from a visible Play launcher outside the player HUD', () => {
  const html = readFileSync(new URL('../web/public/trading-room.html', import.meta.url), 'utf8');
  const hudStart = html.indexOf('<div id="playerHud">');
  const rangerStart = html.indexOf('<section id="rangerAutoHud"');
  const hudEnd = html.indexOf('</div><button id="rangerAutoToggle"', hudStart);

  assert.ok(hudStart >= 0 && hudEnd > hudStart && rangerStart > hudEnd, 'Ranger Auto launcher is a visible HUD sibling, not inside the mobile-hidden player panel');
  assert.match(html, /id="rangerAutoToggle" type="button" aria-label="Show Ranger Auto controls"/);
  assert.match(html, /id="rangerAutoHud" aria-label="Ranger automation" hidden/);
  assert.match(html, /#rangerAutoHud\{top:268px;left:12px/);
  assert.match(html, /id="rangerAutoArm" type="button" hidden>ARM REAL 10 MIN/);
  assert.match(html, /id="rangerAutoStake" type="number"/);
  assert.match(html, /id="rangerAutoStyle">/);
  assert.match(html, /id="rangerAutoActivity" hidden/);
  assert.match(html, /id="rangerAutoStart" type="button" aria-label="Start Ranger Auto"/);
  assert.match(html, /#rangerAutoActivity\{position:fixed;z-index:23/);
  assert.match(html, /#rangerAutoActivity\{position:fixed;z-index:23;top:268px;left:12px;width:min\(260px,calc\(100vw - 24px\)\);padding:0;border:0;border-radius:0;background:transparent/);
  assert.match(html, /toggle\.querySelector\('svg path'\).*rangerAutoActive\?'M8 5v14M16 5v14'/);
  assert.match(html, /#guestBanner\{top:56px!important;left:50%!important/);
  assert.match(html, /@media\(max-width:999\.98px\)\{#rangerAutoToggle\{top:110px;left:8px\}#rangerAutoHud\{top:158px;left:8px/);
});

test('ranger auto start allows demo accounts and explains real-account requirements', () => {
  const html = readFileSync(new URL('../web/public/trading-room.html', import.meta.url), 'utf8');
  const script = html.split('<script>')[1]?.split('</script>')[0];
  assert.ok(script);
  const start = script.indexOf('function rangerAutoStartBlocker(');
  const end = script.indexOf('function renderRangerAutoHud(', start);
  assert.ok(start >= 0 && end > start, 'the Ranger Auto start gate exists');
  const blockerSource = script.slice(start, end);
  const getBlocker = (connectedAccount: boolean, lastRoomState: Record<string, unknown> | null, armedUntil = 0, stakeValue = '1'): string => {
    const readBlocker = runInNewContext(
      `let connectedAccount=${JSON.stringify(connectedAccount)};let lastRoomState=${JSON.stringify(lastRoomState)};let rangerAutoArmedUntil=${armedUntil};const $=()=>({value:${JSON.stringify(stakeValue)}});${blockerSource};rangerAutoStartBlocker`,
    ) as () => string;
    return readBlocker();
  };

  assert.equal(getBlocker(true, { accountMode: 'demo', owner: false, feedConnected: true }), '');
  assert.match(script, /if\(lastRoomState\?\.accountMode==='real'&&!lastRoomState\.owner\)/, 'the active loop keeps demo automation available without weakening the real-account owner gate');
  assert.equal(getBlocker(false, null), '', 'demo automation can start before connecting and wait safely');
  assert.match(getBlocker(true, { accountMode: 'real', owner: false, feedConnected: true }, Date.now() + 60_000), /owner controls/);
  assert.equal(getBlocker(true, { accountMode: 'demo', owner: false, feedConnected: false }), '', 'demo automation can start while the feed reconnects');
  assert.match(getBlocker(true, { accountMode: 'real', owner: true, feedConnected: true }), /ARM REAL/);
  assert.match(getBlocker(true, { accountMode: 'demo', owner: false, feedConnected: true }, 0, ''), /positive base stake/);
});

test('ranger auto activity only includes its five newest tracked trades', () => {
  const html = readFileSync(new URL('../web/public/trading-room.html', import.meta.url), 'utf8');
  const script = html.split('<script>')[1]?.split('</script>')[0];
  assert.ok(script);
  const start = script.indexOf('function rangerAutoTrackedTrades(');
  const end = script.indexOf('function rangerAutoRecentTrades(', start);
  assert.ok(start >= 0 && end > start, 'the Ranger Auto trade filter exists');
  const trackedTrades = runInNewContext(`${script.slice(start, end)}; rangerAutoTrackedTrades`) as (
    trades: Array<{ id: number }>,
    ids: Set<number>,
  ) => Array<{ id: number }>;
  const recentStart = start;
  const recentEnd = script.indexOf('function rangerPatrolPoint(', recentStart);
  const recentTrades = runInNewContext(`${script.slice(recentStart, recentEnd)}; rangerAutoRecentTrades`) as (
    trades: Array<{ id: number }>,
    ids: Set<number>,
  ) => Array<{ id: number }>;
  const trades = Array.from({ length: 8 }, (_, index) => ({ id: 8 - index }));

  assert.equal(trackedTrades(trades, new Set([1, 2, 3, 4, 5, 6, 7])).length, 7, 'session P&L can include every Ranger trade');
  assert.deepEqual([...recentTrades(trades, new Set([1, 2, 3, 4, 5, 6, 7])).map((trade) => trade.id)], [7, 6, 5, 4, 3]);
  assert.deepEqual([...recentTrades(trades, new Set([8])).map((trade) => trade.id)], [8]);
});

test('ranger auto activity skips rebuilding unchanged display data', () => {
  const html = readFileSync(new URL('../web/public/trading-room.html', import.meta.url), 'utf8');
  const script = html.split('<script>')[1]?.split('</script>')[0];
  assert.ok(script);
  const start = script.indexOf('function rangerAutoTrackedTrades(');
  const end = script.indexOf('function stopRangerAuto(', start);
  assert.ok(start >= 0 && end > start, 'the activity renderer is available');

  const elements: Record<string, object> = {};
  const createElement = (tag: string) => ({
    tag,
    dataset: {},
    children: [] as unknown[],
    append(...children: unknown[]) {
      this.children.push(...children);
    },
  });
  const activity = Object.assign(createElement('section'), {
    hidden: true,
    offsetHeight: 60,
    style: {} as Record<string, string>,
    getBoundingClientRect: () => ({ left: 12, bottom: 80 }),
  });
  const pnl = Object.assign(createElement('strong'), { textContent: '' });
  const list = createElement('ol') as ReturnType<typeof createElement> & {
    replacements: number;
    replaceChildren: () => void;
  };
  list.replacements = 0;
  list.replaceChildren = () => {
    list.replacements += 1;
    list.children = [];
  };
  elements.rangerAutoActivity = activity;
  elements.rangerAutoPnl = pnl;
  elements.rangerAutoRecent = list;
  elements.rangerAutoToggle = { getBoundingClientRect: () => ({ left: 12, bottom: 80 }) };
  const trackedIds = new Set([1, 2]);
  const render = runInNewContext(`${script.slice(start, end)}; renderRangerAutoActivity`, {
    $: (id: string) => elements[id],
    document: { createElement },
    rangerAutoActive: true,
    rangerAutoTradeIds: trackedIds,
    rangerAutoMenuOpen: false,
    innerHeight: 800,
  }) as (state: { trades: Array<Record<string, unknown>>; currency: string }) => void;
  const state = {
    currency: 'USD',
    trades: [
      { id: 2, status: 'won', profit: 2, market: 'Volatility 50', direction: 'over', barrier: 3 },
      { id: 1, status: 'pending', profit: 0, market: 'Volatility 10', direction: 'under', barrier: 7 },
    ],
  };

  render(state);
  render(state);
  assert.equal(list.replacements, 1, 'identical displayed data does not rebuild the activity list');

  state.trades[0].profit = 3;
  render(state);
  assert.equal(list.replacements, 2, 'a displayed P&L change rebuilds the activity list');

  state.currency = 'EUR';
  render(state);
  assert.equal(list.replacements, 3, 'a currency change rebuilds the activity list');

  trackedIds.clear();
  render(state);
  assert.equal(list.replacements, 4, 'an empty-state change rebuilds the activity list');
  assert.equal(list.children.length, 1);
  assert.equal((list.children[0] as { textContent: string }).textContent, 'No Ranger trades yet');
});

test('ranger patrol moves toward live cows while waiting and stays inside the pasture', () => {
  const html = readFileSync(new URL('../web/public/trading-room.html', import.meta.url), 'utf8');
  const script = html.split('<script>')[1]?.split('</script>')[0];
  assert.ok(script);
  const start = script.indexOf('function rangerPatrolPoint(');
  const end = script.indexOf('function rangerDamageForEdge(', start);
  assert.ok(start >= 0 && end > start, 'the autonomous patrol waypoint helper exists');
  const patrolPoint = runInNewContext(`${script.slice(start, end)}; rangerPatrolPoint`) as (
    player: { x: number; y: number },
    cows: Array<{ x: number; y: number; alive: boolean }>,
    world: { w: number; h: number },
    exclude: object | null,
  ) => { x: number; y: number };
  const nearest = { x: 120, y: 180, alive: true };
  const distant = { x: 700, y: 700, alive: true };
  const ghost = { x: 110, y: 170, alive: true };
  const point = patrolPoint({ x: 100, y: 150 }, [distant, nearest, ghost], { w: 800, h: 800 }, ghost);

  assert.deepEqual({ ...point }, { x: 65, y: 250 }, 'the ranger patrols beside the nearest live cow without leaving the bounds');
  assert.deepEqual(
    { ...patrolPoint({ x: 10, y: 10 }, [{ x: 0, y: 0, alive: true }], { w: 800, h: 800 }, null) },
    { x: 105, y: 110 },
    'waypoints stay within the pasture bounds',
  );
});

test('high positive-edge ranger hits defeat a cow in one guaranteed shot', () => {
  const html = readFileSync(new URL('../web/public/trading-room.html', import.meta.url), 'utf8');
  const script = html.split('<script>')[1]?.split('</script>')[0];
  assert.ok(script);
  const start = script.indexOf('function rangerDamageForEdge(');
  const end = script.indexOf('function renderRangerAutoActivity(', start);
  assert.ok(start >= 0 && end > start, 'the edge-based damage helper exists');
  const damageForEdge = runInNewContext(`${script.slice(start, end)}; rangerDamageForEdge`) as (edge: number, hp: number, level: number) => number;

  assert.equal(damageForEdge(0.06, 3, 1), 3, '6% edge is an instant kill');
  assert.equal(damageForEdge(0.1, 5, 1), 5, '10% edge instantly defeats a higher-health cow');
  assert.equal(damageForEdge(0.059, 3, 1), 1, 'normal edge keeps the existing level-based damage');
});

test('practice shots do not wait for live ticks while connected shots still require them', () => {
  const html = readFileSync(new URL('../web/public/trading-room.html', import.meta.url), 'utf8');
  const script = html.split('<script>')[1]?.split('</script>')[0];
  assert.ok(script);
  const start = script.indexOf('function rangerShotReady(');
  const end = script.indexOf('function renderRangerAutoActivity(', start);
  assert.ok(start >= 0 && end > start, 'the shot readiness helper exists');
  const shotReady = runInNewContext(`${script.slice(start, end)}; rangerShotReady`) as (
    connected: boolean,
    tickSequence: number,
    lastShotTickSeq: number,
    now: number,
    lastShot: number,
  ) => boolean;

  assert.equal(shotReady(false, 0, 0, 850, 0), true, 'practice fires after its shot interval without a market tick');
  assert.equal(shotReady(false, 0, 0, 849, 0), false, 'practice shots retain the shot interval');
  assert.equal(shotReady(true, 0, 0, 850, 0), false, 'connected trading still waits for a new market tick');
  assert.equal(shotReady(true, 1, 0, 850, 0), true, 'connected trading fires on a new market tick');
  assert.match(script, /if\(!candidate&&!connectedAccount\)\{const aliveCows=/, 'offline practice still selects its local cow candidate');
  assert.match(script, /rangerShotReady\(!\!connectedAccount,tickSequence,target\.lastShotTickSeq,now,lastShot\)/, 'the frame loop uses practice-aware shot readiness');
});
test('ranger auto selects top positive edge contract and patrols continuously without freezing', () => {
  const html = readFileSync(new URL('../web/public/trading-room.html', import.meta.url), 'utf8');
  const script = html.split('<script>')[1]?.split('</script>')[0];
  assert.ok(script);

  // Candidate selection should choose positive edge without requiring 75% rise trend
  const start = script.indexOf('function selectRangerAutoCandidate(');
  const end = script.indexOf('function updateRangerAutoProgress(', start);
  const selectCandidate = runInNewContext(`${script.slice(start, end)}; selectRangerAutoCandidate`) as (
    items: Array<Record<string, unknown>>,
  ) => Record<string, unknown> | null;

  const normalTrendCandidate = {
    fresh: true,
    edge: 0.03,
    score: 0.05,
    p: 0.72,
    digitSamples: 40,
    riseSamples: 20,
    alignedRise: 0.52,
    alignedRate: 0.54,
    hitSignal: false,
    payout: 1.4,
    symbol: 'EDGE-COW',
  };

  assert.equal(
    selectCandidate([normalTrendCandidate])?.symbol,
    'EDGE-COW',
    'the top positive edge candidate is eligible even when quote trend is balanced',
  );

  // Automation loop is evaluated in frame() so the ranger does not freeze
  assert.match(html, /if\(rangerAutoActive\)updateRangerAutomation\(\);/);

  // Patrol waypoint selects another cow when player reaches the current cow
  const patrolStart = script.indexOf('function rangerPatrolPoint(');
  const patrolEnd = script.indexOf('function rangerDamageForEdge(', patrolStart);
  const patrolPoint = runInNewContext(`${script.slice(patrolStart, patrolEnd)}; rangerPatrolPoint`) as (
    player: { x: number; y: number },
    cows: Array<{ x: number; y: number; alive: boolean }>,
    world: { w: number; h: number },
    exclude: object | null,
  ) => { x: number; y: number };

  const cowA = { x: 120, y: 180, alive: true };
  const cowB = { x: 500, y: 400, alive: true };
  const nextPoint = patrolPoint({ x: 65, y: 250 }, [cowA, cowB], { w: 800, h: 800 }, cowA);
  assert.deepEqual({ ...nextPoint }, { x: 395, y: 470 }, 'ranger patrols toward cow B when cow A is excluded');
});
