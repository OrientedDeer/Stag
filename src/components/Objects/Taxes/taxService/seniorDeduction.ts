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
import { FilingStatus, TaxParameters } from "../../../../data/TaxData";

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
 * @param params - Tax parameters carrying the senior fields
 * @param filingStatus - Filing status (drives the MFJ per-person doubling)
 * @param age - Taxpayer age in the tax year (undefined ⇒ 0)
 */
export function seniorAdditionalDeduction(
    params: TaxParameters,
    filingStatus: FilingStatus,
    age: number | undefined,
): number {
    if (!isSeniorEligible(params, age)) return 0;

    const isMFJ = filingStatus === 'Married Filing Jointly';
    const perPersonMultiplier = params.seniorDeductionPerPerson && isMFJ ? 2 : 1;

    return (params.seniorDeduction ?? 0) * perPersonMultiplier;
}
