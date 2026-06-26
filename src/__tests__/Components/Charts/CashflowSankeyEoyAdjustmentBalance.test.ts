import { describe, it, expect } from 'vitest';
import { AssumptionsState, defaultAssumptions, createBuiltinMilestones } from '../../../components/Objects/Assumptions/AssumptionsContext';
import { TaxState } from '../../../components/Objects/Taxes/TaxContext';
import { InvestedAccount, DebtAccount, SavedAccount } from '../../../components/Objects/Accounts/models';
import { WorkIncome } from '../../../components/Objects/Income/models';
import { LoanExpense, FoodExpense, OtherExpense } from '../../../components/Objects/Expense/models';
import { runSimulation } from '../../../components/Objects/Assumptions/useSimulation';
import { buildCashflowSankeyData } from '../../../components/Charts/cashflowSankeyData';

/**
 * #148 — Cashflow Sankey: the synthetic END-OF-YEAR adjustment row must keep
 * "Net Pay" balanced (inflow ≈ outflow within $1).
 *
 * The bug: that row's income / taxes / `livingExpenses` are PRORATED by
 * `remainingFraction` (mid-year → only the rest of the year remains), but it
 * carried NO `cashflowDetail`, so the Sankey took its raw-expenses FALLBACK
 * path. The fallback's residual close used the PRORATED `livingExpenses`, while
 * the emitted Net-Pay→expense links used FULL-YEAR `getAnnualAmount`. Net Pay's
 * inflow ≠ outflow by exactly `fullYearLivingNonMortgage × (1 − remainingFraction)`
 * (~$20k at the test scenario's expense level when ~2 months remain).
 *
 * The fix attaches a prorated `cashflowDetail` to the EOY row (useSimulation
 * STEP 1.75), moving it onto the Sankey's PREFERRED path — the same path every
 * engine-projected year already uses. This test runs the REAL engine with a
 * mid-year `referenceDate` so `remainingFraction ∈ (0,1)`, pulls the
 * `isEndOfYearProjection` row, and feeds its Sankey inputs through the same
 * `buildCashflowSankeyData` the chart uses (identical field mapping to
 * CashflowTabs), then asserts the builder's own imbalance detector reports NO
 * Net-Pay imbalance.
 */
