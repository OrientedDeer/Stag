/**
 * Unit tests for buildDPYearContexts consistency with the executed final sim.
 *
 * These guard two bugs where the DP context builder used the year-0 tax state
 * for every horizon year, optimizing against rates/filing/state that differ
 * from what the final sim (Pass 3) actually executes:
 *
 *   #3 — scheduled tax life events (state move / filing change) were invisible
 *        to the DP: every context used taxState.stateResidency / filingStatus
 *        (the year-0 values).
 *   #4 — future-year tax calibration was ignored: the DP got the un-calibrated
 *        assumptions, so it optimized against current-law rates while the final
 *        sim scaled them via assumptions.macro.taxCalibration.
 *
 * The fix routes the DP context builder through the SAME derivations the final
 * sim uses (deriveFutureAssumptions + scopeFutureTaxState in useSimulation, and
 * per-year resolveTaxEventsForYear inside buildDPYearContexts). We assert on the
 * per-year TaxParameters the contexts expose (fedParams / stateParams brackets),
 * the most direct observable of "what rates the DP is optimizing against".
 */
import { describe, it, expect } from 'vitest';
import { buildDPYearContexts } from '../../../services/simulation/RothConversionDP';
import { getIRMAAAnnualSurcharge } from '../../../data/IRMAAData';
import {
    deriveFutureAssumptions,
    runSimulationWithOptimization,
} from '../../../components/Objects/Assumptions/useSimulation';
import {
    AssumptionsState,
    defaultAssumptions,
    createBuiltinMilestones,
} from '../../../components/Objects/Assumptions/AssumptionsContext';
import { TaxState } from '../../../components/Objects/Taxes/TaxContext';
import { InvestedAccount, SavedAccount } from '../../../components/Objects/Accounts/models';
import { WorkIncome, FutureSocialSecurityIncome } from '../../../components/Objects/Income/models';
import { FoodExpense } from '../../../components/Objects/Expense/models';
import { SimulationYear } from '../../../services/simulation/types';

const START_YEAR = new Date().getFullYear();
const BIRTH_YEAR = START_YEAR - 60; // user is ~60 today
const RETIREMENT_AGE = 60;          // retire essentially now → contexts start at START_YEAR
const RETIREMENT_YEAR = BIRTH_YEAR + RETIREMENT_AGE;
const MOVE_YEAR = RETIREMENT_YEAR + 4;

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

/** Build a minimal retirement-only baseline timeline the context builder can chew on. */
function buildBaseline(): SimulationYear[] {
    const years: SimulationYear[] = [];
    for (let i = 0; i < 10; i++) {
        const year = RETIREMENT_YEAR + i;
        const trad = new InvestedAccount(
            'trad', 'Traditional IRA', 1_000_000, 0, 10, 0.0, 'Traditional IRA', true, 0.2, 1_000_000,
        );
        years.push({
            year,
            incomes: [],
            expenses: [],
            accounts: [trad],
            cashflow: {
                totalIncome: 0,
                totalExpense: 40_000,
                livingExpenses: 40_000,
                discretionary: 0,
                investedUser: 0,
                investedMatch: 0,
                totalInvested: 0,
                bucketAllocations: 0,
                bucketDetail: {},
                withdrawals: 0,
                withdrawalDetail: {},
            },
            taxDetails: {
                fed: 0, state: 0, fica: 0, preTax: 0, insurance: 0, postTax: 0,
                capitalGains: 0, withdrawalOrdinaryTax: 0, niit: 0,
            },
            logs: [],
        });
    }
    return years;
}

const baseTaxState = (overrides: Partial<TaxState> = {}): TaxState => ({
    filingStatus: 'Single',
    stateResidency: 'California',
    deductionMethod: 'Standard',
    fedOverride: null,
    ficaOverride: null,
    stateOverride: null,
    year: START_YEAR,
    ...overrides,
});

/** Highest marginal rate in a params bracket list (0 if none). */
const topRate = (brackets: { rate: number }[] | undefined): number =>
    brackets && brackets.length > 0 ? Math.max(...brackets.map(b => b.rate)) : 0;

