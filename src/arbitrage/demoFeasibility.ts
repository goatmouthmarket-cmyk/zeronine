import type { Hub } from '../api/hub.ts';
import type { Direction } from '../core/digitMath.ts';
import type { ContractUpdate, DerivPrivateClient, QuoteResult } from '../deriv/privateClient.ts';
import {
  getArbExecution,
  getArbExecutionLegs,
  insertArbExecution,
  type ArbExecutionLegRow,
  type ArbExecutionRow,
  updateArbExecution,
  upsertArbExecutionLeg,
} from '../db/store.ts';
import { arbPairKey, calculateArbitrage, isComplementaryPair, type ArbPair, type ArbQuote } from './core.ts';
import { assessDualLegFeasibility, type DualLegResult } from './feasibility.ts';
import { claimArbExecution, releaseArbExecution } from './occupancy.ts';

export interface ArbDemoExecutionInput {
  accountId: string;
  symbol: string;
  currency: string;
  pair: ArbPair;
  targetPayout: number;
}

export interface ArbDemoExecutionState {
  execution: ArbExecutionRow;
  legs: ArbExecutionLegRow[];
}

type LegSpec = { leg: 'under' | 'over'; direction: Direction; barrier: number };

function errorParts(error: unknown): { code: string; message: string } {
  const message = String(error instanceof Error ? error.message : error);
  const code = /^(\w+):/.exec(message)?.[1] ?? 'buy_error';
  return { code, message: message.slice(0, 500) };
}

/** A response timeout can occur after the provider received a buy; never retry it. */
function isUnknownBuyFailure(error: unknown): boolean {
  return /timeout|socket|disconnect|network|private socket/i.test(String(error));
}

function emptyLeg(executionId: string, spec: LegSpec): Omit<ArbExecutionLegRow, 'id'> {
  return {
    execution_id: executionId, leg: spec.leg, direction: spec.direction, barrier: spec.barrier,
    proposal_id: null, ask_price: null, payout: null, quote_sent_at: null, quote_received_at: null, quote_round_trip_ms: null,
    buy_sent_at: null, buy_completed_at: null, status: 'quoted', contract_id: null, buy_price: null,
    error_code: null, error_message: null, date_start: null, date_expiry: null, entry_tick_time: null, exit_tick_time: null,
    settlement_status: null, settlement_profit: null, settled_at: null,
  };
}

function applyQuote(row: Omit<ArbExecutionLegRow, 'id'>, quote: QuoteResult): Omit<ArbExecutionLegRow, 'id'> {
  return { ...row, proposal_id: quote.id, ask_price: quote.askPrice, payout: quote.payout, quote_sent_at: quote.requestSentAt,
    quote_received_at: quote.receivedAt, quote_round_trip_ms: quote.roundTripMs };
}

function asArbQuote(input: ArbDemoExecutionInput, spec: LegSpec, quote: QuoteResult): ArbQuote {
  return {
    symbol: input.symbol, currency: input.currency, duration: 1, durationUnit: 't', basis: 'payout', requestedPayout: input.targetPayout,
    askPrice: quote.askPrice, payout: quote.payout, proposalId: quote.id, direction: spec.direction, barrier: spec.barrier,
    requestSentAt: quote.requestSentAt, receivedAt: quote.receivedAt, roundTripMs: quote.roundTripMs,
  };
}

function legResult(row: ArbExecutionLegRow): DualLegResult {
  return {
    leg: row.leg,
    status: row.status === 'filled' ? 'filled' : row.status === 'unknown' ? 'unknown' : 'rejected',
    buySentAt: row.buy_sent_at ?? 0,
    buyCompletedAt: row.buy_completed_at ?? undefined,
    contractId: row.contract_id ?? undefined,
    errorCode: row.error_code ?? undefined,
    errorMessage: row.error_message ?? undefined,
    dateStart: row.date_start ?? undefined,
    dateExpiry: row.date_expiry ?? undefined,
    entryTickTime: row.entry_tick_time ?? undefined,
    exitTickTime: row.exit_tick_time ?? undefined,
  };
}

/**
 * Deliberately narrow demo-only saga. This module never creates a normal
 * trade, recovery, or ledger entry because its partial-fill behavior is not a
 * supported normal trading outcome.
 */
