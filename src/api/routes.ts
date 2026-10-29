import type { FastifyInstance } from 'fastify';
import { config } from '../config.ts';
import { GoldRuntime, GoldRuntimeUnavailableError } from '../gold/runtime.ts';
import { GoldOAuthError } from '../gold/onboarding.ts';
import { assessGoldProfitProtection } from '../gold/profitProtection.ts';
import { AccountCoordinator } from '../execution/accountCoordinator.ts';
import { grantOwner, isOwner, publicDashboardEnabled, requireOwner } from './access.ts';
import type { DerivPublicFeed } from '../deriv/publicFeed.ts';
import type { DerivPrivateClient } from '../deriv/privateClient.ts';
import { listDerivAccounts } from '../deriv/privateClient.ts';
import type { Hub } from './hub.ts';
import type { MarketRegistry } from '../core/marketState.ts';
import type { Automation } from '../strategy/automation.ts';
import type { PaperSimulator } from '../simulation/paperSimulator.ts';
import type { MomentumObserver } from '../momentum/observer.ts';
import { momentumEntryGuard } from '../momentum/observer.ts';
import { encryptToken } from '../db/crypto.ts';
import {
  buildAuthorizeUrl,
  exchangeOauthCode,
  newPkce,
  resolveStoredToken,
  serializeOAuth,
} from '../deriv/oauth.ts';
import type { TokenSet } from '../deriv/oauth.ts';
import type { Direction, MultiplierDirection } from '../core/digitMath.ts';
import { contractProfit } from '../strategy/pnl.ts';
import { buildRecoveryContext, riskCheck } from '../strategy/risk.ts';
import { runBacktest, TEST_MODES, TEST_STRATEGIES } from '../testlab/backtest.ts';
import { entryLabDashboardState, type EntryResearchRuntime } from '../testlab/entryRuntime.ts';
import type { TestConfig } from '../testlab/backtest.ts';
import { buildCalibrationReport, listPatterns as listStoredPatterns, scanPatterns } from '../testlab/patterns.ts';
import { buildDecisionEvidenceReport } from '../testlab/evidence.ts';
import {
  type TradeRow,
  clearSession,
  getAutomation as storeGetAutomation,
  getCalibration,
  getMeta,
  getMomentumResearchProfile,
  getOpenTrade,
  getOpenTradeByLane,
  isGoldMultiplierTrade,
  isMomentumMultiplierTrade,
  getTrade,
  getPerformanceSummary,
  getPaperTrade,
  getRecovery,
  getSession,
  getSettings,
  insertTrade,
  listMarkets,
  listGoldPredictionEvidence,
  listGoldTradeKnowledge,
  listOpenTrades,
  listDecisionEvents,
  listLedgerEntries,
  listPaperLedgerEntries,
  listPaperTrades,
  listTestRuns,
  listTrades,
  digitTradeEvidence,
  markTradePurchaseOutcomeUnknown,
  markTradePurchased,
  recordGoldTradeKnowledge,
  resolveGoldTradeKnowledge,
  resolveTrade,
  resetPerformanceSummary,
  setAutomation as storeSetAutomation,
  setSession,
  updateSettings,
} from '../db/store.ts';

export interface ApiDeps {
  registry: MarketRegistry;
  feed: DerivPublicFeed;
  client: DerivPrivateClient;
  hub: Hub;
  automation: Automation;
  paperSimulator: PaperSimulator;
  momentum?: MomentumObserver;
  gold?: GoldRuntime;
  /** Virtual-only continuous entry research. It never authorizes an order. */
  entryResearch?: EntryResearchRuntime;
  /** Shared command lane for account-funded Deriv operations. */
  accountCoordinator?: AccountCoordinator;
}

