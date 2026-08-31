import {
  GOLD_TIMEFRAME_MS,
  type GoldCandle,
  type GoldMarketStatus,
  type GoldQuote,
  type GoldSymbol,
  type GoldTimeframe,
} from './domain.ts';
import type { GoldSentimentSnapshot } from './sentiment.ts';

export type GoldSignalDirection = 'BUY' | 'SELL' | 'WAIT';
export type GoldRegime = 'TRENDING' | 'RANGING' | 'HIGH_VOLATILITY' | 'INSUFFICIENT_DATA';
export type GoldSentimentAlignment = 'ALIGNED' | 'CONFLICTING' | 'NEUTRAL';

export interface GoldModelWeights {
  momentum: number;
  timeframeAgreement: number;
  emaAlignment: number;
  structure: number;
  candleConsistency: number;
  volatilitySuitability: number;
  volumeConfirmation: number;
  rsi: number;
  macd: number;
  bollinger: number;
  stochastic: number;
  adx: number;
  /** News-headline sentiment weight; only active while a fresh snapshot exists. */
  newsSentiment: number;
  /** Social-post sentiment weight; only active while a fresh snapshot exists. */
  socialSentiment: number;
}

export interface GoldSignalSentiment {
  newsScore: number;
  socialScore: number;
  combinedScore: number;
  newsCount: number;
  socialCount: number;
  alignment: GoldSentimentAlignment;
  /** True only when price evidence, news, and social all agree strongly. */
  perfectSetup: boolean;
  drivers: string[];
  generatedAt: number;
}

export interface GoldResearchConfig {
  modelVersion: string;
  weights: GoldModelWeights;
  buyThreshold: number;
  sellThreshold: number;
  emaFastPeriod: number;
  emaSlowPeriod: number;
  atrPeriod: number;
  structurePeriod: number;
  minCandles: number;
  maxQuoteAgeMs: number;
  maxSpreadToAtr: number;
  maxNormalizedAtr: number;
  stopAtrMultiple: number;
  targetAtrMultiple: number;
  signalTtlMs: number;
  /** A snapshot older than this is ignored entirely by the model. */
  maxSentimentAgeMs: number;
  sentimentPerfectNewsMin: number;
  sentimentPerfectSocialMin: number;
  sentimentPerfectScoreMin: number;
}

export interface GoldSignal {
  id: string;
  modelVersion: string;
  symbol: string;
  symbolId: string;
  timeframe: GoldTimeframe;
  direction: GoldSignalDirection;
  /** Deterministic strength: round(abs(score) * 100), never a fitted probability. */
  confidence: number;
  /** Signed, normalized model score in [-1, 1]. */
  score: number;
  entryReference: number;
  proposedStopLoss: number | null;
  proposedTakeProfit: number | null;
  atr: number;
  spread: number;
  spreadToAtr: number;
  regime: GoldRegime;
  reasons: string[];
  blockers: string[];
  /** Classic indicator values for dashboard display and evidence. */
  indicators: {
    rsi: number;
    macd: number;
    bollinger: number;
    stochastic: number;
    adx: number;
  };
  sentiment: GoldSignalSentiment | null;
  generatedAt: number;
  expiresAt: number;
}

export interface GoldResearchInput {
  symbol: GoldSymbol;
  quote: GoldQuote | null;
  timeframe: GoldTimeframe;
  /** Candles are supplied oldest first, keyed by broker timeframe. */
  candles: Partial<Record<GoldTimeframe, GoldCandle[]>>;
  now: number;
  config?: Partial<GoldResearchConfig>;
  sentiment?: GoldSentimentSnapshot | null;
}

export const DEFAULT_GOLD_RESEARCH_CONFIG: GoldResearchConfig = {
  modelVersion: 'gold-momentum-v1',
  weights: {
    momentum: .20,
    timeframeAgreement: .15,
    emaAlignment: .12,
    structure: .12,
    candleConsistency: .08,
    volatilitySuitability: .08,
    volumeConfirmation: .04,
    rsi: .06,
    macd: .05,
    bollinger: .04,
    stochastic: .03,
    adx: .03,
    newsSentiment: .10,
    socialSentiment: .05,
  },
  buyThreshold: .40,
  sellThreshold: -.40,
  emaFastPeriod: 9,
  emaSlowPeriod: 21,
  atrPeriod: 14,
  structurePeriod: 20,
  minCandles: 30,
  maxQuoteAgeMs: 10_000,
  maxSpreadToAtr: .15,
  maxNormalizedAtr: .012,
  stopAtrMultiple: 1.5,
  targetAtrMultiple: 2.25,
  signalTtlMs: 30_000,
  maxSentimentAgeMs: 20 * 60_000,
  sentimentPerfectNewsMin: .35,
  sentimentPerfectSocialMin: .20,
  sentimentPerfectScoreMin: .55,
};