/**
 * Lowest (first) bracket rate. Used for the exact-scale calibration check: the
 * top rate can clamp at 1.0 under a large factor (Math.min(1, rate × factor)),
 * but the bottom 10% bracket stays well below the clamp, so factor × rate lands
 * exactly.
 */
const bottomRate = (brackets: { rate: number }[] | undefined): number =>
    brackets && brackets.length > 0 ? brackets[0].rate : 0;

describe('buildDPYearContexts — scheduled tax events (#3)', () => {
    it('reflects the destination state from the move year on, origin state before', () => {
        const taxState = baseTaxState({
            stateResidency: 'California',
            taxEvents: [{ id: 'move', kind: 'stateResidency', value: 'Texas', year: MOVE_YEAR }],
        });

        const contexts = buildDPYearContexts(
            buildBaseline(), assumptions, taxState, RETIREMENT_YEAR, 0,
        );

        const before = contexts.find(c => c.year === MOVE_YEAR - 1);
        const after = contexts.find(c => c.year === MOVE_YEAR);
        expect(before).toBeDefined();
        expect(after).toBeDefined();

        // Before the move: California has progressive, non-zero state rates.
        expect(topRate(before!.stateParams?.brackets)).toBeGreaterThan(0);
        // From the move year: Texas has a single 0% bracket → no state tax.
        expect(topRate(after!.stateParams?.brackets)).toBe(0);
    });

    it('reflects a scheduled filing-status change from its year on', () => {
        const taxState = baseTaxState({
            filingStatus: 'Married Filing Jointly',
            stateResidency: 'Texas', // isolate the filing change (no state tax noise)
            taxEvents: [{ id: 'file', kind: 'filingStatus', value: 'Single', year: MOVE_YEAR }],
        });

        const contexts = buildDPYearContexts(
            buildBaseline(), assumptions, taxState, RETIREMENT_YEAR, 0,
        );

        const before = contexts.find(c => c.year === MOVE_YEAR - 1);
        const after = contexts.find(c => c.year === MOVE_YEAR);
        expect(before!.filingStatus).toBe('Married Filing Jointly');
        expect(after!.filingStatus).toBe('Single');
    });

    it('without a tax event, every context keeps the year-0 state', () => {
        const taxState = baseTaxState({ stateResidency: 'California' });
        const contexts = buildDPYearContexts(
            buildBaseline(), assumptions, taxState, RETIREMENT_YEAR, 0,
        );
        for (const c of contexts) {
            expect(topRate(c.stateParams?.brackets)).toBeGreaterThan(0); // still California
        }
    });

    // A milestone-triggered tax event must fire the year AFTER the milestone is
    // reached — matching the main sim, where a milestone's reach year only becomes
    // visible to the next year's resolveTaxEventsForYear call. The DP encodes this
    // one-year lag when reconstructing reach years from the baseline timeline.
    it('lags a milestone-triggered move one year past the reach year', () => {
        const REACH_YEAR = RETIREMENT_YEAR + 3;
        const baseline = buildBaseline();
        const reachIdx = baseline.findIndex(y => y.year === REACH_YEAR);
        baseline[reachIdx] = {
            ...baseline[reachIdx],
            milestoneEvents: [{ milestoneId: 'ms-retire', yearReached: REACH_YEAR, ageReached: RETIREMENT_AGE + 3 }],
        };

        const taxState = baseTaxState({
            stateResidency: 'California',
            taxEvents: [{ id: 'move', kind: 'stateResidency', value: 'Texas', milestoneId: 'ms-retire' }],
        });

        const contexts = buildDPYearContexts(baseline, assumptions, taxState, RETIREMENT_YEAR, 0);
        const atReach = contexts.find(c => c.year === REACH_YEAR);
        const afterReach = contexts.find(c => c.year === REACH_YEAR + 1);
        expect(atReach).toBeDefined();
        expect(afterReach).toBeDefined();

        // Reach year: the move has NOT taken effect yet (one-year lag) → California.
        expect(topRate(atReach!.stateParams?.brackets)).toBeGreaterThan(0);
        // The next year it takes effect → Texas, no state tax.
        expect(topRate(afterReach!.stateParams?.brackets)).toBe(0);
    });
});

