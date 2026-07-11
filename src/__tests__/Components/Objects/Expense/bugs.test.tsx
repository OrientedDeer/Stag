/**
 * Bug-regression tests for confirmed findings in Expense/models.tsx.
 * Each section references the finding number from the audit.
 *
 * Run with default TZ for most tests.
 * For Finding 1 (timezone safety), run explicitly:
 *   TZ=Australia/Sydney npx vitest run src/__tests__/Components/Objects/Expense/bugs.test.tsx
 *   TZ=America/New_York npx vitest run src/__tests__/Components/Objects/Expense/bugs.test.tsx
 */
import { describe, it, expect } from 'vitest';
import {
  LoanExpense,
  MortgageExpense,
  OtherExpense,
  type AnyExpense,
  getExpenseActiveMultiplier,
  isGoalDueInYear,
  getGoalFundAnnualSetAside,
  getGoalFundMonthlyCap,
} from '../../../../components/Objects/Expense/models';

// ============================================================
// FINDING 2: LoanExpense.getAnnualAmount uncapped → Sankey imbalance
// ============================================================
describe('Finding 2: LoanExpense.getAnnualAmount must be capped at calculateAnnualAmortization', () => {
  /**
   * Construct a loan that will pay off mid-year.
   * Balance = $1,200. Monthly payment = $1,000. APR = 0% (simple).
   * At 0% the monthly interest = 0, so every dollar of payment goes to principal.
   * Month 1: pays $1,000 → balance = $200.
   * Month 2: pays $200 (capped) → balance = 0. Loan done.
   * calculateAnnualAmortization.totalPayment = $1,200.
   * Old getAnnualAmount = $1,000 * 12 = $12,000 (WRONG).
   */
  const startDate = new Date(2030, 0, 1);  // Jan 1 2030 local
  const endDate   = new Date(2035, 0, 1);  // far enough that loan isn't considered "ended" mid-year

  // Override endDate so the amortization loop runs; the balance itself controls early exit.
  // We want a loan whose balance pays off early.
  // $1,200 balance, $1,000/mo, 0% APR → paid off after 2 payments.
  const loan = new LoanExpense(
    'l-payoff', 'Payoff Loan', 1200, 'Monthly',
    0,          // apr = 0%
    'Simple',
    1000,       // explicit payment = $1,000/month
    'No', 0, 'a1',
    startDate,
    endDate,
  );

  it('calculateAnnualAmortization caps total payment at balance (not full year)', () => {
    const { totalPayment } = loan.calculateAnnualAmortization(2030);
    // Only $1,200 is actually paid (the balance), not $12,000.
    expect(totalPayment).toBeCloseTo(1200, 2);
    expect(totalPayment).toBeLessThan(loan.payment * 12);
  });

  it('getAnnualAmount(payoffYear) equals calculateAnnualAmortization(payoffYear).totalPayment', () => {
    const { totalPayment } = loan.calculateAnnualAmortization(2030);
    expect(loan.getAnnualAmount(2030)).toBeCloseTo(totalPayment, 2);
  });

  it('getAnnualAmount(payoffYear) is LESS than payment * 12', () => {
    expect(loan.getAnnualAmount(2030)).toBeLessThan(loan.payment * 12);
  });

  it('getMonthlyAmount(payoffYear) equals getAnnualAmount(payoffYear) / 12', () => {
    expect(loan.getMonthlyAmount(2030)).toBeCloseTo(loan.getAnnualAmount(2030) / 12, 8);
  });

  it('getAnnualAmount in a normal (non-payoff) year still returns payment * active_months', () => {
    // In a later year after the loan is paid (balance=0 from the start of the year),
    // calculateAnnualAmortization returns 0 and so should getAnnualAmount.
    // But for a running year with full balance, it should match active months × payment.
    // Use a fresh loan that won't pay off in 2030 to test non-payoff path.
    const bigLoan = new LoanExpense(
      'l-big', 'Big Loan', 100000, 'Monthly',
      5, 'Compounding', 1000, 'No', 0, 'a1',
      new Date(2030, 0, 1),
      new Date(2040, 0, 1),
    );
    // Full year — getAnnualAmount should equal payment * 12 (no early payoff).
    const { totalPayment } = bigLoan.calculateAnnualAmortization(2030);
    expect(bigLoan.getAnnualAmount(2030)).toBeCloseTo(totalPayment, 2);
  });
});

