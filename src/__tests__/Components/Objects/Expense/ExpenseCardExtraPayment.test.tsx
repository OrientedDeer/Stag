import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import ExpenseCard from '../../../../components/Objects/Expense/ExpenseCard';
import { LoanExpense, MortgageExpense } from '../../../../components/Objects/Expense/models';

// ExpenseCard's contexts (Expense/Account/Assumptions) all have safe defaults,
// so these render-only tests need no providers — the collapsed header is purely
// local state.

function makeLoan(extra_payment = 0): LoanExpense {
    return new LoanExpense(
        'loan-1',      // id
        'Car Loan',    // name
        30_000,        // amount (balance)
        'Monthly',     // frequency
        5.0,           // apr
        'Compounding', // interest_type
        500,           // payment ($/mo scheduled)
        'No',          // is_tax_deductible
        0,             // tax_deductible
        'acct-debt-1', // linkedAccountId
        undefined,     // startDate
        undefined,     // endDate
        undefined,     // startMilestoneId
        undefined,     // endMilestoneId
        extra_payment, // extra monthly principal (#60 B / #144)
    );
}

// The collapsed header renders the amount and the "/mo" suffix as sibling text
// nodes in one div, so match on the div's combined text content.
function headerAmountMatcher(expected: string) {
    // Only the inner amount div has textContent exactly "$X/mo"; the parent
    // button also contains the loan name, so its textContent won't match.
    return (_content: string, element: Element | null): boolean =>
        element?.tagName === 'DIV' && element.textContent === expected;
}

describe('ExpenseCard collapsed header — loan extra payment (#144)', () => {
    it('shows payment + extra_payment when an extra payment is configured', () => {
        // Card is collapsed by default; header reflects the full monthly outflow.
        render(<ExpenseCard expense={makeLoan(150)} />);

        // 500 scheduled + 150 extra = 650 monthly outflow.
        expect(screen.getByText(headerAmountMatcher('$650/mo'))).toBeInTheDocument();
        expect(screen.queryByText(headerAmountMatcher('$500/mo'))).not.toBeInTheDocument();
    });

    it('shows just the payment when there is no extra payment', () => {
        render(<ExpenseCard expense={makeLoan(0)} />);

        expect(screen.getByText(headerAmountMatcher('$500/mo'))).toBeInTheDocument();
    });
});

// MortgageExpense.payment ALREADY includes extra_payment (the constructor rolls it
// into `payment`), unlike LoanExpense.payment which is principal+interest only.
// So the collapsed mortgage header must show the bare `payment` — adding extra
// again double-counts (#144 review fix).
function makeMortgage(extra_payment = 0): MortgageExpense {
    // apr 0 over 36,000 / 360 months ⇒ exactly $100/mo principal, no taxes/PMI/etc.,
    // so payment === 100 + extra_payment (the constructor folds extra in).
    return new MortgageExpense(
        'm1', 'Home', 'Monthly',
        100_000, // valuation
        36_000,  // loan_balance
        36_000,  // starting_loan_balance
        0,       // apr
        30,      // term_length (years)
        0, 0, 0, 0, 0, 0, 0, // property_taxes, valuation_deduction, maintenance, utilities, insurance, pmi, hoa
        'No', 0, // is_tax_deductible, tax_deductible
        'm-acct', // linkedAccountId
        undefined, // startDate
        0,        // payment (recomputed by the constructor)
        extra_payment,
    );
}

describe('ExpenseCard collapsed header — mortgage extra payment NOT double-counted (#144)', () => {
    it('shows the bare payment (which already includes extra), not payment + extra', () => {
        const mortgage = makeMortgage(50);
        // Sanity: the constructor folded the $50 extra into payment ⇒ $150 total.
        expect(mortgage.payment).toBeCloseTo(150, 6);
        expect(mortgage.extra_payment).toBe(50);

        render(<ExpenseCard expense={mortgage} />);

        // Header shows the true $150 outflow — NOT $200 (the double-counted value).
        expect(screen.getByText(headerAmountMatcher('$150/mo'))).toBeInTheDocument();
        expect(screen.queryByText(headerAmountMatcher('$200/mo'))).not.toBeInTheDocument();
    });
});
