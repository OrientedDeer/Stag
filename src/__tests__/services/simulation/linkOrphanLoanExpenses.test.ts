import { describe, it, expect } from 'vitest';
import { linkOrphanLoanExpenses } from '../../../services/simulation/linkOrphanLoanExpenses';
import { calculateNetWorth, calculateTotalDebt } from '../../../services/simulation/MilestoneEvaluator';
import {
    AnyAccount,
    PropertyAccount,
    DebtAccount,
    SavedAccount,
} from '../../../components/Objects/Accounts/models';
import {
    AnyExpense,
    MortgageExpense,
    LoanExpense,
    OtherExpense,
} from '../../../components/Objects/Expense/models';

function makeMortgage(id: string, linkedAccountId: string, loanBalance = 300000): MortgageExpense {
    return new MortgageExpense(
        id, 'Home', 'Monthly',
        500000, loanBalance, 400000, 4, 30,
        1.2, 0, 0.5, 200, 0.3, 0, 0,
        'Itemized', 0, linkedAccountId,
        new Date(),
    );
}

function makeLoan(id: string, linkedAccountId: string, amount = 10000): LoanExpense {
    return new LoanExpense(
        id, 'Personal Loan', amount, 'Monthly',
        8, 'Compounding', 500, 'No', 0, linkedAccountId,
    );
}

describe('linkOrphanLoanExpenses (#124 orphan guard)', () => {
    it('leaves a properly linked mortgage untouched (no new account, no notices)', () => {
        const accounts: AnyAccount[] = [
            new PropertyAccount('acc-house', 'Home', 500000, 'Financed', 300000, 400000, 'exs-house'),
        ];
        const expenses: AnyExpense[] = [makeMortgage('exs-house', 'acc-house')];

        const result = linkOrphanLoanExpenses(accounts, expenses);

        expect(result.accounts).toBe(accounts); // same array reference, untouched
        expect(result.notices).toEqual([]);
        expect(result.accounts).toHaveLength(1);
    });

    it('re-links a mortgage whose linkedAccountId is empty, creating a paired PropertyAccount', () => {
        const accounts: AnyAccount[] = [];
        const mortgage = makeMortgage('exs-orphan', '', 300000);
        const expenses: AnyExpense[] = [mortgage];

        const result = linkOrphanLoanExpenses(accounts, expenses);

        expect(result.notices).toHaveLength(1);
        expect(result.accounts).toHaveLength(1);

        const created = result.accounts[0];
        expect(created).toBeInstanceOf(PropertyAccount);
        const prop = created as PropertyAccount;
        expect(prop.amount).toBe(500000);          // valuation -> account value
        expect(prop.loanAmount).toBe(300000);      // loan_balance -> loanAmount
        expect(prop.ownershipType).toBe('Financed');
        // Bidirectional link: account points at the expense, expense points at the account.
        expect(prop.linkedAccountId).toBe('exs-orphan');
        expect(mortgage.linkedAccountId).toBe(prop.id);
    });

    it('re-links a mortgage whose linkedAccountId is dangling (account not present)', () => {
        const accounts: AnyAccount[] = [
            new SavedAccount('savings', 'Savings', 50000, 1.5),
        ];
        const mortgage = makeMortgage('exs-dangle', 'acc-missing', 250000);
        const expenses: AnyExpense[] = [mortgage];

        const result = linkOrphanLoanExpenses(accounts, expenses);

        expect(result.notices).toHaveLength(1);
        expect(result.accounts).toHaveLength(2); // savings + newly created property
        const created = result.accounts.find(a => a instanceof PropertyAccount) as PropertyAccount;
        expect(created).toBeDefined();
        expect(created.loanAmount).toBe(250000);
        expect(mortgage.linkedAccountId).toBe(created.id);
    });

    it('re-links an orphaned loan expense, creating a paired DebtAccount', () => {
        const accounts: AnyAccount[] = [];
        const loan = makeLoan('exs-loan', '', 12000);
        const expenses: AnyExpense[] = [loan];

        const result = linkOrphanLoanExpenses(accounts, expenses);

        expect(result.notices).toHaveLength(1);
        expect(result.accounts).toHaveLength(1);
        const created = result.accounts[0];
        expect(created).toBeInstanceOf(DebtAccount);
        expect((created as DebtAccount).amount).toBe(12000);
        expect((created as DebtAccount).linkedAccountId).toBe('exs-loan');
        expect(loan.linkedAccountId).toBe(created.id);
    });

    it('ignores non-loan expenses entirely', () => {
        const accounts: AnyAccount[] = [];
        const expenses: AnyExpense[] = [
            new OtherExpense('exs-other', 'Streaming', 50, 'Monthly'),
        ];

        const result = linkOrphanLoanExpenses(accounts, expenses);

        expect(result.accounts).toBe(accounts);
        expect(result.notices).toEqual([]);
    });

    it('avoids id collision when the derived account id already exists', () => {
        // An account already occupies the id the guard would derive ('ACC' + suffix).
        const mortgage = makeMortgage('exs-collide', '', 300000);
        const derived = 'ACC' + 'exs-collide'.substring(3); // mirrors the helper's derivation
        const accounts: AnyAccount[] = [
            new SavedAccount(derived, 'Pre-existing', 1000, 1.5),
        ];
        const expenses: AnyExpense[] = [mortgage];

        const result = linkOrphanLoanExpenses(accounts, expenses);

        const created = result.accounts.find(a => a instanceof PropertyAccount) as PropertyAccount;
        expect(created).toBeDefined();
        expect(created.id).not.toBe(derived); // did not alias onto the existing account
        expect(mortgage.linkedAccountId).toBe(created.id);
    });

    it('after re-linking, account-only net worth matches the full liability (no silent drop)', () => {
        // The end-to-end point of the guard: an orphaned mortgage that the account-only
        // reconciler would otherwise drop (reporting 0) is re-linked so its liability
        // lands on the account side and net worth reflects the real -$300k position.
        const accounts: AnyAccount[] = [];
        const expenses: AnyExpense[] = [makeMortgage('exs-orphan', '', 300000)];

        // Before the guard: account-only net worth silently ignores the orphan.
        expect(calculateNetWorth(accounts, expenses)).toBe(0);

        const result = linkOrphanLoanExpenses(accounts, expenses);

        // After the guard: 500k value − 300k loan on the paired account = 200k.
        expect(calculateNetWorth(result.accounts, result.expenses)).toBe(200000);
        // And total debt now reflects the loan.
        expect(calculateTotalDebt(result.accounts, result.expenses)).toBe(300000);
    });

    it('after re-linking, an orphaned loan adds its balance to account-only total debt', () => {
        const accounts: AnyAccount[] = [];
        const expenses: AnyExpense[] = [makeLoan('exs-loan', '', 12000)];

        expect(calculateTotalDebt(accounts, expenses)).toBe(0); // dropped before guard

        const result = linkOrphanLoanExpenses(accounts, expenses);

        expect(calculateTotalDebt(result.accounts, result.expenses)).toBe(12000);
        expect(calculateNetWorth(result.accounts, result.expenses)).toBe(-12000);
    });
});
