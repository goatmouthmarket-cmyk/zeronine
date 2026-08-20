import type { Direction } from '../core/digitMath.ts';
import { winDigits } from '../core/digitMath.ts';

/**
 * The scanner converts raw tick digits into a quantified view of each market's
 * regime. It runs several rolling windows at once (25/50/100/250/500/1000
 * ticks) because no single window tells the truth - a short burst can fool a
 * small window and a stale regime can fool a long one.
 *
 * Features produced per (direction, barrier):
 * - window win probabilities (win25..win1000)
 * - momentum: recent-vs-long weighted blend (50/100/250/500, weighted 45/30/15/10)
 * - short-long deviation: p50 vs p500 spread
 * - consistency: variance across the four 25-tick blocks inside the last 100
 * - entropy: normalized Shannon entropy of the last 100-tick distribution
 * - transition probability: P(win | previous digit) from the 10x10 matrix,
 *   blended with a small weight (these patterns overfit easily)
 * - estimatedWin: final calibrated probability used for edge/EV math
 */

export const WINDOWS = [25, 50, 100, 250, 500, 1000] as const;
export const MOMENTUM_WEIGHTS: Readonly<Record<number, number>> = { 25: 0, 50: 0.45, 100: 0.3, 250: 0.15, 500: 0.1, 1000: 0 };
export const TRANSITION_WEIGHT = 0.1;
export const BLOCK_SIZE = 25;

export interface BarrierFeatures {
  direction: Direction;
  barrier: number;
  theoreticalWin: number;
  win25: number;
  win50: number;
  win100: number;
  win250: number;
  win500: number;
  win1000: number;
  momentum: number;
  shortLongDeviation: number;
  consistency: number;
  entropy: number;
  transitionCond: number;
  learnedWin: number | null;
  estimatedWin: number;
}

export interface MarketScan {
  symbol: string;
  display: string;
  samples: number;
  previousDigit: number | null;
  features: BarrierFeatures[];
}

/**
 * Learned-pattern hook: given a previous digit, return the renormalized
 * P(next digit) distribution confirmed by pattern_stats, or null when the
 * market has no confirmed rows for that previous digit.
 */
export type PatternLift = (symbol: string, prev: number) => number[] | null;

export interface PatternInput {
  rowFor: PatternLift;
  weight: number;
}

export function digitFreq(digits: number[]): number[] {
  const dist = Array.from({ length: 10 }, () => 0);
  for (const d of digits) {
    const di = Math.trunc(d);
    if (di >= 0 && di <= 9) dist[di] += 1;
  }
  return dist;
}

export function barrierProb(freq: number[], direction: Direction, barrier: number): number {
  let sum = 0;
  for (const d of winDigits(direction, barrier)) sum += freq[d] ?? 0;
  return sum;
}

function theoreticalWin(direction: Direction, barrier: number): number {
  return winDigits(direction, barrier).length / 10;
}

const EMPTY_FREQ = digitFreq([]);

/** Frequency of the digit in the last `n` ticks, or null when fewer are available. */
function windowFreq(digits: number[], n: number): number[] | null {
  if (digits.length < n) return null;
  const slice = digits.slice(digits.length - n);
  const freq = digitFreq(slice);
  const total = slice.length;
  return total > 0 ? freq.map((c) => c / total) : null;
}

/** Weighted blend of the 50/100/250/500-tick windows, renormalized when some are missing. */
function momentumOf(win: Record<number, number | null>): number {
  let acc = 0;
  let w = 0;
  for (const [size, weight] of Object.entries(MOMENTUM_WEIGHTS)) {
    const p = win[Number(size)];
    if (p == null) continue;
    acc += p * weight;
    w += weight;
  }
  return w > 0 ? acc / w : 0;
}

/** Variance across the 25-tick blocks of the last 100 ticks, mapped to a 0..1 score. */
function consistencyOf(digits: number[], direction: Direction, barrier: number): number {
  if (digits.length < BLOCK_SIZE * 4) {
    return digits.length >= BLOCK_SIZE * 2 ? 0.6 : 0.4;
  }
  const blocks: number[] = [];
  for (let block = 0; block < 4; block++) {
    const start = digits.length - 100 + block * BLOCK_SIZE;
    const slice = digits.slice(start, start + BLOCK_SIZE);
    blocks.push(barrierProb(digitFreq(slice), direction, barrier) / BLOCK_SIZE);
  }
  const mean = blocks.reduce((a, b) => a + b, 0) / blocks.length;
  const variance = blocks.reduce((a, b) => a + (b - mean) * (b - mean), 0) / blocks.length;
  // std of a probability can reach ~0.5; score drops to 0 at that point.
  return Math.max(0, Math.min(1, 1 - Math.sqrt(variance) / 0.5));
}

/** Normalized Shannon entropy of the last 100-tick distribution (1 = uniform). */
function entropyOf(digits: number[]): number {
  const freq = windowFreq(digits, Math.min(100, digits.length)) ?? EMPTY_FREQ;
  let h = 0;
  for (const p of freq) {
    if (p > 0) h -= p * Math.log2(p);
  }
  return h / Math.log2(10);
}