// ============================================================
// FINDING 5: MortgageExpense.calculatePayment adds PMI with no LTV gate
// ============================================================
describe('Finding 5: MortgageExpense.calculatePayment must gate PMI on LTV > 80%', () => {
  /**
   * Mortgage with 50% LTV (loan_balance / valuation = 0.5).
   * PMI rate is non-zero (0.5%). LTV <= 80% → PMI must be $0.
   * The bug: calculatePayment() includes PMI unconditionally.
   */
  const mortgageLowLTV = new MortgageExpense(
    'm-ltv', 'Low LTV', 'Monthly',
    400000,   // valuation
    200000,   // loan_balance  → LTV = 0.50 (50%)
    200000,   // starting_loan_balance
    4,        // apr
    30,       // term
    0, 0, 0, 0,   // taxes, deduction, maintenance, utilities
    0,        // home_owners_insurance
    0.5,      // pmi rate (0.5%) — should NOT apply at 50% LTV
    0,        // hoa_fee
    'No', 0, 'a1',
    new Date(2025, 0, 1),
  );

  // Same mortgage with PMI = 0 to get the "no-PMI" payment for comparison.
  const mortgageNoPMI = new MortgageExpense(
    'm-nopmi', 'No PMI', 'Monthly',
    400000,
    200000,
    200000,
    4,
    30,
    0, 0, 0, 0,
    0,
    0,        // pmi = 0
    0,
    'No', 0, 'a1',
    new Date(2025, 0, 1),
  );

  it('LTV=50% (well below 80%): calculatePayment equals the no-PMI payment', () => {
    // When LTV <= 80%, PMI should not be included, so both payments should be equal.
    expect(mortgageLowLTV.calculatePayment()).toBeCloseTo(mortgageNoPMI.calculatePayment(), 2);
  });

  it('LTV=50%: PMI is NOT included in calculatePayment', () => {
    const pmiMonthly = mortgageLowLTV.valuation * mortgageLowLTV.pmi / 100 / 12;
    expect(pmiMonthly).toBeGreaterThan(0); // confirm PMI rate is non-zero
    // The payment should NOT include PMI.
    expect(mortgageLowLTV.calculatePayment()).toBeLessThan(
      mortgageNoPMI.calculatePayment() + pmiMonthly
    );
  });

  it('LTV=90% (above 80%): calculatePayment DOES include PMI', () => {
    const mortgageHighLTV = new MortgageExpense(
      'm-high-ltv', 'High LTV', 'Monthly',
      400000,
      360000,   // loan_balance → LTV = 0.90
      360000,
      4, 30,
      0, 0, 0, 0,
      0,
      0.5,      // pmi rate
      0,
      'No', 0, 'a1',
      new Date(2025, 0, 1),
    );
    const mortgageHighNoPMI = new MortgageExpense(
      'm-high-nopmi', 'High LTV No PMI', 'Monthly',
      400000,
      360000,
      360000,
      4, 30,
      0, 0, 0, 0,
      0,
      0,        // pmi = 0
      0,
      'No', 0, 'a1',
      new Date(2025, 0, 1),
    );
    const pmiMonthly = 400000 * 0.005 / 12;
    expect(mortgageHighLTV.calculatePayment()).toBeCloseTo(
      mortgageHighNoPMI.calculatePayment() + pmiMonthly, 2
    );
  });
});

