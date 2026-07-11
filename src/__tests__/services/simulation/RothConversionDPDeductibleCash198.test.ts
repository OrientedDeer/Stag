/**
 * #198 stage-3 regression: an above-the-line "Yes"-deductible expense must lower
 * the DP's ordinary TAX base but MUST NOT lower its spendable-CASH source.
 *
 * Background: #198 stage 1 (commit 8fd07c8) nets `expenseAboveLineDeductions`
 * into `nonSSOrdinaryIncomeExclRMD`:
 *
 *     nonSSOrdinaryIncomeExclRMD =
 *         max(0, gross − SS − preTaxExemptions − expenseAboveLineDeductions)
 *
 * That is correct for the TAX base (the engine's YearSolver adds the same amount
 * to its federal/state `preTaxDeductions`, so the DP prices the lower tax). But
 * the SAME field is also the DP's spendable-cash source inside `evaluateCell`:
 *
 *     cashFromOrdinary = nonSSOrdinaryIncomeExclRMD + ssBenefits + rmd
 *
 * A "Yes"-deductible expense is still real cash the retiree receives and spends —
 * and it is ALREADY billed inside `spendingNeed` (= totalExpense − taxes). So
 * subtracting it from the cash source double-counts it: every retirement context
 * sees the deduction amount LESS cash than the engine actually has while still
 * billing that same amount in `spendingNeed`, manufacturing a phantom funding gap
 * (extra Traditional-spending tax / infeasibility penalty) in every cell. This
 * distorts `planConversionsViaDP`'s candidate sizing and the #98 Monte-Carlo
 * per-path policy cap, which the engine-direct re-score does NOT protect.
 *
 * The contract (types.ts): the field is "netted into the DP's ordinary tax base,
 * never subtracted from spendable cash."
 *
 * These tests build contexts through the REAL `buildDPYearContexts` producer and
 * exercise the REAL `evaluateCell`, toggling ONLY `expenseAboveLineDeductions`
 * (the exact field + value SimulationEngine emits for a $12k/yr "Yes" charity —
 * see ItemizedDeductionProjection198.test.ts, which proves the engine produces
 * `expenseAboveLineDeductions ≈ 12_000`). The invariant: spendable cash is
 * identical with and without the deduction; only the tax base (and thus the
 * priced tax) differs.
 */
import { describe, it, expect } from 'vitest';
import {
    buildDPYearContexts,
    evaluateCell,
    type DPYearContext,
} from '../../../services/simulation/RothConversionDP';
import {
    type AssumptionsState,
    defaultAssumptions,
    createBuiltinMilestones,
} from '../../../components/Objects/Assumptions/AssumptionsContext';
import { type TaxState } from '../../../components/Objects/Taxes/TaxContext';
import { InvestedAccount } from '../../../components/Objects/Accounts/models';
import { PassiveIncome } from '../../../components/Objects/Income/models';
import { type SimulationYear } from '../../../services/simulation/types';

const START_YEAR = new Date().getFullYear();
const RETIREMENT_AGE = 65;
const BIRTH_YEAR = START_YEAR - 66;                 // already retired today (age 66)
const RETIREMENT_YEAR = BIRTH_YEAR + RETIREMENT_AGE; // START_YEAR − 1 ⇒ every context year is a retirement (non-gap) year

// Ordinary, non-SS, no-deferral retirement income (pension-like). This is what
// `nonSSOrdinaryIncomeExclRMD` captures — the number the deduction nets against.
const PENSION = 50_000;
// The $12k/yr above-the-line "Yes" deduction. SimulationEngine emits exactly this
// on `SimulationYear.expenseAboveLineDeductions` for a $12k "Yes" charity.
const DEDUCTION = 12_000;
// Living expense large enough to force a brokerage-funded gap every year, so the
// waterfall's `fromBrokerage` fully absorbs the gap (no roth/trad spending) and
// we can recover `cashFromOrdinary` from the public evaluateCell output.
const LIVING = 90_000;
const BROKERAGE = 3_000_000; // big enough to cover the gap alone

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

const taxState: TaxState = {
    filingStatus: 'Single',
    stateResidency: 'Texas', // no state tax → isolates the federal cash/tax split
    deductionMethod: 'Standard',
    fedOverride: null,
    ficaOverride: null,
    stateOverride: null,
    year: START_YEAR,
};

/**
 * Retiree baseline spanning ages 66..71 (all pre-RMD, so `rmd = 0` in every
 * context — keeps the cash recovery a clean `nonSSOrdinary`). Every year carries
 * a $50k pension, a large brokerage, and the same living expense. `deduction`
 * sets the engine-produced `expenseAboveLineDeductions` field on each row.
 */
