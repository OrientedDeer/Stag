import { AnyExpense, MortgageExpense, LoanExpense } from "../../components/Objects/Expense/models";
import { AnyIncome, WorkIncome } from "../../components/Objects/Income/models";
import { AnyAccount, InvestedAccount, SavedAccount, ESPPAccount } from "../../components/Objects/Accounts/models";
import { AssumptionsState, getRetirementAge, getLifeExpectancy, getBirthYear } from "../../components/Objects/Assumptions/AssumptionsContext";
import { calculateStrategyWithdrawal, WithdrawalResult } from "../WithdrawalStrategies";
import { SimulationYear } from "./types";

export interface SpendingStrategyResult {
    nextExpenses: AnyExpense[];
    strategyWithdrawalResult: WithdrawalResult | undefined;
    strategyAdjustmentResult: SimulationYear['strategyAdjustment'];
    totalLivingExpenses: number;
    discretionaryCash: number;
    logs: string[];
}

/**
 * Calculate total discretionary expenses.
 */
export function calculateTotalDiscretionary(expenses: AnyExpense[], year: number): number {
    return expenses.reduce((sum, exp) => {
        if (!exp.isDiscretionary) return sum;
        if (exp instanceof MortgageExpense) {
            return sum + exp.calculateAnnualAmortization(year).totalPayment;
        }
        if (exp instanceof LoanExpense) {
            return sum + exp.calculateAnnualAmortization(year).totalPayment;
        }
        return sum + exp.getAnnualAmount(year);
    }, 0);
}

/**
 * Apply lifestyle creep to discretionary expenses during working years.
 */
export function applyLifestyleCreep(
    expenses: AnyExpense[],
    incomes: AnyIncome[],
    assumptions: AssumptionsState,
    year: number,
    isRetired: boolean,
    logs: string[]
): AnyExpense[] {
    if (isRetired || assumptions.expenses.lifestyleCreep <= 0) {
        return expenses;
    }

    const salaryGrowthRate = assumptions.income.salaryGrowth / 100;
    let totalRaise = 0;
    for (const prevInc of incomes) {
        if (prevInc instanceof WorkIncome) {
            const realRaise = prevInc.getAnnualAmount() * salaryGrowthRate;
            if (realRaise > 0) {
                totalRaise += realRaise;
            }
        }
    }

    if (totalRaise <= 0) return expenses;

    const lifestyleCreepAmount = totalRaise * (assumptions.expenses.lifestyleCreep / 100);
    const discretionaryExpenses = expenses.filter(exp => exp.isDiscretionary);
    const totalDiscretionary = discretionaryExpenses.reduce((sum, exp) => {
        return sum + exp.getAnnualAmount(year);
    }, 0);

    if (totalDiscretionary <= 0 || lifestyleCreepAmount <= 0) return expenses;

    const increaseRatio = 1 + (lifestyleCreepAmount / totalDiscretionary);
    const result = expenses.map(exp => {
        if (exp.isDiscretionary) {
            return exp.adjustAmount(increaseRatio);
        }
        return exp;
    });

    logs.push(`[FLOW] Lifestyle creep: Salary raise of $${totalRaise.toLocaleString(undefined, { maximumFractionDigits: 0 })}/yr → Discretionary expenses increased by $${lifestyleCreepAmount.toLocaleString(undefined, { maximumFractionDigits: 0 })}/yr (${assumptions.expenses.lifestyleCreep}%)`);

    return result;
}

/**
 * Calculate withdrawal strategy target for all strategies (GK, Fixed Real, Percentage).
 * Returns undefined for 'None' and 'Needs Based' strategies.
 */
