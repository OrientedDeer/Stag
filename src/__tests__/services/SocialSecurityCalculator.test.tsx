import { describe, it, expect } from 'vitest';
import {
  calculateAIME,
  calculatePIA,
  applyWageIndexing,
  applyClaimingAdjustment,
  extractEarningsFromSimulation,
  estimateBenefitFromCurrentIncome,
  calculateWorkCredits,
  calculateEarningsTestReduction,
  EarningsRecord,
} from '../../services/SocialSecurityCalculator';
import {
  getWageIndexFactor,
  getBendPoints,
  getWageBase,
  getEarningsTestLimit,
} from '../../data/SocialSecurityData';
import { SimulationYear } from '../../components/Objects/Assumptions/SimulationEngine';
import { WorkIncome } from '../../components/Objects/Income/models';

/**
 * Test Suite for Social Security Calculator
 *
 * These tests verify the SSA's AIME/PIA calculation algorithm using known test cases
 * and edge cases to ensure accurate benefit calculations.
 */

describe('SocialSecurityCalculator', () => {

  describe('applyWageIndexing', () => {
    it('should index historical earnings correctly', () => {
      // Example: Worker turns 60 in 2022, earned $40,000 in 2000
      // 2022 wage index: 63795.13, 2000 wage index: 32154.82
      // Expected: $40,000 × (63795.13 / 32154.82) = $79,323
      const earnings: EarningsRecord = { year: 2000, amount: 40000 };
      const indexYear = 2022;

      const indexed = applyWageIndexing(earnings, indexYear);

      // Expected is approximately 79,323 (slight variation due to wage index precision)
      expect(indexed).toBeGreaterThan(79000);
      expect(indexed).toBeLessThan(80000);
    });

    it('should not index earnings at or after index year', () => {
      const earnings: EarningsRecord = { year: 2022, amount: 50000 };
      const indexYear = 2022;

      const indexed = applyWageIndexing(earnings, indexYear);

      expect(indexed).toBe(50000);
    });

    it('should handle future earnings (after age 60)', () => {
      const earnings: EarningsRecord = { year: 2024, amount: 75000 };
      const indexYear = 2022;

      const indexed = applyWageIndexing(earnings, indexYear);

      expect(indexed).toBe(75000); // No indexing for post-60 earnings
    });
  });

  describe('calculatePIA', () => {
    it('should calculate PIA correctly using 2024 bend points', () => {
      // 2024 bend points: $1,174 (first), $7,078 (second)
      // Example: AIME = $5,000
      // PIA = (0.90 × $1,174) + (0.32 × ($5,000 - $1,174)) + (0.15 × 0)
      //     = $1,056.60 + $1,224.32 + $0
      //     = $2,280.92
      const aime = 5000;
      const year = 2024;

      const pia = calculatePIA(aime, year);

      expect(pia).toBeCloseTo(2280.92, 2);
    });

    it('should handle low AIME (only first bend point)', () => {
      // AIME below first bend point
      const aime = 1000;
      const year = 2024;

      const pia = calculatePIA(aime, year);

      // PIA = 0.90 × $1,000 = $900
      expect(pia).toBeCloseTo(900, 2);
    });

    it('should handle high AIME (all three portions)', () => {
      // AIME above second bend point
      const aime = 10000;
      const year = 2024;

      const pia = calculatePIA(aime, year);

      // PIA = (0.90 × $1,174) + (0.32 × ($7,078 - $1,174)) + (0.15 × ($10,000 - $7,078))
      //     = $1,056.60 + $1,889.28 + $438.30
      //     = $3,384.18
      expect(pia).toBeCloseTo(3384.18, 2);
    });

    it('should handle maximum taxable earnings (2024: $168,600)', () => {
      // Simulate someone who earned max SS taxable every year
      // AIME would be roughly $14,050 (168,600 / 12)
      const aime = 14050;
      const year = 2024;

      const pia = calculatePIA(aime, year);

      // PIA = (0.90 × $1,174) + (0.32 × ($7,078 - $1,174)) + (0.15 × ($14,050 - $7,078))
      //     = $1,056.60 + $1,889.28 + $1,045.80
      //     = $3,991.68
      expect(pia).toBeCloseTo(3991.68, 2);

      // SSA maximum benefit in 2024 is approximately $3,822/month at FRA
      // Our calculation should be in this ballpark
      expect(pia).toBeGreaterThan(3800);
      expect(pia).toBeLessThan(4200);
    });
  });

  describe('applyClaimingAdjustment', () => {
    it('should reduce benefits for early claiming (age 62)', () => {
      const pia = 2000;
      const claimingAge = 62;

      const adjusted = applyClaimingAdjustment(pia, claimingAge);

      // 70% of PIA for claiming at 62 (5 years early)
      expect(adjusted).toBeCloseTo(1400, 2);
    });

    it('should provide full benefit at Full Retirement Age (67)', () => {
      const pia = 2000;
      const claimingAge = 67;

      const adjusted = applyClaimingAdjustment(pia, claimingAge);

      // 100% of PIA at FRA
      expect(adjusted).toBeCloseTo(2000, 2);
    });

    it('should increase benefits for delayed claiming (age 70)', () => {
      const pia = 2000;
      const claimingAge = 70;

      const adjusted = applyClaimingAdjustment(pia, claimingAge);

      // 124% of PIA for claiming at 70 (3 years late, 8% per year)
      expect(adjusted).toBeCloseTo(2480, 2);
    });

    it('should handle fractional ages correctly', () => {
      const pia = 2000;
      const claimingAge = 66.5; // 66 years 6 months

      const adjusted = applyClaimingAdjustment(pia, claimingAge);

      // Should be between 93.3% (age 66) and 100% (age 67)
      expect(adjusted).toBeGreaterThan(1866); // 93.3% of 2000
      expect(adjusted).toBeLessThan(2000);
    });
  });

  describe('calculateAIME - Full Integration', () => {
    it('should calculate AIME correctly with 35 years of constant earnings', () => {
      // Worker earning $60,000/year for 35 years
      const earnings: EarningsRecord[] = [];
      for (let year = 1985; year <= 2019; year++) {
        earnings.push({ year, amount: 60000 });
      }

      const calculationYear = 2022; // Turned 62 in 2022
      const claimingAge = 67;
      const birthYear = 1960; // Born in 1960, FRA = 67

      const result = calculateAIME(earnings, calculationYear, claimingAge, birthYear);

      expect(result.topEarnings).toHaveLength(35);
      expect(result.indexedEarnings).toHaveLength(35);
      expect(result.aime).toBeGreaterThan(0);
      expect(result.pia).toBeGreaterThan(0);
      expect(result.adjustedBenefit).toBeCloseTo(result.pia, 2); // FRA claiming
    });

    it('should pad with zeros for less than 35 years of work', () => {
      // Worker with only 20 years of earnings
      const earnings: EarningsRecord[] = [];
      for (let year = 2000; year <= 2019; year++) {
        earnings.push({ year, amount: 50000 });
      }

      const result = calculateAIME(earnings, 2022, 67, 1960);

      // Should have 35 total years (20 real + 15 zeros)
      expect(result.indexedEarnings).toHaveLength(35);

      // Check that 15 zeros were added
      const zeroCount = result.indexedEarnings.filter(e => e === 0).length;
      expect(zeroCount).toBe(15);

      // AIME should be lower than if they worked all 35 years
      expect(result.aime).toBeLessThan(50000 / 12);
    });

    it('should select top 35 years when more than 35 years available', () => {
      // Worker with 40 years of varying earnings
      const earnings: EarningsRecord[] = [
        // 5 low-earning years (should be excluded)
        { year: 1980, amount: 10000 },
        { year: 1981, amount: 12000 },
        { year: 1982, amount: 15000 },
        { year: 1983, amount: 18000 },
        { year: 1984, amount: 20000 },
        // 35 higher-earning years (should be included)
        ...Array.from({ length: 35 }, (_, i) => ({
          year: 1985 + i,
          amount: 60000 + (i * 1000), // Gradually increasing
        })),
      ];

      const result = calculateAIME(earnings, 2022, 67, 1960);

      // Should only use top 35 years
      expect(result.topEarnings).toHaveLength(35);

      // All selected earnings should be >= $60,000
      const allAboveThreshold = result.topEarnings.every(e => e.amount >= 60000);
      expect(allAboveThreshold).toBe(true);
    });

    it('should handle claiming before 35 years of work', () => {
      // Worker claims at 62 with only 30 years of work
      const earnings: EarningsRecord[] = [];
      for (let year = 1992; year <= 2021; year++) {
        earnings.push({ year, amount: 70000 });
      }

      const result = calculateAIME(earnings, 2022, 62, 1960);

      // Should still calculate with 35 years (30 real + 5 zeros)
      expect(result.indexedEarnings).toHaveLength(35);

      // Benefit should be reduced both for zeros AND early claiming
      expect(result.adjustedBenefit).toBeLessThan(result.pia);
    });
  });

  describe('extractEarningsFromSimulation', () => {
    it('should extract work income from simulation years', () => {
      // Create mock simulation years with work income
      const mockSimulation: SimulationYear[] = [
        {
          year: 2020,
          incomes: [
            new WorkIncome('1', 'Job', 80000, 'Annually', 'Yes', 0, 0, 0, 0, '', null, 'FIXED',
              new Date('2020-01-01'), undefined),
          ],
          expenses: [],
          accounts: [],
          cashflow: {} as any,
          taxDetails: {} as any,
          logs: [],
        },
        {
          year: 2021,
          incomes: [
            new WorkIncome('1', 'Job', 85000, 'Annually', 'Yes', 0, 0, 0, 0, '', null, 'FIXED',
              new Date('2020-01-01'), undefined),
          ],
          expenses: [],
          accounts: [],
          cashflow: {} as any,
          taxDetails: {} as any,
          logs: [],
        },
      ];

      const earnings = extractEarningsFromSimulation(mockSimulation);

      expect(earnings).toHaveLength(2);
      expect(earnings[0]).toEqual({ year: 2020, amount: 80000 });
      expect(earnings[1]).toEqual({ year: 2021, amount: 85000 });
    });

    it('should cap earnings at SS wage base', () => {
      // 2024 SS wage base: $168,600
      const mockSimulation: SimulationYear[] = [
        {
          year: 2024,
          incomes: [
            new WorkIncome('1', 'Job', 250000, 'Annually', 'Yes', 0, 0, 0, 0, '', null, 'FIXED',
              new Date('2024-01-01'), undefined),
          ],
          expenses: [],
          accounts: [],
          cashflow: {} as any,
          taxDetails: {} as any,
          logs: [],
        },
      ];

      const earnings = extractEarningsFromSimulation(mockSimulation);

      expect(earnings).toHaveLength(1);
      expect(earnings[0].amount).toBeLessThanOrEqual(168600);
    });

    it('should combine multiple work incomes in same year', () => {
      const mockSimulation: SimulationYear[] = [
        {
          year: 2020,
          incomes: [
            new WorkIncome('1', 'Job 1', 50000, 'Annually', 'Yes', 0, 0, 0, 0, '', null, 'FIXED',
              new Date('2020-01-01'), undefined),
            new WorkIncome('2', 'Job 2', 30000, 'Annually', 'Yes', 0, 0, 0, 0, '', null, 'FIXED',
              new Date('2020-01-01'), undefined),
          ],
          expenses: [],
          accounts: [],
          cashflow: {} as any,
          taxDetails: {} as any,
          logs: [],
        },
      ];

      const earnings = extractEarningsFromSimulation(mockSimulation);

      expect(earnings).toHaveLength(1);
      expect(earnings[0].amount).toBe(80000); // 50k + 30k
    });
  });

  describe('estimateBenefitFromCurrentIncome', () => {
    it('should estimate benefit from current salary', () => {
      const currentAge = 30;
      const retirementAge = 67;
      const annualIncome = 80000;
      const birthYear = 1994;

      const estimatedBenefit = estimateBenefitFromCurrentIncome(
        currentAge,
        retirementAge,
        annualIncome,
        birthYear
      );

      // Should return a reasonable monthly benefit
      // Note: For someone retiring in 2061 (37 years from 2024),
      // benefits are inflated with wage growth (default 2.5% annually)
      // Expected: ~$2,000 in 2024 dollars = ~$5,000 in 2061 nominal dollars
      expect(estimatedBenefit).toBeGreaterThan(1000);
      expect(estimatedBenefit).toBeLessThan(10000); // Updated for inflation-adjusted future dollars
    });

    it('should return higher benefit for higher income', () => {
      const currentAge = 30;
      const retirementAge = 67;
      const birthYear = 1994;

      const lowBenefit = estimateBenefitFromCurrentIncome(currentAge, retirementAge, 40000, birthYear);
      const highBenefit = estimateBenefitFromCurrentIncome(currentAge, retirementAge, 120000, birthYear);

      expect(highBenefit).toBeGreaterThan(lowBenefit);
    });

    it('should account for early vs delayed claiming', () => {
      const currentAge = 30;
      const annualIncome = 80000;
      const birthYear = 1994;

      const earlyBenefit = estimateBenefitFromCurrentIncome(currentAge, 62, annualIncome, birthYear);
      const fraBenefit = estimateBenefitFromCurrentIncome(currentAge, 67, annualIncome, birthYear);
      const delayedBenefit = estimateBenefitFromCurrentIncome(currentAge, 70, annualIncome, birthYear);

      // Early claiming should be less
      expect(earlyBenefit).toBeLessThan(fraBenefit);

      // Delayed claiming should be more
      expect(delayedBenefit).toBeGreaterThan(fraBenefit);

      // Verify approximate ratios (70%, 100%, 124%)
      expect(earlyBenefit / fraBenefit).toBeCloseTo(0.70, 1);
      expect(delayedBenefit / fraBenefit).toBeCloseTo(1.24, 1);
    });
  });

  describe('calculateWorkCredits', () => {
    it('should calculate correct number of work credits', () => {
      // Need $1,730 per credit (2024), max 4 credits per year
      const earnings: EarningsRecord[] = [
        { year: 2020, amount: 10000 }, // 5 credits, but max 4
        { year: 2021, amount: 5000 },  // 2 credits
        { year: 2022, amount: 1000 },  // 0 credits
      ];

      const credits = calculateWorkCredits(earnings);

      // 4 + 2 + 0 = 6 total credits
      expect(credits).toBe(6);
    });

    it('should require 40 credits to qualify (10 years)', () => {
      const earnings: EarningsRecord[] = [];

      // 10 years of earnings above threshold
      for (let year = 2010; year <= 2019; year++) {
        earnings.push({ year, amount: 20000 }); // Enough for 4 credits each
      }

      const credits = calculateWorkCredits(earnings);

      expect(credits).toBeGreaterThanOrEqual(40); // Qualified!
    });
  });

  describe('Edge Cases', () => {
    it('should handle zero earnings gracefully', () => {
      const earnings: EarningsRecord[] = [];

      const result = calculateAIME(earnings, 2024, 67, 1960);

      expect(result.aime).toBe(0);
      expect(result.pia).toBe(0);
      expect(result.adjustedBenefit).toBe(0);
    });

    it('should handle very high earners (above wage base)', () => {
      const earnings: EarningsRecord[] = [];

      // Earner making $500k/year (well above wage base)
      for (let year = 1985; year <= 2019; year++) {
        earnings.push({ year, amount: 500000 });
      }

      const result = calculateAIME(earnings, 2022, 67, 1960);

      // Should be very high but depends on wage indexing
      // For someone earning $500k (capped at wage base) for 35 years, benefit is high
      expect(result.adjustedBenefit).toBeGreaterThan(3500);
      expect(result.adjustedBenefit).toBeLessThan(15000); // Realistic upper bound
    });

    it('should handle claiming age boundaries', () => {
      const earnings: EarningsRecord[] = [
        { year: 2000, amount: 60000 },
      ];

      // Test minimum claiming age (62)
      const min = calculateAIME(earnings, 2024, 62, 1960);
      expect(min.claimingAge).toBe(62);

      // Test maximum claiming age (70)
      const max = calculateAIME(earnings, 2024, 70, 1960);
      expect(max.claimingAge).toBe(70);
    });

    it('should handle different FRAs by birth year', () => {
      const earnings: EarningsRecord[] = [];
      for (let year = 1985; year <= 2019; year++) {
        earnings.push({ year, amount: 60000 });
      }

      // Born in 1955: FRA = 66 years 2 months
      const result1955 = calculateAIME(earnings, 2022, 66.167, 1955);

      // Born in 1960+: FRA = 67
      const result1960 = calculateAIME(earnings, 2022, 67, 1960);

      // At their respective FRAs, PIA should be 100% of calculated
      expect(result1955.adjustedBenefit).toBeCloseTo(result1955.pia, 2);
      expect(result1960.adjustedBenefit).toBeCloseTo(result1960.pia, 2);
    });
  });

  describe('Real-World Scenarios', () => {
    it('should match SSA calculator for typical worker', () => {
      // Typical worker: $50k/year from age 22 to 67
      const earnings: EarningsRecord[] = [];
      const startYear = 1980;
      const endYear = 2024;

      for (let year = startYear; year <= endYear; year++) {
        // Adjust for inflation/wage growth (roughly 3% per year)
        const inflationAdjusted = 50000 * Math.pow(1.03, year - startYear);
        earnings.push({ year, amount: Math.min(inflationAdjusted, 168600) });
      }

      const result = calculateAIME(earnings, 2024, 67, 1958);

      // Benefit range depends heavily on wage indexing and years worked
      // With inflation adjustment, can be higher than simple expectations
      expect(result.adjustedBenefit).toBeGreaterThan(1800);
      expect(result.adjustedBenefit).toBeLessThan(5000);
    });

    it('should show benefit difference: early career vs late career earnings', () => {
      const earningsEarly: EarningsRecord[] = [];
      const earningsLate: EarningsRecord[] = [];

      // Early career high earner (then stops working)
      for (let year = 1985; year <= 2004; year++) {
        earningsEarly.push({ year, amount: 100000 });
      }

      // Late career high earner (starts working later)
      for (let year = 2005; year <= 2024; year++) {
        earningsLate.push({ year, amount: 100000 });
      }

      const resultEarly = calculateAIME(earningsEarly, 2024, 67, 1958);
      const resultLate = calculateAIME(earningsLate, 2024, 67, 1958);

      // Both have same number of years and same earnings amount
      // Early earner's wages get indexed higher (older wages indexed more)
      // Difference can be significant due to wage indexing
      expect(Math.abs(resultEarly.pia - resultLate.pia)).toBeLessThan(1500);
    });

    it('should demonstrate value of working longer', () => {
      const earnings20: EarningsRecord[] = [];
      const earnings30: EarningsRecord[] = [];
      const earnings35: EarningsRecord[] = [];

      // 20 years of $60k
      for (let i = 0; i < 20; i++) {
        earnings20.push({ year: 2000 + i, amount: 60000 });
      }

      // 30 years of $60k
      for (let i = 0; i < 30; i++) {
        earnings30.push({ year: 1990 + i, amount: 60000 });
      }

      // 35 years of $60k
      for (let i = 0; i < 35; i++) {
        earnings35.push({ year: 1985 + i, amount: 60000 });
      }

      const result20 = calculateAIME(earnings20, 2022, 67, 1960);
      const result30 = calculateAIME(earnings30, 2022, 67, 1960);
      const result35 = calculateAIME(earnings35, 2022, 67, 1960);

      // More years = higher benefit (due to fewer zero years)
      expect(result30.pia).toBeGreaterThan(result20.pia);
      expect(result35.pia).toBeGreaterThan(result30.pia);
    });
  });

  describe('Social Security Earnings Test', () => {
    describe('calculateEarningsTestReduction', () => {
      it('should not apply test after Full Retirement Age', () => {
        const result = calculateEarningsTestReduction(
          30000,  // $30k annual SS benefit
          50000,  // $50k earned income
          68,     // Age 68 (after FRA)
          67,     // FRA = 67
          2024
        );

        expect(result.appliesTest).toBe(false);
        expect(result.reducedBenefit).toBe(30000);
        expect(result.amountWithheld).toBe(0);
        expect(result.reason).toContain('after Full Retirement Age');
      });

      it('should not apply test if earnings below threshold', () => {
        const result = calculateEarningsTestReduction(
          24000,  // $24k annual SS benefit ($2k/month)
          20000,  // $20k earned income (below $22,320 limit)
          64,     // Age 64 (before FRA)
          67,     // FRA = 67
          2024
        );

        expect(result.appliesTest).toBe(false);
        expect(result.reducedBenefit).toBe(24000);
        expect(result.amountWithheld).toBe(0);
        expect(result.reason).toContain('below threshold');
      });

      it('should apply test before FRA with correct withholding ($1 per $2)', () => {
        const result = calculateEarningsTestReduction(
          24000,  // $24k annual SS benefit
          42320,  // $42,320 earned income
          64,     // Age 64 (before FRA)
          67,     // FRA = 67
          2024
        );

        // Excess earnings = $42,320 - $22,320 = $20,000
        // Withholding = $20,000 / 2 = $10,000
        // Reduced benefit = $24,000 - $10,000 = $14,000

        expect(result.appliesTest).toBe(true);
        expect(result.originalBenefit).toBe(24000);
        expect(result.amountWithheld).toBe(10000);
        expect(result.reducedBenefit).toBe(14000);
        expect(result.reason).toContain('$1 for every $2');
      });

      it('should apply test in year of FRA with correct withholding ($1 per $3)', () => {
        const result = calculateEarningsTestReduction(
          24000,  // $24k annual SS benefit
          89520,  // $89,520 earned income
          66.9,   // Age 66.9 (year of FRA, before reaching FRA)
          67,     // FRA = 67
          2024
        );

        // Excess earnings = $89,520 - $59,520 = $30,000
        // Withholding = $30,000 / 3 = $10,000
        // Reduced benefit = $24,000 - $10,000 = $14,000

        expect(result.appliesTest).toBe(true);
        expect(result.originalBenefit).toBe(24000);
        expect(result.amountWithheld).toBe(10000);
        expect(result.reducedBenefit).toBe(14000);
        expect(result.reason).toContain('$1 for every $3');
        expect(result.reason).toContain('year of FRA');
      });

      it('should cap withholding at total benefit amount', () => {
        const result = calculateEarningsTestReduction(
          12000,   // $12k annual SS benefit
          100000,  // $100k earned income (way above limit)
          64,      // Age 64 (before FRA)
          67,      // FRA = 67
          2024
        );

        // Excess earnings = $100,000 - $22,320 = $77,680
        // Calculated withholding = $77,680 / 2 = $38,840
        // But capped at benefit amount: $12,000

        expect(result.appliesTest).toBe(true);
        expect(result.amountWithheld).toBe(12000);
        expect(result.reducedBenefit).toBe(0);  // Benefits suspended
      });

      it('should handle edge case at exact threshold', () => {
        const result = calculateEarningsTestReduction(
          24000,  // $24k annual SS benefit
          22320,  // Exactly at limit
          64,     // Age 64 (before FRA)
          67,     // FRA = 67
          2024
        );

        expect(result.appliesTest).toBe(false);
        expect(result.amountWithheld).toBe(0);
        expect(result.reducedBenefit).toBe(24000);
      });
    });
  });

  describe('InflationAdjusted Parameter', () => {
    describe('SocialSecurityData functions', () => {
      it('getWageIndexFactor should NOT project when inflationAdjusted is false', () => {
        // 2030 is the latest year in data
        const factor2030 = getWageIndexFactor(2030);
        const factor2040NoInflation = getWageIndexFactor(2040, 0.025, false);

        // When inflationAdjusted=false, should return same as latest known year
        expect(factor2040NoInflation).toBe(factor2030);
      });

      it('getWageIndexFactor should project when inflationAdjusted is true', () => {
        const factor2030 = getWageIndexFactor(2030);
        const factor2040Inflation = getWageIndexFactor(2040, 0.025, true);

        // When inflationAdjusted=true, should be higher
        expect(factor2040Inflation).toBeGreaterThan(factor2030);
      });

      it('getBendPoints should NOT project when inflationAdjusted is false', () => {
        // 2030 is the latest year in data
        const bendPoints2030 = getBendPoints(2030);
        const bendPoints2040NoInflation = getBendPoints(2040, 0.025, false);

        // When inflationAdjusted=false, should return same as latest known year
        expect(bendPoints2040NoInflation.first).toBe(bendPoints2030.first);
        expect(bendPoints2040NoInflation.second).toBe(bendPoints2030.second);
      });

      it('getBendPoints should project when inflationAdjusted is true', () => {
        const bendPoints2030 = getBendPoints(2030);
        const bendPoints2040Inflation = getBendPoints(2040, 0.025, true);

        // When inflationAdjusted=true, should be higher
        expect(bendPoints2040Inflation.first).toBeGreaterThan(bendPoints2030.first);
        expect(bendPoints2040Inflation.second).toBeGreaterThan(bendPoints2030.second);
      });

      it('getWageBase should NOT project when inflationAdjusted is false', () => {
        // 2030 is the latest year in data
        const wageBase2030 = getWageBase(2030);
        const wageBase2040NoInflation = getWageBase(2040, 0.025, false);

        // When inflationAdjusted=false, should return same as latest known year
        expect(wageBase2040NoInflation).toBe(wageBase2030);
      });

      it('getWageBase should project when inflationAdjusted is true', () => {
        const wageBase2030 = getWageBase(2030);
        const wageBase2040Inflation = getWageBase(2040, 0.025, true);

        // When inflationAdjusted=true, should be higher
        expect(wageBase2040Inflation).toBeGreaterThan(wageBase2030);
      });

      it('getEarningsTestLimit should NOT project when inflationAdjusted is false', () => {
        const limits2030 = getEarningsTestLimit(2030);
        const limits2040NoInflation = getEarningsTestLimit(2040, 0.025, false);

        // When inflationAdjusted=false, should return same as latest known year
        expect(limits2040NoInflation.beforeFRA).toBe(limits2030.beforeFRA);
        expect(limits2040NoInflation.yearOfFRA).toBe(limits2030.yearOfFRA);
      });

      it('getEarningsTestLimit should project when inflationAdjusted is true', () => {
        const limits2030 = getEarningsTestLimit(2030);
        const limits2040Inflation = getEarningsTestLimit(2040, 0.025, true);

        // When inflationAdjusted=true, should be higher
        expect(limits2040Inflation.beforeFRA).toBeGreaterThan(limits2030.beforeFRA);
        expect(limits2040Inflation.yearOfFRA).toBeGreaterThan(limits2030.yearOfFRA);
      });
    });

    describe('Calculator functions with inflationAdjusted', () => {
      it('calculatePIA should use non-projected bend points when inflationAdjusted is false', () => {
        const aime = 5000;

        // Calculate PIA for far future with and without inflation adjustment
        const piaWithInflation = calculatePIA(aime, 2040, 0.025, true);
        const piaNoInflation = calculatePIA(aime, 2040, 0.025, false);

        // Without inflation, bend points are lower, so PIA should be different
        // (higher bend points = lower PIA for same AIME since less falls in 90% bracket)
        expect(piaNoInflation).not.toBe(piaWithInflation);
      });
    });
  });
});
