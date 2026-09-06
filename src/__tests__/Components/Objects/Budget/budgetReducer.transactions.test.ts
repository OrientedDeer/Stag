import { describe, it, expect } from 'vitest';
import {
    budgetReducer,
    initialState,
    type BudgetAction,
} from '../../../../components/Objects/Budget/BudgetContext';
import type {
    BudgetState,
    MonthlySnapshot,
    Transaction,
} from '../../../../components/Objects/Budget/BudgetTypes';
import {
    computeSpendingReconciliation,
    snapshotHasData,
} from '../../../../components/Objects/Budget/budgetUtils';

/**
 * Regression coverage for #210: a transaction added to a (future) month and then
 * deleted used to leave its amount behind in the month's derived `spending`
 * record, so the Overview/Spending/History tabs kept reporting spending with no
 * transaction behind it — and the month still looked "tracked", which suppressed
 * the "project non-discretionary" projection for it.
 */

const makeMonth = (
    month: number,
    year: number,
    overrides: Partial<MonthlySnapshot> = {},
): MonthlySnapshot => ({
    id: `MONTH-${year}-${month}`,
    month,
    year,
    spending: {},
    accountBalances: {},
    contributions: {},
    transactions: [],
    reconciled: false,
    createdAt: new Date(2026, 0, 1),
    updatedAt: new Date(2026, 0, 1),
    ...overrides,
});

const makeTransaction = (
    id: string,
    amount: number,
    overrides: Partial<Transaction> = {},
): Transaction => ({
    id,
    date: new Date(2026, 11, 15),
    description: `txn-${id}`,
    amount,
    ...overrides,
});

const stateWith = (months: MonthlySnapshot[]): BudgetState => ({ ...initialState, months });

const monthById = (state: BudgetState, id: string): MonthlySnapshot => {
    const found = state.months.find(m => m.id === id);
    expect(found).toBeDefined();
    return found as MonthlySnapshot;
};

const apply = (state: BudgetState, actions: BudgetAction[]): BudgetState =>
    actions.reduce(budgetReducer, state);

/**
 * Run the same transaction→spending sync the app runs app-wide (useAutoReconcile
 * / BudgetSpendingReconciler), so these tests exercise the real sequence: the
 * reconciler is what writes `spending` after a transaction is added.
 */
const reconcile = (state: BudgetState): BudgetState =>
    state.months.reduce((acc, snapshot) => {
        const current = acc.months.find(m => m.id === snapshot.id) as MonthlySnapshot;
        return computeSpendingReconciliation(current.transactions, current.spending)
            .reduce(
                (inner, { expenseId, amount }) => budgetReducer(inner, {
                    type: 'UPDATE_SPENDING',
                    payload: { monthId: snapshot.id, expenseId, amount },
                }),
                acc,
            );
    }, state);

