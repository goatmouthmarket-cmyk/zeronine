import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import test from 'node:test';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'overunder-momentum-'));

test('completed multiplier research windows persist and expose a maturity threshold', async () => {
  const { getMomentumResearchProfile, getMomentumResearchProfiles, getMomentumResearchSummary, insertMomentumResearch } = await import('../src/db/store.ts');
  const base = {
    completed_at: Date.now(), symbol: 'frxEURUSD', market: 'forex', direction: 'up' as const,
    confidence: 82, score: 0.002, return_15s: 0.001, return_30s: 0.0015, return_60s: 0.002,
    open_price: 1.08, decision_price: 1.081, exit_price: 1.083, multiplier: 20, stake: 10,
    commission_rate: 0.001, estimated_net: 0.35,
  };
  insertMomentumResearch({ ...base, won: 1 });
  insertMomentumResearch({ ...base, completed_at: base.completed_at + 1, direction: 'down', estimated_net: -0.2, won: 0 });

  const summary = getMomentumResearchSummary(3);
  assert.deepEqual({ ...summary, recent: summary.recent.map((row) => ({ symbol: row.symbol, direction: row.direction, won: row.won })) }, {
    windows: 2, wins: 1, losses: 1, win_rate: 0.5, estimated_net: 0.15,
    maturity_target: 3, samples_remaining: 1, ready_for_virtual_paper: false,
    recent: [
      { symbol: 'frxEURUSD', direction: 'down', won: 0 },
      { symbol: 'frxEURUSD', direction: 'up', won: 1 },
    ],
  });

  const profile = getMomentumResearchProfile('frxEURUSD', 'up');
  assert.equal(profile?.windows, 1);
  assert.equal(profile?.wins, 1);
  assert.equal(profile?.win_rate, 1);
  assert.ok(getMomentumResearchProfiles().some((item) => item.symbol === 'frxEURUSD' && item.direction === 'down'));
});

test('settled manual Momentum bets contribute to future market direction profiles', async () => {
  const { getMomentumResearchProfile, insertTrade, setSession } = await import('../src/db/store.ts');
  setSession({
    id: 'momentum-evidence-demo',
    loginid: 'VRTC_MOM_EVIDENCE',
    balance: 1000,
    currency: 'USD',
    mode: 'demo',
    auth_kind: 'pat',
    token_cipher: 'x',
    created_at: Date.now(),
    updated_at: Date.now(),
  });
  insertTrade({
    ts: Date.now() - 60_000,
    market: 'R_100',
    contract_type: 'MULTUP',
    barrier: 0,
    duration: 5,
    duration_unit: 'm',
    stake: 1,
    ask_price: 1,
    payout: 2.5,
    est_win: 0,
    profit: 1.5,
    status: 'won',
    contract_id: 'momentum-evidence-contract',
    purchase_id: 'momentum-evidence-purchase',
    reason: 'momentum manual UP | five-minute multiplier x1000',
    origin: 'manual',
    resolved_at: Date.now(),
  });

  const profile = getMomentumResearchProfile('R_100', 'up');
  assert.equal(profile?.windows, 1);
  assert.equal(profile?.wins, 1);
  assert.equal(profile?.estimated_net, 1.5);
});
