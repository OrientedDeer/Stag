import { AnyAccount, InvestedAccount, SavedAccount, DebtAccount, PropertyAccount, ESPPAccount, RSUAccount, DeficitDebtAccount } from "../../components/Objects/Accounts/models";
import { MortgageExpense, LoanExpense, AnyExpense } from "../../components/Objects/Expense/models";
import { AnyIncome, isIncomeActiveInCurrentMonth } from "../../components/Objects/Income/models";
import { CustomMilestone, MilestoneCondition, MilestoneReachEvent } from "./types";
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
 * `todayMilestoneSet` is the set of milestones already reached as of today
 * (build it once per render via evaluateAllMilestones against a today-context).
 * Shared by the Income tab and the Priority/Allocation tab so the two surfaces
 * agree on what counts as active now — the un-gated `isIncomeActiveInCurrentMonth`
 * alone is milestone-BLIND and counts a future milestone-started income today
 * (#145 fixed this on the Priority tab; #152 brought the Income tab in line).
 */
export function isIncomeActiveToday(inc: AnyIncome, todayMilestoneSet: Set<string>): boolean {
    return isIncomeActiveInCurrentMonth(inc) &&
        isActiveByMilestone(inc.startMilestoneId, inc.endMilestoneId, todayMilestoneSet);
}
