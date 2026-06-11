import { AnyIncome } from "../../Income/models";
import { TaxState } from "../TaxContext";
import { AssumptionsState } from "../../Assumptions/AssumptionsContext";
import { getTaxParameters } from "./parameters";
import { getEarnedIncome, getFicaExemptions } from "./incomeAggregation";

/**
 * Income threshold above which the 0.9% Additional Medicare surtax applies,
 * by filing status. Shared with the marginal-rate calculation so the two
 * cannot drift apart.
 */
export function getAdditionalMedicareThreshold(filingStatus: TaxState['filingStatus']): number {
    return filingStatus === 'Married Filing Jointly' ? 250000 :
        filingStatus === 'Married Filing Separately' ? 125000 : 200000;
}

export function calculateFicaTax(
    state: TaxState,
    incomes: AnyIncome[],
    year: number,
    assumptions?: AssumptionsState,
): number {
    if (state.ficaOverride !== null) {
        return state.ficaOverride;
    }

    const earnedGross = getEarnedIncome(incomes, year);
    const ficaExemptions = getFicaExemptions(incomes, year);
    const fedParams = getTaxParameters(year, state.filingStatus, "federal", undefined, assumptions);

    if (!fedParams) return 0;

    const taxableBase = Math.max(0, earnedGross - ficaExemptions);
    const ssTax =
        Math.min(taxableBase, fedParams.socialSecurityWageBase) *
        fedParams.socialSecurityTaxRate;
    const medicareTax = taxableBase * fedParams.medicareTaxRate;

    const additionalMedicareThreshold = getAdditionalMedicareThreshold(state.filingStatus);
    const additionalMedicareTax = Math.max(0, taxableBase - additionalMedicareThreshold) * 0.009;

    return ssTax + medicareTax + additionalMedicareTax;
}
