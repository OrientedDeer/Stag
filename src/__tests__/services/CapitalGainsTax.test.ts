import { describe, it, expect } from 'vitest';
import { InvestedAccount } from '../../components/Objects/Accounts/models';
import { calculateCapitalGainsTax } from '../../components/Objects/Taxes/TaxService';
import { TaxState } from '../../components/Objects/Taxes/TaxContext';

describe('Capital Gains Tax', () => {
    const baseTaxState: TaxState = {
        filingStatus: 'Single',
        deductionMethod: 'Standard',
        stateResidency: 'Texas', // No state income tax
        fedOverride: null,
        stateOverride: null,
        ficaOverride: null,
        year: 2025,
    };

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
                demographics: { birthYear: 1994, retirementAge: 65, lifeExpectancy: 90 },
                macro: { inflationRate: 3, healthcareInflation: 5, inflationAdjusted: false },
                investments: { returnRates: { ror: 7 }, withdrawalRate: 4, withdrawalStrategy: 'Fixed Real' as const, gkUpperGuardrail: 1.2, gkLowerGuardrail: 0.8, gkAdjustmentPercent: 10, autoRothConversions: false },
                income: { salaryGrowth: 3, qualifiesForSocialSecurity: true, socialSecurityFundingPercent: 100 },
                expenses: { lifestyleCreep: 0, housingAppreciation: 3, rentInflation: 3 },
                priorities: [],
                withdrawalStrategy: [],
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
                demographics: { birthYear: 1994, retirementAge: 65, lifeExpectancy: 90 },
                macro: { inflationRate: 3, healthcareInflation: 5, inflationAdjusted: false },
                investments: { returnRates: { ror: 7 }, withdrawalRate: 4, withdrawalStrategy: 'Fixed Real' as const, gkUpperGuardrail: 1.2, gkLowerGuardrail: 0.8, gkAdjustmentPercent: 10, autoRothConversions: false },
                income: { salaryGrowth: 3, qualifiesForSocialSecurity: true, socialSecurityFundingPercent: 100 },
                expenses: { lifestyleCreep: 0, housingAppreciation: 3, rentInflation: 3 },
                priorities: [],
                withdrawalStrategy: [],
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
                demographics: { birthYear: 1994, retirementAge: 65, lifeExpectancy: 90 },
                macro: { inflationRate: 3, healthcareInflation: 5, inflationAdjusted: false },
                investments: { returnRates: { ror: 7 }, withdrawalRate: 4, withdrawalStrategy: 'Fixed Real' as const, gkUpperGuardrail: 1.2, gkLowerGuardrail: 0.8, gkAdjustmentPercent: 10, autoRothConversions: false },
                income: { salaryGrowth: 3, qualifiesForSocialSecurity: true, socialSecurityFundingPercent: 100 },
                expenses: { lifestyleCreep: 0, housingAppreciation: 3, rentInflation: 3 },
                priorities: [],
                withdrawalStrategy: [],
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

    describe('calculateCapitalGainsTax', () => {
        it('should return 0% tax for gains within 0% bracket', () => {
            // For 2025 Single, 0% bracket is up to $48,350 taxable income
            const tax = calculateCapitalGainsTax(
                10000,  // gains
                30000,  // ordinaryTaxableIncome (within 0% bracket)
                baseTaxState,
                2025
            );

            // All gains should be in the 0% bracket
            expect(tax).toBe(0);
        });

        it('should apply 15% rate for gains in middle bracket', () => {
            // If ordinary income is $50k (above 0% threshold), gains should be at 15%
            const tax = calculateCapitalGainsTax(
                10000,  // gains
                60000,  // ordinaryTaxableIncome (already above 0% bracket)
                baseTaxState,
                2025
            );

            // All $10k gains should be at 15%
            expect(tax).toBe(1500);
        });

        it('should split gains across brackets', () => {
            // If ordinary income is just below the 0% threshold
            // Some gains should be at 0%, rest at 15%
            const tax = calculateCapitalGainsTax(
                20000,  // gains
                40000,  // ordinaryTaxableIncome (below $48,350 threshold)
                baseTaxState,
                2025
            );

            // $8,350 should be at 0% (filling up to $48,350)
            // $11,650 should be at 15%
            const expected = (8350 * 0) + (11650 * 0.15);
            expect(tax).toBeCloseTo(expected, 0);
        });

        it('should apply 20% rate for high income', () => {
            // If ordinary income pushes gains into 20% bracket
            // 2025 Single: 15% up to $533,400, 20% above
            const tax = calculateCapitalGainsTax(
                50000,  // gains
                500000, // ordinaryTaxableIncome
                baseTaxState,
                2025
            );

            // $33,400 at 15% (filling from $500k to $533,400)
            // $16,600 at 20% (above $533,400)
            const expected = (33400 * 0.15) + (16600 * 0.20);
            expect(tax).toBeCloseTo(expected, 0);
        });

        it('should handle Married Filing Jointly brackets', () => {
            const mfjTaxState: TaxState = {
                ...baseTaxState,
                filingStatus: 'Married Filing Jointly',
            };

            // MFJ has higher thresholds: 0% up to $96,700 in 2025
            const tax = calculateCapitalGainsTax(
                20000,  // gains
                80000,  // ordinaryTaxableIncome
                mfjTaxState,
                2025
            );

            // $16,700 at 0% (filling from $80k to $96,700)
            // $3,300 at 15% (above $96,700)
            const expected = (16700 * 0) + (3300 * 0.15);
            expect(tax).toBeCloseTo(expected, 0);
        });

        it('should return 0 for negative or zero gains', () => {
            expect(calculateCapitalGainsTax(0, 50000, baseTaxState, 2025)).toBe(0);
            expect(calculateCapitalGainsTax(-1000, 50000, baseTaxState, 2025)).toBe(0);
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
