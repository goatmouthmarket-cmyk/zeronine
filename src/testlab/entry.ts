/**
 * Product-isolated entry timing research. This module is deliberately pure:
 * it never quotes, buys, writes a balance, or owns a websocket. Live runners
 * feed it ordered observations; replay runners feed it historical ones.
 */
export type EntryProduct = 'digits' | 'multipliers' | 'gold';

export type EntryMethodId =
  | 'instant'
  | 'confirm_1'
  | 'confirm_2'
  | 'stability_3'
  | 'anti_chase'
  | 'pullback'
  | 'continuation'
  | 'rug_pull_guard'
  | 'next_candle'
  | 'breakout_confirm'
  | 'retest'
  | 'wick_reject';

export interface EntryObservation {
  product: EntryProduct;
  market: string;
  signalId: string;
  /** Strictly increasing per-market tick/candle epoch. Duplicate frames do not count. */
  epoch: number;
  direction: 'up' | 'down';
  /** Normalized movement in the signal direction. */
  momentum?: number;
  /** Normalized adverse extension: 0 calm, 1+ chased/spike territory. */
  extension?: number;
  /** 0..1 current volatility / rug-pull risk estimate. */
  rugRisk?: number;
  /** 0..1 confirmation that price returned to the desired entry zone. */
  pullback?: number;
  /** Gold-only: current candle has closed, so next-candle execution is valid. */
  completedCandle?: boolean;
  /** Gold-only wick rejection strength, normalized 0..1. */
  wickRejection?: number;
}

export type EntryDecision =
  | { state: 'waiting'; methodId: EntryMethodId; confirmations: number; required: number; reason: string }
  | { state: 'ready'; methodId: EntryMethodId; confirmations: number; required: number; reason: string }
  | { state: 'skip'; methodId: EntryMethodId; confirmations: number; required: number; reason: string };

export interface EntryMethodDefinition {
  id: EntryMethodId;
  product: EntryProduct;
  label: string;
  description: string;
}

export const ENTRY_METHODS: readonly EntryMethodDefinition[] = [
  { id: 'instant', product: 'digits', label: 'Instant', description: 'Enter on the qualified signal.' },
  { id: 'confirm_1', product: 'digits', label: 'Confirm 1 tick', description: 'Require one fresh supporting tick.' },
  { id: 'confirm_2', product: 'digits', label: 'Confirm 2 ticks', description: 'Require two fresh supporting ticks.' },
  { id: 'stability_3', product: 'digits', label: 'Stability window', description: 'Require three fresh stable ticks.' },
  { id: 'anti_chase', product: 'digits', label: 'Anti-chase', description: 'Wait for confirmation and reject extended moves.' },
  { id: 'instant', product: 'multipliers', label: 'Instant', description: 'Enter on the qualified momentum signal.' },
  { id: 'confirm_1', product: 'multipliers', label: 'Confirm 1 tick', description: 'Require one fresh supporting tick.' },
  { id: 'pullback', product: 'multipliers', label: 'Pullback', description: 'Wait for a controlled retrace into the entry zone.' },
  { id: 'continuation', product: 'multipliers', label: 'Continuation', description: 'Enter only when directional movement persists.' },
  { id: 'rug_pull_guard', product: 'multipliers', label: 'Rug-pull guard', description: 'Reject spike/Crash/Boom danger conditions.' },
  { id: 'next_candle', product: 'gold', label: 'Next candle', description: 'Enter only from a completed predecessor candle.' },
  { id: 'breakout_confirm', product: 'gold', label: 'Breakout confirmation', description: 'Require direction plus a completed candle.' },
  { id: 'retest', product: 'gold', label: 'Retest', description: 'Wait for price to revisit the breakout zone.' },
  { id: 'wick_reject', product: 'gold', label: 'Wick rejection', description: 'Require a completed rejection wick in direction.' },
];

export function entryMethodsFor(product: EntryProduct): EntryMethodDefinition[] {
  return ENTRY_METHODS.filter((method) => method.product === product);
}

function requirements(methodId: EntryMethodId): number {
  if (methodId === 'confirm_1') return 2;
  if (methodId === 'confirm_2' || methodId === 'anti_chase' || methodId === 'continuation' || methodId === 'rug_pull_guard' || methodId === 'breakout_confirm') return 3;
  if (methodId === 'stability_3') return 4;
  return 1;
}

function clamp01(value: number | undefined): number {
  return Math.max(0, Math.min(1, Number(value ?? 0)));
}

/** Tick/candle epoch-safe state machine for one signal + method. */
export class EntryMethodGate {
  private lastEpoch = 0;
  private confirmations = 0;
  private signalId: string | null = null;
  readonly product: EntryProduct;
  readonly methodId: EntryMethodId;

  constructor(product: EntryProduct, methodId: EntryMethodId) {
    this.product = product;
    this.methodId = methodId;
    if (!entryMethodsFor(product).some((method) => method.id === methodId)) {
      throw new Error(`${methodId} is not an entry method for ${product}`);
    }
  }

  reset(): void {
    this.lastEpoch = 0;
    this.confirmations = 0;
    this.signalId = null;
  }

