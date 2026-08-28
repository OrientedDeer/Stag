import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { type ReactNode } from 'react';

import { useTransactionEditor } from '../../../tabs/Budget/transactions/useTransactionEditor';
import {
    BudgetContext,
    TRANSFER_CATEGORY_ID,
    type BudgetAction,
    type MonthlySnapshot,
    type Transaction,
} from '../../../components/Objects/Budget/BudgetContext';
import { ExpenseContext } from '../../../components/Objects/Expense/ExpenseContext';

// Issue #209: "there is a bug where transfer rules never get added. If I categorize
// something as a transfer with rule creation turned on, it should make a rule."
// The transfer branch of every categorize path clears expenseId and sets isTransfer,
// so the old `if (expenseId)` guards skipped rule creation entirely. A transfer rule
// now stores the TRANSFER_CATEGORY_ID sentinel as its expenseId.

vi.mock('../../../components/Layout/Overlays/ReceiptToast', () => ({
    useReceiptToast: () => ({ show: vi.fn() }),
}));

const SELECTED_MONTH = 1;
const SELECTED_YEAR = 2026;

const transferTxn: Transaction = {
    id: 'T1',
    date: new Date(2026, 0, 15),
    description: 'TRANSFER TO SAVINGS 1234',
    amount: -500,
};

const groceryTxn: Transaction = {
    id: 'T2',
    date: new Date(2026, 0, 16),
    description: 'WHOLE FOODS',
    amount: -84.12,
};

function makeSnapshot(transactions: Transaction[]): MonthlySnapshot {
    return {
        id: 'M1',
        month: SELECTED_MONTH,
        year: SELECTED_YEAR,
        spending: {},
        accountBalances: {},
        contributions: {},
        reconciled: false,
        transactions,
        createdAt: new Date(2026, 0, 1),
        updatedAt: new Date(2026, 0, 1),
    };
}

let dispatch: Mock<(action: BudgetAction) => void>;

function renderEditor(opts: { autoCreateRules?: boolean } = {}) {
    const snapshot = makeSnapshot([transferTxn, groceryTxn]);
    const wrapper = ({ children }: { children: ReactNode }) => (
        <BudgetContext.Provider
            value={{
                months: [snapshot],
                selectedMonth: SELECTED_MONTH,
                selectedYear: SELECTED_YEAR,
                importSettings: {
                    dateColumn: 'Date',
                    amountColumn: 'Amount',
                    descriptionColumn: 'Description',
                    categoryMappings: [],
                    savedCSVFormats: [],
                    autoCreateRules: opts.autoCreateRules ?? true,
                },
                dispatch,
                getOrCreateMonth: () => snapshot,
                getCurrentMonth: () => snapshot,
            }}
        >
            <ExpenseContext.Provider value={{ expenses: [] }}>
                {children}
            </ExpenseContext.Provider>
        </BudgetContext.Provider>
    );

    return renderHook(() => useTransactionEditor(SELECTED_MONTH, SELECTED_YEAR), { wrapper });
}

/** Every ADD_CATEGORY_MAPPING the hook dispatched. */
function addedRules(): Extract<BudgetAction, { type: 'ADD_CATEGORY_MAPPING' }>['payload'][] {
    return dispatch.mock.calls
        .map(([action]) => action as BudgetAction)
        .filter((a): a is Extract<BudgetAction, { type: 'ADD_CATEGORY_MAPPING' }> =>
            a.type === 'ADD_CATEGORY_MAPPING')
        .map(a => a.payload);
}

beforeEach(() => {
    dispatch = vi.fn();
});

describe('useTransactionEditor.update — transfer rule creation (#209)', () => {
    it('creates a rule when a transaction is categorized as a transfer', () => {
        const { result } = renderEditor();

        act(() => {
            result.current.update('T1', {
                description: transferTxn.description,
                amount: -500,
                expenseId: undefined,
                isTransfer: true,
                isReimbursement: false,
            });
        });

        const rules = addedRules();
        expect(rules).toHaveLength(1);
        expect(rules[0].pattern).toBe('TRANSFER TO SAVINGS 1234');
        expect(rules[0].expenseId).toBe(TRANSFER_CATEGORY_ID);
        expect(rules[0].isRegex).toBe(false);
    });

    it('applies the freshly created transfer rule', () => {
        const { result } = renderEditor();

        act(() => {
            result.current.update('T1', { isTransfer: true });
        });

        const applied = dispatch.mock.calls
            .map(([action]) => action as BudgetAction)
            .filter(a => a.type === 'APPLY_CATEGORY_RULE');
        expect(applied).toHaveLength(1);
        expect((applied[0] as Extract<BudgetAction, { type: 'APPLY_CATEGORY_RULE' }>).payload.expenseId)
            .toBe(TRANSFER_CATEGORY_ID);
    });

    it('does not create a rule when auto-create is off', () => {
        const { result } = renderEditor({ autoCreateRules: false });

        act(() => {
            result.current.update('T1', { isTransfer: true });
        });

        expect(addedRules()).toHaveLength(0);
    });

    it('does not create a rule for a contribution transfer (no target account on a rule)', () => {
        const { result } = renderEditor();

        act(() => {
            result.current.update('T1', { isTransfer: true, targetAccountId: 'ACC-1' });
        });

        expect(addedRules()).toHaveLength(0);
    });

    it('still creates an ordinary expense rule', () => {
        const { result } = renderEditor();

        act(() => {
            result.current.update('T2', { expenseId: 'EXP-GROCERIES' });
        });

        const rules = addedRules();
        expect(rules).toHaveLength(1);
        expect(rules[0].expenseId).toBe('EXP-GROCERIES');
    });
});

describe('useTransactionEditor.bulkSetCategory — transfer rule creation (#209)', () => {
    it('creates one transfer rule per distinct description', () => {
        const { result } = renderEditor();

        act(() => {
            result.current.bulkSetCategory(new Set(['T1', 'T2']), TRANSFER_CATEGORY_ID);
        });

        const rules = addedRules();
        expect(rules).toHaveLength(2);
        expect(rules.every(r => r.expenseId === TRANSFER_CATEGORY_ID)).toBe(true);
        expect(rules.map(r => r.pattern).sort()).toEqual(
            ['TRANSFER TO SAVINGS 1234', 'WHOLE FOODS'],
        );
    });

    it('creates no rule when bulk-clearing to Uncategorized', () => {
        const { result } = renderEditor();

        act(() => {
            result.current.bulkSetCategory(new Set(['T1', 'T2']), '');
        });

        expect(addedRules()).toHaveLength(0);
    });
});
