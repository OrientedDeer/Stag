import { describe, it, expect } from 'vitest';
import { type AssumptionsState, defaultAssumptions, createBuiltinMilestones } from '../../../components/Objects/Assumptions/AssumptionsContext';
import { type TaxState } from '../../../components/Objects/Taxes/TaxContext';
import { InvestedAccount, DebtAccount } from '../../../components/Objects/Accounts/models';
import { WorkIncome } from '../../../components/Objects/Income/models';
import { LoanExpense, FoodExpense } from '../../../components/Objects/Expense/models';
import { runSimulation } from '../../../components/Objects/Assumptions/useSimulation';
import { buildCashflowSankeyData } from '../../../components/Charts/cashflowSankeyData';
import { CLASS_TO_CATEGORY } from '../../../components/Objects/Expense/models';

/**
 * #147 — Cashflow Sankey: the "Net Pay" node must balance (inflow ≈ outflow)
 * when a debt is on the priority list and the surplus paydown reduces (or
 * clears) the linked loan's balance.
 *
 * The bug: the #60 surplus paydown reduced the linked LoanExpense's balance in
 * `nextExpenses` BEFORE `buildCashflowDetail` categorized it, so the loan's
 * regular payment was amortized off the POST-paydown balance and undershot
 * `cashflow.livingExpenses` (the solver's PRE-paydown total). The Sankey then
 * subtracted the big pre-paydown total but emitted only the small post-paydown
 * per-category links → Net Pay inflow > outflow by ~the loan's regular+extra
 * payment (the full payment when the paydown cleared the loan).
 *
 * The fix builds the cashflow-detail expense categories off the PRE-paydown loan
 * balances, so the regular payment shows at its true amount and the extra
 * principal appears ONLY in the separate "Pay Down" bucket — they don't
 * cannibalize each other and the Net Pay node balances again.
 *
 * This test runs the REAL engine and feeds each SimulationYear through the same
 * `buildCashflowSankeyData` the chart uses (same field mapping as CashflowTabs),
 * then asserts the builder's own imbalance detector reports NO Net-Pay imbalance.
 */
