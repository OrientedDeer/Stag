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
import { getTaxableSocialSecurityBenefits } from "./socialSecurity";
import { FilingStatus, TaxParameters } from "../../../../data/TaxData";

/**
 * OBBBA "senior bonus" deduction sunset window. The bonus applies for tax years
 * 2025–2028 only and disappears after 2028. The regular 65+ additional standard
 * deduction (`seniorDeduction`) is permanent and is NOT gated by this window.
 */
const SENIOR_BONUS_START_YEAR = 2025;
const SENIOR_BONUS_END_YEAR = 2028;

/**
 * Federal extra deduction for taxpayers age >= seniorAge.
 *
 * Mirrors the state senior-deduction mechanism in stateTax.ts: per-person
 * amounts double for MFJ when `seniorDeductionPerPerson` is true (the single-age
 * model can only assume both spouses meet the threshold). Returns the combined
 * (regular 65+ + OBBBA senior bonus) extra deduction to add on top of the
 * standard / itemized deduction.
 *
 * @param fedParams - Federal tax parameters (carry the senior fields)
 * @param filingStatus - Filing status (drives the MFJ per-person doubling)
 * @param age - Taxpayer age in the tax year (undefined ⇒ no senior deduction)
 * @param year - Tax year (gates the OBBBA bonus to 2025–2028)
 * @param magi - MAGI proxy (≈ AGI) for the OBBBA bonus phaseout
 */
function getFederalSeniorDeduction(
    fedParams: TaxParameters,
    filingStatus: FilingStatus,
    age: number | undefined,
    year: number,
    magi: number,
): number {
    if (age === undefined) return 0;
    const seniorAge = fedParams.seniorAge ?? 65;
    if (age < seniorAge) return 0;

    const isMFJ = filingStatus === 'Married Filing Jointly';
    const perPersonMultiplier = fedParams.seniorDeductionPerPerson && isMFJ ? 2 : 1;

    // Regular (permanent) 65+ additional standard deduction.
    let total = (fedParams.seniorDeduction ?? 0) * perPersonMultiplier;

    // OBBBA senior bonus: $6,000/person, tax years 2025–2028, phasing out at
    // `seniorBonusPhaseoutRate` of (MAGI − threshold), floored at $0.
    if (
        fedParams.seniorBonusDeduction &&
        year >= SENIOR_BONUS_START_YEAR &&
        year <= SENIOR_BONUS_END_YEAR
    ) {
        let bonus = fedParams.seniorBonusDeduction * perPersonMultiplier;
        const threshold = fedParams.seniorBonusPhaseoutThreshold;
        const rate = fedParams.seniorBonusPhaseoutRate;
        if (threshold !== undefined && rate !== undefined && magi > threshold) {
            bonus = Math.max(0, bonus - (magi - threshold) * rate);
        }
        total += bonus;
    }

    return total;
}

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

    // Federal 65+ deductions (regular additional standard deduction + OBBBA senior
    // bonus). The OBBBA bonus phases out on MAGI, so build a MAGI proxy. MAGI for
    // the bonus ≈ AGI = ordinary income + STCG + LTCG + the TAXABLE portion of SS,
    // less above-the-line (pre-tax) deductions. We don't model the few statutory
    // MAGI add-backs (tax-exempt interest, foreign earned income), none of which
    // this app tracks — so MAGI == AGI here. Mirrors the SS-taxability provisional
    // income build used inside bracketTax.ts.
    const taxableSSForMagi = getTaxableSocialSecurityBenefits(
        totalSSBenefits,
        Math.max(0, ordinaryIncome + stcg + ltcg - totalPreTaxDeductions),
        0, // tax-exempt interest — not tracked
        state.filingStatus,
    );
    const magiProxy = Math.max(
        0,
        ordinaryIncome + stcg + ltcg + taxableSSForMagi - totalPreTaxDeductions,
    );
    const seniorDeduction = getFederalSeniorDeduction(
        fedParams,
        state.filingStatus,
        age,
        year,
        magiProxy,
    );

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
            // The 65+ deductions stack on top of the standard OR itemized base, so
            // they're added inside here (matching how stateTax.ts folds the state
            // senior deduction into both the standard and itemized variants).
            standardDeduction: deductionAmount + seniorDeduction,
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
