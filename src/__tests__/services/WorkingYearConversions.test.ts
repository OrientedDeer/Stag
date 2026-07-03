/**
 * #159 — pre-retirement Roth conversion windows (sabbatical / layoff gap years).
 *
 * The canonical scenario the issue names: a household models a 2-year income gap
 * before retirement (job A ends, job B starts later). Before #159 four gates made
 * that window invisible: DP contexts skipped pre-retirement years, solveWorkingYear
 * had no conversion plumbing, the fill-to-headroom family therefore never scheduled
 * pre-retirement conversions, and the executor's NOT_RETIRED skip was silent.
 *
 * These tests pin the fix end-to-end with INVENTED numbers:
 *   1. context building — gap years (and only gap years) get DP contexts, and the
 *      DP starting balances anchor on the first context year;
 *   2. execution — an injected working-year plan entry moves Traditional → Roth,
 *      its tax is charged and funded, and no money is created (ror=0 reconciliation);
 *   3. the full optimizer converts >$0 in the gap years and $0 in every
 *      full-income working year;
 *   4. a NORMAL full-income career builds no pre-retirement contexts and its
 *      working years are byte-equal to the std-ded baseline's working years;
 *   5. a scheduled conversion the executor can't honor logs WHY (no silence).
 */

import { describe, it, expect } from 'vitest';

import {
    InvestedAccount,
    SavedAccount,
    DeficitDebtAccount,
    AnyAccount,
} from '../../components/Objects/Accounts/models';
import { WorkIncome } from '../../components/Objects/Income/models';
import { OtherExpense } from '../../components/Objects/Expense/models';
import {
    AssumptionsState,
    defaultAssumptions,
    createBuiltinMilestones,
} from '../../components/Objects/Assumptions/AssumptionsContext';
import { TaxState } from '../../components/Objects/Taxes/TaxContext';
import { SimulationYear } from '../../components/Objects/Assumptions/SimulationEngine';
import {
    runSimulation,
    runSimulationWithOptimization,
    buildDpSolveInputs,
} from '../../components/Objects/Assumptions/useSimulation';
import {
    solveWorkingYear,
    solveYear,
    YearSolverInput,
    getTotalTraditionalBalance,
    getTotalRothBalance,
} from '../../services/simulation/YearSolver';

const NOW = new Date().getFullYear();
// Fixed mid-year reference date so paired runs prorate year 0 identically.
const REF_DATE = new Date(NOW, 6, 1);

const BIRTH_YEAR = NOW - 50;   // age 50 today
const RETIRE_AGE = 60;         // retirement year = NOW + 10
const RETIREMENT_YEAR = NOW + 10;
const LIFE_EXPECTANCY = 80;
const YEARS_TO_RUN = LIFE_EXPECTANCY - 50;

// Modeled 2-year income gap at ages 53-54 (job A ends after NOW+2, job B starts NOW+5).
const GAP_YEARS = [NOW + 3, NOW + 4];
const FULL_INCOME_YEARS = [NOW + 1, NOW + 2, NOW + 5, NOW + 6, NOW + 7, NOW + 8, NOW + 9];

