import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import ExpenseCard from '../../../../components/Objects/Expense/ExpenseCard';
import { MortgageExpense, LoanExpense, OtherExpense } from '../../../../components/Objects/Expense/models';

// ExpenseCard's contexts (Expense/Account/Assumptions) all have safe defaults,
// so these render-only tests need no providers — sections and the expandable
// card shell are purely local state.

function makeMortgage(overrides: Partial<MortgageExpense> = {}): MortgageExpense {
    const mortgage = new MortgageExpense(
        'mort-1', 'Home', 'Monthly',
        500_000,   // valuation
        320_000,   // loan_balance
        400_000,   // starting_loan_balance
        6.2,       // apr
        30,        // term_length
        1.2,       // property_taxes %
        0,         // valuation_deduction
        0,         // maintenance %
        200,       // utilities $/mo
        0.3,       // home_owners_insurance %
        0.5,       // pmi %
        100,       // hoa_fee $/mo
        'Itemized',
        0,
        'acct-prop-1',
    );
    return Object.assign(mortgage, overrides);
}

function expandCard(name: string): void {
    fireEvent.click(screen.getByRole('button', { name: `Expand ${name} expense details` }));
}

describe('ExpenseCard collapsible sections', () => {
    describe('MortgageFields', () => {
        it('shows paystub-style summaries with sections collapsed by default', () => {
            render(<ExpenseCard expense={makeMortgage()} />);
            expandCard('Home');

            // Loan: current balance @ APR · term (no extra-payment suffix at $0).
            expect(screen.getByText('$320,000 @ 6.2% · 30 yr')).toBeInTheDocument();
            // Escrow extras: 500 tax + 125 insurance + 100 HOA + 200 utilities
            // (PMI skipped — LTV 64% is under the 80% cutoff).
            expect(screen.getByText('$925/mo extras')).toBeInTheDocument();
            // Tax treatment echoes the select value.
            expect(screen.getByText('Itemized')).toBeInTheDocument();

            // Section fields stay hidden until the section is opened.
            expect(screen.queryByLabelText(/Current Loan Balance/)).not.toBeInTheDocument();
            expect(screen.queryByLabelText(/Property Taxes/)).not.toBeInTheDocument();
        });

        it('keeps Valuation, linked property, reset button, and PMI warning outside sections', () => {
            render(<ExpenseCard expense={makeMortgage()} />);
            expandCard('Home');

            expect(screen.getByLabelText(/Valuation/, { selector: 'input' })).toBeInTheDocument();
            expect(screen.getByText('Linked to Property')).toBeInTheDocument();
            expect(screen.getByRole('button', { name: 'Reset Loan Balance to Today' })).toBeInTheDocument();
            // 36% equity with PMI > 0 — the warning must show without expanding anything.
            expect(screen.getByText(/eligible to have your PMI removed/)).toBeInTheDocument();
        });

        it('reveals fields when a section is expanded and includes the extra payment in the summary', () => {
            render(<ExpenseCard expense={makeMortgage({ extra_payment: 250 })} />);
            expandCard('Home');

            expect(screen.getByText('$320,000 @ 6.2% · 30 yr · +$250 extra')).toBeInTheDocument();

            fireEvent.click(screen.getByRole('button', {
                name: (name) => name.startsWith('Loan') && name.includes('$320,000'),
            }));
            expect(screen.getByLabelText(/Current Loan Balance/, { selector: 'input' })).toBeInTheDocument();
            expect(screen.getByLabelText(/Extra Payment/, { selector: 'input' })).toBeInTheDocument();

            fireEvent.click(screen.getByRole('button', { name: /Escrow & ownership costs/ }));
            expect(screen.getByLabelText(/Property Taxes/, { selector: 'input' })).toBeInTheDocument();
            expect(screen.getByLabelText(/HOA Fee/, { selector: 'input' })).toBeInTheDocument();
        });

        it('counts PMI in the extras total while loan-to-value is above 80%', () => {
            render(<ExpenseCard expense={makeMortgage({ loan_balance: 450_000 })} />);
            expandCard('Home');

            // 925 + PMI (500k * 0.5% / 12 ≈ 208) = 1,133; PMI warning gone at 10% equity.
            expect(screen.getByText('$1,133/mo extras')).toBeInTheDocument();
            expect(screen.queryByText(/eligible to have your PMI removed/)).not.toBeInTheDocument();
        });
    });

    describe('LoanFields', () => {
        it('groups loan inputs into a collapsed "Loan details" section with a live summary', () => {
            const loan = new LoanExpense(
                'loan-1', 'Car Loan', 15_000, 'Monthly',
                5.5, 'Simple', 450, 'No', 0, 'acct-debt-1',
            );
            render(<ExpenseCard expense={loan} />);
            expandCard('Car Loan');

            expect(screen.getByText('5.5% APR · $450/mo')).toBeInTheDocument();
            // Linked-account display stays top-level; inputs hide until expanded.
            expect(screen.getByText('Linked to Debt Account')).toBeInTheDocument();
            expect(screen.queryByLabelText(/Interest Type/)).not.toBeInTheDocument();

            fireEvent.click(screen.getByRole('button', { name: /Loan details/ }));
            expect(screen.getByLabelText(/Interest Type/, { selector: 'select' })).toBeInTheDocument();
            expect(screen.getByLabelText(/APR/, { selector: 'input' })).toBeInTheDocument();
        });
    });

    describe('long-term goal kind (issue #67)', () => {
        function makeRecurringGoal(): OtherExpense {
            const goal = new OtherExpense('goal-1', 'Roof', 12_000, 'Monthly', new Date(2026, 0, 1));
            goal.goalType = 'recurring';
            goal.intervalYears = 10;
            goal.goalAccountId = 'acc-roof-fund';
            return goal;
        }

        function makeTargetDateGoal(): OtherExpense {
            const goal = new OtherExpense(
                'goal-2', 'Car', 24_000, 'Monthly',
                new Date(2026, 0, 1), new Date(2028, 0, 1),
            );
            goal.goalType = 'targetDate';
            goal.goalAccountId = 'acc-car-fund';
            return goal;
        }

        it('exposes an editable Goal Type select and the interval input for recurring goals', () => {
            render(<ExpenseCard expense={makeRecurringGoal()} />);
            expandCard('Roof');

            // Kind is editable (a select), not the old read-only set-aside text.
            const select = screen.getByLabelText(/Goal Type/, { selector: 'select' }) as HTMLSelectElement;
            expect(select.value).toBe('Recurring every N years');

            // Recurring goals show the recurrence editor and the live set-aside.
            expect(screen.getByLabelText(/Every \(years\)/, { selector: 'input' })).toBeInTheDocument();
            // 12,000 / (10 * 12) = $100/mo.
            expect(screen.getByText('$100/mo')).toBeInTheDocument();
        });

        it('shows a Target date trigger and hides the interval input for save-by-date goals', () => {
            render(<ExpenseCard expense={makeTargetDateGoal()} />);
            expandCard('Car');

            const select = screen.getByLabelText(/Goal Type/, { selector: 'select' }) as HTMLSelectElement;
            expect(select.value).toBe('Save by date');

            // No recurrence editor for target-date goals; the End trigger is the target.
            expect(screen.queryByLabelText(/Every \(years\)/)).not.toBeInTheDocument();
            expect(screen.getByText('Target date')).toBeInTheDocument();
            // 24,000 / 24 months = $1,000/mo.
            expect(screen.getByText('$1,000/mo')).toBeInTheDocument();
        });
    });
});
