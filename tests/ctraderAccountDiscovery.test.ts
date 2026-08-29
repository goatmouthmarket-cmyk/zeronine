import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CTraderDemoAccountDiscovery,
  parseCTraderAuthorizedAccounts,
  type CTraderAccountDiscoveryTransport,
} from '../src/gold/ctraderAccountDiscovery.ts';

test('cTrader account discovery normalizes only provider-returned account fields', () => {
  assert.deepEqual(parseCTraderAuthorizedAccounts({
    ctidTraderAccount: [
      { ctidTraderAccountId: '101', isLive: false, brokerTitleShort: 'Demo Broker', traderLogin: 9001, ignored: 'never expose' },
      { ctidTraderAccountId: 102, isLive: true, brokerTitleShort: 'Live Broker' },
      { ctidTraderAccountId: '101', isLive: true },
      { ctidTraderAccountId: 'invalid', isLive: false },
    ],
  }), [
    { id: '101', isLive: false, broker: 'Demo Broker', traderLogin: '9001' },
    { id: '102', isLive: true, broker: 'Live Broker', traderLogin: null },
  ]);
});

test('demo account selection is server-verified and never accepts a live account', async () => {
  let calls = 0;
  const transport: CTraderAccountDiscoveryTransport = {
    async listAuthorizedAccounts(input) {
      calls += 1;
      assert.equal(input.accessToken, 'server-held-access-token');
      return [
        { id: '200', isLive: false, broker: 'Demo Broker', traderLogin: '55' },
        { id: '201', isLive: true, broker: 'Live Broker', traderLogin: '56' },
      ];
    },
  };
  const discovery = new CTraderDemoAccountDiscovery(transport);
  assert.deepEqual(await discovery.list({ clientId: 'client', clientSecret: 'secret', accessToken: 'server-held-access-token' }), [
    { id: '200', isLive: false, broker: 'Demo Broker', traderLogin: '55' },
  ]);
  assert.equal((await discovery.verifySelection({ clientId: 'client', clientSecret: 'secret', accessToken: 'server-held-access-token' }, '200')).id, '200');
  await assert.rejects(
    discovery.verifySelection({ clientId: 'client', clientSecret: 'secret', accessToken: 'server-held-access-token' }, '201'),
    /not an authorized cTrader demo account/,
  );
  assert.equal(calls, 3);
});
