import type { FastifyInstance } from 'fastify';
import websocket from '@fastify/websocket';
import type { WebSocket } from 'ws';
import type { Hub } from './hub.ts';
import type { MarketRegistry } from '../core/marketState.ts';
import { isOwner } from './access.ts';

const TICK_INTERVAL_MS = 150;
const MAX_BUFFER = 64 * 1024;
const HEARTBEAT_INTERVAL_MS = 15_000;
const PUBLIC_EVENTS = new Set(['tick', 'feed', 'signal', 'hold', 'intelligence', 'testlab', 'tuning', 'paper_simulation', 'momentum']);

export async function registerWs(app: FastifyInstance, hub: Hub, registry: MarketRegistry): Promise<void> {
  await app.register(websocket, { options: { maxPayload: 8192 } });

  let lastSignal: unknown = null;
  let lastHold: unknown = null;
  let lastIntelligence: unknown = null;
  let lastPaperSimulation: unknown = null;
  hub.on((evt) => {
    if (evt.type === 'signal') lastSignal = evt;
    if (evt.type === 'hold') lastHold = evt;
    if (evt.type === 'intelligence') lastIntelligence = evt;
    if (evt.type === 'paper_simulation') lastPaperSimulation = evt;
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
}
