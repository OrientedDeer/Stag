import { describe, it, expect } from 'vitest';
import {
  calculateFixedRealWithdrawal,
  calculatePercentageWithdrawal,
  calculateGuytonKlingerWithdrawal,
  calculateStrategyWithdrawal,
  evaluateGuytonKlingerGuardrail,
  computeGKDiscretionaryAdjustment,
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

      // Capital Preservation Rule: CUT by 10% (actual GK rules)
      // $40,000 * 0.9 = $36,000
      expect(result.amount).toBe(36000);
      expect(result.guardrailTriggered).toBe('capital-preservation');
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

      // Prosperity Rule: INCREASE by 10% (actual GK rules)
      // $40,000 * 1.1 = $44,000
      expect(result.amount).toBeCloseTo(44000, 0);
      expect(result.guardrailTriggered).toBe('prosperity');
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

      // 5% > 4% * 1.1 (4.4%), so Capital Preservation triggered
      // $40,000 * 0.9 = $36,000
      expect(result.amount).toBe(36000);
      expect(result.guardrailTriggered).toBe('capital-preservation');
    });

    describe('Withdrawal Rule freeze (no inflation bump after a down year)', () => {
      // Canonical GK: skip the annual inflation increase following a year whose
      // portfolio total return was negative, AND only when the current withdrawal
      // rate is above the initial target rate.

      it('(a) down year + above-initial rate → FREEZE (no inflation raise)', () => {
        // baseWithdrawal $40k on a $950k portfolio = 4.21% > 4% target, and within
        // the upper guardrail (4.8%), so the normal branch would inflation-adjust.
        // Last year's return was negative → the Withdrawal Rule freezes the raise.
        const result = calculateGuytonKlingerWithdrawal({
          currentPortfolio: 950000,
          baseWithdrawal: 40000,
          withdrawalRate: 4,
          inflationRate: 3,
          lastYearReturn: -10, // down year
          isFirstYear: false,
        });

        // No raise: withdrawal stays flat at $40,000 (not $41,200).
        expect(result.amount).toBe(40000);
        expect(result.guardrailTriggered).toBe('none');
      });

      it('(b) down year + below-initial rate → still RAISE (freeze does not apply)', () => {
        // baseWithdrawal $40k on a $1.2M portfolio = 3.33% < 4% target. Even though
        // last year was down, the rate is at/below the initial rate, so the freeze
        // does NOT apply and the normal inflation raise proceeds.
        // (3.33% is within the lower guardrail 3.2%, so no prosperity trigger.)
        const result = calculateGuytonKlingerWithdrawal({
          currentPortfolio: 1200000,
          baseWithdrawal: 40000,
          withdrawalRate: 4,
          inflationRate: 3,
          lastYearReturn: -10, // down year
          isFirstYear: false,
        });

        // Normal inflation raise: $40,000 * 1.03 = $41,200.
        expect(result.amount).toBeCloseTo(41200, 0);
        expect(result.guardrailTriggered).toBe('none');
      });

      it('(c) up year + above-initial rate → RAISE (freeze only triggers on a down year)', () => {
        // Same above-initial rate as case (a), but last year's return was positive,
        // so the freeze does not apply and the normal inflation raise proceeds.
        const result = calculateGuytonKlingerWithdrawal({
          currentPortfolio: 950000,
          baseWithdrawal: 40000,
          withdrawalRate: 4,
          inflationRate: 3,
          lastYearReturn: 8, // up year
          isFirstYear: false,
        });

        // Normal inflation raise: $40,000 * 1.03 = $41,200.
        expect(result.amount).toBeCloseTo(41200, 0);
        expect(result.guardrailTriggered).toBe('none');
      });

      it('omitting lastYearReturn preserves legacy behavior (always raises)', () => {
        // Backward compatibility: with no return info we cannot know the year was
        // down, so we keep the inflation raise (no freeze).
        const result = calculateGuytonKlingerWithdrawal({
          currentPortfolio: 950000,
          baseWithdrawal: 40000,
          withdrawalRate: 4,
          inflationRate: 3,
          isFirstYear: false,
        });

        expect(result.amount).toBeCloseTo(41200, 0);
      });

      it('does not affect the capital-preservation cut (down year above the guardrail still cuts)', () => {
        // $40k on $500k = 8% > 4.8% upper guardrail → still a 10% cut, not a freeze.
        const result = calculateGuytonKlingerWithdrawal({
          currentPortfolio: 500000,
          baseWithdrawal: 40000,
          withdrawalRate: 4,
          inflationRate: 3,
          lastYearReturn: -20,
          isFirstYear: false,
        });

        expect(result.amount).toBe(36000);
        expect(result.guardrailTriggered).toBe('capital-preservation');
      });
    });

    it('should skip Capital Preservation when within 15 years of life expectancy', () => {
      // Portfolio dropped triggering upper guardrail
      const result = calculateGuytonKlingerWithdrawal({
        currentPortfolio: 500000,
        baseWithdrawal: 40000,
        withdrawalRate: 4,
        inflationRate: 3,
        yearsRemaining: 10, // Within 15 years of life expectancy
        isFirstYear: false,
      });

      // Should NOT cut - just inflation adjust
      // $40,000 * 1.03 = $41,200
      expect(result.amount).toBeCloseTo(41200, 0);
      expect(result.guardrailTriggered).toBe('none');
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
        guardrailTriggered: 'none',
        targetWithdrawalRate: 4,
        currentWithdrawalRate: 4,
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
        guardrailTriggered: 'none',
        targetWithdrawalRate: 4,
        currentWithdrawalRate: 4.12,
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

    it('should handle zero portfolio for Percentage (no NaN/Infinity)', () => {
      const result = calculatePercentageWithdrawal(0, 4);
      expect(result.amount).toBe(0);
      expect(result.currentWithdrawalRate).toBe(4); // Percentage hardcodes this
      expect(Number.isFinite(result.currentWithdrawalRate)).toBe(true);
    });

    it('should handle zero portfolio for Fixed Real (no NaN/Infinity)', () => {
      const result = calculateFixedRealWithdrawal(0, 4, 3, 0, 0);
      expect(result.amount).toBe(0);
      expect(result.currentWithdrawalRate).toBe(0);
      expect(Number.isFinite(result.currentWithdrawalRate)).toBe(true);
    });

    it('should handle zero portfolio for Guyton-Klinger (no NaN/Infinity)', () => {
      const result = calculateGuytonKlingerWithdrawal({
        currentPortfolio: 0,
        baseWithdrawal: 0,
        withdrawalRate: 4,
        inflationRate: 3,
        isFirstYear: true,
      });
      expect(result.amount).toBe(0);
      expect(result.currentWithdrawalRate).toBe(4); // First year uses target rate
      expect(Number.isFinite(result.currentWithdrawalRate)).toBe(true);
    });

    it('should handle zero portfolio mid-retirement for GK (no NaN/Infinity)', () => {
      const result = calculateGuytonKlingerWithdrawal({
        currentPortfolio: 0,
        baseWithdrawal: 40000, // Had withdrawals before
        withdrawalRate: 4,
        inflationRate: 3,
        isFirstYear: false,
      });
      // Portfolio depleted, but still calculates without NaN
      expect(result.currentWithdrawalRate).toBe(0);
      expect(Number.isFinite(result.currentWithdrawalRate)).toBe(true);
      expect(Number.isFinite(result.amount)).toBe(true);
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

  describe('evaluateGuytonKlingerGuardrail (plan-anchored decision)', () => {
    const base = { withdrawalRate: 4, portfolio: 1_000_000 }; // band [3.2%, 4.8%]

    it('returns none when the plan rate is within the band', () => {
      const ev = evaluateGuytonKlingerGuardrail({ ...base, plannedSpending: 40000 }); // 4.0%
      expect(ev.guardrailTriggered).toBe('none');
      expect(ev.planRate).toBeCloseTo(4.0, 5);
    });

    it('flags capital-preservation above the upper guardrail', () => {
      const ev = evaluateGuytonKlingerGuardrail({ ...base, plannedSpending: 50000, yearsRemaining: 30 }); // 5.0%
      expect(ev.guardrailTriggered).toBe('capital-preservation');
      expect(ev.planRate).toBeCloseTo(5.0, 5);
    });

    it('suppresses the cut within 15 years of life expectancy (15-year rule)', () => {
      const ev = evaluateGuytonKlingerGuardrail({ ...base, plannedSpending: 50000, yearsRemaining: 10 });
      expect(ev.guardrailTriggered).toBe('none');
    });

    it('flags prosperity below the lower guardrail', () => {
      const ev = evaluateGuytonKlingerGuardrail({ ...base, plannedSpending: 30000 }); // 3.0%
      expect(ev.guardrailTriggered).toBe('prosperity');
      expect(ev.planRate).toBeCloseTo(3.0, 5);
    });

    it('returns none / rate 0 for a non-positive portfolio (no NaN)', () => {
      const ev = evaluateGuytonKlingerGuardrail({ withdrawalRate: 4, portfolio: 0, plannedSpending: 40000 });
      expect(ev.guardrailTriggered).toBe('none');
      expect(ev.planRate).toBe(0);
      expect(Number.isFinite(ev.planRate)).toBe(true);
    });

    it('honors a custom (tighter) upper guardrail', () => {
      // center 4%, custom upper 1.1 → 4.4%; 4.5% breaches it.
      const ev = evaluateGuytonKlingerGuardrail({
        ...base, plannedSpending: 45000, upperGuardrail: 1.1, yearsRemaining: 30,
      });
      expect(ev.guardrailTriggered).toBe('capital-preservation');
    });
  });

  describe('computeGKDiscretionaryAdjustment (10% of spending, absorbed by discretionary)', () => {
    it('no-ops when no guardrail is triggered', () => {
      const a = computeGKDiscretionaryAdjustment({ guardrailTriggered: 'none', totalSpending: 100000, discretionary: 40000 });
      expect(a).toEqual({ ratio: 1, targetAdjustment: 0, appliedAdjustment: 0, shortfall: 0, failed: false });
    });

    it('cut: removes 10% of TOTAL spending from discretionary (a much larger % of discretionary)', () => {
      // 10% of $100k = $10k cut, taken from $40k discretionary → discretionary drops 25% to $30k.
      const a = computeGKDiscretionaryAdjustment({ guardrailTriggered: 'capital-preservation', totalSpending: 100000, discretionary: 40000 });
      expect(a.targetAdjustment).toBeCloseTo(10000, 5);
      expect(a.appliedAdjustment).toBeCloseTo(10000, 5);
      expect(a.shortfall).toBe(0);
      expect(a.failed).toBe(false);
      expect(a.ratio).toBeCloseTo(0.75, 5); // 30k / 40k
    });

    it('cut FAILS when the required cut exceeds available discretionary', () => {
      // Needs $10k cut, only $5k discretionary → cuts all $5k, $5k shortfall, plan fails.
      const a = computeGKDiscretionaryAdjustment({ guardrailTriggered: 'capital-preservation', totalSpending: 100000, discretionary: 5000 });
      expect(a.targetAdjustment).toBeCloseTo(10000, 5);
      expect(a.appliedAdjustment).toBeCloseTo(5000, 5);
      expect(a.shortfall).toBeCloseTo(5000, 5);
      expect(a.failed).toBe(true);
      expect(a.ratio).toBe(0); // discretionary cut to zero
    });

    it('cut with zero discretionary fails entirely (nothing to cut)', () => {
      const a = computeGKDiscretionaryAdjustment({ guardrailTriggered: 'capital-preservation', totalSpending: 100000, discretionary: 0 });
      expect(a.appliedAdjustment).toBe(0);
      expect(a.shortfall).toBeCloseTo(10000, 5);
      expect(a.failed).toBe(true);
      expect(a.ratio).toBe(1); // nothing to scale
    });

    it('boost: adds 10% of total spending to discretionary, never fails', () => {
      const a = computeGKDiscretionaryAdjustment({ guardrailTriggered: 'prosperity', totalSpending: 100000, discretionary: 40000 });
      expect(a.targetAdjustment).toBeCloseTo(10000, 5);
      expect(a.appliedAdjustment).toBeCloseTo(10000, 5);
      expect(a.failed).toBe(false);
      expect(a.ratio).toBeCloseTo(1.25, 5); // 50k / 40k
    });

    it('honors a custom adjustment percent', () => {
      // 20% of $100k = $20k cut from $40k discretionary → ratio 0.5.
      const a = computeGKDiscretionaryAdjustment({ guardrailTriggered: 'capital-preservation', totalSpending: 100000, discretionary: 40000, adjustmentPercent: 20 });
      expect(a.targetAdjustment).toBeCloseTo(20000, 5);
      expect(a.ratio).toBeCloseTo(0.5, 5);
    });
  });
});
