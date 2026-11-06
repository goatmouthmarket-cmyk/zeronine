/**
 * Ranger Brain read model.
 *
 * Builds the panel's Mind / Memory / Time Signals content from persisted
 * virtual paper outcomes. Nothing here is simulated: if there is no settled
 * evidence the report says so, and every lesson carries its own sample count
 * and confidence.
 *
 * The Brain is read-only in this release — it observes, explains and abstains.
 * It cannot place a demo or real order, and it never touches the Ghost Scout's
 * independent paper scanner.
 */

import { listPaperTrades, type PaperTradeSummary } from '../db/store.ts';
import {
  BRAIN_DEFAULT_LOOKBACK_DAYS,
  BRAIN_MIN_BUCKET_OUTCOMES,
  BRAIN_MIN_MARKET_OUTCOMES,
  buildTimingProfile,
  verdictLabel,
  type BrainOutcome,
  type TimingBucket,
  type TimingProfile,
  type TimingVerdict,
} from './timing.ts';

export type BrainMindState = 'offline' | 'observing' | 'paper_hunting' | 'waiting';

export interface BrainLesson {
  id: string;
  topic: string;
  finding: string;
  outcomes: number;
  confidence: number | null;
  validity: 'provisional' | 'validated';
  at: number;
}

export interface RangerBrainReport {
  schemaVersion: 1;
  /** Paper-only by construction. There is no account-mode switch here. */
  mode: 'paper';
  generatedAt: number;
  mind: BrainMindState;
  mindLabel: string;
  headline: string;
  market: string | null;
  lookbackDays: number;
  outcomes: number;
  winRate: number | null;
  breakeven: number | null;
  netPnl: number;
  verdict: TimingVerdict;
  verdictLabel: string;
  bestHour: { key: number; label: string; winRate: number | null; outcomes: number; verdict: TimingVerdict } | null;
  currentHour: { key: number; label: string; verdict: TimingVerdict; outcomes: number; winRate: number | null } | null;
  hours: TimingBucket[];
  weekdays: TimingBucket[];
  lessons: BrainLesson[];
  updatedAt: number;
}

export interface BrainReportOptions {
  now?: number;
  market?: string | null;
  lookbackDays?: number;
  /** Injectable for tests; defaults to the persisted virtual ledger. */
  trades?: PaperTradeSummary[];
}

/** Converts persisted virtual trades into settled-outcome evidence. */
export function paperTradesToOutcomes(trades: PaperTradeSummary[]): BrainOutcome[] {
  const outcomes: BrainOutcome[] = [];
  for (const trade of trades) {
    const status = String(trade.status ?? '').toLowerCase();
    if (status !== 'won' && status !== 'lost') continue;
    const openedAt = Number(trade.opened_at);
    const settledAt = Number(trade.updated_at);
    if (!Number.isFinite(openedAt) || !Number.isFinite(settledAt)) continue;
    const stake = Number(trade.stake);
    // A settled win's net profit implies the payout used for break-even.
    const winProfit = Number(trade.est_win) || (Number(trade.payout) - stake);
    outcomes.push({
      openedAt,
      settledAt,
      market: String(trade.market ?? 'unknown'),
      direction: String(trade.direction ?? ''),
      barrier: Number.isFinite(Number(trade.barrier)) ? Number(trade.barrier) : null,
      won: status === 'won',
      netPnl: Number.isFinite(Number(trade.profit)) ? Number(trade.profit) : 0,
      stake: Number.isFinite(stake) && stake > 0 ? stake : null,
      winProfit: Number.isFinite(winProfit) && winProfit > 0 ? winProfit : null,
    });
  }
  return outcomes;
}

const MIND_LABELS: Record<BrainMindState, string> = {
  offline: 'OFFLINE',
  observing: 'OBSERVING',
  paper_hunting: 'PAPER HUNTING',
  waiting: 'WAIT',
};

