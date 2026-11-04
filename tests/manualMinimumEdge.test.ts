import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), 'manual-min-edge-'));
process.env.SESSION_SECRET = 'test-secret-test-secret-test-secret';

test('manual minimum edge uses the current server model and fresh proposal before purchase', async () => {
  const [{ default: Fastify }, hubMod, marketMod, feedMod, autoMod, routesMod, store, cfg, paperMod] = await Promise.all([
    import('fastify'), import('../src/api/hub.ts'), import('../src/core/marketState.ts'),
    import('../src/deriv/publicFeed.ts'), import('../src/strategy/automation.ts'), import('../src/api/routes.ts'),
    import('../src/db/store.ts'), import('../src/config.ts'), import('../src/simulation/paperSimulator.ts'),
  ]);
  cfg.config.dashboardAdminToken = '';
  store.setSession({ id: 'edge', loginid: 'CR_EDGE', balance: 100, currency: 'USD', mode: 'demo', auth_kind: 'pat', token_cipher: 'x', created_at: Date.now(), updated_at: Date.now() });
  const hub = new hubMod.Hub();
  const registry = new marketMod.MarketRegistry({ onTick: () => undefined });
  registry.ensure('R_10');
  for (let i = 0; i < 30; i++) registry.push('R_10', 100 + i / 100, Math.floor(Date.now() / 1000) + i, i % 10);
  const feed = new feedMod.DerivPublicFeed(registry, () => undefined);
  let ratio = 1.8, buys = 0;
  const client = {
    isConnected: true, connectedAccountId: 'CR_EDGE',
    getQuote: async (request: { direction: 'over' | 'under'; barrier: number; amount: number }) => ({ id: 'quote', direction: request.direction, barrier: request.barrier, askPrice: request.amount, payout: request.amount * ratio }),
    placeBuy: async () => { buys++; return { contractId: 'unexpected', buyPrice: 1, payout: 1.8 }; },
  };
  const automation = new autoMod.Automation(registry, client as never, hub);
  const app = Fastify();
  routesMod.registerApi(app, { registry, feed, client: client as never, hub, automation, paperSimulator: new paperMod.PaperSimulator() });
  try {
    const base = { market: 'R_10', direction: 'over', barrier: 1, stake: 1, entryMode: 'instant' };
    const invalid = await app.inject({ method: 'POST', url: '/api/trade/manual', payload: { ...base, minEdge: 1.1 } });
    assert.equal(invalid.statusCode, 400);
    const blocked = await app.inject({ method: 'POST', url: '/api/trade/manual', payload: { ...base, minEdge: .5, estWin: 1 } });
    assert.equal(blocked.statusCode, 409);
    assert.match(blocked.json().error, /below your.*minimum/i);
    assert.equal(buys, 0);
    const preview = await app.inject({ method: 'POST', url: '/api/trade/manual/preview', payload: { ...base, minEdge: .24 } });
    assert.equal(preview.statusCode, 200);
    ratio = 1.78;
    const confirmation = await app.inject({ method: 'POST', url: '/api/trade/manual/confirm', payload: { previewId: preview.json().previewId, idempotencyKey: 'minimum-edge' } });
    assert.equal(confirmation.statusCode, 409);
    assert.match(confirmation.json().error, /below your.*minimum/i);
    assert.equal(buys, 0, 'a sub-threshold refreshed quote must never be purchased');
  } finally { automation.dispose(); await app.close(); }
});
