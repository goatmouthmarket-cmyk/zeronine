/**
 * Authoritative net PnL for a settled digit contract, derived locally from
 * what this bot actually paid and what the contract promised to pay back.
 *
 * The API's own `profit` field is unreliable (it can come back as the total
 * payout, null when the contract currency differs, or stale on reconciles),
 * so the UI indicator never trusts it directly.
 */
export function contractProfit(won: boolean, stake: number, payout: number | undefined): number {
  const s = Number(stake);
  if (!Number.isFinite(s) || s <= 0) return 0;
  if (!won) return -s;
  const p = Number(payout);
  if (!Number.isFinite(p) || p <= 0) return 0;
  return p - s;
}