function clamp(value: number, min = -1, max = 1): number {
  return Math.max(min, Math.min(max, value));
}

function finite(value: number): boolean {
  return Number.isFinite(value);
}

function roundTo(value: number, digits: number): number {
  const factor = 10 ** Math.max(0, digits);
  return Math.round(value * factor) / factor;
}

function resolveConfig(patch?: Partial<GoldResearchConfig>): GoldResearchConfig {
  const config: GoldResearchConfig = {
    ...DEFAULT_GOLD_RESEARCH_CONFIG,
    ...patch,
    weights: { ...DEFAULT_GOLD_RESEARCH_CONFIG.weights, ...patch?.weights },
  };
  const weights = Object.values(config.weights);
  if (weights.some((weight) => !finite(weight) || weight < 0) || weights.every((weight) => weight === 0)) {
    throw new Error('Gold research weights must be finite, non-negative, and include at least one active component');
  }
  if (!finite(config.buyThreshold) || !finite(config.sellThreshold) || config.buyThreshold <= 0 || config.buyThreshold > 1 || config.sellThreshold >= 0 || config.sellThreshold < -1) {
    throw new Error('Gold research thresholds must be within (0, 1] and [-1, 0)');
  }
  if (!Number.isInteger(config.minCandles) || config.minCandles < 2 || config.maxQuoteAgeMs <= 0 || config.maxSpreadToAtr <= 0 || config.maxNormalizedAtr <= 0) {
    throw new Error('Gold research configuration is invalid');
  }
  if (config.maxSentimentAgeMs <= 0
    || !finite(config.sentimentPerfectNewsMin) || config.sentimentPerfectNewsMin <= 0 || config.sentimentPerfectNewsMin > 1
    || !finite(config.sentimentPerfectSocialMin) || config.sentimentPerfectSocialMin <= 0 || config.sentimentPerfectSocialMin > 1
    || !finite(config.sentimentPerfectScoreMin) || config.sentimentPerfectScoreMin <= 0 || config.sentimentPerfectScoreMin > 1) {
    throw new Error('Gold sentiment configuration is invalid');
  }
  return config;
}

function sortedValidCandles(candles: GoldCandle[], symbolId: string, timeframe: GoldTimeframe): GoldCandle[] | null {
  if (candles.some((candle) => candle.symbolId !== symbolId || candle.timeframe !== timeframe || !finite(candle.openTime) || !finite(candle.closeTime)
    || !finite(candle.open) || !finite(candle.high) || !finite(candle.low) || !finite(candle.close)
    || candle.low > Math.min(candle.open, candle.close) || candle.high < Math.max(candle.open, candle.close) || candle.closeTime <= candle.openTime)) return null;
  const sorted = [...candles].sort((a, b) => a.openTime - b.openTime);
  return sorted.some((candle, index) => index > 0 && candle.openTime <= sorted[index - 1]!.openTime) ? null : sorted;
}

function hasMissingIntervals(candles: GoldCandle[], timeframe: GoldTimeframe): boolean {
  const expected = GOLD_TIMEFRAME_MS[timeframe];
  // A gap beyond 1.5 expected intervals makes a price structure unsafe.
  return candles.some((candle, index) => index > 0 && candle.openTime - candles[index - 1]!.openTime > expected * 1.5);
}

function ema(candles: GoldCandle[], period: number): number[] {
  const alpha = 2 / (period + 1);
  const values: number[] = [];
  let previous = candles[0]!.close;
  for (const candle of candles) {
    previous = candle.close * alpha + previous * (1 - alpha);
    values.push(previous);
  }
  return values;
}

function atr(candles: GoldCandle[], period: number): number {
  if (candles.length < 2) return 0;
  const range = candles.slice(1).map((candle, index) => Math.max(
    candle.high - candle.low,
    Math.abs(candle.high - candles[index]!.close),
    Math.abs(candle.low - candles[index]!.close),
  ));
  const tail = range.slice(-period);
  return tail.reduce((sum, value) => sum + value, 0) / Math.max(1, tail.length);
}

