import { goldDiagnostics, loadGoldConfig } from './config.ts';
import type { GoldConfig, GoldDiagnostics } from './config.ts';

export interface GoldInstrument {
  provider: 'ctrader' | 'deriv';
  symbol: string;
  display: string;
  assetClass: 'metal';
  precision: number | null;
  tradable: boolean;
}

export interface GoldPriceTick {
  provider: 'ctrader' | 'deriv';
  symbol: string;
  epochMs: number;
  bid: number | null;
  ask: number | null;
  last: number;
}

export type GoldPriceListener = (tick: GoldPriceTick) => void;

/**
 * The future provider boundary is intentionally market-data-only. There is no
 * order, quote-for-buy, or account-mutation method in this interface.
 */
export interface GoldMarketDataAdapter {
  diagnostics(): GoldDiagnostics;
  listInstruments(): Promise<GoldInstrument[]>;
  subscribePrices(symbol: string, listener: GoldPriceListener): Promise<() => void>;
  close(): Promise<void>;
}

export class GoldAdapterUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GoldAdapterUnavailableError';
  }
}

/**
 * A non-networking cTrader placeholder. It makes configuration observable
 * without initiating authentication, subscribing to prices, or creating an
 * execution surface. Replacing it requires a separate market-data adapter.
 */
export class CTraderGoldClient implements GoldMarketDataAdapter {
  readonly config: GoldConfig;

  constructor(config: GoldConfig = loadGoldConfig()) {
    this.config = config;
  }

  diagnostics(): GoldDiagnostics {
    return goldDiagnostics(this.config);
  }

  async listInstruments(): Promise<GoldInstrument[]> {
    throw new GoldAdapterUnavailableError(this.diagnostics().reason);
  }

  async subscribePrices(_symbol: string, _listener: GoldPriceListener): Promise<() => void> {
    throw new GoldAdapterUnavailableError(this.diagnostics().reason);
  }

  async close(): Promise<void> {
    // There is no network connection to close in the safe default stub.
  }
}

export function createCTraderGoldClient(config: GoldConfig = loadGoldConfig()): GoldMarketDataAdapter {
  return new CTraderGoldClient(config);
}
