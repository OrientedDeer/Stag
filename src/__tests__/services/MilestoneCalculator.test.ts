import { describe, it, expect } from 'vitest';
import {
  calculateMilestones,
  findFinancialIndependenceYear,
  formatAge,
  yearsUntil,
} from '../../services/MilestoneCalculator';
import { type AssumptionsState, createBuiltinMilestones } from '../../components/Objects/Assumptions/AssumptionsContext';
import { type SimulationYear } from '../../components/Objects/Assumptions/SimulationEngine';
import { InvestedAccount } from '../../components/Objects/Accounts/models';
import { OtherExpense } from '../../components/Objects/Expense/models';

// Helper to create mock assumptions
function createMockAssumptions(overrides: { birthYear?: number; retirementAge?: number; lifeExpectancy?: number; priorYearMode?: boolean } = {}): AssumptionsState {
  // birthYear = currentYear - startAge. For tests, we use a fixed year calculation.
  const currentYear = new Date().getFullYear();
  const birthYear = overrides.birthYear ?? currentYear - 30; // Equivalent to startAge: 30
  const retirementAge = overrides.retirementAge ?? 65;
  const lifeExpectancy = overrides.lifeExpectancy ?? 90;
  return {
    demographics: {
      priorYearMode: overrides.priorYearMode ?? false,
    },
    milestones: createBuiltinMilestones(birthYear, retirementAge, lifeExpectancy),
    macro: {
      inflationRate: 3,
      healthcareInflation: 5,
      inflationAdjusted: true,
    },
    investments: {
      returnRates: { ror: 7 },
      withdrawalRate: 4,
      withdrawalStrategy: 'Fixed Real',
      gkUpperGuardrail: 1.2,
      gkLowerGuardrail: 0.8,
      gkAdjustmentPercent: 10,
      autoRothConversions: false,
      taxOptimizationEnabled: false,
      acaAware: true,
    },
    income: {
      salaryGrowth: 3,
      qualifiesForSocialSecurity: true, socialSecurityFundingPercent: 100,
    },
    expenses: {
      lifestyleCreep: 0,
      housingAppreciation: 3,
      rentInflation: 3,
    },
    display: {
      useCompactCurrency: true,
      showExperimentalFeatures: false,
      hsaEligible: true,
    },
    priorities: [],
    withdrawalStrategy: [],
  } as AssumptionsState;
}

// Helper to create mock simulation year
function createMockSimulationYear(
  year: number,
  investedAmount: number,
  annualExpenses: number
): SimulationYear {
  const investedAccount = new InvestedAccount(
    'test-account',
    'Test 401k',
    investedAmount,    // amount
    0,                 // employerBalance
    0,                 // tenureYears
    0.1,               // expenseRatio
    'Traditional 401k' // taxType
  );

  const expense = new OtherExpense(
    'test-expense',
    'Living Expenses',
    annualExpenses / 12,
    'Monthly',
    new Date('2020-01-01'), // Start date in the past
    new Date('2100-01-01')  // End date in the future
  );

  return {
    year,
    incomes: [],
    expenses: [expense],
    accounts: [investedAccount],
    cashflow: {
      totalIncome: 0,
      totalExpense: annualExpenses,
      livingExpenses: annualExpenses,
      discretionary: 0,
      investedUser: 0,
      investedMatch: 0,
      totalInvested: 0,
      bucketAllocations: 0,
      bucketDetail: {},
      withdrawals: 0,
      withdrawalDetail: {},
    },
    taxDetails: {
      fed: 0,
      state: 0,
      fica: 0,
      preTax: 0,
      insurance: 0,
      postTax: 0,
      capitalGains: 0,
      withdrawalOrdinaryTax: 0,
      niit: 0,
    },
    logs: [],
  };
}

