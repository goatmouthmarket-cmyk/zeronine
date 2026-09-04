import type { Direction } from '../core/digitMath.ts';
import { breakevenWinRate, estimatePayoutRatio, winDigits } from '../core/digitMath.ts';
import { scanMarket } from '../strategy/scanner.ts';
import type { MarketScan } from '../strategy/scanner.ts';
import type { RecoveryContext } from '../strategy/recovery.ts';
import { planRecovery } from '../strategy/recovery.ts';
import type { LadderOption } from '../strategy/recovery.ts';
import { nextRecovery } from '../strategy/risk.ts';
import { assessMarketHealth } from '../intelligence/health.ts';
import { assessRegime } from '../intelligence/regime.ts';
import type { IntelligenceSnapshot, MarketIntelligence } from '../intelligence/engine.ts';
import { allocateCapital } from '../intelligence/capitalAllocation.ts';
import {
  evaluateRecoveryObservation,
  startRecoveryObservation,
  transitionRecoveryObservation,
} from '../intelligence/recoveryObservation.ts';
import type { RecoveryObservationState } from '../intelligence/recoveryObservation.ts';
import { digitCandidateQuality, isSensibleDigitCandidate, pickSignalFromSnapshot } from '../strategy/signal.ts';
import { config } from '../config.ts';
import { matchesConfirmedDigitTrigger, matchesDigitTrigger } from '../strategy/entryMode.ts';
import { digitHistory, getQuoteStats, getSettings, insertTestRun, listMarkets, listTestRuns, patternRowsByPrev, patternWeightForStrategy } from '../db/store.ts';
import type { TestRunRow } from '../db/store.ts';
import { computeMetrics, runRow, round2 } from './metrics.ts';
import type { Aggregate } from './metrics.ts';

export const TEST_STRATEGIES = ['conservative', 'martingale', 'boosted_martingale', 'chase'] as const;
export const TEST_MODES = ['rapid', 'balanced', 'strict'] as const;
export const TEST_ENTRY_MODES = ['model', 'digit_trigger', 'digit_trigger_confirmed'] as const;

export interface TestConfig {
  strategyMode: (typeof TEST_STRATEGIES)[number];
  botMode: (typeof TEST_MODES)[number];
  entryMode?: (typeof TEST_ENTRY_MODES)[number];
}

export function allConfigs(): TestConfig[] {
  const out: TestConfig[] = [];
  for (const strategyMode of TEST_STRATEGIES) {
    for (const botMode of TEST_MODES) for (const entryMode of TEST_ENTRY_MODES) out.push({ strategyMode, botMode, entryMode });
  }
  return out;
}

function allowedBarriers(strategyMode: TestConfig['strategyMode']): Array<{ direction: Direction; barrier: number }> {
  if (strategyMode === 'conservative') {
    return [
      { direction: 'over', barrier: 1 },
      { direction: 'under', barrier: 8 },
    ];
  }
  const out: Array<{ direction: Direction; barrier: number }> = [];
  for (let b = 0; b <= 7; b++) out.push({ direction: 'over', barrier: b });
  for (let b = 9; b >= 3; b--) out.push({ direction: 'under', barrier: b });
  return out;
}

function modeGates(botMode: TestConfig['botMode'], minEdgeSetting: number): { minWin: number; minEdge: number } {
  switch (botMode) {
    case 'rapid':
      return { minWin: 0.3, minEdge: Math.max(0.003, minEdgeSetting * 0.5) };
    case 'strict':
      return { minWin: 0.4, minEdge: minEdgeSetting * 2 };
    default:
      return { minWin: 0.35, minEdge: minEdgeSetting };
  }
}

export interface MarketData {
  symbol: string;
  digits: number[];
  sampled: ReplaySample[];
}

export interface ReplaySample {
  k: number;
  epoch: number;
  settleEpoch: number;
  scan: MarketScan;
}

/** A decision point formed strictly from ticks known through `epoch`. */
export interface ChronologicalReplayEvent {
  market: string;
  k: number;
  epoch: number;
  settleEpoch: number;
  scan: MarketScan;
}

/** Stable, globally ordered decision timeline shared by every replay config. */
export function chronologicalReplayEvents(markets: MarketData[]): ChronologicalReplayEvent[] {
  return markets
    .flatMap((market) => market.sampled.map((sample) => ({ market: market.symbol, ...sample })))
    .sort((a, b) => a.epoch - b.epoch || a.market.localeCompare(b.market) || a.k - b.k);
}

