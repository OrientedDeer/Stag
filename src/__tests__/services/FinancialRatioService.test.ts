import { describe, it, expect } from 'vitest';
import {
  calculateFinancialRatios,
  calculateRatioTrends,
  getRatingColor,
  getRatingBgColor,
  getRatingLabel,
} from '../../services/FinancialRatioService';
import { SimulationYear } from '../../components/Objects/Assumptions/SimulationEngine';
import { SavedAccount, InvestedAccount, DebtAccount } from '../../components/Objects/Accounts/models';

// Helper to create a mock SimulationYear
function createMockSimulationYear(
  year: number,
  options: {
    savedAmount?: number;
    investedAmount?: number;
    debtAmount?: number;
    totalIncome?: number;
    totalExpense?: number;
    // Set to true to zero out taxDetails (so livingExpenses = totalExpense)
    zeroTaxDetails?: boolean;
  } = {}
): SimulationYear {
  const {
    savedAmount = 10000,
    investedAmount = 50000,
    debtAmount = 0,
    totalIncome = 100000,
    totalExpense = 70000,
    zeroTaxDetails = false,
  } = options;

  const accounts = [];

  if (savedAmount > 0) {
    accounts.push(
      new SavedAccount('s1', 'Emergency Fund', savedAmount, 1)
    );
  }

  if (investedAmount > 0) {
    accounts.push(
      new InvestedAccount(
        'i1', 'Brokerage', investedAmount, 0, 0, 0.1, 'Brokerage'
      )
    );
  }

  if (debtAmount > 0) {
    accounts.push(
      new DebtAccount('d1', 'Credit Card', debtAmount, '', 18)
    );
  }

  return {
    year,
    incomes: [],
    expenses: [],
    accounts,
    cashflow: {
      totalIncome,
      totalExpense,
      discretionary: totalIncome - totalExpense,
      investedUser: 10000,
      investedMatch: 5000,
      totalInvested: 15000,
      bucketAllocations: 0,
      bucketDetail: {},
      withdrawals: 0,
      withdrawalDetail: {},
    },
    taxDetails: zeroTaxDetails ? {
      fed: 0,
      state: 0,
      fica: 0,
      preTax: 0,
      insurance: 0,
      postTax: 0,
      capitalGains: 0,
    } : {
      fed: 15000,
      state: 5000,
      fica: 7650,
      preTax: 10000,
      insurance: 3000,
      postTax: 0,
      capitalGains: 0,
    },
    logs: [],
  };
}

