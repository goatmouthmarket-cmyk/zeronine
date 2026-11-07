/**
 * Ranger Auto time-to-take-profit estimator.
 *
 * Plain ES module shared by the pasture page and the Node test suite. It only
 * answers when a genuine sample of completed Ranger runs exists; otherwise it
 * reports `available: false` so the UI can say the estimate is unavailable
 * instead of inventing one.
 *
 * Model (all inputs are observed, none are guessed):
 *   - one "cycle" is a completed trade: signal wait + walk/aim/shot + settle
 *   - cycle durations come from finished runs' measured average trade duration
 *   - the win rate comes from settled wins/losses across those runs
 *   - reaching the cooldown threshold adds the configured cooldown to a cycle
 *   - a run may also stop out on the maximum run loss; those runs never reach
 *     the target and are reported as part of the reach rate
 *
 * The replay is deterministic for a given seed, so tests and UI agree.
 */

/**
 * @typedef {object} RunRecord
 * @property {string} [runId]
 * @property {string} [accountId]
 * @property {string} [accountMode]
 * @property {number} [trades]
 * @property {number} [wins]
 * @property {number} [losses]
 * @property {number} [avgTradeMs]
 * @property {number} [wallMs]
 * @property {boolean} [targetReached]
 * @property {number} [takeProfit]
 * @property {number | null} [timeToTargetMs]
 *
 * @typedef {object} RunEvidence
 * @property {number} runs
 * @property {boolean} enoughRuns
 * @property {number[]} cycles
 * @property {number | null} medianCycleMs
 * @property {number | null} slowCycleMs
 * @property {number} wins
 * @property {number} losses
 * @property {number} settled
 * @property {number | null} winRate
 * @property {boolean} enoughRate
 * @property {number} targetRuns
 * @property {number} reachedRuns
 * @property {number | null} reachRate
 * @property {number | null} medianTimeToTargetMs
 * @property {number | null} lastRunDurationMs
 *
 * @typedef {object} EstimateInput
 * @property {RunEvidence | null} [evidence]
 * @property {number} [target]
 * @property {number | null} [perWinProfit]
 * @property {number | null} [avgLossAmount]
 * @property {number} [lossesToCooldown]
 * @property {number} [cooldownSeconds]
 * @property {number} [maxRunLoss]
 * @property {number} [simulations]
 * @property {number} [seed]
 * @property {number} [minRuns]
 * @property {number} [minTrades]
 */

/** Minimum number of finished runs before a distribution is offered. */
export const MIN_RUNS_FOR_ESTIMATE = 3;
/** Minimum settled trades before the observed win rate is used. */
export const MIN_TRADES_FOR_RATE = 30;
/** Bounded simulation size: this never blocks the trade loop. */
export const MAX_SIMULATIONS = 400;
/** No simulated run may plan more than this many trades. */
export const MAX_TRADES_PER_SIM = 400;

/**
 * Deterministic 32-bit PRNG (mulberry32) so replays are reproducible.
 *
 * @param {number} [seed]
 * @returns {() => number}
 */
export function seededRandom(seed = 1) {
  let state = (Number(seed) >>> 0) || 1;
  return function next() {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function quantile(sorted, fraction) {
  if (!sorted.length) return null;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(fraction * sorted.length) - 1));
  return sorted[index];
}

/**
 * Aggregate completed runs into the evidence the estimator needs.
 * Runs must be finished Ranger Auto runs for the same account and mode; the
 * caller is responsible for that filter (and for keeping demo/real apart).
 *
 * @param {RunRecord[]} [runs]
 * @param {{ minRuns?: number }} [options]
 * @returns {RunEvidence}
 */
