/**
 * Monte Carlo reporting layer (fp-review F4/F7/F11) — after-tax percentiles,
 * the paired std-ded baseline arm, and conversion-facing folds.
 *
 * These tests certify REPORTING only: every fixture is real engine output
 * (runMonteCarloSimulationSync / runSimulation + analyzeScenario), never a
 * hand-fabricated shape, and every expectation is an independent recompute of
 * the same fold from the same data. Conversion EXECUTION (the #98 policy, the
 * selective cap) is pinned elsewhere (roth-cookbook/mc-*.test.ts) and must not
 * shift here.
 */
import { describe, it, expect } from 'vitest';
import {
    runMonteCarloSimulationSync,
    buildMcAfterTaxRuler,
    mcYearsToRun,
    computeHorizonTriptych,
    TRIPTYCH_AGES,
} from '../../services/MonteCarloEngine';
import {
    analyzeScenario,
    computeConversionStats,
    totalConvertedInTimeline,
    getPercentileValue,
    crraCertaintyEquivalent,
    computeCertaintyEquivalents,
} from '../../services/MonteCarloAggregator';
import { SeededRandom } from '../../services/RandomGenerator';
import { runSimulation } from '../../components/Objects/Assumptions/useSimulation';
import { terminalAfterTaxNetWorth } from '../../tabs/Future/tabs/FutureUtils';
import {
    AssumptionsState,
    defaultAssumptions,
    createBuiltinMilestones,
} from '../../components/Objects/Assumptions/AssumptionsContext';
import { TaxState } from '../../components/Objects/Taxes/TaxContext';
import { AnyAccount, InvestedAccount, SavedAccount } from '../../components/Objects/Accounts/models';
import { FoodExpense, AnyExpense } from '../../components/Objects/Expense/models';
import type { AnyIncome } from '../../components/Objects/Income/models';
import type { MonteCarloConfig } from '../../services/MonteCarloTypes';

const TIMEOUT = { timeout: 120_000 };

const NOW = new Date().getFullYear();

/**
 * Compact retiree: 65 today, plan ends at 80 (15-year horizon), large
 * Traditional + Roth + brokerage + savings, MFJ Texas, no SS (keeps the
 * scenario fast and conversion-friendly). Rate-match strategy so no DP solve
 * runs — this exercises the reporting folds, not the #98 policy.
 */
function makeScenario(overrides?: {
    taxOptimizationEnabled?: boolean;
    autoRothConversions?: boolean;
}): {
    accounts: AnyAccount[];
    incomes: AnyIncome[];
    expenses: AnyExpense[];
    assumptions: AssumptionsState;
    taxState: TaxState;
} {
    const BY = NOW - 65;
    const assumptions: AssumptionsState = {
        ...defaultAssumptions,
        milestones: createBuiltinMilestones(BY, 65, 80),
        income: { ...defaultAssumptions.income, salaryGrowth: 0 },
        macro: { ...defaultAssumptions.macro, inflationRate: 0, inflationAdjusted: false },
        investments: {
            ...defaultAssumptions.investments,
            returnRates: { ror: 5 },
            taxOptimizationEnabled: overrides?.taxOptimizationEnabled ?? true,
            autoRothConversions: overrides?.autoRothConversions ?? true,
            rothConversionStrategy: 'rate-match',
        },
        withdrawalStrategy: [
            { id: 'ws-savings', name: 'Savings', accountId: 'acc-savings' },
            { id: 'ws-brokerage', name: 'Brokerage', accountId: 'acc-brokerage' },
            { id: 'ws-trad', name: 'Traditional IRA', accountId: 'acc-traditional' },
            { id: 'ws-roth', name: 'Roth IRA', accountId: 'acc-roth' },
        ],
    };
    const taxState: TaxState = {
        filingStatus: 'Married Filing Jointly', stateResidency: 'Texas',
        deductionMethod: 'Standard', fedOverride: null, ficaOverride: null, stateOverride: null, year: NOW,
    };
    const accounts: AnyAccount[] = [
        new InvestedAccount('acc-traditional', 'Traditional IRA', 1_200_000, 0, 10, 0, 'Traditional IRA', true, 0.1, 1_200_000),
        new InvestedAccount('acc-roth', 'Roth IRA', 150_000, 0, 10, 0, 'Roth IRA', true, 0.1, 150_000),
        new InvestedAccount('acc-brokerage', 'Brokerage', 500_000, 0, 10, 0, 'Brokerage', true, 0.1, 350_000),
        new SavedAccount('acc-savings', 'Savings', 60_000, 3),
    ];
    return {
        accounts,
        incomes: [],
        expenses: [new FoodExpense('exp-living', 'Living Expenses', 70_000, 'Annually', new Date(NOW, 0, 1))],
        assumptions, taxState,
    };
}

