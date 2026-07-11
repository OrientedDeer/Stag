/**
 * Milestone-started income must survive the multi-year loop until its milestone
 * fires (#146).
 *
 * The simulation loop fed each year's milestone-FILTERED returned income list
 * forward as the next year's input (`currentIncomes = result.incomes`). An income
 * gated by a start milestone that hasn't fired yet is absent from that filtered
 * list, so it was permanently DROPPED before its milestone could ever fire — its
 * salary and any RSU vesting never appeared for the whole horizon. (Scope131
 * reproduced this via the real `runSimulation`; the single-year `simulateOneYear`
 * path and #131's RSU anchor logic were already correct — the income was starved
 * upstream.)
 *
 * The fix carries dormant, not-yet-started milestone incomes forward (unmutated)
 * alongside the mutated active ones, so they activate when their milestone hits.
 */
import { describe, it, expect } from 'vitest';

import { RSUAccount } from '../../../components/Objects/Accounts/models';
import { WorkIncome } from '../../../components/Objects/Income/models';
import { runSimulation } from '../../../components/Objects/Assumptions/useSimulation';
import {
    type AssumptionsState,
    defaultAssumptions,
    createBuiltinMilestones,
} from '../../../components/Objects/Assumptions/AssumptionsContext';
import { type TaxState } from '../../../components/Objects/Taxes/TaxContext';
import { OtherExpense } from '../../../components/Objects/Expense/models';
import { type CustomMilestone } from '../../../services/simulation/types';

const BIRTH_YEAR = 1985; // working-age throughout the test horizon.

function yearMilestone(id: string, year: number): CustomMilestone {
    return { id, name: id, conditions: [{ type: 'YEAR', operator: '>=', value: year }] };
}

function makeAssumptions(extraMilestones: CustomMilestone[]): AssumptionsState {
    return {
        ...defaultAssumptions,
        milestones: [...createBuiltinMilestones(BIRTH_YEAR, 65, 95), ...extraMilestones],
        macro: { ...defaultAssumptions.macro, inflationAdjusted: false, inflationRate: 0 },
        investments: { ...defaultAssumptions.investments, taxOptimizationEnabled: false, returnRates: { ror: 0 } },
    };
}

function makeTaxState(year: number): TaxState {
    return {
        filingStatus: 'Single',
        stateResidency: 'Texas',
        deductionMethod: 'Standard',
        fedOverride: null,
        ficaOverride: null,
        stateOverride: null,
        year,
    };
}

// Milestone-started WorkIncome with a fully-configured RSU grant; NO startDate.
function makeMilestoneRSUWork(startMilestoneId: string): WorkIncome {
    const inc = new WorkIncome(
        'work-1', 'Job', 100000, 'Annually', 'Yes',
        0, 0, 0, 0, '', null, 'FIXED', undefined, undefined,
    );
    inc.rsuVestingSchedule = 'cliff-1yr';
    inc.rsuGrantShares = 100;
    inc.rsuVestFrequency = 'quarterly';
    inc.rsuExpectedStockGrowth = 0;
    inc.rsuAccountId = 'rsu-1';
    inc.rsuWithholdingRate = 37;
    inc.startMilestoneId = startMilestoneId;
    return inc;
}

describe('runSimulation — milestone-started income survives until its milestone fires (#146)', () => {
    const startYear = new Date().getFullYear();
    const fireYear = startYear + 4;   // milestone fires mid-horizon
    const vestYear = fireYear + 1;    // cliff-1yr RSU vests the year after

    function run() {
        const incomes = [makeMilestoneRSUWork('M')];
        const accounts = [new RSUAccount('rsu-1', 'My RSU', 0, [], 'work-1', undefined, 'TICK', 100)];
        const expenses = [new OtherExpense('e1', 'none', 0, 'Annually', new Date(2020, 0, 1))];
        const assumptions = makeAssumptions([yearMilestone('M', fireYear)]);
        return runSimulation(10, accounts, incomes, expenses, assumptions, makeTaxState(startYear));
    }

    it('is dormant before the milestone, then activates its salary the year it fires', () => {
        const timeline = run();

        const before = timeline.find(y => y.year === startYear + 1);
        const fired = timeline.find(y => y.year === fireYear);
        expect(before).toBeDefined();
        expect(fired).toBeDefined();

        // Before the milestone fires, the milestone-gated income is correctly inactive.
        expect(before!.incomes.some(i => i.id === 'work-1')).toBe(false);

        // The year the milestone fires, the income is back and its salary projects —
        // before the fix it had been dropped years earlier and never reappeared.
        expect(fired!.incomes.some(i => i.id === 'work-1')).toBe(true);
        expect(fired!.cashflow.totalIncome).toBeGreaterThan(0);
    });

    it('vests its RSU the year after the milestone fires (end-to-end)', () => {
        const timeline = run();

        const vestYearObj = timeline.find(y => y.year === vestYear);
        expect(vestYearObj).toBeDefined();

        // The RSU can only vest if the income survived to the milestone year and
        // anchored its grant — the durable signal that #146 is fixed.
        const rsu = vestYearObj!.accounts.find(a => a instanceof RSUAccount) as RSUAccount | undefined;
        expect(rsu).toBeDefined();
        expect(rsu!.totalShares).toBeGreaterThan(0);
    });
});
