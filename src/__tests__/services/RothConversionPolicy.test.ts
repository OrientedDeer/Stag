/**
 * #98 — Stochastic-DP conversion POLICY.
 *
 * The stochastic solve integrates a return distribution into the V-table
 * transition (a common zero-mean shock added to each account's deterministic
 * rate) and emits a closed-loop policy: the argmax conversion as a function of
 * (year, trad, roth) state, looked up per MC path via `lookupConversionPolicy`.
 *
 * These tests exercise `planConversionsViaDP` directly with synthetic contexts:
 *  1. σ=0, meanShift=0  ⇒  the stochastic transition reduces to the deterministic
 *     one, so the policy's central schedule matches the deterministic schedule
 *     (aggregate — per-year amounts can differ by the policy's interpolation
 *     granularity, an accepted #98 approximation).
 *  2. The emitted policy is well-formed and `lookupConversionPolicy` at the
 *     starting state reproduces the central schedule's first-year conversion.
 *  3. A volatile solve (σ>0) still produces a sane, monotone-ish policy.
 */
import { describe, it, expect } from 'vitest';

import {
    planConversionsViaDP,
    lookupConversionPolicy,
    buildShockQuadrature,
    type DPYearContext,
    type DPObjectiveOptions,
} from '../../services/simulation/RothConversionDP';
import { makeDPContext } from './simulation/dpFixtures';

/**
 * Build a synthetic retiree-year context (low fixed income, pre-RMD). This
 * suite's profile adds a spending need + brokerage to fund conversion tax on
 * top of the shared `makeDPContext` field list
 * (src/__tests__/services/simulation/dpFixtures.ts) — single / 2025 params /
 * 5% growth are the shared defaults, so only the spending fields differ.
 */
function makeCtx(year: number, age: number, overrides: Partial<DPYearContext> = {}): DPYearContext {
    return makeDPContext(year, age, {
        spendingNeed: 40_000,
        baselineBrokerageAvailable: 300_000,
        ...overrides,
    });
}

/** 12-year pre-RMD horizon, large Traditional, brokerage to fund conversion tax. */
function makeContexts(): DPYearContext[] {
    return Array.from({ length: 12 }, (_, i) => makeCtx(2025 + i, 60 + i));
}

const MAX_WEALTH: DPObjectiveOptions = {
    objectiveMode: 'max-wealth',
    terminalValuation: 'bracket-aware',
    userSituation: 'self-liquidate',
};

const START_TRAD = 900_000;
const START_ROTH = 50_000;

function totalConverted(m: Map<number, number>): number {
    return [...m.values()].reduce((s, a) => s + a, 0);
}

describe('#98 stochastic conversion policy', () => {
    it('buildShockQuadrature: weights sum to 1; σ=0 ⇒ all shocks 0', () => {
        const q = buildShockQuadrature(0.15, 7);
        expect(q.weights.length).toBe(7);
        expect(q.weights.reduce((s, w) => s + w, 0)).toBeCloseTo(1, 10);
        const z = buildShockQuadrature(0, 7);
        expect(z.shocks.every(s => s === 0)).toBe(true);
    });

    it('σ=0, meanShift=0 reproduces the deterministic schedule (aggregate) and emits a policy', { timeout: 60_000 }, () => {
        const det = planConversionsViaDP(
            { contexts: makeContexts(), currentTradBalance: START_TRAD, currentRothBalance: START_ROTH },
            MAX_WEALTH,
        );
        const stoch = planConversionsViaDP(
            { contexts: makeContexts(), currentTradBalance: START_TRAD, currentRothBalance: START_ROTH },
            { ...MAX_WEALTH, returnDistribution: { stdDev: 0, meanShift: 0, nodes: 7 } },
        );

        // The fixture must actually convert, else the comparison is vacuous.
        expect(totalConverted(det.conversionsByYear)).toBeGreaterThan(50_000);

        // Deterministic solve emits NO policy; stochastic solve does.
        expect(det.policy).toBeUndefined();
        expect(stoch.policy).toBeDefined();
        expect(stoch.policy!.byYear.size).toBe(12);

        // σ=0 ⇒ identical V-table ⇒ same per-cell argmax; the central schedules
        // agree in aggregate (per-year jitter ≤ policy interpolation granularity).
        const dTot = totalConverted(det.conversionsByYear);
        const sTot = totalConverted(stoch.conversionsByYear);
        expect(Math.abs(sTot - dTot) / dTot).toBeLessThan(0.05);
    });

    it('lookupConversionPolicy at the starting state reproduces the first-year central conversion', { timeout: 60_000 }, () => {
        const stoch = planConversionsViaDP(
            { contexts: makeContexts(), currentTradBalance: START_TRAD, currentRothBalance: START_ROTH },
            { ...MAX_WEALTH, returnDistribution: { stdDev: 0.15, meanShift: 0, nodes: 7 } },
        );
        const firstYear = 2025;
        const fromSchedule = stoch.conversionsByYear.get(firstYear) ?? 0;
        const fromLookup = lookupConversionPolicy(stoch.policy!, firstYear, START_TRAD, START_ROTH);
        // year 2025 is always in the policy map by construction, so this must be
        // defined; assert the numeric closeness on the non-null value directly
        // (no `?? 0` fallback, which would silently pass a missing entry).
        expect(fromLookup).toBeDefined();
        // Same interpolation, same state, no binding clamp at year 0 ⇒ within $1.
        expect(Math.abs(fromLookup! - fromSchedule)).toBeLessThanOrEqual(1);
    });

    it('a volatile solve still produces a complete policy and converts', { timeout: 60_000 }, () => {
        const stoch = planConversionsViaDP(
            { contexts: makeContexts(), currentTradBalance: START_TRAD, currentRothBalance: START_ROTH },
            { ...MAX_WEALTH, returnDistribution: { stdDev: 0.18, meanShift: 0.03, nodes: 7 } },
        );
        expect(stoch.policy).toBeDefined();
        expect(stoch.policy!.byYear.size).toBe(12);
        expect(totalConverted(stoch.conversionsByYear)).toBeGreaterThan(0);

        // Load-bearing self-consistency (vs. the old isFinite/≥0 check, which a
        // non-negative interpolation table satisfies structurally): the emitted
        // central schedule must be an actual walk of the stored policy table, so
        // looking the policy up at the FIRST-YEAR starting state reproduces the
        // schedule's first-year conversion — even under volatility. A divergent
        // inline forward computation would break this within the $1 tolerance.
        const firstYear = 2025;
        const fromSchedule = stoch.conversionsByYear.get(firstYear);
        expect(fromSchedule).toBeDefined();
        const fromLookup = lookupConversionPolicy(stoch.policy!, firstYear, START_TRAD, START_ROTH);
        expect(fromLookup).toBeDefined();
        expect(Math.abs(fromLookup! - fromSchedule!)).toBeLessThanOrEqual(1);
        // And the lookup honors the RMD-aware ceiling clamp (≤ entering trad).
        expect(fromLookup!).toBeLessThanOrEqual(START_TRAD);
    });
});

