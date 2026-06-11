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

/**
 * Find the year key in `sourceData` closest to `target`. On an exact tie
 * (target equidistant between two years) the newer year wins (`<=`), since
 * more recent tax law is the better approximation. Returns undefined when the
 * table has no numeric year keys.
 */
function findNearestYear(
    sourceData: AuthorityData,
    target: number
): number | undefined {
    const availableYears = Object.keys(sourceData)
        .map(Number)
        .filter((y) => !Number.isNaN(y));
    if (availableYears.length === 0) return undefined;
    return availableYears.reduce((best, y) =>
        Math.abs(y - target) <= Math.abs(best - target) ? y : best
    );
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
    let inflation = assumptions.macro.inflationRate / 100;
    // The default-param above only fills in when the WHOLE assumptions arg is
    // undefined; a partial object missing inflationRate yields NaN, which would
    // poison every inflated value. Treat a non-finite rate as 0%.
    if (!Number.isFinite(inflation)) inflation = 0;
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
        // A state's table may not include the federal max_year row. Resolve the
        // nearest year actually present and inflate from there (same nearest-year
        // logic used by the non-inflation path below) instead of throwing.
        let baseYear = max_year;
        if (!sourceData[max_year]) {
            const nearest = findNearestYear(sourceData, max_year);
            if (nearest === undefined) return undefined;
            baseYear = nearest;
        }

        const baseYearParams = sourceData[baseYear][filingStatus];
        if (!baseYearParams) return undefined;

        const yearsToCompound = year - baseYear;
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
            // Dollar-amount fields spread in via ...baseYearParams stay nominal
            // unless re-inflated here. seniorAge / *Rate fields are NOT dollars,
            // so they are intentionally left untouched.
            ...(baseYearParams.seniorDeduction !== undefined && {
                seniorDeduction: Math.round(
                    baseYearParams.seniorDeduction * inflationMultiplier
                ),
            }),
            ...(baseYearParams.ssExemptionThreshold !== undefined && {
                ssExemptionThreshold: Math.round(
                    baseYearParams.ssExemptionThreshold * inflationMultiplier
                ),
            }),
            ...(baseYearParams.retirementIncomeExemption !== undefined && {
                retirementIncomeExemption: {
                    ...baseYearParams.retirementIncomeExemption,
                    amount: Math.round(
                        baseYearParams.retirementIncomeExemption.amount *
                            inflationMultiplier
                    ),
                },
            }),
        };
    }

    if (sourceData[closestYear]) {
        return sourceData[closestYear][filingStatus];
    }

    // State tables may not cover every federal year (e.g. California has no 2024
    // entry), so getClosestTaxYear — which only knows federal years — can resolve
    // to a year missing from this authority's table. Fall back to the nearest year
    // actually present so the gap doesn't return undefined → $0 tax.
    const nearestYear = findNearestYear(sourceData, year);
    if (nearestYear === undefined) return undefined;
    return sourceData[nearestYear]?.[filingStatus];
}
