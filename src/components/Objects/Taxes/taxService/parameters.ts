import {
    TaxParameters,
    TAX_DATABASE,
    getClosestTaxYear,
    max_year,
    FilingStatus,
    AuthorityData,
} from "../../../../data/TaxData";
import {
    AssumptionsState,
    defaultAssumptions,
} from "../../Assumptions/AssumptionsContext";

/** Tax years when TCJA SALT cap was in effect ($10k/$5k MFS) */
const TCJA_SALT_START_YEAR = 2018;
const TCJA_SALT_END_YEAR = 2024;

/** Tax years when OBBBA raised SALT cap ($40k/$20k MFS with 1% annual inflation) */
const OBBBA_SALT_START_YEAR = 2025;
const OBBBA_SALT_END_YEAR = 2029;

/** SALT cap amounts */
const SALT_CAP_TCJA_JOINT = 10000;
const SALT_CAP_TCJA_MFS = 5000;
const SALT_CAP_OBBBA_JOINT = 40000;
const SALT_CAP_OBBBA_MFS = 20000;
const SALT_CAP_ANNUAL_INCREASE = 0.01; // 1% annual increase under OBBBA

/**
 * SALT (State and Local Tax) deduction cap.
 *
 * History:
 * - TCJA 2017 (effective 2018-2024): $10,000 cap ($5,000 MFS)
 * - One Big Beautiful Bill Act 2025 (effective 2025-2029): $40,000 cap ($20,000 MFS)
 *   with 1% annual increase starting 2026
 * - 2030+: Reverts to $10,000
 *
 * Note: The 2025 law includes income phase-outs starting at $500k MAGI, but we don't
 * implement those here for simplicity. The cap still provides a minimum of $10,000.
 */
export function getSALTCap(year: number, filingStatus: FilingStatus): number {
    const isMFS = filingStatus === 'Married Filing Separately';

    // Pre-TCJA: No cap
    if (year < TCJA_SALT_START_YEAR) {
        return Infinity;
    }

    // TCJA cap period (2018-2024)
    if (year >= TCJA_SALT_START_YEAR && year <= TCJA_SALT_END_YEAR) {
        return isMFS ? SALT_CAP_TCJA_MFS : SALT_CAP_TCJA_JOINT;
    }

    // OBBBA raised cap period (2025-2029) with 1% annual increase starting 2026
    if (year >= OBBBA_SALT_START_YEAR && year <= OBBBA_SALT_END_YEAR) {
        const yearsOfIncrease = Math.max(0, year - OBBBA_SALT_START_YEAR);
        const inflationFactor = Math.pow(1 + SALT_CAP_ANNUAL_INCREASE, yearsOfIncrease);
        const baseCap = isMFS ? SALT_CAP_OBBBA_MFS : SALT_CAP_OBBBA_JOINT;
        return Math.round(baseCap * inflationFactor);
    }

    // 2030+: Reverts to original TCJA cap
    return isMFS ? SALT_CAP_TCJA_MFS : SALT_CAP_TCJA_JOINT;
}

export function getTaxParameters(
    year: number,
    filingStatus: FilingStatus,
    authority: "federal" | "state",
    stateResidency?: string,
    assumptions: AssumptionsState = {
        ...defaultAssumptions,
        macro: { ...defaultAssumptions.macro, inflationAdjusted: false },
    }
): TaxParameters | undefined {
    const inflation = assumptions.macro.inflationRate / 100;
    const inflationAdjusted = assumptions.macro.inflationAdjusted;

    let sourceData: AuthorityData;
    if (authority === "federal") {
        sourceData = TAX_DATABASE.federal;
    } else if (stateResidency && TAX_DATABASE.states[stateResidency]) {
        sourceData = TAX_DATABASE.states[stateResidency];
    } else {
        return undefined;
    }

    const closestYear = getClosestTaxYear(year);

    if (inflationAdjusted && year > max_year) {
        const baseYearParams = sourceData[max_year][filingStatus];
        if (!baseYearParams) return undefined;

        const yearsToCompound = year - max_year;
        const inflationMultiplier = Math.pow(1 + inflation, yearsToCompound);

        const inflatedBrackets = baseYearParams.brackets.map((bracket) => ({
            ...bracket,
            threshold: Math.round(bracket.threshold * inflationMultiplier),
        }));

        return {
            ...baseYearParams,
            standardDeduction: Math.round(
                baseYearParams.standardDeduction * inflationMultiplier
            ),
            socialSecurityWageBase: Math.round(
                baseYearParams.socialSecurityWageBase * inflationMultiplier
            ),
            brackets: inflatedBrackets,
            capitalGainsBrackets: baseYearParams.capitalGainsBrackets?.map((bracket) => ({
                ...bracket,
                threshold: Math.round(bracket.threshold * inflationMultiplier),
            })),
        };
    }

    return sourceData[closestYear]?.[filingStatus];
}
