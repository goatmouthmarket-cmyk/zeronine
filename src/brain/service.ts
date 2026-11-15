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
  normalizeBrainTimeZone,
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
  dataSource: 'shared_site_paper';
  timeZone: string;
  generatedAt: number;
  mind: BrainMindState;
  mindLabel: string;
  headline: string;
  market: string | null;
  marketSymbol: string | null;
  lookbackDays: number;
  outcomes: number;
  /** Mirrors BRAIN_MIN_MARKET_OUTCOMES so the pasture can draw the same bar. */
  evidenceTarget: number;
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
  marketName?: string | null;
  timeZone?: string;
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
  offline: 'NO PRACTICE RESULTS',
  observing: 'STILL LEARNING',
  paper_hunting: 'TIME TO WATCH',
  waiting: 'NO CLEAR EDGE',
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
export function brainLessons(profile: TimingProfile, now: number, displayMarket = friendlyBrainMarketName(profile.market)): BrainLesson[] {
  const lessons: BrainLesson[] = [];
  const percent = (value: number) => `${(value * 100).toFixed(1)}%`;
  const marketLabel = displayMarket ?? 'All markets';

  if (!profile.outcomes) {
    lessons.push({
      id: 'evidence-empty',
      topic: 'Evidence',
      finding: `I have no finished site practice results for ${marketLabel} from the last ${profile.lookbackDays} days, so I cannot point to a useful time yet.`,
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
      finding: `Across ${profile.outcomes} site practice results for ${marketLabel}, ${percent(profile.winRate)} were wins. The estimated break-even mark is ${percent(profile.breakeven)}.`,
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
      finding: `${BRAIN_MIN_BUCKET_OUTCOMES - profile.outcomes} more settled site practice results are needed before I can judge an hour for ${marketLabel}.`,
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
      finding: `In site practice for ${marketLabel}, around ${best.label} your local time had ${best.wins} wins from ${best.outcomes} settled results (${percent(best.winRate ?? 0)}). It is a time to watch for a fresh setup, not a promise.`,
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
        finding: `Around ${closest.label} has the largest practice sample (${closest.outcomes} results), but it has not shown a dependable advantage over break-even. I cannot call it a best time.`,
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
      finding: `Site practice results for ${marketLabel} have been weaker on ${badDays.map((bucket) => bucket.label).join(', ')}. This is historical evidence, not a prediction.`,
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
  const timeZone = normalizeBrainTimeZone(options.timeZone);
  const market = options.market ?? dominantMarket(outcomes, now, lookbackDays);
  const profile = buildTimingProfile(outcomes, { now, market, lookbackDays, timeZone });
  const displayMarket = profile.market ? (options.marketName || friendlyBrainMarketName(profile.market)) : null;
  const hourValue = new Intl.DateTimeFormat('en-US', { timeZone, hour: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(now)).find((part) => part.type === 'hour')?.value;
  const hourKey = Number(hourValue) % 24;
  const currentBucket = profile.hours[hourKey] ?? null;
  const mind = mindFor(profile);
  const best = profile.bestHour;

  return {
    schemaVersion: 1,
    mode: 'paper',
    dataSource: 'shared_site_paper',
    timeZone,
    generatedAt: now,
    mind,
    mindLabel: MIND_LABELS[mind],
    headline: headlineFor(profile, mind, displayMarket),
    market: displayMarket,
    marketSymbol: profile.market,
    lookbackDays: profile.lookbackDays,
    outcomes: profile.outcomes,
    evidenceTarget: BRAIN_MIN_MARKET_OUTCOMES,
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
    lessons: brainLessons(profile, now, displayMarket || 'All markets'),
    updatedAt: profile.updatedAt,
  };
}

function headlineFor(profile: TimingProfile, mind: BrainMindState, displayMarket: string | null): string {
  const market = displayMarket ?? 'this market';
  const percent = (value: number) => `${(value * 100).toFixed(1)}%`;
  switch (mind) {
    case 'offline':
      return 'No finished site practice results yet. I need evidence before I can suggest a time to watch.';
    case 'observing':
      return profile.bestHour
        ? `I am still learning from ${profile.outcomes} site practice results. Around ${profile.bestHour.label} looks promising for ${market}, but there is not enough evidence to call it a reliable window.`
        : `I have ${profile.outcomes} of ${BRAIN_MIN_MARKET_OUTCOMES} site practice results for ${market}. I am still learning and cannot name a best time yet.`;
    case 'waiting':
      return `Site practice results for ${market} are below the estimated break-even point: ${percent(profile.winRate ?? 0)} wins, compared with ${percent(profile.breakeven ?? 0)} needed to cover the stakes. I do not see a reliable time to recommend; wait for a fresh setup.`;
    default:
      return profile.bestHour
        ? `The strongest-supported practice window for ${market} is around ${profile.bestHour.label} in your local time. It is a time to watch for a fresh setup, not a promise or live signal.`
        : 'I do not have enough evidence to point to a useful practice window yet.';
  }
}

/** Turns common Deriv market symbols into names people recognize. */
export function friendlyBrainMarketName(symbol: string | null | undefined): string {
  if (!symbol) return 'this market';
  const value = symbol.trim();
  const volatility = /^R_(\d+)$/.exec(value);
  if (volatility) return `Volatility ${volatility[1]} Index`;
  const oneSecondVolatility = /^1HZ(\d+)V$/.exec(value);
  if (oneSecondVolatility) return `Volatility ${oneSecondVolatility[1]} (1s) Index`;
  const boom = /^BOOM(\d+)$/.exec(value);
  if (boom) return `Boom ${boom[1]} Index`;
  const crash = /^CRASH(\d+)$/.exec(value);
  if (crash) return `Crash ${crash[1]} Index`;
  const jump = /^JD(\d+)$/.exec(value);
  if (jump) return `Jump ${jump[1]} Index`;
  if (value === 'RDBEAR') return 'Bear Market Index';
  if (value === 'RDBULL') return 'Bull Market Index';
  const step = /^stpRNG(\d*)$/i.exec(value);
  if (step) return step[1] ? `Step ${step[1]} Index` : 'Step Index';
  const currencies = /^(?:frx|OTC_)([A-Z]{6})$/.exec(value);
  if (currencies) return `${currencies[1].slice(0, 3)}/${currencies[1].slice(3)} Forex`;
  if (value.startsWith('cry')) return `${value.slice(3).replace(/([A-Z]{3})([A-Z]{3})$/, '$1/$2')} Crypto`;
  return value.replace(/^([A-Z]+)_/, '$1 ').replaceAll('_', ' ').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/(\d)([A-Z])/g, '$1 $2').trim() || 'Market';
}
function safePaperTrades(): PaperTradeSummary[] {
  try {
    return listPaperTrades(500);
  } catch {
    return [];
  }
}
