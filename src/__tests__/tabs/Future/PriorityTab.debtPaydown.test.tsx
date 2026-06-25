import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import PriorityTab from '../../../tabs/Future/PriorityTab';
import { AccountContext } from '../../../components/Objects/Accounts/AccountContext';
import { DebtAccount, DeficitDebtAccount, InvestedAccount } from '../../../components/Objects/Accounts/models';

/**
 * #60 C (redesign): unlinked DebtAccounts are offered in the Allocation priority
 * list as a "Pay down: <name>" destination; linked debts (accelerated via the
 * loan's extra_payment) and the system DeficitDebt are NOT offered.
 *
 * The destination picker is a CustomDropdown (button + portal'd option buttons),
 * so we open it and assert on the rendered option labels.
 */
describe('PriorityTab debt-paydown offering', () => {
    const accounts = [
        new DebtAccount('cc', 'Credit Card', 5000, '', 22),             // unlinked — offered
        new DebtAccount('loan-debt', 'Auto Loan', 8000, 'exp-auto', 6), // linked — NOT offered
        new DeficitDebtAccount('system-deficit-debt', 'Uncovered Deficit', 0), // system — NOT offered
        new InvestedAccount('brok', 'Brokerage', 100000, 0, 0, 0.1, 'Brokerage'),
    ];

    function renderTab() {
        return render(
            <AccountContext.Provider value={{ accounts, amountHistory: {} }}>
                <PriorityTab />
            </AccountContext.Provider>
        );
    }

    it('offers an unlinked debt as a "Pay down" destination but hides linked + deficit debts', () => {
        renderTab();

        // Open the inline add form, then open the destination dropdown.
        fireEvent.click(screen.getByText('Add Priority'));
        fireEvent.click(screen.getByLabelText('Destination Account'));

        // The unlinked credit card is offered as a "Pay down: …" destination.
        expect(screen.getAllByText('Pay down: Credit Card').length).toBeGreaterThan(0);

        // The linked auto loan and the system deficit debt are NEVER offered —
        // not as a plain name and not as a "Pay down:" entry.
        expect(screen.queryByText(/Auto Loan/)).not.toBeInTheDocument();
        expect(screen.queryByText(/Uncovered Deficit/)).not.toBeInTheDocument();
    });
});
