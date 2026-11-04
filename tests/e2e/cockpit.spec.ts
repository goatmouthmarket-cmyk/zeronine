import { expect, test } from '@playwright/test';

test('guest account page presents the branded connection view and favicon', async ({ page }) => {
  await page.route('**/api/state', async (route) => {
    const response = await route.fetch();
    const state = await response.json();
    state.session = null;
    state.public_dashboard = true;
    state.owner = false;
    await route.fulfill({ response, json: state });
  });
  await page.routeWebSocket('**/ws', () => {});
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Account', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Welcome to the pasture.' })).toBeVisible();
  await expect(page.getByText('Connect Deriv', { exact: true })).toBeVisible();
  const heroBox = await page.locator('.connect-hero').boundingBox();
  const cardBox = await page.locator('.connect-card').boundingBox();
  expect(cardBox?.x ?? 0).toBeGreaterThan((heroBox?.x ?? 0) + (heroBox?.width ?? 0));
  const accountOverflow = await page.locator('.view-account').evaluate((element) => ({
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight,
  }));
  expect(accountOverflow.scrollHeight).toBeLessThanOrEqual(accountOverflow.clientHeight);
  await expect(page.locator('link[rel="icon"]')).toHaveAttribute('href', '/deriv-cows-favicon.ico');
});

test('pasture navigation excludes removed Gold and bot pages', async ({ page }) => {
  await page.route('**/api/**', (route) => route.fulfill({ json: { owner: false, public_dashboard: true, markets: [], trades: [], session: null, settings: null, recovery: null, automation: null, runs: [], entries: [] } }));
  await page.routeWebSocket('**/ws', () => {});
  await page.goto('/gold', { waitUntil: 'domcontentloaded' });
  await expect(page).toHaveURL('/');
  await expect(page.locator('iframe[title="Deriv Cows interactive trading pasture"]')).toBeVisible();
  await expect(page.locator('.bottom-nav').getByRole('button', { name: 'Gold', exact: true })).toHaveCount(0);
  await expect(page.locator('.bottom-nav').getByRole('button', { name: 'Bot', exact: true })).toHaveCount(0);
});
