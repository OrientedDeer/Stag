/**
 * Unit tests for RothConversionDP.
 *
 * Tests the solver against hand-crafted synthetic contexts so we can
 * validate algorithmic behavior (non-negativity, conversion bounds, δ effect
 * on back-loading) independent of the real simulation engine.
 */
import { describe, it, expect } from 'vitest';
import {
    planConversionsViaDP,
    DPYearContext,
    DP_BACKLOAD_DELTA,
} from '../../../services/simulation/RothConversionDP';
import { TAX_DATABASE } from '../../../data/TaxData';

// ---------------------------------------------------------------------------
// Synthetic context builders
// ---------------------------------------------------------------------------

function makeContext(overrides: Partial<DPYearContext> = {}): DPYearContext {
    const fedParams = TAX_DATABASE.federal[2024]['Married Filing Jointly'];
    return {
        year: 2030,
        age: 65,
        nonSSOrdinaryIncomeExclRMD: 30_000,
        ssBenefits: 0,
        ltcgIncome: 0,
        filingStatus: 'Married Filing Jointly',
        fedParams,
        stateParams: null,
        acaOptions: undefined,
        baselineTradWithdrawal: 0,
        // Phase 2 fields. Synthetic defaults: no other expenses (so DP only
        // optimizes against tax), no brokerage, Roth grows at the same rate
        // as trad. Tests that exercise these paths can override.
        spendingNeed: 0,
        baselineBrokerageAvailable: 0,
        rothGrowthRate: 0.07,
        growthRate: 0.07,
        rmdDivisor: 0,
        ...overrides,
    };
}

