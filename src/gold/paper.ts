import { isNewerGoldQuote, type GoldQuote, type GoldSide, type GoldSymbol } from './domain.ts';

const EPSILON = 1e-9;

export interface GoldPaperConfig {
  initialBalance: number;
  currency?: string;
  /** Adverse fill adjustment applied to every entry and exit, in basis points. */
  slippageBps?: number;
  /** Currency charged per unit of volume at both entry and exit. */
  commissionPerUnit?: number;
  /** Used when a broker symbol does not publish a margin rate. */
  defaultMarginRate?: number;
  /** Gold paper trading is conservative by default: one position at a time. */
  onePositionOnly?: boolean;
  maxQuoteAgeMs?: number;
}

export interface GoldPaperOrder {
  symbol: GoldSymbol;
  side: GoldSide;
  volume: number;
  quote: GoldQuote;
  stopLoss?: number | null;
  takeProfit?: number | null;
  now: number;
  origin?: 'manual' | 'automatic_research';
  researchSignalId?: string | null;
}

export interface GoldPaperPosition {
  id: string;
  symbolId: string;
  symbol: string;
  side: GoldSide;
  volume: number;
  entryPrice: number;
  stopLoss: number | null;
  takeProfit: number | null;
  entryCommission: number;
  marginUsed: number;
  openedAt: number;
  updatedAt: number;
  markPrice: number | null;
  unrealizedPnl: number;
  origin: 'manual' | 'automatic_research';
  researchSignalId: string | null;
}

export type GoldPaperCloseReason = 'manual' | 'stop_loss' | 'take_profit';

export interface GoldPaperTrade extends GoldPaperPosition {
  exitPrice: number;
  closedAt: number;
  exitCommission: number;
  grossPnl: number;
  /** P&L after both entry and exit commission. */
  netPnl: number;
  closeReason: GoldPaperCloseReason;
}

export interface GoldPaperState {
  currency: string;
  initialBalance: number;
  balance: number;
  equity: number;
  realizedPnl: number;
  unrealizedPnl: number;
  marginUsed: number;
  freeMargin: number;
  peakEquity: number;
  drawdown: number;
  positions: GoldPaperPosition[];
  closedTrades: GoldPaperTrade[];
}

export type GoldPaperOpenResult =
  | { accepted: true; position: GoldPaperPosition; state: GoldPaperState }
  | { accepted: false; reason: string; state: GoldPaperState };

export type GoldPaperCloseResult =
  | { closed: true; trade: GoldPaperTrade; state: GoldPaperState }
  | { closed: false; reason: string; state: GoldPaperState };

interface ResolvedConfig {
  initialBalance: number;
  currency: string;
  slippageBps: number;
  commissionPerUnit: number;
  defaultMarginRate: number;
  onePositionOnly: boolean;
  maxQuoteAgeMs: number;
}

