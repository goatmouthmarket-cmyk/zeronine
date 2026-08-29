import type { FastifyInstance } from 'fastify';
import { config } from '../config.ts';
import { GoldRuntime, GoldRuntimeUnavailableError } from '../gold/runtime.ts';
import { grantOwner, isOwner, publicDashboardEnabled, requireOwner } from './access.ts';
import type { DerivPublicFeed } from '../deriv/publicFeed.ts';
import type { DerivPrivateClient } from '../deriv/privateClient.ts';
import { listDerivAccounts } from '../deriv/privateClient.ts';
import type { Hub } from './hub.ts';
import type { MarketRegistry } from '../core/marketState.ts';
import type { Automation } from '../strategy/automation.ts';
import type { PaperSimulator } from '../simulation/paperSimulator.ts';
import type { MomentumObserver } from '../momentum/observer.ts';
import { encryptToken } from '../db/crypto.ts';
import {
  buildAuthorizeUrl,
  exchangeOauthCode,
  newPkce,
  resolveStoredToken,
  serializeOAuth,
} from '../deriv/oauth.ts';
import type { TokenSet } from '../deriv/oauth.ts';
import type { Direction } from '../core/digitMath.ts';
import { contractProfit } from '../strategy/pnl.ts';
import { buildRecoveryContext, riskCheck } from '../strategy/risk.ts';
import { runBacktest, TEST_MODES, TEST_STRATEGIES } from '../testlab/backtest.ts';
import type { TestConfig } from '../testlab/backtest.ts';
import { buildCalibrationReport, listPatterns as listStoredPatterns, scanPatterns } from '../testlab/patterns.ts';
import { buildDecisionEvidenceReport } from '../testlab/evidence.ts';
import {
  clearSession,
  getAutomation as storeGetAutomation,
  getCalibration,
  getMeta,
  getOpenTrade,
  getTrade,
  getPerformanceSummary,
  getPaperTrade,
  getRecovery,
  getSession,
  getSettings,
  insertTrade,
  listMarkets,
  listDecisionEvents,
  listLedgerEntries,
  listPaperLedgerEntries,
  listPaperTrades,
  listTestRuns,
  listTrades,
  markTradePurchased,
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
}

