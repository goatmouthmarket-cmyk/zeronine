import type { EntryTimingProfile } from '../db/store.ts';

export const ENTRY_TIMING_MIN_TRIGGER_TRADES = 30;
export const ENTRY_TIMING_MIN_COMPARISON_TRADES = 30;
export const ENTRY_TIMING_MIN_LIFT = 0.03;
export const ENTRY_TIMING_MIN_EDGE = 0.02;

export interface EntryTimingAssessment {
  triggerDigit: 0 | 9;
  targetDirection: 'over' | 'under';
  targetBarrier: 5;
  validated: boolean;
  triggerWinRate: number | null;
  comparisonWinRate: number | null;
  reason: string;
}

/**
 * Tests the operator's explicit hypothesis: after 9, test Over 5 (6-9);
 * after 0, test Under 5 (0-4). It does not assume either transition exists.
 */
export function assessExtremeEntryTiming(
  direction: 'over' | 'under',
  barrier: number,
  profile: EntryTimingProfile,
  breakeven: number,
): EntryTimingAssessment {
  const triggerDigit = direction === 'over' ? 9 : 0;
  const targetDirection = direction;
  const targetBarrier = 5 as const;
  const triggerWinRate = profile.triggerTrades ? profile.triggerWins / profile.triggerTrades : null;
  const comparisonWinRate = profile.otherTrades ? profile.otherWins / profile.otherTrades : null;
  if (barrier !== targetBarrier) {
    return { triggerDigit, targetDirection, targetBarrier, validated: false, triggerWinRate, comparisonWinRate, reason: `timing hypothesis targets ${direction === 'over' ? 'Over' : 'Under'} 5` };
  }
  if (profile.triggerTrades < ENTRY_TIMING_MIN_TRIGGER_TRADES) {
    return { triggerDigit, targetDirection, targetBarrier, validated: false, triggerWinRate, comparisonWinRate, reason: `needs ${ENTRY_TIMING_MIN_TRIGGER_TRADES - profile.triggerTrades} more trigger outcomes` };
  }
  const clearsPrice = triggerWinRate != null && triggerWinRate >= breakeven + ENTRY_TIMING_MIN_EDGE;
  const comparisonReady = profile.otherTrades >= ENTRY_TIMING_MIN_COMPARISON_TRADES;
  const clearsControl = comparisonReady && comparisonWinRate != null && triggerWinRate != null && triggerWinRate >= comparisonWinRate + ENTRY_TIMING_MIN_LIFT;
  const validated = clearsPrice && clearsControl;
  return {
    triggerDigit, targetDirection, targetBarrier, validated, triggerWinRate, comparisonWinRate,
    reason: validated
      ? `validated ${triggerDigit} trigger: ${(triggerWinRate! * 100).toFixed(1)}% vs ${(comparisonWinRate! * 100).toFixed(1)}% control`
      : !comparisonReady ? `needs ${ENTRY_TIMING_MIN_COMPARISON_TRADES - profile.otherTrades} more control outcomes`
        : !clearsPrice ? 'trigger does not clear live break-even evidence' : 'trigger has not beaten the control entry rate',
  };
}
