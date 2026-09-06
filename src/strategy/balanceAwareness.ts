/** Run-scoped financial context for the digit bot. It turns balance, drawdown
 * and protected-profit information into a maximum loss the next contract may
 * take. It makes no prediction and never sees manual/other-product P&L. */
export interface BalanceAwarenessInput {
  startBalance: number;
  currentBalance: number;
  peakBalance: number;
  runProfit: number;
  peakRunProfit: number;
  baseStake: number;
  maxDrawdownPct: number;
}

export interface BalanceAwareness {
  action: 'trade' | 'reduce' | 'hold';
  maxLoss: number;
  protectedProfit: number;
  drawdownPct: number;
  reason: string;
}

export function assessBalanceAwareness(input: BalanceAwarenessInput): BalanceAwareness {
  const balance = Math.max(0, input.currentBalance);
  const peakBalance = Math.max(balance, input.peakBalance, input.startBalance);
  const drawdownPct = peakBalance > 0 ? Math.max(0, (peakBalance - balance) / peakBalance * 100) : 0;
  const arm = Math.max(1, input.baseStake * 5);
  const protectedProfit = input.peakRunProfit >= arm ? input.peakRunProfit * .75 : 0;
  const profitBudget = protectedProfit > 0 ? Math.max(0, input.runProfit - protectedProfit) : Infinity;
  const drawdownBudget = input.maxDrawdownPct > 0 && drawdownPct >= input.maxDrawdownPct ? 0 : balance * (drawdownPct >= input.maxDrawdownPct * .5 ? .01 : .02);
  const maxLoss = Math.floor(Math.min(profitBudget, drawdownBudget) * 100) / 100;
  if (!(maxLoss >= Math.max(.1, input.baseStake * .1))) {
    return { action: 'hold', maxLoss: 0, protectedProfit, drawdownPct, reason: protectedProfit > 0 ? 'profit floor preserved' : 'balance drawdown budget exhausted' };
  }
  if (maxLoss < input.baseStake) return { action: 'reduce', maxLoss, protectedProfit, drawdownPct, reason: 'reduced stake to preserve balance and profit floor' };
  return { action: 'trade', maxLoss, protectedProfit, drawdownPct, reason: protectedProfit > 0 ? 'profit floor active' : 'balance healthy' };
}
