/**
 * Provider-neutral vocabulary for the Gold CFD domain.  Adapters translate a
 * broker protocol into these values; research and risk code never see a
 * cTrader (or future broker) wire payload directly.
 */

export type GoldTimeframe = '1m' | '5m' | '15m' | '1h';
export type GoldEnvironment = 'research' | 'paper' | 'demo' | 'live';
export type GoldSide = 'BUY' | 'SELL';
export type GoldMarketStatus = 'open' | 'closed' | 'suspended' | 'unavailable';
export type GoldOrderStatus = 'accepted' | 'rejected' | 'pending' | 'filled' | 'cancelled' | 'unknown';

export const GOLD_TIMEFRAME_MS: Record<GoldTimeframe, number> = {
  '1m': 60_000,
  '5m': 5 * 60_000,
  '15m': 15 * 60_000,
  '1h': 60 * 60_000,
};

export interface GoldTradingSession {
  /** IANA weekday number: 0 Sunday through 6 Saturday. */
  dayOfWeek: number;
  opensAt: string;
  closesAt: string;
}

export interface GoldSymbol {
  id: string;
  name: string;
  displayName: string;
  digits: number;
  pointSize: number;
  pipSize: number;
  minVolume: number;
  maxVolume: number;
  volumeStep: number;
  minStopDistance: number;
  marginRate: number | null;
  tradingStatus: GoldMarketStatus;
  sessions: GoldTradingSession[];
}

export interface GoldQuote {
  symbolId: string;
  bid: number;
  ask: number;
  mid: number;
  spread: number;
  /** Broker event timestamp in milliseconds since epoch. */
  timestamp: number;
  /** Server receipt timestamp, retained separately for feed diagnostics. */
  receivedAt: number;
  sequence?: number;
}

export interface GoldCandle {
  symbolId: string;
  timeframe: GoldTimeframe;
  /** Start of the broker candle interval, in milliseconds since epoch. */
  openTime: number;
  closeTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  tickVolume: number | null;
  complete: boolean;
}

export interface GoldAccountState {
  accountId: string;
  environment: Extract<GoldEnvironment, 'demo' | 'live'>;
  currency: string;
  balance: number;
  equity: number;
  marginUsed: number;
  freeMargin: number;
  leverage: number | null;
  connected: boolean;
}

export interface GoldPosition {
  id: string;
  accountId: string;
  symbolId: string;
  side: GoldSide;
  volume: number;
  entryPrice: number;
  currentPrice: number | null;
  stopLoss: number | null;
  takeProfit: number | null;
  unrealizedPnl: number | null;
  openedAt: number;
  updatedAt: number;
}

export interface GoldOrderRequest {
  accountId: string;
  symbolId: string;
  side: GoldSide;
  volume: number;
  stopLoss: number | null;
  takeProfit: number | null;
  clientOrderId: string;
  idempotencyKey: string;
  requestedAt: number;
}

export interface GoldOrderPreview {
  accepted: boolean;
  reason: string | null;
  estimatedEntryPrice: number | null;
  estimatedSpreadCost: number | null;
  estimatedCommission: number | null;
  estimatedMargin: number | null;
  brokerRequestId: string | null;
}

export interface GoldOrderResult {
  status: GoldOrderStatus;
  brokerOrderId: string | null;
  brokerPositionId: string | null;
  filledPrice: number | null;
  filledVolume: number | null;
  message: string | null;
  receivedAt: number;
}

export interface GoldCloseRequest {
  accountId: string;
  positionId: string;
  volume: number | null;
  idempotencyKey: string;
  requestedAt: number;
}

export interface GoldModifyRequest {
  accountId: string;
  positionId: string;
  stopLoss: number | null;
  takeProfit: number | null;
  idempotencyKey: string;
  requestedAt: number;
}

/** A market-data adapter cannot submit, preview, or alter an order. */
export interface GoldMarketAdapter {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  getSymbols(accountId: string): Promise<GoldSymbol[]>;
  subscribeQuotes(accountId: string, symbolId: string): Promise<void>;
  unsubscribeQuotes?(accountId: string, symbolId: string): Promise<void>;
  getCandles(accountId: string, symbolId: string, timeframe: GoldTimeframe, count: number): Promise<GoldCandle[]>;
}

/** Execution stays behind this boundary so a future provider can be swapped in. */
export interface GoldExecutionAdapter {
  getAccount(accountId: string): Promise<GoldAccountState>;
  getPositions(accountId: string): Promise<GoldPosition[]>;
  previewOrder(request: GoldOrderRequest): Promise<GoldOrderPreview>;
  placeOrder(request: GoldOrderRequest): Promise<GoldOrderResult>;
  closePosition(request: GoldCloseRequest): Promise<GoldOrderResult>;
  modifyPosition(request: GoldModifyRequest): Promise<GoldOrderResult>;
}

/**
 * Creates a canonical quote from bid/ask feeds.  Adapters should discard
 * duplicate and out-of-order ticks before publishing them to research.
 */
export function normalizeGoldQuote(input: Omit<GoldQuote, 'mid' | 'spread'> & Partial<Pick<GoldQuote, 'mid' | 'spread'>>): GoldQuote {
  if (!Number.isFinite(input.bid) || !Number.isFinite(input.ask) || input.bid <= 0 || input.ask <= 0 || input.ask < input.bid) {
    throw new Error('invalid Gold bid/ask quote');
  }
  if (!Number.isFinite(input.timestamp) || !Number.isFinite(input.receivedAt)) throw new Error('invalid Gold quote timestamp');
  const mid = (input.bid + input.ask) / 2;
  return { ...input, mid, spread: input.ask - input.bid };
}

export function isNewerGoldQuote(previous: GoldQuote | null, next: GoldQuote): boolean {
  if (!previous) return true;
  if (next.sequence !== undefined && previous.sequence !== undefined) return next.sequence > previous.sequence;
  return next.timestamp > previous.timestamp;
}
