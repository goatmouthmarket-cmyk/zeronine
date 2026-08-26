export interface ConfirmableSignal {
  market: string;
  direction: 'over' | 'under';
  barrier: number;
  tickEpoch: number;
}

export interface SignalConfirmationState {
  phase: 'observing' | 'watching' | 'confirmed';
  key: string | null;
  confirmations: number;
  required: number;
  lastTickEpoch: number | null;
}

function signalKey(signal: ConfirmableSignal): string {
  return `${signal.market}|${signal.direction}|${signal.barrier}`;
}

/**
 * Confirms that the same qualified contract remains strongest across distinct
 * market ticks. Timer cycles never count as evidence: only a newer tick epoch
 * for the candidate market can advance the state.
 */
export class SignalConfirmationGate {
  private current: SignalConfirmationState = {
    phase: 'observing',
    key: null,
    confirmations: 0,
    required: 1,
    lastTickEpoch: null,
  };

  reset(required = this.current.required): SignalConfirmationState {
    this.current = {
      phase: 'observing',
      key: null,
      confirmations: 0,
      required: Math.max(1, Math.trunc(required)),
      lastTickEpoch: null,
    };
    return this.state();
  }

  state(): SignalConfirmationState {
    return { ...this.current };
  }

  observe(signal: ConfirmableSignal | null, required: number): SignalConfirmationState {
    const needed = Math.max(1, Math.trunc(required));
    if (!signal || !Number.isFinite(signal.tickEpoch) || signal.tickEpoch <= 0) return this.reset(needed);

    const key = signalKey(signal);
    if (this.current.key !== key || this.current.required !== needed) {
      this.current = {
        phase: needed === 1 ? 'confirmed' : 'watching',
        key,
        confirmations: 1,
        required: needed,
        lastTickEpoch: signal.tickEpoch,
      };
      return this.state();
    }

    if (this.current.lastTickEpoch !== null && signal.tickEpoch < this.current.lastTickEpoch) {
      return this.reset(needed);
    }
    if (signal.tickEpoch > (this.current.lastTickEpoch ?? 0)) {
      this.current.confirmations = Math.min(needed, this.current.confirmations + 1);
      this.current.lastTickEpoch = signal.tickEpoch;
    }
    this.current.phase = this.current.confirmations >= needed ? 'confirmed' : 'watching';
    return this.state();
  }
}

export function confirmationTicksForMode(mode: string): number {
  if (mode === 'rapid') return 1;
  if (mode === 'strict') return 3;
  return 2;
}
