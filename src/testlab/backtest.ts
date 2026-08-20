import type { Direction } from '../core/digitMath.ts';
import { breakevenWinRate, estimatePayoutRatio, winDigits } from '../core/digitMath.ts';
import type { BarrierFeatures } from '../strategy/scanner.ts';
import { featureFor } from '../strategy/scanner.ts';
import type { RecoveryContext } from '../strategy/recovery.ts';
import { planRecovery } from '../strategy/recovery.ts';
import type { LadderOption } from '../strategy/recovery.ts';
import { nextRecovery } from '../strategy/risk.ts';
import { config } from '../config.ts';
import { digitHistory, getQuoteStats, getSettings, insertTestRun, listMarkets, listTestRuns, patternRowsByPrev, patternWeightForStrategy } from '../db/store.ts';
import type { TestRunRow } from '../db/store.ts';
import { computeMetrics, runRow, round2 } from './metrics.ts';
import type { Aggregate } from './metrics.ts';

export const TEST_STRATEGIES = ['conservative', 'martingale', 'boosted_martingale', 'chase'] as const;
export const TEST_MODES = ['rapid', 'balanced', 'strict'] as const;

export interface TestConfig {
  strategyMode: (typeof TEST_STRATEGIES)[number];
  botMode: (typeof TEST_MODES)[number];
}

export function allConfigs(): TestConfig[] {
  const out: TestConfig[] = [];
  for (const strategyMode of TEST_STRATEGIES) {
    for (const botMode of TEST_MODES) out.push({ strategyMode, botMode });
  }
  return out;
}

function allowedBarriers(strategyMode: TestConfig['strategyMode']): Array<{ direction: Direction; barrier: number }> {
  if (strategyMode === 'conservative') {
    return [
      { direction: 'over', barrier: 0 },
      { direction: 'under', barrier: 9 },
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

interface BarrierEst {
  direction: Direction;
  barrier: number;
  estWin: number;
  ratio: number;
}

interface MarketData {
  symbol: string;
  digits: number[];
  sampled: Array<{ k: number; epoch: number; dt: BarrierEst[] }>;
}

function loadMarket(symbol: string, historyLimit: number, stride: number, warmup: number, allowed: Array<{ direction: Direction; barrier: number }>, ratioFor: (m: string, d: Direction, b: number) => number, patternWeight: number): MarketData | null {
  const hist = digitHistory(symbol, historyLimit).filter((h) => h.digit >= 0 && h.digit <= 9);
  if (hist.length < warmup + 300) return null;
  const digits = hist.map((h) => h.digit);
  const epochs = hist.map((h) => h.epoch);
  const patternMap = patternWeight > 0 ? patternRowsByPrev(symbol) : null;
  const sampled: MarketData['sampled'] = [];

  for (let k = warmup; k + 1 < digits.length; k += stride) {
    const buf = digits.slice(Math.max(0, k - 999), k + 1);
    const prevDigit = buf.length ? Math.trunc(buf[buf.length - 1]) : -1;
    const learned = patternMap && prevDigit >= 0 && prevDigit <= 9 ? patternMap.get(prevDigit) ?? null : null;
    const dt: BarrierEst[] = [];
    for (const a of allowed) {
      const f: BarrierFeatures = featureFor(buf, a.direction, a.barrier, learned != null ? { row: learned, weight: patternWeight } : null);
      dt.push({
        direction: a.direction,
        barrier: a.barrier,
        estWin: f.estimatedWin,
        ratio: ratioFor(symbol, a.direction, a.barrier),
      });
    }
    sampled.push({ k, epoch: epochs[k + 1], dt });
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
): BacktestRunResult {
  const gates = modeGates(cfg.botMode, settingsLike.min_edge);
  const allowed = allowedBarriers(cfg.strategyMode);
  const allowedKey = (d: Direction, b: number): string => `${d}|${b}`;
  const allowedSet = new Set(allowed.map((a) => allowedKey(a.direction, a.barrier)));
  const dtAllowed = (c: BarrierEst): boolean => allowedSet.has(allowedKey(c.direction, c.barrier));
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

  for (const m of markets) {
    if (trades.length >= target) break;
    for (const s of m.sampled) {
      if (trades.length >= target) break;
      const outcomeDigit = m.digits[s.k + 1];
      if (!Number.isInteger(outcomeDigit) || outcomeDigit < 0 || outcomeDigit > 9) continue;

      let decision: { direction: Direction; barrier: number; stake: number; ratio: number } | null = null;

      if (st.debt <= 0.005) {
        let best: { direction: Direction; barrier: number; stake: number; ratio: number; score: number } | null = null;
        for (const c of s.dt) {
          if (!dtAllowed(c)) continue;
          const edge = c.estWin - breakevenWinRate(1, c.ratio);
          if (c.estWin < gates.minWin) continue;
          if (edge < gates.minEdge || !(c.ratio > 1)) continue;
          if (!best || edge > best.score) {
            best = { direction: c.direction, barrier: c.barrier, stake: baseStake, ratio: c.ratio, score: edge };
          }
        }
        if (best) decision = best;
      } else {
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
        const ladder: LadderOption[] = s.dt.filter(dtAllowed).map((c) => ({
          direction: c.direction,
          barrier: c.barrier,
          estWin: c.estWin,
          ask: 1,
          payout: c.ratio,
        }));
        if (ladder.length === 0) continue;
        const d = planRecovery(ladder, ctx, ladder[0]);
        if (d.holds || !(d.stake > 0)) continue;
        const ratio = d.payout && d.payout > 1 ? d.payout : 1;
        if (!(ratio > 1)) continue;
        decision = { direction: d.direction, barrier: d.barrier, stake: round2(d.stake), ratio };
      }

      if (!decision) continue;
      const stake = round2(decision.stake);
      if (!(stake > 0) || !(decision.ratio > 1)) continue;
      const won = winDigits(decision.direction, decision.barrier).includes(outcomeDigit);
      const profit = won ? round2(stake * (decision.ratio - 1)) : -round2(stake);
      const balance = round2(st.balance + profit);
      st = { ...nextRecovery(st, won, profit, balance), balance };
      trades.push({
        market: m.symbol,
        epoch: s.epoch,
        direction: decision.direction,
        barrier: decision.barrier,
        stake,
        ratio: decision.ratio,
        won,
        profit,
      });
      equity.push(st.balance);
    }
  }

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
      const md = loadMarket(symbol, 20000, 8, 1000, BARR_KEYS, ratioFor, weight);
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
    const result = replayOne(cfg, ensureMarkets(weightForStrategy(cfg.strategyMode)), settingsLike, baseStake, target, startBalance);
    results.push(result);
    const row = insertTestRun({ ...runRow('backtest', cfg.strategyMode, cfg.botMode, baseStake, target, result.metrics, Date.now()), source: opts.source ?? 'manual' });
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