describe('FinancialRatioService', () => {
  describe('calculateFinancialRatios', () => {
    it('should calculate savings rate correctly', () => {
      const year = createMockSimulationYear(2025, {
        totalIncome: 100000,
        totalExpense: 70000,
      });

      const ratios = calculateFinancialRatios(year);

      // Savings rate = (100000 - 70000) / 100000 = 0.30
      expect(ratios.savingsRate.value).toBe(0.3);
      expect(ratios.savingsRate.rating).toBe('excellent'); // 20%+ is excellent
    });

    it('should calculate expense ratio correctly', () => {
      const year = createMockSimulationYear(2025, {
        totalIncome: 100000,
        totalExpense: 80000,
      });

      const ratios = calculateFinancialRatios(year);

      // Expense ratio = 80000 / 100000 = 0.80
      expect(ratios.expenseRatio.value).toBe(0.8);
    });

    it('should calculate emergency fund months correctly', () => {
      const year = createMockSimulationYear(2025, {
        savedAmount: 30000,
        totalExpense: 60000, // 5000/month (using zeroTaxDetails so living = total)
        zeroTaxDetails: true,
      });

      const ratios = calculateFinancialRatios(year);

      // Emergency months = 30000 / (60000/12) = 30000 / 5000 = 6 months
      expect(ratios.emergencyFundMonths.value).toBe(6);
      expect(ratios.emergencyFundMonths.rating).toBe('excellent'); // 6+ is excellent
    });

    it('should calculate debt-to-income ratio correctly', () => {
      const year = createMockSimulationYear(2025, {
        debtAmount: 20000,
        totalIncome: 100000,
      });

      const ratios = calculateFinancialRatios(year);

      // Debt-to-income = 20000 / 100000 = 0.20
      expect(ratios.debtToIncomeRatio.value).toBe(0.2);
      expect(ratios.debtToIncomeRatio.rating).toBe('excellent'); // <=20% is excellent
    });

    it('should calculate debt-to-asset ratio correctly', () => {
      const year = createMockSimulationYear(2025, {
        savedAmount: 10000,
        investedAmount: 40000,
        debtAmount: 15000,
      });

      const ratios = calculateFinancialRatios(year);

      // Total assets = 10000 + 40000 = 50000
      // Debt-to-asset = 15000 / 50000 = 0.30
      expect(ratios.debtToAssetRatio.value).toBe(0.3);
      expect(ratios.debtToAssetRatio.rating).toBe('good'); // <=30% is good
    });

    it('should calculate net worth to income ratio correctly', () => {
      const year = createMockSimulationYear(2025, {
        savedAmount: 50000,
        investedAmount: 450000,
        debtAmount: 0,
        totalIncome: 100000,
      });

      const ratios = calculateFinancialRatios(year);

      // Net worth = 500000, income = 100000
      // Ratio = 500000 / 100000 = 5
      expect(ratios.netWorthToIncomeRatio.value).toBe(5);
      expect(ratios.netWorthToIncomeRatio.rating).toBe('excellent'); // 5x+ is excellent
    });

    it('should calculate investment allocation correctly', () => {
      const year = createMockSimulationYear(2025, {
        savedAmount: 20000,
        investedAmount: 80000,
      });

      const ratios = calculateFinancialRatios(year);

      // Total assets = 100000, invested = 80000
      // Allocation = 80000 / 100000 = 0.80
      expect(ratios.investmentAllocation.value).toBe(0.8);
      expect(ratios.investmentAllocation.rating).toBe('excellent'); // 80%+ is excellent
    });

    it('should calculate growth rates when previous year provided', () => {
      const prevYear = createMockSimulationYear(2024, {
        savedAmount: 10000,
        investedAmount: 40000,
      });

      const currYear = createMockSimulationYear(2025, {
        savedAmount: 12000,
        investedAmount: 48000,
      });

      const ratios = calculateFinancialRatios(currYear, prevYear);

      // Previous net worth = 50000, current = 60000
      // Growth = (60000 - 50000) / 50000 = 0.20 = 20%
      expect(ratios.netWorthGrowthRate).not.toBeNull();
      expect(ratios.netWorthGrowthRate!.value).toBe(0.2);
      expect(ratios.netWorthGrowthRate!.rating).toBe('excellent'); // 15%+ is excellent
    });

    it('should not have growth rates without previous year', () => {
      const year = createMockSimulationYear(2025);
      const ratios = calculateFinancialRatios(year);

      expect(ratios.netWorthGrowthRate).toBeNull();
      expect(ratios.assetGrowthRate).toBeNull();
    });

    it('should handle zero income gracefully', () => {
      const year = createMockSimulationYear(2025, {
        totalIncome: 0,
        totalExpense: 5000,
      });

      const ratios = calculateFinancialRatios(year);

      expect(ratios.savingsRate.value).toBe(0);
      expect(ratios.expenseRatio.value).toBe(1);
      expect(ratios.debtToIncomeRatio.value).toBe(0);
    });

    it('should handle zero expenses gracefully', () => {
      const year = createMockSimulationYear(2025, {
        savedAmount: 10000,
        totalExpense: 0,
      });

      const ratios = calculateFinancialRatios(year);

      expect(ratios.emergencyFundMonths.value).toBe(0);
    });
  });

  describe('calculateRatioTrends', () => {
    it('should calculate trends for multiple years', () => {
      const simulation = [
        createMockSimulationYear(2025, { totalIncome: 100000, totalExpense: 70000 }),
        createMockSimulationYear(2026, { totalIncome: 105000, totalExpense: 72000 }),
        createMockSimulationYear(2027, { totalIncome: 110000, totalExpense: 75000 }),
      ];

      const trends = calculateRatioTrends(simulation);

      expect(trends).toHaveLength(3);
      expect(trends[0].year).toBe(2025);
      expect(trends[0].savingsRate).toBeCloseTo(0.3, 2);
      expect(trends[1].year).toBe(2026);
      expect(trends[2].year).toBe(2027);
    });

    it('should return empty array for empty simulation', () => {
      const trends = calculateRatioTrends([]);
      expect(trends).toHaveLength(0);
    });
  });

  describe('Rating helpers', () => {
    it('should return correct colors for ratings', () => {
      expect(getRatingColor('excellent')).toBe('text-green-400');
      expect(getRatingColor('good')).toBe('text-blue-400');
      expect(getRatingColor('fair')).toBe('text-yellow-400');
      expect(getRatingColor('poor')).toBe('text-orange-400');
      expect(getRatingColor('critical')).toBe('text-red-400');
    });

    it('should return correct background colors for ratings', () => {
      expect(getRatingBgColor('excellent')).toContain('green');
      expect(getRatingBgColor('good')).toContain('blue');
      expect(getRatingBgColor('fair')).toContain('yellow');
      expect(getRatingBgColor('poor')).toContain('orange');
      expect(getRatingBgColor('critical')).toContain('red');
    });

    it('should return correct labels for ratings', () => {
      expect(getRatingLabel('excellent')).toBe('Excellent');
      expect(getRatingLabel('good')).toBe('Good');
      expect(getRatingLabel('fair')).toBe('Fair');
      expect(getRatingLabel('poor')).toBe('Needs Work');
      expect(getRatingLabel('critical')).toBe('Critical');
    });
  });

  describe('Savings rate rating benchmarks', () => {
    it('should rate 20%+ as excellent', () => {
      const year = createMockSimulationYear(2025, {
        totalIncome: 100000,
        totalExpense: 75000, // 25% savings
      });
      expect(calculateFinancialRatios(year).savingsRate.rating).toBe('excellent');
    });

    it('should rate 15-19% as good', () => {
      const year = createMockSimulationYear(2025, {
        totalIncome: 100000,
        totalExpense: 83000, // 17% savings
      });
      expect(calculateFinancialRatios(year).savingsRate.rating).toBe('good');
    });

    it('should rate 10-14% as fair', () => {
      const year = createMockSimulationYear(2025, {
        totalIncome: 100000,
        totalExpense: 88000, // 12% savings
      });
      expect(calculateFinancialRatios(year).savingsRate.rating).toBe('fair');
    });

    it('should rate 0-9% as poor', () => {
      const year = createMockSimulationYear(2025, {
        totalIncome: 100000,
        totalExpense: 95000, // 5% savings
      });
      expect(calculateFinancialRatios(year).savingsRate.rating).toBe('poor');
    });

    it('should rate negative as critical', () => {
      const year = createMockSimulationYear(2025, {
        totalIncome: 100000,
        totalExpense: 110000, // -10% savings
      });
      expect(calculateFinancialRatios(year).savingsRate.rating).toBe('critical');
    });
  });

  describe('Emergency fund rating benchmarks', () => {
    it('should rate 6+ months as excellent', () => {
      const year = createMockSimulationYear(2025, {
        savedAmount: 40000,
        totalExpense: 60000, // 5000/month, 8 months
        zeroTaxDetails: true,
      });
      expect(calculateFinancialRatios(year).emergencyFundMonths.rating).toBe('excellent');
    });

    it('should rate 3-5 months as good', () => {
      const year = createMockSimulationYear(2025, {
        savedAmount: 20000,
        totalExpense: 60000, // 5000/month, 4 months
        zeroTaxDetails: true,
      });
      expect(calculateFinancialRatios(year).emergencyFundMonths.rating).toBe('good');
    });

    it('should rate 1-2 months as fair', () => {
      const year = createMockSimulationYear(2025, {
        savedAmount: 10000,
        totalExpense: 60000, // 5000/month, 2 months
        zeroTaxDetails: true,
      });
      expect(calculateFinancialRatios(year).emergencyFundMonths.rating).toBe('fair');
    });

    it('should rate 0.5-1 months as poor', () => {
      const year = createMockSimulationYear(2025, {
        savedAmount: 4000,
        totalExpense: 60000, // 5000/month, 0.8 months
        zeroTaxDetails: true,
      });
      expect(calculateFinancialRatios(year).emergencyFundMonths.rating).toBe('poor');
    });

    it('should rate <0.5 month as critical', () => {
      const year = createMockSimulationYear(2025, {
        savedAmount: 2000,
        totalExpense: 60000, // 5000/month, 0.4 months
        zeroTaxDetails: true,
      });
      expect(calculateFinancialRatios(year).emergencyFundMonths.rating).toBe('critical');
    });
  });
});
