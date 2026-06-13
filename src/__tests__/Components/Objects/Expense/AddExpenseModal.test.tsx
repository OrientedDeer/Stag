import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { MemoryRouter } from 'react-router-dom';
import AddExpenseModal from '../../../../components/Objects/Expense/AddExpenseModal';
import { ExpenseDispatchContext } from '../../../../components/Objects/Expense/ExpenseContext';
import { AccountDispatchContext } from '../../../../components/Objects/Accounts/AccountContext';
import { OtherExpense, getGoalMonthlySetAside } from '../../../../components/Objects/Expense/models';
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

// TriggerSelector's date input lives behind a popup button; replace it with a
// labelled native date input so tests can set dates directly. Dates stay LOCAL
// (new Date(y, m-1, d)), matching the real component's handleDateInput.
vi.mock('../../../../components/Layout/InputFields/TriggerSelector', () => ({
    TriggerSelector: ({ label, date, onDateChange }: {
        label: string;
        date: Date | undefined;
        onDateChange: (d: Date | undefined) => void;
    }) => (
        <label>
            {label}
            <input
                type="date"
                value={date
                    ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
                    : ''}
                onChange={e => {
                    if (!e.target.value) { onDateChange(undefined); return; }
                    const [y, m, d] = e.target.value.split('-').map(Number);
                    onDateChange(new Date(y, m - 1, d));
                }}
            />
        </label>
    ),
}));

const expenseDispatch = vi.fn();
const accountDispatch = vi.fn();

// Fixed "today" so set-aside horizons are deterministic: Jun 15, 2026 (local).
const TODAY = new Date(2026, 5, 15);

const renderGoalModal = () =>
    render(
        <MemoryRouter>
            <ReceiptToastProvider>
                <AccountDispatchContext.Provider
                    value={{ dispatch: accountDispatch, exportData: vi.fn(), importData: vi.fn() }}
                >
                    <ExpenseDispatchContext.Provider value={expenseDispatch}>
                        <AddExpenseModal isOpen={true} onClose={vi.fn()} goalMode={true} />
                    </ExpenseDispatchContext.Provider>
                </AccountDispatchContext.Provider>
            </ReceiptToastProvider>
        </MemoryRouter>
    );

const pickOtherType = () => fireEvent.click(screen.getByRole('button', { name: 'Other' }));

const setName = (name: string) => {
    const input = screen.getByLabelText('Expense Name');
    fireEvent.change(input, { target: { value: name } });
    fireEvent.blur(input); // NameInput buffers locally; onChange fires on blur
};

const setAmount = (amount: number) => {
    const input = screen.getByLabelText('Amount ($)');
    fireEvent.focus(input); // CurrencyInput buffers while focused; commits on blur
    fireEvent.change(input, { target: { value: String(amount) } });
    fireEvent.blur(input);
};

const setGoalType = (value: 'recurring' | 'targetDate') =>
    fireEvent.change(screen.getByLabelText('Goal Type'), { target: { value } });

const setTargetDate = (isoDate: string) =>
    fireEvent.change(screen.getByLabelText('Target Date'), { target: { value: isoDate } });

/** The exact monthly string the modal derives, computed from the same helper
 *  (getGoalMonthlySetAside) on a goal built the way handleAdd builds it —
 *  no reimplemented month math, no hardcoded magic. */
const expectedMonthly = (goalProps: {
    amount: number;
    goalType: 'recurring' | 'targetDate';
    startDate: Date;
    targetDate?: Date;
    intervalYears?: number;
}): string => {
    const goal = new OtherExpense('TEST', 'test', goalProps.amount, 'Monthly', goalProps.startDate, undefined);
    goal.goalType = goalProps.goalType;
    if (goalProps.goalType === 'recurring') {
        goal.intervalYears = goalProps.intervalYears;
    } else {
        goal.endDate = goalProps.targetDate;
    }
    const monthly = getGoalMonthlySetAside(goal);
    return `$${monthly.toLocaleString(undefined, { maximumFractionDigits: 0 })}/mo`;
};

const monthYear = (d: Date): string =>
    d.toLocaleDateString(undefined, { month: 'short', year: 'numeric' });

