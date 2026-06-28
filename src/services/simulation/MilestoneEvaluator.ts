import { AnyAccount, InvestedAccount, SavedAccount, DebtAccount, PropertyAccount, ESPPAccount, RSUAccount, DeficitDebtAccount } from "../../components/Objects/Accounts/models";
import { MortgageExpense, LoanExpense, AnyExpense } from "../../components/Objects/Expense/models";
import { AnyIncome, isIncomeActiveInCurrentMonth } from "../../components/Objects/Income/models";
import { CustomMilestone, MilestoneCondition, MilestoneReachEvent, SimulationYear } from "./types";
import { getTaxParameters, calculateTotalFederalTax } from "../../components/Objects/Taxes/TaxService";
import { FilingStatus } from "../../data/TaxData";

/**
 * Context for evaluating milestone conditions
 */
export interface MilestoneContext {
    accounts: AnyAccount[];
    expenses: AnyExpense[];
    year: number;
    age: number;
    milestoneReachYears?: Map<string, number>;  // milestoneId -> year reached (for YEARS_AFTER_MILESTONE)
    filingStatus?: FilingStatus;  // user's filing status, for the EXPENSES_GROSSED_UP tax gross-up (defaults to Single)
}

/**
 * Calculate total net worth: all assets minus all liabilities.
 *
 * Net worth is sourced from ACCOUNTS only — every non-debt account's balance as
 * an asset, and DebtAccount/DeficitDebtAccount balances plus PropertyAccount.loanAmount
 * as liabilities. This is the same liability set as FutureUtils.getAccountTotals, the
 * single canonical net-worth definition every display, chart, Monte Carlo, scenario,
 * and PDF surface already uses (#124).
 *
 * Mortgage/loan balances are NOT read off the expense side. For a linked loan the
 * engine keeps PropertyAccount.loanAmount in sync with MortgageExpense.loan_balance
 * (AccountGrowth.ts), so the account side already carries it. An UNLINKED expense-side
 * loan is a broken record (its paired account is missing); the state-entry layer
 * repairs that by auto-creating + linking a paired account (linkOrphanLoanExpenses),
 * so the liability still lands on the account side and net worth stays single-sourced
 * rather than reading two divergent sources.
 */
export function calculateNetWorth(accounts: AnyAccount[]): number {
    let assets = 0;
    let liabilities = 0;

    accounts.forEach(account => {
        if (account instanceof DeficitDebtAccount) {
            liabilities += account.amount;
        } else if (account instanceof DebtAccount) {
            liabilities += account.amount;
        } else if (account instanceof PropertyAccount) {
            // Property value minus loan balance
            assets += account.amount; // Value
            liabilities += account.loanAmount || 0;
        } else if (account instanceof InvestedAccount || account instanceof SavedAccount || account instanceof ESPPAccount || account instanceof RSUAccount) {
            assets += account.amount;
        }
    });

    return assets - liabilities;
}

/**
 * Calculate liquid net worth: only Brokerage + Savings accounts
 * (Not retirement accounts like 401k, IRA, etc.)
 */
export function calculateLiquidNetWorth(accounts: AnyAccount[]): number {
    let liquid = 0;

    accounts.forEach(account => {
        if (account instanceof SavedAccount) {
            liquid += account.amount;
        } else if (account instanceof InvestedAccount && account.taxType === 'Brokerage') {
            liquid += account.amount;
        } else if (account instanceof ESPPAccount || account instanceof RSUAccount) {
            // ESPP and vested RSUs are liquid (publicly traded stock)
            liquid += account.amount;
        }
    });

    return liquid;
}

/**
 * Calculate total debt: account-carried liabilities only — DebtAccount and
 * DeficitDebtAccount balances plus PropertyAccount.loanAmount. Mirrors the
 * canonical account-only liability set in calculateNetWorth / getAccountTotals
 * (#124): the engine keeps linked loans synced onto the account side, and the
 * state-entry layer re-links orphaned expense-side loans, so debt is single-sourced
 * from accounts rather than summing two divergent sources.
 */
export function calculateTotalDebt(accounts: AnyAccount[]): number {
    let debt = 0;

    accounts.forEach(account => {
        if (account instanceof DeficitDebtAccount) {
            debt += account.amount;
        } else if (account instanceof DebtAccount) {
            debt += account.amount;
        } else if (account instanceof PropertyAccount) {
            debt += account.loanAmount || 0;
        }
    });

    return debt;
}