export class ArbDemoFeasibility {
  private readonly client: DerivPrivateClient;
  private readonly hub: Hub;

  constructor(client: DerivPrivateClient, hub: Hub) {
    this.client = client;
    this.hub = hub;
  }

  state(id: string): ArbDemoExecutionState | null {
    const execution = getArbExecution(id);
    return execution ? { execution, legs: getArbExecutionLegs(id) } : null;
  }

  async start(input: ArbDemoExecutionInput): Promise<ArbDemoExecutionState> {
    if (!isComplementaryPair(input.pair)) throw new Error('only adjacent complementary U(n)/O(n-1) pairs are permitted');
    if (!Number.isFinite(input.targetPayout) || input.targetPayout <= 0) throw new Error('target payout must be greater than zero');
    const id = crypto.randomUUID();
    if (!claimArbExecution(id)) throw new Error('another paired feasibility execution is still active');

    const now = Date.now();
    const specs: LegSpec[] = [
      { leg: 'under', direction: 'under', barrier: input.pair.underBarrier },
      { leg: 'over', direction: 'over', barrier: input.pair.overBarrier },
    ];
    insertArbExecution({
      id, created_at: now, updated_at: now, completed_at: null, account_id: input.accountId, account_mode: 'demo',
      symbol: input.symbol, currency: input.currency, pair_key: arbPairKey(input.pair), under_barrier: input.pair.underBarrier,
      over_barrier: input.pair.overBarrier, target_payout: input.targetPayout, status: 'quoting', feasibility_status: null,
      settlement_alignment: null, buy_request_gap_ms: null, buy_fill_gap_ms: null, quote_gap_ms: null, reason: null,
    });
    specs.forEach((spec) => upsertArbExecutionLeg(emptyLeg(id, spec)));
    this.emit(id);

    try {
      const quoteOutcomes = await Promise.allSettled(specs.map((spec) => this.client.getQuote({
        direction: spec.direction, barrier: spec.barrier, amount: input.targetPayout, currency: input.currency,
        duration: 1, durationUnit: 't', symbol: input.symbol, basis: 'payout',
      })));
      const quotes: Array<QuoteResult | null> = quoteOutcomes.map((outcome, index) => {
        const base = emptyLeg(id, specs[index]!);
        if (outcome.status === 'fulfilled') {
          upsertArbExecutionLeg(applyQuote(base, outcome.value));
          return outcome.value;
        }
        const error = errorParts(outcome.reason);
        upsertArbExecutionLeg({ ...base, status: 'rejected', error_code: error.code, error_message: error.message });
        return null;
      });
      if (!quotes[0] || !quotes[1]) {
        updateArbExecution(id, { status: 'quote_failed', completed_at: Date.now(), reason: 'both fresh payout-basis proposals were not returned' });
        releaseArbExecution(id);
        this.emit(id);
        return this.requiredState(id);
      }

      const calculation = calculateArbitrage(input.pair, asArbQuote(input, specs[0]!, quotes[0]), asArbQuote(input, specs[1]!, quotes[1]));
      if (calculation.status !== 'valid') {
        updateArbExecution(id, { status: 'quote_failed', completed_at: Date.now(), quote_gap_ms: calculation.quoteGapMs ?? null, reason: calculation.reason ?? 'invalid paired proposals' });
        releaseArbExecution(id);
        this.emit(id);
        return this.requiredState(id);
      }

      updateArbExecution(id, { status: 'buying', quote_gap_ms: calculation.quoteGapMs ?? null });
      this.emit(id);
      const buyResults = await Promise.all(specs.map((spec, index) => this.buyLeg(id, spec, quotes[index]!)));
      const feasibility = assessDualLegFeasibility(buyResults[0]!, buyResults[1]!);
      const filled = buyResults.filter((leg) => leg.status === 'filled');
      const status = filled.length
        ? 'settling'
        : feasibility.status === 'partial_fill'
          ? 'partial_fill'
          : feasibility.status === 'both_failed'
            ? 'both_failed'
            : 'unknown_execution';
      updateArbExecution(id, {
        status,
        feasibility_status: feasibility.status, settlement_alignment: feasibility.alignment,
        buy_request_gap_ms: feasibility.buyRequestGapMs, buy_fill_gap_ms: feasibility.buyFillGapMs,
        completed_at: filled.length ? null : Date.now(),
      });
      this.emit(id);
      if (!filled.length) {
        releaseArbExecution(id);
        return this.requiredState(id);
      }

      // Capture provider lifecycle evidence in the background. The occupancy
      // lock remains held until every filled leg is terminal or times out.
      void this.captureSettlements(id).catch((error) => {
        console.warn(`[arb-feasibility] settlement capture failed: ${String(error)}`);
        updateArbExecution(id, { status: 'unknown_execution', completed_at: Date.now(), reason: 'settlement capture failed' });
        releaseArbExecution(id);
        this.emit(id);
      });
      return this.requiredState(id);
    } catch (error) {
      console.warn(`[arb-feasibility] execution setup failed: ${String(error)}`);
      updateArbExecution(id, { status: 'unknown_execution', completed_at: Date.now(), reason: String(error).slice(0, 500) });
      releaseArbExecution(id);
      this.emit(id);
      return this.requiredState(id);
    }
  }

