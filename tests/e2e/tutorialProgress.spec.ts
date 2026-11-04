import { expect, test } from '@playwright/test';

test('tutorial advances after practice and keeps reading steps manual', async ({ page }) => {
  await page.route('**/api/**', (route) => route.fulfill({ json: {
    owner: false, public_dashboard: true, markets: [], trades: [], session: null,
    settings: null, recovery: null, automation: null, runs: [], entries: [],
  } }));
  await page.routeWebSocket('**/ws', () => {});
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/how-to-play');
  await expect(page.getByRole('heading', { name: 'Welcome to the pasture' })).toBeVisible();
  await page.getByRole('button', { name: /Next/ }).click();
  await expect(page.getByRole('heading', { name: 'Move your ranger' })).toBeVisible();
  await page.locator('.guide-pasture').click({ position: { x: 190, y: 310 } });
  await expect(page.getByRole('heading', { name: 'Meet the markets' })).toBeVisible();
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await page.locator('.guide-pasture').press('ArrowRight');
  await expect(page.getByRole('heading', { name: 'Meet the markets' })).toBeVisible();
  await page.getByRole('button', { name: 'Practice cow: Volatility 50, over 2' }).click();
  await expect(page.getByRole('heading', { name: 'Read the cow’s bubble' })).toBeVisible();
  await page.waitForTimeout(1200);
  await expect(page.getByRole('heading', { name: 'Read the cow’s bubble' })).toBeVisible();
  await expect(page.locator('.pasture-guide')).not.toContainText('Gold');
  for (let i = 0; i < 3; i++) await page.getByRole('button', { name: /Next/ }).click();
  await expect(page.getByRole('heading', { name: 'Aim at a cow' })).toBeVisible();
  await page.getByRole('button', { name: 'Practice cow: Volatility 50, over 2' }).click();
  await expect(page.getByRole('heading', { name: 'Read the ranger’s bubble' })).toBeVisible();
  await page.getByRole('button', { name: /Next/ }).click();
  await page.getByRole('button', { name: 'Try paper shot' }).click();
  await expect(page.getByRole('heading', { name: 'Set your trade' })).toBeVisible();
  await page.getByRole('button', { name: /Markets/ }).click();
  await expect(page.getByRole('heading', { name: 'Meet Ranger Auto' })).toBeVisible();
  await page.locator('.guide-game-controls button').nth(1).click();
  await expect(page.getByRole('heading', { name: 'Set limits first' })).toBeVisible();
  await page.getByRole('button', { name: /Next/ }).click();
  await page.getByRole('button', { name: /Start practice/ }).click();
  await expect(page.getByRole('heading', { name: 'Follow the run' })).toBeVisible();
  await page.getByRole('button', { name: /Next/ }).click();
  await page.getByRole('button', { name: /Next/ }).click();
  await expect(page.getByRole('heading', { name: 'Meet the ghost scout' })).toBeVisible();
  await page.getByRole('button', { name: 'Open ghost scout research' }).click();
  await expect(page.getByRole('heading', { name: 'You’re ready' })).toBeVisible();
});
