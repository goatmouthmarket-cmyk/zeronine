import Fastify from 'fastify';
import * as fs from 'node:fs';
import * as path from 'node:path';
import fastifyStatic from '@fastify/static';
import fastifyCookie from '@fastify/cookie';
import { config } from './config.ts';
import { resolveStoredToken } from './deriv/oauth.ts';
import { Hub } from './api/hub.ts';
import { registerApi } from './api/routes.ts';
import { MomentumObserver } from './momentum/observer.ts';
import { registerWs } from './api/ws.ts';
import { MarketRegistry } from './core/marketState.ts';
import { DerivPublicFeed } from './deriv/publicFeed.ts';
import { DerivPrivateClient } from './deriv/privateClient.ts';
import { Automation } from './strategy/automation.ts';
import { DecisionMemory } from './intelligence/decisionMemory.ts';
import {
  digitFingerprint,
  appendPaperLedgerEntrySafely,
  appendPaperTradeContextSafely,
  getDb,
  getMeta,
  getSession,
  getSettings,
  enqueueDigit,
  flushDigitQueue,
  listPaperLedgerEntries,
  pruneDigits,
  setMeta,
  updateSessionBalance,
} from './db/store.ts';
import { runBacktest } from './testlab/backtest.ts';
import { runPaperSweep } from './testlab/paper.ts';
import { scanPatterns } from './testlab/patterns.ts';
import { PaperSimulator } from './simulation/paperSimulator.ts';
import { GoldRuntime } from './gold/runtime.ts';
import type { PaperSignal, PaperSimulationEvent } from './simulation/paperSimulator.ts';
import type { Direction } from './core/digitMath.ts';
import { observeResearchOutcome } from './intelligence/researchCalibration.ts';

function paperSignalFromHubEvent(
  event: Record<string, unknown>,
  stake: number,
  strategyMode: string,
  botMode: string,
): PaperSignal | null {
  const raw = event.signal as { holds?: unknown; candidates?: unknown; reason?: unknown } | undefined;
  if (raw?.holds || !Array.isArray(raw?.candidates)) return null;
  const candidate = raw.candidates[0] as Record<string, unknown> | undefined;
  if (!candidate) return null;
  const direction = candidate.direction;
  const market = candidate.market;
  const barrier = candidate.barrier;
  if (
    typeof market !== 'string'
    || (direction !== 'over' && direction !== 'under')
    || !Number.isInteger(barrier)
  ) return null;
  return {
    market,
    direction: direction as Direction,
    barrier: barrier as number,
    stake,
    estWin: typeof candidate.estWin === 'number' ? candidate.estWin : undefined,
    edge: typeof candidate.edge === 'number' ? candidate.edge : undefined,
    id: `${Number.isFinite(event.ts) ? event.ts : Date.now()}:${market}:${direction}:${barrier}`,
    issuedAt: Number.isFinite(event.ts) ? Number(event.ts) : Date.now(),
    reason: typeof raw?.reason === 'string' ? raw.reason : 'shared configured scanner candidate',
    strategyMode,
    botMode,
    evidence: {
      est_win: typeof candidate.estWin === 'number' ? candidate.estWin : null,
      edge: typeof candidate.edge === 'number' ? candidate.edge : null,
      expected_roi: typeof candidate.expectedROI === 'number' ? candidate.expectedROI : null,
      consistency: typeof candidate.consistency === 'number' ? candidate.consistency : null,
      entropy: typeof candidate.entropy === 'number' ? candidate.entropy : null,
      momentum: typeof candidate.momentum === 'number' ? candidate.momentum : null,
      short_long_deviation: typeof candidate.shortLongDeviation === 'number' ? candidate.shortLongDeviation : null,
      transition_probability: typeof candidate.transitionProb === 'number' ? candidate.transitionProb : null,
      learned_win: typeof candidate.learnedWin === 'number' ? candidate.learnedWin : null,
    },
  };
}

