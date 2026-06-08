import { AnyExpense } from "../../Expense/models";
import { AnyIncome } from "../../Income/models";
import { TaxState } from "../TaxContext";
import { AssumptionsState, getBirthYear } from "../../Assumptions/AssumptionsContext";
import { getTaxParameters } from "./parameters";
import {
    getGrossIncome,
    getPreTaxExemptions,
    getSocialSecurityBenefits,
} from "./incomeAggregation";
import { getTaxableSocialSecurityBenefits } from "./socialSecurity";
import { getItemizedDeductions, getYesDeductions } from "./deductions";
import { calculateTax } from "./bracketTax";

export function calculateStateTax(
    state: TaxState,
    incomes: AnyIncome[],
    expenses: AnyExpense[],
    year: number,
    assumptions?: AssumptionsState,
) {
    if (state.stateOverride !== null) {
        return state.stateOverride;
    }

    const annualGross = getGrossIncome(incomes, year);
    const age = assumptions?.milestones ? year - getBirthYear(assumptions.milestones) : undefined;
    const incomePreTaxDeductions = getPreTaxExemptions(incomes, year, age);
    const expenseAboveLineDeductions = getYesDeductions(expenses, year);
    const totalPreTaxDeductions = incomePreTaxDeductions + expenseAboveLineDeductions;

    const itemizedTotal = getItemizedDeductions(expenses, year);
    const stateParams = getTaxParameters(
        year,
        state.filingStatus,
        "state",
        state.stateResidency,
        assumptions,
    );

    if (!stateParams) return 0;

    // Social Security handling — data-driven `socialSecurityTreatment` defaults to 'exempt'.
    const ssTreatment = stateParams.socialSecurityTreatment ?? 'exempt';
    const totalSSBenefits = getSocialSecurityBenefits(incomes, year);
    let adjustedGrossForState = annualGross;

    if (totalSSBenefits > 0) {
        if (ssTreatment === 'taxable') {
            // States that tax SS: use only the taxable portion (like federal)
            const nonSSGross = annualGross - totalSSBenefits;
            const agiExcludingSS = nonSSGross - totalPreTaxDeductions;
            // TODO: Verify all income types are included (LTCG, STCG, dividends, etc.)
            const taxableSSBenefits = getTaxableSocialSecurityBenefits(
                totalSSBenefits,
                agiExcludingSS,
                0,
                state.filingStatus,
            );
            adjustedGrossForState = annualGross - totalSSBenefits + taxableSSBenefits;
        } else if (ssTreatment === 'income-based') {
            // TODO: Implement income-based SS exemption for states like CO, CT, etc.
            // For now, treat as exempt (conservative).
            adjustedGrossForState = annualGross - totalSSBenefits;
        } else {
            // 'exempt' — exclude SS benefits entirely
            adjustedGrossForState = annualGross - totalSSBenefits;
        }
    }

    // Senior deduction: per-person variants (e.g., Virginia) get doubled for MFJ
    // (assumes both spouses meet the age threshold).
    let seniorDeductionAmount = 0;
    if (stateParams.seniorDeduction && age !== undefined) {
        const seniorAge = stateParams.seniorAge ?? 65;
        if (age >= seniorAge) {
            seniorDeductionAmount = stateParams.seniorDeduction;
            if (stateParams.seniorDeductionPerPerson && state.filingStatus === 'Married Filing Jointly') {
                seniorDeductionAmount *= 2;
            }
        }
    }

    const stateStandardDeduction = (stateParams.standardDeduction || 0) + seniorDeductionAmount;

    if (state.deductionMethod === "Auto") {
        const taxWithStandard = calculateTax(adjustedGrossForState, totalPreTaxDeductions, {
            ...stateParams,
            standardDeduction: stateStandardDeduction,
        });
        const taxWithItemized = calculateTax(adjustedGrossForState, totalPreTaxDeductions, {
            ...stateParams,
            standardDeduction: itemizedTotal + seniorDeductionAmount,
        });
        return Math.min(taxWithStandard, taxWithItemized);
    }

    const stateAppliedMainDeduction =
        state.deductionMethod === "Standard"
            ? stateStandardDeduction
            : itemizedTotal + seniorDeductionAmount;

    return calculateTax(adjustedGrossForState, totalPreTaxDeductions, {
        ...stateParams,
        standardDeduction: stateAppliedMainDeduction,
    });
}

