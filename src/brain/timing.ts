/**
 * Ranger Brain timing evidence.
 *
 * Turns settled *virtual* paper outcomes into per-hour-of-day and
 * per-weekday performance estimates. This module is deliberately pure: it never
 * reads a clock, a socket or a database, and it never looks at an outcome that
 * was not already settled at `now`. That makes the no-look-ahead property
 * testable rather than a promise.
 *
 * Rules that keep the numbers honest:
 *  - A bucket below `BRAIN_MIN_BUCKET_OUTCOMES` settled outcomes is
 *    `insufficient`, never `favorable`.
 *  - Rates are shrunk toward the market's own overall rate, so a hot 3-of-3
 *    hour cannot outrank a well-sampled one.
 *  - `favorable` requires the Wilson lower bound (not the raw rate) to clear
 *    break-even by the configured margin; `unfavorable` requires the upper
 *    bound to sit below break-even by the same margin. Everything else is
 *    `mixed`.
 */

/** Settled outcomes required before a bucket may make any claim at all. */
export const BRAIN_MIN_BUCKET_OUTCOMES = 30;
/** Market-wide settled outcomes required before a finding is called validated. */
export const BRAIN_MIN_MARKET_OUTCOMES = 100;
/** Win-rate margin a bucket must clear beyond break-even, in probability. */
export const BRAIN_MIN_EDGE_MARGIN = 0.02;
/** Prior strength (in pseudo-outcomes) for empirical-Bayes shrinkage. */
export const BRAIN_SHRINKAGE_PRIOR_OUTCOMES = 25;
/** Default evidence window for timing analysis. */
export const BRAIN_DEFAULT_LOOKBACK_DAYS = 30;
/** Two-sided 95% normal quantile. */
export const BRAIN_Z = 1.96;

export type TimingVerdict = 'favorable' | 'mixed' | 'unfavorable' | 'insufficient';

/** The subset of a settled paper outcome the Brain needs. */
export interface BrainOutcome {
  /** UTC epoch ms when the virtual contract was opened (decision clock). */
  openedAt: number;
  /** UTC epoch ms when the outcome became known. */
  settledAt: number;
  market: string;
  direction: string;
  barrier: number | null;
  won: boolean;
  /** Net virtual profit for the outcome (0 for a push/void). */
  netPnl: number;
  /** Virtual stake, used to derive break-even when profit is unavailable. */
  stake?: number | null;
  /** Net profit the contract paid when it won, used for break-even. */
  winProfit?: number | null;
}

export interface TimingBucket {
  /** UTC hour 0-23, or weekday 0-6 (Sunday = 0). */
  key: number;
  label: string;
  outcomes: number;
  wins: number;
  losses: number;
  /** Raw settled win rate; null when the bucket is empty. */
  winRate: number | null;
  /** Empirically shrunk win rate used for ranking and verdicts. */
  shrunkWinRate: number | null;
  /** Wilson 95% interval for the raw win rate. */
  interval: { low: number; high: number } | null;
  netPnl: number;
  verdict: TimingVerdict;
  verdictReason: string;
}

export interface TimingProfile {
  market: string | null;
  lookbackDays: number;
  updatedAt: number;
  outcomes: number;
  wins: number;
  winRate: number | null;
  shrunkWinRate: number | null;
  interval: { low: number; high: number } | null;
  /** Break-even win rate implied by the settled payouts, or null without data. */
  breakeven: number | null;
  netPnl: number;
  verdict: TimingVerdict;
  hours: TimingBucket[];
  weekdays: TimingBucket[];
  /** Best hour that actually clears the evidence bar, if any. */
  bestHour: TimingBucket | null;
}

/** Standard Wilson score interval for a binomial proportion. */
export function wilsonInterval(wins: number, total: number, z = BRAIN_Z): { low: number; high: number } | null {
  if (!Number.isFinite(total) || total <= 0) return null;
  const safeWins = Math.max(0, Math.min(wins, total));
  const p = safeWins / total;
  const z2 = z * z;
  const denominator = 1 + z2 / total;
  const center = (p + z2 / (2 * total)) / denominator;
  const spread = (z * Math.sqrt((p * (1 - p)) / total + z2 / (4 * total * total))) / denominator;
  return { low: Math.max(0, center - spread), high: Math.min(1, center + spread) };
}