export function calculateStrategyTarget(
    accounts: AnyAccount[],
    assumptions: AssumptionsState,
    previousSimulation: SimulationYear[],
    year: number,
    currentAge: number,
    logs: string[]
): WithdrawalResult | undefined {
    const strategy = assumptions.investments.withdrawalStrategy;

    // No target for these strategies
    if (strategy === 'None' || strategy === 'Needs Based') {
        return undefined;
    }

    const totalInvestedAssets = accounts.reduce((sum, acc) => {
        if (acc instanceof InvestedAccount || acc instanceof SavedAccount || acc instanceof ESPPAccount) {
            return sum + acc.amount;
        }
        return sum;
    }, 0);

    const previousStrategyResult = previousSimulation.length > 0
        ? previousSimulation[previousSimulation.length - 1].strategyWithdrawal
        : undefined;

    const retirementStartYear = getBirthYear(assumptions.milestones) + getRetirementAge(assumptions.milestones);
    const yearsInRetirement = year - retirementStartYear;

    // yearsRemaining only needed for GK 15-year rule
    const yearsRemaining = strategy === 'Guyton Klinger'
        ? getLifeExpectancy(assumptions.milestones) - currentAge
        : undefined;

    const result = calculateStrategyWithdrawal({
        strategy,
        withdrawalRate: assumptions.investments.withdrawalRate,
        currentPortfolio: totalInvestedAssets,
        inflationRate: assumptions.macro.inflationRate,
        yearsInRetirement,
        previousWithdrawal: previousStrategyResult,
        // GK-specific params (ignored by other strategies)
        gkUpperGuardrail: assumptions.investments.gkUpperGuardrail,
        gkLowerGuardrail: assumptions.investments.gkLowerGuardrail,
        gkAdjustmentPercent: assumptions.investments.gkAdjustmentPercent,
        yearsRemaining,
    });

    logs.push(`[INFO] Retirement withdrawal strategy: ${strategy}`);
    logs.push(`  Target withdrawal: $${result.amount.toLocaleString(undefined, { maximumFractionDigits: 0 })}`);
    logs.push(`  Portfolio value: $${totalInvestedAssets.toLocaleString(undefined, { maximumFractionDigits: 0 })}`);

    const effectiveRate = totalInvestedAssets > 0 ? (result.amount / totalInvestedAssets) * 100 : 0;
    logs.push(`  Effective rate: ${effectiveRate.toFixed(2)}%`);

    if (result.guardrailTriggered !== 'none') {
        if (result.guardrailTriggered === 'capital-preservation') {
            logs.push(`[CUT] GK Capital Preservation triggered: withdrawal target reduced by ${assumptions.investments.gkAdjustmentPercent}%`);
        } else if (result.guardrailTriggered === 'prosperity') {
            logs.push(`[FLOW] GK Prosperity triggered: withdrawal target increased by ${assumptions.investments.gkAdjustmentPercent}%`);
        }
    }

    return result;
}

/**
 * Increase discretionary expenses to match budget when budget > current expenses.
 * Any surplus beyond discretionary goes to brokerage.
 *
 * This implements "prosperity spending" - when the withdrawal strategy budget
 * exceeds current expenses, we increase discretionary spending up to the budget,
 * and any remaining surplus is invested.
 */
export function applyProsperitySpending(
    expenses: AnyExpense[],
    currentTotalExpenses: number,
    budgetTarget: number,
    year: number,
    logs: string[]
): { adjustedExpenses: AnyExpense[]; surplusToInvest: number; prosperityApplied: boolean } {
    // If budget doesn't exceed expenses, no prosperity to apply
    if (budgetTarget <= currentTotalExpenses) {
        return { adjustedExpenses: expenses, surplusToInvest: 0, prosperityApplied: false };
    }

    const surplus = budgetTarget - currentTotalExpenses;
    const totalDiscretionary = calculateTotalDiscretionary(expenses, year);

    // If no discretionary expenses, invest the entire surplus
    if (totalDiscretionary <= 0) {
        logs.push(`[FLOW] Prosperity: Budget $${budgetTarget.toLocaleString(undefined, { maximumFractionDigits: 0 })} exceeds expenses $${currentTotalExpenses.toLocaleString(undefined, { maximumFractionDigits: 0 })} by $${surplus.toLocaleString(undefined, { maximumFractionDigits: 0 })}, but no discretionary expenses to increase. Surplus will be invested.`);
        return { adjustedExpenses: expenses, surplusToInvest: surplus, prosperityApplied: false };
    }

    // Calculate how much we can increase discretionary expenses
    // Cap increase at 100% of current discretionary (doubling max)
    const maxIncrease = totalDiscretionary; // Can double discretionary spending
    const actualIncrease = Math.min(surplus, maxIncrease);
    const surplusAfterIncrease = surplus - actualIncrease;

    // Apply proportional increase to all discretionary expenses
    const increaseRatio = 1 + (actualIncrease / totalDiscretionary);
    const adjustedExpenses = expenses.map(exp => {
        if (exp.isDiscretionary) {
            return exp.adjustAmount(increaseRatio);
        }
        return exp;
    });

    logs.push(`[FLOW] Prosperity: Budget $${budgetTarget.toLocaleString(undefined, { maximumFractionDigits: 0 })} exceeds expenses $${currentTotalExpenses.toLocaleString(undefined, { maximumFractionDigits: 0 })} → discretionary increased by $${actualIncrease.toLocaleString(undefined, { maximumFractionDigits: 0 })} (${((increaseRatio - 1) * 100).toFixed(0)}%)`);

    if (surplusAfterIncrease > 0) {
        logs.push(`[FLOW] Remaining surplus of $${surplusAfterIncrease.toLocaleString(undefined, { maximumFractionDigits: 0 })} will be invested`);
    }

    return { adjustedExpenses, surplusToInvest: surplusAfterIncrease, prosperityApplied: true };
}
