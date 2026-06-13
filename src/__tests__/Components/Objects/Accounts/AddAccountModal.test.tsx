import type { ComponentProps } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { MemoryRouter } from 'react-router-dom';
import AddAccountModal from '../../../../components/Objects/Accounts/AddAccountModal';
import { AccountDispatchContext } from '../../../../components/Objects/Accounts/AccountContext';
import { ExpenseDispatchContext } from '../../../../components/Objects/Expense/ExpenseContext';
import { PropertyAccount, DebtAccount, SavedAccount } from '../../../../components/Objects/Accounts/models';
import { ReceiptToastProvider } from '../../../../components/Layout/Overlays/ReceiptToast';

// Headless UI's Listbox doesn't open via fireEvent in jsdom (its state machine
// ignores synthetic pointer events), so swap DropdownInput for a native select.
// The dropdown widget itself is covered elsewhere; this suite tests modal logic.
vi.mock('../../../../components/Layout/InputFields/DropdownInput', () => ({
    DropdownInput: ({ label, value, onChange, options }: {
        label: string;
        value: string;
        onChange: (val: string) => void;
        options: ({ value: string; label: string } | string)[];
    }) => (
        <label>
            {label}
            <select value={value} onChange={e => onChange(e.target.value)}>
                {options.map(opt => {
                    const normalized = typeof opt === 'string' ? { value: opt, label: opt } : opt;
                    return (
                        <option key={normalized.value} value={normalized.value}>
                            {normalized.label}
                        </option>
                    );
                })}
            </select>
        </label>
    ),
}));

const accountDispatch = vi.fn();
const expenseDispatch = vi.fn();

const renderModal = (selectedType: ComponentProps<typeof AddAccountModal>['selectedType']) =>
    render(
        <MemoryRouter>
            <ReceiptToastProvider>
                <AccountDispatchContext.Provider
                    value={{ dispatch: accountDispatch, exportData: vi.fn(), importData: vi.fn() }}
                >
                    <ExpenseDispatchContext.Provider value={expenseDispatch}>
                        <AddAccountModal isOpen={true} selectedType={selectedType} onClose={vi.fn()} />
                    </ExpenseDispatchContext.Provider>
                </AccountDispatchContext.Provider>
            </ReceiptToastProvider>
        </MemoryRouter>
    );

const fillName = (name: string) => {
    const nameInput = screen.getByLabelText('Account Name');
    fireEvent.change(nameInput, { target: { value: name } });
    fireEvent.blur(nameInput); // NameInput buffers locally; onChange fires on blur
};

const submit = () => fireEvent.click(screen.getByRole('button', { name: 'Add Account' }));

describe('AddAccountModal receipt toasts', () => {
    beforeEach(() => {
        accountDispatch.mockClear();
        expenseDispatch.mockClear();
    });

    it('fires a receipt toast when a financed property creates a mortgage expense', () => {
        renderModal(PropertyAccount);

        fillName('Lake House');

        // Switch Ownership Type to Financed (mocked native select)
        fireEvent.change(screen.getByLabelText('Ownership Type'), {
            target: { value: 'Financed' },
        });

        submit();

        expect(expenseDispatch).toHaveBeenCalledWith(
            expect.objectContaining({ type: 'ADD_EXPENSE' })
        );

        const toast = screen.getByRole('status');
        expect(toast).toHaveTextContent(
            "Created mortgage expense 'Lake House' with assumed terms (6.23% APR, 30 yr) — review it"
        );
        const link = screen.getByRole('link', { name: 'Review' });
        expect(link).toHaveAttribute('href', '/current/expense?tab=Monthly');
    });

    it('does not fire a toast for an owned (non-financed) property', () => {
        renderModal(PropertyAccount);

        fillName('Cabin');
        submit();

        expect(expenseDispatch).not.toHaveBeenCalled();
        expect(screen.queryByRole('status')).not.toBeInTheDocument();
        expect(accountDispatch).toHaveBeenCalledWith(
            expect.objectContaining({ type: 'ADD_ACCOUNT' })
        );
    });

    it('fires a receipt toast when a debt account creates a loan expense', () => {
        renderModal(DebtAccount);

        fillName('Car Loan');
        submit();

        expect(expenseDispatch).toHaveBeenCalledWith(
            expect.objectContaining({ type: 'ADD_EXPENSE' })
        );

        const toast = screen.getByRole('status');
        expect(toast).toHaveTextContent("Created loan expense 'Car Loan' under Expenses");
        const link = screen.getByRole('link', { name: 'View' });
        expect(link).toHaveAttribute('href', '/current/expense?tab=Monthly');
    });

    it('does not fire a toast for account types without side effects', () => {
        renderModal(SavedAccount);

        fillName('Checking');
        submit();

        expect(expenseDispatch).not.toHaveBeenCalled();
        expect(screen.queryByRole('status')).not.toBeInTheDocument();
    });
});
