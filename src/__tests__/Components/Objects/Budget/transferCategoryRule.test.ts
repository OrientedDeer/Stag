import { describe, it, expect } from 'vitest';
import {
    budgetReducer,
    initialState,
    TRANSFER_CATEGORY_ID,
    isTransferRule,
    type BudgetState,
    type CategoryMapping,
    type MonthlySnapshot,
    type Transaction,
} from '../../../../components/Objects/Budget/BudgetContext';
import { applyCategories } from '../../../../services/CSVImportService';

// Issue #209: categorizing a transaction as "Transfer" must be able to mint an
// auto-categorization rule like any other category. A CategoryMapping.expenseId is a
// plain string, so a transfer rule stores the TRANSFER_CATEGORY_ID sentinel — the same
// value the category dropdowns use. Every consumer that APPLIES a rule has to translate
// that sentinel back into `isTransfer: true` with NO expenseId; writing '__TRANSFER__'
// through as an expenseId would invent a bogus spending category.

function makeTransaction(overrides: Partial<Transaction> = {}): Transaction {
    return {
        id: 'T1',
        date: new Date(2026, 0, 15),
        description: 'TRANSFER TO SAVINGS 1234',
        amount: -500,
        ...overrides,
    };
}

function makeMonth(transactions: Transaction[]): MonthlySnapshot {
    return {
        id: 'M1',
        month: 1,
        year: 2026,
        spending: {},
        accountBalances: {},
        contributions: {},
        reconciled: false,
        transactions,
        createdAt: new Date(2026, 0, 1),
        updatedAt: new Date(2026, 0, 1),
    };
}

function stateWith(transactions: Transaction[]): BudgetState {
    return { ...initialState, months: [makeMonth(transactions)] };
}

const transferRule: CategoryMapping = {
    id: 'RULE-1',
    pattern: 'TRANSFER TO SAVINGS',
    expenseId: TRANSFER_CATEGORY_ID,
    isRegex: false,
};

describe('isTransferRule', () => {
    it('recognizes the sentinel and nothing else', () => {
        expect(isTransferRule(transferRule)).toBe(true);
        expect(isTransferRule({ expenseId: 'EXP-1' })).toBe(false);
        expect(isTransferRule({ expenseId: '' })).toBe(false);
    });
});

describe('APPLY_CATEGORY_RULE with a transfer rule (#209)', () => {
    it('flags matching transactions as transfers instead of assigning the sentinel', () => {
        const state = stateWith([makeTransaction()]);

        const next = budgetReducer(state, {
            type: 'APPLY_CATEGORY_RULE',
            payload: transferRule,
        });

        const txn = next.months[0].transactions[0];
        expect(txn.isTransfer).toBe(true);
        expect(txn.expenseId).toBeUndefined();
    });

    it('never writes the sentinel into expenseId', () => {
        const state = stateWith([makeTransaction(), makeTransaction({ id: 'T2' })]);

        const next = budgetReducer(state, {
            type: 'APPLY_CATEGORY_RULE',
            payload: transferRule,
        });

        for (const txn of next.months[0].transactions) {
            expect(txn.expenseId).not.toBe(TRANSFER_CATEGORY_ID);
        }
    });

    it('leaves non-matching transactions alone', () => {
        const state = stateWith([makeTransaction({ id: 'T2', description: 'WHOLE FOODS' })]);

        const next = budgetReducer(state, {
            type: 'APPLY_CATEGORY_RULE',
            payload: transferRule,
        });

        const txn = next.months[0].transactions[0];
        expect(txn.isTransfer).toBeUndefined();
        expect(txn.expenseId).toBeUndefined();
    });

    it('still assigns a real expenseId for an ordinary rule', () => {
        const state = stateWith([makeTransaction({ description: 'WHOLE FOODS' })]);

        const next = budgetReducer(state, {
            type: 'APPLY_CATEGORY_RULE',
            payload: { id: 'RULE-2', pattern: 'WHOLE FOODS', expenseId: 'EXP-GROCERIES' },
        });

        const txn = next.months[0].transactions[0];
        expect(txn.expenseId).toBe('EXP-GROCERIES');
        expect(txn.isTransfer).toBeUndefined();
    });
});

describe('applyCategories with a transfer rule (#209)', () => {
    it('flags an imported transaction as a transfer without an expenseId', () => {
        const { categorized, autoCategorizedCount } = applyCategories(
            [makeTransaction()],
            [transferRule],
        );

        expect(autoCategorizedCount).toBe(1);
        expect(categorized[0].isTransfer).toBe(true);
        expect(categorized[0].expenseId).toBeUndefined();
    });

    it('still assigns a real expenseId for an ordinary rule', () => {
        const { categorized } = applyCategories(
            [makeTransaction({ description: 'WHOLE FOODS' })],
            [{ id: 'RULE-2', pattern: 'WHOLE FOODS', expenseId: 'EXP-GROCERIES' }],
        );

        expect(categorized[0].expenseId).toBe('EXP-GROCERIES');
        expect(categorized[0].isTransfer).toBeUndefined();
    });
});
