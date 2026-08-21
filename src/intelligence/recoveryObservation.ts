import type { Direction } from '../core/digitMath.ts';
import type { IntelligenceSnapshot, MarketIntelligence } from './engine.ts';

export type RecoveryObservationAction = 'observe' | 'recover' | 'switch_market';

export interface RecoveryLoss {
  direction: Direction;
  barrier: number;
  /** The digit which settled the loss, when it is available from the contract. */
  digit?: number | null;
}

/**
 * Small serializable state owned by the caller. The helpers below return new
 * values, which lets live, paper, and replay code use the same transitions.
 */
export interface RecoveryObservationState {
  market: string;
  observedTicks: number;
  recoveryFailures: number;
  lastLoss?: RecoveryLoss;
}

export type RecoveryObservationEvent =
  | { type: 'tick' }
  | { type: 'recovery_lost'; loss?: RecoveryLoss }
  | { type: 'recovery_won' }
  | { type: 'switch_market'; market: string };

export interface RecoveryObservationConfig {
  minObservationTicks: number;
  maxObservationTicks: number;
  recoverDeceptionThreshold: number;
  recoverReadinessThreshold: number;
  switchDeceptionThreshold: number;
  switchSafetyMargin: number;
}

export const DEFAULT_RECOVERY_OBSERVATION_CONFIG: RecoveryObservationConfig = {
  minObservationTicks: 3,
  maxObservationTicks: 5,
  recoverDeceptionThreshold: 45,
  recoverReadinessThreshold: 55,
  switchDeceptionThreshold: 70,
  switchSafetyMargin: 10,
};

export interface RecoveryObservationInput {
  market: string;
  intelligence: IntelligenceSnapshot;
  /** Recovery debt is read only here; stake and debt calculations stay in recovery.ts. */
  recovery: { debt: number; streak: number };
  ticksSinceLoss: number;
  lastLoss?: RecoveryLoss;
  recoveryFailures?: number;
  config?: Partial<RecoveryObservationConfig>;
}

export interface RecoveryObservation {
  deceptionScore: number;
  readinessScore: number;
  observedTicks: number;
  action: RecoveryObservationAction;
  reason: string;
  switchMarket?: string;
}

function clamp(value: number): number {
  return Math.max(0, Math.min(100, value));
}

function averageConsistency(market: MarketIntelligence): number {
  const { features } = market.scan;
  return features.reduce((total, feature) => total + feature.consistency, 0) / Math.max(1, features.length);
}

function lostContract(loss: RecoveryLoss, digit: number | null): boolean {
  if (digit == null) return false;
  return loss.direction === 'over' ? digit <= loss.barrier : digit >= loss.barrier;
}

function relevantFeature(market: MarketIntelligence, loss?: RecoveryLoss) {
  if (!loss) return undefined;
  return market.scan.features.find((feature) => feature.direction === loss.direction && feature.barrier === loss.barrier);
}

function regimeRisk(regime: MarketIntelligence['regime']['regime']): number {
  switch (regime) {
    case 'loss_cluster': return 25;
    case 'volatile': return 25;
    case 'uncertain': return 22;
    case 'transitioning': return 15;
    default: return 0;
  }
}

function regimeReadiness(regime: MarketIntelligence['regime']['regime']): number {
  switch (regime) {
    case 'favorable': return 12;
    case 'stable': return 9;
    case 'transitioning': return 2;
    case 'volatile': return -10;
    case 'loss_cluster': return -12;
    case 'uncertain': return -10;
  }
}

function marketSafety(market: MarketIntelligence): number {
  const consistency = averageConsistency(market);
  const regimePenalty = regimeRisk(market.regime.regime);
  return market.health.score + market.regime.confidence * 0.15 + consistency * 15 - regimePenalty;
}

function saferMarket(
  snapshot: IntelligenceSnapshot,
  current: MarketIntelligence,
  currentSymbol: string,
  config: RecoveryObservationConfig,
): string | undefined {
  const currentSafety = marketSafety(current);
  let best: { symbol: string; safety: number } | undefined;
  for (const [symbol, market] of snapshot.markets) {
    if (symbol === currentSymbol || market.scan.samples < 100 || market.health.score < 60) continue;
    if (market.regime.regime === 'volatile' || market.regime.regime === 'loss_cluster' || market.regime.regime === 'uncertain') continue;
    const safety = marketSafety(market);
    if ((!best || safety > best.safety) && safety >= currentSafety + config.switchSafetyMargin) {
      best = { symbol, safety };
    }
  }
  return best?.symbol;
}

