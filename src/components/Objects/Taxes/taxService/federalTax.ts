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
import { getTaxableSocialSecurityFromComponents } from "./socialSecurity";
import { isSeniorEligible, seniorAdditionalDeduction } from "./seniorDeduction";
import { FilingStatus, TaxParameters } from "../../../../data/TaxData";

/**
 * OBBBA "senior bonus" deduction sunset window. The bonus applies for tax years
 * 2025–2028 only and disappears after 2028. The regular 65+ additional standard
 * deduction (`seniorDeduction`) is permanent and is NOT gated by this window.
 */
const SENIOR_BONUS_START_YEAR = 2025;
const SENIOR_BONUS_END_YEAR = 2028;

/**
 * Federal extra deductions for taxpayers age >= seniorAge, split into the two
 * IRS components that attach to DIFFERENT bases:
 *
 *  - `regular`: the permanent 65+ ADDITIONAL STANDARD deduction (IRC §63(f),
 *    $2,000–$2,050 single / $1,600–$1,650 per spouse). This is part of the
 *    STANDARD deduction — a filer who ITEMIZES does NOT get it. Returned so the
 *    caller can add it on the standard path ONLY.
 *  - `bonus`: the OBBBA "senior bonus" (IRC §151(d)(5), $6,000/person, tax years
 *    2025–2028). This is a SEPARATE deduction available to BOTH itemizers and
 *    non-itemizers, so the caller adds it on BOTH the standard and itemized
 *    paths. Phases out at `seniorBonusPhaseoutRate` of (MAGI − threshold),
 *    floored at $0.
 *
 * Per-person amounts double for MFJ when `seniorDeductionPerPerson` is true (the
 * single-age model can only assume both spouses meet the threshold). This splits
 * what stateTax.ts folds together because, unlike the federal rules, a state's
 * senior add-on is a single component applied uniformly to both bases.
 *
 * @param fedParams - Federal tax parameters (carry the senior fields)
 * @param filingStatus - Filing status (drives the MFJ per-person doubling)
 * @param age - Taxpayer age in the tax year (undefined ⇒ no senior deduction)
 * @param year - Tax year (gates the OBBBA bonus to 2025–2028)
 * @param magi - MAGI proxy (≈ AGI) for the OBBBA bonus phaseout
 * @returns `{ regular, bonus }` — regular = standard-path-only add-on, bonus =
 *          available on both paths.
 */
function getFederalSeniorDeduction(
    fedParams: TaxParameters,
    filingStatus: FilingStatus,
    age: number | undefined,
    year: number,
    magi: number,
): { regular: number; bonus: number } {
    if (!isSeniorEligible(fedParams, age)) return { regular: 0, bonus: 0 };

    const isMFJ = filingStatus === 'Married Filing Jointly';
    const perPersonMultiplier = fedParams.seniorDeductionPerPerson && isMFJ ? 2 : 1;

    // Regular (permanent) 65+ additional STANDARD deduction — standard path only.
    // Shared with stateTax.ts via seniorAdditionalDeduction so the per-person
    // doubling and eligibility rule stay in one place.
    const regular = seniorAdditionalDeduction(fedParams, filingStatus, age);

    // OBBBA senior bonus: $6,000/person, tax years 2025–2028, phasing out at
    // `seniorBonusPhaseoutRate` of (MAGI − threshold), floored at $0. Available
    // to itemizers AND non-itemizers (added on both paths by the caller).
    let bonus = 0;
    if (
        fedParams.seniorBonusDeduction &&
        year >= SENIOR_BONUS_START_YEAR &&
        year <= SENIOR_BONUS_END_YEAR
    ) {
        bonus = fedParams.seniorBonusDeduction * perPersonMultiplier;
        const threshold = fedParams.seniorBonusPhaseoutThreshold;
        const rate = fedParams.seniorBonusPhaseoutRate;
        if (threshold !== undefined && rate !== undefined && magi > threshold) {
            bonus = Math.max(0, bonus - (magi - threshold) * rate);
        }
    }

    return { regular, bonus };
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
    //
    // Gate the (non-trivial) MAGI-proxy + taxable-SS computation behind the
    // senior-age check: no senior deduction can apply when age is undefined or
    // below seniorAge, so building the proxy would be wasted work in the common
    // (working-age) case. Behavior-preserving — the proxy only feeds the senior
    // deduction, which getFederalSeniorDeduction returns 0 for in that case.
    const seniorEligible = isSeniorEligible(fedParams, age);
    let regularSeniorDeduction = 0;
    let bonusSeniorDeduction = 0;
    if (seniorEligible) {
        // Reuse the SAME provisional-income / taxable-SS build that
        // calculateTotalFederalTax performs on the standard path, instead of
        // recomputing it (which previously called getTaxableSocialSecurityBenefits
        // a second time and risked drift near the $75k/$150k phaseout thresholds).
        const { taxableSS: taxableSSForMagi } = getTaxableSocialSecurityFromComponents(
            ordinaryIncome,
            stcg,
            ltcg,
            totalPreTaxDeductions,
            totalSSBenefits,
            state.filingStatus,
        );
        const magiProxy = Math.max(
            0,
            ordinaryIncome + stcg + ltcg + taxableSSForMagi - totalPreTaxDeductions,
        );
        const senior = getFederalSeniorDeduction(
            fedParams,
            state.filingStatus,
            age,
            year,
            magiProxy,
        );
        regularSeniorDeduction = senior.regular;
        bonusSeniorDeduction = senior.bonus;
    }

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

    // The two 65+ deductions attach to different bases (IRS rules):
    //  - regularSeniorDeduction is part of the STANDARD deduction, so it's added
    //    on the standard path ONLY (an itemizer does not get it).
    //  - bonusSeniorDeduction (OBBBA $6k) is a separate deduction available to
    //    BOTH itemizers and non-itemizers, so it's added on EITHER path.
    // (This is the federal departure from stateTax.ts, which folds its single
    // state senior add-on into both bases uniformly.)
    const calcTaxWithDeduction = (
        deductionAmount: number,
        isStandardPath: boolean,
    ): number => {
        const seniorAddOn = (isStandardPath ? regularSeniorDeduction : 0) + bonusSeniorDeduction;
        const paramsWithDeduction = {
            ...fedParams,
            standardDeduction: deductionAmount + seniorAddOn,
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
        const taxWithStandard = calcTaxWithDeduction(fedParams.standardDeduction, true);
        const taxWithItemized = calcTaxWithDeduction(itemizedTotal, false);
        return Math.min(taxWithStandard, taxWithItemized);
    }

    if (state.deductionMethod === "Standard") {
        return calcTaxWithDeduction(fedParams.standardDeduction, true);
    }

    return calcTaxWithDeduction(itemizedTotal, false);
}