const mcConfig = (o: Partial<MonteCarloConfig> = {}): MonteCarloConfig => ({
    enabled: true, numScenarios: 10, seed: 4242, returnMean: 5, returnStdDev: 15, preset: 'custom', ...o,
});

const pctl = (values: number[], p: number): number =>
    getPercentileValue([...values].sort((a, b) => a - b), p);

describe('F4 — per-path after-tax terminal percentiles', TIMEOUT, () => {
    it('summary.afterTaxPercentiles equals an independent ruler-valued fold of the same paths', () => {
        const sc = makeScenario();
        const cfg = mcConfig();
        const summary = runMonteCarloSimulationSync(
            cfg, sc.accounts, sc.incomes, sc.expenses, sc.assumptions, sc.taxState, {},
        );
        expect(summary.afterTaxPercentiles).toBeDefined();

        // Independent recompute: same seed stream, same per-path sims, same ruler
        // construction, folded outside the engine.
        const years = mcYearsToRun(sc.assumptions);
        const ruler = buildMcAfterTaxRuler(years, sc.accounts, sc.incomes, sc.expenses, sc.assumptions, sc.taxState);
        const rng = new SeededRandom(cfg.seed);
        const afterTax: number[] = [];
        for (let i = 0; i < cfg.numScenarios; i++) {
            const returns = rng.generateReturns(years, cfg.returnMean, cfg.returnStdDev);
            const tl = runSimulation(years, sc.accounts, sc.incomes, sc.expenses, sc.assumptions, sc.taxState, returns, {});
            afterTax.push(terminalAfterTaxNetWorth(tl, ruler));
        }

        expect(Math.abs(summary.afterTaxPercentiles!.p10 - pctl(afterTax, 10))).toBeLessThan(1);
        expect(Math.abs(summary.afterTaxPercentiles!.p50 - pctl(afterTax, 50))).toBeLessThan(1);
        expect(Math.abs(summary.afterTaxPercentiles!.p90 - pctl(afterTax, 90))).toBeLessThan(1);
    });

    it('after-tax median sits below the nominal median when Traditional remains (deferred tax > 0)', () => {
        const sc = makeScenario({ taxOptimizationEnabled: false, autoRothConversions: false });
        const summary = runMonteCarloSimulationSync(
            mcConfig(), sc.accounts, sc.incomes, sc.expenses, sc.assumptions, sc.taxState, {},
        );
        const nominalP50 = summary.percentiles.p50[summary.percentiles.p50.length - 1].netWorth;
        expect(summary.afterTaxPercentiles!.p50).toBeLessThan(nominalP50);
        expect(summary.afterTaxPercentiles!.p10).toBeLessThanOrEqual(summary.afterTaxPercentiles!.p50);
        expect(summary.afterTaxPercentiles!.p50).toBeLessThanOrEqual(summary.afterTaxPercentiles!.p90);
    });
});

