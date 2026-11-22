/**
 * Shared Over/Under decision math. The estimates are hypotheses, not verified odds.
 * No network, persistence, timers, account balances or recovery state live here.
 */
export const CORE_ENGINE_VERSION = 'core-v1' as const;
export const CORE_CONTRACT_POLICY = 'balanced-over-under-v1' as const;
/** Default pasture pool. All valid contracts remain available for explicit manual analysis. */
export function isCorePastureCandidate(candidate: {baseWin:number}): boolean {
  return Number.isFinite(candidate.baseWin) && candidate.baseWin >= .7 && candidate.baseWin <= .8;
}
export type CoreDirection = 'over' | 'under';
export interface CoreTick {
  epoch: number;
  quote: number;
  digit: number;
  sequence?: number;
  segment?: string;
}
export interface CoreMarketInput {
  symbol: string;
  display?: string;
  fresh?: boolean;
  precision?: number;
  recentTicks: readonly CoreTick[];
  payoutRatios?: readonly { direction: CoreDirection; barrier: number; ratio: number; quotedAt?: number }[];
}
export interface CoreEvidenceGroup { trades: number; wins: number; profit: number; stake: number }
export interface CoreLessonConditions {
  digitSequence?: { side: 'high' | 'low'; count: 2 | 3 };
  edge?: { min?: number; max?: number };
  confidence?: { min?: number; max?: number };
}
export interface CoreLessonEvidence {
  id: string;
  marketSymbol: string;
  expectedDirection: CoreDirection | 'none';
  barrier: number | null;
  createdAt: number;
  confirmedPattern: { side: 'high' | 'low'; count: number } | null;
  confirmedConditions?: CoreLessonConditions | null;
  patternEvidence: {
    supported: boolean;
    forwardOnly: boolean;
    complete: boolean;
    firstEvaluatedAt: number;
    lastEvaluatedAt: number;
    matched: CoreEvidenceGroup;
    comparable: CoreEvidenceGroup;
  } | null;
}
export interface CoreSetup {
  readonly state: 'waiting_prices' | 'wait' | 'check_quote' | 'quoted_edge';
  readonly label: string;
  readonly reason: string;
  readonly lesson: 'supports' | 'caution' | 'none';
  readonly probabilityKind: 'estimate';
}
export interface CoreDecision {
  engineVersion: typeof CORE_ENGINE_VERSION;
  decisionId: string;
  market: string;
  display: string;
  direction: CoreDirection;
  barrier: number;
  duration: 1;
  durationUnit: 't';
  at: number;
  cutoff: Readonly<CoreTick & { precision: number | null }>;
  baseWin: number;
  estWin: number;
  probability: number;
  estPayout: number;
  edge: number;
  expectedROI: number;
  quality: number;
  consistency: number;
  entropy: number;
  momentum: number;
  shortLongDeviation: number;
  transitionProb: number;
  transitionSamples: number;
  learnedWin: number | null;
  fresh: boolean;
  hitSignal: boolean;
  lessonIds: readonly string[];
  readonly lessonMatches: readonly Readonly<{ id: string; state: 'matched' | 'applied' | 'caution' }>[];
  features: Readonly<{ samples: number; wins: number; empiricalWin: number; priorSamples: number; lessonAdjustment: number }>;
  evidence: Readonly<{ samples: number; lessonsUsed: number; status: 'collecting' | 'observed'; calibrated: false }>;
  payoutSource: 'estimate' | 'live_quote';
  readonly setup: Readonly<CoreSetup>;
  quote: Readonly<{ ask: number; payout: number; breakeven: number; edge: number; expectedROI: number; quotedAt: number }> | null;
}
/** Presentation of existing decision facts, never an additional trading or risk gate. */
export function deriveCoreSetup(decision: Pick<CoreDecision, 'fresh' | 'expectedROI' | 'payoutSource' | 'features'>): Readonly<CoreSetup> {
  const adjustment = decision.features.lessonAdjustment;
  const lesson = adjustment > 0 ? 'supports' : adjustment < 0 ? 'caution' : 'none';
  const state = !decision.fresh ? 'waiting_prices' : !Number.isFinite(decision.expectedROI) || decision.expectedROI <= 0
    ? 'wait' : decision.payoutSource === 'live_quote' ? 'quoted_edge' : 'check_quote';
  const copy = {
    waiting_prices: ['Waiting for prices', 'Fresh prices are needed to check this setup.'],
    wait: ['Wait', decision.payoutSource === 'live_quote' ? 'The current quote does not offer a positive estimated return.' : 'The estimated payout does not offer a positive estimated return.'],
    check_quote: ['Check quote', 'This estimate needs a current payout quote.'],
    quoted_edge: ['Quote checked', 'The current quote offers a positive estimated return; a win is not guaranteed.'],
  } as const;
  return freeze({ state, label: copy[state][0], reason: copy[state][1], lesson, probabilityKind: 'estimate' as const });
}
const PRIOR_SAMPLES = 200;
const MAX_TICKS = 1000;
const MAX_AGE_MS = 15_000;
const clamp = (value: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, value));
const win = (digit: number, direction: CoreDirection, barrier: number): boolean => direction === 'over' ? digit > barrier : digit < barrier;
export function coreBaseWin(direction: CoreDirection, barrier: number): number {
  if (!Number.isInteger(barrier) || (direction === 'over' ? barrier < 0 || barrier > 8 : barrier < 1 || barrier > 9)) throw new RangeError('Invalid Over/Under barrier');
  return (direction === 'over' ? 9 - barrier : barrier) / 10;
}
function freeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
function fingerprint(ticks: readonly CoreTick[]): string {
  let hash = 2166136261;
  for (const tick of ticks) {
    const key = [tick.segment ?? '', tick.sequence ?? '', tick.epoch, tick.quote, tick.digit].join(':');
    for (let i = 0; i < key.length; i++) { hash ^= key.charCodeAt(i); hash = Math.imul(hash, 16777619); }
  }
  return (hash >>> 0).toString(36);
}
/** Reject ambiguous/out-of-order input rather than silently rearranging ticks. */
function cleanTicks(market: CoreMarketInput, now: number): CoreTick[] {
  const ticks = market.recentTicks.slice(-MAX_TICKS);
  if (!ticks.length) return [];
  for (let i = 0; i < ticks.length; i++) {
    const t = ticks[i], prev = ticks[i - 1];
    if (!Number.isFinite(t.epoch) || t.epoch <= 0 || t.epoch * 1000 > now + 1000 ||
        !Number.isFinite(t.quote) || t.quote < 0 || !Number.isInteger(t.digit) || t.digit < 0 || t.digit > 9 ||
        (t.sequence !== undefined && (!Number.isSafeInteger(t.sequence) || t.sequence < 0))) return [];
    if (prev && (t.epoch < prev.epoch ||
        (t.segment === prev.segment && t.sequence !== undefined && prev.sequence !== undefined && t.sequence <= prev.sequence))) return [];
  }
  // Only the current reconnect segment is usable for consecutive-digit rules.
  const segment = ticks[ticks.length - 1].segment;
  let start = ticks.length - 1;
  while (start > 0 && ticks[start - 1].segment === segment) start--;
  return ticks.slice(start).map(t => ({ ...t }));
}
function validGroup(group: CoreEvidenceGroup): boolean {
  return Number.isInteger(group.trades) && group.trades >= 30 &&
    Number.isInteger(group.wins) && group.wins >= 0 && group.wins <= group.trades &&
    Number.isFinite(group.profit) && Number.isFinite(group.stake) && group.stake > 0;
}
/** A repeated confirmed condition is a match, not evidence that it predicts wins. */
function matchesLesson(
  lesson: CoreLessonEvidence, market: string, direction: CoreDirection, barrier: number,
  ticks: readonly CoreTick[], probability: number, edge: number, now: number,
): boolean {
  if (!lesson.id || lesson.marketSymbol !== market || lesson.expectedDirection !== direction || lesson.barrier !== barrier ||
      !Number.isFinite(lesson.createdAt) || lesson.createdAt > now) return false;
  const conditions: (Omit<CoreLessonConditions, 'digitSequence'> & {
    digitSequence?: { side: 'high' | 'low'; count: number };
  }) | null = lesson.confirmedConditions === undefined
    ? lesson.confirmedPattern ? { digitSequence: lesson.confirmedPattern } : null : lesson.confirmedConditions;
  if (!conditions || !Object.keys(conditions).length || Object.keys(conditions).some(key => !['digitSequence', 'edge', 'confidence'].includes(key))) return false;
  if (conditions.digitSequence !== undefined) {
    const sequence = conditions.digitSequence;
    if (!sequence || ![2, 3].includes(sequence.count) || !['high', 'low'].includes(sequence.side)) return false;
    const recent = ticks.slice(-sequence.count);
    if (recent.length !== sequence.count || recent.some((tick, index) => !Number.isSafeInteger(tick.sequence) || !tick.segment ||
        (index > 0 && (tick.segment !== recent[index - 1].segment || tick.sequence !== recent[index - 1].sequence! + 1)) ||
        (sequence.side === 'high' ? tick.digit < 5 : tick.digit > 4))) return false;
  }
  for (const name of ['edge', 'confidence'] as const) {
    if (conditions[name] === undefined) continue;
    const range = conditions[name], value = name === 'edge' ? edge : probability;
    if (!range || !Number.isFinite(value) || (range.min === undefined && range.max === undefined)) return false;
    const floor = name === 'edge' ? -1 : 0;
    if ((range.min !== undefined && (!Number.isFinite(range.min) || range.min < floor || range.min > 1)) ||
        (range.max !== undefined && (!Number.isFinite(range.max) || range.max < floor || range.max > 1)) ||
        (range.min !== undefined && range.max !== undefined && range.min > range.max) ||
        (range.min !== undefined && value < range.min) || (range.max !== undefined && value > range.max)) return false;
  }
  return true;
}
function lessonLift(
  lesson: CoreLessonEvidence, market: string, direction: CoreDirection, barrier: number,
  ticks: readonly CoreTick[], now: number,
): number {
  const rule = lesson.confirmedPattern, e = lesson.patternEvidence;
  // Richer rules can be displayed as matches; only the supported digit-only
  // evidence adapter is currently allowed to change the probability.
  if (lesson.confirmedConditions !== undefined && (!lesson.confirmedConditions ||
      Object.keys(lesson.confirmedConditions).some(key => key !== 'digitSequence'))) return 0;
  if (!lesson.id || lesson.marketSymbol !== market || lesson.expectedDirection !== direction || lesson.barrier !== barrier ||
      !rule || ![2, 3].includes(rule.count) || !['high', 'low'].includes(rule.side) ||
      !e?.supported || e.forwardOnly !== true || e.complete !== true ||
      !Number.isFinite(lesson.createdAt) || !Number.isFinite(e.firstEvaluatedAt) || !Number.isFinite(e.lastEvaluatedAt) ||
      lesson.createdAt >= e.firstEvaluatedAt || e.firstEvaluatedAt > e.lastEvaluatedAt || e.lastEvaluatedAt > now ||
      !validGroup(e.matched) || !validGroup(e.comparable)) return 0;
  const recent = ticks.slice(-rule.count);
  if (recent.some((t, i) => i > 0 && t.sequence !== undefined && recent[i - 1].sequence !== undefined && t.sequence !== recent[i - 1].sequence! + 1)) return 0;
  if (recent.length !== rule.count || !recent.every(t => rule.side === 'high' ? t.digit >= 5 : t.digit <= 4)) return 0;
  const matched = e.matched, control = e.comparable;
  const p = (matched.wins + 1) / (matched.trades + 2), q = (control.wins + 1) / (control.trades + 2);
  const se = Math.sqrt(p * (1 - p) / (matched.trades + 2) + q * (1 - q) / (control.trades + 2));
  const returnMatched = matched.profit / matched.stake, returnControl = control.profit / control.stake;
  const n = Math.min(matched.trades, control.trades), weight = n / (n + PRIOR_SAMPLES);
  if (returnMatched > 0 && returnMatched > returnControl && p - q > 2 * se) return Math.min(.04, p - q - 2 * se) * weight;
  if (returnMatched < returnControl && p - q < -2 * se) return -Math.min(.04, q - p - 2 * se) * weight;
  return 0;
}
function entropy(ticks: readonly CoreTick[]): number {
  const freq = Array.from({ length: 10 }, () => 0);
  for (const t of ticks) freq[t.digit]++;
  return -freq.reduce((sum, n) => n ? sum + (n / ticks.length) * Math.log(n / ticks.length) : sum, 0) / Math.log(10);
}
/**
 * Every caller consumes these same candidates. Payout estimates are labelled and
 * must be replaced by an actual quote before any purchase or paper fill.
 */
