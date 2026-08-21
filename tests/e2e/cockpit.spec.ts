import { expect, test } from '@playwright/test';

test('cockpit is stable and Start Bot sends the automation request', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));

  await page.goto('/', { waitUntil: 'networkidle' });
  await expect(page.getByText('Pattern', { exact: true })).toBeVisible();
  const startButton = page.getByRole('button', { name: 'Start Bot' });
  await expect(startButton).toBeVisible();
  const metrics = page.locator('.cockpit-metrics .ckm');
  await expect(metrics).toHaveCount(4);

  const metricBounds = await metrics.evaluateAll((cards) => cards.map((card) => card.getBoundingClientRect().toJSON()));
  expect(metricBounds[0].bottom).toBeLessThanOrEqual(metricBounds[2].top);
  expect(metricBounds[1].bottom).toBeLessThanOrEqual(metricBounds[3].top);

  await page.route('**/api/trade/manual', async (route) => {
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, trade: {} }) });
  });
  const selector = page.locator('.side-selector');
  const selectorBefore = await selector.boundingBox();
  const startBefore = await startButton.boundingBox();
  await page.getByRole('button', { name: 'Under 9', exact: true }).click();
  await expect(page.getByText(/Under 9 placed @/)).toBeVisible();
  expect(await selector.boundingBox()).toEqual(selectorBefore);
  expect(await startButton.boundingBox()).toEqual(startBefore);

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
  expect(errors).toEqual([]);
});
