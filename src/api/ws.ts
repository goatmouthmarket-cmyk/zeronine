import type { FastifyInstance } from 'fastify';
import websocket from '@fastify/websocket';
import type { WebSocket } from 'ws';
import type { Hub } from './hub.ts';
import type { MarketRegistry } from '../core/marketState.ts';
import { isOwner } from './access.ts';

const TICK_INTERVAL_MS = 150;
const MAX_BUFFER = 64 * 1024;
const PUBLIC_EVENTS = new Set(['tick', 'feed', 'signal', 'hold', 'intelligence', 'testlab', 'tuning', 'paper_simulation']);

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

    let lastTickSent = 0;
    let pendingTick: unknown = null;
    let tickTimer: NodeJS.Timeout | null = null;

    const flushTicks = (): void => {
      tickTimer = null;
      if (pendingTick && socket.readyState === socket.OPEN) {
        socket.send(JSON.stringify(pendingTick));
        pendingTick = null;
        lastTickSent = Date.now();
      }
    };

    const unsubscribe = hub.on((evt) => {
      if (socket.readyState !== socket.OPEN) return;
      if (!owner && !PUBLIC_EVENTS.has(evt.type)) return;

      if (evt.type === 'tick') {
        const now = Date.now();
        if (now - lastTickSent >= TICK_INTERVAL_MS && socket.bufferedAmount < MAX_BUFFER) {
          socket.send(JSON.stringify(evt));
          lastTickSent = now;
        } else {
          pendingTick = evt;
          if (!tickTimer) tickTimer = setTimeout(flushTicks, TICK_INTERVAL_MS);
        }
        return;
      }

      if (
        ['trade', 'contract', 'decision', 'hold', 'error'].includes(evt.type) &&
        socket.bufferedAmount > MAX_BUFFER
      ) {
        return; // drop non-critical events for slow clients
      }
      socket.send(JSON.stringify(evt));
    });

    socket.on('close', () => {
      unsubscribe();
      if (tickTimer) clearTimeout(tickTimer);
    });
    socket.on('error', () => {
      unsubscribe();
      if (tickTimer) clearTimeout(tickTimer);
    });
  });
}
