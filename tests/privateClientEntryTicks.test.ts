import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DerivPrivateClient, type ContractUpdate } from '../src/deriv/privateClient.ts';

const client = new DerivPrivateClient({ persistBalance: () => {} });
const normalize = (value: Record<string, unknown>): ContractUpdate =>
  (client as unknown as { normalizeContract: (contract: Record<string, unknown>) => ContractUpdate })
    .normalizeContract({ contract_id: 123, underlying_symbol: 'R_100', ...value });

test('reads legacy scalar entry and exit tick timestamps', () => {
  const result = normalize({ entry_tick: 123.45, entry_tick_time: 1700000000, exit_tick: 123.46, exit_tick_time: 1700000002 });
  assert.equal(result.entrySpot, 123.45);
  assert.equal(result.entryTickTime, 1700000000);
  assert.equal(result.exitSpot, 123.46);
  assert.equal(result.exitTickTime, 1700000002);
});

test('reads current string spot fields and timestamps', () => {
  const result = normalize({ entry_spot: '123.45', entry_spot_time: 1700000000, exit_spot: '123.46', exit_spot_time: 1700000002 });
  assert.equal(result.entrySpot, 123.45);
  assert.equal(result.entryTickTime, 1700000000);
  assert.equal(result.exitSpot, 123.46);
  assert.equal(result.exitTickTime, 1700000002);
});

test('reads nested tick shape and leaves missing timestamps unavailable', () => {
  const result = normalize({ entry_tick: { quote: 123.45, epoch: 1700000000 }, exit_tick: { quote: 123.46 } });
  assert.equal(result.entryTickTime, 1700000000);
  assert.equal(result.exitTickTime, undefined);
});
