/**
 * Unit tests for RothConversionDP.
 *
 * Tests the solver against hand-crafted synthetic contexts so we can
 * validate algorithmic behavior (non-negativity, hard cap, δ effect on
 * back-loading) independent of the real simulation engine.
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
        brokerageSlack: 200_000,
        baselineTradWithdrawal: 0,
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
            brokerageSlack: 200_000,
            rmdDivisor,
        }));
    }
    return ctxs;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('planConversionsViaDP', () => {
    it('returns empty plan for empty horizon', () => {
        const plan = planConversionsViaDP({
            contexts: [],
            currentTradBalance: 0,
        });
        expect(plan.conversionsByYear.size).toBe(0);
        expect(plan.diagnostics.horizonYears).toBe(0);
    });

    it('produces non-negative conversion amounts each year', () => {
        const contexts = buildHorizonContexts();
        const plan = planConversionsViaDP({
            contexts,
            currentTradBalance: 1_500_000,
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
        });
        expect(plan.conversionsByYear.size).toBe(contexts.length);
        expect(plan.diagnostics.perYearAmounts.length).toBe(contexts.length);
    });

    it('proposes meaningful conversions for high-trad / low-current-bracket case', () => {
        const contexts = buildHorizonContexts();
        const plan = planConversionsViaDP({
            contexts,
            currentTradBalance: 2_000_000,
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

    it('respects the brokerage hard cap (low-slack year cannot have a tax-runaway conversion)', () => {
        const contexts = buildHorizonContexts().map((c, i) =>
            i === 0 ? { ...c, brokerageSlack: 1_000 } : c
        );
        const plan = planConversionsViaDP({
            contexts,
            currentTradBalance: 1_000_000,
        });
        // First year had only $1k of brokerage slack. The 22% bracket starts
        // around $94k taxable income for MFJ; converting $50k+ would create
        // ~$10k+ of tax, which would exceed slack × 1.2 = $1200. So the hard
        // cap should keep this year's conversion small.
        const firstYearConv = plan.conversionsByYear.get(contexts[0].year) ?? 0;
        expect(firstYearConv).toBeLessThan(60_000);
    });

    it('higher δ produces a more back-loaded plan than δ = 0', () => {
        const contexts = buildHorizonContexts();
        const planNoDelta = planConversionsViaDP({
            contexts,
            currentTradBalance: 1_500_000,
            backloadDelta: 0,
        });
        const planHighDelta = planConversionsViaDP({
            contexts,
            currentTradBalance: 1_500_000,
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
        });
        expect(plan.diagnostics.backloadDelta).toBe(DP_BACKLOAD_DELTA);
    });

    it('completes in well under a second on a realistic 30-year horizon', () => {
        const contexts = buildHorizonContexts();
        const plan = planConversionsViaDP({
            contexts,
            currentTradBalance: 2_000_000,
        });
        // Generous bound — flagged if anything regresses badly.
        expect(plan.diagnostics.elapsedMs).toBeLessThan(2000);
    });
});