export function registerApi(app: FastifyInstance, deps: ApiDeps): void {
  const { registry, feed, client, hub, automation, paperSimulator, momentum } = deps;
  const gold = deps.gold ?? new GoldRuntime();
  const oauthPending = new Map<string, { verifier: string; created: number }>();

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
      gold: gold.state(),
    };
  });

  /**
   * Gold is a separate, virtual-first workspace. State contains no OAuth
   * material and this request never opens a cTrader connection.
   */
  app.get('/api/gold/state', async () => ({ state: gold.state() }));

  // These routes are deliberately virtual-only. The runtime's readiness gate
  // rejects every command until a reviewed adapter has supplied fresh, valid
  // broker market data. There is no cTrader order route in this service.
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
      if (!result.accepted) reply.code(409);
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
      if (!result.closed) reply.code(409);
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

    const body = (req.body ?? {}) as { direction?: unknown; stake?: unknown };
    const direction = body.direction === 'up' || body.direction === 'down' ? body.direction : null;
    const stake = Number(body.stake);
    if (!direction || !Number.isFinite(stake) || stake <= 0) {
      reply.code(400);
      return { error: 'an up/down direction and a positive stake are required' };
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
    if (getOpenTrade()) {
      reply.code(409);
      return { error: 'wait for the open contract to settle before placing a Momentum trade' };
    }
    const gate = riskCheck({
      stake,
      settings,
      balance: session.balance,
      context: buildRecoveryContext(settings),
      lastTradeAt: listTrades(1)[0]?.ts ?? 0,
      tradeGapMs: config.tradeGapMs,
      now: Date.now(),
    });
    if (!gate.ok) {
      reply.code(409);
      return { error: `Momentum trade blocked: ${gate.reason}` };
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
    const reason = [
      `momentum manual ${direction.toUpperCase()}`,
      `five-minute multiplier x${current.config.multiplier}`,
      `research ${signal.direction.toUpperCase()} ${signal.confidence}%`,
      signal.reason,
    ].join(' | ');
    let recordedTrade: ReturnType<typeof insertTrade> | null = null;
    try {
      // The proposal is intentionally obtained immediately before the buy.
      // No scanner quote is reused for an account order.
      const quote = await client.getMultiplierQuote({
        direction,
        amount: stake,
        currency: session.currency || 'USD',
        duration: 5,
        durationUnit: 'm',
        symbol: current.config.symbol,
        multiplier: current.config.multiplier,
      });
      if (!(quote.askPrice > 0) || !Number.isFinite(quote.askPrice)) {
        throw new Error('multiplier proposal returned an invalid purchase price');
      }
      const afterQuote = momentum.state();
      if (
        !afterQuote.running || afterQuote.phase !== 'observing' || !afterQuote.config || !afterQuote.window
        || afterQuote.config.symbol !== current.config.symbol
      ) {
        reply.code(409);
        return { error: 'Momentum research changed while the quote was loading; review it before trading' };
      }
      // This synchronous insert reserves the shared account contract slot
      // before the buy. Concurrent click handlers cannot create a second order.
      if (getOpenTrade()) {
        reply.code(409);
        return { error: 'another account contract opened while the Momentum quote was loading' };
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
      const bought = await client.placeBuy(quote.id, quote.askPrice);
      const actualStake = bought.buyPrice > 0 ? bought.buyPrice : quote.askPrice;
      const actualPayout = bought.payout > 0 ? bought.payout : quote.payout;
      const entrySnapshot = registry.snapshot(current.config.symbol);
      const entrySpot = Number.isFinite(quote.spot) && quote.spot > 0 ? quote.spot : entrySnapshot.lastQuote;
      markTradePurchased(trade.id, bought.contractId, actualStake, actualPayout, trade.account_id, entrySpot, entrySnapshot.lastDigit);
      const purchased = getTrade(trade.id, trade.account_id) ?? trade;
      hub.emit({ type: 'trade', ts: Date.now(), trade: purchased, manual: true, momentum: true });
      settleInBackground(client, hub, trade.id, bought.contractId, actualStake, actualPayout, trade.account_id);
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
          multiplier: current.config.multiplier,
        },
      };
    } catch (error) {
      if (recordedTrade) {
        resolveTrade(recordedTrade.id, 'error', 0, recordedTrade.contract_id || '', undefined, recordedTrade.account_id);
      }
      console.warn(`[momentum manual] order failed: ${String(error)}`);
      reply.code(502);
      return { error: String(error) };
    }
  });

  app.get('/api/settings', async () => getSettings());

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
      else if (numeric.includes(k) && (typeof v === 'number') && Number.isFinite(v)) patch[k] = v;
      else if (k === 'pattern_weight_conservative' || k === 'pattern_weight_martingale' || k === 'pattern_weight_boosted_martingale' || k === 'pattern_weight_chase') {
        if (v === null) patch[k] = null;
        else if (typeof v === 'number' && Number.isFinite(v)) patch[k] = v;
      }
    }
    return updateSettings(patch);
  });

  app.get('/api/history', async (req) => {
    if (!isOwner(req)) return { trades: [], performance: { wins: 0, losses: 0, pushes: 0, profit: 0, reset_at: 0 } };
    const q = req.query as { limit?: string };
    const limit = Math.min(200, Math.max(1, Number(q.limit) || 50));
    return { trades: listTrades(limit), performance: getPerformanceSummary() };
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
    if (getOpenTrade()) {
      reply.code(409);
      return { error: 'wait for the open contract to settle before switching accounts' };
    }
    automation.stop('account switch');
    storeSetAutomation({ armed_until: 0 });
    const token = await resolveStoredToken();
    const tokenSession = getSession() ?? session;
    try {
      const info = await client.reconnect(token, accountId);
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

  app.post('/api/auth/logout', async (req, reply) => {
    if (!requireOwner(req, reply)) return;
    automation.stop('logged out');
    client.disconnect();
    clearSession();
    return { ok: true };
  });

  app.post('/api/trade/manual', async (req, reply) => {
    if (!requireOwner(req, reply)) return;
    const session = getSession();
    if (!session) {
      reply.code(401);
      return { error: 'not connected' };
    }
    const body = req.body as { market?: string; direction?: Direction; barrier?: number; stake?: number; estWin?: number };
    const market = body.market;
    const direction = body.direction;
    const barrier = Number(body.barrier);
    const stake = Number(body.stake);
    const theoreticalWin = direction === 'over' ? (9 - barrier) / 10 : barrier / 10;
    const requestedEstWin = Number(body.estWin);
    const estWin = Number.isFinite(requestedEstWin) && requestedEstWin > 0 && requestedEstWin < 1
      ? requestedEstWin
      : theoreticalWin;
    if (!market || (direction !== 'over' && direction !== 'under') || !Number.isFinite(barrier) || !Number.isFinite(stake)) {
      reply.code(400);
      return { error: 'market/direction/barrier/stake required' };
    }
    const validBarrier = Number.isInteger(barrier)
      && (direction === 'over' ? barrier >= 0 && barrier <= 8 : barrier >= 1 && barrier <= 9);
    if (!validBarrier) {
      reply.code(400);
      return { error: direction === 'over' ? 'over barrier must be an integer from 0 to 8' : 'under barrier must be an integer from 1 to 9' };
    }
    if (!(stake > 0)) {
      reply.code(400);
      return { error: 'stake must be greater than zero' };
    }
    if (!registry.has(market)) {
      reply.code(400);
      return { error: `unknown market ${market}` };
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
    
    // Never clear a provider contract merely because local time elapsed. A
    // delayed settlement must retain the single-open-contract lock.
    const openTrade = getOpenTrade();
    if (openTrade) {
      const staleness = Date.now() - openTrade.ts;
      reply.code(409);
      return { error: `a contract is still open (${(staleness / 1000).toFixed(1)}s old); settlement recovery is active` };
    }
    
    let recordedTrade: ReturnType<typeof insertTrade> | null = null;
    try {
      const quote = await client.getQuote({
        direction,
        barrier,
        amount: stake,
        currency: session.currency || 'USD',
        duration: 1,
        durationUnit: 't',
        symbol: market,
      });
      // Keep this row out of reconciliation until Deriv confirms a contract
      // id. The always-on watch loop must not turn a valid in-flight manual
      // buy into an error between proposal and purchase.
      const trade = recordedTrade = insertTrade({
        ts: Date.now(),
        market,
        contract_type: direction === 'over' ? 'DIGITOVER' : 'DIGITUNDER',
        barrier: quote.barrier,
        duration: 1,
        duration_unit: 't',
        stake,
        ask_price: quote.askPrice,
        payout: quote.payout,
        est_win: estWin,
        profit: 0,
        status: 'purchasing',
        contract_id: '',
        purchase_id: `manual-${Date.now()}`,
        reason: 'manual',
        origin: 'manual',
      });
      const bought = await client.placeBuy(quote.id, quote.askPrice);
      const actualStake = bought.buyPrice > 0 ? bought.buyPrice : quote.askPrice > 0 ? quote.askPrice : stake;
      const actualPayout = bought.payout > 0 ? bought.payout : quote.payout;
      const entrySnapshot = registry.snapshot(market);
      markTradePurchased(trade.id, bought.contractId, actualStake, actualPayout, trade.account_id, entrySnapshot.lastQuote, entrySnapshot.lastDigit);
      hub.emit({ type: 'trade', ts: Date.now(), trade: getTrade(trade.id, trade.account_id) ?? trade, manual: true });
      settleInBackground(client, hub, trade.id, bought.contractId, actualStake, actualPayout, trade.account_id);
      return { ok: true, trade: { id: trade.id, contractId: bought.contractId, ask: quote.askPrice, payout: quote.payout } };
    } catch (err) {
      if (recordedTrade) {
        resolveTrade(recordedTrade.id, 'error', 0, recordedTrade.contract_id || '', undefined, recordedTrade.account_id);
      }
      console.warn(`[manual] order failed: ${String(err)}`);
      reply.code(502);
      return { error: String(err) };
    }
  });

  app.post('/api/trade/manual-basket', async (req, reply) => {
    if (!requireOwner(req, reply)) return;
    const session = getSession();
    if (!session) {
      reply.code(401);
      return { error: 'not connected' };
    }
    if (automation.isRunning()) {
      reply.code(409);
      return { error: 'stop the bot before placing a manual basket' };
    }
    const orders = (req.body as { orders?: Array<{ market?: string; direction?: Direction; barrier?: number; stake?: number; estWin?: number }> } | undefined)?.orders;
    if (!Array.isArray(orders) || orders.length !== 5) {
      reply.code(400);
      return { error: 'a manual basket requires exactly five orders' };
    }
    if (new Set(orders.map((order) => order.market)).size !== 5) {
      reply.code(400);
      return { error: 'basket markets must be distinct' };
    }
    const normalized = orders.map((order) => {
      const market = String(order.market ?? '');
      const direction = order.direction;
      const barrier = Number(order.barrier);
      const stake = Number(order.stake);
      const theoreticalWin = direction === 'over' ? (9 - barrier) / 10 : barrier / 10;
      const requestedEstWin = Number(order.estWin);
      const estWin = Number.isFinite(requestedEstWin) && requestedEstWin > 0 && requestedEstWin < 1 ? requestedEstWin : theoreticalWin;
      return { market, direction, barrier, stake, estWin };
    });
    const invalid = normalized.find((order) => {
      const validBarrier = Number.isInteger(order.barrier)
        && (order.direction === 'over' ? order.barrier >= 0 && order.barrier <= 8 : order.direction === 'under' && order.barrier >= 1 && order.barrier <= 9);
      return !order.market || !registry.has(order.market) || !validBarrier || !(order.stake > 0);
    });
    if (invalid) {
      reply.code(400);
      return { error: `invalid basket order for ${invalid.market || 'unknown market'}` };
    }
    if (getOpenTrade()) {
      reply.code(409);
      return { error: 'wait for the open contract to settle before placing a basket' };
    }
    if (!client.isConnected) {
      try {
        const token = await resolveStoredToken();
        await client.reconnect(token, session.loginid);
      } catch (err) {
        reply.code(409);
        return { error: `socket reconnect failed: ${String(err)}` };
      }
    }

    const batchId = crypto.randomUUID();
    try {
      // Obtain every proposal before purchasing so no leg starts while another
      // is still waiting for its quote. Provider buys are then launched in one
      // concurrent turn (network arrival can still differ by milliseconds).
      const quotes = await Promise.all(normalized.map((order) => client.getQuote({
        direction: order.direction as Direction,
        barrier: order.barrier,
        amount: order.stake,
        currency: session.currency || 'USD',
        duration: 1,
        durationUnit: 't',
        symbol: order.market,
      })));
      const trades = normalized.map((order, index) => insertTrade({
        ts: Date.now(),
        market: order.market,
        contract_type: order.direction === 'over' ? 'DIGITOVER' : 'DIGITUNDER',
        barrier: quotes[index].barrier,
        duration: 1,
        duration_unit: 't',
        stake: order.stake,
        ask_price: quotes[index].askPrice,
        payout: quotes[index].payout,
        est_win: order.estWin,
        profit: 0,
        status: 'purchasing',
        contract_id: '',
        purchase_id: `manual-basket-${batchId}-${index + 1}`,
        reason: `manual basket ${batchId}`,
        origin: 'manual',
      }));
      const outcomes = await Promise.allSettled(quotes.map((quote) => client.placeBuy(quote.id, quote.askPrice)));
      let purchased = 0;
      const results = outcomes.map((outcome, index) => {
        const trade = trades[index];
        const quote = quotes[index];
        if (outcome.status === 'rejected') {
          resolveTrade(trade.id, 'error', 0, '', undefined, trade.account_id);
          return { market: trade.market, ok: false, error: String(outcome.reason) };
        }
        purchased += 1;
        const bought = outcome.value;
        const actualStake = bought.buyPrice > 0 ? bought.buyPrice : quote.askPrice > 0 ? quote.askPrice : normalized[index].stake;
        const actualPayout = bought.payout > 0 ? bought.payout : quote.payout;
        const entrySnapshot = registry.snapshot(trade.market);
        markTradePurchased(trade.id, bought.contractId, actualStake, actualPayout, trade.account_id, entrySnapshot.lastQuote, entrySnapshot.lastDigit);
        const purchasedTrade = getTrade(trade.id, trade.account_id) ?? trade;
        hub.emit({ type: 'trade', ts: Date.now(), trade: purchasedTrade, manual: true, batchId });
        settleInBackground(client, hub, trade.id, bought.contractId, actualStake, actualPayout, trade.account_id);
        return { market: trade.market, ok: true, tradeId: trade.id, contractId: bought.contractId };
      });
      if (purchased === 0) {
        reply.code(502);
        return { error: 'all five basket purchases failed', batchId, results };
      }
      return { ok: true, batchId, purchased, failed: 5 - purchased, results };
    } catch (err) {
      console.warn(`[manual-basket] quote phase failed: ${String(err)}`);
      reply.code(502);
      return { error: `basket quote failed before purchase: ${String(err)}` };
    }
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
    const [strategyMode, botMode] = e.split(/[:-]/);
    if (strategyMode && TEST_STRATEGIES.includes(strategyMode as (typeof TEST_STRATEGIES)[number]) && botMode) {
      out.push({ strategyMode: strategyMode as (typeof TEST_STRATEGIES)[number], botMode: botMode as (typeof TEST_MODES)[number] });
    }
  }
  return out;
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
  let attempts = 0;
  const retry = (): void => {
    attempts += 1;
    const timer = setTimeout(settle, Math.min(10_000, 1_000 * 2 ** Math.min(attempts - 1, 3)));
    timer.unref();
  };
  const settle = (): void => {
    const current = getTrade(tradeId, accountId);
    if (!current || (current.status !== 'pending' && current.status !== 'purchasing')) return;
    void client
    .settleContract(contractId, (u) => hub.emit({ type: 'contract', ts: Date.now(), contractId: u.contractId, update: u, manual: true }))
    .then((outcome) => {
      if (outcome.settled) {
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
        hub.emit({ type: 'contract', ts: Date.now(), contractId, tradeId, result: status, profit, update: outcome });
      } else {
        hub.emit({ type: 'contract', ts: Date.now(), contractId, phase: 'awaiting settlement' });
        retry();
      }
    })
    .catch((err) => {
      hub.emit({ type: 'contract', ts: Date.now(), contractId, phase: 'awaiting settlement', error: String(err) });
      retry();
    });
  };
  settle();
}
