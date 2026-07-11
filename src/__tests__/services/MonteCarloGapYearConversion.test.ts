/**
 * #169 — MC gap-year conversions are CLOSED-LOOP (#159 follow-up).
 *
 * #159 made solveWorkingYear execute pre-retirement gap-year entries from the
 * central deterministic plan. But in Monte Carlo, the #98 stochastic-DP policy
 * lookup only covered retirement years (planConversionDP): gap-year policy
 * entries existed in the solved table yet were never consulted per path, so a
 * path whose realized returns left a much smaller (or larger) Traditional
 * balance in the gap year still converted the centrally-planned amount
 * verbatim (open-loop).
 *
 * #169 mirrors planConversionDP's policy lookup in solveWorkingYear: when
 * `mcConversionPolicy` carries an entry for the year, the executed gap-year
 * conversion is the nearest-neighbor policy lookup at the path's REALIZED
 * (Traditional, Roth IRA) state — bounded by the #89 capHeadroom fill-to cap
 * and the available Traditional balance — instead of the scheduled amount.
 *
 * All numbers below are INVENTED test fixtures. The hand-built DPPolicy tables
 * let each test pin the exact lookup the solver must perform without paying
 * for a real stochastic solve.
 */
import { describe, it, expect } from 'vitest';

import {
    InvestedAccount,
    SavedAccount,
    type AnyAccount,
} from '../../components/Objects/Accounts/models';
import { WorkIncome } from '../../components/Objects/Income/models';
import { OtherExpense } from '../../components/Objects/Expense/models';
import {
    type AssumptionsState,
    defaultAssumptions,
    createBuiltinMilestones,
} from '../../components/Objects/Assumptions/AssumptionsContext';
import { type TaxState } from '../../components/Objects/Taxes/TaxContext';
import { type SimulationYear } from '../../components/Objects/Assumptions/SimulationEngine';
import { runSimulation } from '../../components/Objects/Assumptions/useSimulation';
import {
    solveWorkingYear,
    type YearSolverInput,
    getTotalTraditionalBalance,
    getTotalRothBalance,
} from '../../services/simulation/YearSolver';
import { type DPPolicy, lookupConversionPolicy } from '../../services/simulation/RothConversionDP';
import * as TaxService from '../../components/Objects/Taxes/TaxService';

const NOW = new Date().getFullYear();
// Fixed mid-year reference date so paired runs prorate year 0 identically.
const REF_DATE = new Date(NOW, 6, 1);

// =============================================================================
// Hand-built policy table
// =============================================================================

/**
 * DPPolicy with ONE year entry and a 1-D (trad-only) table: rothBuckets = 0 and
 * a huge dRoth pin the roth index to bucket 0 for any realistic balance, so the
 * nearest-neighbor lookup is `amounts[round(trad / dB)]` (clamped to the last
 * bucket). Lets tests choose exactly what the policy returns per trad state.
 */
function makePolicy(opts: {
    year: number;
    dB: number;
    amounts: number[];
    capHeadroom?: number;
}): DPPolicy {
    const { year, dB, amounts, capHeadroom } = opts;
    return {
        tradBuckets: amounts.length - 1,
        rothBuckets: 0,
        byYear: new Map([[year, {
            table: Float64Array.from(amounts),
            dB,
            dRoth: 10_000_000,
        }]]),
        capHeadroom,
    };
}

// =============================================================================
// Unit-level fixture: a single GAP working year (no wages by default)
// =============================================================================

