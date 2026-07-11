/**
 * #170 — candidate-scoring runs skip the display-only conversion tax-cost work.
 *
 * The #164 display-fidelity counterfactual (a second solveRetirementYear with the
 * conversion forced to $0) and the #159 working-year finite-difference
 * decomposition are REPORTING-ONLY: the optimizer scores timelines on balances
 * and rothConversion.amount, never on taxCost. Scoring runs (engine-direct
 * conversion search, joint withdrawal-order search, the MC h*-cap derivation)
 * therefore pass `skipDisplayRefinement` and skip that work; the final
 * user-facing projection is re-run with the refinement ON, so displayed
 * taxAmount stays finite-difference-exact (pinned by ConversionTaxDisplay.test).
 *
 * Pins, all with INVENTED numbers:
 *   1. flag on → the #164 counterfactual re-solve does NOT happen (the reported
 *      taxAmount keeps the cheap estimate and the display decision-log entry is
 *      absent), while everything decision-side is identical;
 *   2. flag on → the #159 working-year decomposition is skipped ($0 reported),
 *      with identical amounts/taxes/balances;
 *   3. search parity — the engine-direct search picks the SAME plan with the
 *      same score/diagnostics with and without the flag;
 *   4. the optimizer's final projection still reports the exact
 *      finite-difference taxAmount (the refined re-run of the winner).
 */

import { describe, it, expect } from 'vitest';

import { solveRetirementYear, type YearSolverInput } from '../../services/simulation/YearSolver';
import {
    searchConversionPlanByEngine,
    extractConversionPlan,
    applyChosenWithdrawalOrder,
} from '../../services/simulation/EngineDirectConversionSearch';
import {
    runSimulation,
    runSimulationWithOptimization,
    buildDpSolveInputs,
} from '../../components/Objects/Assumptions/useSimulation';
import { type SimulationYear } from '../../components/Objects/Assumptions/SimulationEngine';
import { buildTradValuation, terminalAfterTaxNetWorth } from '../../tabs/Future/tabs/FutureUtils';

import { InvestedAccount, SavedAccount, type BrokerageLot, type AnyAccount } from '../../components/Objects/Accounts/models';
import { WorkIncome, FutureSocialSecurityIncome, type AnyIncome } from '../../components/Objects/Income/models';
import { OtherExpense, FoodExpense } from '../../components/Objects/Expense/models';
import { type AssumptionsState, defaultAssumptions, createBuiltinMilestones } from '../../components/Objects/Assumptions/AssumptionsContext';
import { type TaxState } from '../../components/Objects/Taxes/TaxContext';

const NOW = new Date().getFullYear();
// Fixed mid-year reference date so paired runs prorate year 0 identically.
const REF_DATE = new Date(NOW, 6, 1);

function makeTaxState(filingStatus: TaxState['filingStatus'] = 'Single'): TaxState {
    return {
        filingStatus,
        stateResidency: 'Texas', // no state income tax — isolates federal effects
        deductionMethod: 'Standard',
        fedOverride: null,
        ficaOverride: null,
        stateOverride: null,
        year: NOW,
    };
}

function realRowsByYear(timeline: SimulationYear[]): Map<number, SimulationYear> {
    return new Map(timeline.filter(y => !y.isEndOfYearProjection).map(y => [y.year, y]));
}

// =============================================================================
// 1. Solver level (#164): flag on → no counterfactual re-solve
// =============================================================================
// Same LTCG-heavy shape as ConversionTaxDisplay.test (a): the account-average
// estimate and the finite-difference truth DIVERGE here, so "taxAmount kept the
// estimate" is direct evidence the counterfactual never ran.

