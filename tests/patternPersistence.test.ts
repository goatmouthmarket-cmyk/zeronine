import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import test from 'node:test';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'overunder-patterns-'));

test('an empty pattern scan replacement clears stale confirmed transitions', async () => {
  const { listPatterns, replacePatterns } = await import('../src/db/store.ts');
  replacePatterns([{
    market: 'R_50', prev_digit: 3, next_digit: 7, count: 140,
    frequency: 0.24, expected: 0.1, lift: 2.4, window: 5000,
  }]);
  assert.equal(listPatterns().length, 1);

  replacePatterns([]);
  assert.deepEqual(listPatterns(), []);
});
