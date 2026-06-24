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

/**
 * FICA-taxable wage base: earned wages net of FICA exemptions, floored at 0.
 * The single source of truth for what FICA (SS + Medicare + 0.9% surtax) is
 * charged on. Shared with the marginal-rate / surtax readout in
 * TaxOptimizationService so the Testing-tab numbers cannot drift from the FICA
 * the engine actually charges. If a new exempt income type is added, change it
 * here and every consumer follows.
 */
export function getFicaTaxableBase(incomes: AnyIncome[], year: number): number {
    return Math.max(0, getEarnedIncome(incomes, year) - getFicaExemptions(incomes, year));
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

    const fedParams = getTaxParameters(year, state.filingStatus, "federal", undefined, assumptions);

    if (!fedParams) return 0;

    const taxableBase = getFicaTaxableBase(incomes, year);
    const ssTax =
        Math.min(taxableBase, fedParams.socialSecurityWageBase) *
        fedParams.socialSecurityTaxRate;
    const medicareTax = taxableBase * fedParams.medicareTaxRate;

    const additionalMedicareThreshold = getAdditionalMedicareThreshold(state.filingStatus);
    const additionalMedicareTax = Math.max(0, taxableBase - additionalMedicareThreshold) * 0.009;

    return ssTax + medicareTax + additionalMedicareTax;
}
