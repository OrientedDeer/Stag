import { useContext, useMemo, useCallback } from 'react';
import {
    DataSheetGrid,
    keyColumn,
} from 'react-datasheet-grid';
import 'react-datasheet-grid/dist/style.css';
import { BudgetContext, Transaction } from '../../components/Objects/Budget/BudgetContext';
import { ExpenseContext } from '../../components/Objects/Expense/ExpenseContext';
import { AccountContext } from '../../components/Objects/Accounts/AccountContext';
import { IncomeContext } from '../../components/Objects/Income/IncomeContext';
import { WorkIncome } from '../../components/Objects/Income/models';
import { InvestedAccount, SavedAccount, AnyAccount } from '../../components/Objects/Accounts/models';
import { isLongTermGoal } from '../../components/Objects/Expense/models';
import { useAssumptions, getBirthYear } from '../../components/Objects/Assumptions/AssumptionsContext';
import { TaxContext } from '../../components/Objects/Taxes/TaxContext';
import { SimulationContext } from '../../components/Objects/Assumptions/SimulationContext';
import { get401kLimit, getIRALimit, getHSALimit } from '../../data/ContributionLimits';
import {
    getActiveExpenses,
    getExpenseMonthlyBudget,
    formatCurrency,
} from '../../components/Objects/Budget/budgetUtils';
import { currencyColumn, readOnlyTextColumn } from '../../components/Layout/DataSheetColumns';
import { ToggleInput } from '../../components/Layout/InputFields/ToggleInput';
import { Tooltip } from '../../components/Layout/InputFields/Tooltip';

interface SpendingRow {
    id: string;
    category: string;
    budget: number;
    actual: number | null;
    difference: number;
}