/**
 * Calculate total annual expenses
 * Used for expense multiple calculations (e.g., 25x expenses for FI)
 */
export function calculateAnnualExpenses(expenses: AnyExpense[], year: number): number {
    let total = 0;

    expenses.forEach(expense => {
        // Check if expense is active in this year
        const startYear = expense.startDate ? expense.startDate.getFullYear() : 0;
        const endYear = expense.endDate ? expense.endDate.getFullYear() : 9999;

        if (year >= startYear && year <= endYear) {
            if (expense instanceof MortgageExpense) {
                total += expense.calculateAnnualAmortization(year).totalPayment;
            } else if (expense instanceof LoanExpense) {
                total += expense.calculateAnnualAmortization(year).totalPayment;
            } else {
                total += expense.getAnnualAmount(year);
            }
        }
    });

    return total;
}

/**
 * Fallback filing status for the expense gross-up, used only when the
 * MilestoneContext doesn't carry one. 'Single' is the same conservative default
 * the app ships with (TaxContext.defaultTaxState) and yields the least-favorable
 * brackets, so the grossed-up target is never optimistic.
 */
const GROSS_UP_DEFAULT_FILING_STATUS: FilingStatus = 'Single';

/**
 * Gross up after-tax living expenses into the pre-tax withdrawal needed to fund
 * them, using the real federal bracket schedule for the given year instead of a
 * flat assumed rate.
 *
 * A retiree who needs `netExpenses` to spend must withdraw enough pre-tax
 * dollars `gross` such that `gross - tax(gross) === netExpenses`, i.e.
 * `gross === netExpenses + tax(gross)`. Because `tax(gross)` depends on `gross`,
 * we solve it with a short fixed-point iteration (gross starts at the raw
 * expenses and is bumped by the tax owed each pass). This converges quickly
 * because the federal schedule is piecewise-linear; a handful of iterations is
 * more than enough.
 *
 * The withdrawal is modeled as ordinary income (the typical case for funding
 * retirement from Traditional 401k/IRA balances), so it correctly benefits from
 * the standard deduction and the lower brackets — making the effective rate far
 * more accurate than the previous flat 15%, especially at modest spend levels.
 *
 * Falls back to a flat 15% gross-up if tax parameters can't be resolved for the
 * year (mirrors the previous behavior so the milestone never silently breaks).
 */
function grossUpExpenses(netExpenses: number, year: number, filingStatus: FilingStatus): number {
    const FALLBACK_TAX_RATE = 0.15;

    const fedParams = getTaxParameters(year, filingStatus, "federal");
    if (!fedParams) {
        return netExpenses / (1 - FALLBACK_TAX_RATE);
    }

    // Fixed-point solve for gross such that gross - tax(gross) === netExpenses.
    let gross = netExpenses;
    for (let i = 0; i < 8; i++) {
        const tax = calculateTotalFederalTax(
            gross,  // ordinary income (Traditional-account withdrawal)
            0,      // socialSecurityBenefits
            0,      // shortTermCapitalGains
            0,      // longTermCapitalGains
            0,      // preTaxDeductions (already retired; none assumed)
            filingStatus,
            fedParams,
        ).totalTax;
        const next = netExpenses + tax;
        if (Math.abs(next - gross) < 1) {
            gross = next;
            break;
        }
        gross = next;
    }

    return gross;
}

/**
 * Calculate the target value for comparison based on valueType
 */
