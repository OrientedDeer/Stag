/**
 * #186 regressions for RothConversionDP context building and per-cell tax.
 *
 * Two independent bugs from the 2026-07-06 deep review:
 *
 *  1. Gap-year contexts used GROSS work income (pre-tax 401k/insurance/HSA
 *     deferrals NOT netted). A partial-work pre-retirement year with large
 *     deferrals (real taxable income well under the standard deduction) looked
 *     like it had NO standard-deduction headroom, so the gap-year gate silently
 *     dropped the context — no DP entry, no engine-direct candidates, the
 *     std-deduction conversion window lost. The engine (YearSolver) taxes
 *     grossIncome − getPreTaxExemptions, so the DP must net the same amount.
 *
 *  2. The per-cell state-tax branch mirrored calculateUnifiedStateTax (adds the
 *     IRS-taxable portion of SS to the state base for socialSecurityTreatment
 *     === 'taxable'). The engine's retirement solve (YearSolver) never calls
 *     that — it ALWAYS excludes taxable SS from the state base. The DP must
 *     match the engine so it doesn't price a state-SS cost the engine never bills.
 */
import { describe, it, expect } from 'vitest';
import {
    buildDPYearContexts,
    computeYearTax,
    DPYearContext,
} from '../../../services/simulation/RothConversionDP';
import { makeDPContext } from './dpFixtures';
import {
    AssumptionsState,
    defaultAssumptions,
    createBuiltinMilestones,
} from '../../../components/Objects/Assumptions/AssumptionsContext';
import { TaxState } from '../../../components/Objects/Taxes/TaxContext';
import { InvestedAccount } from '../../../components/Objects/Accounts/models';
import { WorkIncome } from '../../../components/Objects/Income/models';
import { SimulationYear } from '../../../services/simulation/types';
import * as TaxService from '../../../components/Objects/Taxes/TaxService';

const START_YEAR = new Date().getFullYear();
const BIRTH_YEAR = START_YEAR - 59;   // user is ~59 today
const RETIREMENT_AGE = 62;
const RETIREMENT_YEAR = BIRTH_YEAR + RETIREMENT_AGE; // START_YEAR + 3

// Partial-work gap year: $30k gross, $22k pre-tax deferrals ⇒ $8k real taxable.
const GAP_GROSS = 30_000;
const GAP_PRETAX_401K = 22_000;
const GAP_TAXABLE = GAP_GROSS - GAP_PRETAX_401K; // 8_000

const assumptions: AssumptionsState = {
    ...defaultAssumptions,
    demographics: {},
    milestones: createBuiltinMilestones(BIRTH_YEAR, RETIREMENT_AGE, 95),
    macro: {
        ...defaultAssumptions.macro,
        inflationRate: 0,
        inflationAdjusted: false,
        taxBracketShiftPct: 0,
        taxBracketShiftStartYear: 0,
    },
    investments: { ...defaultAssumptions.investments, returnRates: { ror: 0 } },
};

const baseTaxState = (overrides: Partial<TaxState> = {}): TaxState => ({
    filingStatus: 'Single',
    stateResidency: 'Texas', // no state tax → isolates the federal headroom gate
    deductionMethod: 'Standard',
    fedOverride: null,
    ficaOverride: null,
    stateOverride: null,
    year: START_YEAR,
    ...overrides,
});

/**
 * Baseline spanning ages 59..66. The age-60 gap year (START_YEAR + 1, which is
 * NOT baseline[0]) carries a partial-work WorkIncome with heavy pre-tax
 * deferrals. `withDeferrals=false` puts the same job in with NO deferrals so we
 * can show the un-netted gross would blow past the standard deduction.
 */
function buildGapBaseline(withDeferrals: boolean): SimulationYear[] {
    const years: SimulationYear[] = [];
    for (let i = 0; i < 8; i++) {
        const year = START_YEAR + i;
        const age = year - BIRTH_YEAR;
        const trad = new InvestedAccount(
            'trad', 'Traditional IRA', 1_000_000, 0, 10, 0.0, 'Traditional IRA', true, 0.2, 1_000_000,
        );
        // Only the age-60 gap year holds the job.
        const incomes = age === 60
            ? [new WorkIncome(
                'w', 'Part-time job', GAP_GROSS, 'Annually', 'Yes',
                withDeferrals ? GAP_PRETAX_401K : 0, // preTax401k
                0, 0, 0, '', // insurance, roth401k, employerMatch, matchAccountId
              )]
            : [];
        years.push({
            year,
            incomes,
            expenses: [],
            accounts: [trad],
            cashflow: {
                totalIncome: 0, totalExpense: 40_000, livingExpenses: 40_000, discretionary: 0,
                investedUser: 0, investedMatch: 0, totalInvested: 0, bucketAllocations: 0,
                bucketDetail: {}, withdrawals: 0, withdrawalDetail: {},
            },
            taxDetails: {
                fed: 0, state: 0, fica: 0, preTax: 0, insurance: 0, postTax: 0,
                capitalGains: 0, withdrawalOrdinaryTax: 0, niit: 0,
            },
            logs: [],
        });
    }
    return years;
}

