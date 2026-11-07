import type { FastifyInstance } from 'fastify';
import websocket from '@fastify/websocket';
import type { WebSocket } from 'ws';
import type { Hub } from './hub.ts';
import type { MarketRegistry } from '../core/marketState.ts';
import { isOwner } from './access.ts';
import { getSession } from '../db/store.ts';
import { PastureRooms } from './pastureRoom.ts';
import type { MultiplayerStore } from '../execution/multiplayerStore.ts';

const TICK_INTERVAL_MS = 150;
const MAX_BUFFER = 64 * 1024;
const HEARTBEAT_INTERVAL_MS = 15_000;
const PUBLIC_EVENTS = new Set(['tick', 'feed', 'signal', 'intelligence', 'paper_simulation', 'market_scout']);

export async function registerWs(app: FastifyInstance, hub: Hub, registry: MarketRegistry, multiplayerStore?: MultiplayerStore): Promise<void> {
  await app.register(websocket, { options: { maxPayload: 8192 } });

  let lastSignal: unknown = null;
  let lastHold: unknown = null;
  let lastIntelligence: unknown = null;
  let lastPaperSimulation: unknown = null;
  let lastMarketScout: unknown = null;
  hub.on((evt) => {
    if (evt.type === 'signal') lastSignal = evt;
    if (evt.type === 'hold') lastHold = evt;
    if (evt.type === 'intelligence') lastIntelligence = evt;
    if (evt.type === 'paper_simulation') lastPaperSimulation = evt;
    if (evt.type === 'market_scout') lastMarketScout = evt;
  });

  app.get('/ws', { websocket: true }, (socket: WebSocket, req) => {
    const owner = isOwner(req);
    const lastTickSent = new Map<string, number>();
    const pendingTicks = new Map<string, Record<string, unknown>>();
    let tickTimer: NodeJS.Timeout | null = null;
    let closed = false;
    let unsubscribe = (): void => {};
    let heartbeatTimer: NodeJS.Timeout | null = null;
    const cleanup = (): void => {
      if (closed) return;
      closed = true;
      unsubscribe();
      if (tickTimer) clearTimeout(tickTimer);
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      tickTimer = null;
      heartbeatTimer = null;
      pendingTicks.clear();
    };
    const safeSend = (evt: unknown, mustDeliver = false): boolean => {
      if (closed || socket.readyState !== socket.OPEN) return false;
      if (socket.bufferedAmount >= (mustDeliver ? MAX_BUFFER * 4 : MAX_BUFFER)) {
        cleanup();
        try { socket.close(1013, 'slow client'); } catch { /* already closing */ }
        return false;
      }
      try {
        socket.send(JSON.stringify(evt));
        return true;
      } catch {
        cleanup();
        try { socket.terminate(); } catch { /* already closed */ }
        return false;
      }
    };

    safeSend({
      type: 'hello',
      ts: Date.now(),
      markets: registry.allSnapshots(),
    }, true);
    if (lastSignal) safeSend(lastSignal, true);
    if (owner && lastHold) safeSend(lastHold, true);
    if (lastIntelligence) safeSend(lastIntelligence, true);
    if (lastPaperSimulation) safeSend(lastPaperSimulation, true);
    if (lastMarketScout) safeSend(lastMarketScout, true);

    heartbeatTimer = setInterval(() => {
      safeSend({ type: 'heartbeat', ts: Date.now() });
    }, HEARTBEAT_INTERVAL_MS);

    const flushTicks = (): void => {
      tickTimer = null;
      if (closed || socket.readyState !== socket.OPEN) return;
      const now = Date.now();
      for (const [symbol, tick] of pendingTicks) {
        if (socket.bufferedAmount >= MAX_BUFFER) break;
        if (!safeSend(tick)) break;
        pendingTicks.delete(symbol);
        lastTickSent.set(symbol, now);
      }
      if (pendingTicks.size > 0) tickTimer = setTimeout(flushTicks, TICK_INTERVAL_MS);
    };

    unsubscribe = hub.on((evt) => {
      if (closed || socket.readyState !== socket.OPEN) return;
      if (!owner && !PUBLIC_EVENTS.has(evt.type)) return;

      if (evt.type === 'tick') {
        const symbol = typeof evt.symbol === 'string' ? evt.symbol : '';
        if (!symbol) return;
        const now = Date.now();
        const lastSent = lastTickSent.get(symbol) ?? 0;
        if (now - lastSent >= TICK_INTERVAL_MS && socket.bufferedAmount < MAX_BUFFER) {
          if (!safeSend(evt)) return;
          lastTickSent.set(symbol, now);
        } else {
          pendingTicks.set(symbol, evt);
          if (!tickTimer) tickTimer = setTimeout(flushTicks, TICK_INTERVAL_MS);
        }
        return;
      }

      // Account lifecycle events must never be dropped: losing a settlement
      // leaves an otherwise completed trade displayed as Open until reload.
      // Tick traffic is already bounded above and can wait behind this send.
      safeSend(evt, true);
    });

    socket.on('close', cleanup);
    socket.on('error', cleanup);
  });
  const pastures = new PastureRooms();
  app.get('/pasture-ws', { websocket: true }, (socket: WebSocket, req) => {
    void (async () => {
    const origin = req.headers.origin;
    try { if (origin && new URL(origin).host !== req.headers.host) { socket.close(1008, 'origin rejected'); return; } }
    catch { socket.close(1008, 'origin rejected'); return; }
    let closed = false;
    const send = (event: Record<string, unknown>): void => {
      if (closed || socket.readyState !== socket.OPEN) return;
      if (socket.bufferedAmount > MAX_BUFFER) { socket.close(1013, 'slow client'); return; }
      try { socket.send(JSON.stringify(event)); } catch { socket.terminate(); }
    };
    const query = req.query as { room?: unknown };
    const roomId = query.room === undefined ? 'public' : typeof query.room === 'string' ? query.room.toLowerCase() : query.room;
    if (typeof roomId !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(roomId)) { socket.close(1008, 'invalid room'); return; }
    let secret: string | null = null;
    let accountId: string | null = null;
    let ownerSession = false;
    if (roomId !== 'public') {
      if (roomId === 'main' && isOwner(req)) {
        accountId = getSession()?.loginid ?? null;
        ownerSession = Boolean(accountId);
      }
      if (!accountId && multiplayerStore) {
        const signed = req.cookies?.deriv_cows_session;
        const value = signed ? req.unsignCookie(signed) : null;
        secret = value?.valid ? value.value : null;
        const session = await multiplayerStore.resolveSession(secret);
        accountId = session?.accountId ?? null;
      }
      if (!accountId || (roomId !== 'main' && (!multiplayerStore || !await multiplayerStore.isRoomMember(accountId, roomId)))) { socket.close(1008, 'pasture access required'); return; }
    }
    if (socket.readyState !== socket.OPEN) return;
    const joined = pastures.join(roomId, send);
    if (!joined) { socket.close(1013, 'pasture full'); return; }
    let id = joined.id;
    let pasture = joined.room;
    let alive = true;
    const heartbeat = setInterval(() => { void (async () => {
      if (!alive) { socket.terminate(); return; }
      if (ownerSession) {
        if (!isOwner(req) || getSession()?.loginid !== accountId) { socket.close(1008, 'session expired'); return; }
      } else if (accountId && multiplayerStore) {
        const session = await multiplayerStore.resolveSession(secret);
        if (session?.accountId !== accountId || (roomId !== 'main' && !await multiplayerStore.isRoomMember(accountId, roomId))) { socket.close(1008, 'pasture access expired'); return; }
      }
      alive = false; socket.ping();
    })().catch(() => socket.close(1011, 'room unavailable')); }, HEARTBEAT_INTERVAL_MS);
    socket.on('pong', () => { alive = true; });
    let joinedPlayerId: string | null = null;
    socket.on('message', data => {
      try { const msg = JSON.parse(data.toString());
        if (msg.type === 'set-pasture-self-id' && typeof msg.id === 'string' && !joinedPlayerId) {
          joinedPlayerId = msg.id;
          // Re-key the presence to the client's stable id so a reconnect never
          // leaves a duplicate ranger standing on the pasture.
          if (msg.id !== id) {
            pastures.leave(roomId, pasture, id);
            const result = pastures.join(roomId, send, msg.id);
            if (result) { id = result.id; pasture = result.room; }
          }
        } else {
          pasture.receive(id, msg);
        }
      } catch { /* Ignore invalid input. */ }
    });
    const cleanup = () => { if (closed) return; closed = true; clearInterval(heartbeat); pastures.leave(roomId, pasture, id); };
    socket.on('close', cleanup); socket.on('error', cleanup);
    })().catch(() => socket.close(1011, 'room unavailable'));
  });

}