describe('#170 solver level: skipDisplayRefinement skips the #164 counterfactual', () => {
    const YEAR = 2025;
    const BIRTH_YEAR = 1962; // age 63: past 59.5 (no penalty), pre-65 (no IRMAA)
    const CONVERSION = 40_000;

    // Oldest FIFO lot gain ratio ≈ 0.867 vs account average 0.50 — the divergence
    // between the planning-time estimate and the finite difference.
    const lots: BrokerageLot[] = [
        { purchaseYear: 2008, costBasis: 20_000, currentValue: 150_000 },
        { purchaseYear: 2016, costBasis: 80_000, currentValue: 130_000 },
        { purchaseYear: 2022, costBasis: 100_000, currentValue: 120_000 },
    ];

    function makeInput(skipDisplayRefinement: boolean): YearSolverInput {
        const accounts: AnyAccount[] = [
            new InvestedAccount('brokerage-1', 'Brokerage', 400_000, 0, 0, 0.001, 'Brokerage', false, 0, 200_000, undefined, [], lots.map(l => ({ ...l }))),
            new InvestedAccount('trad-1', 'Traditional IRA', 600_000, 0, 0, 0.001, 'Traditional IRA', false, 0),
            new InvestedAccount('roth-1', 'Roth IRA', 60_000, 0, 0, 0.001, 'Roth IRA', false, 0),
        ];
        const assumptions: AssumptionsState = {
            ...defaultAssumptions,
            milestones: createBuiltinMilestones(BIRTH_YEAR, 60, 100),
            investments: {
                ...defaultAssumptions.investments,
                taxOptimizationEnabled: true,
                acaAware: false,
                returnRates: { ror: 0 },
            },
            withdrawalStrategy: [
                { id: 'ws-1', name: 'Brokerage', accountId: 'brokerage-1' },
                { id: 'ws-2', name: 'Traditional IRA', accountId: 'trad-1' },
                { id: 'ws-3', name: 'Roth IRA', accountId: 'roth-1' },
            ],
        };
        return {
            year: YEAR,
            currentAge: YEAR - BIRTH_YEAR,
            isRetired: true,
            incomes: [] as AnyIncome[],
            expenses: [new OtherExpense('living-1', 'Living Expenses', 80_000, 'Annually', new Date(2020, 0, 1))],
            totalLivingExpenses: 80_000,
            rmdAmount: 0,
            accounts,
            withdrawalOrder: [
                { accountId: 'brokerage-1' },
                { accountId: 'trad-1' },
                { accountId: 'roth-1' },
            ],
            taxState: makeTaxState(),
            assumptions,
            taxOptimizationEnabled: true,
            acaAware: false,
            dpConversionPlan: new Map([[YEAR, CONVERSION]]),
            skipDisplayRefinement,
        };
    }

    it('keeps the cheap estimate, drops the display decision entry, and changes nothing decision-side', () => {
        const refined = solveRetirementYear(makeInput(false));
        const skipped = solveRetirementYear(makeInput(true));

        // Both executed the same conversion.
        expect(refined.conversion?.amount).toBe(CONVERSION);
        expect(skipped.conversion?.amount).toBe(CONVERSION);

        // The refined solve rewrote taxAmount to the finite difference; the
        // flagged solve kept the estimate. On this fixture they DIVERGE — direct
        // evidence the counterfactual re-solve never ran under the flag.
        expect(Math.abs(refined.conversion!.taxAmount - skipped.conversion!.taxAmount)).toBeGreaterThan(1);

        // The "Conversion tax cost (display)" decision entry is written only by
        // the counterfactual pass — absent under the flag, present without it.
        const displayEntries = (p: typeof refined) =>
            p.decisions.filter(d => d.description.startsWith('Conversion tax cost (display)'));
        expect(displayEntries(refined).length).toBe(1);
        expect(displayEntries(skipped).length).toBe(0);

        // Reporting-only: everything decision-side is identical.
        expect(skipped.tax.total).toBeCloseTo(refined.tax.total, 6);
        expect(skipped.tax.federal).toBeCloseTo(refined.tax.federal, 6);
        expect(skipped.tax.capitalGainsLT).toBeCloseTo(refined.tax.capitalGainsLT, 6);
        expect(skipped.conversion!.netToRoth).toBe(refined.conversion!.netToRoth);
        const grossSold = (p: typeof refined) =>
            p.withdrawals.reduce((s, w) => s + w.gross, 0);
        expect(grossSold(skipped)).toBeCloseTo(grossSold(refined), 6);
    });
});

// =============================================================================
// 2. Working year (#159): flag on → finite-difference decomposition skipped
// =============================================================================
// Gap-year scenario (same shape as WorkingYearConversions.test): a working-year
// plan entry executes in an income-gap year; with the flag the decomposition is
// skipped ($0 reported) while the executed amounts and balances are identical.

