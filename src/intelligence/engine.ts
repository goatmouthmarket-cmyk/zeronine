import type { MarketRegistry } from '../core/marketState.ts';
import { scanMarket } from '../strategy/scanner.ts';
import type { MarketScan, PatternInput } from '../strategy/scanner.ts';
import type { DigitProvider } from '../strategy/signal.ts';
import { assessMarketHealth } from './health.ts';
import type { MarketHealth } from './health.ts';
import { assessRegime } from './regime.ts';
import type { RegimeAssessment } from './regime.ts';

/**
 * Shared statistical view for one decision cycle. Consumers may attach their
 * lightweight assessments to MarketIntelligence without re-reading history.
 */
export interface MarketIntelligence {
  scan: MarketScan;
  health: MarketHealth;
  regime: RegimeAssessment;
}

export interface IntelligenceSnapshot {
  at: number;
  markets: Map<string, MarketIntelligence>;
}

/**
 * Builds the primary rolling-window calculation pass. The engine deliberately
 * owns no timer or persistence: callers choose their decision cadence, then
 * pass this immutable-in-practice snapshot to signals and future modules.
 */
export class IntelligenceEngine {
  private readonly registry: MarketRegistry;
  private readonly digits: DigitProvider;
  private readonly previous = new Map<string, MarketIntelligence>();

  constructor(
    registry: MarketRegistry,
    digits: DigitProvider,
  ) {
    this.registry = registry;
    this.digits = digits;
  }

  snapshot(pattern?: PatternInput | null): IntelligenceSnapshot {
    const markets = new Map<string, MarketIntelligence>();
    for (const snap of this.registry.allSnapshots()) {
      if (!snap.fresh) continue;
      const history = this.digits(snap.symbol, 1000);
      const scan = scanMarket(snap.symbol, snap.display, history.length ? history : snap.recentDigits, pattern);
      const prior = this.previous.get(snap.symbol);
      markets.set(snap.symbol, {
        scan,
        health: assessMarketHealth(scan, prior?.health),
        regime: assessRegime(scan, prior?.regime),
      });
    }
    this.previous.clear();
    for (const [symbol, intelligence] of markets) this.previous.set(symbol, intelligence);
    return { at: Date.now(), markets };
  }
}

/** Pure adapter for replay and tests that already have market histories. */
export function intelligenceFromScans(scans: Iterable<MarketScan>, at = Date.now()): IntelligenceSnapshot {
  const markets = new Map<string, MarketIntelligence>();
  for (const scan of scans) {
    markets.set(scan.symbol, { scan, health: assessMarketHealth(scan), regime: assessRegime(scan, undefined, at) });
  }
  return { at, markets };
}
