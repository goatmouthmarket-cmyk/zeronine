import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

const assets = new URL('../../web/public/', import.meta.url);
async function pasture(page: Page) {
  const errors: string[] = [], writes: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    class Socket extends EventTarget {
      static OPEN = 1; static CLOSED = 3; readyState = 1;
      constructor() { super(); queueMicrotask(() => { this.dispatchEvent(new Event('open')); (this as any).onopen?.({}); }); }
      send() {} close() { this.readyState = 3; }
    }
    (window as any).WebSocket = Socket;
    (window as any).lessonFocus = []; (window as any).orderMessages = [];
    addEventListener('zeronine:brain-lesson-focus', (event: any) => (window as any).lessonFocus.push(event.detail.lessonId));
    addEventListener('message', event => { if (['zeronine:room-trade', 'zeronine:room-select-market', 'zeronine:room-auto-start'].includes(event.data?.type)) (window as any).orderMessages.push(event.data.type); });
  });
  await page.route('https://**', route => route.abort());
  await page.route('https://pasture.test/**', route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    if (path.startsWith('/api/')) {
      if (request.method() === 'POST') writes.push(path);
      return route.fulfill({ status: path.includes('health') ? 200 : 401, contentType: 'application/json', body: path.includes('health') ? '{"feed":{"connected":true},"owner":false}' : '{"error":"Signed out"}' });
    }
    return route.fulfill({ body: readFileSync(new URL(path.slice(1), assets)), contentType: path.endsWith('.html') ? 'text/html' : path.endsWith('.css') ? 'text/css' : path.endsWith('.svg') ? 'image/svg+xml' : path.endsWith('.png') ? 'image/png' : 'application/javascript' });
  });
  await page.goto('https://pasture.test/trading-room.html?room=main');
  await page.waitForFunction(() => !!(window as any).__zeronineBrainBridge);
  await page.evaluate(() => { document.querySelector('canvas')?.addEventListener('click', () => { (window as any).gameClicks = ((window as any).gameClicks || 0) + 1; }); });
  return { errors, writes };
}
async function publish(page: Page, state: 'wait' | 'check_quote' | 'quoted_edge', lesson = false) {
  await page.evaluate(({ state, lesson }) => {
    const epoch = Math.floor(Date.now() / 1000), positive = state !== 'wait';
    const market = { symbol: 'R_100', display: 'Volatility 100 Index', fresh: true, lastEpoch: epoch, lastQuote: 1234.56, lastDigit: 6, recentDigits: Array(60).fill(6), recentQuotes: Array(60).fill(1234.56), recentTicks: Array.from({ length: 60 }, (_, i) => ({ epoch: epoch - 59 + i, quote: 1234.56, digit: 6 })) };
    const candidate = { market: 'R_100', direction: 'over', barrier: 1, estWin: .812345, baseWin: .8, engineVersion: 'core-v1', fresh: true, expectedROI: positive ? .03 : -.05, edge: positive ? .02 : -.04, estPayout: 1.25, payoutSource: state === 'quoted_edge' ? 'live_quote' : 'estimate', features: { samples: 1000, lessonAdjustment: 0 }, cutoff: { sequence: 60 }, decisionId: 'fixture', lessonIds: [], lessonMatches: lesson ? [{ id: 'lesson-one', state: 'matched' }] : [], setup: { state, label: state === 'wait' ? 'Wait' : state === 'check_quote' ? 'Check quote' : 'Quote checked', reason: state === 'wait' ? 'The payout does not cover the estimated chance.' : 'Check the payout before any trade.', lesson: 'none', probabilityKind: 'estimate' } };
    const room = { accountId: null, accountMode: null, authStatus: 'signed-out', feedConnected: true, currency: 'USD', owner: false, trades: [], markets: [market], candidates: [candidate], paperSimulation: { phase: 'idle', totalTrades: 0, wins: 0, losses: 0, netPnl: 0, virtualBalance: 1000 } };
    postMessage({ type: 'zeronine:room-state', state: room }, location.origin); postMessage({ type: 'zeronine:room-market-state', state: room }, location.origin);
  }, { state, lesson });
}
for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 650 }]) {
  test(`pasture shows canonical Waiting and quote states without changing probability at ${viewport.width}`, async ({ page }) => {
    await page.setViewportSize(viewport); const { errors, writes } = await pasture(page);
    await publish(page, 'wait'); await page.waitForTimeout(250); expect(errors).toEqual([]);
    await expect(page.locator('#pastureSetupStatus')).toHaveText('Waiting · no setup worth checking');
    expect(await page.locator('#pastureSetupStatus').evaluate(element => { const rect = element.getBoundingClientRect(); return document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2) === element; })).toBe(true);
    await page.screenshot({ path: test.info().outputPath('pasture-wait-' + viewport.width + '.png') });
    expect(await page.evaluate(() => (window as any).__zeronineBrainBridge.snapshot().herd.every((cow: any) => cow.p === .812345 && cow.setup.state === 'wait'))).toBe(true);
    await publish(page, 'check_quote'); await expect(page.locator('#pastureSetupStatus')).toContainText('Check quote');
    await publish(page, 'quoted_edge'); await expect(page.locator('#pastureSetupStatus')).toContainText('Quote checked');
    await page.screenshot({ path: test.info().outputPath('pasture-quote-' + viewport.width + '.png') });
    await page.evaluate(() => postMessage({ type: 'zeronine:room-state', state: { feedConnected: false } }, location.origin));
    await expect(page.locator('#pastureSetupStatus')).toHaveText('Waiting for fresh prices');
    expect(await page.evaluate(() => (window as any).__zeronineBrainBridge.snapshot().herd.every((cow: any) => !cow.fresh && cow.setup.state === 'waiting_prices'))).toBe(true);
    expect(errors).toEqual([]); expect(writes.filter(path => /trade|automation|core\/research\//.test(path))).toEqual([]);
  });
}
test('clicking a lesson badge opens that lesson without reaching cow/gameplay click handlers', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 }); const { errors } = await pasture(page);
  await publish(page, 'wait', true);
  await page.waitForFunction(() => (window as any).__zeronineBrainBridge.snapshot().herd.some((cow: any) => { const r = cow.lessonBadge; return r && r.x > 5 && r.x + r.width < innerWidth && r.y > 100 && r.y + r.height < innerHeight && document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)?.id === 'game'; }));
  const badge = await page.evaluate(() => (window as any).__zeronineBrainBridge.snapshot().herd.map((cow: any) => cow.lessonBadge).find((r: any) => r && r.x > 5 && r.x + r.width < innerWidth && r.y > 100 && r.y + r.height < innerHeight && document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)?.id === 'game'));
  await page.mouse.click(badge.x + badge.width / 2, badge.y + badge.height / 2);
  await expect.poll(() => page.evaluate(() => (window as any).lessonFocus)).toEqual(['lesson-one']);
  expect(await page.evaluate(() => (window as any).gameClicks || 0)).toBe(0); expect(await page.evaluate(() => (window as any).orderMessages)).toEqual([]); expect(errors).toEqual([]);
  await page.evaluate(() => postMessage({ type: 'zeronine:room-state', state: { accountId: 'different-player', accountMode: 'demo', authStatus: 'signed-in' } }, location.origin));
  await expect.poll(() => page.evaluate(() => (window as any).__zeronineBrainBridge.snapshot().herd.every((cow: any) => cow.lessonMatches.length === 0 && cow.lessonBadge === null && cow.setup.state === 'waiting_prices'))).toBe(true);
  await page.evaluate(() => postMessage({ type: 'zeronine:room-market-state', state: {} }, location.origin));
  await expect.poll(() => page.evaluate(() => (window as any).__zeronineBrainBridge.snapshot().herd.every((cow: any) => cow.lessonMatches.length === 0 && cow.lessonBadge === null))).toBe(true);
});