describe('#104 stochastic DP emits structured perYearTraces', () => {
    // Before #104/#106 the stochastic ("policy") walk emitted only a lightweight
    // [DEBUG DP policy] line and built NO DPYearTrace, so the Roth conversion
    // debug SCREEN (cost-curve / waterfall / balance-flow) rendered blank for any
    // Monte-Carlo path-policy plan. These tests pin that the stochastic walk now
    // populates the same structured trace the deterministic walk does.
    it('a returnDistribution plan yields one populated DPYearTrace per horizon year', { timeout: 60_000 }, () => {
        const contexts = makeContexts();
        const stoch = planConversionsViaDP(
            { contexts, currentTradBalance: START_TRAD, currentRothBalance: START_ROTH },
            { ...MAX_WEALTH, returnDistribution: { stdDev: 0.15, meanShift: 0, nodes: 7 } },
        );
        const traces = stoch.diagnostics.perYearTraces;
        // Core regression guard: non-empty, one per year (was 0 before #104).
        expect(traces.size).toBe(contexts.length);

        // The fixture must actually convert, else "traces exist" is hollow.
        expect(totalConverted(stoch.conversionsByYear)).toBeGreaterThan(0);

        for (const ctx of contexts) {
            const trace = traces.get(ctx.year);
            expect(trace, `missing trace for year ${ctx.year}`).toBeDefined();
            // The trace must reflect the ACTUAL chosen plan, not a placeholder:
            // chosenC equals what the central schedule recorded for the year.
            expect(trace!.chosenC).toBe(stoch.conversionsByYear.get(ctx.year));
            // The debug screen renders the cost curve and the per-year waterfall;
            // both must be populated for the screen to be non-blank.
            expect(trace!.costCurve.length).toBeGreaterThan(0);
            expect(trace!.age).toBe(ctx.age);
            // Baseline (conversion=0) tax is a tax: ≥ 0 (can be $0 in a low-income
            // early year whose ordinary income is under the standard deduction).
            expect(trace!.taxBaselineNoConv).toBeGreaterThanOrEqual(0);
            // Entering balances are real numbers (the walk tracks state forward).
            expect(Number.isFinite(trace!.tradEntering)).toBe(true);
            expect(Number.isFinite(trace!.rothEntering)).toBe(true);
            expect(Number.isFinite(trace!.tradNext)).toBe(true);
        }

        // First-year entering state is exactly the starting balances handed in.
        const firstTrace = traces.get(2025)!;
        expect(firstTrace.tradEntering).toBe(START_TRAD);
        expect(firstTrace.rothEntering).toBe(START_ROTH);
        // Each cost-curve sample carries the chosen conversion among its points.
        expect(firstTrace.costCurve.some(p => p.c === firstTrace.chosenC)).toBe(true);
    });

    it('deterministic and stochastic both emit traces (parity — neither path is blank)', { timeout: 60_000 }, () => {
        const contexts = makeContexts();
        const det = planConversionsViaDP(
            { contexts, currentTradBalance: START_TRAD, currentRothBalance: START_ROTH },
            MAX_WEALTH,
        );
        const stoch = planConversionsViaDP(
            { contexts, currentTradBalance: START_TRAD, currentRothBalance: START_ROTH },
            { ...MAX_WEALTH, returnDistribution: { stdDev: 0.18, meanShift: 0.03, nodes: 7 } },
        );
        // The deterministic path always built traces; #104 brings the stochastic
        // path to parity (same count, both full).
        expect(det.diagnostics.perYearTraces.size).toBe(contexts.length);
        expect(stoch.diagnostics.perYearTraces.size).toBe(contexts.length);
    });
});