function gapYearInput(opts: {
    tradBalance?: number;
    planAmount?: number;
    policy?: DPPolicy;
    wagesAnnual?: number;
    taxOptimizationEnabled?: boolean;
    forceZeroConversion?: boolean;
}): YearSolverInput {
    const {
        tradBalance = 80_000,
        planAmount = 0,
        policy,
        wagesAnnual = 0,
        taxOptimizationEnabled = true,
        forceZeroConversion = false,
    } = opts;
    const year = NOW;
    const birthYear = year - 50;

    const incomes = wagesAnnual > 0
        ? [new WorkIncome(
            'inc-1', 'Salary', wagesAnnual, 'Annually', 'Yes',
            0, 0, 0, 0, '', null, 'FIXED',
            new Date(year - 5, 0, 1), new Date(year + 10, 11, 31),
        )]
        : [];

    const accounts: AnyAccount[] = [
        new InvestedAccount('trad-1', 'Traditional 401k', tradBalance, 0, 10, 0, 'Traditional 401k', false, 1.0, tradBalance),
        new InvestedAccount('brk-1', 'Brokerage', 200_000, 0, 10, 0, 'Brokerage', false, 1.0, 200_000),
        new InvestedAccount('roth-1', 'Roth IRA', 10_000, 0, 10, 0, 'Roth IRA', false, 1.0, 10_000),
    ];

    const taxState: TaxState = {
        filingStatus: 'Single',
        stateResidency: 'Texas',
        deductionMethod: 'Standard',
        fedOverride: null,
        ficaOverride: null,
        stateOverride: null,
        year,
    };
    const assumptions: AssumptionsState = {
        ...defaultAssumptions,
        milestones: createBuiltinMilestones(birthYear, 60, 90),
        macro: { ...defaultAssumptions.macro, inflationAdjusted: false },
        investments: {
            ...defaultAssumptions.investments,
            taxOptimizationEnabled,
            acaAware: false,
            returnRates: { ror: 0 },
            rothConversionStrategy: 'dp-precomputed',
        },
        withdrawalStrategy: [],
    };

    return {
        year,
        currentAge: 50,
        isRetired: false,
        incomes,
        expenses: [new OtherExpense('living-1', 'Living', 40_000, 'Annually', new Date(year - 5, 0, 1))],
        totalLivingExpenses: 40_000,
        rmdAmount: 0,
        accounts,
        withdrawalOrder: [{ accountId: 'brk-1' }, { accountId: 'trad-1' }],
        taxState,
        assumptions,
        taxOptimizationEnabled,
        acaAware: false,
        dpConversionPlan: planAmount > 0 ? new Map([[year, planAmount]]) : new Map(),
        mcConversionPolicy: policy,
        forceZeroConversion,
    };
}

/** Policy used across the unit tests: conversion scales with the trad bucket. */
function scaledPolicy(capHeadroom?: number): DPPolicy {
    // dB = $20k → trad 80k lands in bucket 4 (=$16k), trad 40k in bucket 2 (=$8k).
    return makePolicy({
        year: NOW,
        dB: 20_000,
        amounts: [0, 4_000, 8_000, 12_000, 16_000],
        capHeadroom,
    });
}

// =============================================================================
// 1. Unit: the gap-year solve consults the policy at REALIZED state
// =============================================================================

