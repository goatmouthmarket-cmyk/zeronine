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

test('profit lock preserves 75% of a bot-run profit peak and leaves only the remainder riskable', async () => {
  const [{ buildRecoveryContext, riskCheck }, { getSettings }] = await Promise.all([
    import('../src/strategy/risk.ts'), import('../src/db/store.ts'),
  ]);
  const settings = getSettings();
  const base = {
    settings, balance: 1_000, context: buildRecoveryContext(settings), lastTradeAt: 0, tradeGapMs: 0, now: Date.now(),
    profitLock: { runProfit: 92, peakRunProfit: 100, triggerProfit: 5, retainRatio: .75 },
  };
  assert.deepEqual(riskCheck({ ...base, stake: 17 }), { ok: true, reason: 'ok' });
  assert.match(riskCheck({ ...base, stake: 17.01 }).reason, /profit lock risk budget/);
  assert.match(riskCheck({ ...base, stake: 1, profitLock: { ...base.profitLock, runProfit: 75 } }).reason, /profit lock preserving 75%/);
});

test('risk lanes isolate Gold and Momentum while retaining each product lock', async () => {
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
  assert.deepEqual(riskCheck({ ...base, lane: 'momentum' }), { ok: true, reason: 'ok' });
  assert.match(riskCheck({ ...base, lane: 'gold' }).reason, /gold contract still settling/);

  store.insertTrade({
    ts: Date.now(), market: 'BOOM300N', contract_type: 'MULTDOWN', barrier: 0, duration: 5, duration_unit: 'm',
    stake: 1, ask_price: 1, payout: 2, est_win: .5, profit: 0, status: 'pending', contract_id: 'momentum-open',
    purchase_id: 'momentum-two-lane', reason: 'momentum manual DOWN', origin: 'manual',
  });
  assert.match(riskCheck({ ...base, lane: 'momentum' }).reason, /momentum contract still settling/);
  assert.match(riskCheck({ ...base, lane: 'gold' }).reason, /gold contract still settling/);

  store.insertTrade({
    ts: Date.now(), market: 'R_100', contract_type: 'DIGITOVER', barrier: 0, duration: 1, duration_unit: 't',
    stake: 1, ask_price: 1, payout: 1.09, est_win: .9, profit: 0, status: 'pending', contract_id: 'digit-open',
    purchase_id: 'digit-two-lane', reason: 'manual', origin: 'manual',
  });
  assert.match(riskCheck({ ...base, lane: 'digit' }).reason, /digit contract still settling/);
  assert.equal(store.listOpenTrades('deriv:VRTC_TWO_LANE').length, 2);
});
