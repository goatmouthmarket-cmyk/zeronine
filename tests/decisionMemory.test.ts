import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'overunder-memory-'));
process.env.DATA_DIR = tmp;

test('counterfactual waits resolve once from the next market tick', async () => {
  const [{ DecisionMemory }, { listDecisionEvents }] = await Promise.all([
    import('../src/intelligence/decisionMemory.ts'),
    import('../src/db/store.ts'),
  ]);
  const memory = new DecisionMemory();
  memory.remember({
    ts: 1_000,
    action: 'wait',
    reason: 'edge below threshold',
    market: 'R_50',
    direction: 'over',
    barrier: 0,
    counterfactual: true,
  });
  memory.onTick('R_10', 0, 1_001);
  assert.equal(listDecisionEvents(1)[0].outcome, null);
  memory.onTick('R_50', 0, 1_002);
  assert.equal(listDecisionEvents(1)[0].outcome, 'lost');
  memory.onTick('R_50', 1, 1_003);
  assert.equal(listDecisionEvents(1)[0].outcome, 'lost');
});

test('duplicate decision evidence is throttled and pending evidence expires', async () => {
  const [{ DecisionMemory }, { listDecisionEvents }] = await Promise.all([
    import('../src/intelligence/decisionMemory.ts'),
    import('../src/db/store.ts'),
  ]);
  const memory = new DecisionMemory();
  const event = { ts: 10_000, action: 'skip' as const, reason: 'risk', market: 'R_25', direction: 'under' as const, barrier: 9, counterfactual: true, expires_at: 10_001 };
  assert.ok(memory.remember(event));
  assert.equal(memory.remember(event), null);
  memory.onTick('R_10', 2, 10_002);
  assert.equal(listDecisionEvents(1)[0].outcome, 'expired');
});