function calculateTargetValue(condition: MilestoneCondition, context: MilestoneContext): number | null {
    const valueType = condition.valueType || 'FIXED';

    switch (valueType) {
        case 'FIXED':
            return condition.value;

        case 'EXPENSES': {
            // value × annual expenses (e.g., 25x expenses for 4% rule)
            // Living expenses only - does NOT include taxes
            const annualExpenses = calculateAnnualExpenses(context.expenses, context.year);
            if (annualExpenses <= 0) return null; // Can't multiply by zero expenses
            return condition.value * annualExpenses;
        }

        case 'EXPENSES_GROSSED_UP': {
            // value × (pre-tax dollars needed to net the annual expenses).
            //
            // Previously this used a flat 15% rate (expenses / (1 - 0.15)),
            // ignoring filing status, state, and the actual bracket schedule.
            // We now derive the gross-up from the real federal tax brackets for
            // the milestone's year via grossUpExpenses() (solving
            // gross - tax(gross) === expenses), which is materially more
            // accurate — at low spend the standard deduction makes the effective
            // rate well under 15%, and at high spend the upper brackets push it
            // above 15%.
            //
            // The user's real filingStatus is threaded through MilestoneContext
            // (set by SimulationEngine). Still federal-only: MilestoneContext does
            // not carry stateResidency, so STATE tax is not included in the
            // gross-up — a fuller fix would thread stateResidency through too.
            const annualExpenses = calculateAnnualExpenses(context.expenses, context.year);
            if (annualExpenses <= 0) return null;
            const grossedUpExpenses = grossUpExpenses(
                annualExpenses,
                context.year,
                context.filingStatus ?? GROSS_UP_DEFAULT_FILING_STATUS,
            );
            return condition.value * grossedUpExpenses;
        }

        case 'MILESTONE_PLUS': {
            // milestone year/age + value offset
            if (!condition.referenceMilestoneId || !context.milestoneReachYears) {
                return null; // Missing reference
            }
            const reachedYear = context.milestoneReachYears.get(condition.referenceMilestoneId);
            if (reachedYear === undefined) {
                return null; // Referenced milestone hasn't been reached yet
            }
            // For YEAR conditions, return the year + offset
            // For AGE conditions, convert to age equivalent
            if (condition.type === 'AGE') {
                // Convert the milestone's reach-year to the age the user was when it
                // was reached, then add the offset. (No '_age' key is ever stored in
                // milestoneReachYears, so this derivation is the sole path.)
                return (reachedYear - context.year + context.age) + condition.value;
            }
            return reachedYear + condition.value;
        }

        default:
            return condition.value;
    }
}

/**
 * Evaluate a single condition against the context
 */
function evaluateCondition(condition: MilestoneCondition, context: MilestoneContext): boolean {
    // Get the measured value (left side of comparison)
    let measuredValue: number;

    switch (condition.type) {
        case 'NET_WORTH':
            measuredValue = calculateNetWorth(context.accounts);
            break;
        case 'LIQUID_NET_WORTH':
            measuredValue = calculateLiquidNetWorth(context.accounts);
            break;
        case 'TOTAL_DEBT':
            measuredValue = calculateTotalDebt(context.accounts);
            break;
        case 'YEAR':
            measuredValue = context.year;
            break;
        case 'AGE':
            measuredValue = context.age;
            break;
        default:
            return false;
    }

    // Get the target value (right side of comparison)
    const targetValue = calculateTargetValue(condition, context);
    if (targetValue === null) {
        return false; // Couldn't calculate target (e.g., milestone not reached yet)
    }

    switch (condition.operator) {
        case '>=':
            return measuredValue >= targetValue;
        case '<=':
            return measuredValue <= targetValue;
        case '>':
            return measuredValue > targetValue;
        case '<':
            return measuredValue < targetValue;
        case '=':
            return measuredValue === targetValue;
        default:
            return false;
    }
}

/**
 * Evaluate if a milestone has been reached (all conditions must be met)
 */
export function evaluateMilestone(milestone: CustomMilestone, context: MilestoneContext): boolean {
    // All conditions must be met (AND logic)
    return milestone.conditions.every(condition => evaluateCondition(condition, context));
}

/**
 * Evaluate all milestones and return newly reached ones
 * @param milestones - All defined milestones
 * @param previouslyReached - IDs of milestones already reached in prior years
 * @param context - Current simulation context
 * @returns Object with newly reached milestones and updated active set
 */
export function evaluateAllMilestones(
    milestones: CustomMilestone[],
    previouslyReached: Set<string>,
    context: MilestoneContext
): {
    newlyReached: MilestoneReachEvent[];
    activeMilestones: string[];
} {
    const newlyReached: MilestoneReachEvent[] = [];
    const activeMilestones = new Set(previouslyReached);

    milestones.forEach(milestone => {
        // Skip if already reached
        if (previouslyReached.has(milestone.id)) {
            return;
        }

        // Check if conditions are now met
        if (evaluateMilestone(milestone, context)) {
            newlyReached.push({
                milestoneId: milestone.id,
                yearReached: context.year,
                ageReached: context.age,
            });
            activeMilestones.add(milestone.id);
        }
    });

    return {
        newlyReached,
        activeMilestones: Array.from(activeMilestones),
    };
}