function returnScore(candles: GoldCandle[], lookback: number, currentAtr: number): number {
  const last = candles.at(-1)!;
  const prior = candles[Math.max(0, candles.length - 1 - lookback)]!;
  return currentAtr > 0 ? clamp((last.close - prior.close) / (currentAtr * Math.max(1, lookback / 2))) : 0;
}

function directionalCandleScore(candles: GoldCandle[]): number {
  const tail = candles.slice(-5);
  if (tail.length === 0) return 0;
  return tail.reduce((sum, candle) => {
    const range = candle.high - candle.low;
    return sum + (range > 0 ? clamp((candle.close - candle.open) / range) : 0);
  }, 0) / tail.length;
}

function structureScore(candles: GoldCandle[], period: number, currentAtr: number): number {
  const last = candles.at(-1)!;
  const prior = candles.slice(-(period + 1), -1);
  if (prior.length === 0 || currentAtr <= 0) return 0;
  const priorHigh = Math.max(...prior.map((candle) => candle.high));
  const priorLow = Math.min(...prior.map((candle) => candle.low));
  if (last.close > priorHigh) return clamp((last.close - priorHigh) / currentAtr);
  if (last.close < priorLow) return clamp((last.close - priorLow) / currentAtr);
  const midpoint = (priorHigh + priorLow) / 2;
  return clamp((last.close - midpoint) / Math.max(currentAtr * 4, (priorHigh - priorLow) / 2));
}

function trendScore(candles: GoldCandle[], fastPeriod: number, slowPeriod: number, currentAtr: number): number {
  const fast = ema(candles, fastPeriod);
  const slow = ema(candles, slowPeriod);
  const last = candles.at(-1)!;
  const fastLast = fast.at(-1)!;
  const slowLast = slow.at(-1)!;
  const slope = fastLast - fast[Math.max(0, fast.length - 4)]!;
  if (currentAtr <= 0) return 0;
  const relation = (fastLast - slowLast) / currentAtr;
  const priceRelation = (last.close - slowLast) / currentAtr;
  return clamp((relation + priceRelation + slope / currentAtr) / 3);
}

function volumeScore(candles: GoldCandle[], directionHint: number): number | null {
  const tail = candles.slice(-6);
  if (tail.length < 6 || tail.some((candle) => candle.tickVolume == null || candle.tickVolume! < 0)) return null;
  const latest = tail.at(-1)!.tickVolume!;
  const baseline = tail.slice(0, -1).reduce((sum, candle) => sum + candle.tickVolume!, 0) / 5;
  if (baseline <= 0) return null;
  return clamp(((latest / baseline) - 1) * Math.sign(directionHint));
}

/** RSI: Relative Strength Index (14). Returns normalized [-1, 1] from 50 midpoint. */
function rsi(candles: GoldCandle[], period = 14): number {
  if (candles.length < period + 1) return 0;
  const changes = candles.slice(1).map((candle, index) => candle.close - candles[index]!.close);
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 0; i < period; i++) {
    const change = changes[i];
    if (change >= 0) avgGain += change;
    else avgLoss -= change;
  }
  avgGain /= period;
  avgLoss /= period;
  for (let i = period; i < changes.length; i++) {
    const change = changes[i];
    if (change >= 0) {
      avgGain = (avgGain * (period - 1) + change) / period;
      avgLoss = (avgLoss * (period - 1)) / period;
    } else {
      avgGain = (avgGain * (period - 1)) / period;
      avgLoss = (avgLoss * (period - 1) - change) / period;
    }
  }
  if (avgLoss === 0) return 1;
  const rs = avgGain / avgLoss;
  const rsiValue = 100 - 100 / (1 + rs);
  return clamp((rsiValue - 50) / 50);
}

/** MACD: (12,26,9) -> histogram normalized by ATR. Returns signed [-1, 1]. */
function macd(candles: GoldCandle[], currentAtr: number): number {
  if (candles.length < 26) return 0;
  const fast = ema(candles, 12);
  const slow = ema(candles, 26);
  const macdLine = fast.map((v, i) => v - slow[i]);
  const signal = ema(macdLine.map(v => ({ close: v }) as GoldCandle), 9);
  const hist = macdLine.at(-1)! - signal.at(-1)!;
  return currentAtr > 0 ? clamp(hist / currentAtr) : 0;
}

