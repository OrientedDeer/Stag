/**
 * A working year past RMD age must NOT double-spend the RMD dollars (#174 + #173).
 *
 * #173 made `isRMDRequired` age-only, and RMDService.processRMDs runs unconditionally
 * before the year solver — so a still-working owner past the RMD age now carries a REAL
 * required distribution, applied as a negative userInflow in growAccounts.
 *
 * #174 added a per-account RMD reservation, but ONLY to solveRetirementYear. The
 * working-year deficit path (solveWorkingYear) rebuilds its withdrawal snapshots from
 * the raw, undrained balances and plans against them directly, with no reservation. So
 * a 74-year-old still working, with a spending deficit and a nearly-depleted Traditional
 * IRA, could plan to withdraw the account's FULL balance for the deficit on top of the
 * RMD that already claimed part of it — over-draining the account (clamped at zero) while
 * the year's spendable cash includes RMD dollars that no longer exist. Net worth is
 * overstated and a real unfunded deficit is hidden.
 *
 * Invariant: for the RMD-subject Traditional account, the discretionary (spending-deficit)
 * gross draw PLUS the RMD withdrawn cannot exceed the account's starting balance.
 */
import { describe, it, expect } from 'vitest';

import { InvestedAccount } from '../../../components/Objects/Accounts/models';
import { WorkIncome } from '../../../components/Objects/Income/models';
import { OtherExpense } from '../../../components/Objects/Expense/models';
import { runSimulation } from '../../../components/Objects/Assumptions/useSimulation';
import {
    AssumptionsState,
    defaultAssumptions,
    createBuiltinMilestones,
} from '../../../components/Objects/Assumptions/AssumptionsContext';
import { TaxState } from '../../../components/Objects/Taxes/TaxContext';
import { calculateRMD } from '../../../data/RMDData';

// Born ~1952 → SECURE 2.0 RMD age 73, so an RMD is required from the first simulated
// year on. The retirement milestone is set to age 90 so the owner is STILL WORKING
// (the working-year solver path) throughout the short horizon.
const CURRENT_YEAR = new Date().getFullYear();
const AGE = 74;
const BIRTH_YEAR = CURRENT_YEAR - AGE;
const TRAD_ID = 'trad-ira';
const TRAD_BALANCE = 50_000;

function makeAssumptions(): AssumptionsState {
    return {
        ...defaultAssumptions,
        milestones: createBuiltinMilestones(BIRTH_YEAR, /* retireAge */ 90, /* lifeExpectancy */ 95),
        macro: { ...defaultAssumptions.macro, inflationAdjusted: false, inflationRate: 0 },
        investments: {
            ...defaultAssumptions.investments,
            taxOptimizationEnabled: false,
            acaAware: false,
            returnRates: { ror: 0 },
        },
        withdrawalStrategy: [
            { id: 'ws-trad', name: 'Traditional IRA', accountId: TRAD_ID },
        ],
    };
}

function makeTaxState(): TaxState {
    return {
        filingStatus: 'Single',
        stateResidency: 'Texas',
        deductionMethod: 'Standard',
        fedOverride: null,
        ficaOverride: null,
        stateOverride: null,
        year: CURRENT_YEAR,
    };
}

describe('Working-year RMD double-spend (#174 / #173)', () => {
    it('does not let the working-year deficit planner draw the RMD-reserved dollars', () => {
        // Fully vested Traditional IRA (employerBalance 0), nearly depleted.
        const trad = new InvestedAccount(TRAD_ID, 'Traditional IRA', TRAD_BALANCE, 0, 0, 0, 'Traditional IRA');

        // Modest wages (genuinely a working year) against a large living expense → a big
        // spending deficit the planner must fund from the Traditional IRA.
        const job = new WorkIncome(
            'job', 'Part-time', 20_000, 'Annually', 'Yes',
            0, 0, 0, 0, '',
            null, 'FIXED',
            new Date('2010-01-01'), undefined, 0,
        );
        const expenses = [new OtherExpense('exp', 'Living', 200_000, 'Annually', new Date('2010-01-01'))];

        // yearsToRun ≥ 2: index 0 is the static Baseline Year 0 and index 1 the synthetic
        // end-of-current-year projection; the first REAL solver year (with RMD + deficit
        // withdrawals) is index 2 onward.
        const simulation = runSimulation(
            3, [trad], [job], expenses, makeAssumptions(), makeTaxState(),
        );

        expect(calculateRMD(TRAD_BALANCE, AGE)).toBeGreaterThan(0);

        // First real working year that took an RMD AND a discretionary draw from the
        // Traditional IRA. withdrawalDetail excludes the RMD (SimulationEngine skips the
        // RMD tracking record), so its entry is the pure spending-deficit gross draw.
        const drawYear = simulation.find(y =>
            (y.rmdDetails?.totalWithdrawn ?? 0) > 0 &&
            (y.cashflow.withdrawalDetail[TRAD_ID] ?? 0) > 0,
        );
        expect(drawYear).toBeDefined();

        const rmdWithdrawn = drawYear!.rmdDetails!.totalWithdrawn;
        const discretionaryDraw = drawYear!.cashflow.withdrawalDetail[TRAD_ID];

        // RMD really fired and the deficit really drove a Traditional draw (otherwise the
        // scenario proves nothing).
        expect(rmdWithdrawn).toBeGreaterThan(0);
        expect(discretionaryDraw).toBeGreaterThan(0);

        // The double-spend guard: with ror = 0 and no contributions, the account can
        // never exceed its $50k starting balance, so the discretionary draw PLUS the RMD
        // withdrawn cannot exceed it. Pre-fix, the working-year planner saw the raw $50k
        // and drew it in FULL on top of the ~$2,033 RMD (~$52,033 total > $50,000).
        expect(discretionaryDraw + rmdWithdrawn).toBeLessThanOrEqual(TRAD_BALANCE + 1);
    });
});
