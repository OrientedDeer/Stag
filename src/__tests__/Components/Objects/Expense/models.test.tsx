import { describe, it, expect } from 'vitest';
import {
  RentExpense,
  MortgageExpense,
  LoanExpense,
  HealthcareExpense,
  BaseExpense,
  reconstituteExpense,
  getExpenseActiveMultiplier,
  isExpenseActiveInCurrentMonth,
  DependentExpense,
  VacationExpense,
  OtherExpense,
} from '../../../../components/Objects/Expense/models';
import { defaultAssumptions, AssumptionsState } from '../../../../components/Objects/Assumptions/AssumptionsContext';

// Mock Assumptions for testing the 'increment' methods
const mockAssumptions: AssumptionsState = {
  ...defaultAssumptions,
  macro: {
    inflationRate: 3, // 3%
    healthcareInflation: 5, // 5%
    inflationAdjusted: false, // Make tests simpler by default
  },
  income: {
    ...defaultAssumptions.income
  },
  expenses: {
    ...defaultAssumptions.expenses,
    rentInflation: 4, // 4%
    housingAppreciation: 5, // 5%
  },
  investments: {
    ...defaultAssumptions.investments
  },
  demographics: {
    ...defaultAssumptions.demographics
  },
  priorities: [],
  withdrawalStrategy: [],
};

const inflationAssumptions: AssumptionsState = {
    ...mockAssumptions,
    macro: {
        ...mockAssumptions.macro,
        inflationAdjusted: true,
    }
}

