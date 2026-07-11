import { describe, it, expect } from 'vitest';
import {
  getAccountTotals,
  calculateNetWorth,
  getNetWorthBreakdown,
  computeAfterTaxNetWorth,
  formatCurrency,
  formatCompactCurrency,
  findFinancialIndependenceYear,
} from '../../../../tabs/Future/tabs/FutureUtils';
import { SavedAccount, InvestedAccount, DebtAccount, ESPPAccount, RSUAccount, type AnyAccount, type ESPPLot, type RSULot } from '../../../../components/Objects/Accounts/models';
import { type SimulationYear } from '../../../../components/Objects/Assumptions/SimulationEngine';
import { type AssumptionsState, defaultAssumptions } from '../../../../components/Objects/Assumptions/AssumptionsContext';

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

  describe('getNetWorthBreakdown (#143)', () => {
    // InvestedAccount positional args:
    // (id, name, amount, employerBalance, tenureYears, expenseRatio, taxType,
    //  isContributionEligible, vestedPerYear, costBasis, ...)
    // employerBalance 40k, tenure 1yr, 20%/yr graded => 20% vested => 80% unvested = 32k.
    it('splits net worth into gross / unvested / vested with an unvested employer match', () => {
      const accounts: AnyAccount[] = [
        new SavedAccount('s1', 'Cash', 10000),
        // amount 100k; of which 40k is employer balance, 20% vested at 1yr => 32k unvested.
        new InvestedAccount('i1', '401k', 100000, 40000, 1, 0.1, 'Traditional 401k', true, 0.2),
        new DebtAccount('d1', 'Student Loan', 20000, 'l1', 5),
      ];

      const { assets, liabilities, gross, unvested, vested } = getNetWorthBreakdown(accounts);

      // Gross is exactly getAccountTotals().netWorth (the engine/optimizer definition).
      const totals = getAccountTotals(accounts);
      expect(gross).toBe(totals.netWorth);
      expect(assets).toBe(110000);          // 10k cash + 100k 401k (full balance)
      expect(liabilities).toBe(20000);      // student loan
      expect(gross).toBe(90000);            // 110k - 20k

      // Unvested = Σ InvestedAccount.nonVestedAmount = 40k * (1 - 0.2) = 32k.
      expect(unvested).toBe(32000);

      // Vested = gross - unvested (the core invariant the display surfaces lead with).
      expect(vested).toBe(gross - unvested);
      expect(vested).toBe(58000);           // 90k - 32k
    });

    it('vested equals gross when there is no unvested match (unvested = 0)', () => {
      const accounts: AnyAccount[] = [
        new SavedAccount('s1', 'Savings', 10000),
        new InvestedAccount('i1', 'Brokerage', 50000, 0, 0, 0, 'Brokerage', true, 0),
        new DebtAccount('d1', 'Credit Card', 5000, 'l2', 18),
      ];

      const { gross, unvested, vested } = getNetWorthBreakdown(accounts);
      expect(gross).toBe(getAccountTotals(accounts).netWorth); // 55k
      expect(unvested).toBe(0);
      expect(vested).toBe(gross);
      expect(vested).toBe(55000);
    });

    it('fully-vested employer balance contributes zero unvested', () => {
      const accounts: AnyAccount[] = [
        // 5 years at 20%/yr => 100% vested => nonVested 0 even though employerBalance is 30k.
        new InvestedAccount('i1', '401k', 100000, 30000, 5, 0.1, 'Traditional 401k', true, 0.2),
      ];
      const { gross, unvested, vested } = getNetWorthBreakdown(accounts);
      expect(unvested).toBe(0);
      expect(vested).toBe(gross);
      expect(vested).toBe(100000);
    });
  });

  describe('computeAfterTaxNetWorth', () => {
    // InvestedAccount positional args:
    // (id, name, amount, employerBalance, tenureYears, expenseRatio, taxType,
    //  isContributionEligible, vestedPerYear, costBasis, ...)
    it('discounts the FULL Traditional balance (contributions + growth) by the ordinary rate', () => {
      const accounts: AnyAccount[] = [
        new SavedAccount('s1', 'Cash', 10000),
        new InvestedAccount('t1', '401k', 100000, 0, 0, 0, 'Traditional 401k', true, 0),
        new InvestedAccount('r1', 'Roth', 100000, 0, 0, 0, 'Roth IRA', true, 0),
      ];
      const r = computeAfterTaxNetWorth(accounts, 0.20);

      expect(r.netWorth).toBe(210000);
      expect(r.deferredOrdinaryTax).toBeCloseTo(20000); // 100k * 20%, whole balance
      expect(r.deferredCapGainsTax).toBe(0);            // Roth + cash owe nothing
      expect(r.deferredTax).toBeCloseTo(20000);
      expect(r.afterTaxNetWorth).toBeCloseTo(190000);
    });

    it('taxes only brokerage unrealized GAINS, at the LTCG rate (basis already taxed)', () => {
      const accounts: AnyAccount[] = [
        // amount 100k, costBasis 60k => 40k unrealized gains
        new InvestedAccount('b1', 'Brokerage', 100000, 0, 0, 0, 'Brokerage', true, 0, 60000),
      ];
      const r = computeAfterTaxNetWorth(accounts, 0.20); // default 15% LTCG

      expect(r.deferredOrdinaryTax).toBe(0);
      expect(r.deferredCapGainsTax).toBeCloseTo(6000);  // 40k * 15%
      expect(r.afterTaxNetWorth).toBeCloseTo(94000);
    });

    it('treats Roth, HSA, cash, and property as fully owned (no deferred tax)', () => {
      const accounts: AnyAccount[] = [
        new InvestedAccount('h1', 'HSA', 50000, 0, 0, 0, 'HSA', true, 0),
        new InvestedAccount('r1', 'Roth 401k', 80000, 0, 0, 0, 'Roth 401k', true, 0),
        new SavedAccount('s1', 'Cash', 20000),
      ];
      const r = computeAfterTaxNetWorth(accounts, 0.25);

      expect(r.deferredTax).toBe(0);
      expect(r.afterTaxNetWorth).toBe(150000);
    });

    it('honors a custom LTCG rate', () => {
      const accounts: AnyAccount[] = [
        new InvestedAccount('b1', 'Brokerage', 100000, 0, 0, 0, 'Brokerage', true, 0, 50000),
      ];
      const r = computeAfterTaxNetWorth(accounts, 0.20, 0.20); // 50k gains * 20%
      expect(r.deferredCapGainsTax).toBeCloseTo(10000);
    });

    it('taxes ESPP and RSU unrealized gains at the LTCG rate (not ordinary)', () => {
      const rsuLot: RSULot = {
        id: 'l1', grantDate: new Date(2020, 0, 1), vestDate: new Date(2021, 0, 1),
        fmvAtVest: 60, shares: 1000, costBasis: 60000,
      };
      const esppLot: ESPPLot = {
        id: 'e1', grantDate: new Date(2020, 0, 1), purchaseDate: new Date(2020, 6, 1),
        fmvAtGrant: 50, fmvAtPurchase: 60, purchasePrice: 51, shares: 1000,
        totalCost: 51000, discountAmount: 9,
      };
      const accounts: AnyAccount[] = [
        new RSUAccount('rsu1', 'RSU', 100000, [rsuLot]),    // 40k unrealized gains
        new ESPPAccount('espp1', 'ESPP', 80000, [esppLot]), // 29k unrealized gains
      ];
      // ordinaryRate is irrelevant here — there's no tax-deferred balance.
      const r = computeAfterTaxNetWorth(accounts, 0.22);

      expect(r.netWorth).toBe(180000);
      expect(r.deferredOrdinaryTax).toBe(0);
      expect(r.deferredCapGainsTax).toBeCloseTo((40000 + 29000) * 0.15); // 10,350
      expect(r.afterTaxNetWorth).toBeCloseTo(180000 - 10350);
    });

    describe('situation-based tradDeferredTax callback (#94)', () => {
      // The callback returns the after-tax VALUE KEPT on the aggregate Traditional balance;
      // computeAfterTaxNetWorth derives the deferred tax as `balance − value`. This guards the
      // inversion trap (returning the tax instead of the value kept would tax at 1 − rate).
      it('computes deferred ordinary tax on the AGGREGATE balance, ignoring the flat per-account rate', () => {
        const accounts: AnyAccount[] = [
          new InvestedAccount('t1', '401k', 100000, 0, 0, 0, 'Traditional 401k', true, 0),
          new InvestedAccount('t2', 'IRA', 100000, 0, 0, 0, 'Traditional IRA', true, 0),
        ];
        // Bequeath-style flat heir valuation: value kept = b * (1 − 0.32).
        const r = computeAfterTaxNetWorth(accounts, 0.99 /* must be ignored */, undefined, b => b * (1 - 0.32));

        expect(r.deferredOrdinaryTax).toBeCloseTo(200000 * 0.32); // 64,000 on the $200k aggregate
        expect(r.afterTaxNetWorth).toBeCloseTo(200000 - 64000);
      });

      it('clamps the deferred ordinary tax at 0 when the valuation exceeds face (rounding undershoot)', () => {
        const accounts: AnyAccount[] = [
          new InvestedAccount('t1', '401k', 100000, 0, 0, 0, 'Traditional 401k', true, 0),
        ];
        const r = computeAfterTaxNetWorth(accounts, 0.20, undefined, b => b * 1.01);
        expect(r.deferredOrdinaryTax).toBe(0);
        expect(r.afterTaxNetWorth).toBe(100000);
      });

      it('still taxes brokerage gains at LTCG while the callback governs Traditional', () => {
        const accounts: AnyAccount[] = [
          new InvestedAccount('t1', '401k', 100000, 0, 0, 0, 'Traditional 401k', true, 0),
          new InvestedAccount('b1', 'Brokerage', 100000, 0, 0, 0, 'Brokerage', true, 0, 60000), // 40k gains
        ];
        const r = computeAfterTaxNetWorth(accounts, 0.20, undefined, b => b * (1 - 0.10));
        expect(r.deferredOrdinaryTax).toBeCloseTo(100000 * 0.10); // 10,000
        expect(r.deferredCapGainsTax).toBeCloseTo(40000 * 0.15);  // 6,000
        expect(r.afterTaxNetWorth).toBeCloseTo(200000 - 10000 - 6000);
      });
    });
  });

  describe('formatCurrency', () => {
    it('should format positive numbers correctly', () => {
      expect(formatCurrency(1234.56)).toBe('$1,235');
    });

    it('should format zero correctly', () => {
      expect(formatCurrency(0)).toBe('$0');
    });

    it('should format negative numbers correctly', () => {
      expect(formatCurrency(-500)).toBe('-$500');
    });

    it('should round numbers with more than two decimal places', () => {
      expect(formatCurrency(99.987)).toBe('$100');
    });

    it('should handle large numbers with commas', () => {
        expect(formatCurrency(1000000)).toBe('$1,000,000');
    });
  });

  describe('formatCompactCurrency', () => {
    it('should format small numbers with full precision', () => {
      expect(formatCompactCurrency(1234.56)).toBe('$1,235');
      expect(formatCompactCurrency(99999.99)).toBe('$100,000');
    });

    it('should format numbers >= 100K with K suffix', () => {
      expect(formatCompactCurrency(100000)).toBe('$100.0K');
      expect(formatCompactCurrency(123456)).toBe('$123.5K');
      expect(formatCompactCurrency(999999)).toBe('$1000.0K');
    });

    it('should format numbers >= 1M with M suffix', () => {
      expect(formatCompactCurrency(1000000)).toBe('$1.00M');
      expect(formatCompactCurrency(1234567)).toBe('$1.23M');
      expect(formatCompactCurrency(999999999)).toBe('$1000.00M');
    });

    it('should format numbers >= 1B with B suffix', () => {
      expect(formatCompactCurrency(1000000000)).toBe('$1.00B');
      expect(formatCompactCurrency(1234567890)).toBe('$1.23B');
    });

    it('should handle negative numbers', () => {
      expect(formatCompactCurrency(-1234.56)).toBe('-$1,235');
      expect(formatCompactCurrency(-1234567)).toBe('-$1.23M');
      expect(formatCompactCurrency(-1000000000)).toBe('-$1.00B');
    });

    it('should handle zero', () => {
      expect(formatCompactCurrency(0)).toBe('$0');
    });

    it('should return full format when forceExact is true', () => {
      expect(formatCompactCurrency(1000000, { forceExact: true })).toBe('$1,000,000');
      expect(formatCompactCurrency(1234567890, { forceExact: true })).toBe('$1,234,567,890');
      expect(formatCompactCurrency(123456, { forceExact: true })).toBe('$123,456');
    });

    it('should return compact format when forceExact is false', () => {
      expect(formatCompactCurrency(1000000, { forceExact: false })).toBe('$1.00M');
      expect(formatCompactCurrency(1234567890, { forceExact: false })).toBe('$1.23B');
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
        livingExpenses: totalExpense,
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