describe('buildDPYearContexts — calibration propagation (#4 supporting)', () => {
    // This documents that buildDPYearContexts DOES scale rates when handed the
    // calibrated assumptions. It does NOT isolate bug #4 on its own (the old
    // builder also propagated whatever assumptions it was given) — the bug was
    // runSimulationWithOptimization handing it the UN-calibrated assumptions.
    // The isolating check lives in the integration describe below.
    it('scales federal bracket rates by the calibration factor', () => {
        // A modest wage so a fed override of ~1.5× computed yields a real factor.
        const income = new WorkIncome(
            'inc', 'Salary', 120_000, 'Annually', 'Yes', 0, 0, 0, 0, '', null, 'FIXED',
            new Date(START_YEAR - 5, 0, 1), new Date(START_YEAR + 40, 11, 31),
        );

        const taxState = baseTaxState({ stateResidency: 'Texas' }); // isolate fed

        // Uncalibrated contexts (what the buggy path fed the DP).
        const uncalibrated = buildDPYearContexts(
            buildBaseline(), assumptions, taxState, RETIREMENT_YEAR, 0,
        );

        // Derive the SAME calibrated assumptions the final sim uses, then build
        // contexts the way the fixed DP path does.
        const calTaxState = baseTaxState({
            stateResidency: 'Texas',
            calibrateFutureYears: true,
            fedOverride: 100_000, // will be > computed fed on $120k → factor > 1
        });
        const dpAssumptions = deriveFutureAssumptions(
            assumptions, calTaxState, [income], [], START_YEAR,
        );
        // Sanity: calibration actually produced a factor > 1.
        expect(dpAssumptions.macro.taxCalibration).toBeDefined();
        expect(dpAssumptions.macro.taxCalibration!.fed).toBeGreaterThan(1);

        const calibrated = buildDPYearContexts(
            buildBaseline(), dpAssumptions, calTaxState, RETIREMENT_YEAR, 0,
        );

        const factor = dpAssumptions.macro.taxCalibration!.fed;
        const a = uncalibrated[0];
        const b = calibrated[0];
        // The bottom (10%) federal bracket rate scales exactly by the calibration
        // factor — it stays below the 100% clamp regardless of factor size.
        expect(bottomRate(b.fedParams.brackets)).toBeCloseTo(bottomRate(a.fedParams.brackets) * factor, 5);
        expect(bottomRate(b.fedParams.brackets)).toBeGreaterThan(bottomRate(a.fedParams.brackets));
        // And the overall schedule is strictly higher under calibration.
        expect(topRate(b.fedParams.brackets)).toBeGreaterThan(topRate(a.fedParams.brackets));
    });
});