describe('Expense Models', () => {
  describe('BaseExpense', () => {
    class TestExpense extends BaseExpense {
      increment(_assumptions: AssumptionsState): TestExpense { return this; }
    }

    it('should calculate prorated annual and monthly amounts correctly', () => {
      const weekly = new TestExpense('t1', 'Weekly', 10, 'Weekly');
      const monthly = new TestExpense('t2', 'Monthly', 100, 'Monthly');
      const annually = new TestExpense('t3', 'Annually', 1200, 'Annually');

      expect(weekly.getProratedAnnual(weekly.amount)).toBe(520);
      expect(weekly.getMonthlyAmount()).toBeCloseTo(43.33, 2);
      expect(monthly.getProratedAnnual(monthly.amount)).toBe(1200);
      expect(monthly.getMonthlyAmount()).toBe(100);
      expect(annually.getProratedAnnual(annually.amount)).toBe(1200);
      expect(annually.getMonthlyAmount()).toBe(100);
    });
  });

  describe('getExpenseActiveMultiplier', () => {
    const expense = new OtherExpense('e1', 'Test', 100, 'Annually', new Date('2025-07-01'), new Date('2026-06-30'));
    
    it('should handle various year scenarios', () => {
      expect(getExpenseActiveMultiplier(expense, 2024)).toBe(0);
      expect(getExpenseActiveMultiplier(expense, 2027)).toBe(0);
      expect(getExpenseActiveMultiplier(expense, 2025)).toBe(6 / 12); // Active for 6 months
      expect(getExpenseActiveMultiplier(expense, 2026)).toBe(6 / 12); // Active for 6 months
    });
  });

  describe('isExpenseActiveInCurrentMonth', () => {
    const today = new Date();
    const lastMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    const nextMonth = new Date(today.getFullYear(), today.getMonth() + 1, 1);
    const thisMonthStart = new Date(today.getFullYear(), today.getMonth(), 1);

    it('should correctly identify active status', () => {
      const futureExpense = new RentExpense('r1', 'Future', 1000, 100, 'Monthly', nextMonth);
      const pastExpense = new RentExpense('r1', 'Past', 1000, 100, 'Monthly', undefined, lastMonth);
      const currentExpense = new RentExpense('r1', 'Current', 1000, 100, 'Monthly', lastMonth);
      const newExpense = new RentExpense('r1', 'New', 1000, 100, 'Monthly', thisMonthStart);

      expect(isExpenseActiveInCurrentMonth(futureExpense)).toBe(false);
      expect(isExpenseActiveInCurrentMonth(pastExpense)).toBe(false);
      expect(isExpenseActiveInCurrentMonth(currentExpense)).toBe(true);
      expect(isExpenseActiveInCurrentMonth(newExpense)).toBe(true);
    });
  });
  
  // --- Detailed Class Tests ---

  describe('RentExpense', () => {
    it('should increment its value based on rent and general inflation', () => {
      const rent = new RentExpense('r1', 'Apt', 1000, 100, 'Monthly');
      const nextYear = rent.increment(inflationAssumptions);

      // New Rent = 1000 * (1 + rentInflation + generalInflation) = 1000 * (1 + 0.04 + 0.03) = 1070
      // New Utilities = 100 * (1 + generalInflation) = 100 * (1 + 0.03) = 103
      expect(nextYear.payment).toBeCloseTo(1070);
      expect(nextYear.utilities).toBeCloseTo(103);
      expect(nextYear.amount).toBeCloseTo(1173);
    });
  });

  describe('MortgageExpense', () => {
    // Params: id, name, freq, valuation, loan_balance, starting_loan_balance, apr, term, taxes, deduct, maint, util, insurance, pmi, hoa, is_deduct, tax_deduct, linkedId, startDate
    const mortgage = new MortgageExpense('m1', 'Home', 'Monthly', 500000, 400000, 400000, 3, 30, 1.2, 0, 1, 100, 0.3, 0, 50, 'Yes', 0, 'a1', new Date('2025-01-01'));
    
    it('should calculate initial monthly payment correctly in constructor', () => {
      // P&I: $1686.416134
      // Taxes: $500
      // Maintenance: $416.66667
      // Utilities: $100
      // Insurance: $125
      // HOA: $50
      // Total should be around $2878.0828
      
      expect(mortgage.payment).toBeCloseTo(2878.08, 2);
    });

    it('should increment for one year', () => {
      const nextYear = mortgage.increment(mockAssumptions);

      // Valuation appreciates by 5%
      expect(nextYear.valuation).toBe(500000 * 1.05);
      
      // Loan balance should decrease
      expect(nextYear.loan_balance).toBeLessThan(400000);
      expect(nextYear.loan_balance).toBeCloseTo(391648.80, 2);

      // Escrow items should inflate
      expect(nextYear.utilities).toBe(100 * 1.05); // housingAppreciation + generalInflation (3% mock) -> NO, mock inflation is off, so only housing appreciation
      expect(nextYear.hoa_fee).toBe(50 * 1.05);
    });

    it('should get balance at a future date', () => {
        const date = new Date('2026-01-01'); // 12 months later
        const balance = mortgage.getBalanceAtDate(date.toISOString());
        expect(balance).toBeCloseTo(391648.80, 2);
    });

    it('should calculate annual amortization', () => {
        const year = 2025;
        const { totalInterest, totalPrincipal } = mortgage.calculateAnnualAmortization(year);
        expect(totalInterest).toBeCloseTo(11885.79, 2);
        expect(totalPrincipal).toBeCloseTo(8351.20, 2);
    });
  });

  describe('LoanExpense', () => {
    // id, name, amount, freq, apr, type, payment, is_deduct, tax_deduct, linkedId, startDate, endDate
    const loan = new LoanExpense('l1', 'Car', 25000, 'Monthly', 5, 'Compounding', 0, 'No', 0, 'a2', new Date('2025-01-01'), new Date('2030-01-01'));

    it('should calculate payment from end date if not provided', () => {
        // 5 years = 60 months
        expect(loan.payment).toBeCloseTo(471.78, 2);
    });

    it('should increment (reduce balance) for one year', () => {
        const nextYear = loan.increment(mockAssumptions);
        expect(nextYear.amount).toBeLessThan(25000);
        expect(nextYear.amount).toBeCloseTo(20486.13, 2);
    });

    it('should calculate months remaining from payment', () => {
        expect(loan.calculateMonthsFromPayment(471.78)).toBe(60);
    });

    it('should calculate annual amortization', () => {
        const { totalInterest, totalPrincipal } = loan.calculateAnnualAmortization(2025);
        expect(totalInterest).toBeCloseTo(1147.49, 2);
        expect(totalPrincipal).toBeCloseTo(4513.87, 2);
    });
  });
  
  const simpleIncrementTestCases = [
    { name: 'DependentExpense', Class: DependentExpense, args: ['d1', 'Child', 500, 'Monthly', 'No', 0], inflationKey: 'inflationRate' },
    { name: 'HealthcareExpense', Class: HealthcareExpense, args: ['h1', 'Premiums', 500, 'Monthly', 'No', 0], inflationKey: 'healthcareInflation' },
    { name: 'VacationExpense', Class: VacationExpense, args: ['v1', 'Trip', 200, 'Monthly'], inflationKey: 'inflationRate' },
    { name: 'OtherExpense', Class: OtherExpense, args: ['o1', 'Misc', 100, 'Monthly'], inflationKey: 'inflationRate' },
  ];

  simpleIncrementTestCases.forEach(({ name, Class, args, inflationKey }) => {
    describe(name, () => {
      it('should increment based on the correct inflation', () => {
        // @ts-ignore
        const instance = new Class(...args);
        const nextYear = instance.increment(inflationAssumptions);
        const rate = inflationKey === 'healthcareInflation' ? inflationAssumptions.macro.healthcareInflation : inflationAssumptions.macro.inflationRate;
        const expected = instance.amount * (1 + rate / 100);
        expect(nextYear.amount).toBe(expected);
      });
    });
  });

  describe('reconstituteExpense', () => {
    it('should create various expense types correctly', () => {
      const rentData = { className: 'RentExpense', id: 'r1', payment: 1500, utilities: 200 };
      const mortgageData = { className: 'MortgageExpense', id: 'm1', valuation: 500000 };
      const loanData = { className: 'LoanExpense', id: 'l1', amount: 20000, startDate: '2023-01-15T00:00:00.000Z' };
      const dependentData = { className: 'DependentExpense', id: 'd1', amount: 300 };

      expect(reconstituteExpense(rentData)).toBeInstanceOf(RentExpense);
      expect(reconstituteExpense(mortgageData)).toBeInstanceOf(MortgageExpense);
      expect(reconstituteExpense(loanData)).toBeInstanceOf(LoanExpense);
      expect(reconstituteExpense(dependentData)).toBeInstanceOf(DependentExpense);
    });

    it('should return null for unknown or invalid data', () => {
        expect(reconstituteExpense({ className: 'ImaginaryExpense' })).toBeNull();
        expect(reconstituteExpense(null)).toBeNull();
        expect(reconstituteExpense({})).toBeNull();
    });
  });
});
