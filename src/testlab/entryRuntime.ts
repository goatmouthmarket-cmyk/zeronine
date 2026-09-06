import {
  EntryMethodGate,
  chooseEntryChampion,
  entryMethodsFor,
  type EntryChampion,
  type EntryDecision,
  type EntryMethodEvidence,
  type EntryMethodId,
  type EntryObservation,
  type EntryProduct,
} from './entry.ts';

export interface EntryResearchMethodState extends EntryMethodEvidence {
  wins: number;
  losses: number;
  openSamples: number;
  lastDecision: EntryDecision['state'] | 'idle';
  lastReason: string;
  /** Bounded virtual equity history for UI only. */
  equity: number[];
}

export interface EntryResearchProductState {
  product: EntryProduct;
  champion: EntryChampion;
  methods: EntryResearchMethodState[];
  updatedAt: number;
}

export interface EntryResearchState {
  mode: 'paper-research';
  running: true;
  products: EntryResearchProductState[];
  updatedAt: number;
}

export interface EntryResearchOutcome {
  product: EntryProduct;
  methodId: EntryMethodId;
  signalId: string;
  /** Virtual research result only. This is never sent to an account or broker. */
  pnl: number;
  resolvedAt?: number;
}

export interface EntryResearchRuntimeOptions {
  now?: () => number;
  minSamples?: number;
  freshnessMs?: number;
  challengerMargin?: number;
  /** State transition notification. Keep observers lightweight; the runtime never awaits them. */
  onState?: (state: EntryResearchState) => void;
}

/** Compact browser-safe view model. It deliberately contains only virtual
 * research metrics, never account balances, contracts, or provider tokens. */
export interface EntryLabDashboardState {
  enabled: true;
  updatedAt: number;
  products: Array<{
    product: EntryProduct;
    enabled: true;
    state: 'testing' | 'waiting';
    updatedAt: number;
    provenMethodId: EntryMethodId | null;
    note: string;
    methods: Array<{
      id: EntryMethodId;
      label: string;
      status: 'testing' | 'waiting' | 'promoted' | 'rejected';
      samples: number;
      wins: number;
      netPnl: number;
      drawdownPct: number;
      confidence: number;
      equity: number[];
      reason: string;
    }>;
  }>;
}

export function entryLabDashboardState(state: EntryResearchState): EntryLabDashboardState {
  return {
    enabled: true,
    updatedAt: state.updatedAt,
    products: state.products.map((product) => ({
      product: product.product,
      enabled: true,
      state: product.methods.some((method) => method.openSamples > 0 || method.lastDecision === 'ready') ? 'testing' : 'waiting',
      updatedAt: product.updatedAt,
      provenMethodId: product.champion.methodId,
      note: product.champion.reason,
      methods: product.methods.map((method) => {
        const definition = entryMethodsFor(product.product).find((item) => item.id === method.methodId);
        const status = product.champion.methodId === method.methodId
          ? 'promoted'
          : method.lastDecision === 'skip'
            ? 'rejected'
            : method.openSamples > 0 || method.lastDecision === 'ready'
              ? 'testing'
              : 'waiting';
        return {
          id: method.methodId,
          label: definition?.label ?? method.methodId,
          status,
          samples: method.samples,
          wins: method.wins,
          netPnl: method.netPnl,
          drawdownPct: method.samples > 0 ? method.maxDrawdown / Math.max(1, Math.abs(method.netPnl) + method.maxDrawdown) * 100 : 0,
          confidence: product.champion.methodId === method.methodId ? product.champion.confidence * 100 : 0,
          equity: [...method.equity],
          reason: product.champion.methodId === method.methodId ? product.champion.reason : method.lastReason,
        };
      }),
    })),
  };
}

interface MutableMethodState extends EntryResearchMethodState {
  gate: EntryMethodGate;
  pending: Map<string, number>;
  peakEquity: number;
  totalDelay: number;
}

const PRODUCTS: readonly EntryProduct[] = ['digits', 'multipliers', 'gold'];

function cloneMethod(row: EntryResearchMethodState): EntryResearchMethodState {
  return { ...row };
}

/**
 * Event-driven, virtual-only entry-method research coordinator. It owns no
 * websocket, quote, buy, close, balance, or persistence operation. Feed
 * adapters can call observe()/recordOutcome() at their own cadence without
 * letting research delay an execution path.
 */
export class EntryResearchRuntime {
  private readonly now: () => number;
  private readonly onState: EntryResearchRuntimeOptions['onState'];
  private readonly options: Required<Pick<EntryResearchRuntimeOptions, 'minSamples' | 'freshnessMs' | 'challengerMargin'>>;
  private readonly methods = new Map<EntryProduct, Map<EntryMethodId, MutableMethodState>>();
  private readonly champions = new Map<EntryProduct, EntryChampion>();
  private updatedAt = 0;