  observe(observation: EntryObservation): EntryDecision {
    const required = requirements(this.methodId);
    if (observation.product !== this.product) throw new Error('entry observation product does not match gate');
    if (!observation.signalId || !Number.isFinite(observation.epoch) || observation.epoch <= 0) {
      return { state: 'skip', methodId: this.methodId, confirmations: this.confirmations, required, reason: 'invalid entry observation' };
    }
    if (this.signalId !== observation.signalId) {
      this.signalId = observation.signalId;
      this.lastEpoch = 0;
      this.confirmations = 0;
    }
    if (observation.epoch < this.lastEpoch) {
      this.reset();
      return { state: 'skip', methodId: this.methodId, confirmations: 0, required, reason: 'out-of-order market observation' };
    }
    if (observation.epoch > this.lastEpoch) {
      this.lastEpoch = observation.epoch;
      this.confirmations = Math.min(required, this.confirmations + 1);
    }

    const momentum = Number(observation.momentum ?? 0);
    const extension = Math.max(0, Number(observation.extension ?? 0));
    const rugRisk = clamp01(observation.rugRisk);
    const pullback = clamp01(observation.pullback);
    const wick = clamp01(observation.wickRejection);
    if ((this.methodId === 'anti_chase' && extension >= 0.75)
      || (this.methodId === 'rug_pull_guard' && (rugRisk >= 0.55 || extension >= 0.8))) {
      return { state: 'skip', methodId: this.methodId, confirmations: this.confirmations, required, reason: 'unsafe chase or rug-pull conditions' };
    }
    if (this.methodId === 'pullback' || this.methodId === 'retest') {
      if (pullback < 0.5) return { state: 'waiting', methodId: this.methodId, confirmations: this.confirmations, required, reason: 'waiting for pullback/retest' };
    }
    if (this.methodId === 'continuation' && momentum < 0.25) {
      return { state: 'waiting', methodId: this.methodId, confirmations: this.confirmations, required, reason: 'momentum has not continued' };
    }
    if ((this.methodId === 'next_candle' || this.methodId === 'breakout_confirm' || this.methodId === 'retest' || this.methodId === 'wick_reject') && !observation.completedCandle) {
      return { state: 'waiting', methodId: this.methodId, confirmations: this.confirmations, required, reason: 'waiting for completed candle' };
    }
    if (this.methodId === 'wick_reject' && wick < 0.55) {
      return { state: 'waiting', methodId: this.methodId, confirmations: this.confirmations, required, reason: 'no qualifying rejection wick' };
    }
    if (this.confirmations < required) {
      return { state: 'waiting', methodId: this.methodId, confirmations: this.confirmations, required, reason: 'collecting fresh confirmation' };
    }
    return { state: 'ready', methodId: this.methodId, confirmations: this.confirmations, required, reason: 'entry conditions confirmed' };
  }
}

export interface EntryMethodEvidence {
  product: EntryProduct;
  methodId: EntryMethodId;
  samples: number;
  netPnl: number;
  maxDrawdown: number;
  averageDelay: number;
  updatedAt: number;
}

export interface EntryChampion {
  methodId: EntryMethodId | null;
  confidence: number;
  reason: string;
}

/**
 * Conservative Free-Agent promotion. A challenger needs fresh evidence,
 * enough independent samples, positive return, bounded drawdown, and a real
 * improvement over the incumbent. Otherwise the existing setting holds.
 */
export function chooseEntryChampion(
  evidence: readonly EntryMethodEvidence[],
  options: { product: EntryProduct; incumbent?: EntryMethodId | null; now?: number; minSamples?: number; freshnessMs?: number; challengerMargin?: number } ,
): EntryChampion {
  const now = options.now ?? Date.now();
  const minSamples = options.minSamples ?? 30;
  const freshnessMs = options.freshnessMs ?? 12 * 60 * 60 * 1000;
  const margin = options.challengerMargin ?? 0.05;
  const valid = evidence.filter((row) => row.product === options.product
    && row.samples >= minSamples
    && now - row.updatedAt <= freshnessMs
    && row.netPnl > 0
    && row.maxDrawdown >= 0
    && Number.isFinite(row.averageDelay));
  if (valid.length === 0) return { methodId: options.incumbent ?? null, confidence: 0, reason: 'not enough fresh positive evidence' };
  const score = (row: EntryMethodEvidence): number => row.netPnl / Math.max(1, row.samples) - row.maxDrawdown / Math.max(1, row.samples) * 0.35 - row.averageDelay * 0.002;
  const ranked = [...valid].sort((a, b) => score(b) - score(a) || b.samples - a.samples || a.methodId.localeCompare(b.methodId));
  const best = ranked[0]!;
  const runnerUp = ranked[1];
  const incumbent = valid.find((row) => row.methodId === options.incumbent);
  if (incumbent && incumbent.methodId !== best.methodId && score(best) < score(incumbent) + margin) {
    return { methodId: incumbent.methodId, confidence: 0.55, reason: 'holding incumbent; challenger lead is too small' };
  }
  if (runnerUp && Math.abs(score(best) - score(runnerUp)) < margin / 2) {
    return { methodId: options.incumbent ?? null, confidence: 0.3, reason: 'top methods are too close to promote' };
  }
  const confidence = Math.min(0.99, 0.45 + Math.min(0.35, best.samples / 400) + Math.min(0.19, Math.max(0, score(best))));
  return { methodId: best.methodId, confidence, reason: `promoted from ${best.samples} fresh outcomes` };
}