/** Bollinger Bands: (20,2) -> position of close within bands [-1, 1]. */
function bollingerPosition(candles: GoldCandle[], period = 20, mult = 2): number {
  if (candles.length < period) return 0;
  const tail = candles.slice(-period);
  const closes = tail.map(c => c.close);
  const mean = closes.reduce((a, b) => a + b, 0) / period;
  const std = Math.sqrt(closes.reduce((sum, c) => sum + (c - mean) ** 2, 0) / period);
  if (std === 0) return 0;
  const upper = mean + mult * std;
  const lower = mean - mult * std;
  const lastClose = closes.at(-1)!;
  return clamp((lastClose - mean) / (upper - lower) * 2);
}

/** Stochastic %K (14,3): normalized to [-1, 1] from 50 midpoint. */
function stochastic(candles: GoldCandle[], kPeriod = 14, dPeriod = 3): number {
  if (candles.length < kPeriod + dPeriod) return 0;
  const tail = candles.slice(-(kPeriod + dPeriod - 1));
  const kValues: number[] = [];
  for (let i = 0; i <= tail.length - kPeriod; i++) {
    const window = tail.slice(i, i + kPeriod);
    const high = Math.max(...window.map(c => c.high));
    const low = Math.min(...window.map(c => c.low));
    const close = window.at(-1)!.close;
    const range = high - low;
    kValues.push(range > 0 ? (close - low) / range * 100 : 50);
  }
  const dValues: number[] = [];
  for (let i = 0; i <= kValues.length - dPeriod; i++) {
    dValues.push(kValues.slice(i, i + dPeriod).reduce((a, b) => a + b, 0) / dPeriod);
  }
  const stochD = dValues.at(-1)!;
  return clamp((stochD - 50) / 50);
}

/** ADX (14): trend strength normalized. Returns 0-1 (strong trend > 0.4). */
function adx(candles: GoldCandle[], period = 14): number {
  if (candles.length < period + 1) return 0;
  const trs: number[] = [];
  const plusDM: number[] = [];
  const minusDM: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const cur = candles[i];
    const prev = candles[i - 1];
    const tr = Math.max(cur.high - cur.low, Math.abs(cur.high - prev.close), Math.abs(cur.low - prev.close));
    trs.push(tr);
    const up = cur.high - prev.high;
    const down = prev.low - cur.low;
    plusDM.push(up > down && up > 0 ? up : 0);
    minusDM.push(down > up && down > 0 ? down : 0);
  }
  const atrVal = atr(candles, period);
  if (atrVal === 0) return 0;
  const plusDI = (plusDM.slice(-period).reduce((a, b) => a + b, 0) / period) / atrVal * 100;
  const minusDI = (minusDM.slice(-period).reduce((a, b) => a + b, 0) / period) / atrVal * 100;
  const dx = plusDI + minusDI === 0 ? 0 : Math.abs(plusDI - minusDI) / (plusDI + minusDI) * 100;
  return clamp(dx / 50);
}

function marketBlocker(status: GoldMarketStatus): string | null {
  if (status === 'open') return null;
  if (status === 'closed') return 'Market is closed';
  if (status === 'suspended') return 'Market is suspended';
  return 'Market is unavailable';
}

function waitSignal(input: GoldResearchInput, config: GoldResearchConfig, blockers: string[], primary: GoldCandle[] = [], sentiment: GoldSentimentSnapshot | null): GoldSignal {
  const quote = input.quote;
  const currentAtr = primary.length >= 2 ? atr(primary, config.atrPeriod) : 0;
  const spread = quote?.spread ?? 0;
  return {
    id: `${config.modelVersion}:${input.symbol.id}:${input.timeframe}:${input.now}`,
    modelVersion: config.modelVersion,
    symbol: input.symbol.name,
    symbolId: input.symbol.id,
    timeframe: input.timeframe,
    direction: 'WAIT',
    confidence: 0,
    score: 0,
    entryReference: quote?.mid ?? primary.at(-1)?.close ?? 0,
    proposedStopLoss: null,
    proposedTakeProfit: null,
    atr: currentAtr,
    spread,
    spreadToAtr: currentAtr > 0 ? spread / currentAtr : Infinity,
    regime: primary.length >= config.minCandles ? 'RANGING' : 'INSUFFICIENT_DATA',
    reasons: [],
    blockers,
    indicators: { rsi: 0, macd: 0, bollinger: 0, stochastic: 0, adx: 0 },
    sentiment: sentiment ? summarizeSentiment(sentiment, 'NEUTRAL', false) : null,
    generatedAt: input.now,
    expiresAt: input.now + config.signalTtlMs,
  };
}

