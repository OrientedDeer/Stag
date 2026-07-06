/**
 * #191 — Projected years must get the federal 65+ senior deductions.
 *
 * Before the fix, the senior add-ons (permanent 65+ additional standard
 * deduction + OBBBA senior bonus) existed ONLY in the year-0 Taxes-tab
 * orchestrator (calculateFederalTaxFromIncomes). The simulation engine
 * (YearSolver) and the Roth DP (buildDPYearContexts → computeYearTax) called
 * calculateTotalFederalTax with the RAW standardDeduction, so a 66-year-old
 * saw the senior deduction on the Taxes tab but in NO projected year — an
 * asymmetry that overstated projected taxes and biased Roth conversion
 * headroom.
 *
 * The fix exposes getEffectiveStandardDeduction (federalTax.ts) and folds it
 * into the fedParams both YearSolver and buildDPYearContexts use.
 */
import { describe, it, expect } from 'vitest';

import * as TaxService from '../../../components/Objects/Taxes/TaxService';
import { getEffectiveStandardDeduction } from '../../../components/Objects/Taxes/taxService/federalTax';
import { solveRetirementYear, YearSolverInput } from '../../../services/simulation/YearSolver';
import { buildDPYearContexts } from '../../../services/simulation/RothConversionDP';
import { InvestedAccount, SavedAccount } from '../../../components/Objects/Accounts/models';
import { PassiveIncome } from '../../../components/Objects/Income/models';
import { OtherExpense } from '../../../components/Objects/Expense/models';
import {
    AssumptionsState,
    defaultAssumptions,
    createBuiltinMilestones,
} from '../../../components/Objects/Assumptions/AssumptionsContext';
import { TaxState } from '../../../components/Objects/Taxes/TaxContext';
import { SimulationYear } from '../../../services/simulation/types';

// =============================================================================
// getEffectiveStandardDeduction — unit
// =============================================================================

const YEAR = 2025;

function fedParamsFor(filing: TaxState['filingStatus'], assumptions?: AssumptionsState) {
    const p = TaxService.getTaxParameters(YEAR, filing, 'federal', undefined, assumptions);
    if (!p) throw new Error('no federal params');
    return p;
}

describe('getEffectiveStandardDeduction (#191 unit)', () => {
    it('returns the raw standard deduction for a working-age filer', () => {
        const p = fedParamsFor('Single');
        expect(getEffectiveStandardDeduction(p, 'Single', 40, YEAR, 50_000))
            .toBe(p.standardDeduction);
    });

    it('returns the raw standard deduction when age is undefined', () => {
        const p = fedParamsFor('Single');
        expect(getEffectiveStandardDeduction(p, 'Single', undefined, YEAR, 50_000))
            .toBe(p.standardDeduction);
    });

    it('adds regular 65+ deduction + full OBBBA bonus for a low-MAGI single senior (2025)', () => {
        const p = fedParamsFor('Single');
        // 2025 Single: $15,750 std + $2,000 regular + $6,000 bonus (MAGI < $75k)
        expect(getEffectiveStandardDeduction(p, 'Single', 66, YEAR, 40_000))
            .toBe(p.standardDeduction + 2000 + 6000);
    });

    it('doubles per-person amounts for MFJ (2025)', () => {
        const p = fedParamsFor('Married Filing Jointly');
        // 2025 MFJ: $31,500 std + 2×$1,600 regular + 2×$6,000 bonus (MAGI < $150k)
        expect(getEffectiveStandardDeduction(p, 'Married Filing Jointly', 66, YEAR, 100_000))
            .toBe(p.standardDeduction + 3200 + 12000);
    });

    it('phases out the OBBBA bonus on MAGI but keeps the regular add-on', () => {
        const p = fedParamsFor('Single');
        // MAGI $175k: bonus 6000 − (175000−75000)×0.06 = 0 → regular only.
        expect(getEffectiveStandardDeduction(p, 'Single', 66, YEAR, 175_000))
            .toBe(p.standardDeduction + 2000);
    });

    it('drops the OBBBA bonus after its 2028 sunset but keeps the regular add-on', () => {
        const p = TaxService.getTaxParameters(2030, 'Single', 'federal');
        if (!p) throw new Error('no federal params');
        // 2030 resolves from the 2026 row (nominal): $2,050 regular, no bonus.
        expect(getEffectiveStandardDeduction(p, 'Single', 70, 2030, 40_000))
            .toBe(p.standardDeduction + 2050);
    });
});

