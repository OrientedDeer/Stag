/**
 * Survivor scenario × conversion optimizer (fp-review F3b, re-optimization leg).
 *
 * No special wiring exists between the composer and the optimizer — the
 * engine-direct search's DP contexts are built FROM the composed baseline
 * timeline, its candidate replays run through the composed simulation loop,
 * and the exit ruler resolves the survivor filing status through
 * resolveTaxEventsForYear (the F3a seam). This test asserts the ECONOMIC
 * consequence the review names: with a survivor event at LE−10, the widow's
 * penalty (Single brackets ≈ half of MFJ on ~the same income) makes residual
 * Traditional more expensive to exit, so the optimizer converts WEAKLY MORE
 * while both spouses are alive. Weak inequality with grid slack: plans are
 * fill-to-bracket-top, so "more" can land on the same grid point.
 */
import { describe, it, expect } from 'vitest';
import { AssumptionsState, defaultAssumptions, createBuiltinMilestones } from '../../components/Objects/Assumptions/AssumptionsContext';
import { TaxState } from '../../components/Objects/Taxes/TaxContext';
import { SurvivorScenario } from '../../services/simulation/SurvivorScenario';
import { AnyAccount, InvestedAccount, SavedAccount } from '../../components/Objects/Accounts/models';
import { CurrentSocialSecurityIncome, FutureSocialSecurityIncome } from '../../components/Objects/Income/models';
import { FoodExpense } from '../../components/Objects/Expense/models';
import { EarningsRecord } from '../../services/SocialSecurityCalculator';
import { runSimulationWithOptimization } from '../../components/Objects/Assumptions/useSimulation';
import { SimulationYear } from '../../services/simulation/types';
import { executedConversionsByYear } from '../roth-cookbook/harness';

const TIMEOUT = { timeout: 300_000 };

const NOW = new Date().getFullYear();
const BY = NOW - 62, RA = 62, LE = 92, ROR = 5;
const DEATH_YEAR = BY + (LE - 10); // first survivor year at age 82 — LE−10

// MFJ real-SS large-Traditional household (same shape as the certification
// panel's real-SS profile) PLUS a second, smaller spousal SS benefit so the
// SS-survivor drop is also in play. dp-precomputed default → engine-direct search.
function makeCouple(survivorScenario?: SurvivorScenario): {
    accounts: AnyAccount[]; incomes: (CurrentSocialSecurityIncome | FutureSocialSecurityIncome)[];
    expenses: FoodExpense[]; assumptions: AssumptionsState; taxState: TaxState; yearsToRun: number;
} {
    const priorEarnings: EarningsRecord[] = [];
    for (let a = 25; a <= 59; a++) priorEarnings.push({ year: BY + a, amount: 130_000 });
    const assumptions: AssumptionsState = {
        ...defaultAssumptions,
        demographics: { priorEarnings },
        milestones: createBuiltinMilestones(BY, RA, LE),
        income: { ...defaultAssumptions.income, salaryGrowth: 0 },
        macro: { ...defaultAssumptions.macro, inflationRate: 0, inflationAdjusted: false },
        investments: {
            ...defaultAssumptions.investments, returnRates: { ror: ROR },
            taxOptimizationEnabled: true, autoRothConversions: true,
            rothConversionStrategy: 'dp-precomputed',
        },
        withdrawalStrategy: [
            { id: 'ws-savings', name: 'Savings', accountId: 'acc-savings' },
            { id: 'ws-brokerage', name: 'Brokerage', accountId: 'acc-brokerage' },
            { id: 'ws-trad', name: 'Traditional IRA', accountId: 'acc-traditional' },
            { id: 'ws-roth', name: 'Roth IRA', accountId: 'acc-roth' },
        ],
    };
    const taxState: TaxState = {
        filingStatus: 'Married Filing Jointly', stateResidency: 'Texas',
        deductionMethod: 'Standard', fedOverride: null, ficaOverride: null, stateOverride: null,
        year: NOW, survivorScenario,
    };
    return {
        accounts: [
            new InvestedAccount('acc-traditional', 'Traditional IRA', 1_500_000, 0, 10, 0, 'Traditional IRA', true, 0.2, 1_500_000),
            new InvestedAccount('acc-roth', 'Roth IRA', 100_000, 0, 10, 0, 'Roth IRA', true, 0.2, 100_000),
            new InvestedAccount('acc-brokerage', 'Brokerage', 400_000, 0, 10, 0, 'Brokerage', true, 0.2, 300_000),
            new SavedAccount('acc-savings', 'Savings', 50_000, 4),
        ],
        incomes: [
            new FutureSocialSecurityIncome('inc-ss', 'Social Security', 67, 3_000, NOW),
            new CurrentSocialSecurityIncome('inc-ss-spouse', 'Spouse SS', 1_250, 'Monthly', new Date(NOW - 1, 0, 1)),
        ],
        expenses: [new FoodExpense('exp-living', 'Living Expenses', 80_000, 'Annually', new Date(NOW, 0, 1))],
        assumptions, taxState, yearsToRun: LE - RA,
    };
}

const optimize = (sc: ReturnType<typeof makeCouple>): SimulationYear[] =>
    runSimulationWithOptimization(sc.yearsToRun, sc.accounts, sc.incomes, sc.expenses, sc.assumptions, sc.taxState);
const totalConverted = (t: SimulationYear[]): number =>
    [...executedConversionsByYear(t).values()].reduce((s, v) => s + v, 0);

// Grid slack: the fill-to-h family moves in bracket-top steps, so allow the
// survivor plan to land one small step "behind" without failing the weak claim.
const GRID_SLACK = 25_000;

describe('optimizer re-optimizes under the survivor scenario (converts weakly more)', TIMEOUT, () => {
    const base = optimize(makeCouple());
    const widowed = optimize(makeCouple({ enabled: true, deathYear: DEATH_YEAR, expenseFactor: 0.8 }));

    it('the composition reached the optimizer path (one SS benefit from deathYear on)', () => {
        const atDeath = widowed.find(y => y.year === DEATH_YEAR && !y.isEndOfYearProjection)!;
        const ssIds = atDeath.incomes.filter(i => i.className.includes('SocialSecurity')).map(i => i.id);
        expect(ssIds).toEqual(['inc-ss']); // spouse's smaller benefit dropped
        const before = base.find(y => y.year === DEATH_YEAR && !y.isEndOfYearProjection)!;
        expect(before.incomes.some(i => i.id === 'inc-ss-spouse')).toBe(true);
    });

    it('converts weakly MORE with a survivor event at LE−10 (the convert-more-while-MFJ lever)', () => {
        const baseTotal = totalConverted(base);
        const widowedTotal = totalConverted(widowed);
        expect(baseTotal).toBeGreaterThan(0); // the comparison is meaningful
        expect(widowedTotal).toBeGreaterThanOrEqual(baseTotal - GRID_SLACK);
    });

    it('the feasibility floor holds under composition (search ran on composed inputs)', () => {
        const strat = widowed[0].strategyTerminalAfterTaxNW!;
        const floor = widowed[0].stdDedBaselineTerminalAfterTaxNW!;
        expect(strat).toBeDefined();
        expect(floor).toBeDefined();
        expect(strat).toBeGreaterThanOrEqual(floor - Math.max(1, Math.abs(floor) * 1e-6));
    });
});
