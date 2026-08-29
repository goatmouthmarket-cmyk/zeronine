import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeGoldQuote, type GoldSymbol } from '../src/gold/domain.ts';
import { GoldPaperEngine } from '../src/gold/paper.ts';

const NOW = 1_750_000_000_000;
const symbol: GoldSymbol = {
  id: 'xauusd', name: 'XAUUSD', displayName: 'Gold / US Dollar', digits: 2,
  pointSize: .01, pipSize: .01, minVolume: 1, maxVolume: 100, volumeStep: 1,
  minStopDistance: .5, marginRate: .02, tradingStatus: 'open', sessions: [],
};

function quote(bid: number, ask: number, offset = 0, sequence?: number) {
  return normalizeGoldQuote({ symbolId: symbol.id, bid, ask, timestamp: NOW + offset, receivedAt: NOW + offset, ...(sequence === undefined ? {} : { sequence }) });
}

function rejection(result: ReturnType<GoldPaperEngine['open']>): string {
  if (result.accepted) throw new Error('expected Gold paper order rejection');
  return result.reason;
}

function closeRejection(result: ReturnType<GoldPaperEngine['close']>): string {
  if (result.closed) throw new Error('expected Gold paper close rejection');
  return result.reason;
}

test('Gold paper book uses bid/ask, slippage, commission, margin, and marks equity from executable prices', () => {
  const engine = new GoldPaperEngine({ initialBalance: 1_000, slippageBps: 1, commissionPerUnit: .5 });
  const opened = engine.open({ symbol, side: 'BUY', volume: 10, quote: quote(2000, 2001), now: NOW, stopLoss: 1990, takeProfit: 2020 });
  assert.equal(opened.accepted, true);
  if (!opened.accepted) return;
  assert.equal(opened.position.entryPrice, 2001 * 1.0001);
  assert.equal(opened.position.marginUsed, 400.24);
  assert.equal(opened.state.balance, 995, 'entry commission is a real virtual cash cost');
  assert.equal(opened.state.unrealizedPnl, -14, 'long positions mark to the bid after adverse slippage');
  assert.equal(opened.state.freeMargin, 580.76);

  engine.onQuote(quote(2005, 2006, 1, 2));
  const marked = engine.state();
  assert.equal(marked.unrealizedPnl, 35.99);
  assert.equal(marked.equity, 1030.99);
  assert.equal(marked.drawdown, 0);
});

test('Gold paper settles stop loss and take profit from executable ticks and preserves net ledger result', () => {
  const engine = new GoldPaperEngine({ initialBalance: 2_000, commissionPerUnit: 1 });
  const opened = engine.open({ symbol, side: 'BUY', volume: 10, quote: quote(2000, 2001), now: NOW, stopLoss: 1995, takeProfit: 2010 });
  assert.ok(opened.accepted);
  const stop = engine.onQuote(quote(1992, 1993, 1, 2))[0]!;
  assert.ok(stop?.closed);
  if (!stop?.closed) return;
  assert.equal(stop.trade.closeReason, 'stop_loss');
  assert.equal(stop.trade.exitPrice, 1992, 'gap-through stop fills at the worse executable bid');
  assert.equal(stop.trade.grossPnl, -90);
  assert.equal(stop.trade.netPnl, -110);
  assert.equal(stop.state.balance, 1890);
  assert.equal(stop.state.marginUsed, 0);

  const target = engine.open({ symbol, side: 'SELL', volume: 10, quote: quote(2010, 2011, 2, 3), now: NOW + 2, stopLoss: 2015, takeProfit: 2000 });
  assert.ok(target.accepted);
  const take = engine.onQuote(quote(1999, 2000, 3, 4))[0]!;
  assert.ok(take?.closed);
  if (!take?.closed) return;
  assert.equal(take.trade.closeReason, 'take_profit');
  assert.equal(take.trade.exitPrice, 2000);
  assert.equal(take.trade.netPnl, 80);
  assert.equal(take.state.balance, 1970);
  assert.equal(take.state.realizedPnl, -30);
});

test('Gold paper validates server-side stops, quote freshness, volume limits, margin and one-position safety', () => {
  const engine = new GoldPaperEngine({ initialBalance: 100, maxQuoteAgeMs: 1_000 });
  const base = { symbol, side: 'BUY' as const, volume: 1, quote: quote(2000, 2001), now: NOW };
  assert.match(rejection(engine.open({ ...base, stopLoss: 2001 })), /below entry/i);
  assert.match(rejection(engine.open({ ...base, takeProfit: 2001.2 })), /minimum stop distance/i);
  assert.match(rejection(engine.open({ ...base, volume: 1.5 })), /step/i);
  assert.match(rejection(engine.open({ ...base, now: NOW + 1_001 })), /stale/i);
  assert.match(rejection(engine.open({ ...base, volume: 3 })), /margin/i);

  const opened = engine.open({ ...base, volume: 2, stopLoss: 1990 });
  assert.ok(opened.accepted);
  assert.match(rejection(engine.open({ ...base, volume: 1, quote: quote(2001, 2002, 1), now: NOW + 1, stopLoss: 1990 })), /already open/i);
});

test('Gold paper ignores out-of-order quotes, allows manual close only for the matching symbol, and reset removes virtual ledger state', () => {
  const engine = new GoldPaperEngine({ initialBalance: 1_000 });
  const opened = engine.open({ symbol, side: 'SELL', volume: 1, quote: quote(2000, 2001, 0, 3), now: NOW, stopLoss: 2005 });
  assert.ok(opened.accepted);
  if (!opened.accepted) return;
  engine.onQuote(quote(1990, 1991, 2, 4));
  assert.equal(engine.state().unrealizedPnl, 9);
  assert.deepEqual(engine.onQuote(quote(2100, 2101, 1, 2)), [], 'old sequence cannot settle or alter a position');
  assert.equal(engine.state().positions.length, 1);
  assert.match(closeRejection(engine.close(opened.position.id, quote(1980, 1981, 1, 2), NOW + 1)), /out of order/i);
  const wrongQuote = normalizeGoldQuote({ symbolId: 'other', bid: 1, ask: 2, timestamp: NOW + 3, receivedAt: NOW + 3 });
  assert.match(closeRejection(engine.close(opened.position.id, wrongQuote, NOW + 3)), /does not match/i);
  const closed = engine.close(opened.position.id, quote(1980, 1981, 4, 5), NOW + 4);
  assert.ok(closed.closed);
  assert.equal(engine.state().closedTrades.length, 1);
  const reset = engine.reset();
  assert.equal(reset.balance, 1_000);
  assert.equal(reset.positions.length, 0);
  assert.equal(reset.closedTrades.length, 0);
  assert.equal(reset.drawdown, 0);
});
