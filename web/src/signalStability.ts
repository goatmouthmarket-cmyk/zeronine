export interface SignalIdentity {
  market: string;
  direction: string;
  barrier: number;
  edge: number;
}

export interface SignalEnvelope<C extends SignalIdentity> {
  candidates: C[];
  holds: boolean;
  reason: string;
}

const MIN_EDGE_IMPROVEMENT = 0.03;
const REQUIRED_CHALLENGER_SCANS = 6;
const EMPTY_SIGNAL_GRACE_MS = 15_000;

function keyOf(candidate: SignalIdentity): string {
  return `${candidate.market}|${candidate.direction}|${candidate.barrier}`;
}

export class SignalStabilizer<C extends SignalIdentity> {
  private visible: SignalEnvelope<C> | null = null;
  private challengerKey: string | null = null;
  private challengerWins = 0;
  private currentMissingSince: number | null = null;
  private emptySince: number | null = null;

  reset(): void {
    this.visible = null;
    this.challengerKey = null;
    this.challengerWins = 0;
    this.currentMissingSince = null;
    this.emptySince = null;
  }

  update(incoming: SignalEnvelope<C>, now = Date.now()): SignalEnvelope<C> | null {
    if (incoming.candidates.length === 0) {
      this.emptySince ??= now;
      this.challengerKey = null;
      this.challengerWins = 0;
      if (this.visible && now - this.emptySince < EMPTY_SIGNAL_GRACE_MS) return this.visible;
      this.reset();
      return null;
    }

    this.emptySince = null;
    const challenger = incoming.candidates[0];
    if (!challenger) return this.visible;
    const current = this.visible?.candidates[0];
    if (!current) {
      this.visible = incoming;
      return incoming;
    }

    const currentKey = keyOf(current);
    const challengerKey = keyOf(challenger);
    const updatedCurrent = incoming.candidates.find((candidate) => keyOf(candidate) === currentKey);
    if (challengerKey === currentKey) {
      this.challengerKey = null;
      this.challengerWins = 0;
      this.currentMissingSince = null;
      this.visible = incoming;
      return incoming;
    }

    if (updatedCurrent) this.currentMissingSince = null;
    else this.currentMissingSince ??= now;
    const currentEdge = updatedCurrent?.edge ?? current.edge;
    const eligible =
      challenger.edge >= currentEdge + MIN_EDGE_IMPROVEMENT ||
      (this.currentMissingSince !== null && now - this.currentMissingSince >= EMPTY_SIGNAL_GRACE_MS);

    if (eligible && this.challengerKey === challengerKey) this.challengerWins += 1;
    else if (eligible) {
      this.challengerKey = challengerKey;
      this.challengerWins = 1;
    } else {
      this.challengerKey = null;
      this.challengerWins = 0;
    }

    if (eligible && this.challengerWins >= REQUIRED_CHALLENGER_SCANS) {
      this.visible = incoming;
      this.challengerKey = null;
      this.challengerWins = 0;
      this.currentMissingSince = null;
      return incoming;
    }

    const pinned = updatedCurrent ?? current;
    this.visible = {
      ...incoming,
      candidates: [pinned, ...incoming.candidates.filter((candidate) => keyOf(candidate) !== currentKey)],
    };
    return this.visible;
  }
}