function makeScenario(opts: { withGap: boolean; ror?: number }) {
    const { withGap, ror = 5 } = opts;

    const assumptions: AssumptionsState = {
        ...defaultAssumptions,
        demographics: {},
        milestones: createBuiltinMilestones(BIRTH_YEAR, RETIRE_AGE, LIFE_EXPECTANCY),
        income: { ...defaultAssumptions.income, salaryGrowth: 0 },
        macro: { ...defaultAssumptions.macro, inflationRate: 0, inflationAdjusted: false },
        investments: {
            ...defaultAssumptions.investments,
            returnRates: { ror },
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
        stateResidency: 'Texas', // no state income tax — isolates the federal effects
        deductionMethod: 'Standard',
        fedOverride: null,
        ficaOverride: null,
        stateOverride: null,
        year: NOW,
    };

    // $140k salary, no 401k/insurance deductions (keeps the cash math simple).
    const mkJob = (id: string, fromYear: number, toYear: number) => new WorkIncome(
        id, 'Salary', 140_000, 'Annually', 'Yes',
        0, 0, 0, 0, '', null, 'FIXED',
        new Date(fromYear, 0, 1), new Date(toYear, 11, 31),
    );
    const incomes = withGap
        ? [mkJob('inc-job1', NOW - 5, NOW + 2), mkJob('inc-job2', NOW + 5, NOW + 9)]
        : [mkJob('inc-job', NOW - 5, NOW + 9)];

    const accounts: AnyAccount[] = [
        // Large Traditional → real RMD pressure at 73+, so gap-year conversions matter.
        new InvestedAccount('acc-trad', 'Traditional 401k', 900_000, 0, 30, 0, 'Traditional 401k', false, 1.0, 900_000),
        // Brokerage with basis == amount (no embedded gains → clean reconciliation).
        new InvestedAccount('acc-brk', 'Brokerage', 300_000, 0, 10, 0, 'Brokerage', false, 1.0, 300_000),
        new InvestedAccount('acc-roth', 'Roth IRA', 30_000, 0, 10, 0, 'Roth IRA', false, 1.0, 30_000),
        new SavedAccount('acc-cash', 'Cash', 40_000, 0),
    ];

    const expenses = [new OtherExpense('exp-living', 'Living', 60_000, 'Annually', new Date(NOW - 5, 0, 1))];

    return { accounts, incomes, expenses, assumptions, taxState };
}

/** Std-ded-only baseline (the same construction production uses for DP contexts). */
function runStdDedBaseline(s: ReturnType<typeof makeScenario>): SimulationYear[] {
    const baselineAssumptions: AssumptionsState = {
        ...s.assumptions,
        investments: { ...s.assumptions.investments, rothConversionStrategy: 'rate-match' },
    };
    return runSimulation(
        YEARS_TO_RUN, s.accounts, s.incomes, s.expenses, baselineAssumptions, s.taxState,
        undefined, { referenceDate: REF_DATE, conversionMode: 'std-ded-only' },
    );
}

function realRowsByYear(timeline: SimulationYear[]): Map<number, SimulationYear> {
    return new Map(timeline.filter(y => !y.isEndOfYearProjection).map(y => [y.year, y]));
}

function sumSpendableAssets(accounts: AnyAccount[]): number {
    return accounts.reduce((s, a) =>
        (a instanceof InvestedAccount || a instanceof SavedAccount) ? s + a.amount : s, 0);
}

// =============================================================================
// 1. Gate 1 — DP contexts cover the gap years (and only the gap years)
// =============================================================================

describe('#159 buildDpSolveInputs: pre-retirement gap-year contexts', () => {
    it('gap years get contexts with work-free income; full-income working years get none', { timeout: 120_000 }, () => {
        const s = makeScenario({ withGap: true });
        const baseline = runStdDedBaseline(s);
        const { dpInputs } = buildDpSolveInputs(
            s.accounts, s.incomes, s.expenses, s.assumptions, s.taxState, baseline,
        );
        const years = dpInputs.contexts.map(c => c.year);

        // The 2 modeled gap years are in the horizon; no other pre-retirement year is.
        for (const gy of GAP_YEARS) expect(years).toContain(gy);
        for (const fy of FULL_INCOME_YEARS) expect(years).not.toContain(fy);
        expect(years).toContain(RETIREMENT_YEAR); // retirement years unchanged

        // Gap contexts: ~zero ordinary income (work income counts against headroom),
        // no RMD, and no ACA/IRMAA pricing (the engine charges neither pre-retirement).
        const gapCtx = dpInputs.contexts.find(c => c.year === GAP_YEARS[0])!;
        expect(gapCtx.nonSSOrdinaryIncomeExclRMD).toBeLessThan(1_000);
        expect(gapCtx.rmdDivisor).toBe(0);
        expect(gapCtx.acaOptions).toBeUndefined();
        expect(gapCtx.irmaaSurchargeForMAGI).toBeUndefined();

        // The horizon STARTS at the first gap year, and the DP's starting Traditional
        // is the balance ENTERING that year (end of the prior baseline year).
        expect(dpInputs.contexts[0].year).toBe(GAP_YEARS[0]);
        const priorRow = baseline.find(y => y.year === GAP_YEARS[0] - 1 && !y.isEndOfYearProjection)!;
        expect(dpInputs.currentTradBalance).toBeCloseTo(
            getTotalTraditionalBalance(priorRow.accounts), 0,
        );
    });

    it('a normal full-income career builds NO pre-retirement contexts', { timeout: 120_000 }, () => {
        const s = makeScenario({ withGap: false });
        const baseline = runStdDedBaseline(s);
        const { dpInputs } = buildDpSolveInputs(
            s.accounts, s.incomes, s.expenses, s.assumptions, s.taxState, baseline,
        );
        expect(dpInputs.contexts.length).toBeGreaterThan(0);
        expect(dpInputs.contexts[0].year).toBe(RETIREMENT_YEAR);
        expect(dpInputs.contexts.every(c => c.year >= RETIREMENT_YEAR)).toBe(true);
    });
});

// =============================================================================
// 2. Gates 2+4 — solveWorkingYear executes a planned conversion, tax accounted
// =============================================================================

describe('#159 working-year conversion execution (injected plan, ror = 0)', () => {
    it('moves Traditional → Roth, charges the conversion tax, and creates no money', { timeout: 120_000 }, () => {
        const s = makeScenario({ withGap: true, ror: 0 });
        const gapYear = GAP_YEARS[0];
        const CONV = 40_000;

        const run = (plan: Map<number, number>) => runSimulation(
            6, s.accounts, s.incomes, s.expenses, s.assumptions, s.taxState,
            undefined, { referenceDate: REF_DATE, dpConversionPlan: plan },
        );
        const withConv = realRowsByYear(run(new Map([[gapYear, CONV]]))).get(gapYear)!;
        const without = realRowsByYear(run(new Map())).get(gapYear)!;

        // Neither run borrowed (clean reconciliation surface).
        for (const row of [withConv, without]) {
            expect(row.accounts.some(a => a instanceof DeficitDebtAccount && a.amount > 1)).toBe(false);
        }

        // The conversion row is recorded and executed in full.
        expect(withConv.rothConversion).toBeDefined();
        expect(withConv.rothConversion!.amount).toBeCloseTo(CONV, 0);
        expect(withConv.rothConversion!.taxCost).toBeGreaterThan(500);

        // Balances moved: Traditional down by the conversion, Roth up by it
        // (spending is funded from cash/brokerage, so Traditional is otherwise untouched).
        expect(getTotalTraditionalBalance(withConv.accounts))
            .toBeCloseTo(getTotalTraditionalBalance(without.accounts) - CONV, 0);
        expect(getTotalRothBalance(withConv.accounts))
            .toBeCloseTo(getTotalRothBalance(without.accounts) + CONV, 0);

        // The conversion is ordinary income: federal tax and MAGI both rise.
        expect(withConv.taxDetails.fed).toBeGreaterThan(without.taxDetails.fed + 500);
        expect(Math.abs((withConv.magi ?? 0) - (without.magi ?? 0) - CONV)).toBeLessThan(5);

        // NO MONEY CREATION (ror = 0): the only cross-run wealth difference is the
        // extra tax paid. cashflow.totalExpense differs exactly by the netted tax.
        const assetDelta = sumSpendableAssets(withConv.accounts) - sumSpendableAssets(without.accounts);
        const expenseDelta = withConv.cashflow.totalExpense - without.cashflow.totalExpense;
        expect(assetDelta).toBeLessThan(0); // paying conversion tax costs real money
        expect(Math.abs(assetDelta + expenseDelta)).toBeLessThan(2);
    });

    it('clamps a plan entry larger than the Traditional balance and logs the clamp', () => {
        const input = unitWorkingInput({ planAmount: 2_000_000 });
        const plan = solveWorkingYear(input);
        expect(plan.conversion).not.toBeNull();
        // Clamped to the whole Traditional balance ($80k in the unit fixture).
        expect(plan.conversion!.amount).toBeCloseTo(80_000, 0);
        expect(plan.decisions.some(d =>
            d.category === 'conversion' && /clamped/i.test(d.description))).toBe(true);
    });

    it('books the finite-difference conversion tax into the year federal tax', () => {
        const withPlan = solveWorkingYear(unitWorkingInput({ planAmount: 25_000 }));
        const noPlan = solveWorkingYear(unitWorkingInput({ planAmount: 0 }));
        expect(withPlan.conversion).not.toBeNull();
        expect(withPlan.conversion!.amount).toBeCloseTo(25_000, 0);
        // tax.federal includes the conversion's fed tax; taxAmount is the finite difference.
        expect(withPlan.tax.federal - noPlan.tax.federal)
            .toBeCloseTo(withPlan.conversion!.federalTaxCost, 2);
        expect(withPlan.conversion!.taxAmount)
            .toBeCloseTo(withPlan.conversion!.federalTaxCost + withPlan.conversion!.stateTaxCost, 2);
        expect(withPlan.magi - noPlan.magi).toBeCloseTo(25_000, 0);
    });
});

// =============================================================================
// 3. End-to-end — the optimizer fills the gap-year window
// =============================================================================

describe('#159 optimizer: the chosen plan uses the pre-retirement window', () => {
    it('converts >$0 in the gap years and $0 in every full-income working year', { timeout: 300_000 }, () => {
        const s = makeScenario({ withGap: true });
        const timeline = runSimulationWithOptimization(
            YEARS_TO_RUN, s.accounts, s.incomes, s.expenses, s.assumptions, s.taxState,
            undefined, REF_DATE,
        );
        const byYear = realRowsByYear(timeline);

        for (const gy of GAP_YEARS) {
            const row = byYear.get(gy)!;
            expect(row.rothConversion?.amount ?? 0).toBeGreaterThan(1_000);
            // Executed on the working-year path: the row is a pre-retirement year.
            expect(gy).toBeLessThan(RETIREMENT_YEAR);
        }
        for (const fy of FULL_INCOME_YEARS) {
            expect(byYear.get(fy)!.rothConversion?.amount ?? 0).toBe(0);
        }
    });
});

// =============================================================================
// 4. Normal career — working years identical to the std-ded baseline
// =============================================================================

describe('#159 normal career: no behavioral change in working years', () => {
    it('optimized working years are byte-equal to the baseline working years', { timeout: 300_000 }, () => {
        const s = makeScenario({ withGap: false });
        const baseline = runStdDedBaseline(s);
        const optimized = runSimulationWithOptimization(
            YEARS_TO_RUN, s.accounts, s.incomes, s.expenses, s.assumptions, s.taxState,
            undefined, REF_DATE,
        );
        const baseByYear = realRowsByYear(baseline);
        const optByYear = realRowsByYear(optimized);

        for (let year = NOW + 1; year < RETIREMENT_YEAR; year++) {
            const o = optByYear.get(year)!;
            const b = baseByYear.get(year)!;
            // No conversion ever lands in a full-income working year…
            expect(o.rothConversion).toBeUndefined();
            // …and the year's economics are BYTE-EQUAL to the plan-free baseline.
            expect(o.taxDetails.fed).toBe(b.taxDetails.fed);
            expect(o.taxDetails.state).toBe(b.taxDetails.state);
            expect(o.magi).toBe(b.magi);
            expect(o.cashflow.totalExpense).toBe(b.cashflow.totalExpense);
            expect(getTotalTraditionalBalance(o.accounts)).toBe(getTotalTraditionalBalance(b.accounts));
            expect(getTotalRothBalance(o.accounts)).toBe(getTotalRothBalance(b.accounts));
        }
    });
});

// =============================================================================
// 5. Executor-skip logging — never silent
// =============================================================================

/**
 * Minimal single-year working-year solver input: $120k wages, $80k Traditional,
 * (optionally) a Roth target, plenty of brokerage. Invented numbers.
 */
function unitWorkingInput(opts: {
    planAmount: number;
    taxOptimizationEnabled?: boolean;
    includeRoth?: boolean;
}): YearSolverInput {
    const { planAmount, taxOptimizationEnabled = true, includeRoth = true } = opts;
    const year = NOW;
    const birthYear = year - 45;

    const wages = new WorkIncome(
        'inc-1', 'Salary', 120_000, 'Annually', 'Yes',
        0, 0, 0, 0, '', null, 'FIXED',
        new Date(year - 5, 0, 1), new Date(year + 10, 11, 31),
    );
    const accounts: AnyAccount[] = [
        new InvestedAccount('trad-1', 'Traditional 401k', 80_000, 0, 10, 0, 'Traditional 401k', false, 1.0, 80_000),
        new InvestedAccount('brk-1', 'Brokerage', 200_000, 0, 10, 0, 'Brokerage', false, 1.0, 200_000),
    ];
    if (includeRoth) {
        accounts.push(new InvestedAccount('roth-1', 'Roth IRA', 10_000, 0, 10, 0, 'Roth IRA', false, 1.0, 10_000));
    }

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
        milestones: createBuiltinMilestones(birthYear, 67, 95),
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
        currentAge: 45,
        isRetired: false,
        incomes: [wages],
        expenses: [new OtherExpense('living-1', 'Living', 50_000, 'Annually', new Date(year - 5, 0, 1))],
        totalLivingExpenses: 50_000,
        rmdAmount: 0,
        accounts,
        withdrawalOrder: [{ accountId: 'brk-1' }, { accountId: 'trad-1' }],
        taxState,
        assumptions,
        taxOptimizationEnabled,
        acaAware: false,
        dpConversionPlan: planAmount > 0 ? new Map([[year, planAmount]]) : new Map(),
    };
}