export function rankCoreCandidates(
  markets: readonly CoreMarketInput[],
  lessons: readonly CoreLessonEvidence[] = [],
  now = Date.now(),
): CoreDecision[] {
  const out: CoreDecision[] = [];
  for (const market of markets) {
    if (!market.symbol || !Number.isFinite(now)) continue;
    const ticks = cleanTicks(market, now);
    if (!ticks.length) continue;
    const last = ticks[ticks.length - 1];
    const fresh = market.fresh !== false && now - last.epoch * 1000 <= MAX_AGE_MS;
    if (!fresh) continue;
    const dataKey = fingerprint(ticks), distributionEntropy = entropy(ticks);
    for (const direction of ['over', 'under'] as const) {
      for (let barrier = direction === 'over' ? 0 : 1; barrier <= (direction === 'over' ? 8 : 9); barrier++) {
        const baseWin = coreBaseWin(direction, barrier);
        const wins = ticks.filter(t => win(t.digit, direction, barrier)).length;
        const empirical = wins / ticks.length;
        // One shrinkage calculation, with a uniform-digit prior. No trend,
        // streak or repeated-window bonuses masquerade as independent evidence.
        const observed = (wins + PRIOR_SAMPLES * baseWin) / (ticks.length + PRIOR_SAMPLES);
        const eligible = lessons.map(lesson => ({ id: lesson.id, lift: lessonLift(lesson, market.symbol, direction, barrier, ticks, now) }))
          .filter(item => item.lift !== 0).sort((a, b) => Math.abs(b.lift) - Math.abs(a.lift) || a.id.localeCompare(b.id));
        // Correlated lessons must never stack. Only the strongest verified lift.
        const used = eligible[0], adjustment = used?.lift ?? 0;
        const probability = clamp(observed + adjustment, .001, .999);
        const ratio = .95 / baseWin;
        const edge = probability - 1 / ratio, expectedROI = probability * ratio - 1;
        // Display-only range rules use the same final facts shown on the cow.
        // They cannot weight the prediction, so this introduces no feedback loop.
        const matchedLessons = lessons.filter(lesson => matchesLesson(lesson, market.symbol, direction, barrier, ticks,
          probability, edge, now));
        const facts: Omit<CoreDecision, 'setup'> = {
          engineVersion: CORE_ENGINE_VERSION,
          decisionId: ['core-v1', encodeURIComponent(market.symbol), last.segment ?? 'segment', last.sequence ?? last.epoch, dataKey, direction, barrier].join(':'),
          market: market.symbol, display: market.display || market.symbol, direction, barrier, duration: 1, durationUnit: 't', at: now,
          cutoff: { ...last, precision: Number.isInteger(market.precision) && market.precision! >= 0 ? market.precision! : null },
          baseWin, estWin: probability, probability, estPayout: ratio, edge, expectedROI, quality: expectedROI,
          consistency: ticks.length / (ticks.length + PRIOR_SAMPLES), entropy: distributionEntropy,
          momentum: observed, shortLongDeviation: 0, transitionProb: baseWin, transitionSamples: 0,
          learnedWin: used ? probability : null, fresh, hitSignal: false, lessonIds: used ? [used.id] : [],
          lessonMatches: matchedLessons.map(lesson => ({ id: lesson.id,
            state: lesson.id === used?.id ? adjustment < 0 ? 'caution' as const : 'applied' as const : 'matched' as const })),
          features: { samples: ticks.length, wins, empiricalWin: empirical, priorSamples: PRIOR_SAMPLES, lessonAdjustment: adjustment },
          evidence: { samples: ticks.length, lessonsUsed: used ? 1 : 0, status: ticks.length >= 200 ? 'observed' : 'collecting', calibrated: false },
          payoutSource: 'estimate', quote: null,
        };
        const decision: CoreDecision = { ...facts, setup: deriveCoreSetup(facts) };
        const offered = market.payoutRatios?.find(q => q.direction === direction && q.barrier === barrier &&
          Number.isFinite(q.quotedAt) && q.quotedAt! >= last.epoch * 1000 && q.quotedAt! <= now && now - q.quotedAt! <= 5000 && q.ratio > 1);
        out.push(offered ? evaluateCoreQuote(decision, 1, offered.ratio, offered.quotedAt) : freeze(decision));
      }
    }
  }
  return out.sort((a, b) => b.expectedROI - a.expectedROI || b.probability - a.probability || a.market.localeCompare(b.market) || a.direction.localeCompare(b.direction) || a.barrier - b.barrier);
}
export function findCoreDecision(
  market: CoreMarketInput, direction: CoreDirection, barrier: number,
  lessons: readonly CoreLessonEvidence[] = [], now = Date.now(),
): CoreDecision | null {
  coreBaseWin(direction, barrier);
  return rankCoreCandidates([market], lessons, now).find(c => c.direction === direction && c.barrier === barrier) ?? null;
}
/** Reprice this exact decision; changing a contract requires a new decision. */
export function evaluateCoreQuote(decision: CoreDecision, ask: number, payout: number, quotedAt = Date.now()): CoreDecision {
  if (!Number.isFinite(ask) || ask <= 0 || !Number.isFinite(payout) || payout <= ask || !Number.isFinite(quotedAt) ||
      quotedAt < decision.cutoff.epoch * 1000) throw new RangeError('Invalid live quote');
  const breakeven = ask / payout, edge = decision.probability - breakeven, expectedROI = decision.probability * payout / ask - 1;
  const quoted = {
    ...decision, estPayout: payout / ask, edge, expectedROI, quality: expectedROI, payoutSource: 'live_quote' as const,
    quote: { ask, payout, breakeven, edge, expectedROI, quotedAt },
  };
  return freeze({ ...quoted, setup: deriveCoreSetup(quoted) });
}
