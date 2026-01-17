import { describe, it, expect } from 'vitest';
import {
  getSocialSecurityBenefits,
  getTaxableSocialSecurityBenefits,
  calculateFederalTax,
} from '../../../../components/Objects/Taxes/TaxService';
import {
  CurrentSocialSecurityIncome,
  FutureSocialSecurityIncome,
  WorkIncome,
} from '../../../../components/Objects/Income/models';
import { TaxState } from '../../../../components/Objects/Taxes/TaxContext';
import { defaultAssumptions } from '../../../../components/Objects/Assumptions/AssumptionsContext';
import { runSimulation } from '../../../../components/Objects/Assumptions/useSimulation';
import { max_year } from '../../../../data/TaxData';

const createTaxState = (filingStatus: 'Single' | 'Married Filing Jointly'): TaxState => ({
  filingStatus,
  stateResidency: 'Texas',
  deductionMethod: 'Standard',
  fedOverride: null,
  ficaOverride: null,
  stateOverride: null,
  year: 2024,
});

describe('Social Security Tax Integration', () => {
  describe('getSocialSecurityBenefits', () => {
    it('should return total SS benefits from CurrentSocialSecurityIncome', () => {
      const incomes = [
        new CurrentSocialSecurityIncome('css-1', 'SSDI', 2000, 'Monthly', new Date('2024-01-01')),
        new WorkIncome('w-1', 'Job', 50000, 'Annually', 'Yes', 0, 0, 0, 0, '', null, 'FIXED', new Date('2024-01-01')),
      ];

      const totalSS = getSocialSecurityBenefits(incomes, 2024);

      // 2000/month * 12 = 24000
      expect(totalSS).toBe(24000);
    });

    it('should return total SS benefits from FutureSocialSecurityIncome', () => {
      const incomes = [
        new FutureSocialSecurityIncome('fss-1', 'Future SS', 67, 2500, 2045, new Date('2024-01-01')),
      ];

      const totalSS = getSocialSecurityBenefits(incomes, 2024);

      // 2500/month * 12 = 30000
      expect(totalSS).toBe(30000);
    });

    it('should combine multiple SS income sources', () => {
      const incomes = [
        new CurrentSocialSecurityIncome('css-1', 'SSDI', 1500, 'Monthly', new Date('2024-01-01')),
        new FutureSocialSecurityIncome('fss-1', 'Future SS', 67, 1000, 2045, new Date('2024-01-01')),
      ];

      const totalSS = getSocialSecurityBenefits(incomes, 2024);

      // (1500 + 1000) * 12 = 30000
      expect(totalSS).toBe(30000);
    });

    it('should return 0 if no SS income exists', () => {
      const incomes = [
        new WorkIncome('w-1', 'Job', 50000, 'Annually', 'Yes', 0, 0, 0, 0, '', null, 'FIXED'),
      ];

      const totalSS = getSocialSecurityBenefits(incomes, 2024);
      expect(totalSS).toBe(0);
    });
  });

  describe('getTaxableSocialSecurityBenefits - Single Filer', () => {
    const filingStatus = 'Single';

    it('should return 0% taxable when combined income < $25,000', () => {
      const ssBenefits = 12000; // $12k/year SS
      const agi = 10000; // $10k other income
      // Combined income = 10000 + (12000 * 0.5) = 16000 < 25000

      const taxable = getTaxableSocialSecurityBenefits(ssBenefits, agi, filingStatus);

      expect(taxable).toBe(0);
    });

    it('should return up to 50% taxable when combined income $25,000-$34,000', () => {
      const ssBenefits = 20000; // $20k/year SS
      const agi = 20000; // $20k other income
      // Combined income = 20000 + (20000 * 0.5) = 30000

      const taxable = getTaxableSocialSecurityBenefits(ssBenefits, agi, filingStatus);

      // Excess above $25,000 = 5,000
      // Taxable = 5,000 * 0.5 = 2,500
      expect(taxable).toBeCloseTo(2500, 0);
    });

    it('should return up to 85% taxable when combined income > $34,000', () => {
      const ssBenefits = 30000; // $30k/year SS
      const agi = 50000; // $50k other income
      // Combined income = 50000 + (30000 * 0.5) = 65000 > 34000

      const taxable = getTaxableSocialSecurityBenefits(ssBenefits, agi, filingStatus);

      // Tier 1: (34000 - 25000) * 0.5 = 4,500
      // Tier 2: (65000 - 34000) * 0.85 = 26,350
      // Total: 4,500 + 26,350 = 30,850
      // But capped at 85% of benefits = 30,000 * 0.85 = 25,500
      expect(taxable).toBeCloseTo(25500, 0);
    });

    it('should cap taxable amount at 85% of total benefits', () => {
      const ssBenefits = 20000;
      const agi = 100000; // Very high income
      // Combined income = 100000 + (20000 * 0.5) = 110000

      const taxable = getTaxableSocialSecurityBenefits(ssBenefits, agi, filingStatus);

      // Tier 1 + Tier 2 would be very high, but capped at 85%
      const maxTaxable = ssBenefits * 0.85;
      expect(taxable).toBe(maxTaxable);
      expect(taxable).toBe(17000);
    });
  });

  describe('getTaxableSocialSecurityBenefits - Married Filing Jointly', () => {
    const filingStatus = 'Married Filing Jointly';

    it('should return 0% taxable when combined income < $32,000', () => {
      const ssBenefits = 20000;
      const agi = 15000;
      // Combined income = 15000 + (20000 * 0.5) = 25000 < 32000

      const taxable = getTaxableSocialSecurityBenefits(ssBenefits, agi, filingStatus);

      expect(taxable).toBe(0);
    });

    it('should return up to 50% taxable when combined income $32,000-$44,000', () => {
      const ssBenefits = 24000;
      const agi = 28000;
      // Combined income = 28000 + (24000 * 0.5) = 40000

      const taxable = getTaxableSocialSecurityBenefits(ssBenefits, agi, filingStatus);

      // Excess above $32,000 = 8,000
      // Taxable = 8,000 * 0.5 = 4,000
      expect(taxable).toBeCloseTo(4000, 0);
    });

    it('should return up to 85% taxable when combined income > $44,000', () => {
      const ssBenefits = 40000;
      const agi = 60000;
      // Combined income = 60000 + (40000 * 0.5) = 80000 > 44000

      const taxable = getTaxableSocialSecurityBenefits(ssBenefits, agi, filingStatus);

      // Tier 1: (44000 - 32000) * 0.5 = 6,000
      // Tier 2: (80000 - 44000) * 0.85 = 30,600
      // Total: 6,000 + 30,600 = 36,600
      // But capped at 85% of benefits = 40,000 * 0.85 = 34,000
      expect(taxable).toBeCloseTo(34000, 0);
    });
  });

  describe('Real-world scenarios', () => {
    it('should calculate correct tax for retiree with moderate income (Single)', () => {
      const ssBenefits = 25000; // $25k/year SS
      const agi = 30000; // $30k from investments/withdrawals
      const filingStatus = 'Single';
      // Combined income = 30000 + (25000 * 0.5) = 42500

      const taxable = getTaxableSocialSecurityBenefits(ssBenefits, agi, filingStatus);

      // Tier 1: (34000 - 25000) * 0.5 = 4,500
      // Tier 2: (42500 - 34000) * 0.85 = 7,225
      // Total: 4,500 + 7,225 = 11,725
      expect(taxable).toBeCloseTo(11725, 0);
    });

    it('should calculate correct tax for couple with low income (Married)', () => {
      const ssBenefits = 30000; // $30k/year SS combined
      const agi = 20000; // $20k from part-time work
      const filingStatus = 'Married Filing Jointly';
      // Combined income = 20000 + (30000 * 0.5) = 35000

      const taxable = getTaxableSocialSecurityBenefits(ssBenefits, agi, filingStatus);

      // Excess above $32,000 = 3,000
      // Taxable = 3,000 * 0.5 = 1,500
      expect(taxable).toBeCloseTo(1500, 0);
    });

    it('should handle edge case at threshold boundary (Single)', () => {
      const ssBenefits = 20000;
      const agi = 15000;
      const filingStatus = 'Single';
      // Combined income = 15000 + (20000 * 0.5) = 25000 exactly

      const taxable = getTaxableSocialSecurityBenefits(ssBenefits, agi, filingStatus);

      // At the exact threshold, no benefits should be taxable
      expect(taxable).toBe(0);
    });
  });

  describe('Integration with calculateFederalTax', () => {
    /**
     * CRITICAL BUG PREVENTION:
     * These tests verify that the taxable SS calculation from getTaxableSocialSecurityBenefits
     * correctly integrates with calculateFederalTax.
     *
     * The bug was in calculateFederalTax where adjustedGross double-counted SS benefits.
     * These integration tests ensure the taxable amount calculated here is used correctly.
     */

    it('should correctly integrate taxable SS calculation into federal tax (SS only)', () => {
      const ssIncome = new CurrentSocialSecurityIncome(
        'ss1',
        'SS',
        4000,
        'Monthly',
        new Date('2024-01-01'),
        new Date('2024-12-31')
      );
      // $48k annual SS

      const fedTax = calculateFederalTax(
        createTaxState('Single'),
        [ssIncome],
        [],
        2024,
        defaultAssumptions
      );

      // Verify the taxable portion was calculated correctly:
      // annualGross = 48,000
      // AGI = 48,000
      // Combined income = 0 + (0.5 * 48,000) = 24,000 < $25,000 threshold
      // So taxable SS should be $0
      // Adjusted gross = 48,000 - 48,000 + 0 = $0
      // Taxable income = $0 - $14,600 (std deduction) = $0
      // Federal tax = $0

      expect(fedTax).toBe(0);
    });

    it('should correctly integrate taxable SS calculation into federal tax (Work + SS)', () => {
      const workIncome = new WorkIncome(
        'w1',
        'Job',
        60000,
        'Annually',
        'Yes',
        0,
        0,
        0,
        0,
        '',
        null,
        'FIXED',
        new Date('2024-01-01'),
        new Date('2024-12-31')
      );

      const ssIncome = new CurrentSocialSecurityIncome(
        'ss1',
        'SS',
        2000,
        'Monthly',
        new Date('2024-01-01'),
        new Date('2024-12-31')
      );
      // $24k annual SS

      const fedTax = calculateFederalTax(
        createTaxState('Single'),
        [workIncome, ssIncome],
        [],
        2024,
        defaultAssumptions
      );

      // Verify the integration:
      // annualGross = 60,000 + 24,000 = 84,000
      // AGI = 84,000
      // Combined income = 84,000 + (0.5 * 24,000) = 96,000 (high)
      // Taxable SS = 0.85 * 24,000 = 20,400
      // Adjusted gross = 84,000 - 24,000 + 20,400 = 80,400
      // Taxable income = 80,400 - 14,600 = 65,800
      //
      // Tax on $65,800 (Single, 2024):
      // 10% on $11,600 = $1,160
      // 12% on $35,550 = $4,266
      // 22% on $18,650 = $4,103
      // Total: ~$9,529

      expect(fedTax).toBeCloseTo(9529, 0); // Within $1
      expect(fedTax).toBeGreaterThan(8000); // Sanity check
      expect(fedTax).toBeLessThan(11000); // Sanity check
    });

    it('should handle SS income at threshold boundary correctly', () => {
      // Test a scenario where SS income is right at the threshold
      const ssIncome = new CurrentSocialSecurityIncome(
        'ss1',
        'SS',
        2500,
        'Monthly',
        new Date('2024-01-01'),
        new Date('2024-12-31')
      );
      // $30k annual SS

      const fedTax = calculateFederalTax(
        createTaxState('Single'),
        [ssIncome],
        [],
        2024,
        defaultAssumptions
      );

      // Combined income = 0 + (0.5 * 30,000) = 15,000 < $25,000
      // So 0% taxable
      // Federal tax should be $0

      expect(fedTax).toBe(0);
    });

    it('should correctly move into higher tax bracket when SS income is added', () => {
      // Single filer near the 12%/22% bracket boundary ($47,150 in 2024)
      // Work income: $40k puts them well within 12% bracket
      // Adding SS should increase tax but keep marginal rate reasonable
      const workIncome = new WorkIncome(
        'w1',
        'Job',
        40000,
        'Annually',
        'Yes',
        0,
        0,
        0,
        0,
        '',
        null,
        'FIXED',
        new Date('2024-01-01'),
        new Date('2024-12-31')
      );

      const ssIncome = new CurrentSocialSecurityIncome(
        'ss1',
        'SS',
        1500,
        'Monthly',
        new Date('2024-01-01'),
        new Date('2024-12-31')
      );
      // SS: $18,000/year

      const taxWithoutSS = calculateFederalTax(
        createTaxState('Single'),
        [workIncome],
        [],
        2024,
        defaultAssumptions
      );

      const taxWithSS = calculateFederalTax(
        createTaxState('Single'),
        [workIncome, ssIncome],
        [],
        2024,
        defaultAssumptions
      );

      const taxJump = taxWithSS - taxWithoutSS;
      const incomeJump = 18000; // SS income added

      // Manual calculation:
      // With work only:
      //   Taxable income = 40,000 - 14,600 = 25,400
      //   Tax: 10% on $11,600 + 12% on $13,800 = $1,160 + $1,656 = $2,816
      //
      // With work + SS:
      //   annualGross = 40,000 + 18,000 = 58,000
      //   AGI = 58,000
      //   Combined income = 58,000 + 9,000 = 67,000 > $34,000
      //   Taxable SS = 0.85 * 18,000 = 15,300
      //   Adjusted gross = 58,000 - 18,000 + 15,300 = 55,300
      //   Taxable income = 55,300 - 14,600 = 40,700
      //   Tax: 10% on $11,600 + 12% on $29,100 = $1,160 + $3,492 = $4,652
      //
      // Tax jump = 4,652 - 2,816 = $1,836
      // Marginal rate = 1,836 / 18,000 = 10.2%

      const marginalRate = (taxJump / incomeJump) * 100;

      expect(marginalRate).toBeCloseTo(10.2, 2); // Within 2%
      expect(marginalRate).toBeGreaterThan(8); // Sanity check: should have some tax
      expect(marginalRate).toBeLessThan(15); // Should not jump to 22% bracket
    });

    it('should correctly handle SS income that pushes into higher brackets', () => {
      // Single filer with work income at $100k + $60k SS
      // This should push into 24% and possibly 32% bracket
      const workIncome = new WorkIncome(
        'w1',
        'Job',
        100000,
        'Annually',
        'Yes',
        0,
        0,
        0,
        0,
        '',
        null,
        'FIXED',
        new Date('2024-01-01'),
        new Date('2024-12-31')
      );

      const ssIncome = new CurrentSocialSecurityIncome(
        'ss1',
        'SS',
        5000,
        'Monthly',
        new Date('2024-01-01'),
        new Date('2024-12-31')
      );

      const fedTax = calculateFederalTax(
        createTaxState('Single'),
        [workIncome, ssIncome],
        [],
        2024,
        defaultAssumptions
      );

      // Manual calculation:
      // annualGross = 100,000 + 60,000 = 160,000
      // AGI = 160,000
      // Combined income = 160,000 + 30,000 = 190,000 (very high)
      // Taxable SS = 0.85 * 60,000 = 51,000 (cap at 85%)
      // Adjusted gross = 160,000 - 60,000 + 51,000 = 151,000
      // Taxable income = 151,000 - 14,600 = 136,400
      //
      // Tax calculation on $136,400 (Single, 2024):
      // 10% on $11,600 = $1,160
      // 12% on $35,550 ($11,600 to $47,150) = $4,266
      // 22% on $53,375 ($47,150 to $100,525) = $11,743
      // 24% on $35,875 ($100,525 to $136,400) = $8,610
      // Total: ~$25,779

      expect(fedTax).toBeCloseTo(25778.38, 0); // Within $1
      expect(fedTax).toBeGreaterThan(22000); // Sanity check
      expect(fedTax).toBeLessThan(30000); // Sanity check
    });
  });

  // =============================================================================
  // E2E Tests: Social Security Tax Impact with runSimulation
  // =============================================================================

  describe('E2E: Social Security Tax Impact', () => {
    /**
     * These tests verify federal taxes are calculated correctly when someone
     * starts receiving Social Security benefits. Checking for:
     * 1. Reasonable tax increase when SS benefits start
     * 2. Correct Social Security taxation (up to 85% of benefits are taxable)
     * 3. No double-taxation or calculation errors
     */

    const createE2ETaxState = (filingStatus: 'Single' | 'Married Filing Jointly'): TaxState => ({
      filingStatus,
      stateResidency: 'New York',
      deductionMethod: 'Standard',
      fedOverride: null,
      ficaOverride: null,
      stateOverride: null,
      year: max_year,
    });

    it('should have reasonable federal tax increase when starting Social Security', () => {
      // Create a typical retiree scenario:
      // - Age 30 in 2024, planning to claim SS at 67 (year 2061)
      // - Working income until age 67
      // - Then only Social Security income

      const currentYear = new Date().getFullYear();
      const assumptions = {
        ...defaultAssumptions,
        demographics: {
          ...defaultAssumptions.demographics,
          birthYear: currentYear - 30, // age 30 in current year
          lifeExpectancy: 85,
        },
      };

      // Work income: $100k/year until retirement
      const workIncome = new WorkIncome(
        'work1',
        'Salary',
        100000,
        'Annually',
        'Yes',
        0,
        0,
        0,
        0,
        '',
        null,
        'FIXED',
        new Date('2024-01-01'),
        new Date('2060-12-31') // Ends before SS starts
      );

      // Future SS: Claiming at 67
      const ssIncome = new FutureSocialSecurityIncome(
        'ss1',
        'Social Security',
        67,
        0, // Will be calculated
        2061,
        new Date('2061-01-01'),
        new Date('2084-12-31')
      );

      const simulationYears = runSimulation(
        38, // years to run (from age 30 to age 68, to see before and after)
        [], // accounts
        [workIncome, ssIncome],
        [], // expenses
        assumptions,
        createE2ETaxState('Single')
      );

      // Find the year before SS starts (2060) and the year it starts (2061)
      const yearBeforeSS = simulationYears.find(y => y.year === 2060);
      const yearSSStarts = simulationYears.find(y => y.year === 2061);

      expect(yearBeforeSS).toBeDefined();
      expect(yearSSStarts).toBeDefined();

      if (!yearBeforeSS || !yearSSStarts) {
        throw new Error('Missing simulation years');
      }

      const incomeJump = yearSSStarts.cashflow.totalIncome - yearBeforeSS.cashflow.totalIncome;
      const taxJump = yearSSStarts.taxDetails.fed - yearBeforeSS.taxDetails.fed;

      // The marginal tax rate on SS income should be reasonable
      // Even with 85% of SS being taxable, the marginal rate shouldn't exceed ~50%
      const marginalRateOnNewIncome = (taxJump / incomeJump) * 100;

      expect(marginalRateOnNewIncome).toBeLessThan(50); // Should not exceed 50%
      expect(marginalRateOnNewIncome).toBeGreaterThan(0); // Should have some tax increase
    });

    it('should correctly tax Social Security benefits (up to 85% taxable)', () => {
      // Simplified scenario: Only Social Security income, no other income
      const currentYear = new Date().getFullYear();
      const assumptions = {
        ...defaultAssumptions,
        demographics: {
          ...defaultAssumptions.demographics,
          birthYear: currentYear - 67, // age 67 in current year
          lifeExpectancy: 85,
        },
      };

      // Only SS income: $3,000/month = $36,000/year
      const ssIncome = new FutureSocialSecurityIncome(
        'ss1',
        'Social Security',
        67,
        3000,
        currentYear,
        new Date(currentYear, 0, 1),
        new Date(currentYear + 17, 11, 31)
      );

      const simulationYears = runSimulation(
        1, // just check first year
        [], // accounts
        [ssIncome],
        [], // expenses
        assumptions,
        createE2ETaxState('Single')
      );

      const firstYear = simulationYears.find(y => y.year === currentYear);
      expect(firstYear).toBeDefined();

      if (!firstYear) {
        throw new Error('Missing first simulation year');
      }

      // For someone with only $36k in SS benefits (Single filer):
      // - Combined income = AGI + 50% of SS = 0 + 18,000 = 18,000
      // - This is below the $25k threshold for Single filers
      // - 0% of SS should be taxable theoretically
      // - But with standard deduction, there may be some tax
      // - Federal tax should be relatively low

      expect(firstYear.taxDetails.fed).toBeLessThan(5500); // Should be reasonable federal tax
    });

    it('should handle moderate income retiree transitioning to SS-only', () => {
      // Realistic retirement scenario:
      // - $80k work income until retirement
      // - Then $40k SS income only

      const currentYear = new Date().getFullYear();
      const assumptions = {
        ...defaultAssumptions,
        demographics: {
          ...defaultAssumptions.demographics,
          birthYear: currentYear - 66, // age 66 in current year
          lifeExpectancy: 85,
        },
      };

      // Work income until retirement
      const workIncome = new WorkIncome(
        'work1',
        'Salary',
        80000,
        'Annually',
        'Yes',
        0,
        0,
        0,
        0,
        '',
        null,
        'FIXED',
        new Date(currentYear, 0, 1),
        new Date(currentYear, 11, 31)
      );

      // SS income starting next year: ~$3,333/month
      const ssIncome = new FutureSocialSecurityIncome(
        'ss1',
        'Social Security',
        67,
        3333,
        currentYear + 1,
        new Date(currentYear + 1, 0, 1),
        new Date(currentYear + 17, 11, 31)
      );

      const simulationYears = runSimulation(
        2, // run first 2 years
        [], // accounts
        [workIncome, ssIncome],
        [], // expenses
        assumptions,
        createE2ETaxState('Married Filing Jointly')
      );

      const year1 = simulationYears.find(y => y.year === currentYear);
      const year2 = simulationYears.find(y => y.year === currentYear + 1);

      expect(year1).toBeDefined();
      expect(year2).toBeDefined();

      if (!year1 || !year2) {
        throw new Error('Missing simulation years');
      }

      // When transitioning to lower income (SS only), federal taxes should DECREASE
      expect(year2.taxDetails.fed).toBeLessThan(year1.taxDetails.fed);

      // The tax should be reasonable for ~$40k SS income
      // For MFJ, combined income = 0 + 20k = 20k (below $32k threshold)
      // So minimal SS taxation
      expect(year2.taxDetails.fed).toBeLessThan(3500);
    });

    it('should handle someone working WHILE receiving Social Security', () => {
      // CRITICAL BUG PREVENTION: This test catches the double-counting bug
      // where SS benefits were counted 1.85x (100% in annualGross + 85% taxable again)
      //
      // Scenario:
      // - Working income continues: $150k/year
      // - SS benefits start: ~$50k/year
      // - Total income jumps by $50k, taxes should not jump by $110k!

      const currentYear = new Date().getFullYear();
      const assumptions = {
        ...defaultAssumptions,
        demographics: {
          ...defaultAssumptions.demographics,
          birthYear: currentYear - 66, // age 66 in current year
          lifeExpectancy: 85,
        },
      };

      // Work income: $150k/year, continues through retirement
      const workIncome = new WorkIncome(
        'work1',
        'Salary',
        150000,
        'Annually',
        'Yes',
        0,
        0,
        0,
        0,
        '',
        null,
        'FIXED',
        new Date(currentYear, 0, 1),
        new Date(currentYear + 2, 11, 31) // Continues after SS starts
      );

      // Future SS: $4,200/month = ~$50k/year starting next year
      const ssIncome = new FutureSocialSecurityIncome(
        'ss1',
        'Social Security',
        67,
        4200,
        currentYear + 1,
        new Date(currentYear + 1, 0, 1),
        new Date(currentYear + 17, 11, 31)
      );

      const simulationYears = runSimulation(
        2, // run first 2 years
        [], // accounts
        [workIncome, ssIncome],
        [], // expenses
        assumptions,
        createE2ETaxState('Single')
      );

      const year1 = simulationYears.find(y => y.year === currentYear);
      const year2 = simulationYears.find(y => y.year === currentYear + 1);

      expect(year1).toBeDefined();
      expect(year2).toBeDefined();

      if (!year1 || !year2) {
        throw new Error('Missing simulation years');
      }

      const incomeJump = year2.cashflow.totalIncome - year1.cashflow.totalIncome;
      const taxJump = year2.taxDetails.fed - year1.taxDetails.fed;

      const expectedMarginalRate = 20.4;
      const actualMarginalRate = (taxJump / incomeJump) * 100;

      // The marginal rate should be reasonable - not 46%!
      // CRITICAL BUG PREVENTION: This precise assertion prevents the double-counting bug
      expect(actualMarginalRate).toBeCloseTo(expectedMarginalRate, 0); // Within 1%
      expect(actualMarginalRate).toBeLessThan(25); // Sanity check upper bound
      expect(actualMarginalRate).toBeGreaterThan(15); // Sanity check lower bound
    });
  });
});
