import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import PriorityTab from '../../../tabs/Future/PriorityTab';
import { ExpenseContext } from '../../../components/Objects/Expense/ExpenseContext';
import { AccountContext } from '../../../components/Objects/Accounts/AccountContext';
import { IncomeContext } from '../../../components/Objects/Income/IncomeContext';
import { TaxContext, defaultTaxState } from '../../../components/Objects/Taxes/TaxContext';
import {
    AssumptionsContext,
    defaultAssumptions,
    createBuiltinMilestones,
    PriorityBucket,
} from '../../../components/Objects/Assumptions/AssumptionsContext';
import { OtherExpense } from '../../../components/Objects/Expense/models';
import { InvestedAccount } from '../../../components/Objects/Accounts/models';

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

/**
 * #189: HSA contribution limit must follow the filer's coverage tier (MFJ →
 * family, ~$8.5k vs the self-only ~$4.3k). The cap was hardcoded 'individual',
 * so a legal family-tier FIXED HSA contribution (e.g. $600/mo = $7,200/yr) was
 * falsely flagged "Exceeds … HSA limit" for a married filer.
 */
describe('PriorityTab HSA cap follows filing status (#189)', () => {
    // $7,200/yr sits above the self-only HSA limit (~$4.3k) but below the family
    // limit (~$8.5k), so the flag flips purely on coverage.
    const hsa = new InvestedAccount('hsa1', 'HSA', 10000, 0, 5, 0.1, 'HSA', true, 0.2, 10000);
    const bucket: PriorityBucket = {
        id: 'b1', name: 'HSA Contribution', type: 'INVESTMENT',
        accountId: 'hsa1', capType: 'FIXED', capValue: 600, // $600/mo → $7,200/yr
    };

    function renderWithFiling(filingStatus: 'Single' | 'Married Filing Jointly') {
        const state = {
            ...defaultAssumptions,
            milestones: createBuiltinMilestones(1985, 65, 90), // age ~41, no HSA catch-up
            priorities: [bucket],
        };
        return render(
            <AssumptionsContext.Provider value={{ state, dispatch: () => null } as never}>
                <AccountContext.Provider value={{ accounts: [hsa] } as never}>
                    <IncomeContext.Provider value={{ incomes: [] } as never}>
                        <ExpenseContext.Provider value={{ expenses: [] } as never}>
                            <TaxContext.Provider value={{ state: { ...defaultTaxState, filingStatus }, dispatch: () => null } as never}>
                                <PriorityTab />
                            </TaxContext.Provider>
                        </ExpenseContext.Provider>
                    </IncomeContext.Provider>
                </AccountContext.Provider>
            </AssumptionsContext.Provider>
        );
    }

    it('does NOT flag a $7,200/yr family-tier HSA contribution for a married filer', () => {
        renderWithFiling('Married Filing Jointly');
        expect(screen.queryByText(/Exceeds .*HSA limit/)).toBeNull();
    });

    it('DOES flag the same $7,200/yr contribution for a single (self-only) filer', () => {
        renderWithFiling('Single');
        expect(screen.getByText(/Exceeds .*HSA limit/)).toBeInTheDocument();
    });
});