/** Creates a recovery-observation state at the point a contract settles as a loss. */
export function startRecoveryObservation(market: string, lastLoss?: RecoveryLoss): RecoveryObservationState {
  return { market, observedTicks: 0, recoveryFailures: 0, lastLoss };
}

/** Applies one event without mutating the caller's state object. */
export function transitionRecoveryObservation(
  state: RecoveryObservationState,
  event: RecoveryObservationEvent,
): RecoveryObservationState {
  switch (event.type) {
    case 'tick':
      return { ...state, observedTicks: state.observedTicks + 1 };
    case 'recovery_lost':
      return {
        ...state,
        observedTicks: 0,
        recoveryFailures: state.recoveryFailures + 1,
        lastLoss: event.loss ?? state.lastLoss,
      };
    case 'recovery_won':
      return { ...state, observedTicks: 0, recoveryFailures: 0 };
    case 'switch_market':
      return { ...state, market: event.market, observedTicks: 0 };
  }
}

/**
 * Scores only already-computed shared intelligence. It is an observation
 * gate before planRecovery(), and intentionally never proposes a stake or
 * changes recovery debt accounting.
 */
export function evaluateRecoveryObservation(input: RecoveryObservationInput): RecoveryObservation {
  const config = { ...DEFAULT_RECOVERY_OBSERVATION_CONFIG, ...input.config };
  const observedTicks = Math.max(0, Math.floor(input.ticksSinceLoss));
  const market = input.intelligence.markets.get(input.market);
  if (!market) {
    return {
      deceptionScore: 100,
      readinessScore: 0,
      observedTicks,
      action: 'observe',
      reason: 'market intelligence is unavailable',
    };
  }
  if (input.recovery.debt <= 0.005) {
    return {
      deceptionScore: 0,
      readinessScore: 100,
      observedTicks,
      action: 'recover',
      reason: 'no recovery debt remains',
    };
  }

  const consistency = averageConsistency(market);
  const feature = relevantFeature(market, input.lastLoss);
  const recentDigit = market.scan.previousDigit;
  const immediateRepeat = observedTicks <= 1 && input.lastLoss?.digit != null && recentDigit === input.lastLoss.digit;
  const currentLossShape = input.lastLoss ? lostContract(input.lastLoss, recentDigit) : false;
  const failureCount = Math.max(0, input.recoveryFailures ?? 0, Math.max(0, input.recovery.streak - 1));

  let deception = regimeRisk(market.regime.regime);
  if (market.health.score < 40) deception += 25;
  else if (market.health.score < 60) deception += 16;
  if (market.health.trend === 'deteriorating') deception += 8;
  if (consistency < 0.45) deception += 18;
  else if (consistency < 0.6) deception += 8;
  if (feature && feature.estimatedWin < 0.5) deception += 16;
  else if (feature && feature.estimatedWin < 0.65) deception += 8;
  if (immediateRepeat) deception += 32;
  else if (currentLossShape) deception += 18;
  deception += Math.min(24, failureCount * 8);
  const deceptionScore = Math.round(clamp(deception));

  let readiness = 25 + Math.min(25, observedTicks * 8);
  readiness += market.health.score * 0.28;
  readiness += consistency * 18;
  readiness += regimeReadiness(market.regime.regime);
  if (!currentLossShape) readiness += 8;
  readiness -= deceptionScore * 0.45;
  const readinessScore = Math.round(clamp(readiness));

  if (observedTicks < config.minObservationTicks) {
    return {
      deceptionScore,
      readinessScore,
      observedTicks,
      action: 'observe',
      reason: `observing ${observedTicks} / ${config.minObservationTicks} ticks after recovery loss`,
    };
  }
  if (deceptionScore <= config.recoverDeceptionThreshold && readinessScore >= config.recoverReadinessThreshold) {
    return {
      deceptionScore,
      readinessScore,
      observedTicks,
      action: 'recover',
      reason: 'observed conditions are sufficiently stable for recovery planning',
    };
  }
  if (observedTicks >= config.maxObservationTicks && deceptionScore >= config.switchDeceptionThreshold) {
    const switchMarket = saferMarket(input.intelligence, market, input.market, config);
    if (switchMarket) {
      return {
        deceptionScore,
        readinessScore,
        observedTicks,
        action: 'switch_market',
        switchMarket,
        reason: `high deception evidence; ${switchMarket} has materially safer observed conditions`,
      };
    }
  }
  return {
    deceptionScore,
    readinessScore,
    observedTicks,
    action: 'observe',
    reason: deceptionScore >= config.switchDeceptionThreshold
      ? 'high deception evidence; no materially safer market is available'
      : 'recovery readiness remains below the configured threshold',
  };
}
