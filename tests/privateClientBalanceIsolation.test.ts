import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DerivPrivateClient } from '../src/deriv/privateClient.ts';

test('separate private clients send balance updates to their own account writer', () => {
  const a: number[] = [], b: number[] = [];
  const first = new DerivPrivateClient({ persistBalance: value => a.push(value) });
  const second = new DerivPrivateClient({ persistBalance: value => b.push(value) });
  const deliver = (client: DerivPrivateClient, balance: number) => {
    (client as unknown as { handleMessage: (message: unknown) => void }).handleMessage({ msg_type: 'balance', balance: { balance } });
  };
  deliver(first, 10);
  deliver(second, 20);
  assert.deepEqual(a, [10]);
  assert.deepEqual(b, [20]);
});
