import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import PriorityTab from '../../../tabs/Future/PriorityTab';
import { ExpenseContext } from '../../../components/Objects/Expense/ExpenseContext';
import { OtherExpense } from '../../../components/Objects/Expense/models';

describe('PriorityTab monthly expense label', () => {
    it('labels the committed-expenses figure as "this month"', () => {
        // The Committed Expenses summary only renders when expenses exist.
        const expenses = [new OtherExpense('e1', 'Rent', 1000, 'Monthly', new Date(2024, 0, 1))];

        render(
            <ExpenseContext.Provider value={{ expenses }}>
                <PriorityTab />
            </ExpenseContext.Provider>
        );

        expect(screen.getByText('Committed Expenses')).toBeInTheDocument();
        // Today's active expenses — deliberately distinct from the Dashboard's
        // annualized "avg/mo this year" figure.
        expect(screen.getByText('this month')).toBeInTheDocument();
    });
});
