/**
 * #89 regression: the DP-precomputed Roth conversion strategy must NOT drain
 * Traditional to ~$0 on a high-growth plan. The bracket-aware terminal valuation
 * (now the production dp-precomputed objective) leaves a reserve sized to the
 * residual's true exit rate, and adapts to the self-liquidate-vs-bequeath choice.
 *
 * Scenario uses round, synthetic numbers (NOT a real plan): a high-growth FIRE
 * shape (~9.3% nominal) where the OLD min-tax objective over-converts and zeroes
 * out Traditional, forgoing the std-deduction / low-bracket harvest #89 is about.
 */
import { describe, it, expect } from 'vitest';
import { AssumptionsState, defaultAssumptions, createBuiltinMilestones } from '../../components/Objects/Assumptions/AssumptionsContext';
import { TaxState } from '../../components/Objects/Taxes/TaxContext';
import { AnyAccount, InvestedAccount, SavedAccount } from '../../components/Objects/Accounts/models';
import { FutureSocialSecurityIncome } from '../../components/Objects/Income/models';
import { FoodExpense } from '../../components/Objects/Expense/models';
import { runSimulationWithOptimization } from '../../components/Objects/Assumptions/useSimulation';
import { SimulationYear } from '../../services/simulation/types';

const BIRTH_YEAR = 1985;
const RETIRE_AGE = 45;
const LIFE_EXP = 90;
const YEARS = LIFE_EXP - (2025 - BIRTH_YEAR) + 2;

type DpObjective = Parameters<typeof runSimulationWithOptimization>[11];

function assumptions(overrides: Partial<AssumptionsState['investments']> = {}): AssumptionsState {
    return {
        ...defaultAssumptions,
        demographics: {},
        milestones: createBuiltinMilestones(BIRTH_YEAR, RETIRE_AGE, LIFE_EXP),
        income: { ...defaultAssumptions.income, salaryGrowth: 0 },
        // ~9.3% nominal: ror 7 + inflation-adjusted on — the regime where the old
        // min-tax objective balloons future RMDs and over-converts.
        macro: { ...defaultAssumptions.macro, inflationRate: 2.5, inflationAdjusted: true },
        investments: {
            ...defaultAssumptions.investments,
            returnRates: { ror: 7 },
            taxOptimizationEnabled: true,
            autoRothConversions: true,
            rothConversionStrategy: 'dp-precomputed',
            ...overrides,
        },
        withdrawalStrategy: [
            { id: 'ws-savings', name: 'Savings', accountId: 'acc-savings' },
            { id: 'ws-brokerage', name: 'Brokerage', accountId: 'acc-brokerage' },
            { id: 'ws-roth', name: 'Roth IRA', accountId: 'acc-roth' },
            { id: 'ws-trad', name: 'Traditional IRA', accountId: 'acc-traditional' },
        ],
    };
}

const taxState: TaxState = {
    filingStatus: 'Single', stateResidency: 'Texas', deductionMethod: 'Standard',
    fedOverride: null, ficaOverride: null, stateOverride: null, year: 2025,
};

const accounts = (): AnyAccount[] => [
    new InvestedAccount('acc-traditional', 'Traditional IRA', 900_000, 0, 10, 0.05, 'Traditional IRA', true, 0.2, 900_000),
    new InvestedAccount('acc-roth', 'Roth IRA', 250_000, 0, 10, 0.05, 'Roth IRA', true, 0.2, 250_000),
    new InvestedAccount('acc-brokerage', 'Brokerage', 850_000, 0, 10, 0.05, 'Brokerage', true, 0.2, 650_000),
    new SavedAccount('acc-savings', 'Savings', 40_000, 4),
];
const incomes = () => [new FutureSocialSecurityIncome('inc-ss', 'Social Security', 67, 2_800, 2025)];
const expenses = () => [new FoodExpense('exp-living', 'Living Expenses', 80_000, 'Annually', new Date('2025-01-01'))];

function terminalTrad(result: SimulationYear[]): number {
    const last = result[result.length - 1];
    return last.accounts
        .filter((a): a is InvestedAccount => a instanceof InvestedAccount && a.taxType === 'Traditional IRA')
        .reduce((s, a) => s + a.vestedAmount, 0);
}

function run(invOverrides: Partial<AssumptionsState['investments']>, dpObjective?: DpObjective): SimulationYear[] {
    return runSimulationWithOptimization(
        YEARS, accounts(), incomes(), expenses(),
        assumptions(invOverrides), taxState, undefined, new Date('2025-06-15'),
        undefined, undefined, undefined, dpObjective,
    );
}

describe('#89 bracket-aware DP Roth conversion', { timeout: 120_000 }, () => {
    // Baseline: the OLD min-tax objective drains Traditional to ~$0 (the bug).
    const minTaxTrad = () => terminalTrad(run({}, { objectiveMode: 'min-tax' }));
    // The new production default (bracket-aware, self-liquidate) and an explicit bequeath run.
    const defaultTrad = () => terminalTrad(run({}));
    const selfLiqTrad = () => terminalTrad(run({ rothConversionUserSituation: 'self-liquidate' }));
    const bequeathTrad = () => terminalTrad(run({ rothConversionUserSituation: 'bequeath' }));

    it('OLD min-tax objective drains Traditional to ~$0 (the #89 bug it replaces)', () => {
        // Without conversions this trad would balloon to tens of millions at 9.3%;
        // min-tax over-converts it down to nearly nothing.
        expect(minTaxTrad()).toBeLessThan(1_000_000);
    });

    it('bracket-aware leaves a Traditional reserve instead of draining to $0', () => {
        // Self-liquidate keeps a meaningful residual (its low real exit rate makes
        // converting the last dollars a loss), well above the drained min-tax case.
        expect(selfLiqTrad()).toBeGreaterThan(2_000_000);
        expect(selfLiqTrad()).toBeGreaterThan(minTaxTrad());
    });

    it('production dp-precomputed default routes to bracket-aware (not min-tax)', () => {
        // No dpObjective override → the assumptions-derived objective. Must behave
        // like bracket-aware (reserve preserved), proving the default flipped.
        expect(defaultTrad()).toBeGreaterThan(2_000_000);
    });

    it('userSituation adapts: bequeath converts more aggressively than self-liquidate', () => {
        // A working heir's high exit rate makes converting worth it, so bequeath
        // leaves materially less Traditional than self-liquidate.
        expect(bequeathTrad()).toBeLessThan(selfLiqTrad());
    });
});
