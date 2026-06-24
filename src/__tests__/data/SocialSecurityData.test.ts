import { describe, it, expect } from 'vitest';
import { getBendPoints, getWageIndexFactor, getEarningsTestLimit } from '../../data/SocialSecurityData';

/**
 * Guards the published Social Security figures baked into SocialSecurityData.tsx
 * against silent drift back to the old placeholder estimates.
 *
 * Sources (official SSA, Office of the Chief Actuary):
 *   PIA bend points:  https://www.ssa.gov/oact/cola/bendpoints.html
 *   AWI series:       https://www.ssa.gov/oact/cola/awiseries.html
 *   Earnings test:    https://www.ssa.gov/oact/cola/rtea.html
 *                     SSA 2026 COLA fact sheet (RS 02501.025)
 *
 * For a year present in the lookup tables both functions return the stored value
 * directly (the future-projection path only runs past the latest tabulated year),
 * so these assertions read the exact published figures.
 */
describe('SocialSecurityData published figures', () => {
  describe('getBendPoints — PIA formula bend points (SSA bendpoints.html)', () => {
    it('returns the published 2024 bend points', () => {
      expect(getBendPoints(2024)).toEqual({ first: 1174, second: 7078 });
    });

    it('returns the published 2025 bend points', () => {
      // Official SSA values; previously a stale "Projected" placeholder of 1200/7240.
      expect(getBendPoints(2025)).toEqual({ first: 1226, second: 7391 });
    });

    it('returns the published 2026 bend points', () => {
      // Official SSA values; previously a stale guess of 1230/7420.
      expect(getBendPoints(2026)).toEqual({ first: 1286, second: 7749 });
    });

    it('keeps bend points monotonically non-decreasing across published and projected years', () => {
      for (let year = 2024; year < 2030; year++) {
        const cur = getBendPoints(year);
        const next = getBendPoints(year + 1);
        expect(next.first).toBeGreaterThanOrEqual(cur.first);
        expect(next.second).toBeGreaterThanOrEqual(cur.second);
      }
    });
  });

  describe('getWageIndexFactor — National Average Wage Index (SSA awiseries.html)', () => {
    it('returns the published 2022 AWI', () => {
      expect(getWageIndexFactor(2022)).toBe(63795.13);
    });

    it('returns the published 2023 AWI', () => {
      // Now an official published value; the "Estimated" marker was stale.
      expect(getWageIndexFactor(2023)).toBe(66621.80);
    });

    it('returns the published 2024 AWI', () => {
      // Official SSA value; previously a stale "Estimated" 68000.00 placeholder.
      expect(getWageIndexFactor(2024)).toBe(69846.57);
    });

    it('keeps the AWI monotonically non-decreasing across published and projected years', () => {
      for (let year = 2022; year < 2030; year++) {
        expect(getWageIndexFactor(year + 1)).toBeGreaterThanOrEqual(getWageIndexFactor(year));
      }
    });
  });

  describe('getEarningsTestLimit — retirement earnings test exempt amounts (SSA rtea.html)', () => {
    it('returns the official 2026 exempt amounts', () => {
      // Official SSA 2026 COLA fact sheet; previously a "Future projection" guess
      // of { beforeFRA: 24000, yearOfFRA: 63700 }.
      expect(getEarningsTestLimit(2026)).toEqual({ beforeFRA: 24480, yearOfFRA: 65160 });
    });

    it('returns the published 2025 exempt amounts', () => {
      expect(getEarningsTestLimit(2025)).toEqual({ beforeFRA: 23400, yearOfFRA: 62160 });
    });

    it('keeps both exempt amounts monotonically non-decreasing across years', () => {
      for (let year = 2024; year < 2030; year++) {
        const cur = getEarningsTestLimit(year);
        const next = getEarningsTestLimit(year + 1);
        expect(next.beforeFRA).toBeGreaterThanOrEqual(cur.beforeFRA);
        expect(next.yearOfFRA).toBeGreaterThanOrEqual(cur.yearOfFRA);
      }
    });
  });
});
