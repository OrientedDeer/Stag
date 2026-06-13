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
}: {
    incomes?: AnyIncome[];
    expenses?: AnyExpense[];
} = {}) {
    const dispatch = vi.fn();
    render(
        <AssumptionsContext.Provider value={{ state: baseState, dispatch }}>
            <IncomeContext.Provider value={{ incomes }}>
                <ExpenseContext.Provider value={{ expenses }}>
                    <MilestoneModal isOpen={true} onClose={() => {}} />
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
