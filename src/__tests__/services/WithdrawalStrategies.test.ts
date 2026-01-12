import { describe, it, expect } from 'vitest';
import {
  calculateFixedRealWithdrawal,
  calculatePercentageWithdrawal,
  calculateGuytonKlingerWithdrawal,
  calculateStrategyWithdrawal,
  WithdrawalResult,
} from '../../services/WithdrawalStrategies';

describe('Withdrawal Strategies', () => {
  describe('Fixed Real Strategy', () => {
    it('should calculate initial withdrawal correctly (year 0)', () => {
      const result = calculateFixedRealWithdrawal(
        1000000, // $1M portfolio
        4,       // 4% withdrawal rate
        3,       // 3% inflation
        0        // Year 0 (first year)
      );

      expect(result.amount).toBe(40000); // 4% of $1M
      expect(result.baseAmount).toBe(40000);
      expect(result.initialPortfolio).toBe(1000000);
    });

    it('should adjust for inflation in subsequent years', () => {
      const result = calculateFixedRealWithdrawal(
        1000000, // $1M portfolio
        4,       // 4% withdrawal rate
        3,       // 3% inflation
        1        // Year 1 (second year)
      );

      // Year 1: $40,000 * 1.03 = $41,200
      expect(result.amount).toBeCloseTo(41200, 0);
      expect(result.baseAmount).toBe(40000); // Base stays the same
    });

    it('should compound inflation over multiple years', () => {
      const result = calculateFixedRealWithdrawal(
        1000000, // $1M portfolio
        4,       // 4% withdrawal rate
        3,       // 3% inflation
        10       // Year 10
      );

      // Year 10: $40,000 * (1.03)^10 = $53,757.01
      const expected = 40000 * Math.pow(1.03, 10);
      expect(result.amount).toBeCloseTo(expected, 2);
    });

    it('should handle zero inflation', () => {
      const result = calculateFixedRealWithdrawal(
        1000000,
        4,
        0, // No inflation
        5
      );

      // No inflation = same withdrawal every year
      expect(result.amount).toBe(40000);
    });

    it('should handle different withdrawal rates', () => {
      const result3 = calculateFixedRealWithdrawal(1000000, 3, 0, 0);
      const result5 = calculateFixedRealWithdrawal(1000000, 5, 0, 0);

      expect(result3.amount).toBe(30000);
      expect(result5.amount).toBe(50000);
    });
  });

  describe('Percentage Strategy', () => {
    it('should calculate as percentage of current portfolio', () => {
      const result = calculatePercentageWithdrawal(
        1000000, // $1M portfolio
        4        // 4% rate
      );

      expect(result.amount).toBe(40000);
    });

    it('should scale with portfolio value', () => {
      const result1M = calculatePercentageWithdrawal(1000000, 4);
      const result500k = calculatePercentageWithdrawal(500000, 4);
      const result2M = calculatePercentageWithdrawal(2000000, 4);

      expect(result1M.amount).toBe(40000);
      expect(result500k.amount).toBe(20000);
      expect(result2M.amount).toBe(80000);
    });

    it('should handle different rates', () => {
      const result3 = calculatePercentageWithdrawal(1000000, 3);
      const result5 = calculatePercentageWithdrawal(1000000, 5);

      expect(result3.amount).toBe(30000);
      expect(result5.amount).toBe(50000);
    });

    it('should handle small portfolios', () => {
      const result = calculatePercentageWithdrawal(10000, 4);
      expect(result.amount).toBe(400);
    });
  });

  describe('Guyton-Klinger Strategy', () => {
    it('should calculate initial withdrawal in first year', () => {
      const result = calculateGuytonKlingerWithdrawal({
        currentPortfolio: 1000000,
        baseWithdrawal: 0, // Not used in first year
        withdrawalRate: 4,
        inflationRate: 3,
        isFirstYear: true,
      });

      expect(result.amount).toBe(40000);
      expect(result.baseAmount).toBe(40000);
    });

    it('should adjust for inflation in normal conditions', () => {
      // Portfolio stayed roughly the same, so normal inflation adjustment
      const result = calculateGuytonKlingerWithdrawal({
        currentPortfolio: 1000000,
        baseWithdrawal: 40000,
        withdrawalRate: 4,
        inflationRate: 3,
        isFirstYear: false,
      });

      // 4% of $1M = 4% (exactly target), so just inflation adjustment
      // $40,000 * 1.03 = $41,200
      expect(result.amount).toBeCloseTo(41200, 0);
    });

    it('should reduce withdrawal when portfolio drops (upper guardrail)', () => {
      // Portfolio dropped to $500k, so $40k withdrawal = 8% rate
      // 8% > 4% * 1.2 (4.8%), so upper guardrail triggered
      const result = calculateGuytonKlingerWithdrawal({
        currentPortfolio: 500000,
        baseWithdrawal: 40000,
        withdrawalRate: 4,
        inflationRate: 3,
        isFirstYear: false,
      });

      // Upper guardrail: no inflation adjustment
      expect(result.amount).toBe(40000);
    });

    it('should increase withdrawal when portfolio grows (lower guardrail)', () => {
      // Portfolio grew to $2M, so $40k withdrawal = 2% rate
      // 2% < 4% * 0.8 (3.2%), so lower guardrail triggered
      const result = calculateGuytonKlingerWithdrawal({
        currentPortfolio: 2000000,
        baseWithdrawal: 40000,
        withdrawalRate: 4,
        inflationRate: 3,
        isFirstYear: false,
      });

      // Lower guardrail: 150% of inflation adjustment
      // $40,000 * (1 + 0.03 * 1.5) = $40,000 * 1.045 = $41,800
      expect(result.amount).toBeCloseTo(41800, 0);
    });

    it('should use custom guardrails', () => {
      // With tighter guardrails (±10%), should trigger more easily
      const result = calculateGuytonKlingerWithdrawal({
        currentPortfolio: 800000, // $40k = 5% rate
        baseWithdrawal: 40000,
        withdrawalRate: 4,
        inflationRate: 3,
        upperGuardrail: 1.1, // 4.4% threshold
        lowerGuardrail: 0.9, // 3.6% threshold
        isFirstYear: false,
      });

      // 5% > 4% * 1.1 (4.4%), so upper guardrail triggered
      expect(result.amount).toBe(40000); // No inflation
    });
  });

  describe('calculateStrategyWithdrawal (main entry point)', () => {
    it('should route to Fixed Real correctly', () => {
      const result = calculateStrategyWithdrawal(
        'Fixed Real',
        4,
        1000000,
        3,
        0,
        undefined
      );

      expect(result.amount).toBe(40000);
    });

    it('should route to Percentage correctly', () => {
      const result = calculateStrategyWithdrawal(
        'Percentage',
        4,
        1000000,
        3,
        0,
        undefined
      );

      expect(result.amount).toBe(40000);
    });

    it('should route to Guyton Klinger correctly', () => {
      const result = calculateStrategyWithdrawal(
        'Guyton Klinger',
        4,
        1000000,
        3,
        0,
        undefined
      );

      expect(result.amount).toBe(40000);
    });

    it('should use previous withdrawal for Fixed Real tracking', () => {
      const previousResult: WithdrawalResult = {
        amount: 40000,
        baseAmount: 40000,
        initialPortfolio: 1000000,
      };

      const result = calculateStrategyWithdrawal(
        'Fixed Real',
        4,
        900000, // Portfolio dropped, but Fixed Real ignores this
        3,
        1, // Year 1
        previousResult
      );

      // Should use original portfolio ($1M), not current ($900k)
      // Year 1: $40,000 * 1.03 = $41,200
      expect(result.amount).toBeCloseTo(41200, 0);
      expect(result.initialPortfolio).toBe(1000000);
    });

    it('should use previous withdrawal for Guyton-Klinger tracking', () => {
      const previousResult: WithdrawalResult = {
        amount: 41200,
        baseAmount: 41200,
        initialPortfolio: 1000000,
      };

      const result = calculateStrategyWithdrawal(
        'Guyton Klinger',
        4,
        1050000, // Slight growth
        3,
        1,
        previousResult
      );

      // 41200 / 1050000 = 3.92%, within guardrails (3.2% - 4.8%)
      // Normal inflation: 41200 * 1.03 = 42436
      expect(result.amount).toBeCloseTo(42436, 0);
    });
  });

  describe('Edge Cases', () => {
    it('should handle very small portfolios', () => {
      const result = calculatePercentageWithdrawal(100, 4);
      expect(result.amount).toBe(4);
    });

    it('should handle very high withdrawal rates', () => {
      const result = calculatePercentageWithdrawal(1000000, 10);
      expect(result.amount).toBe(100000);
    });

    it('should handle zero portfolio (edge case)', () => {
      const result = calculatePercentageWithdrawal(0, 4);
      expect(result.amount).toBe(0);
    });

    it('should handle many years of inflation', () => {
      const result = calculateFixedRealWithdrawal(
        1000000,
        4,
        3,
        30 // 30 years in retirement
      );

      // $40,000 * (1.03)^30 = $97,090.76
      const expected = 40000 * Math.pow(1.03, 30);
      expect(result.amount).toBeCloseTo(expected, 0);
    });
  });
});