export function registerApi(app: FastifyInstance, deps: ApiDeps): void {
  const { registry, feed, client, hub, automation, paperSimulator, momentum } = deps;
  const gold = deps.gold ?? new GoldRuntime();
  const entryResearch = deps.entryResearch;
  // The coordinator is deliberately per API runtime unless main supplies a
  // process-level instance. It serializes short provider commands only; quote
  // streaming and settlement subscriptions stay independent and responsive.
  const accountCoordinator = deps.accountCoordinator ?? new AccountCoordinator();
  const oauthPending = new Map<string, { verifier: string; created: number }>();
  const multiplierProbeCache = new Map<string, { ts: number; result: MultiplierProbeResult }>();
  type ManualEntryMode = 'instant' | 'model' | 'digit-trigger' | 'digit-trigger-confirmed';
  type ManualOrderInput = {
    market: string;
    direction: Direction;
    barrier: number;
    stake: number;
    entryMode: ManualEntryMode;
    companionDemo: boolean;
  };
  type ManualPreview = {
    id: string;
    accountId: string;
    createdAt: number;
    expiresAt: number;
    order: ManualOrderInput;
    ask: number;
    payout: number;
    estimatedWin: number;
    breakeven: number;
    edge: number;
    consumedBy?: string;
  };
  type ManualExecutionResponse = { status: number; body: Record<string, unknown> };
  const manualPreviews = new Map<string, ManualPreview>();
  const manualExecutions = new Map<string, { signature: string; expiresAt: number; promise: Promise<ManualExecutionResponse> }>();
  const manualLaneLocks = new Map<string, string>();
  const MANUAL_PREVIEW_TTL_MS = 30_000;
  const MANUAL_IDEMPOTENCY_TTL_MS = 5 * 60_000;

  class ManualRequestError extends Error {
    readonly status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  }

  const accountIdForSession = (loginid: string): string => `deriv:${loginid}`;
  const theoreticalManualWin = (direction: Direction, barrier: number): number => direction === 'over' ? (9 - barrier) / 10 : barrier / 10;
  const manualModelWin = (order: Pick<ManualOrderInput, 'market' | 'direction' | 'barrier'>): number => {
    const snapshot = registry.snapshot(order.market);
    const theoretical = theoreticalManualWin(order.direction, order.barrier);
    const digits = snapshot.recentDigits.filter((digit) => Number.isInteger(digit) && digit >= 0 && digit <= 9);
    if (!digits.length) return theoretical;
    const wins = digits.filter((digit) => order.direction === 'over' ? digit > order.barrier : digit < order.barrier).length;
    return (wins + theoretical * 20) / (digits.length + 20);
  };
  const normalizeManualOrder = (body: unknown): ManualOrderInput => {
    const input = (body ?? {}) as { market?: unknown; direction?: unknown; barrier?: unknown; stake?: unknown; entryMode?: unknown; companionDemo?: unknown };
    const market = typeof input.market === 'string' ? input.market : '';
    const direction = input.direction === 'over' || input.direction === 'under' ? input.direction : null;
    const barrier = Number(input.barrier);
    const stake = Number(input.stake);
    const entryMode: ManualEntryMode = input.entryMode === 'instant'
      ? 'instant'
      : input.entryMode === 'digit-trigger-confirmed'
        ? 'digit-trigger-confirmed'
        : input.entryMode === 'digit-trigger'
          ? 'digit-trigger'
          : 'model';
    if (!market || !direction || !Number.isFinite(barrier) || !Number.isFinite(stake)) {
      throw new ManualRequestError(400, 'market, direction, barrier, and stake are required');
    }
    const validBarrier = Number.isInteger(barrier)
      && (direction === 'over' ? barrier >= 0 && barrier <= 8 : barrier >= 1 && barrier <= 9);
    if (!validBarrier) {
      throw new ManualRequestError(400, direction === 'over' ? 'over barrier must be an integer from 0 to 8' : 'under barrier must be an integer from 1 to 9');
    }
    if (!(stake > 0)) throw new ManualRequestError(400, 'stake must be greater than zero');
    if (!registry.has(market)) throw new ManualRequestError(400, `unknown market ${market}`);
    return { market, direction, barrier, stake, entryMode, companionDemo: input.companionDemo === true };
  };
  const assertManualPreflight = (order: ManualOrderInput, session: NonNullable<ReturnType<typeof getSession>>): void => {
    if (order.companionDemo && session.mode !== 'demo') throw new ManualRequestError(403, 'companion-confirmed trades are available on demo accounts only');
    if (automation.isRunning()) throw new ManualRequestError(409, 'stop the bot before placing a manual trade');
    const snapshot = registry.snapshot(order.market);
    if (!snapshot.fresh) throw new ManualRequestError(409, 'the selected market feed is stale; wait for a fresh tick');
    const settings = getSettings();
    const accountId = accountIdForSession(session.loginid);
    const gate = riskCheck({
      stake: order.stake,
      settings,
      balance: session.balance,
      context: buildRecoveryContext(settings, accountId),
      lastTradeAt: 0,
      tradeGapMs: 0,
      now: Date.now(),
      accountId,
      skipRecoveryDebtCap: true,
      lane: 'digit',
    });
    if (!gate.ok) throw new ManualRequestError(409, `manual trade blocked: ${gate.reason}`);
    if (manualLaneLocks.has(accountId)) throw new ManualRequestError(409, 'another manual digit order is already being processed');
  };
  const ensureManualClient = async (session: NonNullable<ReturnType<typeof getSession>>): Promise<void> => {
    if (client.isConnected) {
      if (client.connectedAccountId !== session.loginid) throw new ManualRequestError(409, 'Connected Deriv account does not match the selected account. No trade was submitted.');
      return;
    }
    try {
      const token = await resolveStoredToken();
      const connected = await client.reconnect(token, session.loginid);
      if (connected.loginid !== session.loginid || client.connectedAccountId !== session.loginid) throw new Error('Deriv reconnected to a different account');
    } catch (error) {
      throw new ManualRequestError(409, `socket reconnect failed: ${String(error)}`);
    }
  };
  const requestManualQuote = async (
    order: ManualOrderInput,
    session: NonNullable<ReturnType<typeof getSession>>,
  ): ReturnType<DerivPrivateClient['getQuote']> => {
    const request = (): ReturnType<DerivPrivateClient['getQuote']> => client.getQuote({
      direction: order.direction,
      barrier: order.barrier,
      amount: order.stake,
      currency: session.currency || 'USD',
      duration: 1,
      durationUnit: 't',
      symbol: order.market,
    });
    try {
      return await request();
    } catch (firstError) {
      const firstMessage = firstError instanceof Error ? firstError.message : String(firstError);
      if (/rate limit/i.test(firstMessage)) {
        await new Promise((resolve) => setTimeout(resolve, 5_000));
        try {
          return await request();
        } catch (retryError) {
          const retryMessage = retryError instanceof Error ? retryError.message : String(retryError);
          throw new ManualRequestError(503, `Deriv could not refresh the quote: ${retryMessage}. No contract was purchased; wait a moment and request a fresh quote.`);
        }
      }
      const transientConnectionFailure = /private socket (?:not open|closed|disconnected)|proposal timeout|socket error/i.test(firstMessage);
      if (transientConnectionFailure) {
        try {
          await client.reconnect(await resolveStoredToken(), session.loginid);
          await ensureManualClient(session);
          return await request();
        } catch (retryError) {
          const retryMessage = retryError instanceof Error ? retryError.message : String(retryError);
          throw new ManualRequestError(503, `Deriv could not refresh the quote: ${retryMessage}. No contract was purchased; request a fresh quote.`);
        }
      }
      throw new ManualRequestError(503, `Deriv could not refresh the quote: ${firstMessage}. No contract was purchased; request a fresh quote.`);
    }
  };
  const cleanupManualState = (): void => {
    const now = Date.now();
    for (const [id, preview] of manualPreviews) if (preview.expiresAt <= now) manualPreviews.delete(id);
    for (const [id, execution] of manualExecutions) if (execution.expiresAt <= now) manualExecutions.delete(id);
  };
  const runManualIdempotent = (
    accountId: string,
    idempotencyKey: string,
    signature: string,
    work: () => Promise<ManualExecutionResponse>,
  ): Promise<ManualExecutionResponse> => {
    cleanupManualState();
    const key = `${accountId}:${idempotencyKey}`;
    const existing = manualExecutions.get(key);
    if (existing) {
      if (existing.signature !== signature) return Promise.resolve({ status: 409, body: { error: 'idempotency key was already used for a different manual order' } });
      return existing.promise;
    }
    const promise = work().catch((error) => ({
      status: error instanceof ManualRequestError ? error.status : 502,
      body: { error: error instanceof Error ? error.message : String(error) },
    }));
    manualExecutions.set(key, { signature, expiresAt: Date.now() + MANUAL_IDEMPOTENCY_TTL_MS, promise });
    return promise;
  };
  const multiplierCandidates = [10, 20, 30, 50, 75, 100, 150, 200, 250, 300, 400, 500, 600, 700, 800, 900, 1000];
  type MultiplierProbeResult = {
    symbol: string;
    direction: MultiplierDirection;
    stake: number;
    currency: string;
    options: number[];
    max: number | null;
    checkedAt: number;
    rejected: Array<{ multiplier: number; reason: string }>;
  };
  const probeMultiplierOptions = async (input: {
    symbol: string;
    direction: MultiplierDirection;
    stake: number;
    currency: string;
  }): Promise<MultiplierProbeResult> => {
    const cacheKey = `${input.currency}:${input.symbol}:${input.direction}:${Math.round(input.stake * 100) / 100}`;
    const cached = multiplierProbeCache.get(cacheKey);
    if (cached && Date.now() - cached.ts < 5 * 60_000) return cached.result;

    const checked = await Promise.all(multiplierCandidates.map(async (multiplier) => {
      try {
        await client.getMultiplierQuote({
          direction: input.direction,
          amount: input.stake,
          currency: input.currency,
          symbol: input.symbol,
          multiplier,
        });
        return { multiplier, ok: true as const };
      } catch (error) {
        return {
          multiplier,
          ok: false as const,
          reason: error instanceof Error ? error.message : String(error),
        };
      }
    }));
    const options = checked.filter((item) => item.ok).map((item) => item.multiplier);
    const rejected = checked
      .filter((item): item is { multiplier: number; ok: false; reason: string } => !item.ok)
      .map((item) => ({ multiplier: item.multiplier, reason: item.reason }));
    const result = {
      ...input,
      options,
      max: options.length ? Math.max(...options) : null,
      checkedAt: Date.now(),
      rejected,
    };
    multiplierProbeCache.set(cacheKey, { ts: Date.now(), result });
    return result;
  };
  const resumeOpenTradeSettlement = (): void => {
    if (!client.isConnected) return;
    for (const openTrade of listOpenTrades()) {
      if (openTrade.contract_id) settleInBackground(client, hub, openTrade.id, openTrade.contract_id, openTrade.stake, openTrade.payout, openTrade.account_id);
    }
  };
  const isGoldDerivTrade = (trade: { contract_type?: string; market?: string; reason?: string | null } | null | undefined): boolean =>
    Boolean(
      trade
      && (trade.contract_type === 'MULTUP' || trade.contract_type === 'MULTDOWN')
      && (isGoldMultiplierTrade(trade) || trade.market === config.goldDerivSymbol),
    );
  const MULTIPLIER_LOT_LIMITS = { total: 6, momentum: 4, gold: 2 } as const;
  const openMultiplierLots = (accountId: string, product?: 'momentum' | 'gold'): TradeRow[] =>
    listOpenTrades(accountId).filter((trade) => {
      if (trade.contract_type !== 'MULTUP' && trade.contract_type !== 'MULTDOWN') return false;
      if (!product) return true;
      return product === 'gold' ? isGoldDerivTrade(trade) : isMomentumMultiplierTrade(trade);
    });
  const multiplierLotAdmission = (accountId: string, product: 'momentum' | 'gold', nextStake: number, balance: number): string | null => {
    const all = openMultiplierLots(accountId);
    const productLots = openMultiplierLots(accountId, product);
    if (productLots.some((trade) => trade.status === 'purchasing' && /purchase outcome unknown; reconciliation required/i.test(trade.reason ?? ''))) {
      return `${product} has an unresolved purchase; reconcile it before opening another lot`;
    }
    if (all.length >= MULTIPLIER_LOT_LIMITS.total) return `account limit of ${MULTIPLIER_LOT_LIMITS.total} open multiplier lots reached`;
    if (productLots.length >= MULTIPLIER_LOT_LIMITS[product]) return `${product} limit of ${MULTIPLIER_LOT_LIMITS[product]} open lots reached`;
    const reservedStake = all.reduce((sum, trade) => sum + Math.max(0, Number(trade.stake) || 0), 0);
    if (balance > 0 && reservedStake + nextStake > balance * .9) return 'open-lot stake reserve would exceed 90% of account balance';
    return null;
  };
  /**
   * A multiplier can settle while the browser is disconnected, leaving a
   * durable `pending` reservation behind until the next subscription update.
   * Check known contract ids once before applying the lot cap, so a settled
   * contract never blocks a fresh order.  A purchase with no contract id is
   * deliberately not cleared: that remains an explicit reconciliation case.
   */
  const reconcileSettledTrades = async (accountId: string, candidates: TradeRow[]): Promise<void> => {
    if (!client.isConnected) return;
    await Promise.all(candidates.filter((trade) => Boolean(trade.contract_id)).map(async (trade) => {
      const timeout = new Promise<null>((resolve) => {
        // The initial broker snapshot can arrive a few seconds after a socket
        // reconnect. Do not count a persisted lot before that authoritative
        // check has had a realistic chance to finish.
        const timer = setTimeout(() => resolve(null), 12_000);
        timer.unref();
      });
      try {
        const outcome = await Promise.race([
          client.settleContract(trade.contract_id, () => undefined),
          timeout,
        ]);
        if (!outcome?.settled) return;
        const won = outcome.status === 'won';
        const status = won ? ('won' as const) : ('lost' as const);
        const profit = contractProfit(won, trade.stake, trade.payout, outcome);
        resolveTrade(
          trade.id,
          status,
          profit,
          trade.contract_id,
          { entrySpot: outcome.entrySpot, entryDigit: outcome.entryDigit, exitSpot: outcome.exitSpot, exitDigit: outcome.exitDigit },
          accountId,
        );
        const settledTrade = getTrade(trade.id, accountId);
        if (settledTrade) hub.emit({ type: 'trade', ts: Date.now(), trade: settledTrade, performance: getPerformanceSummary(accountId), manual: true, settled: true });
      } catch {
        // The normal background settlement subscriber remains responsible for
        // retries. Admission must never fail merely because reconciliation is
        // temporarily unavailable.
      }
    }));
  };
  const reconcileSettledMultiplierLots = async (accountId: string, product?: 'momentum' | 'gold'): Promise<void> =>
    reconcileSettledTrades(accountId, openMultiplierLots(accountId, product));
  /**
   * A purchase that never received a Deriv contract id is only a local
   * reservation. Keep a fresh reservation safe, but release an old one on
   * account switch so an abandoned browser request cannot lock the account
   * forever. Unknown broker purchase outcomes remain explicitly protected.
   */
  const clearAbandonedLocalReservations = (accountId: string): void => {
    const staleBefore = Date.now() - 60_000;
    for (const trade of listOpenTrades(accountId)) {
      const unknownBrokerOutcome = trade.status === 'purchasing'
        && /purchase outcome unknown; reconciliation required/i.test(trade.reason ?? '');
      if (trade.contract_id || unknownBrokerOutcome || trade.ts > staleBefore) continue;
      resolveTrade(trade.id, 'timeout', 0, '', undefined, accountId);
    }
  };
  const reconcileAccountSwitchContracts = async (accountId: string): Promise<{ portfolioChecked: boolean; listedContractIds: Set<string> }> => {
    const candidates = listOpenTrades(accountId).filter((trade) => Boolean(trade.contract_id));
    // Portfolio is the broker's list of *currently* open positions. It is
    // more useful than a historical contract subscription when a prior socket
    // was lost: absence here means the stored reservation cannot still be an
    // active account contract.
    let openContractIds: Set<string> | null = null;
    try {
      openContractIds = await client.getOpenContractIds();
    } catch {
      // Fall back to individual snapshots below when portfolio is unavailable.
    }
    await Promise.all(candidates.map(async (trade) => {
      try {
        if (openContractIds && !openContractIds.has(trade.contract_id)) {
          resolveTrade(trade.id, 'timeout', 0, trade.contract_id, undefined, accountId);
          return;
        }
        const outcome = await client.getContractSnapshot(trade.contract_id);
        if (!outcome.settled) return;
        const won = outcome.status === 'won';
        const status = won ? ('won' as const) : ('lost' as const);
        resolveTrade(
          trade.id,
          status,
          contractProfit(won, trade.stake, trade.payout, outcome),
          trade.contract_id,
          { entrySpot: outcome.entrySpot, entryDigit: outcome.entryDigit, exitSpot: outcome.exitSpot, exitDigit: outcome.exitDigit },
          accountId,
        );
        const settledTrade = getTrade(trade.id, accountId);
        if (settledTrade) hub.emit({ type: 'trade', ts: Date.now(), trade: settledTrade, performance: getPerformanceSummary(accountId), manual: true, settled: true });
      } catch {
        // An unavailable broker snapshot must not be reclassified locally.
        // The explicit block below remains the safe outcome in this case.
      }
    }));
    return { portfolioChecked: openContractIds !== null, listedContractIds: openContractIds ?? new Set<string>() };
  };
  type CloseTarget = { tradeId?: unknown; contractId?: unknown };
  const findOpenTradeForClose = (
    body: CloseTarget | undefined,
    label: string,
    matchesProduct: (trade: TradeRow) => boolean,
  ): { trade: TradeRow | null; error: string | null } => {
    const rawTradeId = body?.tradeId;
    const rawContractId = body?.contractId;
    const hasTradeId = rawTradeId !== undefined && rawTradeId !== null && rawTradeId !== '';
    const hasContractId = rawContractId !== undefined && rawContractId !== null && rawContractId !== '';
    const tradeId = hasTradeId ? Number(rawTradeId) : null;
    const contractId = hasContractId ? String(rawContractId) : null;
    if (hasTradeId && (!Number.isSafeInteger(tradeId) || (tradeId ?? 0) <= 0)) {
      return { trade: null, error: 'tradeId must be a positive integer' };
    }
    if (hasContractId && !contractId?.trim()) return { trade: null, error: 'contractId is required when supplied' };

    const candidates = listOpenTrades().filter(matchesProduct);
    let trade: TradeRow | undefined;
    if (tradeId !== null) trade = candidates.find((item) => item.id === tradeId);
    else if (contractId) trade = candidates.find((item) => item.contract_id === contractId);
    else if (candidates.length === 1) trade = candidates[0];
    else if (candidates.length > 1) return { trade: null, error: `multiple open ${label} trades found; specify tradeId or contractId` };

    if (!trade) return { trade: null, error: `no open ${label} trade found` };
    if (contractId && trade.contract_id !== contractId) {
      return { trade: null, error: 'tradeId and contractId do not identify the same open contract' };
    }
    return { trade, error: null };
  };
  const fmtSentimentPct = (score: number): string => `${score >= 0 ? '+' : ''}${Math.round(score * 100)}%`;
  const recordGoldTradeKnowledgeSafely = (
    trade: TradeRow,
    signal: ReturnType<typeof gold.state>['research']['state']['signal'],
  ): void => {
    if (!trade.contract_id || (trade.contract_type !== 'MULTUP' && trade.contract_type !== 'MULTDOWN')) return;
    try {
      recordGoldTradeKnowledge({
        tradeId: trade.id,
        contractId: trade.contract_id,
        symbol: trade.market,
        accountMode: trade.account_mode ?? 'unknown',
        direction: trade.contract_type === 'MULTDOWN' ? 'SELL' : 'BUY',
        signalId: signal?.id ?? null,
        signalDirection: signal?.direction ?? null,
        signalConfidence: signal?.confidence ?? null,
        signalScore: signal?.score ?? null,
        entryPrice: trade.entry_spot ?? null,
        openedAt: trade.ts,
        evidence: signal ? {
          modelVersion: signal.modelVersion,
          regime: signal.regime,
          indicators: signal.indicators,
          sentiment: signal.sentiment,
          reasons: signal.reasons,
          followedSuggestion: (trade.contract_type === 'MULTUP' ? 'BUY' : 'SELL') === signal.direction,
        } : { research: 'unavailable at entry' },
      });
    } catch (error) {
      console.warn(`[gold trade knowledge] record failed: ${String(error)}`);
    }
  };
  const goldState = (owner: boolean, session: ReturnType<typeof getSession>) => {
    const openTrades = owner && session ? openMultiplierLots(`deriv:${session.loginid}`, 'gold') : [];
    const predictionRows = listGoldPredictionEvidence(500);
    const tradeKnowledge = listGoldTradeKnowledge(500);
    const resolvedPredictions = predictionRows.filter((row) => row.status !== 'pending');
    const correctPredictions = resolvedPredictions.filter((row) => row.status === 'correct').length;
    return {
      ...gold.state(),
      predictionEvaluation: {
        total: predictionRows.length,
        pending: predictionRows.filter((row) => row.status === 'pending').length,
        resolved: resolvedPredictions.length,
        correct: correctPredictions,
        incorrect: resolvedPredictions.filter((row) => row.status === 'incorrect').length,
        flat: resolvedPredictions.filter((row) => row.status === 'flat').length,
        accuracy: resolvedPredictions.length ? correctPredictions / resolvedPredictions.length : null,
        latest: predictionRows[0] ?? null,
        recent: predictionRows.slice(0, 100),
        tradeOutcomes: {
          total: tradeKnowledge.length,
          pending: tradeKnowledge.filter((row) => row.status === 'pending').length,
          won: tradeKnowledge.filter((row) => row.status === 'won').length,
          lost: tradeKnowledge.filter((row) => row.status === 'lost').length,
        },
      },
      deriv: {
        provider: 'deriv',
        symbol: config.goldDerivSymbol,
        display: config.goldDerivDisplay,
        connected: Boolean(owner && session),
        demoConnected: Boolean(owner && session?.mode === 'demo'),
        accountMode: owner ? session?.mode ?? null : null,
        accountId: owner ? session?.loginid ?? null : null,
        multiplierOptions: [10, 20, 30, 50, 100, 200, 500],
        defaultMultiplier: 20,
        maxStake: config.goldMaxStake,
        openTrades,
        blockedByOpenTrade: null,
        message: !owner
          ? 'Unlock owner controls before placing Deriv Gold trades.'
          : !session
            ? 'Connect a Deriv demo account to trade Gold through Deriv API.'
            : session.mode !== 'demo'
              ? 'Switch to a Deriv demo account. Gold API trading is demo-only.'
              : 'Deriv demo account connected for Gold multiplier orders.',
      },
    };
  };

  app.get('/health', async () => ({
    ok: true,
    uptime: process.uptime(),
    feed: feed.status(),
    markets: registry.allSnapshots().length,
    bot: automation.state(),
  }));

  app.get('/api/markets', async () => {
    const rows = listMarkets();
    const bySymbol = new Map(registry.allSnapshots().map((s) => [s.symbol, s]));
    return rows.map((r) => ({ ...r, live: bySymbol.get(String(r.symbol)) ?? null }));
  });

  app.post('/api/auth/owner', async (req, reply) => {
    if (!publicDashboardEnabled()) return { ok: true };
    const token = (req.body as { token?: string } | undefined)?.token ?? '';
    if (token !== config.dashboardAdminToken) {
      reply.code(401);
      return { error: 'invalid dashboard access token' };
    }
    grantOwner(reply);
    return { ok: true };
  });

  app.get('/api/state', async (req) => {
    const owner = isOwner(req);
    const session = getSession();
    if (owner) resumeOpenTradeSettlement();
    return {
      feed: feed.status(),
      markets: registry.allSnapshots(),
      public_dashboard: publicDashboardEnabled(),
      owner,
      session: owner && session
        ? {
            loginid: session.loginid,
            balance: session.balance,
            currency: session.currency,
            mode: session.mode,
            auth_kind: session.auth_kind,
          }
        : null,
      recovery: owner ? getRecovery() : null,
      settings: getSettings(),
      automation: owner
        ? automation.state()
        : { ...automation.state(), running: false, phase: 'guest', reason: 'Connect Deriv to trade' },
      intelligence: automation.marketIntelligence(),
      trades: owner ? listTrades(20) : [],
      performance: owner ? getPerformanceSummary() : { wins: 0, losses: 0, pushes: 0, profit: 0, reset_at: 0 },
      paperSimulation: paperSimulator.state(),
      momentum: momentum?.state() ?? null,
      gold: goldState(owner, session),
    };
  });

  /**
   * Gold state contains no OAuth material. The active trading path uses the
   * existing Deriv account session; cTrader onboarding remains isolated.
   */
  app.get('/api/gold/state', async (req) => {
    const owner = isOwner(req);
    return { state: goldState(owner, getSession()) };
  });

  /** Gold OAuth is distinct from Deriv OAuth and remains demo/read-only. */
  app.get('/api/gold/onboarding', async (req, reply) => {
    if (!requireOwner(req, reply)) return;
    return { connection: gold.connectionState() };
  });

  app.post('/api/gold/oauth/start', async (req, reply) => {
    if (!requireOwner(req, reply)) return;
    try {
      const authorization = gold.beginOAuthAuthorization();
      reply.setCookie('zeronine_gold_oauth_nonce', authorization.nonce, {
        httpOnly: true,
        sameSite: 'lax',
        path: '/api/gold/oauth',
        secure: config.nodeEnv === 'production',
        signed: true,
        maxAge: 10 * 60,
      });
      return { ok: true, url: authorization.url };
    } catch (error) {
      const connection = gold.connectionState();
      reply.code(error instanceof GoldOAuthError ? error.statusCode : 500);
      return { error: connection.message ?? 'Gold OAuth onboarding is unavailable.', connection };
    }
  });

  app.get('/api/gold/oauth/callback', async (req, reply) => {
    if (!requireOwner(req, reply)) return;
    const nonce = req.cookies?.zeronine_gold_oauth_nonce;
    const validNonce = nonce ? req.unsignCookie(nonce).valid : false;
    reply.clearCookie?.('zeronine_gold_oauth_nonce', { path: '/api/gold/oauth' });
    const query = (req.query ?? {}) as Record<string, unknown>;
    const code = typeof query.code === 'string' ? query.code : '';
    if (!validNonce || !code) {
      reply.redirect('/gold?gold_oauth=error', 303);
      return;
    }
    try {
      await gold.completeOAuthAuthorization(code);
      reply.redirect('/gold?gold_oauth=authorized', 303);
    } catch {
      // OAuth codes and provider details must never reach the browser or logs.
      reply.redirect('/gold?gold_oauth=error', 303);
    }
  });

  app.post('/api/gold/oauth/disconnect', async (req, reply) => {
    if (!requireOwner(req, reply)) return;
    return { ok: true, connection: gold.disconnectOAuthAuthorization() };
  });

  app.get('/api/gold/oauth/accounts', async (req, reply) => {
    if (!requireOwner(req, reply)) return;
    try {
      return { accounts: await gold.listOAuthDemoAccounts() };
    } catch (error) {
      reply.code(error instanceof GoldOAuthError ? error.statusCode : 502);
      return { error: error instanceof GoldOAuthError ? error.message : 'cTrader demo account discovery failed.' };
    }
  });

  app.post('/api/gold/oauth/accounts/select', async (req, reply) => {
    if (!requireOwner(req, reply)) return;
    const accountId = typeof (req.body as { accountId?: unknown } | undefined)?.accountId === 'string'
      ? (req.body as { accountId: string }).accountId
      : '';
    try {
      return { ok: true, connection: await gold.selectOAuthDemoAccount(accountId) };
    } catch (error) {
      reply.code(error instanceof GoldOAuthError ? error.statusCode : 502);
      return { error: error instanceof GoldOAuthError ? error.message : 'cTrader demo account selection failed.' };
    }
  });

  // Virtual Gold paper routes remain separate from Deriv account contracts.
  app.post('/api/gold/paper/orders', async (req, reply) => {
    if (!requireOwner(req, reply)) return;
    const body = req.body as { side?: unknown; volume?: unknown; stopLoss?: unknown; takeProfit?: unknown } | undefined;
    const side = body?.side;
    const volume = Number(body?.volume);
    const stopLoss = body?.stopLoss == null ? null : Number(body.stopLoss);
    const takeProfit = body?.takeProfit == null ? null : Number(body.takeProfit);
    if ((side !== 'BUY' && side !== 'SELL') || !Number.isFinite(volume) || volume <= 0
      || (stopLoss !== null && (!Number.isFinite(stopLoss) || stopLoss <= 0))
      || (takeProfit !== null && (!Number.isFinite(takeProfit) || takeProfit <= 0))) {
      reply.code(400);
      return { error: 'side (BUY or SELL), positive volume, and valid optional stops are required' };
    }
    try {
      const result = gold.openPaper({ side, volume, stopLoss, takeProfit });
      if (!result.accepted) {
        reply.code(409);
        return { ...result, error: result.reason };
      }
      return result;
    } catch (error) {
      reply.code(error instanceof GoldRuntimeUnavailableError ? 409 : 400);
      return { error: String(error instanceof Error ? error.message : error) };
    }
  });

  app.post('/api/gold/paper/positions/:id/close', async (req, reply) => {
    if (!requireOwner(req, reply)) return;
    const positionId = String((req.params as { id?: unknown }).id ?? '').trim();
    if (!positionId) { reply.code(400); return { error: 'Gold paper position id is required' }; }
    try {
      const result = gold.closePaper(positionId);
      if (!result.closed) {
        reply.code(409);
        return { ...result, error: result.reason };
      }
      return result;
    } catch (error) {
      reply.code(error instanceof GoldRuntimeUnavailableError ? 409 : 400);
      return { error: String(error instanceof Error ? error.message : error) };
    }
  });

  app.post('/api/gold/paper/reset', async (req, reply) => {
    if (!requireOwner(req, reply)) return;
    try {
      return { state: gold.resetPaper() };
    } catch (error) {
      reply.code(error instanceof GoldRuntimeUnavailableError ? 409 : 400);
      return { error: String(error instanceof Error ? error.message : error) };
    }
  });

  app.post('/api/gold/backtests/run', async (req, reply) => {
    if (!requireOwner(req, reply)) return;
    try {
      return { result: gold.runBaselineBacktest() };
    } catch (error) {
      reply.code(error instanceof GoldRuntimeUnavailableError ? 409 : 400);
      return { error: String(error instanceof Error ? error.message : error) };
    }
  });

  /**
   * Gold demo execution uses Deriv API multiplier contracts, not MT5 or
   * cTrader CFD order routing. It shares the account-level execution lock
   * with other contract products.
   */
  app.post('/api/gold/trade', async (req, reply) => {
    if (!requireOwner(req, reply)) return;
    const session = getSession();
    if (!session) {
      reply.code(401);
      return { error: 'connect a Deriv demo account to place a Gold trade' };
    }
    if (session.mode !== 'demo') {
      reply.code(403);
      return { error: 'Gold trades are restricted to a Deriv demo account' };
    }
    if (automation.isRunning()) {
      reply.code(409);
      return { error: 'stop the bot before placing a Gold trade' };
    }
    const body = (req.body ?? {}) as { side?: unknown; stake?: unknown; multiplier?: unknown; takeProfit?: unknown; stopLoss?: unknown };
    const side = body.side === 'BUY' || body.side === 'SELL' ? body.side : null;
    const direction = side === 'BUY' ? 'up' : side === 'SELL' ? 'down' : null;
    const stake = Number(body.stake);
    const requestedMultiplier = Number(body.multiplier);
    const multiplier = Number.isFinite(requestedMultiplier) && requestedMultiplier > 0
      ? Math.floor(requestedMultiplier)
      : undefined;
    const takeProfit = Number(body.takeProfit);
    const stopLoss = Number(body.stopLoss);
    if (!side || !direction || !Number.isFinite(stake) || stake <= 0) {
      reply.code(400);
      return { error: 'a BUY/SELL side and positive stake are required' };
    }
    if (multiplier === undefined || multiplier <= 0) {
      reply.code(400);
      return { error: 'a positive multiplier is required' };
    }
    if ((Number.isFinite(takeProfit) && takeProfit <= 0) || (Number.isFinite(stopLoss) && stopLoss <= 0)) {
      reply.code(400);
      return { error: 'take profit and stop loss must be positive when provided' };
    }

    const goldState = gold.state();
    const symbol = goldState.research.state.symbol;
    const signal = goldState.research.state.signal;
    if (!goldState.research.ready || !symbol || !goldState.research.state.quote) {
      reply.code(409);
      return { error: goldState.research.reason ?? 'Gold market data is not ready yet' };
    }
    const settings = getSettings();
    if (stake > config.goldMaxStake) {
      reply.code(400);
      return { error: `Gold stake exceeds the configured maximum (${config.goldMaxStake})` };
    }
    await reconcileSettledMultiplierLots(`deriv:${session.loginid}`);
    const admission = multiplierLotAdmission(`deriv:${session.loginid}`, 'gold', stake, session.balance);
    if (admission) {
      reply.code(409);
      return { error: `Gold trade blocked: ${admission}` };
    }
    const gate = riskCheck({
      stake,
      settings,
      balance: session.balance,
      context: buildRecoveryContext(settings),
      // Account commands are serialized and each position gets a durable
      // reservation, so a second permitted lot need not wait on the legacy
      // single-contract cooldown.
      lastTradeAt: 0,
      tradeGapMs: 0,
      now: Date.now(),
      // Gold multipliers are not digit-recovery bets. Keep the shared balance,
      // drawdown, loss-streak, cooldown, and open-contract rails, but do not
      // reject a manual Gold order solely because the digit strategy has debt.
      skipRecoveryDebtCap: true,
      lane: 'gold',
      skipOpenContractCheck: true,
    });
    if (!gate.ok) {
      reply.code(409);
      return { error: `Gold trade blocked: ${gate.reason}` };
    }

    if (!client.isConnected) {
      try {
        const token = await resolveStoredToken();
        const connected = await client.reconnect(token, session.loginid);
        if (connected.mode !== 'demo') {
          reply.code(403);
          return { error: 'Gold trades are restricted to a Deriv demo account' };
        }
      } catch (error) {
        reply.code(409);
        return { error: `socket reconnect failed: ${String(error)}` };
      }
    }

    let recordedTrade: ReturnType<typeof insertTrade> | null = null;
    let stage: 'availability' | 'proposal' | 'reserve' | 'buy' | 'finalize' = 'availability';
    let buyAttempted = false;
    let bought: { contractId: string; payout: number; buyPrice: number; purchaseTime: number } | null = null;
    let quoteForRecovery: Awaited<ReturnType<typeof client.getMultiplierQuote>> | null = null;
    try {
      const available = await client.getAvailableContracts(symbol.id);
      const requiredContract = direction === 'up' ? 'MULTUP' : 'MULTDOWN';
      if (!available.some((item) => item.contract_type === requiredContract)) {
        reply.code(409);
        return { error: `${requiredContract} is not available for Deriv Gold symbol ${symbol.name}` };
      }
      stage = 'proposal';
      const quote = quoteForRecovery = await client.getMultiplierQuote({
        direction,
        amount: stake,
        currency: session.currency || 'USD',
        symbol: symbol.id,
        multiplier,
        takeProfit: Number.isFinite(takeProfit) ? takeProfit : undefined,
        stopLoss: Number.isFinite(stopLoss) ? stopLoss : undefined,
      });
      if (!(quote.askPrice > 0) || !Number.isFinite(quote.askPrice)) {
        throw new Error('Gold multiplier proposal returned an invalid purchase price');
      }
      stage = 'reserve';
      const afterQuoteAdmission = multiplierLotAdmission(`deriv:${session.loginid}`, 'gold', quote.askPrice, session.balance);
      if (afterQuoteAdmission) {
        reply.code(409);
        return { error: `Gold trade blocked: ${afterQuoteAdmission}` };
      }
      const reason = [
        `gold deriv manual ${side}`,
        `multiplier x${multiplier}`,
        Number.isFinite(takeProfit) ? `TP ${takeProfit}` : null,
        Number.isFinite(stopLoss) ? `SL ${stopLoss}` : null,
        signal ? `research ${signal.direction} ${signal.confidence}%` : 'research unavailable',
        signal?.sentiment
          ? `sentiment news ${fmtSentimentPct(signal.sentiment.newsScore)} social ${fmtSentimentPct(signal.sentiment.socialScore)}`
            + (signal.sentiment.perfectSetup ? ' perfect' : signal.sentiment.alignment === 'CONFLICTING' ? ' conflicting' : '')
          : null,
        signal?.reasons[0] ?? signal?.blockers[0] ?? 'Manual Gold demo decision',
      ].filter(Boolean).join(' | ');
      const trade = recordedTrade = insertTrade({
        ts: Date.now(),
        market: symbol.id,
        contract_type: direction === 'up' ? 'MULTUP' : 'MULTDOWN',
        barrier: 0,
        duration: 0,
        duration_unit: 'm',
        stake,
        ask_price: quote.askPrice,
        payout: quote.payout,
        est_win: signal?.confidence ? signal.confidence / 100 : .5,
        profit: 0,
        status: 'purchasing',
        contract_id: '',
        purchase_id: `gold-deriv-${Date.now()}`,
        reason,
        origin: 'manual',
      });
      stage = 'buy';
      buyAttempted = true;
      bought = await accountCoordinator.runCommand('manual_open', session.loginid, () => client.placeBuy(quote.id, quote.askPrice));
      const actualStake = bought.buyPrice > 0 ? bought.buyPrice : quote.askPrice;
      const actualPayout = bought.payout > 0 ? bought.payout : quote.payout;
      const entryPrice = Number.isFinite(quote.spot) && quote.spot > 0
        ? quote.spot
        : goldState.research.state.quote.mid;
      stage = 'finalize';
      markTradePurchased(trade.id, bought.contractId, actualStake, actualPayout, trade.account_id, entryPrice);
      const purchased = getTrade(trade.id, trade.account_id) ?? trade;
      recordGoldTradeKnowledgeSafely(purchased, signal);
      settleInBackground(client, hub, trade.id, bought.contractId, actualStake, actualPayout, trade.account_id);
      hub.emit({ type: 'trade', ts: Date.now(), trade: purchased, manual: true, gold: true });
      return {
        ok: true,
        trade: {
          id: trade.id,
          contractId: bought.contractId,
          market: symbol.id,
          contractType: trade.contract_type,
          ask: actualStake,
          payout: actualPayout,
          multiplier,
          entryPrice,
          currency: session.currency || 'USD',
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (recordedTrade && buyAttempted && !bought) {
        try {
          markTradePurchaseOutcomeUnknown(recordedTrade.id, recordedTrade.account_id);
        } catch (persistenceError) {
          console.error('[gold deriv] could not record uncertain purchase', { tradeId: recordedTrade.id, persistenceError: String(persistenceError) });
        }
        reply.code(503);
        return {
          error: 'purchase outcome unknown; the account is locked for reconciliation. Do not retry this order.',
          code: 'purchase_outcome_unknown',
        };
      }
      if (recordedTrade && bought) {
        try {
          const existing = getTrade(recordedTrade.id, recordedTrade.account_id);
          if (existing?.contract_id !== bought.contractId) {
            const quote = quoteForRecovery;
            markTradePurchased(
              recordedTrade.id,
              bought.contractId,
              bought.buyPrice > 0 ? bought.buyPrice : quote?.askPrice ?? recordedTrade.ask_price,
              bought.payout > 0 ? bought.payout : quote?.payout ?? recordedTrade.payout,
              recordedTrade.account_id,
              quote?.spot ?? goldState.research.state.quote?.mid,
            );
          }
          const persisted = getTrade(recordedTrade.id, recordedTrade.account_id);
          if (persisted?.contract_id === bought.contractId) {
            recordGoldTradeKnowledgeSafely(persisted, signal);
            settleInBackground(client, hub, persisted.id, bought.contractId, persisted.stake, persisted.payout, persisted.account_id);
          }
        } catch (persistenceError) {
          console.error('[gold deriv] confirmed purchase needs reconciliation', { tradeId: recordedTrade.id, contractId: bought.contractId, persistenceError: String(persistenceError) });
        }
        reply.code(202);
        return { ok: true, warning: 'purchase was confirmed; local status is reconciling', contractId: bought.contractId };
      }
      if (recordedTrade) resolveTrade(recordedTrade.id, 'error', 0, '', undefined, recordedTrade.account_id);
      console.warn('[gold deriv] order failed before purchase', { stage, symbol: symbol.id, side, stake, error: message });
      reply.code(502);
      return { error: `Gold ${stage} failed: ${message}` };
    }
  });

  app.post('/api/gold/close', async (req, reply) => {
    if (!requireOwner(req, reply)) return;
    const session = getSession();
    if (!session) {
      reply.code(401);
      return { error: 'connect a Deriv demo account to close a Gold trade' };
    }
    if (session.mode !== 'demo') {
      reply.code(403);
      return { error: 'Gold trades are restricted to a Deriv demo account' };
    }
    const target = findOpenTradeForClose(
      (req.body ?? {}) as CloseTarget,
      'Gold',
      (trade) => isGoldDerivTrade(trade),
    );
    if (!target.trade) {
      reply.code(409);
      return { error: target.error };
    }
    const openTrade = target.trade;
    if ((openTrade.contract_type !== 'MULTUP' && openTrade.contract_type !== 'MULTDOWN') || !/gold deriv manual/i.test(openTrade.reason ?? '')) {
      reply.code(409);
      return { error: 'the open account contract is not a Gold Deriv multiplier trade' };
    }
    if (!openTrade.contract_id) {
      reply.code(409);
      return { error: 'Gold purchase outcome is unknown; reconcile at Deriv before closing locally' };
    }
    if (!client.isConnected) {
      try {
        const token = await resolveStoredToken();
        const connected = await client.reconnect(token, session.loginid);
        if (connected.mode !== 'demo') {
          reply.code(403);
          return { error: 'Gold trades are restricted to a Deriv demo account' };
        }
      } catch (error) {
        reply.code(409);
        return { error: `socket reconnect failed: ${String(error)}` };
      }
    }
    try {
      const sold = await accountCoordinator.runCommand('manual_close', session.loginid, () => client.sellContract(openTrade.contract_id, 0));
      const profit = Math.round((sold.soldFor - openTrade.stake) * 100) / 100;
      const status = profit > 0 ? 'won' : profit < 0 ? 'lost' : 'push';
      resolveTrade(openTrade.id, status, profit, sold.contractId, undefined, openTrade.account_id);
      try { resolveGoldTradeKnowledge(openTrade.id, status, profit, null, Date.now()); } catch (error) { console.warn(`[gold trade knowledge] close result failed: ${String(error)}`); }
      activeSettlements.delete(settlementKeyFor(openTrade.account_id, openTrade.id, openTrade.contract_id));
      const trade = getTrade(openTrade.id, openTrade.account_id) ?? openTrade;
      const performance = getPerformanceSummary(openTrade.account_id);
      hub.emit({ type: 'trade', ts: Date.now(), trade, performance, manual: true, gold: true, settled: true, sold: true });
      hub.emit({
        type: 'contract',
        ts: Date.now(),
        contractId: sold.contractId,
        tradeId: openTrade.id,
        result: status,
        profit,
        sellPrice: sold.soldFor,
        buyPrice: openTrade.stake,
        sold: true,
        settled: true,
        status,
      });
      return {
        ok: true,
        trade,
        sold: {
          contractId: sold.contractId,
          soldFor: sold.soldFor,
          profit,
          balanceAfter: sold.balanceAfter,
          transactionId: sold.transactionId,
          referenceId: sold.referenceId,
        },
      };
    } catch (error) {
      reply.code(503);
      return { error: `Gold close failed: ${error instanceof Error ? error.message : String(error)}` };
    }
  });

  app.get('/api/momentum/state', async () => ({ state: momentum?.state() ?? null }));
  app.post('/api/momentum/start', async (req, reply) => {
    if (!requireOwner(req, reply)) return;
    if (!momentum) { reply.code(503); return { error: 'momentum observer unavailable' }; }
    try {
      return { state: await momentum.startAutomatic() };
    } catch (error) { reply.code(400); return { error: String(error) }; }
  });
  app.post('/api/momentum/stop', async (req, reply) => {
    if (!requireOwner(req, reply)) return;
    return { state: momentum?.stop() ?? null };
  });
  app.post('/api/momentum/focus', async (req, reply) => {
    if (!requireOwner(req, reply)) return;
    if (!momentum) { reply.code(503); return { error: 'momentum observer unavailable' }; }
    const symbol = String((req.body as { symbol?: unknown } | undefined)?.symbol ?? '');
    if (!symbol) { reply.code(400); return { error: 'a watched market symbol is required' }; }
    try {
      return { state: momentum.focus(symbol) };
    } catch (error) { reply.code(409); return { error: String(error) }; }
  });

  app.post('/api/multiplier/options', async (req, reply) => {
    if (!requireOwner(req, reply)) return;
    const session = getSession();
    if (!session) {
      reply.code(401);
      return { error: 'connect a Deriv demo account to check multiplier limits' };
    }
    if (session.mode !== 'demo') {
      reply.code(403);
      return { error: 'multiplier limit checks are restricted to a Deriv demo account' };
    }

    const body = (req.body ?? {}) as { symbol?: unknown; direction?: unknown; stake?: unknown };
    const symbol = String(body.symbol ?? '').trim();
    const direction = body.direction === 'down' || body.direction === 'SELL'
      ? 'down'
      : body.direction === 'up' || body.direction === 'BUY'
        ? 'up'
        : null;
    const requestedStake = Number(body.stake);
    const stake = Number.isFinite(requestedStake) && requestedStake > 0
      ? Math.max(.35, Math.round(requestedStake * 100) / 100)
      : 1;

    if (!symbol || !direction) {
      reply.code(400);
      return { error: 'symbol and up/down direction are required' };
    }

    if (!client.isConnected) {
      try {
        const token = await resolveStoredToken();
        const connected = await client.reconnect(token, session.loginid);
        if (connected.mode !== 'demo') {
          reply.code(403);
          return { error: 'multiplier limit checks are restricted to a Deriv demo account' };
        }
      } catch (error) {
        reply.code(409);
        return { error: `socket reconnect failed: ${String(error)}` };
      }
    }

    try {
      return await probeMultiplierOptions({
        symbol,
        direction,
        stake,
        currency: session.currency || 'USD',
      });
    } catch (error) {
      reply.code(502);
      return { error: `multiplier limit check failed: ${String(error)}` };
    }
  });

  /**
   * An explicit, demo-only order against the market currently focused by
   * Momentum research. Momentum itself is observation-only: this endpoint is
   * the only path that can convert a user click into a multiplier purchase.
   */
  app.post('/api/momentum/trade', async (req, reply) => {
    if (!requireOwner(req, reply)) return;
    if (!momentum) {
      reply.code(503);
      return { error: 'momentum observer unavailable' };
    }
    const session = getSession();
    if (!session) {
      reply.code(401);
      return { error: 'connect a Deriv demo account to place a Momentum trade' };
    }
    if (session.mode !== 'demo') {
      reply.code(403);
      return { error: 'Momentum trades are restricted to a Deriv demo account' };
    }
    if (automation.isRunning()) {
      reply.code(409);
      return { error: 'stop the bot before placing a Momentum trade' };
    }

    const body = (req.body ?? {}) as { direction?: unknown; stake?: unknown; multiplier?: unknown; takeProfit?: unknown; stopLoss?: unknown };
    const direction = body.direction === 'up' || body.direction === 'down' ? body.direction : null;
    const stake = Number(body.stake);
    const requestedMultiplier = Number(body.multiplier);
    const multiplier = Number.isFinite(requestedMultiplier) && requestedMultiplier > 0
      ? Math.floor(requestedMultiplier)
      : undefined;
    const takeProfit = Number(body.takeProfit);
    const stopLoss = Number(body.stopLoss);
    if (!direction || !Number.isFinite(stake) || stake <= 0) {
      reply.code(400);
      return { error: 'an up/down direction and a positive stake are required' };
    }
    if (multiplier === undefined || multiplier <= 0) {
      reply.code(400);
      return { error: 'a positive multiplier is required' };
    }
    if ((Number.isFinite(takeProfit) && takeProfit <= 0) || (Number.isFinite(stopLoss) && stopLoss <= 0)) {
      reply.code(400);
      return { error: 'take profit and stop loss must be positive when provided' };
    }

    const research = momentum.state();
    if (!research.running || research.phase !== 'observing' || !research.config || !research.window) {
      reply.code(409);
      return { error: 'focus an active Momentum research market before placing a trade' };
    }
    const settings = getSettings();
    if (stake > settings.max_stake) {
      reply.code(400);
      return { error: `stake exceeds the configured maximum (${settings.max_stake})` };
    }
    // Reconnect before checking durable reservations. Otherwise a stale local
    // pending row is counted while its settled Deriv contract cannot be
    // verified, producing a false "two open lots" block.
    if (!client.isConnected) {
      try {
        const token = await resolveStoredToken();
        const connected = await client.reconnect(token, session.loginid);
        if (connected.mode !== 'demo') {
          reply.code(403);
          return { error: 'Momentum trades are restricted to a Deriv demo account' };
        }
      } catch (error) {
        reply.code(409);
        return { error: `socket reconnect failed: ${String(error)}` };
      }
    }
    await reconcileSettledMultiplierLots(`deriv:${session.loginid}`);
    const admission = multiplierLotAdmission(`deriv:${session.loginid}`, 'momentum', stake, session.balance);
    if (admission) {
      reply.code(409);
      return { error: `Momentum trade blocked: ${admission}` };
    }
    const gate = riskCheck({
      stake,
      settings,
      balance: session.balance,
      context: buildRecoveryContext(settings),
      // The product caps and serialized command lane replace the old
      // single-contract cooldown for independently managed Momentum lots.
      lastTradeAt: 0,
      tradeGapMs: 0,
      now: Date.now(),
      // Momentum demo orders never join the digit recovery cycle, so its debt
      // cap must not gate them; every other rail above still applies.
      skipRecoveryDebtCap: true,
      lane: 'momentum',
      skipOpenContractCheck: true,
    });
    if (!gate.ok) {
      reply.code(409);
      return { error: `Momentum trade blocked: ${gate.reason}` };
    }

    // A scan can complete while a user is deciding. Re-read the focus state so
    // the proposal cannot be pointed at a stale or automatically changed market.
    const current = momentum.state();
    if (
      !current.running || current.phase !== 'observing' || !current.config || !current.window
      || current.config.symbol !== research.config.symbol
    ) {
      reply.code(409);
      return { error: 'Momentum research changed; review the focused market before trading' };
    }

    const signal = current.window.decisionSignal ?? current.window.signal;
    if (!signal || signal.direction === 'wait' || !Number.isFinite(signal.confidence) || !signal.reason) {
      reply.code(409);
      return { error: 'Momentum research has no validated direction yet; keep observing before trading' };
    }
    if (direction !== signal.direction) {
      reply.code(409);
      return { error: `Momentum research recommends ${signal.direction.toUpperCase()}; review before trading the opposite direction` };
    }
    const momentumMarkets = Array.isArray(current.markets) ? current.markets : [];
    const currentMarket = momentumMarkets.find((market) => market.symbol === current.config!.symbol)
      ?? { symbol: current.config.symbol, display: current.config.symbol, market: 'unknown' };
    const entryGuard = momentumEntryGuard(
      currentMarket,
      signal,
      current.window.samples ?? [],
      getMomentumResearchProfile(current.config.symbol, signal.direction),
    );
    if (!entryGuard.ok) {
      reply.code(409);
      return { error: `Momentum entry blocked: ${entryGuard.reason}` };
    }
    const reason = [
      `momentum manual ${direction.toUpperCase()}`,
      `five-minute multiplier x${multiplier}`,
      Number.isFinite(takeProfit) ? `TP ${takeProfit}` : null,
      Number.isFinite(stopLoss) ? `SL ${stopLoss}` : null,
      `research ${signal.direction.toUpperCase()} ${signal.confidence}%`,
      signal.reason,
    ].filter(Boolean).join(' | ');
    let recordedTrade: ReturnType<typeof insertTrade> | null = null;
    let stage: 'proposal' | 'reserve' | 'buy' | 'finalize' = 'proposal';
    let buyAttempted = false;
    let bought: { contractId: string; payout: number; buyPrice: number; purchaseTime: number } | null = null;
    let quoteForRecovery: Awaited<ReturnType<typeof client.getMultiplierQuote>> | null = null;
    try {
      // The proposal is intentionally obtained immediately before the buy.
      // No scanner quote is reused for an account order.
      const quote = quoteForRecovery = await client.getMultiplierQuote({
        direction,
        amount: stake,
        currency: session.currency || 'USD',
        symbol: current.config.symbol,
        multiplier,
        takeProfit: Number.isFinite(takeProfit) ? takeProfit : undefined,
        stopLoss: Number.isFinite(stopLoss) ? stopLoss : undefined,
      });
      if (!(quote.askPrice > 0) || !Number.isFinite(quote.askPrice)) {
        throw new Error('multiplier proposal returned an invalid purchase price');
      }
      stage = 'reserve';
      const afterQuote = momentum.state();
      if (
        !afterQuote.running || afterQuote.phase !== 'observing' || !afterQuote.config || !afterQuote.window
        || afterQuote.config.symbol !== current.config.symbol
      ) {
        reply.code(409);
        return { error: 'Momentum research changed while the quote was loading; review it before trading' };
      }
      // The synchronous insert below is the durable reservation.  Commands
      // remain serialized, while separate lots may coexist within the caps.
      const afterQuoteAdmission = multiplierLotAdmission(`deriv:${session.loginid}`, 'momentum', quote.askPrice, session.balance);
      if (afterQuoteAdmission) {
        reply.code(409);
        return { error: `Momentum trade blocked: ${afterQuoteAdmission}` };
      }
      const trade = recordedTrade = insertTrade({
        ts: Date.now(),
        market: current.config.symbol,
        contract_type: direction === 'up' ? 'MULTUP' : 'MULTDOWN',
        barrier: 0,
        duration: 5,
        duration_unit: 'm',
        stake,
        ask_price: quote.askPrice,
        payout: quote.payout,
        est_win: 0,
        profit: 0,
        status: 'purchasing',
        contract_id: '',
        purchase_id: `momentum-manual-${Date.now()}`,
        reason,
        origin: 'manual',
      });
      stage = 'buy';
      buyAttempted = true;
      bought = await accountCoordinator.runCommand('manual_open', session.loginid, () => client.placeBuy(quote.id, quote.askPrice));
      const actualStake = bought.buyPrice > 0 ? bought.buyPrice : quote.askPrice;
      const actualPayout = bought.payout > 0 ? bought.payout : quote.payout;
      const entrySnapshot = registry.snapshot(current.config.symbol);
      const entrySpot = Number.isFinite(quote.spot) && quote.spot > 0 ? quote.spot : entrySnapshot.lastQuote;
      stage = 'finalize';
      markTradePurchased(trade.id, bought.contractId, actualStake, actualPayout, trade.account_id, entrySpot, entrySnapshot.lastDigit);
      const purchased = getTrade(trade.id, trade.account_id) ?? trade;
      settleInBackground(client, hub, trade.id, bought.contractId, actualStake, actualPayout, trade.account_id);
      hub.emit({ type: 'trade', ts: Date.now(), trade: purchased, manual: true, momentum: true });
      return {
        ok: true,
        trade: {
          id: trade.id,
          contractId: bought.contractId,
          market: current.config.symbol,
          contractType: trade.contract_type,
          ask: actualStake,
          payout: actualPayout,
          duration: '5m',
          multiplier,
          entryPrice: entrySpot,
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const logContext = {
        stage,
        tradeId: recordedTrade?.id ?? null,
        accountId: recordedTrade?.account_id ?? null,
        market: current.config.symbol,
        direction,
        stake,
        buyAttempted,
        buyConfirmed: Boolean(bought?.contractId),
        error: message,
      };

      if (recordedTrade && buyAttempted && !bought) {
        // A timeout or socket drop after the buy frame was sent is ambiguous:
        // Deriv may have accepted it. Keep the purchasing lock so a retry
        // cannot open a second contract against the same account.
        try {
          markTradePurchaseOutcomeUnknown(recordedTrade.id, recordedTrade.account_id);
        } catch (persistenceError) {
          console.error('[momentum manual] could not record uncertain purchase', {
            ...logContext,
            persistenceError: String(persistenceError),
          });
        }
        console.warn('[momentum manual] purchase outcome unknown', logContext);
        reply.code(503);
        return {
          error: 'purchase outcome unknown; the account is locked for reconciliation. Do not retry this order.',
          code: 'purchase_outcome_unknown',
        };
      }

      if (recordedTrade && bought) {
        // The provider confirmed a contract. A local ledger/hub failure must
        // never downgrade it to error or erase the contract identifier.
        try {
          const existing = getTrade(recordedTrade.id, recordedTrade.account_id);
          if (existing?.contract_id !== bought.contractId) {
            const quote = quoteForRecovery;
            const entry = registry.snapshot(current.config.symbol);
            markTradePurchased(
              recordedTrade.id,
              bought.contractId,
              bought.buyPrice > 0 ? bought.buyPrice : quote?.askPrice ?? recordedTrade.ask_price,
              bought.payout > 0 ? bought.payout : quote?.payout ?? recordedTrade.payout,
              recordedTrade.account_id,
              quote?.spot ?? entry.lastQuote,
              entry.lastDigit,
            );
          }
          const persisted = getTrade(recordedTrade.id, recordedTrade.account_id);
          if (persisted?.contract_id === bought.contractId) {
            settleInBackground(client, hub, persisted.id, bought.contractId, persisted.stake, persisted.payout, persisted.account_id);
          }
        } catch (persistenceError) {
          console.error('[momentum manual] confirmed purchase needs reconciliation', {
            ...logContext,
            contractId: bought.contractId,
            persistenceError: String(persistenceError),
          });
        }
        console.error('[momentum manual] confirmed purchase finalization failed', {
          ...logContext,
          contractId: bought.contractId,
        });
        reply.code(202);
        return {
          ok: true,
          warning: 'purchase was confirmed; local status is reconciling',
          contractId: bought.contractId,
        };
      }

      if (recordedTrade) {
        // This failure occurred before a buy request was sent, so it cannot
        // represent a live account contract.
        resolveTrade(recordedTrade.id, 'error', 0, '', undefined, recordedTrade.account_id);
      }
      console.warn('[momentum manual] order failed before purchase', logContext);
      reply.code(502);
      return { error: `Momentum ${stage} failed: ${message}` };
    }
  });

  app.post('/api/momentum/close', async (req, reply) => {
    if (!requireOwner(req, reply)) return;
    const session = getSession();
    if (!session) {
      reply.code(401);
      return { error: 'connect a Deriv demo account to close a Momentum trade' };
    }
    if (session.mode !== 'demo') {
      reply.code(403);
      return { error: 'Momentum trades are restricted to a Deriv demo account' };
    }
    const target = findOpenTradeForClose(
      (req.body ?? {}) as CloseTarget,
      'Momentum',
      (trade) => (trade.contract_type === 'MULTUP' || trade.contract_type === 'MULTDOWN') && !isGoldDerivTrade(trade),
    );
    if (!target.trade) {
      reply.code(409);
      const multiplierTrade = getOpenTradeByLane('multiplier');
      return {
        error: target.error === 'no open Momentum trade found' && multiplierTrade
          ? 'the open contract is not a Momentum multiplier trade'
          : target.error,
      };
    }
    const openTrade = target.trade;
    if ((openTrade.contract_type !== 'MULTUP' && openTrade.contract_type !== 'MULTDOWN') || isGoldDerivTrade(openTrade)) {
      reply.code(409);
      return { error: 'the open contract is not a Momentum multiplier trade' };
    }
    if (!openTrade.contract_id) {
      reply.code(409);
      return { error: 'Momentum purchase outcome is unknown; reconcile at Deriv before closing locally' };
    }

    if (!client.isConnected) {
      try {
        const token = await resolveStoredToken();
        const connected = await client.reconnect(token, session.loginid);
        if (connected.mode !== 'demo') {
          reply.code(403);
          return { error: 'Momentum trades are restricted to a Deriv demo account' };
        }
      } catch (error) {
        reply.code(409);
        return { error: `socket reconnect failed: ${String(error)}` };
      }
    }

    try {
      const sold = await accountCoordinator.runCommand('manual_close', session.loginid, () => client.sellContract(openTrade.contract_id, 0));
      const profit = Math.round((sold.soldFor - openTrade.stake) * 100) / 100;
      const status = profit > 0 ? 'won' : profit < 0 ? 'lost' : 'push';
      resolveTrade(openTrade.id, status, profit, sold.contractId, undefined, openTrade.account_id);
      activeSettlements.delete(settlementKeyFor(openTrade.account_id, openTrade.id, openTrade.contract_id));
      const trade = getTrade(openTrade.id, openTrade.account_id) ?? openTrade;
      const performance = getPerformanceSummary(openTrade.account_id);
      hub.emit({ type: 'trade', ts: Date.now(), trade, performance, manual: true, momentum: true, settled: true, sold: true });
      hub.emit({
        type: 'contract',
        ts: Date.now(),
        contractId: sold.contractId,
        tradeId: openTrade.id,
        result: status,
        profit,
        sellPrice: sold.soldFor,
        buyPrice: openTrade.stake,
        sold: true,
        settled: true,
        status,
      });
      return {
        ok: true,
        trade,
        session: (() => {
          const updated = getSession();
          return updated ? {
            loginid: updated.loginid,
            balance: updated.balance,
            currency: updated.currency,
            mode: updated.mode,
            auth_kind: updated.auth_kind,
          } : null;
        })(),
        sold: {
          contractId: sold.contractId,
          soldFor: sold.soldFor,
          profit,
          balanceAfter: sold.balanceAfter,
          transactionId: sold.transactionId,
          referenceId: sold.referenceId,
        },
      };
    } catch (error) {
      reply.code(503);
      return { error: `Momentum close failed: ${error instanceof Error ? error.message : String(error)}` };
    }
  });

  app.get('/api/settings', async () => getSettings());

  app.get('/api/entry-lab', async () => ({
    state: entryResearch ? entryLabDashboardState(entryResearch.state()) : null,
  }));

  app.put('/api/settings', async (req, reply) => {
    if (!requireOwner(req, reply)) return;
    const body = req.body as Record<string, unknown>;
    if (!body || typeof body !== 'object') {
      reply.code(400);
      return { error: 'invalid settings' };
    }
    const numeric = [
      'base_stake',
      'max_stake',
      'min_edge',
      'min_recovery_win',
      'martingale_steps',
      'max_consecutive_losses',
      'strategy_multiplier',
      'recovery_buffer',
      'chase_amortize',
      'max_recovery_debt',
      'max_recovery_exposure',
      'max_drawdown_pct',
      'barrier_number',
      'pattern_weight',
      'pattern_weight_conservative',
      'pattern_weight_martingale',
      'pattern_weight_boosted_martingale',
      'pattern_weight_chase',
    ];
    const patch: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(body)) {
      if (k === 'barrier_preference' && typeof v === 'string') patch[k] = v;
      else if (k === 'strategy_mode' && typeof v === 'string') patch[k] = v;
      else if (k === 'bot_mode' && (v === 'rapid' || v === 'balanced' || v === 'strict')) patch[k] = v;
      else if (k === 'entry_mode' && (v === 'model' || v === 'digit_trigger' || v === 'digit_trigger_confirmed' || v === 'proven_best')) patch[k] = v;
      else if (numeric.includes(k) && (typeof v === 'number') && Number.isFinite(v)) patch[k] = v;
      else if (k === 'pattern_weight_conservative' || k === 'pattern_weight_martingale' || k === 'pattern_weight_boosted_martingale' || k === 'pattern_weight_chase') {
        if (v === null) patch[k] = null;
        else if (typeof v === 'number' && Number.isFinite(v)) patch[k] = v;
      }
    }
    return updateSettings(patch);
  });

  app.get('/api/history', async (req) => {
    if (!isOwner(req)) return { trades: [], evidence: [], performance: { wins: 0, losses: 0, pushes: 0, profit: 0, reset_at: 0 } };
    const q = req.query as { limit?: string };
    const limit = Math.min(200, Math.max(1, Number(q.limit) || 50));
    return { trades: listTrades(limit), evidence: digitTradeEvidence(), performance: getPerformanceSummary() };
  });

  // Account entries are scoped to the active Deriv login and never include
  // virtual research.
  app.get('/api/ledger', async (req) => {
    if (!isOwner(req)) return { entries: [] };
    const q = req.query as { limit?: string };
    const limit = Math.min(500, Math.max(1, Number(q.limit) || 100));
    return { entries: listLedgerEntries(limit) };
  });

  app.get('/api/paper/history', async (req) => {
    if (!isOwner(req)) return { entries: [] };
    const q = req.query as { limit?: string };
    const limit = Math.min(500, Math.max(1, Number(q.limit) || 100));
    return { entries: listPaperLedgerEntries(limit) };
  });

  // A logical virtual contract can have purchased + settled/cancelled audit
  // rows. Keep the dashboard API grouped, while the immutable ledger remains
  // available for audit detail.
  app.get('/api/paper/trades', async (req) => {
    if (!isOwner(req)) return { trades: [] };
    const q = req.query as { limit?: string };
    const limit = Math.min(500, Math.max(1, Number(q.limit) || 100));
    return { trades: listPaperTrades(limit) };
  });

  app.get('/api/paper/trades/:contractRef', async (req, reply) => {
    if (!requireOwner(req, reply)) return;
    const { contractRef } = req.params as { contractRef?: string };
    if (!contractRef || contractRef.length > 300) {
      reply.code(400);
      return { error: 'invalid paper contract reference' };
    }
    const trade = getPaperTrade(contractRef);
    if (!trade) {
      reply.code(404);
      return { error: 'paper trade not found' };
    }
    return { trade };
  });

  app.get('/api/performance', async (req) =>
    isOwner(req) ? getPerformanceSummary() : { wins: 0, losses: 0, pushes: 0, profit: 0, reset_at: 0 },
  );

  app.post('/api/performance/reset', async (req, reply) => {
    if (!requireOwner(req, reply)) return;
    return resetPerformanceSummary();
  });

  app.get('/api/calibration', async () => getCalibration());

  app.post('/api/test/backtest', async (req, reply) => {
    if (!requireOwner(req, reply)) return;
    if (automation.isRunning()) {
      reply.code(409);
      return { error: 'stop the bot before running a backtest' };
    }
    const body = (req.body ?? {}) as Record<string, unknown>;
    const options = {
      baseStake: typeof body.base_stake === 'number' ? body.base_stake : undefined,
      target: typeof body.target === 'number' ? body.target : undefined,
      configs: Array.isArray(body.configs) ? (body.configs as string[]) : undefined,
    };
    try {
      const out = await runBacktest({
        ...options,
        configs: options.configs ? parseTestConfigs(options.configs) : undefined,
        onProgress: (p) => hub.emit({ type: 'testlab', ts: Date.now(), kind: 'backtest', ...p }),
      });
      return { ok: true, runs: out.runs, results: out.results };
    } catch (err) {
      reply.code(500);
      return { error: String(err) };
    }
  });

  app.post('/api/paper/start', async (req, reply) => {
    if (!requireOwner(req, reply)) return;
    paperSimulator.start();
    return { ok: true, state: paperSimulator.state() };
  });

  app.post('/api/paper/stop', async (req, reply) => {
    if (!requireOwner(req, reply)) return;
    paperSimulator.stop();
    return { ok: true, state: paperSimulator.state() };
  });

  app.post('/api/paper/reset', async (req, reply) => {
    if (!requireOwner(req, reply)) return;
    paperSimulator.reset();
    return { ok: true, state: paperSimulator.state() };
  });

  // This old endpoint executed real one-tick contracts on a connected demo
  // account. Keep the failure explicit so a stale dashboard cannot silently
  // spend account funds after the pure simulator rollout.
  app.post('/api/test/paper', async (req, reply) => {
    if (!requireOwner(req, reply)) return;
    reply.code(410);
    return { error: 'account-funded paper sweeps are retired; use /api/paper/start' };
  });

  app.get('/api/test/runs', async (req) => {
    const q = req.query as { kind?: string; limit?: string };
    const kind = q.kind === 'backtest' || q.kind === 'paper' || q.kind === undefined ? q.kind : undefined;
    const limit = Math.min(500, Math.max(1, Number(q.limit) || 200));
    return { runs: kind ? listTestRuns(kind, limit) : listTestRuns(undefined, limit) };
  });

  app.get('/api/test/evidence', async (req) => {
    const q = req.query as { limit?: string };
    const limit = Math.min(1000, Math.max(1, Number(q.limit) || 500));
    const events = listDecisionEvents(limit);
    return { evidence: buildDecisionEvidenceReport(events) };
  });

  app.get('/api/test/backtest/status', async () => {
    const intervalMs = config.autoBacktestHours * 3_600_000;
    const lastRunAt = Number(getMeta('backtest_last_run_at') ?? 0);
    return {
      intervalMs,
      lastRunAt,
      nextRunAt: lastRunAt > 0 ? lastRunAt + intervalMs : Date.now() + intervalMs,
      lastFingerprint: Number(getMeta('backtest_last_fingerprint') ?? 0),
      minNewDigits: config.autoBacktestMinNewDigits,
    };
  });

  app.get('/api/test/paper/status', async () => {
    return {
      enabled: false,
      intervalMs: 0,
      lastRunAt: 0,
      nextRunAt: null,
      reason: 'account-funded paper sweeps are retired; pure virtual simulation is operator-controlled',
    };
  });

  app.post('/api/patterns/scan', async (req, reply) => {
    if (!requireOwner(req, reply)) return;
    try {
      const result = await scanPatterns((done, total, message) =>
        hub.emit({ type: 'testlab', ts: Date.now(), kind: 'patterns', phase: 'scanning', done, total, message }),
      );
      return { ok: true, result };
    } catch (err) {
      reply.code(500);
      return { error: String(err) };
    }
  });

  app.get('/api/patterns', async () => {
    return { patterns: listStoredPatterns(), calibration: buildCalibrationReport() };
  });

  app.post('/api/auth/pat', async (req, reply) => {
    if (!requireOwner(req, reply)) return;
    const body = req.body as { token?: string };
    const token = body?.token?.trim();
    if (!token) {
      reply.code(400);
      return { error: 'token required' };
    }
    try {
      const info = await client.connect(token);
      const created = Date.now();
      setSession({
        id: crypto.randomUUID(),
        loginid: info.loginid,
        balance: info.balance,
        currency: info.currency,
        mode: info.mode,
        auth_kind: 'pat',
        token_cipher: encryptToken(token),
        created_at: created,
        updated_at: created,
      });
      hub.emit({ type: 'session', ts: Date.now(), session: { ...info } });
      return { ok: true, session: info };
    } catch (err) {
      reply.code(401);
      return { error: String(err) };
    }
  });

  app.get('/api/auth/oauth/start', async (req, reply) => {
    if (!requireOwner(req, reply)) return;
    const { verifier, challenge } = newPkce();
    const state = crypto.randomUUID();
    oauthPending.set(state, { verifier, created: Date.now() });
    return { ok: true, url: buildAuthorizeUrl(state, challenge) };
  });

  app.get('/api/auth/oauth/callback', async (req, reply) => {
    if (!requireOwner(req, reply)) return;
    const q = (req.query ?? {}) as Record<string, string | string[]>;
    const str = (k: string): string | undefined => {
      const v = q[k];
      return Array.isArray(v) ? v[0] : typeof v === 'string' ? v : undefined;
    };

    const picks: Array<{ account?: string; token: string }> = [];
    for (let i = 1; i <= 30; i++) {
      const t = str(`token${i}`);
      if (t) picks.push({ account: str(`acct${i}`), token: t });
    }

    let token: string | null = null;
    let tokenSet: TokenSet | null = null;

    if (picks.length > 0) {
      const preferred = config.derivAccountId
        ? picks.find((p) => String(p.account) === config.derivAccountId)
        : undefined;
      token = (preferred ?? picks[0]).token;
    } else {
      const code = str('code');
      const state = str('state');
      const entry = state ? oauthPending.get(state) : undefined;
      if (code && entry) {
        oauthPending.delete(state!);
        try {
          tokenSet = await exchangeOauthCode(code, entry.verifier);
          token = tokenSet.accessToken;
        } catch (err) {
          reply.redirect(`/?oauth=error&msg=${encodeURIComponent(String(err))}`);
          return;
        }
      }
    }

    if (!token) {
      reply.redirect('/?oauth=error&msg=missing OAuth token/code in callback');
      return;
    }

    try {
      const info = await client.connect(token);
      const created = Date.now();
      setSession({
        id: crypto.randomUUID(),
        loginid: info.loginid,
        balance: info.balance,
        currency: info.currency,
        mode: info.mode,
        auth_kind: 'oauth',
        token_cipher: encryptToken(tokenSet ? serializeOAuth(tokenSet) : token),
        created_at: created,
        updated_at: created,
      });
      hub.emit({ type: 'session', ts: Date.now(), session: { ...info } });
      reply.redirect('/?oauth=ok');
    } catch (err) {
      reply.redirect(`/?oauth=error&msg=${encodeURIComponent(String(err))}`);
    }
  });

  app.post('/api/auth/reconnect', async (req, reply) => {
    if (!requireOwner(req, reply)) return;
    const session = getSession();
    if (!session) {
      reply.code(401);
      return { error: 'no session' };
    }
    try {
      const token = await resolveStoredToken();
      const info = await client.connect(token, session.loginid);
      return { ok: true, session: info };
    } catch (err) {
      reply.code(401);
      return { error: String(err) };
    }
  });

  app.get('/api/auth/accounts', async (req, reply) => {
    if (!requireOwner(req, reply)) return;
    if (!getSession()) {
      reply.code(401);
      return { error: 'no session' };
    }
    try {
      const accounts = await listDerivAccounts(await resolveStoredToken());
      return { accounts: accounts.map((account) => ({
        accountId: String(account.account_id),
        mode: String(account.account_type ?? '').toLowerCase().includes('demo') ? 'demo' : 'real',
        currency: account.currency || '',
        balance: Number(account.balance ?? 0),
        status: account.status || '',
      })) };
    } catch (err) {
      reply.code(502);
      return { error: String(err) };
    }
  });

  app.post('/api/auth/switch-account', async (req, reply) => {
    if (!requireOwner(req, reply)) return;
    const session = getSession();
    const accountId = String((req.body as { accountId?: unknown } | undefined)?.accountId ?? '').trim();
    if (!session || !accountId) {
      reply.code(400);
      return { error: 'connected session and accountId required' };
    }
    const token = await resolveStoredToken();
    const currentAccountId = `deriv:${session.loginid}`;
    clearAbandonedLocalReservations(currentAccountId);
    // A browser reload or dropped WebSocket can leave a settled provider
    // contract marked pending locally. Reconnect to the *current* account and
    // ask Deriv for the authoritative state before refusing the switch.
    let contractCheck: { portfolioChecked: boolean; listedContractIds: Set<string> } | null = null;
    if (getOpenTrade(currentAccountId)?.contract_id) {
      try {
        // `isConnected` can be true for a socket whose account authorization
        // is already stale. Switching is infrequent, so use a clean current
        // account connection rather than trusting that flag.
        await client.reconnect(token, session.loginid);
        contractCheck = await reconcileAccountSwitchContracts(currentAccountId);
      } catch {
        // Keep the protective block below if broker state cannot be verified.
      }
    }
    const openTrade = getOpenTrade(currentAccountId);
    if (openTrade) {
      reply.code(409);
      const contractId = openTrade.contract_id || String(openTrade.id);
      if (openTrade.contract_id && contractCheck?.portfolioChecked && contractCheck.listedContractIds.has(openTrade.contract_id)) {
        return { error: `Deriv confirms contract ${contractId} is still open in this account. Close or cash out that contract before switching accounts.` };
      }
      if (openTrade.contract_id) {
        return { error: `Could not verify contract ${contractId} with Deriv. The account switch was kept locked to protect the position; reconnect and try again.` };
      }
      return { error: `Local order ${contractId} is still being submitted. Wait briefly and try switching again.` };
    }
    automation.stop('account switch');
    storeSetAutomation({ armed_until: 0 });
    const tokenSession = getSession() ?? session;
    try {
      const info = await client.reconnect(token, accountId);
      if (info.loginid !== accountId || client.connectedAccountId !== accountId) throw new Error('Deriv connected to a different account; the account switch was not completed');
      const now = Date.now();
      setSession({ ...tokenSession, id: crypto.randomUUID(), loginid: info.loginid, balance: info.balance,
        currency: info.currency, mode: info.mode, created_at: now, updated_at: now });
      hub.emit({ type: 'session', ts: now, session: { ...info } });
      return { ok: true, session: info };
    } catch (err) {
      try { await client.reconnect(token, session.loginid); } catch { /* reconnect loop will retry */ }
      reply.code(502);
      return { error: String(err) };
    }
  });

  /** Explicit owner action for the one contract currently preventing an account switch. */
  app.post('/api/auth/close-open-contract', async (req, reply) => {
    if (!requireOwner(req, reply)) return;
    const session = getSession();
    const openTrade = getOpenTrade();
    if (!session || !openTrade?.contract_id) {
      reply.code(409);
      return { error: 'no cash-out eligible open contract is tracked for this account' };
    }
    try {
      if (!client.isConnected) await client.reconnect(await resolveStoredToken(), session.loginid);
      const sold = await accountCoordinator.runCommand('manual_close', session.loginid, () => client.sellContract(openTrade.contract_id, 0));
      const profit = Math.round((sold.soldFor - openTrade.stake) * 100) / 100;
      const status = profit >= 0 ? ('won' as const) : ('lost' as const);
      resolveTrade(openTrade.id, status, profit, sold.contractId, undefined, openTrade.account_id);
      activeSettlements.delete(settlementKeyFor(openTrade.account_id, openTrade.id, openTrade.contract_id));
      const trade = getTrade(openTrade.id, openTrade.account_id) ?? openTrade;
      hub.emit({ type: 'trade', ts: Date.now(), trade, performance: getPerformanceSummary(openTrade.account_id), manual: true, settled: true });
      return { ok: true, contractId: sold.contractId, soldFor: sold.soldFor };
    } catch (err) {
      reply.code(502);
      return { error: `cash-out for contract ${openTrade.contract_id} failed: ${String(err)}` };
    }
  });

  /**
   * Explicit, confirmed Account-page escape hatch. Portfolio is queried first
   * so this also closes a broker position that survived a lost browser/socket
   * session and is not represented by a local pending row.
   */
  app.post('/api/auth/close-all-open-contracts', async (req, reply) => {
    if (!requireOwner(req, reply)) return;
    const session = getSession();
    if (!session) {
      reply.code(401);
      return { error: 'not connected' };
    }
    try {
      // A fresh authorization makes the portfolio the source of truth for the
      // selected account before sending any sell commands.
      await client.reconnect(await resolveStoredToken(), session.loginid);
      const localTrades = listOpenTrades(session.loginid).filter((trade) => Boolean(trade.contract_id));
      const localByContractId = new Map(localTrades.map((trade) => [trade.contract_id, trade]));
      // Do not attempt to sell stale local rows: portfolio is the broker's
      // authoritative list of contracts that are truly open right now.
      const contractIds = await client.getOpenContractIds();
      const closed: Array<{ tradeId: number | null; contractId: string; soldFor: number }> = [];
      const failed: Array<{ tradeId: number | null; contractId: string; error: string }> = [];

      // Keep sell commands in the account command lane and run them one at a
      // time. This avoids overlapping provider requests and leaves a precise
      // result for any contract that cannot be cashed out.
      for (const contractId of contractIds) {
        const trade = localByContractId.get(contractId);
        try {
          const sold = await accountCoordinator.runCommand('manual_close', session.loginid, () => client.sellContract(contractId, 0));
          if (trade) {
            const profit = Math.round((sold.soldFor - trade.stake) * 100) / 100;
            const status = profit >= 0 ? ('won' as const) : ('lost' as const);
            resolveTrade(trade.id, status, profit, sold.contractId, undefined, trade.account_id);
            if (isGoldDerivTrade(trade)) {
              try { resolveGoldTradeKnowledge(trade.id, status, profit, null, Date.now()); } catch { /* non-critical research telemetry */ }
            }
            activeSettlements.delete(settlementKeyFor(trade.account_id, trade.id, trade.contract_id));
            const settledTrade = getTrade(trade.id, trade.account_id) ?? trade;
            hub.emit({ type: 'trade', ts: Date.now(), trade: settledTrade, performance: getPerformanceSummary(trade.account_id), manual: true, settled: true });
          }
          closed.push({ tradeId: trade?.id ?? null, contractId: sold.contractId, soldFor: sold.soldFor });
        } catch (error) {
          failed.push({
            tradeId: trade?.id ?? null,
            contractId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
      return {
        ok: failed.length === 0,
        closed,
        failed,
        message: contractIds.size === 0 ? 'No open contracts were found for this account.' : undefined,
      };
    } catch (error) {
      reply.code(502);
      return { error: `could not load open contracts from Deriv: ${error instanceof Error ? error.message : String(error)}` };
    }
  });

  app.post('/api/auth/logout', async (req, reply) => {
    if (!requireOwner(req, reply)) return;
    automation.stop('logged out');
    client.disconnect();
    clearSession();
    return { ok: true };
  });

  const performManualPurchase = async (
    order: ManualOrderInput,
    session: NonNullable<ReturnType<typeof getSession>>,
    preview?: ManualPreview,
  ): Promise<ManualExecutionResponse> => {
    assertManualPreflight(order, session);
    const accountId = accountIdForSession(session.loginid);
    const laneToken = crypto.randomUUID();
    manualLaneLocks.set(accountId, laneToken);
    let reservation: ReturnType<AccountCoordinator['reserve']> | null = null;
    let recordedTrade: ReturnType<typeof insertTrade> | null = null;
    let buyAttempted = false;
    let buyConfirmed = false;
    try {
      try {
        reservation = accountCoordinator.reserve({ accountId, product: 'digits', exposure: order.stake });
      } catch (error) {
        throw new ManualRequestError(409, `manual trade blocked: ${error instanceof Error ? error.message : String(error)}`);
      }
      await ensureManualClient(session);
      const entrySnapshot = registry.snapshot(order.market);
      if (!entrySnapshot.fresh) throw new ManualRequestError(409, 'the selected market feed became stale before purchase');
      const quote = await requestManualQuote(order, session);
      if (getSession()?.loginid !== session.loginid || client.connectedAccountId !== session.loginid) throw new ManualRequestError(409, 'Selected account changed while preparing the order. No trade was submitted.');
      if (preview) {
        const askWorsened = quote.askPrice > preview.ask * 1.02 + 1e-9;
        const payoutWorsened = quote.payout + 1e-9 < preview.payout * 0.98;
        if (askWorsened || payoutWorsened) {
          throw new ManualRequestError(409, 'the live quote moved more than 2%; review a fresh quote before buying');
        }
      }
      const estimatedWin = manualModelWin(order);
      const breakeven = quote.payout > 0 ? quote.askPrice / quote.payout : 1;
      const edge = estimatedWin - breakeven;
      const entryLabel = order.companionDemo
        ? 'companion-confirmed model entry'
        : order.entryMode === 'instant'
          ? 'manual trade-now entry'
          : order.entryMode === 'digit-trigger-confirmed'
            ? 'manual two-pass pattern entry'
            : order.entryMode === 'digit-trigger'
              ? 'manual pattern entry'
              : 'manual validated-model entry';
      const evidence = `model ${(estimatedWin * 100).toFixed(1)}% | breakeven ${(breakeven * 100).toFixed(1)}% | edge ${edge >= 0 ? '+' : ''}${(edge * 100).toFixed(1)}% | quote ${quote.askPrice.toFixed(2)}/${quote.payout.toFixed(2)}`;
      const trade = recordedTrade = insertTrade({
        ts: Date.now(),
        market: order.market,
        contract_type: order.direction === 'over' ? 'DIGITOVER' : 'DIGITUNDER',
        barrier: quote.barrier,
        duration: 1,
        duration_unit: 't',
        stake: order.stake,
        ask_price: quote.askPrice,
        payout: quote.payout,
        est_win: estimatedWin,
        profit: 0,
        status: 'purchasing',
        contract_id: '',
        purchase_id: `manual-${Date.now()}-${laneToken.slice(0, 8)}`,
        reason: `${entryLabel} | ${evidence}`,
        origin: 'manual',
      });
      const bought = await accountCoordinator.runCommand('manual_open', session.loginid, async () => {
        if (getSession()?.loginid !== session.loginid || client.connectedAccountId !== session.loginid) throw new ManualRequestError(409, 'Selected account changed before purchase. No trade was submitted.');
        const conflict = listOpenTrades(accountId).find((open) => open.id !== trade.id && (open.contract_type === 'DIGITOVER' || open.contract_type === 'DIGITUNDER'));
        if (conflict) throw new ManualRequestError(409, 'another digit contract opened before this purchase could be submitted');
        buyAttempted = true;
        const result = await client.placeBuy(quote.id, quote.askPrice);
        buyConfirmed = true;
        return result;
      });
      const actualStake = bought.buyPrice > 0 ? bought.buyPrice : quote.askPrice > 0 ? quote.askPrice : order.stake;
      const actualPayout = bought.payout > 0 ? bought.payout : quote.payout;
      markTradePurchased(trade.id, bought.contractId, actualStake, actualPayout, trade.account_id, entrySnapshot.lastQuote, entrySnapshot.lastDigit);
      const purchasedTrade = getTrade(trade.id, trade.account_id) ?? trade;
      hub.emit({ type: 'trade', ts: Date.now(), trade: purchasedTrade, manual: true });
      settleInBackground(client, hub, trade.id, bought.contractId, actualStake, actualPayout, trade.account_id);
      return {
        status: 200,
        body: {
          ok: true,
          trade: { id: trade.id, contractId: bought.contractId, ask: actualStake, payout: actualPayout, estimatedWin, breakeven, edge },
        },
      };
    } catch (error) {
      if (recordedTrade) {
        if (buyAttempted && !buyConfirmed) markTradePurchaseOutcomeUnknown(recordedTrade.id, recordedTrade.account_id);
        else resolveTrade(recordedTrade.id, 'error', 0, recordedTrade.contract_id || '', undefined, recordedTrade.account_id);
      }
      if (error instanceof ManualRequestError) throw error;
      console.warn(`[manual] order failed: ${error instanceof Error ? error.message : String(error)}`);
      throw new ManualRequestError(
        502,
        buyAttempted && !buyConfirmed
          ? 'purchase outcome is unknown at Deriv; the digit lane remains locked for reconciliation and no retry was submitted'
          : 'manual order could not be completed; no retry was submitted automatically',
      );
    } finally {
      if (reservation) accountCoordinator.release(reservation);
      if (manualLaneLocks.get(accountId) === laneToken) manualLaneLocks.delete(accountId);
    }
  };

  app.post('/api/trade/manual/preview', async (req, reply) => {
    if (!requireOwner(req, reply)) return;
    const session = getSession();
    if (!session) {
      reply.code(401);
      return { error: 'not connected' };
    }
    const expectedAccountId = (req.body as { expectedAccountId?: unknown } | undefined)?.expectedAccountId;
    if (expectedAccountId !== undefined && expectedAccountId !== session.loginid) {
      reply.code(409);
      return { error: 'The selected account changed. Refresh your account and try again; no trade was submitted.' };
    }
    try {
      cleanupManualState();
      const order = normalizeManualOrder(req.body);
      assertManualPreflight(order, session);
      await ensureManualClient(session);
      const snapshot = registry.snapshot(order.market);
      const quote = await requestManualQuote(order, session);
      const estimatedWin = manualModelWin(order);
      const breakeven = quote.payout > 0 ? quote.askPrice / quote.payout : 1;
      const preview: ManualPreview = {
        id: crypto.randomUUID(),
        accountId: accountIdForSession(session.loginid),
        createdAt: Date.now(),
        expiresAt: Date.now() + MANUAL_PREVIEW_TTL_MS,
        order,
        ask: quote.askPrice,
        payout: quote.payout,
        estimatedWin,
        breakeven,
        edge: estimatedWin - breakeven,
      };
      manualPreviews.set(preview.id, preview);
      return {
        previewId: preview.id,
        expiresAt: preview.expiresAt,
        order: { market: order.market, direction: order.direction, barrier: order.barrier, stake: order.stake, entryMode: order.entryMode },
        quote: { ask: quote.askPrice, payout: quote.payout, potentialProfit: Math.max(0, quote.payout - quote.askPrice), breakeven },
        model: { estimatedWin, edge: preview.edge },
        account: {
          mode: session.mode,
          currency: session.currency || 'USD',
          balance: session.balance,
          balanceAfter: Math.max(0, session.balance - quote.askPrice),
        },
        market: { display: snapshot.display, lastDigit: snapshot.lastDigit, lastEpoch: snapshot.lastEpoch, fresh: snapshot.fresh },
        risk: { ok: true as const, reason: 'All account, feed, stake, drawdown, and open-contract checks passed.' },
      };
    } catch (error) {
      reply.code(error instanceof ManualRequestError ? error.status : 502);
      return { error: error instanceof Error ? error.message : String(error) };
    }
  });

  app.post('/api/trade/manual/confirm', async (req, reply) => {
    if (!requireOwner(req, reply)) return;
    const session = getSession();
    if (!session) {
      reply.code(401);
      return { error: 'not connected' };
    }
    cleanupManualState();
    const body = (req.body ?? {}) as { previewId?: unknown; idempotencyKey?: unknown };
    const previewId = typeof body.previewId === 'string' ? body.previewId : '';
    const idempotencyKey = typeof body.idempotencyKey === 'string' ? body.idempotencyKey : '';
    if (!previewId || !idempotencyKey || idempotencyKey.length > 128) {
      reply.code(400);
      return { error: 'previewId and idempotencyKey are required' };
    }
    const preview = manualPreviews.get(previewId);
    const accountId = accountIdForSession(session.loginid);
    if (!preview || preview.expiresAt <= Date.now()) {
      reply.code(409);
      return { error: 'the quote review expired; request a fresh quote' };
    }
    if (preview.accountId !== accountId) {
      reply.code(403);
      return { error: 'the quote review belongs to a different account' };
    }
    if (preview.consumedBy && preview.consumedBy !== idempotencyKey) {
      reply.code(409);
      return { error: 'this quote review has already been confirmed' };
    }
    preview.consumedBy = idempotencyKey;
    const signature = JSON.stringify(preview.order);
    const result = await runManualIdempotent(accountId, idempotencyKey, signature, () => performManualPurchase(preview.order, session, preview));
    reply.code(result.status);
    return result.body;
  });

  app.post('/api/trade/manual', async (req, reply) => {
    if (!requireOwner(req, reply)) return;
    const session = getSession();
    if (!session) {
      reply.code(401);
      return { error: 'not connected' };
    }
    const expectedAccountId = (req.body as { expectedAccountId?: unknown } | undefined)?.expectedAccountId;
    if (expectedAccountId !== undefined && expectedAccountId !== session.loginid) {
      reply.code(409);
      return { error: 'The selected account changed. Refresh your account and try again; no trade was submitted.' };
    }
    try {
      const order = normalizeManualOrder(req.body);
      const body = (req.body ?? {}) as { idempotencyKey?: unknown };
      const idempotencyKey = typeof body.idempotencyKey === 'string' && body.idempotencyKey.length > 0 && body.idempotencyKey.length <= 128
        ? body.idempotencyKey
        : crypto.randomUUID();
      const accountId = accountIdForSession(session.loginid);
      const signature = JSON.stringify(order);
      const result = await runManualIdempotent(accountId, idempotencyKey, signature, () => performManualPurchase(order, session));
      reply.code(result.status);
      return result.body;
    } catch (error) {
      reply.code(error instanceof ManualRequestError ? error.status : 502);
      return { error: error instanceof Error ? error.message : String(error) };
    }
  });

  app.post('/api/trade/manual-basket', async (req, reply) => {
    if (!requireOwner(req, reply)) return;
    reply.code(410);
    return {
      error: 'live manual baskets are disabled; use the virtual-paper research tools instead',
    };
  });

  app.post('/api/automation/start', async (req, reply) => {
    if (!requireOwner(req, reply)) return;
    const session = getSession();
    if (!session) {
      reply.code(401);
      return { error: 'not connected' };
    }
    
    // Auto-reconnect if socket is down
    if (!client.isConnected) {
      try {
        const token = await resolveStoredToken();
        await client.reconnect(token, session.loginid);
      } catch (err) {
        reply.code(409);
        return { error: `socket reconnect failed: ${String(err)}` };
      }
    }
    
    // Optional per-run config: strategy mode, stake amount, and run length in trades.
    const body = (req.body ?? {}) as Record<string, unknown>;
    const sPatch: Record<string, unknown> = {};
    if (typeof body.strategy_mode === 'string') sPatch.strategy_mode = body.strategy_mode;
    if (body.entry_mode === 'model' || body.entry_mode === 'digit_trigger' || body.entry_mode === 'digit_trigger_confirmed') sPatch.entry_mode = body.entry_mode;
    if (typeof body.base_stake === 'number' && Number.isFinite(body.base_stake) && body.base_stake > 0) {
      sPatch.base_stake = body.base_stake;
    }
    if (Object.keys(sPatch).length > 0) updateSettings(sPatch);

    const maxTrades =
      typeof body.max_trades === 'number' && Number.isFinite(body.max_trades) && body.max_trades > 0
        ? Math.floor(body.max_trades)
        : 0;

    // Only an explicit operator start may clear a prior Stop latch. Background
    // paper sweeps use the same Automation instance and must remain blocked.
    automation.acknowledgeUserStart();
    automation.start({ maxTrades });
    return { ok: true, state: automation.state() };
  });

  app.post('/api/automation/arm', async (req, reply) => {
    if (!requireOwner(req, reply)) return;
    const session = getSession();
    if (!session) {
      reply.code(401);
      return { error: 'not connected' };
    }
    storeSetAutomation({ armed_until: Date.now() + 10 * 60 * 1000 });
    return { ok: true, armed_until: storeGetAutomation().armed_until };
  });

  app.post('/api/automation/stop', async (req, reply) => {
    if (!requireOwner(req, reply)) return;
    automation.stop('user stop');
    return { ok: true, state: automation.state() };
  });

  app.post('/api/automation/emergency-stop', async (req, reply) => {
    if (!requireOwner(req, reply)) return;
    automation.stop('emergency stop');
    return { ok: true };
  });

  app.post('/api/trade/clear-stuck', async (req, reply) => {
    if (!requireOwner(req, reply)) return;
    const openTrade = getOpenTrade();
    if (!openTrade) {
      return { ok: true, message: 'no stuck trade found' };
    }
    if (openTrade.status === 'purchasing' && openTrade.reason.includes('purchase outcome unknown; reconciliation required')) {
      reply.code(409);
      return { error: 'purchase outcome is unknown at Deriv and cannot be cleared locally; reconcile the broker account first' };
    }
    if (openTrade.contract_id) {
      reply.code(409);
      return { error: 'this contract exists at Deriv and cannot be cleared locally; settlement recovery is active' };
    }
    resolveTrade(openTrade.id, 'timeout', 0, openTrade.contract_id || '');
    return { ok: true, message: `cleared stuck trade ${openTrade.id}` };
  });
}

function parseTestConfigs(entries: string[]): TestConfig[] {
  const out: TestConfig[] = [];
  for (const e of entries) {
    const [strategyMode, botMode, entryMode] = e.split(/[:-]/);
    if (strategyMode && TEST_STRATEGIES.includes(strategyMode as (typeof TEST_STRATEGIES)[number]) && botMode) {
      out.push({
        strategyMode: strategyMode as (typeof TEST_STRATEGIES)[number],
        botMode: botMode as (typeof TEST_MODES)[number],
        entryMode: entryMode === 'digit_trigger_confirmed' ? 'digit_trigger_confirmed' : entryMode === 'digit_trigger' ? 'digit_trigger' : 'model',
      });
    }
  }
  return out;
}

const activeSettlements = new Set<string>();

function settlementKeyFor(accountId: string | undefined, tradeId: number, contractId: string): string {
  return `${accountId ?? 'current'}:${tradeId}:${contractId}`;
}

function settleInBackground(
  client: DerivPrivateClient,
  hub: Hub,
  tradeId: number,
  contractId: string,
  stake: number,
  payout: number,
  accountId?: string,
): void {
  const settlementKey = settlementKeyFor(accountId, tradeId, contractId);
  if (activeSettlements.has(settlementKey)) return;
  activeSettlements.add(settlementKey);
  let attempts = 0;
  let peakProfit = 0;
  let profitLockSelling = false;
  const retry = (): void => {
    attempts += 1;
    const timer = setTimeout(settle, Math.min(10_000, 1_000 * 2 ** Math.min(attempts - 1, 3)));
    timer.unref();
  };
  const settle = (): void => {
    const current = getTrade(tradeId, accountId);
    if (!current || (current.status !== 'pending' && current.status !== 'purchasing')) {
      activeSettlements.delete(settlementKey);
      return;
    }
    const protectProfit = (current.contract_type === 'MULTUP' || current.contract_type === 'MULTDOWN')
      && (/gold deriv manual/i.test(current.reason ?? '') || current.market === config.goldDerivSymbol);
    void client
    .settleContract(contractId, (u) => {
      const session = getSession();
      const protection = assessGoldProfitProtection({ stake, balance: session?.balance ?? 0, previousPeak: peakProfit, profit: u.profit });
      peakProfit = protection.peak;
      hub.emit({
        type: 'contract',
        ts: Date.now(),
        contractId: u.contractId,
        tradeId,
        phase: u.status,
        profit: u.profit,
        sellPrice: u.sellPrice,
        buyPrice: u.buyPrice,
        settled: u.settled,
        status: u.status,
        isValidToSell: u.isValidToSell,
        update: u,
        manual: true,
        profitProtection: protectProfit ? protection : undefined,
      });
      const sellable = u.isValidToSell === true || (u.isValidToSell == null && u.sellPrice > 0);
      if (!protectProfit || !protection.shouldClose || profitLockSelling || !sellable || u.settled) return;
      profitLockSelling = true;
      hub.emit({ type: 'contract', ts: Date.now(), contractId, tradeId, phase: 'profit lock cash-out', profit: u.profit, sellPrice: u.sellPrice, update: u, profitProtection: { ...protection, triggered: true } });
      void client.sellContract(contractId, 0).catch((error) => {
        profitLockSelling = false;
        hub.emit({ type: 'contract', ts: Date.now(), contractId, tradeId, phase: 'profit lock retrying', error: String(error), profitProtection: protection });
      });
    })
    .then((outcome) => {
      if (outcome.settled) {
        activeSettlements.delete(settlementKey);
        const won = outcome.status === 'won';
        const status = won ? ('won' as const) : ('lost' as const);
        const profit = contractProfit(won, stake, payout, outcome);
        resolveTrade(
          tradeId,
          status,
          profit,
          contractId,
          { entrySpot: outcome.entrySpot, entryDigit: outcome.entryDigit, exitSpot: outcome.exitSpot, exitDigit: outcome.exitDigit },
          accountId,
        );
        if (
          (current.contract_type === 'MULTUP' || current.contract_type === 'MULTDOWN')
          && (/gold deriv manual/i.test(current.reason ?? '') || current.market === config.goldDerivSymbol)
        ) {
          try {
            resolveGoldTradeKnowledge(tradeId, status, profit, outcome.exitSpot ?? outcome.sellPrice ?? null, Date.now());
          } catch (error) {
            console.warn(`[gold trade knowledge] settlement result failed: ${String(error)}`);
          }
        }
        const settledTrade = getTrade(tradeId, accountId);
        if (settledTrade) {
          hub.emit({
            type: 'trade',
            ts: Date.now(),
            trade: settledTrade,
            performance: getPerformanceSummary(accountId),
            manual: true,
            settled: true,
          });
        }
        hub.emit({
          type: 'contract',
          ts: Date.now(),
          contractId,
          tradeId,
          result: status,
          profit,
          sellPrice: outcome.sellPrice,
          buyPrice: outcome.buyPrice,
          settled: outcome.settled,
          status: outcome.status,
          update: outcome,
        });
      } else {
        hub.emit({
          type: 'contract',
          ts: Date.now(),
          contractId,
          tradeId,
          phase: 'awaiting settlement',
          profit: outcome.profit,
          sellPrice: outcome.sellPrice,
          buyPrice: outcome.buyPrice,
          settled: outcome.settled,
          status: outcome.status,
          update: outcome,
        });
        retry();
      }
    })
    .catch((err) => {
      hub.emit({ type: 'contract', ts: Date.now(), contractId, tradeId, phase: 'awaiting settlement', error: String(err) });
      retry();
    });
  };
  settle();
}
