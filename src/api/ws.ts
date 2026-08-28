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
    socket.send(
      JSON.stringify({
        type: 'hello',
        ts: Date.now(),
        markets: registry.allSnapshots(),
      }),
    );
    if (lastSignal) socket.send(JSON.stringify(lastSignal));
    if (owner && lastHold) socket.send(JSON.stringify(lastHold));
    if (lastIntelligence) socket.send(JSON.stringify(lastIntelligence));
    if (lastPaperSimulation) socket.send(JSON.stringify(lastPaperSimulation));

    const lastTickSent = new Map<string, number>();
    const pendingTicks = new Map<string, Record<string, unknown>>();
    let tickTimer: NodeJS.Timeout | null = null;
    const heartbeatTimer = setInterval(() => {
      if (socket.readyState === socket.OPEN && socket.bufferedAmount < MAX_BUFFER) {
        socket.send(JSON.stringify({ type: 'heartbeat', ts: Date.now() }));
      }
    }, HEARTBEAT_INTERVAL_MS);

    const flushTicks = (): void => {
      tickTimer = null;
      if (socket.readyState !== socket.OPEN) return;
      const now = Date.now();
      for (const [symbol, tick] of pendingTicks) {
        if (socket.bufferedAmount >= MAX_BUFFER) break;
        socket.send(JSON.stringify(tick));
        pendingTicks.delete(symbol);
        lastTickSent.set(symbol, now);
      }
      if (pendingTicks.size > 0) tickTimer = setTimeout(flushTicks, TICK_INTERVAL_MS);
    };

    const unsubscribe = hub.on((evt) => {
      if (socket.readyState !== socket.OPEN) return;
      if (!owner && !PUBLIC_EVENTS.has(evt.type)) return;

      if (evt.type === 'tick') {
        const symbol = typeof evt.symbol === 'string' ? evt.symbol : '';
        const now = Date.now();
        const lastSent = lastTickSent.get(symbol) ?? 0;
        if (now - lastSent >= TICK_INTERVAL_MS && socket.bufferedAmount < MAX_BUFFER) {
          socket.send(JSON.stringify(evt));
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
      socket.send(JSON.stringify(evt));
    });

    socket.on('close', () => {
      unsubscribe();
      if (tickTimer) clearTimeout(tickTimer);
      clearInterval(heartbeatTimer);
      pendingTicks.clear();
    });
    socket.on('error', () => {
      unsubscribe();
      if (tickTimer) clearTimeout(tickTimer);
      clearInterval(heartbeatTimer);
      pendingTicks.clear();
    });
  });
}