describe('budgetReducer — transactions keep the derived spending record in sync (#210)', () => {
    describe('DELETE_TRANSACTION', () => {
        it('leaves no spending residue after add → reconcile → delete on a future month', () => {
            const december = makeMonth(12, 2026);
            let state = stateWith([december]);

            state = budgetReducer(state, {
                type: 'ADD_TRANSACTION',
                payload: {
                    monthId: december.id,
                    transaction: makeTransaction('t1', -250, { expenseId: 'groceries' }),
                },
            });
            // The reducer writes both sides of the cache invariant atomically;
            // the reconciler is now only a persisted-data repair path.
            expect(monthById(state, december.id).spending).toEqual({ groceries: 250 });
            state = reconcile(state);

            // The reconciler has cached the transaction's amount as spending...
            expect(monthById(state, december.id).spending).toEqual({ groceries: 250 });

            state = budgetReducer(state, {
                type: 'DELETE_TRANSACTION',
                payload: { monthId: december.id, transactionId: 't1' },
            });

            const after = monthById(state, december.id);
            expect(after.transactions).toEqual([]);
            // ...and deleting the transaction must take that cache with it.
            expect(after.spending).toEqual({});
            // A second reconcile pass must not resurrect it either.
            expect(monthById(reconcile(state), december.id).spending).toEqual({});
        });

        it('makes the emptied month read as "no data" again so projection can resume', () => {
            const december = makeMonth(12, 2026);
            let state = stateWith([december]);

            state = apply(state, [
                {
                    type: 'ADD_TRANSACTION',
                    payload: {
                        monthId: december.id,
                        transaction: makeTransaction('t1', -250, { expenseId: 'groceries' }),
                    },
                },
            ]);
            state = reconcile(state);
            expect(snapshotHasData(monthById(state, december.id))).toBe(true);

            state = budgetReducer(state, {
                type: 'DELETE_TRANSACTION',
                payload: { monthId: december.id, transactionId: 't1' },
            });

            expect(snapshotHasData(monthById(state, december.id))).toBe(false);
        });

        it('re-derives the remaining total when other transactions share the category', () => {
            const december = makeMonth(12, 2026, {
                transactions: [
                    makeTransaction('t1', -250, { expenseId: 'groceries' }),
                    makeTransaction('t2', -100, { expenseId: 'groceries' }),
                    makeTransaction('t3', -60, { expenseId: 'gas' }),
                ],
                spending: { groceries: 350, gas: 60 },
            });

            const state = budgetReducer(stateWith([december]), {
                type: 'DELETE_TRANSACTION',
                payload: { monthId: december.id, transactionId: 't1' },
            });

            expect(monthById(state, december.id).spending).toEqual({ groceries: 100, gas: 60 });
        });

        it('drops unrelated orphaned cache entries while deleting', () => {
            const december = makeMonth(12, 2026, {
                transactions: [
                    makeTransaction('t1', -250, { expenseId: 'groceries' }),
                    makeTransaction('t2', -60, { expenseId: 'gas' }),
                ],
                spending: { groceries: 250, gas: 60, orphaned: 999 },
            });

            const state = budgetReducer(stateWith([december]), {
                type: 'DELETE_TRANSACTION',
                payload: { monthId: december.id, transactionId: 't1' },
            });

            expect(monthById(state, december.id).spending).toEqual({ gas: 60 });
        });

        it('nets reimbursements out of the recomputed category total', () => {
            const december = makeMonth(12, 2026, {
                transactions: [
                    makeTransaction('t1', -250, { expenseId: 'travel' }),
                    makeTransaction('t2', -100, { expenseId: 'travel' }),
                    makeTransaction('t3', 40, { expenseId: 'travel', isReimbursement: true }),
                ],
                spending: { travel: 310 },
            });

            const state = budgetReducer(stateWith([december]), {
                type: 'DELETE_TRANSACTION',
                payload: { monthId: december.id, transactionId: 't2' },
            });

            expect(monthById(state, december.id).spending).toEqual({ travel: 210 });
        });

        it('leaves an uncategorized transaction\'s deletion alone', () => {
            const december = makeMonth(12, 2026, {
                transactions: [
                    makeTransaction('t1', -25),
                    makeTransaction('t2', -100, { expenseId: 'groceries' }),
                ],
                spending: { groceries: 100 },
            });

            const state = budgetReducer(stateWith([december]), {
                type: 'DELETE_TRANSACTION',
                payload: { monthId: december.id, transactionId: 't1' },
            });

            expect(monthById(state, december.id).spending).toEqual({ groceries: 100 });
        });

        it('is a no-op for an unknown transaction id', () => {
            const december = makeMonth(12, 2026, {
                transactions: [makeTransaction('t1', -100, { expenseId: 'groceries' })],
                spending: { groceries: 100 },
            });
            const state = stateWith([december]);

            const next = budgetReducer(state, {
                type: 'DELETE_TRANSACTION',
                payload: { monthId: december.id, transactionId: 'nope' },
            });

            expect(monthById(next, december.id)).toBe(december);
        });

        it('keeps the month snapshot so the delete stays undoable', () => {
            const december = makeMonth(12, 2026, {
                transactions: [makeTransaction('t1', -100, { expenseId: 'groceries' })],
                spending: { groceries: 100 },
            });

            let state = budgetReducer(stateWith([december]), {
                type: 'DELETE_TRANSACTION',
                payload: { monthId: december.id, transactionId: 't1' },
            });
            expect(state.months).toHaveLength(1);

            // Undo re-adds the same row to the same month id; reconcile restores the total.
            state = reconcile(budgetReducer(state, {
                type: 'ADD_TRANSACTION',
                payload: {
                    monthId: december.id,
                    transaction: makeTransaction('t1', -100, { expenseId: 'groceries' }),
                },
            }));
            expect(monthById(state, december.id).spending).toEqual({ groceries: 100 });
        });
    });

    describe('CLEAR_ALL_TRANSACTIONS', () => {
        it('clears the complete cache owned by the month transactions', () => {
            const december = makeMonth(12, 2026, {
                transactions: [
                    makeTransaction('t1', -250, { expenseId: 'groceries' }),
                    makeTransaction('t2', -60, { expenseId: 'gas' }),
                ],
                // `utilities` is an orphan. Once a month has transactions the
                // reconciler owns the whole cache, so it is not a manual island.
                spending: { groceries: 250, gas: 60, utilities: 90 },
            });

            const state = budgetReducer(stateWith([december]), {
                type: 'CLEAR_ALL_TRANSACTIONS',
                payload: { monthId: december.id },
            });

            const after = monthById(state, december.id);
            expect(after.transactions).toEqual([]);
            expect(after.spending).toEqual({});
        });

        it('leaves a transaction-less month (hand-entered totals) untouched', () => {
            const december = makeMonth(12, 2026, {
                spending: { utilities: 90 },
            });
            const state = stateWith([december]);

            const next = budgetReducer(state, {
                type: 'CLEAR_ALL_TRANSACTIONS',
                payload: { monthId: december.id },
            });

            expect(monthById(next, december.id)).toBe(december);
        });
    });

    describe('MOVE_TRANSACTION', () => {
        it('moves the derived total with the transaction when the target month exists', () => {
            const november = makeMonth(11, 2026, {
                transactions: [makeTransaction('t1', -250, { expenseId: 'groceries' })],
                spending: { groceries: 250 },
            });
            const december = makeMonth(12, 2026);

            const state = budgetReducer(stateWith([november, december]), {
                type: 'MOVE_TRANSACTION',
                payload: {
                    fromMonthId: november.id,
                    transactionId: 't1',
                    toMonth: 12,
                    toYear: 2026,
                    updates: { date: new Date(2026, 11, 3) },
                },
            });

            expect(monthById(state, november.id).spending).toEqual({});
            expect(snapshotHasData(monthById(state, november.id))).toBe(false);
            expect(monthById(state, december.id).spending).toEqual({ groceries: 250 });
        });

        it('seeds the derived total when the target month has to be created', () => {
            const november = makeMonth(11, 2026, {
                transactions: [
                    makeTransaction('t1', -250, { expenseId: 'groceries' }),
                    makeTransaction('t2', -40, { expenseId: 'groceries' }),
                ],
                spending: { groceries: 290 },
            });

            const state = budgetReducer(stateWith([november]), {
                type: 'MOVE_TRANSACTION',
                payload: {
                    fromMonthId: november.id,
                    transactionId: 't1',
                    toMonth: 12,
                    toYear: 2026,
                },
            });

            expect(monthById(state, november.id).spending).toEqual({ groceries: 40 });
            const created = state.months.find(m => m.month === 12 && m.year === 2026);
            expect(created?.spending).toEqual({ groceries: 250 });
        });

        it('updates in place when a direct caller moves within the same month', () => {
            const december = makeMonth(12, 2026, {
                transactions: [makeTransaction('t1', -250, { expenseId: 'groceries' })],
                spending: { groceries: 250 },
            });

            const state = budgetReducer(stateWith([december]), {
                type: 'MOVE_TRANSACTION',
                payload: {
                    fromMonthId: december.id,
                    transactionId: 't1',
                    toMonth: 12,
                    toYear: 2026,
                    updates: { amount: -300 },
                },
            });

            const after = monthById(state, december.id);
            expect(after.transactions).toHaveLength(1);
            expect(after.transactions[0].amount).toBe(-300);
            expect(after.spending).toEqual({ groceries: 300 });
        });
    });

    describe('UPDATE_TRANSACTION', () => {
        it('moves the total when the transaction is re-categorized', () => {
            const december = makeMonth(12, 2026, {
                transactions: [makeTransaction('t1', -250, { expenseId: 'groceries' })],
                spending: { groceries: 250 },
            });

            const state = budgetReducer(stateWith([december]), {
                type: 'UPDATE_TRANSACTION',
                payload: {
                    monthId: december.id,
                    transactionId: 't1',
                    updates: { expenseId: 'dining' },
                },
            });

            expect(monthById(state, december.id).spending).toEqual({ dining: 250 });
        });

        it('drops the total when the transaction is un-categorized', () => {
            const december = makeMonth(12, 2026, {
                transactions: [makeTransaction('t1', -250, { expenseId: 'groceries' })],
                spending: { groceries: 250 },
            });

            const state = budgetReducer(stateWith([december]), {
                type: 'UPDATE_TRANSACTION',
                payload: {
                    monthId: december.id,
                    transactionId: 't1',
                    updates: { expenseId: undefined },
                },
            });

            const after = monthById(state, december.id);
            expect(after.spending).toEqual({});
            expect(after.transactions[0].expenseId).toBeUndefined();
        });

        it('re-derives the total when the amount changes', () => {
            const december = makeMonth(12, 2026, {
                transactions: [makeTransaction('t1', -250, { expenseId: 'groceries' })],
                spending: { groceries: 250 },
            });

            const state = budgetReducer(stateWith([december]), {
                type: 'UPDATE_TRANSACTION',
                payload: {
                    monthId: december.id,
                    transactionId: 't1',
                    updates: { amount: -300 },
                },
            });

            expect(monthById(state, december.id).spending).toEqual({ groceries: 300 });
        });
    });
});
