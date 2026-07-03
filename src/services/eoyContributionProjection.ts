import { PriorityBucket, AssumptionsState, CapType, getBirthYear, isBalanceTargetCap, getBucketTargetBalance } from '../components/Objects/Assumptions/AssumptionsContext';
import { TaxState } from '../components/Objects/Taxes/TaxContext';
import { AnyAccount, InvestedAccount, DebtAccount, DeficitDebtAccount } from '../components/Objects/Accounts/models';
import { AnyIncome, WorkIncome } from '../components/Objects/Income/models';
import { AnyExpense, LoanExpense, MortgageExpense, getGoalFundAnnualSetAside, mergeGoalFundBuckets } from '../components/Objects/Expense/models';
import { MonthlySnapshot } from '../components/Objects/Budget/BudgetTypes';
import { get401kLimit, getIRALimit, getHSALimit } from '../data/ContributionLimits';
import { getActiveExpenses } from '../components/Objects/Budget/budgetUtils';

/**
 * One row in the EOY contribution projection — used by the debug tab to
 * explain how the Projected Dec balances were computed for each priority.
 */
export interface EOYContributionRow {
    accountId: string;
    accountName: string;
    priorityName: string;
    capType: CapType;
    /** For MAX/FIXED: annual contribution goal. For balance targets (TARGET / MULTIPLE_OF_EXPENSES): target balance. */
    annualGoal: number;
    /** YTD contributions from budget transactions (informational; not used for balance-target priorities) */
    ytdActual: number;
    /** Current account balance — populated only for balance-target priorities (TARGET / MULTIPLE_OF_EXPENSES) */
    currentBalance?: number;
    expectedRemaining: number;
    source: 'budget-ytd' | 'fraction-fallback' | 'balance-target';
    skipped?: 'no-account' | 'remainder' | 'payroll-routed' | 'zero-goal' | 'balance-target-met';
}

/**
 * One row in the EOY debt projection — explains how the principal reduction
 * for each liability (DebtAccount linked to LoanExpense, or MortgageExpense)
 * was computed for the remainder of the year.
 */
export interface EOYDebtRow {
    /** For 'account' rows: the DebtAccount id. For 'mortgage-expense' rows: the MortgageExpense id. */
    targetId: string;
    targetType: 'account' | 'mortgage-expense';
    name: string;
    linkedExpenseName: string;
    currentBalance: number;
    annualPrincipal: number;
    expectedReduction: number;
    skipped?: 'deficit' | 'no-linked-expense' | 'zero-principal' | 'paid-off';
}

export interface EOYContributionProjection {
    /** accountId → extra dollars to add to that account's EOY balance */
    additions: Record<string, number>;
    /** debtAccountId → principal $ to subtract from that DebtAccount's EOY balance */
    debtReductions: Record<string, number>;
    /** mortgageExpenseId → principal $ to subtract from that MortgageExpense's loan_balance */
    mortgageReductions: Record<string, number>;
    /** All considered priorities (including skipped ones, for debug visibility) */
    rows: EOYContributionRow[];
    /** All considered debts (DebtAccount + MortgageExpense) for debug visibility */
    debtRows: EOYDebtRow[];
    /** Accounts already credited by payroll partial-year adjustment — skipped here to avoid double-counting */
    payrollAccountIds: Set<string>;
    /** True if budget data was found for the current year (drives YTD vs fraction-fallback path) */
    hasBudgetData: boolean;
    /** Fraction of calendar year remaining, used by fraction-fallback path */
    remainingFraction: number;
}

