import { describe, it, expect } from 'vitest';
import {
    SavedAccount,
    InvestedAccount,
    PropertyAccount,
    DebtAccount,
    DeficitDebtAccount,
    type AnyAccount,
} from '../../components/Objects/Accounts/models';
import { getAccountTotals as canonicalGetAccountTotals } from '../../components/Objects/Accounts/accountTotals';
import { getAccountTotals as futureUtilsGetAccountTotals } from '../../tabs/Future/tabs/FutureUtils';

/**
 * Characterization tests pinning the single-sourced net-worth definition (#195).
 *
 * ExcelExportService previously carried its own `accountNetWorthTotals` copy of the
 * canonical getAccountTotals — a mortgage-liability mismatch waiting to be reborn as
 * cross-file drift. These tests build a realistic mixed set of REAL account-class
 * instances and lock in that:
 *   1. the canonical function counts a financed home's mortgage as a liability,
 *   2. DeficitDebtAccount is a liability via the DebtAccount branch (the removed
 *      redundant `|| DeficitDebtAccount` branch was behavior-preserving), and
 *   3. FutureUtils re-exports the exact same function (no second copy anywhere).
 */
describe('getAccountTotals single-source (accountTotals module)', () => {
    // Mixed set: cash, taxable invested, financed property w/ mortgage, plain debt,
    // and a system deficit-debt account (extends DebtAccount).
    const buildMixedAccounts = (): AnyAccount[] => [
        new SavedAccount('s1', 'Checking', 15_000),
        new InvestedAccount('i1', 'Brokerage', 200_000, 0, 0, 0, 'Brokerage', true, 0),
        new PropertyAccount('p1', 'House', 500_000, 'Financed', 300_000, 350_000, 'd1', 4),
        new DebtAccount('d1', 'Mortgage carrier', 0, 'p1', 4),
        new DebtAccount('d2', 'Student Loan', 40_000, 'l2', 5),
        new DeficitDebtAccount('df1', 'Deficit', 12_000),
    ];

    it('counts assets, a financed mortgage, plain debt, and deficit debt as the app does', () => {
        const totals = canonicalGetAccountTotals(buildMixedAccounts());

        // Assets: cash 15k + brokerage 200k + house 500k (mortgage carrier is a
        // DebtAccount with amount 0, so it adds nothing).
        expect(totals.assets).toBe(715_000);
        // Liabilities: house loanAmount 300k + student loan 40k + deficit 12k.
        expect(totals.liabilities).toBe(352_000);
        expect(totals.netWorth).toBe(363_000);
    });

    it('treats DeficitDebtAccount as a liability via the DebtAccount branch', () => {
        // A lone DeficitDebtAccount must land entirely in liabilities — proving the
        // removed `instanceof DeficitDebtAccount` branch was redundant with the
        // `instanceof DebtAccount` branch it extends.
        const totals = canonicalGetAccountTotals([new DeficitDebtAccount('df1', 'Deficit', 7_500)]);
        expect(totals.assets).toBe(0);
        expect(totals.liabilities).toBe(7_500);
        expect(totals.netWorth).toBe(-7_500);
    });

    it('is the very same function FutureUtils re-exports (no divergent copy)', () => {
        // Referential identity is the strongest possible guarantee the definition
        // is single-sourced: the Excel export, projection history, and every in-app
        // net-worth figure resolve to this one implementation.
        expect(futureUtilsGetAccountTotals).toBe(canonicalGetAccountTotals);

        // And it agrees field-by-field on the realistic fixture (belt-and-suspenders
        // in case the re-export is ever replaced with a wrapper).
        const accounts = buildMixedAccounts();
        expect(futureUtilsGetAccountTotals(accounts)).toEqual(canonicalGetAccountTotals(accounts));
    });
});