describe('MilestoneCalculator', () => {
  describe('calculateMilestones', () => {
    it('should calculate basic milestone summary correctly', () => {
      const assumptions = createMockAssumptions();
      const simulation: SimulationYear[] = [];
      const currentYear = new Date().getFullYear();

      const result = calculateMilestones(assumptions, simulation);

      expect(result.currentAge).toBe(30);
      expect(result.currentYear).toBe(currentYear);
      expect(result.retirementAge).toBe(65);
      expect(result.retirementYear).toBe(currentYear + 35); // currentYear + (65 - 30)
      expect(result.lifeExpectancy).toBe(90);
      expect(result.lifeExpectancyYear).toBe(currentYear + 60); // currentYear + (90 - 30)
    });

    it('should calculate progress percentage correctly', () => {
      const assumptions = createMockAssumptions({ birthYear: new Date().getFullYear() - 45, lifeExpectancy: 90 });
      const simulation: SimulationYear[] = [];

      const result = calculateMilestones(assumptions, simulation);

      // 45 / 90 = 50%
      expect(result.progress).toBe(50);
    });

    it('should return null fiYear when simulation is empty', () => {
      const assumptions = createMockAssumptions();
      const simulation: SimulationYear[] = [];

      const result = calculateMilestones(assumptions, simulation);

      expect(result.fiYear).toBeNull();
      expect(result.fiAge).toBeNull();
    });

  });

  describe('findFinancialIndependenceYear', () => {
    it('should return null for empty simulation', () => {
      const assumptions = createMockAssumptions();
      const simulation: SimulationYear[] = [];

      const result = findFinancialIndependenceYear(simulation, assumptions);

      expect(result).toBeNull();
    });

    it('should detect FI when portfolio can cover expenses', () => {
      const assumptions = createMockAssumptions();
      const currentYear = new Date().getFullYear();

      // FI check uses PREVIOUS year's portfolio to cover CURRENT year's expenses
      // Year 0: $2M invested (this is what gets checked for year 1)
      // Year 1: anything, $50k expenses
      // 4% of $2M = $80k, expenses + tax = $50k / 0.85 = ~$58.8k
      // $80k > $58.8k = FI reached in year 1
      const simulation: SimulationYear[] = [
        createMockSimulationYear(currentYear, 2000000, 50000),
        createMockSimulationYear(currentYear + 1, 2100000, 50000),
      ];

      const result = findFinancialIndependenceYear(simulation, assumptions);

      expect(result).not.toBeNull();
      expect(result?.year).toBe(currentYear + 1);
      expect(result?.age).toBe(31); // startAge 30 + 1 year
    });

    it('should return null when portfolio cannot cover expenses', () => {
      const assumptions = createMockAssumptions();
      const currentYear = new Date().getFullYear();

      // Year 0: $100k invested, $50k expenses
      // Year 1: $150k invested, $50k expenses
      // 4% of $150k = $6k, expenses + tax = ~$58.8k
      // $6k < $58.8k = FI not reached
      const simulation: SimulationYear[] = [
        createMockSimulationYear(currentYear, 100000, 50000),
        createMockSimulationYear(currentYear + 1, 150000, 50000),
      ];

      const result = findFinancialIndependenceYear(simulation, assumptions);

      expect(result).toBeNull();
    });

    it('should find earliest FI year in multi-year simulation', () => {
      const assumptions = createMockAssumptions();
      const currentYear = new Date().getFullYear();

      // FI check uses PREVIOUS year's portfolio
      // Need $50k/0.85 = $58.8k gross withdrawal needed
      // At 4% rate, need $58.8k / 0.04 = $1.47M portfolio
      const simulation: SimulationYear[] = [
        createMockSimulationYear(currentYear, 500000, 50000),
        createMockSimulationYear(currentYear + 1, 800000, 50000),
        createMockSimulationYear(currentYear + 2, 1200000, 50000),
        createMockSimulationYear(currentYear + 3, 1500000, 50000), // $1.5M is enough!
        createMockSimulationYear(currentYear + 4, 2000000, 50000),
      ];

      const result = findFinancialIndependenceYear(simulation, assumptions);

      // Check year +1: uses year 0's $500k → 4% = $20k < $58.8k, not FI
      // Check year +2: uses year +1's $800k → 4% = $32k < $58.8k, not FI
      // Check year +3: uses year +2's $1.2M → 4% = $48k < $58.8k, not FI
      // Check year +4: uses year +3's $1.5M → 4% = $60k > $58.8k, FI!
      expect(result?.year).toBe(currentYear + 4);
    });

    it('should use correct withdrawal rate from assumptions', () => {
      const assumptions = createMockAssumptions();
      const currentYear = new Date().getFullYear();
      assumptions.investments.withdrawalRate = 5; // Higher withdrawal rate

      // FI check uses PREVIOUS year's portfolio
      // With 5% withdrawal rate:
      // 5% of $1M = $50k
      // Expenses with tax = $40k / 0.85 = $47k
      // $50k > $47k = FI reached
      const simulation: SimulationYear[] = [
        createMockSimulationYear(currentYear, 1000000, 40000), // Year 0: $1M (used for year 1 check)
        createMockSimulationYear(currentYear + 1, 1100000, 40000),
      ];

      const result = findFinancialIndependenceYear(simulation, assumptions);

      expect(result).not.toBeNull();
      expect(result?.year).toBe(currentYear + 1);
    });
  });

  describe('yearsUntil', () => {
    it('should calculate years until target age', () => {
      expect(yearsUntil(30, 65)).toBe(35);
      expect(yearsUntil(50, 65)).toBe(15);
      expect(yearsUntil(60, 62)).toBe(2);
    });

    it('should return 0 when already past target age', () => {
      expect(yearsUntil(70, 65)).toBe(0);
      expect(yearsUntil(65, 65)).toBe(0);
    });

    it('should handle fractional ages', () => {
      expect(yearsUntil(59, 59.5)).toBe(1); // Rounds up
      expect(yearsUntil(59.5, 62)).toBe(3); // 2.5 rounds up to 3
    });
  });

  describe('formatAge', () => {
    it('should format whole ages', () => {
      expect(formatAge(30)).toBe('30');
      expect(formatAge(65)).toBe('65');
      expect(formatAge(100)).toBe('100');
    });

    it('should format half ages with ½ symbol', () => {
      expect(formatAge(59.5)).toBe('59½');
      expect(formatAge(62.5)).toBe('62½');
    });

    it('should floor other fractional ages', () => {
      expect(formatAge(30.3)).toBe('30');
      expect(formatAge(65.9)).toBe('65');
    });
  });

  describe('Edge Cases', () => {
    it('should handle retirement age equal to current age', () => {
      const assumptions = createMockAssumptions({ birthYear: new Date().getFullYear() - 65, retirementAge: 65 });
      const simulation: SimulationYear[] = [];

      const result = calculateMilestones(assumptions, simulation);

      expect(result.currentAge).toBe(65);
      expect(result.retirementAge).toBe(65);
      expect(result.retirementYear).toBe(result.currentYear);
    });

    it('should cap progress at 100%', () => {
      // Edge case: current age > life expectancy (shouldn't happen but handle gracefully)
      const assumptions = createMockAssumptions({ birthYear: new Date().getFullYear() - 95, lifeExpectancy: 90 });
      const simulation: SimulationYear[] = [];

      const result = calculateMilestones(assumptions, simulation);

      expect(result.progress).toBe(100);
    });
  });
});