describe('#170 working-year level: skipDisplayRefinement skips the #159 decomposition', () => {
    const BIRTH_YEAR = NOW - 50;
    const GAP_YEAR = NOW + 3;
    const CONV = 40_000;

    function makeScenario() {
        const assumptions: AssumptionsState = {
            ...defaultAssumptions,
            demographics: {},
            milestones: createBuiltinMilestones(BIRTH_YEAR, 60, 80),
            income: { ...defaultAssumptions.income, salaryGrowth: 0 },
            macro: { ...defaultAssumptions.macro, inflationRate: 0, inflationAdjusted: false },
            investments: {
                ...defaultAssumptions.investments,
                returnRates: { ror: 0 },
                autoRothConversions: false,
                taxOptimizationEnabled: true,
                rothConversionStrategy: 'dp-precomputed' as const,
            },
            withdrawalStrategy: [
                { id: 'ws-cash', name: 'Cash', accountId: 'acc-cash' },
                { id: 'ws-brk', name: 'Brokerage', accountId: 'acc-brk' },
                { id: 'ws-trad', name: 'Traditional', accountId: 'acc-trad' },
                { id: 'ws-roth', name: 'Roth', accountId: 'acc-roth' },
            ],
        };
        const mkJob = (id: string, fromYear: number, toYear: number) => new WorkIncome(
            id, 'Salary', 140_000, 'Annually', 'Yes',
            0, 0, 0, 0, '', null, 'FIXED',
            new Date(fromYear, 0, 1), new Date(toYear, 11, 31),
        );
        // 2-year modeled income gap at NOW+3 / NOW+4.
        const incomes = [mkJob('inc-job1', NOW - 5, NOW + 2), mkJob('inc-job2', NOW + 5, NOW + 9)];
        const accounts: AnyAccount[] = [
            new InvestedAccount('acc-trad', 'Traditional 401k', 900_000, 0, 30, 0, 'Traditional 401k', false, 1.0, 900_000),
            new InvestedAccount('acc-brk', 'Brokerage', 300_000, 0, 10, 0, 'Brokerage', false, 1.0, 300_000),
            new InvestedAccount('acc-roth', 'Roth IRA', 30_000, 0, 10, 0, 'Roth IRA', false, 1.0, 30_000),
            new SavedAccount('acc-cash', 'Cash', 40_000, 0),
        ];
        const expenses = [new OtherExpense('exp-living', 'Living', 60_000, 'Annually', new Date(NOW - 5, 0, 1))];
        return { accounts, incomes, expenses, assumptions, taxState: makeTaxState() };
    }

    it('reports $0 tax cost under the flag; amounts, taxes, and balances are identical', { timeout: 120_000 }, () => {
        const s = makeScenario();
        const run = (skip: boolean) => runSimulation(
            6, s.accounts, s.incomes, s.expenses, s.assumptions, s.taxState,
            undefined, { referenceDate: REF_DATE, dpConversionPlan: new Map([[GAP_YEAR, CONV]]), skipDisplayRefinement: skip },
        );
        const refined = realRowsByYear(run(false));
        const skipped = realRowsByYear(run(true));
        const refinedRow = refined.get(GAP_YEAR)!;
        const skippedRow = skipped.get(GAP_YEAR)!;

        // Same executed conversion either way.
        expect(refinedRow.rothConversion?.amount).toBeCloseTo(CONV, 0);
        expect(skippedRow.rothConversion?.amount).toBeCloseTo(CONV, 0);

        // Refined run decomposes the real cost; the flagged run reports $0.
        expect(refinedRow.rothConversion!.taxCost).toBeGreaterThan(500);
        expect(skippedRow.rothConversion!.taxCost).toBe(0);

        // Reporting-only: the year's taxes and every terminal balance match.
        expect(skippedRow.taxDetails.fed).toBeCloseTo(refinedRow.taxDetails.fed, 6);
        expect(skippedRow.taxDetails.state).toBeCloseTo(refinedRow.taxDetails.state, 6);
        const lastRefined = refined.get(NOW + 6)!;
        const lastSkipped = skipped.get(NOW + 6)!;
        for (const acc of lastRefined.accounts) {
            const twin = lastSkipped.accounts.find(a => a.id === acc.id)!;
            expect(twin.amount).toBeCloseTo(acc.amount, 6);
        }
    });
});

// =============================================================================
// 3. Search parity: identical chosen plan/score with and without the flag
// =============================================================================

