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
import { getTaxableSocialSecurityFromBase } from "./socialSecurity";
import { getItemizedDeductions, getYesDeductions } from "./deductions";
import { calculateTax } from "./bracketTax";
import { seniorAdditionalDeduction } from "./seniorDeduction";

/**
 * Shared core of state-tax computation.
 *
 * Given the ordinary gross income BEFORE Social Security treatment
 * (`annualGross`, which already includes any additional ordinary income like
 * withdrawals / Roth conversions / RMDs), this applies the data-driven SS
 * treatment, the senior deduction (doubled per-person for MFJ), and the
 * Auto / Standard / Itemized deduction selection.
 *
 * Both `calculateStateTax` and `calculateUnifiedStateTax` delegate here so the
 * SS-treatment switch, senior-deduction doubling, and deduction selection live
 * in exactly one place. Callers are responsible for the `stateOverride`
 * short-circuit and the `getTaxParameters` undefined guard before calling.
 */
function computeStateTaxFromGross(
    annualGross: number,
    state: TaxState,
    incomes: AnyIncome[],
    expenses: AnyExpense[],
    year: number,
    stateParams: NonNullable<ReturnType<typeof getTaxParameters>>,
    age: number | undefined,
): number {
    const incomePreTaxDeductions = getPreTaxExemptions(incomes, year, age);
    const expenseAboveLineDeductions = getYesDeductions(expenses, year);
    const totalPreTaxDeductions = incomePreTaxDeductions + expenseAboveLineDeductions;

    // Social Security handling — data-driven `socialSecurityTreatment` defaults to 'exempt'.
    const ssTreatment = stateParams.socialSecurityTreatment ?? 'exempt';
    const totalSSBenefits = getSocialSecurityBenefits(incomes, year);
    let adjustedGross = annualGross;

    if (ssTreatment === 'taxable') {
        // States that tax SS: use only the taxable portion (like federal). NOTE: the
        // state base is `nonSSGross − preTax` (no separate STCG/LTCG add) and is passed
        // UN-floored — distinct from the federal components helper, which adds STCG/LTCG
        // and floors at 0. We share only the final base→taxableSS step (the
        // taxExemptInterest=0 convention) via getTaxableSocialSecurityFromBase; the base
        // itself is deliberately NOT the same expression as the federal path.
        // TODO: Verify all income types are included (LTCG, STCG, dividends, etc.)
        const nonSSGross = annualGross - totalSSBenefits;
        const agiExcludingSS = nonSSGross - totalPreTaxDeductions;
        const taxableSSBenefits = getTaxableSocialSecurityFromBase(
            agiExcludingSS,
            totalSSBenefits,
            state.filingStatus,
        );
        adjustedGross = annualGross - totalSSBenefits + taxableSSBenefits;
    } else {
        // 'exempt' (and, for now, 'income-based' — treated conservatively as
        // exempt) — exclude SS benefits entirely. Subtracting 0 when there are
        // no SS benefits leaves the gross unchanged.
        // TODO: Implement income-based SS exemption for states like CO, CT, etc.
        adjustedGross = annualGross - totalSSBenefits;
    }

    // Senior deduction: per-person variants (e.g., Virginia) get doubled for MFJ
    // (assumes both spouses meet the age threshold). Shared with federalTax.ts's
    // regular 65+ add-on via seniorAdditionalDeduction so the rule lives in one
    // place.
    //
    // AFAGI proxy for income-based phaseouts (Virginia: the $12k age deduction is
    // reduced $1-for-$1 by AFAGI above $50k single / $75k married). VA's AFAGI is
    // federal AGI minus taxable Social Security — `adjustedGross` already has the
    // state's SS treatment applied (VA is 'exempt', so SS is fully removed), and
    // above-the-line deductions come off federal AGI, so subtract those too.
    // States without phaseout fields ignore the argument entirely.
    const afagiProxy = Math.max(0, adjustedGross - totalPreTaxDeductions);
    const seniorDeductionAmount = seniorAdditionalDeduction(
        stateParams, state.filingStatus, age, afagiProxy,
    );

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
        state.deductionMethod === "Standard"
            ? stateStandardDeduction
            : itemizedTotal + seniorDeductionAmount;

    return calculateTax(adjustedGross, totalPreTaxDeductions, {
        ...stateParams,
        standardDeduction: stateAppliedMainDeduction,
    });
}

export function calculateStateTax(
    state: TaxState,
    incomes: AnyIncome[],
    expenses: AnyExpense[],
    year: number,
    assumptions?: AssumptionsState,
) {
    // calculateStateTax is exactly calculateUnifiedStateTax with no additional
    // ordinary income — delegate so the two stay in lockstep.
    return calculateUnifiedStateTax(state, incomes, expenses, 0, year, assumptions);
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

    return computeStateTaxFromGross(annualGross, state, incomes, expenses, year, stateParams, age);
}
