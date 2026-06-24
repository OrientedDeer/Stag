import { describe, it, expect } from 'vitest';
import { computeOverviewBuckets } from '../../../tabs/Future/tabs/OverviewTab';
import { calculateNetWorth, getAccountTotals } from '../../../tabs/Future/tabs/FutureUtils';
import {
    InvestedAccount,
    SavedAccount,
    PropertyAccount,
    DebtAccount,
    ESPPAccount,
    RSUAccount,
    AnyAccount,
} from '../../../components/Objects/Accounts/models';
import { MortgageExpense, AnyExpense } from '../../../components/Objects/Expense/models';

/**
 * Regression: the Overview net-worth chart/tooltip used to subtract mortgage
 * debt from MortgageExpense.loan_balance, while getAccountTotals /
 * calculateNetWorth (the Assets sub-tab, the DataTab Net Worth column, and the
 * projection-history snapshots) subtract PropertyAccount.loanAmount and ignore
 * expenses. The two Net-Worth views could disagree by a full mortgage balance:
 *   - an UNLINKED MortgageExpense (no PropertyAccount carrying the loan) was
 *     subtracted on the chart but not by getAccountTotals -> chart understated,
 *   - a PropertyAccount.loanAmount with no linked expense was subtracted by
 *     getAccountTotals but not by the chart -> chart overstated.
 *
 * computeOverviewBuckets now derives its Debt bucket from getAccountTotals, so
 * the bucket sum (Invested + Saved + Property + Debt) equals calculateNetWorth
 * for every account configuration and the two views cannot disagree.
 */
describe('OverviewTab net worth matches getAccountTotals on mortgage debt', () => {
    const bucketSum = (accounts: AnyAccount[], expenses: AnyExpense[]): number => {
        const b = computeOverviewBuckets(accounts, expenses);
        return b.Invested + b.Saved + b.Property + b.Debt;
    };

    // A standalone (unlinked) MortgageExpense whose id is NOT referenced by any
    // PropertyAccount.linkedAccountId — the imported/unlinked shape the finding flags.
    const makeMortgage = (id: string, loanBalance: number, valuation: number): MortgageExpense =>
        new MortgageExpense(
            id, 'Home Loan', 'Monthly',
            valuation, loanBalance, loanBalance,
            3, 30, 1.2, 0, 1, 100, 0.3, 0, 50,
            'Yes', 0, '', new Date(),
        );

    it('linked property: debt comes from PropertyAccount.loanAmount, agrees with calculateNetWorth', () => {
        // Financed house: value 300k, loan 250k -> net equity 50k. The linked
        // mortgage expense carries a matching loan_balance the engine keeps in sync.
        const accounts: AnyAccount[] = [
            new InvestedAccount('inv', 'Brokerage', 400_000),
            new PropertyAccount('prop', 'House', 300_000, 'Financed', 250_000, 250_000, 'mort'),
        ];
        const expenses: AnyExpense[] = [makeMortgage('mort', 250_000, 300_000)];

        const buckets = computeOverviewBuckets(accounts, expenses);
        // Property bucket is the gross value; the loan lands in Debt via loanAmount.
        expect(buckets.Property).toBe(300_000);
        expect(buckets.Debt).toBe(-250_000);
        // 400k + 300k - 250k = 450k
        expect(bucketSum(accounts, expenses)).toBe(450_000);
        expect(bucketSum(accounts, expenses)).toBe(calculateNetWorth(accounts));
    });

    it('UNLINKED mortgage: chart no longer double-subtracts a loan the accounts do not carry', () => {
        // Owned-outright PropertyAccount (loanAmount 0) PLUS a standalone mortgage
        // expense (e.g. imported state). getAccountTotals ignores the expense, so
        // the chart must too, or it understates net worth by the loan balance.
        const accounts: AnyAccount[] = [
            new SavedAccount('sav', 'Cash', 100_000),
            new PropertyAccount('prop', 'House', 300_000, 'Owned', 0, 0, ''),
        ];
        const expenses: AnyExpense[] = [makeMortgage('orphan-mort', 200_000, 300_000)];

        // Before the fix this returned -300_000 (= -(100k + 300k - 200k)); now it
        // matches getAccountTotals, which never looks at the expense.
        expect(bucketSum(accounts, expenses)).toBe(400_000);
        expect(bucketSum(accounts, expenses)).toBe(calculateNetWorth(accounts));
        // Net worth must be invariant to the orphan mortgage expense.
        expect(bucketSum(accounts, expenses)).toBe(bucketSum(accounts, []));
    });

    it('mirror case: PropertyAccount.loanAmount with no linked expense is subtracted, agrees with calculateNetWorth', () => {
        // Financed house carrying its own loanAmount but no MortgageExpense at all.
        // The old chart ignored loanAmount and overstated net worth by the loan.
        const accounts: AnyAccount[] = [
            new InvestedAccount('inv', 'Brokerage', 500_000),
            new PropertyAccount('prop', 'House', 400_000, 'Financed', 150_000, 150_000, ''),
        ];

        const buckets = computeOverviewBuckets(accounts, []);
        expect(buckets.Debt).toBe(-150_000);
        // 500k + 400k - 150k = 750k
        expect(bucketSum(accounts, [])).toBe(750_000);
        expect(bucketSum(accounts, [])).toBe(calculateNetWorth(accounts));
    });

    it('ESPP/RSU portfolio with debt + property still folds into Invested and agrees (no #wave-1 regression)', () => {
        const accounts: AnyAccount[] = [
            new InvestedAccount('inv', 'Brokerage', 400_000),
            new SavedAccount('sav', 'Cash', 50_000),
            new PropertyAccount('prop', 'House', 300_000, 'Financed', 120_000, 120_000, ''),
            new ESPPAccount('espp', 'Company ESPP', 75_000),
            new RSUAccount('rsu', 'Company RSU', 200_000),
            new DebtAccount('debt', 'Credit Card', 10_000, ''),
        ];

        const buckets = computeOverviewBuckets(accounts, []);
        // ESPP + RSU fold into Invested: 400k + 75k + 200k = 675k.
        expect(buckets.Invested).toBe(675_000);
        // Debt = credit card 10k + property loan 120k = 130k.
        expect(buckets.Debt).toBe(-130_000);
        // 675k + 50k + 300k - 130k = 895k
        expect(bucketSum(accounts, [])).toBe(895_000);
        expect(bucketSum(accounts, [])).toBe(calculateNetWorth(accounts));
    });

    it('bucket Debt equals -getAccountTotals.liabilities across mixed account shapes', () => {
        const accounts: AnyAccount[] = [
            new PropertyAccount('p1', 'House A', 500_000, 'Financed', 300_000, 300_000, 'm1'),
            new PropertyAccount('p2', 'House B', 250_000, 'Owned', 0, 0, ''),
            new DebtAccount('d1', 'Auto Loan', 25_000, ''),
        ];
        const buckets = computeOverviewBuckets(accounts, [makeMortgage('m1', 300_000, 500_000)]);
        const { liabilities } = getAccountTotals(accounts);
        expect(buckets.Debt).toBe(-liabilities);
    });
});