describe('AddExpenseModal goal plan preview', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(TODAY);
        expenseDispatch.mockClear();
        accountDispatch.mockClear();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('shows the derived monthly set-aside for a save-by-date goal ($10,000 over 18 months)', () => {
        renderGoalModal();
        pickOtherType();

        // No preview until an amount is entered
        expect(screen.queryByText(/Sets aside/)).not.toBeInTheDocument();

        setGoalType('targetDate');
        setTargetDate('2027-12-15'); // 18 whole months from Jun 2026
        setAmount(10000);

        const target = new Date(2027, 11, 15);
        const monthly = expectedMonthly({ amount: 10000, goalType: 'targetDate', startDate: TODAY, targetDate: target });
        expect(monthly).toBe('$556/mo'); // 10000 / 18 = 555.55 → rounds to 556

        const preview = screen.getByText(/Sets aside/).closest('div');
        expect(preview).toHaveTextContent(
            `Sets aside ${monthly} (${monthYear(TODAY)} → ${monthYear(target)}) into a new '(unnamed) (fund)' account. The $10,000 is spent at the target date.`
        );
        expect(preview).toHaveClass('bg-blue-900/20', 'border-blue-700/50', 'text-blue-400');
    });

    it('updates the preview live when the amount changes', () => {
        renderGoalModal();
        pickOtherType();
        setGoalType('targetDate');
        setTargetDate('2027-12-15');

        setAmount(10000);
        expect(screen.getByText(/Sets aside/).closest('div')).toHaveTextContent('$556/mo');

        setAmount(18000); // 18000 / 18 months = $1,000/mo
        const monthly = expectedMonthly({
            amount: 18000, goalType: 'targetDate', startDate: TODAY, targetDate: new Date(2027, 11, 15),
        });
        expect(monthly).toBe('$1,000/mo');
        const preview = screen.getByText(/Sets aside/).closest('div');
        expect(preview).toHaveTextContent(`Sets aside ${monthly}`);
        expect(preview).toHaveTextContent('The $18,000 is spent at the target date.');
    });

    it('uses the entered name for the fund account in the preview', () => {
        renderGoalModal();
        pickOtherType();
        setGoalType('targetDate');
        setTargetDate('2027-12-15');
        setAmount(10000);
        setName('New Car');

        expect(screen.getByText(/Sets aside/).closest('div'))
            .toHaveTextContent("into a new 'New Car (fund)' account");
    });

    it('shows the recurring preview with interval and total', () => {
        renderGoalModal();
        pickOtherType();
        // Default goal type is recurring, every 10 years
        setAmount(12000);

        const monthly = expectedMonthly({ amount: 12000, goalType: 'recurring', startDate: TODAY, intervalYears: 10 });
        expect(monthly).toBe('$100/mo'); // 12000 / (10 * 12)

        const preview = screen.getByText(/Sets aside/).closest('div');
        expect(preview).toHaveTextContent(
            `Sets aside ${monthly} into a new '(unnamed) (fund)' account, replacing the $12,000 item every 10 years.`
        );
    });

    it('warns with the lump amount when the target is less than a month away', () => {
        renderGoalModal();
        pickOtherType();
        setGoalType('targetDate');
        setAmount(10000);

        // Target this month (0 whole months out)
        setTargetDate('2026-06-20');
        let warning = screen.getByText(/Target is less than a month away/).closest('div');
        expect(warning).toHaveTextContent(
            'Target is less than a month away — the full $10,000 is due immediately.'
        );
        expect(warning).toHaveClass('bg-yellow-900/30', 'border-yellow-700/50', 'text-yellow-300');
        expect(screen.queryByText(/Sets aside/)).not.toBeInTheDocument();

        // Exactly one month out: the "monthly plan" is the whole total — still a lump
        setTargetDate('2026-07-15');
        warning = screen.getByText(/Target is less than a month away/).closest('div');
        expect(warning).toHaveTextContent('the full $10,000 is due immediately');

        // Two months out: back to a real plan
        setTargetDate('2026-08-15');
        expect(screen.queryByText(/Target is less than a month away/)).not.toBeInTheDocument();
        expect(screen.getByText(/Sets aside/)).toBeInTheDocument();
    });
});

describe('AddExpenseModal goal creation receipt', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(TODAY);
        expenseDispatch.mockClear();
        accountDispatch.mockClear();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('fires a receipt toast naming the fund account when a goal is created', () => {
        renderGoalModal();
        pickOtherType();
        setGoalType('targetDate');
        setTargetDate('2027-12-15');
        setAmount(10000);
        setName('New Car');

        fireEvent.click(screen.getByRole('button', { name: 'Add Expense' }));

        // The goal expense and its linked fund account were both created
        expect(expenseDispatch).toHaveBeenCalledWith(
            expect.objectContaining({ type: 'ADD_EXPENSE' })
        );
        expect(accountDispatch).toHaveBeenCalledWith(
            expect.objectContaining({
                type: 'ADD_ACCOUNT',
                payload: expect.objectContaining({ name: 'New Car (fund)' }),
            })
        );

        const toast = screen.getByRole('status');
        expect(toast).toHaveTextContent(
            "Created 'New Car (fund)' account — it holds this goal's savings"
        );
        const link = screen.getByRole('link', { name: 'View' });
        expect(link).toHaveAttribute('href', '/current/accounts?tab=Cash');
    });

    it('does not fire a receipt toast for an ordinary (non-goal) expense', () => {
        render(
            <MemoryRouter>
                <ReceiptToastProvider>
                    <AccountDispatchContext.Provider
                        value={{ dispatch: accountDispatch, exportData: vi.fn(), importData: vi.fn() }}
                    >
                        <ExpenseDispatchContext.Provider value={expenseDispatch}>
                            <AddExpenseModal isOpen={true} onClose={vi.fn()} />
                        </ExpenseDispatchContext.Provider>
                    </AccountDispatchContext.Provider>
                </ReceiptToastProvider>
            </MemoryRouter>
        );
        pickOtherType();
        setAmount(50);
        setName('Coffee');

        fireEvent.click(screen.getByRole('button', { name: 'Add Expense' }));

        expect(expenseDispatch).toHaveBeenCalledWith(
            expect.objectContaining({ type: 'ADD_EXPENSE' })
        );
        expect(screen.queryByRole('status')).not.toBeInTheDocument();
        expect(screen.queryByText(/Sets aside/)).not.toBeInTheDocument();
    });
});
