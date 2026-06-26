import { TaxParameters } from "../../../../data/TaxData";
import { TaxState } from "../TaxContext";
import { AssumptionsState } from "../../Assumptions/AssumptionsContext";
import { getTaxParameters } from "./parameters";
import { getAdditionalMedicareThreshold } from "./ficaTax";

/** Result of marginal tax rate calculation */
export interface MarginalRateResult {
    rate: number;           // Decimal rate (e.g., 0.22 for 22%)
    bracketStart: number;   // Taxable income where this bracket starts
    bracketEnd: number;     // Taxable income where this bracket ends (Infinity for top)
    headroom: number;       // $ remaining until next bracket
}

/**
 * Get the marginal tax rate for a given taxable income.
 *
 * @param taxableIncome - Income after deductions (not gross income)
 * @param params - Tax parameters containing brackets
 * @returns Marginal rate info including headroom to next bracket
 */
export function getMarginalTaxRate(
    taxableIncome: number,
    params: TaxParameters,
): MarginalRateResult {
    // Defensive guard: an authority with no brackets (e.g. a sparsely-populated
    // future-year fallback) would otherwise dereference `undefined`. Treat the
    // absence of any bracket as a flat 0% rate with unbounded headroom.
    if (params.brackets.length === 0) {
        return { rate: 0, bracketStart: 0, bracketEnd: Infinity, headroom: Infinity };
    }

    if (taxableIncome <= 0) {
        const first = params.brackets[0];
        const second = params.brackets[1];
        return {
            rate: first.rate,
            bracketStart: first.threshold,
            bracketEnd: second ? second.threshold : Infinity,
            headroom: second ? second.threshold : Infinity,
        };
    }

    for (let i = 0; i < params.brackets.length; i++) {
        const current = params.brackets[i];
        const next = params.brackets[i + 1];
        const upperLimit = next ? next.threshold : Infinity;

        if (taxableIncome >= current.threshold && taxableIncome < upperLimit) {
            return {
                rate: current.rate,
                bracketStart: current.threshold,
                bracketEnd: upperLimit,
                headroom: upperLimit === Infinity ? Infinity : upperLimit - taxableIncome,
            };
        }
    }

    const top = params.brackets[params.brackets.length - 1];
    return {
        rate: top.rate,
        bracketStart: top.threshold,
        bracketEnd: Infinity,
        headroom: Infinity,
    };
}

/**
 * Get combined marginal tax rate (federal + state + FICA if applicable).
 *
 * @param grossIncome - Gross income before deductions
 * @param preTaxDeductions - 401k, HSA, etc.
 * @param taxState - Tax configuration
 * @param year - Tax year
 * @param assumptions - Assumptions for inflation adjustment
 * @param includesFICA - Whether to include FICA taxes (true for earned income)
 * @param earnedIncome - FICA-eligible earned income, net of FICA exemptions, used for the
 *   Social-Security wage-base test. Defaults to grossIncome (correct when all income is
 *   earned wages). Pass the earned base explicitly when grossIncome also carries non-earned
 *   income (SS, pension, passive) — otherwise that non-earned income inflates the wage-base
 *   comparison and wrongly drops the 6.2% SS rate for a still-working person below the base.
 * @returns Combined marginal rate breakdown
 */
export function getCombinedMarginalRate(
    grossIncome: number,
    preTaxDeductions: number,
    taxState: TaxState,
    year: number,
    assumptions: AssumptionsState,
    includesFICA: boolean = true,
    earnedIncome: number = grossIncome,
    // SS-covered earned income = earnedIncome minus any CSRS wages (CSRS workers
    // are outside Social Security). Only the 6.2% SS component keys off this.
    // Defaults to earnedIncome so non-CSRS callers are byte-identical (#139).
    ssCoveredEarnedIncome: number = earnedIncome,
): {
    federal: number;
    state: number;
    fica: number;
    combined: number;
    federalHeadroom: number;
} {
    const fedParams = getTaxParameters(year, taxState.filingStatus, 'federal', undefined, assumptions);
    const stateParams = getTaxParameters(year, taxState.filingStatus, 'state', taxState.stateResidency, assumptions);

    const adjustedGross = Math.max(0, grossIncome - preTaxDeductions);
    const fedStdDed = fedParams?.standardDeduction ?? 14600;
    const stateStdDed = stateParams?.standardDeduction ?? 0;

    const fedTaxableIncome = Math.max(0, adjustedGross - fedStdDed);
    const stateTaxableIncome = Math.max(0, adjustedGross - stateStdDed);

    const fedMarginal = fedParams ? getMarginalTaxRate(fedTaxableIncome, fedParams) : { rate: 0, headroom: Infinity };
    const stateMarginal = stateParams ? getMarginalTaxRate(stateTaxableIncome, stateParams) : { rate: 0, headroom: Infinity };

    // FICA: 6.2% SS (up to wage base) + 1.45% Medicare + 0.9% Additional
    // Medicare surtax above the filing-status threshold. Above the SS wage
    // base the 6.2% has already dropped off, so a high earner ends at
    // 0.0145 + 0.009 = 0.0235.
    let ficaRate = 0;
    if (includesFICA && fedParams) {
        const ssWageBase = fedParams.socialSecurityWageBase ?? 168600;
        // The 6.2% SS portion applies only to SS-COVERED earned income below the
        // wage base — mirroring calculateFicaTax, which tests its SS-covered base,
        // not total gross. ssCoveredEarnedIncome excludes CSRS wages (#139), so for
        // a CSRS-only earner it is 0 and the next wage dollar carries Medicare but
        // no SS (the > 0 guard) — the engine charges $0 SS there. Comparing full
        // grossIncome would also wrongly keep SS for a non-working person whose
        // SS/pension/passive income pushes gross past the base while wages are below.
        if (ssCoveredEarnedIncome > 0 && ssCoveredEarnedIncome < ssWageBase) {
            ficaRate = fedParams.socialSecurityTaxRate + fedParams.medicareTaxRate;
        } else {
            ficaRate = fedParams.medicareTaxRate;
        }
        // Mirror calculateFicaTax: the 0.9% surtax applies above a
        // filing-status threshold (shared helper keeps the two in sync).
        // Like the SS check above, this tests EARNED income — calculateFicaTax
        // applies the surtax to its taxableBase (earned, net of FICA exemptions),
        // not total gross. Comparing full grossIncome here would wrongly add the
        // surtax for someone whose non-earned income pushes gross past the
        // threshold while wages stay below it.
        const additionalMedicareThreshold = getAdditionalMedicareThreshold(taxState.filingStatus);
        if (earnedIncome >= additionalMedicareThreshold) {
            ficaRate += 0.009;
        }
    }

    return {
        federal: fedMarginal.rate,
        state: stateMarginal.rate,
        fica: ficaRate,
        combined: fedMarginal.rate + stateMarginal.rate + ficaRate,
        federalHeadroom: fedMarginal.headroom,
    };
}
