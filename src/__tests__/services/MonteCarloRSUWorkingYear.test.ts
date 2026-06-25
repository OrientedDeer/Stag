/**
 * #114 — a working-year RSU over-withholding must not register a phantom MC failure.
 *
 * Monte Carlo flags any year that holds a DeficitDebtAccount as a "year of
 * depletion" → failure (MonteCarloAggregator.analyzeScenario, which checks for a
 * DeficitDebtAccount by instance/className). Before #114, a still-working year with
 * a sell-to-cover RSU vest decided the year's deficit on the GROSS tax — before the
 * withholding refund netted in — so an OVER-withheld vest fabricated a deficit-debt
 * ≈ the year's tax even though the withholding already covered it. That phantom debt
 * made the whole path read as a failure, and (because DeficitDebtAccount carries
 * forward) every subsequent year too.
 *
 * This builds a multi-year timeline by chaining simulateOneYear (the same per-year
 * engine MC runs each path through) for an over-withheld working-year vest, then
 * feeds it to the REAL MC scenario analyzer. The path must succeed: no phantom
 * yearOfDepletion.
 *
 * RED before the fix: the analyzer reports yearOfDepletion = the vest year and
 * success = false (verified against the pre-fix engine: debt = $765 every year).
 */
import { describe, it, expect } from 'vitest';

import { RSUAccount, SavedAccount, AnyAccount } from '../../components/Objects/Accounts/models';
import { WorkIncome } from '../../components/Objects/Income/models';
import { OtherExpense } from '../../components/Objects/Expense/models';
import {
    AssumptionsState,
    defaultAssumptions,
    createBuiltinMilestones,
} from '../../components/Objects/Assumptions/AssumptionsContext';
import { TaxState } from '../../components/Objects/Taxes/TaxContext';
import { SimulationYear } from '../../services/simulation/types';
import { simulateOneYear } from '../../components/Objects/Assumptions/SimulationEngine';
import { analyzeScenario } from '../../services/MonteCarloAggregator';

function taxState(): TaxState {
    return {
        filingStatus: 'Single',
        stateResidency: 'Texas',
        deductionMethod: 'Standard',
        fedOverride: null,
        ficaOverride: null,
        stateOverride: null,
        year: 2026,
    };
}

// Still-working single filer (born 1976 → age 50 in 2026; retires at 65, so the
// vest years are all working years). One $10,000 cliff-1yr RSU vest in 2026 with
// 37% sell-to-cover withholding — a deliberate over-withhold (actual tax on the
// $10k, below the standard deduction, is ≈ $765 FICA). The $100k idle cash is NOT
// in the withdrawal order, so the only thing that could create a deficit-debt is
// the tax the withholding already paid.
function buildScenario(withholdingRate: number) {
    const assumptions: AssumptionsState = {
        ...defaultAssumptions,
        milestones: createBuiltinMilestones(1976, 65, 95),
        macro: { ...defaultAssumptions.macro, inflationAdjusted: false, inflationRate: 0 },
        investments: { ...defaultAssumptions.investments, taxOptimizationEnabled: false, returnRates: { ror: 0 } },
    };

    const work = new WorkIncome(
        'work-1', 'Job', 0, 'Annually', 'Yes',
        0, 0, 0, 0, 'sav-1', null, 'FIXED', new Date(2025, 0, 1), undefined,
    );
    work.rsuVestingSchedule = 'cliff-1yr';
    work.rsuGrantShares = 100;            // 100 sh × $100 = $10,000 vest in 2026
    work.rsuAccountId = 'rsu-1';
    work.rsuExpectedStockGrowth = 0;
    work.rsuWithholdingRate = withholdingRate;

    const rsu = new RSUAccount('rsu-1', 'RSU', 0, [], 'work-1', undefined, 'CO', 100);
    const sav = new SavedAccount('sav-1', 'Cash', 100000, 0);
    const expense = new OtherExpense('e1', 'none', 0, 'Annually', new Date(2020, 0, 1));

    return { assumptions, work, accounts: [rsu, sav] as AnyAccount[], expense };
}

// Chain simulateOneYear year-over-year (the pattern MC's per-path engine uses) to
// build a real multi-year timeline through the working-year vest.
function buildTimeline(withholdingRate: number): SimulationYear[] {
    const { assumptions, work, accounts: initial, expense } = buildScenario(withholdingRate);
    let accounts = initial;
    let prevMilestones: string[] = [];
    const timeline: SimulationYear[] = [];
    for (let year = 2026; year <= 2030; year++) {
        const result = simulateOneYear(
            year, [work], [expense], accounts, assumptions, taxState(), timeline, undefined, prevMilestones,
        );
        timeline.push(result);
        accounts = result.accounts;
        prevMilestones = result.activeMilestones ?? [];
    }
    return timeline;
}

describe('Monte Carlo — working-year RSU over-withholding (#114)', () => {
    it('does not register a phantom failure for an over-withheld working-year vest', () => {
        const timeline = buildTimeline(37);
        const result = analyzeScenario(0, timeline, new Array(timeline.length).fill(0));

        // The over-withheld working-year vest must NOT fabricate a deficit-debt, so
        // the MC analyzer sees no year of depletion and the path succeeds.
        expect(result.yearOfDepletion).toBeNull();
        expect(result.success).toBe(true);
    });

    it('still flags a GENUINE shortfall (no withholding, tax unreachable) as a failure', () => {
        // Control: at 0% withholding the $765 tax is genuinely owed but the $100k
        // cash isn't in the order, so a real deficit-debt forms. The fix must NOT
        // suppress this — only the phantom (withholding-covered) case.
        const timeline = buildTimeline(0);
        const result = analyzeScenario(0, timeline, new Array(timeline.length).fill(0));

        expect(result.success).toBe(false);
        expect(result.yearOfDepletion).toBe(2026);
    });
});
