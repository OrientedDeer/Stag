import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import PriorityTab from '../../../tabs/Future/PriorityTab';
import {
    AssumptionsContext,
    defaultAssumptions,
    PriorityBucket,
} from '../../../components/Objects/Assumptions/AssumptionsContext';
import { ExpenseContext } from '../../../components/Objects/Expense/ExpenseContext';
import { OtherExpense } from '../../../components/Objects/Expense/models';
import { AccountContext } from '../../../components/Objects/Accounts/AccountContext';
import { SavedAccount } from '../../../components/Objects/Accounts/models';
import { ReceiptToastProvider } from '../../../components/Layout/Overlays/ReceiptToast';

function renderWithPriorities(priorities: PriorityBucket[], dispatch = vi.fn()) {
    const expenses = [new OtherExpense('e1', 'Rent', 1000, 'Monthly', new Date(2024, 0, 1))];
    const state = { ...defaultAssumptions, priorities };
    render(
        <ReceiptToastProvider>
            <AssumptionsContext.Provider value={{ state, dispatch }}>
                <ExpenseContext.Provider value={{ expenses }}>
                    <PriorityTab />
                </ExpenseContext.Provider>
            </AssumptionsContext.Provider>
        </ReceiptToastProvider>
    );
    return { dispatch };
}

describe('PriorityTab allocation waterfall provenance (C2)', () => {
    it('shows a short label instead of arithmetic-in-prose', () => {
        renderWithPriorities([
            { id: 'b1', name: 'Save monthly', type: 'SAVINGS', capType: 'FIXED', capValue: 500 },
        ]);

        // Short label, not "2x Expenses (Target: $X - Current: $Y)".
        expect(screen.getByText('Fixed monthly')).toBeInTheDocument();
        // A provenance Tooltip help button accompanies the bucket.
        expect(screen.getAllByLabelText('Help').length).toBeGreaterThan(0);
    });

    it('labels an emergency-fund bucket with its multiple and a tooltip', () => {
        renderWithPriorities([
            { id: 'b2', name: 'Rainy day', type: 'SAVINGS', capType: 'MULTIPLE_OF_EXPENSES', capValue: 6 },
        ]);

        expect(screen.getByText('Emergency fund (6× expenses)')).toBeInTheDocument();
    });
});

describe('PriorityTab reorder/delete feedback (B3)', () => {
    it('fires a ReceiptToast on bucket delete', () => {
        renderWithPriorities([
            { id: 'b3', name: 'Save monthly', type: 'SAVINGS', capType: 'FIXED', capValue: 500 },
        ]);

        fireEvent.click(screen.getByTitle('Delete'));

        const toast = screen.getByRole('status');
        expect(within(toast).getByText(/projection updated/)).toBeInTheDocument();
        expect(within(toast).getByText(/Removed "Save monthly"/)).toBeInTheDocument();
    });

    it('fires a ReceiptToast when a new priority is added', () => {
        const dispatch = vi.fn();
        const expenses = [new OtherExpense('e1', 'Rent', 1000, 'Monthly', new Date(2024, 0, 1))];
        const accounts = [new SavedAccount('acc1', 'Emergency Savings', 5000)];
        render(
            <ReceiptToastProvider>
                <AssumptionsContext.Provider value={{ state: { ...defaultAssumptions }, dispatch }}>
                    <AccountContext.Provider value={{ accounts, amountHistory: {} }}>
                        <ExpenseContext.Provider value={{ expenses }}>
                            <PriorityTab />
                        </ExpenseContext.Provider>
                    </AccountContext.Provider>
                </AssumptionsContext.Provider>
            </ReceiptToastProvider>
        );

        // Open the add form, then add (account preselects, type defaults to MAX).
        fireEvent.click(screen.getByText('Add Priority'));
        fireEvent.click(screen.getByRole('button', { name: 'Add' }));

        expect(dispatch).toHaveBeenCalledWith(
            expect.objectContaining({ type: 'ADD_PRIORITY' })
        );
        const toast = screen.getByRole('status');
        expect(within(toast).getByText(/Allocation added/)).toBeInTheDocument();
    });
});
