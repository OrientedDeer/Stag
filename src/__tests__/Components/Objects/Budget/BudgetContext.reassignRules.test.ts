/**
 * REASSIGN_CATEGORY_MAPPINGS (#209): the user ends an expense, recreates it, and
 * every categorization rule still points at the dead expense id. This action
 * repoints them all in one dispatch.
 */
import { describe, it, expect } from 'vitest';
import { budgetReducer, initialState } from '../../../../components/Objects/Budget/BudgetContext';
import type { BudgetState, CategoryMapping, MonthlySnapshot } from '../../../../components/Objects/Budget/BudgetTypes';

const rule = (id: string, pattern: string, expenseId: string, isRegex = false): CategoryMapping => ({
    id,
    pattern,
    expenseId,
    isRegex,
});

const stateWith = (mappings: CategoryMapping[], months: MonthlySnapshot[] = []): BudgetState => ({
    ...initialState,
    months,
    importSettings: { ...initialState.importSettings, categoryMappings: mappings },
});

describe('budgetReducer — REASSIGN_CATEGORY_MAPPINGS', () => {
    it('repoints every rule aimed at the old expense, leaving others alone', () => {
        const state = stateWith([
            rule('r1', 'AMAZON', 'misc-old'),
            rule('r2', 'TARGET', 'misc-old'),
            rule('r3', 'SAFEWAY', 'groceries'),
        ]);

        const next = budgetReducer(state, {
            type: 'REASSIGN_CATEGORY_MAPPINGS',
            payload: { fromExpenseId: 'misc-old', toExpenseId: 'misc-new' },
        });

        expect(next.importSettings.categoryMappings.map(m => [m.id, m.expenseId])).toEqual([
            ['r1', 'misc-new'],
            ['r2', 'misc-new'],
            ['r3', 'groceries'],
        ]);
    });

    it('preserves each rule\'s pattern and regex flag', () => {
        const state = stateWith([rule('r1', 'AMZN|AMAZON', 'misc-old', true)]);

        const next = budgetReducer(state, {
            type: 'REASSIGN_CATEGORY_MAPPINGS',
            payload: { fromExpenseId: 'misc-old', toExpenseId: 'misc-new' },
        });

        expect(next.importSettings.categoryMappings[0]).toEqual({
            id: 'r1',
            pattern: 'AMZN|AMAZON',
            expenseId: 'misc-new',
            isRegex: true,
        });
    });

    it('does not mutate the original rule objects', () => {
        const original = rule('r1', 'AMAZON', 'misc-old');
        const state = stateWith([original]);

        budgetReducer(state, {
            type: 'REASSIGN_CATEGORY_MAPPINGS',
            payload: { fromExpenseId: 'misc-old', toExpenseId: 'misc-new' },
        });

        expect(original.expenseId).toBe('misc-old');
    });

    it('collapses a moved rule that duplicates one the target already had', () => {
        const state = stateWith([
            rule('r1', 'amazon', 'misc-new'),   // already on the target
            rule('r2', 'AMAZON', 'misc-old'),   // same pattern, different case
            rule('r3', 'TARGET', 'misc-old'),
        ]);

        const next = budgetReducer(state, {
            type: 'REASSIGN_CATEGORY_MAPPINGS',
            payload: { fromExpenseId: 'misc-old', toExpenseId: 'misc-new' },
        });

        // r2 is dead weight next to r1 (matching is case-insensitive, first match
        // wins), so it's dropped; the earlier rule survives.
        expect(next.importSettings.categoryMappings.map(m => m.id)).toEqual(['r1', 'r3']);
    });

    it('leaves pre-existing duplicates under an UNRELATED category alone', () => {
        // Regression: the collision check must be scoped to the rules being moved.
        // A user who already had two identical rules under some other category must
        // not lose one of them just because they reassigned A -> B.
        const state = stateWith([
            rule('c1', 'COSTCO', 'unrelated'),
            rule('c2', 'COSTCO', 'unrelated'),   // pre-existing duplicate, untouched by the move
            rule('a1', 'AMAZON', 'expense-a'),
        ]);

        const next = budgetReducer(state, {
            type: 'REASSIGN_CATEGORY_MAPPINGS',
            payload: { fromExpenseId: 'expense-a', toExpenseId: 'expense-b' },
        });

        expect(next.importSettings.categoryMappings.map(m => [m.id, m.expenseId])).toEqual([
            ['c1', 'unrelated'],
            ['c2', 'unrelated'],
            ['a1', 'expense-b'],
        ]);
    });

    it('keeps duplicates that already sat on the TARGET category', () => {
        // Same scoping rule from the other side: only the moved rule can be dropped.
        const state = stateWith([
            rule('b1', 'AMAZON', 'misc-new'),
            rule('b2', 'AMAZON', 'misc-new'),   // pre-existing duplicate on the target
            rule('r1', 'AMAZON', 'misc-old'),   // moved -> collides -> dropped
            rule('r2', 'TARGET', 'misc-old'),
        ]);

        const next = budgetReducer(state, {
            type: 'REASSIGN_CATEGORY_MAPPINGS',
            payload: { fromExpenseId: 'misc-old', toExpenseId: 'misc-new' },
        });

        expect(next.importSettings.categoryMappings.map(m => m.id)).toEqual(['b1', 'b2', 'r2']);
    });

    it('collapses two identical rules that are moved together', () => {
        const state = stateWith([
            rule('r1', 'AMAZON', 'misc-old'),
            rule('r2', 'amazon', 'misc-old'),
        ]);

        const next = budgetReducer(state, {
            type: 'REASSIGN_CATEGORY_MAPPINGS',
            payload: { fromExpenseId: 'misc-old', toExpenseId: 'misc-new' },
        });

        expect(next.importSettings.categoryMappings.map(m => m.id)).toEqual(['r1']);
    });

    it('keeps a same-pattern rule when the regex flag differs (they match differently)', () => {
        const state = stateWith([
            rule('r1', 'AMZN|AMAZON', 'misc-new', true),
            rule('r2', 'AMZN|AMAZON', 'misc-old', false),
        ]);

        const next = budgetReducer(state, {
            type: 'REASSIGN_CATEGORY_MAPPINGS',
            payload: { fromExpenseId: 'misc-old', toExpenseId: 'misc-new' },
        });

        expect(next.importSettings.categoryMappings.map(m => m.id)).toEqual(['r1', 'r2']);
    });

    it('returns the same state object when nothing points at the source', () => {
        const state = stateWith([rule('r1', 'AMAZON', 'groceries')]);

        const next = budgetReducer(state, {
            type: 'REASSIGN_CATEGORY_MAPPINGS',
            payload: { fromExpenseId: 'misc-old', toExpenseId: 'misc-new' },
        });

        expect(next).toBe(state);
    });

    it.each([
        ['source equals target', 'misc-old', 'misc-old'],
        ['empty source', '', 'misc-new'],
        ['empty target', 'misc-old', ''],
    ])('is a no-op for %s', (_label, fromExpenseId, toExpenseId) => {
        const state = stateWith([rule('r1', 'AMAZON', 'misc-old')]);

        const next = budgetReducer(state, {
            type: 'REASSIGN_CATEGORY_MAPPINGS',
            payload: { fromExpenseId, toExpenseId },
        });

        expect(next).toBe(state);
    });

    it('leaves transactions untouched — it only moves rules', () => {
        const month: MonthlySnapshot = {
            id: 'm1',
            month: 3,
            year: 2026,
            spending: {},
            accountBalances: {},
            contributions: {},
            transactions: [
                { id: 't1', date: new Date(2026, 2, 4), description: 'AMAZON', amount: -20, expenseId: 'misc-old' },
                { id: 't2', date: new Date(2026, 2, 5), description: 'AMAZON', amount: -30 },
            ],
            reconciled: false,
            createdAt: new Date(),
            updatedAt: new Date(),
        };
        const state = stateWith([rule('r1', 'AMAZON', 'misc-old')], [month]);

        const next = budgetReducer(state, {
            type: 'REASSIGN_CATEGORY_MAPPINGS',
            payload: { fromExpenseId: 'misc-old', toExpenseId: 'misc-new' },
        });

        expect(next.months).toBe(state.months);
        expect(next.months[0].transactions[0].expenseId).toBe('misc-old');
        expect(next.months[0].transactions[1].expenseId).toBeUndefined();
    });

    it('can move rules off the transfer pseudo-category onto a real expense', () => {
        const state = stateWith([rule('r1', 'VENMO', '__TRANSFER__')]);

        const next = budgetReducer(state, {
            type: 'REASSIGN_CATEGORY_MAPPINGS',
            payload: { fromExpenseId: '__TRANSFER__', toExpenseId: 'misc-new' },
        });

        expect(next.importSettings.categoryMappings[0].expenseId).toBe('misc-new');
    });
});