describe('#170 engine-direct search parity with skipDisplayRefinement', () => {
    // Small retired household (no seeds → no DP solve needed): trad-heavy with
    // SS from 67, so the search actually schedules conversions to compare.
    const BIRTH_YEAR = NOW - 65; // already retired (retire age 60), 20-year horizon
    const YEARS = 20;

    function makeScenario() {
        const assumptions: AssumptionsState = {
            ...defaultAssumptions,
            demographics: {},
            milestones: createBuiltinMilestones(BIRTH_YEAR, 60, 85),
            income: { ...defaultAssumptions.income, salaryGrowth: 0 },
            macro: { ...defaultAssumptions.macro, inflationRate: 0, inflationAdjusted: false },
            investments: {
                ...defaultAssumptions.investments,
                returnRates: { ror: 5 },
                autoRothConversions: false,
                taxOptimizationEnabled: true,
                rothConversionStrategy: 'dp-precomputed' as const,
                acaAware: false,
            },
            withdrawalStrategy: [
                { id: 'ws-cash', name: 'Cash', accountId: 'acc-cash' },
                { id: 'ws-brk', name: 'Brokerage', accountId: 'acc-brk' },
                { id: 'ws-trad', name: 'Traditional', accountId: 'acc-trad' },
                { id: 'ws-roth', name: 'Roth', accountId: 'acc-roth' },
            ],
        };
        const incomes = [new FutureSocialSecurityIncome('inc-ss', 'Social Security', 67, 2_500, NOW)];
        const accounts: AnyAccount[] = [
            new InvestedAccount('acc-trad', 'Traditional 401k', 800_000, 0, 30, 0, 'Traditional 401k', false, 1.0, 800_000),
            new InvestedAccount('acc-brk', 'Brokerage', 300_000, 0, 10, 0, 'Brokerage', false, 1.0, 200_000),
            new InvestedAccount('acc-roth', 'Roth IRA', 50_000, 0, 10, 0, 'Roth IRA', false, 1.0, 50_000),
            new SavedAccount('acc-cash', 'Cash', 40_000, 0),
        ];
        const expenses = [new FoodExpense('exp-living', 'Living', 60_000, 'Annually', new Date(NOW, 0, 1))];
        return { accounts, incomes, expenses, assumptions, taxState: makeTaxState() };
    }

    it('same chosen plan, label, headroom, sim count, and score', { timeout: 240_000 }, () => {
        const s = makeScenario();
        const baselineAssumptions: AssumptionsState = {
            ...s.assumptions,
            investments: { ...s.assumptions.investments, rothConversionStrategy: 'rate-match' },
        };
        const baselineTl = runSimulation(
            YEARS, s.accounts, s.incomes, s.expenses, baselineAssumptions, s.taxState,
            undefined, { referenceDate: REF_DATE, conversionMode: 'std-ded-only' },
        );
        const { dpInputs } = buildDpSolveInputs(
            s.accounts, s.incomes, s.expenses, s.assumptions, s.taxState, baselineTl,
        );
        expect(dpInputs.contexts.length).toBeGreaterThan(0);
        const ruler = buildTradValuation(baselineTl, s.assumptions, s.taxState);

        const search = (skip: boolean) => {
            const scorePlan = (plan: Map<number, number>) => {
                const tl = runSimulation(
                    YEARS, s.accounts, s.incomes, s.expenses, s.assumptions, s.taxState,
                    undefined, { referenceDate: REF_DATE, dpConversionPlan: plan, skipDisplayRefinement: skip },
                );
                return { afterTaxNW: terminalAfterTaxNetWorth(tl, ruler), timeline: tl };
            };
            return searchConversionPlanByEngine(dpInputs.contexts, scorePlan, {
                baseline: {
                    afterTaxNW: terminalAfterTaxNetWorth(baselineTl, ruler),
                    timeline: baselineTl,
                    plan: extractConversionPlan(baselineTl),
                },
                startingTradBalance: dpInputs.currentTradBalance,
            });
        };

        const flagged = search(true);
        const unflagged = search(false);

        // Identical chosen plan (the optimizer never reads taxCost)…
        expect([...flagged.conversionsByYear.entries()].sort((a, b) => a[0] - b[0]))
            .toEqual([...unflagged.conversionsByYear.entries()].sort((a, b) => a[0] - b[0]));
        // …identical diagnostics…
        expect(flagged.diagnostics.bestLabel).toBe(unflagged.diagnostics.bestLabel);
        expect(flagged.diagnostics.bestHeadroom).toBe(unflagged.diagnostics.bestHeadroom);
        expect(flagged.diagnostics.sims).toBe(unflagged.diagnostics.sims);
        // …identical score and executed conversions on the winning timelines.
        expect(terminalAfterTaxNetWorth(flagged.winningTimeline, ruler))
            .toBeCloseTo(terminalAfterTaxNetWorth(unflagged.winningTimeline, ruler), 6);
        expect([...extractConversionPlan(flagged.winningTimeline).entries()])
            .toEqual([...extractConversionPlan(unflagged.winningTimeline).entries()]);
    });
});

// =============================================================================
// 4. Final projection: the optimizer's displayed taxAmount is still the exact
//    finite difference (the refined re-run of the winner)
// =============================================================================

