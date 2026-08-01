/**
 * #207 asset allocation — engine-level behavior.
 *
 * Two things the resolver unit tests cannot catch:
 *  1. Accounts are rebuilt field-by-field in several places outside models.ts (the Roth
 *     401k → Roth IRA rollover at retirement, the pre-Year-1 contribution adjustments).
 *     Any of those dropping `stockPct` silently reverts the user's allocation mid-plan,
 *     while every growth-math unit test still passes.
 *  2. The blended rate has to actually move balances — and must NOT move them at all at
 *     the default 100% stock.
 */
import { describe, it, expect } from 'vitest';
import { runSimulation } from '../../../components/Objects/Assumptions/useSimulation';
import { InvestedAccount } from '../../../components/Objects/Accounts/models';
import {
    type AssumptionsState,
    defaultAssumptions,
    createBuiltinMilestones,
} from '../../../components/Objects/Assumptions/AssumptionsContext';
import { defaultTaxState } from '../../../components/Objects/Taxes/TaxContext';

const BIRTH_YEAR = new Date().getFullYear() - 50; // age 50 today
const RETIREMENT_AGE = 55;

function makeAssumptions(over: {
    ror?: number;
    bondRor?: number;
    stockPct?: number;
    glidepath?: AssumptionsState['investments']['allocationGlidepath'];
} = {}): AssumptionsState {
    return {
        ...defaultAssumptions,
        macro: { ...defaultAssumptions.macro, inflationAdjusted: false, inflationRate: 0 },
        milestones: createBuiltinMilestones(BIRTH_YEAR, RETIREMENT_AGE, 95),
        investments: {
            ...defaultAssumptions.investments,
            returnRates: { ror: over.ror ?? 10, bondRor: over.bondRor ?? 0 },
            defaultAllocation: { stockPct: over.stockPct ?? 100 },
            allocationGlidepath: over.glidepath,
        },
        withdrawalStrategy: [],
    };
}

/** A single account, no contributions, no income/expenses — pure growth. */
function growOnly(account: InvestedAccount, assumptions: AssumptionsState, years: number) {
    return runSimulation(years, [account], [], [], assumptions, defaultTaxState);
}

const brokerage = (stockPct?: number) => new InvestedAccount(
    'acct-1', 'Brokerage', 100_000, 0, 0, 0 /* no ER */, 'Brokerage',
    true, 0.2, 100_000, undefined, [], [], stockPct,
);

describe('#207 allocation in the simulation engine', () => {
    it('grows at the blended rate for a bond-bearing default allocation', () => {
        // 60% of 10% + 40% of 0% = 6%.
        const timeline = growOnly(brokerage(), makeAssumptions({ stockPct: 60 }), 3);
        const balance = timeline[timeline.length - 1].accounts
            .find(a => a.id === 'acct-1')!.amount;
        expect(balance).toBeCloseTo(100_000 * 1.06 ** 3, 2);
    });

    it('is byte-identical to the pre-#207 path at 100% stock', () => {
        const allStock = growOnly(brokerage(), makeAssumptions({ stockPct: 100 }), 5);
        const legacy = makeAssumptions({ stockPct: 100 });
        // Strip the #207 fields entirely — the shape a pre-#207 save produces.
        delete legacy.investments.defaultAllocation;
        delete legacy.investments.returnRates.bondRor;
        const preFeature = growOnly(brokerage(), legacy, 5);

        const balanceOf = (tl: ReturnType<typeof growOnly>) =>
            tl[tl.length - 1].accounts.find(a => a.id === 'acct-1')!.amount;
        expect(balanceOf(allStock)).toBe(balanceOf(preFeature));
    });

    it('lets a per-account allocation override the global default', () => {
        // Global is all-stock; this account is 25/75 → 0.25*10 + 0.75*0 = 2.5%.
        const timeline = growOnly(brokerage(25), makeAssumptions({ stockPct: 100 }), 4);
        const balance = timeline[timeline.length - 1].accounts
            .find(a => a.id === 'acct-1')!.amount;
        expect(balance).toBeCloseTo(100_000 * 1.025 ** 4, 2);
    });

    it('applies a glidepath to the default allocation year over year', () => {
        // 100% stock at age 50 → 0% at age 60, so the stock share (and the growth rate)
        // falls each year rather than staying at the year-0 value.
        const glided = growOnly(brokerage(), makeAssumptions({
            glidepath: {
                enabled: true, startAge: 50, endAge: 60, startStockPct: 100, endStockPct: 0,
            },
        }), 10);
        const flat = growOnly(brokerage(), makeAssumptions({ stockPct: 100 }), 10);

        const balanceOf = (tl: ReturnType<typeof growOnly>) =>
            tl[tl.length - 1].accounts.find(a => a.id === 'acct-1')!.amount;
        // Strictly between the all-stock and all-bond outcomes, and strictly below all-stock.
        expect(balanceOf(glided)).toBeLessThan(balanceOf(flat));
        expect(balanceOf(glided)).toBeGreaterThan(100_000);
    });

    it('preserves a per-account allocation across the Roth 401k → Roth IRA rollover', () => {
        // The rollover at retirement rebuilds the account field-by-field. If it drops
        // stockPct, growth silently jumps to the global allocation from that year on.
        const roth401k = new InvestedAccount(
            'roth-401k', 'Roth 401k', 100_000, 0, 0, 0, 'Roth 401k',
            true, 0.2, 100_000, undefined, [], [], 30,
        );
        const timeline = growOnly(roth401k, makeAssumptions({ stockPct: 100 }), 12);

        const rolled = timeline[timeline.length - 1].accounts
            .find(a => a.id === 'roth-401k') as InvestedAccount;
        expect(rolled.taxType).toBe('Roth IRA'); // the rollover did happen
        expect(rolled.stockPct).toBe(30);        // ...and kept the allocation
    });
});