function mindFor(profile: TimingProfile): BrainMindState {
  if (!profile.outcomes) return 'offline';
  // A strong hour cannot make the Brain "hunting" before the market-wide
  // evidence bar is met; the policy would still abstain at that point.
  if (profile.outcomes < BRAIN_MIN_MARKET_OUTCOMES) return 'observing';
  if (profile.verdict === 'unfavorable') return 'waiting';
  return profile.bestHour ? 'paper_hunting' : 'observing';
}

/** Deterministic lessons: every sentence restates a measured number. */
export function brainLessons(profile: TimingProfile, now: number): BrainLesson[] {
  const lessons: BrainLesson[] = [];
  const percent = (value: number) => `${(value * 100).toFixed(1)}%`;
  const marketLabel = profile.market ?? 'All markets';

  if (!profile.outcomes) {
    lessons.push({
      id: 'evidence-empty',
      topic: 'Evidence',
      finding: `No settled virtual outcomes in the last ${profile.lookbackDays} days, so ${marketLabel} has no measurable edge yet.`,
      outcomes: 0,
      confidence: null,
      validity: 'provisional',
      at: now,
    });
    return lessons;
  }

  if (profile.breakeven != null && profile.winRate != null) {
    lessons.push({
      id: 'evidence-overall',
      topic: 'Evidence',
      finding: `${profile.outcomes} settled virtual outcomes at ${percent(profile.winRate)} against a ${percent(profile.breakeven)} break-even (95% range ${
        profile.interval ? `${percent(profile.interval.low)}–${percent(profile.interval.high)}` : 'unavailable'
      }).`,
      outcomes: profile.outcomes,
      confidence: profile.interval?.low ?? null,
      validity: profile.verdict === 'favorable' && profile.outcomes >= BRAIN_MIN_MARKET_OUTCOMES ? 'validated' : 'provisional',
      at: profile.updatedAt,
    });
  }

  if (profile.outcomes < BRAIN_MIN_BUCKET_OUTCOMES) {
    lessons.push({
      id: 'evidence-thin',
      topic: 'Evidence',
      finding: `${BRAIN_MIN_BUCKET_OUTCOMES - profile.outcomes} more settled outcomes are needed before any hour can be called favorable.`,
      outcomes: profile.outcomes,
      confidence: null,
      validity: 'provisional',
      at: profile.updatedAt,
    });
  }

  const best = profile.bestHour;
  if (best) {
    lessons.push({
      id: `hour-favorable-${best.key}`,
      topic: 'Time of day',
      finding: `${marketLabel} around ${best.label} settled ${best.wins} of ${best.outcomes} (${percent(best.winRate ?? 0)}), clearing break-even on its lower bound.`,
      outcomes: best.outcomes,
      confidence: best.interval?.low ?? null,
      validity: profile.outcomes >= BRAIN_MIN_MARKET_OUTCOMES ? 'validated' : 'provisional',
      at: profile.updatedAt,
    });
  } else {
    const closest = profile.hours
      .filter((bucket) => bucket.outcomes >= BRAIN_MIN_BUCKET_OUTCOMES)
      .sort((a, b) => (b.shrunkWinRate ?? 0) - (a.shrunkWinRate ?? 0))[0];
    if (closest) {
      lessons.push({
        id: `hour-no-winner-${closest.key}`,
        topic: 'Time of day',
        finding: `Best-sampled hour is ${closest.label} with ${percent(closest.winRate ?? 0)} over ${closest.outcomes} outcomes, but it does not separate from break-even. No hour is favorable.`,
        outcomes: closest.outcomes,
        confidence: closest.interval?.low ?? null,
        validity: 'provisional',
        at: profile.updatedAt,
      });
    }
  }

  const badDays = profile.weekdays.filter((bucket) => bucket.verdict === 'unfavorable');
  if (badDays.length) {
    lessons.push({
      id: 'weekday-unfavorable',
      topic: 'Time of day',
      finding: `${badDays.map((bucket) => bucket.label).join(', ')} sit measurably below break-even for ${marketLabel}.`,
      outcomes: badDays.reduce((sum, bucket) => sum + bucket.outcomes, 0),
      confidence: badDays[0]?.interval?.high ?? null,
      validity: 'provisional',
      at: profile.updatedAt,
    });
  }

  return lessons;
}

