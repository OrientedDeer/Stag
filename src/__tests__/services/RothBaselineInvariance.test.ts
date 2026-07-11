/**
 * #94 regression guard — the std-ded comparison BASELINE for the Withdrawal-tab
 * "After-Tax Wealth Gained" readout must be INVARIANT to the selected Roth strategy.
 *
 * Background: runSimulationWithOptimization always runs a full-horizon std-ded-only
 * baseline up front and stashes, on year 0, its after-tax terminal net worth
 * (`stdDedBaselineTerminalAfterTaxNW`). That figure is the denominator of the readout
 * ("your strategy vs free-conversions only"). It is built from the std-ded baseline
 * timeline + a SITUATION-based Traditional exit ruler — neither of which depends on
 * the user's SELECTED strategy. So switching the selected strategy (dp-precomputed vs
 * std-ded-only) must NOT move the baseline figure: it must match to the dollar.
 *
 * The #94 bug was a ~$10k strategy-dependent DRIFT in that baseline (the ruler was
 * partly built from the selected-strategy timeline), so the readout's denominator
 * silently changed depending on which strategy you were viewing. This guard reasserts
 * the cross-strategy invariance the deleted RothConversionBracketAware.test.ts carried.
 *
 * Reconstructs that dollar-exact assertion in a new, focused file (the original test
 * file was removed when the optimizer was rewritten to the engine-direct search).
 * Synthetic, PII-free numbers only.
 */
import { describe, it, expect } from 'vitest';
import { type AssumptionsState, defaultAssumptions, createBuiltinMilestones } from '../../components/Objects/Assumptions/AssumptionsContext';
import { type TaxState } from '../../components/Objects/Taxes/TaxContext';
import { type AnyAccount, InvestedAccount, SavedAccount } from '../../components/Objects/Accounts/models';
import { FutureSocialSecurityIncome } from '../../components/Objects/Income/models';
import { FoodExpense } from '../../components/Objects/Expense/models';
import { type EarningsRecord } from '../../services/SocialSecurityCalculator';
import { runSimulationWithOptimization } from '../../components/Objects/Assumptions/useSimulation';
import { type SimulationYear } from '../../services/simulation/types';

const TIMEOUT = { timeout: 180_000 };

// Realistic large-Traditional retirement profile with real Social Security (35-year
// earnings history → non-zero PIA), MFJ, modest growth — the regime where the readout
// matters most (a sizeable residual Traditional whose exit valuation drives the figure).
// Pattern adapted from RothConversionFeasibilityFloor.test.ts::makeRealSSLargeTradScenario.
const NOW = new Date().getFullYear();
const BY = NOW - 62, RA = 62, LE = 92, ROR = 5;

function priorEarnings(): EarningsRecord[] {
    const r: EarningsRecord[] = [];
    for (let a = 25; a <= 59; a++) r.push({ year: BY + a, amount: 130_000 });
    return r;
}

const WITHDRAWAL_ORDER = [
    { id: 'ws-savings', name: 'Savings', accountId: 'acc-savings' },
    { id: 'ws-brokerage', name: 'Brokerage', accountId: 'acc-brokerage' },
    { id: 'ws-trad', name: 'Traditional IRA', accountId: 'acc-traditional' },
    { id: 'ws-roth', name: 'Roth IRA', accountId: 'acc-roth' },
];

type Strategy = AssumptionsState['investments']['rothConversionStrategy'];

function assumptions(rothConversionStrategy: Strategy): AssumptionsState {
    return {
        ...defaultAssumptions,
        demographics: { priorEarnings: priorEarnings() },
        milestones: createBuiltinMilestones(BY, RA, LE),
        income: { ...defaultAssumptions.income, salaryGrowth: 0 },
        macro: { ...defaultAssumptions.macro, inflationRate: 0, inflationAdjusted: false },
        investments: {
            ...defaultAssumptions.investments,
            returnRates: { ror: ROR },
            taxOptimizationEnabled: true,
            autoRothConversions: true,
            rothConversionStrategy,
        },
        withdrawalStrategy: WITHDRAWAL_ORDER,
    };
}

const taxState: TaxState = {
    filingStatus: 'Married Filing Jointly', stateResidency: 'Texas', deductionMethod: 'Standard',
    fedOverride: null, ficaOverride: null, stateOverride: null, year: NOW,
};
// Fresh account/income/expense instances per run (runSimulation mutates copies, but
// keep each run independent to be safe).
const accounts = (): AnyAccount[] => [
    new InvestedAccount('acc-traditional', 'Traditional IRA', 1_500_000, 0, 10, 0, 'Traditional IRA', true, 0.2, 1_500_000),
    new InvestedAccount('acc-roth', 'Roth IRA', 100_000, 0, 10, 0, 'Roth IRA', true, 0.2, 100_000),
    new InvestedAccount('acc-brokerage', 'Brokerage', 400_000, 0, 10, 0, 'Brokerage', true, 0.2, 300_000),
    new SavedAccount('acc-savings', 'Savings', 50_000, 4),
];
const incomes = () => [new FutureSocialSecurityIncome('inc-ss', 'Social Security', 67, 3_000, NOW)];
const expenses = () => [new FoodExpense('exp-living', 'Living Expenses', 80_000, 'Annually', new Date(`${NOW}-01-01`))];
const YEARS = LE - RA;

function run(strategy: Strategy): SimulationYear[] {
    return runSimulationWithOptimization(YEARS, accounts(), incomes(), expenses(), assumptions(strategy), taxState);
}

describe('#94 — std-ded comparison baseline is invariant to the selected Roth strategy', TIMEOUT, () => {
    it('stdDedBaselineTerminalAfterTaxNW matches to the dollar across dp-precomputed vs std-ded-only', () => {
        const dp = run('dp-precomputed')[0].stdDedBaselineTerminalAfterTaxNW;
        const sd = run('std-ded-only')[0].stdDedBaselineTerminalAfterTaxNW;

        expect(dp).toBeDefined();
        expect(sd).toBeDefined();
        // Sanity: a real, positive baseline (the residual Traditional is large here).
        expect(dp!).toBeGreaterThan(0);

        // The std-ded baseline sim + the situation-based exit ruler depend only on the
        // situation, not the selected strategy — so the readout's denominator must be
        // identical. < $1 catches the #94 ~$10k drift; if this FAILS the invariance is
        // genuinely broken (do not loosen the tolerance — it is the bug under guard).
        expect(Math.abs(dp! - sd!)).toBeLessThan(1);
    });

    // NOTE on withdrawal ORDER (deliberately NOT asserted as invariant): the std-ded
    // baseline timeline is run with the user's stored `withdrawalStrategy` order (only the
    // rothConversionStrategy is overridden to rate-match/std-ded-only — see
    // useSimulation.runSimulationWithOptimization). So flipping the drawdown order DOES move
    // the baseline figure (~$15k here, trad-last vs trad-first) — that is BY DESIGN, not a
    // #94-style leak: the order is a legitimate part of "the situation" the baseline models.
    // The #94 guard is specifically that the SELECTED ROTH STRATEGY must not move it, which
    // the assertion above covers.
});
