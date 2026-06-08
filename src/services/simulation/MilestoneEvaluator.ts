import { AnyAccount, InvestedAccount, SavedAccount, DebtAccount, PropertyAccount, ESPPAccount, DeficitDebtAccount } from "../../components/Objects/Accounts/models";
import { MortgageExpense, LoanExpense, AnyExpense } from "../../components/Objects/Expense/models";
import { CustomMilestone, MilestoneCondition, MilestoneReachEvent } from "./types";

/**
 * Context for evaluating milestone conditions
 */
export interface MilestoneContext {
    accounts: AnyAccount[];
    expenses: AnyExpense[];
    year: number;
    age: number;
    milestoneReachYears?: Map<string, number>;  // milestoneId -> year reached (for YEARS_AFTER_MILESTONE)
}

/**
 * Calculate total net worth: all assets minus all liabilities
 */
export function calculateNetWorth(accounts: AnyAccount[], expenses: AnyExpense[]): number {
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
        } else if (account instanceof InvestedAccount || account instanceof SavedAccount || account instanceof ESPPAccount) {
            assets += account.amount;
        }
    });

    // Build set of expense ids that are linked to an account (so the loan is
    // already counted on the account side) to avoid double-counting.
    const linkedExpenseIds = new Set<string>();
    accounts.forEach(a => {
        if ((a instanceof PropertyAccount || a instanceof DebtAccount) && a.linkedAccountId) {
            linkedExpenseIds.add(a.linkedAccountId);
        }
    });

    // Also include mortgage and loan balances from standalone expenses
    // (skip those linked to an account, already counted above).
    expenses.forEach(expense => {
        if (expense instanceof MortgageExpense) {
            if (!linkedExpenseIds.has(expense.id)) liabilities += expense.loan_balance;
        } else if (expense instanceof LoanExpense) {
            if (!linkedExpenseIds.has(expense.id)) liabilities += expense.amount;
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
        } else if (account instanceof ESPPAccount) {
            // ESPP is liquid (publicly traded stock)
            liquid += account.amount;
        }
    });

    return liquid;
}

/**
 * Calculate total debt: all debt accounts + mortgage/loan balances
 */
export function calculateTotalDebt(accounts: AnyAccount[], expenses: AnyExpense[]): number {
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

    // Build set of expense ids that are linked to an account (so the loan is
    // already counted on the account side) to avoid double-counting.
    const linkedExpenseIds = new Set<string>();
    accounts.forEach(a => {
        if ((a instanceof PropertyAccount || a instanceof DebtAccount) && a.linkedAccountId) {
            linkedExpenseIds.add(a.linkedAccountId);
        }
    });

    // Also include mortgage and loan balances from standalone expenses
    // (skip those linked to an account, already counted above).
    expenses.forEach(expense => {
        if (expense instanceof MortgageExpense) {
            if (!linkedExpenseIds.has(expense.id)) debt += expense.loan_balance;
        } else if (expense instanceof LoanExpense) {
            if (!linkedExpenseIds.has(expense.id)) debt += expense.amount;
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
        const startYear = expense.startDate ? expense.startDate.getUTCFullYear() : 0;
        const endYear = expense.endDate ? expense.endDate.getUTCFullYear() : 9999;

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
            // value × (expenses / (1 - tax_rate)) - includes estimated taxes
            // Uses 15% estimated tax rate (conservative for retirement withdrawals)
            const annualExpenses = calculateAnnualExpenses(context.expenses, context.year);
            if (annualExpenses <= 0) return null;
            const estimatedTaxRate = 0.15;
            const grossedUpExpenses = annualExpenses / (1 - estimatedTaxRate);
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
            measuredValue = calculateNetWorth(context.accounts, context.expenses);
            break;
        case 'LIQUID_NET_WORTH':
            measuredValue = calculateLiquidNetWorth(context.accounts);
            break;
        case 'TOTAL_DEBT':
            measuredValue = calculateTotalDebt(context.accounts, context.expenses);
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
