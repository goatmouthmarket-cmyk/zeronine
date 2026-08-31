import assert from 'node:assert/strict';
import test from 'node:test';
import type { GoldDiagnostics } from '../src/gold/config.ts';
import type { GoldInstrument, GoldMarketDataAdapter, GoldPriceListener } from '../src/gold/ctrader.ts';
import type { GoldCandle, GoldQuote, GoldSymbol } from '../src/gold/domain.ts';
import { GoldRuntime, GoldRuntimeUnavailableError } from '../src/gold/runtime.ts';
import { GoldResearchService } from '../src/gold/researchService.ts';

const NOW = 1_750_000_000_000;
const symbol: GoldSymbol = {
  id: 'xauusd', name: 'XAUUSD', displayName: 'Gold / US Dollar', digits: 2,
  pointSize: .01, pipSize: .01, minVolume: 1, maxVolume: 100, volumeStep: 1,
  minStopDistance: .5, marginRate: .02, tradingStatus: 'open', sessions: [],
};

function candle(index: number, timeframe: '5m' | '15m' = '5m', slope = .1): GoldCandle {
  const open = 2_000 + index * slope;
  const interval = timeframe === '5m' ? 300_000 : 900_000;
  return {
    symbolId: symbol.id, timeframe, openTime: NOW - (40 - index) * interval,
    closeTime: NOW - (39 - index) * interval, open, high: Math.max(open, open + slope) + .2, low: Math.min(open, open + slope) - .1,
    close: open + slope, tickVolume: 10, complete: true,
  };
}

function diagnostics(marketDataCapable: boolean): GoldDiagnostics {
  return {
    provider: 'ctrader', status: marketDataCapable ? 'read_only_stub' : 'unconfigured', symbol: 'XAUUSD',
    requestedAccountMode: 'demo', liveEnabled: false, marketDataCapable, executionCapable: false,
    configured: marketDataCapable, missing: marketDataCapable ? [] : ['CTRADER_CLIENT_ID'], validationErrors: [],
    reason: marketDataCapable ? 'validated test market data' : 'adapter unavailable',
  };
}

class TestMarketAdapter implements GoldMarketDataAdapter {
  private readonly marketDataCapable: boolean;

  constructor(marketDataCapable: boolean) {
    this.marketDataCapable = marketDataCapable;
  }
  diagnostics(): GoldDiagnostics { return diagnostics(this.marketDataCapable); }
  async listInstruments(): Promise<GoldInstrument[]> { return []; }
  async subscribePrices(_symbol: string, _listener: GoldPriceListener): Promise<() => void> { return () => undefined; }
  async close(): Promise<void> {}
}

test('Gold runtime is inert until a validated live market-data adapter supplies current prices', () => {
  const runtime = new GoldRuntime({ adapter: new TestMarketAdapter(false), now: () => NOW });
  const state = runtime.state();
  assert.equal(state.diagnostics.executionCapable, false);
  assert.equal(state.research.ready, false);
  assert.equal(state.paper.ready, false);
  assert.equal(state.backtest.ready, false);
  assert.throws(() => runtime.openPaper({ side: 'BUY', volume: 1 }), GoldRuntimeUnavailableError);
  assert.throws(() => runtime.runBaselineBacktest(), GoldRuntimeUnavailableError);
});

test('Gold runtime automatically paper-tests a validated prediction and links the evidence', () => {
  const runtime = new GoldRuntime({ adapter: new TestMarketAdapter(true), now: () => NOW, research: new GoldResearchService({ now: () => NOW, confirmationCandles: 1 }) });
  runtime.setSymbol(symbol);
  runtime.replaceCandles('5m', Array.from({ length: 40 }, (_, index) => candle(index, '5m', .7)));
  runtime.replaceCandles('15m', Array.from({ length: 40 }, (_, index) => candle(index, '15m', .7)));
  runtime.ingestQuote({ symbolId: symbol.id, bid: 2_028, ask: 2_028.05, timestamp: NOW - 50, receivedAt: NOW, sequence: 1 });

  const state = runtime.state();
  assert.equal(state.research.state.signal?.direction, 'BUY', JSON.stringify(state.research.state.signal));
  assert.equal(state.paperAutomation.opened, 1);
  assert.equal(state.paper.state.positions.length, 1);
  assert.equal(state.paper.state.positions[0]?.origin, 'automatic_research');
  assert.equal(state.paper.state.positions[0]?.researchSignalId, state.research.state.signal?.id);
});

