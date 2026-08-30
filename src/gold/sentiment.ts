/**
 * Provider-neutral Gold news/social sentiment vocabulary and scoring. It is
 * deliberately lexical and deterministic: no NLP service, no API key, no
 * nondeterministic model calls. Every score can be traced back to the exact
 * phrases that produced it, which keeps research evidence auditable.
 *
 * The sentiment worker fetches headlines/posts from proper sources and turns
 * them into `GoldSentimentItem`s; this module only scores and aggregates them.
 */

export type GoldSentimentKind = 'news' | 'social';

export interface GoldSentimentItem {
  /** Stable dedupe key derived from source + normalized title. */
  id: string;
  kind: GoldSentimentKind;
  /** Source label, e.g. `google-news`, `fxstreet`, `stocktwits`, `reddit`. */
  source: string;
  title: string;
  url: string | null;
  /** Publisher timestamp in milliseconds since epoch. */
  publishedAt: number;
  /** Keyword score in [-1, 1]; positive is bullish for Gold. */
  score: number;
  /** Matched phrases that drove the score, e.g. `rate cut`. */
  drivers: string[];
  fetchedAt: number;
}

export interface GoldSentimentSourceStatus {
  kind: GoldSentimentKind;
  source: string;
  ok: boolean;
  items: number;
  lastFetchAt: number;
  error: string | null;
}

export interface GoldSentimentSnapshot {
  /** Recency-weighted news aggregate in [-1, 1]. */
  newsScore: number;
  /** Recency-weighted social aggregate in [-1, 1]. */
  socialScore: number;
  /** Blended crowd score in [-1, 1]; news weighted above social. */
  combinedScore: number;
  newsCount: number;
  socialCount: number;
  /** Age of the newest item per kind, in milliseconds. */
  newsFreshnessMs: number;
  socialFreshnessMs: number;
  /** Most repeated phrases across the current window. */
  drivers: string[];
  /** Strongest recent items, strongest first, capped for evidence display. */
  topItems: GoldSentimentItem[];
  sources: GoldSentimentSourceStatus[];
  generatedAt: number;
}

export interface GoldSentimentScoreOptions {
  now?: number;
  /** Recency half-life per kind. Defaults: news 4h, social 2h. */
  newsHalfLifeMs?: number;
  socialHalfLifeMs?: number;
  /** Items older than this are dropped from aggregation. Default 48h. */
  windowMs?: number;
  /** Blend weight of news inside combinedScore. Default 0.65. */
  newsBlend?: number;
  maxTopItems?: number;
}

// Phrases are matched case-insensitively as substrings. Bullish phrases push
// Gold up (safe-haven demand, easing, crisis); bearish phrases push it down
// (hawkish policy, strong dollar, risk appetite). Multi-word phrases keep the
// lexicon unambiguous compared with single tokens like "cut" or "falls".
const BULLISH_PHRASES: readonly string[] = [
  'rate cut', 'rate cuts', 'cut interest rates', 'cuts interest rates', 'dovish', 'easing cycle',
  'stimulus', 'quantitative easing', 'inflation surges', 'inflation rises', 'rising inflation',
  'higher inflation', 'hotter-than-expected inflation', 'safe haven', 'safe-haven demand',
  'geopolitical tension', 'geopolitical tensions', 'escalation', 'escalates', 'military strike',
  'conflict intensifies', 'war fears', 'recession fears', 'recession warning', 'economic slowdown',
  'growth fears', 'stock market selloff', 'stocks slide', 'equities fall', 'risk-off',
  'de-dollarization', 'de dollarization', 'central bank buying', 'central banks buying',
  'central-bank demand', 'record gold buying', 'gold buying spree', 'buying opportunity',
  'gold rallies', 'gold surges', 'gold climbs', 'gold jumps', 'gold rises', 'gold gains',
  'gold shines', 'bullish gold', 'gold bullish', 'all-time high', 'record high', 'breaks above',
  'supply deficit', 'mine output falls', 'mining disruption', 'strong demand for gold',
  'etf inflows', 'etf buying', 'gold etf inflow', 'hedging demand',
];

const BEARISH_PHRASES: readonly string[] = [
  'rate hike', 'rate hikes', 'raise interest rates', 'raises interest rates', 'hawkish', 'tightening',
  'tapering', 'taper', 'strong dollar', 'dollar strengthens', 'dollar rises',
  'dollar rallies', 'dollar firm', 'yields rise', 'rising yields', 'higher yields', 'real yields climb',
  'risk appetite', 'risk-on', 'stocks rally', 'equities rally', 'stock market rally',
  'gold falls', 'gold drops', 'gold declines', 'gold slides', 'gold plunges', 'gold sinks',
  'gold eases', 'gold settles lower', 'gold weakens', 'bearish gold', 'gold bearish',
  'profit-taking', 'profit taking', 'overbought', 'correction looms', 'resistance level',
  'fed officials say', 'hot inflation data', 'hotter inflation', 'sticky inflation',
  'chances of a hike', 'rate increase', 'rate increases', 'fewer rate cuts', 'no rate cuts',
  'rate-cut bets fade', 'gold selling', 'etf outflows', 'gold etf outflow',
];

