import { describe, it, expect } from 'vitest';
import { InvestedAccount, BrokerageLot } from '../../components/Objects/Accounts/models';
import { AssumptionsState, createBuiltinMilestones, defaultAssumptions } from '../../components/Objects/Assumptions/AssumptionsContext';

// Helper to create a minimal AssumptionsState for increment()
function makeAssumptions(ror: number = 7): AssumptionsState {
    return {
        ...defaultAssumptions,
        demographics: { priorEarnings: [] },
        milestones: createBuiltinMilestones(1990, 65, 90),
        macro: { ...defaultAssumptions.macro, inflationRate: 3, inflationAdjusted: false },
        investments: {
            ...defaultAssumptions.investments,
            returnRates: { ror },
            withdrawalRate: 4,
            withdrawalStrategy: 'None' as const,
            autoRothConversions: false,
            gkUpperGuardrail: 20,
            gkLowerGuardrail: 20,
            gkAdjustmentPercent: 10,
        },
        income: { ...defaultAssumptions.income, salaryGrowth: 3, socialSecurityFundingPercent: 100 },
        expenses: { ...defaultAssumptions.expenses, lifestyleCreep: 0 },
        withdrawalStrategy: [],
        priorities: [],
    };
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
            // Should be long-term: 2030 - 2028 = 2 >= 1
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

    describe('FIFO lot withdrawal', () => {
        it('sells oldest lot first (FIFO)', () => {
            const lots: BrokerageLot[] = [
                { purchaseYear: 2020, costBasis: 40000, currentValue: 60000 },
                { purchaseYear: 2024, costBasis: 20000, currentValue: 40000 },
            ];
            const account = new InvestedAccount(
                'brok-1', 'Brokerage', 100000, 0, 0, 0.1,
                'Brokerage', true, 0.2, 60000, undefined, [], lots
            );

            // Withdraw 50000 - should fully consume the 2020 lot (60000) first
            // But we only need 50000, so 2020 lot is partially sold
            const result = account.increment(makeAssumptions(), -50000, 0, undefined, 0, 2025);

            // 2020 lot should be reduced by 50000, leaving 10000
            // 2024 lot should be untouched
            const returnRate = 1 + (7 - 0.1) / 100;
            expect(result.lots.length).toBe(2);
            expect(result.lots[0].purchaseYear).toBe(2020);
            expect(result.lots[0].currentValue).toBeCloseTo(10000 * returnRate, 0);
            expect(result.lots[1].purchaseYear).toBe(2024);
            expect(result.lots[1].currentValue).toBeCloseTo(40000 * returnRate, 0);
        });

        it('fully exhausts oldest lot before moving to next', () => {
            const lots: BrokerageLot[] = [
                { purchaseYear: 2020, costBasis: 20000, currentValue: 30000 },
                { purchaseYear: 2024, costBasis: 40000, currentValue: 70000 },
            ];
            const account = new InvestedAccount(
                'brok-1', 'Brokerage', 100000, 0, 0, 0.1,
                'Brokerage', true, 0.2, 60000, undefined, [], lots
            );

            // Withdraw 50000 - should fully consume 2020 lot (30000) and take 20000 from 2024 lot
            const result = account.increment(makeAssumptions(), -50000, 0, undefined, 0, 2025);

            const returnRate = 1 + (7 - 0.1) / 100;
            // 2020 lot should be fully consumed (filtered out as < 0.01)
            expect(result.lots.length).toBe(1);
            expect(result.lots[0].purchaseYear).toBe(2024);
            // 2024 lot: 70000 - 20000 = 50000 remaining, then grown
            expect(result.lots[0].currentValue).toBeCloseTo(50000 * returnRate, 0);
        });

        it('removes fully sold lots', () => {
            const lots: BrokerageLot[] = [
                { purchaseYear: 2020, costBasis: 30000, currentValue: 50000 },
                { purchaseYear: 2023, costBasis: 30000, currentValue: 50000 },
            ];
            const account = new InvestedAccount(
                'brok-1', 'Brokerage', 100000, 0, 0, 0.1,
                'Brokerage', true, 0.2, 60000, undefined, [], lots
            );

            // Withdraw exactly the first lot's value
            const result = account.increment(makeAssumptions(), -50000, 0, undefined, 0, 2025);

            // First lot should be removed, second lot remains
            expect(result.lots.length).toBe(1);
            expect(result.lots[0].purchaseYear).toBe(2023);
        });

        it('handles multi-lot withdrawal spanning 3+ lots', () => {
            const lots: BrokerageLot[] = [
                { purchaseYear: 2018, costBasis: 10000, currentValue: 20000 },
                { purchaseYear: 2020, costBasis: 15000, currentValue: 30000 },
                { purchaseYear: 2023, costBasis: 25000, currentValue: 50000 },
            ];
            const account = new InvestedAccount(
                'brok-1', 'Brokerage', 100000, 0, 0, 0.1,
                'Brokerage', true, 0.2, 50000, undefined, [], lots
            );

            // Withdraw 60000 - should consume first two lots (20k + 30k = 50k) and 10k from third
            const result = account.increment(makeAssumptions(), -60000, 0, undefined, 0, 2025);

            const returnRate = 1 + (7 - 0.1) / 100;
            expect(result.lots.length).toBe(1);
            expect(result.lots[0].purchaseYear).toBe(2023);
            // 50000 - 10000 = 40000 remaining, then grown
            expect(result.lots[0].currentValue).toBeCloseTo(40000 * returnRate, 0);
        });

        it('reduces costBasis proportionally within a partially sold lot', () => {
            const lots: BrokerageLot[] = [
                { purchaseYear: 2020, costBasis: 40000, currentValue: 100000 },
            ];
            const account = new InvestedAccount(
                'brok-1', 'Brokerage', 100000, 0, 0, 0.1,
                'Brokerage', true, 0.2, 40000, undefined, [], lots
            );

            // Withdraw 50% of the lot's value
            const result = account.increment(makeAssumptions(), -50000, 0, undefined, 0, 2025);

            // costBasis should also be reduced by 50%
            expect(result.lots[0].costBasis).toBeCloseTo(20000, 0);
        });
    });

    describe('Short-term vs long-term classification', () => {
        // Long-term capital gains require holding for MORE than 1 year.
        // With year-only precision: currentYear - purchaseYear >= 1 means long-term
        // e.g., purchased 2024, sold 2025 → difference = 1 → long-term

        describe('holding period classification', () => {
            it('same year purchase and sale is short-term', () => {
                // purchaseYear: 2025, currentYear: 2025 → difference = 0 → short-term
                const account = new InvestedAccount(
                    'brok-1', 'Brokerage', 100000, 0, 0, 0.1,
                    'Brokerage', true, 0.2, 60000, undefined, [],
                    [{ purchaseYear: 2025, costBasis: 60000, currentValue: 100000 }]
                );

                const result = account.calculateLotAwareWithdrawal(50000, 2025);

                // 2025 - 2025 = 0 < 1, so short-term
                expect(result.shortTermGains).toBeGreaterThan(0);
                expect(result.longTermGains).toBe(0);
            });

            it('1 year difference is short-term (conservative with year-only precision)', () => {
                // purchaseYear: 2024, currentYear: 2025 → difference = 1 → short-term
                // Using >= 2 threshold to be conservative (Dec 2024 → Jan 2025 could be only 1 month)
                const account = new InvestedAccount(
                    'brok-1', 'Brokerage', 100000, 0, 0, 0.1,
                    'Brokerage', true, 0.2, 60000, undefined, [],
                    [{ purchaseYear: 2024, costBasis: 60000, currentValue: 100000 }]
                );

                const result = account.calculateLotAwareWithdrawal(50000, 2025);

                // 2025 - 2024 = 1 < 2, so short-term (conservative)
                expect(result.shortTermGains).toBeGreaterThan(0);
                expect(result.longTermGains).toBe(0);
            });

            it('2+ year difference is long-term', () => {
                // purchaseYear: 2023, currentYear: 2025 → difference = 2 → long-term
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
        });

        it('splits gains across short and long-term lots correctly with FIFO', () => {
            const lots: BrokerageLot[] = [
                { purchaseYear: 2020, costBasis: 30000, currentValue: 50000 }, // Long-term (5 years)
                { purchaseYear: 2025, costBasis: 30000, currentValue: 50000 }, // Short-term (same year)
            ];
            const account = new InvestedAccount(
                'brok-1', 'Brokerage', 100000, 0, 0, 0.1,
                'Brokerage', true, 0.2, 60000, undefined, [], lots
            );

            // FIFO: Withdraw 60000 - takes all of 2020 lot (50k) + 10k from 2025 lot
            const result = account.calculateLotAwareWithdrawal(60000, 2025);

            // 2020 lot (long-term): all 50000 sold, gain = 50000 - 30000 = 20000
            // 2025 lot (short-term): 10000 sold (20% of 50000), gain = 10000 - 6000 = 4000
            expect(result.longTermGains).toBeCloseTo(20000, 0);
            expect(result.shortTermGains).toBeCloseTo(4000, 0);
            expect(result.basisReturn).toBeCloseTo(36000, 0); // 30000 + 6000
        });

        it('sells oldest lot first for tax calculation (FIFO)', () => {
            const lots: BrokerageLot[] = [
                { purchaseYear: 2020, costBasis: 30000, currentValue: 50000 }, // Long-term
                { purchaseYear: 2025, costBasis: 30000, currentValue: 50000 }, // Short-term
            ];
            const account = new InvestedAccount(
                'brok-1', 'Brokerage', 100000, 0, 0, 0.1,
                'Brokerage', true, 0.2, 60000, undefined, [], lots
            );

            // Withdraw only 40000 - should come entirely from 2020 lot (oldest)
            const result = account.calculateLotAwareWithdrawal(40000, 2025);

            // All from 2020 lot (long-term): gain = 40000 - 24000 = 16000
            // (40k is 80% of 50k value, so basis = 80% of 30k = 24k)
            expect(result.longTermGains).toBeCloseTo(16000, 0);
            expect(result.shortTermGains).toBe(0); // 2025 lot untouched
            expect(result.basisReturn).toBeCloseTo(24000, 0);
        });

        it('handles lot at exactly the 2-year boundary as long-term', () => {
            // With year-only precision, >= 2 year difference = long-term (conservative)
            const account = new InvestedAccount(
                'brok-1', 'Brokerage', 100000, 0, 0, 0.1,
                'Brokerage', true, 0.2, 60000, undefined, [],
                [{ purchaseYear: 2023, costBasis: 60000, currentValue: 100000 }]
            );

            // Exactly 2 years later (2025 - 2023 = 2)
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

            // Verify all lots are long-term by year 2027
            // Seed lot purchaseYear = 2023, so 2027 - 2023 = 4 >= 1, long-term
            // Year 2025 contribution: 2027 - 2025 = 2 >= 1, long-term
            // Year 2026 contribution: 2027 - 2026 = 1 >= 1, long-term
            const result = account.calculateLotAwareWithdrawal(1000, 2027);
            expect(result.shortTermGains).toBe(0);
            expect(result.longTermGains).toBeGreaterThan(0);
        });
    });

    // =========================================================================
    // FIFO-specific tests
    // =========================================================================
    describe('FIFO lot selection behavior', () => {
        it('sells 2020 lot before 2024 lot', () => {
            const lots: BrokerageLot[] = [
                { purchaseYear: 2024, costBasis: 20000, currentValue: 25000 }, // Newer
                { purchaseYear: 2020, costBasis: 30000, currentValue: 50000 }, // Older (should sell first)
            ];
            const account = new InvestedAccount(
                'brok-1', 'Brokerage', 75000, 0, 0, 0.1,
                'Brokerage', true, 0.2, 50000, undefined, [], lots
            );

            // Withdraw 40000 - should come from 2020 lot first (even though it's second in array)
            const result = account.calculateLotAwareWithdrawal(40000, 2025);

            // 2020 lot: 40000 is 80% of 50000, so basis = 80% of 30000 = 24000
            // gain = 40000 - 24000 = 16000 (long-term: 2025 - 2020 = 5)
            expect(result.longTermGains).toBeCloseTo(16000, 0);
            expect(result.shortTermGains).toBe(0); // 2024 lot not touched
        });

        it('partial lot sale leaves remainder in lot', () => {
            const lots: BrokerageLot[] = [
                { purchaseYear: 2020, costBasis: 30000, currentValue: 50000 },
            ];
            // Use 0 expense ratio to avoid growth complications
            const account = new InvestedAccount(
                'brok-1', 'Brokerage', 50000, 0, 0, 0, // 0% expense ratio
                'Brokerage', true, 0.2, 30000, undefined, [], lots
            );

            // Withdraw 10000 from 50000 lot
            const result = account.increment(makeAssumptions(0), -10000, 0, undefined, 0, 2025);

            // Lot should have 40000 remaining (no growth with 0% return and 0% expense)
            expect(result.lots.length).toBe(1);
            expect(result.lots[0].currentValue).toBeCloseTo(40000, 0);
            // costBasis reduced proportionally: 30000 * (40000/50000) = 24000
            expect(result.lots[0].costBasis).toBeCloseTo(24000, 0);
        });

        it('multi-lot sale spans multiple lots correctly', () => {
            const lots: BrokerageLot[] = [
                { purchaseYear: 2018, costBasis: 10000, currentValue: 15000 }, // Oldest (long-term)
                { purchaseYear: 2020, costBasis: 20000, currentValue: 30000 }, // Middle (long-term)
                { purchaseYear: 2024, costBasis: 25000, currentValue: 35000 }, // Newest (short-term, only 1 year)
            ];
            const account = new InvestedAccount(
                'brok-1', 'Brokerage', 80000, 0, 0, 0.1,
                'Brokerage', true, 0.2, 55000, undefined, [], lots
            );

            // Withdraw 55000: exhausts 2018 (15k) + 2020 (30k) + takes 10k from 2024
            const result = account.calculateLotAwareWithdrawal(55000, 2025);

            // 2018 lot: gain = 15000 - 10000 = 5000 (long-term, 7 year diff)
            // 2020 lot: gain = 30000 - 20000 = 10000 (long-term, 5 year diff)
            // 2024 lot: 10000/35000 = 28.57% sold, basis = 7142.86, gain = 2857.14 (short-term, 1 year diff < 2)
            expect(result.longTermGains).toBeCloseTo(5000 + 10000, 0);
            expect(result.shortTermGains).toBeCloseTo(2857.14, 0);
            expect(result.basisReturn).toBeCloseTo(10000 + 20000 + 7142.86, 0);
        });

        it('STCG vs LTCG classification works correctly with FIFO', () => {
            const lots: BrokerageLot[] = [
                { purchaseYear: 2023, costBasis: 10000, currentValue: 12000 }, // Long-term (2+ years)
                { purchaseYear: 2025, costBasis: 15000, currentValue: 18000 }, // Short-term (same year)
            ];
            const account = new InvestedAccount(
                'brok-1', 'Brokerage', 30000, 0, 0, 0.1,
                'Brokerage', true, 0.2, 25000, undefined, [], lots
            );

            // Withdraw 20000: exhausts 2023 lot (12k) + takes 8k from 2025 lot
            const result = account.calculateLotAwareWithdrawal(20000, 2025);

            // 2023 lot (long-term, 2+ year diff): gain = 12000 - 10000 = 2000
            // 2025 lot (short-term): 8000/18000 = 44.44% sold
            //   basis = 6666.67, gain = 8000 - 6666.67 = 1333.33
            expect(result.longTermGains).toBeCloseTo(2000, 0);
            expect(result.shortTermGains).toBeCloseTo(1333.33, 0);
        });

        it('handles unsorted lots array (sorts by purchaseYear)', () => {
            // Lots deliberately in wrong order
            const lots: BrokerageLot[] = [
                { purchaseYear: 2023, costBasis: 20000, currentValue: 30000 },
                { purchaseYear: 2020, costBasis: 15000, currentValue: 25000 }, // Oldest but second
                { purchaseYear: 2022, costBasis: 18000, currentValue: 28000 },
            ];
            const account = new InvestedAccount(
                'brok-1', 'Brokerage', 83000, 0, 0, 0.1,
                'Brokerage', true, 0.2, 53000, undefined, [], lots
            );

            // Withdraw 20000 - should come from 2020 lot (oldest) first
            const result = account.calculateLotAwareWithdrawal(20000, 2025);

            // 2020 lot: 20000/25000 = 80% sold, basis = 12000, gain = 8000 (long-term)
            expect(result.longTermGains).toBeCloseTo(8000, 0);
            expect(result.shortTermGains).toBe(0);
            expect(result.basisReturn).toBeCloseTo(12000, 0);
        });
    });
});
