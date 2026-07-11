import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, act } from '@testing-library/react';
import { useContext, useEffect } from 'react';

import { AccountContext } from '../../components/Objects/Accounts/AccountContext';
import { AccountProvider } from '../../components/Objects/Accounts/AccountProvider';
import { ExpenseContext } from '../../components/Objects/Expense/ExpenseContext';
import { ExpenseProvider } from '../../components/Objects/Expense/ExpenseProvider';
import { OrphanLoanReconciler } from '../../components/OrphanLoanReconciler';
import { PropertyAccount, type AnyAccount } from '../../components/Objects/Accounts/models';
import { MortgageExpense, type AnyExpense } from '../../components/Objects/Expense/models';
import { calculateNetWorth } from '../../services/simulation/MilestoneEvaluator';

// localStorage mock (mirrors the AccountContext/ExpenseContext test pattern).
const localStorageMock = (() => {
    let store: { [key: string]: string } = {};
    return {
        getItem: vi.fn((key: string) => store[key] || null),
        setItem: vi.fn((key: string, value: string) => { store[key] = value.toString(); }),
        clear: vi.fn(() => { store = {}; }),
        removeItem: vi.fn((key: string) => { delete store[key]; }),
    };
})();
Object.defineProperty(window, 'localStorage', { value: localStorageMock });

const ACCOUNTS_KEY = 'user_accounts_data';
const EXPENSES_KEY = 'user_expenses_data';

// An orphan mortgage as it would sit in persisted localStorage: a MortgageExpense
// with an empty linkedAccountId and NO paired account in the accounts blob.
const orphanMortgageJson = {
    expenses: [
        {
            className: 'MortgageExpense',
            id: 'exs-orphan', name: 'Old Home', frequency: 'Monthly',
            valuation: 500000, loan_balance: 300000, starting_loan_balance: 400000,
            apr: 4, term_length: 30, property_taxes: 1.2, valuation_deduction: 0,
            maintenance: 0.5, utilities: 200, home_owners_insurance: 0.3, pmi: 0,
            hoa_fee: 0, is_tax_deductible: 'Itemized', tax_deductible: 0,
            linkedAccountId: '',
            startDate: '2020-01-01',
        },
    ],
};

// Probe that captures the live account + expense context state. The assignment to
// the external holder happens in an effect (not during render) so it complies with
// react-hooks/immutability; the effect re-runs whenever the captured values change,
// so `captured` always reflects the latest committed context state.
function makeProbe() {
    const captured: { accounts: AnyAccount[]; expenses: AnyExpense[] } = { accounts: [], expenses: [] };
    const Probe = () => {
        const accounts = useContext(AccountContext).accounts;
        const expenses = useContext(ExpenseContext).expenses;
        useEffect(() => {
            captured.accounts = accounts;
            captured.expenses = expenses;
        }, [accounts, expenses]);
        return null;
    };
    return { captured, Probe };
}

function renderWithProviders(probe: () => null) {
    const Probe = probe;
    return render(
        <AccountProvider>
            <ExpenseProvider>
                <OrphanLoanReconciler />
                <Probe />
            </ExpenseProvider>
        </AccountProvider>
    );
}

