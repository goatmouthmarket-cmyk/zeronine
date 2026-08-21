import type { MarketScan } from '../strategy/scanner.ts';

export type MarketRegime = 'stable' | 'favorable' | 'transitioning' | 'volatile' | 'loss_cluster' | 'uncertain';

export interface RegimeAssessment {
  regime: MarketRegime;
  confidence: number;
  since: number;
  reasons: string[];
}

function clamp(n: number): number {
  return Math.max(0, Math.min(100, n));
}

/** Classifies observed feature stability with light hysteresis, never a forecast. */
export function assessRegime(scan: MarketScan, previous?: RegimeAssessment, now = Date.now()): RegimeAssessment {
  const consistency = scan.features.reduce((sum, feature) => sum + feature.consistency, 0) / Math.max(1, scan.features.length);
  const movement = scan.features.reduce((sum, feature) => sum + Math.abs(feature.shortLongDeviation), 0) / Math.max(1, scan.features.length);
  const entropy = scan.features[0]?.entropy ?? 0;
  let regime: MarketRegime = 'stable';
  const reasons: string[] = [];
  if (scan.samples < 100) {
    regime = 'uncertain';
    reasons.push('insufficient sample');
  } else if (consistency < 0.45) {
    regime = 'volatile';
    reasons.push('low window consistency');
  } else if (movement > 0.12 && consistency < 0.65) {
    regime = 'transitioning';
    reasons.push('short and long windows diverge');
  } else if (entropy < 0.62 && movement > 0.08) {
    regime = 'loss_cluster';
    reasons.push('concentrated recent digits');
  } else if (movement > 0.06 && consistency >= 0.65) {
    regime = 'favorable';
    reasons.push('consistent observed tilt');
  } else {
    reasons.push('stable observed windows');
  }
  const confidence = Math.round(clamp(Math.min(1, scan.samples / 250) * 45 + consistency * 35 + Math.min(1, movement / 0.12) * 20));
  // Avoid flip-flopping on marginal evidence; strong classifications can still change.
  if (previous && previous.regime !== regime && confidence < 65) {
    return { ...previous, confidence, reasons: [...previous.reasons, 'holding prior regime pending stronger evidence'] };
  }
  return { regime, confidence, since: previous?.regime === regime ? previous.since : now, reasons };
}