describe('#169 gap-year MC policy consult (unit: solveWorkingYear)', () => {
    it('a diverged path follows the policy lookup, not the verbatim central amount', () => {
        // Central plan scheduled $16,000 (the mean-path amount at trad = $80k).
        const onTrack = solveWorkingYear(gapYearInput({
            tradBalance: 80_000, planAmount: 16_000, policy: scaledPolicy(),
        }));
        expect(onTrack.conversion).not.toBeNull();
        expect(onTrack.conversion!.amount).toBeCloseTo(16_000, 6);

        // A crashed path enters the gap year with only $40k Traditional. The
        // policy at that realized state says $8,000 — NOT the central $16,000.
        const diverged = solveWorkingYear(gapYearInput({
            tradBalance: 40_000, planAmount: 16_000, policy: scaledPolicy(),
        }));
        expect(diverged.conversion).not.toBeNull();
        expect(diverged.conversion!.amount).toBeCloseTo(8_000, 6);
        expect(diverged.decisions.some(d =>
            d.category === 'conversion' && /#98 MC policy/.test(d.description))).toBe(true);
    });

    it('the policy can ADD a conversion the central plan lacks (bull-path adaptivity)', () => {
        const plan = solveWorkingYear(gapYearInput({
            tradBalance: 80_000, planAmount: 0, policy: scaledPolicy(),
        }));
        expect(plan.conversion).not.toBeNull();
        expect(plan.conversion!.amount).toBeCloseTo(16_000, 6);
    });

    it('the policy can ZERO OUT a scheduled conversion (near-depleted path)', () => {
        // trad $5k → nearest bucket 0 → policy $0, overriding the scheduled $16k.
        const plan = solveWorkingYear(gapYearInput({
            tradBalance: 5_000, planAmount: 16_000, policy: scaledPolicy(),
        }));
        expect(plan.conversion).toBeNull();
    });

    it('#89 capHeadroom bounds the policy amount at fill-to-(stdDed + h*)', () => {
        // Policy wants $40k at trad $80k; the cap says fill taxable income only
        // to stdDed + $2,000. With no wages/SS the realized ordinary base is $0,
        // so the executed amount is exactly stdDed + $2,000.
        const bigPolicy = makePolicy({
            year: NOW, dB: 20_000,
            amounts: [0, 10_000, 20_000, 30_000, 40_000],
            capHeadroom: 2_000,
        });
        const input = gapYearInput({ tradBalance: 80_000, planAmount: 0, policy: bigPolicy });
        const fedParams = TaxService.getTaxParameters(
            NOW, 'Single', 'federal', undefined, input.assumptions)!;
        const plan = solveWorkingYear(input);
        expect(plan.conversion).not.toBeNull();
        expect(plan.conversion!.amount).toBeCloseTo(fedParams.standardDeduction + 2_000, 6);

        // Residual gap-year wages shrink the cap dollar-for-dollar.
        const withWages = solveWorkingYear(gapYearInput({
            tradBalance: 80_000, planAmount: 0, policy: bigPolicy, wagesAnnual: 6_000,
        }));
        expect(withWages.conversion).not.toBeNull();
        expect(withWages.conversion!.amount)
            .toBeCloseTo(fedParams.standardDeduction + 2_000 - 6_000, 6);
    });

    it('the executed amount is clamped to the realized Traditional balance', () => {
        // The table cell says $50k but the account only holds $9k —
        // lookupConversionPolicy clamps to [0, trad] and the executor clamps to
        // the available balance, so the executed amount can never exceed it.
        const policy = makePolicy({ year: NOW, dB: 10_000, amounts: [0, 50_000] });
        const plan = solveWorkingYear(gapYearInput({
            tradBalance: 9_000, planAmount: 0, policy,
        }));
        expect(plan.conversion).not.toBeNull();
        expect(plan.conversion!.amount).toBeLessThanOrEqual(9_000);
    });

    it('forceZeroConversion suppresses the policy consult (display counterfactual)', () => {
        const plan = solveWorkingYear(gapYearInput({
            tradBalance: 80_000, planAmount: 16_000, policy: scaledPolicy(),
            forceZeroConversion: true,
        }));
        expect(plan.conversion).toBeNull();
    });

    it('tax optimization off → policy not consulted', () => {
        const plan = solveWorkingYear(gapYearInput({
            tradBalance: 80_000, planAmount: 0, policy: scaledPolicy(),
            taxOptimizationEnabled: false,
        }));
        expect(plan.conversion).toBeNull();
        expect(plan.decisions.some(d => /#98 MC policy/.test(d.description))).toBe(false);
    });

    it('NO policy entry for the year → byte-identical to the policy-free solve', () => {
        // Policy exists but only covers a DIFFERENT year (a non-gap working year
        // in a real run) — the solve must be indistinguishable from no policy at
        // all, both with and without a scheduled plan entry.
        const otherYearPolicy = makePolicy({
            year: NOW + 1, dB: 20_000, amounts: [0, 4_000, 8_000],
        });
        for (const planAmount of [0, 12_000]) {
            const withPolicy = solveWorkingYear(gapYearInput({ planAmount, policy: otherYearPolicy }));
            const without = solveWorkingYear(gapYearInput({ planAmount }));
            expect(withPolicy).toEqual(without);
        }
    });
});

// =============================================================================
// 2. End-to-end through runSimulation: per-path adaptivity in the gap year
// =============================================================================

const BIRTH_YEAR = NOW - 50;
const RETIRE_AGE = 60;
const RETIREMENT_YEAR = NOW + 10;
const LIFE_EXPECTANCY = 80;

// Modeled 2-year income gap at ages 53-54 (job A ends after NOW+2, job B starts NOW+5).
const GAP_YEAR = NOW + 3;

function makeScenario(opts: { withGap: boolean }) {
    const { withGap } = opts;

    const assumptions: AssumptionsState = {
        ...defaultAssumptions,
        demographics: {},
        milestones: createBuiltinMilestones(BIRTH_YEAR, RETIRE_AGE, LIFE_EXPECTANCY),
        income: { ...defaultAssumptions.income, salaryGrowth: 0 },
        macro: { ...defaultAssumptions.macro, inflationRate: 0, inflationAdjusted: false },
        investments: {
            ...defaultAssumptions.investments,
            returnRates: { ror: 5 },
            withdrawalRate: 4.0,
            autoRothConversions: false,
            taxOptimizationEnabled: true,
            rothConversionStrategy: 'dp-precomputed',
            rothConversionUserSituation: 'self-liquidate',
        },
        withdrawalStrategy: [
            { id: 'ws-cash', name: 'Cash', accountId: 'acc-cash' },
            { id: 'ws-brk', name: 'Brokerage', accountId: 'acc-brk' },
            { id: 'ws-trad', name: 'Traditional', accountId: 'acc-trad' },
            { id: 'ws-roth', name: 'Roth', accountId: 'acc-roth' },
        ],
    };

    const taxState: TaxState = {
        filingStatus: 'Single',
        stateResidency: 'Texas',
        deductionMethod: 'Standard',
        fedOverride: null,
        ficaOverride: null,
        stateOverride: null,
        year: NOW,
    };

    const mkJob = (id: string, fromYear: number, toYear: number) => new WorkIncome(
        id, 'Salary', 140_000, 'Annually', 'Yes',
        0, 0, 0, 0, '', null, 'FIXED',
        new Date(fromYear, 0, 1), new Date(toYear, 11, 31),
    );
    const incomes = withGap
        ? [mkJob('inc-job1', NOW - 5, NOW + 2), mkJob('inc-job2', NOW + 5, NOW + 9)]
        : [mkJob('inc-job', NOW - 5, NOW + 9)];

    const accounts: AnyAccount[] = [
        new InvestedAccount('acc-trad', 'Traditional 401k', 900_000, 0, 30, 0, 'Traditional 401k', false, 1.0, 900_000),
        new InvestedAccount('acc-brk', 'Brokerage', 300_000, 0, 10, 0, 'Brokerage', false, 1.0, 300_000),
        new InvestedAccount('acc-roth', 'Roth IRA', 30_000, 0, 10, 0, 'Roth IRA', false, 1.0, 30_000),
        new SavedAccount('acc-cash', 'Cash', 40_000, 0),
    ];

    const expenses = [new OtherExpense('exp-living', 'Living', 60_000, 'Annually', new Date(NOW - 5, 0, 1))];

    return { accounts, incomes, expenses, assumptions, taxState };
}

const realRowsByYear = (timeline: SimulationYear[]): Map<number, SimulationYear> =>
    new Map(timeline.filter(y => !y.isEndOfYearProjection).map(y => [y.year, y]));

const totalTrad = (accts: AnyAccount[]): number => accts
    .filter((a): a is InvestedAccount => a instanceof InvestedAccount &&
        (a.taxType === 'Traditional 401k' || a.taxType === 'Traditional IRA'))
    .reduce((s, a) => s + a.vestedAmount, 0);
const totalRothIra = (accts: AnyAccount[]): number => accts
    .filter((a): a is InvestedAccount => a instanceof InvestedAccount && a.taxType === 'Roth IRA')
    .reduce((s, a) => s + a.vestedAmount, 0);

describe('#169 end-to-end: MC paths adapt the gap-year conversion per realized state', () => {
    it('flat vs crash paths execute the policy lookup at their own balances', { timeout: 120_000 }, () => {
        const s = makeScenario({ withGap: true });

        // Policy: gap-year conversion scales with the realized Traditional
        // bucket ($150k buckets, $4k per bucket step). No capHeadroom → no cap.
        const policy = makePolicy({
            year: GAP_YEAR,
            dB: 150_000,
            amounts: [0, 4_000, 8_000, 12_000, 16_000, 20_000, 24_000, 28_000, 32_000],
        });
        // Sentinel central-plan amount: if the policy were NOT consulted, the
        // gap year would convert exactly $999 (the pre-#169 open-loop behavior).
        const plan = new Map([[GAP_YEAR, 999]]);

        const run = (yearlyReturns: number[]) => runSimulation(
            6, s.accounts, s.incomes, s.expenses, s.assumptions, s.taxState,
            yearlyReturns, { referenceDate: REF_DATE, dpConversionPlan: plan, mcConversionPolicy: policy },
        );

        const flatRows = realRowsByYear(run([5, 5, 5, 5, 5, 5]));
        const crashRows = realRowsByYear(run([-30, -30, 5, 5, 5, 5]));

        const check = (rows: Map<number, SimulationYear>): number => {
            // start-of-gap-year state = end of the prior year's row.
            const sot = rows.get(GAP_YEAR - 1)!.accounts;
            const expected = lookupConversionPolicy(
                policy, GAP_YEAR, totalTrad(sot), totalRothIra(sot))!;
            const row = rows.get(GAP_YEAR)!;
            expect(expected).toBeGreaterThan(0);
            expect(row.rothConversion).toBeDefined();
            // Executed == the policy at THIS path's realized state (not the $999 sentinel).
            expect(row.rothConversion!.amount).toBeCloseTo(expected, 0);
            return row.rothConversion!.amount;
        };

        const flatAmt = check(flatRows);
        const crashAmt = check(crashRows);
        // The crash path's realized Traditional is far smaller → smaller conversion.
        expect(crashAmt).toBeLessThan(flatAmt);
    });
});

// =============================================================================
// 3. No-gap scenario: byte-identical with a policy that has no working-year entries
// =============================================================================

describe('#169 no-gap scenario: byte-identical MC behavior', () => {
    it('working years with no policy entry are byte-equal to the policy-free run', { timeout: 120_000 }, () => {
        const s = makeScenario({ withGap: false });

        // A retirement-only policy whose table is all zeros: the retirement
        // lookup returns $0 (same as no plan entry), so EVERY row — working and
        // retirement — must be byte-equal to the run without a policy.
        const policy = makePolicy({ year: RETIREMENT_YEAR, dB: 1_000_000, amounts: [0, 0] });

        const years = 13; // through retirement + 2
        const withPolicy = realRowsByYear(runSimulation(
            years, s.accounts, s.incomes, s.expenses, s.assumptions, s.taxState,
            undefined, { referenceDate: REF_DATE, dpConversionPlan: new Map(), mcConversionPolicy: policy },
        ));
        const without = realRowsByYear(runSimulation(
            years, s.accounts, s.incomes, s.expenses, s.assumptions, s.taxState,
            undefined, { referenceDate: REF_DATE, dpConversionPlan: new Map() },
        ));

        expect([...withPolicy.keys()]).toEqual([...without.keys()]);
        for (const [year, w] of withPolicy) {
            const b = without.get(year)!;
            expect(w.rothConversion?.amount).toBe(b.rothConversion?.amount);
            expect(w.taxDetails.fed).toBe(b.taxDetails.fed);
            expect(w.taxDetails.state).toBe(b.taxDetails.state);
            expect(w.magi).toBe(b.magi);
            expect(w.cashflow.totalExpense).toBe(b.cashflow.totalExpense);
            expect(getTotalTraditionalBalance(w.accounts)).toBe(getTotalTraditionalBalance(b.accounts));
            expect(getTotalRothBalance(w.accounts)).toBe(getTotalRothBalance(b.accounts));
        }
    });
});
