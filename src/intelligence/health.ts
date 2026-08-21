import type { MarketScan } from '../strategy/scanner.ts';

export interface MarketHealth {
  score: number;
  label: 'excellent' | 'healthy' | 'weak' | 'avoid';
  trend: 'improving' | 'stable' | 'deteriorating';
  reasons: string[];
}

function clamp(n: number): number {
  return Math.max(0, Math.min(100, n));
}

/**
 * Describes the quality of observed scanner evidence, not the predictability
 * of a market. It is deliberately pure so replays and live snapshots agree.
 */
export function assessMarketHealth(scan: MarketScan, previous?: MarketHealth): MarketHealth {
  const consistency = scan.features.reduce((sum, feature) => sum + feature.consistency, 0) / Math.max(1, scan.features.length);
  const entropy = scan.features[0]?.entropy ?? 0;
  const strongest = scan.features.reduce((best, feature) => Math.max(best, feature.estimatedWin - feature.theoreticalWin), 0);
  const sampleScore = Math.min(1, scan.samples / 250);
  const score = Math.round(clamp(sampleScore * 30 + consistency * 40 + entropy * 20 + Math.min(1, strongest / 0.08) * 10));
  const label: MarketHealth['label'] = score >= 80 ? 'excellent' : score >= 60 ? 'healthy' : score >= 40 ? 'weak' : 'avoid';
  const trend: MarketHealth['trend'] = previous == null || Math.abs(score - previous.score) < 5
    ? 'stable'
    : score > previous.score ? 'improving' : 'deteriorating';
  const reasons: string[] = [];
  if (scan.samples < 100) reasons.push('limited recent sample');
  if (consistency < 0.55) reasons.push('unstable short windows');
  if (entropy < 0.7) reasons.push('concentrated digit distribution');
  if (reasons.length === 0) reasons.push('consistent observed distribution');
  return { score, label, trend, reasons };
}