// =============================================================================
// Integration: isolate bug #4 (DP plan must react to calibration) and #3
// (DP plan must react to a scheduled state move) through the public
// runSimulationWithOptimization entry point.
//
// The DP-precomputed plan is observable as `rothConversion.amount` per year in
// the returned timeline (the final sim executes exactly the DP plan). We compare
// the TOTAL DP-planned conversion dollars across two runs that differ ONLY in
// the future-year tax state. Before the fix, the DP context builder got the
// year-0 tax state / un-calibrated assumptions for BOTH runs, so the two DP
// plans were identical → equal totals. After the fix the DP sees the executed
// future-year rates, so the plans diverge.
// =============================================================================
describe('runSimulationWithOptimization — DP plan honors future tax state', { timeout: 120_000 }, () => {
    const birthYear = 1985;
    const retirementAge = 45; // FIRE retiree so the DP has pre-SS bracket room
    const lifeExpectancy = 95;
    const yearsToSimulate = 55;

    const baseAssumptions = (): AssumptionsState => ({
        ...defaultAssumptions,
        demographics: {},
        milestones: createBuiltinMilestones(birthYear, retirementAge, lifeExpectancy),
        income: { ...defaultAssumptions.income, salaryGrowth: 0 },
        macro: {
            ...defaultAssumptions.macro,
            inflationRate: 2.5,
            inflationAdjusted: true,
            taxBracketShiftPct: 0,
            taxBracketShiftStartYear: 0,
        },
        investments: {
            ...defaultAssumptions.investments,
            returnRates: { ror: 6 },
            taxOptimizationEnabled: true,
            autoRothConversions: true,
            rothConversionStrategy: 'dp-precomputed',
        },
        withdrawalStrategy: [
            { id: 'ws-savings', name: 'Savings', accountId: 'acc-savings' },
            { id: 'ws-brokerage', name: 'Brokerage', accountId: 'acc-brokerage' },
            { id: 'ws-roth', name: 'Roth IRA', accountId: 'acc-roth' },
            { id: 'ws-trad', name: 'Traditional IRA', accountId: 'acc-traditional' },
        ],
    });

    const accounts = () => [
        new InvestedAccount('acc-traditional', 'Traditional IRA', 1_500_000, 0, 10, 0.05, 'Traditional IRA', true, 0.2, 1_500_000),
        new InvestedAccount('acc-roth', 'Roth IRA', 100_000, 0, 10, 0.05, 'Roth IRA', true, 0.2, 100_000),
        new InvestedAccount('acc-brokerage', 'Brokerage', 800_000, 0, 10, 0.05, 'Brokerage', true, 0.2, 600_000),
        new SavedAccount('acc-savings', 'Savings', 100_000, 4),
    ];
    // A small wage in the current year so calibration has a positive computed-fed
    // base to scale (override ÷ computed). Ends before retirement.
    const incomes = () => [
        new WorkIncome('inc', 'Salary', 90_000, 'Annually', 'Yes', 0, 0, 0, 0, '', null, 'FIXED',
            new Date(2025 - 5, 0, 1), new Date(birthYear + retirementAge - 1, 11, 31)),
        new FutureSocialSecurityIncome('inc-ss', 'Social Security', 67, 0, 0),
    ];
    const expenses = () => [
        new FoodExpense('exp-living', 'Living Expenses', 50_000, 'Annually', new Date('2025-01-01')),
    ];

    const totalConverted = (sim: SimulationYear[]) =>
        sim.reduce((s, y) => s + (y.rothConversion?.amount ?? 0), 0);

    // NOTE on #4: an end-to-end conversion-total comparison does NOT cleanly
    // isolate the calibration bug, because the final sim already applies
    // calibration to executed years — that perturbs account balances → the
    // std-ded baseline timeline → the DP contexts even when the DP itself reads
    // un-calibrated rates. So the conversion total diverges with OR without the
    // fix. The isolating #4 check spies on the assumptions handed to
    // buildDPYearContexts and lives in RothConversionDPCalibrationWiring.test.ts.

    it('#3: a scheduled state move changes the DP-planned conversion total', () => {
        // Compare a run that stays in a taxed state (California) for the whole
        // horizon vs one that moves to no-tax Texas partway through retirement.
        // Post-move years have NO state tax, so converting there is cheaper — the
        // DP should plan a different schedule than the stay-in-California run.
        // Pre-fix the DP used year-0 California for every context in BOTH runs →
        // identical plans → equal totals.
        const a = baseAssumptions();
        const refDate = new Date('2025-06-15');
        const moveYear = birthYear + retirementAge + 5;

        const stay: TaxState = {
            filingStatus: 'Single', stateResidency: 'California', deductionMethod: 'Standard',
            fedOverride: null, ficaOverride: null, stateOverride: null, year: 2025,
        };
        const move: TaxState = {
            ...stay,
            taxEvents: [{ id: 'move', kind: 'stateResidency', value: 'Texas', year: moveYear }],
        };

        const staySim = runSimulationWithOptimization(
            yearsToSimulate, accounts(), incomes(), expenses(), a, stay, undefined, refDate,
        );
        const moveSim = runSimulationWithOptimization(
            yearsToSimulate, accounts(), incomes(), expenses(), a, move, undefined, refDate,
        );

        const stayTotal = totalConverted(staySim);
        const moveTotal = totalConverted(moveSim);

        expect(stayTotal).toBeGreaterThan(50_000);
        expect(moveTotal).toBeGreaterThan(50_000);
        // The DP plan must respond to the scheduled state move. The bug this guards
        // (#3: every DP context built from the year-0 tax state) made the two plans
        // byte-IDENTICAL — so the assertion needs a robust "plans diverge" readout.
        //
        // Measure the response as the per-year L1 divergence of the two schedules,
        // not the difference of TOTALS: a state move legitimately reshuffles WHICH
        // years convert (deferring dollars into the no-tax TX years) and those
        // timing shifts can nearly cancel in the total. That is exactly what
        // happened after #161 (savings-first tax-opt funding): the response stayed
        // strong per-year (L1 ≈ $358k; the schedules differ from the move year
        // onward) while the total delta collapsed to ~$42k — under the old
        // |Δtotal| > 100k form this test failed on a proxy artifact, not on the
        // property. (Pre-#161 the same engine measured L1 ≈ $578k / Δtotal ≈ $218k;
        // the once-recorded "~$400k total response" pre-dates other engine shifts —
        // Δtotal has never been a stable readout, and its SIGN is not a theorem
        // either: cheaper post-move conversions also make the Traditional's EXIT
        // cheaper, a two-sided effect that can push the optimal total either way.)
        // The bound stays the STRONG $100k (never relaxed); a context-blind DP
        // scores L1 = 0 and fails it unambiguously.
        const years = new Set<number>();
        const planOf = (sim: SimulationYear[]) => {
            const m = new Map<number, number>();
            for (const y of sim) {
                if (y.isEndOfYearProjection) continue;
                m.set(y.year, y.rothConversion?.amount ?? 0);
                years.add(y.year);
            }
            return m;
        };
        const stayPlan = planOf(staySim);
        const movePlan = planOf(moveSim);
        let planDivergence = 0;
        for (const y of years) {
            planDivergence += Math.abs((stayPlan.get(y) ?? 0) - (movePlan.get(y) ?? 0));
        }
        expect(planDivergence).toBeGreaterThan(100_000);
    });
});