function summarizeSentiment(
  sentiment: GoldSentimentSnapshot,
  alignment: GoldSentimentAlignment,
  perfectSetup: boolean,
): GoldSignalSentiment {
  return {
    newsScore: sentiment.newsScore,
    socialScore: sentiment.socialScore,
    combinedScore: sentiment.combinedScore,
    newsCount: sentiment.newsCount,
    socialCount: sentiment.socialCount,
    alignment,
    perfectSetup,
    drivers: [...sentiment.drivers],
    generatedAt: sentiment.generatedAt,
  };
}

/**
 * Sentiment participates only while a fresh, non-empty snapshot exists. A
 * missing, stale, or empty snapshot leaves the price model byte-identical,
 * which keeps historical backtests and offline research deterministic.
 */
function usableSentiment(input: GoldResearchInput, config: GoldResearchConfig): GoldSentimentSnapshot | null {
  const sentiment = input.sentiment ?? null;
  if (!sentiment) return null;
  if (!Number.isFinite(sentiment.generatedAt) || input.now - sentiment.generatedAt > config.maxSentimentAgeMs) return null;
  if (sentiment.newsCount <= 0 && sentiment.socialCount <= 0) return null;
  const newsScore = Number(sentiment.newsScore);
  const socialScore = Number(sentiment.socialScore);
  if (!finite(newsScore) || Math.abs(newsScore) > 1 || !finite(socialScore) || Math.abs(socialScore) > 1) return null;
  return sentiment;
}

/**
 * Evaluates an explainable deterministic Gold signal. It is pure: fetching,
 * persistence, risk approval, and order placement live outside this module.
 */
