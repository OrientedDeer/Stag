import { useCallback, useContext, useMemo } from 'react';
import { ResponsiveBar } from '@nivo/bar';
import { useChartTheme } from '../../components/Charts/useChartTheme';
import { ChartFrame } from '../../components/Charts/ChartFrame';
import { BudgetContext } from '../../components/Objects/Budget/BudgetContext';
import { ExpenseContext } from '../../components/Objects/Expense/ExpenseContext';
import {
    calculateBudgetSummary,
    formatCurrency,
    getActiveExpenses,
    getNonDiscretionaryMonthlyBudget,
    getUncategorizedCount,
    getUncategorizedSpending,
    MONTH_NAMES,
} from '../../components/Objects/Budget/budgetUtils';
import { ToggleInput } from '../../components/Layout/InputFields/ToggleInput';
import { Tooltip } from '../../components/Layout/InputFields/Tooltip';

const chartKeys = ['average'];
const chartMargin = { top: 5, right: 20, bottom: 25, left: 100 };
const chartValueScale = { type: 'linear' } as const;
const chartAxisBottom = {
    tickSize: 0,
    tickPadding: 5,
    format: (v: number) => `$${v.toLocaleString()}`,
};
const chartAxisLeft = { tickSize: 0, tickPadding: 10 };
const chartTheme = {
    axis: {
        ticks: { text: { fill: 'var(--c-content-muted)', fontSize: 11 } },
    },
    grid: { line: { stroke: 'var(--c-border-default)' } },
};
const BarTooltip = ({ data, value }: { data: { name: string }; value: number }) => (
    <div className="bg-surface-overlay border border-border-default p-2 rounded shadow-xl text-xs">
        <div className="font-semibold text-white">{data.name}</div>
        <div className="text-positive">{formatCurrency(value)} / month avg</div>
    </div>
);

