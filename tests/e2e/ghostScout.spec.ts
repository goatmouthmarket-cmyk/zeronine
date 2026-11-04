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
  await expect(game.locator('#rangerAutoMinEdge')).toHaveValue('0');
  await expect(game.getByLabel('Red', { exact: true })).toBeChecked();
  await expect(game.getByLabel('Paper test', { exact: true })).not.toBeChecked();
  await game.locator('#rangerAutoMinEdge').fill('2');
  await game.locator('#rangerAutoMinEdge').blur();
  await expect(game.locator('#rangerAutoMinEdge')).toHaveValue('2');
  await game.getByLabel('Paper test', { exact: true }).check();
  await expect(game.getByLabel('Paper test', { exact: true })).toBeChecked();
  await expect(game.getByText(/Paper results are research only/)).toBeVisible();
  await page.getByRole('button', { name: 'Hide Ranger Auto controls' }).click();
  await game.locator('.target-menu summary').click();
  await expect(game.getByLabel('Manual shots / ticks')).toHaveValue('3');
  await expect(game.locator('#manualMinEdge')).toHaveValue('');
  await game.locator('#manualMinEdge').fill('2.5');
  await game.locator('#manualMinEdge').blur();
  await expect(game.locator('#manualMinEdge')).toHaveValue('2.5');
  await expect(game.locator('.hud-avatar svg')).toHaveCount(1);
});


test('account and history open in the pasture and restore its progress HUD', async ({ page }) => {
  await page.route('**/api/**', route => route.fulfill({ json: {
    owner: false, public_dashboard: true, markets: [], trades: [], session: null,
    settings: null, recovery: null, automation: null, runs: [], entries: [],
  } }));
  await page.routeWebSocket('**/ws', () => {});
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  const game = page.frameLocator('iframe[title="Deriv Cows interactive trading pasture"]');
  await page.getByRole('button', { name: 'Open game menu' }).click();
  await page.locator('.bottom-nav').getByRole('button', { name: 'History', exact: true }).click();
  await expect(page.getByRole('complementary', { name: 'Trade history' })).toBeVisible();
  await expect(game.locator('#marketHudQuick')).toBeHidden();
  await page.getByRole('button', { name: 'Close details' }).click();
  await expect(game.locator('#marketHudQuick')).toBeVisible();
  await page.getByRole('button', { name: 'Open game menu' }).click();
  await page.locator('.bottom-nav').getByRole('button', { name: 'Account', exact: true }).click();
  await expect(page.getByRole('complementary', { name: 'Account' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Continue with Deriv' })).toBeVisible();
  await expect(game.locator('#marketHudQuick')).toBeHidden();
  await page.getByRole('button', { name: 'Close details' }).click();
  await expect(game.locator('#marketHudQuick')).toBeVisible();
});


test('Jamaica weather loads automatically and the mobile menu has no stray border', async ({ page }) => {
  let weatherUrl = '';
  await page.route('**/api/**', route => route.fulfill({ json: { owner: false, public_dashboard: true, markets: [], trades: [], session: null, settings: null, recovery: null, automation: null, runs: [], entries: [] } }));
  await page.route('https://api.open-meteo.com/**', route => { weatherUrl = route.request().url(); return route.fulfill({ json: { current: { temperature_2m: 26, is_day: 1, weather_code: 61 } } }); });
  await page.routeWebSocket('**/ws', () => {});
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  const game = page.frameLocator('iframe[title="Deriv Cows interactive trading pasture"]');
  await expect(game.getByRole('button', { name: /Kingston, Jamaica: Rain, 26/i })).toBeVisible();
  expect(weatherUrl).toContain('latitude=18.0179');
  expect(weatherUrl).toContain('America%2FJamaica');
  await expect(game.locator('#mobileHelp')).toContainText('Hold to paper trade');
  await expect(page.locator('.pasture-nav')).toHaveCSS('border-top-width', '0px');
  await page.getByRole('button', { name: 'Open game menu' }).click();
  await expect(page.locator('.bottom-nav')).toBeVisible();
});


test('ranger wardrobe updates and saves a guest appearance', async ({ page }) => {
  await page.route('**/api/**', route => route.fulfill({ json: { owner: false, public_dashboard: true, markets: [], trades: [], session: null, settings: null, recovery: null, automation: null, runs: [], entries: [] } }));
  await page.routeWebSocket('**/ws', () => {});
  await page.addInitScript(() => { if (window !== window.parent) window.addEventListener('message', event => { if (event.data?.type === 'zeronine:ranger-appearance') (window as any).__rangerAppearance = event.data.appearance; }); });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/account');
  await page.getByRole('combobox', { name: 'Outfit', exact: true }).selectOption('vest');
  await page.getByRole('combobox', { name: 'Headwear' }).selectOption('cap');
  await page.getByRole('combobox', { name: 'Accessory' }).selectOption('scarf');
  await page.getByLabel('Outfit color').fill('#ab3344');
  await expect(page.getByLabel('Ranger appearance preview')).toBeVisible();
  const frame = page.frameLocator('iframe[title="Deriv Cows interactive trading pasture"]');
  await expect.poll(() => frame.locator('body').evaluate(() => (window as any).__rangerAppearance?.color)).toBe('#ab3344');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('pasture-ranger-appearance') || '{}'))).toMatchObject({ outfit: 'vest', headwear: 'cap', accessory: 'scarf', color: '#ab3344' });
  await page.reload();
  await expect(page.getByRole('combobox', { name: 'Outfit', exact: true })).toHaveValue('vest');
  await expect(page.getByRole('combobox', { name: 'Headwear' })).toHaveValue('cap');
});
