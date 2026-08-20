export type HubEventType =
  | 'tick'
  | 'feed'
  | 'session'
  | 'balance'
  | 'hello'
  | 'status'
  | 'signal'
  | 'quote'
  | 'quote_error'
  | 'decision'
  | 'hold'
  | 'cooldown'
  | 'trade'
  | 'contract'
  | 'recovery'
  | 'testlab'
  | 'error';

export interface AutomationEvent {
  type: HubEventType;
  ts: number;
  [key: string]: unknown;
}

export type Broadcast = (evt: AutomationEvent) => void;

export class Hub {
  private listeners = new Set<(evt: AutomationEvent) => void>();

  on(cb: (evt: AutomationEvent) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  emit(evt: AutomationEvent): void {
    for (const cb of this.listeners) {
      try {
        cb(evt);
      } catch {
        // listener errors never break the loop
      }
    }
  }
}