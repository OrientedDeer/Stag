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
        expect(Math.abs(moveTotal - stayTotal)).toBeGreaterThan(20_000);
    });
});
