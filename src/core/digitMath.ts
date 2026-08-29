export type Direction = 'over' | 'under';
export type MultiplierDirection = 'up' | 'down';

export const CONTRACT_TYPE: Record<Direction, 'DIGITOVER' | 'DIGITUNDER'> = {
  over: 'DIGITOVER',
  under: 'DIGITUNDER',
};

export const DIRECTION_LABEL: Record<Direction, 'Over' | 'Under'> = {
  over: 'Over',
  under: 'Under',
};

export interface TickPayload {
  symbol: string;
  quote: number;
  epoch: number;
}

export function ticksHistory(symbol: string, count: number, reqId: number): Record<string, unknown> {
  return { ticks_history: symbol, style: 'ticks', count, end: 'latest', req_id: reqId };
}

export function subscribeTicks(symbol: string, reqId: number): Record<string, unknown> {
  return { ticks: symbol, subscribe: 1, req_id: reqId };
}

export function authorize(token: string, reqId = 1): Record<string, unknown> {
  return { authorize: token, req_id: reqId };
}

export function balanceSubscribe(reqId: number): Record<string, unknown> {
  return { balance: 1, subscribe: 1, req_id: reqId };
}

export function contractsFor(symbol: string, reqId: number): Record<string, unknown> {
  return { contracts_for: symbol, req_id: reqId };
}

export function activeSymbols(reqId: number): Record<string, unknown> {
  return { active_symbols: 'brief', product_type: 'basic', req_id: reqId };
}

export interface ProposalArgs {
  direction: Direction;
  barrier: number;
  amount: number;
  currency: string;
  duration: number;
  durationUnit: 't' | 'm' | 's';
  symbol: string;
  reqId: number;
  /** Defaults to stake for all existing trading callers. */
  basis?: 'stake' | 'payout';
}

/**
 * Multiplier contracts have a different proposal shape from digit contracts:
 * there is no barrier and the requested multiplier is part of the contract.
 * Keep this separate so digit callers cannot accidentally create a multiplier
 * proposal by changing only a direction label.
 */
export interface MultiplierProposalArgs {
  direction: MultiplierDirection;
  amount: number;
  currency: string;
  symbol: string;
  multiplier: number;
  reqId: number;
  basis?: 'stake' | 'payout';
}

export function proposal(args: ProposalArgs): Record<string, unknown> {
  return {
    proposal: 1,
    req_id: args.reqId,
    amount: Math.round(args.amount * 100) / 100,
    basis: args.basis ?? 'stake',
    contract_type: CONTRACT_TYPE[args.direction],
    currency: args.currency,
    duration: args.duration,
    duration_unit: args.durationUnit,
    underlying_symbol: args.symbol,
    barrier: String(args.barrier),
  };
}

export function multiplierProposal(args: MultiplierProposalArgs): Record<string, unknown> {
  return {
    proposal: 1,
    req_id: args.reqId,
    amount: Math.round(args.amount * 100) / 100,
    basis: args.basis ?? 'stake',
    contract_type: args.direction === 'up' ? 'MULTUP' : 'MULTDOWN',
    currency: args.currency,
    underlying_symbol: args.symbol,
    multiplier: args.multiplier,
  };
}

export function buy(proposalId: string | number, price: number, reqId: number): Record<string, unknown> {
  return { buy: proposalId, price, req_id: reqId };
}

export function proposalOpenContract(contractId: string | number, reqId: number, subscribe = true): Record<string, unknown> {
  const msg: Record<string, unknown> = {
    proposal_open_contract: 1,
    contract_id: Number(contractId),
    req_id: reqId,
  };
  if (subscribe) msg.subscribe = 1;
  return msg;
}

export function profitTable(reqId: number, limit = 25): Record<string, unknown> {
  return { profit_table: 1, description: 1, limit, req_id: reqId };
}

export function ping(): Record<string, unknown> {
  return { ping: 1 };
}

const precisionRegistry = new Map<string, number>();

export function setPrecision(symbol: string, decimals: number): void {
  precisionRegistry.set(symbol, decimals);
}

export function getPrecision(symbol: string): number | undefined {
  return precisionRegistry.get(symbol);
}

export function lastDigitOf(quote: number, decimals?: number): number {
  const v = Math.abs(quote);
  if (typeof decimals === 'number' && Number.isInteger(decimals) && decimals > 0) {
    const tail = v.toFixed(decimals).split('.')[1];
    return tail ? Number(tail[tail.length - 1]) : 0;
  }
  const s = v.toString();
  const tail = s.split('.')[1] ?? s;
  return tail.length === 0 ? 0 : Number(tail[tail.length - 1]);
}

export function winDigits(direction: Direction, barrier: number): number[] {
  const digits: number[] = [];
  for (let d = 0; d <= 9; d++) {
    if (direction === 'over' && d > barrier) digits.push(d);
    if (direction === 'under' && d < barrier) digits.push(d);
  }
  return digits;
}

export function estimateWinRate(dist: number[], direction: Direction, barrier: number): number {
  const wins = winDigits(direction, barrier);
  let p = 0;
  for (const d of wins) p += dist[d] ?? 0;
  return p;
}

export function estimatePayoutRatio(direction: Direction, barrier: number): number {
  // Theoretical win fraction for a uniform digit; margins applied by real quotes.
  const frac = winDigits(direction, barrier).length / 10;
  if (frac <= 0) return 10;
  return (1 / frac) * 0.95;
}

export function expectedProfit(winProb: number, stake: number, payout: number): number {
  return winProb * (payout - stake) - (1 - winProb) * stake;
}

export function breakevenWinRate(stake: number, payout: number): number {
  return stake / payout;
}
