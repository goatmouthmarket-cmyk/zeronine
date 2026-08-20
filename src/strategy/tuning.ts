import { config } from '../config.ts';
import { getSession, getMeta, getSettings, latestTestRun, setMeta, updateSettings } from '../db/store.ts';
import type { SettingsRow, TestRunRow } from '../db/store.ts';
import { TEST_MODES, TEST_STRATEGIES } from '../testlab/backtest.ts';
import type { TestConfig } from '../testlab/backtest.ts';
import { round2 } from '../testlab/metrics.ts';

export interface UsedRun {
  strategy: string;
  mode: string;
  trades: number;
  edge: number;
  netPnl: number;
  at: number;
}

export interface TuningVerdict {
  strategyMode: string;
  botMode: string;
  minEdge: number;
  baseStake: number;
  usedBacktest: UsedRun | null;
  usedPaper: UsedRun | null;
  reason: string;
  at: number;
  changed: boolean;
  applied: boolean;
}

export interface TuningCandidate {
  strategy: TestConfig['strategyMode'];
  mode: TestConfig['botMode'];
  bt: TestRunRow | null;
  paper: TestRunRow | null;
}

const STAKES: Array<[number, number]> = [
  [0.03, 1.3],
  [0.015, 1.2],
  [0.006, 1.1],
  [0.002, 1.0],
];

/** Average ROI per staked dollar across a settled run — the realized edge. */
export function realizedEdge(r: Pick<TestRunRow, 'trades' | 'net_pnl' | 'avg_stake'> | null): number {
  if (!r || !r.trades || !(r.trades > 0)) return 0;
  if (r.avg_stake == null || !(r.avg_stake > 0)) return 0;
  return r.net_pnl / (r.avg_stake * r.trades);
}

function usedRun(r: TestRunRow | null): UsedRun | null {
  if (!r) return null;
  return {
    strategy: r.strategy_mode,
    mode: r.bot_mode,
    trades: r.trades,
    edge: round2(realizedEdge(r)),
    netPnl: r.net_pnl,
    at: r.finished_at,
  };
}

/**
 * The config that independently tops BOTH the backtest column and the paper
 * column with a positive realized edge. Every candidate must be fresh and large
 * enough to count. Returns null when backtest and paper disagree, tie, or offer
 * nothing positive — the bot stays put until the data is unambiguous.
 */
export function bestAgreeing(cands: TuningCandidate[], minTrades: number, freshnessMs: number): TuningCandidate | null {
  const now = Date.now();
  const valid = cands.filter(
    (c) =>
      c.bt != null &&
      c.paper != null &&
      c.bt.trades >= minTrades &&
      c.paper.trades >= minTrades &&
      now - c.bt.finished_at <= freshnessMs &&
      now - c.paper.finished_at <= freshnessMs,
  );
  const top = (f: (c: TuningCandidate) => number): TuningCandidate | null => {
    let best: TuningCandidate | null = null;
    let topVal = -Infinity;
    for (const c of valid) {
      const v = f(c);
      if (!(v > 0)) continue; // a champion must prove a positive realized edge
      if (v > topVal + 1e-9) {
        topVal = v;
        best = c;
      } else if (Math.abs(v - topVal) <= 1e-9) {
        best = null; // tie for the lead -> ambiguous, don't act on a coin flip
      }
    }
    return best;
  };
  const byBt = top((c) => realizedEdge(c.bt));
  const byPaper = top((c) => realizedEdge(c.paper));
  if (!byBt || !byPaper || byBt.strategy !== byPaper.strategy || byBt.mode !== byPaper.mode) return null;
  return byBt;
}

function stakeStep(edge: number): number {
  for (const [threshold, mult] of STAKES) if (edge >= threshold) return mult;
  return 0.8;
}

/**
 * Turn a champion's realized edge into tightened gates: min_edge converges up to
 * half the proven edge (never below the current floor, capped at 5%) and
 * base_stake scales by edge tier, clamped to max_stake and a balance cap.
 */
export function adjust(settings: Pick<SettingsRow, 'min_edge' | 'base_stake' | 'max_stake'>, edge: number, balance: number): { minEdge: number; baseStake: number } {
  const minEdge = Math.max(settings.min_edge, Math.min(0.05, round2(edge * 0.5)));
  const mult = stakeStep(edge);
  const cap = Math.min(settings.max_stake > 0 ? settings.max_stake : Infinity, balance > 0 ? balance * 0.02 : Infinity);
  const baseStake = Math.max(0.1, Math.min(cap, round2(Math.round(settings.base_stake * mult * 10) / 10)));
  return { minEdge, baseStake };
}

export function readTuningVerdict(): TuningVerdict | null {
  const raw = getMeta('tuning_verdict');
  if (!raw) return null;
  try {
    return JSON.parse(raw) as TuningVerdict;
  } catch {
    return null;
  }
}

/**
 * Evaluate every (strategy x mode) against its latest backtest AND paper runs,
 * auto-switching the live config, tightening min_edge, and rescaling base_stake
 * when the two methods independently crown the same positive champion. When
 * apply=false the verdict is computed and recorded but not written to settings,
 * so a live run is never yanked mid-trade.
 */
