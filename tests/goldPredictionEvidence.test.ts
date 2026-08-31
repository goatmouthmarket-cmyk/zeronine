import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import test from 'node:test';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'overunder-gold-prediction-'));

test('Gold prediction evidence persists once and resolves immutably at day end', async () => {
  const store = await import('../src/db/store.ts');
  const generatedAt = Date.UTC(2026, 7, 31, 15);
  const dueAt = Date.UTC(2026, 8, 1);
  const input = {
    signal_id: 'gold-signal-1', symbol: 'frxXAUUSD', timeframe: '1m', direction: 'BUY' as const,
    confidence: 72, score: .72, entry_price: 4_430, generated_at: generatedAt, evaluation_due_at: dueAt,
    evidence: { regime: 'TRENDING', rsi: 58 },
  };
  store.recordGoldPredictionEvidence(input);
  store.recordGoldPredictionEvidence({ ...input, confidence: 1 });
  const pending = store.listPendingGoldPredictions('frxXAUUSD', dueAt);
  assert.equal(pending.length, 1);
  assert.equal(pending[0]?.confidence, 72, 'duplicate signal ids must not rewrite the original evidence');

  store.resolveGoldPredictionEvidence('gold-signal-1', 'correct', 4_445, dueAt + 60_000);
  store.resolveGoldPredictionEvidence('gold-signal-1', 'incorrect', 4_400, dueAt + 120_000);
  const row = store.listGoldPredictionEvidence(1)[0];
  assert.equal(row?.status, 'correct');
  assert.equal(row?.exit_price, 4_445);
  assert.equal(store.listPendingGoldPredictions('frxXAUUSD', dueAt + 1).length, 0);
});
