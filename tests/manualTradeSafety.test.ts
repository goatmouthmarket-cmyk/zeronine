import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import test from 'node:test';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'overunder-manual-safety-'));
process.env.SESSION_SECRET = 'test-secret-test-secret-test-secret';

test('manual preview enforces risk and confirmation is idempotent', async () => {
  const [{ default: Fastify }, hubMod, marketMod, feedMod, autoMod, routesMod, store, cfg, paperMod, cryptoMod] = await Promise.all([
    import('fastify'),
    import('../src/api/hub.ts'),
    import('../src/core/marketState.ts'),
    import('../src/deriv/publicFeed.ts'),
    import('../src/strategy/automation.ts'),
    import('../src/api/routes.ts'),
    import('../src/db/store.ts'),
    import('../src/config.ts'),
    import('../src/simulation/paperSimulator.ts'),
    import('../src/db/crypto.ts'),
  ]);
  cfg.config.dashboardAdminToken = '';
  store.setSession({
    id: 'manual-safety', loginid: 'CR_SAFE', balance: 100, currency: 'USD', mode: 'demo', auth_kind: 'pat',
    token_cipher: cryptoMod.encryptToken('test-token'), created_at: Date.now(), updated_at: Date.now(),
  });
  store.updateSettings({ max_stake: 1 });

  const hub = new hubMod.Hub();
  const registry = new marketMod.MarketRegistry({ onTick: () => undefined });
  registry.ensure('R_10');
  for (let index = 0; index < 30; index += 1) {
    registry.push('R_10', 100 + index / 100, Math.floor(Date.now() / 1000) + index, index % 10);
  }
  const feed = new feedMod.DerivPublicFeed(registry, () => undefined);
  let quoteCalls = 0;
  let reconnectCalls = 0;
  let buyCalls = 0;
  let payoutRatio = 1.8;
  let failBuy = false;
  let failNextQuote = false;
  const client = {
    isConnected: true,
    connectedAccountId: 'CR_SAFE',
    getQuote: async (request: { direction: 'over' | 'under'; barrier: number; amount: number }) => {
      quoteCalls += 1;
      if (failNextQuote) {
        failNextQuote = false;
        throw new Error('proposal: private socket closed');
      }
      return { id: `proposal-${quoteCalls}`, direction: request.direction, barrier: request.barrier, askPrice: request.amount, payout: request.amount * payoutRatio };
    },
    reconnect: async () => {
      reconnectCalls += 1;
      return { loginid: 'CR_SAFE', balance: 100, currency: 'USD', mode: 'demo' as const };
    },
    placeBuy: async (_proposalId: string, askPrice: number) => {
      buyCalls += 1;
      if (failBuy) throw new Error('buy response timeout');
      await new Promise((resolve) => setTimeout(resolve, 10));
      return { contractId: 'manual-safe-contract', buyPrice: askPrice, payout: askPrice * 1.8 };
    },
    settleContract: async () => new Promise(() => undefined),
  };
  const automation = new autoMod.Automation(registry, client as never, hub);
  const app = Fastify();
  routesMod.registerApi(app, {
    registry, feed, client: client as never, hub, automation, paperSimulator: new paperMod.PaperSimulator(),
  });

  client.connectedAccountId = 'OTHER_ACCOUNT';
  const wrongAccount = await app.inject({ method: 'POST', url: '/api/trade/manual/preview', payload: { market: 'R_10', direction: 'over', barrier: 1, stake: 1, entryMode: 'instant' } });
  assert.equal(wrongAccount.statusCode, 409);
  assert.match(wrongAccount.json().error, /does not match/i);
  assert.equal(buyCalls, 0, 'a mismatched broker socket must never place a purchase');
  client.connectedAccountId = 'CR_SAFE';
  const staleSelection = await app.inject({ method: 'POST', url: '/api/trade/manual/preview', payload: { market: 'R_10', direction: 'over', barrier: 1, stake: 1, entryMode: 'instant', expectedAccountId: 'OTHER_ACCOUNT' } });
  assert.equal(staleSelection.statusCode, 409);
  assert.equal(buyCalls, 0, 'a stale browser selection must never place a purchase');

  const previewResponse = await app.inject({
    method: 'POST', url: '/api/trade/manual/preview',
    payload: { market: 'R_10', direction: 'over', barrier: 1, stake: 2, entryMode: 'instant' },
  });
  assert.equal(previewResponse.statusCode, 200);
  const preview = previewResponse.json();
  assert.equal(preview.quote.ask, 2);
  assert.equal(preview.quote.payout, 3.6);
  assert.equal(preview.quote.breakeven, 1 / 1.8);
  assert.equal(preview.account.balanceAfter, 98);
  assert.equal(preview.risk.ok, true);
  assert.equal(quoteCalls, 1, 'manual stake may exceed the bot maximum and still request a provider quote');

  payoutRatio = 1.5;
  const moved = await app.inject({
    method: 'POST', url: '/api/trade/manual/confirm',
    payload: { previewId: preview.previewId, idempotencyKey: 'moved-quote-action' },
  });
  assert.equal(moved.statusCode, 409);
  assert.match(moved.json().error, /moved more than 2%/i);
  assert.equal(buyCalls, 0, 'a materially worse confirmation quote must not be purchased');

  payoutRatio = 1.8;
  const refreshedPreviewResponse = await app.inject({
    method: 'POST', url: '/api/trade/manual/preview',
    payload: { market: 'R_10', direction: 'over', barrier: 1, stake: 1, entryMode: 'instant' },
  });
  assert.equal(refreshedPreviewResponse.statusCode, 200);
  const refreshedPreview = refreshedPreviewResponse.json();

  const confirmation = { previewId: refreshedPreview.previewId, idempotencyKey: 'same-operator-action' };
  failNextQuote = true;
  const [first, retry] = await Promise.all([
    app.inject({ method: 'POST', url: '/api/trade/manual/confirm', payload: confirmation }),
    app.inject({ method: 'POST', url: '/api/trade/manual/confirm', payload: confirmation }),
  ]);
  assert.equal(first.statusCode, 200);
  assert.equal(retry.statusCode, 200);
  assert.equal(first.json().trade.contractId, retry.json().trade.contractId);
  assert.equal(quoteCalls, 5, 'a transient pre-purchase quote failure is retried once after reconnecting');
  assert.equal(reconnectCalls, 1);
  assert.equal(buyCalls, 1, 'an idempotent retry must reuse the original purchase result');
  assert.match(store.getPendingTrades()[0]?.reason ?? '', /model .*breakeven .*edge .*quote/i);

  const secondKey = await app.inject({
    method: 'POST', url: '/api/trade/manual/confirm',
    payload: { previewId: refreshedPreview.previewId, idempotencyKey: 'different-action' },
  });
  assert.equal(secondKey.statusCode, 409);
  assert.equal(buyCalls, 1);

  store.setSession({
    id: 'manual-unknown', loginid: 'CR_UNKNOWN', balance: 100, currency: 'USD', mode: 'demo', auth_kind: 'pat',
    token_cipher: cryptoMod.encryptToken('test-token'), created_at: Date.now(), updated_at: Date.now(),
  });
  client.connectedAccountId = 'CR_UNKNOWN';
  failBuy = true;
  const unknown = await app.inject({
    method: 'POST', url: '/api/trade/manual',
    payload: { market: 'R_10', direction: 'over', barrier: 1, stake: 1, entryMode: 'model', idempotencyKey: 'unknown-buy' },
  });
  assert.equal(unknown.statusCode, 502);
  assert.match(unknown.json().error, /outcome is unknown/i);
  const unknownTrade = store.getOpenTrade();
  assert.match(unknownTrade?.reason ?? '', /purchase outcome unknown; reconciliation required/i);

  const noRetry = await app.inject({
    method: 'POST', url: '/api/trade/manual',
    payload: { market: 'R_10', direction: 'over', barrier: 1, stake: 1, entryMode: 'model', idempotencyKey: 'different-retry' },
  });
  assert.equal(noRetry.statusCode, 409);
  assert.equal(buyCalls, 2, 'an unknown buy must keep the lane locked against a new request');

  automation.dispose();
  await app.close();
});
