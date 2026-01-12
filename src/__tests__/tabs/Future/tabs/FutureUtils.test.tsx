import { describe, it, expect } from 'vitest';
import {
  getAccountTotals,
  calculateNetWorth,
  formatCurrency,
  findFinancialIndependenceYear,
} from '../../../../tabs/Future/tabs/FutureUtils';
import { SavedAccount, InvestedAccount, DebtAccount, AnyAccount } from '../../../../components/Objects/Accounts/models';
import { SimulationYear } from '../../../../components/Objects/Assumptions/SimulationEngine';
import { AssumptionsState, defaultAssumptions } from '../../../../components/Objects/Assumptions/AssumptionsContext';

describe('FutureUtils', () => {
  describe('getAccountTotals and calculateNetWorth', () => {
    it('should correctly sum assets and liabilities to find net worth', () => {
      const accounts: AnyAccount[] = [
        new SavedAccount('s1', 'Savings', 10000),
        new InvestedAccount('i1', 'Brokerage', 50000, 0, 0, 0, 'Brokerage', true, 0),
        new DebtAccount('d1', 'Student Loan', 20000, 'l1', 5),
        new DebtAccount('d2', 'Credit Card', 5000, 'l2', 18),
      ];

      const { assets, liabilities, netWorth } = getAccountTotals(accounts);

      expect(assets).toBe(60000); // 10000 + 50000
      expect(liabilities).toBe(25000); // 20000 + 5000
      expect(netWorth).toBe(35000); // 60000 - 25000
      
      // Test the wrapper function
      expect(calculateNetWorth(accounts)).toBe(35000);
    });

    it('should handle an empty list of accounts', () => {
      const { assets, liabilities, netWorth } = getAccountTotals([]);
      expect(assets).toBe(0);
      expect(liabilities).toBe(0);
      expect(netWorth).toBe(0);
    });

    it('should handle only asset accounts', () => {
        const accounts: AnyAccount[] = [
          new SavedAccount('s1', 'Savings', 10000),
          new InvestedAccount('i1', 'Brokerage', 50000, 0, 0, 0, 'Brokerage', true, 0),
        ];
        const { assets, liabilities, netWorth } = getAccountTotals(accounts);
        expect(assets).toBe(60000);
        expect(liabilities).toBe(0);
        expect(netWorth).toBe(60000);
    });

    it('should handle only debt accounts', () => {
        const accounts: AnyAccount[] = [
            new DebtAccount('d1', 'Student Loan', 20000, 'l1', 5),
        ];
        const { assets, liabilities, netWorth } = getAccountTotals(accounts);
        expect(assets).toBe(0);
        expect(liabilities).toBe(20000);
        expect(netWorth).toBe(-20000);
    });
  });

  describe('formatCurrency', () => {
    it('should format positive numbers correctly', () => {
      expect(formatCurrency(1234.56)).toBe('$1,234.56');
    });

    it('should format zero correctly', () => {
      expect(formatCurrency(0)).toBe('$0.00');
    });

    it('should format negative numbers correctly', () => {
      expect(formatCurrency(-500)).toBe('-$500.00');
    });

    it('should round numbers with more than two decimal places', () => {
      expect(formatCurrency(99.987)).toBe('$99.99');
    });

    it('should handle large numbers with commas', () => {
        expect(formatCurrency(1000000)).toBe('$1,000,000.00');
    });
  });

  describe('findFinancialIndependenceYear', () => {
    const mockAssumptions: AssumptionsState = {
      ...defaultAssumptions,
      investments: {
        ...defaultAssumptions.investments,
        withdrawalRate: 4, // 4% withdrawal rate
      },
    };

    const createMockYear = (year: number, investmentAmount: number, totalExpense: number): SimulationYear => ({
      year,
      incomes: [],
      expenses: [],
      accounts: [new InvestedAccount('i1', '401k', investmentAmount, 0, 0, 0, 'Traditional 401k', true, 0)],
      cashflow: {
        totalIncome: 0,
        totalExpense,
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
      },
      logs: [],
    });

    it('should return the year financial independence is reached', () => {
      const simulation: SimulationYear[] = [
        createMockYear(2025, 900000, 50000),  // 900k * 0.04 = 36k (Not enough)
        createMockYear(2026, 1000000, 50000), // Check against this year's expense. 900k * 0.04 > 50k is FALSE
        createMockYear(2027, 1100000, 50000), // Check against this year's expense. 1M * 0.04 = 40k (Not enough)
        createMockYear(2028, 1300000, 50000), // Check against this year's expense. 1.1M * 0.04 = 44k (Not enough)
        createMockYear(2029, 1500000, 50000), // Check against this year's expense. 1.3M * 0.04 = 52k (ENOUGH!)
      ];

      expect(findFinancialIndependenceYear(simulation, mockAssumptions)).toBe(2029);
    });

    it('should return null if financial independence is never reached', () => {
        const simulation: SimulationYear[] = [
          createMockYear(2025, 100000, 50000),
          createMockYear(2026, 120000, 51000),
          createMockYear(2027, 140000, 52000),
        ];
  
        expect(findFinancialIndependenceYear(simulation, mockAssumptions)).toBeNull();
    });

    it('should return null for an empty or single-year simulation', () => {
        expect(findFinancialIndependenceYear([], mockAssumptions)).toBeNull();
        const singleYearSim = [createMockYear(2025, 100000, 50000)];
        expect(findFinancialIndependenceYear(singleYearSim, mockAssumptions)).toBeNull();
    });

    it('should handle the case where there are no invested accounts', () => {
        const simulation: SimulationYear[] = [
            { ...createMockYear(2025, 100000, 40000), accounts: [new SavedAccount('s1', 'Savings', 1000000)] },
            { ...createMockYear(2026, 120000, 40000), accounts: [new SavedAccount('s1', 'Savings', 1100000)] },
        ];
        expect(findFinancialIndependenceYear(simulation, mockAssumptions)).toBeNull();
    });
  });
});