// =============================================================================
// #76 — head IRMAA seeding. Under the real 2-year lag, the first two Medicare
// years (ages 65-66) are billed on the pre-Medicare (ages 63-64) MAGI, which is
// typically lower (pre-RMD, and the year-65/66 conversion can't retroactively
// raise it). buildDPYearContexts has no MAGI history, so it pins a CONSTANT
// surcharge for ages 65-66 from the baseline timeline's stored year−2 MAGI —
// the surcharge ignores the Medicare year's own (possibly higher) MAGI.
//
// This block retires at 65 so the lookback years (ages 63-64) are PRE-retirement
// — the case the constant baseline seed exclusively serves after Finding 2
// (2026-06-24 review). When the lookback years are POST-retirement (early
// retiree, DP-controlled), the cost is instead attributed to the age-63/64
// context (conversion-sensitive) and the head year is pinned to 0; that case is
// covered in RothConversionDPMedicareSeed.test.ts.
// =============================================================================
describe('buildDPYearContexts — head IRMAA seeding (#76)', () => {
    // Retire at 65 so ages 65-66 are in-horizon but the lookback years (63-64)
    // are PRE-retirement (no DP conversion) — the baseline-seed path. The baseline
    // starts 2 years before retirement so ages 63-64 MAGI is available to seed.
    const HEAD_RETIREMENT_AGE = 65;
    const HEAD_RETIREMENT_YEAR = BIRTH_YEAR + HEAD_RETIREMENT_AGE;
    const HEAD_BASELINE_START_YEAR = HEAD_RETIREMENT_YEAR - 2; // age 63
    const headAssumptions: AssumptionsState = {
        ...assumptions,
        milestones: createBuiltinMilestones(BIRTH_YEAR, HEAD_RETIREMENT_AGE, 95),
    };

    /**
     * Baseline spanning ages 63..72, with each year's stored `magi` controlled
     * by `magiForAge`. Ages 63-64 are the PRE-retirement lookback years that seed
     * the age-65/66 surcharge; ages 65-66 carry a deliberately HIGH own-year magi
     * so we can prove the seed ignores it.
     */
    const buildHeadBaseline = (magiForAge: (age: number) => number): SimulationYear[] => {
        const years: SimulationYear[] = [];
        for (let i = 0; i < 11; i++) {
            const year = HEAD_BASELINE_START_YEAR + i;
            const age = year - BIRTH_YEAR;
            const trad = new InvestedAccount(
                'trad', 'Traditional IRA', 1_000_000, 0, 10, 0.0, 'Traditional IRA', true, 0.2, 1_000_000,
            );
            years.push({
                year,
                incomes: [],
                expenses: [],
                accounts: [trad],
                cashflow: {
                    totalIncome: 0, totalExpense: 40_000, livingExpenses: 40_000, discretionary: 0,
                    investedUser: 0, investedMatch: 0, totalInvested: 0, bucketAllocations: 0,
                    bucketDetail: {}, withdrawals: 0, withdrawalDetail: {},
                },
                taxDetails: {
                    fed: 0, state: 0, fica: 0, preTax: 0, insurance: 0, postTax: 0,
                    capitalGains: 0, withdrawalOrdinaryTax: 0, niit: 0,
                },
                magi: magiForAge(age),
                logs: [],
            });
        }
        return years;
    };

    // Single filer, no inflation indexing → IRMAA tier-1 cliff at $109k.
    const taxState = baseTaxState({ filingStatus: 'Single', stateResidency: 'Texas' });
    const surchargeAt = (magi: number, year: number) =>
        getIRMAAAnnualSurcharge(magi, 'Single', year, headAssumptions);

    it('seeds ages 65-66 from the pre-65 (year−2) MAGI, ignoring the Medicare year own MAGI', () => {
        // Pre-65 (ages 63-64) MAGI sits BELOW the $109k cliff → seeded surcharge
        // is $0. The Medicare years (65-66) carry a HIGH own-year MAGI ($300k,
        // well into a surcharge tier) that same-year pricing would have billed.
        const baseline = buildHeadBaseline(age => (age >= 65 ? 300_000 : 50_000));
        const contexts = buildDPYearContexts(
            baseline, headAssumptions, taxState, HEAD_RETIREMENT_YEAR, 0,
        );

        const ctx65 = contexts.find(c => c.age === 65)!;
        const ctx66 = contexts.find(c => c.age === 66)!;
        expect(ctx65.irmaaSurchargeForMAGI).toBeDefined();
        expect(ctx66.irmaaSurchargeForMAGI).toBeDefined();

        // The seeded surcharge ignores its MAGI argument: probing with the high
        // own-year MAGI still returns the pre-65 (below-cliff → $0) surcharge.
        expect(ctx65.irmaaSurchargeForMAGI!(300_000)).toBe(0);
        expect(ctx66.irmaaSurchargeForMAGI!(300_000)).toBe(0);
        // Sanity: that high MAGI WOULD have billed a real surcharge under
        // same-year pricing, so the $0 above is the seed at work, not a no-op.
        expect(surchargeAt(300_000, ctx65.year)).toBeGreaterThan(0);
    });

    it('a HIGH pre-65 MAGI seeds a real (constant) surcharge into ages 65-66 even when probed low', () => {
        // Pre-65 (ages 63-64) MAGI is HIGH (above the cliff); the Medicare years'
        // own MAGI is LOW. The seed should bill the pre-65 surcharge regardless.
        const baseline = buildHeadBaseline(age => (age >= 65 ? 40_000 : 200_000));
        const contexts = buildDPYearContexts(
            baseline, headAssumptions, taxState, HEAD_RETIREMENT_YEAR, 0,
        );

        const ctx65 = contexts.find(c => c.age === 65)!;
        const ctx66 = contexts.find(c => c.age === 66)!;
        // age-65 seeds from age-63 magi ($200k), age-66 from age-64 magi ($200k).
        const expected65 = surchargeAt(200_000, ctx65.year);
        const expected66 = surchargeAt(200_000, ctx66.year);
        expect(expected65).toBeGreaterThan(0);

        // Constant surcharge equal to the pre-65 value, independent of the probe.
        expect(ctx65.irmaaSurchargeForMAGI!(40_000)).toBe(expected65);
        expect(ctx65.irmaaSurchargeForMAGI!(999_999)).toBe(expected65);
        expect(ctx66.irmaaSurchargeForMAGI!(40_000)).toBe(expected66);
    });

    it('a normal (age 67+) Medicare year still prices IRMAA on its own MAGI', () => {
        // Outside the head window, the surcharge must remain MAGI-sensitive: the
        // seeding is an edge correction, not a blanket constant.
        const baseline = buildHeadBaseline(() => 50_000);
        const contexts = buildDPYearContexts(
            baseline, headAssumptions, taxState, HEAD_RETIREMENT_YEAR, 0,
        );
        const ctx70 = contexts.find(c => c.age === 70)!;
        expect(ctx70.irmaaSurchargeForMAGI).toBeDefined();
        // Below the cliff → 0; above it → a real surcharge. Argument-sensitive.
        expect(ctx70.irmaaSurchargeForMAGI!(50_000)).toBe(0);
        expect(ctx70.irmaaSurchargeForMAGI!(300_000)).toBe(surchargeAt(300_000, ctx70.year));
        expect(ctx70.irmaaSurchargeForMAGI!(300_000)).toBeGreaterThan(0);
    });
});