/**
 * Empirical-Bayes rate: the bucket's own record blended with the market-wide
 * rate. A tiny bucket is pulled almost all the way to the prior; a large one
 * keeps its own signal.
 */
export function shrunkWinRate(
  wins: number,
  total: number,
  priorRate: number | null,
  priorOutcomes = BRAIN_SHRINKAGE_PRIOR_OUTCOMES,
): number | null {
  if (!Number.isFinite(total) || total <= 0) return priorRate ?? null;
  if (priorRate == null || !Number.isFinite(priorRate)) return wins / total;
  const weight = Math.max(0, priorOutcomes);
  return (wins + weight * priorRate) / (total + weight);
}

/**
 * Break-even win rate for a fixed-odds virtual contract: stake / (stake + win
 * profit). Returns the median across outcomes so one odd payout cannot move the
 * bar for the whole bucket.
 */
export function impliedBreakeven(profits: Array<{ stake: number; winProfit: number }>): number | null {
  const rates = profits
    .filter((entry) => Number.isFinite(entry.stake) && entry.stake > 0 && Number.isFinite(entry.winProfit) && entry.winProfit > 0)
    .map((entry) => entry.stake / (entry.stake + entry.winProfit))
    .filter((rate) => rate > 0 && rate < 1)
    .sort((a, b) => a - b);
  if (!rates.length) return null;
  const middle = Math.floor(rates.length / 2);
  return rates.length % 2 ? rates[middle]! : (rates[middle - 1]! + rates[middle]!) / 2;
}

export function classifyBucket(
  outcomes: number,
  rawRate: number | null,
  interval: { low: number; high: number } | null,
  breakeven: number | null,
  margin = BRAIN_MIN_EDGE_MARGIN,
): { verdict: TimingVerdict; reason: string } {
  if (outcomes < BRAIN_MIN_BUCKET_OUTCOMES) {
    return {
      verdict: 'insufficient',
      reason: `${outcomes} of ${BRAIN_MIN_BUCKET_OUTCOMES} settled outcomes`,
    };
  }
  if (breakeven == null || rawRate == null || interval == null) {
    return { verdict: 'insufficient', reason: 'no settled payout to compare against' };
  }
  const percent = (value: number) => `${(value * 100).toFixed(1)}%`;
  if (interval.low >= breakeven + margin) {
    return {
      verdict: 'favorable',
      reason: `95% lower bound ${percent(interval.low)} clears break-even ${percent(breakeven)}`,
    };
  }
  if (interval.high <= breakeven - margin) {
    return {
      verdict: 'unfavorable',
      reason: `95% upper bound ${percent(interval.high)} sits below break-even ${percent(breakeven)}`,
    };
  }
  return {
    verdict: 'mixed',
    reason: `${percent(rawRate)} overlaps break-even ${percent(breakeven)}`,
  };
}

const UTC_HOUR_LABEL = (hour: number) => `${String(hour).padStart(2, '0')}:00 UTC`;
const WEEKDAY_LABELS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function buildBuckets(
  outcomes: BrainOutcome[],
  keys: number,
  keyOf: (outcome: BrainOutcome) => number,
  labelOf: (key: number) => string,
  priorRate: number | null,
  breakeven: number | null,
): TimingBucket[] {
  const buckets: TimingBucket[] = [];
  for (let key = 0; key < keys; key += 1) {
    const rows = outcomes.filter((outcome) => keyOf(outcome) === key);
    const wins = rows.filter((row) => row.won).length;
    const total = rows.length;
    const rawRate = total ? wins / total : null;
    const interval = wilsonInterval(wins, total);
    const shrunk = shrunkWinRate(wins, total, priorRate);
    const { verdict, reason } = classifyBucket(total, rawRate, interval, breakeven);
    buckets.push({
      key,
      label: labelOf(key),
      outcomes: total,
      wins,
      losses: total - wins,
      winRate: rawRate,
      shrunkWinRate: shrunk,
      interval,
      netPnl: rows.reduce((sum, row) => sum + (Number.isFinite(row.netPnl) ? row.netPnl : 0), 0),
      verdict,
      verdictReason: reason,
    });
  }
  return buckets;
}

