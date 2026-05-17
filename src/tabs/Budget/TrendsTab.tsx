import { useContext, useMemo } from 'react';
import { ResponsiveLine } from '@nivo/line';
import { BudgetContext } from '../../components/Objects/Budget/BudgetContext';
import { ExpenseContext } from '../../components/Objects/Expense/ExpenseContext';
import {
    MONTH_NAMES,
    formatCurrency,
    getExpenseMonthlyBudget,
} from '../../components/Objects/Budget/budgetUtils';

const lineMargin = { top: 20, right: 20, bottom: 40, left: 60 };
const lineXScale = { type: 'point' } as const;
const lineYScale = { type: 'linear' as const, min: 0, max: 'auto' as const };
const lineAxisBottom = { tickSize: 0, tickPadding: 10 };
const spendingAxisLeft = {
    tickSize: 0,
    tickPadding: 10,
    format: (v: number) => `$${(v / 1000).toFixed(0)}k`,
};
const categoryAxisLeft = {
    tickSize: 0,
    tickPadding: 10,
    format: (v: number) => `$${v.toLocaleString()}`,
};
const spendingColors = ['#f87171', '#4ade80'];
const categoryColors = { datum: 'color' } as const;
const lineTheme = {
    axis: {
        ticks: { text: { fill: '#6b7280', fontSize: 11 } },
    },
    grid: { line: { stroke: '#374151' } },
    legends: { text: { fill: '#9ca3af', fontSize: 11 } },
    crosshair: { line: { stroke: '#86efac', strokeWidth: 1 } },
};
const categoryLineTheme = {
    ...lineTheme,
    legends: { text: { fill: '#9ca3af', fontSize: 10 } },
};
const pointColor = { theme: 'background' } as const;
const pointBorderColor = { from: 'serieColor' } as const;
const spendingLegends = [
    {
        anchor: 'top-right' as const,
        direction: 'row' as const,
        translateY: -20,
        itemWidth: 80,
        itemHeight: 20,
        symbolSize: 10,
        symbolShape: 'circle' as const,
    },
];
const categoryLegends = [
    {
        anchor: 'top' as const,
        direction: 'row' as const,
        translateY: -20,
        itemWidth: 100,
        itemHeight: 20,
        symbolSize: 8,
        symbolShape: 'circle' as const,
    },
];
type LineTooltipPoint = {
    data: { x: unknown; y: unknown };
    seriesId: string | number;
    seriesColor: string;
};
const LineTooltip = ({ point }: { point: LineTooltipPoint }) => (
    <div className="bg-gray-800 border border-gray-700 p-2 rounded shadow-xl text-xs">
        <div className="font-semibold text-white">{point.data.x as string}</div>
        <div style={{ color: point.seriesColor }}>
            {point.seriesId}: {formatCurrency(point.data.y as number)}
        </div>
    </div>
);

