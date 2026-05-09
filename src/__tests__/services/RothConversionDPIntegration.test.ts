/**
 * End-to-end integration test for the DP-precomputed Roth conversion strategy.
 *
 * Runs the whole pipeline: full-horizon std-ded baseline → buildDPYearContexts →
 * planConversionsViaDP → final main sim with DP plan plumbed through. Verifies
 * the simulation completes without throwing and that the DP strategy actually
 * fires at least one conversion in a clear-cut FIRE scenario where converting
 * is unambiguously beneficial.
 */
import { describe, it, expect } from 'vitest';
import { AssumptionsState, defaultAssumptions, createBuiltinMilestones } from '../../components/Objects/Assumptions/AssumptionsContext';
import { TaxState } from '../../components/Objects/Taxes/TaxContext';
import { InvestedAccount, SavedAccount } from '../../components/Objects/Accounts/models';
import { FutureSocialSecurityIncome } from '../../components/Objects/Income/models';
import { FoodExpense } from '../../components/Objects/Expense/models';
import { runSimulationWithOptimization } from '../../components/Objects/Assumptions/useSimulation';

describe('DP-precomputed Roth conversion strategy — end-to-end', () => {
    const birthYear = 1985;
    const retirementAge = 40; // FIRE: early retiree
    const lifeExpectancy = 95;
    const yearsToSimulate = 55;

    const baseAssumptions = (
        rothConversionStrategy: 'rate-match' | 'dp-precomputed',
    ): AssumptionsState => ({
        ...defaultAssumptions,
        demographics: {},
        milestones: createBuiltinMilestones(birthYear, retirementAge, lifeExpectancy),
        income: { ...defaultAssumptions.income, salaryGrowth: 0 },
        macro: { ...defaultAssumptions.macro, inflationRate: 2.5, inflationAdjusted: true },
        investments: {
            ...defaultAssumptions.investments,
            returnRates: { ror: 6 },
            taxOptimizationEnabled: true,
            autoRothConversions: true,
            rothConversionStrategy,
        },
        withdrawalStrategy: [
            { id: 'ws-savings', name: 'Savings', accountId: 'acc-savings' },
            { id: 'ws-brokerage', name: 'Brokerage', accountId: 'acc-brokerage' },
            { id: 'ws-roth', name: 'Roth IRA', accountId: 'acc-roth' },
            { id: 'ws-trad', name: 'Traditional IRA', accountId: 'acc-traditional' },
        ],
    });

    const taxState: TaxState = {
        filingStatus: 'Single',
        stateResidency: 'Texas',
        deductionMethod: 'Standard',
        fedOverride: null,
        ficaOverride: null,
        stateOverride: null,
        year: 2025,
    };

    const buildAccounts = () => [
        new InvestedAccount('acc-traditional', 'Traditional IRA', 1_500_000, 0, 10, 0.05, 'Traditional IRA', true, 0.2, 1_500_000),
        new InvestedAccount('acc-roth', 'Roth IRA', 100_000, 0, 10, 0.05, 'Roth IRA', true, 0.2, 100_000),
        new InvestedAccount('acc-brokerage', 'Brokerage', 800_000, 0, 10, 0.05, 'Brokerage', true, 0.2, 600_000),
        new SavedAccount('acc-savings', 'Savings', 100_000, 4),
    ];

    const buildIncomes = () => [
        new FutureSocialSecurityIncome('inc-ss', 'Social Security', 67, 0, 0),
    ];

    const buildExpenses = () => [
        new FoodExpense('exp-living', 'Living Expenses', 50_000, 'Annually', new Date('2025-01-01')),
    ];

    it('runs the DP path end-to-end without throwing', () => {
        const assumptions = baseAssumptions('dp-precomputed');
        const result = runSimulationWithOptimization(
            yearsToSimulate,
            buildAccounts(),
            buildIncomes(),
            buildExpenses(),
            assumptions,
            taxState,
            undefined,
            new Date('2025-06-15'),
        );
        expect(result.length).toBeGreaterThan(0);
    });

    it('DP path produces at least one auto-conversion across the horizon', () => {
        const assumptions = baseAssumptions('dp-precomputed');
        const result = runSimulationWithOptimization(
            yearsToSimulate,
            buildAccounts(),
            buildIncomes(),
            buildExpenses(),
            assumptions,
            taxState,
            undefined,
            new Date('2025-06-15'),
        );
        const totalConverted = result.reduce(
            (sum, year) => sum + (year.rothConversion?.amount ?? 0),
            0,
        );
        // FIRE retiree with $1.5M trad and modest income should see meaningful
        // conversion activity from the DP strategy. Threshold is intentionally
        // loose to avoid brittle assertions across small algorithm tweaks.
        expect(totalConverted).toBeGreaterThan(50_000);
    });

    it('DP fills standard-deduction headroom in pre-SS retirement years', () => {
        // Regression guard: an earlier bug had buildDPYearContexts include
        // baseline conversions in nonSSOrdinaryIncomeExclRMD, which made the
        // DP solve for "extra above baseline" while the final sim executed
        // only the plan amount. Net: every year was $0. This test asserts the
        // DP fills at least *some* of the available std-ded headroom in early
        // pre-SS retirement years, where baseline ordinary income is low and
        // a free conversion is unambiguously optimal.
        const assumptions = baseAssumptions('dp-precomputed');
        const result = runSimulationWithOptimization(
            yearsToSimulate,
            buildAccounts(),
            buildIncomes(),
            buildExpenses(),
            assumptions,
            taxState,
            undefined,
            new Date('2025-06-15'),
        );
        // Pre-SS years (age 40 → 66): SS hasn't started, ordinary income is low,
        // 0% bracket headroom is high. DP should convert *something* in most of these.
        const preSSYears = result.filter(y => {
            const age = y.year - birthYear;
            return age >= retirementAge && age < 67;
        });
        const yearsWithConversions = preSSYears.filter(
            y => (y.rothConversion?.amount ?? 0) > 0,
        );
        expect(yearsWithConversions.length).toBeGreaterThan(preSSYears.length / 2);
    });

    it('DP conversion entries are tagged with the DP-planned reason', () => {
        const assumptions = baseAssumptions('dp-precomputed');
        const result = runSimulationWithOptimization(
            yearsToSimulate,
            buildAccounts(),
            buildIncomes(),
            buildExpenses(),
            assumptions,
            taxState,
            undefined,
            new Date('2025-06-15'),
        );
        const conversionYears = result.filter(y => (y.rothConversion?.amount ?? 0) > 0);
        expect(conversionYears.length).toBeGreaterThan(0);
        // At least one year's logs should mention the DP strategy.
        const anyDPLog = result.some(y =>
            y.logs?.some(l => l.includes('DP-planned'))
        );
        expect(anyDPLog).toBe(true);
    });

    it('future-retirement case: DP starts from baseline retirement-year trad, not today', () => {
        // Regression guard: the DP forward sweep originally started at
        // accounts.vestedAmount (today's balance), but contexts only span
        // retirement onward. So with retirement N years out, the DP missed
        // pre-retirement growth + 401k contributions, saw a tiny trad,
        // projected tiny RMDs, and picked $0 for every year.
        //
        // This setup has the user 11 years away from retirement with modest
        // current trad ($88k) and large brokerage. Pre-retirement growth +
        // contributions push trad to ~$700k by retirement. If the DP starts
        // from today's $88k it'll see no future tax pressure; if it starts
        // from baseline's retirement-year $700k, it will.
        const futureRetirementBirth = 2001;
        const retirementAt = 35;
        const futureLifeExpectancy = 95;
        const futureYears = 60;

        const futureAssumptions: AssumptionsState = {
            ...defaultAssumptions,
            demographics: {},
            milestones: createBuiltinMilestones(futureRetirementBirth, retirementAt, futureLifeExpectancy),
            income: { ...defaultAssumptions.income, salaryGrowth: 0 },
            macro: { ...defaultAssumptions.macro, inflationRate: 2.5, inflationAdjusted: true },
            investments: {
                ...defaultAssumptions.investments,
                returnRates: { ror: 7 },
                taxOptimizationEnabled: true,
                autoRothConversions: true,
                rothConversionStrategy: 'dp-precomputed',
            },
            withdrawalStrategy: [
                { id: 'ws-savings', name: 'Savings', accountId: 'acc-savings' },
                { id: 'ws-brokerage', name: 'Brokerage', accountId: 'acc-brokerage' },
                { id: 'ws-roth', name: 'Roth IRA', accountId: 'acc-roth' },
                { id: 'ws-trad', name: 'Traditional IRA', accountId: 'acc-traditional' },
            ],
        };
        const futureAccounts = [
            new InvestedAccount('acc-traditional', 'Traditional 401k', 88_000, 0, 5, 0.05, 'Traditional 401k', true, 0.2, 88_000),
            new InvestedAccount('acc-roth', 'Roth IRA', 200_000, 0, 5, 0.05, 'Roth IRA', true, 0.2, 200_000),
            new InvestedAccount('acc-brokerage', 'Brokerage', 700_000, 0, 5, 0.05, 'Brokerage', true, 0.2, 600_000),
            new SavedAccount('acc-savings', 'Savings', 50_000, 4),
        ];
        const result = runSimulationWithOptimization(
            futureYears,
            futureAccounts,
            buildIncomes(),
            buildExpenses(),
            futureAssumptions,
            taxState,
            undefined,
            new Date('2025-06-15'),
        );
        // After fix, DP should fire conversions in retirement years given the
        // ~$700k baseline trad balance at retirement. Before the fix this
        // was zero because DP saw $88k today.
        const totalConverted = result.reduce(
            (sum, year) => sum + (year.rothConversion?.amount ?? 0),
            0,
        );
        expect(totalConverted).toBeGreaterThan(20_000);
    });

    it('rate-match path is unaffected (regression check)', () => {
        const assumptions = baseAssumptions('rate-match');
        const result = runSimulationWithOptimization(
            yearsToSimulate,
            buildAccounts(),
            buildIncomes(),
            buildExpenses(),
            assumptions,
            taxState,
            undefined,
            new Date('2025-06-15'),
        );
        // No DP-planned log entries should appear in the rate-match path.
        const anyDPLog = result.some(y =>
            y.logs?.some(l => l.includes('DP-planned'))
        );
        expect(anyDPLog).toBe(false);
        expect(result.length).toBeGreaterThan(0);
    });
});