describe('F7 — paired same-seed baseline arm', TIMEOUT, () => {
    it('with conversions disabled entirely, both arms are identical: every paired delta is zero', () => {
        // The active arm (no tax-opt, no auto-conversions) and the std-ded-only
        // baseline arm both execute zero conversions, so the ONLY way any paired
        // delta can be non-zero is a seed/draw mismatch between the arms. This
        // pins the pairing exactness (common random numbers).
        const sc = makeScenario({ taxOptimizationEnabled: false, autoRothConversions: false });
        const summary = runMonteCarloSimulationSync(
            mcConfig({ compareToBaseline: true }), sc.accounts, sc.incomes, sc.expenses, sc.assumptions, sc.taxState, {},
        );
        const cmp = summary.baselineComparison;
        expect(cmp).toBeDefined();
        expect(cmp!.deltaSuccessRate).toBe(0);
        expect(cmp!.activeFailures).toBe(cmp!.baselineFailures);
        expect(Math.abs(cmp!.afterTaxDelta.p10)).toBeLessThan(1e-6);
        expect(Math.abs(cmp!.afterTaxDelta.p50)).toBeLessThan(1e-6);
        expect(Math.abs(cmp!.afterTaxDelta.p90)).toBeLessThan(1e-6);
        expect(cmp!.fractionBehindBaseline).toBe(0);
        // The baseline arm's after-tax distribution must match the active arm's.
        expect(Math.abs(cmp!.baselineAfterTax.p50 - summary.afterTaxPercentiles!.p50)).toBeLessThan(1e-6);
    });

    it('with conversions on, the comparison is present and internally consistent', () => {
        const sc = makeScenario();
        const summary = runMonteCarloSimulationSync(
            mcConfig({ compareToBaseline: true }), sc.accounts, sc.incomes, sc.expenses, sc.assumptions, sc.taxState, {},
        );
        const cmp = summary.baselineComparison!;
        expect(cmp).toBeDefined();
        expect(cmp.baselineSuccessRate).toBeGreaterThanOrEqual(0);
        expect(cmp.baselineSuccessRate).toBeLessThanOrEqual(100);
        expect(cmp.deltaSuccessRate).toBeCloseTo(summary.successRate - cmp.baselineSuccessRate, 8);
        expect(cmp.afterTaxDelta.p10).toBeLessThanOrEqual(cmp.afterTaxDelta.p50);
        expect(cmp.afterTaxDelta.p50).toBeLessThanOrEqual(cmp.afterTaxDelta.p90);
        expect(cmp.fractionBehindBaseline).toBeGreaterThanOrEqual(0);
        expect(cmp.fractionBehindBaseline).toBeLessThanOrEqual(1);
    });

    it('the arm is opt-in: no baselineComparison without the toggle', () => {
        const sc = makeScenario();
        const summary = runMonteCarloSimulationSync(
            mcConfig(), sc.accounts, sc.incomes, sc.expenses, sc.assumptions, sc.taxState, {},
        );
        expect(summary.baselineComparison).toBeUndefined();
    });
});

describe('F11 — conversion-facing folds', TIMEOUT, () => {
    it('totalConverted percentiles equal an independent per-path fold, and paths actually convert', () => {
        const sc = makeScenario();
        const cfg = mcConfig();
        const summary = runMonteCarloSimulationSync(
            cfg, sc.accounts, sc.incomes, sc.expenses, sc.assumptions, sc.taxState, {},
        );
        expect(summary.conversionStats).toBeDefined();

        // Independent recompute of the per-path totals.
        const years = mcYearsToRun(sc.assumptions);
        const rng = new SeededRandom(cfg.seed);
        const totals: number[] = [];
        for (let i = 0; i < cfg.numScenarios; i++) {
            const returns = rng.generateReturns(years, cfg.returnMean, cfg.returnStdDev);
            const tl = runSimulation(years, sc.accounts, sc.incomes, sc.expenses, sc.assumptions, sc.taxState, returns, {});
            totals.push(tl.reduce((s, y) => s + (y.isEndOfYearProjection ? 0 : (y.rothConversion?.amount ?? 0)), 0));
        }
        // The scenario is built to convert (large Trad, low ordinary income, tax-opt on).
        expect(Math.max(...totals)).toBeGreaterThan(0);
        const cs = summary.conversionStats!;
        expect(Math.abs(cs.totalConverted.p10 - pctl(totals, 10))).toBeLessThan(1);
        expect(Math.abs(cs.totalConverted.p50 - pctl(totals, 50))).toBeLessThan(1);
        expect(Math.abs(cs.totalConverted.p90 - pctl(totals, 90))).toBeLessThan(1);
        expect(cs.fractionOfPathsConverting).toBeCloseTo(totals.filter(t => t > 0).length / totals.length, 8);
    });

    it('the buy-the-dip slice classifies conversion years by the previous year\'s realized return', () => {
        // Real engine output with a CONTROLLED return sequence: real-year j grows
        // on returns[j-1], so a negative returns[t] makes year t+2's conversion an
        // "after a down year" sample. The expectation is an independent fold over
        // the same timeline the engine produced.
        const sc = makeScenario();
        const years = mcYearsToRun(sc.assumptions);
        const returns = Array.from({ length: years }, (_, i) => (i % 3 === 1 ? -20 : 8));
        const tl = runSimulation(years, sc.accounts, sc.incomes, sc.expenses, sc.assumptions, sc.taxState, returns, {});
        const scenario = analyzeScenario(0, tl, returns);
        expect(totalConvertedInTimeline(tl)).toBeGreaterThan(0);

        const stats = computeConversionStats([scenario]);

        // Independent fold over the identical timeline.
        const real = tl.filter(y => !y.isEndOfYearProjection);
        let first = -1, last = -1;
        for (let j = 1; j < real.length; j++) {
            if ((real[j].rothConversion?.amount ?? 0) > 0) { if (first < 0) first = j; last = j; }
        }
        expect(first).toBeGreaterThan(-1);
        const afterDown: number[] = [];
        const afterOther: number[] = [];
        for (let j = Math.max(first, 2); j <= last; j++) {
            const conv = real[j].rothConversion?.amount ?? 0;
            (returns[j - 2] < 0 ? afterDown : afterOther).push(conv);
        }
        const median = (a: number[]): number | null => (a.length ? pctl(a, 50) : null);
        expect(stats.medianConvertedAfterDownYear).toBe(median(afterDown));
        expect(stats.medianConvertedAfterOtherYears).toBe(median(afterOther));
        // #162: sample sizes are exposed so the UI can hide the comparison when
        // either slice is too thin for its median to mean anything.
        expect(stats.sampleYearsAfterDown).toBe(afterDown.length);
        expect(stats.sampleYearsAfterOther).toBe(afterOther.length);
    });
});

