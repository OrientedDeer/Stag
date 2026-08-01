/**
 * #207 × #98 — the DP drift invariant under asset allocation.
 *
 * `ctx.growthRate` is the Traditional-balance-weighted net rate the Roth-conversion DP
 * projects balances with, and the #98 comment block in useSimulation promises it lines up
 * with what Monte Carlo actually applies (`ctx.growthRate + meanShift`). Allocation gives
 * that rate a second input (the stock/bond blend) and a glidepath makes it vary BY YEAR —
 * which is why `meanShift` became a per-year schedule.
 *
 * These tests pin the two halves that a future edit could silently break:
 *   • growthRate follows the allocation blend, per account and per year;
 *   • a per-year meanShift schedule is accepted and behaves like the scalar when constant.
 */
import { describe, it, expect } from 'vitest';
import { buildDPYearContexts, planConversionsViaDP, type DPInputs } from '../../../services/simulation/RothConversionDP';
import { runSimulation } from '../../../components/Objects/Assumptions/useSimulation';
import { InvestedAccount } from '../../../components/Objects/Accounts/models';
import {
    type AssumptionsState,
    defaultAssumptions,
    createBuiltinMilestones,
} from '../../../components/Objects/Assumptions/AssumptionsContext';
import { defaultTaxState } from '../../../components/Objects/Taxes/TaxContext';

const START_YEAR = new Date().getFullYear();
const BIRTH_YEAR = START_YEAR - 60;
const RETIREMENT_AGE = 60;

function makeAssumptions(over: {
    ror?: number;
    bondRor?: number;
    stockPct?: number;
    glidepath?: AssumptionsState['investments']['allocationGlidepath'];
} = {}): AssumptionsState {
    return {
        ...defaultAssumptions,
        macro: { ...defaultAssumptions.macro, inflationAdjusted: false, inflationRate: 0 },
        milestones: createBuiltinMilestones(BIRTH_YEAR, RETIREMENT_AGE, 90),
        investments: {
            ...defaultAssumptions.investments,
            returnRates: { ror: over.ror ?? 10, bondRor: over.bondRor ?? 0 },
            defaultAllocation: { stockPct: over.stockPct ?? 100 },
            allocationGlidepath: over.glidepath,
        },
        withdrawalStrategy: [],
    };
}

const tradIRA = (stockPct?: number, expenseRatio = 0) => new InvestedAccount(
    'trad', 'Traditional IRA', 500_000, 0, 0, expenseRatio, 'Traditional IRA',
    true, 0.2, 500_000, undefined, [], [], stockPct,
);

function contextsFor(assumptions: AssumptionsState, account: InvestedAccount) {
    const baseline = runSimulation(20, [account], [], [], assumptions, defaultTaxState);
    return buildDPYearContexts(baseline, assumptions, defaultTaxState, START_YEAR, 0);
}

describe('#207 DP growth-rate invariant', () => {
    it('weights the DP growth rate by the allocation blend, not the bare stock rate', () => {
        // 40/60 stock/bond at 10%/0% → 4% gross, minus a 0.5% expense ratio → 3.5%.
        const contexts = contextsFor(makeAssumptions({ stockPct: 100 }), tradIRA(40, 0.5));
        expect(contexts.length).toBeGreaterThan(0);
        expect(contexts[0].growthRate).toBeCloseTo(0.035, 6);
    });

    it('is unchanged at 100% stock (the pre-#207 formula)', () => {
        const contexts = contextsFor(makeAssumptions({ stockPct: 100 }), tradIRA(undefined, 0.5));
        expect(contexts[0].growthRate).toBeCloseTo((10 - 0.5) / 100, 6);
    });

    it('customROR still bypasses the allocation blend', () => {
        const acct = tradIRA(20, 0);
        acct.customROR = 6;
        const contexts = contextsFor(makeAssumptions({ stockPct: 100 }), acct);
        expect(contexts[0].growthRate).toBeCloseTo(0.06, 6);
    });

    it('varies the growth rate year over year under a glidepath', () => {
        // 100% stock at 60 → 0% at 80, so each later context must drift toward the bond rate.
        const contexts = contextsFor(makeAssumptions({
            glidepath: {
                enabled: true, startAge: 60, endAge: 80, startStockPct: 100, endStockPct: 0,
            },
        }), tradIRA());

        const rates = contexts.map(c => c.growthRate);
        expect(rates.length).toBeGreaterThan(5);
        // Strictly decreasing — a single year-0 rate reused for the horizon would be flat.
        for (let i = 1; i < rates.length; i++) {
            expect(rates[i]).toBeLessThan(rates[i - 1]);
        }
        // Contexts begin the year AFTER the glidepath's start age, so the first rate is
        // already one step down from the 10% all-stock endpoint, and the last is well
        // along the way to the 0% bond endpoint.
        expect(rates[0]).toBeLessThan(0.10);
        expect(rates[0]).toBeGreaterThan(0.09);
        expect(rates[rates.length - 1]).toBeLessThan(0.06);
    });
});

