import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

const assets = new URL('../../web/public/', import.meta.url);
function snapshot(running = false) {
  return { engineVersion: 'core-v1', available: true, running, canActivate: false, autoEnabled: false,
    readiness: { settled: 82, target: 200, fills: 84, missing: 2, netProfit: 3.4, modelBrier: .14, baselineBrier: .15, reason: 'Collect 118 more paper results.' },
    run: running ? { id: 'run-one', running: true, balance: 100.8, settled: 3, wins: 2, losses: 1, netProfit: .8, maxDrawdown: 1, phase: 'Virtual trade open' } : null,
    recent: [], coverage: { complete: 82, missing: 2 } };
}
async function mount(page: Page, initial = snapshot(), authorized = true) {
  const control = { state: initial, authorized, fail: false, delay: 0, gets: 0, active: 0, maxActive: 0, posts: [] as string[], holdNext: false, release: null as null | (() => void) };
  await page.addInitScript(() => { (window as any).researchNavigation = []; window.addEventListener('message', event => { if (event.data?.type === 'zeronine:room-navigate') (window as any).researchNavigation.push(event.data.page); }); });
  await page.route('http://research.test/**', async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.pathname.startsWith('/api/')) {
      expect(url.pathname).toMatch(/^\/api\/core\/research(?:\/(start|stop|activate))?$/);
      if (request.method() === 'POST') {
        control.posts.push(url.pathname);
        if (url.pathname.endsWith('/start')) { expect(request.postDataJSON()).toEqual({ startingBalance: 100, stake: 1, takeProfit: 5, maxLoss: 10 }); control.state = snapshot(true); }
        if (url.pathname.endsWith('/stop')) control.state = { ...control.state, running: false, run: control.state.run ? { ...control.state.run, running: false, phase: 'Paused' } : null };
      } else { control.gets++; control.active++; control.maxActive = Math.max(control.maxActive, control.active); }
      const response = JSON.stringify(control.state), authorized = control.authorized;
      if (control.holdNext) { control.holdNext = false; await new Promise<void>(resolve => { control.release = resolve; }); }
      if (control.delay) await new Promise(resolve => setTimeout(resolve, control.delay));
      if (request.method() === 'GET') control.active--;
      await route.fulfill({ status: !authorized ? 401 : control.fail ? 503 : 200, contentType: 'application/json', body: !authorized ? '{"error":"Signed out"}' : control.fail ? '{"error":"Unavailable"}' : response }).catch(() => {});
      return;
    }
    if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><head><meta name="viewport" content="width=device-width"><link rel="stylesheet" href="/core-research-hud.css"></head><body style="margin:0;background:#56844b"><div id="coreResearchHud"></div><script src="/core-research-hud.js"></script></body></html>' });
    const file = new URL(url.pathname.slice(1), assets);
    return route.fulfill({ body: readFileSync(file), contentType: url.pathname.endsWith('.css') ? 'text/css' : url.pathname.endsWith('.svg') ? 'image/svg+xml' : 'application/javascript' });
  });
  await page.goto('http://research.test/');
  return control;
}
async function controlVisible(page: Page, selector: string) {
  const rect = await page.locator(selector).boundingBox(), viewport = page.viewportSize()!;
  expect(rect).not.toBeNull(); expect(rect!.x).toBeGreaterThanOrEqual(0); expect(rect!.y).toBeGreaterThanOrEqual(0);
  expect(rect!.x + rect!.width).toBeLessThanOrEqual(viewport.width + 1); expect(rect!.y + rect!.height).toBeLessThanOrEqual(viewport.height + 1);
  expect(await page.locator(selector).evaluate(el => { const r = el.getBoundingClientRect(), top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return top === el || el.contains(top); })).toBe(true);
}

