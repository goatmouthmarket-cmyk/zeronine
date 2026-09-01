export interface GoldProfitProtection {
  activation: number;
  peak: number;
  armed: boolean;
  floor: number;
  shouldClose: boolean;
}

export function assessGoldProfitProtection(input: {
  stake: number;
  balance: number;
  previousPeak: number;
  profit: number;
}): GoldProfitProtection {
  const stake = Math.max(0, Number(input.stake) || 0);
  const balance = Math.max(0, Number(input.balance) || 0);
  const profit = Number.isFinite(input.profit) ? input.profit : 0;
  const peak = Math.max(0, Number(input.previousPeak) || 0, profit);
  const activation = Math.max(stake * .5, balance * .001);
  const armed = peak >= activation;
  const giveback = Math.max(stake * .1, peak * .1);
  const floor = armed ? Math.max(0, peak - giveback) : 0;
  return { activation, peak, armed, floor, shouldClose: armed && profit <= floor };
}
