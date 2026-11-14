import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { WebSocket } from 'ws';
import { listDerivAccounts } from '../deriv/privateClient.ts';
import type { DerivPrivateClient } from '../deriv/privateClient.ts';
import { PlayerClients } from '../execution/playerClients.ts';
import { MultiplayerStore } from '../execution/multiplayerStore.ts';
import type { MarketRegistry } from '../core/marketState.ts';
import { buildRecoveryContext, riskCheck } from '../strategy/risk.ts';
import { getSettings } from '../db/store.ts';
import { estimateWinRate, winDigits } from '../core/digitMath.ts';
import { isOwner } from './access.ts';
import { getSession } from '../db/store.ts';
import { resolveStoredToken } from '../deriv/oauth.ts';

type Direction = 'over' | 'under';
type Order = { market: string; direction: Direction; barrier: number; stake: number; minEdge: number };
type Preview = { accountId: string; order: Order; ask: number; payout: number; edge: number; expiresAt: number; mode: 'demo' | 'real' };
type Event = { type: 'balance' | 'trade'; accountId: string; [key: string]: unknown };

export function registerPlayerTrading(app: FastifyInstance, store: MultiplayerStore, registry: MarketRegistry): void {
  const previews = new Map<string, Preview>();
  const listeners = new Map<string, Set<(event: Event) => void>>();
  const publish = (event: Event): void => { for (const send of listeners.get(event.accountId) ?? []) send(event); };
  const clients = new PlayerClients((accountId, balance) => publish({ type: 'balance', accountId, balance }));
  const monitors = new Map<string, NodeJS.Timeout>();
  app.addHook('onClose', async () => { for (const timer of monitors.values()) clearInterval(timer); clients.disconnectAll(); });
  const validOrigin = (req: FastifyRequest): boolean => {
    const origin = req.headers.origin;
    if (!origin) return true;
    try { return new URL(origin).host === req.headers.host; } catch { return false; }
  };

  const secretFor = (req: FastifyRequest): string | null => {
    const signed = req.cookies?.deriv_cows_session;
    if (!signed) return null;
    const value = req.unsignCookie(signed);
    return value.valid ? value.value : null;
  };
  const principal = async (req: FastifyRequest) => {
    if (isOwner(req)) {
      const ownerSession = getSession();
      if (ownerSession) return { accountId: ownerSession.loginid, token: await resolveStoredToken(), source: 'owner' as const };
    }
    const player = await store.resolveSession(secretFor(req));
    return player ? { ...player, source: 'player' as const } : null;
  };
  const account = async (accountId: string, token: string, purpose: 'state' | 'trade' = 'trade') => {
    const info = (await listDerivAccounts(token)).find(item => String(item.account_id) === accountId);
    if (!info) throw new Error('Deriv account unavailable; sign in again');
    const balance = Number(info.balance);
    // Empty accounts must remain selectable and visible, but all quote and buy
    // paths retain the positive-balance requirement before any order request.
    if (info.balance == null || !Number.isFinite(balance) || balance < 0 || (purpose === 'trade' && balance === 0)) throw new Error('Deriv balance unavailable');
    return { balance, currency: info.currency || 'USD', mode: String(info.account_type ?? '').toLowerCase().includes('demo') ? 'demo' as const : 'real' as const };
  };
  const parseOrder = (input: unknown): Order => {
    const body = input && typeof input === 'object' ? input as Record<string, unknown> : {};
    const market = typeof body.market === 'string' ? body.market : '';
    const direction = body.direction === 'over' || body.direction === 'under' ? body.direction : null;
    const barrier = Number(body.barrier), stake = Number(body.stake);
    const minEdge = body.minEdge === undefined ? 0 : Number(body.minEdge);
    if (!direction || !registry.has(market) || !Number.isInteger(barrier) || (direction === 'over' ? barrier < 0 || barrier > 8 : barrier < 1 || barrier > 9)) throw new Error('invalid market or contract');
    if (!Number.isFinite(stake) || stake <= 0 || !Number.isFinite(minEdge) || minEdge < 0 || minEdge > 1) throw new Error('invalid stake or minimum edge');
    return { market, direction, barrier, stake, minEdge };
  };
  const modelEdge = (order: Order, ask: number, payout: number): number => {
    const dist = registry.snapshot(order.market).dist;
    const sample = dist.reduce((sum, count) => sum + count, 0);
    const prior = winDigits(order.direction, order.barrier).length / 10;
    return (estimateWinRate(dist, order.direction, order.barrier) + prior * 20) / (sample + 20) - ask / payout;
  };
  const quote = async (client: DerivPrivateClient, order: Order, currency: string) => client.getQuote({
    direction: order.direction, barrier: order.barrier, amount: order.stake,
    currency, duration: 1, durationUnit: 't', symbol: order.market,
  });
  const reconcile = async (accountId: string, client: DerivPrivateClient) => {
    const active = await store.activeContract(accountId);
    if (!active?.provider_contract_id || (active.status !== 'open' && active.status !== 'unknown')) return active;
    try {
      const result = await client.getContractSnapshot(active.provider_contract_id);
      if (result.settled && (result.status === 'won' || result.status === 'lost')) {
        await store.recordSettlement(accountId, active.provider_contract_id, result.status, result.profit);
        publish({ type: 'trade', accountId, contractId: active.provider_contract_id, status: result.status, profit: result.profit });
        return null;
      }
    } catch { /* Keep the reservation until the broker can be checked. */ }
    return active;
  };
  const monitor = (accountId: string, client: DerivPrivateClient) => {
    if (monitors.has(accountId)) return;
    let running = false;
    const timer = setInterval(() => { void (async () => {
      if (running) return;
      running = true;
      try {
        const active = await reconcile(accountId, client);
        if (!active || (active.status !== 'open' && !(active.status === 'unknown' && active.provider_contract_id))) { clearInterval(timer); monitors.delete(accountId); }
      } finally { running = false; }
    })().catch(() => { running = false; }); }, 1_000);
    timer.unref();
    monitors.set(accountId, timer);
  };
  const fail = (reply: { code: (code: number) => unknown }, status: number, message: string, extra?: Record<string, unknown>) => { reply.code(status); return { error: message, ...extra }; };

  app.get('/api/player/trading/state', async (req, reply) => {
    const user = await principal(req);
    if (!user) return fail(reply, 401, 'player session required');
    try {
      const info = await account(user.accountId, user.token, 'state');
      const risk = await store.riskSnapshot(user.accountId, info.balance);
      const client = await clients.connect(user.accountId, user.token);
      const active = await reconcile(user.accountId, client);
      if (active?.status === 'open' || (active?.status === 'unknown' && active.provider_contract_id)) monitor(user.accountId, client);
      return { session: { loginid: user.accountId, ...info }, risk, active, trades: await store.listTrades(user.accountId) };
    } catch {
      // The player session itself is still valid; only the Deriv/account services
      // are unavailable. Report that distinctly so the browser shows
      // "reconnecting" instead of signing the player out.
      return fail(reply, 503, 'account or trading state unavailable', { code: 'trading_state_unavailable', retryable: true });
    }
  });

  app.post('/api/player/rooms', async (req, reply) => {
    if (!validOrigin(req)) return fail(reply, 403, 'origin rejected');
    const user = await principal(req);
    if (!user) return fail(reply, 401, 'player session required');
    try { return { roomId: await store.createRoom(user.accountId) }; }
    catch { return fail(reply, 503, 'room unavailable'); }
  });

  app.post('/api/player/rooms/join', async (req, reply) => {
    if (!validOrigin(req)) return fail(reply, 403, 'origin rejected');
    const user = await principal(req);
    if (!user) return fail(reply, 401, 'player session required');
    const roomId = (req.body as { roomId?: unknown } | undefined)?.roomId;
    if (typeof roomId !== 'string' || !await store.joinRoom(user.accountId, roomId)) return fail(reply, 404, 'room not found');
    return { roomId: roomId.toLowerCase() };
  });

  app.get('/api/player/rooms/:roomId', async (req, reply) => {
    const user = await principal(req);
    if (!user) return fail(reply, 401, 'player session required');
    const roomId = (req.params as { roomId: string }).roomId;
    if (!await store.isRoomMember(user.accountId, roomId)) return fail(reply, 403, 'room access required');
    return { roomId };
  });

  app.post('/api/player/trade/preview', async (req, reply) => {
    if (!validOrigin(req)) return fail(reply, 403, 'origin rejected');
    const user = await principal(req);
    if (!user) return fail(reply, 401, 'player session required');
    let order: Order;
    try { order = parseOrder(req.body); } catch (error) { return fail(reply, 400, error instanceof Error ? error.message : 'invalid order'); }
    let stage = 'Deriv account';
    try {
      const info = await account(user.accountId, user.token);
      const settings = getSettings();
      // The operator picks the stake on an explicit order; the balance rail in
      // riskCheck below is the sizing limit here, not the bot's MAX_STAKE cap.
      if (!registry.snapshot(order.market).fresh) return fail(reply, 409, 'market feed is stale');
      stage = 'account risk';
      const riskState = await store.riskSnapshot(user.accountId, info.balance);
      const risk = riskCheck({ stake: order.stake, settings, balance: info.balance,
        context: buildRecoveryContext(settings, undefined, riskState), lastTradeAt: 0,
        tradeGapMs: 0, now: Date.now(), accountId: `deriv:${user.accountId}`,
        skipStrategyCaps: true,
        lane: 'digit' });
      if (!risk.ok) return fail(reply, 409, `trade blocked: ${risk.reason}`);
      stage = 'Deriv connection';
      const client = await clients.connect(user.accountId, user.token);
      if (await reconcile(user.accountId, client)) return fail(reply, 409, 'account has an open or uncertain contract');
      if ((await client.getOpenContractIds()).size > 0) return fail(reply, 409, 'Deriv account already has an open contract');
      stage = 'Deriv quote';
      const offered = await quote(client, order, info.currency);
      if (!Number.isFinite(offered.askPrice) || offered.askPrice <= 0 || !Number.isFinite(offered.payout) || offered.payout <= offered.askPrice || offered.askPrice > info.balance) return fail(reply, 409, 'invalid or unaffordable quote');
      const edge = modelEdge(order, offered.askPrice, offered.payout);
      // A zero (or absent) minimum means the operator asked for no edge filter.
      if (order.minEdge > 0 && edge < order.minEdge) return fail(reply, 409, 'quote does not meet minimum edge');
      const previewId = randomUUID();
      const expiresAt = Date.now() + 30_000;
      for (const [id, preview] of previews) if (preview.expiresAt <= Date.now()) previews.delete(id);
      previews.set(previewId, { accountId: user.accountId, order, ask: offered.askPrice, payout: offered.payout, edge, expiresAt, mode: info.mode });
      return { previewId, expiresAt, order, quote: { ask: offered.askPrice, payout: offered.payout }, edge, account: { balance: info.balance, currency: info.currency, mode: info.mode } };
    } catch (error) {
      const code = error && typeof error === 'object' && 'code' in error && typeof error.code === 'string' ? error.code : 'unknown';
      console.error(`[player trading] preview failed at ${stage} (${code})`);
      return fail(reply, 503, `${stage} unavailable; no trade was submitted`);
    }
  });

  app.post('/api/player/trade/confirm', async (req, reply) => {
    if (!validOrigin(req)) return fail(reply, 403, 'origin rejected');
    const user = await principal(req);
    if (!user) return fail(reply, 401, 'player session required');
    const body = (req.body ?? {}) as { previewId?: unknown; idempotencyKey?: unknown; confirmRealFunds?: unknown };
    const preview = typeof body.previewId === 'string' ? previews.get(body.previewId) : undefined;
    if (!preview || preview.expiresAt <= Date.now()) return fail(reply, 409, 'quote review expired');
    if (preview.accountId !== user.accountId) return fail(reply, 403, 'quote belongs to another account');
    if (preview.mode === 'real' && body.confirmRealFunds !== true) return fail(reply, 403, 'real-money confirmation required');
    if (typeof body.idempotencyKey !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/.test(body.idempotencyKey)) return fail(reply, 400, 'valid idempotency key required');
    previews.delete(body.previewId as string);
    const order = preview.order;
    let reservation: string | null = null;
    let buyAttempted = false;
    let boughtContractId: string | null = null;
    try {
      const info = await account(user.accountId, user.token);
      if (info.mode !== preview.mode || !registry.snapshot(order.market).fresh) return fail(reply, 409, 'account or market changed');
      const settings = getSettings();
      const riskState = await store.riskSnapshot(user.accountId, info.balance);
      const risk = riskCheck({ stake: order.stake, settings, balance: info.balance,
        context: buildRecoveryContext(settings, undefined, riskState), lastTradeAt: 0,
        tradeGapMs: 0, now: Date.now(), accountId: `deriv:${user.accountId}`,
        skipStrategyCaps: true,
        lane: 'digit' });
      if (!risk.ok) return fail(reply, 409, `trade blocked: ${risk.reason}`);
      const client = await clients.connect(user.accountId, user.token);
      if (await reconcile(user.accountId, client)) return fail(reply, 409, 'account has an open or uncertain contract');
      if ((await client.getOpenContractIds()).size > 0) return fail(reply, 409, 'Deriv account already has an open contract');
      const offered = await quote(client, order, info.currency);
      if (offered.askPrice > preview.ask * 1.02 || offered.payout < preview.payout * .98 || offered.askPrice > info.balance || !Number.isFinite(offered.askPrice) || offered.askPrice <= 0 || !Number.isFinite(offered.payout) || offered.payout <= offered.askPrice) return fail(reply, 409, 'quote changed; review again');
      if ((order.minEdge > 0 && modelEdge(order, offered.askPrice, offered.payout) < order.minEdge) || !registry.snapshot(order.market).fresh) return fail(reply, 409, 'market no longer meets entry conditions');
      try { reservation = await store.reserve(user.accountId, body.idempotencyKey, { ...order, mode: info.mode }); }
      catch { return fail(reply, 409, 'account has an open or uncertain contract'); }
      if (client.connectedAccountId !== user.accountId) throw new Error('connected account changed');
      if ((await client.getOpenContractIds()).size > 0) throw new Error('Deriv account already has an open contract');
      buyAttempted = true;
      const bought = await client.placeBuy(offered.id, offered.askPrice);
      boughtContractId = bought.contractId;
      await store.markPurchased(user.accountId, reservation, bought.contractId, bought.buyPrice, bought.payout);
      publish({ type: 'trade', accountId: user.accountId, contractId: bought.contractId, status: 'open' });
      monitor(user.accountId, client);
      return { ok: true, reservationId: reservation, contractId: bought.contractId, ask: bought.buyPrice, payout: bought.payout };
    } catch {
      if (reservation) {
        if (buyAttempted) { try { await store.markUnknown(user.accountId, reservation, boughtContractId); } catch { /* retain the active reservation */ } }
        else await store.cancelBeforeBuy(user.accountId, reservation);
      }
      return fail(reply, buyAttempted ? 502 : 409, buyAttempted ? 'purchase outcome uncertain; account remains locked for reconciliation' : 'trade was not submitted');
    }
  });

  app.get('/player-ws', { websocket: true }, (socket: WebSocket, req) => {
    if (!validOrigin(req)) { socket.close(1008, 'origin rejected'); return; }
    void (async () => {
      const user = await principal(req);
      if (!user) { socket.close(1008, 'session required'); return; }
      if (socket.readyState !== socket.OPEN) return;
      const accountId = user.accountId;
      const secret = secretFor(req);
      const stillAuthorized = async () => user.source === 'owner'
        ? isOwner(req) && getSession()?.loginid === accountId
        : (await store.resolveSession(secret))?.accountId === accountId;
      const send = (event: Event) => { void (async () => {
        if (!await stillAuthorized()) { socket.close(1008, 'session expired'); return; }
        if (socket.readyState === socket.OPEN && socket.bufferedAmount < 65536) socket.send(JSON.stringify(event));
      })().catch(() => socket.close(1011, 'session unavailable')); };
      let bucket = listeners.get(accountId);
      if (!bucket) { bucket = new Set(); listeners.set(accountId, bucket); }
      bucket.add(send);
      const heartbeat = setInterval(() => { void stillAuthorized().then(ok => { if (!ok) socket.close(1008, 'session expired'); }).catch(() => socket.close(1011, 'session unavailable')); }, 15_000);
      const cleanup = () => { clearInterval(heartbeat); bucket!.delete(send); if (bucket!.size === 0) listeners.delete(accountId); };
      socket.on('close', cleanup); socket.on('error', cleanup);
      socket.send(JSON.stringify({ type: 'hello', accountId }));
    })().catch(() => socket.close(1011, 'session unavailable'));
  });
}
