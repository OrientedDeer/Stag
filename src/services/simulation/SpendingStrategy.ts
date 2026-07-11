import { type AnyExpense, MortgageExpense, LoanExpense, isLongTermGoal } from "../../components/Objects/Expense/models";
import { type AnyIncome, WorkIncome } from "../../components/Objects/Income/models";
import { type AnyAccount } from "../../components/Objects/Accounts/models";
import { sumInvestedAssets } from "../../components/Objects/Accounts/accountUtils";
import { type AssumptionsState, getRetirementAge, getLifeExpectancy, getBirthYear } from "../../components/Objects/Assumptions/AssumptionsContext";
import { calculateStrategyWithdrawal, type WithdrawalResult } from "../WithdrawalStrategies";
import { type SimulationYear } from "./types";

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
    // Long-term goals default to isDiscretionary=true but their `amount` is the
    // goal's TOTAL cost, which must stay static (see the goal-amount invariant in
    // Expense.getAnnualAmount). A goal contributes $0 to the recurring denominator
    // (getAnnualAmount returns 0 for goalType), yet adjustAmount would still scale
    // its stored total — compounding it every working year. Exclude goals from both
    // the denominator and the adjustment so creep only touches recurring spending.
    const isCreepEligible = (exp: AnyExpense): boolean => exp.isDiscretionary && !isLongTermGoal(exp);
    const discretionaryExpenses = expenses.filter(isCreepEligible);
    const totalDiscretionary = discretionaryExpenses.reduce((sum, exp) => {
        return sum + exp.getAnnualAmount(year);
    }, 0);

    if (totalDiscretionary <= 0 || lifestyleCreepAmount <= 0) return expenses;

    const increaseRatio = 1 + (lifestyleCreepAmount / totalDiscretionary);
    const result = expenses.map(exp => {
        if (isCreepEligible(exp)) {
            return exp.adjustAmount(increaseRatio);
        }
        return exp;
    });

    logs.push(`[FLOW] Lifestyle creep: Salary raise of $${totalRaise.toLocaleString(undefined, { maximumFractionDigits: 0 })}/yr → Discretionary expenses increased by $${lifestyleCreepAmount.toLocaleString(undefined, { maximumFractionDigits: 0 })}/yr (${assumptions.expenses.lifestyleCreep}%)`);

    return result;
}

/**
 * Calculate the withdrawal strategy budget for the budget-cap strategies
 * (Fixed Real, Percentage). Returns undefined for 'None' / 'Needs Based'.
 *
 * NOTE: Guyton-Klinger no longer routes through here. GK is now plan-anchored and
 * handled directly in SimulationEngine (`evaluateGuytonKlingerGuardrail`): it
 * spends the itemized plan within the ±20% band and applies a ±10% discretionary
 * adjustment only on a guardrail breach — there is no annual budget cap.
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

    const totalInvestedAssets = sumInvestedAssets(accounts);

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

