export type LessonConditions = {
  digitSequence?: { side: 'high' | 'low'; count: 2 | 3 };
  edge?: { min?: number; max?: number };
  confidence?: { min?: number; max?: number };
};
export type CoreLessonRule = {
  id: string; version: number; accountId: string; sourceTradeId: string;
  marketSymbol: string; expectedDirection: 'over' | 'under'; barrier: number;
  mode: 'demo' | 'real'; stance: 'good' | 'warning'; conditions: LessonConditions;
  note: string; confidence: number; createdAt: number; legacyInsightId: string | null;
};
export type EvidenceTrade = {
  id: string; accountId: string; market: string; direction: string; barrier: number;
  mode: string; status: string; createdAt: number; settledAt: number | null;
  stake: number | null; profit: number | null; context: Record<string, unknown> | null;
};
export type LessonEvaluation = {
  classification: 'matched' | 'comparison' | 'skipped';
  reason: string; conditions: Record<string, boolean | null>;
};

/** Validate the rule before it reaches storage. Notes are never executable code. */
export function normalizeLessonConditions(input: unknown): LessonConditions {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Choose a pattern to check.');
  const raw = input as Record<string, unknown>;
  const result: LessonConditions = {};
  if (raw.digitSequence != null) {
    const sequence = raw.digitSequence as { side?: unknown; count?: unknown };
    if (!sequence || (sequence.side !== 'high' && sequence.side !== 'low') || (sequence.count !== 2 && sequence.count !== 3)) throw new Error('Use two or three high or low digits.');
    result.digitSequence = { side: sequence.side, count: sequence.count };
  }
  for (const name of ['edge', 'confidence'] as const) {
    if (raw[name] == null) continue;
    const range = raw[name] as { min?: unknown; max?: unknown };
    if (!range || typeof range !== 'object' || Array.isArray(range)) throw new Error('Choose a valid range.');
    const min = range.min, max = range.max, floor = name === 'edge' ? -1 : 0;
    if ((min == null && max == null) ||
      (min != null && (typeof min !== 'number' || !Number.isFinite(min) || min < floor || min > 1)) ||
      (max != null && (typeof max !== 'number' || !Number.isFinite(max) || max < floor || max > 1)) ||
      (typeof min === 'number' && typeof max === 'number' && min > max)) throw new Error('Choose a valid range.');
    result[name] = { ...(min != null ? { min: min as number } : {}), ...(max != null ? { max: max as number } : {}) };
  }
  if (!Object.keys(result).length) throw new Error('Choose a pattern to check.');
  return result;
}

function finite(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value); }

/** Uses only captured information available before entry. The outcome labels
 * performance after matching; it never participates in the pattern predicate. */
export function evaluateLessonRule(rule: CoreLessonRule, trade: EvidenceTrade): LessonEvaluation {
  const facts: Record<string, boolean | null> = {};
  const skipped = (reason: string): LessonEvaluation => ({ classification: 'skipped', reason, conditions: facts });
  if (trade.accountId !== rule.accountId || trade.mode !== rule.mode) return skipped('different_account_or_mode');
  if (trade.market !== rule.marketSymbol || trade.direction !== rule.expectedDirection || trade.barrier !== rule.barrier) return skipped('different_contract');
  if (trade.id === rule.sourceTradeId || !Number.isFinite(trade.createdAt) || trade.createdAt <= rule.createdAt) return skipped('not_a_later_trade');
  if (!['won', 'lost'].includes(trade.status) || trade.settledAt == null || !Number.isFinite(trade.settledAt) || trade.settledAt < trade.createdAt) return skipped('not_settled');
  if (!finite(trade.profit) || !finite(trade.stake) || trade.stake <= 0) return skipped('missing_result_values');
  const context = trade.context;
  if (!context) return skipped('missing_entry_record');
  let conditions: LessonConditions;
  try { conditions = normalizeLessonConditions(rule.conditions); } catch { return skipped('unsupported_rule'); }
  if (conditions.digitSequence) {
    const entryEpoch = context.entryEpoch;
    if (!finite(entryEpoch) || entryEpoch <= 0) return skipped('missing_entry_tick');
    const count = conditions.digitSequence.count;
    const before = Array.isArray(context.before) ? context.before.slice(-count) : [];
    if (before.length !== count) return skipped('missing_before_ticks');
    let lastEpoch = -Infinity;
    for (const item of before) {
      if (!item || typeof item !== 'object') return skipped('invalid_before_ticks');
      const tick = item as { digit?: unknown; epoch?: unknown };
      if (!finite(tick.digit) || !Number.isInteger(tick.digit) || tick.digit < 0 || tick.digit > 9 ||
          !finite(tick.epoch) || tick.epoch > entryEpoch || tick.epoch < lastEpoch) return skipped('invalid_before_ticks');
      lastEpoch = tick.epoch;
    }
    // New captures carry stable sequence/connection identities. A gap or
    // reconnect cannot count as consecutive digits even if seconds are equal.
    const identified = before as Array<{ sequence?: unknown; segment?: unknown }>;
    if (context.engineVersion === 'core-v1' || identified.some(tick => tick.sequence != null || tick.segment != null)) {
      if (identified.some(tick => !finite(tick.sequence) || !Number.isInteger(tick.sequence) || typeof tick.segment !== 'string' || !tick.segment)) return skipped('missing_tick_identity');
      if (identified.some((tick,index) => index > 0 && (tick.segment !== identified[index-1].segment ||
        Number(tick.sequence) !== Number(identified[index-1].sequence)+1))) return skipped('gapped_before_ticks');
    }
    facts.digitSequence = before.every(item => conditions.digitSequence!.side === 'high'
      ? Number((item as { digit: number }).digit) >= 5 : Number((item as { digit: number }).digit) <= 4);
  }
  for (const name of ['edge', 'confidence'] as const) {
    const range = conditions[name];
    if (!range) continue;
    const value = context[name === 'edge' ? 'cowEdge' : 'cowConfidence'];
    const shownAt = context.cowShownAt;
    if (!finite(value) || !finite(shownAt) || shownAt > trade.createdAt || shownAt < trade.createdAt - 120_000) return skipped('missing_pre_entry_' + name);
    facts[name] = (range.min == null || value >= range.min) && (range.max == null || value <= range.max);
  }
  return { classification: Object.values(facts).every(Boolean) ? 'matched' : 'comparison', reason: 'checked_before_entry', conditions: facts };
}

