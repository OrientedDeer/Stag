import { describe, it, expect } from 'vitest';
import { InvestedAccount, BrokerageLot } from '../../components/Objects/Accounts/models';
import { createBuiltinMilestones } from '../../components/Objects/Assumptions/AssumptionsContext';

// Helper to create a minimal AssumptionsState for increment()
function makeAssumptions(ror: number = 7) {
    return {
        demographics: { priorEarnings: [] },
        milestones: createBuiltinMilestones(1990, 65, 90),
        macro: { inflationRate: 3, inflationAdjusted: false },
        investments: {
            returnRates: { ror },
            withdrawalRate: 4,
            withdrawalStrategy: 'None' as const,
            autoRothConversions: false,
            rothConversionTargetBracket: 0.22,
            gkUpperGuardrail: 20,
            gkLowerGuardrail: 20,
            gkAdjustmentPercent: 10,
        },
        income: { salaryGrowth: 3, socialSecurityFundingPercent: 100 },
        expenses: { lifestyleCreep: 0 },
        withdrawalStrategy: [],
        priorities: [],
    } as any;
}

describe('BrokerageLot tracking', () => {
    describe('Seed lot creation', () => {
        it('creates a seed lot on first increment when lots are empty', () => {
            const account = new InvestedAccount(
                'brok-1', 'Brokerage', 100000, 0, 0, 0.1,
                'Brokerage', true, 0.2, 80000 // costBasis = 80000
            );

            const result = account.increment(makeAssumptions(), 0, 0, undefined, 0, 2025);

            expect(result.lots.length).toBe(1);
            expect(result.lots[0].purchaseYear).toBe(2023); // year - 2
            expect(result.lots[0].costBasis).toBe(80000); // matches original costBasis
        });

        it('uses purchaseYear = year - 2 to treat existing holdings as long-term', () => {
            const account = new InvestedAccount(
                'brok-1', 'Brokerage', 50000, 0, 0, 0.1,
                'Brokerage', true, 0.2, 40000
            );

            const result = account.increment(makeAssumptions(), 0, 0, undefined, 0, 2030);

            expect(result.lots[0].purchaseYear).toBe(2028);
            // Should be long-term: 2030 - 2028 = 2 >= 2
        });

        it('does not create seed lot for non-Brokerage accounts', () => {
            const tradAccount = new InvestedAccount(
                'trad-1', 'Traditional', 100000, 0, 0, 0.1,
                'Traditional 401k', true, 0.2, 80000
            );

            const result = tradAccount.increment(makeAssumptions(), 0, 0, undefined, 0, 2025);
            expect(result.lots.length).toBe(0);
        });

        it('does not create seed lot when currentYear is 0', () => {
            const account = new InvestedAccount(
                'brok-1', 'Brokerage', 100000, 0, 0, 0.1,
                'Brokerage', true, 0.2, 80000
            );

            const result = account.increment(makeAssumptions(), 0, 0, undefined, 0, 0);
            expect(result.lots.length).toBe(0);
        });
    });

    describe('Contribution creates new lot', () => {
        it('adds a new lot with contribution amount when user contributes', () => {
            const account = new InvestedAccount(
                'brok-1', 'Brokerage', 100000, 0, 0, 0.1,
                'Brokerage', true, 0.2, 80000
            );

            // First increment creates seed lot
            const seeded = account.increment(makeAssumptions(), 0, 0, undefined, 0, 2025);
            expect(seeded.lots.length).toBe(1);

            // Second increment with contribution creates a new lot
            const contributed = seeded.increment(makeAssumptions(), 10000, 0, undefined, 0, 2026);
            expect(contributed.lots.length).toBe(2);

            // New lot should have the contribution year and amount
            const newLot = contributed.lots[1];
            expect(newLot.purchaseYear).toBe(2026);
            expect(newLot.costBasis).toBe(10000);
            expect(newLot.currentValue).toBeCloseTo(10000 * (1 + (7 - 0.1) / 100), 0);
        });

        it('does not create lot for zero contribution', () => {
            const account = new InvestedAccount(
                'brok-1', 'Brokerage', 100000, 0, 0, 0.1,
                'Brokerage', true, 0.2, 80000
            );

            const seeded = account.increment(makeAssumptions(), 0, 0, undefined, 0, 2025);
            const noContrib = seeded.increment(makeAssumptions(), 0, 0, undefined, 0, 2026);
            expect(noContrib.lots.length).toBe(1); // Still just seed lot
        });
    });

    describe('Lot growth', () => {
        it('grows currentValue proportionally with returnRate', () => {
            const returnRate = 1 + (7 - 0.1) / 100; // 6.9% net
            const account = new InvestedAccount(
                'brok-1', 'Brokerage', 100000, 0, 0, 0.1,
                'Brokerage', true, 0.2, 100000, undefined, [],
                [{ purchaseYear: 2023, costBasis: 80000, currentValue: 100000 }]
            );

            const result = account.increment(makeAssumptions(), 0, 0, undefined, 0, 2025);

            expect(result.lots[0].currentValue).toBeCloseTo(100000 * returnRate, 0);
        });

        it('keeps costBasis fixed during growth', () => {
            const account = new InvestedAccount(
                'brok-1', 'Brokerage', 100000, 0, 0, 0.1,
                'Brokerage', true, 0.2, 80000, undefined, [],
                [{ purchaseYear: 2023, costBasis: 80000, currentValue: 100000 }]
            );

            const result = account.increment(makeAssumptions(), 0, 0, undefined, 0, 2025);

            expect(result.lots[0].costBasis).toBe(80000); // Unchanged
        });

        it('applies same growth rate to all lots', () => {
            const lots: BrokerageLot[] = [
                { purchaseYear: 2020, costBasis: 50000, currentValue: 70000 },
                { purchaseYear: 2023, costBasis: 30000, currentValue: 35000 },
            ];
            const account = new InvestedAccount(
                'brok-1', 'Brokerage', 105000, 0, 0, 0.1,
                'Brokerage', true, 0.2, 80000, undefined, [], lots
            );

            const result = account.increment(makeAssumptions(), 0, 0, undefined, 0, 2025);

            const returnRate = 1 + (7 - 0.1) / 100;
            expect(result.lots[0].currentValue).toBeCloseTo(70000 * returnRate, 0);
            expect(result.lots[1].currentValue).toBeCloseTo(35000 * returnRate, 0);
        });
    });

    describe('Withdrawal reduces lots proportionally', () => {
        it('reduces all lots proportionally on withdrawal', () => {
            const lots: BrokerageLot[] = [
                { purchaseYear: 2020, costBasis: 40000, currentValue: 60000 },
                { purchaseYear: 2023, costBasis: 20000, currentValue: 40000 },
            ];
            const account = new InvestedAccount(
                'brok-1', 'Brokerage', 100000, 0, 0, 0.1,
                'Brokerage', true, 0.2, 60000, undefined, [], lots
            );

            // Withdraw 50% of account
            const result = account.increment(makeAssumptions(), -50000, 0, undefined, 0, 2025);

            // Each lot should be reduced by 50%
            expect(result.lots[0].costBasis).toBeCloseTo(20000, 0);
            expect(result.lots[0].currentValue).toBeCloseTo(30000 * (1 + (7 - 0.1) / 100), 0);
            expect(result.lots[1].costBasis).toBeCloseTo(10000, 0);
            expect(result.lots[1].currentValue).toBeCloseTo(20000 * (1 + (7 - 0.1) / 100), 0);
        });

        it('filters out negligible lots after withdrawal', () => {
            const lots: BrokerageLot[] = [
                { purchaseYear: 2020, costBasis: 0.005, currentValue: 0.005 },
                { purchaseYear: 2023, costBasis: 50000, currentValue: 80000 },
            ];
            const account = new InvestedAccount(
                'brok-1', 'Brokerage', 80000.005, 0, 0, 0.1,
                'Brokerage', true, 0.2, 50000.005, undefined, [], lots
            );

            // Any withdrawal that reduces the tiny lot below 0.01
            const result = account.increment(makeAssumptions(), -40000, 0, undefined, 0, 2025);

            // The negligible lot should be filtered
            expect(result.lots.length).toBe(1);
            expect(result.lots[0].purchaseYear).toBe(2023);
        });
    });

    describe('Short-term vs long-term classification', () => {
        it('classifies lot as long-term when currentYear - purchaseYear >= 2', () => {
            const account = new InvestedAccount(
                'brok-1', 'Brokerage', 100000, 0, 0, 0.1,
                'Brokerage', true, 0.2, 60000, undefined, [],
                [{ purchaseYear: 2023, costBasis: 60000, currentValue: 100000 }]
            );

            const result = account.calculateLotAwareWithdrawal(50000, 2025);

            // 2025 - 2023 = 2 >= 2, so long-term
            expect(result.longTermGains).toBeGreaterThan(0);
            expect(result.shortTermGains).toBe(0);
        });

        it('classifies lot as short-term when currentYear - purchaseYear < 2', () => {
            const account = new InvestedAccount(
                'brok-1', 'Brokerage', 100000, 0, 0, 0.1,
                'Brokerage', true, 0.2, 60000, undefined, [],
                [{ purchaseYear: 2024, costBasis: 60000, currentValue: 100000 }]
            );

            const result = account.calculateLotAwareWithdrawal(50000, 2025);

            // 2025 - 2024 = 1 < 2, so short-term
            expect(result.shortTermGains).toBeGreaterThan(0);
            expect(result.longTermGains).toBe(0);
        });

        it('splits gains across short and long-term lots correctly', () => {
            const lots: BrokerageLot[] = [
                { purchaseYear: 2020, costBasis: 30000, currentValue: 50000 }, // Long-term (5 years)
                { purchaseYear: 2024, costBasis: 30000, currentValue: 50000 }, // Short-term (1 year)
            ];
            const account = new InvestedAccount(
                'brok-1', 'Brokerage', 100000, 0, 0, 0.1,
                'Brokerage', true, 0.2, 60000, undefined, [], lots
            );

            const result = account.calculateLotAwareWithdrawal(100000, 2025);

            // Total lot value = 100000, withdrawal = 100000 (100%)
            // Each lot: gain = 50000 - 30000 = 20000
            // Long-term lot (2020): 20000 gain
            // Short-term lot (2024): 20000 gain
            expect(result.longTermGains).toBeCloseTo(20000, 0);
            expect(result.shortTermGains).toBeCloseTo(20000, 0);
            expect(result.basisReturn).toBeCloseTo(60000, 0);
        });

        it('handles lot at exactly the 2-year boundary as long-term', () => {
            const account = new InvestedAccount(
                'brok-1', 'Brokerage', 100000, 0, 0, 0.1,
                'Brokerage', true, 0.2, 60000, undefined, [],
                [{ purchaseYear: 2023, costBasis: 60000, currentValue: 100000 }]
            );

            // Exactly 2 years later
            const result = account.calculateLotAwareWithdrawal(50000, 2025);
            expect(result.longTermGains).toBeGreaterThan(0);
            expect(result.shortTermGains).toBe(0);
        });
    });

    describe('Fallback to proportional when no lots', () => {
        it('falls back to proportional method when lots array is empty', () => {
            const account = new InvestedAccount(
                'brok-1', 'Brokerage', 100000, 0, 0, 0.1,
                'Brokerage', true, 0.2, 60000, undefined, [],
                [] // No lots
            );

            const result = account.calculateLotAwareWithdrawal(50000, 2025);

            // All gains treated as long-term in fallback
            const expectedGains = 50000 * (40000 / 100000); // gainsPortion = 40000/100000
            expect(result.longTermGains).toBeCloseTo(expectedGains, 0);
            expect(result.shortTermGains).toBe(0);
            expect(result.basisReturn).toBeCloseTo(50000 - expectedGains, 0);
        });

        it('returns zero gains when amount is zero', () => {
            const account = new InvestedAccount(
                'brok-1', 'Brokerage', 0, 0, 0, 0.1,
                'Brokerage', true, 0.2, 0
            );

            const result = account.calculateLotAwareWithdrawal(1000, 2025);

            expect(result.shortTermGains).toBe(0);
            expect(result.longTermGains).toBe(0);
            expect(result.basisReturn).toBe(0);
        });
    });

    describe('Multi-year simulation lot accumulation', () => {
        it('accumulates lots correctly across multiple years', () => {
            let account = new InvestedAccount(
                'brok-1', 'Brokerage', 50000, 0, 0, 0.1,
                'Brokerage', true, 0.2, 50000
            );

            // Year 1: Initial seed + contribution
            account = account.increment(makeAssumptions(7), 10000, 0, undefined, 0, 2025);
            expect(account.lots.length).toBe(2); // seed + contribution

            // Year 2: Another contribution
            account = account.increment(makeAssumptions(7), 10000, 0, undefined, 0, 2026);
            expect(account.lots.length).toBe(3);

            // Year 3: No contribution
            account = account.increment(makeAssumptions(7), 0, 0, undefined, 0, 2027);
            expect(account.lots.length).toBe(3); // No new lot

            // Verify seed lot is still long-term by year 2027
            // Seed lot purchaseYear = 2023, so 2027 - 2023 = 4 >= 2
            const result = account.calculateLotAwareWithdrawal(1000, 2027);
            // Year 2025 contribution: 2027 - 2025 = 2, long-term
            // Year 2026 contribution: 2027 - 2026 = 1, short-term
            expect(result.shortTermGains).toBeGreaterThanOrEqual(0);
        });
    });
});
