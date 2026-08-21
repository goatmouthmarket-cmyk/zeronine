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
