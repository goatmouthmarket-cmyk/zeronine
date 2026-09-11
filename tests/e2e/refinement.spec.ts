import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.route('**/api/**', (route) => route.fulfill({ json: {
    owner: false, public_dashboard: true, markets: [], trades: [], session: null,
    settings: null, recovery: null, automation: null, runs: [], entries: [],
  } }));
  await page.routeWebSocket('**/ws', () => {});
  await page.emulateMedia({ reducedMotion: 'reduce' });
});

test('guest screens fit the supported viewport widths', async ({ page }) => {
  for (const width of [320, 375, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const path of ['/', '/account', '/history', '/bot', '/lab', '/momentum', '/gold', '/privacy']) {
      await page.goto(path, { waitUntil: 'domcontentloaded' });
      await expect(page.locator('#main-content')).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${path} at ${width}px`).toBe(true);
    }
  }
});

test('connection fields have visible labels and legal links clear the home ticker', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/account', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('label[for="deriv-api-token"]')).toBeVisible();
  await expect(page.getByLabel('Deriv API token', { exact: true })).toBeVisible();
  await expect(page.locator('.desktop-nav [aria-current="page"]')).toHaveText('Account');
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  const strip = await page.locator('.legal-quick-links.global').boundingBox();
  const ticker = await page.locator('.ticker').boundingBox();
  if (ticker && strip) expect(strip.y).toBeGreaterThanOrEqual(ticker.y + ticker.height);
});

test('Lab keeps the selected research view after reload', async ({ page }) => {
  await page.goto('/lab', { waitUntil: 'domcontentloaded' });
  await page.locator('.tl-tabs button').filter({ hasText: 'Paper' }).click();
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.locator('.tl-tabs button[aria-pressed="true"]')).toHaveText('Paper');
});