describe('#170 final projection keeps the finite-difference display (#164)', () => {
    // High-SS, large-Traditional — a regime where the search picks a non-baseline
    // winner with conversions (same shape as the joint-optimizer wiring test).
    const BIRTH_YEAR = NOW - 60;
    const YEARS = 30; // retire 60 → LE 90

    const assumptions: AssumptionsState = {
        ...defaultAssumptions,
        demographics: {},
        milestones: createBuiltinMilestones(BIRTH_YEAR, 60, 90),
        income: { ...defaultAssumptions.income, salaryGrowth: 0 },
        macro: { ...defaultAssumptions.macro, inflationRate: 0, inflationAdjusted: false },
        investments: {
            ...defaultAssumptions.investments,
            returnRates: { ror: 6 },
            autoRothConversions: false,
            taxOptimizationEnabled: true,
            rothConversionStrategy: 'dp-precomputed' as const,
            rothConversionUserSituation: 'self-liquidate' as const,
            acaAware: false, // keep the year-tax accessor below exhaustive
        },
        withdrawalStrategy: [
            { id: 'ws-cash', name: 'Cash', accountId: 'acc-cash' },
            { id: 'ws-brk', name: 'Brokerage', accountId: 'acc-brk' },
            { id: 'ws-trad', name: 'Traditional', accountId: 'acc-trad' },
            { id: 'ws-roth', name: 'Roth', accountId: 'acc-roth' },
        ],
    };
    const accounts = (): AnyAccount[] => [
        new InvestedAccount('acc-trad', 'Traditional 401k', 1_200_000, 0, 30, 0, 'Traditional 401k', false, 1.0, 1_200_000),
        new InvestedAccount('acc-brk', 'Brokerage', 350_000, 0, 10, 0, 'Brokerage', false, 1.0, 250_000),
        new InvestedAccount('acc-roth', 'Roth IRA', 80_000, 0, 10, 0, 'Roth IRA', false, 1.0, 80_000),
        new SavedAccount('acc-cash', 'Cash', 50_000, 0),
    ];
    const incomes = () => [new FutureSocialSecurityIncome('inc-ss', 'Social Security', 67, 3_500, NOW)];
    const expenses = () => [new FoodExpense('exp-living', 'Living', 75_000, 'Annually', new Date(NOW, 0, 1))];

    it('taxCost at a conversion year equals the year-tax delta vs a zeroed-year replay', { timeout: 240_000 }, () => {
        const result = runSimulationWithOptimization(
            YEARS, accounts(), incomes(), expenses(), assumptions, makeTaxState(), undefined, REF_DATE,
        );
        const executedPlan = extractConversionPlan(result);
        // Premise: a non-baseline winner with conversions (else the refined
        // re-run never fires and this scenario needs re-tuning, not the code).
        expect(executedPlan.size).toBeGreaterThan(0);
        const jointLog = result[0].logs.find(l => l.includes('[joint optimizer]'));
        expect(jointLog).toBeDefined();
        expect(jointLog).not.toContain('conversions: std-ded-baseline');

        // Replay assumptions: the chosen order + the executed plan, exactly what
        // the optimizer's final refined re-run executed.
        const validIds = new Set(accounts().map(a => a.id));
        const chosenAssumptions = applyChosenWithdrawalOrder(
            assumptions, result[0].chosenWithdrawalOrder, validIds,
        );
        const rows = realRowsByYear(result);
        // The conversion year with the largest reported cost — the strongest pin.
        const [year, row] = [...rows.entries()]
            .filter(([, r]) => (r.rothConversion?.amount ?? 0) > 0)
            .sort((a, b) => (b[1].rothConversion!.taxCost) - (a[1].rothConversion!.taxCost))[0];
        expect(row.rothConversion!.taxCost).toBeGreaterThan(100);

        // Zero out ONLY that year's conversion: prior years are identical, so the
        // zeroed run's year-Y row IS the #164 counterfactual for year Y.
        const zeroedPlan = new Map(executedPlan);
        zeroedPlan.delete(year);
        const zeroed = realRowsByYear(runSimulation(
            YEARS, accounts(), incomes(), expenses(), chosenAssumptions, makeTaxState(),
            undefined, { referenceDate: REF_DATE, dpConversionPlan: zeroedPlan },
        )).get(year)!;
        expect(zeroed.rothConversion).toBeUndefined();

        const totalTax = (r: SimulationYear) =>
            r.taxDetails.fed + r.taxDetails.state + r.taxDetails.fica +
            r.taxDetails.capitalGains + r.taxDetails.withdrawalOrdinaryTax + r.taxDetails.niit +
            (r.taxDetails.irmaa ?? 0) + (r.taxDetails.aca ?? 0);
        const finiteDifference = totalTax(row) - totalTax(zeroed);
        expect(Math.abs(row.rothConversion!.taxCost - finiteDifference)).toBeLessThanOrEqual(1);
    });
});
