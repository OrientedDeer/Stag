import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import MilestoneModal from '../../../../components/Objects/Assumptions/MilestoneModal';
import { AssumptionsContext, defaultAssumptions } from '../../../../components/Objects/Assumptions/AssumptionsContext';
import type { AssumptionsState } from '../../../../components/Objects/Assumptions/AssumptionsContext';
import { IncomeContext } from '../../../../components/Objects/Income/IncomeContext';
import { ExpenseContext } from '../../../../components/Objects/Expense/ExpenseContext';
import type { AnyIncome } from '../../../../components/Objects/Income/models';
import { PassiveIncome } from '../../../../components/Objects/Income/models';
import type { AnyExpense } from '../../../../components/Objects/Expense/models';
import { FoodExpense, OtherExpense } from '../../../../components/Objects/Expense/models';

const CUSTOM_ID = 'MILE-TEST-1';

const baseState: AssumptionsState = {
    ...defaultAssumptions,
    milestones: [
        ...defaultAssumptions.milestones,
        { id: CUSTOM_ID, name: 'Coast FIRE', conditions: [{ type: 'NET_WORTH', operator: '>=', value: 750000 }] },
    ],
};

function renderModal({
    incomes = [],
    expenses = [],
    milestoneReachYears,
    birthYear,
}: {
    incomes?: AnyIncome[];
    expenses?: AnyExpense[];
    milestoneReachYears?: Map<string, number>;
    birthYear?: number;
} = {}) {
    const dispatch = vi.fn();
    render(
        <AssumptionsContext.Provider value={{ state: baseState, dispatch }}>
            <IncomeContext.Provider value={{ incomes }}>
                <ExpenseContext.Provider value={{ expenses }}>
                    <MilestoneModal
                        isOpen={true}
                        onClose={() => {}}
                        milestoneReachYears={milestoneReachYears}
                        birthYear={birthYear}
                    />
                </ExpenseContext.Provider>
            </IncomeContext.Provider>
        </AssumptionsContext.Provider>
    );
    return { dispatch };
}

describe('MilestoneModal delete impact summary', () => {
    it('deletes an unreferenced milestone immediately without a confirmation dialog', () => {
        const { dispatch } = renderModal();

        fireEvent.click(screen.getByTitle('Delete milestone'));

        expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
        expect(dispatch).toHaveBeenCalledWith({ type: 'REMOVE_MILESTONE', payload: CUSTOM_ID });
    });

    it('shows a confirmation listing affected objects when the milestone is referenced', () => {
        const expenses: AnyExpense[] = [
            new FoodExpense('EXP-1', 'Groceries', 500, 'Monthly', undefined, undefined, CUSTOM_ID, undefined),
            new OtherExpense('EXP-2', 'Hobby budget', 100, 'Monthly', undefined, undefined, undefined, CUSTOM_ID),
        ];
        const incomes: AnyIncome[] = [
            new PassiveIncome('INC-1', 'Rental income', 1000, 'Monthly', 'No', 'Rental', undefined, undefined, false, undefined, CUSTOM_ID),
        ];
        const { dispatch } = renderModal({ incomes, expenses });

        fireEvent.click(screen.getByTitle('Delete milestone'));

        // Nothing deleted yet — the confirm dialog gates it
        expect(dispatch).not.toHaveBeenCalled();
        const dialog = screen.getByRole('alertdialog');
        expect(dialog).toBeInTheDocument();

        // Warning copy with counts
        expect(screen.getByText(/2 expense\(s\) and 1 income\(s\) use this milestone as a trigger/)).toBeInTheDocument();
        expect(screen.getByText(/they will reset to End of Plan/)).toBeInTheDocument();

        // Affected objects listed by name
        expect(screen.getByText('Groceries')).toBeInTheDocument();
        expect(screen.getByText('Hobby budget')).toBeInTheDocument();
        expect(screen.getByText('Rental income')).toBeInTheDocument();
    });

    it('dispatches REMOVE_MILESTONE only after confirming, and not on cancel', () => {
        const expenses: AnyExpense[] = [
            new FoodExpense('EXP-1', 'Groceries', 500, 'Monthly', undefined, undefined, CUSTOM_ID, undefined),
        ];
        const { dispatch } = renderModal({ expenses });

        // Cancel path
        fireEvent.click(screen.getByTitle('Delete milestone'));
        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
        expect(dispatch).not.toHaveBeenCalled();
        expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();

        // Confirm path
        fireEvent.click(screen.getByTitle('Delete milestone'));
        fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
        expect(dispatch).toHaveBeenCalledWith({ type: 'REMOVE_MILESTONE', payload: CUSTOM_ID });
        expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    });

    it('lists an object once even if it references the milestone as both start and end', () => {
        const expenses: AnyExpense[] = [
            new FoodExpense('EXP-1', 'Groceries', 500, 'Monthly', undefined, undefined, CUSTOM_ID, CUSTOM_ID),
        ];
        renderModal({ expenses });

        fireEvent.click(screen.getByTitle('Delete milestone'));

        expect(screen.getAllByText('Groceries')).toHaveLength(1);
        expect(screen.getByText(/1 expense\(s\) and 0 income\(s\)/)).toBeInTheDocument();
    });
});

describe('MilestoneModal reach-year display', () => {
    it('does not render reach status when milestoneReachYears is omitted', () => {
        renderModal();
        expect(screen.queryByText(/reached/i)).not.toBeInTheDocument();
        expect(screen.queryByText(/Not reached within plan/)).not.toBeInTheDocument();
    });

    it('shows the reached year and age when the milestone is hit in the plan', () => {
        renderModal({
            milestoneReachYears: new Map([[CUSTOM_ID, 2034]]),
            birthYear: 1987,
        });
        expect(screen.getByText(/→ reached 2034 \(age 47\)/)).toBeInTheDocument();
    });

    it('shows reached year without age when birthYear is missing', () => {
        renderModal({
            milestoneReachYears: new Map([[CUSTOM_ID, 2034]]),
        });
        const reached = screen.getByText(/→ reached 2034/);
        expect(reached).toBeInTheDocument();
        expect(reached.textContent).not.toMatch(/age/);
    });

    it('shows "Not reached within plan" when the milestone is absent from reach years', () => {
        renderModal({
            milestoneReachYears: new Map(),
            birthYear: 1987,
        });
        // baseState carries built-in milestones too; none are in the empty
        // reach map, so every listed milestone shows the "not reached" copy.
        expect(screen.getAllByText('Not reached within plan').length).toBeGreaterThan(0);
        expect(screen.queryByText(/→ reached/)).not.toBeInTheDocument();
    });

    it('tags the number of expenses and incomes that trigger off the milestone', () => {
        const expenses: AnyExpense[] = [
            new FoodExpense('EXP-1', 'Groceries', 500, 'Monthly', undefined, undefined, CUSTOM_ID, undefined),
        ];
        const incomes: AnyIncome[] = [
            new PassiveIncome('INC-1', 'Rental income', 1000, 'Monthly', 'No', 'Rental', undefined, undefined, false, undefined, CUSTOM_ID),
        ];
        renderModal({
            expenses,
            incomes,
            milestoneReachYears: new Map([[CUSTOM_ID, 2034]]),
            birthYear: 1987,
        });
        expect(screen.getByText('1 expense / 1 income triggered')).toBeInTheDocument();
    });
});
