import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { type ReactNode } from 'react';
import SpendingTab from '../../../tabs/Budget/SpendingTab';
import { BudgetContext } from '../../../components/Objects/Budget/BudgetContext';
import type { BudgetState, MonthlySnapshot } from '../../../components/Objects/Budget/BudgetTypes';
import { ExpenseContext } from '../../../components/Objects/Expense/ExpenseContext';
import { AccountContext } from '../../../components/Objects/Accounts/AccountContext';
import { IncomeContext } from '../../../components/Objects/Income/IncomeContext';
import {
    AssumptionsContext,
    defaultAssumptions,
    type PriorityBucket,
} from '../../../components/Objects/Assumptions/AssumptionsContext';
import { OtherExpense, type AnyExpense } from '../../../components/Objects/Expense/models';
import { SavedAccount, type AnyAccount } from '../../../components/Objects/Accounts/models';

// The spending grid itself isn't under test — stub out react-datasheet-grid
// (it doesn't render meaningfully in jsdom). keyColumn/floatColumn/textColumn
// are also consumed by DataSheetColumns.
vi.mock('react-datasheet-grid', () => ({
    DataSheetGrid: () => <div data-testid="datasheet-grid" />,
    keyColumn: (key: string, column: object) => ({ key, ...column }),
    floatColumn: {},
    textColumn: {},
}));

const makeSnapshot = (
    month: number,
    year: number,
    accountBalances: Record<string, number>
): MonthlySnapshot => ({
    id: `${year}-${month}`,
    month,
    year,
    spending: {},
    accountBalances,
    contributions: {},
    transactions: [],
    reconciled: false,
    createdAt: new Date(),
    updatedAt: new Date(),
});

interface HarnessOptions {
    budget: Partial<BudgetState>;
    expenses: AnyExpense[];
    accounts: AnyAccount[];
    priorities?: PriorityBucket[];
}

const renderSpendingTab = ({ budget, expenses, accounts, priorities = [] }: HarnessOptions) => {
    const budgetValue = {
        months: [] as MonthlySnapshot[],
        importSettings: {
            dateColumn: 'Date',
            amountColumn: 'Amount',
            descriptionColumn: 'Description',
            categoryMappings: [],
            savedCSVFormats: [],
            autoCreateRules: false,
        },
        selectedMonth: 1,
        selectedYear: 2025,
        projectFuture: false,
        dispatch: () => null,
        getOrCreateMonth: () => makeSnapshot(1, 2025, {}),
        getCurrentMonth: () => undefined,
        ...budget,
    };
    const wrapper = ({ children }: { children: ReactNode }) => (
        <AssumptionsContext.Provider value={{ state: { ...defaultAssumptions, priorities }, dispatch: () => null }}>
            <AccountContext.Provider value={{ accounts, amountHistory: {} }}>
                <IncomeContext.Provider value={{ incomes: [] }}>
                    <ExpenseContext.Provider value={{ expenses }}>
                        <BudgetContext.Provider value={budgetValue}>
                            {children}
                        </BudgetContext.Provider>
                    </ExpenseContext.Provider>
                </IncomeContext.Provider>
            </AccountContext.Provider>
        </AssumptionsContext.Provider>
    );
    return render(<SpendingTab />, { wrapper });
};

/** Hover the pacing "why" tooltip inside the contribution row for `accountName`. */
const openRowTooltip = (accountName: string): HTMLElement => {
    const accountLabel = screen.getByText(accountName);
    const row = accountLabel.closest('tr');
    expect(row).not.toBeNull();
    const helpButton = within(row as HTMLElement).getByLabelText('Help');
    fireEvent.mouseEnter(helpButton);
    return screen.getByRole('tooltip');
};