/**
 * #199 — the baseline year 0 is REALIZED when the projection starts: the engine's
 * loop begins at (startYear + 1) and NEVER re-simulates year 0, so a DP plan entry
 * there could never execute. buildDPYearContexts must therefore emit NO context for
 * baseline[0].year — including the synthetic END-OF-YEAR-PROJECTION duplicate row a
 * partial-year run pushes with that SAME year — and exactly one context per
 * plannable (re-simulated) year after it.
 *
 * The pre-#199 code only excluded year 0 inside the #159 pre-retirement gap-year
 * branch, so an ALREADY-RETIRED baseline (retirementYear <= baseline[0].year, where
 * every year is a retirement year and isGapYear is false) slipped a context — two,
 * with the EOY duplicate — into the unexecutable year 0, running the DP's internal
 * balance walk a year ahead of the realized walk.
 */
describe('buildDPYearContexts — excludes the unexecutable baseline year 0 (#199)', () => {
    // Already-retired baseline: retirementYear == the first baseline year, and the
    // first year is DUPLICATED (yearZero + its EOY-projection row share one year),
    // mirroring what runSimulation pushes for a partial-year current year.
    const buildRetiredBaselineWithEoyDup = (): SimulationYear[] => {
        const rows = buildBaseline(); // 10 rows, years RETIREMENT_YEAR .. +9
        const eoyDuplicate: SimulationYear = { ...rows[0], isEndOfYearProjection: true };
        return [rows[0], eoyDuplicate, ...rows.slice(1)];
    };

    it('emits no context for baseline year 0 and exactly one per plannable year', () => {
        const baseline = buildRetiredBaselineWithEoyDup();
        const taxState = baseTaxState();
        // retirementYear == baseline[0].year → every year is a retirement year
        // (isGapYear false), the pre-#199 code path that lets year 0 through.
        const contexts = buildDPYearContexts(
            baseline, assumptions, taxState, RETIREMENT_YEAR, 0,
        );

        const year0 = baseline[0].year;
        // No context for the realized/unexecutable year 0 (nor its EOY duplicate).
        expect(contexts.some(c => c.year === year0)).toBe(false);
        expect(contexts.every(c => c.year > year0)).toBe(true);

        // Exactly one context per plannable year (every distinct baseline year
        // strictly after year 0), no duplicates.
        const plannableYears = [...new Set(
            baseline.map(y => y.year).filter(y => y > year0),
        )].sort((a, b) => a - b);
        const contextYears = contexts.map(c => c.year).sort((a, b) => a - b);
        expect(contextYears).toEqual(plannableYears);
        // And every year appears exactly once (guards the EOY-duplicate re-entering).
        expect(new Set(contextYears).size).toBe(contextYears.length);
    });
});
