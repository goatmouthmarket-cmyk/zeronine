import assert from 'node:assert/strict';
import test from 'node:test';
import { assessGoldTradeGuidance } from '../web/src/goldTradeGuidance.ts';

const openBuy = { open: true, side: 'BUY' as const, pnl: 1, forecastSide: 'BUY' as const, forecastActionable: true, forecastConfidence: 72 };

test('Gold trade guidance holds an aligned contract', () => {
  assert.equal(assessGoldTradeGuidance(openBuy).action, 'HOLD');
});

test('Gold trade guidance closes for a confirmed reversal or threatened stop', () => {
  assert.equal(assessGoldTradeGuidance({ ...openBuy, forecastSide: 'SELL' }).action, 'CLOSE');
  assert.equal(assessGoldTradeGuidance({ ...openBuy, pnl: -8.2, stopLoss: 10 }).action, 'CLOSE');
});

test('Gold trade guidance protects profit near target and warns on forming reversal', () => {
  assert.equal(assessGoldTradeGuidance({ ...openBuy, pnl: 8.5, takeProfit: 10 }).action, 'PROTECT');
  assert.equal(assessGoldTradeGuidance({ ...openBuy, forecastSide: 'SELL', forecastActionable: false }).action, 'PROTECT');
});
