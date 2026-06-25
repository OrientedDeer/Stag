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
import { hydrateAccountState } from '../../../components/Objects/Accounts/AccountContext';
import { hydrateExpenseState } from '../../../components/Objects/Expense/ExpenseContext';

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
        expect(calculateNetWorth(accounts)).toBe(0);

        const result = linkOrphanLoanExpenses(accounts, expenses);

        // After the guard: 500k value − 300k loan on the paired account = 200k.
        expect(calculateNetWorth(result.accounts)).toBe(200000);
        // And total debt now reflects the loan.
        expect(calculateTotalDebt(result.accounts)).toBe(300000);
    });

    it('after re-linking, an orphaned loan adds its balance to account-only total debt', () => {
        const accounts: AnyAccount[] = [];
        const expenses: AnyExpense[] = [makeLoan('exs-loan', '', 12000)];

        expect(calculateTotalDebt(accounts)).toBe(0); // dropped before guard

        const result = linkOrphanLoanExpenses(accounts, expenses);

        expect(calculateTotalDebt(result.accounts)).toBe(12000);
        expect(calculateNetWorth(result.accounts)).toBe(-12000);
    });

    it('does NOT double-claim when an account already links the expense but the back-link is broken (#124 [3])', () => {
        // Half-broken link: the PropertyAccount points at the mortgage
        // (account.linkedAccountId === mortgage.id), but the mortgage's own
        // linkedAccountId is empty. The loan is ALREADY carried by that account, so
        // the guard must NOT mint a second PropertyAccount (which would double-count
        // the 300k loan in net worth / total debt). It should reuse the existing one
        // and repair the back-link.
        const existing = new PropertyAccount('acc-house', 'Home', 500000, 'Financed', 300000, 400000, 'exs-house');
        const mortgage = makeMortgage('exs-house', '', 300000); // back-link broken
        const accounts: AnyAccount[] = [existing];
        const expenses: AnyExpense[] = [mortgage];

        const result = linkOrphanLoanExpenses(accounts, expenses);

        // No new account created.
        expect(result.accounts).toHaveLength(1);
        expect(result.accounts[0]).toBe(existing);
        // Back-link repaired to the existing account.
        expect(mortgage.linkedAccountId).toBe('acc-house');
        // Loan counted exactly once: 500k − 300k = 200k (NOT -100k double-counted).
        expect(calculateNetWorth(result.accounts)).toBe(200000);
        expect(calculateTotalDebt(result.accounts)).toBe(300000);
    });

    it('does NOT double-claim a loan when a DebtAccount already links the expense (#124 [3])', () => {
        const existing = new DebtAccount('acc-loan', 'Personal Loan', 12000, 'exs-loan', 8);
        const loan = makeLoan('exs-loan', '', 12000); // back-link broken
        const accounts: AnyAccount[] = [existing];
        const expenses: AnyExpense[] = [loan];

        const result = linkOrphanLoanExpenses(accounts, expenses);

        expect(result.accounts).toHaveLength(1);
        expect(result.accounts[0]).toBe(existing);
        expect(loan.linkedAccountId).toBe('acc-loan');
        // 12k counted once, not 24k.
        expect(calculateTotalDebt(result.accounts)).toBe(12000);
    });

    it('reuses the existing account even when its id is NOT the derived ACC-id (#124 [3])', () => {
        // The account claiming the expense has an arbitrary id (e.g. an imported one
        // that does not follow the 'ACC'+suffix convention). The guard must still
        // recognize the claim via account.linkedAccountId and reuse it.
        const existing = new PropertyAccount('imported-xyz', 'Home', 500000, 'Financed', 300000, 400000, 'exs-house');
        const mortgage = makeMortgage('exs-house', '', 300000);
        const accounts: AnyAccount[] = [existing];
        const expenses: AnyExpense[] = [mortgage];

        const result = linkOrphanLoanExpenses(accounts, expenses);

        expect(result.accounts).toHaveLength(1);
        expect(mortgage.linkedAccountId).toBe('imported-xyz');
        expect(calculateNetWorth(result.accounts)).toBe(200000);
    });

    it('repairs an orphan that arrives through the localStorage boot-hydration path (#124 [0])', () => {
        // Reproduce the boot path: accounts and expenses are persisted under SEPARATE
        // localStorage keys and rehydrated independently (hydrateAccountState /
        // hydrateExpenseState). A pre-existing orphan mortgage (no paired account in
        // the persisted accounts blob) survives reconstitution. Running the guard over
        // the two independently-hydrated sets repairs it — exactly what a boot-time
        // reconciler reading both contexts would do.
        const persistedAccounts = { accounts: [], amountHistory: {} };
        const persistedExpenses = {
            expenses: [
                {
                    className: 'MortgageExpense',
                    id: 'exs-boot-orphan', name: 'Old Home', frequency: 'Monthly',
                    valuation: 500000, loan_balance: 300000, starting_loan_balance: 400000,
                    apr: 4, term_length: 30, property_taxes: 1.2, valuation_deduction: 0,
                    maintenance: 0.5, utilities: 200, home_owners_insurance: 0.3, pmi: 0,
                    hoa_fee: 0, is_tax_deductible: 'Itemized', tax_deductible: 0,
                    linkedAccountId: '', // orphan: no paired account persisted
                    startDate: '2020-01-01',
                },
            ],
        };

        const accountState = hydrateAccountState(persistedAccounts, { accounts: [], amountHistory: {} });
        const expenseState = hydrateExpenseState(persistedExpenses, { expenses: [] });

        // The orphan reconstituted into a real MortgageExpense.
        expect(expenseState.expenses[0]).toBeInstanceOf(MortgageExpense);
        // Account-only net worth would silently drop it before repair.
        expect(calculateNetWorth(accountState.accounts)).toBe(0);

        const result = linkOrphanLoanExpenses(accountState.accounts, expenseState.expenses);

        // After the boot-time guard, the liability lands on a paired account.
        expect(result.accounts).toHaveLength(1);
        expect(result.accounts[0]).toBeInstanceOf(PropertyAccount);
        expect(calculateNetWorth(result.accounts)).toBe(200000);
        expect((expenseState.expenses[0] as MortgageExpense).linkedAccountId).toBe(result.accounts[0].id);
    });
});
