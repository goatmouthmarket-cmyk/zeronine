import type { FastifyInstance } from 'fastify';
import { config } from '../config.ts';
import type { DerivPublicFeed } from '../deriv/publicFeed.ts';
import type { DerivPrivateClient } from '../deriv/privateClient.ts';
import type { Hub } from './hub.ts';
import type { MarketRegistry } from '../core/marketState.ts';
import type { Automation } from '../strategy/automation.ts';
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
import {
  clearSession,
  getAutomation as storeGetAutomation,
  getCalibration,
  getOpenTrade,
  getRecovery,
  getSession,
  getSettings,
  insertTrade,
  listMarkets,
  listTrades,
  resolveTrade,
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
}

export function registerApi(app: FastifyInstance, deps: ApiDeps): void {
  const { registry, feed, client, hub, automation } = deps;
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

  app.get('/api/state', async () => {
    const session = getSession();
    return {
      feed: feed.status(),
      markets: registry.allSnapshots(),
      session: session
        ? {
            loginid: session.loginid,
            balance: session.balance,
            currency: session.currency,
            mode: session.mode,
            auth_kind: session.auth_kind,
          }
        : null,
      recovery: getRecovery(),
      settings: getSettings(),
      automation: automation.state(),
      trades: listTrades(20),
    };
  });

  app.get('/api/settings', async () => getSettings());

  app.put('/api/settings', async (req, reply) => {
    const body = req.body as Record<string, unknown>;
    if (!body || typeof body !== 'object') {
      reply.code(400);
      return { error: 'invalid settings' };
    }
    const numeric = [
      'base_stake',
      'max_stake',
      'daily_loss_limit',
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
    ];
    const patch: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(body)) {
      if (k === 'barrier_preference' && typeof v === 'string') patch[k] = v;
      else if (k === 'strategy_mode' && typeof v === 'string') patch[k] = v;
      else if (numeric.includes(k) && typeof v === 'number' && Number.isFinite(v)) patch[k] = v;
    }
    return updateSettings(patch);
  });

  app.get('/api/history', async (req) => {
    const q = req.query as { limit?: string };
    const limit = Math.min(200, Math.max(1, Number(q.limit) || 50));
    return { trades: listTrades(limit) };
  });

  app.get('/api/calibration', async () => getCalibration());

  app.post('/api/auth/pat', async (req, reply) => {
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

  app.get('/api/auth/oauth/start', async () => {
    const { verifier, challenge } = newPkce();
    const state = crypto.randomUUID();
    oauthPending.set(state, { verifier, created: Date.now() });
    return { ok: true, url: buildAuthorizeUrl(state, challenge) };
  });

  app.get('/api/auth/oauth/callback', async (req, reply) => {
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

  app.post('/api/auth/reconnect', async (_req, reply) => {
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

  app.post('/api/auth/logout', async () => {
    automation.stop('logged out');
    client.disconnect();
    clearSession();
    return { ok: true };
  });

  app.post('/api/trade/manual', async (req, reply) => {
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
    const settings = getSettings();
    if (stake > settings.max_stake) {
      reply.code(400);
      return { error: 'stake exceeds max stake' };
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
      });
      const bought = await client.placeBuy(quote.id, quote.askPrice);
      resolveTrade(trade.id, 'pending', 0, bought.contractId);
      hub.emit({ type: 'trade', ts: Date.now(), trade, manual: true });
      settleInBackground(client, hub, trade.id, bought.contractId);
      return { ok: true, trade: { id: trade.id, contractId: bought.contractId, ask: quote.askPrice, payout: quote.payout } };
    } catch (err) {
      reply.code(502);
      return { error: String(err) };
    }
  });

  app.post('/api/automation/start', async (req, reply) => {
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

    automation.start({ maxTrades });
    return { ok: true, state: automation.state() };
  });

  app.post('/api/automation/arm', async (_req, reply) => {
    const session = getSession();
    if (!session) {
      reply.code(401);
      return { error: 'not connected' };
    }
    storeSetAutomation({ armed_until: Date.now() + 10 * 60 * 1000 });
    return { ok: true, armed_until: storeGetAutomation().armed_until };
  });

  app.post('/api/automation/stop', async () => {
    automation.stop('user stop');
    return { ok: true, state: automation.state() };
  });

  app.post('/api/automation/emergency-stop', async () => {
    automation.stop('emergency stop');
    return { ok: true };
  });

  app.post('/api/trade/clear-stuck', async () => {
    const openTrade = getOpenTrade();
    if (!openTrade) {
      return { ok: true, message: 'no stuck trade found' };
    }
    resolveTrade(openTrade.id, 'timeout', 0, openTrade.contract_id || '');
    return { ok: true, message: `cleared stuck trade ${openTrade.id}` };
  });
}

function settleInBackground(client: DerivPrivateClient, hub: Hub, tradeId: number, contractId: string): void {
  void client
    .settleContract(contractId, (u) => hub.emit({ type: 'contract', ts: Date.now(), contractId: u.contractId, update: u, manual: true }))
    .then((outcome) => {
      if (outcome.settled) {
        const won = outcome.status === 'won';
        const status = won ? ('won' as const) : ('lost' as const);
        const profit = Number.isFinite(outcome.profit) ? outcome.profit : 0;
        resolveTrade(
          tradeId,
          status,
          profit,
          contractId,
          { entrySpot: outcome.entrySpot, exitSpot: outcome.exitSpot, exitDigit: outcome.exitDigit },
        );
        hub.emit({ type: 'contract', ts: Date.now(), contractId, result: status, profit, update: outcome });
      } else {
        resolveTrade(tradeId, 'expired', 0, contractId);
        hub.emit({ type: 'contract', ts: Date.now(), contractId, result: 'expired' });
      }
    })
    .catch((err) => {
      resolveTrade(tradeId, 'error', 0, contractId);
      hub.emit({ type: 'contract', ts: Date.now(), contractId, result: 'error', error: String(err) });
    });
}