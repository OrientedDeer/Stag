import { describe, it, expect } from 'vitest';

import { RSUAccount, InvestedAccount } from '../../../components/Objects/Accounts/models';
import { WorkIncome } from '../../../components/Objects/Income/models';
import { FoodExpense } from '../../../components/Objects/Expense/models';
import { runSimulation } from '../../../components/Objects/Assumptions/useSimulation';
import { buildCashflowSankeyData } from '../../../components/Charts/cashflowSankeyData';
import {
    AssumptionsState,
    defaultAssumptions,
    createBuiltinMilestones,
} from '../../../components/Objects/Assumptions/AssumptionsContext';
import { TaxState } from '../../../components/Objects/Taxes/TaxContext';

/**
 * #153 — Cashflow Sankey: the "Net Pay" node must balance on the first year an
 * RSU grant vests.
 *
 * The bug: an RSU vest is recognized at its FULL GROSS value as reinvested W-2
 * income, but only the NET shares (gross − sell-to-cover withholding) actually
 * land in the RSU account — the withheld slice was sold to pay tax. The Sankey
 * routed the GROSS amount both into Gross Pay AND back out of Net Pay to the
 * account, while the withholding was ALSO inside the Taxes node. So Net Pay's
 * inflow (gross − tax) was less than its outflow (gross reinvested) by exactly
 * the vest withholding → "Net Pay has $X inflows but $Y outflows" with Y − X ==
 * the withheld amount.
 *
 * The fix: the reinvested OUTFLOW (Net Pay → account) and the `remaining` close
 * use the NET (gross − withheld); the GROSS still flows into Gross Pay so the
 * withholding keeps a tax source. Gross Pay balances (gross in = net-to-NetPay +
 * withheld-to-Taxes) and Net Pay balances (net in = net reinvested out).
 *
 * Runs the REAL engine and feeds each SimulationYear through the same
 * `buildCashflowSankeyData` the chart uses, asserting the imbalance detector
 * reports NO Net-Pay imbalance on the vest year. (Deliberately uses a clean,
 * round, fabricated grant — 300 shares @ $40, 25% withholding — unrelated to any
 * real portfolio.)
 */
