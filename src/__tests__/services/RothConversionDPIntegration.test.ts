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

// 2D-state DP: end-to-end runs (baseline + DP solve + final sim) take up
// to ~30s with the current grid. Default vitest 5s timeout would flake.
describe('DP-precomputed Roth conversion strategy — end-to-end', { timeout: 60_000 }, () => {
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

    it('DP performs meaningful conversions in pre-SS retirement years', () => {
        // Regression guard: an earlier bug had buildDPYearContexts include
        // baseline conversions in nonSSOrdinaryIncomeExclRMD, which made the
        // DP solve for "extra above baseline" while the final sim executed
        // only the plan amount. Net: every year was $0. This test guards
        // against that by asserting non-trivial pre-SS conversion activity.
        //
        // We don't assert "every year converts" — with a correct growth-rate
        // model, DP often concentrates conversions into a few high-impact
        // bracket-fill years rather than spreading thin std-ded fills across
        // every year. So the regression check is on TOTAL pre-SS conversion
        // dollars and the presence of at least a few active conversion years.
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
        // Pre-SS years (age 40 → 66): SS hasn't started, ordinary income is low.
        const preSSYears = result.filter(y => {
            const age = y.year - birthYear;
            return age >= retirementAge && age < 67;
        });
        const yearsWithConversions = preSSYears.filter(
            y => (y.rothConversion?.amount ?? 0) > 0,
        );
        const totalPreSSConverted = preSSYears.reduce(
            (sum, y) => sum + (y.rothConversion?.amount ?? 0),
            0,
        );
        expect(yearsWithConversions.length).toBeGreaterThanOrEqual(3);
        expect(totalPreSSConverted).toBeGreaterThan(100_000);
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

    it('does not over-front-load conversions in long FIRE horizon (3D regression guard)', () => {
        // Reproduces the original 2D-state DP bug: with the user's age-25
        // / retire-35 / 60-year FIRE setup, the 2D solver projected trad@RMD
        // ≈ $20M (because it couldn't model Roth depletion → later
        // trad-spending) and front-loaded $280k of conversions in year 1
        // followed by ~$30k/yr afterward. The 3D solver should see that
        // aggressive year-1 conversions deplete Roth and force trad-spending
        // late in retirement, so it spreads conversions across the horizon
        // — especially under the δ=1.5% back-load preference.
        const futureRetirementBirth = 2001;
        const retirementAt = 35;
        const futureLifeExpectancy = 95;
        const futureYears = 60;
        const retirementYear = futureRetirementBirth + retirementAt;

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

        const totalConverted = result.reduce(
            (s, y) => s + (y.rothConversion?.amount ?? 0),
            0,
        );
        // If DP picks $0 across the horizon, there's nothing to over-front-
        // load and the bug doesn't apply. Other tests guard against that
        // failure mode.
        if (totalConverted === 0) return;

        const yearOneConversion =
            result.find(y => y.year === retirementYear)?.rothConversion?.amount ?? 0;
        const firstThreeYears = result
            .filter(y => y.year >= retirementYear && y.year < retirementYear + 3)
            .reduce((s, y) => s + (y.rothConversion?.amount ?? 0), 0);

        const yearOneShare = yearOneConversion / totalConverted;
        const firstThreeShare = firstThreeYears / totalConverted;

        // Year 1 should not dominate. Pre-fix: 70%+. Post-fix: should be a
        // small fraction of total. 40% is intentionally loose to avoid
        // false-fails on small algorithm tweaks while still catching the
        // catastrophic regression.
        expect(yearOneShare).toBeLessThan(0.4);
        // First three years also shouldn't carry the bulk. Loose-ish bound
        // since some early-retirement bracket-fill is legitimate.
        expect(firstThreeShare).toBeLessThan(0.6);
    });

    it('DP lifetime tax stays within tolerance of rate-match', () => {
        // Quality check: DP optimizes for lifetime tax with δ=1.5% back-load
        // preference. With δ=0 it would strictly dominate rate-match (DP is
        // the global optimum); with δ>0 it can pay slightly more lifetime
        // tax in exchange for the SORR-friendly back-loaded plan. 10%
        // tolerance catches major regressions (DP much worse than the
        // heuristic it replaces) without false-failing on small δ-driven
        // differences or per-strategy execution divergence.
        const dpAssumptions = baseAssumptions('dp-precomputed');
        const rateAssumptions = baseAssumptions('rate-match');

        const dpResult = runSimulationWithOptimization(
            yearsToSimulate, buildAccounts(), buildIncomes(), buildExpenses(),
            dpAssumptions, taxState, undefined, new Date('2025-06-15'),
        );
        const rateResult = runSimulationWithOptimization(
            yearsToSimulate, buildAccounts(), buildIncomes(), buildExpenses(),
            rateAssumptions, taxState, undefined, new Date('2025-06-15'),
        );

        const sumLifetimeTax = (sim: typeof dpResult) =>
            sim.reduce(
                (s, y) =>
                    s +
                    (y.taxDetails.fed ?? 0) +
                    (y.taxDetails.state ?? 0) +
                    (y.taxDetails.fica ?? 0),
                0,
            );

        const dpTax = sumLifetimeTax(dpResult);
        const rateTax = sumLifetimeTax(rateResult);

        expect(dpTax).toBeLessThan(rateTax * 1.10);
    });
});
