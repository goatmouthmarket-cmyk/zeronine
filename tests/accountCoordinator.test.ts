import assert from 'node:assert/strict';
import test from 'node:test';
import { AccountCoordinator } from '../src/execution/accountCoordinator.ts';

test('account coordinator enforces shared exposure with product-specific slots', () => {
  const coordinator = new AccountCoordinator({
    maxOpenContracts: 3, maxReservedExposure: 10,
    maxOpenPerProduct: { digits: 1, momentum: 2, gold: 1 }, maxConcurrentSettlements: 1,
  });
  const digit = coordinator.reserve({ accountId: 'CR1', product: 'digits', exposure: 2 });
  coordinator.reserve({ accountId: 'CR1', product: 'momentum', exposure: 3 });
  assert.throws(() => coordinator.reserve({ accountId: 'CR1', product: 'digits', exposure: 1 }), /digits open-contract/);
  assert.throws(() => coordinator.reserve({ accountId: 'CR1', product: 'gold', exposure: 6 }), /reserved-exposure/);
  coordinator.release(digit);
  const state = coordinator.state('CR1');
  assert.equal(state.active, 1);
  assert.equal(state.reservedExposure, 3);
});

test('account commands serialize while settlement supervision remains bounded', async () => {
  const coordinator = new AccountCoordinator({ maxOpenContracts: 2, maxReservedExposure: 10, maxOpenPerProduct: {}, maxConcurrentSettlements: 1 });
  const order: string[] = [];
  await Promise.all([
    coordinator.runCommand('test', 'CR2', async () => { order.push('first'); }),
    coordinator.runCommand('manual_open', 'CR2', async () => { order.push('second'); }),
  ]);
  assert.deepEqual(order, ['first', 'second']);

  let release!: () => void;
  const waiting = new Promise<void>((resolve) => { release = resolve; });
  const first = coordinator.supervise('CR2', async () => { await waiting; return 'one'; });
  const second = coordinator.supervise('CR2', async () => 'two');
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(coordinator.state('CR2').activeSettlements, 1);
  release();
  assert.deepEqual(await Promise.all([first, second]), ['one', 'two']);
});
