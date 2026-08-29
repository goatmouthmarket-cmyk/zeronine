import type { Direction } from '../core/digitMath.ts';
import { digitHistory, getCalibration, listMarkets, listPatterns, listTestRuns, replacePatterns, scannerStatsByBarrier } from '../db/store.ts';
import { round2 } from './metrics.ts';

export interface TransitionRow {
  market: string;
  prev_digit: number;
  next_digit: number;
  count: number;
  frequency: number;
  expected: number;
  lift: number;
  window: number;
}

export interface PatternScanResult {
  scannedMarkets: number;
  inserted: number;
  confirmed: number;
  noise: number;
}

export interface CalibrationReport {
  buckets: ReturnType<typeof getCalibration>['buckets'];
  total: number;
  byBarrier: Array<{ market: string; direction: Direction; barrier: number; trades: number; wins: number; win_rate: number | null }>;
  byStrategy: Array<{ strategy: string; mode: string; kind: string; trades: number; wins: number; win_rate: number | null }>;
}

export const PATTERN_MIN_SAMPLES = 120;
export const LIFT_OVER = 1.3;
export const LIFT_UNDER = 0.77;
const CONFIRM_WINDOWS = [2000, 5000];

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * 10x10 prev->next transition counts over the given slice of digits.
 * Transitions are adjacent pairs within the slice.
 */
export function countTransitions(digits: number[]): { matrix: number[][]; rowSum: number[]; total: number } {
  const matrix = Array.from({ length: 10 }, () => Array.from({ length: 10 }, () => 0));
  for (let i = 1; i < digits.length; i++) {
    const a = digits[i - 1];
    const b = digits[i];
    if (a < 0 || a > 9 || b < 0 || b > 9) continue;
    matrix[a][b] += 1;
  }
  const rowSum = matrix.map((row) => row.reduce((s, n) => s + n, 0));
  const total = rowSum.reduce((s, n) => s + n, 0);
  return { matrix, rowSum, total };
}

export function baselineFrequency(digits: number[]): number[] {
  const counts = Array.from({ length: 10 }, () => 0);
  let total = 0;
  for (const d of digits) {
    if (d < 0 || d > 9) continue;
    counts[d] += 1;
    total += 1;
  }
  if (total === 0) return Array.from({ length: 10 }, () => 0.1);
  return counts.map((c) => c / total);
}

/**
 * Pure core: analyse a full digit series and return confirmed transitions plus
 * a noise count. The >=120-sample floor is judged on the whole series; lift
 * must then clear the threshold in every confirm window (last 2k and last 5k
 * ticks) with the same direction. Anything weaker is labelled noise.
 */
export function analyzeDigits(market: string, fullHistory: number[]): { confirmed: TransitionRow[]; noise: number } {
  const tail = fullHistory.slice(-5000);
  if (tail.length < Math.max(...CONFIRM_WINDOWS)) return { confirmed: [], noise: 0 };

  const subWindows = [
    { window: 2000, slice: fullHistory.slice(-2000) },
    { window: 5000, slice: tail },
  ];

  const base = baselineFrequency(fullHistory);
  const fullCounts = countTransitions(fullHistory);
  const estimates = subWindows.map((w) => {
    const t = countTransitions(w.slice);
    return { window: w.window, matrix: t.matrix, rowSum: t.rowSum };
  });

  const confirmed: TransitionRow[] = [];
  let noise = 0;
  const big = estimates.find((e) => e.window === 5000)!;

  for (let a = 0; a < 10; a++) {
    if (fullCounts.rowSum[a] === 0) continue;
    for (let b = 0; b < 10; b++) {
      const lifts: number[] = [];
      if (fullCounts.matrix[a][b] < PATTERN_MIN_SAMPLES) {
        noise += 1;
        continue;
      }
      let pass = true;
      for (const e of estimates) {
        const expected = base[b];
        const lift = e.rowSum[a] > 0 && expected > 0 ? e.matrix[a][b] / e.rowSum[a] / expected : 1;
        lifts.push(lift);
        const over = lift >= LIFT_OVER;
        const under = lift <= LIFT_UNDER;
        if (!over && !under) pass = false;
      }
      if (!pass) {
        noise += 1;
        continue;
      }
      const signs = lifts.map((l) => (l >= LIFT_OVER ? 'over' : 'under'));
      if (new Set(signs).size !== 1) {
        noise += 1;
        continue;
      }
      const condP = big.rowSum[a] > 0 ? big.matrix[a][b] / big.rowSum[a] : 0;
      const expected = Math.max(base[b], 1e-6);
      confirmed.push({
        market,
        prev_digit: a,
        next_digit: b,
        count: big.matrix[a][b],
        frequency: round2(condP),
        expected: round2(expected),
        lift: round2(condP / expected),
        window: big.window,
      });
    }
  }

  return { confirmed, noise };
}

/**
 * Load one market's stored digits and persist its confirmed transitions.
 */
function buildMarketPatterns(market: string): { confirmed: TransitionRow[]; noise: number } {
  const history = digitHistory(market, 100000)
    .filter((h) => h.digit >= 0 && h.digit <= 9)
    .map((h) => h.digit);
  return analyzeDigits(market, history);
}

/** Scan every market, persist confirmed patterns, and report counts. */
export async function scanPatterns(onProgress?: (done: number, total: number, message: string) => void): Promise<PatternScanResult> {
  const markets = listMarkets().map((m) => String(m.symbol));
  const total = markets.length;
  const all: TransitionRow[] = [];
  let confirmed = 0;
  let noise = 0;

  for (let i = 0; i < markets.length; i++) {
    const market = markets[i];
    onProgress?.(i + 1, total, `Scanning ${market} (${i + 1}/${total})`);
    const r = buildMarketPatterns(market);
    all.push(...r.confirmed);
    confirmed += r.confirmed.length;
    noise += r.noise;
    await sleep(0);
  }

  // A scan is a complete replacement of the evidence set. Retaining rows
  // after no transition still qualifies would make stale knowledge influence
  // future live and virtual-paper signals.
  replacePatterns(all);
  return { scannedMarkets: total, inserted: all.length, confirmed, noise };
}

/** Calibration report: scanner est_win vs actual, plus per-barrier and per-strategy actuals. */
export function buildCalibrationReport(): CalibrationReport {
  const cal = getCalibration();

  const byBarrier: CalibrationReport['byBarrier'] = scannerStatsByBarrier().map((r) => ({
    market: r.market,
    direction: r.direction as Direction,
    barrier: r.barrier,
    trades: r.trades,
    wins: r.wins,
    win_rate: r.trades > 0 ? round2((r.wins / r.trades) * 100) : null,
  }));

  const byStrategy: CalibrationReport['byStrategy'] = [];
  for (const run of listTestRuns()) {
    const rate = run.trades > 0 ? round2((run.wins / run.trades) * 100) : null;
    byStrategy.push({
      strategy: run.strategy_mode,
      mode: run.bot_mode,
      kind: run.kind,
      trades: run.trades,
      wins: run.wins,
      win_rate: rate,
    });
  }

  return { buckets: cal.buckets, total: cal.total, byBarrier, byStrategy };
}

export { listPatterns };
