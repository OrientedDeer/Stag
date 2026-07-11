import { describe, it, expect } from 'vitest';
import { type AssumptionsState, defaultAssumptions, createBuiltinMilestones } from '../../../components/Objects/Assumptions/AssumptionsContext';
import { type TaxState } from '../../../components/Objects/Taxes/TaxContext';
import { InvestedAccount } from '../../../components/Objects/Accounts/models';
import { WorkIncome } from '../../../components/Objects/Income/models';
import { FoodExpense } from '../../../components/Objects/Expense/models';
import { runSimulation } from '../../../components/Objects/Assumptions/useSimulation';
import { buildCashflowSankeyData } from '../../../components/Charts/cashflowSankeyData';
import {
    getFlowSeries,
    getNodeSeries,
    getSeriesYears,
    simYearToSankeyInput,
    summarizeSeries,
} from '../../../components/Charts/cashflowSankeySeries';

// #205 (c): getFlowSeries/getNodeSeries walk the pure per-year builder over a REAL
// multi-year simulation (not a fabricated fixture) — the values are asserted against
// the same builder the chart renders.

const baseAssumptions: AssumptionsState = {
    ...defaultAssumptions,
    demographics: {},
    income: { ...defaultAssumptions.income, salaryGrowth: 0 },
    macro: { ...defaultAssumptions.macro, inflationRate: 0, inflationAdjusted: false },
    investments: { ...defaultAssumptions.investments, returnRates: { ror: 0 } },
};

const taxState: TaxState = {
    filingStatus: 'Single', stateResidency: 'DC', deductionMethod: 'Standard',
    fedOverride: null, ficaOverride: null, stateOverride: null, year: 2024,
};

/** A short working-years run: a salaried worker with a living expense. */
function buildTimeline() {
    const assumptions: AssumptionsState = {
        ...baseAssumptions,
        milestones: createBuiltinMilestones(1985, 67, 90), // ~age 40, working
    };
    const income = new WorkIncome('inc-1', 'Job A', 90000, 'Annually', 'Yes', 0, 0, 0, 0, '', null);
    const expense = new FoodExpense('exp-1', 'Living', 30000, 'Annually', new Date('2024-01-01'));
    const savings = new InvestedAccount('sav-1', 'Brokerage', 50000, 0, 5, 0.0, 'Brokerage', true, 0.2);
    return runSimulation(6, [savings], [income], [expense], assumptions, taxState);
}

/** Real years only, matching what the series helper aligns to. */
const realYears = (timeline: ReturnType<typeof buildTimeline>) =>
    timeline.filter(sy => !sy.isEndOfYearProjection);

describe('cashflowSankeySeries (#205c)', () => {
    it('series length equals the real-year count and years align', () => {
        const timeline = buildTimeline();
        const reals = realYears(timeline);

        const years = getSeriesYears(timeline);
        expect(years.length).toBe(reals.length);
        expect(years).toEqual(reals.map(sy => sy.year));

        const grossPay = getNodeSeries(timeline, 'Gross Pay');
        expect(grossPay.length).toBe(reals.length);
    });

    it('flow values match the per-year builder output', () => {
        const timeline = buildTimeline();
        const reals = realYears(timeline);

        // Job A → Gross Pay exists every working year; verify each value against a
        // fresh build of that year (the source of truth).
        const series = getFlowSeries(timeline, 'Job A', 'Gross Pay');
        reals.forEach((sy, i) => {
            const { data } = buildCashflowSankeyData(simYearToSankeyInput(sy));
            const link = data.links.find(l => l.source === 'Job A' && l.target === 'Gross Pay');
            expect(series[i]).toBeCloseTo(link?.value ?? 0, 6);
        });
        // A working salary flow is active (nonzero) in the first year.
        expect(series[0]).toBeGreaterThan(0);
    });

    it('node values match max(inflow, outflow) of the per-year builder', () => {
        const timeline = buildTimeline();
        const reals = realYears(timeline);

        const grossPay = getNodeSeries(timeline, 'Gross Pay');
        reals.forEach((sy, i) => {
            const { data } = buildCashflowSankeyData(simYearToSankeyInput(sy));
            let inTot = 0, outTot = 0;
            for (const l of data.links) {
                if (l.target === 'Gross Pay') inTot += l.value;
                if (l.source === 'Gross Pay') outTot += l.value;
            }
            expect(grossPay[i]).toBeCloseTo(Math.max(inTot, outTot), 6);
        });
    });

    it('returns 0 for a year in which the node/flow is absent', () => {
        const timeline = buildTimeline();
        // A node that never exists in this scenario → all zeros, full length.
        const missing = getNodeSeries(timeline, 'Withdraw: Nonexistent Account');
        expect(missing.length).toBe(realYears(timeline).length);
        expect(missing.every(v => v === 0)).toBe(true);
    });

    it('caches: same input reference returns the identical array', () => {
        const timeline = buildTimeline();
        const a = getFlowSeries(timeline, 'Job A', 'Gross Pay');
        const b = getFlowSeries(timeline, 'Job A', 'Gross Pay');
        expect(a).toBe(b); // identity, not just equality

        const n1 = getNodeSeries(timeline, 'Gross Pay');
        const n2 = getNodeSeries(timeline, 'Gross Pay');
        expect(n1).toBe(n2);

        // A different timeline reference is a cache miss → a fresh array.
        const other = buildTimeline();
        const c = getFlowSeries(other, 'Job A', 'Gross Pay');
        expect(c).not.toBe(a);
        expect(c).toEqual(a); // same deterministic scenario → same values
    });

    it('summarizeSeries reports lifetime total, peak year, and active span', () => {
        const years = [2024, 2025, 2026, 2027];
        const values = [0, 100, 250, 0];
        const s = summarizeSeries(years, values);
        expect(s.total).toBe(350);
        expect(s.peakValue).toBe(250);
        expect(s.peakYear).toBe(2026);
        expect(s.firstActiveYear).toBe(2025);
        expect(s.lastActiveYear).toBe(2026);
    });
});
