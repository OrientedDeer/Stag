import { AnyExpense } from "../../Expense/models";
import { AnyIncome } from "../../Income/models";
import { TaxState, DeductionMethod } from "../TaxContext";
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
import { isSeniorEligible, seniorAdditionalDeduction, seniorPerPersonMultiplier } from "./seniorDeduction";
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

    // Regular (permanent) 65+ additional STANDARD deduction — standard path only.
    // Shared with stateTax.ts via seniorAdditionalDeduction so the per-person
    // doubling and eligibility rule stay in one place.
    const regular = seniorAdditionalDeduction(fedParams, filingStatus, age);

    // Same per-person doubling rule the regular add-on uses (seniorDeduction.ts),
    // applied to the bonus base so the two can't disagree.
    const perPersonMultiplier = seniorPerPersonMultiplier(fedParams, filingStatus);

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
 * Effective STANDARD-path deduction for a given year: the base standard deduction
 * plus BOTH federal 65+ add-ons (the permanent regular additional standard
 * deduction AND the OBBBA senior bonus, phased on `magiProxy`).
 *
 * Exists so the year-by-year simulation engine (YearSolver / RothConversionDP),
 * which computes tax by calling `calculateTotalFederalTax` directly with
 * `fedParams.standardDeduction`, gets the SAME senior deduction the year-0
 * Taxes-tab orchestrator (`calculateFederalTaxFromIncomes`) already applies —
 * closing the year-0-vs-projection asymmetry (#191) where a 65+ retiree saw the
 * senior deduction on the Taxes tab but not in any projected year. The engine
 * only ever takes the STANDARD path, so this folds both add-ons into one figure
 * it can drop into `fedParams.standardDeduction`.
 *
 * `magiProxy` (≈ AGI) drives only the OBBBA-bonus phaseout; the regular add-on is
 * unconditional for a senior filer. Callers that can't cheaply build a full MAGI
 * may pass a pre-withdrawal proxy — the regular add-on (the dominant dollar
 * effect) is unaffected and the bonus phaseout degrades gracefully.
 *
 * @param fedParams - Federal tax parameters (carry the senior fields)
 * @param filingStatus - Filing status (drives the MFJ per-person doubling)
 * @param age - Taxpayer age in the tax year (undefined ⇒ base deduction only)
 * @param year - Tax year (gates the OBBBA bonus to 2025–2028)
 * @param magiProxy - MAGI proxy (≈ AGI) for the OBBBA bonus phaseout
 * @returns base standard deduction + regular 65+ add-on + (phased) OBBBA bonus
 */
export function getEffectiveStandardDeduction(
    fedParams: TaxParameters,
    filingStatus: FilingStatus,
    age: number | undefined,
    year: number,
    magiProxy: number,
): number {
    // Thin wrapper over getEffectiveDeduction: itemizedTotal=0, method='Standard'
    // resolves to exactly `standardDeduction + regular + bonus` — byte-identical to
    // the pre-#198 body, so every not-yet-migrated caller stays unchanged.
    return getEffectiveDeduction(
        fedParams, filingStatus, age, year, magiProxy, 0, "Standard",
    );
}

/**
 * Effective per-year deduction the engine bills a filer, generalizing
 * getEffectiveStandardDeduction to honor ITEMIZED and 'Auto' deduction methods in
 * projected years (#198). Mirrors the year-0 orchestrator
 * (`calculateFederalTaxFromIncomes`) component-for-component so an itemizing
 * mortgage-holder sees the deduction (and the year it flips back to standard as the
 * loan amortizes) in every projected year, not just year 0.
 *
 * The engine only ever takes the STANDARD path when pricing tax
 * (`calculateTotalFederalTax` reads only `fedParams.standardDeduction`), so — as
 * #191 established for the senior add-ons — this folds "the deduction the IRS bills
 * this filer this year" into ONE number the three tax-deduction chokepoints drop
 * into `fedParams.standardDeduction`. Itemization is simply a larger candidate for
 * that same number.
 *
 * Component attachment mirrors `federalTax.ts`'s year-0 rules EXACTLY:
 *  - the permanent 65+ regular additional STANDARD deduction attaches to the
 *    standard path ONLY (an itemizer forgoes it);
 *  - the OBBBA senior bonus attaches to BOTH paths.
 *
 * `deductionMethod === 'Auto'` returns `max(standardPath, itemizedPath)` — the
 * deduction-space analog of year-0's `min(taxWithStandard, taxWithItemized)`. The
 * two agree except for a second-order interaction (a larger deduction lowers
 * ordinary income and can shift LTCG stacking / SS-taxability / NIIT thresholds),
 * confined to a narrow band near the standard↔itemized crossover and dominated by
 * the deduction-monotonic mortgage-interest term. This is the SAME simplification
 * #191 shipped for seniors.
 *
 * @param itemizedTotal - Precomputed itemized deduction total for the year
 *   (mortgage interest + flagged itemized expenses + capped SALT), from the
 *   ENTERING-balance expense list (see SimulationEngine — computing it off the
 *   post-increment list would return next year's mortgage interest). 0 ⇒ the
 *   itemized path is never chosen (standard wins), preserving today's behavior.
 * @param deductionMethod - 'Standard' | 'Itemized' | 'Auto'.
 */
export function getEffectiveDeduction(
    fedParams: TaxParameters,
    filingStatus: FilingStatus,
    age: number | undefined,
    year: number,
    magiProxy: number,
    itemizedTotal: number,
    deductionMethod: DeductionMethod,
): number {
    const { regular, bonus } = getFederalSeniorDeduction(
        fedParams, filingStatus, age, year, magiProxy,
    );
    const standardPath = fedParams.standardDeduction + regular + bonus;
    // No regular 65+ add-on on the itemized path (it is part of the STANDARD
    // deduction); the OBBBA bonus applies on both — identical to year-0.
    const itemizedPath = itemizedTotal + bonus;
    switch (deductionMethod) {
        case "Standard":
            return standardPath;
        case "Itemized":
            return itemizedPath;
        case "Auto":
            return Math.max(standardPath, itemizedPath);
    }
}

/**
 * The #191/#198 "effective-deduction chokepoint": returns a COPY of `fedParams`
 * with its `standardDeduction` replaced by `getEffectiveDeduction(...)`, so the
 * only path the engine ever prices (`calculateTotalFederalTax` reads solely
 * `fedParams.standardDeduction`) bills the same senior add-ons + itemized ≷
 * standard choice the year-0 Taxes-tab orchestrator applies.
 *
 * The engine (YearSolver retirement + working paths) and the DP objective
 * (RothConversionDP) must maintain this identical wrapper mechanic, or the DP
 * optimizes against a different tax than the engine bills — the exact
 * engine-vs-DP pricing asymmetry #191/#198 exist to close. This shared wrapper
 * keeps the three sites in lockstep by construction.
 *
 * Only the wrapper mechanics are unified here: each call site computes its own
 * `magiProxy` (the retirement path uses baseOrdinaryIncome; the working path a
 * pre-tax-deferral-netted proxy through getTaxableSocialSecurityFromComponents;
 * the DP its own non-SS-ordinary + LTCG + taxable-SS figure) and passes the
 * result in, matching the situation that site enters the year in. The remaining
 * six positional args mirror `getEffectiveDeduction` exactly.
 */
export function withEffectiveDeduction(
    fedParams: TaxParameters,
    filingStatus: FilingStatus,
    age: number | undefined,
    year: number,
    magiProxy: number,
    itemizedTotal: number,
    deductionMethod: DeductionMethod,
): TaxParameters {
    return {
        ...fedParams,
        standardDeduction: getEffectiveDeduction(
            fedParams, filingStatus, age, year, magiProxy, itemizedTotal, deductionMethod,
        ),
    };
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
    // Federal params resolve for every filing status; $0 federal tax would be a
    // silent distortion, so crash loudly instead (matches YearSolver).
    if (!fedParams) {
        throw new Error(`No federal tax parameters for year ${year}`);
    }

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
        // Use the SAME SS-taxability FORMULA that calculateTotalFederalTax uses on
        // the standard path (single-sourced in getTaxableSocialSecurityFromComponents)
        // instead of open-coding it here a second time — eliminating the drift hazard
        // near the $75k/$150k phaseout thresholds. (The VALUE is still recomputed: this
        // call and the later calculateTotalFederalTax call each run the formula once.)
        const taxableSSForMagi = getTaxableSocialSecurityFromComponents(
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
