/**
 * Leaf module for the RSU-grant structural predicate.
 *
 * Lives apart from models.tsx so that importing this pure helper into other
 * modules (RSUVesting, incomeCardUtils) does NOT pull in the whole income-model
 * graph, and — because this is a plain .ts file with no React exports — does not
 * trip the `react-refresh/only-export-components` lint rule that a .tsx file with
 * a mix of components and helpers would.
 *
 * No runtime imports → no import cycle.
 */

// RSU vesting schedules (v1). Mirrors `RSUVestingSchedule` in models.tsx; inlined
// here as a value-free string union so this stays a true leaf with no import of
// the model graph. Kept in sync with models.tsx (both define the same literals).
export type RSUVestingScheduleKind = 'NONE' | 'cliff-1yr' | 'graded-3yr' | 'graded-4yr';

/**
 * True when a WorkIncome has an RSU grant worth vesting: a real schedule and a
 * positive share count. The single source of truth for the "RSU active" guard —
 * the engine (RSUVesting), the model (getRSUVestSchedule / getRSUVestEventsForYear),
 * and the card validation all share this so the boolean can't drift. Takes a
 * structural shape so interface-typed callers (RSUVesting, incomeCardUtils) work
 * without an instanceof narrow.
 */
export function isActiveRSUGrant(
  income: { rsuVestingSchedule: RSUVestingScheduleKind; rsuGrantShares: number }
): boolean {
  return income.rsuVestingSchedule !== 'NONE' && income.rsuGrantShares > 0;
}
