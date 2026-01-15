import { describe, it, expect } from 'vitest';
import {
  getFERSMRA,
  checkFERSEligibility,
  calculateFERSBasicBenefit,
  calculateFERSSupplement,
  getFERSCOLA,
  calculateCSRSBasicBenefit,
  checkCSRSEligibility,
  getCSRSCOLA,
  calculateHigh3,
  estimateHigh3,
  getFERSEarlyReduction,
} from '../../data/PensionData';

describe('PensionData', () => {
  describe('getFERSMRA', () => {
    it('should return correct MRA for various birth years', () => {
      expect(getFERSMRA(1950)).toBe(55);
      expect(getFERSMRA(1958)).toBe(56);
      expect(getFERSMRA(1965)).toBe(56.5);
      expect(getFERSMRA(1970)).toBe(57);
      expect(getFERSMRA(1980)).toBe(57); // All years 1970+ are 57
      expect(getFERSMRA(1940)).toBe(55); // Before 1948
    });
  });

  describe('checkFERSEligibility', () => {
    it('should return full retirement at 62 with 5+ years', () => {
      const result = checkFERSEligibility(62, 5, 1970);
      expect(result.eligible).toBe(true);
      expect(result.reductionPercent).toBe(0);
    });

    it('should return full retirement at 60 with 20+ years', () => {
      const result = checkFERSEligibility(60, 20, 1970);
      expect(result.eligible).toBe(true);
      expect(result.reductionPercent).toBe(0);
    });

    it('should return full retirement at MRA with 30+ years', () => {
      const result = checkFERSEligibility(57, 30, 1970);
      expect(result.eligible).toBe(true);
      expect(result.reductionPercent).toBe(0);
    });

    it('should return reduced retirement at MRA with 10-29 years', () => {
      const result = checkFERSEligibility(57, 15, 1970);
      expect(result.eligible).toBe(true);
      expect(result.reductionPercent).toBe(25); // 5% per year under 62, capped at 25%
    });

    it('should return not eligible if under MRA with < 10 years', () => {
      const result = checkFERSEligibility(55, 5, 1970);
      expect(result.eligible).toBe(false);
    });
  });

  describe('calculateFERSBasicBenefit', () => {
    it('should use 1% multiplier for standard retirement', () => {
      // 20 years * $100,000 * 1% = $20,000
      const benefit = calculateFERSBasicBenefit(20, 100000, 60);
      expect(benefit).toBe(20000);
    });

    it('should use 1.1% multiplier for age 62+ with 20+ years', () => {
      // 20 years * $100,000 * 1.1% = $22,000
      const benefit = calculateFERSBasicBenefit(20, 100000, 62);
      expect(benefit).toBe(22000);
    });

    it('should use 1% if retiring at 62 with less than 20 years', () => {
      // 15 years * $100,000 * 1% = $15,000
      const benefit = calculateFERSBasicBenefit(15, 100000, 62);
      expect(benefit).toBe(15000);
    });
  });

  describe('calculateFERSSupplement', () => {
    it('should calculate supplement as fraction of SS benefit', () => {
      // 30 years / 40 * $2000/month * 12 = $18,000/year
      const supplement = calculateFERSSupplement(30, 2000);
      expect(supplement).toBe(18000);
    });

    it('should handle partial years of service', () => {
      // 20 years / 40 * $2000/month * 12 = $12,000/year
      const supplement = calculateFERSSupplement(20, 2000);
      expect(supplement).toBe(12000);
    });
  });

  describe('getFERSCOLA', () => {
    it('should return 0 for retirees under 62', () => {
      expect(getFERSCOLA(0.03, 60)).toBe(0);
    });

    it('should return full COLA if inflation <= 2%', () => {
      expect(getFERSCOLA(0.02, 65)).toBe(0.02);
      expect(getFERSCOLA(0.015, 65)).toBe(0.015);
    });

    it('should return 2% if inflation between 2-3%', () => {
      expect(getFERSCOLA(0.025, 65)).toBe(0.02);
      expect(getFERSCOLA(0.03, 65)).toBe(0.02);
    });

    it('should return CPI-1% if inflation > 3%', () => {
      expect(getFERSCOLA(0.04, 65)).toBe(0.03);
      expect(getFERSCOLA(0.05, 65)).toBe(0.04);
    });
  });

  describe('calculateCSRSBasicBenefit', () => {
    it('should calculate graduated formula correctly for 5 years', () => {
      // 5 years * $100,000 * 1.5% = $7,500
      const benefit = calculateCSRSBasicBenefit(5, 100000);
      expect(benefit).toBe(7500);
    });

    it('should calculate graduated formula correctly for 10 years', () => {
      // 5 years * $100,000 * 1.5% = $7,500
      // 5 years * $100,000 * 1.75% = $8,750
      // Total = $16,250
      const benefit = calculateCSRSBasicBenefit(10, 100000);
      expect(benefit).toBe(16250);
    });

    it('should calculate graduated formula correctly for 30 years', () => {
      // 5 years * $100,000 * 1.5% = $7,500
      // 5 years * $100,000 * 1.75% = $8,750
      // 20 years * $100,000 * 2% = $40,000
      // Total = $56,250
      const benefit = calculateCSRSBasicBenefit(30, 100000);
      expect(benefit).toBe(56250);
    });

    it('should cap benefit at 80% of High-3', () => {
      // With 50 years of service, benefit would exceed 80%
      // 5 * 1.5% + 5 * 1.75% + 40 * 2% = 7.5% + 8.75% + 80% = 96.25%
      // Should be capped at 80% = $80,000
      const benefit = calculateCSRSBasicBenefit(50, 100000);
      expect(benefit).toBe(80000);
    });
  });

  describe('checkCSRSEligibility', () => {
    it('should return full retirement at 62 with 5+ years', () => {
      const result = checkCSRSEligibility(62, 5);
      expect(result.eligible).toBe(true);
      expect(result.reductionPercent).toBe(0);
    });

    it('should return full retirement at 60 with 20+ years', () => {
      const result = checkCSRSEligibility(60, 20);
      expect(result.eligible).toBe(true);
      expect(result.reductionPercent).toBe(0);
    });

    it('should return full retirement at 55 with 30+ years', () => {
      const result = checkCSRSEligibility(55, 30);
      expect(result.eligible).toBe(true);
      expect(result.reductionPercent).toBe(0);
    });

    it('should return reduced retirement for early retirement', () => {
      // Age 50 with 20+ years: 5 years under 55 = 10% reduction
      const result = checkCSRSEligibility(50, 20);
      expect(result.eligible).toBe(true);
      expect(result.reductionPercent).toBe(10);
    });
  });

  describe('getCSRSCOLA', () => {
    it('should return full inflation rate', () => {
      expect(getCSRSCOLA(0.03)).toBe(0.03);
      expect(getCSRSCOLA(0.05)).toBe(0.05);
    });
  });

  describe('calculateHigh3', () => {
    it('should return 0 for empty salary history', () => {
      expect(calculateHigh3([])).toBe(0);
    });

    it('should average entire history if less than 3 years', () => {
      expect(calculateHigh3([50000, 60000])).toBe(55000);
      expect(calculateHigh3([70000])).toBe(70000);
    });

    it('should find highest 3 consecutive years', () => {
      // Years: 50k, 60k, 70k, 80k, 75k
      // Highest 3 consecutive: 70k + 80k + 75k = 225k / 3 = 75k
      expect(calculateHigh3([50000, 60000, 70000, 80000, 75000])).toBe(75000);
    });

    it('should handle ascending salary history', () => {
      // Last 3 years are highest: 80k, 90k, 100k = 90k average
      expect(calculateHigh3([50000, 60000, 70000, 80000, 90000, 100000])).toBe(90000);
    });
  });

  describe('estimateHigh3', () => {
    it('should return current salary if 0 years until retirement', () => {
      expect(estimateHigh3(100000, 0)).toBe(100000);
    });

    it('should project salary growth for future High-3', () => {
      // With 2% growth and 5 years until retirement:
      // Year -2: 100000 * 1.02^3 = 106120.80
      // Year -1: 100000 * 1.02^4 = 108243.22
      // Year 0:  100000 * 1.02^5 = 110408.08
      // Average = 108257.37
      const estimated = estimateHigh3(100000, 5, 0.02);
      expect(estimated).toBeCloseTo(108257.37, 0);
    });
  });

  describe('getFERSEarlyReduction', () => {
    it('should return 1.0 for age 62 or older', () => {
      expect(getFERSEarlyReduction(62)).toBe(1.0);
      expect(getFERSEarlyReduction(65)).toBe(1.0);
    });

    it('should reduce by 5% per year under 62', () => {
      expect(getFERSEarlyReduction(61)).toBe(0.95); // 5% reduction
      expect(getFERSEarlyReduction(60)).toBe(0.90); // 10% reduction
      expect(getFERSEarlyReduction(57)).toBe(0.75); // 25% reduction (max)
    });

    it('should cap reduction at 25%', () => {
      expect(getFERSEarlyReduction(55)).toBe(0.75); // Capped at 25%
      expect(getFERSEarlyReduction(50)).toBe(0.75); // Capped at 25%
    });
  });
});
