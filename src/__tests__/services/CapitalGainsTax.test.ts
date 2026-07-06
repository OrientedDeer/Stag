import { describe, it, expect } from 'vitest';
import { InvestedAccount } from '../../components/Objects/Accounts/models';
import { createBuiltinMilestones } from '../../components/Objects/Assumptions/AssumptionsContext';

describe('Capital Gains Tax', () => {
    describe('InvestedAccount costBasis tracking', () => {
        it('should initialize costBasis equal to amount', () => {
            const account = new InvestedAccount(
                'test-1',
                'Test Brokerage',
                100000, // amount
                0,      // employerBalance
                0,      // tenureYears
                0.1,    // expenseRatio
                'Brokerage'
            );

            expect(account.amount).toBe(100000);
            expect(account.costBasis).toBe(100000);
            expect(account.unrealizedGains).toBe(0);
        });

        it('should track gains after growth', () => {
            const assumptions = {
                demographics: {},
                macro: { inflationRate: 3, healthcareInflation: 5, inflationAdjusted: false },
                investments: { returnRates: { ror: 7 }, withdrawalRate: 4, withdrawalStrategy: 'Fixed Real' as const, gkUpperGuardrail: 1.2, gkLowerGuardrail: 0.8, gkAdjustmentPercent: 10, autoRothConversions: false, taxOptimizationEnabled: false, acaAware: true },
                income: { salaryGrowth: 3, qualifiesForSocialSecurity: true, socialSecurityFundingPercent: 100 },
                expenses: { lifestyleCreep: 0, housingAppreciation: 3, rentInflation: 3 },
                priorities: [],
                withdrawalStrategy: [],
                milestones: createBuiltinMilestones(1994, 65, 90),
                display: { useCompactCurrency: true, showExperimentalFeatures: false, hsaEligible: true },
            };

            let account = new InvestedAccount(
                'test-1',
                'Test Brokerage',
                100000,
                0, 0, 0.1, 'Brokerage', true, 0.2,
                100000 // costBasis
            );

            // Grow for one year (7% return - 0.1% expense = 6.9% growth)
            account = account.increment(assumptions, 0, 0);

            // After growth, amount should be higher but costBasis stays the same
            expect(account.amount).toBeGreaterThan(100000);
            expect(account.costBasis).toBe(100000); // costBasis unchanged
            expect(account.unrealizedGains).toBeGreaterThan(0);
        });

        it('should increase costBasis with contributions', () => {
            const assumptions = {
                demographics: {},
                macro: { inflationRate: 3, healthcareInflation: 5, inflationAdjusted: false },
                investments: { returnRates: { ror: 7 }, withdrawalRate: 4, withdrawalStrategy: 'Fixed Real' as const, gkUpperGuardrail: 1.2, gkLowerGuardrail: 0.8, gkAdjustmentPercent: 10, autoRothConversions: false, taxOptimizationEnabled: false, acaAware: true },
                income: { salaryGrowth: 3, qualifiesForSocialSecurity: true, socialSecurityFundingPercent: 100 },
                expenses: { lifestyleCreep: 0, housingAppreciation: 3, rentInflation: 3 },
                priorities: [],
                withdrawalStrategy: [],
                milestones: createBuiltinMilestones(1994, 65, 90),
                display: { useCompactCurrency: true, showExperimentalFeatures: false, hsaEligible: true },
            };

            let account = new InvestedAccount(
                'test-1',
                'Test Brokerage',
                100000,
                0, 0, 0.1, 'Brokerage', true, 0.2,
                100000
            );

            // Add $10k contribution
            account = account.increment(assumptions, 10000, 0);

            // CostBasis should increase by the contribution amount
            expect(account.costBasis).toBeCloseTo(110000, 0);
        });

        it('should decrease costBasis proportionally on withdrawal', () => {
            const assumptions = {
                demographics: {},
                macro: { inflationRate: 3, healthcareInflation: 5, inflationAdjusted: false },
                investments: { returnRates: { ror: 7 }, withdrawalRate: 4, withdrawalStrategy: 'Fixed Real' as const, gkUpperGuardrail: 1.2, gkLowerGuardrail: 0.8, gkAdjustmentPercent: 10, autoRothConversions: false, taxOptimizationEnabled: false, acaAware: true },
                income: { salaryGrowth: 3, qualifiesForSocialSecurity: true, socialSecurityFundingPercent: 100 },
                expenses: { lifestyleCreep: 0, housingAppreciation: 3, rentInflation: 3 },
                priorities: [],
                withdrawalStrategy: [],
                milestones: createBuiltinMilestones(1994, 65, 90),
                display: { useCompactCurrency: true, showExperimentalFeatures: false, hsaEligible: true },
            };

            // Start with $100k balance, $80k cost basis (so $20k in gains)
            let account = new InvestedAccount(
                'test-1',
                'Test Brokerage',
                100000,
                0, 0, 0.1, 'Brokerage', true, 0.2,
                80000 // costBasis is less than amount (has gains)
            );

            expect(account.unrealizedGains).toBe(20000);

            // Withdraw 10% ($10k)
            account = account.increment(assumptions, -10000, 0);

            // After growth and withdrawal, costBasis should be reduced by 10%
            // Note: withdrawal happens before growth in the logic
            expect(account.costBasis).toBeCloseTo(72000, 0); // 80000 * 0.9
        });

        it('should calculate withdrawal allocation correctly', () => {
            const account = new InvestedAccount(
                'test-1',
                'Test Brokerage',
                100000, // total value
                0, 0, 0.1, 'Brokerage', true, 0.2,
                60000   // costBasis (40% gains)
            );

            const allocation = account.calculateWithdrawalAllocation(10000);

            // 40% of account is gains, 60% is basis
            expect(allocation.gains).toBe(4000);  // 40% of 10000
            expect(allocation.basis).toBe(6000);  // 60% of 10000
        });
    });

    describe('Roth early withdrawal gains taxation', () => {
        it('should recognize Roth IRA has cost basis for tracking', () => {
            const rothAccount = new InvestedAccount(
                'roth-1',
                'Roth IRA',
                50000,  // current value
                0, 5, 0.1,
                'Roth IRA',
                true, 0.2,
                30000   // costBasis (contributions)
            );

            expect(rothAccount.costBasis).toBe(30000);
            expect(rothAccount.unrealizedGains).toBe(20000);
        });

        it('should calculate Roth withdrawal allocation correctly', () => {
            const rothAccount = new InvestedAccount(
                'roth-1',
                'Roth IRA',
                50000,
                0, 5, 0.1,
                'Roth IRA',
                true, 0.2,
                30000
            );

            // For Roth, ordering rules say contributions come out first
            // But proportional method gives us an estimate
            const allocation = rothAccount.calculateWithdrawalAllocation(10000);

            expect(allocation.basis).toBe(6000);  // 60% basis
            expect(allocation.gains).toBe(4000);  // 40% gains
        });
    });
});
