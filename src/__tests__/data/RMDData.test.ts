import { describe, it, expect } from 'vitest';
import {
  getRMDStartAge,
  getDistributionPeriod,
  calculateRMD,
  isAccountSubjectToRMD,
  calculateRMDPenalty,
  isRMDRequired,
} from '../../data/RMDData';

describe('RMDData', () => {
  describe('getRMDStartAge', () => {
    it('should return 72 for birth year 1950 or earlier', () => {
      expect(getRMDStartAge(1950)).toBe(72);
      expect(getRMDStartAge(1945)).toBe(72);
      expect(getRMDStartAge(1940)).toBe(72);
    });

    it('should return 73 for birth years 1951-1959', () => {
      expect(getRMDStartAge(1951)).toBe(73);
      expect(getRMDStartAge(1955)).toBe(73);
      expect(getRMDStartAge(1959)).toBe(73);
    });

    it('should return 75 for birth year 1960 or later', () => {
      expect(getRMDStartAge(1960)).toBe(75);
      expect(getRMDStartAge(1970)).toBe(75);
      expect(getRMDStartAge(1980)).toBe(75);
      expect(getRMDStartAge(2000)).toBe(75);
    });
  });

  describe('getDistributionPeriod', () => {
    it('should return correct factors for standard ages', () => {
      expect(getDistributionPeriod(72)).toBe(27.4);
      expect(getDistributionPeriod(73)).toBe(26.5);
      expect(getDistributionPeriod(75)).toBe(24.6);
      expect(getDistributionPeriod(80)).toBe(20.2);
      expect(getDistributionPeriod(90)).toBe(12.2);
      expect(getDistributionPeriod(100)).toBe(6.4);
    });

    it('should return age 72 factor for ages below 72', () => {
      expect(getDistributionPeriod(70)).toBe(27.4);
      expect(getDistributionPeriod(50)).toBe(27.4);
    });

    it('should return age 120 factor for ages above 120', () => {
      expect(getDistributionPeriod(121)).toBe(2.0);
      expect(getDistributionPeriod(130)).toBe(2.0);
    });
  });

  describe('calculateRMD', () => {
    it('should calculate correct RMD amount', () => {
      // $500,000 balance at age 73 with factor 26.5 = $18,867.92
      const rmd = calculateRMD(500000, 73);
      expect(rmd).toBeCloseTo(18867.92, 0);
    });

    it('should calculate RMD at age 80', () => {
      // $300,000 balance at age 80 with factor 20.2 = $14,851.49
      const rmd = calculateRMD(300000, 80);
      expect(rmd).toBeCloseTo(14851.49, 0);
    });

    it('should return 0 for ages below 72', () => {
      expect(calculateRMD(500000, 71)).toBe(0);
      expect(calculateRMD(500000, 65)).toBe(0);
    });

    it('should return 0 for zero or negative balance', () => {
      expect(calculateRMD(0, 75)).toBe(0);
      expect(calculateRMD(-10000, 75)).toBe(0);
    });

    it('should handle large balances', () => {
      // $2,000,000 at age 75 with factor 24.6 = $81,300.81
      const rmd = calculateRMD(2000000, 75);
      expect(rmd).toBeCloseTo(81300.81, 0);
    });
  });

  describe('isAccountSubjectToRMD', () => {
    it('should return true for Traditional 401k', () => {
      expect(isAccountSubjectToRMD('Traditional 401k')).toBe(true);
    });

    it('should return true for Traditional IRA', () => {
      expect(isAccountSubjectToRMD('Traditional IRA')).toBe(true);
    });

    it('should return false for Roth accounts', () => {
      expect(isAccountSubjectToRMD('Roth 401k')).toBe(false);
      expect(isAccountSubjectToRMD('Roth IRA')).toBe(false);
    });

    it('should return false for other account types', () => {
      expect(isAccountSubjectToRMD('Brokerage')).toBe(false);
      expect(isAccountSubjectToRMD('HSA')).toBe(false);
      expect(isAccountSubjectToRMD('Savings')).toBe(false);
    });
  });

  describe('calculateRMDPenalty', () => {
    it('should calculate 25% penalty for shortfall', () => {
      expect(calculateRMDPenalty(10000)).toBe(2500);
      expect(calculateRMDPenalty(5000)).toBe(1250);
    });

    it('should calculate 10% penalty if corrected timely', () => {
      expect(calculateRMDPenalty(10000, true)).toBe(1000);
      expect(calculateRMDPenalty(5000, true)).toBe(500);
    });

    it('should return 0 for no shortfall', () => {
      expect(calculateRMDPenalty(0)).toBe(0);
      expect(calculateRMDPenalty(-100)).toBe(0);
    });
  });

  describe('isRMDRequired', () => {
    it('should return false before RMD start age', () => {
      // Person born 1955, RMD starts at 73
      expect(isRMDRequired(72, 1955)).toBe(false);
      expect(isRMDRequired(70, 1955)).toBe(false);
    });

    it('should return true at and after RMD start age', () => {
      // Person born 1955, RMD starts at 73
      expect(isRMDRequired(73, 1955)).toBe(true);
      expect(isRMDRequired(75, 1955)).toBe(true);
      expect(isRMDRequired(80, 1955)).toBe(true);
    });

    it('should use correct start age for different birth years', () => {
      // Born 1950: starts at 72
      expect(isRMDRequired(72, 1950)).toBe(true);
      expect(isRMDRequired(71, 1950)).toBe(false);

      // Born 1959: starts at 73
      expect(isRMDRequired(73, 1959)).toBe(true);
      expect(isRMDRequired(72, 1959)).toBe(false);

      // Born 1965: starts at 75
      expect(isRMDRequired(75, 1965)).toBe(true);
      expect(isRMDRequired(74, 1965)).toBe(false);
    });
  });
});
