import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import test from 'node:test';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'overunder-arb-demo-'));
process.env.SESSION_SECRET = 'test-secret-test-secret-test-secret';

const waitFor = async (check: () => boolean, timeout = 1_000): Promise<void> => {
  const end = Date.now() + timeout;
  while (!check()) {
    if (Date.now() > end) throw new Error('timed out waiting for asynchronous feasibility settlement');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
};

test('demo feasibility buys fresh payout-basis complementary legs concurrently and records aligned settlements', async () => {
  const [hubMod, harnessMod] = await Promise.all([
    import('../src/api/hub.ts'),
    import('../src/arbitrage/demoFeasibility.ts'),
  ]);
  const calls: Array<{ kind: string; id?: string; basis?: string; price?: number }> = [];
  let concurrentBuys = 0;
  let sawTwoBuys = false;
  let releaseBuys: (() => void) | undefined;
  const buyGate = new Promise<void>((resolve) => { releaseBuys = resolve; });
  const client = {
    getQuote: async (input: { direction: 'under' | 'over'; barrier: number; basis?: string; amount: number }) => {
      calls.push({ kind: 'quote', basis: input.basis });
      return { id: `proposal-${input.direction}`, direction: input.direction, barrier: input.barrier, askPrice: 4.9, payout: input.amount,
        spot: 1, requestSentAt: Date.now(), receivedAt: Date.now(), roundTripMs: 2, basis: 'payout' as const };
    },
    placeBuy: async (id: string, price: number) => {
      calls.push({ kind: 'buy', id, price });
      concurrentBuys += 1;
      if (concurrentBuys === 2) { sawTwoBuys = true; releaseBuys?.(); }
      await buyGate;
      return { contractId: `contract-${id}`, payout: 10, buyPrice: price, purchaseTime: 10 };
    },
    settleContract: async (id: string) => ({ contractId: id, status: 'won' as const, profit: 0.2, sellPrice: 5.1, buyPrice: 4.9, settled: true,
      dateStart: 10, dateExpiry: 11, entryTickTime: 10, exitTickTime: 11 }),
  };
  const harness = new harnessMod.ArbDemoFeasibility(client as never, new hubMod.Hub());
  const opened = await harness.start({ accountId: 'deriv:CR_ARB', symbol: 'R_50', currency: 'USD', pair: { underBarrier: 5, overBarrier: 4 }, targetPayout: 10 });
  assert.equal(sawTwoBuys, true, 'both purchase requests must begin before either resolves');
  assert.deepEqual(calls.filter((call) => call.kind === 'quote').map((call) => call.basis), ['payout', 'payout']);
  assert.deepEqual(calls.filter((call) => call.kind === 'buy').map((call) => call.price), [4.9, 4.9]);
  await waitFor(() => harness.state(opened.execution.id)?.execution.status === 'completed');
  const completed = harness.state(opened.execution.id)!;
  assert.equal(completed.execution.feasibility_status, 'both_filled');
  assert.equal(completed.execution.settlement_alignment, 'same_settlement_event');
  assert.equal(completed.legs.filter((leg) => leg.status === 'filled').length, 2);
});

test('an ambiguous buy outcome is retained once and is never retried', async () => {
  const [hubMod, harnessMod] = await Promise.all([
    import('../src/api/hub.ts'),
    import('../src/arbitrage/demoFeasibility.ts'),
  ]);
  const buys: string[] = [];
  const client = {
    getQuote: async (input: { direction: 'under' | 'over'; barrier: number; amount: number }) =>
      ({ id: `proposal-${input.direction}`, direction: input.direction, barrier: input.barrier, askPrice: 5, payout: input.amount,
        spot: 1, requestSentAt: Date.now(), receivedAt: Date.now(), roundTripMs: 1, basis: 'payout' as const }),
    placeBuy: async (id: string) => {
      buys.push(id);
      if (id.endsWith('over')) throw new Error('buy timeout');
      return { contractId: 'under-contract', payout: 10, buyPrice: 5, purchaseTime: 10 };
    },
    settleContract: async (id: string) => ({ contractId: id, status: 'lost' as const, profit: -5, sellPrice: 0, buyPrice: 5, settled: true,
      dateStart: 10, dateExpiry: 11, entryTickTime: 10, exitTickTime: 11 }),
  };
  const harness = new harnessMod.ArbDemoFeasibility(client as never, new hubMod.Hub());
  const state = await harness.start({ accountId: 'deriv:CR_ARB', symbol: 'R_50', currency: 'USD', pair: { underBarrier: 5, overBarrier: 4 }, targetPayout: 10 });
  await waitFor(() => harness.state(state.execution.id)?.execution.status === 'completed');
  const completed = harness.state(state.execution.id)!;
  assert.deepEqual(buys.sort(), ['proposal-over', 'proposal-under']);
  assert.equal(completed.execution.feasibility_status, 'unknown_execution');
  assert.equal(completed.legs.find((leg) => leg.leg === 'over')?.status, 'unknown');
});

test('the demo endpoint requires explicit confirmation and rejects real sessions', async () => {
  const [{ default: Fastify }, hubMod, marketMod, feedMod, autoMod, routesMod, paperMod, store, cfg, harnessMod] = await Promise.all([
    import('fastify'), import('../src/api/hub.ts'), import('../src/core/marketState.ts'), import('../src/deriv/publicFeed.ts'),
    import('../src/strategy/automation.ts'), import('../src/api/routes.ts'), import('../src/simulation/paperSimulator.ts'),
    import('../src/db/store.ts'), import('../src/config.ts'), import('../src/arbitrage/demoFeasibility.ts'),
  ]);
  cfg.config.dashboardAdminToken = '';
  store.setSession({ id: 'arb-api', loginid: 'CR_ARB_API', balance: 100, currency: 'USD', mode: 'demo', auth_kind: 'pat', token_cipher: 'x', created_at: Date.now(), updated_at: Date.now() });
  const hub = new hubMod.Hub();
  const registry = new marketMod.MarketRegistry({ onTick: () => undefined });
  registry.ensure('R_50');
  const client = {
    isConnected: true,
    getQuote: async () => { throw new Error('must not quote without confirmation'); },
    placeBuy: async () => { throw new Error('must not buy without confirmation'); },
    settleContract: async () => new Promise(() => undefined),
  };
  const automation = new autoMod.Automation(registry, client as never, hub);
  const app = Fastify();
  routesMod.registerApi(app, { registry, feed: new feedMod.DerivPublicFeed(registry, () => undefined), client: client as never, hub, automation,
    paperSimulator: new paperMod.PaperSimulator(), arbDemoFeasibility: new harnessMod.ArbDemoFeasibility(client as never, hub) });
  const noConfirmation = await app.inject({ method: 'POST', url: '/api/arb/feasibility/demo', payload: { symbol: 'R_50', pair: 'U5/O4', target_payout: 10 } });
  assert.equal(noConfirmation.statusCode, 400);
  store.setSession({ ...store.getSession()!, mode: 'real' });
  const real = await app.inject({ method: 'POST', url: '/api/arb/feasibility/demo', payload: { confirm_demo_execution: true, symbol: 'R_50', pair: 'U5/O4', target_payout: 10 } });
  assert.equal(real.statusCode, 403);
  automation.dispose();
  await app.close();
});
