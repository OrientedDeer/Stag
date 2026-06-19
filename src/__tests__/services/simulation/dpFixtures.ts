/**
 * Shared synthetic-context fixtures for the RothConversionDP test suites.
 *
 * `DPYearContext` is a wide struct (~14 required fields). Two test files build
 * synthetic horizons from it — `RothConversionDP.test.ts` (MFJ, 2024 params,
 * tax-only profile) and `RothConversionPolicy.test.ts` (single, 2025 params,
 * spending+brokerage profile). They used to each re-declare the full field list,
 * so a shape change had to be mirrored in two places. This module owns the field
 * list in ONE place; each caller passes only the fields its profile overrides.
 *
 * `makeDPContext` fills every required field with a neutral default and spreads
 * `overrides` last, so a profile that needs MFJ/2024/spending just overrides
 * those keys. The optional fields (acaOptions, irmaaSurchargeForMAGI, baseline
 * diagnostics) are omitted unless an override supplies them.
 */
import { DPYearContext } from '../../../services/simulation/RothConversionDP';
import * as TaxService from '../../../components/Objects/Taxes/TaxService';

/**
 * Default federal params used when an override doesn't supply `fedParams`.
 * Single / 2025 — the Policy-suite profile; the DP suite overrides with its
 * MFJ / 2024 params.
 */
export const DEFAULT_FED_PARAMS = TaxService.getTaxParameters(2025, 'Single', 'federal')!;

/**
 * Build a synthetic `DPYearContext`. `year`/`age` are required (every horizon
 * year needs them); everything else defaults to a neutral low-income retiree
 * cell and is overridable. The defaults mirror the Policy-suite profile (single,
 * no fixed ordinary income, pre-RMD); callers wanting the DP-suite profile pass
 * `filingStatus`/`fedParams`/income/etc. as overrides.
 */
export function makeDPContext(
    year: number,
    age: number,
    overrides: Partial<DPYearContext> = {},
): DPYearContext {
    return {
        year,
        age,
        nonSSOrdinaryIncomeExclRMD: 0,
        ssBenefits: 0,
        ltcgIncome: 0,
        filingStatus: 'Single',
        fedParams: DEFAULT_FED_PARAMS,
        stateParams: null,
        baselineTradWithdrawal: 0,
        spendingNeed: 0,
        baselineBrokerageAvailable: 0,
        rothGrowthRate: 0.05,
        growthRate: 0.05,
        rmdDivisor: 0,
        ...overrides,
    };
}