/**
 * Check if an income/expense should be active based on milestone state
 * @param startMilestoneId - Milestone that triggers start (optional)
 * @param endMilestoneId - Milestone that triggers end (optional)
 * @param currentMilestones - Set of milestone IDs reached as of current year
 * @param previousMilestones - Set of milestone IDs reached as of previous year (optional, defaults to currentMilestones)
 * @returns true if the item should be active
 */
export function isActiveByMilestone(
    startMilestoneId: string | undefined,
    endMilestoneId: string | undefined,
    currentMilestones: Set<string>,
    previousMilestones?: Set<string>
): boolean {
    // START: use current state (begin immediately when milestone is reached)
    if (startMilestoneId && !currentMilestones.has(startMilestoneId)) {
        return false;
    }

    // END: use previous state (continue through the year milestone is reached)
    // If no previous state provided, fall back to current (for backwards compatibility)
    const endCheckSet = previousMilestones ?? currentMilestones;
    if (endMilestoneId && endCheckSet.has(endMilestoneId)) {
        return false;
    }

    return true;
}

/**
 * Whether an income is active RIGHT NOW, combining BOTH gates:
 *   1. the fixed start/end-date window (isIncomeActiveInCurrentMonth), and
 *   2. the start/end MILESTONE gate (isActiveByMilestone) — a milestone-started
 *      income is inactive until its start milestone has fired, even with no fixed
 *      start date.
 *
 * `todayMilestoneSet` is the set of milestones already reached as of today; both
 * the Income tab and the Priority/Allocation tab build it from the SHARED
 * `useTodayMilestoneSet` hook, so the two surfaces can't diverge on "what milestone
 * has fired now". The un-gated `isIncomeActiveInCurrentMonth` alone is
 * milestone-BLIND and counts a future milestone-started income today (#145 fixed
 * the Priority tab; #152 brought the Income tab in line).
 *
 * NOTE the two surfaces apply the shared set with DIFFERENT predicates, by design:
 * the Income tab uses THIS function (fixed-date window AND milestone) because its
 * breakdown wants a hard active/inactive boolean; the Priority tab applies only the
 * milestone gate (`isActiveByMilestoneToday`) and lets `getMonthlyAmount` zero out-of-
 * window fixed dates, because a $0 income must stay in its tax base.
 *
 * `milestoneGateUnresolved` (findings 1/2/3, supersedes the global #152/#154 flag):
 * a PER-INCOME signal that THIS income's own start/end milestone genuinely can't be
 * resolved right now. The today-milestone set resolves RELATIVE (MILESTONE_PLUS, "N
 * years after X") conditions out of the cached simulation timeline; on the Current/
 * Income tab no projection may have run yet (`simulation === []`), so a relative
 * milestone can't be confirmed reached even when it fired years ago. For ONLY those
 * incomes we fall back to the fixed-date window alone — gating on a milestone set we
 * know is incomplete would silently drop a genuinely-active relative-milestone income.
 *
 * Crucially the fallback is PER-INCOME and applies only to sim-DEPENDENT milestones:
 * an income gated on an ABSOLUTE (AGE/YEAR) milestone resolves from current age/year
 * alone — no projection needed — so it keeps its normal gate and is NOT shown active
 * before its milestone fires (finding 1). And "can't resolve" means the projection
 * itself hasn't run, NOT that a relative milestone ran and never fired (finding 3):
 * see `isIncomeMilestoneGateUnresolved`.
 */
export function isIncomeActiveToday(
    inc: AnyIncome,
    todayMilestoneSet: Set<string>,
    milestoneGateUnresolved = false,
): boolean {
    if (milestoneGateUnresolved) {
        return isIncomeActiveInCurrentMonth(inc);
    }
    return isIncomeActiveInCurrentMonth(inc) &&
        isActiveByMilestone(inc.startMilestoneId, inc.endMilestoneId, todayMilestoneSet);
}

/**
 * The Priority/Allocation-tab counterpart of `isIncomeActiveToday`: applies ONLY the
 * start/end milestone gate (the tab lets `getMonthlyAmount` zero out-of-window fixed
 * dates and a $0 income must stay in the tax base, so it deliberately omits the
 * fixed-date AND). Threads the SAME per-income `milestoneGateUnresolved` fallback as
 * the Income tab (finding 2/4): an already-fired relative-milestone income with no
 * projection cached must stay counted here too — otherwise its take-home/tax base is
 * understated — while an absolute-milestone income keeps its normal gate.
 */
