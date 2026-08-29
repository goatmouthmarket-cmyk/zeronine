import assert from 'node:assert/strict';
import test from 'node:test';
import { PaperSimulator } from '../src/simulation/paperSimulator.ts';

const tick = (digit: number, epoch: number, market = 'R_50') => ({
  market,
  quote: 1_000 + digit / 10,
  digit,
  epoch,
});

test('paper simulator settles only from the next public tick and changes virtual balance', () => {
  const simulator = new PaperSimulator({ initialBalance: 100, defaultStake: 10, defaultPayoutRatio: 1.9 });
  const events: string[] = [];
  simulator.on((event) => events.push(event.type));

  assert.equal(simulator.start(), true);
  simulator.onTick(tick(4, 1));
  simulator.offer({ market: 'R_50', direction: 'over', barrier: 3 });
  assert.equal(simulator.state().openContract?.status, 'open');
  assert.equal(simulator.state().availableBalance, 90);

  simulator.onTick(tick(8, 2));
  const state = simulator.state();
  assert.equal(state.openContract, null);
  assert.equal(state.wins, 1);
  assert.equal(state.losses, 0);
  assert.equal(state.totalTrades, 1);
  assert.equal(state.balance, 109);
  assert.equal(state.netPnl, 9);
  assert.equal(state.lastSettled?.profit, 9);
  assert.deepEqual(state.equity, [100, 109]);
  assert.deepEqual(events, ['started', 'tick', 'opened', 'tick', 'settled']);
});

test('paper simulator uses the first subsequent tick from the contract market only', () => {
  const simulator = new PaperSimulator({ initialBalance: 100, defaultStake: 10 });
  simulator.start();
  simulator.onTick(tick(4, 1));
  simulator.offer({ market: 'R_50', direction: 'under', barrier: 5 });
  simulator.onTick(tick(9, 2, 'R_75'));
  assert.equal(simulator.state().openContract?.status, 'open');
  simulator.onTick(tick(7, 3));
  assert.equal(simulator.state().lastSettled?.status, 'lost');
  assert.equal(simulator.state().balance, 90);
});

test('paper simulator enforces one virtual contract and never opens before a public tick', () => {
  const simulator = new PaperSimulator({ initialBalance: 10, defaultStake: 2 });
  const skipped: string[] = [];
  simulator.on((event) => {
    if (event.type === 'skipped') skipped.push(event.reason);
  });
  simulator.start();
  assert.equal(simulator.offer({ market: 'R_10', direction: 'over', barrier: 0 }), null);
  simulator.onTick(tick(2, 1));
  assert.ok(simulator.offer({ market: 'R_50', direction: 'over', barrier: 0 }));
  assert.equal(simulator.offer({ market: 'R_50', direction: 'under', barrier: 9 }), null);
  assert.deepEqual(skipped, ['market has no public tick yet', 'one virtual contract is already open']);
});

test('paper simulator stops without settling or restarting a cancelled contract', () => {
  const simulator = new PaperSimulator({ initialBalance: 100, defaultStake: 10 });
  simulator.start();
  simulator.onTick(tick(1, 1));
  simulator.offer({ market: 'R_50', direction: 'over', barrier: 0 });
  simulator.stop();
  simulator.onTick(tick(9, 2));
  const state = simulator.state();
  assert.equal(state.phase, 'stopped');
  assert.equal(state.totalTrades, 0);
  assert.equal(state.balance, 100);
  assert.equal(state.openContract, null);
  assert.equal(simulator.offer({ market: 'R_50', direction: 'over', barrier: 0 }), null);
});

test('paper simulator completes a bounded run and can only resume after reset', () => {
  const simulator = new PaperSimulator({ initialBalance: 100, defaultStake: 5, maxTrades: 1 });
  simulator.start();
  simulator.onTick(tick(2, 1));
  simulator.offer({ market: 'R_50', direction: 'over', barrier: 0 });
  simulator.onTick(tick(5, 2));
  assert.equal(simulator.state().phase, 'completed');
  assert.equal(simulator.start(), false);
  simulator.reset();
  assert.equal(simulator.state().phase, 'idle');
  assert.equal(simulator.start(), true);
});

test('paper simulator accepts each fresh scanner offer once and cools down repeated candidates', () => {
  const simulator = new PaperSimulator({ initialBalance: 100, defaultStake: 5 });
  const skipped: string[] = [];
  simulator.on((event) => {
    if (event.type === 'skipped') skipped.push(event.reason);
  });
  simulator.start();
  simulator.onTick(tick(1, 1));
  const fresh = { market: 'R_50', direction: 'over' as const, barrier: 0, id: 'scan-1', issuedAt: Date.now() };
  assert.ok(simulator.offer(fresh));
  simulator.onTick(tick(9, 2));
  assert.equal(simulator.offer(fresh), null, 'the same scanner emission cannot reopen a settled contract');
  assert.equal(simulator.offer({ ...fresh, id: 'scan-2', issuedAt: Date.now() }), null, 'a rapid repeat of the same candidate is cooled down');
  assert.equal(simulator.offer({ ...fresh, id: 'stale', issuedAt: Date.now() - 6_000 }), null, 'an old scanner recommendation is rejected');
  assert.deepEqual(skipped, ['scanner signal was already offered', 'scanner candidate cooldown', 'scanner signal is stale']);
});