export function summarizeRunEvidence(runs, { minRuns = MIN_RUNS_FOR_ESTIMATE } = {}) {
  const list = (Array.isArray(runs) ? runs : []).filter((run) => run && Number(run.trades) > 0);
  const cycles = list
    .map((run) => Number(run.avgTradeMs))
    .filter((ms) => Number.isFinite(ms) && ms > 0)
    .sort((a, b) => a - b);
  const wins = list.reduce((sum, run) => sum + Math.max(0, Number(run.wins) || 0), 0);
  const losses = list.reduce((sum, run) => sum + Math.max(0, Number(run.losses) || 0), 0);
  const settled = wins + losses;
  const reaching = list.filter((run) => run.targetReached === true).length;
  const targetRuns = list.filter((run) => Number(run.takeProfit) > 0);
  const reachDurations = targetRuns
    .filter((run) => run.targetReached === true && Number(run.timeToTargetMs) > 0)
    .map((run) => Number(run.timeToTargetMs))
    .sort((a, b) => a - b);
  return {
    runs: list.length,
    enoughRuns: list.length >= minRuns && cycles.length >= minRuns,
    cycles,
    medianCycleMs: quantile(cycles, 0.5),
    slowCycleMs: quantile(cycles, 0.9),
    wins,
    losses,
    settled,
    winRate: settled > 0 ? wins / settled : null,
    enoughRate: settled >= MIN_TRADES_FOR_RATE,
    targetRuns: targetRuns.length,
    reachedRuns: reaching,
    reachRate: targetRuns.length > 0 ? reaching / targetRuns.length : null,
    medianTimeToTargetMs: quantile(reachDurations, 0.5),
    lastRunDurationMs: list.length ? Number(list[0].wallMs) || null : null,
  };
}

/**
 * Bounded Monte Carlo replay of one run toward its take-profit target.
 *
 * Returns `{ available: false, reason }` when the evidence is too thin. When
 * available it returns a distribution (median / slower case), the simulated
 * reach rate and the explicit assumptions used.
 *
 * @param {EstimateInput} [input]
 * @returns {Record<string, any>}
 */
