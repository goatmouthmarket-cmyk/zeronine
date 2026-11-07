/**
 * Ranger Auto risk engine.
 *
 * This module is the single source of truth for the pre-start Risk & Reward
 * preview, the consecutive-loss breakdown and the take-profit projection. It is
 * a plain ES module so the static pasture page (`web/public/trading-room.html`)
 * can load it without a build step, and Node tests can import it directly.
 *
 * It deliberately mirrors the pasture's own wager sizing (`plannedCowStake`) so
 * the preview never promises a stake the live code would not place, and it
 * takes the stricter backend caps as inputs instead of re-deriving them.
 */

export const RANGER_RISK_STYLES = ['base', 'martingale', 'boosted', 'chase'];

/**
 * @typedef {object} StakeInput
 * @property {number} [baseStake]
 * @property {string} [style]
 * @property {number} [debt]
 * @property {number | null} [payout]
 * @property {number | null} [estimatePayout] Theoretical estimate (e.g. estPayout); never treated as a live broker quote.
 * @property {boolean} [payoutAuthoritative] True only for a verified live broker quote.
 * @property {number | null} [winChance]
 * @property {number} [balance]
 * @property {number} [serverMaxStake]
 * @property {number} [ratio]
 * @property {number} [chaseAmortize]
 * @property {number} [recoveryBuffer]
 *
 * @typedef {object} LadderInput
 * @property {number} [baseStake]
 * @property {string} [style]
 * @property {number} [losses]
 * @property {number | null} [payout]
 * @property {number | null} [estimatePayout]
 * @property {boolean} [payoutAuthoritative]
 * @property {number | null} [winChance]
 * @property {number} [balance]
 * @property {number} [startDebt]
 * @property {number} [maxRunLoss]
 * @property {number} [serverMaxStake]
 * @property {number} [ratio]
 *
 * @typedef {object} LadderStep
 * @property {number} lossNumber
 * @property {number | null} stake
 * @property {number | null} [payout]
 * @property {number | null} [estimatePayout]
 * @property {number} [net]
 * @property {string} [netSource]
 * @property {boolean} [authoritative]
 * @property {boolean} [illustrative]
 * @property {number} cumulativeLoss
 * @property {number} remainingBalance
 * @property {number} [recoveryTarget]
 * @property {boolean} [coversTarget]
 * @property {number} [coverageShortfall]
 * @property {number | null} [clearingStake]
 * @property {number | null} projectedNextStake
 * @property {string} [nextBlockedReason]
 * @property {string} status
 * @property {string} reason
 * @property {number | null} [requiredStake]
 *
 * @typedef {object} Ladder
 * @property {string} style
 * @property {number} requestedLosses
 * @property {LadderStep[]} steps
 * @property {number} exposure
 * @property {number | null} blockedAt
 * @property {boolean} payoutBlocked
 * @property {boolean} [usesEstimate]
 * @property {boolean} [hasVerifiedPayout]
 * @property {boolean} [illustrative]
 * @property {number | null} runLossStopAt
 * @property {number} endDebt
 * @property {number | null} winsToRecover
 * @property {boolean} complete
 *
 * @typedef {object} PreviewInput
 * @property {number} [baseStake]
 * @property {string} [style]
 * @property {string | null} [accountMode]
 * @property {string | null} [accountId]
 * @property {number} [balance]
 * @property {string} [currency]
 * @property {number} [lossesToCooldown]
 * @property {number} [cooldownSeconds]
 * @property {number} [takeProfit]
 * @property {number} [maxRunLoss]
 * @property {number} [startDebt]
 * @property {number | null} [payout]
 * @property {number | null} [estimatePayout]
 * @property {boolean} [payoutAuthoritative]
 * @property {number | null} [winChance]
 * @property {number} [serverMaxStake]
 * @property {number} [runProfit]
 * @property {number} [ratio]
 * @property {number} [maxRunLoss]
 * @property {number} [startDebt]
 * @property {number | null} [payout]
 * @property {number | null} [winChance]
 * @property {number} [serverMaxStake]
 * @property {number} [runProfit]
 * @property {number} [ratio]
 */

/** Pasture balance safeguard: a wager may never exceed 90% of the balance. */
export const BALANCE_LIMIT_RATIO = 0.9;

/** Rounding used by the pasture when it converts a target stake to cents. */
/** @param {number} value @returns {number} */
export function roundStake(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return 0;
  return Math.round((number + Number.EPSILON) * 100) / 100;
}