describe('F13/#160 — CRRA certainty equivalents', TIMEOUT, () => {
    it('matches hand-computed values at gamma=2 and gamma=4', () => {
        const values = [100, 200, 400];
        // gamma=2: CE = n / Σ(1/w) = 3 / (1/100 + 1/200 + 1/400) = 3/0.0175 = 1200/7
        expect(crraCertaintyEquivalent(values, 2)).toBeCloseTo(1200 / 7, 8);
        // gamma=4: CE = (mean(w^-3))^(-1/3)
        //   mean = (1e-6 + 1.25e-7 + 1.5625e-8)/3 = 3.802083e-7 → CE ≈ 138.036
        expect(crraCertaintyEquivalent(values, 4)).toBeCloseTo(138.03613466513653, 6);
        // Also pin against the direct un-normalized textbook formula — an
        // independent check on the median-normalized implementation.
        const direct = Math.pow(
            (Math.pow(100, -3) + Math.pow(200, -3) + Math.pow(400, -3)) / 3, -1 / 3,
        );
        expect(crraCertaintyEquivalent(values, 4)).toBeCloseTo(direct, 8);
    });

    it('is scale-invariant at 6-7-figure wealth (the median-normalization is numerically safe)', () => {
        const base = [42_000, 500_000, 1_500_000, 8_000_000];
        for (const gamma of [2, 4]) {
            const small = crraCertaintyEquivalent(base, gamma);
            const large = crraCertaintyEquivalent(base.map(v => v * 1000), gamma);
            expect(Number.isFinite(small)).toBe(true);
            expect(Number.isFinite(large)).toBe(true);
            // CE(k·w) = k·CE(w)
            expect(large / 1000).toBeCloseTo(small, 6);
        }
        // Degenerate distribution: CE of a sure thing is the sure thing.
        expect(crraCertaintyEquivalent([750_000, 750_000], 4)).toBeCloseTo(750_000, 6);
    });

    it('excludes failed paths and non-positive after-tax values from the solvent set', () => {
        // Path 0: positive but FAILED (mid-life deficit; #111 success flag wins).
        // Path 1, 2: solvent. Path 3: success flag set but after-tax value ≤ 0 —
        // CRRA is undefined there, guarded out with no epsilon floor.
        const values = [900, 100, 200, -50];
        const flags = [false, true, true, true];
        const ce = computeCertaintyEquivalents(values, flags);
        expect(ce).toBeDefined();
        expect(ce!.solventCount).toBe(2);
        expect(ce!.totalCount).toBe(4);
        // Hand-computed over the surviving {100, 200}:
        //   gamma=2: 2 / (1/100 + 1/200) = 400/3
        expect(ce!.gamma2).toBeCloseTo(400 / 3, 8);
        //   gamma=4: (mean(100^-3, 200^-3))^(-1/3) ≈ 121.141
        expect(ce!.gamma4).toBeCloseTo(121.14137285547595, 6);
        // No qualifying path at all → undefined (the failure rate tells that story).
        expect(computeCertaintyEquivalents([-1, 100], [true, false])).toBeUndefined();
        // Direct CE call on non-positive wealth is a loud error, not a coercion.
        expect(() => crraCertaintyEquivalent([100, 0], 2)).toThrow();
    });

    it('summary CE: gamma4 ≤ gamma2 ≤ solvent mean, matching an independent engine fold', () => {
        const sc = makeScenario();
        const cfg = mcConfig();
        const summary = runMonteCarloSimulationSync(
            cfg, sc.accounts, sc.incomes, sc.expenses, sc.assumptions, sc.taxState, {},
        );
        expect(summary.certaintyEquivalents).toBeDefined();
        const ce = summary.certaintyEquivalents!;

        // Independent recompute: same seed stream, same per-path sims, same ruler;
        // solvency from analyzeScenario's #111 success flag.
        const years = mcYearsToRun(sc.assumptions);
        const ruler = buildMcAfterTaxRuler(years, sc.accounts, sc.incomes, sc.expenses, sc.assumptions, sc.taxState);
        const rng = new SeededRandom(cfg.seed);
        const afterTax: number[] = [];
        const success: boolean[] = [];
        for (let i = 0; i < cfg.numScenarios; i++) {
            const returns = rng.generateReturns(years, cfg.returnMean, cfg.returnStdDev);
            const tl = runSimulation(years, sc.accounts, sc.incomes, sc.expenses, sc.assumptions, sc.taxState, returns, {});
            afterTax.push(terminalAfterTaxNetWorth(tl, ruler));
            success.push(analyzeScenario(i, tl, returns).success);
        }
        const expected = computeCertaintyEquivalents(afterTax, success)!;
        expect(Math.abs(ce.gamma2 - expected.gamma2)).toBeLessThan(1);
        expect(Math.abs(ce.gamma4 - expected.gamma4)).toBeLessThan(1);
        expect(ce.solventCount).toBe(expected.solventCount);
        expect(ce.totalCount).toBe(cfg.numScenarios);

        // Risk-aversion ordering: CE(γ=4) ≤ CE(γ=2) ≤ mean of the solvent values.
        const solvent = afterTax.filter((v, i) => success[i] && v > 0);
        const solventMean = solvent.reduce((s, v) => s + v, 0) / solvent.length;
        expect(ce.gamma4).toBeLessThanOrEqual(ce.gamma2 + 1e-9);
        expect(ce.gamma2).toBeLessThanOrEqual(solventMean + 1e-9);
    });
});

