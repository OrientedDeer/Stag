/**
 * #201 follow-up — the multi-mortgage Itemized warning must be visible on the
 * Accounts and Expenses tabs, not just Taxes: mortgages are created from those
 * two tabs, and the engine SUMS interest across every mortgage flagged
 * Itemized (it does not reconcile down to the larger loan), so a
 * wrongly-flagged mortgage silently inflates the deduction with nothing on
 * screen unless the user happens to open Taxes.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import '@testing-library/jest-dom';
import { MultiMortgageItemizeWarning } from '../../../../components/Objects/Expense/MultiMortgageItemizeWarning';
import ExpenseTab from '../../../../tabs/Current/ExpenseTab';
import AccountTab from '../../../../tabs/Current/AccountTab';
import { ExpenseContext, ExpenseDispatchContext } from '../../../../components/Objects/Expense/ExpenseContext';
import { AccountContext, AccountDispatchContext } from '../../../../components/Objects/Accounts/AccountContext';
import { MortgageExpense } from '../../../../components/Objects/Expense/models';
import type { AnyExpense } from '../../../../components/Objects/Expense/models';

const WARNING_TITLE = /Multiple mortgages set to Itemized/;

function mortgage(
    id: string,
    deductible: 'Itemized' | 'No' = 'Itemized',
    startYearsAgo = 2,
    endYearsAgo?: number,
): MortgageExpense {
    const m = new MortgageExpense(
        id, `Home ${id}`, 'Monthly', 500_000, 400_000, 400_000, 6.0, 30,
        1.0, 0, 1.0, 0, 0.5, 0.5, 0, deductible, 0, `acc-${id}`,
        new Date(new Date().getFullYear() - startYearsAgo, 0, 1), 0, 0,
    );
    if (endYearsAgo !== undefined) {
        m.endDate = new Date(new Date().getFullYear() - endYearsAgo, 0, 1);
    }
    return m;
}

function withExpenses(expenses: AnyExpense[], children: React.ReactNode) {
    return (
        <ExpenseContext.Provider value={{ expenses }}>
            <ExpenseDispatchContext.Provider value={vi.fn()}>
                {children}
            </ExpenseDispatchContext.Provider>
        </ExpenseContext.Provider>
    );
}

describe('MultiMortgageItemizeWarning', () => {
    it('warns when 2+ active mortgages are flagged Itemized', () => {
        render(withExpenses([mortgage('M1'), mortgage('M2')], <MultiMortgageItemizeWarning />));
        expect(screen.getByText(WARNING_TITLE)).toBeInTheDocument();
        expect(screen.getByText(/2 mortgages are marked Itemized/)).toBeInTheDocument();
    });

    it('stays silent with a single itemized mortgage', () => {
        render(withExpenses([mortgage('M1'), mortgage('M2', 'No')], <MultiMortgageItemizeWarning />));
        expect(screen.queryByText(WARNING_TITLE)).not.toBeInTheDocument();
    });

    it('ignores mortgages no longer active this year', () => {
        render(withExpenses(
            [mortgage('M1'), mortgage('M2', 'Itemized', 20, 5)],
            <MultiMortgageItemizeWarning />,
        ));
        expect(screen.queryByText(WARNING_TITLE)).not.toBeInTheDocument();
    });

    it('appears on the Expenses tab', () => {
        render(<MemoryRouter>{withExpenses([mortgage('M1'), mortgage('M2')], <ExpenseTab />)}</MemoryRouter>);
        expect(screen.getByText(WARNING_TITLE)).toBeInTheDocument();
    });

    it('appears on the Accounts tab', () => {
        render(
            <MemoryRouter>
                <AccountContext.Provider value={{ accounts: [], amountHistory: {} }}>
                    <AccountDispatchContext.Provider value={{ dispatch: vi.fn(), exportData: vi.fn(), importData: vi.fn() }}>
                        {withExpenses([mortgage('M1'), mortgage('M2')], <AccountTab />)}
                    </AccountDispatchContext.Provider>
                </AccountContext.Provider>
            </MemoryRouter>
        );
        expect(screen.getByText(WARNING_TITLE)).toBeInTheDocument();
    });
});