// ============================================================
// FINDING 8: getGoalFundAnnualSetAside double-counts shared fund accounts
// ============================================================
describe('Finding 8: getGoalFundAnnualSetAside must sum across ALL goals sharing an accountId', () => {
  /**
   * Two targetDate goals sharing the same goalAccountId.
   * Goal A: $24,000 over 24 months (2026–2028)  → $1,000/mo.
   * Goal B: $48,000 over 24 months (2026–2028)  → $2,000/mo.
   * Combined set-aside: $3,000/mo, $36,000/year.
   *
   * The bug: expenses.find() returns only the FIRST matching goal, so
   * getGoalFundAnnualSetAside returns $1,000/mo × 12 = $12,000 instead of $36,000.
   */
  const makeGoal = (id: string, amount: number): AnyExpense => {
    const g = new OtherExpense(id, `Goal ${id}`, amount, 'Monthly',
      new Date(2026, 0, 1), new Date(2028, 0, 1));
    g.goalType = 'targetDate';
    // endDate IS the target for targetDate goals.
    g.endDate = new Date(2028, 0, 1);
    g.goalAccountId = 'fund1';
    return g;
  };

  const goalA = makeGoal('ga', 24000); // $1,000/mo over 24 months
  const goalB = makeGoal('gb', 48000); // $2,000/mo over 24 months
  const expenses: AnyExpense[] = [goalA, goalB];

  it('getGoalFundAnnualSetAside sums both goals (not just the first)', () => {
    // 2027: both goals are fully active (12 months each).
    // Expected: $1,000 × 12 + $2,000 × 12 = $36,000.
    const total = getGoalFundAnnualSetAside(expenses, 'fund1', 2027);
    expect(total).toBeCloseTo(36000, 2);
  });

  it('summed set-aside is NOT equal to 2× the first goal alone', () => {
    const firstGoalOnly = getGoalFundAnnualSetAside([goalA], 'fund1', 2027)!;
    const bothGoals = getGoalFundAnnualSetAside(expenses, 'fund1', 2027)!;
    // Bug would return firstGoalOnly (= 12000) for bothGoals; correct is 36000.
    expect(bothGoals).not.toBeCloseTo(firstGoalOnly, 2);
    expect(bothGoals).toBeCloseTo(firstGoalOnly * 3, 2); // $12,000 × 3 = $36,000
  });

  it('getGoalFundMonthlyCap sums both goals', () => {
    const cap = getGoalFundMonthlyCap(expenses, 'fund1', 2027);
    // $1,000 + $2,000 = $3,000/mo.
    expect(cap).toBeCloseTo(3000, 2);
  });

  it('returns undefined when no goal targets the account', () => {
    expect(getGoalFundAnnualSetAside(expenses, 'other-fund', 2027)).toBeUndefined();
    expect(getGoalFundMonthlyCap(expenses, 'other-fund', 2027)).toBeUndefined();
  });

  it('single-goal case still works correctly after fix', () => {
    const singleGoal = getGoalFundAnnualSetAside([goalA], 'fund1', 2027);
    expect(singleGoal).toBeCloseTo(12000, 2);
  });
});

// ============================================================
// FINDING 1: date readers use getUTC* on local-midnight dates (timezone safety)
// ============================================================
describe('Finding 1: local-midnight dates must use local (not UTC) accessors', () => {
  /**
   * parseDate (and direct code) builds LOCAL-midnight dates via new Date(y, m-1, d).
   * Readers in models.tsx currently use getUTCFullYear()/getUTCMonth(), which shifts
   * the window in positive-UTC timezones (e.g. Sydney, UTC+10/11):
   *   new Date(2030,0,1) in Sydney = 2029-12-31T13:00:00Z
   *   getUTCFullYear() → 2029  (WRONG, should be 2030)
   *   getUTCMonth()    → 11    (WRONG, should be 0)
   *
   * After the fix all readers use getFullYear()/getMonth() (local accessors).
   * These tests use new Date(y,m,d) (local midnight) to match how parseDate works.
   */

  describe('isGoalDueInYear — local-midnight endDate', () => {
    it('targetDate goal with local Jan 1 2030 endDate is due in 2030', () => {
      const g = new OtherExpense('g1', 'Goal', 10000, 'Monthly', new Date(2025, 0, 1));
      g.goalType = 'targetDate';
      g.endDate = new Date(2030, 0, 1);  // local midnight Jan 1 2030
      expect(isGoalDueInYear(g, 2030)).toBe(true);
      expect(isGoalDueInYear(g, 2029)).toBe(false);
    });
  });

  describe('getExpenseActiveMultiplier — local-midnight startDate', () => {
    it('expense starting local Jan 1 2030 is fully active in 2030 (multiplier=1)', () => {
      const e = new OtherExpense('e1', 'Test', 100, 'Annually', new Date(2030, 0, 1));
      // Should be 1 (active all 12 months). Would be 1/12 if getUTCMonth() returned 11.
      expect(getExpenseActiveMultiplier(e, 2030)).toBe(1);
    });

    it('expense starting local Jan 1 2030 is NOT active in 2029', () => {
      const e = new OtherExpense('e1', 'Test', 100, 'Annually', new Date(2030, 0, 1));
      expect(getExpenseActiveMultiplier(e, 2029)).toBe(0);
    });
  });

  describe('goalMonthsActiveInYear via getGoalFundAnnualSetAside — local-midnight dates', () => {
    it('full-year goal active Jan–Dec 2030 gives 12 months of set-aside', () => {
      // $12,000 over 12 months = $1,000/mo.
      const g = new OtherExpense('g2', 'Goal', 12000, 'Monthly', new Date(2030, 0, 1));
      g.goalType = 'targetDate';
      g.endDate = new Date(2031, 0, 1);  // 12 months exactly
      g.goalAccountId = 'acc';
      const annual = getGoalFundAnnualSetAside([g], 'acc', 2030);
      expect(annual).toBeCloseTo(12000, 2);
    });
  });
});
