import { describe, it, expect, vi } from 'vitest';
import {
  RentExpense,
  MortgageExpense,
  LoanExpense,
  HealthcareExpense,
  BaseExpense,
  AnyExpense,
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
      increment(_assumptions: AssumptionsState): AnyExpense { return this as unknown as AnyExpense; }
      adjustAmount(_ratio: number): AnyExpense { return this as unknown as AnyExpense; }
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
    // Use Date constructor with args to ensure local time (month is 0-indexed, so 6 = July)
    const expense = new OtherExpense('e1', 'Test', 100, 'Annually', new Date(2025, 6, 1), new Date(2026, 5, 30));

    it('should handle various year scenarios', () => {
      expect(getExpenseActiveMultiplier(expense, 2024)).toBe(0);
      expect(getExpenseActiveMultiplier(expense, 2027)).toBe(0);
      expect(getExpenseActiveMultiplier(expense, 2025)).toBe(6 / 12); // Active for 6 months
      expect(getExpenseActiveMultiplier(expense, 2026)).toBe(6 / 12); // Active for 6 months
    });

    // Hand-verified test cases for Batch 19
    it('should return 1.0 for full year active (starts Jan, no end)', () => {
      const fullYear = new OtherExpense('e2', 'Full Year', 100, 'Annually', new Date(2024, 0, 1));
      expect(getExpenseActiveMultiplier(fullYear, 2024)).toBe(1.0);
    });

    it('should return 0.5 for Apr-Sep expense (6 months active)', () => {
      // April (month 3) through September (month 8) = 6 months
      const sixMonth = new OtherExpense('e3', 'Six Month', 100, 'Annually', new Date(2024, 3, 1), new Date(2024, 8, 30));
      expect(getExpenseActiveMultiplier(sixMonth, 2024)).toBe(6 / 12);
    });

    it('should return 0 for expense fully outside year (before)', () => {
      const endedBefore = new OtherExpense('e4', 'Ended Before', 100, 'Annually', new Date(2022, 0, 1), new Date(2022, 11, 31));
      expect(getExpenseActiveMultiplier(endedBefore, 2024)).toBe(0);
    });

    it('should return 0 for expense fully outside year (after)', () => {
      const startsAfter = new OtherExpense('e5', 'Starts After', 100, 'Annually', new Date(2025, 0, 1));
      expect(getExpenseActiveMultiplier(startsAfter, 2024)).toBe(0);
    });

    it('should handle partial year start (July = 6 months)', () => {
      // July (month 6) through December = 6 months
      const julyStart = new OtherExpense('e6', 'July Start', 100, 'Annually', new Date(2024, 6, 1));
      expect(getExpenseActiveMultiplier(julyStart, 2024)).toBe(6 / 12);
    });

    it('should handle partial year end (March = 3 months)', () => {
      // Jan through March (month 0, 1, 2) = 3 months
      const marchEnd = new OtherExpense('e7', 'March End', 100, 'Annually', new Date(2024, 0, 1), new Date(2024, 2, 31));
      expect(getExpenseActiveMultiplier(marchEnd, 2024)).toBe(3 / 12);
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
      // New Utilities = 100 * (1 + rentInflation + generalInflation) = 100 * (1 + 0.04 + 0.03) = 107
      expect(nextYear.payment).toBeCloseTo(1070);
      expect(nextYear.utilities).toBeCloseTo(107);
      expect(nextYear.amount).toBeCloseTo(1177);
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

    // User-specified hand-verified test scenarios
    describe('calculateAnnualAmortization with hand-verified values', () => {
      it('should calculate Year 1 amortization: $300k loan at 6% APR', () => {
        // $300,000 loan, 6% APR, 30-year term, purchased Jan 2024
        // Monthly P&I = $1,798.65
        const mortgage6pct = new MortgageExpense(
          'm-test', 'Test Home', 'Monthly',
          350000,   // valuation
          300000,   // loan_balance
          300000,   // starting_loan_balance
          6,        // apr (6%)
          30,       // term_length (30 years)
          0, 0, 0, 0, 0, // taxes, deduction, maintenance, utilities, insurance
          0,        // pmi
          0,        // hoa_fee
          'Yes', 0, 'a1',
          new Date(2024, 0, 1) // Jan 1, 2024 (local time to avoid timezone issues)
        );

        const { totalInterest, totalPrincipal, totalPayment } = mortgage6pct.calculateAnnualAmortization(2024);

        // Year 1 (full 12 months):
        // Monthly P&I = $1,798.65, total = $21,583.80
        // Computed: Interest ≈ $17,900, Principal ≈ $3,684
        expect(totalInterest).toBeCloseTo(17900, -1); // Within $10
        expect(totalPrincipal).toBeCloseTo(3684, -1);
        expect(totalPayment).toBeCloseTo(21584, 0);
      });

      it('should handle partial first year (purchased July 2024)', () => {
        const mortgagePartial = new MortgageExpense(
          'm-partial', 'Partial Year', 'Monthly',
          350000, 300000, 300000,
          6, 30,
          0, 0, 0, 0, 0,
          0, 0, 'Yes', 0, 'a1',
          new Date(2024, 6, 1) // July 1, 2024 (month 6, 0-indexed)
        );

        const { totalInterest, totalPrincipal, totalPayment } = mortgagePartial.calculateAnnualAmortization(2024);

        // 6 months of payments (Jul-Dec): months 6,7,8,9,10,11
        // Monthly P&I = $1798.65, monthly rate = 6%/12 = 0.5%
        // Month 1: Interest = 300000 * 0.005 = 1500, Principal = 298.65
        // Month 2: Interest = 299701.35 * 0.005 = 1498.51, Principal = 300.14
        // ... continues with decreasing interest, increasing principal
        // Total Interest ≈ 8977, Total Principal ≈ 1814
        expect(totalPayment).toBeCloseTo(1798.65 * 6, 0); // ~$10,792
        expect(totalInterest).toBeCloseTo(8977, 0);
        expect(totalPrincipal).toBeCloseTo(1814, 0);
        expect(totalInterest + totalPrincipal).toBeCloseTo(totalPayment, 0);
      });

      it('should return zeros for year after loan payoff', () => {
        // Mortgage with tiny remaining balance that will be paid off
        const paidOffMortgage = new MortgageExpense(
          'm-paid', 'Paid Off', 'Monthly',
          350000, 0, 300000, // loan_balance = 0 (already paid off)
          6, 30,
          0, 0, 0, 0, 0,
          0, 0, 'Yes', 0, 'a1',
          new Date('2024-01-01')
        );

        const { totalInterest, totalPrincipal } = paidOffMortgage.calculateAnnualAmortization(2025);

        // No P&I payments when loan is paid off
        expect(totalInterest).toBe(0);
        expect(totalPrincipal).toBe(0);
      });
    });

    describe('calculatePayment', () => {
      it('should calculate total monthly payment including all components', () => {
        // P&I ≈ $1,799 (from $300k at 6%, 30yr)
        // + taxes $400/mo (property_taxes as % of valuation)
        // + insurance $150/mo
        // + PMI $100/mo
        // + repairs $200/mo
        // + utilities $300
        // + extra $0
        const mortgageWithAll = new MortgageExpense(
          'm-full', 'Full Payment', 'Monthly',
          400000,   // valuation
          300000,   // loan_balance
          300000,   // starting_loan_balance
          6,        // apr
          30,       // term
          1.2,      // property_taxes (1.2% of valuation = $4800/yr = $400/mo)
          0,        // valuation_deduction
          0.6,      // maintenance (0.6% of valuation = $2400/yr = $200/mo)
          300,      // utilities
          0.45,     // insurance (0.45% of valuation = $1800/yr = $150/mo)
          0.3,      // pmi (0.3% of valuation = $1200/yr = $100/mo)
          0,        // hoa_fee
          'Yes', 0, 'a1',
          new Date('2024-01-01')
        );

        const payment = mortgageWithAll.calculatePayment();

        // P&I ≈ $1,798.65
        // taxes = 400000 × 0.012 / 12 = $400
        // insurance = 400000 × 0.0045 / 12 = $150
        // pmi = 400000 × 0.003 / 12 = $100
        // repairs = 400000 × 0.006 / 12 = $200
        // utilities = $300
        // Total ≈ $2,949
        expect(payment).toBeCloseTo(2949, 0);
      });
    });

    describe('calculateDeductible', () => {
      it('should calculate monthly interest: $290k balance at 6% APR = $1,450', () => {
        const mortgageDeduct = new MortgageExpense(
          'm-deduct', 'Deductible', 'Monthly',
          350000, 290000, 300000, // loan_balance = $290,000
          6, 30,
          0, 0, 0, 0, 0,
          0, 0, 'Yes', 0, 'a1',
          new Date('2024-01-01')
        );

        const deductible = mortgageDeduct.calculateDeductible();

        // Monthly interest = $290,000 × 0.06 / 12 = $1,450
        expect(deductible).toBe(1450);
      });
    });

    describe('getPrincipalPayment', () => {
      it('should calculate principal: P&I payment - current interest', () => {
        // Standard P&I on $300k at 6% = $1,798.65
        // Current interest on $290k at 6% = $290k × 0.005 = $1,450
        // Principal = $1,798.65 - $1,450 = $348.65
        const mortgagePrincipal = new MortgageExpense(
          'm-principal', 'Principal Test', 'Monthly',
          350000, 290000, 300000, // current balance $290k, starting $300k
          6, 30,
          0, 0, 0, 0, 0,
          0, 0, 'Yes', 0, 'a1',
          new Date('2024-01-01')
        );

        const principal = mortgagePrincipal.getPrincipalPayment();

        // $1,798.65 - $1,450 = $348.65
        expect(principal).toBeCloseTo(349, 0);
      });
    });

    describe('getBalanceAtDate', () => {
      it('should calculate balance after 12 months of payments', () => {
        // Use the existing mortgage from the test file for consistency
        const mortgageBalance = new MortgageExpense(
          'm-balance', 'Balance Test', 'Monthly',
          350000, 300000, 300000,
          6, 30,
          0, 0, 0, 0, 0,
          0, 0, 'Yes', 0, 'a1',
          new Date('2024-01-15') // Mid-month to avoid edge cases
        );

        // Get balance 12 months later
        const balance = mortgageBalance.getBalanceAtDate('2025-01-15');

        // After 12 payments on $300k at 6%:
        // P&I payment ≈ $1,798.65/month
        // Year 1 principal ≈ $3,368 (actual computed by the function)
        // Balance should be roughly $296,000-$297,000
        expect(balance).toBeGreaterThan(295000);
        expect(balance).toBeLessThan(297000);
      });

      it('should return starting balance when months elapsed is 0', () => {
        const mortgageAtStart = new MortgageExpense(
          'm-start', 'At Start', 'Monthly',
          350000, 300000, 300000,
          6, 30,
          0, 0, 0, 0, 0,
          0, 0, 'Yes', 0, 'a1',
          new Date('2024-01-15')
        );

        // Same month - monthsElapsed should be 0
        const balance = mortgageAtStart.getBalanceAtDate('2024-01-20');

        // When monthsElapsed <= 0, returns starting_loan_balance
        expect(balance).toBe(300000);
      });

      it('should return 0 for date before purchase', () => {
        const mortgageBefore = new MortgageExpense(
          'm-before', 'Before', 'Monthly',
          350000, 300000, 300000,
          6, 30,
          0, 0, 0, 0, 0,
          0, 0, 'Yes', 0, 'a1',
          new Date('2024-06-01')
        );

        const balance = mortgageBefore.getBalanceAtDate('2024-01-01');

        // Before purchase, loan didn't exist
        expect(balance).toBe(0);
      });
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

    // User-specified hand-verified test scenarios
    describe('calculateAnnualAmortization with hand-verified values', () => {
      it('should calculate compounding loan: $20k at 8% APR, 5-year term', () => {
        // $20,000 loan, 8% APR, 5-year (60 months)
        // Monthly payment ≈ $405.53
        const loan8pct = new LoanExpense(
          'l-test', 'Test Loan', 20000, 'Monthly',
          8, 'Compounding', 0, 'No', 0, 'a1',
          new Date(2024, 0, 1), // Jan 2024
          new Date(2029, 0, 1)  // Jan 2029 (60 months)
        );

        const { totalInterest, totalPrincipal, totalPayment } = loan8pct.calculateAnnualAmortization(2024);

        // Year 1 (full 12 months):
        // Monthly payment ≈ $405.53, total = $4,866.36
        // Computed: Interest ≈ $1,478, Principal ≈ $3,389
        expect(totalPayment).toBeCloseTo(4866, 0);
        expect(totalInterest).toBeCloseTo(1478, 0);
        expect(totalPrincipal).toBeCloseTo(3389, 0);
      });

      it('should calculate simple interest loan differently', () => {
        // Same loan but with Simple interest type
        // For simple interest: interest is NOT computed monthly on remaining balance
        const loanSimple = new LoanExpense(
          'l-simple', 'Simple Loan', 20000, 'Monthly',
          8, 'Simple', 405.53, 'No', 0, 'a1',
          new Date(2024, 0, 1),
          new Date(2029, 0, 1)
        );

        const { totalInterest, totalPrincipal } = loanSimple.calculateAnnualAmortization(2024);

        // Simple-interest loans now accrue interest on the outstanding balance
        // each month, just like compounding loans (the prior $0-interest
        // behavior was a bug). Interest ≈ $1,477.53, principal makes up the rest.
        expect(totalInterest).toBeCloseTo(1477.53, 2);
        expect(totalPrincipal).toBeCloseTo(3388.83, 2);
      });

      it('should handle partial first year (loan starts July)', () => {
        const loanPartial = new LoanExpense(
          'l-partial', 'Partial Year', 20000, 'Monthly',
          8, 'Compounding', 405.53, 'No', 0, 'a1',
          new Date(2024, 6, 1),  // July 2024
          new Date(2029, 6, 1)   // July 2029
        );

        const { totalPayment } = loanPartial.calculateAnnualAmortization(2024);

        // Only 6 months of payments (Jul-Dec)
        expect(totalPayment).toBeCloseTo(405.53 * 6, 0);
      });

      it('should return zeros for year after payoff', () => {
        const loanPaid = new LoanExpense(
          'l-paid', 'Paid Off', 20000, 'Monthly',
          8, 'Compounding', 405.53, 'No', 0, 'a1',
          new Date(2024, 0, 1),
          new Date(2029, 0, 1)
        );

        // Year 2030 is after end date (Jan 2029)
        const { totalInterest, totalPrincipal, totalPayment } = loanPaid.calculateAnnualAmortization(2030);

        expect(totalInterest).toBe(0);
        expect(totalPrincipal).toBe(0);
        expect(totalPayment).toBe(0);
      });
    });

    describe('calculatePaymentFromEndDate', () => {
      it('should calculate $405.53/month for $20k at 8% over 60 months', () => {
        const loan60mo = new LoanExpense(
          'l-60mo', 'Car Loan', 20000, 'Monthly',
          8, 'Compounding', 0, 'No', 0, 'a1',
          new Date(2024, 0, 1),
          new Date(2029, 0, 1)  // 60 months
        );

        // Payment is auto-calculated in constructor
        expect(loan60mo.payment).toBeCloseTo(405.53, 2);
      });

      it('should calculate $299.71/month for $10k at 5% over 36 months', () => {
        const loan36mo = new LoanExpense(
          'l-36mo', 'Personal Loan', 10000, 'Monthly',
          5, 'Compounding', 0, 'No', 0, 'a1',
          new Date(2024, 0, 1),
          new Date(2027, 0, 1)  // 36 months
        );

        expect(loan36mo.payment).toBeCloseTo(299.71, 2);
      });
    });

    describe('calculateMonthsFromPayment', () => {
      it('should return 60 months for $20k at 8% with $405.53 payment', () => {
        const loanMonths = new LoanExpense(
          'l-months', 'Test', 20000, 'Monthly',
          8, 'Compounding', 405.53, 'No', 0, 'a1',
          new Date(2024, 0, 1)
        );

        const months = loanMonths.calculateMonthsFromPayment(405.53);
        expect(months).toBe(60);
      });

      it('should return Infinity when payment is too low to cover interest', () => {
        // $20,000 at 8% APR = $20,000 × 0.08 / 12 = $133.33/month minimum interest
        const loanLow = new LoanExpense(
          'l-low', 'Test', 20000, 'Monthly',
          8, 'Compounding', 100, 'No', 0, 'a1',
          new Date(2024, 0, 1)
        );

        const months = loanLow.calculateMonthsFromPayment(100);
        expect(months).toBe(Infinity);
      });

      it('should return Infinity when payment equals interest exactly', () => {
        // Minimum payment = principal × monthlyRate = 20000 × 0.08/12 = 133.33
        const loanExact = new LoanExpense(
          'l-exact', 'Test', 20000, 'Monthly',
          8, 'Compounding', 133.33, 'No', 0, 'a1',
          new Date(2024, 0, 1)
        );

        const months = loanExact.calculateMonthsFromPayment(133.33);
        expect(months).toBe(Infinity);
      });
    });

    describe('calculateEndDateFromPayment', () => {
      it('should calculate Jan 2029 end date for $20k at 8% with $405.53 payment', () => {
        const loanEnd = new LoanExpense(
          'l-end', 'Test', 20000, 'Monthly',
          8, 'Compounding', 405.53, 'No', 0, 'a1',
          new Date(2024, 0, 1)  // Jan 2024 start
        );

        const endDate = loanEnd.calculateEndDateFromPayment(405.53);

        // 60 months from Jan 2024 = Jan 2029
        expect(endDate.getFullYear()).toBe(2029);
        expect(endDate.getMonth()).toBe(0); // January
      });
    });

    describe('getMonthsUntilPaidOff', () => {
      it('should return 60 months for Jan 2024 to Jan 2029', () => {
        const loan60 = new LoanExpense(
          'l-60', 'Test', 20000, 'Monthly',
          8, 'Compounding', 405.53, 'No', 0, 'a1',
          new Date(2024, 0, 1),  // Jan 2024
          new Date(2029, 0, 1)   // Jan 2029
        );

        expect(loan60.getMonthsUntilPaidOff()).toBe(60);
      });

      it('should return 120 months when end date not provided (defaults to start + 10 years)', () => {
        // LoanExpense constructor defaults to startDate + 10 years when no endDate provided
        const loanNoEnd = new LoanExpense(
          'l-noend', 'Test', 20000, 'Monthly',
          8, 'Compounding', 405.53, 'No', 0, 'a1',
          new Date(2024, 0, 1)
          // No end date - constructor defaults to Jan 2034 (10 years later)
        );

        // 10 years * 12 months = 120 months
        expect(loanNoEnd.getMonthsUntilPaidOff()).toBe(120);
      });
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

      // Should apply rent inflation (general inflation disabled when inflationAdjusted=false)
      expect(nextYear.payment).toBeCloseTo(1000 * 1.04);
      expect(nextYear.utilities).toBeCloseTo(100 * 1.04); // Rent inflation applies to utilities too
    });

    it('should handle MortgageExpense with different frequencies', () => {
      const mortgage = new MortgageExpense('m1', 'Home', 'Annually', 500000, 400000, 400000, 3, 30, 1.2, 0, 1, 100, 0.3, 0, 50, 'Yes', 0, 'a1');
      expect(mortgage.frequency).toBe('Annually');
      // For 'Annually' frequency, getAnnualAmount returns the calculated annual expense
      // This includes P&I, taxes, insurance, etc. calculated for annual payment
      expect(mortgage.getAnnualAmount()).toBeCloseTo(2878.08, 0);
    });

    it('should handle LoanExpense with simple interest type', () => {
      const loan = new LoanExpense('l1', 'Personal', 10000, 'Monthly', 5, 'Simple', 200, 'No', 0, 'a1');
      expect(loan.interest_type).toBe('Simple');
      const nextYear = loan.increment(mockAssumptions);
      expect(nextYear.amount).toBeLessThan(10000);
    });

    it('should handle LoanExpense with automatic payment calculation', () => {
      const loan = new LoanExpense('l1', 'Car', 25000, 'Monthly', 5, 'Compounding', 0, 'No', 0, 'a2', new Date('2025-01-01'), new Date('2030-01-01'));
      // Payment should be auto-calculated: $25k at 5% for 60 months
      // Monthly rate = 0.05/12 = 0.004167, n = 60
      // Payment = 25000 × 0.004167 × 1.2834 / 0.2834 ≈ $471.78
      expect(loan.payment).toBeCloseTo(471.78, 0);
    });

    it('should handle getExpenseActiveMultiplier edge cases', () => {
      const noEndDate = new OtherExpense('e1', 'Test', 100, 'Annually', new Date('2020-01-01'));
      expect(getExpenseActiveMultiplier(noEndDate, 2025)).toBe(1);

      const partialYearStart = new OtherExpense('e2', 'Test', 100, 'Annually', new Date('2025-06-15'));
      const multiplier = getExpenseActiveMultiplier(partialYearStart, 2025);
      // June (month 5 in 0-indexed) through December (month 11) = 7 months active
      // multiplier = 7/12 ≈ 0.5833
      expect(multiplier).toBeCloseTo(7 / 12, 4);
    });
  });

  // --- UTC date-only convention regression tests (bugs #5, #8) ---
  // Date-only values are stored as UTC-midnight Dates. In a negative-UTC (US)
  // timezone, new Date(Date.UTC(2030,0,1)) is 2029-12-31T19:00 local, so local
  // getMonth()/getFullYear() read Dec 2029 (off by a month AND a year) while
  // getUTC* correctly reads Jan 2030. These methods must use getUTC*.
  describe('UTC date-only handling (timezone safety)', () => {
    // 2030-01-01 at UTC midnight — reads as Dec 2029 with LOCAL accessors in US TZs.
    const utcStart = new Date(Date.UTC(2030, 0, 1));
    // 2035-06-01 at UTC midnight — reads as May 2035 with LOCAL accessors in US TZs.
    const utcEnd = new Date(Date.UTC(2035, 5, 1));

    describe('MortgageExpense.calculateAnnualAmortization (#5)', () => {
      it('treats a UTC-midnight startDate as Jan 2030, not Dec 2029', () => {
        const mortgage = new MortgageExpense(
          'm-utc', 'UTC Home', 'Monthly',
          350000, 300000, 300000,
          6, 30,
          0, 0, 0, 0, 0,
          0, 0, 'Yes', 0, 'a1',
          utcStart
        );
        // year before start -> nothing.
        expect(mortgage.calculateAnnualAmortization(2029).totalPayment).toBe(0);
        // start year -> active (would be skipped if read as 2029 via local accessors,
        // and the purchaseMonth would be 11 instead of 0).
        const startYear = mortgage.calculateAnnualAmortization(2030);
        expect(startYear.totalPayment).toBeGreaterThan(0);
        // Jan start => full 12 months. A local read (Dec) would only count 1 month.
        const fullYear = mortgage.calculateAnnualAmortization(2031);
        expect(startYear.totalPayment).toBeCloseTo(fullYear.totalPayment, 0);
      });
    });

    describe('LoanExpense.calculateAnnualAmortization (#5)', () => {
      it('uses UTC accessors for start/end year and month boundaries', () => {
        const loan = new LoanExpense(
          'l-utc', 'UTC Loan', 30000, 'Monthly',
          6, 'Compounding', 600, 'No', 0, 'a1',
          utcStart, // 2030-01-01 UTC
          utcEnd    // 2035-06-01 UTC
        );
        // Before start year: zero. Local read would think start is Dec 2029.
        expect(loan.calculateAnnualAmortization(2029).totalPayment).toBe(0);
        // Start year active and starts in January (full run of months from index 0).
        const startYear = loan.calculateAnnualAmortization(2030);
        expect(startYear.totalPayment).toBeGreaterThan(0);
        // End year is 2035 (UTC), not 2035 misread as something else; past end => 0.
        expect(loan.calculateAnnualAmortization(2036).totalPayment).toBe(0);
      });
    });

    describe('getMonthsUntilPaidOff (#8)', () => {
      it('computes whole months using UTC accessors', () => {
        // Start on the 1st (UTC) — rolls back a month with local accessors in a
        // US TZ. End mid-month (the 15th, UTC) — does NOT roll back. So a local
        // read shifts only the start, giving 66 instead of the correct 65.
        const loan = new LoanExpense(
          'l-months-utc', 'UTC Loan', 30000, 'Monthly',
          6, 'Compounding', 600, 'No', 0, 'a1',
          new Date(Date.UTC(2030, 0, 1)),  // 2030-01-01 UTC
          new Date(Date.UTC(2035, 5, 15))  // 2035-06-15 UTC
        );
        // (2035-2030)*12 + (5-0) = 65 months.
        expect(loan.getMonthsUntilPaidOff()).toBe(65);
      });
    });

    describe('isExpenseActiveInCurrentMonth (#8)', () => {
      it('agrees with getExpenseActiveMultiplier on the current year for UTC dates', () => {
        // Build a UTC-midnight start on the 1st of the current month. With LOCAL
        // accessors in a US TZ this would read as the previous month, but the
        // expense is genuinely active now.
        const now = new Date();
        const utcThisMonth = new Date(Date.UTC(now.getFullYear(), now.getMonth(), 1));
        const expense = new OtherExpense('e-utc', 'UTC active', 100, 'Monthly', utcThisMonth);

        expect(isExpenseActiveInCurrentMonth(expense)).toBe(true);
        // Cross-check with the file's getUTC*-based multiplier: active this year.
        expect(getExpenseActiveMultiplier(expense, now.getFullYear())).toBeGreaterThan(0);
      });

      it('treats a next-month UTC start as inactive (not pulled into this month)', () => {
        // A UTC-midnight start on the 1st of NEXT month reads, in a US TZ, as the
        // last day of THIS month with local accessors — which would wrongly mark
        // it active now. With getUTC* it stays correctly inactive. (When run on
        // the last day of a month the local roll-back lands in the current month
        // too; the assertion holds either way since UTC start is still future.)
        const now = new Date();
        const nextMonthStart = new Date(Date.UTC(now.getFullYear(), now.getMonth() + 1, 1));
        const expense = new OtherExpense('e-next', 'Next month', 100, 'Monthly', nextMonthStart);
        expect(isExpenseActiveInCurrentMonth(expense)).toBe(false);
      });

      it('treats a future UTC start as inactive', () => {
        const future = new Date(Date.UTC(new Date().getFullYear() + 2, 0, 1));
        const expense = new OtherExpense('e-future', 'Future', 100, 'Monthly', future);
        expect(isExpenseActiveInCurrentMonth(expense)).toBe(false);
      });
    });
  });
});