export function tuneSettings(opts?: { minTrades?: number; freshnessMs?: number; apply?: boolean }): TuningVerdict | null {
  if (!config.autoTuneEnabled) return readTuningVerdict();
  const minTrades = opts?.minTrades ?? config.autoTuneMinTrades;
  const freshnessMs = opts?.freshnessMs ?? config.autoTuneFreshnessMs;
  const apply = opts?.apply ?? true;
  const settings = getSettings();
  const now = Date.now();

  const cands: TuningCandidate[] = [];
  for (const strategy of TEST_STRATEGIES) {
    for (const mode of TEST_MODES) {
      cands.push({
        strategy,
        mode,
        bt: latestTestRun('backtest', strategy, mode),
        paper: latestTestRun('paper', strategy, mode),
      });
    }
  }
  const anyFresh = cands.some((c) => (c.bt && now - c.bt.finished_at <= freshnessMs) || (c.paper && now - c.paper.finished_at <= freshnessMs));
  if (!anyFresh) return verdictOf(settings.strategy_mode, settings.bot_mode, settings, null, null, 'no fresh backtest + paper data yet', now, false, false);

  const champ = bestAgreeing(cands, minTrades, freshnessMs);
  if (!champ) return verdictOf(settings.strategy_mode, settings.bot_mode, settings, null, null, 'backtest and paper do not agree on a positive champion — holding config', now, false, false);

  const edge = Math.min(realizedEdge(champ.bt), realizedEdge(champ.paper));
  const { minEdge, baseStake } = adjust(settings, edge, getSession()?.balance ?? 0);

  const incumbent: TuningCandidate = {
    strategy: settings.strategy_mode as TestConfig['strategyMode'],
    mode: settings.bot_mode as TestConfig['botMode'],
    bt: latestTestRun('backtest', settings.strategy_mode, settings.bot_mode),
    paper: latestTestRun('paper', settings.strategy_mode, settings.bot_mode),
  };
  let strategyMode: string = champ.strategy;
  let botMode: string = champ.mode;
  let reason = `champion ${champ.strategy} · ${champ.mode} (edge ${round2(edge * 100)}%)`;
  if (strategyMode === settings.strategy_mode && botMode === settings.bot_mode) {
    reason = `holding ${strategyMode} · ${botMode}, tightening to its proven edge (${round2(edge * 100)}%)`;
  } else {
    const incEdge = Math.min(realizedEdge(incumbent.bt), realizedEdge(incumbent.paper));
    if (incEdge > 0 && incEdge + 0.001 >= edge) {
      strategyMode = settings.strategy_mode;
      botMode = settings.bot_mode;
      reason = `champion ${champ.strategy} · ${champ.mode} is not materially better than incumbent ${settings.strategy_mode} · ${settings.bot_mode} — holding`;
    } else {
      reason = `switching to champion ${champ.strategy} · ${champ.mode} (backtest + paper agree, edge ${round2(edge * 100)}%)`;
    }
  }

  const changed =
    strategyMode !== settings.strategy_mode ||
    botMode !== settings.bot_mode ||
    Math.abs(minEdge - settings.min_edge) > 1e-6 ||
    Math.abs(baseStake - settings.base_stake) > 1e-6;

  const applied = changed && apply && (strategyMode !== settings.strategy_mode || botMode !== settings.bot_mode || Math.abs(minEdge - settings.min_edge) > 1e-6 || Math.abs(baseStake - settings.base_stake) > 1e-6);
  let finalReason = reason;
  let finalApplied = false;
  if (changed) {
    if (apply) {
      updateSettings({ strategy_mode: strategyMode, bot_mode: botMode, min_edge: minEdge, base_stake: baseStake });
      finalApplied = true;
      finalReason = `${reason} -> min edge ${round2(minEdge * 100)}%, stake $${round1(baseStake)}`;
    } else {
      finalReason = `${reason} (computed; bot is running so settings were not touched)`;
    }
  } else {
    finalReason = `${reason} — no change needed`;
  }

  const verdict = verdictOf(
    strategyMode,
    botMode,
    { min_edge: minEdge, base_stake: baseStake, max_stake: settings.max_stake },
    champ.bt,
    champ.paper,
    finalReason,
    now,
    changed,
    finalApplied,
  );
  setMeta('tuning_verdict', JSON.stringify(verdict));
  return verdict;
}

function verdictOf(
  strategyMode: string,
  botMode: string,
  s: Pick<SettingsRow, 'min_edge' | 'base_stake' | 'max_stake'>,
  bt: TestRunRow | null,
  paper: TestRunRow | null,
  reason: string,
  at: number,
  changed: boolean,
  applied: boolean,
): TuningVerdict {
  return {
    strategyMode,
    botMode,
    minEdge: s.min_edge,
    baseStake: s.base_stake,
    usedBacktest: usedRun(bt),
    usedPaper: usedRun(paper),
    reason,
    at,
    changed,
    applied,
  };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}