function positive(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

/**
 * Outstanding debt a recovery wager must repay, matching src/strategy/recovery.ts
 * profileTarget() and the pasture's `plannedCowStake()`:
 *   base        -> flat stake, nothing chased
 *   martingale  -> repay the whole tracked debt in one win
 *   boosted     -> debt plus half a base stake of profit buffer
 *   chase       -> repay ~35% of the debt per favourable win, floored at half a base stake
 * @param {StakeInput} [input]
 * @returns {number}
 */
export function recoveryTarget(input = {}) {
  const { style = 'base', debt = 0, baseStake = 0, chaseAmortize = 0.35, recoveryBuffer = 0.5 } = input;
  const tracked = positive(debt);
  const base = positive(baseStake);
  if (!RANGER_RISK_STYLES.includes(style) || style === 'base') return 0;
  if (tracked <= 0.005) return 0;
  if (style === 'boosted') return tracked + base * recoveryBuffer;
  if (style === 'chase') return Math.min(tracked, Math.max(base * 0.5, tracked * chaseAmortize));
  return tracked;
}

/**
 * Net return per unit of stake. An authoritative live/broker payout wins.
 * A theoretical estimate payout (e.g. estPayout from signal candidates) is
 * usable for illustrative pre-start modeling but is never a live quote.
 * Without payout data the pasture falls back to the theoretical digit win
 * chance, which is also a model, not a quote. `source` lets the UI label the
 * number honestly.
 * @param {StakeInput & { estimatePayout?: number | null, payoutAuthoritative?: boolean }} [input]
 * @returns {{ net: number, source: 'payout' | 'estimate' | 'model' | 'unavailable', authoritative: boolean }}
 */
export function netReturnPerUnit(input = {}) {
  const { payout = null, estimatePayout = null, winChance = null, payoutAuthoritative } = input;
  const quoted = Number(payout);
  const explicitAuthoritative = payoutAuthoritative === true;
  const explicitEstimate = payoutAuthoritative === false;
  if (Number.isFinite(quoted) && quoted > 1 && !explicitEstimate) {
    return { net: quoted - 1, source: explicitAuthoritative ? 'payout' : 'payout', authoritative: explicitAuthoritative || payoutAuthoritative !== false };
  }
  const estimate = Number(estimatePayout);
  if (Number.isFinite(estimate) && estimate > 1) return { net: estimate - 1, source: 'estimate', authoritative: false };
  if (explicitEstimate && Number.isFinite(quoted) && quoted > 1) return { net: quoted - 1, source: 'estimate', authoritative: false };
  const chance = Number(winChance);
  if (Number.isFinite(chance) && chance > 0 && chance < 1) {
    const net = Math.max(0.05, 0.95 / Math.max(0.05, chance) - 1);
    return { net, source: 'model', authoritative: false };
  }
  return { net: 0, source: 'unavailable', authoritative: false };
}

/** The pasture's 90% balance cap, in cents. */
export function balanceCap(balance, ratio = BALANCE_LIMIT_RATIO) {
  const amount = Number(balance);
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  return Math.floor(amount * ratio * 100) / 100;
}

/**
 * Plan one wager exactly as the pasture would. Any limit that blocks execution
 * is reported instead of silently shrinking the projection.
 *
 * @param {StakeInput & { estimatePayout?: number | null, payoutAuthoritative?: boolean }} [input]
 * @returns {Record<string, any>}
 */
export function planStake(input = {}) {
  /** @type {Required<Pick<StakeInput, 'baseStake' | 'style' | 'debt' | 'payout' | 'winChance' | 'balance' | 'serverMaxStake' | 'ratio'>> & { estimatePayout?: number | null, payoutAuthoritative?: boolean }} */
  const { baseStake = 0, style = 'base', debt = 0, payout = null, estimatePayout = null, payoutAuthoritative, winChance = null, balance = 0, serverMaxStake = 0, ratio = BALANCE_LIMIT_RATIO } = /** @type {any} */ (input);
  const base = Number(baseStake);
  if (!Number.isFinite(base) || base <= 0) {
    return { stake: 0, blocked: true, reason: 'Enter a stake greater than zero.', cap: 0, recoveryTarget: 0, net: 0, netSource: 'unavailable', authoritative: false };
  }
  const cap = balanceCap(balance, ratio);
  if (!(cap > 0)) {
    return { stake: 0, blocked: true, reason: 'Account balance is unavailable; no wager is executable.', cap: 0, recoveryTarget: recoveryTarget({ style, debt, baseStake: base }), net: 0, netSource: 'unavailable', authoritative: false };
  }
  const target = recoveryTarget({ style, debt, baseStake: base });
  const netInfo = netReturnPerUnit({ payout, estimatePayout, payoutAuthoritative, winChance });
  const { net, source, authoritative } = netInfo;
  if (target > 0 && !(net > 0)) {
    return {
      stake: 0,
      blocked: true,
      reason: 'Payout data is unavailable, so the recovery stake cannot be sized safely.',
      cap,
      recoveryTarget: target,
      net: 0,
      netSource: source,
      payoutDependent: true,
      authoritative: false,
      illustrative: false,
    };
  }
  const wanted = target > 0 ? Math.max(base, target / net) : base;
  const stake = roundStake(wanted);
  const limit = serverMaxStake > 0 ? Math.min(cap, positive(serverMaxStake)) : cap;
  if (stake > limit + 0.001) {
    return {
      stake: 0,
      blocked: true,
      reason: `Required ${style} stake of ${stake.toFixed(2)} is above the executable limit of ${limit.toFixed(2)}.`,
      cap,
      limit,
      recoveryTarget: target,
      net,
      netSource: source,
      requiredStake: stake,
      authoritative: Boolean(authoritative),
      illustrative: !authoritative && (source === 'estimate' || source === 'model'),
    };
  }
  // A win only clears the target if the rounded stake's net return covers it.
  // The pasture rounds to the nearest cent, so the executed stake can be a
  // cent short of the exact recovery amount; report that instead of pretending
  // a win clears the debt.
  const projectedNet = stake * net;
  const clearingStake = target > 0 ? Math.ceil((target / net) * 100 - 1e-9) / 100 : null;
  const illustrative = !authoritative && (source === 'estimate' || source === 'model');
  return {
    stake,
    blocked: false,
    reason: illustrative ? 'Illustrative scenario based on a theoretical payout estimate. Actual execution uses the live broker quote and enforces all risk checks.' : '',
    cap,
    limit,
    recoveryTarget: target,
    net,
    netSource: source,
    authoritative: Boolean(authoritative),
    illustrative,
    requiredStake: stake,
    clearingStake,
    coversTarget: target <= 0 ? true : projectedNet + 1e-9 >= target,
    coverageShortfall: target <= 0 ? 0 : Math.max(0, target - projectedNet),
  };
}

/**
 * Loss ladder for N consecutive losses under one recovery style.
 *
 * Each step is a losing wager: the stake is charged against the balance, added
 * to the tracked debt (the pasture's session recovery model), and the next step
 * re-sizes from that grown debt. A step that breaches a risk gate is marked
 * blocked and ends the executable ladder.
 *
 * `maxRunLoss` is a stop applied *after* a verified settlement, so the step that
 * reaches the boundary is still executed; the next entry is what gets blocked.
 *
 * @param {LadderInput & { estimatePayout?: number | null, payoutAuthoritative?: boolean }} [input]
 * @returns {Ladder}
 */
export function buildLossLadder(input = {}) {
  const { baseStake = 0, style = 'base', losses = 3, payout = null, estimatePayout = null, payoutAuthoritative, winChance = null, balance = 0, startDebt = 0, maxRunLoss = 0, serverMaxStake = 0, ratio = BALANCE_LIMIT_RATIO } = /** @type {any} */ (input);
  const count = Math.max(1, Math.min(20, Math.floor(Number(losses) || 3)));
  const steps = [];
  let debt = positive(startDebt);
  let remaining = Number(balance);
  let cumulative = 0;
  let blockedAt = null;
  let runLossStopAt = null;
  let payoutBlocked = false;
  let anyAuthoritative = false;
  let anyEstimate = false;
  for (let index = 1; index <= count; index += 1) {
    const plan = planStake({ baseStake, style, debt, payout, estimatePayout, payoutAuthoritative, winChance, balance: remaining, serverMaxStake, ratio });
    if (plan.blocked) {
      if (plan.payoutDependent) payoutBlocked = true;
      steps.push({
        lossNumber: index,
        stake: null,
        cumulativeLoss: cumulative,
        remainingBalance: remaining,
        status: 'blocked',
        reason: plan.reason,
        projectedNextStake: null,
        requiredStake: plan.requiredStake ?? null,
        netSource: plan.netSource || 'unavailable',
        illustrative: false,
      });
      blockedAt = index;
      break;
    }
    if (plan.authoritative) anyAuthoritative = true;
    if (plan.netSource === 'estimate' || plan.netSource === 'model') anyEstimate = true;
    const stake = plan.stake;
    // Money is tracked in cents so the ladder never displays float dust.
    cumulative = roundStake(cumulative + stake);
    remaining = roundStake(remaining - stake);
    debt = roundStake(debt + stake);
    const next = planStake({ baseStake, style, debt, payout, estimatePayout, payoutAuthoritative, winChance, balance: remaining, serverMaxStake, ratio });
    const displayedPayout = plan.netSource === 'payout' && plan.authoritative ? Number(payout) : null;
    const step = {
      lossNumber: index,
      stake,
      payout: displayedPayout,
      estimatePayout: plan.netSource === 'estimate' ? Number(estimatePayout ?? payout) : null,
      net: plan.net,
      netSource: plan.netSource,
      authoritative: Boolean(plan.authoritative),
      illustrative: Boolean(plan.illustrative),
      cumulativeLoss: cumulative,
      remainingBalance: remaining,
      recoveryTarget: plan.recoveryTarget,
      coversTarget: plan.coversTarget,
      coverageShortfall: plan.coverageShortfall,
      clearingStake: plan.clearingStake ?? null,
      projectedNextStake: next.blocked ? null : next.stake,
      nextBlockedReason: next.blocked ? next.reason : '',
      status: 'executable',
      reason: plan.reason || '',
    };
    steps.push(step);
    if (maxRunLoss > 0 && cumulative + 1e-9 >= maxRunLoss && runLossStopAt === null) runLossStopAt = index;
  }
  const last = steps[steps.length - 1];
  const exposure = last ? (last.status === 'blocked' ? last.cumulativeLoss : last.cumulativeLoss) : 0;
  const winsToRecover = (() => {
    if (!last || last.status === 'blocked') return null;
    const net = last.net;
    if (!(net > 0)) return null;
    const stake = last.projectedNextStake ?? last.stake;
    const perWin = stake * net;
    if (!(perWin > 0)) return null;
    return Math.max(1, Math.ceil(debt / perWin - 1e-9));
  })();
  return {
    style,
    requestedLosses: count,
    steps,
    exposure,
    blockedAt,
    payoutBlocked,
    usesEstimate: anyEstimate && !anyAuthoritative,
    hasVerifiedPayout: anyAuthoritative,
    illustrative: anyEstimate && !anyAuthoritative,
    runLossStopAt,
    endDebt: debt,
    winsToRecover,
    complete: blockedAt === null && steps.length === count,
  };
}

/**
 * Take-profit projection. Wins are counted from NET profit, never from payout,
 * and the count is labelled an all-wins scenario by the UI.
 *
 * @param {{ target?: number, runProfit?: number, perWinProfit?: number | null }} [input]
 * @returns {{ enabled: boolean, target: number, runProfit: number, remaining: number | null, winsNeeded: number | null, progressPct: number, deficit: number, perWinProfit: number | null | undefined }}
 */
export function projectTakeProfit(input = {}) {
  const { target = 0, runProfit = 0, perWinProfit = null } = /** @type {any} */ (input);
  const goal = Number(target);
  const profit = Number.isFinite(Number(runProfit)) ? Number(runProfit) : 0;
  if (!Number.isFinite(goal) || goal <= 0) {
    return { enabled: false, target: 0, runProfit: profit, remaining: null, winsNeeded: null, progressPct: 0, deficit: profit < 0 ? Math.abs(profit) : 0, perWinProfit };
  }
  const remaining = Math.max(0, goal - profit);
  const perWin = Number(perWinProfit);
  const winsNeeded = perWin > 0 && remaining > 0 ? Math.max(1, Math.ceil(remaining / perWin - 1e-9)) : remaining > 0 ? null : 0;
  return {
    enabled: true,
    target: goal,
    runProfit: profit,
    remaining,
    winsNeeded,
    progressPct: Math.max(0, Math.min(100, (profit / goal) * 100)),
    deficit: profit < 0 ? Math.abs(profit) : 0,
    perWinProfit: perWin > 0 ? perWin : null,
  };
}

/**
 * Expected trades to reach the target under an observed win model. Only
 * returned when the sample is large enough to support the statement; otherwise
 * null so the UI can decline to guess.
 *
 * @param {{ winsNeeded?: number | null, winRate?: number | null, sample?: number, minSample?: number }} [input]
 * @returns {{ trades: number, winRate: number, sample: number, minSample: number } | null}
 */
export function expectedTradesToTarget(input = {}) {
  const { winsNeeded = null, winRate = null, sample = 0, minSample = 30 } = /** @type {any} */ (input);
  const wins = Number(winsNeeded);
  const rate = Number(winRate);
  if (!Number.isFinite(wins) || wins <= 0) return null;
  if (!Number.isFinite(rate) || rate <= 0) return null;
  if (!Number.isFinite(sample) || sample < minSample) return null;
  const expected = wins / Math.min(0.95, Math.max(0.05, rate));
  return { trades: Math.ceil(expected - 1e-9), winRate: rate, sample, minSample };
}

/**
 * Worst-case disclosure. A run is only bounded when an enforceable stop exists;
 * a consecutive-loss cooldown on its own never bounds a run.
 *
 * @param {{ maxRunLoss?: number, lossesToCooldown?: number, ladderExposure?: number, capitalBounded?: boolean, currency?: string }} [input]
 * @returns {{ bounded: boolean, boundary: number | null, currency: string, reason: string }}
 */
export function describeWorstCase(input = {}) {
  const { maxRunLoss = 0, lossesToCooldown = 0, ladderExposure = 0, capitalBounded = false, currency = 'USD' } = /** @type {any} */ (input);
  const runLoss = Number(maxRunLoss);
  if (Number.isFinite(runLoss) && runLoss > 0) {
    return {
      bounded: true,
      boundary: runLoss,
      currency,
      reason: `New entries stop once realized run P&L reaches -${runLoss.toFixed(2)} ${currency}. A settlement can cross that line before the next entry is blocked.`,
    };
  }
  if (capitalBounded) {
    return {
      bounded: false,
      boundary: null,
      currency,
      reason: 'Only the account balance bounds losses; the run has no enforceable exit boundary of its own.',
    };
  }
  return {
    bounded: false,
    boundary: null,
    currency,
    reason: `No maximum run loss is set, so the ${Number(lossesToCooldown) || 0}-loss cooldown only pauses trading (about ${Number(ladderExposure) || 0} ${currency} at the selected stake). The run itself is unbounded.`,
  };
}

/**
 * Full preview model used by the pasture card. Everything the UI displays comes
 * from here, so displayed maths is testable without a DOM.
 *
 * @param {PreviewInput} [input]
 * @returns {Record<string, any>}
 */
export function buildRiskPreview(input = {}) {
  const { baseStake = 0, style = 'base', accountMode = null, accountId = null, balance = 0, currency = 'USD', lossesToCooldown = 3, cooldownSeconds = 45, takeProfit = 0, maxRunLoss = 0, startDebt = 0, payout = null, estimatePayout = null, payoutAuthoritative, winChance = null, serverMaxStake = 0, runProfit = 0, ratio = BALANCE_LIMIT_RATIO } = /** @type {any} */ (input);
  const ladder = buildLossLadder({ baseStake, style, losses: lossesToCooldown, payout, estimatePayout, payoutAuthoritative, winChance, balance, startDebt, maxRunLoss, serverMaxStake, ratio });
  const first = planStake({ baseStake, style, debt: startDebt, payout, estimatePayout, payoutAuthoritative, winChance, balance, serverMaxStake, ratio });
  const perWinProfit = first.blocked ? null : first.stake * first.net;
  const takeProfitProjection = projectTakeProfit({ target: takeProfit, runProfit, perWinProfit });
  const boundedByRunLoss = Number(maxRunLoss) > 0;
  const verifiedPayout = first.netSource === 'payout' && first.authoritative ? Number(payout) : null;
  const theoreticalEstimatePayout = first.netSource === 'estimate' ? Number(estimatePayout ?? payout) : null;
  return {
    config: {
      accountMode,
      accountId,
      balance: Number.isFinite(Number(balance)) ? Number(balance) : null,
      currency,
      baseStake: Number(baseStake) || 0,
      style,
      lossesToCooldown: Number(lossesToCooldown) || 0,
      cooldownSeconds: Number(cooldownSeconds) || 0,
      takeProfit: Number(takeProfit) || 0,
      maxRunLoss: Number(maxRunLoss) || 0,
      startDebt: positive(startDebt),
      netPerUnit: first.net,
      netSource: first.netSource,
      authoritative: Boolean(first.authoritative),
      illustrative: Boolean(first.illustrative || ladder.illustrative),
      payout: verifiedPayout,
      estimatePayout: theoreticalEstimatePayout,
      winChance: Number.isFinite(Number(winChance)) && Number(winChance) > 0 && Number(winChance) < 1 ? Number(winChance) : null,
      perWinProfit,
      balanceCap: first.cap,
      serverMaxStake: Number(serverMaxStake) || 0,
      executableLimit: first.limit ?? first.cap,
    },
    firstStake: first,
    ladder,
    takeProfit: takeProfitProjection,
    worstCase: describeWorstCase({ maxRunLoss, lossesToCooldown, ladderExposure: ladder.exposure, capitalBounded: false, currency }),
    cooldownExposure: ladder.exposure,
    boundedByRunLoss,
  };
}
