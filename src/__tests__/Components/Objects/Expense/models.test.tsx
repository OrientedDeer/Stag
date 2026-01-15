import { describe, it, expect, vi } from 'vitest';
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
  EmergencyExpense,
  TransportExpense,
  FoodExpense,
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
      adjustAmount(_ratio: number): TestExpense { return this; }
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

      // Utilities and HOA only inflate with general inflation (not housing appreciation)
      // Since inflation is OFF in mockAssumptions, they should stay the same
      expect(nextYear.utilities).toBe(100);
      expect(nextYear.hoa_fee).toBe(50);
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

    it('should inflate utilities and HOA only with general inflation when inflation is ON', () => {
      const inflationOnAssumptions: AssumptionsState = {
        ...mockAssumptions,
        macro: {
          ...mockAssumptions.macro,
          inflationAdjusted: true, // Turn inflation ON
        },
      };

      const nextYear = mortgage.increment(inflationOnAssumptions);

      // With 3% inflation, utilities and HOA should increase by 3%
      expect(nextYear.utilities).toBeCloseTo(100 * 1.03, 2);
      expect(nextYear.hoa_fee).toBeCloseTo(50 * 1.03, 2);

      // But valuation should increase by housing appreciation (5%) + inflation (3%) = 8%
      expect(nextYear.valuation).toBeCloseTo(500000 * 1.08, 2);
    });

    it('should auto-remove PMI when equity reaches 20%', () => {
      // Create mortgage with PMI where equity is just under 20%
      // Valuation: 500000, Loan: 405000 = 19% equity (81% LTV)
      const mortgageWithPmi = new MortgageExpense(
        'm2', 'Home with PMI', 'Monthly',
        500000, 405000, 405000, // valuation, loan_balance, starting_loan_balance
        3, 30, // apr, term
        1.2, 0, 1, 100, 0.3, // taxes, deduction, maintenance, utilities, insurance
        0.58, // PMI rate (0.58%)
        50, 'Yes', 0, 'a1', new Date('2025-01-01')
      );

      expect(mortgageWithPmi.pmi).toBe(0.58);

      // After one year with 5% appreciation:
      // New valuation: 500000 * 1.05 = 525000
      // Loan balance decreases to ~396xxx
      // Equity will be > 20%, so PMI should be removed
      const nextYear = mortgageWithPmi.increment(mockAssumptions);

      // Verify PMI was removed (equity should be > 20%)
      const equity = (nextYear.valuation - nextYear.loan_balance) / nextYear.valuation;
      expect(equity).toBeGreaterThanOrEqual(0.2);
      expect(nextYear.pmi).toBe(0);
    });

    it('should keep PMI when equity is under 20%', () => {
      // Create mortgage with PMI where equity is well under 20%
      // Valuation: 500000, Loan: 450000 = 10% equity (90% LTV)
      const mortgageWithPmi = new MortgageExpense(
        'm3', 'Home high LTV', 'Monthly',
        500000, 450000, 450000, // valuation, loan_balance, starting_loan_balance
        3, 30, // apr, term
        1.2, 0, 1, 100, 0.3, // taxes, deduction, maintenance, utilities, insurance
        0.58, // PMI rate
        50, 'Yes', 0, 'a1', new Date('2025-01-01')
      );

      const nextYear = mortgageWithPmi.increment(mockAssumptions);

      // Verify PMI is still there (equity should still be < 20%)
      const equity = (nextYear.valuation - nextYear.loan_balance) / nextYear.valuation;
      expect(equity).toBeLessThan(0.2);
      expect(nextYear.pmi).toBe(0.58);
    });

    it('should remove PMI when loan is paid off', () => {
      // Create mortgage with small remaining balance
      const almostPaidOff = new MortgageExpense(
        'm4', 'Almost paid', 'Monthly',
        500000, 1000, 400000, // valuation, tiny loan_balance, starting_loan_balance
        3, 30,
        1.2, 0, 1, 100, 0.3,
        0.58, // PMI rate
        50, 'Yes', 0, 'a1', new Date('2025-01-01')
      );

      const nextYear = almostPaidOff.increment(mockAssumptions);

      // Loan should be paid off, PMI removed
      expect(nextYear.loan_balance).toBe(0);
      expect(nextYear.pmi).toBe(0);
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

    it('should calculate annual and monthly amounts from payment', () => {
      // Loan with explicit payment
      const loanWithPayment = new LoanExpense('l1', 'Car', 25000, 'Monthly', 5, 'Compounding', 600, 'No', 0, 'a1');
      expect(loanWithPayment.getAnnualAmount()).toBe(600 * 12);
      expect(loanWithPayment.getMonthlyAmount()).toBe(600);
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
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- parameterized test pattern
        const instance = new (Class as any)(...args);
        const nextYear = instance.increment(inflationAssumptions);
        const rate = inflationKey === 'healthcareInflation' ? inflationAssumptions.macro.healthcareInflation : inflationAssumptions.macro.inflationRate;
        const expected = instance.amount * (1 + rate / 100);
        expect(nextYear.amount).toBe(expected);
      });
    });
  });

  // Add missing expense types that weren't covered
  describe('EmergencyExpense', () => {
    it('should increment based on inflation', () => {
      const expense = new EmergencyExpense('e1', 'Emergency Fund', 1000, 'Annually');
      const nextYear = expense.increment(inflationAssumptions);
      const expected = 1000 * (1 + inflationAssumptions.macro.inflationRate / 100);
      expect(nextYear.amount).toBe(expected);
    });
  });

  describe('TransportExpense', () => {
    it('should increment based on inflation', () => {
      const expense = new TransportExpense('t1', 'Gas', 200, 'Monthly');
      const nextYear = expense.increment(inflationAssumptions);
      const expected = 200 * (1 + inflationAssumptions.macro.inflationRate / 100);
      expect(nextYear.amount).toBe(expected);
    });
  });

  describe('FoodExpense', () => {
    it('should increment based on inflation', () => {
      const expense = new FoodExpense('f1', 'Groceries', 500, 'Monthly');
      const nextYear = expense.increment(inflationAssumptions);
      const expected = 500 * (1 + inflationAssumptions.macro.inflationRate / 100);
      expect(nextYear.amount).toBe(expected);
    });
  });

  describe('reconstituteExpense', () => {
    it('should create various expense types correctly and preserve data', () => {
      const rentData = { className: 'RentExpense', id: 'r1', payment: 1500, utilities: 200 };
      const mortgageData = { className: 'MortgageExpense', id: 'm1', valuation: 500000 };
      const loanData = { className: 'LoanExpense', id: 'l1', amount: 20000 };
      const dependentData = { className: 'DependentExpense', id: 'd1', amount: 300 };
      const healthcareData = { className: 'HealthcareExpense', id: 'h1', amount: 500 };
      const vacationData = { className: 'VacationExpense', id: 'v1', amount: 1000 };
      const emergencyData = { className: 'EmergencyExpense', id: 'e1', amount: 500 };
      const transportData = { className: 'TransportExpense', id: 't1', amount: 200 };
      const foodData = { className: 'FoodExpense', id: 'f1', amount: 400 };
      const otherData = { className: 'OtherExpense', id: 'o1', amount: 100 };

      const rent = reconstituteExpense(rentData) as RentExpense;
      expect(rent).toBeInstanceOf(RentExpense);
      expect(rent.id).toBe('r1');
      expect(rent.payment).toBe(1500);

      const mortgage = reconstituteExpense(mortgageData) as MortgageExpense;
      expect(mortgage).toBeInstanceOf(MortgageExpense);
      expect(mortgage.id).toBe('m1');
      expect(mortgage.valuation).toBe(500000);

      const loan = reconstituteExpense(loanData) as LoanExpense;
      expect(loan).toBeInstanceOf(LoanExpense);
      expect(loan.id).toBe('l1');
      expect(loan.amount).toBe(20000);
      
      const dependent = reconstituteExpense(dependentData) as DependentExpense;
      expect(dependent).toBeInstanceOf(DependentExpense);
      expect(dependent.id).toBe('d1');
      expect(dependent.amount).toBe(300);

      const healthcare = reconstituteExpense(healthcareData) as HealthcareExpense;
      expect(healthcare).toBeInstanceOf(HealthcareExpense);
      expect(healthcare.id).toBe('h1');
      expect(healthcare.amount).toBe(500);

      const vacation = reconstituteExpense(vacationData) as VacationExpense;
      expect(vacation).toBeInstanceOf(VacationExpense);
      expect(vacation.id).toBe('v1');
      expect(vacation.amount).toBe(1000);

      const emergency = reconstituteExpense(emergencyData) as EmergencyExpense;
      expect(emergency).toBeInstanceOf(EmergencyExpense);
      expect(emergency.id).toBe('e1');
      expect(emergency.amount).toBe(500);

      const transport = reconstituteExpense(transportData) as TransportExpense;
      expect(transport).toBeInstanceOf(TransportExpense);
      expect(transport.id).toBe('t1');
      expect(transport.amount).toBe(200);

      const food = reconstituteExpense(foodData) as FoodExpense;
      expect(food).toBeInstanceOf(FoodExpense);
      expect(food.id).toBe('f1');
      expect(food.amount).toBe(400);

      const other = reconstituteExpense(otherData) as OtherExpense;
      expect(other).toBeInstanceOf(OtherExpense);
      expect(other.id).toBe('o1');
      expect(other.amount).toBe(100);
    });

    it('should return null for unknown or invalid data', () => {
        const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        expect(reconstituteExpense({ className: 'ImaginaryExpense' })).toBeNull();
        expect(reconstituteExpense(null)).toBeNull();
        expect(reconstituteExpense({})).toBeNull();
        consoleSpy.mockRestore();
    });

    it('should handle legacy HousingExpense className as RentExpense', () => {
      const legacyData = { className: 'HousingExpense', id: 'h1', payment: 1500, utilities: 200 };
      const expense = reconstituteExpense(legacyData);

      expect(expense).toBeInstanceOf(RentExpense);
      expect(expense?.id).toBe('h1');
      expect((expense as RentExpense).payment).toBe(1500);
      expect((expense as RentExpense).utilities).toBe(200);
    });
  });

  describe('adjustAmount Methods', () => {
    describe('RentExpense.adjustAmount', () => {
      it('should scale payment and utilities by ratio', () => {
        const rent = new RentExpense('r1', 'Apt', 1000, 200, 'Monthly', new Date('2025-01-01'));
        const adjusted = rent.adjustAmount(0.9); // 10% reduction

        expect(adjusted.payment).toBeCloseTo(900);
        expect(adjusted.utilities).toBeCloseTo(180);
        expect(adjusted.amount).toBeCloseTo(1080);
        expect(adjusted).toBeInstanceOf(RentExpense);
      });

      it('should preserve other properties when adjusting', () => {
        const rent = new RentExpense('r1', 'Apt', 1000, 200, 'Monthly', new Date('2025-01-01'), new Date('2030-12-31'));
        const adjusted = rent.adjustAmount(1.1); // 10% increase

        expect(adjusted.id).toBe('r1');
        expect(adjusted.name).toBe('Apt');
        expect(adjusted.frequency).toBe('Monthly');
      });
    });

    describe('DependentExpense.adjustAmount', () => {
      it('should scale amount by ratio and preserve isDiscretionary', () => {
        const expense = new DependentExpense('d1', 'Child', 500, 'Monthly', 'Yes', 0, new Date('2025-01-01'));
        expense.isDiscretionary = true;
        const adjusted = expense.adjustAmount(0.85);

        expect(adjusted.amount).toBeCloseTo(425);
        expect(adjusted.isDiscretionary).toBe(true);
        expect(adjusted).toBeInstanceOf(DependentExpense);
      });

      it('should handle non-discretionary expense', () => {
        const expense = new DependentExpense('d1', 'Child', 500, 'Monthly', 'No', 0, new Date('2025-01-01'));
        expense.isDiscretionary = false;
        const adjusted = expense.adjustAmount(0.9);

        expect(adjusted.amount).toBeCloseTo(450);
        expect(adjusted.isDiscretionary).toBe(false);
      });
    });

    describe('HealthcareExpense.adjustAmount', () => {
      it('should scale amount by ratio and preserve isDiscretionary', () => {
        const expense = new HealthcareExpense('h1', 'Premiums', 600, 'Monthly', 'Yes', 0, new Date('2025-01-01'));
        expense.isDiscretionary = true;
        const adjusted = expense.adjustAmount(0.8);

        expect(adjusted.amount).toBeCloseTo(480);
        expect(adjusted.isDiscretionary).toBe(true);
        expect(adjusted).toBeInstanceOf(HealthcareExpense);
      });
    });

    describe('VacationExpense.adjustAmount', () => {
      it('should scale amount by ratio', () => {
        const expense = new VacationExpense('v1', 'Trip', 5000, 'Annually', new Date('2025-01-01'));
        const adjusted = expense.adjustAmount(0.75); // 25% reduction

        expect(adjusted.amount).toBeCloseTo(3750);
        expect(adjusted).toBeInstanceOf(VacationExpense);
      });

      it('should preserve all properties when adjusting', () => {
        const expense = new VacationExpense('v1', 'Annual Trip', 5000, 'Annually', new Date('2025-06-01'), new Date('2030-12-31'));
        const adjusted = expense.adjustAmount(1.2);

        expect(adjusted.id).toBe('v1');
        expect(adjusted.name).toBe('Annual Trip');
        expect(adjusted.frequency).toBe('Annually');
        expect(adjusted.amount).toBeCloseTo(6000);
      });
    });

    describe('EmergencyExpense.adjustAmount', () => {
      it('should scale amount by ratio', () => {
        const expense = new EmergencyExpense('e1', 'Emergency Fund', 2000, 'Annually', new Date('2025-01-01'));
        const adjusted = expense.adjustAmount(0.9);

        expect(adjusted.amount).toBeCloseTo(1800);
        expect(adjusted).toBeInstanceOf(EmergencyExpense);
      });

      it('should handle increase ratio', () => {
        const expense = new EmergencyExpense('e1', 'Rainy Day', 1000, 'Monthly');
        const adjusted = expense.adjustAmount(1.15);

        expect(adjusted.amount).toBeCloseTo(1150);
      });
    });

    describe('TransportExpense.adjustAmount', () => {
      it('should scale amount by ratio', () => {
        const expense = new TransportExpense('t1', 'Gas', 300, 'Monthly', new Date('2025-01-01'));
        const adjusted = expense.adjustAmount(0.85);

        expect(adjusted.amount).toBeCloseTo(255);
        expect(adjusted).toBeInstanceOf(TransportExpense);
      });

      it('should preserve dates when adjusting', () => {
        const startDate = new Date('2025-01-01');
        const endDate = new Date('2030-12-31');
        const expense = new TransportExpense('t1', 'Car Payment', 400, 'Monthly', startDate, endDate);
        const adjusted = expense.adjustAmount(1.0);

        expect(adjusted.startDate).toEqual(startDate);
        expect(adjusted.endDate).toEqual(endDate);
      });
    });

    describe('FoodExpense.adjustAmount', () => {
      it('should scale amount by ratio', () => {
        const expense = new FoodExpense('f1', 'Groceries', 800, 'Monthly', new Date('2025-01-01'));
        const adjusted = expense.adjustAmount(0.9);

        expect(adjusted.amount).toBeCloseTo(720);
        expect(adjusted).toBeInstanceOf(FoodExpense);
      });

      it('should handle zero ratio edge case', () => {
        const expense = new FoodExpense('f1', 'Dining Out', 500, 'Monthly');
        const adjusted = expense.adjustAmount(0);

        expect(adjusted.amount).toBe(0);
      });
    });

    describe('OtherExpense.adjustAmount', () => {
      it('should scale amount by ratio', () => {
        const expense = new OtherExpense('o1', 'Misc', 200, 'Monthly', new Date('2025-01-01'));
        const adjusted = expense.adjustAmount(0.7);

        expect(adjusted.amount).toBeCloseTo(140);
        expect(adjusted).toBeInstanceOf(OtherExpense);
      });

      it('should preserve all properties including dates', () => {
        const startDate = new Date('2025-01-01');
        const endDate = new Date('2028-06-30');
        const expense = new OtherExpense('o1', 'Subscription', 100, 'Monthly', startDate, endDate);
        const adjusted = expense.adjustAmount(1.5);

        expect(adjusted.id).toBe('o1');
        expect(adjusted.name).toBe('Subscription');
        expect(adjusted.frequency).toBe('Monthly');
        expect(adjusted.startDate).toEqual(startDate);
        expect(adjusted.endDate).toEqual(endDate);
        expect(adjusted.amount).toBeCloseTo(150);
      });
    });

    describe('LoanExpense.adjustAmount', () => {
      it('should return same loan unchanged since loans are fixed obligations', () => {
        const loan = new LoanExpense('l1', 'Car', 25000, 'Monthly', 5, 'Compounding', 500, 'No', 0, 'a1');
        const adjusted = loan.adjustAmount(0.8);

        // Loans cannot be adjusted - should return the same instance
        expect(adjusted).toBe(loan);
        expect(adjusted.amount).toBe(25000);
      });
    });
  });

  describe('Edge Cases and Additional Coverage', () => {
    it('should handle RentExpense without inflation adjustment', () => {
      const rent = new RentExpense('r1', 'Apt', 1000, 100, 'Monthly');
      const nextYear = rent.increment(mockAssumptions); // inflationAdjusted = false

      // Should only apply rent inflation, not general inflation
      expect(nextYear.payment).toBeCloseTo(1000 * 1.04);
      expect(nextYear.utilities).toBeCloseTo(100); // No inflation
    });

    it('should handle MortgageExpense with different frequencies', () => {
      const mortgage = new MortgageExpense('m1', 'Home', 'Annually', 500000, 400000, 400000, 3, 30, 1.2, 0, 1, 100, 0.3, 0, 50, 'Yes', 0, 'a1');
      expect(mortgage.frequency).toBe('Annually');
      expect(mortgage.getAnnualAmount()).toBeGreaterThan(0);
    });

    it('should handle LoanExpense with simple interest type', () => {
      const loan = new LoanExpense('l1', 'Personal', 10000, 'Monthly', 5, 'Simple', 200, 'No', 0, 'a1');
      expect(loan.interest_type).toBe('Simple');
      const nextYear = loan.increment(mockAssumptions);
      expect(nextYear.amount).toBeLessThan(10000);
    });

    it('should handle LoanExpense with automatic payment calculation', () => {
      const loan = new LoanExpense('l1', 'Car', 25000, 'Monthly', 5, 'Compounding', 0, 'No', 0, 'a2', new Date('2025-01-01'), new Date('2030-01-01'));
      // Payment should be auto-calculated if not provided
      expect(loan.payment).toBeGreaterThan(0);
    });

    it('should handle getExpenseActiveMultiplier edge cases', () => {
      const noEndDate = new OtherExpense('e1', 'Test', 100, 'Annually', new Date('2020-01-01'));
      expect(getExpenseActiveMultiplier(noEndDate, 2025)).toBe(1);

      const partialYearStart = new OtherExpense('e2', 'Test', 100, 'Annually', new Date('2025-06-15'));
      const multiplier = getExpenseActiveMultiplier(partialYearStart, 2025);
      expect(multiplier).toBeGreaterThan(0);
      expect(multiplier).toBeLessThan(1);
    });
  });
});
