import { useContext, useMemo, useCallback } from 'react';
import {
    DataSheetGrid,
    keyColumn,
    textColumn,
} from 'react-datasheet-grid';
import 'react-datasheet-grid/dist/style.css';
import { BudgetContext, Transaction } from '../../components/Objects/Budget/BudgetContext';
import { ExpenseContext } from '../../components/Objects/Expense/ExpenseContext';
import { AccountContext } from '../../components/Objects/Accounts/AccountContext';
import { InvestedAccount, SavedAccount } from '../../components/Objects/Accounts/models';
import { useAssumptions } from '../../components/Objects/Assumptions/AssumptionsContext';
import { TaxContext } from '../../components/Objects/Taxes/TaxContext';
import { SimulationContext } from '../../components/Objects/Assumptions/SimulationContext';
import { get401kLimit, getIRALimit, getHSALimit } from '../../data/ContributionLimits';
import {
    getActiveExpenses,
    getExpenseMonthlyBudget,
    calculateBudgetSummary,
    formatCurrency,
} from '../../components/Objects/Budget/budgetUtils';
import { useAutoReconcile } from '../../hooks/useAutoReconcile';
import { currencyColumn } from '../../components/Layout/DataSheetColumns';

interface SpendingRow {
    id: string;
    category: string;
    budget: number;
    actual: number | null;
    difference: number;
}

