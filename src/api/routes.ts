import type { FastifyInstance } from 'fastify';
import { config, shouldScheduleAutoDemoPaperSweep } from '../config.ts';
import { grantOwner, isOwner, publicDashboardEnabled, requireOwner } from './access.ts';
import type { DerivPublicFeed } from '../deriv/publicFeed.ts';
import type { DerivPrivateClient } from '../deriv/privateClient.ts';
import type { Hub } from './hub.ts';
import type { MarketRegistry } from '../core/marketState.ts';
import type { Automation } from '../strategy/automation.ts';
import type { PaperSimulator } from '../simulation/paperSimulator.ts';
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
  getPerformanceSummary,
  getRecovery,
  getSession,
  getSettings,
  insertTrade,
  listMarkets,
  listDecisionEvents,
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
}

export function registerApi(app: FastifyInstance, deps: ApiDeps): void {
  const { registry, feed, client, hub, automation, paperSimulator } = deps;
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
    };
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
    const intervalMs = config.autoPaperIntervalMs;
    const lastRunAt = Number(getMeta('paper_last_run_at') ?? 0);
    const enabled = shouldScheduleAutoDemoPaperSweep(config);
    return {
      enabled,
      intervalMs,
      lastRunAt,
      nextRunAt: enabled ? (lastRunAt > 0 ? lastRunAt + intervalMs : Date.now() + intervalMs) : null,
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
      const info = await client.connect(token);
      return { ok: true, session: info };
    } catch (err) {
      reply.code(401);
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
    
    // Auto-reconnect if socket is down
    if (!client.isConnected) {
      try {
        const token = await resolveStoredToken();
        await client.reconnect(token);
      } catch (err) {
        reply.code(409);
        return { error: `socket reconnect failed: ${String(err)}` };
      }
    }
    
    const body = req.body as { market?: string; direction?: Direction; barrier?: number; stake?: number };
    const market = body.market;
    const direction = body.direction;
    const barrier = Number(body.barrier);
    const stake = Number(body.stake);
    if (!market || (direction !== 'over' && direction !== 'under') || !Number.isFinite(barrier) || !Number.isFinite(stake)) {
      reply.code(400);
      return { error: 'market/direction/barrier/stake required' };
    }
    if (!registry.has(market)) {
      reply.code(400);
      return { error: `unknown market ${market}` };
    }
    // Check for stale pending trades and clear them
    const openTrade = getOpenTrade();
    if (openTrade) {
      const staleness = Date.now() - openTrade.ts;
      // Clear trades pending for more than 30 seconds (should have settled by then)
      if (staleness > 30_000) {
        resolveTrade(openTrade.id, 'timeout', 0, openTrade.contract_id || '');
      } else {
        reply.code(409);
        return { error: `a contract is still open (${(staleness / 1000).toFixed(1)}s old)` };
      }
    }
    
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
      const trade = insertTrade({
        ts: Date.now(),
        market,
        contract_type: direction === 'over' ? 'DIGITOVER' : 'DIGITUNDER',
        barrier: quote.barrier,
        duration: 1,
        duration_unit: 't',
        stake,
        ask_price: quote.askPrice,
        payout: quote.payout,
        est_win: 0,
        profit: 0,
        status: 'pending',
        contract_id: '',
        purchase_id: `manual-${Date.now()}`,
        reason: 'manual',
        origin: 'manual',
      });
      const bought = await client.placeBuy(quote.id, quote.askPrice);
      const actualStake = bought.buyPrice > 0 ? bought.buyPrice : quote.askPrice > 0 ? quote.askPrice : stake;
      const actualPayout = bought.payout > 0 ? bought.payout : quote.payout;
      markTradePurchased(trade.id, bought.contractId, actualStake, actualPayout, trade.account_id);
      hub.emit({ type: 'trade', ts: Date.now(), trade, manual: true });
      settleInBackground(client, hub, trade.id, bought.contractId, actualStake, actualPayout, trade.account_id);
      return { ok: true, trade: { id: trade.id, contractId: bought.contractId, ask: quote.askPrice, payout: quote.payout } };
    } catch (err) {
      reply.code(502);
      return { error: String(err) };
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
        await client.reconnect(token);
      } catch (err) {
        reply.code(409);
        return { error: `socket reconnect failed: ${String(err)}` };
      }
    }
    
    if (session.mode === 'real' && storeGetAutomation().armed_until < Date.now()) {
      reply.code(403);
      return { error: 'real-account automation requires arming first' };
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
          { entrySpot: outcome.entrySpot, exitSpot: outcome.exitSpot, exitDigit: outcome.exitDigit },
          accountId,
        );
        hub.emit({ type: 'contract', ts: Date.now(), contractId, result: status, profit, update: outcome });
      } else {
        hub.emit({ type: 'contract', ts: Date.now(), contractId, phase: 'awaiting settlement' });
      }
    })
    .catch((err) => {
      hub.emit({ type: 'contract', ts: Date.now(), contractId, phase: 'awaiting settlement', error: String(err) });
    });
}
