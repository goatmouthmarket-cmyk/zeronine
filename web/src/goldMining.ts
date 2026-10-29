export interface GoldMiningState {
  research: { ready: boolean; state: {
    symbol: { tradingStatus: string } | null;
    quote: { timestamp: number } | null;
    signal: { actionable: boolean; direction: string; expiresAt: number } | null;
  } };
}

/** Advisory display only; the server still enforces all execution checks. */
export function goldMiningDirection(state: GoldMiningState | null, now: number): 'BUY' | 'SELL' | null {
  const research = state?.research.state;
  const signal = research?.signal;
  const quote = research?.quote;
  if (!state?.research.ready || research?.symbol?.tradingStatus !== 'open' || !quote || !Number.isFinite(quote.timestamp)
    || now - quote.timestamp > 10_000 || quote.timestamp > now + 10_000
    || !signal?.actionable || signal.expiresAt <= now) return null;
  return signal.direction === 'BUY' || signal.direction === 'SELL' ? signal.direction : null;
}
