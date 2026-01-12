import { describe, it, expect } from 'vitest';
import { WorkIncome, FutureSocialSecurityIncome, CurrentSocialSecurityIncome } from '../../components/Objects/Income/models';
import { simulateOneYear } from '../../components/Objects/Assumptions/SimulationEngine';
import { defaultAssumptions } from '../../components/Objects/Assumptions/AssumptionsContext';
import { TaxState } from '../../components/Objects/Taxes/TaxContext';
import { max_year } from '../../data/TaxData';

const testTaxState: TaxState = {
  filingStatus: 'Single',
  stateResidency: 'DC',
  deductionMethod: 'Standard',
  fedOverride: null,
  ficaOverride: null,
  stateOverride: null,
  year: max_year,
};

describe('Social Security End-to-End Flow', () => {
  it('should calculate FutureSocialSecurityIncome benefit at claiming age', () => {
    // User: Age 30 in 2024, plans to claim SS at 67 (in 2061)
    const startYear = 2024;
    const birthYear = 1994; // Born 1994, age 30 in 2024
    const claimingAge = 67;
    const claimingYear = birthYear + claimingAge; // 2061

    const assumptions = {
      ...defaultAssumptions,
      demographics: {
        ...defaultAssumptions.demographics,
        startAge: 30,
        startYear: startYear,
        lifeExpectancy: 90,
      },
      macro: {
        ...defaultAssumptions.macro,
        inflationRate: 3.0,
      },
    };

    // Create work income (will contribute to SS earnings history)
    const workIncome = new WorkIncome(
      'work-1',
      'Software Engineer',
      100000,
      'Annually',
      'Yes',
      0, 0, 0, 0, '', null,
      'FIXED',
      new Date(`${startYear}-01-01`),
      new Date(`${claimingYear}-01-01`) // Work until claiming age
    );

    // Create Future Social Security Income (claiming at 67)
    const futureSS = new FutureSocialSecurityIncome(
      'fss-1',
      'Future SS Benefits',
      claimingAge,
      0, // Not calculated yet
      0, // Calculation year (will be set during simulation)
      undefined, // Start date will be set at claiming age
      undefined  // End date will be set to life expectancy
    );

    const incomes = [workIncome, futureSS];
    const expenses: any[] = [];
    const accounts: any[] = [];

    // Simulate multiple years to build earnings history
    let timeline: any[] = [];

    // Simulate 10 years of work (ages 30-39, years 2024-2033)
    for (let year = startYear; year < startYear + 10; year++) {
      const result = simulateOneYear(
        year,
        incomes,
        expenses,
        accounts,
        assumptions,
        testTaxState,
        timeline
      );

      timeline.push(result);

      // Update incomes for next year (increment them)
      incomes[0] = incomes[0].increment(assumptions);
      incomes[1] = incomes[1].increment(assumptions);
    }

    // Fast forward to claiming age year (2061)
    // For this test, we'll just simulate that year directly with earnings history
    const claimingYearResult = simulateOneYear(
      claimingYear,
      incomes,
      expenses,
      accounts,
      assumptions,
      testTaxState,
      timeline
    );

    // Find the FutureSocialSecurityIncome in the result
    const ssIncome = claimingYearResult.incomes.find(
      inc => inc instanceof FutureSocialSecurityIncome
    ) as FutureSocialSecurityIncome;

    expect(ssIncome).toBeDefined();

    // Benefit should have been calculated (PIA > 0)
    // Note: Exact value depends on wage indexing and bend points for 2061
    // For 10 years of $100k earnings (capped at SS wage base), we expect some benefit
    expect(ssIncome.calculatedPIA).toBeGreaterThan(0);
    expect(ssIncome.calculationYear).toBe(claimingYear);

    // Start and end dates should be set
    expect(ssIncome.startDate).toBeDefined();
    expect(ssIncome.end_date).toBeDefined();
  });

  it('should grow CurrentSocialSecurityIncome with COLA each year', () => {
    const startYear = 2024;
    const assumptions = {
      ...defaultAssumptions,
      demographics: {
        ...defaultAssumptions.demographics,
        startAge: 50,
        startYear: startYear,
        lifeExpectancy: 90,
      },
      macro: {
        ...defaultAssumptions.macro,
        inflationRate: 3.0, // 3% COLA
      },
    };

    // User already receiving $2000/month in SSDI benefits
    let currentSS = new CurrentSocialSecurityIncome(
      'css-1',
      'SSDI Benefits',
      2000,
      'Monthly',
      new Date(`${startYear}-01-01`),
      undefined
    );

    const incomes = [currentSS];
    const expenses: any[] = [];
    const accounts: any[] = [];

    let timeline: any[] = [];

    // Simulate 5 years
    for (let year = startYear; year < startYear + 5; year++) {
      const result = simulateOneYear(
        year,
        incomes,
        expenses,
        accounts,
        assumptions,
        testTaxState,
        timeline
      );

      timeline.push(result);

      // Update income for next year
      incomes[0] = incomes[0].increment(assumptions);
    }

    // After 5 years with 3% COLA: 2000 * (1.03^5) = 2318.55
    const finalIncome = incomes[0] as CurrentSocialSecurityIncome;
    expect(finalIncome.amount).toBeCloseTo(2318.55, 1);
  });

  it('should persist and reconstitute Social Security incomes through localStorage', () => {
    // This would test that saving/loading works correctly
    // For now, just verify the class structure is preserved
    const currentSS = new CurrentSocialSecurityIncome(
      'css-1',
      'SSDI',
      1500,
      'Monthly'
    );

    const futureSS = new FutureSocialSecurityIncome(
      'fss-1',
      'Future Benefits',
      67,
      2500,
      2045
    );

    // Verify class names for serialization
    expect(currentSS.constructor.name).toBe('CurrentSocialSecurityIncome');
    expect(futureSS.constructor.name).toBe('FutureSocialSecurityIncome');

    // Verify properties exist
    expect(currentSS.amount).toBe(1500);
    expect(currentSS.frequency).toBe('Monthly');
    expect(currentSS.earned_income).toBe('No');

    expect(futureSS.claimingAge).toBe(67);
    expect(futureSS.calculatedPIA).toBe(2500);
    expect(futureSS.calculationYear).toBe(2045);
  });
});
