import { expect, test } from '@playwright/test';

test('cockpit is stable and Start Bot sends the automation request', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));

  await page.route('**/api/state', async (route) => {
    const response = await route.fetch();
    const state = (await response.json()) as {
      automation?: Record<string, unknown>;
      markets?: Array<Record<string, unknown>>;
      trades?: Array<Record<string, unknown>>;
      selected?: string | null;
    };
    state.automation = { ...state.automation, running: false, phase: 'standby' };
    const markets = state.markets?.length ? state.markets : [{
      symbol: 'R_10',
      display: 'Volatility 10',
      lastQuote: 100,
      lastEpoch: Math.floor(Date.now() / 1000),
      lastDigit: 0,
      fresh: true,
      ticksPerMin: 16,
      recentDigits: [],
      dist: Array.from({ length: 10 }, () => 0),
    }];
    state.markets = markets.map((market, index) => ({
      ...market,
      recentQuotes: Array.from({ length: 16 }, (_, tick) => 100 + index + tick * 0.14),
    }));
    state.selected = String(state.markets[0].symbol);
    state.trades = [
      {
        id: 9001,
        ts: Date.now(),
        market: String(state.markets?.[0]?.symbol ?? 'R_10'),
        contract_type: 'DIGITOVER',
        barrier: 0,
        stake: 2,
        payout: 3.8,
        profit: 1.8,
        status: 'won',
        reason: 'test',
      },
    ];
    await route.fulfill({ response, json: state });
  });
  await page.routeWebSocket('**/ws', () => {});
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.getByText('Pattern', { exact: true })).toBeVisible();
  const startButton = page.getByRole('button', { name: 'Start Bot' });
  await expect(startButton).toBeVisible();
  await expect(page.locator('.market-pulse')).toBeVisible();
  await expect(page.locator('.market-pulse svg')).toBeVisible();
  await expect(page.locator('.activity-streak')).toContainText('1 STREAK');
  let resetRequested = false;
  await page.route('**/api/performance/reset', async (route) => {
    resetRequested = true;
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ wins: 0, losses: 0, pushes: 0, profit: 0, reset_at: Date.now() }) });
  });
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Reset dashboard performance' }).click();
  await expect.poll(() => resetRequested).toBe(true);
  const metrics = page.locator('.cockpit-metrics .ckm');
  await expect(metrics).toHaveCount(4);

  for (const viewport of [{ width: 1280, height: 720 }, { width: 1280, height: 667 }, { width: 1272, height: 536 }]) {
    await page.setViewportSize(viewport);
    const tradeCard = page.locator('.view-home .dash-main .trade-card');
    const dashboard = page.locator('.view-home .dashboard');
    const perf = page.locator('.view-home .perf');
    await expect(tradeCard).toBeVisible();
    await expect(perf).toBeVisible();
    const overflow = await tradeCard.evaluate((element) => ({
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight,
    }));
    if (viewport.height >= 667) {
      expect(overflow.scrollHeight).toBeLessThanOrEqual(overflow.clientHeight);
    }
    const perfOverflow = await perf.evaluate((element) => ({
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight,
    }));
    expect(perfOverflow.scrollHeight).toBeLessThanOrEqual(perfOverflow.clientHeight);
    const dashboardBounds = await dashboard.boundingBox();
    const perfBounds = await perf.boundingBox();
    expect((perfBounds?.y ?? 0) + (perfBounds?.height ?? 0)).toBeLessThanOrEqual((dashboardBounds?.y ?? 0) + (dashboardBounds?.height ?? 0));
  }

  const metricBounds = await metrics.evaluateAll((cards) => cards.map((card) => card.getBoundingClientRect().toJSON()));
  expect(metricBounds[0].bottom).toBeLessThanOrEqual(metricBounds[2].top);
  expect(metricBounds[1].bottom).toBeLessThanOrEqual(metricBounds[3].top);

  await page.route('**/api/trade/manual', async (route) => {
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, trade: {} }) });
  });
  const selector = page.locator('.side-selector');
  const selectorBefore = await selector.boundingBox();
  const startBefore = await startButton.boundingBox();
  await page.locator('.side-btn.under').click();
  await expect(page.getByText(/Under 9 placed @/)).toBeVisible();
  expect(await selector.boundingBox()).toEqual(selectorBefore);
  expect(await startButton.boundingBox()).toEqual(startBefore);

  await page.getByRole('button', { name: 'Bot', exact: true }).click();
  await expect(page.getByText('Automation limits', { exact: true })).toBeVisible();
  await expect(page.getByText('Max drawdown', { exact: true })).toBeVisible();
  await expect(page.getByText('Daily loss limit', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Home', exact: true }).click();

  let fullHistoryRequested = false;
  await page.route('**/api/history?limit=200', async (route) => {
    fullHistoryRequested = true;
    await route.continue();
  });
  await page.getByRole('button', { name: 'History', exact: true }).click();
  await expect.poll(() => fullHistoryRequested).toBe(true);
  await page.getByRole('button', { name: 'Home', exact: true }).click();

  let startBody: unknown = null;
  await page.route('**/api/automation/start', async (route) => {
    startBody = route.request().postDataJSON();
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, state: { running: true, phase: 'scanning', lastCompletedAt: 0, runTrades: 0 } }),
    });
  });
  await startButton.click();
  await expect.poll(() => startBody).toEqual(expect.objectContaining({ strategy_mode: expect.any(String), base_stake: expect.any(Number) }));
  await expect(page.locator('.bot-control.running')).toBeVisible();
  expect(errors).toEqual([]);
});
