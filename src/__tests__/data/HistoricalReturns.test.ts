import { describe, it, expect } from 'vitest';
import {
  getYearReturns,
  getBlendedReturn,
  SP500_RETURNS,
  BOND_RETURNS,
  INFLATION_RATES,
} from '../../data/HistoricalReturns';

/**
 * Regression for the falsy-vs-undefined bug in getYearReturns: a legitimate
 * 0.00% return for a year must NOT be treated as a missing year. The original
 * guard used `!SP500_RETURNS[year] || !BOND_RETURNS[year]`, which is truthy for
 * a stored 0, so a flat-return year would have been dropped (returned null).
 *
 * We exercise this by injecting a synthetic future year (well past the real
 * tabulated data) into the exported lookup records, then restoring them.
 */
describe('getYearReturns — 0.00% return is a present row, not a missing year', () => {
  const TEST_YEAR = 9999; // far outside the real dataset

  function withInjectedYear(
    rows: { sp500: number; bond: number; inflation: number },
    fn: () => void,
  ) {
    SP500_RETURNS[TEST_YEAR] = rows.sp500;
    BOND_RETURNS[TEST_YEAR] = rows.bond;
    INFLATION_RATES[TEST_YEAR] = rows.inflation;
    try {
      fn();
    } finally {
      delete SP500_RETURNS[TEST_YEAR];
      delete BOND_RETURNS[TEST_YEAR];
      delete INFLATION_RATES[TEST_YEAR];
    }
  }

  it('returns the row (not null) when the S&P 500 return is exactly 0.00', () => {
    withInjectedYear({ sp500: 0, bond: 0.04, inflation: 0.02 }, () => {
      expect(getYearReturns(TEST_YEAR)).toEqual({ stocks: 0, bonds: 0.04, inflation: 0.02 });
    });
  });

  it('returns the row (not null) when the bond return is exactly 0.00', () => {
    withInjectedYear({ sp500: 0.1, bond: 0, inflation: 0.02 }, () => {
      expect(getYearReturns(TEST_YEAR)).toEqual({ stocks: 0.1, bonds: 0, inflation: 0.02 });
    });
  });

  it('returns the row when both stock and bond returns are exactly 0.00', () => {
    withInjectedYear({ sp500: 0, bond: 0, inflation: 0 }, () => {
      expect(getYearReturns(TEST_YEAR)).toEqual({ stocks: 0, bonds: 0, inflation: 0 });
    });
  });

  it('getBlendedReturn yields 0 (not null) for a flat 0/0 year', () => {
    withInjectedYear({ sp500: 0, bond: 0, inflation: 0 }, () => {
      expect(getBlendedReturn(TEST_YEAR, 0.6)).toBe(0);
    });
  });

  it('still returns null when a dataset genuinely lacks the year', () => {
    // No injection: 9999 is absent from every table.
    expect(getYearReturns(TEST_YEAR)).toBeNull();
  });
});
