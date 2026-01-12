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
  });
});