function loadMarket(symbol: string, historyLimit: number, stride: number, warmup: number, patternWeight: number): MarketData | null {
  const hist = digitHistory(symbol, historyLimit).filter((h) => h.digit >= 0 && h.digit <= 9);
  if (hist.length < warmup + 300) return null;
  const digits = hist.map((h) => h.digit);
  const epochs = hist.map((h) => h.epoch);
  const patternMap = patternWeight > 0 ? patternRowsByPrev(symbol) : null;
  const sampled: ReplaySample[] = [];

  for (let k = warmup; k + 1 < digits.length; k += stride) {
    const buf = digits.slice(Math.max(0, k - 999), k + 1);
    // `buf` ends at k. The settlement digit k + 1 is deliberately excluded
    // from the scanner, so no feature can observe the result it will be scored
    // against below.
    const scan = scanMarket(symbol, symbol, buf, patternMap
      ? { rowFor: (_market, previous) => patternMap.get(previous) ?? null, weight: patternWeight }
      : null);
    sampled.push({ k, epoch: epochs[k], settleEpoch: epochs[k + 1], scan });
  }
  if (sampled.length === 0) return null;
  return { symbol, digits, sampled };
}

export interface BacktestTrade {
  market: string;
  epoch: number;
  direction: Direction;
  barrier: number;
  stake: number;
  ratio: number;
  won: boolean;
  profit: number;
}

export interface BacktestRunResult {
  config: TestConfig;
  baseStake: number;
  startBalance: number;
  trades: BacktestTrade[];
  metrics: Aggregate;
  equity: number[];
}

export interface BacktestOutcome {
  runs: TestRunRow[];
  results: BacktestRunResult[];
}

interface ReplayState {
  mode: 'base' | 'recovering';
  streak: number;
  debt: number;
  attempts: number;
  cycleStake: number;
  peakBalance: number;
  balance: number;
}

