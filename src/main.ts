import Fastify from 'fastify';
import * as fs from 'node:fs';
import * as path from 'node:path';
import fastifyStatic from '@fastify/static';
import { config } from './config.ts';
import { getDb, getSession, insertDigit, pruneDigits, updateSessionBalance } from './db/store.ts';
import { resolveStoredToken } from './deriv/oauth.ts';
import { Hub } from './api/hub.ts';
import { registerApi } from './api/routes.ts';
import { registerWs } from './api/ws.ts';
import { MarketRegistry } from './core/marketState.ts';
import { DerivPublicFeed } from './deriv/publicFeed.ts';
import { DerivPrivateClient } from './deriv/privateClient.ts';
import { Automation } from './strategy/automation.ts';

async function main(): Promise<void> {
  getDb();

  const app = Fastify({ logger: false, bodyLimit: 64 * 1024 });

  const hub = new Hub();
  const registry = new MarketRegistry({
    onTick: (snap) => {
      insertDigit(snap.symbol, snap.lastEpoch, snap.lastQuote, snap.lastDigit);
      hub.emit({
        type: 'tick',
        ts: Date.now(),
        symbol: snap.symbol,
        display: snap.display,
        quote: snap.lastQuote,
        epoch: snap.lastEpoch,
        digit: snap.lastDigit,
        fresh: snap.fresh,
        recentDigits: snap.recentDigits,
      });
    },
  });

  const feed = new DerivPublicFeed(registry, (status) => {
    hub.emit({ type: 'feed', ts: Date.now(), status });
  });

  const client = new DerivPrivateClient();
  client.onSession = (session) => hub.emit({ type: 'session', ts: Date.now(), session });
  client.onBalance = (balance) => hub.emit({ type: 'balance', ts: Date.now(), balance });
  client.onDisconnect = () => hub.emit({ type: 'session', ts: Date.now(), session: null, reason: 'disconnected' });

  const automation = new Automation(registry, client, hub);

  registerApi(app, { registry, feed, client, hub, automation });
  await registerWs(app, hub, registry);

  const webDist = path.resolve(import.meta.dirname, '..', 'web', 'dist');
  if (fs.existsSync(webDist)) {
    app.register(fastifyStatic, { root: webDist, index: ['index.html'] });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/') || req.url.startsWith('/health')) {
        reply.code(404).send({ error: 'not found' });
        return;
      }
      reply.sendFile('index.html');
    });
  } else if (config.nodeEnv !== 'development') {
    console.warn('[server] web/dist missing — run `npm run build:web` (dashboard will not be served)');
  }

  await app.listen({ port: config.port, host: '0.0.0.0' });
  console.info(`[server] listening on :${config.port} (${config.nodeEnv})`);

  await feed.connect();

  automation.watch();

  const reconnectPrivate = async (): Promise<void> => {
    const session = getSession();
    if (!session || client.isConnected) return;
    try {
      const token = await resolveStoredToken();
      const info = await client.connect(token);
      updateSessionBalance(info.balance);
      console.info(`[private] reconnected ${info.loginid} (${info.mode})`);
    } catch (err) {
      console.warn(`[private] reconnect failed: ${err}`);
    }
  };

  await reconnectPrivate();
  const reconnectTimer = setInterval(() => void reconnectPrivate(), 15_000);
  reconnectTimer.unref();

  const pruneTimer = setInterval(() => pruneDigits(200_000), 60 * 60 * 1000);
  pruneTimer.unref();

  const shutdown = async (signal: string): Promise<void> => {
    console.info(`[server] ${signal} — shutting down`);
    clearInterval(pruneTimer);
    clearInterval(reconnectTimer);
    automation.dispose();
    client.disconnect();
    feed.stop();
    await app.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

void main().catch((err) => {
  console.error('[server] fatal', err);
  process.exit(1);
});