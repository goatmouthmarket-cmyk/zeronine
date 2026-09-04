import type { Direction } from '../core/digitMath.ts';

/** A narrow, testable hypothesis; it never bypasses normal quality or risk gates. */
export type EntryMode = 'model' | 'digit_trigger';

export function isEntryMode(value: unknown): value is EntryMode {
  return value === 'model' || value === 'digit_trigger';
}

export function triggerDigitsFor(direction: Direction): readonly number[] {
  return direction === 'over' ? [8, 9] : [0, 1];
}

export function matchesDigitTrigger(direction: Direction, digit: number | null | undefined): boolean {
  return typeof digit === 'number' && triggerDigitsFor(direction).includes(digit);
}

export function entryIntent(mode: EntryMode, direction: Direction, digit: number | null | undefined): string {
  if (mode === 'digit_trigger') {
    return `${direction === 'over' ? 'high' : 'low'} digit trigger ${digit ?? '—'} (${triggerDigitsFor(direction).join('/')}) with model and price gates`;
  }
  return 'model-ranked signal with price, risk, and confirmation gates';
}