function getAnnualGoalForPriority(
    priority: PriorityBucket,
    account: AnyAccount,
    year: number,
    age: number,
    assumptions: AssumptionsState,
    taxState: TaxState,
    expenses: AnyExpense[],
    today: Date,
): number {
    const inflationAdjusted = assumptions.macro.inflationAdjusted;
    const hsaCoverage = taxState.filingStatus === 'Married Filing Jointly' ? 'family' : 'individual';

    // Goal sinking funds: derive the annual goal from the goal expense itself
    // (months-prorated — a June-start goal plans 7 months this year), mirroring
    // the simulation engine's committed funding.
    const goalAnnual = getGoalFundAnnualSetAside(expenses, priority.accountId, year);
    if (goalAnnual !== undefined) return goalAnnual;

    if (priority.capType === 'MAX' && account instanceof InvestedAccount) {
        switch (account.taxType) {
            case 'Roth IRA':
            case 'Traditional IRA':
                return getIRALimit(year, age, inflationAdjusted);
            case 'Roth 401k':
            case 'Traditional 401k':
                return get401kLimit(year, age, inflationAdjusted);
            case 'HSA':
                return getHSALimit(year, age, hsaCoverage, inflationAdjusted);
            default:
                return priority.capValue || 0;
        }
    }
    if (priority.capType === 'FIXED') {
        return (priority.capValue || 0) * 12;
    }
    if (isBalanceTargetCap(priority.capType)) {
        const activeToday = getActiveExpenses(expenses, today.getMonth() + 1, today.getFullYear());
        const monthlyExp = activeToday.reduce((s, e) => s + e.getMonthlyAmount(), 0);
        return getBucketTargetBalance(priority, monthlyExp)!;
    }
    return 0;
}

/**
 * Compute extra contributions to layer onto the synthetic EOY projection row.
 *
 * Why: STEP 1.5 in useSimulation only credits payroll-routed contributions
 * (401k preTax/roth + employer match + ESPP). That misses everything the user
 * is actively budgeting toward via `assumptions.priorities` — Brokerage, IRA,
 * HSA, savings — which makes "Projected Dec" look artificially low.
 *
 * For each non-payroll priority with an annual goal:
 *   expectedRemaining = max(0, annualGoal − ytdActual)
 * YTD comes from budget transactions[].targetAccountId. If no contributions
 * have been logged yet, ytdActual is 0 and the full annual goal is projected.
 *
 * REMAINDER priorities have no fixed cap, but their effective annual goal can
 * be supplied from a prior simulation's `cashflow.bucketDetail` (the simulation
 * decides how much surplus flows into each remainder bucket). When that's
 * available we treat it like MAX/FIXED: remaining = max(0, annualGoal − ytd).
 * Without it we fall back to skipping (no goal to scale against).
 */