/** P(win | previous digit) from the 10x10 transition matrix over the last 500 ticks. */
function transitionCond(digits: number[], direction: Direction, barrier: number): number {
  const wins = winDigits(direction, barrier);
  const count: number[][] = Array.from({ length: 10 }, () => Array.from({ length: 10 }, () => 0));
  const row: number[] = Array.from({ length: 10 }, () => 0);
  const start = Math.max(1, digits.length - 500);
  for (let i = start; i < digits.length; i++) {
    const prev = Math.trunc(digits[i - 1]);
    const next = Math.trunc(digits[i]);
    if (prev < 0 || prev > 9 || next < 0 || next > 9) continue;
    row[prev] += 1;
    count[prev][next] += 1;
  }
  let cond = 0;
  let rows = 0;
  const winSet = new Set(wins);
  for (let prev = 0; prev < 10; prev++) {
    if (row[prev] === 0) continue;
    let winsFrom = 0;
    for (let next = 0; next < 10; next++) if (winSet.has(next)) winsFrom += count[prev][next];
    cond += winsFrom / row[prev];
    rows += 1;
  }
  if (rows === 0) return theoreticalWin(direction, barrier);
  return cond / rows;
}

function clamp(p: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, p));
}

// Exposed so the test lab can reproduce the exact signal math per barrier.
export { theoreticalWin, windowFreq, momentumOf, consistencyOf, entropyOf, transitionCond };

export function scanMarket(
  symbol: string,
  display: string,
  digits: number[],
  pattern?: PatternInput | null,
): MarketScan {
  const features: BarrierFeatures[] = [];
  const prevDigit = digits.length ? Math.trunc(digits[digits.length - 1]) : -1;
  const rowFor = pattern && pattern.weight > 0 ? pattern.rowFor : undefined;
  for (const direction of ['over', 'under'] as Direction[]) {
    for (const barrier of direction === 'over' ? [0, 1, 2, 3, 4, 5, 6, 7] : [9, 8, 7, 6, 5, 4, 3]) {
      const learned = rowFor ? (prevDigit >= 0 && prevDigit <= 9 ? rowFor(symbol, prevDigit) ?? null : null) : null;
      features.push(featureFor(digits, direction, barrier, learned != null ? { row: learned, weight: pattern?.weight ?? 0 } : null));
    }
  }

  const last = digits.length ? Math.trunc(digits[digits.length - 1]) : null;
  return {
    symbol,
    display,
    samples: digits.length,
    previousDigit: last != null && last >= 0 && last <= 9 ? last : null,
    features,
  };
}

/**
 * Compute the full feature set for a single (direction, barrier) — the lightweight
 * path the test lab uses so a backtest can assess one barrier without scanning all.
 */
export function featureFor(
  digits: number[],
  direction: Direction,
  barrier: number,
  pattern?: { row: number[] | null; weight: number } | null,
): BarrierFeatures {
  const wins: Record<number, number | null> = { 50: null, 100: null, 250: null, 500: null };
  const base = theoreticalWin(direction, barrier);

  const p = {
    win25: 0,
    win50: 0,
    win100: 0,
    win250: 0,
    win500: 0,
    win1000: 0,
  };
  for (const size of WINDOWS) {
    const freq = windowFreq(digits, size);
    const prob = freq ? barrierProb(freq, direction, barrier) : 0;
    if (size === 25) p.win25 = prob;
    if (size === 50) {
      p.win50 = prob;
      wins[50] = freq ? prob : null;
    }
    if (size === 100) {
      p.win100 = prob;
      wins[100] = freq ? prob : null;
    }
    if (size === 250) {
      p.win250 = prob;
      wins[250] = freq ? prob : null;
    }
    if (size === 500) {
      p.win500 = prob;
      wins[500] = freq ? prob : null;
    }
    if (size === 1000) p.win1000 = prob;
  }

  const momentum = momentumOf(wins);
  const consistency = consistencyOf(digits, direction, barrier);
  const entropy = entropyOf(digits);
  const transitionCondProb = transitionCond(digits, direction, barrier);

  const tilt = momentum - base;
  const credible = tilt * consistency;
  let transitionAdj = (transitionCondProb - base) * TRANSITION_WEIGHT;
  let learnedWin: number | null = null;
  if (pattern && pattern.weight > 0 && pattern.row) {
    const row = pattern.row;
    const wins = winDigits(direction, barrier);
    learnedWin = wins.reduce((s, d) => s + (row[d] ?? 0), 0);
    const w = clamp(pattern.weight, 0, 1);
    transitionAdj = ((1 - w) * transitionCondProb + w * learnedWin - base) * TRANSITION_WEIGHT;
  }
  const estimatedWin = clamp(base + credible + transitionAdj, 0.02, 0.98);

  return {
    direction,
    barrier,
    theoreticalWin: base,
    ...p,
    momentum,
    shortLongDeviation: p.win50 - p.win500,
    consistency,
    entropy,
    transitionCond: transitionCondProb,
    learnedWin,
    estimatedWin,
  };
}

export function featuresFor(scan: MarketScan, direction: Direction, barrier: number): BarrierFeatures | null {
  return scan.features.find((f) => f.direction === direction && f.barrier === barrier) ?? null;
}