describe('#148 Cashflow Sankey — Net Pay balances on the EOY-adjustment row', () => {
    const birthYear = 1990;
    const retirementAge = 65;
    const yearsToSimulate = 5;

    const taxState: TaxState = {
        filingStatus: 'Single',
        stateResidency: 'DC',
        deductionMethod: 'Standard',
        fedOverride: null,
        ficaOverride: null,
        stateOverride: null,
        year: 2025,
    };

    const baseAssumptions: AssumptionsState = {
        ...defaultAssumptions,
        demographics: {},
        milestones: createBuiltinMilestones(birthYear, retirementAge, 90),
        income: { ...defaultAssumptions.income, salaryGrowth: 0 },
        macro: { ...defaultAssumptions.macro, inflationRate: 0, inflationAdjusted: false },
        investments: {
            ...defaultAssumptions.investments,
            returnRates: { ror: 5 },
            autoRothConversions: false,
        },
        withdrawalStrategy: [],
    };

    // Same shape as #147's no-debt baseline: salaried income, a non-mortgage
    // living expense (the mismatched term), no priorities.
    const noDebtAssumptions: AssumptionsState = { ...baseAssumptions, priorities: [] };

    // With a debt flagged for surplus paydown — the issue notes the EOY imbalance
    // reproduces identically with and without a priority-list debt, so we lock that in.
    const withDebtAssumptions: AssumptionsState = {
        ...baseAssumptions,
        priorities: [
            { id: 'p-loan', name: 'Pay down: Car Loan', type: 'DEBT', accountId: 'acc-carloan', capType: 'REMAINDER' },
        ],
    };

    const makeAccounts = () => [
        new DebtAccount('acc-carloan', 'Car Loan Debt', 20000, 'exp-carloan', 6.0),
        new InvestedAccount('acc-savings', 'Savings', 30000, 0, 10, 0.05, 'Brokerage', true, 1.0, 30000),
    ];
    const makeIncomes = () => [
        new WorkIncome('inc-work', 'Job', 120000, 'Annually', 'Yes', 0, 0, 0, 0, '', null, 'FIXED'),
    ];
    const makeExpenses = () => [
        new LoanExpense(
            'exp-carloan', 'Car Loan', 20000, 'Monthly', 6.0, 'Compounding',
            400, 'No', 0, 'acc-carloan',
            new Date(2025, 0, 1), new Date(2035, 0, 1),
        ),
        new FoodExpense('exp-living', 'Living Expenses', 36000, 'Annually', new Date(2025, 0, 1)),
    ];

    // Same baseline plus a long-term GOAL funded by a monthly set-aside into a
    // reserved sinking-fund SavedAccount. A goal reports $0 from getAnnualAmount,
    // so the EOY row's `livingExpenses` (= Σ getAnnualAmount × remainingFraction)
    // legitimately EXCLUDES the set-aside — this scenario locks in that the EOY
    // row's rebuilt expense links stay on that SAME goal-excluding basis (so Net
    // Pay still balances) and guards against a refactor that reuses
    // buildCashflowDetail's goal-INCLUSIVE categories (which would unbalance the
    // row by exactly the prorated set-aside). This is the case the original #148
    // coverage missed.
    const goalAssumptions: AssumptionsState = { ...baseAssumptions, priorities: [] };
    const makeGoalAccounts = () => [
        new SavedAccount('acc-roof-fund', 'Roof (fund)', 0, 0),
        new InvestedAccount('acc-savings', 'Savings', 30000, 0, 10, 0.05, 'Brokerage', true, 1.0, 30000),
    ];
    const makeGoalExpenses = () => {
        const roofGoal = new OtherExpense('exp-roof', 'Roof', 36000, 'Monthly', new Date(2024, 0, 1));
        roofGoal.goalType = 'recurring';
        roofGoal.intervalYears = 3;
        roofGoal.goalAccountId = 'acc-roof-fund';
        return [
            new FoodExpense('exp-living', 'Living Expenses', 36000, 'Annually', new Date(2025, 0, 1)),
            roofGoal,
        ];
    };

    /** Map a SimulationYear into buildCashflowSankeyData exactly as CashflowTabs does. */
    function sankeyForYear(y: ReturnType<typeof runSimulation>[number]) {
        return buildCashflowSankeyData({
            incomes: y.incomes,
            expenses: y.expenses,
            year: y.year,
            taxes: y.taxDetails,
            bucketAllocations: y.cashflow.bucketDetail || {},
            accounts: y.accounts,
            withdrawals: y.cashflow.withdrawalDetail || {},
            rothConversion: y.rothConversion,
            cashflowDetail: y.cashflowDetail,
            livingExpenses: y.cashflow.livingExpenses,
        });
    }

    // A spread of reference months so the assertion is proration-magnitude-
    // independent: Feb (~10/12 remains), Jun (~6/12), Oct (~2/12).
    const refDates: Array<{ label: string; date: Date }> = [
        { label: 'February (large remaining fraction)', date: new Date(2025, 1, 15) },
        { label: 'June (half year)', date: new Date(2025, 5, 15) },
        { label: 'October (small remaining fraction)', date: new Date(2025, 9, 15) },
    ];

    type Factories = {
        accounts: () => ReturnType<typeof makeAccounts> | ReturnType<typeof makeGoalAccounts>;
        expenses: () => ReturnType<typeof makeExpenses> | ReturnType<typeof makeGoalExpenses>;
    };
    const baseFactories: Factories = { accounts: makeAccounts, expenses: makeExpenses };
    const goalFactories: Factories = { accounts: makeGoalAccounts, expenses: makeGoalExpenses };

    const scenarios: Array<{ label: string; assumptions: AssumptionsState; factories: Factories }> = [
        { label: 'no debt on priority list', assumptions: noDebtAssumptions, factories: baseFactories },
        { label: 'debt on priority list', assumptions: withDebtAssumptions, factories: baseFactories },
        // The case the original #148 coverage missed: a user funding a long-term goal.
        { label: 'funding a long-term goal', assumptions: goalAssumptions, factories: goalFactories },
    ];

    for (const { label: scenarioLabel, assumptions, factories } of scenarios) {
        for (const { label: monthLabel, date } of refDates) {
            it(`Net Pay balances on the EOY row (${scenarioLabel}, ${monthLabel})`, () => {
                const sim = runSimulation(
                    yearsToSimulate, factories.accounts(), makeIncomes(), factories.expenses(),
                    assumptions, taxState, undefined, { referenceDate: date },
                );

                const eoy = sim.find(y => y.isEndOfYearProjection);
                expect(eoy, 'a synthetic end-of-year adjustment row should exist mid-year').toBeDefined();

                // The fix's mechanism: the EOY row now carries a cashflowDetail
                // (preferred Sankey path) AND a prorated, non-zero living expense
                // term — so the mismatched expense term is genuinely exercised.
                expect(eoy!.cashflowDetail, 'EOY row should carry a prorated cashflowDetail (#148)').toBeDefined();
                expect(eoy!.cashflow.livingExpenses, 'EOY row should have prorated living expenses').toBeGreaterThan(0);

                const { imbalances, error } = sankeyForYear(eoy!);
                expect(error, 'sankey build error on EOY row').toBeNull();

                const netPay = imbalances.find(im => im.nodeName === 'Net Pay');
                expect(
                    netPay,
                    netPay
                        ? `Net Pay unbalanced on EOY row: in=${netPay.inflows.toFixed(2)} out=${netPay.outflows.toFixed(2)} Δ=${netPay.difference.toFixed(2)}`
                        : undefined,
                ).toBeUndefined();

                // No node should be unbalanced on the row.
                expect(
                    imbalances,
                    `unexpected Sankey imbalances on EOY row: ${JSON.stringify(imbalances)}`,
                ).toHaveLength(0);
            });
        }
    }

    it('the EOY-row expense category reflects the PRORATED living expense (not full-year)', () => {
        // Guards against a "balanced but wrong-magnitude" regression: the row is
        // prorated, so its emitted living-expense link must be the prorated slice,
        // strictly smaller than the full $36k/yr. (October ⇒ ~2/12 remains.)
        const sim = runSimulation(
            yearsToSimulate, makeAccounts(), makeIncomes(), makeExpenses(),
            noDebtAssumptions, taxState, undefined, { referenceDate: new Date(2025, 9, 15) },
        );
        const eoy = sim.find(y => y.isEndOfYearProjection);
        expect(eoy).toBeDefined();

        const livingCat = Object.entries(eoy!.cashflowDetail!.expensesByCategory)
            .reduce((sum, [, v]) => sum + v, 0);
        // remainingFraction for Oct = (11 - 9) / 12 = 2/12 ⇒ ~$6k, well under the
        // full annual $36k and matching the prorated cashflow.livingExpenses.
        expect(livingCat, 'prorated, not full-year').toBeGreaterThan(0);
        expect(livingCat, 'prorated, strictly below full annual').toBeLessThan(36000);
        // The categorized non-mortgage expenses must equal the row's living-expense
        // close term (livingExpenses − mortgage payment), within $1 — exactly the
        // consistency the fix establishes.
        expect(Math.abs(livingCat - eoy!.cashflow.livingExpenses)).toBeLessThan(1);
    });

    it('keeps the long-term-goal set-aside OFF the EOY row (close term and links agree)', () => {
        // Invariant that keeps Net Pay balanced on the EOY row when a goal is funded.
        //
        // A long-term goal reports $0 from getAnnualAmount, so the EOY row's
        // `livingExpenses` (Σ getAnnualAmount × remainingFraction, derived in the
        // year-0 baseline — NOT through SimulationEngine, which DOES add goal funding
        // to projected years) legitimately EXCLUDES the set-aside. The Sankey closes
        // the residual against that `livingExpenses`, so the row's emitted expense
        // links must stay on the SAME goal-excluding basis. If a refactor ever reused
        // buildCashflowDetail's goal-INCLUSIVE `expensesByCategory` (which emits a
        // "<name> (goal)" category) for this row, the links would carry the prorated
        // set-aside the close term does not, unbalancing Net Pay by exactly that slice
        // — the #148 bug class. This test pins the basis so that can't regress.
        const sim = runSimulation(
            yearsToSimulate, makeGoalAccounts(), makeIncomes(), makeGoalExpenses(),
            goalAssumptions, taxState, undefined, { referenceDate: new Date(2025, 5, 15) },
        );
        const eoy = sim.find(y => y.isEndOfYearProjection);
        expect(eoy, 'a synthetic end-of-year adjustment row should exist mid-year').toBeDefined();

        // Sanity-check the scenario actually funds a goal: at least one projected
        // engine year (a real, non-baseline, non-EOY row) DOES carry a "(goal)"
        // category, so the fund is genuinely live in this run.
        const startYear = eoy!.year; // EOY row shares year-0's (current) year
        const projectedHasGoal = sim
            .filter(y => !y.isEndOfYearProjection && y.year > startYear)
            .some(y => Object.keys(y.cashflowDetail?.expensesByCategory ?? {})
                .some(cat => cat.includes('(goal)')));
        expect(projectedHasGoal, 'a projected engine year should fund the goal').toBe(true);

        // The EOY row must NOT carry any "(goal)" category — the set-aside is excluded
        // from its livingExpenses, so it must be excluded from its links too.
        const eoyCats = eoy!.cashflowDetail!.expensesByCategory;
        const eoyHasGoal = Object.keys(eoyCats).some(cat => cat.includes('(goal)'));
        expect(eoyHasGoal, 'the goal set-aside must NOT leak onto the EOY row').toBe(false);

        // Close term == link sum (the balance condition), within $1.
        const linkSum = Object.values(eoyCats).reduce((sum, v) => sum + v, 0);
        expect(Math.abs(linkSum - eoy!.cashflow.livingExpenses)).toBeLessThan(1);

        // And Net Pay is balanced end-to-end.
        const { imbalances, error } = sankeyForYear(eoy!);
        expect(error).toBeNull();
        expect(
            imbalances,
            `unexpected Sankey imbalances on goal-funded EOY row: ${JSON.stringify(imbalances)}`,
        ).toHaveLength(0);
    });
});
