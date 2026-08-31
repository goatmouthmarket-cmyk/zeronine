import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import test from 'node:test';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'gold-deriv-trade-'));
process.env.SESSION_SECRET = 'test-secret-test-secret-test-secret';
process.env.GOLD_DERIV_SYMBOL = 'frxXAUUSD';
process.env.GOLD_DERIV_DISPLAY = 'Gold / US Dollar';

function goldState(direction: 'BUY' | 'SELL' = 'BUY') {
  const now = Date.now();
  return {
    diagnostics: {
      provider: 'deriv',
      status: 'market_data_active',
      symbol: 'frxXAUUSD',
      requestedAccountMode: 'demo',
      liveEnabled: false,
      marketDataCapable: true,
      executionCapable: true,
      configured: true,
      missing: [],
      validationErrors: [],
      reason: 'Deriv Gold ready',
    },
    connection: {
      status: 'ready',
      mode: 'demo',
      configured: true,
      canDisconnect: false,
      authorizedAt: null,
      message: null,
    },
    research: {
      ready: true,
      reason: null,
      state: {
        mode: 'research',
        symbol: {
          id: 'frxXAUUSD',
          name: 'frxXAUUSD',
          displayName: 'Gold / US Dollar',
          digits: 2,
          pointSize: 0.01,
          pipSize: 0.01,
          minVolume: 0.35,
          maxVolume: 10000,
          volumeStep: 0.01,
          minStopDistance: 0,
          marginRate: null,
          tradingStatus: 'open',
          sessions: [],
        },
        timeframe: '1m',
        quote: { symbolId: 'frxXAUUSD', bid: 2030.1, ask: 2030.1, mid: 2030.1, spread: 0, timestamp: now, receivedAt: now },
        candles: {},
        signal: {
          id: `gold-test-${direction}`,
          modelVersion: 'test',
          symbol: 'Gold / US Dollar',
          symbolId: 'frxXAUUSD',
          timeframe: '1m',
          direction,
          confidence: 71,
          score: direction === 'BUY' ? .71 : -.71,
          entryReference: 2030.1,
          proposedStopLoss: null,
          proposedTakeProfit: null,
          atr: 1,
          spread: 0,
          spreadToAtr: 0,
          regime: 'TRENDING',
          reasons: ['test Gold trend'],
          blockers: [],
          generatedAt: now,
          expiresAt: now + 30000,
        },
        recentSignals: [],
        lastRejectedTick: null,
        updatedAt: now,
      },
    },
    paper: { ready: true, reason: null, state: { currency: 'USD', initialBalance: 10000, balance: 10000, equity: 10000, realizedPnl: 0, unrealizedPnl: 0, marginUsed: 0, freeMargin: 10000, peakEquity: 10000, drawdown: 0, positions: [], closedTrades: [] } },
    backtest: { ready: false, reason: null, result: null },
  };
}