function clampScore(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(-1, Math.min(1, value));
}

/** Scores one headline or post body. Pure, deterministic, explainable. */
export function scoreSentimentText(text: string): { score: number; drivers: string[] } {
  const haystack = ` ${text.toLowerCase().replace(/\s+/g, ' ')} `;
  const bullish: string[] = [];
  const bearish: string[] = [];
  for (const phrase of BULLISH_PHRASES) {
    if (haystack.includes(phrase)) bullish.push(phrase);
  }
  for (const phrase of BEARISH_PHRASES) {
    if (haystack.includes(phrase)) bearish.push(phrase);
  }
  const total = bullish.length + bearish.length;
  if (total === 0) return { score: 0, drivers: [] };
  return {
    score: clampScore((bullish.length - bearish.length) / total),
    drivers: [...bullish, ...bearish],
  };
}

function decayWeight(ageMs: number, halfLifeMs: number): number {
  if (ageMs <= 0) return 1;
  return 2 ** (-ageMs / Math.max(1, halfLifeMs));
}

function aggregate(items: GoldSentimentItem[], halfLifeMs: number, now: number): { score: number; count: number; freshnessMs: number } {
  if (items.length === 0) return { score: 0, count: 0, freshnessMs: Number.POSITIVE_INFINITY };
  let weighted = 0;
  let weight = 0;
  let newest = 0;
  for (const item of items) {
    const age = Math.max(0, now - item.publishedAt);
    const w = decayWeight(age, halfLifeMs);
    weighted += item.score * w;
    weight += w;
    newest = Math.max(newest, item.publishedAt);
  }
  return {
    score: weight > 0 ? clampScore(weighted / weight) : 0,
    count: items.length,
    freshnessMs: Math.max(0, now - newest),
  };
}

function topDrivers(items: GoldSentimentItem[], limit: number): string[] {
  const counts = new Map<string, number>();
  for (const item of items) {
    for (const driver of item.drivers) counts.set(driver, (counts.get(driver) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, limit)
    .map(([driver]) => driver);
}

/**
 * Aggregates scored items into one snapshot. Older evidence decays
 * exponentially so a stale morning headline cannot dominate the current read.
 */
export function buildSentimentSnapshot(
  items: GoldSentimentItem[],
  sources: GoldSentimentSourceStatus[],
  options: GoldSentimentScoreOptions = {},
): GoldSentimentSnapshot {
  const now = options.now ?? Date.now();
  const windowMs = options.windowMs ?? 48 * 60 * 60_000;
  const newsHalfLifeMs = options.newsHalfLifeMs ?? 4 * 60 * 60_000;
  const socialHalfLifeMs = options.socialHalfLifeMs ?? 2 * 60 * 60_000;
  const newsBlend = Math.min(1, Math.max(0, options.newsBlend ?? .65));
  const maxTopItems = options.maxTopItems ?? 8;

  const fresh = items.filter((item) => Number.isFinite(item.publishedAt) && now - item.publishedAt <= windowMs);
  const news = fresh.filter((item) => item.kind === 'news');
  const social = fresh.filter((item) => item.kind === 'social');
  const newsAggregate = aggregate(news, newsHalfLifeMs, now);
  const socialAggregate = aggregate(social, socialHalfLifeMs, now);

  let combinedScore: number;
  if (newsAggregate.count === 0 && socialAggregate.count === 0) combinedScore = 0;
  else if (newsAggregate.count === 0) combinedScore = socialAggregate.score;
  else if (socialAggregate.count === 0) combinedScore = newsAggregate.score;
  else combinedScore = clampScore(newsAggregate.score * newsBlend + socialAggregate.score * (1 - newsBlend));

  const topItems = [...fresh]
    .filter((item) => Math.abs(item.score) > 0)
    .sort((left, right) => Math.abs(right.score) - Math.abs(left.score) || right.publishedAt - left.publishedAt)
    .slice(0, maxTopItems);

  return {
    newsScore: round(newsAggregate.score),
    socialScore: round(socialAggregate.score),
    combinedScore: round(combinedScore),
    newsCount: newsAggregate.count,
    socialCount: socialAggregate.count,
    newsFreshnessMs: Number.isFinite(newsAggregate.freshnessMs) ? Math.max(0, round(newsAggregate.freshnessMs)) : Number.POSITIVE_INFINITY,
    socialFreshnessMs: Number.isFinite(socialAggregate.freshnessMs) ? Math.max(0, round(socialAggregate.freshnessMs)) : Number.POSITIVE_INFINITY,
    drivers: topDrivers(fresh, 6),
    topItems,
    sources: sources.map((source) => ({ ...source })),
    generatedAt: now,
  };
}

function round(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

/** Human-facing lean of a sentiment score. */
export function sentimentLean(score: number): 'BULLISH' | 'BEARISH' | 'NEUTRAL' {
  if (score >= .15) return 'BULLISH';
  if (score <= -.15) return 'BEARISH';
  return 'NEUTRAL';
}
