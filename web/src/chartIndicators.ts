import type { LineData, Time } from 'lightweight-charts';

export interface ChartIndicators {
  emaFast: LineData<Time>[];
  emaSlow: LineData<Time>[];
  bandUpper: LineData<Time>[];
  bandLower: LineData<Time>[];
}

/** Visual research overlays only. They never feed an execution decision. */
export function calculateChartIndicators(points: LineData<Time>[], fastPeriod = 13, slowPeriod = 34, bandPeriod = 20): ChartIndicators {
  const emaFast: LineData<Time>[] = [];
  const emaSlow: LineData<Time>[] = [];
  const bandUpper: LineData<Time>[] = [];
  const bandLower: LineData<Time>[] = [];
  let fast = Number.NaN;
  let slow = Number.NaN;
  const fastAlpha = 2 / (fastPeriod + 1);
  const slowAlpha = 2 / (slowPeriod + 1);
  for (let index = 0; index < points.length; index += 1) {
    const point = points[index]!;
    fast = Number.isFinite(fast) ? fast + fastAlpha * (point.value - fast) : point.value;
    slow = Number.isFinite(slow) ? slow + slowAlpha * (point.value - slow) : point.value;
    emaFast.push({ time: point.time, value: fast });
    emaSlow.push({ time: point.time, value: slow });
    if (index + 1 < bandPeriod) continue;
    const sample = points.slice(index + 1 - bandPeriod, index + 1).map((candidate) => candidate.value);
    const mean = sample.reduce((sum, value) => sum + value, 0) / sample.length;
    const deviation = Math.sqrt(sample.reduce((sum, value) => sum + (value - mean) ** 2, 0) / sample.length);
    bandUpper.push({ time: point.time, value: mean + 2 * deviation });
    bandLower.push({ time: point.time, value: mean - 2 * deviation });
  }
  return { emaFast, emaSlow, bandUpper, bandLower };
}