function buildRetireeBaseline(deduction: number): SimulationYear[] {
    const years: SimulationYear[] = [];
    for (let i = 0; i < 6; i++) {
        const year = START_YEAR + i;
        const trad = new InvestedAccount(
            'trad', 'Traditional IRA', 500_000, 0, 10, 0.0, 'Traditional IRA', true, 0.2, 500_000,
        );
        const brokerage = new InvestedAccount(
            'brk', 'Brokerage', BROKERAGE, 0, 10, 0.0, 'Brokerage', true, 0.2, BROKERAGE,
        );
        const pension = new PassiveIncome(
            'p', 'Pension', PENSION, 'Annually', 'No', 'Other', new Date(START_YEAR - 1, 0, 1),
        );
        years.push({
            year,
            incomes: [pension],
            expenses: [],
            accounts: [trad, brokerage],
            cashflow: {
                totalIncome: PENSION, totalExpense: LIVING, livingExpenses: LIVING, discretionary: 0,
                investedUser: 0, investedMatch: 0, totalInvested: 0, bucketAllocations: 0,
                bucketDetail: {}, withdrawals: 0, withdrawalDetail: {},
            },
            taxDetails: {
                fed: 0, state: 0, fica: 0, preTax: 0, insurance: 0, postTax: 0,
                capitalGains: 0, withdrawalOrdinaryTax: 0, niit: 0,
            },
            // The field under test — the exact shape/value SimulationEngine emits.
            expenseAboveLineDeductions: deduction,
            logs: [],
        });
    }
    return years;
}

/**
 * Recover the `cashFromOrdinary` that evaluateCell used, from its public output.
 * In a brokerage-funded gap year (totalNeed > 0, fully sourced, no unmet need):
 *   totalNeed = spendingNeed + yearTax − cashFromOrdinary
 *             = fromBrokerage + fromRoth + tradSpending + unmetNeed
 * ⇒ cashFromOrdinary = spendingNeed + yearTax − (that sourced sum).
 */
function recoverCashFromOrdinary(
    ctx: DPYearContext,
    r: ReturnType<typeof evaluateCell>,
): number {
    const sourced = r.fromBrokerage + r.fromRoth + r.tradSpending + r.unmetNeed;
    return ctx.spendingNeed + r.yearTax - sourced;
}

describe('#198 deductible "Yes" expense: tax base drops, spendable cash does NOT', () => {
    const INSPECT_YEAR = START_YEAR + 1; // age 67, comfortably pre-RMD

    function contextFor(deduction: number): DPYearContext {
        const contexts = buildDPYearContexts(
            buildRetireeBaseline(deduction), assumptions, taxState, RETIREMENT_YEAR, BROKERAGE,
        );
        const ctx = contexts.find(c => c.year === INSPECT_YEAR);
        expect(ctx).toBeDefined();
        return ctx!;
    }

    it('nets the deduction out of the ordinary TAX base (stage-1 behavior preserved)', () => {
        const withDed = contextFor(DEDUCTION);
        const noDed = contextFor(0);
        // The tax base SHOULD drop by exactly the deduction.
        expect(noDed.nonSSOrdinaryIncomeExclRMD).toBeCloseTo(PENSION, 4);
        expect(withDed.nonSSOrdinaryIncomeExclRMD).toBeCloseTo(PENSION - DEDUCTION, 4);
    });

    it('does NOT subtract the deduction from spendable cash (the fix)', () => {
        const withDed = contextFor(DEDUCTION);
        const noDed = contextFor(0);

        // Same DP cell state for both; conversion 0, no baseline tax to net against.
        const trad = 500_000, roth = 100_000;
        const rWith = evaluateCell(trad, roth, 0, withDed, 0);
        const rNo = evaluateCell(trad, roth, 0, noDed, 0);

        // Preconditions: a genuine brokerage-funded gap in BOTH, fully sourced,
        // no roth/trad tap and nothing unmet — so the recovery formula is exact.
        for (const r of [rWith, rNo]) {
            expect(r.fromBrokerage).toBeGreaterThan(0);
            expect(r.fromRoth).toBe(0);
            expect(r.tradSpending).toBe(0);
            expect(r.unmetNeed).toBe(0);
        }

        const cashWith = recoverCashFromOrdinary(withDed, rWith);
        const cashNo = recoverCashFromOrdinary(noDed, rNo);

        // The deduction is real cash the retiree still has AND already spends
        // (it's inside spendingNeed) — so the cash source must be the FULL
        // ordinary income in both cases, unchanged by the deduction.
        expect(cashNo).toBeCloseTo(PENSION, 2);
        expect(cashWith).toBeCloseTo(PENSION, 2);
        expect(cashWith).toBeCloseTo(cashNo, 2);
    });

    it('still prices LESS tax with the deduction (the tax-base netting is live)', () => {
        const withDed = contextFor(DEDUCTION);
        const noDed = contextFor(0);
        const trad = 500_000, roth = 100_000;
        const rWith = evaluateCell(trad, roth, 0, withDed, 0);
        const rNo = evaluateCell(trad, roth, 0, noDed, 0);
        // $12k off a positive marginal bracket ⇒ strictly less tax.
        expect(rWith.yearTax).toBeLessThan(rNo.yearTax);
    });
});
