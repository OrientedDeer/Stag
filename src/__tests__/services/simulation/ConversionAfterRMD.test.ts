/**
 * A Roth conversion in an RMD year must be sized against the Traditional
 * balance LEFT after the RMD. RMDService queues the RMD as a pending inflow, so
 * the solver used to clamp the plan to the undrained balance: executeYearPlan
 * then moved only balance − RMD, but the year's tax was computed on the full
 * planned amount, taxing the RMD dollars twice.
 */
import { describe, it, expect } from 'vitest';

import { runSimulation } from '../../../components/Objects/Assumptions/useSimulation';
import { InvestedAccount, SavedAccount, type AnyAccount } from '../../../components/Objects/Accounts/models';
import { OtherExpense } from '../../../components/Objects/Expense/models';
import {
    type AssumptionsState,
    defaultAssumptions,
    createBuiltinMilestones,
} from '../../../components/Objects/Assumptions/AssumptionsContext';
import { type TaxState } from '../../../components/Objects/Taxes/TaxContext';

const YEAR = new Date().getFullYear();

const taxState: TaxState = {
    filingStatus: 'Single',
    stateResidency: 'Texas',
    deductionMethod: 'Standard',
    fedOverride: null,
    ficaOverride: null,
    stateOverride: null,
    year: YEAR,
};

const assumptions: AssumptionsState = {
    ...defaultAssumptions,
    milestones: createBuiltinMilestones(YEAR - 80, 65, 95),
    macro: { ...defaultAssumptions.macro, inflationRate: 0, inflationAdjusted: false },
    investments: {
        ...defaultAssumptions.investments,
        returnRates: { ror: 0 },
        withdrawalStrategy: 'None',
        taxOptimizationEnabled: true,
        rothConversionStrategy: 'dp-precomputed',
        acaAware: false,
    },
    withdrawalStrategy: [
        { id: 'w-cash', name: 'Cash', accountId: 'cash' },
        { id: 'w-trad', name: 'Trad', accountId: 'trad' },
        { id: 'w-roth', name: 'Roth', accountId: 'roth' },
    ],
};

const TRAD = 100_000;

function makeAccounts(): AnyAccount[] {
    return [
        new InvestedAccount('trad', 'Trad IRA', TRAD, 0, 10, 0, 'Traditional IRA'),
        new InvestedAccount('roth', 'Roth IRA', 10_000, 0, 10, 0, 'Roth IRA', true, 0.2, 10_000),
        new SavedAccount('cash', 'Cash', 300_000, 0),
    ];
}

const living = () => [new OtherExpense('living', 'Living', 30_000, 'Annually', new Date(YEAR - 5, 0, 1))];

function run(plan: number) {
    return runSimulation(
        3, makeAccounts(), [], living(), assumptions, taxState, undefined,
        { dpConversionPlan: new Map([[YEAR, plan], [YEAR + 1, plan], [YEAR + 2, plan]]) },
    ).filter(y => !y.isEndOfYearProjection);
}

describe('Roth conversion in an RMD year', () => {
    // Age 81 in the first solved year: RMD required, and the plan asks to convert
    // the whole Traditional balance.
    const timeline = run(TRAD);
    const idx = timeline.findIndex(y => (y.rothConversion?.amount ?? 0) > 0);
    const year = timeline[idx];
    const rmd = year.rmdDetails?.totalWithdrawn ?? 0;

    it('converts only what remains after the RMD', () => {
        expect(idx).toBeGreaterThan(0);
        expect(rmd).toBeGreaterThan(0);
        expect(year.rothConversion!.amount).toBeCloseTo(TRAD - rmd, 2);
    });

    it('charges the same tax as a plan sized to the post-RMD balance', () => {
        // Same executed conversion and RMD → the same ordinary income, so the bill
        // must match. Pre-fix the over-sized plan was billed ~22% × RMD more.
        const exact = run(TRAD - rmd)[idx];
        expect(exact.rothConversion!.amount).toBeCloseTo(year.rothConversion!.amount, 2);
        expect(year.taxDetails.fed).toBeCloseTo(exact.taxDetails.fed, 0);
        const cash = (y: typeof year) => y.accounts.find(a => a.id === 'cash')!.amount;
        expect(cash(year)).toBeCloseTo(cash(exact), 0);
    });
});
