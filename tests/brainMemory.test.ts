import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import type { RangerBrainReport } from '../src/brain/service.ts';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ranger-brain-memory-'));
process.env.DATA_DIR = dir;

test('paper finding transitions persist with observation times and no fabricated backfill', async () => {
  const { observeBrainMemory } = await import('../src/brain/memory.ts');
  const report = {
    mode: 'paper', market: 'R_50', lookbackDays: 30, updatedAt: 1700000000000,
    lessons: [{ id: 'hour-14', topic: 'Time', finding: '14:00 won 20 of 35 outcomes', outcomes: 35, validity: 'provisional' }],
  } as unknown as RangerBrainReport;
  const first = observeBrainMemory(report, 1700001000000);
  assert.equal(first.length, 1);
  assert.equal(first[0]?.observedAt, 1700001000000);
  assert.equal(first[0]?.evidenceAt, report.updatedAt);
  const countOnly = { ...report, lessons: [{ ...report.lessons[0]!, finding: '14:00 won 21 of 36 outcomes', outcomes: 36 }] };
  assert.equal(observeBrainMemory(countOnly, 1700001001000).length, 1);
  const changed = { ...report, lessons: [{ ...report.lessons[0]!, finding: '14:00 no longer clears break-even', validity: 'validated' as const }] };
  assert.equal(observeBrainMemory(changed, 1700001002000).length, 2);
  assert.equal(observeBrainMemory({ ...changed, lookbackDays: 7 }, 1700001003000).length, 2);
  assert.deepEqual(observeBrainMemory({ ...report, market: 'R_10', lessons: [] }, 1700001004000), []);
  assert.throws(() => observeBrainMemory({ ...report, mode: 'real' } as unknown as RangerBrainReport));

  // Read through an independent connection, proving this is durable storage,
  // not just an in-memory collection attached to the report.
  const { config } = await import('../src/config.ts');
  const second = new DatabaseSync(config.dbPath);
  try {
    const row = second.prepare('SELECT count(*) AS n FROM brain_memory_events').get() as { n: number };
    assert.equal(row.n, 2);
  } finally { second.close(); }
});
