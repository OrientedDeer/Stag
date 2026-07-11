/**
 * #201 — every itemized mortgage shares one $750k acquisition-debt cap and the
 * engine SUMS interest across every mortgage flagged Itemized (it does not
 * reconcile down to the larger loan), so a wrongly-flagged mortgage silently
 * inflates the deduction. The warning must sit ON the mortgage producing it:
 *  - a header badge on each offending mortgage's ExpenseCard (visible collapsed),
 *    with the full banner in the expanded body;
 *  - a header badge on the linked PropertyAccount's AccountCard, pointing at the
 *    mortgage's card in the Expenses tab (the fix lives on the expense);
 *  - the full banner still renders in deduction context on the Taxes tab.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import '@testing-library/jest-dom';
import {
    MultiMortgageItemizeWarning,
    getActiveItemizedMortgages,
} from '../../../../components/Objects/Expense/MultiMortgageItemizeWarning';
import ExpenseTab from '../../../../tabs/Current/ExpenseTab';
import AccountTab from '../../../../tabs/Current/AccountTab';
import { ExpenseContext, ExpenseDispatchContext } from '../../../../components/Objects/Expense/ExpenseContext';
import { AccountContext, AccountDispatchContext } from '../../../../components/Objects/Accounts/AccountContext';
import { MortgageExpense } from '../../../../components/Objects/Expense/models';
import type { AnyExpense } from '../../../../components/Objects/Expense/models';
import { PropertyAccount } from '../../../../components/Objects/Accounts/models';
import type { AnyAccount } from '../../../../components/Objects/Accounts/models';

const WARNING_TITLE = /Multiple Mortgages Set to Itemized/;
const BADGE_LABEL = 'Shared $750k cap';

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

/** A property account whose id matches the mortgage's `linkedAccountId` (acc-<id>). */
function property(mortgageId: string): PropertyAccount {
    return new PropertyAccount(`acc-${mortgageId}`, `Home ${mortgageId}`, 500_000, 'Financed', 400_000, 400_000, mortgageId);
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

function withAccounts(accounts: AnyAccount[], children: React.ReactNode) {
    return (
        <AccountContext.Provider value={{ accounts, amountHistory: {} }}>
            <AccountDispatchContext.Provider value={{ dispatch: vi.fn(), exportData: vi.fn(), importData: vi.fn() }}>
                {children}
            </AccountDispatchContext.Provider>
        </AccountContext.Provider>
    );
}

describe('getActiveItemizedMortgages', () => {
    const year = new Date().getFullYear();

    it('returns every active Itemized mortgage', () => {
        const set = getActiveItemizedMortgages([mortgage('M1'), mortgage('M2')], year);
        expect(set.map((m) => m.id)).toEqual(['M1', 'M2']);
    });

    it('excludes mortgages not flagged Itemized', () => {
        const set = getActiveItemizedMortgages([mortgage('M1'), mortgage('M2', 'No')], year);
        expect(set.map((m) => m.id)).toEqual(['M1']);
    });

    it('excludes mortgages no longer active this year', () => {
        const set = getActiveItemizedMortgages([mortgage('M1'), mortgage('M2', 'Itemized', 20, 5)], year);
        expect(set.map((m) => m.id)).toEqual(['M1']);
    });
});

describe('MultiMortgageItemizeWarning', () => {
    it('warns when 2+ active mortgages are flagged Itemized', () => {
        render(withExpenses([mortgage('M1'), mortgage('M2')], <MultiMortgageItemizeWarning />));
        expect(screen.getByText(WARNING_TITLE)).toBeInTheDocument();
        expect(screen.getByText(/one shared/)).toBeInTheDocument();
        // The shared $750,000 acquisition-debt cap is called out.
        expect(screen.getByText('$750,000')).toBeInTheDocument();
    });

    it('names each affected mortgage in the list', () => {
        render(withExpenses([mortgage('M1'), mortgage('M2')], <MultiMortgageItemizeWarning />));
        expect(screen.getByText('Home M1')).toBeInTheDocument();
        expect(screen.getByText('Home M2')).toBeInTheDocument();
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
});

describe('Expenses tab — warning lives on the mortgage cards', () => {
    it('badges every offending mortgage card, with no page-top banner before expanding', () => {
        render(<MemoryRouter>{withExpenses([mortgage('M1'), mortgage('M2')], <ExpenseTab />)}</MemoryRouter>);
        // A badge sits on each collapsed mortgage card…
        expect(screen.getAllByText(BADGE_LABEL)).toHaveLength(2);
        // …and the full banner only appears once a card is expanded (its body).
        expect(screen.queryByText(WARNING_TITLE)).not.toBeInTheDocument();
    });

    it('shows no badge when only one mortgage is itemized', () => {
        render(<MemoryRouter>{withExpenses([mortgage('M1'), mortgage('M2', 'No')], <ExpenseTab />)}</MemoryRouter>);
        expect(screen.queryByText(BADGE_LABEL)).not.toBeInTheDocument();
    });
});

describe('Accounts tab — badge on the linked property card', () => {
    // Property accounts live under the "Property" sub-tab; select it so the cards render.
    beforeEach(() => localStorage.setItem('account_active_tab', 'Property'));

    it('badges the property accounts linked to the offending mortgages', () => {
        render(
            <MemoryRouter>
                {withAccounts([property('M1'), property('M2')],
                    withExpenses([mortgage('M1'), mortgage('M2')], <AccountTab />))}
            </MemoryRouter>
        );
        expect(screen.getAllByText(BADGE_LABEL)).toHaveLength(2);
    });

    it('shows no badge when only one mortgage is itemized', () => {
        render(
            <MemoryRouter>
                {withAccounts([property('M1'), property('M2')],
                    withExpenses([mortgage('M1'), mortgage('M2', 'No')], <AccountTab />))}
            </MemoryRouter>
        );
        expect(screen.queryByText(BADGE_LABEL)).not.toBeInTheDocument();
    });
});
