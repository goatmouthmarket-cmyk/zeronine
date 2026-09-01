export type GoldTradeGuidanceAction = 'HOLD' | 'PROTECT' | 'CLOSE' | 'WAIT';

export interface GoldTradeGuidanceInput {
  open: boolean;
  side: 'BUY' | 'SELL' | null;
  pnl: number | null;
  takeProfit?: number;
  stopLoss?: number;
  forecastSide: 'BUY' | 'SELL' | null;
  forecastActionable: boolean;
  forecastConfidence: number;
}

export interface GoldTradeGuidance {
  action: GoldTradeGuidanceAction;
  reason: string;
  tone: 'positive' | 'warning' | 'danger' | 'idle';
}

export function assessGoldTradeGuidance(input: GoldTradeGuidanceInput): GoldTradeGuidance {
  if (!input.open || !input.side) return { action: 'WAIT', reason: 'Open a trade to receive live hold and close guidance.', tone: 'idle' };
  const pnl = Number.isFinite(input.pnl) ? Number(input.pnl) : null;
  if (pnl != null && input.stopLoss != null && pnl <= -input.stopLoss * .8) {
    return { action: 'CLOSE', reason: `Loss is within 20% of the ${input.stopLoss.toFixed(2)} stop limit. Protect remaining stake.`, tone: 'danger' };
  }
  if (pnl != null && input.takeProfit != null && pnl >= input.takeProfit * .85) {
    return { action: 'PROTECT', reason: `Profit has reached at least 85% of the ${input.takeProfit.toFixed(2)} target. Consider cashing out.`, tone: 'warning' };
  }
  const reversal = Boolean(input.forecastSide && input.forecastSide !== input.side);
  if (reversal && input.forecastActionable) {
    return { action: 'CLOSE', reason: `Confirmed ${input.forecastSide} forecast opposes this ${input.side} contract.`, tone: 'danger' };
  }
  if (reversal) {
    return { action: 'PROTECT', reason: `An opposing ${input.forecastSide} forecast is forming at ${input.forecastConfidence}% confidence. Watch the next confirmation closely.`, tone: 'warning' };
  }
  if (input.forecastSide === input.side) {
    return { action: 'HOLD', reason: `${input.forecastConfidence}% forecast remains aligned with the open ${input.side} contract.`, tone: 'positive' };
  }
  return { action: 'HOLD', reason: 'No confirmed reversal yet. Keep the stop-loss in control and review on the next completed candle.', tone: 'idle' };
}
