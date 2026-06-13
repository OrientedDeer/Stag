import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import TaxesTab from '../../../tabs/Current/TaxesTab';
import { IncomeContext } from '../../../components/Objects/Income/IncomeContext';
import { ExpenseContext } from '../../../components/Objects/Expense/ExpenseContext';
import { TaxContext, defaultTaxState } from '../../../components/Objects/Taxes/TaxContext';
import type { TaxState } from '../../../components/Objects/Taxes/TaxContext';
import { AssumptionsContext, defaultAssumptions } from '../../../components/Objects/Assumptions/AssumptionsContext';
import { WorkIncome } from '../../../components/Objects/Income/models';
import type { AnyIncome } from '../../../components/Objects/Income/models';
import type { AnyExpense } from '../../../components/Objects/Expense/models';

function renderTaxesTab(taxState: Partial<TaxState> = {}, incomes: AnyIncome[] = [], expenses: AnyExpense[] = []) {
    const dispatch = vi.fn();
    render(
        <IncomeContext.Provider value={{ incomes }}>
            <ExpenseContext.Provider value={{ expenses }}>
                <AssumptionsContext.Provider value={{ state: defaultAssumptions, dispatch }}>
                    <TaxContext.Provider value={{ state: { ...defaultTaxState, ...taxState }, dispatch }}>
                        <TaxesTab />
                    </TaxContext.Provider>
                </AssumptionsContext.Provider>
            </ExpenseContext.Provider>
        </IncomeContext.Provider>
    );
    return { dispatch };
}

describe('TaxesTab', () => {
    it('renders without throwing when the selected state/year/filing combo is absent from the tax DB', () => {
        // "Nevada" is not a key in TAX_DATABASE.states, so stateParams resolves
        // to undefined. Before the guard, line 69 dereffed stateParams.standardDeduction
        // and threw on render (#65 A3).
        expect(() =>
            renderTaxesTab({ stateResidency: 'Nevada' })
        ).not.toThrow();
        // State tax falls back to $0 for the unknown jurisdiction.
        expect(screen.getByText(/Nevada State Tax/)).toBeInTheDocument();
    });

    it('renders the hero numbers and tax breakdown for a normal income', () => {
        const incomes: AnyIncome[] = [
            new WorkIncome('INC-1', 'Salary', 100000, 'Annually', 'Yes', 0, 0, 0, 0, ''),
        ];
        renderTaxesTab({}, incomes);
        expect(screen.getByText('Estimated Net Pay (Annual)')).toBeInTheDocument();
        expect(screen.getByText('Effective Rate')).toBeInTheDocument();
        expect(screen.getByText('Net Take Home')).toBeInTheDocument();
        expect(screen.getByText(/Federal Income Tax/)).toBeInTheDocument();
    });

    it('shows an Employer Match (post-tax) line when a Roth employer match is present', () => {
        // WorkIncome with a Roth employer match routed to an account produces a
        // post-tax employer-match component that netPaycheck subtracts. Without
        // the new line the column would not reconcile to Net Take Home (#64 C1).
        const incomes: AnyIncome[] = [
            new WorkIncome(
                'INC-1', 'Salary', 120000, 'Annually',
                'Yes', 0, 0, 0,
                /* employerMatch */ 5000, /* matchAccountId */ 'ACC-ROTH',
                /* taxType */ 'Roth 401k',
            ),
        ];
        renderTaxesTab({}, incomes);
        expect(screen.getByText('Employer Match (post-tax)')).toBeInTheDocument();
    });
});