  private async buyLeg(id: string, spec: LegSpec, quote: QuoteResult): Promise<DualLegResult> {
    const base = applyQuote(emptyLeg(id, spec), quote);
    const buySentAt = Date.now();
    upsertArbExecutionLeg({ ...base, buy_sent_at: buySentAt });
    try {
      const bought = await this.client.placeBuy(quote.id, quote.askPrice);
      const buyCompletedAt = Date.now();
      upsertArbExecutionLeg({ ...base, buy_sent_at: buySentAt, buy_completed_at: buyCompletedAt, status: 'filled', contract_id: bought.contractId, buy_price: bought.buyPrice });
      return { leg: spec.leg, status: 'filled', buySentAt, buyCompletedAt, contractId: bought.contractId };
    } catch (error) {
      const failure = errorParts(error);
      const status = isUnknownBuyFailure(error) ? 'unknown' : 'rejected';
      upsertArbExecutionLeg({ ...base, buy_sent_at: buySentAt, buy_completed_at: Date.now(), status, error_code: failure.code, error_message: failure.message });
      return { leg: spec.leg, status, buySentAt, buyCompletedAt: Date.now(), errorCode: failure.code, errorMessage: failure.message };
    }
  }

  private async captureSettlements(id: string): Promise<void> {
    const state = this.requiredState(id);
    const filled = state.legs.filter((leg) => leg.status === 'filled' && leg.contract_id);
    await Promise.all(filled.map(async (leg) => {
      const outcome = await this.client.settleContract(leg.contract_id!, () => undefined);
      this.recordSettlement(leg, outcome);
    }));
    const legs = getArbExecutionLegs(id);
    const under = legs.find((leg) => leg.leg === 'under');
    const over = legs.find((leg) => leg.leg === 'over');
    if (!under || !over) throw new Error('execution legs disappeared during settlement capture');
    const feasibility = assessDualLegFeasibility(legResult(under), legResult(over));
    updateArbExecution(id, {
      status: 'completed', completed_at: Date.now(), feasibility_status: feasibility.status,
      settlement_alignment: feasibility.alignment, buy_request_gap_ms: feasibility.buyRequestGapMs, buy_fill_gap_ms: feasibility.buyFillGapMs,
    });
    releaseArbExecution(id);
    this.emit(id);
  }

  private recordSettlement(leg: ArbExecutionLegRow, outcome: ContractUpdate): void {
    upsertArbExecutionLeg({
      ...leg,
      status: leg.status,
      settlement_status: outcome.settled ? outcome.status : 'unsettled', settlement_profit: outcome.profit,
      date_start: outcome.dateStart ?? null, date_expiry: outcome.dateExpiry ?? null,
      entry_tick_time: outcome.entryTickTime ?? null, exit_tick_time: outcome.exitTickTime ?? null,
      settled_at: outcome.settled ? Date.now() : null,
    });
  }

  private requiredState(id: string): ArbDemoExecutionState {
    const value = this.state(id);
    if (!value) throw new Error('arb execution persistence unavailable');
    return value;
  }

  private emit(id: string): void {
    const state = this.state(id);
    if (state) this.hub.emit({ type: 'arb_execution', ts: Date.now(), state });
  }
}
