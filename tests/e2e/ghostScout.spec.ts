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

test('Ranger Auto exposes separate entry timing, ring and paper research controls', async ({ page }) => {
  await page.route('**/api/**', (route) => route.fulfill({ json: {
    owner: false, public_dashboard: true, markets: [], trades: [], session: null,
    settings: null, recovery: null, automation: null, runs: [], entries: [],
  } }));
  await page.routeWebSocket('**/ws', () => {});
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Show Ranger Auto controls' }).click();
  const game = page.frameLocator('iframe[title="Deriv Cows interactive trading pasture"]');
  await game.getByText('Entry and paper research').click();
  await expect(game.getByLabel('Auto shots / ticks')).toHaveValue('3');
  await expect(game.getByLabel('Minimum edge (%)')).toHaveValue('0');
  await expect(game.getByLabel('Red', { exact: true })).toBeChecked();
  await expect(game.getByLabel('Paper test', { exact: true })).not.toBeChecked();
  await game.getByLabel('Minimum edge (%)').fill('2');
  await game.getByLabel('Minimum edge (%)').blur();
  await expect(game.getByLabel('Minimum edge (%)')).toHaveValue('2');
  await game.getByLabel('Paper test', { exact: true }).check();
  await expect(game.getByLabel('Paper test', { exact: true })).toBeChecked();
  await expect(game.getByText(/Paper results are research only/)).toBeVisible();
  await page.getByRole('button', { name: 'Hide Ranger Auto controls' }).click();
  await game.locator('.target-menu summary').click();
  await expect(game.getByLabel('Manual shots / ticks')).toHaveValue('3');
  await expect(game.getByLabel('Skip if signal changes')).toBeChecked();
  await game.getByLabel('Skip if signal changes').uncheck();
  await expect(game.getByLabel('Skip if signal changes')).not.toBeChecked();
  await expect(game.locator('.hud-avatar svg')).toHaveCount(1);
});
