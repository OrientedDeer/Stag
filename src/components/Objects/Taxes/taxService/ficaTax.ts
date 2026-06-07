import { AnyIncome } from "../../Income/models";
import { TaxState } from "../TaxContext";
import { AssumptionsState } from "../../Assumptions/AssumptionsContext";
import { getTaxParameters } from "./parameters";
import { getEarnedIncome, getFicaExemptions } from "./incomeAggregation";

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

    return ssTax + medicareTax;
}