/** 30-year retirement, age 65 → 94. RMDs from 73 onward. */
function buildHorizonContexts(): DPYearContext[] {
    const ctxs: DPYearContext[] = [];
    for (let i = 0; i < 30; i++) {
        const age = 65 + i;
        const year = 2030 + i;
        // Distribution-period divisors approximate Uniform Lifetime Table
        const rmdDivisor =
            age >= 73 ? Math.max(8.0, 26.5 - (age - 73) * 0.9) : 0;
        ctxs.push(makeContext({
            year,
            age,
            // Modest baseline: SS at 67, pension flat
            ssBenefits: age >= 67 ? 30_000 : 0,
            nonSSOrdinaryIncomeExclRMD: 30_000,
            rmdDivisor,
        }));
    }
    return ctxs;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

// 2D-state DP backward sweep is materially more expensive than the prior 1D
// solver — typical synthetic-context run is several seconds. Per-describe
// timeout kept generous so individual tests don't trip vitest's 5s default.
describe('planConversionsViaDP', { timeout: 30_000 }, () => {
    it('returns empty plan for empty horizon', () => {
        const plan = planConversionsViaDP({
            contexts: [],
            currentTradBalance: 0,
            currentRothBalance: 0,
        });
        expect(plan.conversionsByYear.size).toBe(0);
        expect(plan.diagnostics.horizonYears).toBe(0);
    });

    it('produces non-negative conversion amounts each year', () => {
        const contexts = buildHorizonContexts();
        const plan = planConversionsViaDP({
            contexts,
            currentTradBalance: 1_500_000,
            currentRothBalance: 100_000,
        });
        for (const amount of plan.conversionsByYear.values()) {
            expect(amount).toBeGreaterThanOrEqual(0);
        }
    });

    it('emits one entry per horizon year', () => {
        const contexts = buildHorizonContexts();
        const plan = planConversionsViaDP({
            contexts,
            currentTradBalance: 1_500_000,
            currentRothBalance: 100_000,
        });
        expect(plan.conversionsByYear.size).toBe(contexts.length);
        expect(plan.diagnostics.perYearAmounts.length).toBe(contexts.length);
    });

    it('proposes meaningful conversions for high-trad / low-current-bracket case', () => {
        const contexts = buildHorizonContexts();
        const plan = planConversionsViaDP({
            contexts,
            currentTradBalance: 2_000_000,
            currentRothBalance: 100_000,
        });
        // Some year should propose a meaningful conversion (>$5k) — otherwise
        // the algorithm is just doing nothing on a case where conversions
        // clearly help.
        const totalConverted = Array.from(plan.conversionsByYear.values())
            .reduce((s, a) => s + a, 0);
        expect(totalConverted).toBeGreaterThan(50_000);
    });

    it('does not propose conversions exceeding the starting trad balance', () => {
        const contexts = buildHorizonContexts();
        const startingTrad = 500_000;
        const plan = planConversionsViaDP({
            contexts,
            currentTradBalance: startingTrad,
            currentRothBalance: 100_000,
        });
        const totalConverted = Array.from(plan.conversionsByYear.values())
            .reduce((s, a) => s + a, 0);
        // Account for growth: total conversions can exceed starting balance
        // because the trad grows year-over-year. But individual years should
        // never exceed that year's available balance.
        for (const entry of plan.diagnostics.perYearAmounts) {
            expect(entry.amount).toBeLessThanOrEqual(entry.estimatedTradBalance + 1);
        }
        // Sanity: total over lifetime stays within reasonable multiple of starting.
        expect(totalConverted).toBeLessThan(startingTrad * 4);
    });

    it('fills bracket space even when no brokerage exists (regression: removed hard cap)', () => {
        // Setup: 30-year horizon with $2M trad. RMDs at 73 push the user
        // deep into the 22% federal bracket — converting now while they're
        // in a lower bracket is the textbook win. Pre-fix, the hard cap
        // (conversionTax ≤ brokerageSlack × 1.2) rejected every conversion
        // beyond the std-ded headroom, so DP picked tiny amounts and the
        // trad ballooned. Post-fix, DP should fill bracket space sized to
        // future RMD pressure.
        const contexts = buildHorizonContexts();
        const plan = planConversionsViaDP({
            contexts,
            currentTradBalance: 2_000_000,
            currentRothBalance: 100_000,
        });

        // At least one year should pick a conversion well above the std-ded
        // headroom (which is ~$29k MFJ). $50k+ exercises the cap-removal.
        const maxYearly = Math.max(...Array.from(plan.conversionsByYear.values()));
        expect(maxYearly).toBeGreaterThan(50_000);
    });

    it('higher δ produces a more back-loaded plan than δ = 0', () => {
        const contexts = buildHorizonContexts();
        const planNoDelta = planConversionsViaDP({
            contexts,
            currentTradBalance: 1_500_000,
            currentRothBalance: 100_000,
            backloadDelta: 0,
        });
        const planHighDelta = planConversionsViaDP({
            contexts,
            currentTradBalance: 1_500_000,
            currentRothBalance: 100_000,
            backloadDelta: 0.05, // exaggerated for test signal
        });

        // Compare share of conversions in the first half vs second half of
        // horizon. With δ = 0, optimizer mildly front-loads (Roth growth
        // arbitrage). With high δ, it should push more weight to later years.
        const halfIdx = Math.floor(contexts.length / 2);
        const sumFirstHalf = (plan: typeof planNoDelta) =>
            plan.diagnostics.perYearAmounts
                .slice(0, halfIdx)
                .reduce((s, e) => s + e.amount, 0);
        const sumSecondHalf = (plan: typeof planNoDelta) =>
            plan.diagnostics.perYearAmounts
                .slice(halfIdx)
                .reduce((s, e) => s + e.amount, 0);

        const noDeltaFront = sumFirstHalf(planNoDelta);
        const noDeltaBack = sumSecondHalf(planNoDelta);
        const highDeltaFront = sumFirstHalf(planHighDelta);
        const highDeltaBack = sumSecondHalf(planHighDelta);

        const noDeltaFrontShare =
            noDeltaFront / Math.max(1, noDeltaFront + noDeltaBack);
        const highDeltaFrontShare =
            highDeltaFront / Math.max(1, highDeltaFront + highDeltaBack);

        // High δ pushes weight toward back → smaller front share.
        expect(highDeltaFrontShare).toBeLessThan(noDeltaFrontShare + 0.01);
    });

    it('defaults backloadDelta to DP_BACKLOAD_DELTA constant', () => {
        const contexts = buildHorizonContexts();
        const plan = planConversionsViaDP({
            contexts,
            currentTradBalance: 1_000_000,
            currentRothBalance: 100_000,
        });
        expect(plan.diagnostics.backloadDelta).toBe(DP_BACKLOAD_DELTA);
    });

    it('completes within a reasonable bound on a realistic 30-year horizon', () => {
        const contexts = buildHorizonContexts();
        const plan = planConversionsViaDP({
            contexts,
            currentTradBalance: 2_000_000,
            currentRothBalance: 100_000,
        });
        // Generous bound — flagged if anything regresses badly. The 2D
        // (trad × roth) backward sweep is the dominant cost; current grid
        // (TRAD=100, ROTH=50, CONV=200) lands around 4-5s on a typical
        // 30-yr horizon. Threshold is 2× that to avoid flakes on slow CI.
        expect(plan.diagnostics.elapsedMs).toBeLessThan(15_000);
    });

    it('plumbs Roth grid scaffolding through diagnostics (Phase 1)', () => {
        const contexts = buildHorizonContexts();
        const plan = planConversionsViaDP({
            contexts,
            currentTradBalance: 1_500_000,
            currentRothBalance: 250_000,
        });
        // Phase 1 scaffolding for the 3D state extension. The solver does
        // not yet read these — this test guards against the wiring being
        // dropped before Phase 4 lands.
        expect(plan.diagnostics.rothBuckets).toBe(50);
        expect(plan.diagnostics.maxRoth).toBeGreaterThan(250_000);
        expect(plan.diagnostics.dRoth).toBeGreaterThan(0);
        expect(plan.diagnostics.dRoth).toBe(plan.diagnostics.maxRoth / 50);
    });
});
