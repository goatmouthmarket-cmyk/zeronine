import type { Hub } from '../api/hub.ts';
import { getSettings, getSession, insertTestRun, maxTradeId, tradesAfterId, updateSettings } from '../db/store.ts';
import type { TestRunRow } from '../db/store.ts';
import { computeMetrics, runRow } from './metrics.ts';
import { allConfigs } from './backtest.ts';
import type { TestConfig } from './backtest.ts';

export interface PaperAutomation {
  isRunning(): boolean;
  start(opts: { maxTrades?: number }): void;
  stop(reason?: string): void;
  state(): Record<string, unknown>;
}

export interface PaperSweepProgress {
  kind: 'paper';
  phase: 'running' | 'done' | 'failed';
  configIndex: number;
  totalConfigs: number;
  config: TestConfig;
  tradesDone: number;
  tradesTarget: number;
  message: string;
}

export interface PaperSweepOptions {
  configs?: TestConfig[];
  tradesPerConfig?: number;
  timeoutMs?: number;
  source?: 'manual' | 'auto';
  onProgress?: (p: PaperSweepProgress) => void;
}

export interface PaperSweepResult {
  runs: TestRunRow[];
  completed: number;
  failed: number;
}

const DEFAULT_TRADES_PER_CONFIG = 40;
const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000;

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function waitForStop(automation: PaperAutomation, timeoutMs: number, onTick: () => void): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (automation.isRunning() && Date.now() < deadline) {
    onTick();
    await sleep(1500);
  }
  if (automation.isRunning()) throw new Error('timed out waiting for the sweep run to finish');
}

function emit(hub: Hub, p: PaperSweepProgress): void {
  hub.emit({ type: 'testlab', ts: Date.now(), ...p });
}

/**
 * Sequentially run every config x mode combination on the demo account.
 * Each config: snapshot settings -> apply strategy/mode -> start a bounded
 * automation run -> wait for its natural stop -> score only the trades created
 * after the snapshot -> persist kind='paper' -> restore settings.
 *
 * Demo-only: rejects a real-account session and a bot that is already running.

 */
export async function runPaperSweep(
  automation: PaperAutomation,
  hub: Hub,
  opts: PaperSweepOptions = {},
): Promise<PaperSweepResult> {
  const session = getSession();
  if (!session) throw Object.assign(new Error('no session connected — log in on a demo account first'), { code: 'NO_SESSION' });
  if (session.mode !== 'demo') throw Object.assign(new Error('paper sweeps are demo-only — refusing to trade a real account'), { code: 'REAL_MODE' });
  if (automation.isRunning()) throw Object.assign(new Error('the bot is already running — stop it before sweeping'), { code: 'BOT_RUNNING' });

  const configs = opts.configs ?? allConfigs();
  const tradesTarget = Math.max(1, Math.min(200, Math.floor(opts.tradesPerConfig ?? DEFAULT_TRADES_PER_CONFIG)));
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const baseStake = getSettings().base_stake;
  const startBalance = session.balance ?? 0;

  const runs: TestRunRow[] = [];
  let completed = 0;
  let failed = 0;

  for (let i = 0; i < configs.length; i++) {
    const cfg = configs[i];
    const snapshot = getSettings();
    if (automation.isRunning()) {
      failed += 1;
      emit(hub, {
        kind: 'paper', phase: 'failed', configIndex: i, totalConfigs: configs.length, config: cfg,
        tradesDone: 0, tradesTarget, message: 'bot started during sweep — aborting',
      });
      break;
    }

    updateSettings({ strategy_mode: cfg.strategyMode, bot_mode: cfg.botMode });
    const boundary = maxTradeId();
    const startedAt = Date.now();

    const progress = (tradesDone: number, message: string, phase: PaperSweepProgress['phase'] = 'running') =>
      emit(hub, {
        kind: 'paper', phase, configIndex: i, totalConfigs: configs.length, config: cfg,
        tradesDone, tradesTarget, message,
      });

    const tick = () =>
      progress(Number(automation.state().runTrades ?? 0), `${cfg.strategyMode} · ${cfg.botMode} · ${i + 1}/${configs.length}`, 'running');

    try {
      automation.start({ maxTrades: tradesTarget });
      tick();
      await waitForStop(automation, timeoutMs, tick);

      const trades = tradesAfterId(boundary).filter((t) => t.status === 'won' || t.status === 'lost');
      const metrics = computeMetrics(trades, startBalance);
      const row = insertTestRun({ ...runRow('paper', cfg.strategyMode, cfg.botMode, baseStake, tradesTarget, metrics, startedAt), source: opts.source ?? 'manual' });
      runs.push(row);
      completed += 1;
      progress(trades.length, `completed ${trades.length} trades for ${cfg.strategyMode} · ${cfg.botMode}`, 'done');
    } catch (err) {
      failed += 1;
      progress(0, `failed: ${err instanceof Error ? err.message : String(err)}`, 'failed');
    } finally {
      automation.stop('sweep: next config');
      updateSettings({ strategy_mode: snapshot.strategy_mode, bot_mode: snapshot.bot_mode });
    }
  }

  return { runs, completed, failed };
}