export function isActiveByMilestoneToday(
    inc: AnyIncome,
    todayMilestoneSet: Set<string>,
    milestoneGateUnresolved = false,
): boolean {
    if (milestoneGateUnresolved) {
        return true;
    }
    return isActiveByMilestone(inc.startMilestoneId, inc.endMilestoneId, todayMilestoneSet);
}

/** True when any income references a start/end milestone — i.e. milestone gating
 *  is in play at all. The shared predicate behind both the simulation tabs' and the
 *  useTodayMilestoneSet short-circuit, so "is anything milestone-gated" can't drift. */
export function incomeHasMilestoneGate(incomes: AnyIncome[]): boolean {
    return incomes.some(inc => inc.startMilestoneId || inc.endMilestoneId);
}

/**
 * Whether evaluating a milestone needs the cached PROJECTION timeline to resolve —
 * i.e. it is SIM-DEPENDENT rather than resolvable from today's context alone.
 *
 * A milestone is sim-dependent iff any of its conditions is RELATIVE (MILESTONE_PLUS,
 * "N years after X"): that's the only valueType that reads `milestoneReachYears`, the
 * per-milestone reach map lifted out of the projected timeline. ABSOLUTE conditions —
 * AGE/YEAR with a FIXED/EXPENSES/EXPENSES_GROSSED_UP target — and value/net-worth
 * conditions (NET_WORTH/LIQUID_NET_WORTH/TOTAL_DEBT) all resolve against today's
 * accounts/expenses/age in the from-scratch `evaluateAllMilestones` call, with NO
 * projection required, so they are NOT sim-dependent.
 */
export function isMilestoneSimDependent(milestone: CustomMilestone): boolean {
    return milestone.conditions.some(c => (c.valueType ?? 'FIXED') === 'MILESTONE_PLUS');
}

/**
 * Per-income "its milestone gate can't be resolved right now" signal (findings 1/2/3).
 *
 * True iff BOTH:
 *  - the projection itself hasn't run (`projectionHasRun === false`, i.e. the cached
 *    `simulation` array is empty) — the ONLY honest "can't resolve" trigger. A relative
 *    milestone that ran and simply never fired leaves the reach map empty too, but that
 *    is a genuine UNREACHED result and must gate the income OFF, not fall back (finding
 *    3) — so we key off the projection's existence, never the reach-map size; AND
 *  - THIS income's own start or end milestone is sim-DEPENDENT (`isMilestoneSimDependent`)
 *    — only then does the missing timeline actually prevent resolution. An income gated
 *    on an absolute (AGE/YEAR) milestone resolves from today's context regardless, so it
 *    keeps its normal gate even with no projection cached (finding 1).
 *
 * `milestonesById` maps milestone id → milestone so the income's referenced start/end
 * milestone kind can be looked up.
 */
export function isIncomeMilestoneGateUnresolved(
    inc: AnyIncome,
    milestonesById: Map<string, CustomMilestone>,
    projectionHasRun: boolean,
): boolean {
    if (projectionHasRun) return false;
    const milestoneSimDependent = (id: string | undefined): boolean => {
        if (!id) return false;
        const milestone = milestonesById.get(id);
        return milestone ? isMilestoneSimDependent(milestone) : false;
    };
    return milestoneSimDependent(inc.startMilestoneId) || milestoneSimDependent(inc.endMilestoneId);
}

/**
 * Canonical extractor for per-milestone reach years from a projected timeline:
 * milestoneId → the FIRST simulation year that recorded it firing (its
 * `milestoneEvents[].yearReached`). This is the map MILESTONE_PLUS ("N years after
 * X") conditions resolve against. One implementation so the several surfaces that
 * need it (the today-milestone hook, etc.) can't drift on the scan semantics.
 */
export function buildMilestoneReachYears(simulation: SimulationYear[]): Map<string, number> {
    const reachYears = new Map<string, number>();
    for (const simYear of simulation) {
        for (const ev of simYear.milestoneEvents ?? []) {
            if (!reachYears.has(ev.milestoneId)) {
                reachYears.set(ev.milestoneId, ev.yearReached);
            }
        }
    }
    return reachYears;
}
