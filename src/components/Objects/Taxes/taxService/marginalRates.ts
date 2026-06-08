import { TaxParameters } from "../../../../data/TaxData";
import { TaxState } from "../TaxContext";
import { AssumptionsState } from "../../Assumptions/AssumptionsContext";
import { getTaxParameters } from "./parameters";

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
 * @returns Combined marginal rate breakdown
 */
export function getCombinedMarginalRate(
    grossIncome: number,
    preTaxDeductions: number,
    taxState: TaxState,
    year: number,
    assumptions: AssumptionsState,
    includesFICA: boolean = true,
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
    const fedStdDed = fedParams?.standardDeduction || 14600;
    const stateStdDed = stateParams?.standardDeduction || 0;

    const fedTaxableIncome = Math.max(0, adjustedGross - fedStdDed);
    const stateTaxableIncome = Math.max(0, adjustedGross - stateStdDed);

    const fedMarginal = fedParams ? getMarginalTaxRate(fedTaxableIncome, fedParams) : { rate: 0, headroom: Infinity };
    const stateMarginal = stateParams ? getMarginalTaxRate(stateTaxableIncome, stateParams) : { rate: 0, headroom: Infinity };

    // FICA: 6.2% SS (up to wage base) + 1.45% Medicare
    let ficaRate = 0;
    if (includesFICA && fedParams) {
        const ssWageBase = fedParams.socialSecurityWageBase || 168600;
        if (grossIncome < ssWageBase) {
            ficaRate = fedParams.socialSecurityTaxRate + fedParams.medicareTaxRate;
        } else {
            ficaRate = fedParams.medicareTaxRate;
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
