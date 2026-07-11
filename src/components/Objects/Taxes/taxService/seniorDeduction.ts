/**
 * Shared senior (65+) additional-deduction helpers.
 *
 * The REGULAR 65+ additional standard deduction (IRC §63(f)) is identical on the
 * federal and state paths: a per-person base (`seniorDeduction`) that doubles for
 * MFJ when `seniorDeductionPerPerson` is set, applied when the filer is at/above
 * the senior age (`seniorAge`, default 65). Both federalTax.ts and stateTax.ts
 * previously implemented this independently; they now share this single
 * definition so the eligibility rule and the MFJ doubling can't drift.
 *
 * The federal OBBBA "senior bonus" split (regular vs bonus, standard-vs-itemized
 * bases, MAGI phaseout) is NOT here — it lives in federalTax.ts because it is a
 * federal-only departure from the uniform state add-on.
 */
import { type FilingStatus, type TaxParameters } from "../../../../data/TaxData";

/**
 * 65+ senior-deduction eligibility: a defined age at or above the senior-age
 * threshold (default 65). Single source of the eligibility rule for both the
 * federal MAGI-proxy gate / getFederalSeniorDeduction early-out and the shared
 * regular-deduction helper below, so the two can't drift.
 */
export function isSeniorEligible(params: TaxParameters, age: number | undefined): boolean {
    return age !== undefined && age >= (params.seniorAge ?? 65);
}

/**
 * The REGULAR 65+ additional standard deduction (per-person base, doubled for MFJ
 * when `seniorDeductionPerPerson` is set). Returns 0 when the filer is not
 * senior-eligible or the parameters carry no senior deduction.
 *
 * This is the federal "regular" component AND the entire state senior add-on —
 * the one piece both paths share. Federal bonus logic stays in federalTax.ts.
 *
 * When the parameters carry an income-based phaseout
 * (`seniorDeductionPhaseoutThreshold` + `seniorDeductionPhaseoutRate`, e.g.
 * Virginia's age deduction: reduced $1-for-$1 by AFAGI above $50k single /
 * $75k married) AND the caller supplies `incomeForPhaseout`, the TOTAL
 * (per-person-multiplied) deduction is reduced by rate × (income − threshold),
 * floored at $0. Callers that pass no income (the federal regular add-on —
 * federal rows carry no phaseout fields) are byte-for-byte unchanged.
 *
 * @param params - Tax parameters carrying the senior fields
 * @param filingStatus - Filing status (drives the MFJ per-person doubling)
 * @param age - Taxpayer age in the tax year (undefined ⇒ 0)
 * @param incomeForPhaseout - AFAGI-style income for the phaseout (undefined ⇒ no phaseout)
 */
export function seniorAdditionalDeduction(
    params: TaxParameters,
    filingStatus: FilingStatus,
    age: number | undefined,
    incomeForPhaseout?: number,
): number {
    if (!isSeniorEligible(params, age)) return 0;

    let deduction = (params.seniorDeduction ?? 0) * seniorPerPersonMultiplier(params, filingStatus);

    const threshold = params.seniorDeductionPhaseoutThreshold;
    const rate = params.seniorDeductionPhaseoutRate;
    if (
        threshold !== undefined &&
        rate !== undefined &&
        incomeForPhaseout !== undefined &&
        incomeForPhaseout > threshold
    ) {
        deduction = Math.max(0, deduction - (incomeForPhaseout - threshold) * rate);
    }

    return deduction;
}

/**
 * Per-person multiplier for senior add-ons: 2 for an MFJ filer when the parameters
 * mark the deduction per-person (`seniorDeductionPerPerson`), else 1. The single-age
 * model assumes both spouses meet the threshold. Shared by the regular state/federal
 * add-on (above) AND the federal OBBBA-bonus path in federalTax.ts so the doubling
 * rule lives in one place and can't disagree.
 */
export function seniorPerPersonMultiplier(
    params: TaxParameters,
    filingStatus: FilingStatus,
): number {
    const isMFJ = filingStatus === 'Married Filing Jointly';
    return params.seniorDeductionPerPerson && isMFJ ? 2 : 1;
}
