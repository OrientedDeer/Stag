/**
 * #93 — Monte Carlo NON-ANTICIPATIVE adaptive Roth-conversion rule.
 *
 * The MC engine pre-solves the bracket-aware max-wealth DP once against the
 * user's projection RoR, then replays it per path through an adaptive overlay
 * (YearSolver.planConversionDP): each year the planned conversion is scaled by
 * the ratio of the path's REALIZED start-of-year Traditional balance to the
 * EXPECTED balance the plan assumed. The overlay must be a strict
 * GENERALIZATION of the open-loop plan:
 *
 *   ON-TRACK PATH (returns ≈ the plan's RoR)  ⇒  ratio == 1 every year
 *                                             ⇒  scaled == planned conversion.
 *
 * This test pins that property end-to-end through the public MC API. We build a
 * DP-enabled retiree, read the deterministic plan's per-year conversions, then
 * run a single MC path whose flat returns (stdDev = 0) exactly equal the
 * projection RoR — the realized balances track the projection, so the adaptive
 * overlay must reproduce the deterministic conversions year-for-year.
 *
 * Inflation-adjusted is OFF and every account's expense ratio is 0, so the MC
 * per-year override return (config.returnMean, applied flat) equals the
 * deterministic per-account growth rate (returnRates.ror) — i.e. the path is
 * genuinely on-track, not just "close".
 */
import { describe, it, expect } from 'vitest';

import { runMonteCarloSimulationSync } from '../../services/MonteCarloEngine';
import { MonteCarloConfig } from '../../services/MonteCarloTypes';
import { runSimulationWithOptimization } from '../../components/Objects/Assumptions/useSimulation';
import { InvestedAccount, SavedAccount } from '../../components/Objects/Accounts/models';
import { SocialSecurityIncome } from '../../components/Objects/Income/models';
import { OtherExpense } from '../../components/Objects/Expense/models';
import {
    AssumptionsState,
    defaultAssumptions,
    createBuiltinMilestones,
} from '../../components/Objects/Assumptions/AssumptionsContext';
import { TaxState } from '../../components/Objects/Taxes/TaxContext';
import { SimulationYear } from '../../services/simulation/types';

const ROR = 5; // % nominal; with expenseRatio 0 and inflationAdjusted off, the
               // on-track MC override return is exactly this.
const BIRTH_YEAR = new Date().getFullYear() - 65; // already retired (age 65 today)

function makeAccounts() {
    // Large Traditional IRA so the bracket-aware DP schedules real conversions;
    // brokerage + savings provide a non-Trad source to pay the conversion tax.
    // expenseRatio = 0 everywhere keeps the on-track override return = ROR exactly.
    const traditional = new InvestedAccount(
        'trad-1', 'Traditional IRA', 900000, 0, 20, 0 /* expenseRatio */, 'Traditional IRA',
    );
    const brokerage = new InvestedAccount(
        'brokerage-1', 'Brokerage', 300000, 0, 10, 0, 'Brokerage', true, 0.2, 240000,
    );
    const roth = new InvestedAccount(
        'roth-1', 'Roth IRA', 50000, 0, 10, 0, 'Roth IRA', true, 0.2, 50000,
    );
    const savings = new SavedAccount('savings-1', 'Savings', 80000, 0 /* interest */);
    return [traditional, brokerage, roth, savings];
}

function makeIncomes() {
    return [
        new SocialSecurityIncome(
            'ss-1', 'Social Security', 1800, 'Monthly', 65, undefined,
            new Date(`${BIRTH_YEAR + 65}-01-01`),
        ),
    ];
}

function makeExpenses() {
    return [new OtherExpense('living-1', 'Living Expenses', 40000, 'Annually', new Date('2020-01-01'))];
}

function makeAssumptions(): AssumptionsState {
    return {
        ...defaultAssumptions,
        milestones: createBuiltinMilestones(BIRTH_YEAR, 60 /* retired in past */, 80),
        investments: {
            ...defaultAssumptions.investments,
            taxOptimizationEnabled: true,
            // rothConversionStrategy stays at the dp-precomputed default.
            returnRates: { ror: ROR },
        },
        macro: { ...defaultAssumptions.macro, inflationAdjusted: false },
        withdrawalStrategy: [
            { id: 'ws-1', name: 'Brokerage', accountId: 'brokerage-1' },
            { id: 'ws-2', name: 'Traditional', accountId: 'trad-1' },
            { id: 'ws-3', name: 'Roth', accountId: 'roth-1' },
            { id: 'ws-4', name: 'Savings', accountId: 'savings-1' },
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
        year: new Date().getFullYear(),
    };
}

/** Per-year conversion amounts (year → $), only years with a positive conversion. */
function conversionsByYear(timeline: SimulationYear[]): Map<number, number> {
    const m = new Map<number, number>();
    for (const y of timeline) {
        const amt = y.rothConversion?.amount ?? 0;
        if (amt > 0) m.set(y.year, amt);
    }
    return m;
}

describe('#93 MC adaptive conversion overlay — generalization of the precomputed plan', () => {
    it('reproduces the deterministic DP conversions on an on-track (flat-RoR) MC path', { timeout: 60000 }, () => {
        const accounts = makeAccounts();
        const incomes = makeIncomes();
        const expenses = makeExpenses();
        const assumptions = makeAssumptions();
        const taxState = makeTaxState();

        // 1) Deterministic projection (uses returnRates.ror) — the open-loop plan.
        const det = runSimulationWithOptimization(
            30, makeAccounts(), incomes, expenses, assumptions, taxState,
        );
        const detConversions = conversionsByYear(det);

        // Guard: the fixture must actually schedule conversions, else the test is vacuous.
        expect(detConversions.size).toBeGreaterThan(0);

        // 2) Single MC path with flat returns == ROR (stdDev 0 ⇒ every year is exactly
        //    the projection RoR ⇒ the path tracks the projection ⇒ ratio == 1).
        const config: MonteCarloConfig = {
            enabled: true,
            numScenarios: 1,
            seed: 12345,
            returnMean: ROR,
            returnStdDev: 0,
            preset: 'custom',
        };
        const mc = runMonteCarloSimulationSync(
            config, accounts, incomes, expenses, assumptions, taxState,
        );
        // With one scenario, worst == median == best — all are the on-track path.
        const mcConversions = conversionsByYear(mc.medianCase.timeline);

        // 3) The adaptive overlay must reduce to the plan: identical conversion years
        //    and identical amounts (within a rounding dollar).
        expect([...mcConversions.keys()].sort()).toEqual([...detConversions.keys()].sort());
        for (const [year, detAmt] of detConversions) {
            const mcAmt = mcConversions.get(year) ?? 0;
            expect(Math.abs(mcAmt - detAmt)).toBeLessThanOrEqual(1);
        }
    });
});