// =============================================================================
// solveRetirementYear — the engine bills the senior deduction (#191)
// =============================================================================

const BIRTH_YEAR = YEAR - 66; // age 66 in the scenario year
const PENSION = 60_000;

function buildSolverInput(): YearSolverInput {
    const assumptions: AssumptionsState = {
        ...defaultAssumptions,
        milestones: createBuiltinMilestones(BIRTH_YEAR, 65, 95),
        investments: {
            ...defaultAssumptions.investments,
            taxOptimizationEnabled: false,
            returnRates: { ror: 5 },
        },
        withdrawalStrategy: [
            { id: 'ws-1', name: 'Savings', accountId: 'savings-1' },
        ],
    };
    const taxState: TaxState = {
        filingStatus: 'Single',
        stateResidency: 'Texas', // no state tax — isolate the federal effect
        deductionMethod: 'Standard',
        fedOverride: null,
        ficaOverride: null,
        stateOverride: null,
        year: YEAR,
    };
    const pension = new PassiveIncome(
        'pension-1', 'Pension', PENSION, 'Annually', 'No', 'Other',
        new Date(2018, 0, 1), undefined, false,
    );
    const living = new OtherExpense(
        'living-1', 'Living Expenses', 30_000, 'Annually', new Date(2020, 0, 1),
    );
    const savings = new SavedAccount('savings-1', 'Savings', 100_000, 2.0);

    return {
        year: YEAR,
        currentAge: 66,
        isRetired: true,
        incomes: [pension],
        expenses: [living],
        totalLivingExpenses: 30_000,
        rmdAmount: 0,
        accounts: [savings],
        withdrawalOrder: [{ accountId: 'savings-1' }],
        taxState,
        assumptions,
        taxOptimizationEnabled: false,
        acaAware: false,
    };
}

describe('solveRetirementYear senior deduction (#191)', () => {
    it('taxes a 66-year-old single retiree with the effective (senior) standard deduction', () => {
        const input = buildSolverInput();
        const plan = solveRetirementYear(input);

        const raw = TaxService.getTaxParameters(
            YEAR, 'Single', 'federal', undefined, input.assumptions,
        );
        if (!raw) throw new Error('no federal params');

        // Expected: tax on $60k pension with std ded $15,750 + $2,000 + $6,000
        // (MAGI $60k < $75k phaseout threshold → full bonus).
        const withSenior = TaxService.calculateTotalFederalTax(
            PENSION, 0, 0, 0, 0, 'Single',
            { ...raw, standardDeduction: raw.standardDeduction + 2000 + 6000 },
        ).totalTax;
        const withRaw = TaxService.calculateTotalFederalTax(
            PENSION, 0, 0, 0, 0, 'Single', raw,
        ).totalTax;

        // Sanity: the deduction difference is worth real dollars here.
        expect(withRaw - withSenior).toBeGreaterThan(800);

        // The engine must bill the senior figure (pre-fix it billed withRaw).
        expect(plan.tax.federal).toBeCloseTo(withSenior, 0);
        expect(plan.tax.federal).toBeLessThan(withRaw - 500);
    });
});

// =============================================================================
// buildDPYearContexts — the DP optimizes against the senior deduction (#191)
// =============================================================================

// Mirror the fixture style of RothConversionDPContexts.test.ts: a minimal
// retirement-only baseline timeline (shape the engine actually emits).
const DP_START_YEAR = new Date().getFullYear();
const DP_BIRTH_YEAR = DP_START_YEAR - 66; // 66 at the first context year
const DP_RETIREMENT_YEAR = DP_START_YEAR;

