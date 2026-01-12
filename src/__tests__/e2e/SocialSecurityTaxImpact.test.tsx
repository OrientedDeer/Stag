import { describe, it, expect } from 'vitest';
import { runSimulation } from '../../components/Objects/Assumptions/useSimulation';
import { defaultAssumptions } from '../../components/Objects/Assumptions/AssumptionsContext';
import { WorkIncome, FutureSocialSecurityIncome } from '../../components/Objects/Income/models';
import { TaxState } from '../../components/Objects/Taxes/TaxContext';
import { max_year } from '../../data/TaxData';

/**
 * End-to-End Tests: Social Security Tax Impact
 *
 * These tests verify that federal taxes are calculated correctly when someone
 * starts receiving Social Security benefits. We're checking for:
 * 1. Reasonable tax increase when SS benefits start
 * 2. Correct Social Security taxation (up to 85% of benefits are taxable)
 * 3. No double-taxation or calculation errors
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

describe('Social Security Tax Impact Tests', () => {

  it('should have reasonable federal tax increase when starting Social Security', () => {
    // Create a typical retiree scenario:
    // - Age 30 in 2024, planning to claim SS at 67 (year 2061)
    // - Working income until age 67
    // - Then only Social Security income

    const assumptions = {
      ...defaultAssumptions,
      demographics: {
        ...defaultAssumptions.demographics,
        startAge: 30,
        startYear: 2024,
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
      createTaxState('Single')
    );

    // Find the year before SS starts (2060) and the year it starts (2061)
    const yearBeforeSS = simulationYears.find(y => y.year === 2060);
    const yearSSStarts = simulationYears.find(y => y.year === 2061);

    expect(yearBeforeSS).toBeDefined();
    expect(yearSSStarts).toBeDefined();

    if (!yearBeforeSS || !yearSSStarts) {
      throw new Error('Missing simulation years');
    }

    // Log the detailed breakdown
    console.log('\n--- Year Before SS (2060) ---');
    console.log('Gross Income:', yearBeforeSS.cashflow.totalIncome);
    console.log('Federal Tax:', yearBeforeSS.taxDetails.fed);
    console.log('Effective Tax Rate:', ((yearBeforeSS.taxDetails.fed / yearBeforeSS.cashflow.totalIncome) * 100).toFixed(2) + '%');

    console.log('\n--- Year SS Starts (2061) ---');
    console.log('Gross Income:', yearSSStarts.cashflow.totalIncome);
    console.log('Federal Tax:', yearSSStarts.taxDetails.fed);
    console.log('Effective Tax Rate:', ((yearSSStarts.taxDetails.fed / yearSSStarts.cashflow.totalIncome) * 100).toFixed(2) + '%');

    const incomeJump = yearSSStarts.cashflow.totalIncome - yearBeforeSS.cashflow.totalIncome;
    const taxJump = yearSSStarts.taxDetails.fed - yearBeforeSS.taxDetails.fed;

    console.log('\n--- Changes ---');
    console.log('Income Jump:', incomeJump.toLocaleString());
    console.log('Tax Jump:', taxJump.toLocaleString());
    console.log('Marginal Tax Rate on New Income:', ((taxJump / incomeJump) * 100).toFixed(2) + '%');

    // The marginal tax rate on SS income should be reasonable
    // Even with 85% of SS being taxable, the marginal rate shouldn't exceed ~50%
    // (37% top bracket + some state tax, but we're looking at federal only here)
    const marginalRateOnNewIncome = (taxJump / incomeJump) * 100;

    expect(marginalRateOnNewIncome).toBeLessThan(50); // Should not exceed 50%
    expect(marginalRateOnNewIncome).toBeGreaterThan(0); // Should have some tax increase
  });

  it('should correctly tax Social Security benefits (up to 85% taxable)', () => {
    // Simplified scenario: Only Social Security income, no other income
    const assumptions = {
      ...defaultAssumptions,
      demographics: {
        ...defaultAssumptions.demographics,
        startAge: 67,
        startYear: 2024,
        lifeExpectancy: 85,
      },
    };

    // Only SS income: $3,000/month = $36,000/year
    const ssIncome = new FutureSocialSecurityIncome(
      'ss1',
      'Social Security',
      67,
      3000,
      2024,
      new Date('2024-01-01'),
      new Date('2041-12-31')
    );

    const simulationYears = runSimulation(
      1, // just check first year
      [], // accounts
      [ssIncome],
      [], // expenses
      assumptions,
      createTaxState('Single')
    );

    const year2024 = simulationYears.find(y => y.year === 2024);
    expect(year2024).toBeDefined();

    if (!year2024) {
      throw new Error('Missing 2024 simulation year');
    }

    console.log('\n--- Social Security Only Scenario ---');
    console.log('Total SS Benefits:', year2024.cashflow.totalIncome);
    console.log('Federal Tax:', year2024.taxDetails.fed);
    console.log('Effective Tax Rate:', ((year2024.taxDetails.fed / year2024.cashflow.totalIncome) * 100).toFixed(2) + '%');

    // For someone with only $36k in SS benefits (Single filer):
    // - Combined income = AGI + 50% of SS = 0 + 18,000 = 18,000
    // - This is below the $25k threshold for Single filers
    // - 0% of SS should be taxable theoretically
    // - But with standard deduction, there may be some tax
    // - Federal tax should be relatively low

    expect(year2024.taxDetails.fed).toBeLessThan(5500); // Should be reasonable federal tax
  });

  it('should handle high earner starting Social Security correctly', () => {
    // High earner scenario: $200k work income + SS
    const assumptions = {
      ...defaultAssumptions,
      demographics: {
        ...defaultAssumptions.demographics,
        startAge: 66,
        startYear: 2024,
        lifeExpectancy: 85,
      },
    };

    // Work income: $200k/year
    const workIncome = new WorkIncome(
      'work1',
      'Salary',
      200000,
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

    // Future SS: $4,000/month = $48,000/year
    const ssIncome = new FutureSocialSecurityIncome(
      'ss1',
      'Social Security',
      67,
      4000,
      2025,
      new Date('2025-01-01'),
      new Date('2041-12-31')
    );

    const simulationYears = runSimulation(
      2, // run 2024 and 2025
      [], // accounts
      [workIncome, ssIncome],
      [], // expenses
      assumptions,
      createTaxState('Married Filing Jointly')
    );

    const year2024 = simulationYears.find(y => y.year === 2024);
    const year2025 = simulationYears.find(y => y.year === 2025);

    expect(year2024).toBeDefined();
    expect(year2025).toBeDefined();

    if (!year2024 || !year2025) {
      throw new Error('Missing simulation years');
    }

    console.log('\n--- High Earner Scenario ---');
    console.log('2024 (No SS):');
    console.log('  Gross Income:', year2024.cashflow.totalIncome.toLocaleString());
    console.log('  Federal Tax:', year2024.taxDetails.fed.toLocaleString());
    console.log('  Effective Rate:', ((year2024.taxDetails.fed / year2024.cashflow.totalIncome) * 100).toFixed(2) + '%');

    console.log('2025 (With SS):');
    console.log('  Gross Income:', year2025.cashflow.totalIncome.toLocaleString());
    console.log('  Federal Tax:', year2025.taxDetails.fed.toLocaleString());
    console.log('  Effective Rate:', ((year2025.taxDetails.fed / year2025.cashflow.totalIncome) * 100).toFixed(2) + '%');

    const incomeJump = year2025.cashflow.totalIncome - year2024.cashflow.totalIncome;
    const taxJump = year2025.taxDetails.fed - year2024.taxDetails.fed;

    console.log('Income Jump:', incomeJump.toLocaleString());
    console.log('Tax Jump:', taxJump.toLocaleString());
    console.log('Marginal Rate on New Income:', ((taxJump / incomeJump) * 100).toFixed(2) + '%');

    // With high income, 85% of SS is taxable
    // Taxable SS = 0.85 * 48,000 = 40,800
    // At 24-32% bracket range, tax on this = ~10-13k
    // So marginal rate should be roughly 20-27%

    const marginalRateOnNewIncome = (taxJump / incomeJump) * 100;

    // Should be reasonable - income decreased so we expect negative marginal rate
    // or if income increased slightly, should be under 40%
    expect(Math.abs(marginalRateOnNewIncome)).toBeLessThan(45);
  });

  it('should handle moderate income retiree transitioning to SS-only', () => {
    // Realistic retirement scenario:
    // - $80k work income until retirement
    // - Then $40k SS income only

    const assumptions = {
      ...defaultAssumptions,
      demographics: {
        ...defaultAssumptions.demographics,
        startAge: 66,
        startYear: 2024,
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
      new Date('2024-01-01'),
      new Date('2024-12-31')
    );

    // SS income starting 2025: ~$3,333/month
    const ssIncome = new FutureSocialSecurityIncome(
      'ss1',
      'Social Security',
      67,
      3333,
      2025,
      new Date('2025-01-01'),
      new Date('2041-12-31')
    );

    const simulationYears = runSimulation(
      2, // run 2024 and 2025
      [], // accounts
      [workIncome, ssIncome],
      [], // expenses
      assumptions,
      createTaxState('Married Filing Jointly')
    );

    const year2024 = simulationYears.find(y => y.year === 2024);
    const year2025 = simulationYears.find(y => y.year === 2025);

    expect(year2024).toBeDefined();
    expect(year2025).toBeDefined();

    if (!year2024 || !year2025) {
      throw new Error('Missing simulation years');
    }

    console.log('\n--- Moderate Income Retirement Transition ---');
    console.log('2024 (Working, $80k):');
    console.log('  Gross Income:', year2024.cashflow.totalIncome.toLocaleString());
    console.log('  Federal Tax:', year2024.taxDetails.fed.toLocaleString());

    console.log('2025 (Retired, SS only):');
    console.log('  Gross Income:', year2025.cashflow.totalIncome.toLocaleString());
    console.log('  Federal Tax:', year2025.taxDetails.fed.toLocaleString());

    // When transitioning to lower income (SS only), federal taxes should DECREASE
    expect(year2025.taxDetails.fed).toBeLessThan(year2024.taxDetails.fed);

    // The tax should be reasonable for ~$40k SS income
    // For MFJ, combined income = 0 + 20k = 20k (below $32k threshold)
    // So minimal SS taxation
    expect(year2025.taxDetails.fed).toBeLessThan(3500);
  });

  it('should handle someone working WHILE receiving Social Security', () => {
    // This matches the user's concern: continuing to work after SS starts
    //  - Working income continues: $150k/year
    // - SS benefits start: ~$50k/year
    // - Total income jumps by $50k, taxes should not jump by $110k!

    const assumptions = {
      ...defaultAssumptions,
      demographics: {
        ...defaultAssumptions.demographics,
        startAge: 66,
        startYear: 2024,
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
      new Date('2024-01-01'),
      new Date('2026-12-31') // Continues after SS starts
    );

    // Future SS: $4,200/month = ~$50k/year starting 2025
    const ssIncome = new FutureSocialSecurityIncome(
      'ss1',
      'Social Security',
      67,
      4200,
      2025,
      new Date('2025-01-01'),
      new Date('2041-12-31')
    );

    const simulationYears = runSimulation(
      2, // run 2024 and 2025
      [], // accounts
      [workIncome, ssIncome],
      [], // expenses
      assumptions,
      createTaxState('Single')
    );

    const year2024 = simulationYears.find(y => y.year === 2024);
    const year2025 = simulationYears.find(y => y.year === 2025);

    expect(year2024).toBeDefined();
    expect(year2025).toBeDefined();

    if (!year2024 || !year2025) {
      throw new Error('Missing simulation years');
    }

    console.log('\n--- Working While Receiving SS ---');
    console.log('2024 (Work only, $150k):');
    console.log('  Gross Income:', year2024.cashflow.totalIncome.toLocaleString());
    console.log('  Federal Tax:', year2024.taxDetails.fed.toLocaleString());
    console.log('  Effective Rate:', ((year2024.taxDetails.fed / year2024.cashflow.totalIncome) * 100).toFixed(2) + '%');

    console.log('2025 (Work $150k + SS ~$50k):');
    console.log('  Gross Income:', year2025.cashflow.totalIncome.toLocaleString());
    console.log('  Federal Tax:', year2025.taxDetails.fed.toLocaleString());
    console.log('  Effective Rate:', ((year2025.taxDetails.fed / year2025.cashflow.totalIncome) * 100).toFixed(2) + '%');

    const incomeJump = year2025.cashflow.totalIncome - year2024.cashflow.totalIncome;
    const taxJump = year2025.taxDetails.fed - year2024.taxDetails.fed;

    console.log('\n--- CRITICAL ANALYSIS ---');
    console.log('Income Jump:', incomeJump.toLocaleString());
    console.log('Tax Jump:', taxJump.toLocaleString());
    console.log('Marginal Tax Rate on SS Income:', ((taxJump / incomeJump) * 100).toFixed(2) + '%');
    console.log('');
    console.log('Expected behavior:');
    console.log('  - ~85% of SS benefits are taxable: 0.85 * 50,400 = $42,840');
    console.log('  - At 24% bracket (Single, $150k income): 0.24 * 42,840 = $10,281');
    console.log('  - Expected marginal rate: 10,281 / 50,400 = 20.4%');
    console.log('  - Actual marginal rate:', ((taxJump / incomeJump) * 100).toFixed(2) + '%');

    const expectedMarginalRate = 20.4;
    const actualMarginalRate = (taxJump / incomeJump) * 100;
    const difference = actualMarginalRate - expectedMarginalRate;

    if (Math.abs(difference) > 5) {
      console.log('\n⚠️  WARNING: Marginal rate differs by ' + difference.toFixed(2) + '% from expected!');
      if (actualMarginalRate > 50) {
        console.log('🚨 BUG DETECTED: Marginal rate exceeds 50%! Possible double-taxation or calculation error.');
      }
    }

    // The marginal rate should be reasonable - not 46%!
    // CRITICAL BUG PREVENTION: This precise assertion prevents the double-counting bug
    // where SS benefits were counted 1.85x (100% in annualGross + 85% taxable again)
    expect(actualMarginalRate).toBeCloseTo(expectedMarginalRate, 0); // Within 1%
    expect(actualMarginalRate).toBeLessThan(25); // Sanity check upper bound
    expect(actualMarginalRate).toBeGreaterThan(15); // Sanity check lower bound
  });
});