export default function SpendingTab() {
    const { months, selectedMonth, selectedYear, dispatch } = useContext(BudgetContext);
    const { expenses } = useContext(ExpenseContext);
    const { accounts } = useContext(AccountContext);
    const { assumptions } = useAssumptions();
    const { state: taxState } = useContext(TaxContext);
    const { simulation } = useContext(SimulationContext);
    const priorities = assumptions.priorities;

    // Calculate age from birth year
    const currentAge = selectedYear - assumptions.demographics.birthYear;

    // Get simulation's bucket allocations for REMAINDER type priorities
    const simulatedBucketAllocations = useMemo(() => {
        // Try next year first (Year 1 has actual allocations, Year 0 is baseline)
        const nextYearSim = simulation.find(s => s.year === selectedYear + 1);
        if (nextYearSim?.cashflow.bucketDetail && Object.keys(nextYearSim.cashflow.bucketDetail).length > 0) {
            return nextYearSim.cashflow.bucketDetail;
        }
        const currentYearSim = simulation.find(s => s.year === selectedYear);
        return currentYearSim?.cashflow.bucketDetail || {};
    }, [simulation, selectedYear]);

    const currentSnapshot = useMemo(() =>
        months.find(m => m.month === selectedMonth && m.year === selectedYear),
        [months, selectedMonth, selectedYear]
    );

    const activeExpenses = useMemo(() =>
        getActiveExpenses(expenses, selectedMonth, selectedYear),
        [expenses, selectedMonth, selectedYear]
    );

    const budgetSummary = useMemo(() =>
        calculateBudgetSummary(expenses, currentSnapshot, selectedMonth, selectedYear),
        [expenses, currentSnapshot, selectedMonth, selectedYear]
    );

    // Calculate annual contribution goals based on priority capType
    // For MAX priorities, use IRS limits; for FIXED, use capValue * 12
    const getAnnualGoal = useCallback((priority: typeof priorities[0], account: typeof accounts[0] | undefined): number => {
        if (!account) return 0;

        const inflationAdjusted = assumptions.macro.inflationAdjusted;
        const hsaCoverage = taxState.filingStatus === 'Married Filing Jointly' ? 'family' : 'individual';

        if (priority.capType === 'MAX' && account instanceof InvestedAccount) {
            // Look up IRS limit based on account's taxType
            switch (account.taxType) {
                case 'Roth IRA':
                case 'Traditional IRA':
                    return getIRALimit(selectedYear, currentAge, inflationAdjusted);
                case 'Roth 401k':
                case 'Traditional 401k':
                    return get401kLimit(selectedYear, currentAge, inflationAdjusted);
                case 'HSA':
                    return getHSALimit(selectedYear, currentAge, hsaCoverage, inflationAdjusted);
                default:
                    // Brokerage or other - use capValue if set
                    return priority.capValue || 0;
            }
        } else if (priority.capType === 'FIXED') {
            return (priority.capValue || 0) * 12; // capValue is monthly
        } else if (priority.capType === 'MULTIPLE_OF_EXPENSES') {
            // For emergency fund targets, this is the TARGET BALANCE (not annual contribution)
            const monthlyExpenses = budgetSummary.totalBudget;
            return monthlyExpenses * (priority.capValue || 0);
        } else if (priority.capType === 'REMAINDER') {
            // REMAINDER: Use simulation's projected allocation for this account
            return simulatedBucketAllocations[priority.accountId!] || 0;
        }
        return 0;
    }, [assumptions, selectedYear, currentAge, taxState.filingStatus, budgetSummary.totalBudget, simulatedBucketAllocations]);

    // Get all transactions for the current year up to the selected month (YTD)
    const ytdTransactions = useMemo(() => {
        const transactions: Transaction[] = [];
        months.forEach(m => {
            if (m.year === selectedYear && m.month <= selectedMonth) {
                transactions.push(...m.transactions);
            }
        });
        return transactions;
    }, [months, selectedYear, selectedMonth]);

    // Get transactions for the current month only
    const currentMonthTransactions = useMemo(() => {
        return currentSnapshot?.transactions || [];
    }, [currentSnapshot]);

    // Calculate actual contributions per account from transactions (YTD and current month)
    const transactionContributions = useMemo(() => {
        const ytd: Record<string, number> = {};
        const monthly: Record<string, number> = {};

        ytdTransactions.forEach(t => {
            if (t.targetAccountId && t.amount !== 0) {
                ytd[t.targetAccountId] = (ytd[t.targetAccountId] || 0) + Math.abs(t.amount);
            }
        });

        currentMonthTransactions.forEach(t => {
            if (t.targetAccountId && t.amount !== 0) {
                monthly[t.targetAccountId] = (monthly[t.targetAccountId] || 0) + Math.abs(t.amount);
            }
        });

        return { ytd, monthly };
    }, [ytdTransactions, currentMonthTransactions]);

    // Get starting balance for each account at the beginning of the year
    // This is either the December balance of the previous year, or the account's current balance
    const startingBalances = useMemo(() => {
        const balances: Record<string, number> = {};

        // Look for December of previous year
        const decSnapshot = months.find(m => m.month === 12 && m.year === selectedYear - 1);
        // Or January of current year as fallback
        const janSnapshot = months.find(m => m.month === 1 && m.year === selectedYear);

        priorities.filter(p => p.accountId).forEach(p => {
            const accountId = p.accountId!;
            // Priority: Dec prev year > Jan current year > account's current balance
            if (decSnapshot?.accountBalances[accountId] !== undefined) {
                balances[accountId] = decSnapshot.accountBalances[accountId];
            } else if (janSnapshot?.accountBalances[accountId] !== undefined) {
                balances[accountId] = janSnapshot.accountBalances[accountId];
            } else {
                // Fall back to account's current balance from context
                const account = accounts.find(a => a.id === accountId);
                balances[accountId] = account?.amount || 0;
            }
        });

        return balances;
    }, [months, selectedYear, priorities, accounts]);

    // Build contribution rows with appropriate tracking method per account type
    const contributionRows = useMemo(() => {
        return priorities
            .filter(p => p.accountId)
            .map((p, index) => {
                const account = accounts.find(a => a.id === p.accountId);
                const accountName = account?.name || 'Unknown Account';
                const accountId = p.accountId!;

                // Calculate annual goal based on priority type
                const annualTarget = getAnnualGoal(p, account);

                // MULTIPLE_OF_EXPENSES is a "reach this balance" goal, not "contribute per year"
                const isBalanceTarget = p.capType === 'MULTIPLE_OF_EXPENSES';

                const monthlyTarget = isBalanceTarget ? 0 : annualTarget / 12;
                const ytdTarget = isBalanceTarget ? annualTarget : monthlyTarget * selectedMonth;

                // Determine tracking method based on account type:
                // - InvestedAccount: Use transaction-based tracking (decouples from market gains)
                // - SavedAccount: Use balance-based tracking (simple deposits/withdrawals + APR)
                const isInvestedAccount = account instanceof InvestedAccount;
                const isSavingsAccount = account instanceof SavedAccount;

                // Get starting balance
                const startingBalance = startingBalances[accountId] || 0;

                // Get actual balance from current month snapshot, or account's current balance
                const actualBalance = currentSnapshot?.accountBalances[accountId] ?? account?.amount ?? 0;

                // Calculate YTD actual contribution based on account type
                let ytdActual: number;
                if (isInvestedAccount) {
                    // Transaction-based: Sum of tagged contribution transactions
                    ytdActual = transactionContributions.ytd[accountId] || 0;
                } else {
                    // Balance-based: Difference in balance (works for savings accounts)
                    ytdActual = actualBalance - startingBalance;
                }

                // Monthly actual from transactions
                const monthlyActual = transactionContributions.monthly[accountId] || 0;

                // Determine status based on progress
                let status: 'ahead' | 'on-track' | 'behind' | 'overfunded' = 'on-track';
                if (isBalanceTarget && annualTarget > 0) {
                    // For balance targets: compare current balance to target
                    const ratio = actualBalance / annualTarget;
                    if (ratio > 1.05) status = 'overfunded';
                    else if (ratio >= 0.95) status = 'on-track';
                    else status = 'behind';
                } else if (ytdTarget > 0) {
                    const ratio = ytdActual / ytdTarget;
                    // For contribution targets: ahead if > 105%, on-track if 95-105%, behind if < 95%
                    if (ratio < 0.95) status = 'behind';
                    else if (ratio > 1.05) status = 'ahead';
                } else if (ytdActual > 0) {
                    status = 'ahead';
                }

                return {
                    priority: index + 1,
                    accountId,
                    accountName,
                    bucketName: p.name,
                    annualTarget,
                    monthlyTarget,
                    ytdTarget,
                    ytdActual,
                    monthlyActual,
                    actualBalance,
                    startingBalance,
                    status,
                    isTransactionBased: isInvestedAccount,
                    isSavingsAccount,
                    isBalanceTarget, // For display - shows "Balance" vs "Contribution" tracking
                    capType: p.capType,
                };
            });
    }, [priorities, accounts, getAnnualGoal, transactionContributions, selectedMonth, startingBalances, currentSnapshot]);

    const hasPriorityBuckets = priorities.filter(p => p.accountId).length > 0;

    // Auto-reconcile - sync spending with transaction totals
    useAutoReconcile(months, dispatch);

    // Create rows for the grid
    const rows: SpendingRow[] = useMemo(() => {
        return activeExpenses.map(expense => {
            const budget = getExpenseMonthlyBudget(expense);
            const actual = currentSnapshot?.spending[expense.id] ?? null;
            const difference = actual !== null ? budget - actual : budget;

            return {
                id: expense.id,
                category: expense.name,
                budget,
                actual,
                difference,
            };
        });
    }, [activeExpenses, currentSnapshot]);

    // Define columns - use keyColumn and cast to avoid type issues with nullable fields
    const columns = useMemo(() => [
        {
            ...keyColumn('category', textColumn),
            title: 'Category',
            disabled: true,
            minWidth: 150,
        },
        {
            ...keyColumn('budget', currencyColumn),
            title: 'Budget',
            disabled: true,
            minWidth: 100,
        },
        {
            ...keyColumn('actual', currencyColumn),
            title: 'Actual',
            disabled: true,
            minWidth: 100,
        },
        {
            ...keyColumn('difference', currencyColumn),
            title: 'Diff',
            disabled: true,
            minWidth: 100,
        },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ] as any, []);

    if (activeExpenses.length === 0) {
        return (
            <div className="text-center py-12">
                <div className="text-gray-400 mb-4">
                    No expense categories found for this month.
                </div>
                <p className="text-gray-500 text-sm">
                    Add expenses in the Current &gt; Expenses tab to start tracking your budget.
                </p>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            {/* Spending Grid */}
            <div className="bg-gray-800 rounded-lg border border-gray-700 overflow-hidden">
                <div className="p-4 border-b border-gray-700">
                    <h3 className="text-lg font-semibold text-white">Spending by Category</h3>
                    <p className="text-sm text-gray-400 mt-1">
                        Spending is automatically calculated from categorized transactions.
                    </p>
                </div>
                <div className="budget-grid">
                    <DataSheetGrid
                        value={rows}
                        columns={columns}
                        lockRows
                        rowHeight={40}
                        headerRowHeight={40}
                    />
                </div>
            </div>

            {/* Contributions Section */}
            {hasPriorityBuckets && selectedYear !== new Date().getFullYear() && (
                <div className="bg-gray-800 rounded-lg border border-gray-700 p-6">
                    <h3 className="text-lg font-semibold text-white mb-2">Contribution Tracking</h3>
                    <p className="text-sm text-gray-400">
                        Contribution tracking is available for the current year only. Navigate to {new Date().getFullYear()} to track your contributions against annual goals.
                    </p>
                </div>
            )}
            {hasPriorityBuckets && selectedYear === new Date().getFullYear() && (
                <div className="bg-gray-800 rounded-lg border border-gray-700 overflow-hidden">
                    <div className="p-4 border-b border-gray-700">
                        <h3 className="text-lg font-semibold text-white">Contribution Tracking</h3>
                        <p className="text-sm text-gray-400 mt-1">
                            Track contributions to your paycheck allocator selections. Investment accounts use transaction-based tracking.
                        </p>
                    </div>
                    <div className="overflow-x-auto">
                        <table className="w-full">
                            <thead className="bg-gray-900/50">
                                <tr>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                                        #
                                    </th>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                                        Account
                                    </th>
                                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-400 uppercase tracking-wider">
                                        Current
                                    </th>
                                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-400 uppercase tracking-wider">
                                        YTD Actual
                                    </th>
                                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-400 uppercase tracking-wider">
                                        Goal
                                    </th>
                                    <th className="px-4 py-3 text-center text-xs font-medium text-gray-400 uppercase tracking-wider">
                                        Progress
                                    </th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-700">
                                {contributionRows.map((row) => {
                                    // Calculate progress percentage toward ANNUAL goal
                                    // For balance targets, use actualBalance; for contribution targets, use ytdActual
                                    const progressPercent = row.annualTarget > 0
                                        ? ((row.isBalanceTarget ? row.actualBalance : row.ytdActual) / row.annualTarget) * 100
                                        : (row.ytdActual > 0 ? 100 : 0);
                                    // Expected progress based on month (only for contribution targets, not balance targets)
                                    const expectedProgressPercent = row.isBalanceTarget ? 100 : (selectedMonth / 12) * 100;
                                    // For balance targets, show overfunded amount based on current balance vs target
                                    const overfundedAmount = row.isBalanceTarget && row.actualBalance > row.annualTarget
                                        ? row.actualBalance - row.annualTarget
                                        : 0;

                                    return (
                                        <tr key={row.accountId} className="hover:bg-gray-700/30">
                                            <td className="px-4 py-3 text-sm text-gray-400">
                                                {row.priority}
                                            </td>
                                            <td className="px-4 py-3">
                                                <div className="text-sm font-medium text-white">{row.accountName}</div>
                                                <div className="text-xs text-gray-500">
                                                    {row.bucketName}
                                                </div>
                                            </td>
                                            <td className="px-4 py-3 text-sm text-right text-white font-medium">
                                                {formatCurrency(row.actualBalance)}
                                            </td>
                                            <td className={`px-4 py-3 text-sm text-right font-medium ${
                                                row.ytdActual > 0 ? 'text-green-400' : row.ytdActual < 0 ? 'text-red-400' : 'text-gray-400'
                                            }`}>
                                                {row.ytdActual >= 0 ? '+' : ''}{formatCurrency(row.ytdActual)}
                                            </td>
                                            <td className="px-4 py-3 text-sm text-right text-gray-400">
                                                {row.annualTarget > 0 ? (
                                                    <div>
                                                        {formatCurrency(row.annualTarget)}
                                                        {!row.isBalanceTarget && (
                                                            <div className="text-xs text-gray-500">/year</div>
                                                        )}
                                                    </div>
                                                ) : '—'}
                                            </td>
                                            <td className="px-4 py-3">
                                                {row.annualTarget > 0 ? (
                                                    <div className="flex flex-col items-center gap-1">
                                                        <div className="w-full bg-gray-700 rounded-full h-2 relative">
                                                            {/* Expected progress marker (only for contribution targets) */}
                                                            {!row.isBalanceTarget && (
                                                                <div
                                                                    className="absolute top-0 bottom-0 w-px bg-gray-600/40"
                                                                    style={{ left: `${expectedProgressPercent}%` }}
                                                                />
                                                            )}
                                                            {/* Actual progress */}
                                                            <div
                                                                className={`h-full rounded-full transition-all ${
                                                                    row.status === 'overfunded' ? 'bg-blue-500' :
                                                                    progressPercent >= expectedProgressPercent ? 'bg-green-500' : 'bg-yellow-500'
                                                                }`}
                                                                style={{ width: `${Math.min(progressPercent, 100)}%` }}
                                                            />
                                                        </div>
                                                        <span className={`text-xs ${
                                                            row.status === 'overfunded' ? 'text-blue-400' :
                                                            progressPercent >= expectedProgressPercent ? 'text-green-400' : 'text-yellow-400'
                                                        }`}>
                                                            {row.status === 'overfunded'
                                                                ? `+${formatCurrency(overfundedAmount)} over`
                                                                : `${progressPercent.toFixed(0)}%`
                                                            }
                                                        </span>
                                                    </div>
                                                ) : (
                                                    <div className="text-center">
                                                        <span className="text-xs text-green-400">
                                                            {row.ytdActual >= 0 ? 'Complete' : '—'}
                                                        </span>
                                                    </div>
                                                )}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}


            {/* Legend */}
            <div className="flex gap-6 text-sm text-gray-400">
                <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded bg-green-400"></div>
                    <span>Under budget</span>
                </div>
                <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded bg-yellow-400"></div>
                    <span>Over budget</span>
                </div>
            </div>
        </div>
    );
}