test('Gold runtime stores a prediction and scores it at the five-minute forecast horizon', () => {
  let now = NOW;
  const pending = new Map<string, { signal_id: string; direction: 'BUY' | 'SELL'; entry_price: number; generated_at: number; evaluation_due_at: number }>();
  const resolved: Array<{ signalId: string; status: string; exitPrice: number }> = [];
  const runtime = new GoldRuntime({
    adapter: new TestMarketAdapter(true),
    now: () => now,
    research: new GoldResearchService({ now: () => now, confirmationCandles: 1 }),
    predictionEvidence: {
      record(signal, evaluationDueAt) {
        if (signal.direction !== 'BUY' && signal.direction !== 'SELL') return;
        pending.set(signal.id, { signal_id: signal.id, direction: signal.direction, entry_price: signal.entryReference, generated_at: signal.generatedAt, evaluation_due_at: evaluationDueAt });
      },
      pending: (_symbol, dueAt) => [...pending.values()].filter((row) => row.evaluation_due_at <= dueAt),
      resolve(signalId, status, exitPrice) {
        resolved.push({ signalId, status, exitPrice });
        pending.delete(signalId);
      },
    },
  });
  runtime.setSymbol(symbol);
  const primary = Array.from({ length: 40 }, (_, index) => candle(index, '5m', .7));
  runtime.replaceCandles('5m', primary);
  runtime.replaceCandles('15m', Array.from({ length: 40 }, (_, index) => candle(index, '15m', .7)));
  runtime.ingestQuote({ symbolId: symbol.id, bid: 2_028, ask: 2_028.05, timestamp: NOW - 50, receivedAt: NOW, sequence: 1 });
  const saved = [...pending.values()][0];
  assert.ok(saved);

  now = saved.evaluation_due_at + 60_000;
  const dayEnd = { ...primary.at(-1)!, openTime: saved.evaluation_due_at - 300_000, closeTime: saved.evaluation_due_at, open: saved.entry_price + 4, high: saved.entry_price + 6, low: saved.entry_price + 3, close: saved.entry_price + 5 };
  runtime.replaceCandles('5m', [...primary, dayEnd]);
  assert.deepEqual(resolved, [{ signalId: saved.signal_id, status: 'correct', exitPrice: saved.entry_price + 5 }]);
});

test('Gold runtime can use only virtual paper and completed-candle backtests after market data is validated', () => {
  const runtime = new GoldRuntime({ adapter: new TestMarketAdapter(true), now: () => NOW });
  runtime.setSymbol(symbol);
  runtime.replaceCandles('5m', Array.from({ length: 40 }, (_, index) => candle(index)));
  const quote: Omit<GoldQuote, 'mid' | 'spread'> = {
    symbolId: symbol.id, bid: 2_004, ask: 2_004.1, timestamp: NOW, receivedAt: NOW, sequence: 1,
  };
  runtime.ingestQuote(quote);

  const ready = runtime.state();
  assert.equal(ready.research.ready, true);
  assert.equal(ready.paper.ready, true);
  assert.equal(ready.backtest.ready, true);
  assert.equal(ready.diagnostics.executionCapable, false, 'the runtime never exposes a broker execution path');

  const opened = runtime.openPaper({ side: 'BUY', volume: 1, stopLoss: 2_000, takeProfit: 2_010 });
  assert.ok(opened.accepted, opened.accepted ? undefined : opened.reason);
  const result = runtime.runBaselineBacktest();
  assert.ok(result.candlesProcessed > 0);
  assert.equal(runtime.state().backtest.result?.modelVersion, 'gold-backtest-v1');
});

test('Gold backtest ignores the active unfinished candle and runs completed history', () => {
  const runtime = new GoldRuntime({ adapter: new TestMarketAdapter(true), now: () => NOW });
  runtime.setSymbol(symbol);
  const history = Array.from({ length: 40 }, (_, index) => candle(index));
  history.push({ ...candle(40), openTime: NOW, closeTime: NOW + 300_000, complete: false });
  runtime.replaceCandles('5m', history);

  assert.equal(runtime.state().backtest.ready, true);
  const result = runtime.runBaselineBacktest();
  assert.equal(result.candlesProcessed, 40);
});
