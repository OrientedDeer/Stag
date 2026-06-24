import { describe, it, expect } from 'vitest';
import {
  getContributionLimits,
  get401kLimit,
  get415cLimit,
  getIRALimit,
} from '../../data/ContributionLimits';

/**
 * Guards the published IRS contribution limits baked into ContributionLimits.ts
 * against silent drift back to stale placeholder estimates.
 *
 * Sources (official IRS):
 *   2026 limits:  IRS Notice 2025-67
 *                 https://www.irs.gov/newsroom/401k-limit-increases-to-24500-for-2026-ira-limit-increases-to-7500
 *   §415(c):      https://www.irs.gov/retirement-plans/cola-increases-for-dollar-limitations-on-benefits-and-contributions
 *
 * For a year present in the lookup table getContributionLimits returns the stored
 * values directly (the future-projection path only runs past the latest tabulated
 * year), so these assertions read the exact published figures.
 */
describe('ContributionLimits published IRS figures', () => {
  describe('2026 limits (IRS Notice 2025-67)', () => {
    const limits = getContributionLimits(2026);

    it('401(k) elective-deferral limit is $24,500', () => {
      expect(limits.traditional401k).toBe(24500);
    });

    it('401(k) catch-up (age 50+) is $8,000', () => {
      expect(limits.catchUp401k).toBe(8000);
    });

    it('401(k) super catch-up (ages 60-63) is $11,250', () => {
      expect(limits.superCatchUp401k).toBe(11250);
    });

    it('IRA contribution limit is $7,500', () => {
      expect(limits.traditionalIRA).toBe(7500);
    });

    it('IRA catch-up (age 50+) is $1,100', () => {
      expect(limits.catchUpIRA).toBe(1100);
    });

    it('§415(c) annual-additions limit is $72,000', () => {
      expect(limits.section415c).toBe(72000);
    });
  });

  describe('age-based helpers apply the published super catch-up directly', () => {
    it('get401kLimit at age 62 (2026) = base + $11,250 super catch-up', () => {
      // $24,500 + $11,250 — NOT base + round(8000 * 1.5) = $12,000
      expect(get401kLimit(2026, 62)).toBe(24500 + 11250);
    });

    it('get401kLimit at age 55 (2026) = base + $8,000 standard catch-up', () => {
      expect(get401kLimit(2026, 55)).toBe(24500 + 8000);
    });

    it('get401kLimit at age 45 (2026) = base only', () => {
      expect(get401kLimit(2026, 45)).toBe(24500);
    });

    it('get415cLimit at age 62 (2026) = §415(c) + $11,250 super catch-up', () => {
      expect(get415cLimit(2026, 62)).toBe(72000 + 11250);
    });

    it('getIRALimit at age 50 (2026) = base + $1,100 catch-up', () => {
      expect(getIRALimit(2026, 50)).toBe(7500 + 1100);
    });
  });

  describe('super catch-up is no longer derived as catchUp401k * 1.5', () => {
    // Regression: when catchUp401k was 7500 the *1.5 derivation happened to give
    // $11,250; with the corrected $8,000 base, *1.5 would drift to $12,000. The
    // published figure ($11,250) must come from its own field, not the ratio.
    it('the published super catch-up is not 1.5x the standard catch-up for 2026', () => {
      const limits = getContributionLimits(2026);
      expect(limits.superCatchUp401k).not.toBe(Math.round(limits.catchUp401k * 1.5));
    });
  });

  describe('projected future years carry the super catch-up forward', () => {
    it('a far-future year still has a defined superCatchUp401k', () => {
      const future = getContributionLimits(2035);
      expect(future.superCatchUp401k).toBe(11250);
    });
  });
});