export function estimateTimeToTarget(input = {}) {
  const { evidence = null, target = 0, perWinProfit = null, avgLossAmount = null, lossesToCooldown = 3, cooldownSeconds = 45, maxRunLoss = 0, simulations = MAX_SIMULATIONS, seed = 20261107, minRuns = MIN_RUNS_FOR_ESTIMATE, minTrades = MIN_TRADES_FOR_RATE } = /** @type {any} */ (input);
  const goal = Number(target);
  const perWin = Number(perWinProfit);
  const loss = Number(avgLossAmount);
  const summary = evidence && typeof evidence === 'object' ? evidence : summarizeRunEvidence([], { minRuns });
  if (!(goal > 0)) {
    return { available: false, reason: 'no_target', message: 'Take profit is disabled, so there is no target time to estimate.' };
  }
  if (!Number.isFinite(perWin) || perWin <= 0) {
    return { available: false, reason: 'no_payout', message: 'Net profit per win is unavailable, so a target time cannot be estimated.' };
  }
  if (!summary.enoughRuns) {
    return {
      available: false,
      reason: 'insufficient_runs',
      message: 'Not enough completed Ranger runs to estimate time reliably.',
      runs: summary.runs,
      minRuns,
    };
  }
  if (!summary.enoughRate) {
    return {
      available: false,
      reason: 'insufficient_trades',
      message: `Not enough settled Ranger trades to estimate time reliably (${summary.settled}/${minTrades}).`,
      settled: summary.settled,
      minTrades,
    };
  }
  const cycles = summary.cycles;
  const winRate = Math.min(0.95, Math.max(0.05, summary.winRate));
  const lossAmount = Number.isFinite(loss) && loss > 0 ? loss : perWin;
  const streakLimit = Math.max(1, Math.floor(Number(lossesToCooldown) || 0));
  const cooldownMs = Math.max(0, Number(cooldownSeconds) || 0) * 1000;
  const runLoss = Number(maxRunLoss) > 0 ? Number(maxRunLoss) : 0;
  const runsToSimulate = Math.max(1, Math.min(MAX_SIMULATIONS, Math.floor(Number(simulations) || MAX_SIMULATIONS)));
  const random = seededRandom(seed);
  const reached = [];
  let stoppedOut = 0;
  let unfinished = 0;
  let cooldownTotal = 0;
  for (let sim = 0; sim < runsToSimulate; sim += 1) {
    let elapsed = 0;
    let profit = 0;
    let streak = 0;
    let done = false;
    for (let trade = 0; trade < MAX_TRADES_PER_SIM; trade += 1) {
      const cycle = cycles[Math.floor(random() * cycles.length)] ?? summary.medianCycleMs;
      elapsed += cycle;
      if (random() < winRate) {
        profit += perWin;
        streak = 0;
      } else {
        profit -= lossAmount;
        streak += 1;
        if (streak >= streakLimit && cooldownMs > 0) {
          elapsed += cooldownMs;
          cooldownTotal += cooldownMs;
          streak = 0;
        }
      }
      if (profit + 1e-9 >= goal) {
        reached.push(elapsed);
        done = true;
        break;
      }
      if (runLoss > 0 && profit <= -runLoss + 1e-9) {
        stoppedOut += 1;
        done = true;
        break;
      }
    }
    if (!done) unfinished += 1;
  }
  reached.sort((a, b) => a - b);
  const reachRate = reached.length / runsToSimulate;
  if (!reached.length) {
    return {
      available: true,
      reason: 'never_reached',
      message: 'No simulated run reached take profit under the observed win rate and configured limits.',
      reachRate: 0,
      simulations: runsToSimulate,
      stoppedOut,
      unfinished,
      runs: summary.runs,
      settled: summary.settled,
      winRate,
      assumptions: timingAssumptions({ summary, winRate, cooldownSeconds, runLoss, streakLimit }),
    };
  }
  return {
    available: true,
    reason: '',
    medianMs: quantile(reached, 0.5),
    slowMs: quantile(reached, 0.9),
    fastMs: quantile(reached, 0.1),
    reachRate,
    simulations: runsToSimulate,
    stoppedOut,
    unfinished,
    meanCooldownMs: cooldownTotal / runsToSimulate,
    runs: summary.runs,
    settled: summary.settled,
    winRate,
    medianCycleMs: summary.medianCycleMs,
    medianTimeToTargetMs: summary.medianTimeToTargetMs,
    lastRunDurationMs: summary.lastRunDurationMs,
    assumptions: timingAssumptions({ summary, winRate, cooldownSeconds, runLoss, streakLimit }),
  };
}

function timingAssumptions({ summary, winRate, cooldownSeconds, runLoss, streakLimit }) {
  return [
    `${summary.runs} completed Ranger runs, ${summary.settled} settled trades.`,
    `Median observed cycle ${Math.round((summary.medianCycleMs ?? 0) / 1000)}s per completed trade.`,
    `Observed win rate ${(winRate * 100).toFixed(1)}% reused as the future rate.`,
    `A ${streakLimit}-loss streak adds ${Math.round(cooldownSeconds)}s of cooldown.`,
    runLoss > 0 ? `Runs stop out at a ${runLoss.toFixed(2)} realized loss.` : 'No maximum run loss; only take profit ends a simulated run.',
    'Past timing is not a promise about future settlement speed or signal availability.',
  ];
}

/**
 * Human-readable duration, e.g. 1h 04m or 3m 20s.
 *
 * @param {number} ms
 * @returns {string}
 */
export function formatDuration(ms) {
  const total = Math.max(0, Math.round(Number(ms) || 0) / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = Math.floor(total % 60);
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, '0')}m`;
  if (minutes > 0) return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
  return `${seconds}s`;
}

/**
 * Clock format for the live HUD timer.
 *
 * @param {number} ms
 * @returns {string}
 */
export function formatClock(ms) {
  const total = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}