async function main(): Promise<void> {
  getDb();
  for (const entry of listPaperLedgerEntries(500).reverse()) {
    if (entry.event !== 'settled' || entry.est_win == null || (entry.status !== 'won' && entry.status !== 'lost')) continue;
    observeResearchOutcome({
      market: entry.market,
      direction: entry.contract_type === 'DIGITOVER' ? 'over' : 'under',
      barrier: entry.barrier,
      predicted: entry.est_win,
      won: entry.status === 'won',
    });
  }

  const app = Fastify({ logger: false, bodyLimit: 64 * 1024 });
  app.addHook('onSend', async (req, reply, payload) => {
    if (req.url.startsWith('/api/') || req.url.startsWith('/health')) {
      reply.header('Cache-Control', 'private, no-store, max-age=0');
      reply.header('Pragma', 'no-cache');
      reply.header('Vary', 'Cookie');
    }
    return payload;
  });
  await app.register(fastifyCookie, { secret: config.sessionSecret });

  const hub = new Hub();
  const decisionMemory = new DecisionMemory();
  const paperSimulator = new PaperSimulator({ defaultStake: getSettings().base_stake });
  let latestPaperSignal: PaperSignal | null = null;
  hub.on((event) => {
    if (event.type !== 'signal') return;
    // Virtual research consumes the same configured digit scanner candidate as
    // the bot. It does not choose, blend, or invent a separate strategy.
    const settings = getSettings();
    latestPaperSignal = paperSignalFromHubEvent(event, settings.base_stake, settings.strategy_mode, settings.bot_mode);
  });
  paperSimulator.on((event: PaperSimulationEvent) => {
    if (event.type === 'opened') {
      appendPaperTradeContextSafely(event.contract, {
        strategyMode: event.contract.strategyMode,
        botMode: event.contract.botMode,
        candidateReason: event.contract.candidateReason,
        signalId: event.contract.signalId,
        signalAt: event.contract.scannerIssuedAt,
        evidence: event.contract.evidence,
      });
      appendPaperLedgerEntrySafely(event.contract, 'purchased');
    } else if (event.type === 'settled') {
      appendPaperLedgerEntrySafely(event.contract, 'settled');
      if (event.contract.estWin != null) {
        observeResearchOutcome({
          market: event.contract.market,
          direction: event.contract.direction,
          barrier: event.contract.barrier,
          predicted: event.contract.estWin,
          won: event.contract.status === 'won',
        });
      }
    } else if (event.type === 'cancelled') {
      appendPaperLedgerEntrySafely(event.contract, 'cancelled', event.reason);
    }
    // Raw ticks already travel over the throttled market-tick channel. Only
    // state transitions need a separate public simulation event.
    if (event.type === 'tick') return;
    hub.emit({
      type: 'paper_simulation',
      ts: Date.now(),
      event: event.type,
      state: event.state,
      ...(('contract' in event && event.contract) ? { contract: event.contract } : {}),
      ...(('reason' in event && event.reason) ? { reason: event.reason } : {}),
    });
  });
  const registry = new MarketRegistry({
    onTick: (snap) => {
      enqueueDigit(snap.symbol, snap.lastEpoch, snap.lastQuote, snap.lastDigit);
      decisionMemory.onTick(snap.symbol, snap.lastDigit);
      // A scanner pick gets one matching-market entry opportunity only. This
      // avoids opening repeated contracts from a stale "latest" candidate.
      const paperSignal = latestPaperSignal?.market === snap.symbol
        && latestPaperSignal.issuedAt !== undefined
        && Date.now() - latestPaperSignal.issuedAt <= 5_000
        ? latestPaperSignal
        : null;
      if (paperSignal || (latestPaperSignal?.issuedAt !== undefined && Date.now() - latestPaperSignal.issuedAt > 5_000)) {
        latestPaperSignal = null;
      }
      paperSimulator.onTick({
        market: snap.symbol,
        quote: snap.lastQuote,
        digit: snap.lastDigit,
        epoch: snap.lastEpoch,
      }, paperSignal);
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
  const momentum = new MomentumObserver(hub);
  const gold = new GoldRuntime();
  const startMomentumResearch = (): void => {
    void momentum.startAutomatic().catch((error) => {
      console.warn(`[momentum] automatic research start failed; retrying in 30 seconds: ${String(error)}`);
      const retry = setTimeout(startMomentumResearch, 30_000);
      retry.unref();
    });
  };
  startMomentumResearch();

  registerApi(app, { registry, feed, client, hub, automation, paperSimulator, momentum, gold });
  await registerWs(app, hub, registry);

  const webDist = path.resolve(import.meta.dirname, '..', 'web', 'dist');
  if (fs.existsSync(webDist)) {
    app.register(fastifyStatic, {
      root: webDist,
      index: ['index.html'],
      setHeaders(res, filePath) {
        if (filePath.includes(`${path.sep}assets${path.sep}`)) {
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        } else if (filePath.endsWith('.html')) {
          res.setHeader('Cache-Control', 'no-cache, max-age=0, must-revalidate');
        } else {
          res.setHeader('Cache-Control', 'public, max-age=3600');
        }
      },
    });
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
      const info = await client.connect(token, session.loginid);
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

  // Account-funded sweeps are off unless both explicit opt-in settings exist.
  // A pure paper simulator has no Deriv account purchase path.
  /* Legacy account-funded paper sweep removed. */
  if (false) {
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
        console.info('[auto-paper] demo execution sweep finished');
        runAutoTune();
      } catch (err) {
        console.warn(`[auto-paper] failed: ${err}`);
      } finally {
        autoPaperBusy = false;
      }
    };
  } else {
    console.info('[auto-paper] account-funded demo sweeps disabled');
  }

  // Self-tuning: recompute the champion (backtest + paper must agree) after
  // either automated source produces fresh runs. When the live bot is running
  // the verdict is computed and stored for the dashboard — settings are only
  // applied while the bot is idle so a run is never yanked mid-trade.
  const runAutoTune = (): void => {
    // Intentionally inert: research P&L cannot rewrite live settings.
  };

  const shutdown = async (signal: string): Promise<void> => {
    console.info(`[server] ${signal} — shutting down`);
    clearInterval(pruneTimer);
    clearInterval(reconnectTimer);
    clearInterval(autoBacktestTimer);
    clearTimeout(bootAutoBacktest);
    automation.dispose();
    client.disconnect();
    feed.stop();
    flushDigitQueue();
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