const dpAssumptions: AssumptionsState = {
    ...defaultAssumptions,
    demographics: {},
    milestones: createBuiltinMilestones(DP_BIRTH_YEAR, 65, 95),
    macro: {
        ...defaultAssumptions.macro,
        inflationRate: 0,
        inflationAdjusted: false,
        taxBracketShiftPct: 0,
        taxBracketShiftStartYear: 0,
    },
    investments: { ...defaultAssumptions.investments, returnRates: { ror: 0 } },
};

function buildDPBaseline(): SimulationYear[] {
    const years: SimulationYear[] = [];
    for (let i = 0; i < 8; i++) {
        const year = DP_RETIREMENT_YEAR + i;
        const trad = new InvestedAccount(
            'trad', 'Traditional IRA', 1_000_000, 0, 10, 0.0, 'Traditional IRA', true, 0.2, 1_000_000,
        );
        years.push({
            year,
            incomes: [],
            expenses: [],
            accounts: [trad],
            cashflow: {
                totalIncome: 0,
                totalExpense: 40_000,
                livingExpenses: 40_000,
                discretionary: 0,
                investedUser: 0,
                investedMatch: 0,
                totalInvested: 0,
                bucketAllocations: 0,
                bucketDetail: {},
                withdrawals: 0,
                withdrawalDetail: {},
            },
            taxDetails: {
                fed: 0, state: 0, fica: 0, preTax: 0, insurance: 0, postTax: 0,
                capitalGains: 0, withdrawalOrdinaryTax: 0, niit: 0,
            },
            logs: [],
        } as unknown as SimulationYear);
    }
    return years;
}

const dpTaxState: TaxState = {
    filingStatus: 'Single',
    stateResidency: 'Texas',
    deductionMethod: 'Standard',
    fedOverride: null,
    ficaOverride: null,
    stateOverride: null,
    year: DP_START_YEAR,
};

describe('buildDPYearContexts senior deduction (#191)', () => {
    it('bakes the effective (senior) standard deduction into every 65+ context', () => {
        const contexts = buildDPYearContexts(
            buildDPBaseline(), dpAssumptions, dpTaxState, DP_RETIREMENT_YEAR, 0,
        );
        expect(contexts.length).toBeGreaterThan(0);

        for (const ctx of contexts) {
            const raw = TaxService.getTaxParameters(
                ctx.year, 'Single', 'federal', undefined, dpAssumptions,
            );
            if (!raw) throw new Error(`no federal params for ${ctx.year}`);
            const expected = getEffectiveStandardDeduction(
                raw, 'Single', ctx.age, ctx.year,
                // Baseline has no income → MAGI proxy 0 → full bonus while it lasts.
                0,
            );
            // Every context year here is 65+, so the senior add-on must be > 0
            // (pre-fix: contexts carried the raw standard deduction).
            expect(expected).toBeGreaterThan(raw.standardDeduction);
            expect(ctx.fedParams.standardDeduction).toBe(expected);
        }
    });

    it('post-2028 contexts keep the regular 65+ add-on after the OBBBA bonus sunsets', () => {
        const contexts = buildDPYearContexts(
            buildDPBaseline(), dpAssumptions, dpTaxState, DP_RETIREMENT_YEAR, 0,
        );
        const postSunset = contexts.filter(c => c.year > 2028);
        expect(postSunset.length).toBeGreaterThan(0);
        for (const ctx of postSunset) {
            const raw = TaxService.getTaxParameters(
                ctx.year, 'Single', 'federal', undefined, dpAssumptions,
            );
            if (!raw) throw new Error(`no federal params for ${ctx.year}`);
            // Regular add-on only ($2,050 from the 2026 row, nominal — no bonus).
            expect(ctx.fedParams.standardDeduction)
                .toBe(raw.standardDeduction + (raw.seniorDeduction ?? 0));
        }
    });
});