export interface BacktestProgress {
  phase: 'preparing' | 'replaying' | 'done';
  configIndex: number;
  totalConfigs: number;
  message: string;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

const BARR_KEYS: { direction: Direction; barrier: number }[] = allowedBarriers('martingale');

interface PendingReplayContract {
  market: string;
  settleEpoch: number;
  outcomeDigit: number;
  direction: Direction;
  barrier: number;
  stake: number;
  ratio: number;
  epoch: number;
}

function replayQuoteQuality(quote: {
  baseWin: number;
  estWin: number;
  realEdge: number;
  realEV: number;
  consistency: number;
  entropy: number;
  momentum: number;
}): number {
  return digitCandidateQuality({
    baseWin: quote.baseWin,
    estWin: quote.estWin,
    edge: quote.realEdge,
    expectedROI: quote.realEV,
    consistency: quote.consistency,
    entropy: quote.entropy,
    momentum: quote.momentum,
    learnedWin: null,
  });
}

function replayRiskAllowed(st: ReplayState, settings: Parameters<typeof replayOne>[2], stake: number): boolean {
  if (!(stake > 0) || stake > st.balance * 0.9) return false;
  if (st.streak + 1 > settings.max_consecutive_losses) return false;
  if (settings.max_drawdown_pct > 0 && st.peakBalance > 0
    && (st.peakBalance - st.balance) / st.peakBalance >= settings.max_drawdown_pct / 100) return false;
  if (st.debt > 0.005 && (st.cycleStake + stake > settings.max_recovery_exposure || st.debt >= settings.max_recovery_debt)) return false;
  return true;
}

function replayOne(
  cfg: TestConfig,
  markets: MarketData[],
  settingsLike: {
    min_edge: number;
    min_recovery_win: number;
    martingale_steps: number;
    max_consecutive_losses: number;
    strategy_multiplier: number;
    recovery_buffer: number;
    chase_amortize: number;
    max_recovery_debt: number;
    max_recovery_exposure: number;
    max_drawdown_pct: number;
  },
  baseStake: number,
  target: number,
  startBalance: number,
  ratioFor: (market: string, direction: Direction, barrier: number) => number,
): BacktestRunResult {
  const entryMode = cfg.entryMode ?? 'model';
  const gates = modeGates(cfg.botMode, settingsLike.min_edge);
  const allowed = allowedBarriers(cfg.strategyMode);
  let st: ReplayState = {
    mode: 'base',
    streak: 0,
    debt: 0,
    attempts: 0,
    cycleStake: 0,
    peakBalance: startBalance,
    balance: startBalance,
  };
  const trades: BacktestTrade[] = [];
  const equity = [startBalance];
  const currentMarkets = new Map<string, MarketIntelligence>();
  const currentSamples = new Map<string, ReplaySample>();
  let observation: RecoveryObservationState | undefined;
  let pending: PendingReplayContract | undefined;

  const settle = (contract: PendingReplayContract): void => {
    const won = winDigits(contract.direction, contract.barrier).includes(contract.outcomeDigit);
    const profit = won ? round2(contract.stake * (contract.ratio - 1)) : -round2(contract.stake);
    const balance = round2(st.balance + profit);
    const before = st;
    st = { ...nextRecovery(st, won, profit, balance), balance };
    if (won) {
      if (observation) observation = transitionRecoveryObservation(observation, { type: 'recovery_won' });
    } else {
      const loss = { direction: contract.direction, barrier: contract.barrier, digit: contract.outcomeDigit };
      observation = before.debt > 0.005 && observation
        ? transitionRecoveryObservation(observation, { type: 'recovery_lost', loss })
        : startRecoveryObservation(contract.market, loss);
    }
    trades.push({
      market: contract.market,
      epoch: contract.epoch,
      direction: contract.direction,
      barrier: contract.barrier,
      stake: contract.stake,
      ratio: contract.ratio,
      won,
      profit,
    });
    equity.push(st.balance);
  };

  for (const event of chronologicalReplayEvents(markets)) {
    if (trades.length >= target) break;
    let settledThisCycle = false;
    if (pending && pending.settleEpoch <= event.epoch) {
      settle(pending);
      pending = undefined;
      settledThisCycle = true;
      if (trades.length >= target) break;
    }

    const previous = currentMarkets.get(event.market);
    currentMarkets.set(event.market, {
      scan: event.scan,
      health: assessMarketHealth(event.scan, previous?.health),
      regime: assessRegime(event.scan, previous?.regime, event.epoch * 1000),
    });
    currentSamples.set(event.market, { k: event.k, epoch: event.epoch, settleEpoch: event.settleEpoch, scan: event.scan });
    const intelligence: IntelligenceSnapshot = { at: event.epoch * 1000, markets: new Map(currentMarkets) };

    if (observation && observation.market === event.market) {
      observation = transitionRecoveryObservation(observation, { type: 'tick' });
    }
    // A live contract prevents a second order. Also do not immediately reuse a
    // settlement tick as a new signal; its digit was not knowable at entry.
    if (pending || settledThisCycle) continue;

    const conservative = cfg.strategyMode === 'conservative';
    const signal = pickSignalFromSnapshot(
      intelligence,
      conservative ? 0 : gates.minWin,
      conservative ? -1 : gates.minEdge,
      20,
      allowed,
    );
    if (signal.holds || signal.candidates.length === 0) continue;

    const quotes = signal.candidates.map((candidate) => {
      const ratio = ratioFor(candidate.market, candidate.direction, candidate.barrier);
      return { ...candidate, ratio, realEdge: candidate.estWin - breakevenWinRate(1, ratio), realEV: candidate.estWin * ratio - 1 };
    }).filter((quote) => quote.ratio > 1);
    if (quotes.length === 0) continue;

    let decision: { market: string; direction: Direction; barrier: number; stake: number; ratio: number; estWin: number } | undefined;
    let deceptionScore: number | undefined;
    if (st.debt <= 0.005) {
      const eligible = conservative
        ? quotes.filter((quote) => quote.estWin >= Math.max(gates.minWin, config.minExtremeWin))
          .sort((a, b) => b.estWin - a.estWin || b.realEV - a.realEV)
        : quotes.filter((quote) => quote.estWin >= gates.minWin && quote.realEdge >= gates.minEdge)
          .filter((quote) => isSensibleDigitCandidate({
            baseWin: quote.baseWin,
            estWin: quote.estWin,
            edge: quote.realEdge,
            expectedROI: quote.realEV,
          }))
          .sort((a, b) => replayQuoteQuality(b) - replayQuoteQuality(a) || b.realEV - a.realEV || b.estWin - a.estWin);
      const best = entryMode === 'model' ? eligible[0] : eligible.find((quote) => {
        const marketData = markets.find((market) => market.symbol === quote.market);
        const k = currentSamples.get(quote.market)?.k ?? -1;
        return entryMode === 'digit_trigger_confirmed'
          ? matchesConfirmedDigitTrigger(quote.direction, marketData?.digits.slice(Math.max(0, k - 12), k + 1) ?? [])
          : matchesDigitTrigger(quote.direction, marketData?.digits[k]);
      });
      if (best) decision = { ...best, stake: baseStake };
    } else {
      const recoveryMarket = observation?.market ?? event.market;
      const observed = evaluateRecoveryObservation({
        market: recoveryMarket,
        intelligence,
        recovery: { debt: st.debt, streak: st.streak },
        ticksSinceLoss: observation?.observedTicks ?? 0,
        recoveryFailures: observation?.recoveryFailures,
        lastLoss: observation?.lastLoss,
      });
      deceptionScore = observed.deceptionScore;
      if (observed.action === 'observe') continue;
      if (observed.action === 'switch_market' && observed.switchMarket && observation) {
        observation = transitionRecoveryObservation(observation, { type: 'switch_market', market: observed.switchMarket });
      }
      const selectedMarket = observed.action === 'switch_market' ? observed.switchMarket : recoveryMarket;
      const ladderQuotes = quotes.filter((quote) => quote.market === selectedMarket);
      if (ladderQuotes.length === 0) continue;
        const ctx: RecoveryContext = {
          mode: st.mode,
          streak: st.streak,
          debt: st.debt,
          attempts: st.attempts,
          cycleStake: st.cycleStake,
          peakBalance: st.peakBalance,
          baseStake,
          maxStake: 1e9,
          minRecoveryWinRate: settingsLike.min_recovery_win,
          minExtremeWin: config.minExtremeWin,
          martingaleSteps: settingsLike.martingale_steps,
          maxConsecutiveLosses: settingsLike.max_consecutive_losses,
          strategy: cfg.strategyMode,
          multiplier: settingsLike.strategy_multiplier,
          recoveryBuffer: settingsLike.recovery_buffer,
          chaseAmortize: settingsLike.chase_amortize,
          maxRecoveryDebt: settingsLike.max_recovery_debt,
          maxRecoveryExposure: settingsLike.max_recovery_exposure,
          maxDrawdownPct: settingsLike.max_drawdown_pct,
        };
        const ladder: LadderOption[] = ladderQuotes.map((quote) => ({
          direction: quote.direction,
          barrier: quote.barrier,
          estWin: quote.estWin,
          ask: 1,
          payout: quote.ratio,
        }));
        const d = planRecovery(ladder, ctx, ladder[0]);
        if (d.holds || !(d.stake > 0)) continue;
        const ratio = d.payout && d.payout > 1 ? d.payout : 1;
        if (!(ratio > 1)) continue;
        const selected = ladderQuotes.find((quote) => quote.direction === d.direction && quote.barrier === d.barrier);
        if (selected) decision = { ...selected, stake: d.stake, ratio };
    }

    if (!decision) continue;
    const market = intelligence.markets.get(decision.market);
    const drawdownPct = st.peakBalance > 0 ? ((st.peakBalance - st.balance) / st.peakBalance) * 100 : 0;
    const allocation = allocateCapital({
      proposedStake: decision.stake,
      balance: st.balance,
      health: market?.health,
      regime: market?.regime,
      deceptionScore,
      recovery: { streak: st.streak },
      drawdownPct,
    });
    const stake = round2(allocation.stake);
    if (!replayRiskAllowed(st, settingsLike, stake)) continue;
    const marketData = markets.find((candidate) => candidate.symbol === decision.market);
    const decisionSample = currentSamples.get(decision.market);
    const outcomeDigit = marketData && decisionSample ? marketData.digits[decisionSample.k + 1] : undefined;
    if (!marketData || !decisionSample || typeof outcomeDigit !== 'number' || !Number.isInteger(outcomeDigit) || outcomeDigit < 0 || outcomeDigit > 9) continue;
    const settledDigit = outcomeDigit;
    pending = {
      market: decision.market,
      settleEpoch: decisionSample.settleEpoch,
      outcomeDigit: settledDigit,
      direction: decision.direction,
      barrier: decision.barrier,
      stake,
      ratio: decision.ratio,
      epoch: event.epoch,
    };
  }

  if (pending && trades.length < target) settle(pending);

  const metrics = computeMetrics(trades, startBalance);
  return { config: cfg, baseStake, startBalance, trades, metrics, equity };
}

export interface BacktestOptions {
  baseStake?: number;
  target?: number;
  configs?: TestConfig[];
  source?: 'manual' | 'auto';
  onProgress?: (p: BacktestProgress) => void;
}

/**
 * Offline replay of every (strategy x bot_mode) configuration over the stored
 * digit history. Payouts are estimated from the observed quote_stats averages
 * (falls back to theoretical ratios per barrier when no quote has been seen).
 * Scans are precomputed once per market and shared across all configs.
 */
export async function runBacktest(opts: BacktestOptions = {}): Promise<BacktestOutcome> {
  const baseStake = opts.baseStake ?? 1;
  const target = Math.max(1, Math.min(200, opts.target ?? 200));
  const configKeys = opts.configs ?? allConfigs();
  const startBalance = baseStake * 100;

  const settingsLike = {
    min_edge: 0.01,
    min_recovery_win: 0.3,
    martingale_steps: 5,
    max_consecutive_losses: 10,
    strategy_multiplier: 3,
    recovery_buffer: 0.5,
    chase_amortize: 0.35,
    max_recovery_debt: 50,
    max_recovery_exposure: 100,
    max_drawdown_pct: 20,
    pattern_weight: getSettings().pattern_weight,
    pattern_weight_conservative: getSettings().pattern_weight_conservative,
    pattern_weight_martingale: getSettings().pattern_weight_martingale,
    pattern_weight_boosted_martingale: getSettings().pattern_weight_boosted_martingale,
    pattern_weight_chase: getSettings().pattern_weight_chase,
  };
  const weightForStrategy = (strategy: string): number => patternWeightForStrategy(settingsLike, strategy);

  opts.onProgress?.({ phase: 'preparing', configIndex: 0, totalConfigs: configKeys.length, message: 'Loading market history' });
  await sleep(0);

  const ratioStats = getQuoteStats();
  const avgRatio = new Map<string, number>();
  for (const s of ratioStats) {
    const samples = Number(s.samples);
    if (samples > 0) avgRatio.set(`${s.market}|${s.direction}|${s.barrier}`, Number(s.sum_ratio) / samples);
  }
  const ratioFor = (market: string, direction: Direction, barrier: number): number =>
    avgRatio.get(`${market}|${direction}|${barrier}`) ?? estimatePayoutRatio(direction, barrier);

  const marketsByWeight = new Map<number, MarketData[]>();
  const ensureMarkets = (weight: number): MarketData[] => {
    let list = marketsByWeight.get(weight);
    if (list) return list;
    list = [];
    for (const row of listMarkets()) {
      const symbol = String(row.symbol);
      const md = loadMarket(symbol, 20000, 8, 1000, weight);
      if (md) list.push(md);
    }
    marketsByWeight.set(weight, list);
    return list;
  };

  const runs: TestRunRow[] = [];
  const results: BacktestRunResult[] = [];
  for (let i = 0; i < configKeys.length; i++) {
    const cfg = configKeys[i];
    opts.onProgress?.({ phase: 'replaying', configIndex: i, totalConfigs: configKeys.length, message: `${cfg.strategyMode} · ${cfg.botMode}` });
    const result = replayOne(cfg, ensureMarkets(weightForStrategy(cfg.strategyMode)), settingsLike, baseStake, target, startBalance, ratioFor);
    results.push(result);
    const row = insertTestRun({ ...runRow('backtest', cfg.strategyMode, cfg.botMode, cfg.entryMode ?? 'model', baseStake, target, result.metrics, Date.now()), source: opts.source ?? 'manual' });
    runs.push(row);
    await sleep(0); // let ws progress frames flush
  }
  opts.onProgress?.({ phase: 'done', configIndex: configKeys.length, totalConfigs: configKeys.length, message: 'Backtest complete' });
  return { runs, results };
}

export function latestBacktestRuns(baseStake = 0): TestRunRow[] {
  // used by the compare tab: resurface persisted runs for the UI
  return listTestRuns('backtest', 500);
}
