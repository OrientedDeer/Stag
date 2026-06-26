import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import ExpenseCard from '../../../../components/Objects/Expense/ExpenseCard';
import { LoanExpense } from '../../../../components/Objects/Expense/models';

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
