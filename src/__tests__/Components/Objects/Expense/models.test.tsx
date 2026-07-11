import { describe, it, expect, vi } from 'vitest';
import {
  RentExpense,
  MortgageExpense,
  LoanExpense,
  HealthcareExpense,
  BaseExpense,
  type AnyExpense,
  reconstituteExpense,
  getExpenseActiveMultiplier,
  isExpenseActiveInCurrentMonth,
  getGoalMonthlySetAside,
  getGoalFundMonthlyCap,
  getGoalFundAnnualSetAside,
  isExpenseDone,
  DependentExpense,
  VacationExpense,
  OtherExpense,
  EmergencyExpense,
  TransportExpense,
  FoodExpense,
} from '../../../../components/Objects/Expense/models';
import { defaultAssumptions, type AssumptionsState } from '../../../../components/Objects/Assumptions/AssumptionsContext';

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
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      increment(_assumptions: AssumptionsState): AnyExpense { return this as unknown as AnyExpense; }
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
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

    describe('future-dated home purchase does not advance before closing (#178)', () => {
      // A home purchased Jan 2028, advanced through 2026/2027 first.
      const futureHome = new MortgageExpense('mf', 'Future Home', 'Monthly', 500000, 400000, 400000, 3, 30, 1.2, 0, 1, 100, 0.3, 0, 50, 'Yes', 0, 'a4', new Date(2028, 0, 1));

      it('holds loan_balance and valuation for years before the purchase year', () => {
        const y2026 = futureHome.increment(mockAssumptions, 2026);
        expect(y2026.loan_balance).toBe(400000); // no phantom principal paydown
        expect(y2026.valuation).toBe(500000);    // no phantom appreciation
        expect(y2026.tax_deductible).toBe(0);     // no phantom interest deduction
      });

      it('advances normally once the purchase year is reached', () => {
        const y2028 = futureHome.increment(mockAssumptions, 2028);
        expect(y2028.loan_balance).toBeLessThan(400000);
        expect(y2028.valuation).toBe(500000 * 1.05);
      });

      it('advances when no year is supplied (backward compatible)', () => {
        expect(futureHome.increment(mockAssumptions).loan_balance).toBeLessThan(400000);
      });
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
        // + PMI: LTV = 300k/400k = 75% <= 80%, so PMI does NOT apply (bug fix)
        // + repairs $200/mo
        // + utilities $300
        // + extra $0
        const mortgageWithAll = new MortgageExpense(
          'm-full', 'Full Payment', 'Monthly',
          400000,   // valuation
          300000,   // loan_balance → LTV = 75% (no PMI should apply)
          300000,   // starting_loan_balance
          6,        // apr
          30,       // term
          1.2,      // property_taxes (1.2% of valuation = $4800/yr = $400/mo)
          0,        // valuation_deduction
          0.6,      // maintenance (0.6% of valuation = $2400/yr = $200/mo)
          300,      // utilities
          0.45,     // insurance (0.45% of valuation = $1800/yr = $150/mo)
          0.3,      // pmi rate, but LTV <= 80% so PMI = $0
          0,        // hoa_fee
          'Yes', 0, 'a1',
          new Date('2024-01-01')
        );

        const payment = mortgageWithAll.calculatePayment();

        // P&I ≈ $1,798.65
        // taxes = 400000 × 0.012 / 12 = $400
        // insurance = 400000 × 0.0045 / 12 = $150
        // PMI = $0 (LTV 75% is ≤ 80%; PMI gate prevents inclusion)
        // repairs = 400000 × 0.006 / 12 = $200
        // utilities = $300
        // Total ≈ $2,849 (was $2,949 before the PMI gate fix)
        expect(payment).toBeCloseTo(2849, 0);
      });
    });

    // A1 backlog item: MortgageExpense.getAnnualAmount(year) must be
    // amortization-aware (mirroring LoanExpense after PR #57 #2), so the
    // DataTab table/CSV agree with the Sankey/engine path, which already
    // special-cases mortgages through calculateAnnualAmortization.
    describe('getAnnualAmount year-aware amortization (backlog A1)', () => {
      // 0% APR for exact numbers: starting $360k over 30y → standard P&I $1,000/mo.
      // $5,000 balance left at the start of 2030 → paid off after 5 payments.
      // No escrow (all rates/fees 0), so payment === P&I === $1,000/mo.
      const payoffYearMortgage = new MortgageExpense(
        'm-payoff', 'Payoff Year', 'Monthly',
        400000,  // valuation
        5000,    // loan_balance at start of 2030
        360000,  // starting_loan_balance
        0,       // apr (0% → exact straight-line P&I)
        30,      // term_length
        0, 0, 0, 0, 0, // taxes, deduction, maintenance, utilities, insurance
        0, 0, 'No', 0, 'a1',
        new Date(2028, 0, 1) // purchased Jan 2028 → 2030 is a full year (startMonth 0)
      );

      it('getAnnualAmount(payoffYear) equals calculateAnnualAmortization(payoffYear).totalPayment', () => {
        const { totalPayment } = payoffYearMortgage.calculateAnnualAmortization(2030);
        expect(totalPayment).toBeCloseTo(5000, 2); // sanity: 5 × $1,000, then paid off
        expect(payoffYearMortgage.getAnnualAmount(2030)).toBeCloseTo(totalPayment, 2);
      });

      it('getAnnualAmount(payoffYear) is LESS than payment × 12', () => {
        expect(payoffYearMortgage.payment).toBeCloseTo(1000, 2);
        expect(payoffYearMortgage.getAnnualAmount(2030)).toBeLessThan(payoffYearMortgage.payment * 12);
      });

      it('no-arg getAnnualAmount keeps the "today" payment×12 semantics (Dashboard/SpendingTab)', () => {
        expect(payoffYearMortgage.getAnnualAmount()).toBeCloseTo(12000, 2);
      });

      it('getMonthlyAmount(year) equals getAnnualAmount(year) / 12', () => {
        expect(payoffYearMortgage.getMonthlyAmount(2030))
          .toBeCloseTo(payoffYearMortgage.getAnnualAmount(2030) / 12, 8);
      });

      it('a normal (non-payoff) full year still equals payment × 12, including LTV-gated PMI', () => {
        // LTV = 450k/500k = 90% > 80% → PMI applies and is embedded in `payment`.
        const withPmi = new MortgageExpense(
          'm-pmi', 'High LTV', 'Monthly',
          500000, 450000, 450000,
          3, 30,
          0, 0, 0, 0, 0,
          0.6,  // pmi rate → 500000 × 0.6% / 12 = $250/mo while LTV > 80%
          0, 'No', 0, 'a1',
          new Date(2025, 0, 1)
        );
        // Identical mortgage without PMI, to pin the PMI delta.
        const noPmi = new MortgageExpense(
          'm-nopmi', 'High LTV no PMI', 'Monthly',
          500000, 450000, 450000,
          3, 30,
          0, 0, 0, 0, 0,
          0, 0, 'No', 0, 'a1',
          new Date(2025, 0, 1)
        );

        // Mid-life full year: amortization-aware annual == payment × 12.
        expect(withPmi.getAnnualAmount(2026)).toBeCloseTo(withPmi.payment * 12, 2);
        expect(noPmi.getAnnualAmount(2026)).toBeCloseTo(noPmi.payment * 12, 2);
        // The PMI escrow flows through the year-aware amount: $250/mo × 12.
        expect(withPmi.getAnnualAmount(2026) - noPmi.getAnnualAmount(2026)).toBeCloseTo(3000, 2);
      });

      it('returns 0 before the purchase year', () => {
        expect(payoffYearMortgage.getAnnualAmount(2027)).toBe(0);
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

    describe('future-dated loan does not amortize before it starts (#178)', () => {
      // A $30k car loan starting Jan 2028, being advanced through years before 2028.
      const futureLoan = new LoanExpense('lf', 'Future Car', 30000, 'Monthly', 6, 'Compounding', 0, 'No', 0, 'a3', new Date(2028, 0, 1), new Date(2033, 0, 1));

      it('holds the balance for years strictly before the start year', () => {
        // Advancing through 2026 and 2027 must NOT pay down principal — no cash
        // leaves the plan before the loan exists.
        expect(futureLoan.increment(mockAssumptions, 2026).amount).toBe(30000);
        expect(futureLoan.increment(mockAssumptions, 2027).amount).toBe(30000);
      });

      it('amortizes normally once the loan has started', () => {
        const started = futureLoan.increment(mockAssumptions, 2028);
        expect(started.amount).toBeLessThan(30000);
      });

      it('still amortizes when no year is supplied (backward compatible)', () => {
        expect(futureLoan.increment(mockAssumptions).amount).toBeLessThan(30000);
      });
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

    // Phase-1 (#60 B): extra_payment is an OPTIONAL trailing constructor arg
    // (default 0) that adds extra monthly principal, mirroring
    // MortgageExpense.extra_payment. Default-off keeps existing loans identical.
    describe('extra_payment (accelerated payoff)', () => {
      it('defaults to 0 when not provided (existing loans unchanged)', () => {
        const baseLoan = new LoanExpense(
          'l-base', 'Car', 20000, 'Monthly', 8, 'Compounding', 405.53, 'No', 0, 'a1',
          new Date(2024, 0, 1), new Date(2029, 0, 1)
        );
        expect(baseLoan.extra_payment).toBe(0);

        // With default 0, the amortization is byte-identical to the prior behavior.
        const { totalPrincipal } = baseLoan.calculateAnnualAmortization(2024);
        expect(totalPrincipal).toBeCloseTo(3389, 0);
      });

      it('adds extra principal each month in calculateAnnualAmortization', () => {
        const extra = 100;
        const accelLoan = new LoanExpense(
          'l-accel', 'Car', 20000, 'Monthly', 8, 'Compounding', 405.53, 'No', 0, 'a1',
          new Date(2024, 0, 1), new Date(2029, 0, 1),
          undefined, undefined, extra
        );
        expect(accelLoan.extra_payment).toBe(extra);

        const base = new LoanExpense(
          'l-accel', 'Car', 20000, 'Monthly', 8, 'Compounding', 405.53, 'No', 0, 'a1',
          new Date(2024, 0, 1), new Date(2029, 0, 1)
        );

        const baseAmort = base.calculateAnnualAmortization(2024);
        const accelAmort = accelLoan.calculateAnnualAmortization(2024);

        // Extra $100/mo for 12 months ≈ $1,200 more principal in year 1
        // (slightly more once the lower balance saves interest).
        expect(accelAmort.totalPrincipal).toBeGreaterThan(baseAmort.totalPrincipal + 1190);
        expect(accelAmort.totalPayment).toBeGreaterThan(baseAmort.totalPayment);
      });

      it('pays the loan down faster via increment() and survives the year', () => {
        const extra = 200;
        const accelLoan = new LoanExpense(
          'l-accel2', 'Car', 25000, 'Monthly', 5, 'Compounding', 471.78, 'No', 0, 'a1',
          new Date(2025, 0, 1), new Date(2030, 0, 1),
          undefined, undefined, extra
        );
        const base = new LoanExpense(
          'l-accel2', 'Car', 25000, 'Monthly', 5, 'Compounding', 471.78, 'No', 0, 'a1',
          new Date(2025, 0, 1), new Date(2030, 0, 1)
        );

        const nextAccel = accelLoan.increment(mockAssumptions);
        const nextBase = base.increment(mockAssumptions);

        // Accelerated balance is lower, and extra_payment carries to next year.
        expect(nextAccel.amount).toBeLessThan(nextBase.amount);
        expect(nextAccel.extra_payment).toBe(extra);
      });

      it('caps extra principal at the remaining balance (no overpay)', () => {
        // Tiny balance, huge extra payment — must not drive balance negative.
        const tinyLoan = new LoanExpense(
          'l-tiny', 'Almost paid', 300, 'Monthly', 5, 'Compounding', 100, 'No', 0, 'a1',
          new Date(2025, 0, 1), new Date(2030, 0, 1),
          undefined, undefined, 5000
        );
        const next = tinyLoan.increment(mockAssumptions);
        expect(next.amount).toBeGreaterThanOrEqual(0);

        const { totalPrincipal } = tinyLoan.calculateAnnualAmortization(2025);
        expect(totalPrincipal).toBeLessThanOrEqual(300 + 0.01);
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
    it('preserves an ABSENT startDate as undefined for a milestone-started expense (#178)', () => {
      // Milestone-started expenses carry startDate undefined BY DESIGN. The old
      // parseDateRequired stamped a fresh new Date() on every reload, destabilizing the
      // simulation input hash. Round-trip the undefined instead.
      const food = reconstituteExpense({ className: 'FoodExpense', id: 'f9', amount: 400, startMilestoneId: 'ms-move' }) as FoodExpense;
      expect(food).toBeInstanceOf(FoodExpense);
      expect(food.startDate).toBeUndefined();
      expect(food.startMilestoneId).toBe('ms-move');
    });

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

  // --- Local-midnight date convention regression tests ---
  // Date-only values are built by parseDate via new Date(y, m-1, d) — LOCAL midnight.
  // Readers now use getFullYear()/getMonth() (local) so they work correctly in any
  // timezone: positive-UTC (Sydney) and negative-UTC (US) alike. Tests use
  // new Date(y, m, d) (local midnight) to match production date construction.
  describe('local-midnight date handling (timezone safety)', () => {
    // Jan 1 2030 local midnight — matches parseDate('2030-01-01').
    const localStart = new Date(2030, 0, 1);
    // Jun 1 2035 local midnight.
    const localEnd = new Date(2035, 5, 1);

    describe('MortgageExpense.calculateAnnualAmortization', () => {
      it('treats a local-midnight Jan 1 2030 startDate as Jan 2030', () => {
        const mortgage = new MortgageExpense(
          'm-local', 'Local Home', 'Monthly',
          350000, 300000, 300000,
          6, 30,
          0, 0, 0, 0, 0,
          0, 0, 'Yes', 0, 'a1',
          localStart
        );
        // Year before start → nothing.
        expect(mortgage.calculateAnnualAmortization(2029).totalPayment).toBe(0);
        // Start year → active.
        const startYear = mortgage.calculateAnnualAmortization(2030);
        expect(startYear.totalPayment).toBeGreaterThan(0);
        // Jan start → full 12 months equals a plain full year.
        const fullYear = mortgage.calculateAnnualAmortization(2031);
        expect(startYear.totalPayment).toBeCloseTo(fullYear.totalPayment, 0);
      });
    });

    describe('LoanExpense.calculateAnnualAmortization', () => {
      it('uses local accessors for start/end year and month boundaries', () => {
        const loan = new LoanExpense(
          'l-local', 'Local Loan', 30000, 'Monthly',
          6, 'Compounding', 600, 'No', 0, 'a1',
          localStart, // Jan 1 2030 local
          localEnd    // Jun 1 2035 local
        );
        // Before start year → zero.
        expect(loan.calculateAnnualAmortization(2029).totalPayment).toBe(0);
        // Start year active and starts in January.
        const startYear = loan.calculateAnnualAmortization(2030);
        expect(startYear.totalPayment).toBeGreaterThan(0);
        // End year is 2035 local; past end → 0.
        expect(loan.calculateAnnualAmortization(2036).totalPayment).toBe(0);
      });
    });

    describe('getMonthsUntilPaidOff', () => {
      it('computes whole months using local accessors', () => {
        // Jan 2030 to Jun 2035 = 65 months: (2035-2030)*12 + (5-0) = 65.
        const loan = new LoanExpense(
          'l-months-local', 'Local Loan', 30000, 'Monthly',
          6, 'Compounding', 600, 'No', 0, 'a1',
          new Date(2030, 0, 1),  // Jan 2030 local
          new Date(2035, 5, 15)  // Jun 15 2035 local (mid-month — getMonth still 5)
        );
        // (2035-2030)*12 + (5-0) = 65 months.
        expect(loan.getMonthsUntilPaidOff()).toBe(65);
      });
    });

    describe('isExpenseActiveInCurrentMonth', () => {
      it('agrees with getExpenseActiveMultiplier on the current year for local dates', () => {
        // Local-midnight start on the 1st of the current month — genuinely active.
        const now = new Date();
        const localThisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        const expense = new OtherExpense('e-local', 'Local active', 100, 'Monthly', localThisMonth);

        expect(isExpenseActiveInCurrentMonth(expense)).toBe(true);
        expect(getExpenseActiveMultiplier(expense, now.getFullYear())).toBeGreaterThan(0);
      });

      it('treats a next-month local start as inactive', () => {
        const now = new Date();
        const nextMonthStart = new Date(now.getFullYear(), now.getMonth() + 1, 1);
        const expense = new OtherExpense('e-next', 'Next month', 100, 'Monthly', nextMonthStart);
        expect(isExpenseActiveInCurrentMonth(expense)).toBe(false);
      });

      it('treats a future local start as inactive', () => {
        const future = new Date(new Date().getFullYear() + 2, 0, 1);
        const expense = new OtherExpense('e-future', 'Future', 100, 'Monthly', future);
        expect(isExpenseActiveInCurrentMonth(expense)).toBe(false);
      });
    });
  });

  describe('long-term goals — derived funding (no stored duplicates)', () => {
    // endDate IS a targetDate goal's target. The funding set-aside is derived
    // from the goal each year (getGoalFundMonthlyCap) so edits to the goal's
    // amount/dates propagate — the priority's stored capValue is only a
    // creation-time snapshot that nothing should trust.
    // Dates use local midnight (new Date(y, m, d)) to match parseDate output.
    const makeGoal = (amount: number, startYear: number, targetYear: number) => {
      const goal = new OtherExpense('exp-g', 'Goal', amount, 'Monthly', new Date(startYear, 0, 1));
      goal.goalType = 'targetDate';
      goal.endDate = new Date(targetYear, 0, 1);
      goal.goalAccountId = 'acc-fund';
      return goal;
    };

    it('getGoalMonthlySetAside reads the target from endDate', () => {
      const goal = makeGoal(36000, 2025, 2028); // 36 months
      expect(getGoalMonthlySetAside(goal)).toBeCloseTo(1000, 5);
    });

    it('getGoalFundMonthlyCap derives the live cap inside the saving window', () => {
      const goal = makeGoal(36000, 2025, 2028);
      expect(getGoalFundMonthlyCap([goal], 'acc-fund', 2024)).toBe(0);   // not saving yet
      expect(getGoalFundMonthlyCap([goal], 'acc-fund', 2026)).toBeCloseTo(1000, 5);
      expect(getGoalFundMonthlyCap([goal], 'acc-fund', 2028)).toBeCloseTo(1000, 5); // purchase year still funds
      expect(getGoalFundMonthlyCap([goal], 'acc-fund', 2029)).toBe(0);   // already purchased
    });

    it('getGoalFundMonthlyCap reflects goal edits immediately (regression: stale capValue)', () => {
      const goal = makeGoal(36000, 2025, 2028);
      goal.amount = 72000; // user doubles the goal after creation
      expect(getGoalFundMonthlyCap([goal], 'acc-fund', 2026)).toBeCloseTo(2000, 5);
      goal.endDate = new Date(2031, 0, 1); // user pushes the target out (72 months, local midnight)
      expect(getGoalFundMonthlyCap([goal], 'acc-fund', 2026)).toBeCloseTo(1000, 5);
    });

    it('getGoalFundAnnualSetAside prorates partial years and sums to the goal amount', () => {
      // Goal: $31,000 starting June 2026, due Jan 2029 → 31 months → $1,000/mo.
      // 2026 commits Jun–Dec (7 mo), 2027/2028 full years, 2029 (Jan target) 0.
      // Dates are local midnight to match parseDate output.
      const goal = new OtherExpense('exp-g', 'Goal', 31000, 'Monthly', new Date(2026, 5, 1));
      goal.goalType = 'targetDate';
      goal.endDate = new Date(2029, 0, 1);
      goal.goalAccountId = 'acc-fund';

      expect(getGoalFundAnnualSetAside([goal], 'acc-fund', 2025)).toBe(0);
      expect(getGoalFundAnnualSetAside([goal], 'acc-fund', 2026)).toBeCloseTo(7000, 5);
      expect(getGoalFundAnnualSetAside([goal], 'acc-fund', 2027)).toBeCloseTo(12000, 5);
      expect(getGoalFundAnnualSetAside([goal], 'acc-fund', 2028)).toBeCloseTo(12000, 5);
      expect(getGoalFundAnnualSetAside([goal], 'acc-fund', 2029)).toBe(0);

      // Across all years, exactly the goal amount is committed.
      const total = [2025, 2026, 2027, 2028, 2029, 2030]
        .reduce((s, y) => s + (getGoalFundAnnualSetAside([goal], 'acc-fund', y) ?? 0), 0);
      expect(total).toBeCloseTo(31000, 5);
    });

    it('getGoalFundAnnualSetAside prorates a mid-year target in the final year', () => {
      // $29,000 from Jan 2026 to Jun 2028 → 29 months. 2028 commits Jan–May (5 mo).
      const goal = new OtherExpense('exp-g', 'Goal', 29000, 'Monthly', new Date(2026, 0, 1));
      goal.goalType = 'targetDate';
      goal.endDate = new Date(2028, 5, 1);
      goal.goalAccountId = 'acc-fund';

      expect(getGoalFundAnnualSetAside([goal], 'acc-fund', 2028)).toBeCloseTo(5000, 5);
      const total = [2026, 2027, 2028]
        .reduce((s, y) => s + (getGoalFundAnnualSetAside([goal], 'acc-fund', y) ?? 0), 0);
      expect(total).toBeCloseTo(29000, 5);
    });

    it('getGoalFundAnnualSetAside prorates a recurring goal start year, then runs full years', () => {
      const goal = new OtherExpense('exp-g', 'Roof', 36000, 'Monthly', new Date(2026, 9, 1)); // Oct local
      goal.goalType = 'recurring';
      goal.intervalYears = 3; // $1,000/mo
      goal.goalAccountId = 'acc-fund';

      expect(getGoalFundAnnualSetAside([goal], 'acc-fund', 2026)).toBeCloseTo(3000, 5); // Oct–Dec
      expect(getGoalFundAnnualSetAside([goal], 'acc-fund', 2027)).toBeCloseTo(12000, 5);
      expect(getGoalFundAnnualSetAside([goal], 'acc-fund', 2035)).toBeCloseTo(12000, 5); // recurs forever
    });

    // #83: the monthly cap (PriorityTab) and the annual set-aside (sim engine +
    // charts) must agree on a goal's end semantics even when an endDate lingers.
    // Previously getGoalFundMonthlyCap only honored endDate for 'targetDate'
    // goals, so a recurring goal carrying an endDate kept a nonzero $/mo cap
    // while goalMonthsActiveInYear (and the sim) reserved $0 past that year.
    describe('#83: cap, set-aside, and done-status agree on goalType-aware endDate', () => {
      const makeRecurring = (opts: { endDate?: Date } = {}) => {
        const goal = new OtherExpense('exp-rg', 'Roof', 36000, 'Monthly', new Date(2026, 0, 1));
        goal.goalType = 'recurring';
        goal.intervalYears = 3; // $1,000/mo
        goal.goalAccountId = 'acc-fund';
        if (opts.endDate) goal.endDate = opts.endDate;
        return goal;
      };

      it('recurring goal with NO endDate: cap, set-aside, and done all say it never finishes', () => {
        const goal = makeRecurring();
        // Funds every full year forever; never done.
        expect(getGoalFundMonthlyCap([goal], 'acc-fund', 2040)).toBeCloseTo(1000, 5);
        expect(getGoalFundAnnualSetAside([goal], 'acc-fund', 2040)).toBeCloseTo(12000, 5);
        expect(isExpenseDone(goal)).toBe(false);
      });

      it('recurring goal WITH an endDate: cap and set-aside both stop after it (no disagreement)', () => {
        // "Stop replacing it" at end of 2029 (the sim engine stops the lump and
        // the set-aside after endDate.year < year; the cap must match).
        const goal = makeRecurring({ endDate: new Date(2029, 0, 1) });
        // In the saving window both surfaces fund.
        expect(getGoalFundMonthlyCap([goal], 'acc-fund', 2028)).toBeCloseTo(1000, 5);
        expect(getGoalFundAnnualSetAside([goal], 'acc-fund', 2028)).toBeCloseTo(12000, 5);
        // After the end year, both reserve $0 — the regression was cap > 0 here.
        expect(getGoalFundMonthlyCap([goal], 'acc-fund', 2030)).toBe(0);
        expect(getGoalFundAnnualSetAside([goal], 'acc-fund', 2030)).toBe(0);
      });

      it('isExpenseDone is goalType-aware: recurring-with-past-end is done, no-end recurring is not', () => {
        const ended = makeRecurring({ endDate: new Date(2000, 0, 1) }); // long past
        expect(isExpenseDone(ended)).toBe(true);
        const forever = makeRecurring();
        expect(isExpenseDone(forever)).toBe(false);
        // A targetDate goal still respects its own past target.
        const target = makeGoal(36000, 2010, 2013);
        expect(isExpenseDone(target)).toBe(true);
        const futureTarget = makeGoal(36000, 2030, 2033);
        expect(isExpenseDone(futureTarget)).toBe(false);
      });
    });

    it('getGoalFundMonthlyCap returns undefined for accounts that are not goal funds', () => {
      const goal = makeGoal(36000, 2025, 2028);
      expect(getGoalFundMonthlyCap([goal], 'acc-other', 2026)).toBeUndefined();
      expect(getGoalFundMonthlyCap([goal], undefined, 2026)).toBeUndefined();
    });

    it('reconstituteExpense migrates legacy goalTargetDate into endDate', () => {
      // Pre-migration backups stored the target in a separate goalTargetDate
      // field (a duplicate of endDate that could drift). On load it must be
      // absorbed into endDate when endDate is missing.
      // parseDate converts the ISO string to local midnight: new Date(2027, 0, 1).
      const legacy = {
        className: 'OtherExpense',
        id: 'exp-legacy', name: 'Legacy goal', amount: 12000, frequency: 'Monthly',
        startDate: '2025-01-01T00:00:00.000Z',
        goalType: 'targetDate',
        goalTargetDate: '2027-01-01T00:00:00.000Z',
        goalAccountId: 'acc-fund',
      };
      const expense = reconstituteExpense(legacy)!;
      // parseDate builds local midnight, so getFullYear() = 2027 regardless of TZ.
      expect(expense.endDate?.getFullYear()).toBe(2027);
      expect(getGoalMonthlySetAside(expense)).toBeCloseTo(12000 / 24, 5);
    });
  });
});