for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 650 }, { width: 844, height: 390 }]) {
  test(`virtual scout controls stay reachable at ${viewport.width}x${viewport.height}; closing never pauses`, async ({ page }) => {
    await page.setViewportSize(viewport); const control = await mount(page);
    await expect(page.locator('.crh-run')).toBeEnabled(); expect(control.posts).toEqual([]);
    await expect(page.locator('#coreResearchHud')).not.toHaveClass(/is-running/);
    await page.locator('.crh-banner').click(); await expect(page.locator('.crh-progress-label')).toHaveText('82 / 200');
    await controlVisible(page, '.crh-close'); await controlVisible(page, '.crh-run');
    if (viewport.width <= 700) {
      await controlVisible(page, '.crh-progress-label'); await controlVisible(page, '.crh-progress');
      const goal = await page.locator('.crh-progress').boundingBox(), footer = await page.locator('.crh-footer').boundingBox();
      expect(goal!.y + goal!.height).toBeLessThanOrEqual(footer!.y);
    }
    await page.locator('.crh-run').click(); await expect(page.locator('.crh-run')).toHaveText('Pause research');
    await expect(page.locator('#coreResearchHud')).toHaveClass(/is-running/);
    await expect(page.locator('.crh-progress-label')).toHaveText('82 / 200'); await expect(page.locator('.crh-profit')).toHaveText('+0.80');
    await expect(page.locator('.crh-return b')).toHaveText('+3.40'); await expect(page.locator('.crh-quality b')).toHaveText('98%'); await expect(page.locator('.crh-strength b')).toHaveText('Keeping up');
    await page.locator('.crh-close').click(); await expect(page.locator('.crh-panel')).toBeHidden();
    await page.locator('.crh-banner').click(); await page.keyboard.press('Escape'); await expect(page.locator('.crh-panel')).toBeHidden();
    await page.locator('.crh-banner').click(); await page.mouse.click(viewport.width - 3, viewport.height - 3); await expect(page.locator('.crh-panel')).toBeHidden();
    expect(control.posts).toEqual(['/api/core/research/start']);
    await page.locator('.crh-banner').click(); await controlVisible(page, '.crh-run'); await page.locator('.crh-run').click();
    await expect(page.locator('.crh-run')).toHaveText('Start a new run'); await expect(page.locator('.crh-mini-status')).toHaveText('Research paused');
    expect(control.posts).toEqual(['/api/core/research/start', '/api/core/research/stop']);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}
test('guest sign-in uses Account; switching account discards a late private response', async ({ page }) => {
  const control = await mount(page, snapshot(true)); await expect(page.locator('.crh-profit')).toHaveText('+0.80');
  control.holdNext = true; await page.locator('.crh-banner').click(); await expect.poll(() => control.release !== null).toBe(true);
  control.authorized = false;
  await page.evaluate(() => window.postMessage({ type: 'zeronine:room-state', state: { accountId: null, authStatus: 'signed-out' } }, location.origin));
  await expect(page.locator('.crh-profit')).toHaveText('+0.00'); await expect(page.locator('.crh-latest')).toBeEmpty();
  control.release!(); await expect(page.locator('.crh-connect')).toBeVisible(); await expect(page.locator('.crh-mini-results')).toHaveText('Virtual only');
  const gets = control.gets; await page.waitForTimeout(1650); expect(control.gets).toBe(gets);
  await page.locator('.crh-connect').click(); await expect.poll(() => page.evaluate(() => (window as any).researchNavigation)).toContain('account');
  control.authorized = true; control.state = snapshot();
  await page.evaluate(() => window.postMessage({ type: 'zeronine:room-state', state: { accountId: 'different-account', accountMode: 'demo', authStatus: 'signed-in' } }, location.origin));
  await expect(page.locator('.crh-run')).toBeVisible(); await expect(page.locator('.crh-run')).toBeEnabled(); await expect(page.locator('.crh-profit')).toHaveText('+0.00');
  expect(control.posts).toEqual([]);
});
test('slow or unavailable polling never overlaps or invents live activity', async ({ page }) => {
  const control = await mount(page, snapshot(true)); await expect(page.locator('#coreResearchHud')).toHaveClass(/is-running/);
  control.delay = 1800; await page.locator('.crh-banner').click(); await page.waitForTimeout(3300); expect(control.maxActive).toBe(1);
  control.delay = 0; control.fail = true; await expect(page.locator('.crh-mini-status')).toHaveText('Reconnecting', { timeout: 6000 });
  await expect(page.locator('#coreResearchHud')).not.toHaveClass(/is-running/); await expect(page.locator('.crh-profit')).toHaveText('+0.80');
  control.fail = false; control.state = { ...snapshot(true), running: false, run: { ...snapshot(true).run!, running: false, phase: 'Remaining loss budget is smaller than the stake' } };
  await expect(page.locator('.crh-mini-status')).toHaveText('Loss budget reached', { timeout: 5000 });
  await expect(page.locator('.crh-status')).toContainText('Loss budget reached'); expect(control.posts).toEqual([]);
});
test('an initial 401 offers Account sign-in without retrying or starting research', async ({ page }) => {
  const control = await mount(page, snapshot(), false); await page.locator('.crh-banner').click();
  await expect(page.locator('.crh-connect')).toBeVisible(); const gets = control.gets;
  await page.waitForTimeout(1650); expect(control.gets).toBe(gets); expect(control.posts).toEqual([]);
});
test('a connected owner is supported even when player sign-in status is signed out', async ({ page }) => {
  const control = await mount(page, snapshot(true)); await expect(page.locator('.crh-profit')).toHaveText('+0.80');
  const gets = control.gets;
  await page.evaluate(() => window.postMessage({ type: 'zeronine:room-state', state: { accountId: 'owner-account', accountMode: 'demo', owner: true, authStatus: 'signed-out' } }, location.origin));
  await expect.poll(() => control.gets).toBeGreaterThan(gets); await expect(page.locator('.crh-profit')).toHaveText('+0.80');
  await expect(page.locator('.crh-connect')).toBeHidden(); expect(control.posts).toEqual([]);
});
test('native Research keyboard controls do not send gameplay key presses', async ({ page }) => {
  const control = await mount(page); await expect(page.locator('.crh-run')).toBeEnabled();
  await page.evaluate(() => { (window as any).gameplayKeys = 0; window.addEventListener('keydown', event => { if (event.key !== 'Escape') (window as any).gameplayKeys++; }); });
  await page.locator('.crh-banner').focus(); await page.keyboard.press('Space'); await expect(page.locator('.crh-panel')).toBeVisible();
  await page.locator('.crh-run').focus(); await page.keyboard.press('Enter'); await expect(page.locator('.crh-run')).toHaveText('Pause research');
  expect(await page.evaluate(() => (window as any).gameplayKeys)).toBe(0); expect(control.posts).toEqual(['/api/core/research/start']);
  await page.keyboard.press('Escape'); await expect(page.locator('.crh-panel')).toBeHidden();
});
