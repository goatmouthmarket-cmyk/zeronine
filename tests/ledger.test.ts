import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import test from 'node:test';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'overunder-ledger-'));
process.env.SESSION_SECRET = 'test-secret-test-secret-test-secret';

test('ledger preserves actual lifecycle entries and keeps virtual results out of account P&L', async () => {
  const store = await import('../src/db/store.ts');
  const login = (loginid: string, mode: 'demo' | 'real') => store.setSession({
    id: `session-${loginid}`,
    loginid,
    balance: 100,
    currency: 'USD',
    mode,
    auth_kind: 'pat',
    token_cipher: 'x',
    created_at: Date.now(),
    updated_at: Date.now(),
  });

  login('A', 'demo');
  const trade = store.insertTrade({
    ts: 10,
    market: 'R_50',
    contract_type: 'DIGITOVER',
    barrier: 0,
    duration: 1,
    duration_unit: 't',
    stake: 2,
    ask_price: 2,
    payout: 3.8,
    est_win: 0.6,
    profit: 0,
    status: 'pending',
    contract_id: '',
    purchase_id: 'manual-1',
    reason: 'manual',
  });
  store.markTradePurchased(trade.id, 'contract-a', 2, 3.8);
  store.resolveTrade(trade.id, 'won', 1.8, 'contract-a', { entrySpot: 10.1, exitSpot: 10.9, exitDigit: 9 });
  store.resolveTrade(trade.id, 'lost', -2, 'contract-a');
  assert.equal(store.getTrade(trade.id)?.profit, 1.8, 'duplicate settlement cannot overwrite the first result');

  store.appendPaperLedgerEntry({
    id: 1,
    runId: 'test-run',
    market: 'R_50',
    direction: 'over',
    barrier: 0,
    stake: 2,
    payoutRatio: 1.9,
    status: 'won',
    entryEpoch: 20,
    entryQuote: 10.1,
    entryDigit: 1,
    exitEpoch: 21,
    exitQuote: 10.9,
    exitDigit: 9,
    profit: 1.8,
    estWin: 0.6,
  }, 'settled');

  const entries = store.listLedgerEntries(10);
  assert.deepEqual(entries.map((entry) => entry.event), ['settled', 'purchased', 'requested']);
  assert.ok(entries.every((entry) => entry.book === 'account'));
  assert.equal(entries[0].account_mode, 'demo');
  assert.equal(entries[0].profit, 1.8);
  const paperEntries = store.listPaperLedgerEntries(10);
  assert.equal(paperEntries.length, 1);
  assert.equal(paperEntries[0].account_id, null);
  assert.equal(paperEntries[0].account_mode, 'not_applicable');
  assert.match(paperEntries[0].reason, /virtual research/);
  assert.equal(store.getPerformanceSummary().profit, 1.8, 'paper profit must not affect account performance');

  login('B', 'real');
  const scoped = store.listLedgerEntries(10);
  assert.equal(scoped.length, 0, 'B cannot see paper research or A financial records');
  assert.equal(store.listPaperLedgerEntries(10).length, 1, 'paper history remains available in its own book');
});

test('paper outcome calibration is sample-gated, holdout-validated, bounded, and P&L-free', async () => {
  const store = await import('../src/db/store.ts');
  const calibration = await import('../src/intelligence/researchCalibration.ts');
  calibration.resetResearchCalibrationForTests();
  for (let i = 0; i < 30; i += 1) {
    store.appendPaperLedgerEntry({
      id: i + 1,
      runId: 'calibration-run',
      market: 'R_25',
      direction: 'under',
      barrier: 9,
      stake: 1000 + i,
      payoutRatio: 99,
      status: 'won',
      entryEpoch: 100 + i,
      entryQuote: 10,
      entryDigit: 1,
      exitEpoch: 101 + i,
      exitQuote: 11,
      exitDigit: 1,
      profit: 999999,
      estWin: 0.6,
    }, 'settled');
    calibration.observeResearchOutcome({ market: 'R_25', direction: 'under', barrier: 9, predicted: 0.6, won: true });
  }
  const calibrated = calibration.calibrateResearchProbability('R_25', 'under', 9, 0.6);
  assert.equal(calibrated.applied, true);
  assert.equal(calibrated.samples, 30);
  assert.ok(calibrated.probability > 0.6 && calibrated.probability <= 0.63);
  assert.equal(calibration.calibrateResearchProbability('R_25', 'over', 0, 0.6).applied, false);
});
