/**
 * Serializes account commands while allowing bounded independent settlements.
 * It is intentionally provider-agnostic: routes supply quote/buy/sell work;
 * the coordinator owns admission, ordering and release. Paper/replay work must
 * never enter this class.
 */
export type AccountProduct = 'digits' | 'momentum' | 'gold';
export type AccountCommandPriority = 'manual_close' | 'manual_open' | 'bot' | 'test';

export interface AccountExecutionPolicy {
  maxOpenContracts: number;
  maxReservedExposure: number;
  maxOpenPerProduct: Partial<Record<AccountProduct, number>>;
  maxConcurrentSettlements: number;
}

export interface AccountReservation {
  id: string;
  accountId: string;
  product: AccountProduct;
  exposure: number;
  createdAt: number;
}

export interface AccountCoordinatorState {
  accountId: string;
  active: number;
  reservedExposure: number;
  queuedCommands: number;
  activeSettlements: number;
  byProduct: Record<AccountProduct, number>;
}

const DEFAULT_POLICY: AccountExecutionPolicy = {
  maxOpenContracts: 6,
  maxReservedExposure: 100,
  maxOpenPerProduct: { digits: 3, momentum: 2, gold: 2 },
  maxConcurrentSettlements: 3,
};

interface AccountState {
  reservations: Map<string, AccountReservation>;
  commandTail: Promise<void>;
  queued: number;
  settlements: number;
  settlementQueue: Array<() => void>;
}

function newState(): AccountState {
  return { reservations: new Map(), commandTail: Promise.resolve(), queued: 0, settlements: 0, settlementQueue: [] };
}

/**
 * One coordinator instance owns every account-funded Deriv command in the
 * server process. Commands are short (proposal/freshness/buy/sell); long
 * settlement monitoring uses a separate bounded pool so scanning stays fast.
 */
export class AccountCoordinator {
  private readonly accounts = new Map<string, AccountState>();
  private sequence = 0;
  private readonly policy: AccountExecutionPolicy;

  constructor(policy: AccountExecutionPolicy = DEFAULT_POLICY) {
    this.policy = policy;
  }

  reserve(input: { accountId: string; product: AccountProduct; exposure: number; now?: number }): AccountReservation {
    if (!input.accountId) throw new Error('account id is required');
    if (!(Number.isFinite(input.exposure) && input.exposure > 0)) throw new Error('reserved exposure must be positive');
    const state = this.account(input.accountId);
    const active = [...state.reservations.values()];
    if (active.length >= this.policy.maxOpenContracts) throw new Error('account open-contract limit reached');
    const total = active.reduce((sum, item) => sum + item.exposure, 0);
    if (total + input.exposure > this.policy.maxReservedExposure + 1e-9) throw new Error('account reserved-exposure limit reached');
    const productCount = active.filter((item) => item.product === input.product).length;
    const productCap = this.policy.maxOpenPerProduct[input.product] ?? this.policy.maxOpenContracts;
    if (productCount >= productCap) throw new Error(`${input.product} open-contract limit reached`);
    const reservation: AccountReservation = {
      id: `${input.accountId}:${Date.now()}:${++this.sequence}`,
      accountId: input.accountId,
      product: input.product,
      exposure: input.exposure,
      createdAt: input.now ?? Date.now(),
    };
    state.reservations.set(reservation.id, reservation);
    return reservation;
  }

  release(reservation: AccountReservation | string): void {
    const id = typeof reservation === 'string' ? reservation : reservation.id;
    const accountId = typeof reservation === 'string' ? id.split(':', 1)[0] : reservation.accountId;
    if (accountId) this.account(accountId).reservations.delete(id);
  }

  /** FIFO account command lane. Priority is exposed for callers/UI today;
   * manual close can be routed before queued test work in the next persisted
   * coordinator migration without changing the API. */
  runCommand<T>(_priority: AccountCommandPriority, accountId: string, work: () => Promise<T>): Promise<T> {
    const state = this.account(accountId);
    state.queued += 1;
    const run = state.commandTail.then(work, work);
    state.commandTail = run.then(() => undefined, () => undefined);
    return run.finally(() => { state.queued = Math.max(0, state.queued - 1); });
  }

  async supervise<T>(accountId: string, work: () => Promise<T>): Promise<T> {
    const state = this.account(accountId);
    if (state.settlements >= this.policy.maxConcurrentSettlements) {
      await new Promise<void>((resolve) => state.settlementQueue.push(resolve));
    }
    state.settlements += 1;
    try {
      return await work();
    } finally {
      state.settlements = Math.max(0, state.settlements - 1);
      state.settlementQueue.shift()?.();
    }
  }

  state(accountId: string): AccountCoordinatorState {
    const state = this.account(accountId);
    const active = [...state.reservations.values()];
    const byProduct: Record<AccountProduct, number> = { digits: 0, momentum: 0, gold: 0 };
    for (const reservation of active) byProduct[reservation.product] += 1;
    return {
      accountId,
      active: active.length,
      reservedExposure: active.reduce((sum, item) => sum + item.exposure, 0),
      queuedCommands: state.queued,
      activeSettlements: state.settlements,
      byProduct,
    };
  }

  private account(accountId: string): AccountState {
    let state = this.accounts.get(accountId);
    if (!state) {
      state = newState();
      this.accounts.set(accountId, state);
    }
    return state;
  }
}
