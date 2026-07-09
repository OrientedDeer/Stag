import { describe, it, expect } from 'vitest';
import { getActiveWindowMultiplier } from '../../../components/Objects/modelUtils';
import {
  WorkIncome,
  getIncomeActiveMultiplier,
  getIncomeActiveMonthOverlap,
} from '../../../components/Objects/Income/models';

/**
 * CHARACTERIZATION tests for the shared active-window month convention.
 *
 * These pin the CURRENT behavior of BOTH `getActiveWindowMultiplier` (the shared
 * helper in modelUtils) and `getIncomeActiveMonthOverlap` (the #179 401k-tail
 * proration copy in Income/models). The refactor generalizes the shared helper
 * with an optional `fromMonthInclusive` param whose default (0) must reproduce
 * every value pinned here byte-for-byte. Both functions use the repo-wide
 * LOCAL-midnight convention: dates are built with `new Date(y, m-1, d)` and read
 * with local getFullYear()/getMonth(); month arithmetic is inclusive.
 */

// WorkIncome ctor (matching existing tests):
// (id, name, amount, frequency, earned_income, w, x, y, z, matchAccountId, ?, milestoneType, startDate, end_date)
function work(id: string, start: Date | null, end: Date | null): WorkIncome {
  return new WorkIncome(id, id, 1, 'Monthly', 'Yes', 0, 0, 0, 0, 'a1', null, 'FIXED', start ?? undefined as unknown as Date, end ?? undefined as unknown as Date);
}

describe('getActiveWindowMultiplier — characterization of current behavior', () => {
  it('income starting mid-year (April 2025) → 9/12', () => {
    expect(getActiveWindowMultiplier({ startDate: new Date(2025, 3, 1), endDate: null }, 2025)).toBe(9 / 12);
  });

  it('income ending mid-year (Sept 2025), started prior year → 9/12', () => {
    expect(getActiveWindowMultiplier({ startDate: new Date(2024, 0, 1), endDate: new Date(2025, 8, 30) }, 2025)).toBe(9 / 12);
  });

  it('starting AND ending in the same year (April–Sept 2025) → 6/12', () => {
    expect(getActiveWindowMultiplier({ startDate: new Date(2025, 3, 1), endDate: new Date(2025, 8, 30) }, 2025)).toBe(6 / 12);
  });

  it('window entirely BEFORE the year → 0', () => {
    expect(getActiveWindowMultiplier({ startDate: new Date(2023, 0, 1), endDate: new Date(2024, 5, 30) }, 2025)).toBe(0);
  });

  it('window entirely AFTER the year → 0', () => {
    expect(getActiveWindowMultiplier({ startDate: new Date(2026, 0, 1), endDate: null }, 2025)).toBe(0);
  });

  it('full year (Jan start, open-ended) → 1.0', () => {
    expect(getActiveWindowMultiplier({ startDate: new Date(2025, 0, 1), endDate: null }, 2025)).toBe(1.0);
  });

  it('spans a year boundary (Nov 2024 → Feb 2025), viewed in 2025 → 2/12', () => {
    expect(getActiveWindowMultiplier({ startDate: new Date(2024, 10, 1), endDate: new Date(2025, 1, 28) }, 2025)).toBeCloseTo(2 / 12, 10);
  });

  it('single-month window (Dec start, open-ended) → 1/12', () => {
    expect(getActiveWindowMultiplier({ startDate: new Date(2025, 11, 1), endDate: null }, 2025)).toBe(1 / 12);
  });

  it('single-month window (starts and ends December) → 1/12', () => {
    expect(getActiveWindowMultiplier({ startDate: new Date(2025, 11, 1), endDate: new Date(2025, 11, 31) }, 2025)).toBe(1 / 12);
  });

  it('agrees with getIncomeActiveMultiplier for the same window (delegation invariant)', () => {
    const inc = work('w-agree', new Date(2025, 3, 1), new Date(2025, 8, 30));
    expect(getIncomeActiveMultiplier(inc, 2025)).toBe(
      getActiveWindowMultiplier({ startDate: inc.startDate, endDate: inc.end_date }, 2025),
    );
  });
});

