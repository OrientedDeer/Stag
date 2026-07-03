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
} from '../../services/MonteCarloEngine';
import {
    analyzeScenario,
    computeConversionStats,
    totalConvertedInTimeline,
    getPercentileValue,
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
    });
});
