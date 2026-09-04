import type { Direction } from '../core/digitMath.ts';

/** A narrow, testable hypothesis; it never bypasses normal quality or risk gates. */
export type EntryMode = 'model' | 'digit_trigger' | 'digit_trigger_confirmed';

export function isEntryMode(value: unknown): value is EntryMode {
  return value === 'model' || value === 'digit_trigger' || value === 'digit_trigger_confirmed';
}

export function triggerDigitsFor(direction: Direction): readonly number[] {
  return direction === 'over' ? [8, 9] : [0, 1];
}

export function matchesDigitTrigger(direction: Direction, digit: number | null | undefined): boolean {
  return typeof digit === 'number' && triggerDigitsFor(direction).includes(digit);
}

export interface TriggerProgress { firstExtreme: boolean; followThrough: boolean; reentryExtreme: boolean; }

/** Two-pass hypothesis: an earlier extreme must be followed by a same-side
 * follow-through digit before the next extreme can become an entry signal. */
export function confirmedTriggerProgress(direction: Direction, digits: readonly number[]): TriggerProgress {
  const clean = digits.filter((digit) => Number.isInteger(digit) && digit >= 0 && digit <= 9);
  const last = clean.at(-1);
  const reentryExtreme = matchesDigitTrigger(direction, last);
  const prior = clean.slice(0, -1);
  const isFollowThrough = (digit: number) => direction === 'over' ? digit >= 6 : digit <= 3;
  let firstExtreme = false;
  let followThrough = false;
  for (let index = 0; index < prior.length; index += 1) {
    if (!firstExtreme && matchesDigitTrigger(direction, prior[index])) firstExtreme = true;
    else if (firstExtreme && isFollowThrough(prior[index])) followThrough = true;
  }
  return { firstExtreme, followThrough, reentryExtreme };
}

export function matchesConfirmedDigitTrigger(direction: Direction, digits: readonly number[]): boolean {
  const progress = confirmedTriggerProgress(direction, digits);
  return progress.firstExtreme && progress.followThrough && progress.reentryExtreme;
}

export function entryIntent(mode: EntryMode, direction: Direction, digit: number | null | undefined): string {
  if (mode === 'digit_trigger_confirmed') {
    return `two-pass ${direction === 'over' ? 'high' : 'low'} trigger ${digit ?? '—'} after prior follow-through, with model and price gates`;
  }
  if (mode === 'digit_trigger') {
    return `${direction === 'over' ? 'high' : 'low'} digit trigger ${digit ?? '—'} (${triggerDigitsFor(direction).join('/')}) with model and price gates`;
  }
  return 'model-ranked signal with price, risk, and confirmation gates';
}
