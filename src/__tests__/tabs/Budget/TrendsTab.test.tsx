import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ReactNode } from 'react';
import TrendsTab from '../../../tabs/Budget/TrendsTab';
import { BudgetContext } from '../../../components/Objects/Budget/BudgetContext';
import type { MonthlySnapshot } from '../../../components/Objects/Budget/BudgetTypes';
import { ExpenseContext } from '../../../components/Objects/Expense/ExpenseContext';
import { OtherExpense, AnyExpense } from '../../../components/Objects/Expense/models';

// Mock the Nivo line chart — we only need the `data` prop it received,
// serialized so the window (x values) and points (y values) can be asserted.
vi.mock('@nivo/line', () => ({
    ResponsiveLine: ({ data }: { data: unknown }) => (
        <div data-testid="mock-line-chart">{JSON.stringify(data)}</div>
    ),
}));

type ChartPoint = { x: string; y: number };
type ChartSeries = { id: string; data: ChartPoint[] };

const makeSnapshot = (
    month: number,
    year: number,
    spending: Record<string, number>,
): MonthlySnapshot => ({
    id: `${year}-${month}`,
    month,
    year,
    spending,
    accountBalances: {},
    contributions: {},
    transactions: [],
    reconciled: false,
    createdAt: new Date(),
    updatedAt: new Date(),
});

const rent = new OtherExpense('rent', 'Rent', 1000, 'Monthly', new Date(2025, 0, 1));

const renderTrendsTab = (months: MonthlySnapshot[], expenses: AnyExpense[] = [rent]) => {
    const budgetValue = {
        months,
        importSettings: {
            dateColumn: 'Date',
            amountColumn: 'Amount',
            descriptionColumn: 'Description',
            categoryMappings: [],
            savedCSVFormats: [],
            autoCreateRules: false,
        },
        selectedMonth: 1,
        selectedYear: 2026,
        projectFuture: false,
        dispatch: vi.fn(),
        getOrCreateMonth: () => makeSnapshot(1, 2026, {}),
        getCurrentMonth: () => undefined,
    };
    const wrapper = ({ children }: { children: ReactNode }) => (
        <ExpenseContext.Provider value={{ expenses }}>
            <BudgetContext.Provider value={budgetValue}>
                {children}
            </BudgetContext.Provider>
        </ExpenseContext.Provider>
    );
    return render(<TrendsTab />, { wrapper });
};

const getChartSeries = (chartIndex: number): ChartSeries[] => {
    const charts = screen.getAllByTestId('mock-line-chart');
    return JSON.parse(charts[chartIndex].textContent ?? '[]') as ChartSeries[];
};

describe('TrendsTab — 6-month window uses complete months only', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        // Freeze time MID-month: July 15, 2026. July is in progress, so the
        // window must be the last 6 COMPLETE months: Jan 26 … Jun 26.
        vi.setSystemTime(new Date(2026, 6, 15));
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    // Apr–Jun 2026 are complete months with data; Jul 2026 is the current
    // partial month and must be excluded everywhere.
    const monthsFixture = [
        makeSnapshot(4, 2026, { rent: 700 }),
        makeSnapshot(5, 2026, { rent: 800 }),
        makeSnapshot(6, 2026, { rent: 1000 }),
        makeSnapshot(7, 2026, { rent: 999 }), // current in-progress month
    ];

    it('spending-vs-budget chart ends at the previous month and omits the current month', () => {
        renderTrendsTab(monthsFixture);

        const spendingChart = getChartSeries(0);
        const spent = spendingChart.find(s => s.id === 'Spent');
        expect(spent).toBeDefined();

        const xs = spent!.data.map(p => p.x);
        expect(xs).toEqual(['Jan 26', 'Feb 26', 'Mar 26', 'Apr 26', 'May 26', 'Jun 26']);
        expect(xs).not.toContain('Jul 26');

        // The partial July spending ($999) must not be plotted; the previous
        // (complete) month June is the last point.
        expect(spent!.data.map(p => p.y)).toEqual([0, 0, 0, 700, 800, 1000]);
    });

    it('category trends chart uses the same complete-month window', () => {
        renderTrendsTab(monthsFixture);

        const categoryChart = getChartSeries(1);
        const rentSeries = categoryChart.find(s => s.id === 'Rent');
        expect(rentSeries).toBeDefined();

        const xs = rentSeries!.data.map(p => p.x);
        expect(xs).not.toContain('Jul 26');
        expect(xs[xs.length - 1]).toBe('Jun 26');
        expect(rentSeries!.data[rentSeries!.data.length - 1].y).toBe(1000);
    });

    it('summary tiles agree with the chart window (current month excluded)', () => {
        renderTrendsTab(monthsFixture);

        // 6-Month Total: 700 + 800 + 1000 (July's 999 excluded)
        expect(screen.getByText('$2,500')).toBeInTheDocument();
        // 6-Month Budget: 6 complete months × $1,000 rent
        expect(screen.getByText('$6,000')).toBeInTheDocument();
        // Monthly Average: $2,500 over 3 months with data
        expect(screen.getByText('$833')).toBeInTheDocument();
    });

    it('rolls the window across a year boundary (January → ends at December)', () => {
        vi.setSystemTime(new Date(2027, 0, 10)); // Jan 10, 2027

        renderTrendsTab([
            makeSnapshot(12, 2026, { rent: 1200 }),
            makeSnapshot(1, 2027, { rent: 50 }), // current in-progress month
        ]);

        const spendingChart = getChartSeries(0);
        const spent = spendingChart.find(s => s.id === 'Spent');
        const xs = spent!.data.map(p => p.x);
        expect(xs).toEqual(['Jul 26', 'Aug 26', 'Sep 26', 'Oct 26', 'Nov 26', 'Dec 26']);
        expect(xs).not.toContain('Jan 27');
        expect(spent!.data[spent!.data.length - 1].y).toBe(1200);
    });
});