export function evaluateGoldResearch(input: GoldResearchInput): GoldSignal {
  const config = resolveConfig(input.config);
  const quote = input.quote;
  const blockers: string[] = [];
  const sentiment = usableSentiment(input, config);
  const primaryRaw = input.candles[input.timeframe] ?? [];
  const confirmationTimeframe: GoldTimeframe = input.timeframe === '15m' || input.timeframe === '1h' ? input.timeframe : '15m';
  const confirmationRaw = input.candles[confirmationTimeframe] ?? [];
  const primary = sortedValidCandles(primaryRaw, input.symbol.id, input.timeframe);
  const confirmation = sortedValidCandles(confirmationRaw, input.symbol.id, confirmationTimeframe);

  const statusBlocker = marketBlocker(input.symbol.tradingStatus);
  if (statusBlocker) blockers.push(statusBlocker);
  if (!quote) blockers.push('No live quote is available');
  else {
    if (!finite(quote.bid) || !finite(quote.ask) || quote.bid <= 0 || quote.ask < quote.bid || !finite(quote.mid) || !finite(quote.spread)) blockers.push('Quote is invalid');
    if (input.now - quote.timestamp > config.maxQuoteAgeMs) blockers.push('Quote is stale');
    if (quote.timestamp > input.now + config.maxQuoteAgeMs) blockers.push('Quote timestamp is in the future');
  }
  if (!primary || !confirmation) blockers.push('Candle data is invalid or out of order');
  if (primary && primary.length < config.minCandles) blockers.push(`Insufficient ${input.timeframe} candle history`);
  if (confirmation && confirmation.length < config.minCandles) blockers.push(`Insufficient ${confirmationTimeframe} candle history`);
  // Broker history legitimately contains session/weekend closures. Only the
  // latest analysis window must be continuous; an older closure should not
  // pin live research to WAIT until all 500 downloaded rows roll forward.
  if (primary && hasMissingIntervals(primary.slice(-config.minCandles), input.timeframe)) blockers.push(`Missing ${input.timeframe} candle intervals`);
  if (confirmation && hasMissingIntervals(confirmation.slice(-config.minCandles), confirmationTimeframe)) blockers.push(`Missing ${confirmationTimeframe} candle intervals`);
  if (blockers.length > 0) return waitSignal(input, config, blockers, primary ?? [], sentiment);

  const candles = primary!;
  const confirmationCandles = confirmation!;
  const currentAtr = atr(candles, config.atrPeriod);
  const normalizedAtr = currentAtr / Math.max(candles.at(-1)!.close, Number.EPSILON);
  const spreadToAtr = quote!.spread / Math.max(currentAtr, Number.EPSILON);
  if (!finite(currentAtr) || currentAtr <= 0) blockers.push('ATR is unavailable');
  if (spreadToAtr > config.maxSpreadToAtr) blockers.push('Spread is too wide relative to recent movement');
  if (normalizedAtr > config.maxNormalizedAtr) blockers.push('Volatility exceeds the configured safety limit');
  if (blockers.length > 0) return waitSignal(input, config, blockers, candles, sentiment);

  const momentum = returnScore(candles, 5, currentAtr);
  const confirmationMomentum = returnScore(confirmationCandles, 5, atr(confirmationCandles, config.atrPeriod));
  const agreement = Math.sign(momentum) === Math.sign(confirmationMomentum) ? momentum : (momentum + confirmationMomentum) / 4;
  const primaryTrend = trendScore(candles, config.emaFastPeriod, config.emaSlowPeriod, currentAtr);
  const confirmationTrend = trendScore(confirmationCandles, config.emaFastPeriod, config.emaSlowPeriod, atr(confirmationCandles, config.atrPeriod));
  const emaAlignment = Math.sign(primaryTrend) === Math.sign(confirmationTrend)
    ? (primaryTrend + confirmationTrend) / 2
    : primaryTrend / 2;
  const structure = structureScore(candles, config.structurePeriod, currentAtr);
  const candleConsistency = directionalCandleScore(candles);
  const volume = volumeScore(candles, momentum);
  const rsiValue = rsi(candles, 14);
  const macdValue = macd(candles, currentAtr);
  const bollingerValue = bollingerPosition(candles, 20, 2);
  const stochasticValue = stochastic(candles, 14, 3);
  const adxValue = adx(candles, 14);
  const components: Array<{ value: number; weight: number; directional: boolean }> = [
    { value: momentum, weight: config.weights.momentum, directional: true },
    { value: agreement, weight: config.weights.timeframeAgreement, directional: true },
    { value: emaAlignment, weight: config.weights.emaAlignment, directional: true },
    { value: structure, weight: config.weights.structure, directional: true },
    { value: candleConsistency, weight: config.weights.candleConsistency, directional: true },
    // The suitability component is a quality multiplier, not directional alpha.
    { value: 1, weight: config.weights.volatilitySuitability, directional: false },
    { value: volume ?? 0, weight: config.weights.volumeConfirmation, directional: true },
    { value: rsiValue, weight: config.weights.rsi, directional: true },
    { value: macdValue, weight: config.weights.macd, directional: true },
    { value: bollingerValue, weight: config.weights.bollinger, directional: true },
    { value: stochasticValue, weight: config.weights.stochastic, directional: true },
    { value: adxValue, weight: config.weights.adx, directional: true },
  ];
  if (sentiment) {
    components.push({ value: sentiment.newsScore, weight: config.weights.newsSentiment, directional: true });
    components.push({ value: sentiment.socialScore, weight: config.weights.socialSentiment, directional: true });
  }
  const directionalWeight = components
    .filter((component) => component.directional)
    .reduce((sum, component) => sum + component.weight, 0);
  const signedDirectional = components
    .filter((component) => component.directional && component.weight > 0)
    .reduce((sum, component) => sum + component.value * component.weight, 0) / Math.max(directionalWeight, Number.EPSILON);
  const quality = clamp(1 - (spreadToAtr / config.maxSpreadToAtr), 0, 1) * clamp(1 - (normalizedAtr / config.maxNormalizedAtr), 0, 1);
  const score = clamp(signedDirectional * (.55 + quality * .45));
  const reasons: string[] = [];
  if (Math.sign(momentum) === Math.sign(confirmationMomentum) && Math.abs(momentum) >= .15) reasons.push('Short and confirmation timeframe momentum agree');
  if (Math.sign(primaryTrend) === Math.sign(confirmationTrend) && Math.abs(primaryTrend) >= .15) reasons.push('Price and EMA direction agree across timeframes');
  if (Math.abs(structure) >= .2) reasons.push(structure > 0 ? 'Price is breaking above the recent range' : 'Price is breaking below the recent range');
  if (Math.abs(candleConsistency) >= .25) reasons.push(candleConsistency > 0 ? 'Recent candle bodies favor buyers' : 'Recent candle bodies favor sellers');
  if (volume !== null && Math.abs(volume) >= .1) reasons.push('Tick volume confirms the current move');
  if (spreadToAtr <= config.maxSpreadToAtr * .6) reasons.push('Spread is below the configured cost hurdle');

  let direction: GoldSignalDirection = 'WAIT';
  if (score >= config.buyThreshold) direction = 'BUY';
  else if (score <= config.sellThreshold) direction = 'SELL';
  else blockers.push('Evidence does not exceed the configured directional threshold');
  if (direction === 'WAIT' && reasons.length === 0) reasons.push('Price structure is mixed');

  let signalSentiment: GoldSignalSentiment | null = null;
  if (sentiment) {
    const priceSign = Math.sign(score) || (direction === 'BUY' ? 1 : direction === 'SELL' ? -1 : 0);
    const combinedSign = Math.sign(sentiment.combinedScore);
    const alignment: GoldSentimentAlignment = Math.abs(sentiment.combinedScore) < .15 || priceSign === 0
      ? 'NEUTRAL'
      : combinedSign === priceSign ? 'ALIGNED' : 'CONFLICTING';
    const newsAligned = priceSign !== 0 && Math.sign(sentiment.newsScore) === priceSign && Math.abs(sentiment.newsScore) >= .25;
    const socialAligned = priceSign !== 0 && Math.sign(sentiment.socialScore) === priceSign && Math.abs(sentiment.socialScore) >= .15;
    const newsConflicts = priceSign !== 0 && Math.sign(sentiment.newsScore) === -priceSign && Math.abs(sentiment.newsScore) >= .25;
    if (newsAligned) reasons.push('News sentiment supports the move');
    if (socialAligned) reasons.push('Social sentiment supports the move');
    if (newsConflicts) reasons.push('News sentiment conflicts with the price evidence');
    const perfectSetup = direction !== 'WAIT'
      && priceSign !== 0
      && Math.sign(sentiment.newsScore) === priceSign && Math.abs(sentiment.newsScore) >= config.sentimentPerfectNewsMin
      && Math.sign(sentiment.socialScore) === priceSign && Math.abs(sentiment.socialScore) >= config.sentimentPerfectSocialMin
      && Math.abs(score) >= config.sentimentPerfectScoreMin;
    if (perfectSetup) reasons.push('Price, news, and social sentiment fully agree: perfect setup');
    signalSentiment = summarizeSentiment(sentiment, alignment, perfectSetup);
  }

  const entryReference = direction === 'BUY' ? quote!.ask : direction === 'SELL' ? quote!.bid : quote!.mid;
  const minStop = Math.max(input.symbol.minStopDistance, currentAtr * config.stopAtrMultiple);
  const target = Math.max(input.symbol.minStopDistance, currentAtr * config.targetAtrMultiple);
  return {
    id: `${config.modelVersion}:${input.symbol.id}:${input.timeframe}:${quote!.timestamp}`,
    modelVersion: config.modelVersion,
    symbol: input.symbol.name,
    symbolId: input.symbol.id,
    timeframe: input.timeframe,
    direction,
    confidence: Math.round(Math.abs(score) * 100),
    score,
    entryReference: roundTo(entryReference, input.symbol.digits),
    proposedStopLoss: direction === 'BUY' ? roundTo(entryReference - minStop, input.symbol.digits) : direction === 'SELL' ? roundTo(entryReference + minStop, input.symbol.digits) : null,
    proposedTakeProfit: direction === 'BUY' ? roundTo(entryReference + target, input.symbol.digits) : direction === 'SELL' ? roundTo(entryReference - target, input.symbol.digits) : null,
    atr: currentAtr,
    spread: quote!.spread,
    spreadToAtr,
    regime: normalizedAtr > config.maxNormalizedAtr * .7 ? 'HIGH_VOLATILITY' : Math.abs(emaAlignment) >= .2 ? 'TRENDING' : 'RANGING',
    reasons,
    blockers,
    indicators: { rsi: rsiValue, macd: macdValue, bollinger: bollingerValue, stochastic: stochasticValue, adx: adxValue },
    sentiment: signalSentiment,
    generatedAt: input.now,
    expiresAt: input.now + config.signalTtlMs,
  };
}
