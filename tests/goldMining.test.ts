import test from 'node:test';
import assert from 'node:assert/strict';
import { goldMiningDirection } from '../web/src/goldMining.ts';
import type { GoldMiningState } from '../web/src/goldMining.ts';

test('Gold mining only displays a current actionable signal on an open market with a fresh quote', () => {
  const now = 1_000_000;
  const state: GoldMiningState = { research: { ready: true, state: { symbol: { tradingStatus: 'open' }, quote: { timestamp: now }, signal: { actionable: true, direction: 'BUY', expiresAt: now + 1_000 } } } };
  assert.equal(goldMiningDirection(state, now), 'BUY');
  assert.equal(goldMiningDirection(state, now + 1_000), null);
  state.research.state.signal!.expiresAt = now + 50_000;
  assert.equal(goldMiningDirection(state, now + 10_001), null);
  state.research.state.symbol!.tradingStatus = 'closed';
  assert.equal(goldMiningDirection(state, now), null);
  state.research.state.symbol!.tradingStatus = 'open';
  state.research.state.signal!.actionable = false;
  assert.equal(goldMiningDirection(state, now), null);
  assert.equal(goldMiningDirection(null, now), null);
});
