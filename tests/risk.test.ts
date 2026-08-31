import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'overunder-risk-'));

test('risk check has no daily loss gate', async () => {
  const [{ buildRecoveryContext, riskCheck }, { getSettings }] = await Promise.all([
    import('../src/strategy/risk.ts'),
    import('../src/db/store.ts'),
  ]);
  const settings = getSettings();
  assert.equal('daily_loss_limit' in settings, false);

  const result = riskCheck({
    stake: 1,
    settings,
    balance: 1_000,
    context: buildRecoveryContext(settings),
    lastTradeAt: 0,
    tradeGapMs: 0,
    now: Date.now(),
  });
  assert.deepEqual(result, { ok: true, reason: 'ok' });
});

test('risk lanes allow one digit and one multiplier contract concurrently', async () => {
  const [{ buildRecoveryContext, riskCheck }, store] = await Promise.all([
    import('../src/strategy/risk.ts'),
    import('../src/db/store.ts'),
  ]);
  store.setSession({
    id: 'two-lane', loginid: 'VRTC_TWO_LANE', balance: 1_000, currency: 'USD', mode: 'demo', auth_kind: 'pat',
    token_cipher: 'x', created_at: Date.now(), updated_at: Date.now(),
  });
  const settings = store.getSettings();
  store.insertTrade({
    ts: Date.now(), market: 'frxXAUUSD', contract_type: 'MULTUP', barrier: 0, duration: 0, duration_unit: 'm',
    stake: 1, ask_price: 1, payout: 1, est_win: .5, profit: 0, status: 'pending', contract_id: 'gold-open',
    purchase_id: 'gold-two-lane', reason: 'gold deriv manual BUY', origin: 'manual',
  });
  const base = {
    stake: 1, settings, balance: 1_000, context: buildRecoveryContext(settings), lastTradeAt: 0, tradeGapMs: 0,
    now: Date.now(), accountId: 'deriv:VRTC_TWO_LANE',
  };
  assert.deepEqual(riskCheck({ ...base, lane: 'digit' }), { ok: true, reason: 'ok' });
  assert.match(riskCheck({ ...base, lane: 'multiplier' }).reason, /multiplier contract still settling/);

  store.insertTrade({
    ts: Date.now(), market: 'R_100', contract_type: 'DIGITOVER', barrier: 0, duration: 1, duration_unit: 't',
    stake: 1, ask_price: 1, payout: 1.09, est_win: .9, profit: 0, status: 'pending', contract_id: 'digit-open',
    purchase_id: 'digit-two-lane', reason: 'manual', origin: 'manual',
  });
  assert.match(riskCheck({ ...base, lane: 'digit' }).reason, /digit contract still settling/);
  assert.equal(store.listOpenTrades('deriv:VRTC_TWO_LANE').length, 2);
});