describe('#147 Cashflow Sankey — Net Pay balances with a priority-list debt paydown', () => {
    const birthYear = 1990;
    const retirementAge = 65;
    const yearsToSimulate = 12; // a working-years window where surplus pays the debt down

    const taxState: TaxState = {
        filingStatus: 'Single',
        stateResidency: 'DC',
        deductionMethod: 'Standard',
        fedOverride: null,
        ficaOverride: null,
        stateOverride: null,
        year: 2025,
    };

    // Base assumptions: strong income → large surplus → the priority-list debt is
    // paid down (and cleared) in the early years. Inflation off for clean math.
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

    // A debt flagged for surplus paydown PLUS a brokerage REMAINDER, so once the
    // loan clears the surplus keeps flowing (exercises the cleared-loan corner —
    // the worst case, where the categorized payment collapsed to ~$0 in the bug).
    const withDebtPriority: AssumptionsState = {
        ...baseAssumptions,
        priorities: [
            { id: 'p-loan', name: 'Pay down: Car Loan', type: 'DEBT', accountId: 'acc-carloan', capType: 'REMAINDER' },
            { id: 'p-brok', name: 'Brokerage', type: 'INVESTMENT', accountId: 'acc-brokerage', capType: 'REMAINDER' },
        ],
    };

    const makeAccounts = () => [
        new DebtAccount('acc-carloan', 'Car Loan Debt', 20000, 'exp-carloan', 6.0),
        new InvestedAccount('acc-savings', 'Savings', 30000, 0, 10, 0.05, 'Brokerage', true, 1.0, 30000),
        new InvestedAccount('acc-brokerage', 'Brokerage', 0, 0, 10, 0.05, 'Brokerage', true, 1.0, 0),
    ];
    const makeIncomes = () => [
        new WorkIncome('inc-work', 'Job', 120000, 'Annually', 'Yes', 0, 0, 0, 0, '', null, 'FIXED'),
    ];
    // Car loan: $20k @ 6%, $400/mo regular payment (+ implicit extra via surplus).
    const makeExpenses = () => [
        new LoanExpense(
            'exp-carloan', 'Car Loan', 20000, 'Monthly', 6.0, 'Compounding',
            400, 'No', 0, 'acc-carloan',
            new Date(2025, 0, 1), new Date(2035, 0, 1),
        ),
        new FoodExpense('exp-living', 'Living Expenses', 36000, 'Annually', new Date(2025, 0, 1)),
    ];

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

    it('reports NO Net Pay imbalance in any year a paydown happens (regression)', () => {
        const sim = runSimulation(
            yearsToSimulate, makeAccounts(), makeIncomes(), makeExpenses(),
            withDebtPriority, taxState,
        );

        // Sanity: the surplus paydown actually fires (bucketDetail for the debt > 0
        // in at least one year), otherwise the test wouldn't exercise the bug.
        const paydownYears = sim.filter(y => (y.cashflow.bucketDetail['acc-carloan'] ?? 0) > 0);
        expect(paydownYears.length, 'surplus must pay down the flagged debt in ≥1 year').toBeGreaterThan(0);

        // Scope to ENGINE years — the years that carry a `cashflowDetail` produced
        // by buildCashflowDetail. That is the exact surface #147 governs (and what
        // the chart actually renders for projected years). The synthetic baseline
        // "Year 0" and the partial-year EOY adjustment have no cashflowDetail and
        // take the Sankey's raw-expenses FALLBACK path; the partial-year carries a
        // pre-existing imbalance that is identical with or without the debt priority
        // (verified), so it is out of scope for this regression.
        const engineYears = sim.filter(y => y.cashflowDetail);
        expect(engineYears.length, 'should have engine-projected years').toBeGreaterThan(0);

        for (const y of engineYears) {
            const { imbalances, error } = sankeyForYear(y);
            expect(error, `sankey build error in ${y.year}`).toBeNull();
            const netPay = imbalances.find(im => im.nodeName === 'Net Pay');
            expect(
                netPay,
                netPay
                    ? `Net Pay unbalanced in ${y.year}: in=${netPay.inflows.toFixed(2)} out=${netPay.outflows.toFixed(2)} Δ=${netPay.difference.toFixed(2)}`
                    : undefined,
            ).toBeUndefined();
            // No node should be unbalanced, but Net Pay is the one #147 broke.
            expect(imbalances, `unexpected Sankey imbalances in ${y.year}: ${JSON.stringify(imbalances)}`).toHaveLength(0);
        }
    });

    it("the loan's expense category reflects the FULL regular payment, not the reduced one", () => {
        const sim = runSimulation(
            yearsToSimulate, makeAccounts(), makeIncomes(), makeExpenses(),
            withDebtPriority, taxState,
        );

        // Same scenario with the debt NOT flagged — the loan amortizes on schedule,
        // so its categorized payment is the true regular payment (no paydown).
        const baselineSim = runSimulation(
            yearsToSimulate, makeAccounts(), makeIncomes(), makeExpenses(),
            { ...baseAssumptions, priorities: [] }, taxState,
        );

        const loanCategory = CLASS_TO_CATEGORY['LoanExpense'] || 'Other';

        // The year the surplus actually pays the loan down: the regular payment must
        // STILL show at its full scheduled amount in the loan expense category — the
        // extra principal lives only in the separate "Pay Down" bucket and must not
        // cannibalize the regular payment. Pre-fix the categorized payment was
        // amortized off the REDUCED balance and undershot (collapsing to ~$0 when the
        // paydown cleared the loan). We compare against the same-year baseline run
        // (debt NOT flagged), where the loan amortizes its true scheduled payment.
        const paydownYear = sim.find(y =>
            y.cashflowDetail && (y.cashflow.bucketDetail['acc-carloan'] ?? 0) > 0);
        expect(paydownYear, 'a year with a real paydown and cashflowDetail').toBeDefined();

        const baselineYear = baselineSim.find(b => b.year === paydownYear!.year);
        expect(baselineYear?.cashflowDetail, 'matching baseline engine year').toBeDefined();

        const flaggedLoanCat = paydownYear!.cashflowDetail!.expensesByCategory[loanCategory] ?? 0;
        const baselineLoanCat = baselineYear!.cashflowDetail!.expensesByCategory[loanCategory] ?? 0;

        // Baseline pays the full scheduled loan payment (~$400/mo × 12 ≈ $4,800).
        expect(baselineLoanCat, 'baseline loan category should be the full regular payment').toBeGreaterThan(1000);
        expect(
            Math.abs(flaggedLoanCat - baselineLoanCat),
            `loan category must show the FULL regular payment (flagged=${flaggedLoanCat}, baseline=${baselineLoanCat})`,
        ).toBeLessThan(1);
    });
});