test('manual Gold demo trade can deliberately differ from the research suggestion', async () => {
  const [{ default: Fastify }, hubMod, marketMod, feedMod, autoMod, paperMod, routesMod, store, cfg] = await Promise.all([
    import('fastify'),
    import('../src/api/hub.ts'),
    import('../src/core/marketState.ts'),
    import('../src/deriv/publicFeed.ts'),
    import('../src/strategy/automation.ts'),
    import('../src/simulation/paperSimulator.ts'),
    import('../src/api/routes.ts'),
    import('../src/db/store.ts'),
    import('../src/config.ts'),
  ]);
  cfg.config.dashboardAdminToken = '';
  cfg.config.goldDerivSymbol = 'frxXAUUSD';
  cfg.config.goldDerivDisplay = 'Gold / US Dollar';
  store.setSession({
    id: 'gold-demo', loginid: 'VRTC_GOLD', balance: 500, currency: 'USD', mode: 'demo', auth_kind: 'pat',
    token_cipher: 'x', created_at: Date.now(), updated_at: Date.now(),
  });

  const hub = new hubMod.Hub();
  const registry = new marketMod.MarketRegistry({ onTick: () => undefined });
  const feed = new feedMod.DerivPublicFeed(registry, () => undefined);
  let quoteArgs: Record<string, unknown> | null = null;
  let boughtProposal = '';
  const client = {
    isConnected: true,
    getAvailableContracts: async () => [{ contract_type: 'MULTUP' }, { contract_type: 'MULTDOWN' }],
    getMultiplierQuote: async (args: Record<string, unknown>) => {
      quoteArgs = args;
      return { id: 'gold-proposal', askPrice: 2, payout: 5, spot: 2031.25, direction: 'up', multiplier: 20 };
    },
    placeBuy: async (proposalId: string) => {
      boughtProposal = proposalId;
      return { contractId: 'gold-contract', buyPrice: 2, payout: 5, purchaseTime: 1 };
    },
    settleContract: async (contractId: string, onUpdate: (update: Record<string, unknown>) => void) => {
      onUpdate({ contractId, status: 'open', profit: .35, sellPrice: 2.35, buyPrice: 2, settled: false });
      return new Promise(() => undefined);
    },
  };
  const app = Fastify();
  const automation = new autoMod.Automation(registry, client as never, hub);
  routesMod.registerApi(app, {
    registry, feed, client: client as never, hub, automation,
    paperSimulator: new paperMod.PaperSimulator(), gold: { state: () => goldState('BUY') } as never,
  });

  const response = await app.inject({ method: 'POST', url: '/api/gold/trade', payload: { side: 'SELL', stake: 2, multiplier: 20, takeProfit: 1.5, stopLoss: .75 } });
  assert.equal(response.statusCode, 200);
  assert.equal(boughtProposal, 'gold-proposal');
  assert.deepEqual(quoteArgs, {
    direction: 'down', amount: 2, currency: 'USD', symbol: 'frxXAUUSD', multiplier: 20, takeProfit: 1.5, stopLoss: .75,
  });
  const trade = store.getOpenTrade('deriv:VRTC_GOLD');
  assert.ok(trade);
  assert.equal(trade.contract_type, 'MULTDOWN');
  assert.equal(trade.market, 'frxXAUUSD');
  assert.equal(trade.entry_spot, 2031.25);
  assert.match(trade.reason, /gold deriv manual SELL/i);
  assert.match(trade.reason, /research BUY 71%/i);
  const learned = store.listGoldTradeKnowledge().find((row) => row.trade_id === trade.id);
  assert.equal(learned?.account_mode, 'demo');
  assert.equal(learned?.direction, 'SELL');
  assert.equal(learned?.signal_direction, 'BUY', 'manual disagreement must be retained as knowledge');
  assert.equal(learned?.status, 'pending');

  const momentumClose = await app.inject({ method: 'POST', url: '/api/momentum/close' });
  assert.equal(momentumClose.statusCode, 409);
  assert.match(momentumClose.json().error, /not a Momentum multiplier trade/i);

  automation.dispose();
  await app.close();
});

test('Gold Deriv close sells the open Gold multiplier contract', async () => {
  const [{ default: Fastify }, hubMod, marketMod, feedMod, autoMod, paperMod, routesMod, store, cfg] = await Promise.all([
    import('fastify'),
    import('../src/api/hub.ts'),
    import('../src/core/marketState.ts'),
    import('../src/deriv/publicFeed.ts'),
    import('../src/strategy/automation.ts'),
    import('../src/simulation/paperSimulator.ts'),
    import('../src/api/routes.ts'),
    import('../src/db/store.ts'),
    import('../src/config.ts'),
  ]);
  cfg.config.dashboardAdminToken = '';
  store.setSession({
    id: 'gold-demo-close', loginid: 'VRTC_GOLD_CLOSE', balance: 500, currency: 'USD', mode: 'demo', auth_kind: 'pat',
    token_cipher: 'x', created_at: Date.now(), updated_at: Date.now(),
  });
  const open = store.insertTrade({
    ts: Date.now(),
    market: 'frxXAUUSD',
    contract_type: 'MULTDOWN',
    barrier: 0,
    duration: 0,
    duration_unit: 'm',
    stake: 3,
    ask_price: 3,
    payout: 6,
    est_win: .7,
    profit: 0,
    status: 'pending',
    contract_id: 'gold-open-contract',
    purchase_id: 'gold-test',
    reason: 'gold deriv manual SELL | multiplier x20',
    origin: 'manual',
  });

  const hub = new hubMod.Hub();
  const registry = new marketMod.MarketRegistry({ onTick: () => undefined });
  const feed = new feedMod.DerivPublicFeed(registry, () => undefined);
  let soldContract = '';
  const client = {
    isConnected: true,
    sellContract: async (contractId: string) => {
      soldContract = contractId;
      return { contractId, soldFor: 4.25, balanceAfter: 501.25, transactionId: 'sell-tx', referenceId: 'sell-ref' };
    },
  };
  const app = Fastify();
  const automation = new autoMod.Automation(registry, client as never, hub);
  routesMod.registerApi(app, {
    registry, feed, client: client as never, hub, automation,
    paperSimulator: new paperMod.PaperSimulator(), gold: { state: () => goldState('SELL') } as never,
  });

  const response = await app.inject({ method: 'POST', url: '/api/gold/close' });
  assert.equal(response.statusCode, 200);
  assert.equal(soldContract, 'gold-open-contract');
  const closed = store.getTrade(open.id, 'deriv:VRTC_GOLD_CLOSE');
  assert.equal(closed?.status, 'won');
  assert.equal(closed?.profit, 1.25);

  automation.dispose();
  await app.close();
});
