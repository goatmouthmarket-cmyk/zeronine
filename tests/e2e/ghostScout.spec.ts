import { expect, test } from '@playwright/test';

test('ghost scout offers paper results and historical research in the pasture', async ({ page }) => {
  await page.route('**/api/**', (route) => route.fulfill({ json: {
    owner: false, public_dashboard: true, markets: [], trades: [], session: null,
    settings: null, recovery: null, automation: null, runs: [], entries: [],
  } }));
  await page.routeWebSocket('**/ws', () => {});
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  const game = page.frameLocator('iframe[title="Deriv Cows interactive trading pasture"]');
  await game.locator('#ghostPanelShortcut').evaluate((button: HTMLElement) => button.click());
  await expect(game.locator('#ghostTraderPanel')).toBeVisible();
  await expect(game.getByText('HISTORICAL REPLAY')).toBeVisible();
  await expect(game.getByRole('button', { name: 'Run replay' })).toBeDisabled();
  await expect(game.getByRole('button', { name: 'More research' })).toBeVisible();
  await expect(game.getByText('Research only. No account funds used.')).toBeVisible();
  await expect(page.locator('.bottom-nav').getByRole('button', { name: 'Lab', exact: true })).toHaveCount(0);
  await game.getByRole('button', { name: 'More research' }).click();
  await expect(page).toHaveURL('/lab');
});