export default function TrendsTab() {
    const { months } = useContext(BudgetContext);
    const { expenses } = useContext(ExpenseContext);

    // Get last 6 months of data (relative to current date or selected year)
    const trendData = useMemo(() => {
        const now = new Date();
        const currentMonth = now.getMonth() + 1;
        const currentYear = now.getFullYear();

        // Generate last 6 months
        const monthsToShow: { month: number; year: number; label: string }[] = [];
        let m = currentMonth;
        let y = currentYear;

        for (let i = 0; i < 6; i++) {
            monthsToShow.unshift({
                month: m,
                year: y,
                label: `${MONTH_NAMES[m - 1].slice(0, 3)} ${y.toString().slice(-2)}`,
            });
            m--;
            if (m === 0) {
                m = 12;
                y--;
            }
        }

        return monthsToShow.map(({ month, year, label }) => {
            const snapshot = months.find(s => s.month === month && s.year === year);
            const totalSpent = snapshot
                ? Object.values(snapshot.spending).reduce((s, v) => s + v, 0)
                : 0;

            const budget = expenses.reduce((sum, exp) => {
                const startDate = exp.startDate || new Date(0);
                const endDate = exp.endDate;
                const targetDate = new Date(year, month - 1, 15);

                if (startDate > targetDate) return sum;
                if (endDate && endDate < targetDate) return sum;

                return sum + getExpenseMonthlyBudget(exp);
            }, 0);

            return {
                month: label,
                spent: totalSpent,
                budget,
                difference: budget - totalSpent,
            };
        });
    }, [months, expenses]);

    // Line chart data for spending vs budget
    const lineChartData = useMemo(() => [
        {
            id: 'Spent',
            color: '#f87171', // red-400
            data: trendData.map(d => ({ x: d.month, y: d.spent })),
        },
        {
            id: 'Budget',
            color: '#4ade80', // green-400
            data: trendData.map(d => ({ x: d.month, y: d.budget })),
        },
    ], [trendData]);

    // Line chart data for category trends over time
    const categoryTrendData = useMemo(() => {
        const colors = ['#f87171', '#fb923c', '#facc15', '#4ade80', '#22d3ee', '#818cf8', '#e879f9', '#f472b6'];

        // Get top categories by total spending
        const categoryTotals: Record<string, number> = {};
        expenses.forEach(exp => {
            categoryTotals[exp.id] = 0;
        });

        trendData.forEach(({ month }) => {
            const [monthName, yearStr] = month.split(' ');
            const monthNum = MONTH_NAMES.findIndex(m => m.startsWith(monthName)) + 1;
            const year = 2000 + parseInt(yearStr);
            const snapshot = months.find(s => s.month === monthNum && s.year === year);
            if (snapshot) {
                expenses.forEach(exp => {
                    categoryTotals[exp.id] += snapshot.spending[exp.id] || 0;
                });
            }
        });

        // Get top 6 categories
        const topCategories = expenses
            .filter(exp => categoryTotals[exp.id] > 0)
            .sort((a, b) => categoryTotals[b.id] - categoryTotals[a.id])
            .slice(0, 6);

        return topCategories.map((exp, idx) => ({
            id: exp.name,
            color: colors[idx % colors.length],
            data: trendData.map(({ month }) => {
                const [monthName, yearStr] = month.split(' ');
                const monthNum = MONTH_NAMES.findIndex(m => m.startsWith(monthName)) + 1;
                const year = 2000 + parseInt(yearStr);
                const snapshot = months.find(s => s.month === monthNum && s.year === year);
                return {
                    x: month,
                    y: snapshot?.spending[exp.id] || 0,
                };
            }),
        }));
    }, [trendData, months, expenses]);

    // Calculate stats
    const stats = useMemo(() => {
        const totalSpent = trendData.reduce((s, d) => s + d.spent, 0);
        const totalBudget = trendData.reduce((s, d) => s + d.budget, 0);
        const monthsWithData = trendData.filter(d => d.spent > 0).length;
        const avgMonthly = monthsWithData > 0 ? totalSpent / monthsWithData : 0;

        return { totalSpent, totalBudget, avgMonthly };
    }, [trendData]);

    const hasData = trendData.some(d => d.spent > 0);

    if (!hasData) {
        return (
            <div className="text-center py-12">
                <div className="text-gray-400 mb-4">
                    No spending data for the last 6 months.
                </div>
                <p className="text-gray-500 text-sm">
                    Enter spending in the Spending tab to see trends over time.
                </p>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            {/* Stats Cards */}
            <div className="grid grid-cols-3 gap-4">
                <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
                    <div className="text-xs text-gray-500">6-Month Total</div>
                    <div className="text-xl font-bold text-white">{formatCurrency(stats.totalSpent)}</div>
                </div>
                <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
                    <div className="text-xs text-gray-500">6-Month Budget</div>
                    <div className="text-xl font-bold text-white">{formatCurrency(stats.totalBudget)}</div>
                </div>
                <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
                    <div className="text-xs text-gray-500">Monthly Average</div>
                    <div className="text-xl font-bold text-white">{formatCurrency(stats.avgMonthly)}</div>
                </div>
            </div>

            {/* Spending vs Budget Line Chart */}
            <div className="bg-gray-800 rounded-xl p-4 border border-gray-700">
                <h3 className="text-sm text-gray-400 mb-4">Spending vs Budget (Last 6 Months)</h3>
                <div className="h-64">
                    <ResponsiveLine
                        data={lineChartData}
                        margin={lineMargin}
                        xScale={lineXScale}
                        yScale={lineYScale}
                        axisBottom={lineAxisBottom}
                        axisLeft={spendingAxisLeft}
                        enableGridX={false}
                        gridYValues={5}
                        colors={spendingColors}
                        lineWidth={3}
                        curve="monotoneX"
                        enablePoints={true}
                        pointSize={8}
                        pointColor={pointColor}
                        pointBorderWidth={2}
                        pointBorderColor={pointBorderColor}
                        useMesh={true}
                        enableArea={true}
                        areaOpacity={0.1}
                        legends={spendingLegends}
                        theme={lineTheme}
                        tooltip={LineTooltip}
                    />
                </div>
            </div>

            {/* Category Trends Line Chart */}
            {categoryTrendData.length > 0 && (
                <div className="bg-gray-800 rounded-xl p-4 border border-gray-700">
                    <h3 className="text-sm text-gray-400 mb-4">Category Spending Trends (Top 6)</h3>
                    <div className="h-64">
                        <ResponsiveLine
                            data={categoryTrendData}
                            margin={lineMargin}
                            xScale={lineXScale}
                            yScale={lineYScale}
                            axisBottom={lineAxisBottom}
                            axisLeft={categoryAxisLeft}
                            enableGridX={false}
                            gridYValues={5}
                            colors={categoryColors}
                            lineWidth={2}
                            curve="linear"
                            enablePoints={true}
                            pointSize={6}
                            pointColor={pointColor}
                            pointBorderWidth={2}
                            pointBorderColor={pointBorderColor}
                            useMesh={true}
                            legends={categoryLegends}
                            theme={categoryLineTheme}
                            tooltip={LineTooltip}
                        />
                    </div>
                </div>
            )}

        </div>
    );
}