describe('#153 Cashflow Sankey — Net Pay balances on the first RSU vest year', () => {
    const BIRTH_YEAR = 1988; // working-age throughout the horizon
    const START_YEAR = new Date().getFullYear();
    // A one-year cliff anchored on the grant's fixed start date vests the next year.
    const VEST_YEAR = START_YEAR + 1;

    // Grant: 300 shares, 1-year cliff, $40/share flat (0% growth → FMV stays $40),
    // 25% sell-to-cover. Gross vest = $12,000; withheld = $3,000; net = $9,000.
    const WITHHOLDING_PCT = 25;

    const taxState: TaxState = {
        filingStatus: 'Single',
        stateResidency: 'California',
        deductionMethod: 'Standard',
        fedOverride: null,
        ficaOverride: null,
        stateOverride: null,
        year: START_YEAR,
    };

    const assumptions: AssumptionsState = {
        ...defaultAssumptions,
        demographics: {},
        milestones: createBuiltinMilestones(BIRTH_YEAR, 65, 95),
        income: { ...defaultAssumptions.income, salaryGrowth: 0 },
        macro: { ...defaultAssumptions.macro, inflationRate: 0, inflationAdjusted: false },
        investments: {
            ...defaultAssumptions.investments,
            returnRates: { ror: 0 },
            taxOptimizationEnabled: false,
            autoRothConversions: false,
        },
        withdrawalStrategy: [],
        priorities: [],
    };

    function makeIncomes() {
        // Fixed-start job (no milestone) so the RSU grant anchors on startDate and
        // its 1-year cliff vests in VEST_YEAR.
        const inc = new WorkIncome(
            'rsu-job', 'Engineer', 150000, 'Annually', 'Yes',
            0, 0, 0, 0, '', null, 'FIXED',
            new Date(START_YEAR, 0, 1),
        );
        inc.rsuVestingSchedule = 'cliff-1yr';
        inc.rsuGrantShares = 300;
        inc.rsuVestFrequency = 'quarterly';
        inc.rsuExpectedStockGrowth = 0;
        inc.rsuAccountId = 'rsu-acct';
        inc.rsuWithholdingRate = WITHHOLDING_PCT;
        return [inc];
    }
    const makeAccounts = () => [
        new RSUAccount('rsu-acct', 'Equity Grants', 0, [], 'rsu-job', undefined, 'ACME', 40),
        new InvestedAccount('acc-cash', 'Cash', 25000, 0, 10, 0, 'Brokerage', true, 1.0, 25000),
    ];
    const makeExpenses = () => [
        new FoodExpense('exp-living', 'Living', 48000, 'Annually', new Date(START_YEAR, 0, 1)),
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

    it('records the RSU vest reinvested-net = gross − withholding (builder)', () => {
        const sim = runSimulation(8, makeAccounts(), makeIncomes(), makeExpenses(), assumptions, taxState);

        const vest = sim.find(y => y.year === VEST_YEAR);
        expect(vest?.cashflowDetail, 'vest year should be an engine year with cashflowDetail').toBeDefined();

        const vestSource = vest!.cashflowDetail!.incomeBySource.find(
            s => s.kind === 'reinvested' && /RSU Vest/i.test(s.name),
        );
        expect(vestSource, 'a reinvested RSU vest income source in the vest year').toBeDefined();

        // Gross was recognized; net = gross × (1 − withholding%). This is the value
        // the Sankey routes OUT of Net Pay (the withheld slice went to Taxes).
        expect(vestSource!.amount, 'gross vest recognized').toBeGreaterThan(0);
        expect(vestSource!.reinvestedNet, 'reinvestedNet must be set for an RSU vest').toBeDefined();
        expect(vestSource!.reinvestedNet!).toBeCloseTo(
            vestSource!.amount * (1 - WITHHOLDING_PCT / 100),
            2,
        );
        // The net is strictly less than gross — the whole point.
        expect(vestSource!.reinvestedNet!).toBeLessThan(vestSource!.amount - 1);
    });

    it('labels the reinvested destination with the RSU ACCOUNT name, not the vest income name', () => {
        const sim = runSimulation(8, makeAccounts(), makeIncomes(), makeExpenses(), assumptions, taxState);

        const vest = sim.find(y => y.year === VEST_YEAR);
        const vestSource = vest!.cashflowDetail!.incomeBySource.find(
            s => s.kind === 'reinvested' && /RSU Vest/i.test(s.name),
        );
        expect(vestSource, 'a reinvested RSU vest income source in the vest year').toBeDefined();

        // The vest id is `rsu-vest-{accountId}-{incomeId}-{year}`; the Sankey destination
        // must resolve to the linked RSU account ('Equity Grants'), not the synthetic
        // vest-income name ('… RSU Vest').
        expect(vestSource!.accountName).toBe('Equity Grants');
        expect(vestSource!.accountName).not.toMatch(/RSU Vest/i);
    });

    it('reports NO Net Pay imbalance in any engine year, including the vest year (regression)', () => {
        const sim = runSimulation(8, makeAccounts(), makeIncomes(), makeExpenses(), assumptions, taxState);

        // Sanity: the vest actually fired (the RSU account holds net shares), so the
        // test genuinely exercises the reinvested-withholding path.
        const vest = sim.find(y => y.year === VEST_YEAR);
        const rsu = vest?.accounts.find(a => a instanceof RSUAccount) as RSUAccount | undefined;
        expect(rsu, 'RSU account present in the vest year').toBeDefined();
        expect(rsu!.totalShares, 'net vested shares landed in the RSU account').toBeGreaterThan(0);

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
            expect(
                imbalances,
                `unexpected Sankey imbalances in ${y.year}: ${JSON.stringify(imbalances)}`,
            ).toHaveLength(0);
        }
    });
});
