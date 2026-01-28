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
 * Calculate total living expenses from an expense list.
 */
function calculateTotalLivingExpenses(expenses: AnyExpense[], year: number): number {
    return expenses.reduce((sum, exp) => {
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
 * Calculate total discretionary expenses.
 */
function calculateTotalDiscretionary(expenses: AnyExpense[], year: number): number {
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
            const realRaise = prevInc.amount * salaryGrowthRate;
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
 * Calculate the Guyton-Klinger withdrawal target (before spending cap enforcement).
 */
export function calculateGKTarget(
    accounts: AnyAccount[],
    assumptions: AssumptionsState,
    previousSimulation: SimulationYear[],
    year: number,
    currentAge: number,
    logs: string[]
): WithdrawalResult | undefined {
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
    const yearsRemaining = getLifeExpectancy(assumptions.milestones) - currentAge;

    const result = calculateStrategyWithdrawal({
        strategy: 'Guyton Klinger',
        withdrawalRate: assumptions.investments.withdrawalRate,
        currentPortfolio: totalInvestedAssets,
        inflationRate: assumptions.macro.inflationRate,
        yearsInRetirement,
        previousWithdrawal: previousStrategyResult,
        gkUpperGuardrail: assumptions.investments.gkUpperGuardrail,
        gkLowerGuardrail: assumptions.investments.gkLowerGuardrail,
        gkAdjustmentPercent: assumptions.investments.gkAdjustmentPercent,
        yearsRemaining,
    });

    logs.push(`[INFO] Retirement withdrawal strategy: Guyton Klinger`);
    logs.push(`  Target withdrawal: $${result.amount.toLocaleString(undefined, { maximumFractionDigits: 0 })}`);
    logs.push(`  Portfolio value: $${totalInvestedAssets.toLocaleString(undefined, { maximumFractionDigits: 0 })}`);
    logs.push(`  Effective rate: ${((result.amount / totalInvestedAssets) * 100).toFixed(2)}%`);

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
 * Calculate the non-GK withdrawal strategy target (Fixed Real, Percentage, etc.).
 */
export function calculateNonGKTarget(
    accounts: AnyAccount[],
    assumptions: AssumptionsState,
    previousSimulation: SimulationYear[],
    year: number,
    logs: string[]
): WithdrawalResult | undefined {
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

    const result = calculateStrategyWithdrawal(
        assumptions.investments.withdrawalStrategy as 'Fixed Real' | 'Percentage' | 'Guyton Klinger',
        assumptions.investments.withdrawalRate,
        totalInvestedAssets,
        assumptions.macro.inflationRate,
        yearsInRetirement,
        previousStrategyResult
    );

    logs.push(`[INFO] Retirement withdrawal strategy: ${assumptions.investments.withdrawalStrategy}`);
    logs.push(`  Target withdrawal: $${result.amount.toLocaleString(undefined, { maximumFractionDigits: 0 })}`);
    logs.push(`  Portfolio value: $${totalInvestedAssets.toLocaleString(undefined, { maximumFractionDigits: 0 })}`);
    logs.push(`  Effective rate: ${((result.amount / totalInvestedAssets) * 100).toFixed(2)}%`);

    return result;
}

/**
 * Enforce GK spending cap: trim discretionary expenses to stay within budget.
 */
export function enforceGKSpendingCap(
    expenses: AnyExpense[],
    strategyWithdrawalResult: WithdrawalResult,
    discretionaryCash: number,
    totalGrossIncome: number,
    preTaxDeductions: number,
    postTaxDeductions: number,
    totalTax: number,
    reinvestedIncome: number,
    year: number,
    _assumptions: AssumptionsState,
    logs: string[]
): { nextExpenses: AnyExpense[]; totalLivingExpenses: number; discretionaryCash: number; strategyAdjustmentResult: SimulationYear['strategyAdjustment'] } {
    const deficit = Math.abs(discretionaryCash);
    const gkBudget = strategyWithdrawalResult.amount;
    let nextExpenses = expenses;
    let strategyAdjustmentResult: SimulationYear['strategyAdjustment'] = undefined;

    if (deficit > gkBudget) {
        const excessSpending = deficit - gkBudget;
        const totalDiscretionary = calculateTotalDiscretionary(nextExpenses, year);

        if (totalDiscretionary > 0) {
            const trimAmount = Math.min(excessSpending, totalDiscretionary);
            const cutRatio = 1 - (trimAmount / totalDiscretionary);

            nextExpenses = nextExpenses.map(exp => {
                if (exp.isDiscretionary) {
                    return exp.adjustAmount(cutRatio);
                }
                return exp;
            });

            const totalLivingExpenses = calculateTotalLivingExpenses(nextExpenses, year);
            const newDiscretionaryCash = totalGrossIncome - preTaxDeductions - postTaxDeductions - totalTax - totalLivingExpenses - reinvestedIncome;

            logs.push(`[TARGET] GK spending cap: trimmed discretionary by $${trimAmount.toLocaleString(undefined, { maximumFractionDigits: 0 })} to stay within $${gkBudget.toLocaleString(undefined, { maximumFractionDigits: 0 })} budget`);

            if (trimAmount >= totalDiscretionary) {
                logs.push(`[WARN] GK cap: all discretionary expenses eliminated but fixed expenses still exceed budget`);
            }

            strategyAdjustmentResult = {
                guardrailTriggered: strategyWithdrawalResult.guardrailTriggered,
                requiredAdjustment: excessSpending,
                actualAdjustment: trimAmount,
                discretionaryAvailable: totalDiscretionary,
                warning: trimAmount < excessSpending
                    ? `GK budget is $${gkBudget.toLocaleString(undefined, { maximumFractionDigits: 0 })} but fixed expenses alone create a $${(deficit - totalDiscretionary).toLocaleString(undefined, { maximumFractionDigits: 0 })} deficit. Consider reducing fixed expenses.`
                    : undefined,
            };

            return { nextExpenses, totalLivingExpenses, discretionaryCash: newDiscretionaryCash, strategyAdjustmentResult };
        } else {
            logs.push(`[WARN] GK spending cap: deficit ($${deficit.toLocaleString(undefined, { maximumFractionDigits: 0 })}) exceeds budget ($${gkBudget.toLocaleString(undefined, { maximumFractionDigits: 0 })}) but no discretionary expenses to trim`);
            strategyAdjustmentResult = {
                guardrailTriggered: strategyWithdrawalResult.guardrailTriggered,
                requiredAdjustment: excessSpending,
                actualAdjustment: 0,
                discretionaryAvailable: 0,
                warning: `GK budget is $${gkBudget.toLocaleString(undefined, { maximumFractionDigits: 0 })} but no discretionary expenses to trim. All expenses are fixed.`,
            };
        }
    } else {
        logs.push(`[OK] GK spending cap: deficit ($${deficit.toLocaleString(undefined, { maximumFractionDigits: 0 })}) within budget ($${gkBudget.toLocaleString(undefined, { maximumFractionDigits: 0 })})`);
    }

    const totalLivingExpenses = calculateTotalLivingExpenses(nextExpenses, year);
    return { nextExpenses, totalLivingExpenses, discretionaryCash, strategyAdjustmentResult };
}

/**
 * Enforce Fixed Real / Percentage spending cap.
 */
export function enforceStrategySpendingCap(
    expenses: AnyExpense[],
    strategyWithdrawalResult: WithdrawalResult,
    discretionaryCash: number,
    totalGrossIncome: number,
    preTaxDeductions: number,
    postTaxDeductions: number,
    totalTax: number,
    reinvestedIncome: number,
    year: number,
    assumptions: AssumptionsState,
    logs: string[]
): { nextExpenses: AnyExpense[]; totalLivingExpenses: number; discretionaryCash: number; strategyAdjustmentResult: SimulationYear['strategyAdjustment'] } {
    const deficit = Math.abs(discretionaryCash);
    const budget = strategyWithdrawalResult.amount;
    let nextExpenses = expenses;
    let strategyAdjustmentResult: SimulationYear['strategyAdjustment'] = undefined;

    if (deficit > budget) {
        const excessSpending = deficit - budget;
        const totalDiscretionary = calculateTotalDiscretionary(nextExpenses, year);

        if (totalDiscretionary > 0) {
            const trimAmount = Math.min(excessSpending, totalDiscretionary);
            const cutRatio = 1 - (trimAmount / totalDiscretionary);

            nextExpenses = nextExpenses.map(exp => {
                if (exp.isDiscretionary) {
                    return exp.adjustAmount(cutRatio);
                }
                return exp;
            });

            const totalLivingExpenses = calculateTotalLivingExpenses(nextExpenses, year);
            const newDiscretionaryCash = totalGrossIncome - preTaxDeductions - postTaxDeductions - totalTax - totalLivingExpenses - reinvestedIncome;

            logs.push(`[TARGET] ${assumptions.investments.withdrawalStrategy} spending cap: trimmed discretionary by $${trimAmount.toLocaleString(undefined, { maximumFractionDigits: 0 })} to stay within $${budget.toLocaleString(undefined, { maximumFractionDigits: 0 })} budget`);

            if (trimAmount < excessSpending) {
                strategyAdjustmentResult = {
                    guardrailTriggered: 'capital-preservation',
                    requiredAdjustment: excessSpending,
                    actualAdjustment: trimAmount,
                    discretionaryAvailable: totalDiscretionary,
                    warning: `${assumptions.investments.withdrawalStrategy} budget is $${budget.toLocaleString(undefined, { maximumFractionDigits: 0 })} but fixed expenses alone create a $${(deficit - totalDiscretionary).toLocaleString(undefined, { maximumFractionDigits: 0 })} deficit. Consider reducing fixed expenses.`,
                };
            }

            return { nextExpenses, totalLivingExpenses, discretionaryCash: newDiscretionaryCash, strategyAdjustmentResult };
        } else {
            logs.push(`[WARN] ${assumptions.investments.withdrawalStrategy} spending cap: deficit exceeds budget but no discretionary expenses to trim`);
            strategyAdjustmentResult = {
                guardrailTriggered: 'capital-preservation',
                requiredAdjustment: excessSpending,
                actualAdjustment: 0,
                discretionaryAvailable: 0,
                warning: `${assumptions.investments.withdrawalStrategy} budget is $${budget.toLocaleString(undefined, { maximumFractionDigits: 0 })} but no discretionary expenses to trim. All expenses are fixed.`,
            };
        }
    } else {
        logs.push(`[OK] ${assumptions.investments.withdrawalStrategy} spending cap: deficit ($${deficit.toLocaleString(undefined, { maximumFractionDigits: 0 })}) within budget ($${budget.toLocaleString(undefined, { maximumFractionDigits: 0 })})`);
    }

    const totalLivingExpenses = calculateTotalLivingExpenses(nextExpenses, year);
    return { nextExpenses, totalLivingExpenses, discretionaryCash, strategyAdjustmentResult };
}
