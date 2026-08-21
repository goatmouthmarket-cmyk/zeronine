import { winDigits } from '../core/digitMath.ts';
import { insertDecisionEvent, pruneDecisionEvents, resolveDecisionEvent } from '../db/store.ts';
import type { DecisionAction, DecisionEventInput } from '../db/store.ts';

export interface MemoryDecision extends Omit<DecisionEventInput, 'action'> {
  action: DecisionAction;
  counterfactual?: boolean;
}

interface PendingDecision {
  id: number;
  market: string;
  direction: 'over' | 'under';
  barrier: number;
  expiresAt: number;
}

/**
 * Bounded evidence collection for decisions that can be objectively checked
 * against the next tick. It never participates in execution or tuning.
 */
export class DecisionMemory {
  private readonly pending = new Map<number, PendingDecision>();
  private readonly recent = new Map<string, number>();

  remember(decision: MemoryDecision): number | null {
    const key = `${decision.action}|${decision.market}|${decision.direction ?? ''}|${decision.barrier ?? ''}|${decision.reason}`;
    const now = decision.ts;
    const previous = this.recent.get(key);
    if (previous !== undefined && previous + 5_000 > now) return null;
    this.recent.set(key, now);
    const expiresAt = decision.expires_at ?? now + 60_000;
    const id = insertDecisionEvent({ ...decision, expires_at: expiresAt });
    if (decision.counterfactual && (decision.direction === 'over' || decision.direction === 'under') && Number.isInteger(decision.barrier)) {
      this.pending.set(id, { id, market: decision.market, direction: decision.direction, barrier: Number(decision.barrier), expiresAt });
      while (this.pending.size > 200) {
        const oldest = this.pending.keys().next().value as number | undefined;
        if (oldest === undefined) break;
        resolveDecisionEvent(oldest, 'expired', now);
        this.pending.delete(oldest);
      }
    }
    if (this.recent.size > 500) this.recent.clear();
    if (id % 100 === 0) pruneDecisionEvents();
    return id;
  }

  onTick(market: string, digit: number, now = Date.now()): void {
    for (const pending of [...this.pending.values()]) {
      if (pending.expiresAt < now) {
        resolveDecisionEvent(pending.id, 'expired', now);
        this.pending.delete(pending.id);
        continue;
      }
      if (pending.market !== market || !Number.isInteger(digit)) continue;
      resolveDecisionEvent(pending.id, winDigits(pending.direction, pending.barrier).includes(digit) ? 'won' : 'lost', now);
      this.pending.delete(pending.id);
    }
  }
}
