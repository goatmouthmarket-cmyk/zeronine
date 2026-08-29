import {
  GOLD_TIMEFRAME_MS,
  type GoldCandle,
  type GoldMarketStatus,
  type GoldQuote,
  type GoldSymbol,
  type GoldTimeframe,
} from './domain.ts';

export type GoldSignalDirection = 'BUY' | 'SELL' | 'WAIT';
export type GoldRegime = 'TRENDING' | 'RANGING' | 'HIGH_VOLATILITY' | 'INSUFFICIENT_DATA';

export interface GoldModelWeights {
  momentum: number;
  timeframeAgreement: number;
  emaAlignment: number;
  structure: number;
  candleConsistency: number;
  volatilitySuitability: number;
  volumeConfirmation: number;
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
}

export const DEFAULT_GOLD_RESEARCH_CONFIG: GoldResearchConfig = {
  modelVersion: 'gold-momentum-v1',
  weights: {
    momentum: .25,
    timeframeAgreement: .20,
    emaAlignment: .15,
    structure: .15,
    candleConsistency: .10,
    volatilitySuitability: .10,
    volumeConfirmation: .05,
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

function marketBlocker(status: GoldMarketStatus): string | null {
  if (status === 'open') return null;
  if (status === 'closed') return 'Market is closed';
  if (status === 'suspended') return 'Market is suspended';
  return 'Market is unavailable';
}

function waitSignal(input: GoldResearchInput, config: GoldResearchConfig, blockers: string[], primary: GoldCandle[] = []): GoldSignal {
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
    generatedAt: input.now,
    expiresAt: input.now + config.signalTtlMs,
  };
}

/**
 * Evaluates an explainable deterministic Gold signal. It is pure: fetching,
 * persistence, risk approval, and order placement live outside this module.
 */
export function evaluateGoldResearch(input: GoldResearchInput): GoldSignal {
  const config = resolveConfig(input.config);
  const quote = input.quote;
  const blockers: string[] = [];
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
  if (primary && hasMissingIntervals(primary, input.timeframe)) blockers.push(`Missing ${input.timeframe} candle intervals`);
  if (confirmation && hasMissingIntervals(confirmation, confirmationTimeframe)) blockers.push(`Missing ${confirmationTimeframe} candle intervals`);
  if (blockers.length > 0) return waitSignal(input, config, blockers, primary ?? []);

  const candles = primary!;
  const confirmationCandles = confirmation!;
  const currentAtr = atr(candles, config.atrPeriod);
  const normalizedAtr = currentAtr / Math.max(candles.at(-1)!.close, Number.EPSILON);
  const spreadToAtr = quote!.spread / Math.max(currentAtr, Number.EPSILON);
  if (!finite(currentAtr) || currentAtr <= 0) blockers.push('ATR is unavailable');
  if (spreadToAtr > config.maxSpreadToAtr) blockers.push('Spread is too wide relative to recent movement');
  if (normalizedAtr > config.maxNormalizedAtr) blockers.push('Volatility exceeds the configured safety limit');
  if (blockers.length > 0) return waitSignal(input, config, blockers, candles);

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
  const components: Array<[number, number]> = [
    [momentum, config.weights.momentum],
    [agreement, config.weights.timeframeAgreement],
    [emaAlignment, config.weights.emaAlignment],
    [structure, config.weights.structure],
    [candleConsistency, config.weights.candleConsistency],
    // The suitability component is a quality multiplier, not directional alpha.
    [1, config.weights.volatilitySuitability],
    [volume ?? 0, config.weights.volumeConfirmation],
  ];
  const activeWeight = components.reduce((sum, [, weight]) => sum + weight, 0);
  const directionalWeight = activeWeight - config.weights.volatilitySuitability;
  const signedDirectional = components
    .filter(([, weight], index) => index !== 5 && weight > 0)
    .reduce((sum, [value, weight]) => sum + value * weight, 0) / Math.max(directionalWeight, Number.EPSILON);
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
    generatedAt: input.now,
    expiresAt: input.now + config.signalTtlMs,
  };
}