  constructor(options: EntryResearchRuntimeOptions = {}) {
    this.now = options.now ?? Date.now;
    this.onState = options.onState;
    this.options = {
      minSamples: Math.max(1, options.minSamples ?? 30),
      freshnessMs: Math.max(1_000, options.freshnessMs ?? 12 * 60 * 60 * 1_000),
      challengerMargin: Math.max(0, options.challengerMargin ?? .05),
    };
    for (const product of PRODUCTS) {
      const rows = new Map<EntryMethodId, MutableMethodState>();
      for (const definition of entryMethodsFor(product)) {
        rows.set(definition.id, {
          product,
          methodId: definition.id,
          samples: 0,
          netPnl: 0,
          maxDrawdown: 0,
          averageDelay: 0,
          updatedAt: 0,
          wins: 0,
          losses: 0,
          openSamples: 0,
          lastDecision: 'idle',
          lastReason: 'waiting for a qualified research signal',
          gate: new EntryMethodGate(product, definition.id),
          pending: new Map(),
          peakEquity: 0,
          totalDelay: 0,
          equity: [0],
        });
      }
      this.methods.set(product, rows);
      this.champions.set(product, { methodId: null, confidence: 0, reason: 'collecting entry evidence' });
    }
  }

  /** Advance all product-specific gates with one ordered, normalized observation. */
  observe(observation: EntryObservation): EntryDecision[] {
    const methods = this.methods.get(observation.product);
    if (!methods) return [];
    const now = this.now();
    const decisions: EntryDecision[] = [];
    let changed = false;
    for (const row of methods.values()) {
      const decision = row.gate.observe(observation);
      decisions.push(decision);
      if (row.lastDecision !== decision.state || row.lastReason !== decision.reason) changed = true;
      row.lastDecision = decision.state;
      row.lastReason = decision.reason;
      if (decision.state === 'ready' && !row.pending.has(observation.signalId)) {
        row.pending.set(observation.signalId, now);
        row.openSamples = row.pending.size;
        changed = true;
      }
    }
    if (changed) this.publish(now);
    return decisions;
  }

  /** Resolve one pending virtual entry. Unknown/late results are ignored. */
  recordOutcome(outcome: EntryResearchOutcome): boolean {
    const row = this.methods.get(outcome.product)?.get(outcome.methodId);
    if (!row || !Number.isFinite(outcome.pnl)) return false;
    const openedAt = row.pending.get(outcome.signalId);
    if (openedAt == null) return false;
    row.pending.delete(outcome.signalId);
    row.openSamples = row.pending.size;
    const resolvedAt = outcome.resolvedAt ?? this.now();
    const delay = Math.max(0, resolvedAt - openedAt) / 1_000;
    row.samples += 1;
    row.netPnl += outcome.pnl;
    row.totalDelay += delay;
    row.averageDelay = row.totalDelay / row.samples;
    const currentEquity = (row.equity.at(-1) ?? 0) + outcome.pnl;
    row.equity = [...row.equity, currentEquity].slice(-40);
    row.peakEquity = Math.max(row.peakEquity, currentEquity);
    row.maxDrawdown = Math.max(row.maxDrawdown, row.peakEquity - currentEquity);
    if (outcome.pnl > 0) row.wins += 1;
    else if (outcome.pnl < 0) row.losses += 1;
    row.updatedAt = resolvedAt;
    row.lastDecision = 'idle';
    row.lastReason = outcome.pnl > 0 ? 'virtual outcome won' : outcome.pnl < 0 ? 'virtual outcome lost' : 'virtual outcome flat';
    this.refreshChampion(outcome.product, resolvedAt);
    this.publish(resolvedAt);
    return true;
  }

  state(): EntryResearchState {
    return {
      mode: 'paper-research',
      running: true,
      products: PRODUCTS.map((product) => ({
        product,
        champion: { ...(this.champions.get(product) ?? { methodId: null, confidence: 0, reason: 'collecting entry evidence' }) },
        methods: [...(this.methods.get(product)?.values() ?? [])].map(cloneMethod).sort((a, b) => a.methodId.localeCompare(b.methodId)),
        updatedAt: Math.max(0, ...(Array.from(this.methods.get(product)?.values() ?? []).map((row) => row.updatedAt))),
      })),
      updatedAt: this.updatedAt,
    };
  }

  private refreshChampion(product: EntryProduct, now: number): void {
    const incumbent = this.champions.get(product)?.methodId ?? null;
    const evidence: EntryMethodEvidence[] = [...(this.methods.get(product)?.values() ?? [])].map((row) => ({
      product: row.product,
      methodId: row.methodId,
      samples: row.samples,
      netPnl: row.netPnl,
      maxDrawdown: row.maxDrawdown,
      averageDelay: row.averageDelay,
      updatedAt: row.updatedAt,
    }));
    this.champions.set(product, chooseEntryChampion(evidence, { product, incumbent, now, ...this.options }));
  }

  private publish(now: number): void {
    this.updatedAt = now;
    // A dashboard subscriber cannot block market-data or execution callers.
    try { this.onState?.(this.state()); } catch { /* observer failures are isolated */ }
  }
}