describe('SpendingTab pacing "why" tooltip', () => {
    beforeEach(() => {
        // Fake only Date (not timers) so React/RTL scheduling is untouched.
        vi.useFakeTimers({ toFake: ['Date'] });
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    // A regular (non-goal) expense so the tab doesn't early-return on an empty grid.
    const rent = new OtherExpense('rent', 'Rent', 1000, 'Monthly', new Date(2024, 0, 1));

    it('explains the arithmetic for a mid-year-start goal (active months, start month)', () => {
        vi.setSystemTime(new Date(2026, 5, 12)); // June 12, 2026

        // Goal: $12,000 car, saving June 2025 → June 2026 ($1,000/mo).
        // In 2025 it plans 7 active months (Jun–Dec) → $7,000 prorated annual target.
        const carGoal = new OtherExpense('g1', 'Car', 12000, 'Monthly', new Date(2025, 5, 1), new Date(2026, 5, 1));
        carGoal.goalType = 'targetDate';
        carGoal.goalAccountId = 'fund1';

        renderSpendingTab({
            budget: { selectedMonth: 12, selectedYear: 2025 },
            expenses: [rent, carGoal],
            accounts: [new SavedAccount('fund1', 'Car Fund', 0, 0)],
        });

        const tooltip = openRowTooltip('Car Fund');
        const text = tooltip.textContent ?? '';
        expect(text).toContain('Expected $7,000 by December');
        expect(text).toContain('$1,000/mo × 7 active months');
        expect(text).toContain('$7,000 planned over 7 months');
        expect(text).toContain('funding starts June');
        // No contributions logged → waiting, with an explanation.
        expect(text).toContain('no contributions logged yet');
        expect(text).toContain('pacing starts with the first one');
    });

    it('explains "behind" as the 2x-monthly catch-up being out of reach', () => {
        vi.setSystemTime(new Date(2026, 10, 15)); // November 15, 2026

        // FIXED $100/mo bucket → $1,200/yr. By November only $300 contributed:
        // $900 still needed > 2 × $100 × 1 remaining month → behind (unreachable).
        const priorities: PriorityBucket[] = [{
            id: 'p1',
            name: 'Vacation bucket',
            type: 'SAVINGS',
            accountId: 'sav1',
            capType: 'FIXED',
            capValue: 100,
        }];

        renderSpendingTab({
            budget: {
                selectedMonth: 11,
                selectedYear: 2026,
                months: [
                    makeSnapshot(12, 2025, { sav1: 1000 }),
                    makeSnapshot(11, 2026, { sav1: 1300 }),
                ],
            },
            expenses: [rent],
            accounts: [new SavedAccount('sav1', 'Vacation Savings', 1300, 0)],
            priorities,
        });

        const tooltip = openRowTooltip('Vacation Savings');
        const text = tooltip.textContent ?? '';
        // Jan-start bucket: 11 active months of the 12 planned.
        expect(text).toContain('Expected $1,100 by November');
        expect(text).toContain('$100/mo × 11 active months');
        expect(text).toContain('$1,200 planned over 12 months');
        expect(text).toContain("even 2× the monthly target for the remaining 1 month can't reach the annual goal");
    });

    it('labels the savings-target monthly expense figure as "this month"', () => {
        vi.setSystemTime(new Date(2026, 5, 12)); // June 12, 2026

        const priorities: PriorityBucket[] = [{
            id: 'ef',
            name: 'Emergency fund',
            type: 'SAVINGS',
            accountId: 'ef1',
            capType: 'MULTIPLE_OF_EXPENSES',
            capValue: 6,
        }];

        renderSpendingTab({
            budget: { selectedMonth: 6, selectedYear: 2026 },
            expenses: [rent],
            accounts: [new SavedAccount('ef1', 'Emergency Fund', 5000, 0)],
            priorities,
        });

        // Today's active expenses: $1,000/mo rent — labeled as this month's figure.
        expect(screen.getByText(/\$1,000\/mo this month/)).toBeInTheDocument();
    });

    // #167: TARGET is a balance-target flavor like MULTIPLE_OF_EXPENSES, so it
    // renders in the Savings Targets section with funded status, not as an
    // annual contribution row.
    it('renders a TARGET bucket in the savings-target section with funded status', () => {
        vi.setSystemTime(new Date(2026, 5, 12)); // June 12, 2026

        const priorities: PriorityBucket[] = [{
            id: 'hf',
            name: 'House fund',
            type: 'SAVINGS',
            accountId: 'hf1',
            capType: 'TARGET',
            capValue: 20000,
        }];

        renderSpendingTab({
            budget: { selectedMonth: 6, selectedYear: 2026 },
            expenses: [rent],
            accounts: [new SavedAccount('hf1', 'House Fund', 20000, 0)],
            priorities,
        });

        // Row lands in the balance-target section…
        expect(screen.getByText('Savings Targets')).toBeInTheDocument();
        const row = screen.getByText('House Fund').closest('tr') as HTMLElement;
        // …with the dollar target and fully-funded status (balance = target).
        expect(within(row).getAllByText('$20,000').length).toBeGreaterThan(0);
        expect(within(row).getByText('Fully funded')).toBeInTheDocument();
    });

    it('shows an in-progress TARGET bucket with the remaining gap', () => {
        vi.setSystemTime(new Date(2026, 5, 12)); // June 12, 2026

        const priorities: PriorityBucket[] = [{
            id: 'hf',
            name: 'House fund',
            type: 'SAVINGS',
            accountId: 'hf1',
            capType: 'TARGET',
            capValue: 20000,
        }];

        renderSpendingTab({
            budget: { selectedMonth: 6, selectedYear: 2026 },
            expenses: [rent],
            accounts: [new SavedAccount('hf1', 'House Fund', 5000, 0)],
            priorities,
        });

        const row = screen.getByText('House Fund').closest('tr') as HTMLElement;
        // 5,000 / 20,000 = 25%, $15,000 to go.
        expect(within(row).getByText(/25% · \$15,000 to go/)).toBeInTheDocument();
    });
});
