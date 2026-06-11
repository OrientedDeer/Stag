import { AnyExpense } from "../../Expense/models";
import { AnyIncome } from "../../Income/models";
import { TaxState } from "../TaxContext";
import { AssumptionsState, getBirthYear } from "../../Assumptions/AssumptionsContext";
import { getTaxParameters, getSALTCap } from "./parameters";
import {
    getGrossIncome,
    getPreTaxExemptions,
    getSocialSecurityBenefits,
} from "./incomeAggregation";
import { getItemizedDeductions, getYesDeductions } from "./deductions";
import { calculateTotalFederalTax } from "./bracketTax";
import { calculateStateTax, calculateUnifiedStateTax } from "./stateTax";

/**
 * Calculate federal tax from income/expense objects using calculateTotalFederalTax.
 *
 * Orchestrates the full federal tax computation: extracts values from incomes
 * + expenses, threads them through `calculateTotalFederalTax`, handles SALT
 * cap interaction with state tax, and picks the best of Standard / Itemized
 * deduction when `deductionMethod === 'Auto'`.
 *
 * @param state - Tax state (filing status, overrides, deduction method)
 * @param incomes - Income objects (SS, pensions, work income)
 * @param expenses - Expense objects (for itemized deductions)
 * @param additionalOrdinaryIncome - Traditional withdrawals + Roth conversions + RMDs (default 0)
 * @param year - Tax year
 * @param assumptions - Assumptions for inflation adjustments
 * @param stcg - Short-term capital gains (default 0)
 * @param ltcg - Long-term capital gains (default 0)
 * @returns Federal tax amount
 */
export function calculateFederalTaxFromIncomes(
    state: TaxState,
    incomes: AnyIncome[],
    expenses: AnyExpense[],
    additionalOrdinaryIncome: number = 0,
    year: number,
    assumptions?: AssumptionsState,
    stcg: number = 0,
    ltcg: number = 0,
): number {
    if (state.fedOverride !== null) {
        return state.fedOverride;
    }

    const incomeGross = getGrossIncome(incomes, year);
    const age = assumptions?.milestones ? year - getBirthYear(assumptions.milestones) : undefined;

    const incomePreTaxDeductions = getPreTaxExemptions(incomes, year, age);
    const expenseAboveLineDeductions = getYesDeductions(expenses, year);
    const totalPreTaxDeductions = incomePreTaxDeductions + expenseAboveLineDeductions;

    const totalSSBenefits = getSocialSecurityBenefits(incomes, year);
    const nonSSGross = incomeGross - totalSSBenefits;
    const ordinaryIncome = nonSSGross + additionalOrdinaryIncome;

    const fedParams = getTaxParameters(year, state.filingStatus, "federal", undefined, assumptions);
    if (!fedParams) return 0;

    // SALT cap interaction with state tax. Only needed for the Itemized / Auto
    // paths — on the Standard path `itemizedTotal` is never used, so skip the
    // (expensive) state-tax + SALT + itemized computation entirely.
    let itemizedTotal = 0;
    if (state.deductionMethod !== "Standard") {
        const stateTax = additionalOrdinaryIncome > 0
            ? calculateUnifiedStateTax(state, incomes, expenses, additionalOrdinaryIncome, year, assumptions)
            : calculateStateTax(state, incomes, expenses, year, assumptions);

        const saltCap = getSALTCap(year, state.filingStatus);
        const cappedStateTax = Math.min(stateTax, saltCap);

        itemizedTotal = getItemizedDeductions(expenses, year) + cappedStateTax;
    }

    const calcTaxWithDeduction = (deductionAmount: number): number => {
        const paramsWithDeduction = {
            ...fedParams,
            standardDeduction: deductionAmount,
        };
        return calculateTotalFederalTax(
            ordinaryIncome,
            totalSSBenefits,
            stcg,
            ltcg,
            totalPreTaxDeductions,
            state.filingStatus,
            paramsWithDeduction,
        ).totalTax;
    };

    if (state.deductionMethod === "Auto") {
        const taxWithStandard = calcTaxWithDeduction(fedParams.standardDeduction);
        const taxWithItemized = calcTaxWithDeduction(itemizedTotal);
        return Math.min(taxWithStandard, taxWithItemized);
    }

    const appliedDeduction = state.deductionMethod === "Standard"
        ? fedParams.standardDeduction
        : itemizedTotal;

    return calcTaxWithDeduction(appliedDeduction);
}