describe('#186 gap-year contexts net pre-tax deferrals', () => {
    const GAP_YEAR = BIRTH_YEAR + 60; // age-60 gap year

    it('the standard deduction sits between the taxable and gross figures (fixture sanity)', () => {
        const fedParams = TaxService.getTaxParameters(GAP_YEAR, 'Single', 'federal', undefined, assumptions)!;
        // The bug only manifests when the deferrals straddle the standard
        // deduction: net taxable is UNDER it (real headroom) but gross is OVER it.
        expect(GAP_TAXABLE).toBeLessThan(fedParams.standardDeduction);
        expect(GAP_GROSS).toBeGreaterThan(fedParams.standardDeduction);
    });

    it('builds a context for a heavily-deferred gap year and nets the deferrals', () => {
        const contexts = buildDPYearContexts(
            buildGapBaseline(true), assumptions, baseTaxState(), RETIREMENT_YEAR, 0,
        );
        // Pre-fix: gross ($30k) > standard deduction ⇒ negative headroom ⇒ the
        // gap gate skipped this year and NO context existed here.
        const gap = contexts.find(c => c.year === GAP_YEAR);
        expect(gap).toBeDefined();
        // The context's ordinary base must be the REAL taxable income ($8k),
        // not the gross ($30k).
        expect(gap!.nonSSOrdinaryIncomeExclRMD).toBeCloseTo(GAP_TAXABLE, 6);
    });

    it('without deferrals the same gross correctly produces no gap context', () => {
        // Control: identical job, zero deferrals ⇒ full $30k taxable ⇒ over the
        // standard deduction ⇒ no headroom ⇒ no context. Proves the context in
        // the test above comes from the netting, not from the year being present.
        const contexts = buildDPYearContexts(
            buildGapBaseline(false), assumptions, baseTaxState(), RETIREMENT_YEAR, 0,
        );
        expect(contexts.find(c => c.year === GAP_YEAR)).toBeUndefined();
    });
});

describe('#186 per-cell state tax always excludes SS (matches the engine)', () => {
    const YEAR = 2030;
    const AGE = 70;
    const ORDINARY = 80_000; // non-SS ordinary (already SS- and deferral-netted upstream)
    const SS = 40_000;

    // California params with SS treatment forced to 'taxable' — the case the old
    // branch handled and the engine never does. (Shipped data has every state
    // 'exempt'; this exercises the pre-diverged path.)
    const stateParams = {
        ...TaxService.getTaxParameters(YEAR, 'Single', 'state', 'California')!,
        socialSecurityTreatment: 'taxable' as const,
    };

    function ctx(): DPYearContext {
        return makeDPContext(YEAR, AGE, {
            nonSSOrdinaryIncomeExclRMD: ORDINARY,
            ssBenefits: SS,
            ltcgIncome: 0,
            filingStatus: 'Single',
            stateParams,
        });
    }

    it('the state base is non-SS ordinary + LTCG only, never inflated by taxable SS', () => {
        const c = ctx();
        const total = computeYearTax(ORDINARY, c);

        // Isolate the state portion: computeYearTax = federal + state (no ACA/IRMAA here).
        const fed = TaxService.calculateTotalFederalTax(
            ORDINARY, SS, 0, 0, 0, 'Single', c.fedParams,
        ).totalTax;
        const statePortion = total - fed;

        const expectedStateSSExcluded = TaxService.calculateTax(ORDINARY, 0, stateParams);

        // Sanity: the old (buggy) base would have added taxable SS and cost MORE.
        const taxableSS = TaxService.getTaxableSocialSecurityBenefits(SS, ORDINARY, 0, 'Single');
        expect(taxableSS).toBeGreaterThan(0);
        const buggyStateSSIncluded = TaxService.calculateTax(ORDINARY + taxableSS, 0, stateParams);
        expect(buggyStateSSIncluded).toBeGreaterThan(expectedStateSSExcluded);

        // The DP must price the SS-EXCLUDED base (what the engine bills).
        expect(statePortion).toBeCloseTo(expectedStateSSExcluded, 4);
        expect(statePortion).not.toBeCloseTo(buggyStateSSIncluded, 0);
    });
});
