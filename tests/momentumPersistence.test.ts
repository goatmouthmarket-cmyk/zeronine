import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import test from 'node:test';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'overunder-momentum-'));

test('completed multiplier research windows persist and expose a maturity threshold', async () => {
  const { getMomentumResearchSummary, insertMomentumResearch } = await import('../src/db/store.ts');
  const base = {
    completed_at: Date.now(), symbol: 'frxEURUSD', market: 'forex', direction: 'up' as const,
    confidence: 82, score: 0.002, return_15s: 0.001, return_30s: 0.0015, return_60s: 0.002,
    open_price: 1.08, decision_price: 1.081, exit_price: 1.083, multiplier: 20, stake: 10,
    commission_rate: 0.001, estimated_net: 0.35,
  };
  insertMomentumResearch({ ...base, won: 1 });
  insertMomentumResearch({ ...base, completed_at: base.completed_at + 1, direction: 'down', estimated_net: -0.2, won: 0 });

  const summary = getMomentumResearchSummary(3);
  assert.deepEqual(summary, {
    windows: 2, wins: 1, losses: 1, win_rate: 0.5, estimated_net: 0.15,
    maturity_target: 3, samples_remaining: 1, ready_for_virtual_paper: false,
  });
});
