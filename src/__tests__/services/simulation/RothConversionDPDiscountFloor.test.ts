/**
 * Regression test for the deterministic max-wealth discount-factor floor.
 *
 * The max-wealth objective (the PRODUCTION default) discounts each year's
 * future value by `1/(1 + growthRate)`. The stochastic path floors its
 * denominator at 0.01 (#5) so a pathological rate can't blow up the discount,
 * but the deterministic max-wealth path historically used an UNFLOORED
 * `1/(1 + ctx.growthRate)` in BOTH the backward sweep and the forward extract.
 *
 * A Traditional account whose net growth rate is exactly −100% (e.g. a
 * hand-edited / QR-imported `customROR = -100`, or `-95` with a 6% expense
 * ratio — NOT reachable through the percent input, which strips the minus sign
 * and caps at 30) makes the unfloored denominator `1 + (-1) = 0`, so
 * `df = 1 / 0 = +Infinity`. The future term `df × futureValue` then evaluates to
 * `Infinity × 0 = NaN` at the cells where the (about-to-be-wiped-out) trad
 * terminal value is 0, seeding the backward-sweep V-table with NaN. Because
 * `NaN > -Infinity` is `false`, the max-wealth argmax never selects a positive
 * conversion at those cells, so the solver returns a GARBAGE all-zero plan —
 * it converts NOTHING even though front-loading is obviously optimal when the
 * balance is about to evaporate.
 *
 * The fix mirrors the stochastic floor — `Math.max(0.01, 1 + ctx.growthRate)`
 * in both df sites — so the discount stays finite and the plan front-loads the
 * conversion correctly.
 *
 * FAIL-FIRST: with the floor removed, the −100% case below converts $0 and the
 * "meaningful conversion" assertion fails; with the floor it front-loads the
 * full first-year bracket headroom.
 */
import { describe, it, expect } from 'vitest';
import {
    planConversionsViaDP,
    DPYearContext,
    DPObjectiveOptions,
} from '../../../services/simulation/RothConversionDP';
import { TAX_DATABASE } from '../../../data/TaxData';
import { makeDPContext } from './dpFixtures';

// Production objective: max-wealth is the DEFAULT in the real engine and is the
// ONLY mode whose deterministic df uses `1/(1+growthRate)` (min-tax uses the
// fixed back-load discount, which never touches growthRate). The bug lives
// behind this branch, so the test must select it explicitly —
// `planConversionsViaDP` defaults to legacy min-tax when no opts are passed.
const MAX_WEALTH_OPTS: DPObjectiveOptions = { objectiveMode: 'max-wealth' };

/** MFJ / 2024-params 30-year horizon (age 65→94, RMDs from 73) with an overridable net growth rate. */
function buildHorizon(growthRate: number): DPYearContext[] {
    const ctxs: DPYearContext[] = [];
    for (let i = 0; i < 30; i++) {
        const age = 65 + i;
        const year = 2030 + i;
        const rmdDivisor = age >= 73 ? Math.max(8.0, 26.5 - (age - 73) * 0.9) : 0;
        ctxs.push(
            makeDPContext(year, age, {
                nonSSOrdinaryIncomeExclRMD: 30_000,
                ssBenefits: age >= 67 ? 30_000 : 0,
                filingStatus: 'Married Filing Jointly',
                fedParams: TAX_DATABASE.federal[2024]['Married Filing Jointly'],
                rothGrowthRate: 0.07,
                growthRate,
                rmdDivisor,
            }),
        );
    }
    return ctxs;
}

function runPlan(growthRate: number) {
    return planConversionsViaDP(
        {
            contexts: buildHorizon(growthRate),
            currentTradBalance: 1_500_000,
            currentRothBalance: 100_000,
        },
        MAX_WEALTH_OPTS,
    );
}

function totalConverted(plan: ReturnType<typeof runPlan>): number {
    return Array.from(plan.conversionsByYear.values()).reduce((s, a) => s + a, 0);
}

// Each case runs a full 30-year DP (several seconds). Per-describe timeout kept
// generous so the CPU-bound solver doesn't trip vitest's 5s default under the
// parallel-suite load (matches the sibling RothConversionDP.test.ts convention).
describe('RothConversionDP deterministic max-wealth discount floor', { timeout: 30_000 }, () => {
    it('still produces a meaningful plan at a net growth rate of exactly -100% (df would be 1/0)', () => {
        // df = 1 / (1 + (-1)) = 1/0 = +Infinity without the floor → Infinity×0 = NaN
        // poisons the V-table → max-wealth argmax never converts → garbage $0 plan.
        const plan = runPlan(-1.0);

        // The headline regression check: the solver must still front-load a real
        // conversion (the unfloored bug returns exactly $0 here).
        expect(totalConverted(plan)).toBeGreaterThan(50_000);

        // And every emitted amount stays a finite, non-negative dollar figure.
        for (const [year, amount] of plan.conversionsByYear) {
            expect(Number.isFinite(amount), `conversion for ${year} must be finite`).toBe(true);
            expect(amount).toBeGreaterThanOrEqual(0);
        }
        for (const entry of plan.diagnostics.perYearAmounts) {
            expect(Number.isFinite(entry.amount)).toBe(true);
            expect(Number.isFinite(entry.estimatedTradBalance)).toBe(true);
        }
    });

    it('keeps the plan finite and non-negative below -100% net growth (denominator goes negative)', () => {
        // df = 1 / (1 + (-1.5)) = 1/(-0.5) = -2 without the floor. The negative
        // discount is the same root-cause pathology; the floor clamps it to 1/0.01.
        const plan = runPlan(-1.5);

        for (const [year, amount] of plan.conversionsByYear) {
            expect(Number.isFinite(amount), `conversion for ${year} must be finite`).toBe(true);
            expect(amount).toBeGreaterThanOrEqual(0);
        }
        for (const entry of plan.diagnostics.perYearAmounts) {
            expect(Number.isFinite(entry.amount)).toBe(true);
        }
    });

    it('is unchanged for a normal positive net growth rate (floor never binds)', () => {
        const plan = runPlan(0.07);
        expect(totalConverted(plan)).toBeGreaterThan(50_000);
        for (const amount of plan.conversionsByYear.values()) {
            expect(Number.isFinite(amount)).toBe(true);
            expect(amount).toBeGreaterThanOrEqual(0);
        }
    });
});
