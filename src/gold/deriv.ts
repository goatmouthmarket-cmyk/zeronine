import { config } from '../config.ts';
import type { GoldDiagnostics } from './config.ts';
import type { GoldInstrument, GoldMarketDataAdapter, GoldPriceListener } from './ctrader.ts';

export function derivGoldSymbolMetadata(symbol = config.goldDerivSymbol, display = config.goldDerivDisplay): GoldInstrument {
  return {
    provider: 'deriv',
    symbol,
    display,
    assetClass: 'metal',
    precision: 2,
    tradable: true,
  };
}

export class DerivGoldMarketDataAdapter implements GoldMarketDataAdapter {
  private readonly symbol: string;
  private readonly display: string;

  constructor(options: { symbol?: string; display?: string } = {}) {
    this.symbol = options.symbol ?? config.goldDerivSymbol;
    this.display = options.display ?? config.goldDerivDisplay;
  }

  diagnostics(): GoldDiagnostics {
    return {
      provider: 'deriv',
      status: 'market_data_active',
      symbol: this.symbol,
      requestedAccountMode: 'demo',
      liveEnabled: false,
      marketDataCapable: true,
      executionCapable: true,
      configured: true,
      missing: [],
      validationErrors: [],
      reason: 'Deriv Gold market data is active. Demo multiplier orders use the connected Deriv account and live proposal gates.',
    };
  }

  async listInstruments(): Promise<GoldInstrument[]> {
    return [derivGoldSymbolMetadata(this.symbol, this.display)];
  }

  async subscribePrices(_symbol: string, _listener: GoldPriceListener): Promise<() => void> {
    // Runtime market-data ingress is driven by DerivGoldFeed so it can share the
    // service websocket lifecycle. This adapter is intentionally diagnostic.
    return () => undefined;
  }

  async close(): Promise<void> {
    // No owned network resource.
  }
}

