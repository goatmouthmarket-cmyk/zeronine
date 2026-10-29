import { winDigits } from '../core/digitMath.ts';
import type { PaperTick } from './paperSimulator.ts';

/** Independent next-tick observations, not account contracts or live quotes. */
export interface ScoutSample {
  market: string;
  direction: 'over' | 'under';
  barrier: number;
  wins: number;
  losses: number;
  samples: number;
}

const SETUPS = [
  { direction: 'over', barrier: 1 }, { direction: 'over', barrier: 2 },
  { direction: 'under', barrier: 7 }, { direction: 'under', barrier: 8 },
] as const;
const WINDOW = 500;

export class MarketScout {
  private readonly markets = new Map<string, { epoch: number; outcomes: boolean[][] }>();

  onTick(tick: PaperTick): void {
    if (!tick.market || !Number.isFinite(tick.epoch) || !Number.isInteger(tick.digit) || tick.digit < 0 || tick.digit > 9) return;
    let state = this.markets.get(tick.market);
    if (!state) {
      this.markets.set(tick.market, { epoch: tick.epoch, outcomes: SETUPS.map(() => []) });
      return;
    }
    // A duplicate or older tick cannot settle a new virtual observation.
    if (tick.epoch <= state.epoch) return;
    state.epoch = tick.epoch;
    SETUPS.forEach((setup, i) => {
      const results = state!.outcomes[i]!;
      results.push(winDigits(setup.direction, setup.barrier).includes(tick.digit));
      if (results.length > WINDOW) results.shift();
    });
  }

  snapshot(): ScoutSample[] {
    return [...this.markets.entries()].flatMap(([market, state]) => SETUPS.map((setup, i) => {
      const results = state.outcomes[i]!;
      const wins = results.filter(Boolean).length;
      return { market, ...setup, wins, losses: results.length - wins, samples: results.length };
    }));
  }
}
