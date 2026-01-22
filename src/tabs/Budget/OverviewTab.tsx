import { useContext, useMemo } from 'react';
import { ResponsiveBar } from '@nivo/bar';
import { BudgetContext } from '../../components/Objects/Budget/BudgetContext';
import { ExpenseContext } from '../../components/Objects/Expense/ExpenseContext';
import {
    calculateBudgetSummary,
    formatCurrency,
    MONTH_NAMES,
} from '../../components/Objects/Budget/budgetUtils';

export default function OverviewTab() {
    const { months, selectedMonth, selectedYear, dispatch } = useContext(BudgetContext);
    const { expenses } = useContext(ExpenseContext);

    const currentSnapshot = useMemo(() =>
        months.find(m => m.month === selectedMonth && m.year === selectedYear),
        [months, selectedMonth, selectedYear]
    );

    const budgetSummary = useMemo(() =>
        calculateBudgetSummary(expenses, currentSnapshot, selectedMonth, selectedYear),
        [expenses, currentSnapshot, selectedMonth, selectedYear]
    );

    // Calculate year-to-date stats (from first month with data to selected month)
    const ytdStats = useMemo(() => {
        // Find months with data in the selected year
        const monthsWithData = months
            .filter(m =>
                m.year === selectedYear &&
                (Object.keys(m.spending).length > 0 || m.transactions.length > 0)
            )
            .map(m => m.month);

        // Find the earliest month with data
        const firstMonthWithData = monthsWithData.length > 0 ? Math.min(...monthsWithData) : selectedMonth;

        let totalBudget = 0;
        let totalSpent = 0;

        // Calculate budget from first month with data to selected month
        for (let month = firstMonthWithData; month <= selectedMonth; month++) {
            // Calculate expected budget for this month
            const monthBudget = expenses.reduce((sum, exp) => {
                const startDate = exp.startDate || new Date(0);
                const endDate = exp.endDate;
                const targetDate = new Date(selectedYear, month - 1, 15);

                if (startDate > targetDate) return sum;
                if (endDate && endDate < targetDate) return sum;

                return sum + exp.getMonthlyAmount();
            }, 0);
            totalBudget += monthBudget;

            // Get actual spending for month (if it exists)
            const snapshot = months.find(m => m.year === selectedYear && m.month === month);
            if (snapshot) {
                totalSpent += Object.values(snapshot.spending).reduce((s, v) => s + v, 0);
            }
        }

        return {
            totalBudget,
            totalSpent,
            remaining: totalBudget - totalSpent,
            isUnderBudget: totalSpent <= totalBudget,
        };
    }, [months, expenses, selectedMonth, selectedYear]);

    const hasData = currentSnapshot && (
        Object.keys(currentSnapshot.spending).length > 0 ||
        currentSnapshot.transactions.length > 0
    );

    const now = new Date();
    const isFutureMonth = selectedYear > now.getFullYear() ||
        (selectedYear === now.getFullYear() && selectedMonth > now.getMonth() + 1);

    // Category spending data for bar chart (average of 6 months ending at selected month)
    const categoryData = useMemo(() => {
        const colors = ['#f87171', '#fb923c', '#facc15', '#4ade80', '#22d3ee', '#818cf8', '#e879f9', '#f472b6'];

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
            if (snapshot) {
                expenses.forEach(exp => {
                    if (snapshot.spending[exp.id]) {
                        categoryTotals[exp.id].total += snapshot.spending[exp.id];
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
    }, [months, expenses, selectedMonth, selectedYear]);

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

    return (
        <div className="space-y-6">
            {/* Quick Stats Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* This Month */}
                <div className="bg-gray-800 rounded-xl p-4 border border-gray-700">
                    <h3 className="text-sm text-gray-400 mb-2">This Month</h3>
                    <div className="text-2xl font-bold text-white">
                        {formatCurrency(budgetSummary.totalSpent)}
                        <span className="text-gray-500 text-lg ml-1">/ {formatCurrency(budgetSummary.totalBudget)}</span>
                    </div>
                    <div className={`text-sm mt-1 ${budgetSummary.isUnderBudget ? 'text-green-400' : 'text-yellow-400'}`}>
                        {budgetSummary.isUnderBudget
                            ? `${formatCurrency(budgetSummary.remaining)} under budget`
                            : `${formatCurrency(Math.abs(budgetSummary.remaining))} over budget`
                        }
                    </div>
                    {/* Progress bar */}
                    <div className="mt-3 bg-gray-700 rounded-full h-2 overflow-hidden">
                        <div
                            className={`h-full transition-all duration-300 ${
                                budgetSummary.percentSpent > 100 ? 'bg-yellow-500' : 'bg-green-500'
                            }`}
                            style={{ width: `${Math.min(budgetSummary.percentSpent, 100)}%` }}
                        />
                    </div>
                </div>

                {/* Year to Date */}
                <div className="bg-gray-800 rounded-xl p-4 border border-gray-700">
                    <h3 className="text-sm text-gray-400 mb-2">Year to Date</h3>
                    <div className="text-2xl font-bold text-white">
                        {formatCurrency(ytdStats.totalSpent)}
                        <span className="text-gray-500 text-lg ml-1">/ {formatCurrency(ytdStats.totalBudget)}</span>
                    </div>
                    <div className={`text-sm mt-1 ${ytdStats.isUnderBudget ? 'text-green-400' : 'text-yellow-400'}`}>
                        {ytdStats.isUnderBudget
                            ? `${formatCurrency(ytdStats.remaining)} under budget`
                            : `${formatCurrency(Math.abs(ytdStats.remaining))} over budget`
                        }
                    </div>
                </div>
            </div>

            {/* Year Progress */}
            <div className="bg-gray-800 rounded-xl p-4 border border-gray-700">
                <h3 className="text-sm text-gray-400 mb-3">Year Progress</h3>
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
                        const isFuture = monthNum > new Date().getMonth() + 1 && selectedYear >= new Date().getFullYear();

                        // Calculate budget status for months with data
                        let budgetStatus: 'very-under' | 'under' | 'over' | 'very-over' | null = null;
                        let percentSpent = 0;
                        if (hasMonthData && monthSnapshot) {
                            const monthBudget = expenses.reduce((sum, exp) => {
                                const startDate = exp.startDate || new Date(0);
                                const endDate = exp.endDate;
                                const targetDate = new Date(selectedYear, monthNum - 1, 15);
                                if (startDate > targetDate) return sum;
                                if (endDate && endDate < targetDate) return sum;
                                return sum + exp.getMonthlyAmount();
                            }, 0);
                            const monthSpent = Object.values(monthSnapshot.spending).reduce((s, v) => s + v, 0);
                            percentSpent = monthBudget > 0 ? (monthSpent / monthBudget) * 100 : 0;

                            if (percentSpent <= 80) budgetStatus = 'very-under';
                            else if (percentSpent <= 100) budgetStatus = 'under';
                            else if (percentSpent <= 120) budgetStatus = 'over';
                            else budgetStatus = 'very-over';
                        }

                        const getButtonClasses = () => {
                            if (hasMonthData) {
                                switch (budgetStatus) {
                                    case 'very-under': return 'bg-blue-500 text-white hover:bg-blue-400';
                                    case 'under': return 'bg-teal-600 text-white hover:bg-teal-500';
                                    case 'over': return 'bg-orange-500 text-white hover:bg-orange-400';
                                    case 'very-over': return 'bg-rose-600 text-white hover:bg-rose-500';
                                    default: return 'bg-teal-600 text-white hover:bg-teal-500';
                                }
                            }
                            return isFuture
                                ? 'bg-gray-700 text-gray-500 hover:bg-gray-600'
                                : 'bg-gray-600 text-gray-400 hover:bg-gray-500';
                        };

                        const getTitle = () => {
                            if (hasMonthData) {
                                return `${name}: ${percentSpent.toFixed(0)}% of budget spent`;
                            }
                            return `${name}: ${isFuture ? 'Future' : 'No data'}`;
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
                <div className="flex flex-wrap gap-x-4 gap-y-1 mt-3 text-xs text-gray-500">
                    <div className="flex items-center gap-1.5">
                        <div className="w-2.5 h-2.5 rounded bg-blue-500"></div>
                        <span>&lt;80%</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                        <div className="w-2.5 h-2.5 rounded bg-teal-600"></div>
                        <span>80-100%</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                        <div className="w-2.5 h-2.5 rounded bg-orange-500"></div>
                        <span>100-120%</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                        <div className="w-2.5 h-2.5 rounded bg-rose-600"></div>
                        <span>&gt;120%</span>
                    </div>
                </div>
            </div>

            {/* Spending by Category */}
            {categoryData.length > 0 && (
                <div className="bg-gray-800 rounded-xl p-4 border border-gray-700">
                    <div className="flex items-center justify-between mb-3">
                        <h3 className="text-sm text-gray-400">Average Monthly Spending</h3>
                        <span className="text-xs text-gray-500">{chartDateRange}</span>
                    </div>
                    <div className="h-48">
                        <ResponsiveBar
                            data={categoryData}
                            keys={['average']}
                            indexBy="name"
                            margin={{ top: 5, right: 20, bottom: 25, left: 100 }}
                            layout="horizontal"
                            valueScale={{ type: 'linear' }}
                            colors={({ data }) => data.color as string}
                            borderRadius={4}
                            padding={0.3}
                            axisBottom={{
                                tickSize: 0,
                                tickPadding: 5,
                                format: (v) => `$${v.toLocaleString()}`,
                            }}
                            axisLeft={{
                                tickSize: 0,
                                tickPadding: 10,
                            }}
                            enableGridY={false}
                            enableLabel={false}
                            theme={{
                                axis: {
                                    ticks: { text: { fill: '#9ca3af', fontSize: 11 } },
                                },
                                grid: { line: { stroke: '#374151' } },
                            }}
                            tooltip={({ data, value }) => (
                                <div className="bg-gray-800 border border-gray-700 p-2 rounded shadow-xl text-xs">
                                    <div className="font-semibold text-white">{data.name}</div>
                                    <div className="text-green-400">{formatCurrency(value)} / month avg</div>
                                </div>
                            )}
                        />
                    </div>
                </div>
            )}

            {/* Getting Started - shown when no data and not a future month */}
            {!hasData && !isFutureMonth && (
                <div className="bg-blue-900/20 border border-blue-700/50 rounded-lg p-6 text-center">
                    <h3 className="text-lg font-semibold text-blue-400 mb-2">
                        Get Started with Budget Tracking
                    </h3>
                    <p className="text-gray-300 mb-4">
                        Track your actual spending against your budget.
                    </p>
                    <div className="flex justify-center gap-4 flex-wrap">
                        <div className="bg-gray-800 rounded-lg p-4 max-w-xs">
                            <div className="text-green-400 font-semibold mb-1">1. Transactions Tab</div>
                            <p className="text-sm text-gray-400">
                                Import transactions from your bank or credit card
                            </p>
                        </div>
                        <div className="bg-gray-800 rounded-lg p-4 max-w-xs">
                            <div className="text-green-400 font-semibold mb-1">2. Spending Tab</div>
                            <p className="text-sm text-gray-400">
                                Review spending by category and track contributions
                            </p>
                        </div>
                    </div>
                </div>
            )}

        </div>
    );
}