/**
 * Picks the market with the most settled outcomes in the lookback window.
 *
 * A pooled "all markets" verdict would blend incompatible instruments, so the
 * default report always describes one real market instead of an average.
 */
export function dominantMarket(outcomes: BrainOutcome[], now: number, lookbackDays: number): string | null {
  const since = now - lookbackDays * 24 * 60 * 60 * 1000;
  const counts = new Map<string, number>();
  for (const outcome of outcomes) {
    if (outcome.settledAt > now || outcome.settledAt < since) continue;
    counts.set(outcome.market, (counts.get(outcome.market) ?? 0) + 1);
  }
  let best: string | null = null;
  let bestCount = 0;
  for (const [market, count] of counts) {
    // Ties keep the first market seen so the panel does not flicker between
    // equally sampled markets on every request.
    if (count > bestCount) {
      best = market;
      bestCount = count;
    }
  }
  return best;
}

export function buildBrainReport(options: BrainReportOptions = {}): RangerBrainReport {
  const now = options.now ?? Date.now();
  const trades = options.trades ?? safePaperTrades();
  const outcomes = paperTradesToOutcomes(trades);
  const lookbackDays = options.lookbackDays ?? BRAIN_DEFAULT_LOOKBACK_DAYS;
  const market = options.market ?? dominantMarket(outcomes, now, lookbackDays);
  const profile = buildTimingProfile(outcomes, { now, market, lookbackDays });
  const hourKey = new Date(now).getUTCHours();
  const currentBucket = profile.hours[hourKey] ?? null;
  const mind = mindFor(profile);
  const best = profile.bestHour;

  return {
    schemaVersion: 1,
    mode: 'paper',
    generatedAt: now,
    mind,
    mindLabel: MIND_LABELS[mind],
    headline: headlineFor(profile, mind),
    market: profile.market,
    lookbackDays: profile.lookbackDays,
    outcomes: profile.outcomes,
    winRate: profile.winRate,
    breakeven: profile.breakeven,
    netPnl: profile.netPnl,
    verdict: profile.verdict,
    verdictLabel: verdictLabel(profile.verdict),
    bestHour: best ? { key: best.key, label: best.label, winRate: best.winRate, outcomes: best.outcomes, verdict: best.verdict } : null,
    currentHour: currentBucket
      ? { key: currentBucket.key, label: currentBucket.label, verdict: currentBucket.verdict, outcomes: currentBucket.outcomes, winRate: currentBucket.winRate }
      : null,
    hours: profile.hours,
    weekdays: profile.weekdays,
    lessons: brainLessons(profile, now),
    updatedAt: profile.updatedAt,
  };
}

function headlineFor(profile: TimingProfile, mind: BrainMindState): string {
  const percent = (value: number) => `${(value * 100).toFixed(1)}%`;
  switch (mind) {
    case 'offline':
      return 'No settled virtual outcomes yet. The Brain is not claiming an edge.';
    case 'observing':
      return profile.bestHour
        ? `${profile.outcomes} of ${BRAIN_MIN_MARKET_OUTCOMES} settled outcomes. ${profile.bestHour.label} leads so far but is not validated yet.`
        : `${profile.outcomes} of ${BRAIN_MIN_MARKET_OUTCOMES} settled outcomes. Collecting evidence before any shot.`;
    case 'waiting':
      return `This market's overall record is ${percent(profile.winRate ?? 0)} against ${percent(profile.breakeven ?? 0)} break-even. Waiting.`;
    default:
      return profile.bestHour
        ? `${profile.bestHour.label} clears break-even on ${profile.bestHour.outcomes} settled outcomes. Paper shots allowed.`
        : 'Evidence is not yet strong enough for a paper shot.';
  }
}

function safePaperTrades(): PaperTradeSummary[] {
  try {
    return listPaperTrades(500);
  } catch {
    return [];
  }
}