function rounded(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function finitePositive(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function resolveConfig(config: GoldPaperConfig): ResolvedConfig {
  const resolved: ResolvedConfig = {
    initialBalance: config.initialBalance,
    currency: config.currency ?? 'USD',
    slippageBps: config.slippageBps ?? 0,
    commissionPerUnit: config.commissionPerUnit ?? 0,
    defaultMarginRate: config.defaultMarginRate ?? .02,
    onePositionOnly: config.onePositionOnly ?? true,
    maxQuoteAgeMs: config.maxQuoteAgeMs ?? 10_000,
  };
  if (!finitePositive(resolved.initialBalance)) throw new Error('Gold paper initial balance must be positive');
  if (!resolved.currency.trim()) throw new Error('Gold paper currency is required');
  if (!Number.isFinite(resolved.slippageBps) || resolved.slippageBps < 0 || resolved.slippageBps > 1_000) throw new Error('Gold paper slippage must be between 0 and 1000 bps');
  if (!Number.isFinite(resolved.commissionPerUnit) || resolved.commissionPerUnit < 0) throw new Error('Gold paper commission must be non-negative');
  if (!Number.isFinite(resolved.defaultMarginRate) || resolved.defaultMarginRate <= 0 || resolved.defaultMarginRate > 1) throw new Error('Gold paper default margin rate must be within (0, 1]');
  if (!Number.isFinite(resolved.maxQuoteAgeMs) || resolved.maxQuoteAgeMs <= 0) throw new Error('Gold paper maximum quote age must be positive');
  return resolved;
}

/**
 * Pure virtual CFD book. It accepts already-normalized prices and cannot
 * connect to, authorize, or submit orders to any external broker.
 */
export class GoldPaperEngine {
  private readonly config: ResolvedConfig;
  private balance: number;
  private peakEquity: number;
  private nextPositionId = 1;
  private readonly positions = new Map<string, GoldPaperPosition>();
  private readonly closedTrades: GoldPaperTrade[] = [];
  private readonly quotes = new Map<string, GoldQuote>();

  constructor(config: GoldPaperConfig) {
    this.config = resolveConfig(config);
    this.balance = this.config.initialBalance;
    this.peakEquity = this.balance;
  }

  state(): GoldPaperState {
    const positions = [...this.positions.values()].map((position) => clone(position));
    const unrealizedPnl = rounded(positions.reduce((total, position) => total + position.unrealizedPnl, 0));
    const marginUsed = rounded(positions.reduce((total, position) => total + position.marginUsed, 0));
    const equity = rounded(this.balance + unrealizedPnl);
    this.peakEquity = Math.max(this.peakEquity, equity);
    return {
      currency: this.config.currency,
      initialBalance: this.config.initialBalance,
      balance: rounded(this.balance),
      equity,
      realizedPnl: rounded(this.balance - this.config.initialBalance),
      unrealizedPnl,
      marginUsed,
      freeMargin: rounded(equity - marginUsed),
      peakEquity: rounded(this.peakEquity),
      drawdown: rounded(Math.max(0, this.peakEquity - equity)),
      positions,
      closedTrades: this.closedTrades.map((trade) => clone(trade)),
    };
  }

  /** Validates risk-relevant inputs and opens at the executable bid/ask side. */
  open(order: GoldPaperOrder): GoldPaperOpenResult {
    const rejection = this.validateOrder(order);
    if (rejection) return { accepted: false, reason: rejection, state: this.state() };
    const previousQuote = this.quotes.get(order.quote.symbolId) ?? null;
    if (!isNewerGoldQuote(previousQuote, order.quote)) return this.reject('Gold paper entry quote is out of order');
    if (this.config.onePositionOnly && this.positions.size > 0) return this.reject('one Gold paper position is already open');

    const entryPrice = this.adverseEntryPrice(order.side, order.quote);
    const marginRate = order.symbol.marginRate ?? this.config.defaultMarginRate;
    const marginUsed = rounded(entryPrice * order.volume * marginRate);
    const entryCommission = rounded(order.volume * this.config.commissionPerUnit);
    const provisionalEquity = this.balance - entryCommission;
    const usedMargin = [...this.positions.values()].reduce((sum, position) => sum + position.marginUsed, 0);
    if (provisionalEquity - usedMargin - marginUsed < -EPSILON) return this.reject('insufficient virtual free margin');

    this.balance = rounded(this.balance - entryCommission);
    const entryMark = this.exitPrice(order.side, order.quote);
    const position: GoldPaperPosition = {
      id: `gold-paper-${this.nextPositionId++}`,
      symbolId: order.symbol.id,
      symbol: order.symbol.name,
      side: order.side,
      volume: order.volume,
      entryPrice,
      stopLoss: order.stopLoss ?? null,
      takeProfit: order.takeProfit ?? null,
      entryCommission,
      marginUsed,
      openedAt: order.now,
      updatedAt: order.now,
      markPrice: entryMark,
      unrealizedPnl: 0,
      origin: order.origin ?? 'manual',
      researchSignalId: order.researchSignalId ?? null,
    };
    position.unrealizedPnl = rounded(this.grossPnl(position, entryMark));
    this.positions.set(position.id, position);
    this.recordQuote(order.quote);
    return { accepted: true, position: clone(position), state: this.state() };
  }

  /** Marks positions to executable prices and settles any confirmed SL/TP hit. */
  onQuote(quote: GoldQuote): GoldPaperCloseResult[] {
    if (!this.validQuote(quote)) return [];
    const previous = this.quotes.get(quote.symbolId) ?? null;
    if (!isNewerGoldQuote(previous, quote)) return [];
    this.recordQuote(quote);
    const settled: GoldPaperCloseResult[] = [];
    for (const position of [...this.positions.values()]) {
      if (position.symbolId !== quote.symbolId) continue;
      const close = this.triggeredClose(position, quote);
      if (close) settled.push(this.closeAt(position, close.price, quote.timestamp, close.reason));
      else {
        position.markPrice = this.exitPrice(position.side, quote);
        position.unrealizedPnl = rounded(this.grossPnl(position, position.markPrice));
        position.updatedAt = quote.timestamp;
      }
    }
    this.state();
    return settled;
  }

  /** A manual close always uses the executable opposite side of the supplied quote. */
  close(positionId: string, quote: GoldQuote, now: number): GoldPaperCloseResult {
    const position = this.positions.get(positionId);
    if (!position) return { closed: false, reason: 'Gold paper position was not found', state: this.state() };
    if (position.symbolId !== quote.symbolId) return { closed: false, reason: 'quote does not match Gold paper position', state: this.state() };
    if (!this.validQuote(quote) || !Number.isFinite(now) || now < quote.timestamp || now - quote.timestamp > this.config.maxQuoteAgeMs) return { closed: false, reason: 'Gold paper close quote is stale or invalid', state: this.state() };
    const previousQuote = this.quotes.get(quote.symbolId) ?? null;
    if (!isNewerGoldQuote(previousQuote, quote)) return { closed: false, reason: 'Gold paper close quote is out of order', state: this.state() };
    this.recordQuote(quote);
    return this.closeAt(position, this.exitPrice(position.side, quote), now, 'manual');
  }

  reset(): GoldPaperState {
    this.balance = this.config.initialBalance;
    this.peakEquity = this.balance;
    this.nextPositionId = 1;
    this.positions.clear();
    this.closedTrades.length = 0;
    this.quotes.clear();
    return this.state();
  }

  private validateOrder(order: GoldPaperOrder): string | null {
    if (!order.symbol?.id || !order.symbol.name) return 'Gold paper symbol is required';
    if (order.symbol.tradingStatus !== 'open') return 'Gold market is not open';
    if (order.side !== 'BUY' && order.side !== 'SELL') return 'Gold paper side must be BUY or SELL';
    if (!finitePositive(order.volume) || order.volume < order.symbol.minVolume - EPSILON || order.volume > order.symbol.maxVolume + EPSILON) return 'Gold paper volume is outside symbol limits';
    const steps = (order.volume - order.symbol.minVolume) / order.symbol.volumeStep;
    if (!Number.isFinite(order.symbol.volumeStep) || order.symbol.volumeStep <= 0 || Math.abs(steps - Math.round(steps)) > EPSILON) return 'Gold paper volume does not match symbol step';
    if (!this.validQuote(order.quote) || order.quote.symbolId !== order.symbol.id) return 'invalid Gold paper entry quote';
    if (!Number.isFinite(order.now) || order.now < order.quote.timestamp || order.now - order.quote.timestamp > this.config.maxQuoteAgeMs) return 'Gold paper entry quote is stale';
    if (order.symbol.marginRate !== null && (!Number.isFinite(order.symbol.marginRate) || order.symbol.marginRate <= 0 || order.symbol.marginRate > 1)) return 'Gold symbol margin rate is invalid';
    return this.validateStops(order);
  }

  private validateStops(order: GoldPaperOrder): string | null {
    const entryPrice = this.adverseEntryPrice(order.side, order.quote);
    const stopLoss = order.stopLoss ?? null;
    const takeProfit = order.takeProfit ?? null;
    if (stopLoss !== null && !finitePositive(stopLoss)) return 'Gold paper stop loss must be a positive price';
    if (takeProfit !== null && !finitePositive(takeProfit)) return 'Gold paper take profit must be a positive price';
    const distance = order.symbol.minStopDistance;
    if (!Number.isFinite(distance) || distance < 0) return 'Gold symbol minimum stop distance is invalid';
    if (order.side === 'BUY') {
      if (stopLoss !== null && (stopLoss >= entryPrice || entryPrice - stopLoss + EPSILON < distance)) return 'Gold BUY stop loss must be below entry and outside the minimum stop distance';
      if (takeProfit !== null && (takeProfit <= entryPrice || takeProfit - entryPrice + EPSILON < distance)) return 'Gold BUY take profit must be above entry and outside the minimum stop distance';
    } else {
      if (stopLoss !== null && (stopLoss <= entryPrice || stopLoss - entryPrice + EPSILON < distance)) return 'Gold SELL stop loss must be above entry and outside the minimum stop distance';
      if (takeProfit !== null && (takeProfit >= entryPrice || entryPrice - takeProfit + EPSILON < distance)) return 'Gold SELL take profit must be below entry and outside the minimum stop distance';
    }
    return null;
  }

  private triggeredClose(position: GoldPaperPosition, quote: GoldQuote): { price: number; reason: GoldPaperCloseReason } | null {
    if (position.side === 'BUY') {
      if (position.stopLoss !== null && quote.bid <= position.stopLoss) return { price: Math.min(position.stopLoss, this.exitPrice(position.side, quote)), reason: 'stop_loss' };
      if (position.takeProfit !== null && quote.bid >= position.takeProfit) return { price: position.takeProfit, reason: 'take_profit' };
    } else {
      if (position.stopLoss !== null && quote.ask >= position.stopLoss) return { price: Math.max(position.stopLoss, this.exitPrice(position.side, quote)), reason: 'stop_loss' };
      if (position.takeProfit !== null && quote.ask <= position.takeProfit) return { price: position.takeProfit, reason: 'take_profit' };
    }
    return null;
  }

  private closeAt(position: GoldPaperPosition, exitPrice: number, closedAt: number, closeReason: GoldPaperCloseReason): GoldPaperCloseResult {
    const exitCommission = rounded(position.volume * this.config.commissionPerUnit);
    const grossPnl = rounded(this.grossPnl(position, exitPrice));
    const trade: GoldPaperTrade = {
      ...position,
      exitPrice,
      closedAt,
      exitCommission,
      grossPnl,
      netPnl: rounded(grossPnl - position.entryCommission - exitCommission),
      closeReason,
      markPrice: exitPrice,
      unrealizedPnl: 0,
      updatedAt: closedAt,
    };
    this.positions.delete(position.id);
    this.closedTrades.push(trade);
    this.balance = rounded(this.balance + grossPnl - exitCommission);
    return { closed: true, trade: clone(trade), state: this.state() };
  }

  private reject(reason: string): GoldPaperOpenResult {
    return { accepted: false, reason, state: this.state() };
  }

  private adverseEntryPrice(side: GoldSide, quote: GoldQuote): number {
    const factor = this.config.slippageBps / 10_000;
    return side === 'BUY' ? quote.ask * (1 + factor) : quote.bid * (1 - factor);
  }

  private exitPrice(side: GoldSide, quote: GoldQuote): number {
    const factor = this.config.slippageBps / 10_000;
    return side === 'BUY' ? quote.bid * (1 - factor) : quote.ask * (1 + factor);
  }

  private grossPnl(position: GoldPaperPosition, exitPrice: number): number {
    return (position.side === 'BUY' ? exitPrice - position.entryPrice : position.entryPrice - exitPrice) * position.volume;
  }

  private recordQuote(quote: GoldQuote): void {
    const previous = this.quotes.get(quote.symbolId) ?? null;
    if (!previous || isNewerGoldQuote(previous, quote)) this.quotes.set(quote.symbolId, clone(quote));
  }

  private validQuote(quote: GoldQuote): boolean {
    return Boolean(quote?.symbolId)
      && finitePositive(quote.bid)
      && finitePositive(quote.ask)
      && quote.ask >= quote.bid
      && Number.isFinite(quote.timestamp)
      && Number.isFinite(quote.receivedAt);
  }
}
