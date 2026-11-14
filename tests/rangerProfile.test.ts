import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ranger-profiles-'));
test('profiles persist independently per Deriv account with validated appearance', async () => {
  const { saveRangerProfile, getRangerProfile, normalizeRangerProfile } = await import('../src/api/rangerProfile.ts');
  const alice = normalizeRangerProfile({ name: '  Alice\n  Ranger  ', appearance: { outfit: 'hoodie', headwear: 'hood', accessory: 'cape', color: '#123456', accent: '#abcdef' } });
  saveRangerProfile('VRTC_A', alice);
  saveRangerProfile('VRTC_B', normalizeRangerProfile({ name: 'Bob', appearance: { outfit: 'invalid', color: 'url(x)' } }));
  assert.deepEqual(getRangerProfile('VRTC_A'), alice);
  assert.equal(getRangerProfile('VRTC_A')?.name, 'Alice Ranger');
  assert.equal(getRangerProfile('VRTC_B')?.name, 'Bob');
  assert.equal(getRangerProfile('VRTC_B')?.appearance.outfit, 'classic');
  assert.equal(getRangerProfile('VRTC_B')?.appearance.color, '#326db1');
  assert.equal(getRangerProfile('VRTC_C'), null);
  const { config } = await import('../src/config.ts');
  const second = new DatabaseSync(config.dbPath);
  try { assert.equal((second.prepare('SELECT count(*) AS n FROM ranger_profiles').get() as { n: number }).n, 2); } finally { second.close(); }
});