describe('F13/#160 — horizon triptych', TIMEOUT, () => {
    it('produces finite after-tax values at 75/85/95; the 75 column equals a direct runSimulation-to-75 valuation', () => {
        const sc = makeScenario(); // age 65 today, configured LE 80
        const trip = computeHorizonTriptych(sc.accounts, sc.incomes, sc.expenses, sc.assumptions, sc.taxState);
        expect(trip.map(h => h.age)).toEqual([...TRIPTYCH_AGES]);
        // All three horizons exceed current age + 1 — every column runs, INCLUDING
        // 95 which lies past the configured LE of 80 (the point of the stress).
        // Monotone-nondecreasing wealth is deliberately NOT asserted: dying later
        // can be poorer, and that is real.
        for (const h of trip) {
            expect(h.afterTaxNetWorth).not.toBeNull();
            expect(Number.isFinite(h.afterTaxNetWorth!)).toBe(true);
        }

        // Direct 75-horizon valuation constructed WITHOUT the triptych helper:
        // fresh milestones with End of Plan at 75, deterministic run, per-horizon ruler.
        const BY = NOW - 65;
        const a75: AssumptionsState = { ...sc.assumptions, milestones: createBuiltinMilestones(BY, 65, 75) };
        const years = mcYearsToRun(a75);
        const tl = runSimulation(years, sc.accounts, sc.incomes, sc.expenses, a75, sc.taxState, undefined, {});
        const ruler75 = buildMcAfterTaxRuler(years, sc.accounts, sc.incomes, sc.expenses, a75, sc.taxState);
        expect(trip[0].afterTaxNetWorth!).toBeCloseTo(terminalAfterTaxNetWorth(tl, ruler75), 6);
    });

    it('skips horizons at or below current age + 1', () => {
        const sc = makeScenario();
        // Re-anchor the household to age 80 today: the 75 column is behind them.
        const assumptions: AssumptionsState = {
            ...sc.assumptions,
            milestones: createBuiltinMilestones(NOW - 80, 65, 85),
        };
        const trip = computeHorizonTriptych(sc.accounts, sc.incomes, sc.expenses, assumptions, sc.taxState);
        expect(trip[0]).toEqual({ age: 75, afterTaxNetWorth: null });
        expect(trip[1].afterTaxNetWorth).not.toBeNull();
        expect(trip[2].afterTaxNetWorth).not.toBeNull();
    });
});