describe('#159 executor-skip logging: a scheduled conversion is never skipped silently', () => {
    it('working year + tax optimization disabled → decision log says why', () => {
        const plan = solveWorkingYear(unitWorkingInput({ planAmount: 25_000, taxOptimizationEnabled: false }));
        expect(plan.conversion).toBeNull();
        expect(plan.decisions.some(d =>
            d.category === 'conversion'
            && /Skipped scheduled Roth conversion/.test(d.description)
            && /tax optimization is disabled/.test(d.description))).toBe(true);
    });

    it('working year + no Roth account to receive → decision log says why', () => {
        const plan = solveWorkingYear(unitWorkingInput({ planAmount: 25_000, includeRoth: false }));
        expect(plan.conversion).toBeNull();
        expect(plan.decisions.some(d =>
            d.category === 'conversion'
            && /Skipped scheduled Roth conversion/.test(d.description)
            && /no Roth account/.test(d.description))).toBe(true);
    });

    it('retirement path (planConversionDP) with tax optimization disabled → logged skip, not silence', () => {
        const input: YearSolverInput = {
            ...unitWorkingInput({ planAmount: 25_000, taxOptimizationEnabled: false }),
            isRetired: true,
            incomes: [], // retired: no wages
        };
        const plan = solveYear(input);
        expect(plan.conversion).toBeNull();
        expect(plan.taxOptimizationTarget?.limitingFactor).toBe('OPTIMIZATION_DISABLED');
        expect(plan.decisions.some(d =>
            d.category === 'conversion'
            && /Skipped scheduled Roth conversion/.test(d.description)
            && /tax optimization is disabled/.test(d.description))).toBe(true);
    });
});