describe('getIncomeActiveMonthOverlap — characterization of current behavior', () => {
  it('fromMonthInclusive = 0 equals the plain multiplier (April–Sept 2025) → 6/12', () => {
    const inc = work('w0', new Date(2025, 3, 1), new Date(2025, 8, 30));
    expect(getIncomeActiveMonthOverlap(inc, 2025, 0)).toBe(6 / 12);
    expect(getIncomeActiveMonthOverlap(inc, 2025, 0)).toBe(getIncomeActiveMultiplier(inc, 2025));
  });

  it('fromMonthInclusive = 0 equals plain multiplier for a full-year income → 1.0', () => {
    const inc = work('wfull', new Date(2024, 0, 1), null);
    expect(getIncomeActiveMonthOverlap(inc, 2025, 0)).toBe(1.0);
  });

  it('mid-year tail (from Nov=10) on a full-year income → 2/12', () => {
    const inc = work('wfy', new Date(2025, 0, 1), null);
    expect(getIncomeActiveMonthOverlap(inc, 2025, 10)).toBe(2 / 12);
  });

  it('tail starts PAST the end month: ended March, tail from Nov → 0 (no phantom deposit)', () => {
    const endedMarch = work('wem', new Date(2025, 0, 1), new Date(2025, 2, 31));
    expect(getIncomeActiveMonthOverlap(endedMarch, 2025, 10)).toBe(0);
  });

  it('tail from Nov on a Jan–June income → 0 (window ends before tail begins)', () => {
    const janToJune = work('wjj', new Date(2025, 0, 1), new Date(2025, 5, 30));
    expect(getIncomeActiveMonthOverlap(janToJune, 2025, 10)).toBe(0);
  });

  it('single-month overlap: starts December, tail from Nov → just December (1/12)', () => {
    const startsDec = work('wd', new Date(2025, 11, 1), null);
    expect(getIncomeActiveMonthOverlap(startsDec, 2025, 10)).toBe(1 / 12);
  });

  it('tail begins mid-window: Feb–Nov income, tail from June (5) → June..Nov = 6/12', () => {
    const inc = work('wmid', new Date(2025, 1, 1), new Date(2025, 10, 30));
    expect(getIncomeActiveMonthOverlap(inc, 2025, 5)).toBe(6 / 12);
  });

  it('window entirely before the year → 0 regardless of tail', () => {
    const inc = work('wbefore', new Date(2023, 0, 1), new Date(2024, 5, 30));
    expect(getIncomeActiveMonthOverlap(inc, 2025, 0)).toBe(0);
    expect(getIncomeActiveMonthOverlap(inc, 2025, 6)).toBe(0);
  });

  it('window entirely after the year → 0 regardless of tail', () => {
    const inc = work('wafter', new Date(2026, 0, 1), null);
    expect(getIncomeActiveMonthOverlap(inc, 2025, 0)).toBe(0);
  });

  it('tail from December (11) on a full-year income → just December (1/12)', () => {
    const inc = work('wdectail', new Date(2025, 0, 1), null);
    expect(getIncomeActiveMonthOverlap(inc, 2025, 11)).toBe(1 / 12);
  });

  it('spans a year boundary (Nov 2024 → Feb 2025), tail from Feb (1) → just Feb (1/12)', () => {
    const inc = work('wspan', new Date(2024, 10, 1), new Date(2025, 1, 28));
    expect(getIncomeActiveMonthOverlap(inc, 2025, 1)).toBeCloseTo(1 / 12, 10);
  });

  it('negative fromMonthInclusive is clamped to 0 (whole active window)', () => {
    const inc = work('wneg', new Date(2025, 3, 1), new Date(2025, 8, 30));
    expect(getIncomeActiveMonthOverlap(inc, 2025, -3)).toBe(6 / 12);
  });
});
