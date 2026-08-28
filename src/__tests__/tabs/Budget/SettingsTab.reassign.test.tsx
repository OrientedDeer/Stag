/**
 * SettingsTab "Reassign Rules" (#209): the user ends an expense, recreates it,
 * and needs every categorization rule repointed at the replacement in bulk.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { type ReactNode } from 'react';
import SettingsTab from '../../../tabs/Budget/SettingsTab';
import { BudgetContext } from '../../../components/Objects/Budget/BudgetContext';
import type { BudgetState, CategoryMapping, MonthlySnapshot } from '../../../components/Objects/Budget/BudgetTypes';
import { ExpenseContext } from '../../../components/Objects/Expense/ExpenseContext';
import { OtherExpense, type AnyExpense } from '../../../components/Objects/Expense/models';

// Headless UI's Listbox doesn't open via fireEvent in jsdom (its state machine
// ignores synthetic pointer events), so swap DropdownInput for a native select.
// The dropdown widget itself is covered by its own suite.
vi.mock('../../../components/Layout/InputFields/DropdownInput', () => ({
    DropdownInput: ({ label, value, onChange, options }: {
        label: string;
        value: string;
        onChange: (val: string) => void;
        options: ({ value: string; label: string } | string)[];
    }) => (
        <label>
            {label}
            <select value={value} onChange={e => onChange(e.target.value)}>
                {options.map(opt => {
                    const normalized = typeof opt === 'string' ? { value: opt, label: opt } : opt;
                    return (
                        <option key={normalized.value} value={normalized.value}>
                            {normalized.label}
                        </option>
                    );
                })}
            </select>
        </label>
    ),
}));

const rule = (id: string, pattern: string, expenseId: string): CategoryMapping => ({
    id, pattern, expenseId, isRegex: false,
});

const MISC_OLD = new OtherExpense('misc-old', 'Misc (old)', 100, 'Monthly', new Date(2020, 0, 1), new Date(2025, 11, 31));
const MISC_NEW = new OtherExpense('misc-new', 'Misc', 120, 'Monthly', new Date(2026, 0, 1));
const GROCERIES = new OtherExpense('groceries', 'Groceries', 500, 'Monthly');

const dispatch = vi.fn();

function renderSettings(mappings: CategoryMapping[], expenses: AnyExpense[] = [MISC_OLD, MISC_NEW, GROCERIES]) {
    const budgetValue = {
        months: [] as MonthlySnapshot[],
        importSettings: {
            dateColumn: 'Date',
            amountColumn: 'Amount',
            descriptionColumn: 'Description',
            categoryMappings: mappings,
            savedCSVFormats: [],
            autoCreateRules: false,
        },
        selectedMonth: 1,
        selectedYear: 2026,
        dispatch,
        getOrCreateMonth: () => ({} as MonthlySnapshot),
        getCurrentMonth: () => undefined,
    } as unknown as BudgetState & { dispatch: typeof dispatch };

    const wrapper = ({ children }: { children: ReactNode }) => (
        <ExpenseContext.Provider value={{ expenses }}>
            <BudgetContext.Provider value={budgetValue as never}>
                {children}
            </BudgetContext.Provider>
        </ExpenseContext.Provider>
    );
    const utils = render(<SettingsTab />, { wrapper });
    // The rules panel is collapsed by default.
    fireEvent.click(screen.getByText('Auto-categorization Rules'));
    return utils;
}

const openReassign = () => fireEvent.click(screen.getByRole('button', { name: 'Reassign Rules' }));
const fromSelect = () => screen.getByLabelText('From category');
const toSelect = () => screen.getByLabelText('To category');

const threeRules = [
    rule('r1', 'AMAZON', 'misc-old'),
    rule('r2', 'TARGET', 'misc-old'),
    rule('r3', 'SAFEWAY', 'groceries'),
];

describe('SettingsTab — bulk rule reassignment', () => {
    beforeEach(() => dispatch.mockClear());

    it('warns about rules stranded on an ended expense', () => {
        renderSettings(threeRules);
        expect(screen.getByText('Rules point at categories you no longer use')).toBeInTheDocument();
        expect(screen.getByText('Misc (old) (ended): 2 rules')).toBeInTheDocument();
    });

    it('warns about rules pointing at a deleted expense', () => {
        renderSettings([rule('r1', 'AMAZON', 'gone-forever')]);
        expect(screen.getByText('Deleted category: 1 rule')).toBeInTheDocument();
    });

    it('shows no warning when every rule points at a live expense', () => {
        renderSettings([rule('r3', 'SAFEWAY', 'groceries')]);
        expect(screen.queryByText('Rules point at categories you no longer use')).not.toBeInTheDocument();
    });

    it('reports how many rules the selected source will move', () => {
        renderSettings(threeRules);
        openReassign();
        expect(screen.getByTestId('reassign-count')).toHaveTextContent('Pick the category whose rules should move.');

        fireEvent.change(fromSelect(), { target: { value: 'misc-old' } });
        expect(screen.getByTestId('reassign-count')).toHaveTextContent('2 rules will be repointed.');

        fireEvent.change(fromSelect(), { target: { value: 'groceries' } });
        expect(screen.getByTestId('reassign-count')).toHaveTextContent('1 rule will be repointed.');
    });

    it('labels the source options with their rule counts and ended state', () => {
        renderSettings(threeRules);
        openReassign();
        const labels = Array.from(fromSelect().querySelectorAll('option')).map(o => o.textContent);
        expect(labels).toContain('Misc (old) (ended) — 2 rules');
        expect(labels).toContain('Groceries — 1 rule');
    });

    it('excludes the chosen source from the target list', () => {
        renderSettings(threeRules);
        openReassign();
        fireEvent.change(fromSelect(), { target: { value: 'misc-old' } });
        const values = Array.from(toSelect().querySelectorAll('option')).map(o => (o as HTMLOptionElement).value);
        expect(values).not.toContain('misc-old');
        expect(values).toEqual(expect.arrayContaining(['misc-new', 'groceries']));
    });

    it('dispatches ONE bulk action for the whole move', () => {
        renderSettings(threeRules);
        openReassign();
        fireEvent.change(fromSelect(), { target: { value: 'misc-old' } });
        fireEvent.change(toSelect(), { target: { value: 'misc-new' } });
        fireEvent.click(screen.getByRole('button', { name: 'Reassign 2 rules' }));

        expect(dispatch).toHaveBeenCalledTimes(1);
        expect(dispatch).toHaveBeenCalledWith({
            type: 'REASSIGN_CATEGORY_MAPPINGS',
            payload: { fromExpenseId: 'misc-old', toExpenseId: 'misc-new' },
        });
    });

    it('does not touch existing transactions unless re-apply is opted into', () => {
        renderSettings(threeRules);
        openReassign();
        fireEvent.change(fromSelect(), { target: { value: 'misc-old' } });
        fireEvent.change(toSelect(), { target: { value: 'misc-new' } });
        fireEvent.click(screen.getByRole('button', { name: 'Reassign 2 rules' }));

        expect(dispatch.mock.calls.some(c => c[0].type === 'APPLY_CATEGORY_RULE')).toBe(false);
    });

    it('re-applies the moved rules against the NEW expense window when opted in', () => {
        renderSettings(threeRules);
        openReassign();
        fireEvent.change(fromSelect(), { target: { value: 'misc-old' } });
        fireEvent.change(toSelect(), { target: { value: 'misc-new' } });
        // The label also wraps a tooltip "?" button, so pin the toggle by id.
        fireEvent.click(screen.getByLabelText('Also re-apply to uncategorized transactions', {
            selector: '#reassign-reapply',
        }));
        fireEvent.click(screen.getByRole('button', { name: 'Reassign 2 rules' }));

        const applies = dispatch.mock.calls
            .map(c => c[0])
            .filter(a => a.type === 'APPLY_CATEGORY_RULE');
        expect(applies).toHaveLength(2);
        for (const action of applies) {
            expect(action.payload.expenseId).toBe('misc-new');
            // The replacement expense's window, not the ended one's.
            expect(action.payload.expenseStart).toEqual(MISC_NEW.startDate);
            expect(action.payload.expenseEnd).toBeUndefined();
        }
        expect(applies.map(a => a.payload.pattern).sort()).toEqual(['AMAZON', 'TARGET']);
    });

    it('keeps the confirm button disabled until a valid pair is chosen', () => {
        renderSettings(threeRules);
        openReassign();
        expect(screen.getByRole('button', { name: 'Reassign' })).toBeDisabled();

        fireEvent.change(fromSelect(), { target: { value: 'misc-old' } });
        expect(screen.getByRole('button', { name: 'Reassign 2 rules' })).toBeDisabled();

        fireEvent.change(toSelect(), { target: { value: 'misc-new' } });
        expect(screen.getByRole('button', { name: 'Reassign 2 rules' })).toBeEnabled();
    });

    it('opens the form pre-pointed at the stranded category from the warning banner', () => {
        renderSettings(threeRules);
        fireEvent.click(screen.getByRole('button', { name: 'Reassign them to another category' }));
        expect(fromSelect()).toHaveValue('misc-old');
        expect(screen.getByTestId('reassign-count')).toHaveTextContent('2 rules will be repointed.');
    });

    it('closes and clears the form on cancel', () => {
        renderSettings(threeRules);
        openReassign();
        fireEvent.change(fromSelect(), { target: { value: 'misc-old' } });
        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

        expect(screen.queryByLabelText('From category')).not.toBeInTheDocument();
        expect(dispatch).not.toHaveBeenCalled();

        openReassign();
        expect(fromSelect()).toHaveValue('');
    });

    it('offers no reassign control when there are no rules at all', () => {
        renderSettings([]);
        expect(screen.queryByRole('button', { name: 'Reassign Rules' })).not.toBeInTheDocument();
    });
});
