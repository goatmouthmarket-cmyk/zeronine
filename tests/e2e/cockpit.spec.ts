import { expect, test } from '@playwright/test';

test('cockpit is stable and Start Bot sends the automation request', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));

  await page.goto('/', { waitUntil: 'networkidle' });
  await expect(page.getByText('Pattern', { exact: true })).toBeVisible();
  const startButton = page.getByRole('button', { name: 'Start Bot' });
  await expect(startButton).toBeVisible();
  await expect(page.locator('.cockpit-metrics .ckm')).toHaveCount(4);

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
