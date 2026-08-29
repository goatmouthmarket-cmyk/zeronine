import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import test from 'node:test';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'gold-onboarding-'));
process.env.SESSION_SECRET = 'test-session-secret-test-session-secret';

const configEnv = {
  CTRADER_API_URL: 'https://openapi.ctrader.com',
  CTRADER_CLIENT_ID: 'demo-client',
  CTRADER_CLIENT_SECRET: 'demo-secret',
  CTRADER_REDIRECT_URI: 'https://zeronine.example/api/gold/oauth/callback',
  CTRADER_ACCOUNT_MODE: 'demo',
  GOLD_LIVE_ENABLED: '0',
  GOLD_TOKEN_ENCRYPTION_KEY: 'test-gold-token-encryption-key-at-least-32',
};

test('Gold demo onboarding uses the documented consent URL and stores only encrypted authorization material', async () => {
  const [{ loadGoldConfig }, { GoldOAuthOnboarding }, { CTraderDemoAccountDiscovery }, store] = await Promise.all([
    import('../src/gold/config.ts'),
    import('../src/gold/onboarding.ts'),
    import('../src/gold/ctraderAccountDiscovery.ts'),
    import('../src/db/store.ts'),
  ]);
  const discovery = new CTraderDemoAccountDiscovery({
    async listAuthorizedAccounts(input) {
      assert.equal(input.accessToken, 'never-return-this-token');
      return [
        { id: '101', isLive: false, broker: 'Demo Broker', traderLogin: '10' },
        { id: '102', isLive: true, broker: 'Live Broker', traderLogin: '11' },
      ];
    },
  });
  const service = new GoldOAuthOnboarding(
    loadGoldConfig(configEnv),
    () => 1_000,
    async () => ({ accessToken: 'never-return-this-token', refreshToken: 'never-return-this-refresh-token', expiresIn: 3600 }),
    discovery,
  );

  assert.equal(service.state().status, 'ready');
  const begun = service.begin();
  const url = new URL(begun.url);
  assert.equal(url.searchParams.get('scope'), 'accounts');
  assert.equal(url.searchParams.get('product'), 'web');
  assert.equal(url.searchParams.has('code_challenge'), false);
  assert.equal(url.searchParams.has('state'), false);

  const completed = await service.complete('server-only-code');
  assert.equal(completed.status, 'authorized_demo_pending_account_discovery');
  assert.equal(completed.authorizedAt, 1_000);
  assert.equal(completed.canDisconnect, true);
  const row = store.getGoldDemoConnection('dashboard-owner');
  assert.ok(row);
  assert.equal(row.token_cipher.includes('never-return-this-token'), false);
  assert.equal(row.token_cipher.includes('never-return-this-refresh-token'), false);
  assert.equal(row.status, 'authorized_demo_pending_account_discovery');

  assert.deepEqual(await service.listDemoAccounts(), [{ id: '101', isLive: false, broker: 'Demo Broker', traderLogin: '10' }]);
  const selected = await service.selectDemoAccount('101');
  assert.equal(selected.status, 'connected_demo');
  assert.equal(selected.accountLabel, 'Demo Broker - 101');
  await assert.rejects(service.selectDemoAccount('102'), /not an authorized cTrader demo account/);
  store.upsertGoldDemoConnection({ ...store.getGoldDemoConnection('dashboard-owner')!, token_expires_at: 1_000 });
  await assert.rejects(service.listDemoAccounts(), /authorization has expired/);

  const disconnected = service.disconnect();
  assert.equal(disconnected.status, 'ready');
  assert.equal(store.getGoldDemoConnection('dashboard-owner'), null);
});

test('cTrader authorization exchange uses the documented camelCase token response', async () => {
  const [{ loadGoldConfig }, { exchangeCTraderAuthorizationCode }] = await Promise.all([
    import('../src/gold/config.ts'),
    import('../src/gold/onboarding.ts'),
  ]);
  let requested = '';
  const fetcher = async (input: URL | RequestInfo): Promise<Response> => {
    requested = String(input);
    return new Response(JSON.stringify({ accessToken: 'access', refreshToken: 'refresh', expiresIn: 600, tokenType: 'Bearer' }), { status: 200 });
  };
  const token = await exchangeCTraderAuthorizationCode(loadGoldConfig(configEnv), 'authorization-code', fetcher as typeof fetch);
  const url = new URL(requested);
  assert.equal(url.hostname, 'openapi.ctrader.com');
  assert.equal(url.searchParams.get('grant_type'), 'authorization_code');
  assert.equal(url.searchParams.get('code'), 'authorization-code');
  assert.equal(token.accessToken, 'access');
});
