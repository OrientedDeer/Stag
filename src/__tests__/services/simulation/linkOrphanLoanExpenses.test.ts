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
        // A back-link-only repair still counts as a change (must be persisted) [#1].
        expect(result.changed).toBe(true);
        // ...but no account was created, so there is no creation notice.
        expect(result.notices).toEqual([]);
        // Loan counted exactly once: 500k − 300k = 200k (NOT -100k double-counted).
        expect(calculateNetWorth(result.accounts)).toBe(200000);
        expect(calculateTotalDebt(result.accounts)).toBe(300000);
    });

    it('reports changed=false and empty notices when there is nothing to repair (#124 [1])', () => {
        // Fully-linked property + mortgage: no creation, no back-link repair.
        const existing = new PropertyAccount('acc-house', 'Home', 500000, 'Financed', 300000, 400000, 'exs-house');
        const mortgage = makeMortgage('exs-house', 'acc-house', 300000);
        const result = linkOrphanLoanExpenses([existing], [mortgage]);

        expect(result.changed).toBe(false);
        expect(result.notices).toEqual([]);
        expect(result.accounts).toHaveLength(1);
    });

    it('clears a wrong-typed account stale claim when the expense is relinked to a correct carrier (#124 [7])', () => {
        // A correctly-typed PropertyAccount carries the mortgage (claims it AND the
        // expense back-link is empty), while a WRONG-typed DebtAccount ALSO claims the
        // same expense id (stale). The guard reuses the PropertyAccount and must clear
        // the DebtAccount's stale linkedAccountId so two accounts don't both reference
        // the expense.
        const carrier = new PropertyAccount('acc-prop', 'Home', 500000, 'Financed', 300000, 400000, 'exs-house');
        const staleClaimant = new DebtAccount('acc-debt', 'Unrelated Debt', 5000, 'exs-house', 5);
        const mortgage = makeMortgage('exs-house', '', 300000); // back-link empty
        const accounts: AnyAccount[] = [carrier, staleClaimant];

        const result = linkOrphanLoanExpenses(accounts, [mortgage]);

        // Reused the correct carrier (no new account).
        expect(result.accounts).toHaveLength(2);
        expect(mortgage.linkedAccountId).toBe('acc-prop');
        // The wrong-typed DebtAccount no longer claims the expense.
        expect(staleClaimant.linkedAccountId).toBe('');
        expect(result.changed).toBe(true);
    });

    it('clears a wrong-typed stale claim when a NEW carrier is minted (#124 [7])', () => {
        // A wrong-typed DebtAccount claims the mortgage's expense id, and there is NO
        // correctly-typed carrier — so a PropertyAccount is minted. The DebtAccount's
        // stale claim on the expense must be cleared so it doesn't dangle.
        const wrongClaimant = new DebtAccount('acc-debt', 'Unrelated Debt', 5000, 'exs-house', 5);
        const mortgage = makeMortgage('exs-house', '', 300000);

        const result = linkOrphanLoanExpenses([wrongClaimant], [mortgage]);

        const created = result.accounts.find(a => a instanceof PropertyAccount) as PropertyAccount;
        expect(created).toBeDefined();
        expect(mortgage.linkedAccountId).toBe(created.id);
        expect(wrongClaimant.linkedAccountId).toBe(''); // stale claim cleared
        expect(result.changed).toBe(true);
        // 5000 unrelated debt + (500k − 300k) = 195000.
        expect(calculateNetWorth(result.accounts)).toBe(195000);
    });

    it('does NOT clear a SECOND correctly-typed carrier of the same expense (#124 review-4 [2])', () => {
        // Two PropertyAccounts both legitimately link the same mortgage (e.g. a
        // genuine second financed property whose expense id collided, or duplicate
        // carriers). clearStaleClaims must NOT wipe the non-chosen one — it's a valid
        // carrier and AccountGrowth must keep syncing the loan onto it. Only WRONG-typed
        // claimants get cleared. A wrong-typed DebtAccount in the mix IS cleared.
        const carrierA = new PropertyAccount('acc-prop-a', 'Home A', 500000, 'Financed', 300000, 400000, 'exs-house');
        const carrierB = new PropertyAccount('acc-prop-b', 'Home B', 400000, 'Financed', 200000, 300000, 'exs-house');
        const wrongTyped = new DebtAccount('acc-debt', 'Unrelated Debt', 5000, 'exs-house', 5);
        const mortgage = makeMortgage('exs-house', '', 300000); // back-link empty
        const accounts: AnyAccount[] = [carrierA, carrierB, wrongTyped];

        const result = linkOrphanLoanExpenses(accounts, [mortgage]);

        // No new account; the chosen carrier (first correctly-typed) gets the back-link.
        expect(result.accounts).toHaveLength(3);
        // BOTH correctly-typed carriers KEEP their claim — neither is wiped.
        expect(carrierA.linkedAccountId).toBe('exs-house');
        expect(carrierB.linkedAccountId).toBe('exs-house');
        // The wrong-typed DebtAccount IS cleared.
        expect(wrongTyped.linkedAccountId).toBe('');
        expect(result.changed).toBe(true);
    });

    it('back-link-only repair returns a NEW expenses ref but the SAME accounts ref (#124 review-4 [8])', () => {
        // Carrier exists and claims the expense; only the expense back-link is repaired.
        // Expenses changed => new expenses array; no account changed => same accounts ref.
        const carrier = new PropertyAccount('acc-prop', 'Home', 500000, 'Financed', 300000, 400000, 'exs-house');
        const mortgage = makeMortgage('exs-house', '', 300000); // back-link empty
        const accounts: AnyAccount[] = [carrier];
        const expenses: AnyExpense[] = [mortgage];

        const result = linkOrphanLoanExpenses(accounts, expenses);

        expect(result.changed).toBe(true);
        expect(result.expenses).not.toBe(expenses); // expense changed => new ref
        expect(result.accounts).toBe(accounts);     // no account changed => same ref
    });

    it('stale-claim-only repair returns a NEW accounts ref but the SAME expenses ref (#124 review-4 [8])', () => {
        // Carrier exists AND the expense back-link already points at it (no expense
        // change), but a wrong-typed account also claims the expense (account change).
        // Accounts changed => new accounts array; expenses untouched => same ref.
        const carrier = new PropertyAccount('acc-prop', 'Home', 500000, 'Financed', 300000, 400000, 'exs-house');
        const wrongTyped = new DebtAccount('acc-debt', 'Unrelated Debt', 5000, 'exs-house', 5);
        const mortgage = makeMortgage('exs-house', 'acc-prop', 300000); // back-link already correct
        const accounts: AnyAccount[] = [carrier, wrongTyped];
        const expenses: AnyExpense[] = [mortgage];

        const result = linkOrphanLoanExpenses(accounts, expenses);

        expect(result.changed).toBe(true);
        expect(wrongTyped.linkedAccountId).toBe(''); // stale claim cleared
        expect(result.accounts).not.toBe(accounts); // account changed => new ref
        expect(result.expenses).toBe(expenses);     // expense untouched => same ref
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

    it('STILL repairs a mortgage whose forward link points at a non-loan account (#124 [1])', () => {
        // Legacy/hand-edited backup: the mortgage's linkedAccountId resolves to a
        // present account, but it's a SavedAccount — which carries NO loan
        // (SavedAccount has no loanAmount, and AccountGrowth only syncs linked loan
        // state onto Property/Debt). The forward link "resolves" but does NOT carry
        // the liability, so the loan would be silently dropped from account-only net
        // worth. The guard must treat this as still-orphaned and create the proper
        // paired PropertyAccount.
        const saved = new SavedAccount('acc-saved', 'Savings', 50000, 1.5);
        const mortgage = makeMortgage('exs-house', 'acc-saved', 300000); // points at the wrong type
        const accounts: AnyAccount[] = [saved];
        const expenses: AnyExpense[] = [mortgage];

        const result = linkOrphanLoanExpenses(accounts, expenses);

        // A PropertyAccount was created to carry the loan (saved + new property = 2).
        expect(result.accounts).toHaveLength(2);
        const created = result.accounts.find(a => a instanceof PropertyAccount) as PropertyAccount;
        expect(created).toBeDefined();
        expect(created.loanAmount).toBe(300000);
        // Back-link repointed to the real carrier.
        expect(mortgage.linkedAccountId).toBe(created.id);
        // Net worth: 50k saved + (500k − 300k) property = 250k. NOT 50k (silent drop).
        expect(calculateNetWorth(result.accounts)).toBe(250000);
    });

    it('STILL repairs a loan whose forward link points at a non-debt account (#124 [1])', () => {
        const saved = new SavedAccount('acc-saved', 'Savings', 50000, 1.5);
        const loan = makeLoan('exs-loan', 'acc-saved', 12000); // points at the wrong type
        const accounts: AnyAccount[] = [saved];
        const expenses: AnyExpense[] = [loan];

        const result = linkOrphanLoanExpenses(accounts, expenses);

        expect(result.accounts).toHaveLength(2);
        const created = result.accounts.find(a => a instanceof DebtAccount) as DebtAccount;
        expect(created).toBeDefined();
        expect(created.amount).toBe(12000);
        expect(loan.linkedAccountId).toBe(created.id);
        // 50k saved − 12k debt = 38k. NOT 50k.
        expect(calculateNetWorth(result.accounts)).toBe(38000);
    });

    it('STILL repairs a mortgage that only a wrong-typed DebtAccount claims (#124 [2])', () => {
        // Reverse-link type mismatch: a DebtAccount claims the MortgageExpense's id,
        // but a mortgage's balance must live on a PropertyAccount.loanAmount, not a
        // DebtAccount. The DebtAccount does not carry the mortgage, so the guard must
        // still create the paired PropertyAccount rather than treating it as covered.
        const wrongType = new DebtAccount('acc-debt', 'Some Debt', 9999, 'exs-house', 5);
        const mortgage = makeMortgage('exs-house', '', 300000);
        const accounts: AnyAccount[] = [wrongType];
        const expenses: AnyExpense[] = [mortgage];

        const result = linkOrphanLoanExpenses(accounts, expenses);

        // The pre-existing DebtAccount stays; a PropertyAccount is added for the loan.
        expect(result.accounts).toHaveLength(2);
        const created = result.accounts.find(a => a instanceof PropertyAccount) as PropertyAccount;
        expect(created).toBeDefined();
        expect(created.loanAmount).toBe(300000);
        expect(mortgage.linkedAccountId).toBe(created.id);
        // (500k − 300k) property − 9999 unrelated debt = 190001.
        expect(calculateNetWorth(result.accounts)).toBe(190001);
    });

    it('STILL repairs a loan that only a wrong-typed PropertyAccount claims (#124 [2])', () => {
        const wrongType = new PropertyAccount('acc-prop', 'Home', 400000, 'Owned', 0, 0, 'exs-loan');
        const loan = makeLoan('exs-loan', '', 12000);
        const accounts: AnyAccount[] = [wrongType];
        const expenses: AnyExpense[] = [loan];

        const result = linkOrphanLoanExpenses(accounts, expenses);

        expect(result.accounts).toHaveLength(2);
        const created = result.accounts.find(a => a instanceof DebtAccount) as DebtAccount;
        expect(created).toBeDefined();
        expect(created.amount).toBe(12000);
        expect(loan.linkedAccountId).toBe(created.id);
        // 400k property + 0 loan − 12k new debt = 388000.
        expect(calculateNetWorth(result.accounts)).toBe(388000);
    });

    it('would repair an orphan reconstituted from the localStorage boot-hydration blobs (#124 [0]; boot wiring tracked in #136)', () => {
        // NOTE: the guard is NOT wired into localStorage boot-hydration today — that
        // path has no shared chokepoint (AccountProvider/ExpenseProvider hydrate from
        // SEPARATE keys) and is tracked as #136. This test only proves the HELPER is
        // correct on boot-shaped input: accounts and expenses are persisted under
        // separate localStorage blobs and rehydrated independently (hydrateAccountState
        // / hydrateExpenseState); a pre-existing orphan mortgage (no paired account in
        // the persisted accounts blob) survives reconstitution. Run over the two
        // independently-hydrated sets, the helper repairs it — i.e. wiring it into a
        // boot-time reconciler (#136) would fix the path; the helper itself is ready.
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