/**
 * Builds the timing profile from settled outcomes only.
 *
 * @param outcomes settled virtual outcomes (unsettled rows are ignored)
 * @param options  `now` is the decision instant; anything settled after it is
 *                 excluded, so evaluating "now" can never see the future.
 */
export function buildTimingProfile(
  outcomes: BrainOutcome[],
  options: {
    now: number;
    market?: string | null;
    lookbackDays?: number;
    minEdgeMargin?: number;
    breakevenOverride?: number | null;
  },
): TimingProfile {
  const now = options.now;
  const lookbackDays = Math.max(1, Math.min(365, Math.round(options.lookbackDays ?? BRAIN_DEFAULT_LOOKBACK_DAYS)));
  const since = now - lookbackDays * 24 * 60 * 60 * 1000;
  const market = options.market ?? null;
  const settled = outcomes.filter((outcome) =>
    Number.isFinite(outcome.openedAt) && Number.isFinite(outcome.settledAt)
    && outcome.settledAt <= now && outcome.settledAt >= since
    && (market == null || outcome.market === market));

  const wins = settled.filter((row) => row.won).length;
  const total = settled.length;
  const rawRate = total ? wins / total : null;
  const breakeven = options.breakevenOverride ?? impliedBreakevenOutcomes(settled);
  const margin = options.minEdgeMargin ?? BRAIN_MIN_EDGE_MARGIN;
  const interval = wilsonInterval(wins, total);
  const overall = classifyBucket(total, rawRate, interval, breakeven, margin);
  const hours = buildBuckets(settled, 24, (row) => new Date(row.openedAt).getUTCHours(), UTC_HOUR_LABEL, rawRate, breakeven);
  const weekdays = buildBuckets(settled, 7, (row) => new Date(row.openedAt).getUTCDay(), (key) => WEEKDAY_LABELS[key]!, rawRate, breakeven);
  const bestHour = hours
    .filter((bucket) => bucket.verdict === 'favorable')
    .sort((a, b) => (b.shrunkWinRate ?? 0) - (a.shrunkWinRate ?? 0) || b.outcomes - a.outcomes)[0] ?? null;

  return {
    market,
    lookbackDays,
    updatedAt: total ? Math.max(...settled.map((row) => row.settledAt)) : now,
    outcomes: total,
    wins,
    winRate: rawRate,
    shrunkWinRate: shrunkWinRate(wins, total, rawRate),
    interval,
    breakeven,
    netPnl: settled.reduce((sum, row) => sum + (Number.isFinite(row.netPnl) ? row.netPnl : 0), 0),
    verdict: overall.verdict,
    hours,
    weekdays,
    bestHour,
  };
}

function impliedBreakevenOutcomes(outcomes: BrainOutcome[]): number | null {
  const pairs: Array<{ stake: number; winProfit: number }> = [];
  for (const outcome of outcomes) {
    const stake = Number(outcome.stake);
    if (!Number.isFinite(stake) || stake <= 0) continue;
    // Prefer the recorded payout; a settled win's net profit is the fallback.
    const declared = Number(outcome.winProfit);
    const winProfit = Number.isFinite(declared) && declared > 0
      ? declared
      : Number.isFinite(outcome.netPnl) && outcome.netPnl > 0
        ? outcome.netPnl
        // No winning row yet: use the standard digit over/under payout so the
        // break-even bar is still explicit rather than invisible.
        : stake * 0.95;
    pairs.push({ stake, winProfit });
  }
  return impliedBreakeven(pairs);
}

/** Formats a verdict for the pasture panel without overstating it. */
export function verdictLabel(verdict: TimingVerdict): string {
  switch (verdict) {
    case 'favorable': return 'Favorable';
    case 'unfavorable': return 'Unfavorable';
    case 'mixed': return 'Mixed';
    default: return 'Insufficient data';
  }
}