export default function OverviewTab() {
    const { months, selectedMonth, selectedYear, importSettings, projectFuture, dispatch } = useContext(BudgetContext);
    const { expenses } = useContext(ExpenseContext);
    const { resolve } = useChartTheme();

    const setProjectFuture = useCallback((enabled: boolean) => {
        dispatch({ type: 'SET_PROJECT_FUTURE', payload: enabled });
    }, [dispatch]);

    // Determine whether a given month is in the future relative to today
    const now = new Date();
    const isMonthInFuture = useCallback((m: number, y: number) => {
        return y > now.getFullYear() || (y === now.getFullYear() && m > now.getMonth() + 1);
    }, [now]);

    const currentSnapshot = useMemo(() =>
        months.find(m => m.month === selectedMonth && m.year === selectedYear),
        [months, selectedMonth, selectedYear]
    );

    // Effective spend for a given month: actual snapshot if available; otherwise (if projecting
    // and the month is in the future), the non-discretionary monthly budget.
    const getEffectiveMonthSpend = useCallback((m: number, y: number) => {
        const snap = months.find(s => s.month === m && s.year === y);
        if (snap && (Object.keys(snap.spending).length > 0 || snap.transactions.length > 0)) {
            return Object.values(snap.spending).reduce((s, v) => s + v, 0) + getUncategorizedSpending(snap);
        }
        if (projectFuture && isMonthInFuture(m, y)) {
            return getNonDiscretionaryMonthlyBudget(expenses, m, y);
        }
        return 0;
    }, [months, projectFuture, isMonthInFuture, expenses]);

    const budgetSummary = useMemo(() => {
        const base = calculateBudgetSummary(expenses, currentSnapshot, selectedMonth, selectedYear);
        // Override totalSpent when projecting a future month with no data.
        if (projectFuture && isMonthInFuture(selectedMonth, selectedYear) && base.totalSpent === 0) {
            const projected = getNonDiscretionaryMonthlyBudget(expenses, selectedMonth, selectedYear);
            const remaining = base.totalBudget - projected;
            return {
                ...base,
                totalSpent: projected,
                remaining,
                isUnderBudget: remaining >= 0,
                percentSpent: base.totalBudget > 0 ? (projected / base.totalBudget) * 100 : 0,
            };
        }
        return base;
    }, [expenses, currentSnapshot, selectedMonth, selectedYear, projectFuture, isMonthInFuture]);

    // Calculate year-to-date stats (from first month with data to selected month).
    // When projectFuture is on, future months in the range contribute their non-discretionary
    // monthly budget as projected spend so the YTD doesn't look artificially low.
    const ytdStats = useMemo(() => {
        const monthsWithData = months
            .filter(m =>
                m.year === selectedYear &&
                (Object.keys(m.spending).length > 0 || m.transactions.length > 0)
            )
            .map(m => m.month);
        const firstMonthWithData = monthsWithData.length > 0 ? Math.min(...monthsWithData) : selectedMonth;

        let totalBudget = 0;
        let totalSpent = 0;

        for (let month = firstMonthWithData; month <= selectedMonth; month++) {
            const monthBudget = expenses.reduce((sum, exp) => {
                const startDate = exp.startDate || new Date(0);
                const endDate = exp.endDate;
                const targetDate = new Date(selectedYear, month - 1, 15);
                if (startDate > targetDate) return sum;
                if (endDate && endDate < targetDate) return sum;
                return sum + exp.getMonthlyAmount();
            }, 0);
            totalBudget += monthBudget;
            totalSpent += getEffectiveMonthSpend(month, selectedYear);
        }

        return {
            totalBudget,
            totalSpent,
            remaining: totalBudget - totalSpent,
            isUnderBudget: totalSpent <= totalBudget,
            monthsCounted: selectedMonth - firstMonthWithData + 1,
            firstMonth: firstMonthWithData,
        };
    }, [months, expenses, selectedMonth, selectedYear, getEffectiveMonthSpend]);

    const hasData = currentSnapshot && (
        Object.keys(currentSnapshot.spending).length > 0 ||
        currentSnapshot.transactions.length > 0
    );

    const isFutureMonth = isMonthInFuture(selectedMonth, selectedYear);

    // Category spending data for bar chart (average of 6 months ending at selected month)
    const categoryData = useMemo(() => {
        const colors = ['var(--c-negative)', 'var(--c-cat-orange)', 'var(--c-warning)', 'var(--c-positive)', 'var(--c-cat-cyan)', 'var(--c-cat-purple)', 'var(--c-cat-fuchsia-bright)', 'var(--c-cat-fuchsia)'];

        // Get 6 months ending at selected month
        const monthsToCheck: { month: number; year: number }[] = [];
        let m = selectedMonth;
        let y = selectedYear;
        for (let i = 0; i < 6; i++) {
            monthsToCheck.push({ month: m, year: y });
            m--;
            if (m === 0) {
                m = 12;
                y--;
            }
        }

        // Sum spending by category across all 6 months and count months with data
        const categoryTotals: Record<string, { total: number; monthsWithData: number }> = {};
        expenses.forEach(exp => {
            categoryTotals[exp.id] = { total: 0, monthsWithData: 0 };
        });

        monthsToCheck.forEach(({ month, year }) => {
            const snapshot = months.find(s => s.month === month && s.year === year);
            const hasSnapshotData = snapshot && (
                Object.keys(snapshot.spending).length > 0 || snapshot.transactions.length > 0
            );
            if (hasSnapshotData && snapshot) {
                expenses.forEach(exp => {
                    if (snapshot.spending[exp.id]) {
                        categoryTotals[exp.id].total += snapshot.spending[exp.id];
                        categoryTotals[exp.id].monthsWithData++;
                    }
                });
            } else if (projectFuture && isMonthInFuture(month, year)) {
                // Future month with no data: fill in non-discretionary at budgeted amount
                // so the average doesn't go blank when scrubbing past the data horizon.
                // Discretionary categories are intentionally skipped (consistent with the toggle).
                getActiveExpenses(expenses, month, year).forEach(exp => {
                    if (!exp.isDiscretionary) {
                        categoryTotals[exp.id].total += exp.getMonthlyAmount();
                        categoryTotals[exp.id].monthsWithData++;
                    }
                });
            }
        });

        const data = expenses
            .map((exp, idx) => {
                const { total, monthsWithData } = categoryTotals[exp.id];
                return {
                    name: exp.name.length > 15 ? exp.name.slice(0, 13) + '...' : exp.name,
                    average: monthsWithData > 0 ? total / monthsWithData : 0,
                    color: colors[idx % colors.length],
                };
            })
            .filter(d => d.average > 0)
            .sort((a, b) => b.average - a.average)
            .slice(0, 8);

        return data;
    }, [months, expenses, selectedMonth, selectedYear, projectFuture, isMonthInFuture]);

    // Compute the date range label for the chart
    const chartDateRange = useMemo(() => {
        // End month is selected month
        const endMonth = MONTH_NAMES[selectedMonth - 1].slice(0, 3);
        const endYear = selectedYear.toString().slice(-2);

        // Start month is 5 months before selected month
        let startM = selectedMonth - 5;
        let startY = selectedYear;
        if (startM <= 0) {
            startM += 12;
            startY--;
        }
        const startMonth = MONTH_NAMES[startM - 1].slice(0, 3);
        const startYear = startY.toString().slice(-2);

        return `${startMonth} '${startYear} - ${endMonth} '${endYear}`;
    }, [selectedMonth, selectedYear]);

    const uncategorizedCount = useMemo(() =>
        getUncategorizedCount(currentSnapshot),
        [currentSnapshot]
    );

    const uncategorizedTotal = useMemo(() =>
        getUncategorizedSpending(currentSnapshot),
        [currentSnapshot]
    );

    const lastImportDate = useMemo(() => {
        const formats = importSettings?.savedCSVFormats || [];
        if (formats.length === 0) return null;
        const dates = formats.map(f => new Date(f.lastUsed).getTime()).filter(t => !isNaN(t));
        if (dates.length === 0) return null;
        return new Date(Math.max(...dates));
    }, [importSettings?.savedCSVFormats]);

    return (
        <div className="space-y-6">
            {/* Quick Stats Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* This Month */}
                <div className="bg-surface-overlay rounded-xl p-4 border border-border-default">
                    <h3 className="text-sm text-content-muted mb-2 flex items-center gap-1.5">
                        This Month
                        <Tooltip
                            text={`${formatCurrency(budgetSummary.totalBudget)} budget = this month's active expenses (non-discretionary + discretionary). Spent ${formatCurrency(budgetSummary.totalSpent)} so far; ${budgetSummary.isUnderBudget ? `${formatCurrency(budgetSummary.remaining)} remaining` : `${formatCurrency(Math.abs(budgetSummary.remaining))} over`}.`}
                        />
                    </h3>
                    <div className="text-2xl font-bold text-white">
                        {formatCurrency(budgetSummary.totalSpent)}
                        <span className="text-content-subtle text-lg ml-1">/ {formatCurrency(budgetSummary.totalBudget)}</span>
                    </div>
                    <div className={`text-sm mt-1 ${budgetSummary.isUnderBudget ? 'text-positive' : 'text-warning'}`}>
                        {budgetSummary.isUnderBudget
                            ? `${formatCurrency(budgetSummary.remaining)} under budget`
                            : `${formatCurrency(Math.abs(budgetSummary.remaining))} over budget`
                        }
                    </div>
                    {/* Progress bar */}
                    <div className="mt-3 bg-surface-input rounded-full h-2 overflow-hidden">
                        <div
                            className={`h-full transition-all duration-300 ${
                                budgetSummary.percentSpent > 100 ? 'bg-warning-soft' : 'bg-positive-soft'
                            }`}
                            style={{ width: `${Math.min(budgetSummary.percentSpent, 100)}%` }}
                        />
                    </div>
                </div>

                {/* Year to Date */}
                <div className="bg-surface-overlay rounded-xl p-4 border border-border-default">
                    <h3 className="text-sm text-content-muted mb-2 flex items-center gap-1.5">
                        Year to Date
                        <Tooltip
                            text={`${formatCurrency(ytdStats.totalBudget)} budget = sum of ${ytdStats.monthsCounted} month${ytdStats.monthsCounted === 1 ? '' : 's'}' active expenses (${MONTH_NAMES[ytdStats.firstMonth - 1]}–${MONTH_NAMES[selectedMonth - 1]}). Spent ${formatCurrency(ytdStats.totalSpent)} against it.${projectFuture && isMonthInFuture(selectedMonth, selectedYear) ? ' Future months count their non-discretionary budget as projected spend.' : ''}`}
                        />
                        {projectFuture && isMonthInFuture(selectedMonth, selectedYear) && (
                            <span className="text-xs text-content-subtle font-normal ml-1">(non-discretionary projected)</span>
                        )}
                    </h3>
                    <div className="text-2xl font-bold text-white">
                        {formatCurrency(ytdStats.totalSpent)}
                        <span className="text-content-subtle text-lg ml-1">/ {formatCurrency(ytdStats.totalBudget)}</span>
                    </div>
                    <div className={`text-sm mt-1 ${ytdStats.isUnderBudget ? 'text-positive' : 'text-warning'}`}>
                        {ytdStats.isUnderBudget
                            ? `${formatCurrency(ytdStats.remaining)} under budget`
                            : `${formatCurrency(Math.abs(ytdStats.remaining))} over budget`
                        }
                    </div>
                </div>
            </div>

            {/* Uncategorized Transactions Warning */}
            {uncategorizedCount > 0 && (
                <div className="bg-warning-tint/30 border border-warning-strong/50 rounded-lg p-4 flex items-start gap-3 -mt-1">
                    <span className="text-warning text-lg leading-none mt-0.5">!</span>
                    <div>
                        <p className="text-warning-bright text-sm font-medium">
                            {uncategorizedCount} uncategorized transaction{uncategorizedCount !== 1 ? 's' : ''} ({formatCurrency(uncategorizedTotal)})
                        </p>
                        <p className="text-warning-bright/60 text-xs mt-0.5">
                            Review and categorize them in the Transactions tab so spending is tracked accurately.
                        </p>
                    </div>
                </div>
            )}

            {/* Last Import Indicator */}
            {lastImportDate && (
                <div className="text-xs text-content-subtle text-right -mt-3">
                    Last import: {lastImportDate.toLocaleDateString('en-US', {
                        month: 'short', day: 'numeric', year: 'numeric'
                    })}
                    {(() => {
                        const days = Math.floor((Date.now() - lastImportDate.getTime()) / (1000 * 60 * 60 * 24));
                        if (days === 0) return ' (today)';
                        if (days === 1) return ' (yesterday)';
                        if (days > 30) return ` (${days} days ago)`;
                        return ` (${days} days ago)`;
                    })()}
                </div>
            )}

            {/* Year Progress */}
            <div className="bg-surface-overlay rounded-xl p-4 border border-border-default">
                <div className="flex items-start justify-between gap-4 mb-3">
                    <h3 className="text-sm text-content-muted">Year Progress</h3>
                    <div className="shrink-0">
                        <ToggleInput
                            label="Project non-discretionary"
                            enabled={projectFuture ?? false}
                            setEnabled={setProjectFuture}
                            tooltip="When on, future months count their non-discretionary budget as projected spending. YTD and 'This Month' reflect the spending you're committed to even before it happens."
                        />
                    </div>
                </div>
                <div className="flex gap-1">
                    {MONTH_NAMES.map((name, idx) => {
                        const monthNum = idx + 1;
                        const monthSnapshot = months.find(
                            m => m.month === monthNum && m.year === selectedYear
                        );
                        const hasMonthData = monthSnapshot && (
                            Object.keys(monthSnapshot.spending).length > 0 || monthSnapshot.transactions.length > 0
                        );
                        const isCurrentMonth = monthNum === selectedMonth;
                        const isFuture = isMonthInFuture(monthNum, selectedYear);
                        const isProjected = !hasMonthData && isFuture && projectFuture;

                        // Compute monthly budget once (used for both real and projected scoring)
                        const monthBudget = expenses.reduce((sum, exp) => {
                            const startDate = exp.startDate || new Date(0);
                            const endDate = exp.endDate;
                            const targetDate = new Date(selectedYear, monthNum - 1, 15);
                            if (startDate > targetDate) return sum;
                            if (endDate && endDate < targetDate) return sum;
                            return sum + exp.getMonthlyAmount();
                        }, 0);

                        let budgetStatus: 'very-under' | 'under' | 'over' | 'very-over' | null = null;
                        let percentSpent = 0;
                        let tileSpent = 0;
                        if (hasMonthData && monthSnapshot) {
                            const monthSpent = Object.values(monthSnapshot.spending).reduce((s, v) => s + v, 0) + getUncategorizedSpending(monthSnapshot);
                            tileSpent = monthSpent;
                            percentSpent = monthBudget > 0 ? (monthSpent / monthBudget) * 100 : 0;

                            if (percentSpent <= 80) budgetStatus = 'very-under';
                            else if (percentSpent <= 100) budgetStatus = 'under';
                            else if (percentSpent <= 120) budgetStatus = 'over';
                            else budgetStatus = 'very-over';
                        } else if (isProjected) {
                            const projected = getNonDiscretionaryMonthlyBudget(expenses, monthNum, selectedYear);
                            tileSpent = projected;
                            percentSpent = monthBudget > 0 ? (projected / monthBudget) * 100 : 0;
                            if (percentSpent <= 80) budgetStatus = 'very-under';
                            else if (percentSpent <= 100) budgetStatus = 'under';
                            else if (percentSpent <= 120) budgetStatus = 'over';
                            else budgetStatus = 'very-over';
                        }

                        const getButtonClasses = () => {
                            if (hasMonthData || isProjected) {
                                const base = (() => {
                                    switch (budgetStatus) {
                                        case 'very-under': return 'bg-positive-soft text-white hover:bg-positive';
                                        case 'under': return 'bg-positive-solid text-white hover:bg-positive-soft';
                                        case 'over': return 'bg-warning-soft text-white hover:bg-warning';
                                        case 'very-over': return 'bg-negative-soft text-white hover:bg-negative';
                                        default: return 'bg-positive-solid text-white hover:bg-positive-soft';
                                    }
                                })();
                                // Slight dimming hint for projected (vs. actual) data.
                                return isProjected ? `${base} opacity-70` : base;
                            }
                            return isFuture
                                ? 'bg-surface-input text-content-subtle hover:bg-surface-hover'
                                : 'bg-surface-hover text-content-muted hover:bg-surface-muted';
                        };

                        const getTitle = () => {
                            if (hasMonthData) {
                                return `${name}: ${formatCurrency(tileSpent)} spent of ${formatCurrency(monthBudget)} budget (${percentSpent.toFixed(0)}%)`;
                            }
                            if (isProjected) {
                                return `${name}: ${formatCurrency(tileSpent)} projected of ${formatCurrency(monthBudget)} budget (${percentSpent.toFixed(0)}%, non-discretionary only)`;
                            }
                            return `${name}: ${isFuture ? 'Future month — no data yet' : 'No data'}`;
                        };

                        return (
                            <button
                                key={name}
                                onClick={() => dispatch({ type: 'SET_SELECTED_MONTH', payload: { month: monthNum, year: selectedYear } })}
                                className={`flex-1 h-8 rounded flex items-center justify-center text-xs font-medium cursor-pointer transition-colors ${getButtonClasses()} ${isCurrentMonth ? 'ring-2 ring-white' : ''}`}
                                title={getTitle()}
                            >
                                {name.slice(0, 3)}
                            </button>
                        );
                    })}
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-1 mt-3 text-xs text-content-subtle">
                    <div className="flex items-center gap-1.5">
                        <div className="w-2.5 h-2.5 rounded bg-positive-soft"></div>
                        <span>&lt;80%</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                        <div className="w-2.5 h-2.5 rounded bg-positive-solid"></div>
                        <span>80-100%</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                        <div className="w-2.5 h-2.5 rounded bg-warning-soft"></div>
                        <span>100-120%</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                        <div className="w-2.5 h-2.5 rounded bg-negative-soft"></div>
                        <span>&gt;120%</span>
                    </div>
                </div>
            </div>

            {/* Spending by Category */}
            {categoryData.length > 0 && (
                <div className="bg-surface-overlay rounded-xl p-4 border border-border-default">
                    <div className="flex items-center justify-between mb-3">
                        <h3 className="text-sm text-content-muted">Average Monthly Spending</h3>
                        <span className="text-xs text-content-subtle">{chartDateRange}</span>
                    </div>
                    <div className="h-48">
                        <ChartFrame><ResponsiveBar
                            data={categoryData}
                            keys={chartKeys}
                            indexBy="name"
                            margin={chartMargin}
                            layout="horizontal"
                            valueScale={chartValueScale}
                            colors={({ data }: { data: { color: string } }) => resolve(data.color)}
                            borderRadius={4}
                            padding={0.3}
                            axisBottom={chartAxisBottom}
                            axisLeft={chartAxisLeft}
                            enableGridY={false}
                            enableLabel={false}
                            theme={chartTheme}
                            tooltip={BarTooltip}
                        /></ChartFrame>
                    </div>
                </div>
            )}

            {/* Getting Started - shown when no data and not a future month */}
            {!hasData && !isFutureMonth && (
                <div className="bg-info-tint/20 border border-info-strong/50 rounded-lg p-6 text-center">
                    <h3 className="text-lg font-semibold text-info mb-2">
                        Get Started with Budget Tracking
                    </h3>
                    <p className="text-content-default mb-4">
                        Track your actual spending against your budget.
                    </p>
                    <div className="flex justify-center gap-4 flex-wrap">
                        <div className="bg-surface-overlay rounded-lg p-4 max-w-xs">
                            <div className="text-positive font-semibold mb-1">1. Transactions Tab</div>
                            <p className="text-sm text-content-muted">
                                Import transactions from your bank or credit card
                            </p>
                        </div>
                        <div className="bg-surface-overlay rounded-lg p-4 max-w-xs">
                            <div className="text-positive font-semibold mb-1">2. Spending Tab</div>
                            <p className="text-sm text-content-muted">
                                Review spending by category and track contributions
                            </p>
                        </div>
                    </div>
                </div>
            )}

        </div>
    );
}
