import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import test from 'node:test';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'overunder-ledger-migration-'));
process.env.DATA_DIR = dataDir;
process.env.SESSION_SECRET = 'test-secret-test-secret-test-secret';

test('migration backfills historical trade lifecycle rows exactly once', async () => {
  const legacy = new DatabaseSync(path.join(dataDir, 'overunder.db'));
  legacy.exec(`
    CREATE TABLE trades (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts INTEGER, market TEXT, contract_type TEXT, barrier INTEGER, duration INTEGER, duration_unit TEXT,
      stake REAL, ask_price REAL, payout REAL, est_win REAL, profit REAL, status TEXT,
      contract_id TEXT, purchase_id TEXT, reason TEXT
    );
    INSERT INTO trades
      (ts, market, contract_type, barrier, duration, duration_unit, stake, ask_price, payout, est_win, profit,
       status, contract_id, purchase_id, reason)
    VALUES (1000, 'R_25', 'DIGITUNDER', 9, 1, 't', 2, 2, 3.8, .6, 1.8,
      'won', 'legacy-contract', 'legacy-purchase', 'manual');
  `);
  legacy.close();

  const store = await import('../src/db/store.ts');
  const entries = store.listLedgerEntries(10, '__legacy__');
  assert.deepEqual(entries.map((entry) => entry.event), ['settled', 'purchased', 'requested']);
  assert.equal(entries.every((entry) => entry.account_id === '__legacy__'), true);
  assert.equal(entries[0].account_mode, 'unknown');

  store.getDb();
  assert.equal(store.listLedgerEntries(10, '__legacy__').length, 3, 'reopening must not duplicate immutable entries');
});
