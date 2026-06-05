import { describe, it, expect } from 'vitest';
import {
  getTransactionMonthlyAmount,
  getExpenseMonthlyBudget,
  getActiveExpenses,
  calculateTotalMonthlyBudget,
  formatMonthYear,
  calculateBudgetSummary,
  calculateVariance,
  getExpectedAccountBalance,
  getExpectedMonthlyContribution,
  calculateNetCashFlow,
  getTotalIncome,
  getTotalNetSpending,
  getNetSpendingByCategory,
  getIncomeByCategory,
  getCategorySpending,
  getAccountBalances,
  calculateCategoryTotalsFromTransactions,
} from '../../../../components/Objects/Budget/budgetUtils';
import { Transaction, MonthlySnapshot } from '../../../../components/Objects/Budget/BudgetContext';
import { OtherExpense } from '../../../../components/Objects/Expense/models';
import { SavedAccount } from '../../../../components/Objects/Accounts/models';
import { SimulationYear } from '../../../../services/simulation/types';

describe('budgetUtils', () => {
  describe('getTransactionMonthlyAmount', () => {
    it('should convert $1,200 annual transaction to $100/month', () => {
      const transaction: Transaction = {
        id: 't1',
        date: new Date(2024, 0, 1),
        description: 'Annual subscription',
        amount: 1200,
        frequency: 'annual',
      };

      expect(getTransactionMonthlyAmount(transaction)).toBe(100);
    });

    it('should convert $400 quarterly transaction to $133.33/month', () => {
      const transaction: Transaction = {
        id: 't2',
        date: new Date(2024, 0, 1),
        description: 'Quarterly dues',
        amount: 400,
        frequency: 'quarterly',
      };

      // $400 / 3 = $133.33...
      expect(getTransactionMonthlyAmount(transaction)).toBeCloseTo(133.33, 2);
    });

    it('should keep $500 monthly transaction at $500/month', () => {
      const transaction: Transaction = {
        id: 't3',
        date: new Date(2024, 0, 1),
        description: 'Monthly service',
        amount: 500,
        frequency: 'monthly',
      };

      expect(getTransactionMonthlyAmount(transaction)).toBe(500);
    });

    it('should treat one-time transaction as full amount (divisor = 1)', () => {
      const transaction: Transaction = {
        id: 't4',
        date: new Date(2024, 0, 1),
        description: 'One-time purchase',
        amount: 250,
        frequency: 'one-time',
      };

      // One-time transactions are not spread, divisor = 1
      expect(getTransactionMonthlyAmount(transaction)).toBe(250);
    });

    it('should handle undefined frequency as divisor = 1', () => {
      const transaction: Transaction = {
        id: 't5',
        date: new Date(2024, 0, 1),
        description: 'No frequency specified',
        amount: 300,
        // frequency: undefined
      };

      expect(getTransactionMonthlyAmount(transaction)).toBe(300);
    });
  });

  describe('getExpenseMonthlyBudget', () => {
    it('should convert annual expense $12,000 to $1,000/month', () => {
      const expense = new OtherExpense(
        'e1', 'Annual Expense', 12000, 'Annually'
      );

      // $12,000 annual / 12 = $1,000/month
      expect(getExpenseMonthlyBudget(expense)).toBe(1000);
    });

    it('should convert weekly expense $100 to $433.33/month', () => {
      const expense = new OtherExpense(
        'e2', 'Weekly Expense', 100, 'Weekly'
      );

      // $100/week * 52 weeks / 12 months = $433.33...
      expect(getExpenseMonthlyBudget(expense)).toBeCloseTo(433.33, 2);
    });

    it('should keep monthly expense $500 at $500/month', () => {
      const expense = new OtherExpense(
        'e3', 'Monthly Expense', 500, 'Monthly'
      );

      expect(getExpenseMonthlyBudget(expense)).toBe(500);
    });
  });

  describe('getActiveExpenses', () => {
    it('should filter expenses by active date range', () => {
      // Expense A: starts Jan 2024, no end → active in June 2024
      const expenseA = new OtherExpense(
        'a', 'Expense A', 500, 'Monthly',
        new Date(2024, 0, 1)  // Jan 1, 2024
        // No end date
      );

      // Expense B: starts Jan 2024, ends March 2024 → NOT active in June 2024
      const expenseB = new OtherExpense(
        'b', 'Expense B', 300, 'Monthly',
        new Date(2024, 0, 1),   // Jan 1, 2024
        new Date(2024, 2, 31)   // March 31, 2024
      );

      // Expense C: starts July 2024 → NOT active in June 2024
      const expenseC = new OtherExpense(
        'c', 'Expense C', 200, 'Monthly',
        new Date(2024, 6, 1)   // July 1, 2024
      );

      const expenses = [expenseA, expenseB, expenseC];

      // June 2024 (month 6 in 1-indexed format)
      const activeInJune = getActiveExpenses(expenses, 6, 2024);

      expect(activeInJune).toHaveLength(1);
      expect(activeInJune[0].id).toBe('a');
    });

    it('should include expenses with no start date', () => {
      const expense = new OtherExpense(
        'nostart', 'No Start', 100, 'Monthly'
        // No start date - defaults to epoch
      );

      const active = getActiveExpenses([expense], 6, 2024);
      expect(active).toHaveLength(1);
    });

    it('should include expenses on start date month', () => {
      const expense = new OtherExpense(
        'same', 'Same Month Start', 100, 'Monthly',
        new Date(2024, 5, 1)  // June 1, 2024
      );

      // June 2024 check - expense starts June 1, should be active mid-June
      const active = getActiveExpenses([expense], 6, 2024);
      expect(active).toHaveLength(1);
    });

    it('should exclude expenses that end before target month', () => {
      const expense = new OtherExpense(
        'ended', 'Ended Early', 100, 'Monthly',
        new Date(2024, 0, 1),   // Jan 1, 2024
        new Date(2024, 4, 31)   // May 31, 2024
      );

      // June 2024 - expense ended May 31
      const active = getActiveExpenses([expense], 6, 2024);
      expect(active).toHaveLength(0);
    });
  });

  describe('calculateTotalMonthlyBudget', () => {
    it('should sum monthly amounts of active expenses', () => {
      // 3 active expenses at $500, $300, $200/month → $1,000
      const expense1 = new OtherExpense(
        'e1', 'Expense 1', 500, 'Monthly',
        new Date(2024, 0, 1)
      );
      const expense2 = new OtherExpense(
        'e2', 'Expense 2', 300, 'Monthly',
        new Date(2024, 0, 1)
      );
      const expense3 = new OtherExpense(
        'e3', 'Expense 3', 200, 'Monthly',
        new Date(2024, 0, 1)
      );

      const expenses = [expense1, expense2, expense3];

      // June 2024 - all should be active
      const total = calculateTotalMonthlyBudget(expenses, 6, 2024);
      expect(total).toBe(1000);
    });

    it('should only include active expenses in total', () => {
      const activeExpense = new OtherExpense(
        'active', 'Active', 500, 'Monthly',
        new Date(2024, 0, 1)
      );
      const inactiveExpense = new OtherExpense(
        'inactive', 'Inactive', 300, 'Monthly',
        new Date(2024, 0, 1),
        new Date(2024, 2, 31)  // Ends March 2024
      );

      const expenses = [activeExpense, inactiveExpense];

      // June 2024 - only activeExpense should count
      const total = calculateTotalMonthlyBudget(expenses, 6, 2024);
      expect(total).toBe(500);
    });

    it('should return 0 when no expenses are active', () => {
      const futureExpense = new OtherExpense(
        'future', 'Future', 500, 'Monthly',
        new Date(2025, 0, 1)  // Starts Jan 2025
      );

      // June 2024 - expense hasn't started yet
      const total = calculateTotalMonthlyBudget([futureExpense], 6, 2024);
      expect(total).toBe(0);
    });

    it('should handle mixed frequencies correctly', () => {
      const monthlyExpense = new OtherExpense(
        'm', 'Monthly', 600, 'Monthly',
        new Date(2024, 0, 1)
      );
      const weeklyExpense = new OtherExpense(
        'w', 'Weekly', 100, 'Weekly',
        new Date(2024, 0, 1)
      );
      const annualExpense = new OtherExpense(
        'a', 'Annual', 1200, 'Annually',
        new Date(2024, 0, 1)
      );

      const expenses = [monthlyExpense, weeklyExpense, annualExpense];

      // $600 (monthly) + $100*52/12 (weekly = 433.33) + $1200/12 (annual = 100) = $1133.33
      const total = calculateTotalMonthlyBudget(expenses, 6, 2024);
      expect(total).toBeCloseTo(1133.33, 2);
    });
  });

  describe('formatMonthYear', () => {
    it('should format month=1, year=2024 as "January 2024"', () => {
      expect(formatMonthYear(1, 2024)).toBe('January 2024');
    });

    it('should format month=12, year=2025 as "December 2025"', () => {
      expect(formatMonthYear(12, 2025)).toBe('December 2025');
    });

    it('should format month=6, year=2023 as "June 2023"', () => {
      expect(formatMonthYear(6, 2023)).toBe('June 2023');
    });

    it('should format month=3, year=2030 as "March 2030"', () => {
      expect(formatMonthYear(3, 2030)).toBe('March 2030');
    });
  });

  describe('calculateBudgetSummary', () => {
    // Helper to create a minimal snapshot
    const createSnapshot = (spending: Record<string, number>): MonthlySnapshot => ({
      id: 'snap-1',
      month: 6,
      year: 2024,
      spending,
      accountBalances: {},
      contributions: {},
      transactions: [],
      reconciled: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    it('should calculate summary when under budget', () => {
      // Budget = $3,000, actual spending = $2,500
      const expense1 = new OtherExpense('e1', 'Expense 1', 1500, 'Monthly', new Date(2024, 0, 1));
      const expense2 = new OtherExpense('e2', 'Expense 2', 1500, 'Monthly', new Date(2024, 0, 1));
      const expenses = [expense1, expense2];

      const snapshot = createSnapshot({
        e1: 1200,  // Spent $1,200 of $1,500 budget
        e2: 1300,  // Spent $1,300 of $1,500 budget
      });

      const result = calculateBudgetSummary(expenses, snapshot, 6, 2024);

      expect(result.totalBudget).toBe(3000);
      expect(result.totalSpent).toBe(2500);
      expect(result.remaining).toBe(500);
      expect(result.isUnderBudget).toBe(true);
      expect(result.percentSpent).toBeCloseTo(83.33, 2);
    });

    it('should calculate summary when over budget', () => {
      // Budget = $3,000, actual spending = $3,500
      const expense1 = new OtherExpense('e1', 'Expense 1', 1500, 'Monthly', new Date(2024, 0, 1));
      const expense2 = new OtherExpense('e2', 'Expense 2', 1500, 'Monthly', new Date(2024, 0, 1));
      const expenses = [expense1, expense2];

      const snapshot = createSnapshot({
        e1: 1800,  // Overspent
        e2: 1700,  // Overspent
      });

      const result = calculateBudgetSummary(expenses, snapshot, 6, 2024);

      expect(result.totalBudget).toBe(3000);
      expect(result.totalSpent).toBe(3500);
      expect(result.remaining).toBe(-500);
      expect(result.isUnderBudget).toBe(false);
      expect(result.percentSpent).toBeCloseTo(116.67, 2);
    });

    it('should handle undefined snapshot as zero spending', () => {
      const expense = new OtherExpense('e1', 'Expense 1', 1000, 'Monthly', new Date(2024, 0, 1));

      const result = calculateBudgetSummary([expense], undefined, 6, 2024);

      expect(result.totalBudget).toBe(1000);
      expect(result.totalSpent).toBe(0);
      expect(result.remaining).toBe(1000);
      expect(result.isUnderBudget).toBe(true);
      expect(result.percentSpent).toBe(0);
    });

    it('should handle zero budget gracefully', () => {
      // No active expenses → zero budget
      const futureExpense = new OtherExpense('e1', 'Future', 500, 'Monthly', new Date(2025, 0, 1));
      const snapshot = createSnapshot({ e1: 100 });

      const result = calculateBudgetSummary([futureExpense], snapshot, 6, 2024);

      expect(result.totalBudget).toBe(0);
      expect(result.totalSpent).toBe(100);
      expect(result.remaining).toBe(-100);
      expect(result.percentSpent).toBe(0); // Division by zero protection
    });
  });

  describe('calculateVariance', () => {
    it('should calculate variance within tolerance (on track)', () => {
      // actual = $950, expected = $1,000, tolerance = 5%
      // difference = -$50, percentVariance = -5%, onTrack = true (within 5%)
      const result = calculateVariance(950, 1000, 5);

      expect(result.actual).toBe(950);
      expect(result.expected).toBe(1000);
      expect(result.difference).toBe(-50);
      expect(result.percentVariance).toBe(-5);
      expect(result.isOnTrack).toBe(true);
    });

    it('should calculate variance outside tolerance (not on track)', () => {
      // actual = $800, expected = $1,000, tolerance = 5%
      // difference = -$200, percentVariance = -20%, onTrack = false
      const result = calculateVariance(800, 1000, 5);

      expect(result.actual).toBe(800);
      expect(result.expected).toBe(1000);
      expect(result.difference).toBe(-200);
      expect(result.percentVariance).toBe(-20);
      expect(result.isOnTrack).toBe(false);
    });

    it('should calculate positive variance (over expected)', () => {
      // actual = $1,100, expected = $1,000, default tolerance = 5%
      // difference = $100, percentVariance = 10%, onTrack = false
      const result = calculateVariance(1100, 1000);

      expect(result.actual).toBe(1100);
      expect(result.expected).toBe(1000);
      expect(result.difference).toBe(100);
      expect(result.percentVariance).toBe(10);
      expect(result.isOnTrack).toBe(false);
    });

    it('should handle zero expected value', () => {
      const result = calculateVariance(100, 0, 5);

      expect(result.difference).toBe(100);
      expect(result.percentVariance).toBe(0); // Division by zero protection
    });

    it('should handle exact match as on track', () => {
      const result = calculateVariance(1000, 1000, 5);

      expect(result.difference).toBe(0);
      expect(result.percentVariance).toBe(0);
      expect(result.isOnTrack).toBe(true);
    });
  });

  describe('getExpectedAccountBalance', () => {
    // Helper to create minimal simulation data
    const createSimulationYear = (year: number, accountId: string, amount: number): SimulationYear => ({
      year,
      incomes: [],
      expenses: [],
      accounts: [{ id: accountId, amount } as never], // Minimal account object
      cashflow: {
        totalIncome: 0, totalExpense: 0, livingExpenses: 0, discretionary: 0,
        investedUser: 0, investedMatch: 0, totalInvested: 0,
        bucketAllocations: 0, bucketDetail: {}, withdrawals: 0, withdrawalDetail: {},
      },
      taxDetails: {
        fed: 0, state: 0, fica: 0, preTax: 0, insurance: 0, postTax: 0,
        capitalGains: 0, withdrawalOrdinaryTax: 0, niit: 0,
      },
      logs: [],
    });

    it('should interpolate balance at mid-year (month 6)', () => {
      // Account at $100k (Jan 2024) and $112k (Jan 2025)
      // month=6, year=2024 → $100k + ($12k × 6/12) = $106k
      const simulation = [
        createSimulationYear(2024, 'acc1', 100000),
        createSimulationYear(2025, 'acc1', 112000),
      ];

      const result = getExpectedAccountBalance('acc1', 6, 2024, simulation);

      // $100,000 + ($112,000 - $100,000) * (6/12) = $100,000 + $6,000 = $106,000
      expect(result).toBe(106000);
    });

    it('should return year-start value at month 1 (1/12 through year)', () => {
      const simulation = [
        createSimulationYear(2024, 'acc1', 100000),
        createSimulationYear(2025, 'acc1', 112000),
      ];

      // Month 1 = 1/12 of the way through the year
      const result = getExpectedAccountBalance('acc1', 1, 2024, simulation);

      // $100,000 + $12,000 * (1/12) = $101,000
      expect(result).toBe(101000);
    });

    it('should return end-of-year value at month 12', () => {
      const simulation = [
        createSimulationYear(2024, 'acc1', 100000),
        createSimulationYear(2025, 'acc1', 112000),
      ];

      // Month 12 = 12/12 = full year
      const result = getExpectedAccountBalance('acc1', 12, 2024, simulation);

      // $100,000 + $12,000 * (12/12) = $112,000
      expect(result).toBe(112000);
    });

    it('should return null for empty simulation', () => {
      const result = getExpectedAccountBalance('acc1', 6, 2024, []);
      expect(result).toBeNull();
    });

    it('should return null for missing year', () => {
      const simulation = [
        createSimulationYear(2025, 'acc1', 100000),
      ];

      const result = getExpectedAccountBalance('acc1', 6, 2024, simulation);
      expect(result).toBeNull();
    });

    it('should return null for missing account', () => {
      const simulation = [
        createSimulationYear(2024, 'other-acc', 100000),
      ];

      const result = getExpectedAccountBalance('acc1', 6, 2024, simulation);
      expect(result).toBeNull();
    });

    it('should use start balance when no next year data', () => {
      // Only 2024 data, no 2025
      const simulation = [
        createSimulationYear(2024, 'acc1', 100000),
      ];

      const result = getExpectedAccountBalance('acc1', 6, 2024, simulation);

      // No growth data available, so stays at start balance
      // $100,000 + ($100,000 - $100,000) * 0.5 = $100,000
      expect(result).toBe(100000);
    });
  });

  describe('getExpectedMonthlyContribution', () => {
    const createSimulationYear = (year: number, accountId: string, amount: number): SimulationYear => ({
      year,
      incomes: [],
      expenses: [],
      accounts: [{ id: accountId, amount } as never],
      cashflow: {
        totalIncome: 0, totalExpense: 0, livingExpenses: 0, discretionary: 0,
        investedUser: 0, investedMatch: 0, totalInvested: 0,
        bucketAllocations: 0, bucketDetail: {}, withdrawals: 0, withdrawalDetail: {},
      },
      taxDetails: {
        fed: 0, state: 0, fica: 0, preTax: 0, insurance: 0, postTax: 0,
        capitalGains: 0, withdrawalOrdinaryTax: 0, niit: 0,
      },
      logs: [],
    });

    it('should calculate monthly contribution from annual change', () => {
      // Account goes from $100k (2023) to $112k (2024)
      // ($112k - $100k) / 12 = $1,000/month expected
      const simulation = [
        createSimulationYear(2023, 'acc1', 100000),
        createSimulationYear(2024, 'acc1', 112000),
      ];

      const result = getExpectedMonthlyContribution('acc1', 2024, simulation);

      expect(result).toBe(1000); // $12,000 / 12 = $1,000
    });

    it('should return null for empty simulation', () => {
      const result = getExpectedMonthlyContribution('acc1', 2024, []);
      expect(result).toBeNull();
    });

    it('should return null for missing year', () => {
      const simulation = [
        createSimulationYear(2023, 'acc1', 100000),
      ];

      const result = getExpectedMonthlyContribution('acc1', 2024, simulation);
      expect(result).toBeNull();
    });

    it('should return null for missing account', () => {
      const simulation = [
        createSimulationYear(2024, 'other-acc', 100000),
      ];

      const result = getExpectedMonthlyContribution('acc1', 2024, simulation);
      expect(result).toBeNull();
    });

    it('should handle no previous year data (assumes 0 starting balance)', () => {
      // Only 2024 data, no 2023 - treats previous as 0
      const simulation = [
        createSimulationYear(2024, 'acc1', 12000),
      ];

      const result = getExpectedMonthlyContribution('acc1', 2024, simulation);

      // ($12,000 - $0) / 12 = $1,000
      expect(result).toBe(1000);
    });

    it('should handle account decline (negative contribution)', () => {
      // Account goes from $120k to $108k (withdrawals or losses)
      const simulation = [
        createSimulationYear(2023, 'acc1', 120000),
        createSimulationYear(2024, 'acc1', 108000),
      ];

      const result = getExpectedMonthlyContribution('acc1', 2024, simulation);

      // ($108,000 - $120,000) / 12 = -$1,000
      expect(result).toBe(-1000);
    });
  });

  // ==========================================================================
  // Batch 17: Cash Flow & Categories
  // ==========================================================================

  describe('calculateNetCashFlow', () => {
    it('should calculate income, spending, and net cash flow', () => {
      // Income: $5,000 salary, $200 interest
      // Spending: $2,000 rent (expenseId: rent), $500 groceries (expenseId: food)
      // Reimbursement: $100 received against groceries
      const transactions: Transaction[] = [
        { id: 't1', date: new Date(2024, 0, 15), description: 'Salary', amount: 5000, incomeCategory: 'Salary' },
        { id: 't2', date: new Date(2024, 0, 16), description: 'Interest', amount: 200, incomeCategory: 'Interest' },
        { id: 't3', date: new Date(2024, 0, 1), description: 'Rent', amount: -2000, expenseId: 'rent' },
        { id: 't4', date: new Date(2024, 0, 10), description: 'Groceries', amount: -500, expenseId: 'food' },
        { id: 't5', date: new Date(2024, 0, 20), description: 'Grocery reimbursement', amount: 100, expenseId: 'food' },
      ];

      const result = calculateNetCashFlow(transactions);

      // income = $5,000 + $200 = $5,200
      // spending (net) = rent $2,000 + (groceries $500 - reimbursement $100) = $2,400
      // net = $5,200 - $2,400 = $2,800
      expect(result.income).toBe(5200);
      expect(result.spending).toBe(2400);
      expect(result.net).toBe(2800);
    });

    it('should exclude transfers from income calculation', () => {
      const transactions: Transaction[] = [
        { id: 't1', date: new Date(2024, 0, 1), description: 'Salary', amount: 1000, incomeCategory: 'Salary' },
        { id: 't2', date: new Date(2024, 0, 2), description: 'Transfer in', amount: 500, isTransfer: true },
      ];

      const result = calculateNetCashFlow(transactions);
      expect(result.income).toBe(1000); // Transfer excluded
    });
  });

  describe('getTotalIncome', () => {
    it('should sum positive amounts with income category, excluding transfers and reimbursements', () => {
      const transactions: Transaction[] = [
        { id: 't1', date: new Date(2024, 0, 1), description: 'Salary', amount: 5000, incomeCategory: 'Salary' },
        { id: 't2', date: new Date(2024, 0, 2), description: 'Interest', amount: 200, incomeCategory: 'Interest' },
        { id: 't3', date: new Date(2024, 0, 3), description: 'Transfer in', amount: 1000, isTransfer: true, incomeCategory: 'Other Income' },
        { id: 't4', date: new Date(2024, 0, 4), description: 'Reimbursement', amount: 100, isReimbursement: true, expenseId: 'food' },
      ];

      const result = getTotalIncome(transactions);

      // Only salary ($5,000) + interest ($200) = $5,200
      // Transfer and reimbursement excluded
      expect(result).toBe(5200);
    });

    it('should exclude account contributions (targetAccountId)', () => {
      const transactions: Transaction[] = [
        { id: 't1', date: new Date(2024, 0, 1), description: 'Salary', amount: 5000, incomeCategory: 'Salary' },
        { id: 't2', date: new Date(2024, 0, 2), description: '401k contribution', amount: 500, targetAccountId: 'acc-401k', incomeCategory: 'Salary' },
      ];

      const result = getTotalIncome(transactions);
      expect(result).toBe(5000); // Contribution excluded
    });
  });

  describe('getTotalNetSpending', () => {
    it('should calculate gross expenses minus reimbursements', () => {
      const transactions: Transaction[] = [
        { id: 't1', date: new Date(2024, 0, 1), description: 'Rent', amount: -2000, expenseId: 'rent' },
        { id: 't2', date: new Date(2024, 0, 10), description: 'Groceries', amount: -500, expenseId: 'food' },
        { id: 't3', date: new Date(2024, 0, 20), description: 'Grocery refund', amount: 100, expenseId: 'food' },
      ];

      const result = getTotalNetSpending(transactions);

      // Rent: $2,000 gross, $0 reimbursements = $2,000 net
      // Food: $500 gross, $100 reimbursements = $400 net
      // Total: $2,400
      expect(result).toBe(2400);
    });

    it('should exclude transfers from spending calculation', () => {
      const transactions: Transaction[] = [
        { id: 't1', date: new Date(2024, 0, 1), description: 'Rent', amount: -1000, expenseId: 'rent' },
        { id: 't2', date: new Date(2024, 0, 2), description: 'Transfer', amount: -500, isTransfer: true, expenseId: 'transfer' },
      ];

      const result = getTotalNetSpending(transactions);
      expect(result).toBe(1000); // Transfer excluded
    });
  });

  describe('getNetSpendingByCategory', () => {
    it('should group spending by expense category with gross, reimbursements, and net', () => {
      const transactions: Transaction[] = [
        { id: 't1', date: new Date(2024, 0, 1), description: 'Groceries 1', amount: -300, expenseId: 'food' },
        { id: 't2', date: new Date(2024, 0, 5), description: 'Groceries 2', amount: -200, expenseId: 'food' },
        { id: 't3', date: new Date(2024, 0, 10), description: 'Grocery refund', amount: 50, expenseId: 'food' },
        { id: 't4', date: new Date(2024, 0, 1), description: 'Rent', amount: -2000, expenseId: 'rent' },
      ];

      const result = getNetSpendingByCategory(transactions);

      // Groceries: gross = $500, reimbursements = $50, net = $450
      expect(result['food'].gross).toBe(500);
      expect(result['food'].reimbursements).toBe(50);
      expect(result['food'].net).toBe(450);

      // Rent: gross = $2,000, reimbursements = $0, net = $2,000
      expect(result['rent'].gross).toBe(2000);
      expect(result['rent'].reimbursements).toBe(0);
      expect(result['rent'].net).toBe(2000);
    });

    it('should exclude transfers and account contributions', () => {
      const transactions: Transaction[] = [
        { id: 't1', date: new Date(2024, 0, 1), description: 'Food', amount: -100, expenseId: 'food' },
        { id: 't2', date: new Date(2024, 0, 2), description: 'Transfer', amount: -500, isTransfer: true, expenseId: 'transfer' },
        { id: 't3', date: new Date(2024, 0, 3), description: '401k', amount: -200, targetAccountId: 'acc-401k', expenseId: 'savings' },
      ];

      const result = getNetSpendingByCategory(transactions);

      expect(result['food']).toBeDefined();
      expect(result['transfer']).toBeUndefined(); // Transfer excluded
      expect(result['savings']).toBeUndefined(); // Contribution excluded
    });

    it('should handle transactions without expenseId', () => {
      const transactions: Transaction[] = [
        { id: 't1', date: new Date(2024, 0, 1), description: 'Food', amount: -100, expenseId: 'food' },
        { id: 't2', date: new Date(2024, 0, 2), description: 'Unknown', amount: -50 }, // No expenseId
      ];

      const result = getNetSpendingByCategory(transactions);

      expect(Object.keys(result)).toHaveLength(1);
      expect(result['food']).toBeDefined();
    });
  });

  describe('getIncomeByCategory', () => {
    it('should group income by category', () => {
      const transactions: Transaction[] = [
        { id: 't1', date: new Date(2024, 0, 1), description: 'Salary', amount: 5000, incomeCategory: 'Salary' },
        { id: 't2', date: new Date(2024, 0, 2), description: 'Bonus', amount: 1000, incomeCategory: 'Salary' },
        { id: 't3', date: new Date(2024, 0, 3), description: 'Interest', amount: 200, incomeCategory: 'Interest' },
        { id: 't4', date: new Date(2024, 0, 4), description: 'Dividends', amount: 300, incomeCategory: 'Dividends' },
      ];

      const result = getIncomeByCategory(transactions);

      expect(result['Salary']).toBe(6000); // $5,000 + $1,000
      expect(result['Interest']).toBe(200);
      expect(result['Dividends']).toBe(300);
    });

    it('should exclude transfers and reimbursements', () => {
      const transactions: Transaction[] = [
        { id: 't1', date: new Date(2024, 0, 1), description: 'Salary', amount: 5000, incomeCategory: 'Salary' },
        { id: 't2', date: new Date(2024, 0, 2), description: 'Transfer', amount: 1000, isTransfer: true, incomeCategory: 'Other Income' },
        { id: 't3', date: new Date(2024, 0, 3), description: 'Reimbursement', amount: 100, isReimbursement: true, incomeCategory: 'Other Income' },
      ];

      const result = getIncomeByCategory(transactions);

      expect(result['Salary']).toBe(5000);
      expect(result['Other Income']).toBeUndefined(); // Transfer and reimbursement excluded
    });

    it('should ignore negative amounts', () => {
      const transactions: Transaction[] = [
        { id: 't1', date: new Date(2024, 0, 1), description: 'Salary', amount: 5000, incomeCategory: 'Salary' },
        { id: 't2', date: new Date(2024, 0, 2), description: 'Expense', amount: -100, incomeCategory: 'Salary' },
      ];

      const result = getIncomeByCategory(transactions);

      expect(result['Salary']).toBe(5000); // Negative amount ignored
    });
  });

  describe('getCategorySpending', () => {
    // Helper to create a minimal snapshot
    const createSnapshotWithSpending = (spending: Record<string, number>): MonthlySnapshot => ({
      id: 'snap-1',
      month: 6,
      year: 2024,
      spending,
      accountBalances: {},
      contributions: {},
      transactions: [],
      reconciled: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    it('should calculate budget vs actual per category', () => {
      // Groceries budgeted $600/month, actual $550
      const groceries = new OtherExpense('food', 'Groceries', 600, 'Monthly', new Date(2024, 0, 1));
      const rent = new OtherExpense('rent', 'Rent', 2000, 'Monthly', new Date(2024, 0, 1));

      const snapshot = createSnapshotWithSpending({
        food: 550,
        rent: 2100,
      });

      const result = getCategorySpending([groceries, rent], snapshot, 6, 2024);

      // Groceries: budget $600, actual $550, difference $50
      const groceriesResult = result.find(c => c.expenseId === 'food');
      expect(groceriesResult?.budget).toBe(600);
      expect(groceriesResult?.actual).toBe(550);
      expect(groceriesResult?.difference).toBe(50);
      expect(groceriesResult?.percentUsed).toBeCloseTo(91.67, 2);

      // Rent: budget $2,000, actual $2,100, difference -$100
      const rentResult = result.find(c => c.expenseId === 'rent');
      expect(rentResult?.budget).toBe(2000);
      expect(rentResult?.actual).toBe(2100);
      expect(rentResult?.difference).toBe(-100);
    });

    it('should return 0 actual when snapshot is undefined', () => {
      const groceries = new OtherExpense('food', 'Groceries', 600, 'Monthly', new Date(2024, 0, 1));

      const result = getCategorySpending([groceries], undefined, 6, 2024);

      expect(result[0].budget).toBe(600);
      expect(result[0].actual).toBe(0);
      expect(result[0].difference).toBe(600);
    });

    it('should only include active expenses', () => {
      const activeExpense = new OtherExpense('food', 'Food', 500, 'Monthly', new Date(2024, 0, 1));
      const inactiveExpense = new OtherExpense('old', 'Old', 300, 'Monthly', new Date(2023, 0, 1), new Date(2024, 2, 31));

      const snapshot = createSnapshotWithSpending({ food: 400, old: 200 });

      const result = getCategorySpending([activeExpense, inactiveExpense], snapshot, 6, 2024);

      expect(result).toHaveLength(1);
      expect(result[0].expenseId).toBe('food');
    });
  });

  // ==========================================================================
  // Batch 18: Account Balances & Reconciliation
  // ==========================================================================

  describe('getAccountBalances', () => {
    const createSimulationYear = (year: number, accountId: string, amount: number): SimulationYear => ({
      year,
      incomes: [],
      expenses: [],
      accounts: [{ id: accountId, amount, name: 'Test Account' } as never],
      cashflow: {
        totalIncome: 0, totalExpense: 0, livingExpenses: 0, discretionary: 0,
        investedUser: 0, investedMatch: 0, totalInvested: 0,
        bucketAllocations: 0, bucketDetail: {}, withdrawals: 0, withdrawalDetail: {},
      },
      taxDetails: {
        fed: 0, state: 0, fica: 0, preTax: 0, insurance: 0, postTax: 0,
        capitalGains: 0, withdrawalOrdinaryTax: 0, niit: 0,
      },
      logs: [],
    });

    const createSnapshotWithBalances = (
      balances: Record<string, number>,
      month: number = 6
    ): MonthlySnapshot => ({
      id: `snap-${month}`,
      month,
      year: 2024,
      spending: {},
      accountBalances: balances,
      contributions: {},
      transactions: [],
      reconciled: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    it('should compare expected vs actual for each account', () => {
      // Setup: checking account, simulation expects $15,000 at month 6
      // Previous month: $14,000
      // Current month actual: $14,500
      const checking = new SavedAccount('checking', 'Checking', 14000);
      const accounts = [checking];

      const simulation = [
        createSimulationYear(2024, 'checking', 12000), // Start of year
        createSimulationYear(2025, 'checking', 18000), // End of year
      ];
      // Expected at month 6: $12,000 + ($6,000 * 6/12) = $15,000

      const prevSnapshot = createSnapshotWithBalances({ checking: 14000 }, 5);
      const currentSnapshot = createSnapshotWithBalances({ checking: 14500 }, 6);

      const result = getAccountBalances(accounts, currentSnapshot, prevSnapshot, 6, 2024, simulation);

      expect(result).toHaveLength(1);
      expect(result[0].accountId).toBe('checking');
      expect(result[0].previousBalance).toBe(14000);
      expect(result[0].expectedBalance).toBe(15000);
      expect(result[0].actualBalance).toBe(14500);
      expect(result[0].difference).toBe(-500); // actual - expected
    });

    it('should handle missing snapshots', () => {
      const checking = new SavedAccount('checking', 'Checking', 10000);

      const simulation = [
        createSimulationYear(2024, 'checking', 10000),
        createSimulationYear(2025, 'checking', 12000),
      ];

      const result = getAccountBalances([checking], undefined, undefined, 6, 2024, simulation);

      expect(result[0].previousBalance).toBeNull();
      expect(result[0].actualBalance).toBeNull();
      expect(result[0].expectedBalance).toBe(11000); // Interpolated
      expect(result[0].difference).toBeNull(); // Can't calculate without actual
    });

    it('should handle missing simulation data', () => {
      const checking = new SavedAccount('checking', 'Checking', 10000);
      const currentSnapshot = createSnapshotWithBalances({ checking: 10500 });

      const result = getAccountBalances([checking], currentSnapshot, undefined, 6, 2024, []);

      expect(result[0].actualBalance).toBe(10500);
      expect(result[0].expectedBalance).toBeNull();
      expect(result[0].difference).toBeNull();
    });

    it('should identify market-driven accounts', () => {
      // SavedAccount is not market-driven
      const savings = new SavedAccount('savings', 'Savings', 10000);

      const result = getAccountBalances([savings], undefined, undefined, 6, 2024, []);

      expect(result[0].isMarketDriven).toBe(false);
    });
  });

  describe('calculateCategoryTotalsFromTransactions', () => {
    it('should calculate gross and reimbursements by category', () => {
      const transactions: Transaction[] = [
        // Groceries: $200, $150 expenses, $50 reimbursement
        { id: 't1', date: new Date(2024, 0, 1), description: 'Groceries 1', amount: -200, expenseId: 'food' },
        { id: 't2', date: new Date(2024, 0, 5), description: 'Groceries 2', amount: -150, expenseId: 'food' },
        { id: 't3', date: new Date(2024, 0, 10), description: 'Grocery refund', amount: 50, expenseId: 'food' },
        // Utilities: $100, $80 expenses
        { id: 't4', date: new Date(2024, 0, 1), description: 'Electric', amount: -100, expenseId: 'utilities' },
        { id: 't5', date: new Date(2024, 0, 15), description: 'Gas', amount: -80, expenseId: 'utilities' },
      ];

      const result = calculateCategoryTotalsFromTransactions(transactions);

      // Groceries: gross = $350, reimbursements = $50
      expect(result['food'].gross).toBe(350);
      expect(result['food'].reimbursements).toBe(50);

      // Utilities: gross = $180, reimbursements = $0
      expect(result['utilities'].gross).toBe(180);
      expect(result['utilities'].reimbursements).toBe(0);
    });

    it('should exclude transfers', () => {
      const transactions: Transaction[] = [
        { id: 't1', date: new Date(2024, 0, 1), description: 'Food', amount: -100, expenseId: 'food' },
        { id: 't2', date: new Date(2024, 0, 2), description: 'Transfer', amount: -500, isTransfer: true, expenseId: 'transfer' },
      ];

      const result = calculateCategoryTotalsFromTransactions(transactions);

      expect(result['food']).toBeDefined();
      expect(result['transfer']).toBeUndefined();
    });

    it('should exclude account contributions (targetAccountId)', () => {
      const transactions: Transaction[] = [
        { id: 't1', date: new Date(2024, 0, 1), description: 'Food', amount: -100, expenseId: 'food' },
        { id: 't2', date: new Date(2024, 0, 2), description: '401k', amount: -500, targetAccountId: 'acc-401k', expenseId: 'savings' },
      ];

      const result = calculateCategoryTotalsFromTransactions(transactions);

      expect(result['food']).toBeDefined();
      expect(result['savings']).toBeUndefined();
    });

    it('should ignore transactions without expenseId', () => {
      const transactions: Transaction[] = [
        { id: 't1', date: new Date(2024, 0, 1), description: 'Food', amount: -100, expenseId: 'food' },
        { id: 't2', date: new Date(2024, 0, 2), description: 'Unknown', amount: -50 }, // No expenseId
      ];

      const result = calculateCategoryTotalsFromTransactions(transactions);

      expect(Object.keys(result)).toHaveLength(1);
      expect(result['food'].gross).toBe(100);
    });

    it('should handle empty transaction list', () => {
      const result = calculateCategoryTotalsFromTransactions([]);
      expect(Object.keys(result)).toHaveLength(0);
    });

    it('should not treat true income with a stale expenseId as a reimbursement', () => {
      // Regression: an income transaction that also carried an expenseId (e.g. from a
      // category rule matching its description) was counted as a reimbursement, driving
      // the category's net spending negative.
      const transactions: Transaction[] = [
        { id: 't1', date: new Date(2024, 1, 3), description: 'Misc purchase', amount: -1000, expenseId: 'misc' },
        { id: 't2', date: new Date(2024, 1, 15), description: 'Paycheck', amount: 4907, expenseId: 'misc', incomeCategory: 'Salary' },
      ];

      const result = calculateCategoryTotalsFromTransactions(transactions);

      // Only the real expense counts; the income is ignored, not a reimbursement.
      expect(result['misc'].gross).toBe(1000);
      expect(result['misc'].reimbursements).toBe(0);
    });

    it('should still count genuine reimbursements (positive, no incomeCategory)', () => {
      const transactions: Transaction[] = [
        { id: 't1', date: new Date(2024, 1, 3), description: 'Misc purchase', amount: -1000, expenseId: 'misc' },
        { id: 't2', date: new Date(2024, 1, 10), description: 'Refund', amount: 300, expenseId: 'misc', isReimbursement: true },
      ];

      const result = calculateCategoryTotalsFromTransactions(transactions);

      expect(result['misc'].gross).toBe(1000);
      expect(result['misc'].reimbursements).toBe(300);
    });
  });
});