export default function SpendingTab() {
    const { months, selectedMonth, selectedYear, projectFuture, dispatch: budgetDispatch } = useContext(BudgetContext);
    const { expenses } = useContext(ExpenseContext);
    const { accounts, amountHistory } = useContext(AccountContext);
    const { incomes } = useContext(IncomeContext);
    const { assumptions } = useAssumptions();
    const { state: taxState } = useContext(TaxContext);
    const { simulation } = useContext(SimulationContext);
    const priorities = assumptions.priorities;

    const setProjectFuture = useCallback((enabled: boolean) => {
        budgetDispatch({ type: 'SET_PROJECT_FUTURE', payload: enabled });
    }, [budgetDispatch]);

    const today = useMemo(() => new Date(), []);
    const currentRealMonth = today.getMonth() + 1;
    const currentRealYear = today.getFullYear();
    const isFutureMonth = selectedYear > currentRealYear ||
        (selectedYear === currentRealYear && selectedMonth > currentRealMonth);
    const isPastYear = selectedYear < currentRealYear;
    const isCurrentYear = selectedYear === currentRealYear;

    // Calculate age from birth year
    const currentAge = selectedYear - getBirthYear(assumptions.milestones);

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

    // Stable monthly-expenses denominator for emergency-fund targets.
    // Always uses TODAY's active expenses (not the selected month/year) so the
    // target reflects what you're actually paying now and doesn't shift as you
    // scrub months or revisit historical years.
    const currentMonthlyExpenses = useMemo(() => {
        const activeToday = getActiveExpenses(expenses, currentRealMonth, currentRealYear);
        return activeToday.reduce((sum, exp) => sum + exp.getMonthlyAmount(), 0);
    }, [expenses, currentRealMonth, currentRealYear]);

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
            // Emergency-fund target = months × current monthly expenses (today's active set).
            return currentMonthlyExpenses * (priority.capValue || 0);
        } else if (priority.capType === 'REMAINDER') {
            // REMAINDER: Use simulation's projected allocation for this account
            return simulatedBucketAllocations[priority.accountId!] || 0;
        }
        return 0;
    }, [assumptions, selectedYear, currentAge, taxState.filingStatus, currentMonthlyExpenses, simulatedBucketAllocations]);

    // The "tracking horizon" is the month we treat as YTD-end:
    // - past years: full year (month 12)
    // - current year: up through selectedMonth (or current real month if user scrubs ahead)
    // - future years: shouldn't show tracking, but use 12 as a fallback for display math
    const trackingMonth = useMemo(() => {
        if (isPastYear) return 12;
        if (isCurrentYear) return Math.min(selectedMonth, currentRealMonth);
        return 12;
    }, [isPastYear, isCurrentYear, selectedMonth, currentRealMonth]);

    // Get all transactions for the current year up to the tracking month (YTD)
    const ytdTransactions = useMemo(() => {
        const transactions: Transaction[] = [];
        months.forEach(m => {
            if (m.year === selectedYear && m.month <= trackingMonth) {
                transactions.push(...m.transactions);
            }
        });
        return transactions;
    }, [months, selectedYear, trackingMonth]);

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

    // Historic balance for an account from amountHistory: the latest recorded
    // entry on or before `asOf` (an ISO YYYY-MM-DD upper bound). Lets the budget
    // show the real balance for a past month instead of today's live balance.
    const historicBalance = useCallback((accountId: string, asOf: string): number | null => {
        const hist = amountHistory[accountId];
        if (!hist || hist.length === 0) return null;
        let best: number | null = null;
        let bestDate = '';
        for (const e of hist) {
            if (e.date <= asOf && e.date >= bestDate) { best = e.num; bestDate = e.date; }
        }
        return best;
    }, [amountHistory]);

    // ISO upper bounds (lexical): end of the selected month, and end of the
    // prior December (= the selected year's starting point).
    const selectedMonthEnd = `${selectedYear}-${String(selectedMonth).padStart(2, '0')}-31`;
    const priorYearEnd = `${selectedYear - 1}-12-31`;

    // Get starting balance for each account at the beginning of the year.
    // Order of preference: Dec balance of prev year > Jan balance of current year >
    // recorded history at year start > account's current balance.
    // We anchor on the real Jan 1 balance so "expected by now" doesn't drift with today's actual balance.
    const startingBalances = useMemo(() => {
        const balances: Record<string, number> = {};
        const decSnapshot = months.find(m => m.month === 12 && m.year === selectedYear - 1);
        const janSnapshot = months.find(m => m.month === 1 && m.year === selectedYear);

        accounts.forEach(account => {
            const id = account.id;
            if (decSnapshot?.accountBalances[id] !== undefined) {
                balances[id] = decSnapshot.accountBalances[id];
            } else if (janSnapshot?.accountBalances[id] !== undefined) {
                balances[id] = janSnapshot.accountBalances[id];
            } else {
                balances[id] = historicBalance(id, priorYearEnd) ?? account.amount ?? 0;
            }
        });

        return balances;
    }, [months, selectedYear, accounts, historicBalance, priorYearEnd]);

    // Per-account annual growth rate (decimal), matching the simulation's BOY convention.
    // SavedAccount: APR. InvestedAccount/ESPPAccount: ror (custom or global) + inflation − expense ratio.
    const getAccountGrowthRate = useCallback((account: AnyAccount): number => {
        if (account instanceof SavedAccount) {
            return (account.apr || 0) / 100;
        }
        if (account instanceof InvestedAccount) {
            const ror = account.customROR ?? assumptions.investments.returnRates.ror;
            const inflation = assumptions.macro.inflationAdjusted ? assumptions.macro.inflationRate : 0;
            return (ror + inflation - (account.expenseRatio || 0)) / 100;
        }
        // Other account types (property, debt, ESPP) — no simple growth rate; treat as 0.
        return 0;
    }, [assumptions]);

    // Month (1-12) within the selected year that funding begins, per account.
    // For a long-term goal we honor its start date so a mid-year goal's expected
    // balance ramps from that month rather than from January. Started in a prior
    // year → 1 (full year); starts later this year → its month; future year → 13
    // (not funding yet). Non-goal accounts default to 1 (unchanged behavior).
    const fundingStartMonth = useMemo(() => {
        const map: Record<string, number> = {};
        expenses.forEach(exp => {
            if (!isLongTermGoal(exp) || !exp.goalAccountId || !exp.startDate) return;
            const sd = new Date(exp.startDate);
            map[exp.goalAccountId] = sd.getFullYear() < selectedYear ? 1
                : sd.getFullYear() === selectedYear ? sd.getMonth() + 1
                : 13;
        });
        return map;
    }, [expenses, selectedYear]);

    // Plan-benchmark "expected balance by now": linearly interpolate from Jan 1 actual
    // toward the planned EOY (BOY-timed: contributions added first, then grown a year).
    // Starting-balance growth ramps over the whole year (time held); the planned
    // contribution ramps only over the months funding has been active (startMonth..).
    // With startMonth = 1 this is identical to the original Jan-based formula.
    const computeExpectedByNow = useCallback(
        (account: AnyAccount, annualContribution: number, monthOfYear: number, startMonth = 1): number => {
            const start = startingBalances[account.id] ?? account.amount;
            const r = getAccountGrowthRate(account);
            const m = Math.max(0, Math.min(12, monthOfYear));
            const timeFraction = m / 12; // growth on the starting balance
            const contribFraction = Math.max(0, Math.min(12, m - (startMonth - 1))) / 12;
            return start + (start * r) * timeFraction + (annualContribution * (1 + r)) * contribFraction;
        },
        [startingBalances, getAccountGrowthRate]
    );

    // Annual contributions routed via payroll (not via priority buckets):
    // - 401k preTax + roth + employer match → matchAccountId
    // - ESPP purchases → esppAccountId
    // Uses getEffective401k() so autoMax401k 'traditional' / 'roth' modes resolve to the
    // IRS limit rather than the stored (often 0) custom value. Mirrors Dashboard.tsx.
    const getPayrollContributionToAccount = useCallback((accountId: string): number => {
        const ageInSelectedYear = selectedYear - getBirthYear(assumptions.milestones);
        const inflationAdjusted = assumptions.macro.inflationAdjusted;
        let total = 0;
        incomes.forEach(inc => {
            if (!(inc instanceof WorkIncome)) return;
            if (inc.matchAccountId === accountId) {
                const effective = inc.getEffective401k(selectedYear, ageInSelectedYear, inflationAdjusted);
                total += inc.getProratedAnnual(effective.preTax, selectedYear);
                total += inc.getProratedAnnual(effective.roth, selectedYear);
                total += inc.getEffectiveAnnualEmployerMatch(selectedYear);
            }
            if (inc.esppAccountId === accountId) {
                total += inc.getAnnualESPPContribution(selectedYear);
            }
        });
        return total;
    }, [incomes, selectedYear, assumptions]);

    // Build rows for both sections (split by balance-target vs contribution-target)
    const { savingsTargetRows, contributionRows } = useMemo(() => {
        const savings: SavingsTargetRow[] = [];
        const contribs: ContributionRow[] = [];

        priorities.filter(p => p.accountId).forEach((p, index) => {
            const account = accounts.find(a => a.id === p.accountId);
            const accountName = account?.name || 'Unknown Account';
            const accountId = p.accountId!;
            const annualTarget = getAnnualGoal(p, account);
            const startingBalance = startingBalances[accountId] || 0;
            const actualBalance = currentSnapshot?.accountBalances[accountId]
                ?? historicBalance(accountId, selectedMonthEnd)
                ?? account?.amount ?? 0;

            if (p.capType === 'MULTIPLE_OF_EXPENSES') {
                // Balance target (e.g. emergency fund). Status is a strict comparison:
                // you are either funded or in-progress; "overfunded" only kicks in at >=110%.
                const progressPercent = annualTarget > 0
                    ? (actualBalance / annualTarget) * 100
                    : 0;
                let status: 'fully-funded' | 'in-progress' | 'overfunded' = 'in-progress';
                if (annualTarget <= 0) {
                    status = 'in-progress';
                } else if (actualBalance >= annualTarget * 1.10) {
                    status = 'overfunded';
                } else if (actualBalance >= annualTarget) {
                    status = 'fully-funded';
                } else {
                    status = 'in-progress';
                }
                savings.push({
                    priority: index + 1,
                    accountId,
                    accountName,
                    bucketName: p.name,
                    target: annualTarget,
                    actualBalance,
                    startingBalance,
                    progressPercent,
                    status,
                });
                return;
            }

            // Annual contribution targets (MAX / FIXED / REMAINDER)
            const isInvestedAccount = account instanceof InvestedAccount;
            const isSavingsAccount = account instanceof SavedAccount;

            // YTD contributed
            let ytdActual: number;
            if (isInvestedAccount) {
                ytdActual = transactionContributions.ytd[accountId] || 0;
            } else {
                // Balance-delta tracking for savings accounts.
                // Floor at zero so withdrawals don't display as negative contributions.
                ytdActual = Math.max(0, actualBalance - startingBalance);
            }

            // Funding may start mid-year (e.g. a goal created in July); count
            // only the months it's actually been active so the expected balance
            // and pacing target ramp from the start month, not January.
            const startMonth = fundingStartMonth[accountId] ?? 1;
            const monthsActive = Math.max(0, trackingMonth - (startMonth - 1));

            // Plan-benchmark expected balance at the tracking month.
            // Anchors on real Jan 1 balance, projects toward (start + annualTarget) × (1 + r),
            // and ramps the contribution from the funding start month. Independent of today's actual.
            const projectedBalance = account
                ? computeExpectedByNow(account, annualTarget, trackingMonth, startMonth)
                : null;
            const balanceVariance = projectedBalance !== null
                ? actualBalance - projectedBalance
                : null;

            // Pacing — linear is the visual reference; status is more permissive.
            const monthlyTarget = annualTarget / 12;
            const ytdLinearTarget = monthlyTarget * monthsActive;
            const monthsRemaining = Math.max(0, 12 - trackingMonth);
            const remainingNeeded = Math.max(0, annualTarget - ytdActual);
            // "Unreachable" = even if user contributed 2x the linear monthly target
            // every remaining month, they couldn't catch up. Tolerates lump-sum / front-loaders.
            const isUnreachable = annualTarget > 0
                && monthsRemaining > 0
                && remainingNeeded > monthlyTarget * 2 * monthsRemaining;

            let pacing: 'complete' | 'ahead' | 'on-track' | 'waiting' | 'behind' = 'on-track';
            if (annualTarget <= 0) {
                pacing = ytdActual > 0 ? 'complete' : 'on-track';
            } else if (ytdActual <= 0) {
                // Zero contributions = no signal. Don't judge ahead/behind until they start.
                // Lump-sum / tax-time IRAs can stay here through Dec.
                pacing = 'waiting';
            } else if (ytdActual >= annualTarget * 0.95) {
                pacing = 'complete';
            } else if (monthsRemaining === 0) {
                // End of year with some progress but short of goal → behind.
                pacing = 'behind';
            } else if (isUnreachable) {
                pacing = 'behind';
            } else if (ytdActual >= ytdLinearTarget) {
                pacing = 'ahead';
            } else {
                pacing = 'on-track';
            }

            contribs.push({
                priority: index + 1,
                accountId,
                accountName,
                bucketName: p.name,
                annualTarget,
                ytdActual,
                ytdLinearTarget,
                actualBalance,
                projectedBalance,
                balanceVariance,
                pacing,
                isTransactionBased: isInvestedAccount,
                isSavingsAccount,
                capType: p.capType,
            });
        });

        return { savingsTargetRows: savings, contributionRows: contribs };
    }, [priorities, accounts, getAnnualGoal, transactionContributions, trackingMonth, startingBalances, currentSnapshot, computeExpectedByNow, fundingStartMonth, historicBalance, selectedMonthEnd]);

    // "Other accounts" — accounts not in any priority bucket. Expected balance includes
    // payroll-routed contributions (401k self + roth + employer match, ESPP purchases),
    // so a 401k account that's not in priorities still shows a realistic expected balance.
    const otherAccountRows = useMemo(() => {
        const priorityAccountIds = new Set(priorities.map(p => p.accountId).filter(Boolean) as string[]);
        return accounts
            .filter(a => !priorityAccountIds.has(a.id))
            .map(account => {
                const actualBalance = currentSnapshot?.accountBalances[account.id]
                    ?? historicBalance(account.id, selectedMonthEnd)
                    ?? account.amount;
                const annualContribution = getPayrollContributionToAccount(account.id);
                const projectedBalance = computeExpectedByNow(account, annualContribution, trackingMonth);
                const variance = actualBalance - projectedBalance;
                const variancePercent = projectedBalance !== 0
                    ? (variance / projectedBalance) * 100
                    : null;
                return {
                    accountId: account.id,
                    accountName: account.name,
                    actualBalance,
                    projectedBalance,
                    annualContribution,
                    variance,
                    variancePercent,
                };
            })
            .filter(r => r.actualBalance > 0 || r.projectedBalance > 0);
    }, [accounts, priorities, currentSnapshot, trackingMonth, computeExpectedByNow, getPayrollContributionToAccount, historicBalance, selectedMonthEnd]);

    const hasPriorityBuckets = priorities.filter(p => p.accountId).length > 0;
    const showTracking = !isFutureMonth && hasPriorityBuckets;

    // Create rows for the spending grid.
    // When projectFuture is on AND we're on a future month, non-discretionary expenses
    // show their budgeted amount as "actual" so the grid isn't all zeros.
    const rows: SpendingRow[] = useMemo(() => {
        return activeExpenses.map(expense => {
            const budget = getExpenseMonthlyBudget(expense, selectedMonth);
            let actual = currentSnapshot?.spending[expense.id] ?? null;

            if (actual === null && isFutureMonth && projectFuture && !expense.isDiscretionary) {
                actual = budget;
            }

            const difference = actual !== null ? budget - actual : budget;
            return {
                id: expense.id,
                category: expense.name,
                budget,
                actual,
                difference,
            };
        });
    }, [activeExpenses, currentSnapshot, isFutureMonth, projectFuture, selectedMonth]);

    // Define columns - use keyColumn and cast to avoid type issues with nullable fields
    const columns = useMemo(() => [
        {
            ...keyColumn('category', readOnlyTextColumn),
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
                <div className="p-4 border-b border-gray-700 flex items-start justify-between gap-4">
                    <div>
                        <h3 className="text-lg font-semibold text-white">Spending by Category</h3>
                        <p className="text-sm text-gray-400 mt-1">
                            Spending is automatically calculated from categorized transactions.
                            {isFutureMonth && projectFuture && (
                                <> Non-discretionary expenses are projected at budgeted amounts for this future month.</>
                            )}
                        </p>
                    </div>
                    {isFutureMonth && (
                        <div className="shrink-0">
                            <ToggleInput
                                label="Project non-discretionary"
                                enabled={projectFuture ?? false}
                                setEnabled={setProjectFuture}
                                tooltip="When viewing a future month, show non-discretionary expenses at their budgeted amount instead of $0."
                            />
                        </div>
                    )}
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

            {/* Future-month notice for tracking sections */}
            {hasPriorityBuckets && isFutureMonth && (
                <div className="bg-blue-900/20 border border-blue-700/50 rounded-lg p-4">
                    <p className="text-sm text-blue-400">
                        Contribution and account tracking is hidden for future months. Navigate to a past or current month to see your progress.
                    </p>
                </div>
            )}

            {/* Savings Targets (balance-based goals) */}
            {showTracking && savingsTargetRows.length > 0 && (
                <div className="bg-gray-800 rounded-lg border border-gray-700 overflow-hidden">
                    <div className="p-4 border-b border-gray-700">
                        <h3 className="text-lg font-semibold text-white">Savings Targets</h3>
                        <p className="text-sm text-gray-400 mt-1">
                            Reach-this-balance goals (e.g. emergency fund). Target uses your current monthly expenses ({formatCurrency(currentMonthlyExpenses)}/mo).
                        </p>
                    </div>
                    <div className="overflow-x-auto">
                        <table className="w-full">
                            <thead className="bg-gray-900/50">
                                <tr>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">#</th>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">Account</th>
                                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-400 uppercase tracking-wider">Current</th>
                                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-400 uppercase tracking-wider">Target</th>
                                    <th className="px-4 py-3 text-center text-xs font-medium text-gray-400 uppercase tracking-wider">Status</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-700">
                                {savingsTargetRows.map(row => {
                                    const cappedProgress = Math.min(row.progressPercent, 100);
                                    const surplus = row.actualBalance - row.target;
                                    return (
                                        <tr key={row.accountId} className="hover:bg-gray-700/30">
                                            <td className="px-4 py-3 text-sm text-gray-400">{row.priority}</td>
                                            <td className="px-4 py-3">
                                                <div className="text-sm font-medium text-white">{row.accountName}</div>
                                                <div className="text-xs text-gray-500">{row.bucketName}</div>
                                            </td>
                                            <td className="px-4 py-3 text-sm text-right text-white font-medium">
                                                {formatCurrency(row.actualBalance)}
                                            </td>
                                            <td className="px-4 py-3 text-sm text-right text-gray-400">
                                                {row.target > 0 ? formatCurrency(row.target) : '—'}
                                            </td>
                                            <td className="px-4 py-3">
                                                {row.target > 0 ? (
                                                    <div className="flex flex-col items-center gap-1">
                                                        <div className="w-full bg-gray-700 rounded-full h-2">
                                                            <div
                                                                className={`h-full rounded-full transition-all ${
                                                                    row.status === 'overfunded' ? 'bg-blue-500' :
                                                                    row.status === 'fully-funded' ? 'bg-green-500' :
                                                                    'bg-yellow-500'
                                                                }`}
                                                                style={{ width: `${cappedProgress}%` }}
                                                            />
                                                        </div>
                                                        <span className={`text-xs ${
                                                            row.status === 'overfunded' ? 'text-blue-400' :
                                                            row.status === 'fully-funded' ? 'text-green-400' :
                                                            'text-yellow-400'
                                                        }`}>
                                                            {row.status === 'overfunded'
                                                                ? `Fully funded · +${formatCurrency(surplus)} over`
                                                                : row.status === 'fully-funded'
                                                                ? 'Fully funded'
                                                                : `${row.progressPercent.toFixed(0)}% · ${formatCurrency(row.target - row.actualBalance)} to go`
                                                            }
                                                        </span>
                                                    </div>
                                                ) : (
                                                    <div className="text-center text-xs text-gray-500">—</div>
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

            {/* Annual Contributions */}
            {showTracking && contributionRows.length > 0 && (
                <div className="bg-gray-800 rounded-lg border border-gray-700 overflow-hidden">
                    <div className="p-4 border-b border-gray-700">
                        <h3 className="text-lg font-semibold text-white">
                            Annual Contributions {isPastYear && <span className="text-sm font-normal text-gray-500">({selectedYear})</span>}
                        </h3>
                        <p className="text-sm text-gray-400 mt-1">
                            Per-year contribution goals. {isCurrentYear && 'Pacing is informational — front-loading or lump-sum contributions are fine.'}
                            {isPastYear && 'Showing full-year totals.'}
                        </p>
                    </div>
                    <div className="overflow-x-auto">
                        <table className="w-full">
                            <thead className="bg-gray-900/50">
                                <tr>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">#</th>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">Account</th>
                                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-400 uppercase tracking-wider">Balance</th>
                                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-400 uppercase tracking-wider">
                                        {isPastYear ? 'Contributed' : 'YTD Contributed'}
                                    </th>
                                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-400 uppercase tracking-wider">Annual Goal</th>
                                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-400 uppercase tracking-wider">
                                        <span className="inline-flex items-center gap-1 justify-end">
                                            {isPastYear ? 'Expected EOY' : 'Expected by now'}
                                            <Tooltip text="Projected balance at the end of the tracking month, assuming on-plan contributions and growth. Mid-month, expect to be slightly behind until the month's paychecks land." />
                                        </span>
                                    </th>
                                    <th className="px-4 py-3 text-center text-xs font-medium text-gray-400 uppercase tracking-wider">Pacing</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-700">
                                {contributionRows.map(row => {
                                    const rawProgress = row.annualTarget > 0
                                        ? (row.ytdActual / row.annualTarget) * 100
                                        : (row.ytdActual > 0 ? 100 : 0);
                                    const cappedProgress = Math.min(rawProgress, 100);
                                    const overageAmount = row.annualTarget > 0
                                        ? Math.max(0, row.ytdActual - row.annualTarget)
                                        : 0;
                                    const remainingToGo = row.annualTarget > 0
                                        ? Math.max(0, row.annualTarget - row.ytdActual)
                                        : 0;
                                    const expectedProgressPercent = isPastYear
                                        ? 100
                                        : (trackingMonth / 12) * 100;
                                    const pacingColor =
                                        row.pacing === 'complete' ? 'text-green-400' :
                                        row.pacing === 'ahead' ? 'text-green-400' :
                                        row.pacing === 'on-track' ? 'text-blue-400' :
                                        row.pacing === 'waiting' ? 'text-gray-400' :
                                        'text-yellow-400';
                                    const barColor =
                                        row.pacing === 'complete' ? 'bg-green-500' :
                                        row.pacing === 'ahead' ? 'bg-green-500' :
                                        row.pacing === 'on-track' ? 'bg-blue-500' :
                                        row.pacing === 'waiting' ? 'bg-gray-500' :
                                        'bg-yellow-500';
                                    const pacingText =
                                        row.pacing === 'complete' && overageAmount > 0
                                            ? `Complete · +${formatCurrency(overageAmount)} over`
                                        : row.pacing === 'complete'
                                            ? 'Complete · 100%'
                                        : row.pacing === 'ahead'
                                            ? `Ahead · ${cappedProgress.toFixed(0)}%`
                                        : row.pacing === 'on-track'
                                            ? `On track · ${cappedProgress.toFixed(0)}% · ${formatCurrency(remainingToGo)} to go`
                                        : row.pacing === 'waiting'
                                            ? `Awaiting contribution · ${formatCurrency(remainingToGo)} planned`
                                        : `Behind · ${cappedProgress.toFixed(0)}% · ${formatCurrency(remainingToGo)} to go`;

                                    return (
                                        <tr key={row.accountId} className="hover:bg-gray-700/30">
                                            <td className="px-4 py-3 text-sm text-gray-400">{row.priority}</td>
                                            <td className="px-4 py-3">
                                                <div className="text-sm font-medium text-white">{row.accountName}</div>
                                                <div className="text-xs text-gray-500">
                                                    {row.bucketName}
                                                    {row.isTransactionBased && ' · transaction-based'}
                                                    {row.isSavingsAccount && ' · balance-delta'}
                                                </div>
                                            </td>
                                            <td className="px-4 py-3 text-sm text-right text-white font-medium">
                                                {formatCurrency(row.actualBalance)}
                                            </td>
                                            <td className={`px-4 py-3 text-sm text-right font-medium ${
                                                row.ytdActual > 0 ? 'text-green-400' : 'text-gray-400'
                                            }`}>
                                                {row.ytdActual > 0 ? '+' : ''}{formatCurrency(row.ytdActual)}
                                            </td>
                                            <td className="px-4 py-3 text-sm text-right text-gray-400">
                                                {row.annualTarget > 0 ? formatCurrency(row.annualTarget) : '—'}
                                            </td>
                                            <td className="px-4 py-3 text-sm text-right">
                                                {row.projectedBalance !== null ? (
                                                    <div>
                                                        <div className="text-gray-300">{formatCurrency(row.projectedBalance)}</div>
                                                        {row.balanceVariance !== null && (
                                                            <div className={`text-xs ${
                                                                row.balanceVariance >= 0 ? 'text-green-400' : 'text-red-400'
                                                            }`}>
                                                                {row.balanceVariance >= 0 ? '+' : ''}{formatCurrency(row.balanceVariance)}
                                                            </div>
                                                        )}
                                                    </div>
                                                ) : <span className="text-gray-500">—</span>}
                                            </td>
                                            <td className="px-4 py-3">
                                                {row.annualTarget > 0 ? (
                                                    <div className="flex flex-col items-center gap-1">
                                                        <div className="w-full bg-gray-700 rounded-full h-2 relative">
                                                            {!isPastYear && (
                                                                <div
                                                                    className="absolute top-0 bottom-0 w-px bg-gray-500/60"
                                                                    style={{ left: `${expectedProgressPercent}%` }}
                                                                    title={`Linear pace: ${expectedProgressPercent.toFixed(0)}%`}
                                                                />
                                                            )}
                                                            <div
                                                                className={`h-full rounded-full transition-all ${barColor}`}
                                                                style={{ width: `${cappedProgress}%` }}
                                                            />
                                                        </div>
                                                        <span className={`text-xs ${pacingColor}`}>
                                                            {pacingText}
                                                        </span>
                                                    </div>
                                                ) : (
                                                    <div className="text-center">
                                                        <span className="text-xs text-gray-500">
                                                            {row.ytdActual > 0 ? formatCurrency(row.ytdActual) : '—'}
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

            {/* Other Accounts vs Plan */}
            {!isFutureMonth && otherAccountRows.length > 0 && (
                <div className="bg-gray-800 rounded-lg border border-gray-700 overflow-hidden">
                    <div className="p-4 border-b border-gray-700">
                        <h3 className="text-lg font-semibold text-white">Other Accounts vs Plan</h3>
                        <p className="text-sm text-gray-400 mt-1">
                            Accounts without a priority bucket. Expected balance includes payroll-routed contributions (401k, employer match, ESPP) plus market growth.
                        </p>
                    </div>
                    <div className="overflow-x-auto">
                        <table className="w-full">
                            <thead className="bg-gray-900/50">
                                <tr>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">Account</th>
                                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-400 uppercase tracking-wider">Current</th>
                                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-400 uppercase tracking-wider">Annual Plan</th>
                                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-400 uppercase tracking-wider">
                                        <span className="inline-flex items-center gap-1 justify-end">
                                            {isPastYear ? 'Expected EOY' : 'Expected by now'}
                                            <Tooltip text="Projected balance at the end of the tracking month, assuming on-plan contributions and growth. Mid-month, expect to be slightly behind until the month's paychecks land." />
                                        </span>
                                    </th>
                                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-400 uppercase tracking-wider">Variance</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-700">
                                {otherAccountRows.map(row => (
                                    <tr key={row.accountId} className="hover:bg-gray-700/30">
                                        <td className="px-4 py-3 text-sm font-medium text-white">{row.accountName}</td>
                                        <td className="px-4 py-3 text-sm text-right text-white font-medium">
                                            {formatCurrency(row.actualBalance)}
                                        </td>
                                        <td className="px-4 py-3 text-sm text-right text-gray-400">
                                            {row.annualContribution > 0 ? formatCurrency(row.annualContribution) : '—'}
                                        </td>
                                        <td className="px-4 py-3 text-sm text-right text-gray-400">
                                            {formatCurrency(row.projectedBalance)}
                                        </td>
                                        <td className="px-4 py-3 text-sm text-right">
                                            <span className={row.variance >= 0 ? 'text-green-400' : 'text-red-400'}>
                                                {row.variance >= 0 ? '+' : ''}{formatCurrency(row.variance)}
                                                {row.variancePercent !== null && (
                                                    <span className="text-xs text-gray-500 ml-1">
                                                        ({row.variancePercent >= 0 ? '+' : ''}{row.variancePercent.toFixed(1)}%)
                                                    </span>
                                                )}
                                            </span>
                                        </td>
                                    </tr>
                                ))}
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

interface SavingsTargetRow {
    priority: number;
    accountId: string;
    accountName: string;
    bucketName: string;
    target: number;
    actualBalance: number;
    startingBalance: number;
    progressPercent: number;
    status: 'fully-funded' | 'in-progress' | 'overfunded';
}

interface ContributionRow {
    priority: number;
    accountId: string;
    accountName: string;
    bucketName: string;
    annualTarget: number;
    ytdActual: number;
    ytdLinearTarget: number;
    actualBalance: number;
    projectedBalance: number | null;
    balanceVariance: number | null;
    pacing: 'complete' | 'ahead' | 'on-track' | 'waiting' | 'behind';
    isTransactionBased: boolean;
    isSavingsAccount: boolean;
    capType: string;
}