/**
 * Calculate state tax including additional ordinary income from withdrawals.
 *
 * @param state - Tax state
 * @param incomes - Original income objects
 * @param expenses - Expenses (for deductions)
 * @param additionalOrdinaryIncome - Traditional withdrawals + Roth conversions + RMDs
 * @param year - Tax year
 * @param assumptions - Assumptions for inflation adjustments
 * @returns State tax including all income sources
 */
export function calculateUnifiedStateTax(
    state: TaxState,
    incomes: AnyIncome[],
    expenses: AnyExpense[],
    additionalOrdinaryIncome: number,
    year: number,
    assumptions?: AssumptionsState,
): number {
    if (state.stateOverride !== null) {
        return state.stateOverride;
    }

    const stateParams = getTaxParameters(
        year,
        state.filingStatus,
        "state",
        state.stateResidency,
        assumptions,
    );

    if (!stateParams) return 0;

    const incomeGross = getGrossIncome(incomes, year);
    const annualGross = incomeGross + additionalOrdinaryIncome;

    const age = assumptions?.milestones ? year - getBirthYear(assumptions.milestones) : undefined;
    const incomePreTaxDeductions = getPreTaxExemptions(incomes, year, age);
    const expenseAboveLineDeductions = getYesDeductions(expenses, year);
    const totalPreTaxDeductions = incomePreTaxDeductions + expenseAboveLineDeductions;

    const ssTreatment = stateParams.socialSecurityTreatment ?? 'exempt';
    const totalSSBenefits = getSocialSecurityBenefits(incomes, year);
    let adjustedGross = annualGross;

    if (totalSSBenefits > 0) {
        if (ssTreatment === 'taxable') {
            const nonSSGross = annualGross - totalSSBenefits;
            const agiExcludingSS = nonSSGross - totalPreTaxDeductions;
            // TODO: Verify all income types are included (LTCG, STCG, dividends, etc.)
            const taxableSSBenefits = getTaxableSocialSecurityBenefits(
                totalSSBenefits,
                agiExcludingSS,
                0,
                state.filingStatus,
            );
            adjustedGross = annualGross - totalSSBenefits + taxableSSBenefits;
        } else if (ssTreatment === 'income-based') {
            // TODO: Implement income-based SS exemption (CO, CT, etc.)
            adjustedGross = annualGross - totalSSBenefits;
        } else {
            adjustedGross = annualGross - totalSSBenefits;
        }
    }

    let seniorDeductionAmount = 0;
    if (stateParams.seniorDeduction && age !== undefined) {
        const seniorAge = stateParams.seniorAge ?? 65;
        if (age >= seniorAge) {
            seniorDeductionAmount = stateParams.seniorDeduction;
            if (stateParams.seniorDeductionPerPerson && state.filingStatus === 'Married Filing Jointly') {
                seniorDeductionAmount *= 2;
            }
        }
    }

    const itemizedTotal = getItemizedDeductions(expenses, year);
    const stateStandardDeduction = (stateParams.standardDeduction || 0) + seniorDeductionAmount;

    if (state.deductionMethod === "Auto") {
        const taxWithStandard = calculateTax(adjustedGross, totalPreTaxDeductions, {
            ...stateParams,
            standardDeduction: stateStandardDeduction,
        });
        const taxWithItemized = calculateTax(adjustedGross, totalPreTaxDeductions, {
            ...stateParams,
            standardDeduction: itemizedTotal + seniorDeductionAmount,
        });
        return Math.min(taxWithStandard, taxWithItemized);
    }

    const stateAppliedMainDeduction =
        state.deductionMethod === "Standard" ? stateStandardDeduction : itemizedTotal + seniorDeductionAmount;

    return calculateTax(adjustedGross, totalPreTaxDeductions, {
        ...stateParams,
        standardDeduction: stateAppliedMainDeduction,
    });
}