describe('#207 per-year meanShift schedule', () => {
    /**
     * A minimal DP input set built from a real baseline. Deliberately SHORT — each
     * stochastic solve is a 7-node backward sweep over every context, so a full 30-year
     * horizon would put these well past the default test timeout for no extra coverage.
     */
    function dpInputs(assumptions: AssumptionsState): DPInputs {
        const account = tradIRA();
        const baseline = runSimulation(8, [account], [], [], assumptions, defaultTaxState);
        return {
            contexts: buildDPYearContexts(baseline, assumptions, defaultTaxState, START_YEAR, 0)
                .slice(0, 8),
            currentTradBalance: 500_000,
            currentRothBalance: 0,
        };
    }

    it('treats a constant schedule exactly like the equivalent scalar', () => {
        const assumptions = makeAssumptions();
        const inputs = dpInputs(assumptions);
        const opts = { returnDistribution: { stdDev: 0.15, nodes: 7 as const } };

        const scalar = planConversionsViaDP(inputs, {
            ...opts, returnDistribution: { ...opts.returnDistribution, meanShift: 0.02 },
        });
        const schedule = planConversionsViaDP(inputs, {
            ...opts,
            returnDistribution: {
                ...opts.returnDistribution,
                meanShift: new Array(inputs.contexts.length).fill(0.02),
            },
        });

        expect(Array.from(schedule.conversionsByYear.entries()))
            .toEqual(Array.from(scalar.conversionsByYear.entries()));
    // Two full stochastic backward sweeps per test — well past the 5s default once the
    // whole suite is running in parallel.
    }, 30_000);

    it('accepts a varying schedule and solves it into a well-formed plan', () => {
        const assumptions = makeAssumptions();
        const inputs = dpInputs(assumptions);
        const n = inputs.contexts.length;
        const opts = { returnDistribution: { stdDev: 0.15, nodes: 7 as const } };

        const flat = planConversionsViaDP(inputs, {
            ...opts, returnDistribution: { ...opts.returnDistribution, meanShift: 0 },
        });
        // A drift that ramps up over the horizon — the shape a glidepath produces.
        const ramped = planConversionsViaDP(inputs, {
            ...opts,
            returnDistribution: {
                ...opts.returnDistribution,
                meanShift: Array.from({ length: n }, (_, t) => (t / Math.max(1, n - 1)) * 0.04),
            },
        });

        const total = (p: typeof flat) =>
            Array.from(p.conversionsByYear.values()).reduce((s, a) => s + a, 0);
        // The ramp must produce a finite, well-formed plan (an undefined shift anywhere in
        // the sweep would poison the V-table into NaN and surface here).
        expect(Number.isFinite(total(ramped))).toBe(true);
        expect(ramped.conversionsByYear.size).toBe(flat.conversionsByYear.size);
        for (const amount of ramped.conversionsByYear.values()) {
            expect(Number.isFinite(amount)).toBe(true);
            expect(amount).toBeGreaterThanOrEqual(0);
        }
        // ...and the solver must actually READ the per-year form — the summary log renders
        // a schedule differently from a scalar.
        expect(ramped.diagnostics.summaryLogs.join(' ')).toContain('per-year');
    }, 30_000);

    it('clamps a short schedule to its last entry rather than reading undefined', () => {
        const assumptions = makeAssumptions();
        const inputs = dpInputs(assumptions);
        const opts = { returnDistribution: { stdDev: 0.15, nodes: 7 as const } };

        const short = planConversionsViaDP(inputs, {
            ...opts, returnDistribution: { ...opts.returnDistribution, meanShift: [0.02] },
        });
        const scalar = planConversionsViaDP(inputs, {
            ...opts, returnDistribution: { ...opts.returnDistribution, meanShift: 0.02 },
        });
        expect(Array.from(short.conversionsByYear.entries()))
            .toEqual(Array.from(scalar.conversionsByYear.entries()));
    }, 30_000);
});
