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

test('Gold account trade outcomes build direction-specific knowledge across account modes', async () => {
  const store = await import('../src/db/store.ts');
  for (let index = 0; index < 3; index += 1) {
    store.recordGoldTradeKnowledge({
      tradeId: 100 + index, contractId: `gold-contract-${index}`, symbol: 'frxXAUUSD',
      accountMode: index === 0 ? 'real' : 'demo', direction: 'BUY', signalId: `signal-${index}`,
      signalDirection: 'BUY', signalConfidence: 70, signalScore: .7, entryPrice: 4_430,
      openedAt: Date.now() + index, evidence: { source: 'account contract' },
    });
    store.resolveGoldTradeKnowledge(100 + index, index < 2 ? 'won' : 'lost', index < 2 ? 5 : -3, 4_435);
  }
  assert.deepEqual(store.getGoldTradeKnowledgeProfile('frxXAUUSD', 'BUY'), { samples: 3, winRate: 2 / 3 });
  assert.deepEqual(store.getGoldTradeKnowledgeProfile('frxXAUUSD', 'SELL'), { samples: 0, winRate: null });
  assert.deepEqual(new Set(store.listGoldTradeKnowledge().map((row) => row.account_mode)), new Set(['demo', 'real']));
});
