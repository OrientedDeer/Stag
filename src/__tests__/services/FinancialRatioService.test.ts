import { describe, it, expect } from 'vitest';
import {
  calculateFinancialRatios,
  calculateRatioTrends,
  getRatingColor,
  getRatingBgColor,
  getRatingLabel,
  rateSavingsRate,
  rateEmergencyFund,
  rateDebtToIncome,
  rateDebtToAsset,
  getNetWorthTarget,
  rateNetWorthToIncome,
  rateInvestmentAllocation,
  rateGrowthRate,
  getSustainableRate,
  rateWithdrawalRate,
  rateRetirementSavingsRate,
  rateRetirementGrowthRate,
  ratePortfolioYears,
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
    livingExpenses?: number;
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
    livingExpenses = totalExpense,
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
      livingExpenses,
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
      niit: 0,
    } : {
      fed: 15000,
      state: 5000,
      fica: 7650,
      preTax: 10000,
      insurance: 3000,
      postTax: 0,
      capitalGains: 0,
      niit: 0,
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
        livingExpenses: 0,
      });

      const ratios = calculateFinancialRatios(year);

      // Savings rate = (100000 - 70000 + 10000 preTax) / 100000 = 0.40
      // 401k/HSA contributions (preTax) count as savings, not expenses
      expect(ratios.savingsRate.value).toBe(0.4);
      expect(ratios.savingsRate.rating).toBe('excellent'); // 20%+ is excellent
    });

    it('should calculate expense ratio correctly', () => {
      const year = createMockSimulationYear(2025, {
        totalIncome: 100000,
        totalExpense: 80000,
        livingExpenses: 0,
      });

      const ratios = calculateFinancialRatios(year);

      // Expense ratio = (80000 - 10000 preTax) / 100000 = 0.70
      // 401k/HSA contributions (preTax) are excluded as they're savings
      expect(ratios.expenseRatio.value).toBe(0.7);
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
        livingExpenses: 0,
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
        livingExpenses: 0,
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
      // Savings rate includes preTax (10000) as savings: (100000 - 70000 + 10000) / 100000 = 0.40
      expect(trends[0].savingsRate).toBeCloseTo(0.4, 2);
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
        zeroTaxDetails: true,
      });
      expect(calculateFinancialRatios(year).savingsRate.rating).toBe('excellent');
    });

    it('should rate 15-19% as good', () => {
      const year = createMockSimulationYear(2025, {
        totalIncome: 100000,
        totalExpense: 83000, // 17% savings
        zeroTaxDetails: true,
      });
      expect(calculateFinancialRatios(year).savingsRate.rating).toBe('good');
    });

    it('should rate 10-14% as fair', () => {
      const year = createMockSimulationYear(2025, {
        totalIncome: 100000,
        totalExpense: 88000, // 12% savings
        zeroTaxDetails: true,
      });
      expect(calculateFinancialRatios(year).savingsRate.rating).toBe('fair');
    });

    it('should rate 0-9% as poor', () => {
      const year = createMockSimulationYear(2025, {
        totalIncome: 100000,
        totalExpense: 95000, // 5% savings
        zeroTaxDetails: true,
      });
      expect(calculateFinancialRatios(year).savingsRate.rating).toBe('poor');
    });

    it('should rate negative as critical', () => {
      const year = createMockSimulationYear(2025, {
        totalIncome: 100000,
        totalExpense: 110000, // -10% savings
        zeroTaxDetails: true,
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

  // ==========================================================================
  // Direct Unit Tests for Rating Functions
  // ==========================================================================

  describe('rateSavingsRate', () => {
    describe('rating levels', () => {
      it('should rate 0% as poor', () => {
        expect(rateSavingsRate(0)).toBe('poor');
      });

      it('should rate 5% as poor', () => {
        expect(rateSavingsRate(0.05)).toBe('poor');
      });

      it('should rate 10% as fair', () => {
        expect(rateSavingsRate(0.10)).toBe('fair');
      });

      it('should rate 15% as good', () => {
        expect(rateSavingsRate(0.15)).toBe('good');
      });

      it('should rate 20% as excellent', () => {
        expect(rateSavingsRate(0.20)).toBe('excellent');
      });

      it('should rate 25% as excellent', () => {
        expect(rateSavingsRate(0.25)).toBe('excellent');
      });

      it('should rate negative as critical', () => {
        expect(rateSavingsRate(-0.05)).toBe('critical');
        expect(rateSavingsRate(-0.10)).toBe('critical');
      });
    });

    describe('boundary conditions', () => {
      it('should rate exactly 10% as fair (boundary)', () => {
        expect(rateSavingsRate(0.10)).toBe('fair');
      });

      it('should rate 9.99% as poor', () => {
        expect(rateSavingsRate(0.0999)).toBe('poor');
      });

      it('should rate exactly 15% as good (boundary)', () => {
        expect(rateSavingsRate(0.15)).toBe('good');
      });

      it('should rate 14.99% as fair', () => {
        expect(rateSavingsRate(0.1499)).toBe('fair');
      });

      it('should rate exactly 20% as excellent (boundary)', () => {
        expect(rateSavingsRate(0.20)).toBe('excellent');
      });

      it('should rate 19.99% as good', () => {
        expect(rateSavingsRate(0.1999)).toBe('good');
      });
    });
  });

  describe('rateEmergencyFund', () => {
    describe('rating levels', () => {
      it('should rate 0 months as critical', () => {
        expect(rateEmergencyFund(0)).toBe('critical');
      });

      it('should rate 0.5 months as poor', () => {
        expect(rateEmergencyFund(0.5)).toBe('poor');
      });

      it('should rate 1 month as fair', () => {
        expect(rateEmergencyFund(1)).toBe('fair');
      });

      it('should rate 3 months as good', () => {
        expect(rateEmergencyFund(3)).toBe('good');
      });

      it('should rate 6 months as excellent', () => {
        expect(rateEmergencyFund(6)).toBe('excellent');
      });

      it('should rate 12 months as excellent', () => {
        expect(rateEmergencyFund(12)).toBe('excellent');
      });
    });

    describe('boundary conditions', () => {
      it('should rate exactly 0.5 months as poor (boundary)', () => {
        expect(rateEmergencyFund(0.5)).toBe('poor');
      });

      it('should rate 0.49 months as critical', () => {
        expect(rateEmergencyFund(0.49)).toBe('critical');
      });

      it('should rate exactly 1 month as fair (boundary)', () => {
        expect(rateEmergencyFund(1)).toBe('fair');
      });

      it('should rate 0.99 months as poor', () => {
        expect(rateEmergencyFund(0.99)).toBe('poor');
      });

      it('should rate exactly 3 months as good (boundary)', () => {
        expect(rateEmergencyFund(3)).toBe('good');
      });

      it('should rate 2.99 months as fair', () => {
        expect(rateEmergencyFund(2.99)).toBe('fair');
      });

      it('should rate exactly 6 months as excellent (boundary)', () => {
        expect(rateEmergencyFund(6)).toBe('excellent');
      });

      it('should rate 5.99 months as good', () => {
        expect(rateEmergencyFund(5.99)).toBe('good');
      });
    });
  });

  describe('rateDebtToIncome', () => {
    describe('rating levels', () => {
      it('should rate 0% as excellent', () => {
        expect(rateDebtToIncome(0)).toBe('excellent');
      });

      it('should rate 20% as excellent', () => {
        expect(rateDebtToIncome(0.20)).toBe('excellent');
      });

      it('should rate 30% as good', () => {
        expect(rateDebtToIncome(0.30)).toBe('good');
      });

      it('should rate 36% as good (mortgage threshold)', () => {
        expect(rateDebtToIncome(0.36)).toBe('good');
      });

      it('should rate 40% as fair', () => {
        expect(rateDebtToIncome(0.40)).toBe('fair');
      });

      it('should rate 50% as poor', () => {
        expect(rateDebtToIncome(0.50)).toBe('poor');
      });

      it('should rate over 100% as critical', () => {
        expect(rateDebtToIncome(1.0)).toBe('critical');
        expect(rateDebtToIncome(1.5)).toBe('critical');
      });
    });

    describe('boundary conditions', () => {
      it('should rate exactly 20% as excellent (boundary)', () => {
        expect(rateDebtToIncome(0.20)).toBe('excellent');
      });

      it('should rate 20.01% as good', () => {
        expect(rateDebtToIncome(0.2001)).toBe('good');
      });

      it('should rate exactly 36% as good (boundary)', () => {
        expect(rateDebtToIncome(0.36)).toBe('good');
      });

      it('should rate 36.01% as fair', () => {
        expect(rateDebtToIncome(0.3601)).toBe('fair');
      });

      it('should rate exactly 43% as fair (boundary)', () => {
        expect(rateDebtToIncome(0.43)).toBe('fair');
      });

      it('should rate 43.01% as poor', () => {
        expect(rateDebtToIncome(0.4301)).toBe('poor');
      });

      it('should rate exactly 50% as poor (boundary)', () => {
        expect(rateDebtToIncome(0.50)).toBe('poor');
      });

      it('should rate 50.01% as critical', () => {
        expect(rateDebtToIncome(0.5001)).toBe('critical');
      });
    });
  });

  describe('rateDebtToAsset', () => {
    describe('rating levels', () => {
      it('should rate 0% as excellent (no debt)', () => {
        expect(rateDebtToAsset(0)).toBe('excellent');
      });

      it('should rate 20% as excellent', () => {
        expect(rateDebtToAsset(0.20)).toBe('excellent');
      });

      it('should rate 25% as good', () => {
        expect(rateDebtToAsset(0.25)).toBe('good');
      });

      it('should rate 40% as fair', () => {
        expect(rateDebtToAsset(0.40)).toBe('fair');
      });

      it('should rate 50% as fair', () => {
        expect(rateDebtToAsset(0.50)).toBe('fair');
      });

      it('should rate 75% as poor', () => {
        expect(rateDebtToAsset(0.75)).toBe('poor');
      });

      it('should rate over 100% as critical (underwater)', () => {
        expect(rateDebtToAsset(1.0)).toBe('critical');
        expect(rateDebtToAsset(1.5)).toBe('critical');
      });
    });

    describe('boundary conditions', () => {
      it('should rate exactly 20% as excellent (boundary)', () => {
        expect(rateDebtToAsset(0.20)).toBe('excellent');
      });

      it('should rate 20.01% as good', () => {
        expect(rateDebtToAsset(0.2001)).toBe('good');
      });

      it('should rate exactly 30% as good (boundary)', () => {
        expect(rateDebtToAsset(0.30)).toBe('good');
      });

      it('should rate 30.01% as fair', () => {
        expect(rateDebtToAsset(0.3001)).toBe('fair');
      });

      it('should rate exactly 50% as fair (boundary)', () => {
        expect(rateDebtToAsset(0.50)).toBe('fair');
      });

      it('should rate 50.01% as poor', () => {
        expect(rateDebtToAsset(0.5001)).toBe('poor');
      });

      it('should rate exactly 80% as poor (boundary)', () => {
        expect(rateDebtToAsset(0.80)).toBe('poor');
      });

      it('should rate 80.01% as critical', () => {
        expect(rateDebtToAsset(0.8001)).toBe('critical');
      });
    });
  });

  describe('getNetWorthTarget', () => {
    describe('age-based targets', () => {
      it('should return 0.5x for age 25', () => {
        expect(getNetWorthTarget(25)).toBe(0.5);
      });

      it('should return 1x for age 30', () => {
        expect(getNetWorthTarget(30)).toBe(1);
      });

      it('should return 3x for age 40', () => {
        expect(getNetWorthTarget(40)).toBe(3);
      });

      it('should return 6x for age 50', () => {
        expect(getNetWorthTarget(50)).toBe(6);
      });

      it('should return 8x for age 60', () => {
        expect(getNetWorthTarget(60)).toBe(8);
      });

      it('should return 10x for age 67', () => {
        expect(getNetWorthTarget(67)).toBe(10);
      });
    });

    describe('interpolation', () => {
      it('should interpolate between 25 and 30 (age 27.5 = 0.75x)', () => {
        expect(getNetWorthTarget(27.5)).toBe(0.75);
      });

      it('should interpolate between 30 and 35 (age 32.5 = 1.5x)', () => {
        expect(getNetWorthTarget(32.5)).toBe(1.5);
      });

      it('should interpolate between 40 and 45 (age 42.5 = 3.5x)', () => {
        expect(getNetWorthTarget(42.5)).toBe(3.5);
      });
    });

    describe('edge cases', () => {
      it('should return 0.5x for ages below 25', () => {
        expect(getNetWorthTarget(20)).toBe(0.5);
        expect(getNetWorthTarget(18)).toBe(0.5);
      });

      it('should return 10x for ages above 67', () => {
        expect(getNetWorthTarget(70)).toBe(10);
        expect(getNetWorthTarget(80)).toBe(10);
      });
    });

    describe('targets increase with age', () => {
      it('should have monotonically increasing targets', () => {
        const ages = [25, 30, 35, 40, 45, 50, 55, 60, 67];
        for (let i = 1; i < ages.length; i++) {
          expect(getNetWorthTarget(ages[i])).toBeGreaterThan(getNetWorthTarget(ages[i - 1]));
        }
      });
    });
  });

  describe('rateNetWorthToIncome', () => {
    describe('without age parameter (default target = 3x)', () => {
      it('should rate 3x as excellent (at target)', () => {
        expect(rateNetWorthToIncome(3)).toBe('excellent');
      });

      it('should rate 4x as excellent (above target)', () => {
        expect(rateNetWorthToIncome(4)).toBe('excellent');
      });

      it('should rate 2.25x as good (75% of target)', () => {
        expect(rateNetWorthToIncome(2.25)).toBe('good');
      });

      it('should rate 1.5x as fair (50% of target)', () => {
        expect(rateNetWorthToIncome(1.5)).toBe('fair');
      });

      it('should rate 1x as poor (below 50% of target)', () => {
        expect(rateNetWorthToIncome(1)).toBe('poor');
      });

      it('should rate negative net worth as critical', () => {
        expect(rateNetWorthToIncome(-1)).toBe('critical');
      });
    });

    describe('with age 30 (target = 1x)', () => {
      it('should rate 1x as excellent (at target)', () => {
        expect(rateNetWorthToIncome(1, 30)).toBe('excellent');
      });

      it('should rate 0.75x as good (75% of target)', () => {
        expect(rateNetWorthToIncome(0.75, 30)).toBe('good');
      });

      it('should rate 0.5x as fair (50% of target)', () => {
        expect(rateNetWorthToIncome(0.5, 30)).toBe('fair');
      });

      it('should rate 0.25x as poor (below 50%)', () => {
        expect(rateNetWorthToIncome(0.25, 30)).toBe('poor');
      });
    });

    describe('with age 50 (target = 6x)', () => {
      it('should rate 6x as excellent (at target)', () => {
        expect(rateNetWorthToIncome(6, 50)).toBe('excellent');
      });

      it('should rate 4.5x as good (75% of target)', () => {
        expect(rateNetWorthToIncome(4.5, 50)).toBe('good');
      });

      it('should rate 3x as fair (50% of target)', () => {
        expect(rateNetWorthToIncome(3, 50)).toBe('fair');
      });

      it('should rate 2x as poor (below 50%)', () => {
        expect(rateNetWorthToIncome(2, 50)).toBe('poor');
      });
    });

    describe('with age 65 (target ~ 9x)', () => {
      it('should rate 9x+ as excellent', () => {
        const target = getNetWorthTarget(65);
        expect(rateNetWorthToIncome(target, 65)).toBe('excellent');
      });

      it('should rate 75% of target as good', () => {
        const target = getNetWorthTarget(65);
        expect(rateNetWorthToIncome(target * 0.75, 65)).toBe('good');
      });
    });
  });

  describe('rateInvestmentAllocation', () => {
    describe('rating levels', () => {
      it('should rate 0% as critical (nothing invested)', () => {
        expect(rateInvestmentAllocation(0)).toBe('critical');
      });

      it('should rate 5% as critical', () => {
        expect(rateInvestmentAllocation(0.05)).toBe('critical');
      });

      it('should rate 10% as poor', () => {
        expect(rateInvestmentAllocation(0.10)).toBe('poor');
      });

      it('should rate 20% as fair', () => {
        expect(rateInvestmentAllocation(0.20)).toBe('fair');
      });

      it('should rate 40% as good', () => {
        expect(rateInvestmentAllocation(0.40)).toBe('good');
      });

      it('should rate 60% as excellent', () => {
        expect(rateInvestmentAllocation(0.60)).toBe('excellent');
      });

      it('should rate 80% as excellent', () => {
        expect(rateInvestmentAllocation(0.80)).toBe('excellent');
      });
    });

    describe('boundary conditions', () => {
      it('should rate exactly 10% as poor (boundary)', () => {
        expect(rateInvestmentAllocation(0.10)).toBe('poor');
      });

      it('should rate 9.99% as critical', () => {
        expect(rateInvestmentAllocation(0.0999)).toBe('critical');
      });

      it('should rate exactly 20% as fair (boundary)', () => {
        expect(rateInvestmentAllocation(0.20)).toBe('fair');
      });

      it('should rate 19.99% as poor', () => {
        expect(rateInvestmentAllocation(0.1999)).toBe('poor');
      });

      it('should rate exactly 40% as good (boundary)', () => {
        expect(rateInvestmentAllocation(0.40)).toBe('good');
      });

      it('should rate 39.99% as fair', () => {
        expect(rateInvestmentAllocation(0.3999)).toBe('fair');
      });

      it('should rate exactly 60% as excellent (boundary)', () => {
        expect(rateInvestmentAllocation(0.60)).toBe('excellent');
      });

      it('should rate 59.99% as good', () => {
        expect(rateInvestmentAllocation(0.5999)).toBe('good');
      });
    });
  });

  describe('rateGrowthRate', () => {
    describe('rating levels (no inflation offset)', () => {
      it('should rate negative growth as critical', () => {
        expect(rateGrowthRate(-0.05)).toBe('critical');
        expect(rateGrowthRate(-0.01)).toBe('critical');
      });

      it('should rate 0% growth as poor', () => {
        expect(rateGrowthRate(0)).toBe('poor');
      });

      it('should rate 3% growth as fair', () => {
        expect(rateGrowthRate(0.03)).toBe('fair');
      });

      it('should rate 7% growth as fair', () => {
        expect(rateGrowthRate(0.07)).toBe('fair');
      });

      it('should rate 8% growth as good', () => {
        expect(rateGrowthRate(0.08)).toBe('good');
      });

      it('should rate 10% growth as good', () => {
        expect(rateGrowthRate(0.10)).toBe('good');
      });

      it('should rate 15% growth as excellent', () => {
        expect(rateGrowthRate(0.15)).toBe('excellent');
      });

      it('should rate 20% growth as excellent', () => {
        expect(rateGrowthRate(0.20)).toBe('excellent');
      });
    });

    describe('with inflation offset', () => {
      it('should lower thresholds with negative offset (real returns)', () => {
        const offset = -0.03; // 3% inflation
        // 0% real = poor (0 >= -0.03), but -4% = critical
        expect(rateGrowthRate(0, offset)).toBe('fair'); // 0 >= 0.03 + (-0.03)
        expect(rateGrowthRate(-0.04, offset)).toBe('critical');
      });

      it('should raise thresholds with positive offset', () => {
        const offset = 0.03; // Need 3% more
        // 3% nominal = poor (just at 0 + offset threshold)
        expect(rateGrowthRate(0.03, offset)).toBe('poor');
        // 6% nominal = fair (>= 3% + offset)
        expect(rateGrowthRate(0.06, offset)).toBe('fair');
        // 11% nominal = good (>= 8% + offset)
        expect(rateGrowthRate(0.11, offset)).toBe('good');
        // 18% nominal = excellent (>= 15% + offset)
        expect(rateGrowthRate(0.18, offset)).toBe('excellent');
      });
    });

    describe('boundary conditions', () => {
      it('should rate exactly 3% as fair (boundary)', () => {
        expect(rateGrowthRate(0.03)).toBe('fair');
      });

      it('should rate 2.99% as poor', () => {
        expect(rateGrowthRate(0.0299)).toBe('poor');
      });

      it('should rate exactly 8% as good (boundary)', () => {
        expect(rateGrowthRate(0.08)).toBe('good');
      });

      it('should rate 7.99% as fair', () => {
        expect(rateGrowthRate(0.0799)).toBe('fair');
      });

      it('should rate exactly 15% as excellent (boundary)', () => {
        expect(rateGrowthRate(0.15)).toBe('excellent');
      });

      it('should rate 14.99% as good', () => {
        expect(rateGrowthRate(0.1499)).toBe('good');
      });
    });
  });

  describe('getSustainableRate', () => {
    describe('standard values', () => {
      it('should return 10% for 10 years remaining', () => {
        // max(0.04, 1/10) = max(0.04, 0.10) = 0.10
        expect(getSustainableRate(10)).toBe(0.10);
      });

      it('should return 5% for 20 years remaining', () => {
        // max(0.04, 1/20) = max(0.04, 0.05) = 0.05
        expect(getSustainableRate(20)).toBe(0.05);
      });

      it('should return 4% for 25 years remaining', () => {
        // max(0.04, 1/25) = max(0.04, 0.04) = 0.04
        expect(getSustainableRate(25)).toBe(0.04);
      });

      it('should return 4% for 30 years remaining', () => {
        // max(0.04, 1/30) = max(0.04, 0.0333) = 0.04
        expect(getSustainableRate(30)).toBe(0.04);
      });

      it('should return 4% for 40 years remaining', () => {
        // max(0.04, 1/40) = max(0.04, 0.025) = 0.04
        expect(getSustainableRate(40)).toBe(0.04);
      });
    });

    describe('edge cases', () => {
      it('should return 100% for 0 years remaining', () => {
        expect(getSustainableRate(0)).toBe(1.0);
      });

      it('should return 100% for negative years', () => {
        expect(getSustainableRate(-5)).toBe(1.0);
      });

      it('should return 20% for 5 years remaining', () => {
        // max(0.04, 1/5) = max(0.04, 0.20) = 0.20
        expect(getSustainableRate(5)).toBe(0.20);
      });
    });

    describe('rate decreases as years increase', () => {
      it('should have monotonically decreasing rates (until 4% floor)', () => {
        const years = [5, 10, 15, 20, 25, 30, 40];
        for (let i = 1; i < years.length; i++) {
          expect(getSustainableRate(years[i])).toBeLessThanOrEqual(getSustainableRate(years[i - 1]));
        }
      });
    });
  });

  describe('rateWithdrawalRate', () => {
    describe('with 30 years remaining (sustainable = 4%)', () => {
      const yearsRemaining = 30;
      // Sustainable withdrawal rate = 1/yearsRemaining = ~4%

      it('should rate 2% as excellent (50% of sustainable)', () => {
        // 0.02 <= 0.04 * 0.75 = 0.03
        expect(rateWithdrawalRate(0.02, yearsRemaining)).toBe('excellent');
      });

      it('should rate 3% as excellent (75% of sustainable)', () => {
        // 0.03 <= 0.04 * 0.75 = 0.03
        expect(rateWithdrawalRate(0.03, yearsRemaining)).toBe('excellent');
      });

      it('should rate 4% as good (at sustainable)', () => {
        // 0.04 <= 0.04 * 1.05 = 0.042
        expect(rateWithdrawalRate(0.04, yearsRemaining)).toBe('good');
      });

      it('should rate 5% as fair', () => {
        // 0.05 <= 0.04 * 1.30 = 0.052
        expect(rateWithdrawalRate(0.05, yearsRemaining)).toBe('fair');
      });

      it('should rate 6% as poor', () => {
        // 0.06 <= 0.04 * 1.55 = 0.062
        expect(rateWithdrawalRate(0.06, yearsRemaining)).toBe('poor');
      });

      it('should rate 7% as critical (unsustainable)', () => {
        // 0.07 > 0.04 * 1.55 = 0.062
        expect(rateWithdrawalRate(0.07, yearsRemaining)).toBe('critical');
      });
    });

    describe('with 10 years remaining (sustainable = 10%)', () => {
      const yearsRemaining = 10;

      it('should rate 7.5% as excellent', () => {
        // 0.075 <= 0.10 * 0.75 = 0.075
        expect(rateWithdrawalRate(0.075, yearsRemaining)).toBe('excellent');
      });

      it('should rate 10% as good', () => {
        // 0.10 <= 0.10 * 1.05 = 0.105
        expect(rateWithdrawalRate(0.10, yearsRemaining)).toBe('good');
      });

      it('should rate 12% as fair', () => {
        // 0.12 <= 0.10 * 1.30 = 0.13
        expect(rateWithdrawalRate(0.12, yearsRemaining)).toBe('fair');
      });

      it('should rate 15% as poor', () => {
        // 0.15 <= 0.10 * 1.55 = 0.155
        expect(rateWithdrawalRate(0.15, yearsRemaining)).toBe('poor');
      });

      it('should rate 20% as critical', () => {
        // 0.20 > 0.10 * 1.55 = 0.155
        expect(rateWithdrawalRate(0.20, yearsRemaining)).toBe('critical');
      });
    });

    describe('without yearsRemaining parameter (defaults to 30)', () => {
      it('should use 4% sustainable rate', () => {
        expect(rateWithdrawalRate(0.04)).toBe('good');
        expect(rateWithdrawalRate(0.03)).toBe('excellent');
        expect(rateWithdrawalRate(0.05)).toBe('fair');
      });
    });
  });

  describe('rateRetirementSavingsRate', () => {
    describe('rating levels', () => {
      it('should rate positive savings as excellent (building wealth in retirement)', () => {
        expect(rateRetirementSavingsRate(0.05)).toBe('excellent');
        expect(rateRetirementSavingsRate(0.10)).toBe('excellent');
      });

      it('should rate 0% as excellent (breaking even)', () => {
        expect(rateRetirementSavingsRate(0)).toBe('excellent');
      });

      it('should rate -3% as good (sustainable drawdown)', () => {
        expect(rateRetirementSavingsRate(-0.03)).toBe('good');
      });

      it('should rate -4% as fair (moderate drawdown)', () => {
        expect(rateRetirementSavingsRate(-0.04)).toBe('fair');
      });

      it('should rate -5% as fair', () => {
        expect(rateRetirementSavingsRate(-0.05)).toBe('fair');
      });

      it('should rate -7% as poor (high drawdown)', () => {
        expect(rateRetirementSavingsRate(-0.07)).toBe('poor');
      });

      it('should rate -10% as poor', () => {
        expect(rateRetirementSavingsRate(-0.10)).toBe('poor');
      });

      it('should rate -15% as critical (rapid depletion)', () => {
        expect(rateRetirementSavingsRate(-0.15)).toBe('critical');
      });
    });

    describe('boundary conditions', () => {
      it('should rate exactly 0% as excellent (boundary)', () => {
        expect(rateRetirementSavingsRate(0)).toBe('excellent');
      });

      it('should rate -0.01% as good', () => {
        expect(rateRetirementSavingsRate(-0.0001)).toBe('good');
      });

      it('should rate exactly -3% as good (boundary)', () => {
        expect(rateRetirementSavingsRate(-0.03)).toBe('good');
      });

      it('should rate -3.01% as fair', () => {
        expect(rateRetirementSavingsRate(-0.0301)).toBe('fair');
      });

      it('should rate exactly -5% as fair (boundary)', () => {
        expect(rateRetirementSavingsRate(-0.05)).toBe('fair');
      });

      it('should rate -5.01% as poor', () => {
        expect(rateRetirementSavingsRate(-0.0501)).toBe('poor');
      });

      it('should rate exactly -10% as poor (boundary)', () => {
        expect(rateRetirementSavingsRate(-0.10)).toBe('poor');
      });

      it('should rate -10.01% as critical', () => {
        expect(rateRetirementSavingsRate(-0.1001)).toBe('critical');
      });
    });
  });

  describe('rateRetirementGrowthRate', () => {
    describe('rating levels (no inflation offset)', () => {
      it('should rate 5%+ as excellent', () => {
        expect(rateRetirementGrowthRate(0.05)).toBe('excellent');
        expect(rateRetirementGrowthRate(0.10)).toBe('excellent');
      });

      it('should rate 0% as good (preserving capital)', () => {
        expect(rateRetirementGrowthRate(0)).toBe('good');
      });

      it('should rate -2% as fair', () => {
        expect(rateRetirementGrowthRate(-0.02)).toBe('fair');
      });

      it('should rate -3% as fair', () => {
        expect(rateRetirementGrowthRate(-0.03)).toBe('fair');
      });

      it('should rate -4% as poor', () => {
        expect(rateRetirementGrowthRate(-0.04)).toBe('poor');
      });

      it('should rate -5% as poor', () => {
        expect(rateRetirementGrowthRate(-0.05)).toBe('poor');
      });

      it('should rate below -5% as critical', () => {
        expect(rateRetirementGrowthRate(-0.06)).toBe('critical');
        expect(rateRetirementGrowthRate(-0.10)).toBe('critical');
      });
    });

    describe('with inflation offset', () => {
      it('should adjust thresholds with positive offset (nominal mode)', () => {
        const offset = 0.03; // Need 3% more
        // 3% nominal = good (0 + offset)
        expect(rateRetirementGrowthRate(0.03, offset)).toBe('good');
        // 8% nominal = excellent (5% + offset)
        expect(rateRetirementGrowthRate(0.08, offset)).toBe('excellent');
        // 0% nominal = fair (-3% + offset)
        expect(rateRetirementGrowthRate(0, offset)).toBe('fair');
      });

      it('should adjust thresholds with negative offset (real mode)', () => {
        const offset = -0.03;
        // -3% real = good (0 + offset = -0.03)
        expect(rateRetirementGrowthRate(-0.03, offset)).toBe('good');
        // 2.01% real = excellent (5% + offset = 0.02, need > 0.02)
        expect(rateRetirementGrowthRate(0.0201, offset)).toBe('excellent');
        // 2% real = good (at boundary, not >=)
        expect(rateRetirementGrowthRate(0.02, offset)).toBe('good');
      });
    });

    describe('boundary conditions', () => {
      it('should rate exactly 5% as excellent (boundary)', () => {
        expect(rateRetirementGrowthRate(0.05)).toBe('excellent');
      });

      it('should rate 4.99% as good', () => {
        expect(rateRetirementGrowthRate(0.0499)).toBe('good');
      });

      it('should rate exactly 0% as good (boundary)', () => {
        expect(rateRetirementGrowthRate(0)).toBe('good');
      });

      it('should rate -0.01% as fair', () => {
        expect(rateRetirementGrowthRate(-0.0001)).toBe('fair');
      });

      it('should rate exactly -3% as fair (boundary)', () => {
        expect(rateRetirementGrowthRate(-0.03)).toBe('fair');
      });

      it('should rate -3.01% as poor', () => {
        expect(rateRetirementGrowthRate(-0.0301)).toBe('poor');
      });

      it('should rate exactly -5% as poor (boundary)', () => {
        expect(rateRetirementGrowthRate(-0.05)).toBe('poor');
      });

      it('should rate -5.01% as critical', () => {
        expect(rateRetirementGrowthRate(-0.0501)).toBe('critical');
      });
    });
  });

  describe('ratePortfolioYears', () => {
    describe('with 30 years remaining (default)', () => {
      it('should rate 45+ years as excellent (1.5x remaining)', () => {
        expect(ratePortfolioYears(45, 30)).toBe('excellent');
        expect(ratePortfolioYears(50, 30)).toBe('excellent');
      });

      it('should rate 36 years as good (1.2x remaining)', () => {
        expect(ratePortfolioYears(36, 30)).toBe('good');
      });

      it('should rate 30 years as fair (at remaining)', () => {
        expect(ratePortfolioYears(30, 30)).toBe('fair');
      });

      it('should rate 25 years as fair (absolute floor)', () => {
        expect(ratePortfolioYears(25, 30)).toBe('fair');
      });

      it('should rate 22.5 years as poor (0.75x remaining)', () => {
        expect(ratePortfolioYears(22.5, 30)).toBe('poor');
      });

      it('should rate 20 years as poor (absolute floor)', () => {
        expect(ratePortfolioYears(20, 30)).toBe('poor');
      });

      it('should rate 15 years as critical (below 0.75x and 20)', () => {
        expect(ratePortfolioYears(15, 30)).toBe('critical');
      });

      it('should rate 5 years as critical (running out soon)', () => {
        expect(ratePortfolioYears(5, 30)).toBe('critical');
      });
    });

    describe('with 20 years remaining', () => {
      it('should rate 30+ years as excellent (1.5x)', () => {
        expect(ratePortfolioYears(30, 20)).toBe('excellent');
      });

      it('should rate 24 years as good (1.2x)', () => {
        expect(ratePortfolioYears(24, 20)).toBe('good');
      });

      it('should rate 25 years as good (above 1.2x)', () => {
        // 25 >= 24 (1.2 * 20), so good
        expect(ratePortfolioYears(25, 20)).toBe('good');
      });

      it('should rate 20 years as fair (at remaining)', () => {
        expect(ratePortfolioYears(20, 20)).toBe('fair');
      });

      it('should rate 15 years as poor (0.75x)', () => {
        expect(ratePortfolioYears(15, 20)).toBe('poor');
      });
    });

    describe('with 10 years remaining', () => {
      it('should rate 15+ years as excellent', () => {
        expect(ratePortfolioYears(15, 10)).toBe('excellent');
      });

      it('should rate 12 years as good', () => {
        expect(ratePortfolioYears(12, 10)).toBe('good');
      });

      it('should rate 25 years as excellent (well above 1.5x)', () => {
        // 25 >= 15 (1.5 * 10), so excellent
        expect(ratePortfolioYears(25, 10)).toBe('excellent');
      });

      it('should rate 10 years as fair', () => {
        expect(ratePortfolioYears(10, 10)).toBe('fair');
      });
    });

    describe('without yearsRemaining parameter (defaults to 30)', () => {
      it('should use 30-year baseline', () => {
        expect(ratePortfolioYears(45)).toBe('excellent');
        expect(ratePortfolioYears(36)).toBe('good');
        expect(ratePortfolioYears(30)).toBe('fair');
      });
    });

    describe('edge cases', () => {
      it('should handle very short years remaining', () => {
        // yearsRemaining = 5, but min is 1
        // 1.5 * 5 = 7.5 for excellent
        // 1.2 * 5 = 6 for good
        expect(ratePortfolioYears(8, 5)).toBe('excellent');
        expect(ratePortfolioYears(6, 5)).toBe('good');
      });

      it('should use minimum of 1 year for yearsRemaining', () => {
        // yearsRemaining <= 0 uses 1
        expect(ratePortfolioYears(2, 0)).toBe('excellent'); // 2 >= 1.5
        expect(ratePortfolioYears(1.2, 0)).toBe('good'); // 1.2 >= 1.2
      });

      it('should rate years based on 30-year default', () => {
        // Default yearsRemaining = 30
        // 1.5 * 30 = 45 for excellent
        // 1.2 * 30 = 36 for good
        expect(ratePortfolioYears(45)).toBe('excellent'); // 45 >= 45
        expect(ratePortfolioYears(40)).toBe('good'); // 40 >= 36, < 45
        expect(ratePortfolioYears(30)).toBe('fair'); // 30 >= 30 (at remaining)
      });
    });
  });
});