export function computeEOYBudgetContributions(
    priorities: PriorityBucket[],
    accounts: AnyAccount[],
    incomes: AnyIncome[],
    expenses: AnyExpense[],
    budgetMonths: MonthlySnapshot[],
    assumptions: AssumptionsState,
    taxState: TaxState,
    startYear: number,
    today: Date,
    remainderAnnualGoals?: Record<string, number>,
): EOYContributionProjection {
    const additions: Record<string, number> = {};
    const rows: EOYContributionRow[] = [];

    const payrollAccountIds = new Set<string>();
    incomes.forEach(inc => {
        if (inc instanceof WorkIncome) {
            if (inc.matchAccountId) payrollAccountIds.add(inc.matchAccountId);
            if (inc.esppAccountId) payrollAccountIds.add(inc.esppAccountId);
        }
    });

    const currentMonth1 = today.getMonth() + 1;
    const ytdByAccount: Record<string, number> = {};
    let hasBudgetData = false;
    budgetMonths.forEach(m => {
        if (m.year !== startYear || m.month > currentMonth1) return;
        if (m.transactions.length > 0) hasBudgetData = true;
        m.transactions.forEach(t => {
            if (t.targetAccountId && t.amount !== 0) {
                ytdByAccount[t.targetAccountId] = (ytdByAccount[t.targetAccountId] || 0) + Math.abs(t.amount);
            }
        });
    });

    const remainingFraction = (11 - today.getMonth()) / 12;
    const age = startYear - getBirthYear(assumptions.milestones);

    // Goal funds are tracked via synthetic buckets (goals no longer carry a
    // priority — their funding is a committed transfer derived from the goal).
    const effectivePriorities = mergeGoalFundBuckets(priorities, expenses);

    effectivePriorities.forEach(priority => {
        if (!priority.accountId) return;
        const account = accounts.find(a => a.id === priority.accountId);
        if (!account) {
            rows.push({
                accountId: priority.accountId, accountName: '(missing)', priorityName: priority.name,
                capType: priority.capType, annualGoal: 0, ytdActual: 0, expectedRemaining: 0,
                source: 'fraction-fallback', skipped: 'no-account',
            });
            return;
        }
        if (priority.capType === 'REMAINDER') {
            const ytdActual = ytdByAccount[priority.accountId] || 0;
            const annualGoal = remainderAnnualGoals?.[priority.accountId] || 0;
            if (annualGoal > 0) {
                const expectedRemaining = Math.max(0, annualGoal - ytdActual);
                if (expectedRemaining > 0) {
                    additions[priority.accountId] = (additions[priority.accountId] || 0) + expectedRemaining;
                }
                rows.push({
                    accountId: priority.accountId, accountName: account.name, priorityName: priority.name,
                    capType: priority.capType, annualGoal, ytdActual,
                    expectedRemaining, source: 'budget-ytd',
                });
                return;
            }
            rows.push({
                accountId: priority.accountId, accountName: account.name, priorityName: priority.name,
                capType: priority.capType, annualGoal: 0, ytdActual,
                expectedRemaining: 0, source: 'fraction-fallback', skipped: 'remainder',
            });
            return;
        }
        if (payrollAccountIds.has(priority.accountId)) {
            rows.push({
                accountId: priority.accountId, accountName: account.name, priorityName: priority.name,
                capType: priority.capType, annualGoal: 0, ytdActual: ytdByAccount[priority.accountId] || 0,
                expectedRemaining: 0, source: 'fraction-fallback', skipped: 'payroll-routed',
            });
            return;
        }

        const annualGoal = getAnnualGoalForPriority(priority, account, startYear, age, assumptions, taxState, expenses, today);
        if (annualGoal <= 0) {
            rows.push({
                accountId: priority.accountId, accountName: account.name, priorityName: priority.name,
                capType: priority.capType, annualGoal: 0, ytdActual: ytdByAccount[priority.accountId] || 0,
                expectedRemaining: 0, source: 'fraction-fallback', skipped: 'zero-goal',
            });
            return;
        }

        const ytdActual = ytdByAccount[priority.accountId] || 0;

        // TARGET / MULTIPLE_OF_EXPENSES are balance targets (a dollar amount, or an
        // emergency fund = N×monthly expenses), not recurring annual contributions. If the
        // account is already at/above target, no contribution is needed; otherwise the gap
        // to the target is what will be added.
        if (isBalanceTargetCap(priority.capType)) {
            const currentBalance = account.amount;
            const gap = Math.max(0, annualGoal - currentBalance);
            if (gap === 0) {
                rows.push({
                    accountId: priority.accountId, accountName: account.name, priorityName: priority.name,
                    capType: priority.capType, annualGoal, ytdActual, currentBalance,
                    expectedRemaining: 0, source: 'balance-target', skipped: 'balance-target-met',
                });
                return;
            }
            additions[priority.accountId] = (additions[priority.accountId] || 0) + gap;
            rows.push({
                accountId: priority.accountId,
                accountName: account.name,
                priorityName: priority.name,
                capType: priority.capType,
                annualGoal,
                ytdActual,
                currentBalance,
                expectedRemaining: gap,
                source: 'balance-target',
            });
            return;
        }

        const expectedRemaining = Math.max(0, annualGoal - ytdActual);
        const source = 'budget-ytd' as const;

        additions[priority.accountId] = (additions[priority.accountId] || 0) + expectedRemaining;
        rows.push({
            accountId: priority.accountId,
            accountName: account.name,
            priorityName: priority.name,
            capType: priority.capType,
            annualGoal,
            ytdActual,
            expectedRemaining,
            source,
        });
    });

    // Debt principal pay-down for the rest of the year — both DebtAccount-style
    // liabilities (car loans, credit cards via LoanExpense) and mortgages
    // (loan_balance lives directly on MortgageExpense, no DebtAccount).
    // Each linked expense's annualAmortization gives the year's principal,
    // scaled by remainingFraction to estimate the remaining-year pay-down.
    const debtReductions: Record<string, number> = {};
    const mortgageReductions: Record<string, number> = {};
    const debtRows: EOYDebtRow[] = [];

    accounts.forEach(acc => {
        if (!(acc instanceof DebtAccount)) return;
        if (acc instanceof DeficitDebtAccount) {
            debtRows.push({
                targetId: acc.id, targetType: 'account', name: acc.name, linkedExpenseName: '',
                currentBalance: acc.amount, annualPrincipal: 0, expectedReduction: 0,
                skipped: 'deficit',
            });
            return;
        }
        const linkedExpense = expenses.find(
            e => e instanceof LoanExpense && e.linkedAccountId === acc.id,
        ) as LoanExpense | undefined;
        if (!linkedExpense) {
            debtRows.push({
                targetId: acc.id, targetType: 'account', name: acc.name, linkedExpenseName: '',
                currentBalance: acc.amount, annualPrincipal: 0, expectedReduction: 0,
                skipped: 'no-linked-expense',
            });
            return;
        }
        const annualPrincipal = linkedExpense.calculateAnnualAmortization(startYear).totalPrincipal;
        if (annualPrincipal <= 0) {
            debtRows.push({
                targetId: acc.id, targetType: 'account', name: acc.name, linkedExpenseName: linkedExpense.name,
                currentBalance: acc.amount, annualPrincipal: 0, expectedReduction: 0,
                skipped: 'zero-principal',
            });
            return;
        }
        const expectedReduction = Math.min(acc.amount, annualPrincipal * remainingFraction);
        debtReductions[acc.id] = (debtReductions[acc.id] || 0) + expectedReduction;
        debtRows.push({
            targetId: acc.id, targetType: 'account', name: acc.name, linkedExpenseName: linkedExpense.name,
            currentBalance: acc.amount, annualPrincipal, expectedReduction,
        });
    });

    expenses.forEach(exp => {
        if (!(exp instanceof MortgageExpense)) return;
        if (exp.loan_balance <= 0) {
            debtRows.push({
                targetId: exp.id, targetType: 'mortgage-expense', name: exp.name, linkedExpenseName: exp.name,
                currentBalance: 0, annualPrincipal: 0, expectedReduction: 0,
                skipped: 'paid-off',
            });
            return;
        }
        const annualPrincipal = exp.calculateAnnualAmortization(startYear).totalPrincipal;
        if (annualPrincipal <= 0) {
            debtRows.push({
                targetId: exp.id, targetType: 'mortgage-expense', name: exp.name, linkedExpenseName: exp.name,
                currentBalance: exp.loan_balance, annualPrincipal: 0, expectedReduction: 0,
                skipped: 'zero-principal',
            });
            return;
        }
        const expectedReduction = Math.min(exp.loan_balance, annualPrincipal * remainingFraction);
        mortgageReductions[exp.id] = (mortgageReductions[exp.id] || 0) + expectedReduction;
        debtRows.push({
            targetId: exp.id, targetType: 'mortgage-expense', name: exp.name, linkedExpenseName: exp.name,
            currentBalance: exp.loan_balance, annualPrincipal, expectedReduction,
        });
    });

    return { additions, debtReductions, mortgageReductions, rows, debtRows, payrollAccountIds, hasBudgetData, remainingFraction };
}
