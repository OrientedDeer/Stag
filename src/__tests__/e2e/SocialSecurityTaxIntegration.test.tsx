import { describe, it, expect } from 'vitest';
import { defaultAssumptions } from '../../components/Objects/Assumptions/AssumptionsContext';
import { WorkIncome, CurrentSocialSecurityIncome } from '../../components/Objects/Income/models';
import { TaxState } from '../../components/Objects/Taxes/TaxContext';
import { calculateFederalTax } from '../../components/Objects/Taxes/TaxService';
import { max_year } from '../../data/TaxData';

/**
 * Integration Tests: Social Security + Federal Tax Calculation
 *
 * These tests verify that Social Security benefits integrate correctly with federal tax calculations.
 *
 * **CRITICAL BUG PREVENTION:**
 * These tests prevent the double-counting bug where SS benefits were counted 1.85x in federal tax:
 * - Bug: `adjustedGross = annualGross + taxableSSBenefits` (counted 100% + 85% = 185%)
 * - Fix: `adjustedGross = annualGross - totalSSBenefits + taxableSSBenefits` (only taxable portion)
 *
 * If this bug is reintroduced, these tests will fail with clear error messages showing:
 * - Federal tax amount is too high
 * - Marginal rate exceeds expected value
 */

const createTaxState = (filingStatus: 'Single' | 'Married Filing Jointly'): TaxState => ({
  filingStatus,
  stateResidency: 'New York',
  deductionMethod: 'Standard',
  fedOverride: null,
  ficaOverride: null,
  stateOverride: null,
  year: max_year,
});

describe('Social Security Tax Integration Tests', () => {

  it('should correctly calculate federal tax when work and SS income are both present', () => {
    // Setup: $100k work + $24k SS
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
      'SSDI',
      2000,
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
    // annualGross = 100,000 + 24,000 = 124,000
    // AGI = 124,000 (no pre-tax deductions)
    // Combined income = AGI + (0.5 * SS) = 124,000 + 12,000 = 136,000
    // Since combined income > $34,000, up to 85% of SS is taxable
    // Taxable SS = 0.85 * 24,000 = 20,400 (high income)
    // Adjusted gross = 124,000 - 24,000 + 20,400 = 120,400
    // Taxable income = 120,400 - 14,600 (std deduction 2024) = 105,800
    //
    // Tax calculation on $105,800 (Single, 2024):
    // 10% on first $11,600 = $1,160
    // 12% on $11,600 to $47,150 = $4,266
    // 22% on $47,150 to $100,525 = $11,743
    // 24% on $100,525 to $105,800 = $1,266
    // Total: ~$18,435
    //
    // Note: This is an approximation. The actual tax may vary slightly based on exact bracket thresholds.

    expect(fedTax).toBeCloseTo(18434.38, 0); // Within $1
    expect(fedTax).toBeGreaterThan(15000); // Sanity check: should be substantial
    expect(fedTax).toBeLessThan(22000); // Sanity check: should not be excessive
  });

  it('should correctly tax SS-only income below threshold', () => {
    // $36k SS annual for Single filer
    // Combined income = AGI + (0.5 * SS) = 0 + 18,000 = 18,000 < $25,000
    // So 0% of SS is taxable for federal income tax
    const ssIncome = new CurrentSocialSecurityIncome(
      'ss1',
      'SSDI',
      3000,
      'Monthly',
      new Date('2024-01-01'),
      new Date('2024-12-31')
    );

    const fedTax = calculateFederalTax(
      createTaxState('Single'),
      [ssIncome],
      [],
      2024,
      defaultAssumptions
    );

    // Manual calculation:
    // annualGross = 36,000
    // AGI = 36,000
    // Combined income = 0 + (0.5 * 36,000) = 18,000 < $25,000 threshold
    // Taxable SS = $0
    // Adjusted gross = 36,000 - 36,000 + 0 = $0
    // Taxable income = $0 - $14,600 (std deduction) = $0
    // Expected tax = $0

    expect(fedTax).toBe(0);
  });

  it('should correctly tax SS-only income above threshold', () => {
    // $60k SS annual for Single filer
    // Combined income = 0 + (0.5 * 60,000) = 30,000 > $25,000
    // Taxable SS portion calculated via formula
    const ssIncome = new CurrentSocialSecurityIncome(
      'ss1',
      'SSDI',
      5000,
      'Monthly',
      new Date('2024-01-01'),
      new Date('2024-12-31')
    );

    const fedTax = calculateFederalTax(
      createTaxState('Single'),
      [ssIncome],
      [],
      2024,
      defaultAssumptions
    );

    // Manual calculation:
    // annualGross = 60,000
    // AGI = 60,000
    // Combined income = 0 + (0.5 * 60,000) = 30,000
    //
    // Threshold 1: $25,000, Threshold 2: $34,000 (Single)
    // Combined income falls between thresholds, so up to 50% taxable
    //
    // Excess above first threshold: 30,000 - 25,000 = 5,000
    // 50% of excess: 5,000 * 0.5 = 2,500
    // Cap at 50% of total SS: min(2,500, 60,000 * 0.5) = 2,500
    // Taxable SS = $2,500
    //
    // Adjusted gross = 60,000 - 60,000 + 2,500 = 2,500
    // Taxable income = 2,500 - 14,600 (std deduction) = $0 (can't be negative)
    // Expected tax = $0

    expect(fedTax).toBe(0);

    // Note: Even though some SS is taxable, the standard deduction covers it all
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
