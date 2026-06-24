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

describe('TaxesTab year guard', () => {
    // A backup whose tax `year` is not a key in TAX_DATABASE.federal (a
    // forward-dated or hand-edited export) is loaded verbatim via SET_BULK_DATA
    // with no clamp. Before the guard, line 128 dereffed
    // TAX_DATABASE.federal[taxYear][filingStatus] with no optional chaining, so
    // federal[<unknown year>] was undefined and undefined[filingStatus] threw —
    // white-screening the whole route and persisting across reloads.

    it('renders without throwing for a future year not in the tax DB', () => {
        const incomes: AnyIncome[] = [
            new WorkIncome('INC-1', 'Salary', 100000, 'Annually', 'Yes', 0, 0, 0, 0, ''),
        ];
        expect(() =>
            renderTaxesTab({ year: 2099 }, incomes)
        ).not.toThrow();
        // The breakdown still renders against a fallback set of parameters.
        expect(screen.getByText(/Federal Income Tax/)).toBeInTheDocument();
    });

    it('renders without throwing for an old year not in the tax DB', () => {
        expect(() =>
            renderTaxesTab({ year: 1990 })
        ).not.toThrow();
        expect(screen.getByText('Estimated Net Pay (Annual)')).toBeInTheDocument();
    });
});