describe('OrphanLoanReconciler (#136 boot-hydration orphan repair)', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        localStorageMock.clear();
        localStorageMock.getItem.mockClear();
        localStorageMock.setItem.mockClear();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('repairs an orphan loan present in persisted localStorage on boot', () => {
        localStorage.setItem(ACCOUNTS_KEY, JSON.stringify({ accounts: [], amountHistory: {} }));
        localStorage.setItem(EXPENSES_KEY, JSON.stringify(orphanMortgageJson));

        const { captured, Probe } = makeProbe();
        // The reconcile runs in a mount effect; flush effects with act().
        act(() => { renderWithProviders(Probe); });

        // After the boot reconcile, a paired PropertyAccount exists for the orphan.
        const property = captured.accounts.find((a): a is PropertyAccount => a instanceof PropertyAccount);
        expect(property).toBeDefined();
        expect(property!.loanAmount).toBe(300000);

        // The expense is now linked to that account (back-link repaired).
        const mortgage = captured.expenses.find((e): e is MortgageExpense => e instanceof MortgageExpense);
        expect(mortgage!.linkedAccountId).toBe(property!.id);

        // Account-only net worth reflects the liability: 500k − 300k = 200k (not 0).
        expect(calculateNetWorth(captured.accounts)).toBe(200000);
    });

    it('persists the repair back to localStorage (self-heals saved state)', () => {
        localStorage.setItem(ACCOUNTS_KEY, JSON.stringify({ accounts: [], amountHistory: {} }));
        localStorage.setItem(EXPENSES_KEY, JSON.stringify(orphanMortgageJson));

        const { Probe } = makeProbe();
        act(() => { renderWithProviders(Probe); });
        // Flush the debounced (500ms) localStorage write.
        act(() => { vi.advanceTimersByTime(600); });

        // The persisted accounts blob should now contain the created PropertyAccount.
        const persisted = JSON.parse(localStorage.getItem(ACCOUNTS_KEY) as string);
        const hasProperty = (persisted.accounts as Array<{ className?: string; loanAmount?: number }>)
            .some(a => a.className === 'PropertyAccount' && a.loanAmount === 300000);
        expect(hasProperty).toBe(true);

        // And the expenses blob carries the repaired back-link.
        const persistedExp = JSON.parse(localStorage.getItem(EXPENSES_KEY) as string);
        expect(persistedExp.expenses[0].linkedAccountId).not.toBe('');
    });

    it('does NOT add an account when there are no orphans (idempotent, no churn)', () => {
        // A properly linked property + mortgage: nothing to repair.
        const linkedAccounts = {
            accounts: [
                { className: 'PropertyAccount', id: 'acc-house', name: 'Home', amount: 500000,
                  ownershipType: 'Financed', loanAmount: 300000, startingLoanBalance: 400000,
                  linkedAccountId: 'exs-house', apr: 4 },
            ],
            amountHistory: {},
        };
        const linkedExpenses = {
            expenses: [{ ...orphanMortgageJson.expenses[0], id: 'exs-house', linkedAccountId: 'acc-house' }],
        };
        localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(linkedAccounts));
        localStorage.setItem(EXPENSES_KEY, JSON.stringify(linkedExpenses));

        const { captured, Probe } = makeProbe();
        act(() => { renderWithProviders(Probe); });
        act(() => { vi.advanceTimersByTime(600); });

        // No NEW account created (still exactly the one persisted); the existing
        // PropertyAccount instance is untouched, and the persisted blob still has one.
        expect(captured.accounts).toHaveLength(1);
        const persisted = JSON.parse(localStorage.getItem(ACCOUNTS_KEY) as string);
        expect(persisted.accounts).toHaveLength(1);
    });

    it('DISPATCHES a back-link-only repair (no account created, no notice) so it self-heals (#124 review-3 #1)', () => {
        // The carrier PropertyAccount already exists and claims the expense
        // (account.linkedAccountId === 'exs-house'), but the expense's OWN
        // linkedAccountId is empty. The guard repairs only the expense back-link —
        // it creates NO account and pushes NO notice (empty `notices`), but reports
        // `changed: true`. The reconciler must STILL dispatch SET_BULK_DATA (keying
        // off `changed`, not notices); otherwise the reducer state object is never
        // replaced and the repair isn't durably committed.
        //
        // Observable signal: a dispatch replaces the expense array with a NEW
        // reference (SET_BULK_DATA). We capture the array identity before vs after.
        const accountsBlob = {
            accounts: [
                { className: 'PropertyAccount', id: 'acc-house', name: 'Home', amount: 500000,
                  ownershipType: 'Financed', loanAmount: 300000, startingLoanBalance: 400000,
                  linkedAccountId: 'exs-house', apr: 4 },
            ],
            amountHistory: {},
        };
        const expensesBlob = {
            // expense id 'exs-house' but its own linkedAccountId is empty (back-link broken).
            expenses: [{ ...orphanMortgageJson.expenses[0], id: 'exs-house', linkedAccountId: '' }],
        };
        localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(accountsBlob));
        localStorage.setItem(EXPENSES_KEY, JSON.stringify(expensesBlob));

        const dispatchedExpenseArrays: AnyExpense[][] = [];
        const Probe = () => {
            const expenses = useContext(ExpenseContext).expenses;
            useEffect(() => {
                dispatchedExpenseArrays.push(expenses);
            }, [expenses]);
            return null;
        };
        act(() => { renderWithProviders(Probe); });
        act(() => { vi.advanceTimersByTime(600); });

        // The expense array changed identity at least once => a SET_BULK_DATA was
        // dispatched by the reconciler (without the changed-gate fix it would not be,
        // since notices is empty for a back-link-only repair).
        expect(dispatchedExpenseArrays.length).toBeGreaterThanOrEqual(2);

        // And the back-link is repaired on the committed instance.
        const latest = dispatchedExpenseArrays[dispatchedExpenseArrays.length - 1];
        const mortgage = latest.find((e): e is MortgageExpense => e instanceof MortgageExpense);
        expect(mortgage!.linkedAccountId).toBe('acc-house');
    });
});
