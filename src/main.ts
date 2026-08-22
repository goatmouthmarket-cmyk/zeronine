import Fastify from 'fastify';
import * as fs from 'node:fs';
import * as path from 'node:path';
import fastifyStatic from '@fastify/static';
import { config } from './config.ts';
import { resolveStoredToken } from './deriv/oauth.ts';
import { Hub } from './api/hub.ts';
import { registerApi } from './api/routes.ts';
import { registerWs } from './api/ws.ts';
import { MarketRegistry } from './core/marketState.ts';
import { DerivPublicFeed } from './deriv/publicFeed.ts';
import { DerivPrivateClient } from './deriv/privateClient.ts';
import { Automation } from './strategy/automation.ts';
import { DecisionMemory } from './intelligence/decisionMemory.ts';
import {
  digitFingerprint,
  getDb,
  getMeta,
  getSession,
  getSettings,
  insertDigit,
  pruneDigits,
  setMeta,
  updateSessionBalance,
} from './db/store.ts';
import { runBacktest } from './testlab/backtest.ts';
import { runPaperSweep } from './testlab/paper.ts';
import { scanPatterns } from './testlab/patterns.ts';
import { tuneSettings } from './strategy/tuning.ts';

async function main(): Promise<void> {
  getDb();

  const app = Fastify({ logger: false, bodyLimit: 64 * 1024 });

  const hub = new Hub();
  const decisionMemory = new DecisionMemory();
  const registry = new MarketRegistry({
    onTick: (snap) => {
      insertDigit(snap.symbol, snap.lastEpoch, snap.lastQuote, snap.lastDigit);
      decisionMemory.onTick(snap.symbol, snap.lastDigit);
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
        recentQuotes: snap.recentQuotes,
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

  const automation = new Automation(registry, client, hub, decisionMemory);

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

  // Auto-backtest: every few hours (env AUTO_BACKTEST_HOURS), but only when the
  // stored history actually grew enough (AUTO_BACKTEST_MIN_NEW_DIGITS) since the
  // last run, so an idle feed does not burn CPU on a pointless replay. Runs
  // regardless of the live bot — results persist as source='auto' runs. A
  // pattern scan runs first so pattern-weighted signals replay on fresh stats.
  const autoBacktestMs = config.autoBacktestHours * 3_600_000;
  let autoBacktestBusy = false;
  let lastAutoFingerprint = Number(getMeta('backtest_last_fingerprint') ?? 0);
  const runAutoBacktest = async (): Promise<void> => {
    if (autoBacktestBusy) return;
    autoBacktestBusy = true;
    try {
      const fp = digitFingerprint();
      if (fp - lastAutoFingerprint < config.autoBacktestMinNewDigits) return;
      // Refresh confirmed next-digit transitions first so per-strategy pattern
      // weights always replay against up-to-date pattern_stats.
      const scan = await scanPatterns((done, total, message) =>
        hub.emit({ type: 'testlab', ts: Date.now(), kind: 'patterns', source: 'auto', phase: 'scanning', done, total, message }),
      );
      if (scan.confirmed > 0) console.info(`[auto-backtest] pattern scan: ${scan.confirmed} confirmed transitions`);
      await runBacktest({
        baseStake: getSettings().base_stake,
        source: 'auto',
        onProgress: (p) => hub.emit({ type: 'testlab', ts: Date.now(), kind: 'backtest', source: 'auto', ...p }),
      });
      lastAutoFingerprint = fp;
      setMeta('backtest_last_fingerprint', String(fp));
      setMeta('backtest_last_run_at', String(Date.now()));
      console.info(`[auto-backtest] finished (history fingerprint ${fp})`);
      runAutoTune();
    } catch (err) {
      console.warn(`[auto-backtest] failed: ${err}`);
    } finally {
      autoBacktestBusy = false;
    }
  };
  const autoBacktestTimer = setInterval(() => void runAutoBacktest(), autoBacktestMs);
  autoBacktestTimer.unref();
  const bootAutoBacktest = setTimeout(() => void runAutoBacktest(), 10_000);
  bootAutoBacktest.unref();

  // Auto paper sweep: much more frequent than the backtest (env
  // AUTO_PAPER_INTERVAL_MS, default 30m) so the demo tape is constantly
  // re-evaluated. Always skips — never throws — when there is nothing safe to
  // trade on: no demo session, the live bot is running, or the feed is down.
  let autoPaperBusy = false;
  const runAutoPaper = async (): Promise<void> => {
    if (autoPaperBusy) return;
    const session = getSession();
    if (!session || session.mode !== 'demo') return;
    if (automation.isRunning()) return;
    if (automation.isOperatorStopped()) return;
    if (!feed.status().connected) return;
    autoPaperBusy = true;
    try {
      const lastRunAt = Number(getMeta('paper_last_run_at') ?? 0);
      if (Date.now() - lastRunAt < config.autoPaperIntervalMs) return;
      await runPaperSweep(automation, hub, {
        tradesPerConfig: 40,
        source: 'auto',
        onProgress: (p) => hub.emit({ type: 'testlab', ts: Date.now(), source: 'auto', ...p }),
      });
      setMeta('paper_last_run_at', String(Date.now()));
      console.info('[auto-paper] sweep finished');
      runAutoTune();
    } catch (err) {
      console.warn(`[auto-paper] failed: ${err}`);
    } finally {
      autoPaperBusy = false;
    }
  };
  const autoPaperTimer = setInterval(() => void runAutoPaper(), 60_000);
  autoPaperTimer.unref();
  const bootAutoPaper = setTimeout(() => void runAutoPaper(), 30_000);
  bootAutoPaper.unref();

  // Self-tuning: recompute the champion (backtest + paper must agree) after
  // either automated source produces fresh runs. When the live bot is running
  // the verdict is computed and stored for the dashboard — settings are only
  // applied while the bot is idle so a run is never yanked mid-trade.
  const runAutoTune = (): void => {
    try {
      const verdict = tuneSettings({ apply: !automation.isRunning() });
      if (!verdict) return;
      hub.emit({ type: 'tuning', ts: Date.now(), ...verdict });
      console.info(
        `[auto-tune] ${verdict.reason}${verdict.applied ? ` (applied min edge ${verdict.minEdge}, stake $${verdict.baseStake})` : ''}`,
      );
    } catch (err) {
      console.warn(`[auto-tune] failed: ${err}`);
    }
  };

  const shutdown = async (signal: string): Promise<void> => {
    console.info(`[server] ${signal} — shutting down`);
    clearInterval(pruneTimer);
    clearInterval(reconnectTimer);
    clearInterval(autoBacktestTimer);
    clearTimeout(bootAutoBacktest);
    clearInterval(autoPaperTimer);
    clearTimeout(bootAutoPaper);
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
