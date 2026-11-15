import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { WebSocket } from 'ws';
import type { DerivPrivateClient } from '../deriv/privateClient.ts';
import { PlayerClients } from '../execution/playerClients.ts';
import { MultiplayerStore } from '../execution/multiplayerStore.ts';
import type { MarketRegistry } from '../core/marketState.ts';
import { buildRecoveryContext, riskCheck } from '../strategy/risk.ts';
import { getSettings } from '../db/store.ts';
import { estimateWinRate, winDigits, getPrecision } from '../core/digitMath.ts';
import { pickSignal, type SignalCandidate } from '../strategy/signal.ts';
import { isOwner } from './access.ts';
import { getSession } from '../db/store.ts';
import { resolveStoredToken } from '../deriv/oauth.ts';

type Direction = 'over' | 'under';
type CowDisplay = { edge: number | null; confidence: number | null; shownAt: number; brainPick: boolean };
type Order = { market: string; direction: Direction; barrier: number; stake: number; minEdge: number; cowDisplay?: CowDisplay | null };
type Preview = { accountId: string; order: Order; ask: number; payout: number; edge: number; expiresAt: number; mode: 'demo' | 'real' };
type Event = { type: 'balance' | 'trade'; accountId: string; [key: string]: unknown };

export function registerPlayerTrading(app: FastifyInstance, store: MultiplayerStore, registry: MarketRegistry): void {
  const previews = new Map<string, Preview>();
  const listeners = new Map<string, Set<(event: Event) => void>>();
  const publish = (event: Event): void => { for (const send of listeners.get(event.accountId) ?? []) send(event); };
  const clients = new PlayerClients((accountId, balance) => publish({ type: 'balance', accountId, balance }));
  const monitors = new Map<string, NodeJS.Timeout>();
  const rangerArms = new Map<string, number>();
  const rangerRuns = new Map<string, RangerRun>();
  app.addHook('onClose', async () => {
    for (const timer of monitors.values()) clearInterval(timer);
    for (const run of rangerRuns.values()) if (run.timer) clearInterval(run.timer);
    rangerRuns.clear();
    rangerArms.clear();
    clients.disconnectAll();
  });
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
    // Reuse the authenticated private socket session. Its balance subscription
    // keeps this snapshot current, avoiding a second REST /accounts request for
    // every preview and purchase.
    const { session } = await clients.connectWithSession(accountId, token);
    const balance = Number(session.balance);
    if (!Number.isFinite(balance) || balance < 0 || (purpose === 'trade' && balance === 0)) throw new Error('Deriv balance unavailable');
    return { balance, currency: session.currency || 'USD', mode: session.mode };
  };
  const parseOrder = (input: unknown): Order => {
    const body = input && typeof input === 'object' ? input as Record<string, unknown> : {};
    const market = typeof body.market === 'string' ? body.market : '';
    const direction = body.direction === 'over' || body.direction === 'under' ? body.direction : null;
    const barrier = Number(body.barrier), stake = Number(body.stake);
    const minEdge = body.minEdge === undefined ? 0 : Number(body.minEdge);
    if (!direction || !registry.has(market) || !Number.isInteger(barrier) || (direction === 'over' ? barrier < 0 || barrier > 8 : barrier < 1 || barrier > 9)) throw new Error('invalid market or contract');
    if (!Number.isFinite(stake) || stake <= 0 || !Number.isFinite(minEdge) || minEdge < 0 || minEdge > 1) throw new Error('invalid stake or minimum edge');
    // Client metadata is optional and never influences pricing or risk checks.
    const raw = body.cowDisplay && typeof body.cowDisplay === 'object' ? body.cowDisplay as Record<string, unknown> : null;
    const bounded = (value: unknown, min: number, max: number): number | null => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max ? value : null;
    const shownAt = bounded(raw?.shownAt, Date.now() - 120_000, Date.now() + 5_000);
    const cowDisplay = raw && shownAt !== null ? { edge: bounded(raw.edge, -1, 1), confidence: bounded(raw.confidence, 0, 1), shownAt, brainPick: raw.brainPick === true } : null;
    return { market, direction, barrier, stake, minEdge, cowDisplay };
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
  // Collect evidence after purchase without delaying or affecting execution.
  // Match both Deriv's entry epoch and entry quote; ambiguous matches stay unavailable.
  const captureTradeContext = (accountId: string, contractId: string, order: Order, edge: number, client: DerivPrivateClient): void => {
    void (async () => {
      // Persist an incomplete snapshot immediately in the background. If the
      // process stops while waiting for Deriv or later ticks, the card can
      // still show the captured quote estimate and the cow's displayed values.
      const pending: Record<string, unknown> = {
        entryQuote: null, entryDigit: null, entryEpoch: null, before: [], after: [],
        edge: Number.isFinite(edge) ? edge : null, confidence: null,
        cowEdge: order.cowDisplay?.edge ?? null, cowConfidence: order.cowDisplay?.confidence ?? null,
        cowShownAt: order.cowDisplay?.shownAt ?? null, brainPick: order.cowDisplay?.brainPick === true, complete: false,
      };
      const initialWrite = store.saveTradeContext(accountId, contractId, pending)
        .catch(error => { console.warn('[brain] initial trade context unavailable:', error instanceof Error ? error.message : String(error)); });
      let provider: Awaited<ReturnType<DerivPrivateClient['getContractSnapshot']>> | null = null;
      let context: Record<string, unknown> | null = null;
      for (let attempt = 0; attempt < 20; attempt++) {
        if (attempt) await new Promise(resolve => setTimeout(resolve, 1000));
        try { provider = provider ?? await client.getContractSnapshot(contractId); } catch { continue; }
        // Market precision can arrive after purchase when the public feed reconnects.
        // Read it on every attempt instead of freezing an unavailable value.
        const precision = getPrecision(order.market);
        if (!Number.isInteger(precision) || precision! < 0 || precision! > 12 ||
            !Number.isFinite(provider.entrySpot) || !Number.isFinite(provider.entryTickTime)) {
          if (!Number.isFinite(provider.entrySpot) || !Number.isFinite(provider.entryTickTime)) provider = null;
          continue;
        }
        const entryEpoch = Number(provider.entryTickTime), entrySpot = Number(provider.entrySpot);
        const ticks = registry.snapshot(order.market).recentTicks;
        const matches = ticks.flatMap((tick, index) => tick.epoch === entryEpoch && tick.quote.toFixed(precision!) === entrySpot.toFixed(precision!) ? [index] : []);
        const format = (tick: { quote: number; digit: number; epoch: number }) => ({ quote: tick.quote.toFixed(precision!), digit: tick.digit, epoch: tick.epoch });
        const index = matches.length === 1 ? matches[0] : -1;
        const before = index >= 0 ? ticks.slice(Math.max(0, index - 3), index).map(format) : [];
        const after = index >= 0 ? ticks.slice(index + 1, index + 4).map(format) : [];
        context = { entryQuote: entrySpot.toFixed(precision!), entryDigit: Number.isInteger(provider.entryDigit) ? provider.entryDigit : null,
          entryEpoch, before, after, edge: Number.isFinite(edge) ? edge : null, confidence: null,
          cowEdge: order.cowDisplay?.edge ?? null, cowConfidence: order.cowDisplay?.confidence ?? null, cowShownAt: order.cowDisplay?.shownAt ?? null, brainPick: order.cowDisplay?.brainPick === true,
          complete: index >= 3 && after.length === 3 };
        if (context.complete) break;
      }
      if (!context) context = { entryQuote: null, entryDigit: null, entryEpoch: null, before: [], after: [], edge: Number.isFinite(edge) ? edge : null, confidence: null, cowEdge: order.cowDisplay?.edge ?? null, cowConfidence: order.cowDisplay?.confidence ?? null, cowShownAt: order.cowDisplay?.shownAt ?? null, brainPick: order.cowDisplay?.brainPick === true, complete: false };
      // Serialize writes so a slow initial save cannot overwrite the completed
      // sequence. The runner is detached from trade submission throughout.
      await initialWrite;
      await store.saveTradeContext(accountId, contractId, context);
    })().catch(error => { console.warn('[brain] trade context unavailable:', error instanceof Error ? error.message : String(error)); });
  };
  // This runs after settlement and never blocks a purchase or the settlement
  // response. Only an unambiguous Deriv exit quote/time match can anchor ticks.
  const captureExitContext = (
    accountId: string, contractId: string, market: string,
    settled: Awaited<ReturnType<DerivPrivateClient['getContractSnapshot']>>,
    client: DerivPrivateClient,
  ): void => {
    void (async () => {
      let provider = settled;
      let initialWrite: Promise<void> | null = null;
      let exit: Record<string, unknown> = { quote: null, digit: null, epoch: null, before: [], after: [], complete: false };
      for (let attempt = 0; attempt < 30; attempt++) {
        if (attempt) await new Promise(resolve => setTimeout(resolve, 1000));
        if (!Number.isFinite(provider.exitSpot) || !Number.isFinite(provider.exitTickTime)) {
          try { provider = await client.getContractSnapshot(contractId); } catch { continue; }
        }
        const precision = getPrecision(market);
        if (!Number.isInteger(precision) || precision! < 0 || precision! > 12 ||
            !Number.isFinite(provider.exitSpot) || !Number.isFinite(provider.exitTickTime)) continue;
        const epoch = Number(provider.exitTickTime), spot = Number(provider.exitSpot);
        const ticks = registry.snapshot(market).recentTicks;
        const matches = ticks.flatMap((tick, index) =>
          tick.epoch === epoch && tick.quote.toFixed(precision!) === spot.toFixed(precision!) ? [index] : []);
        const index = matches.length === 1 ? matches[0] : -1;
        const format = (tick: { quote: number; digit: number; epoch: number }) =>
          ({ quote: tick.quote.toFixed(precision!), digit: tick.digit, epoch: tick.epoch });
        const before = index >= 0 ? ticks.slice(Math.max(0, index - 3), index).map(format) : [];
        const after = index >= 0 ? ticks.slice(index + 1, index + 4).map(format) : [];
        exit = { quote: spot.toFixed(precision!), digit: Number.isInteger(provider.exitDigit) ? provider.exitDigit : null,
          epoch, before, after, complete: index >= 3 && after.length === 3 };
        if (!initialWrite) initialWrite = store.saveTradeContext(accountId, contractId, { exit })
          .catch(error => { console.warn('[brain] initial exit context unavailable:', error instanceof Error ? error.message : String(error)); });
        if (exit.complete) break;
      }
      // Merge the exit key into the existing context without overwriting the
      // concurrently collected entry, cow display, or Brain attribution.
      if (initialWrite) await initialWrite;
      await store.saveTradeContext(accountId, contractId, { exit });
    })().catch(error => console.warn('[brain] exit context unavailable:', error instanceof Error ? error.message : String(error)));
  };
  const reconcile = async (accountId: string, client: DerivPrivateClient) => {
    const active = await store.activeContract(accountId);
    if (!active?.provider_contract_id || (active.status !== 'open' && active.status !== 'unknown')) return active;
    try {
      const result = await client.getContractSnapshot(active.provider_contract_id);
      if (result.settled && (result.status === 'won' || result.status === 'lost')) {
        await store.recordSettlement(accountId, active.provider_contract_id, result.status, result.profit);
        captureExitContext(accountId, active.provider_contract_id, active.market, result, client);
        publish({ type: 'trade', accountId, contractId: active.provider_contract_id, status: result.status, profit: result.profit });
        const rangerRun = rangerRuns.get(accountId);
        if (rangerRun?.pendingContractId === active.provider_contract_id) settleRangerRun(rangerRun, result.status, result.profit);
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

  type RangerRunConfig = {
    stake: number;
    maxStake: number;
    minEdge: number;
    minWin: number;
    maxTrades: number;
    maxRunLoss: number;
    takeProfit: number;
    lossLimit: number;
    cooldownSeconds: number;
    shots: number;
    direction: Direction | null;
    barrier: number | null;
    market: string | null;
    green: boolean;
    gold: boolean;
    red: boolean;
  };
  type RangerPick = SignalCandidate & { p: number; score: number; digitSamples: number; riseSamples: number; hitSignal: boolean; epoch: number };
  type RangerRun = {
    accountId: string;
    mode: 'demo' | 'real';
    armedUntil: number;
    source: 'owner' | 'player';
    sessionSecret: string | null;
    ownerAuthorized: () => boolean;
    token: string;
    config: RangerRunConfig;
    running: boolean;
    phase: string;
    reason: string | null;
    startedAt: number;
    updatedAt: number;
    tradesDone: number;
    wins: number;
    losses: number;
    lossStreak: number;
    runProfit: number;
    candidate: { market: string; direction: Direction; barrier: number } | null;
    confirmKey: string;
    confirmEpoch: number;
    confirmations: number;
    lastAttemptEpoch: number;
    cooldownUntil: number;
    pendingContractId: string | null;
    timer: NodeJS.Timeout | null;
    busy: boolean;
  };
  const RANGER_ARM_MS = 10 * 60 * 1000;
  const RANGER_AUTH_CHECK_MS = 15_000;
  const RANGER_RUN_INTERVAL_MS = 750;
  const rangerAuthCheckedAt = new Map<string, number>();

  function rangerRunState(run: RangerRun | undefined, accountId: string, armedUntil = 0): Record<string, unknown> {
    if (!run) return { running: false, phase: 'idle', startedAt: null, tradesDone: 0, wins: 0, losses: 0, runProfit: 0, reason: null, candidate: null, account: { loginid: accountId }, armedUntil: armedUntil || null };
    return {
      running: run.running, phase: run.phase, startedAt: run.startedAt, updatedAt: run.updatedAt,
      tradesDone: run.tradesDone, wins: run.wins, losses: run.losses, runProfit: run.runProfit,
      reason: run.reason, candidate: run.candidate, config: run.config,
      account: { loginid: run.accountId, mode: run.mode },
      armedUntil: run.mode === 'real' ? rangerArms.get(run.accountId) ?? null : null,
      cooldownUntil: run.cooldownUntil || null,
    };
  }

  function stopRangerRun(run: RangerRun, reason: string): void {
    if (!run.running) return;
    run.running = false;
    run.phase = 'stopped';
    run.reason = reason;
    run.updatedAt = Date.now();
    if (run.timer) clearInterval(run.timer);
    run.timer = null;
  }

  function settleRangerRun(run: RangerRun, status: 'won' | 'lost', profit: number): void {
    if (!run.running || !Number.isFinite(profit)) return;
    run.pendingContractId = null;
    run.tradesDone += 1;
    run.runProfit += profit;
    if (status === 'won') { run.wins += 1; run.lossStreak = 0; }
    else { run.losses += 1; run.lossStreak += 1; }
    run.updatedAt = Date.now();
    if (run.config.maxTrades > 0 && run.tradesDone >= run.config.maxTrades) { stopRangerRun(run, 'Maximum trade count reached.'); return; }
    if (run.config.takeProfit > 0 && run.runProfit >= run.config.takeProfit) { stopRangerRun(run, 'Take-profit limit reached.'); return; }
    if (run.config.maxRunLoss > 0 && run.runProfit <= -run.config.maxRunLoss) { stopRangerRun(run, 'Maximum run loss reached.'); return; }
    if (run.config.lossLimit > 0 && run.lossStreak >= run.config.lossLimit) {
      run.lossStreak = 0;
      run.cooldownUntil = Date.now() + run.config.cooldownSeconds * 1000;
      run.phase = 'cooldown';
    } else run.phase = 'scanning';
  }

  function parseRangerConfig(input: unknown): RangerRunConfig {
    const body = input && typeof input === 'object' ? input as Record<string, unknown> : {};
    const number = (key: string, fallback: number): number => body[key] === undefined ? fallback : Number(body[key]);
    const stake = number('stake', NaN), maxStake = number('maxStake', stake);
    const minEdge = number('minEdge', 0), minWin = number('minWin', 0.7);
    const maxTrades = number('maxTrades', 0), maxRunLoss = number('maxRunLoss', 0);
    const takeProfit = number('takeProfit', 0), lossLimit = number('lossLimit', 0);
    const cooldownSeconds = number('cooldownSeconds', 60), shots = number('shots', 3);
    if (!Number.isFinite(stake) || stake <= 0 || !Number.isFinite(maxStake) || maxStake <= 0 || stake > maxStake) throw new Error('invalid Ranger Auto stake or maximum stake');
    if (![minEdge, minWin, maxTrades, maxRunLoss, takeProfit, lossLimit, cooldownSeconds, shots].every(Number.isFinite)) throw new Error('invalid Ranger Auto configuration');
    if (minEdge < 0 || minEdge > 1 || minWin < 0.7 || minWin > 0.99 || maxTrades < 0 || maxTrades > 1000 || maxRunLoss < 0 || takeProfit < 0 || lossLimit < 0 || lossLimit > 100 || cooldownSeconds < 1 || cooldownSeconds > 3600 || shots < 1 || shots > 5 || !Number.isInteger(maxTrades) || !Number.isInteger(lossLimit) || !Number.isInteger(cooldownSeconds) || !Number.isInteger(shots)) throw new Error('Ranger Auto settings are outside the allowed range');
    const direction = body.direction === 'over' || body.direction === 'under' ? body.direction : null;
    const barrierValue = body.barrier === undefined || body.barrier === null ? null : Number(body.barrier);
    if (barrierValue !== null && (!Number.isInteger(barrierValue) || (direction === 'over' ? barrierValue < 0 || barrierValue > 8 : barrierValue < 1 || barrierValue > 9))) throw new Error('invalid Ranger Auto barrier');
    const market = typeof body.market === 'string' && registry.has(body.market) ? body.market : null;
    if (body.market !== undefined && body.market !== null && !market) throw new Error('invalid Ranger Auto market');
    const green = body.green === undefined ? true : body.green === true;
    const gold = body.gold === undefined ? true : body.gold === true;
    const red = body.red === undefined ? true : body.red === true;
    if (!green && !gold && !red) throw new Error('enable at least one Ranger Auto ring');
    return { stake, maxStake, minEdge, minWin, maxTrades, maxRunLoss, takeProfit, lossLimit, cooldownSeconds, shots, direction, barrier: barrierValue, market, green, gold, red };
  }

  function rangerCandidates(run: RangerRun): RangerPick[] {
    const allowed = run.config.direction
      ? run.config.barrier === null
        ? Array.from({ length: 9 }, (_, index) => ({ direction: run.config.direction as Direction, barrier: run.config.direction === 'over' ? index : index + 1 }))
        : [{ direction: run.config.direction, barrier: run.config.barrier }]
      : run.config.barrier === null ? null : [
          { direction: 'over' as Direction, barrier: run.config.barrier },
          { direction: 'under' as Direction, barrier: run.config.barrier },
        ];
    const pick = pickSignal(registry, run.config.minWin, -1, (symbol, count) => registry.snapshot(symbol).recentDigits.slice(-count), 500, allowed);
    const snapshots = new Map(registry.allSnapshots().map(snapshot => [snapshot.symbol, snapshot] as const));
    const candidates: RangerPick[] = [];
    for (const candidate of pick.candidates) {
      const snapshot = snapshots.get(candidate.market);
      if (!snapshot || !snapshot.fresh || (run.config.market && candidate.market !== run.config.market)) continue;
      const digits = snapshot.recentDigits;
      const quotes = snapshot.recentQuotes;
      const high = digits.filter(digit => digit >= 5).length;
      const wins = digits.filter(digit => candidate.direction === 'over' ? digit > candidate.barrier : digit < candidate.barrier).length;
      const alignedRate = digits.length ? wins / digits.length : 0.5;
      const empiricalP = digits.length ? (wins + candidate.estWin * 10) / (digits.length + 10) : candidate.estWin;
      const empiricalWeight = digits.length ? Math.min(0.3, digits.length / (digits.length + 18) * 0.3) : 0;
      const alignedQuotes: number[] = [];
      for (let index = 1; index < quotes.length; index++) {
        if (candidate.direction === 'over' ? quotes[index] > quotes[index - 1] : quotes[index] < quotes[index - 1]) alignedQuotes.push(quotes[index]);
      }
      const riseSamples = Math.max(0, quotes.length - 1);
      const alignedRise = riseSamples ? alignedQuotes.length / riseSamples : 0.5;
      const rawP = candidate.estWin;
      const hlAdjustment = digits.length >= 20 ? ((candidate.direction === 'over' ? high : digits.length - high) / digits.length - 0.5) * 0.12 : 0;
      const riseAdjustment = riseSamples >= 8 ? (alignedRise - 0.5) * 0.1 : 0;
      const p = Math.max(0.01, Math.min(0.99, rawP * (1 - empiricalWeight) + empiricalP * empiricalWeight + hlAdjustment + riseAdjustment));
      const ratio = candidate.estPayout;
      const edge = p - (ratio > 0 ? 1 / ratio : candidate.baseWin);
      const score = p * ratio - 1;
      const hitSignal = digits.length >= 30 && riseSamples >= 12 && alignedRise >= 0.65 && alignedRate >= 0.55 && p >= 0.7 && edge > 0;
      if (p < run.config.minWin || edge <= 0 || edge < run.config.minEdge) continue;
      candidates.push({ ...candidate, p, edge, score, digitSamples: digits.length, riseSamples, hitSignal, epoch: snapshot.lastEpoch });
    }
    if (!candidates.length) return [];
    const bestEdge = [...candidates].sort((a, b) => b.edge - a.edge || b.score - a.score)[0];
    const bestScore = [...candidates].sort((a, b) => b.score - a.score || b.edge - a.edge)[0];
    return candidates.filter(candidate =>
      (run.config.green && candidate === bestEdge) ||
      (run.config.gold && candidate === bestScore) ||
      (run.config.red && candidate.hitSignal)
    ).sort((a, b) => b.score - a.score || b.edge - a.edge || b.p - a.p);
  }

  async function runnerAuthorized(run: RangerRun, force = false): Promise<string | null> {
    const now = Date.now();
    const checkedAt = rangerAuthCheckedAt.get(run.accountId) ?? 0;
    if (!force && now - checkedAt < RANGER_AUTH_CHECK_MS) return run.token;
    rangerAuthCheckedAt.set(run.accountId, now);
    if (run.source === 'owner') {
      const session = getSession();
      if (!run.ownerAuthorized() || !session || session.loginid !== run.accountId) return null;
      try { return await resolveStoredToken(); } catch { return null; }
    }
    try {
      const current = await store.resolveSession(run.sessionSecret);
      if (!current || current.accountId !== run.accountId || current.expiresAt <= now) return null;
      run.token = current.token;
      return current.token;
    } catch { return null; }
  }

  async function tickRangerRun(run: RangerRun): Promise<void> {
    if (!run.running || run.busy) return;
    run.busy = true;
    try {
      const now = Date.now();
      if (run.mode === 'real') {
        const armedUntil = rangerArms.get(run.accountId) ?? 0;
        if (armedUntil <= now || armedUntil !== run.armedUntil) { stopRangerRun(run, 'Real-money authorization expired.'); return; }
      }
      const token = await runnerAuthorized(run);
      if (!token) { stopRangerRun(run, 'Deriv session expired or changed.'); return; }
      const info = await account(run.accountId, token);
      if (info.mode !== run.mode) { stopRangerRun(run, 'Deriv account mode changed.'); return; }
      if (run.pendingContractId) { run.phase = 'waiting-settlement'; return; }
      const active = await store.activeContract(run.accountId);
      if (active && (active.status === 'open' || active.status === 'unknown' || active.status === 'purchasing')) {
        run.pendingContractId = active.provider_contract_id ?? null;
        run.phase = 'waiting-settlement';
        if (active.provider_contract_id) monitor(run.accountId, await clients.connect(run.accountId, token));
        return;
      }
      if (run.cooldownUntil > now) { run.phase = 'cooldown'; run.updatedAt = now; return; }
      if (run.cooldownUntil) { run.cooldownUntil = 0; run.phase = 'scanning'; }
      const picks = rangerCandidates(run);
      if (!picks.length) {
        run.candidate = null; run.confirmKey = ''; run.confirmEpoch = 0; run.confirmations = 0;
        run.phase = 'waiting-signal'; run.updatedAt = now; return;
      }
      const selected = picks[0];
      const key = selected.market + '|' + selected.direction + '|' + selected.barrier;
      run.candidate = { market: selected.market, direction: selected.direction, barrier: selected.barrier };
      if (key !== run.confirmKey) { run.confirmKey = key; run.confirmEpoch = 0; run.confirmations = 0; run.lastAttemptEpoch = 0; }
      if (selected.epoch > run.confirmEpoch) { run.confirmEpoch = selected.epoch; run.confirmations += 1; }
      if (run.confirmations < run.config.shots) { run.phase = 'confirming-signal'; run.updatedAt = now; return; }
      if (selected.epoch <= run.lastAttemptEpoch) { run.phase = 'waiting-next-tick'; run.updatedAt = now; return; }
      run.lastAttemptEpoch = selected.epoch;
      run.phase = 'quoting'; run.updatedAt = now;
      const order: Order = { market: selected.market, direction: selected.direction, barrier: selected.barrier, stake: run.config.stake, minEdge: run.config.minEdge };
      if (!registry.snapshot(order.market).fresh) { run.phase = 'waiting-feed'; return; }
      const riskSettings = getSettings();
      const riskState = await store.riskSnapshot(run.accountId, info.balance);
      const risk = riskCheck({ stake: order.stake, settings: riskSettings, balance: info.balance,
        context: buildRecoveryContext(riskSettings, undefined, riskState), lastTradeAt: 0,
        tradeGapMs: 0, now, accountId: 'deriv:' + run.accountId,
        skipStrategyCaps: false, lane: 'digit' });
      if (!risk.ok) { stopRangerRun(run, 'Trade blocked by account risk: ' + risk.reason); return; }
      const client = await clients.connect(run.accountId, token);
      if (await reconcile(run.accountId, client)) { run.phase = 'waiting-settlement'; return; }
      if ((await client.getOpenContractIds()).size > 0) { run.phase = 'waiting-settlement'; return; }
      const offered = await quote(client, order, info.currency);
      if (!Number.isFinite(offered.askPrice) || offered.askPrice <= 0 || !Number.isFinite(offered.payout) || offered.payout <= offered.askPrice || offered.askPrice > info.balance) { run.phase = 'waiting-quote'; return; }
      const liveEdge = modelEdge(order, offered.askPrice, offered.payout);
      if (order.minEdge > 0 && liveEdge < order.minEdge) { run.phase = 'waiting-edge'; return; }
      if (!registry.snapshot(order.market).fresh) { run.phase = 'waiting-feed'; return; }
      const stillAuthorized = await runnerAuthorized(run, true);
      if (!run.running || !stillAuthorized) { if (run.running) stopRangerRun(run, 'Deriv session expired or changed.'); return; }
      const confirmRiskState = await store.riskSnapshot(run.accountId, info.balance);
      const confirmRisk = riskCheck({ stake: order.stake, settings: riskSettings, balance: info.balance,
        context: buildRecoveryContext(riskSettings, undefined, confirmRiskState), lastTradeAt: 0,
        tradeGapMs: 0, now: Date.now(), accountId: 'deriv:' + run.accountId,
        skipStrategyCaps: false, lane: 'digit' });
      if (!confirmRisk.ok) { stopRangerRun(run, 'Trade blocked by account risk: ' + confirmRisk.reason); return; }
      const reservationId = await store.reserve(run.accountId, randomUUID(), { ...order, mode: info.mode });
      let buyAttempted = false;
      let boughtContractId: string | null = null;
      try {
        if (!run.running || (run.mode === 'real' && (rangerArms.get(run.accountId) ?? 0) <= Date.now())) {
          await store.cancelBeforeBuy(run.accountId, reservationId);
          if (run.running) stopRangerRun(run, 'Real-money authorization expired.');
          return;
        }
        const buyAuthorization = await runnerAuthorized(run, true);
        if (!run.running || !buyAuthorization) {
          await store.cancelBeforeBuy(run.accountId, reservationId);
          if (run.running) stopRangerRun(run, 'Deriv session expired or changed.');
          return;
        }
        if (client.connectedAccountId !== run.accountId || (await client.getOpenContractIds()).size > 0) {
          await store.cancelBeforeBuy(run.accountId, reservationId);
          run.phase = 'waiting-settlement';
          return;
        }
        buyAttempted = true;
        const bought = await client.placeBuy(offered.id, offered.askPrice);
        boughtContractId = bought.contractId;
        await store.markPurchased(run.accountId, reservationId, bought.contractId, bought.buyPrice, bought.payout);
        run.pendingContractId = bought.contractId;
        run.phase = 'waiting-settlement'; run.updatedAt = Date.now();
        publish({ type: 'trade', accountId: run.accountId, contractId: bought.contractId, status: 'open' });
        captureTradeContext(run.accountId, bought.contractId, order, liveEdge, client);
        monitor(run.accountId, client);
      } catch (error) {
        if (buyAttempted) {
          try { await store.markUnknown(run.accountId, reservationId, boughtContractId); } catch { /* reservation remains fail-closed */ }
          stopRangerRun(run, 'Purchase outcome uncertain; account locked for reconciliation.');
        } else {
          await store.cancelBeforeBuy(run.accountId, reservationId);
          run.phase = 'waiting-quote'; run.updatedAt = Date.now();
        }
      }
    } catch (error) {
      run.phase = 'error'; run.reason = error instanceof Error ? error.message : 'Ranger Auto cycle failed';
      run.updatedAt = Date.now();
    } finally {
      run.busy = false;
    }
  }

  function startRangerTimer(run: RangerRun): void {
    if (run.timer) clearInterval(run.timer);
    run.timer = setInterval(() => { void tickRangerRun(run); }, RANGER_RUN_INTERVAL_MS);
    void tickRangerRun(run);
  }

  const fail = (reply: { code: (code: number) => unknown }, status: number, message: string, extra?: Record<string, unknown>) => { reply.code(status); return { error: message, ...extra }; };


  app.post('/api/player/automation/arm', async (req, reply) => {
    if (!validOrigin(req)) return fail(reply, 403, 'origin rejected');
    const user = await principal(req);
    if (!user) return fail(reply, 401, 'player session required');
    if ((req.body as { confirmRealFunds?: unknown } | undefined)?.confirmRealFunds !== true) return fail(reply, 403, 'explicit real-money confirmation required');
    try {
      const info = await account(user.accountId, user.token, 'state');
      if (info.mode !== 'real') return fail(reply, 409, 'real-money arm is only available for a real account');
      const armedUntil = Date.now() + RANGER_ARM_MS;
      rangerArms.set(user.accountId, armedUntil);
      const run = rangerRuns.get(user.accountId);
      if (run?.running) run.armedUntil = armedUntil;
      return { ok: true, armedUntil, account: { loginid: user.accountId, mode: info.mode } };
    } catch { return fail(reply, 503, 'Deriv account could not be verified'); }
  });

  app.post('/api/player/automation/disarm', async (req, reply) => {
    if (!validOrigin(req)) return fail(reply, 403, 'origin rejected');
    const user = await principal(req);
    if (!user) return fail(reply, 401, 'player session required');
    rangerArms.delete(user.accountId);
    const run = rangerRuns.get(user.accountId);
    if (run?.running && run.mode === 'real') stopRangerRun(run, 'Real-money automation disarmed.');
    return { ok: true, state: rangerRunState(run, user.accountId) };
  });

  app.post('/api/player/automation/start', async (req, reply) => {
    if (!validOrigin(req)) return fail(reply, 403, 'origin rejected');
    const user = await principal(req);
    if (!user) return fail(reply, 401, 'player session required');
    let config: RangerRunConfig;
    try { config = parseRangerConfig(req.body); } catch (error) { return fail(reply, 400, error instanceof Error ? error.message : 'invalid Ranger Auto settings'); }
    try {
      const info = await account(user.accountId, user.token);
      if (info.mode === 'real') {
        const armedUntil = rangerArms.get(user.accountId) ?? 0;
        if (armedUntil <= Date.now()) return fail(reply, 403, 'arm real-money automation for 10 minutes before starting');
      }
      const current = rangerRuns.get(user.accountId);
      // Repeated start requests should restore the existing run in the UI, not report a failure.
      if (current?.running) return { ok: true, state: rangerRunState(current, user.accountId) };
      const active = await store.activeContract(user.accountId);
      const client = await clients.connect(user.accountId, user.token);
      if (active && (active.status === 'open' || active.status === 'unknown' || active.status === 'purchasing') || (await client.getOpenContractIds()).size > 0) return fail(reply, 409, 'account has an open or uncertain contract');
      if (!(listeners.get(user.accountId)?.size)) return fail(reply, 409, 'keep the authenticated player connection open to run Ranger Auto');
      const sessionSecret = user.source === 'player' ? secretFor(req) : null;
      const run: RangerRun = {
        accountId: user.accountId, mode: info.mode, source: user.source, sessionSecret,
        ownerAuthorized: () => isOwner(req), token: user.token, config,
        running: true, phase: 'starting', reason: null, startedAt: Date.now(), updatedAt: Date.now(),
        tradesDone: 0, wins: 0, losses: 0, lossStreak: 0, runProfit: 0,
        candidate: null, confirmKey: '', confirmEpoch: 0, confirmations: 0, lastAttemptEpoch: 0,
        cooldownUntil: 0, pendingContractId: null, timer: null, busy: false,
        armedUntil: info.mode === 'real' ? rangerArms.get(user.accountId) ?? 0 : 0,
      };
      rangerRuns.set(user.accountId, run);
      startRangerTimer(run);
      return { ok: true, state: rangerRunState(run, user.accountId) };
    } catch (error) {
      return fail(reply, 503, error instanceof Error ? error.message : 'Ranger Auto could not start');
    }
  });

  app.post('/api/player/automation/stop', async (req, reply) => {
    if (!validOrigin(req)) return fail(reply, 403, 'origin rejected');
    const user = await principal(req);
    if (!user) return fail(reply, 401, 'player session required');
    const run = rangerRuns.get(user.accountId);
    if (run) stopRangerRun(run, 'Stopped by user.');
    return { ok: true, state: rangerRunState(run, user.accountId, rangerArms.get(user.accountId) ?? 0) };
  });

  app.get('/api/player/automation/state', async (req, reply) => {
    const user = await principal(req);
    if (!user) return fail(reply, 401, 'player session required');
    return { state: rangerRunState(rangerRuns.get(user.accountId), user.accountId, rangerArms.get(user.accountId) ?? 0) };
  });

  app.get('/api/player/trading/state', async (req, reply) => {
    const user = await principal(req);
    if (!user) return fail(reply, 401, 'player session required');
    try {
      const info = await account(user.accountId, user.token, 'state');
      const risk = await store.riskSnapshot(user.accountId, info.balance);
      const client = await clients.connect(user.accountId, user.token);
      const active = await reconcile(user.accountId, client);
      if (active?.status === 'open' || (active?.status === 'unknown' && active.provider_contract_id)) monitor(user.accountId, client);
      return { session: { loginid: user.accountId, ...info }, risk, active, trades: await store.listTrades(user.accountId), rangerAutomation: rangerRunState(rangerRuns.get(user.accountId), user.accountId, rangerArms.get(user.accountId) ?? 0) };
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
      const offered = await quote(client, order, info.currency);
      if (offered.askPrice > preview.ask * 1.02 || offered.payout < preview.payout * .98 || offered.askPrice > info.balance || !Number.isFinite(offered.askPrice) || offered.askPrice <= 0 || !Number.isFinite(offered.payout) || offered.payout <= offered.askPrice) return fail(reply, 409, 'quote changed; review again');
      const entryEdge = modelEdge(order, offered.askPrice, offered.payout);
      if ((order.minEdge > 0 && entryEdge < order.minEdge) || !registry.snapshot(order.market).fresh) return fail(reply, 409, 'market no longer meets entry conditions');
      try { reservation = await store.reserve(user.accountId, body.idempotencyKey, { ...order, mode: info.mode }); }
      catch { return fail(reply, 409, 'account has an open or uncertain contract'); }
      if (client.connectedAccountId !== user.accountId) throw new Error('connected account changed');
      if ((await client.getOpenContractIds()).size > 0) throw new Error('Deriv account already has an open contract');
      buyAttempted = true;
      const bought = await client.placeBuy(offered.id, offered.askPrice);
      boughtContractId = bought.contractId;
      await store.markPurchased(user.accountId, reservation, bought.contractId, bought.buyPrice, bought.payout);
      publish({ type: 'trade', accountId: user.accountId, contractId: bought.contractId, status: 'open' });
      captureTradeContext(user.accountId, bought.contractId, order, entryEdge, client);
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
      const cleanup = () => { clearInterval(heartbeat); bucket!.delete(send); if (bucket!.size === 0) { listeners.delete(accountId); const run = rangerRuns.get(accountId); if (run?.running) stopRangerRun(run, 'Player connection closed.'); } };
      socket.on('close', cleanup); socket.on('error', cleanup);
      socket.send(JSON.stringify({ type: 'hello', accountId }));
    })().catch(() => socket.close(1011, 'session unavailable'));
  });
}
