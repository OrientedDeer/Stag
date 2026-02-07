import { describe, it, expect, vi } from 'vitest';
import {
    SavedAccount,
    InvestedAccount,
    ESPPAccount,
    ESPPLot,
    BrokerageLot,
    PropertyAccount,
    DebtAccount,
    DeficitDebtAccount,
    reconstituteAccount
} from '../../../../components/Objects/Accounts/models';
import { defaultAssumptions } from '../../../../components/Objects/Assumptions/AssumptionsContext';

// Mock Assumptions for testing the 'increment' methods
const mockAssumptions = {
    ...defaultAssumptions,
    investments: {
        ...defaultAssumptions.investments,
        returnRates: { ror: 10 } // 10%
    },
    macro: {
        ...defaultAssumptions.macro,
        inflationRate: 3, // 3%
        inflationAdjusted: false,
    },
    expenses: {
        ...defaultAssumptions.expenses,
        housingAppreciation: 5, // 5%
    }
};

describe('Account Models', () => {

    describe('SavedAccount', () => {
        it('should initialize with correct defaults', () => {
            const acc = new SavedAccount('s1', 'Emergency Fund', 1000);
            expect(acc.apr).toBe(0);
        });

        it('should increment its value based on APR and contribution', () => {
            const acc = new SavedAccount('s1', 'Emergency Fund', 1000, 5); // 5% APR
            const nextYear = acc.increment(mockAssumptions, 500);
            // BOY timing: (1000 + 500) * 1.05 = 1575
            expect(nextYear.amount).toBeCloseTo((1000 + 500) * 1.05);
        });

        it('should grow $10,000 at 5% APR without contribution to $10,500', () => {
            const acc = new SavedAccount('s1', 'Savings', 10000, 5); // 5% APR
            const nextYear = acc.increment(mockAssumptions, 0);
            // $10,000 × 1.05 = $10,500
            expect(nextYear.amount).toBe(10500);
        });

        it('should grow $10,000 + $2,000 contribution at 5% APR to $12,600', () => {
            const acc = new SavedAccount('s1', 'Savings', 10000, 5); // 5% APR
            const nextYear = acc.increment(mockAssumptions, 2000);
            // BOY timing: ($10,000 + $2,000) × 1.05 = $12,600
            expect(nextYear.amount).toBe(12600);
        });
    });

    describe('InvestedAccount', () => {
        it('should initialize with correct defaults', () => {
            const acc = new InvestedAccount('i1', 'Brokerage', 10000, 0, 5, 0.1, 'Brokerage', true, 0.2);
            expect(acc.expenseRatio).toBe(0.1);
            expect(acc.taxType).toBe('Brokerage');
            expect(acc.isContributionEligible).toBe(true);
            expect(acc.vestedPerYear).toBe(0.2);
        });

        it('should grow based on RoR, subtracting expense ratio', () => {
            const assumptions = { ...mockAssumptions, macro: { ...mockAssumptions.macro, inflationAdjusted: false }};
            // 10% RoR, 0.5% Expense Ratio
            const acc = new InvestedAccount('i1', 'Brokerage', 10000, 0, 5, 0.5, 'Brokerage', true, 0.2);
            const nextYear = acc.increment(assumptions, 1000);

            // BOY timing: (10000 + 1000) * 1.095 = 11000 * 1.095 = 12045
            expect(nextYear.amount).toBeCloseTo((10000 + 1000) * 1.095);
        });

        it('should include inflation in growth if inflationAdjusted is true', () => {
            const assumptions = { ...mockAssumptions, macro: { ...mockAssumptions.macro, inflationAdjusted: true }};
             // 10% RoR, 3% Inflation, 0.5% Expense Ratio
            const acc = new InvestedAccount('i1', 'Brokerage', 10000, 0, 5, 0.5, 'Brokerage', true, 0.2);
            const nextYear = acc.increment(assumptions, 0);

            // Expected: 10000 * (1 + (10 + 3 - 0.5)/100) = 10000 * 1.125 = 11250
            expect(nextYear.amount).toBeCloseTo(11250);
        });

        it('should decrease the non-vested amount over time as tenure increases', () => {
            const assumptions = { ...mockAssumptions };

            // SETUP:
            // Total: 20k
            // Employer Portion: 10k
            // Tenure: 0 years (0% vested initially)
            // Vesting Schedule: 25% per year
            const acc = new InvestedAccount(
                'i1',
                '401k',
                20000,
                10000, // employerBalance
                0,     // tenureYears
                0.1,
                'Traditional 401k',
                true,
                0.25   // vestedPerYear
            );

            // --- YEAR 1 ---
            // User contributes 0, Employer contributes 5,000
            const year1 = acc.increment(assumptions, 0, 5000);

            // BOY timing math:
            // Growth Rate = 1.099
            // Pre-growth: User = 10000, Employer = 10000 + 5000 = 15000
            // Grown Employer = 15000 * 1.099 = 16485
            // Grown Total = 25000 * 1.099 = 27475
            // New Tenure = 1, Vested % = 25%
            // Non-Vested = 16485 * 0.75 = 12363.75

            expect(year1.employerBalance).toBeCloseTo(16485, 0);
            expect(year1.nonVestedAmount).toBeCloseTo(12363.75, 0);

            // --- YEAR 2 ---
            // Another 5k employer match
            const year2 = year1.increment(assumptions, 0, 5000);

            // BOY timing math:
            // Pre-growth: Employer = 16485 + 5000 = 21485
            // Grown Employer = 21485 * 1.099 = 23612.015
            // New Tenure = 2, Vested % = 50%
            // Non-Vested = 23612.015 * 0.50 = 11806

            // The non-vested portion should decrease as vesting increases
            expect(year2.nonVestedAmount).toBeLessThan(year1.nonVestedAmount);
            expect(year2.nonVestedAmount).toBeCloseTo(11806, 0);
        });

        it('should drain employer balance if user withdrawal exceeds user balance', () => {
            const assumptions = { ...mockAssumptions };
            // 1. Setup
            const acc = new InvestedAccount(
                'i1', '401k',
                10000, // Total
                5000,  // Employer Portion
                2,     // Tenure (will become 3, so 75% vested: 3 * 0.25 = 0.75)
                0.1, 'Traditional 401k', true, 0.25
            );

            // 2. Act: Withdraw $6,000 (More than user has, but less than vested limit)
            const next = acc.increment(assumptions, -6000, 0);

            // 3. Assert - BOY timing:
            // Growth Rate: 1.099
            // NewTenure = 3, vestedPct = 0.75
            // Pre-growth: User = 5000, Employer = 5000
            // Withdrawal = 6000:
            //   - User equity: 5000 (all used)
            //   - Shortfall: 1000
            //   - Vested employer: 5000 * 0.75 = 3750
            //   - Taken from employer: min(1000, 3750) = 1000
            // PreGrowthEmployer = 5000 - 1000 = 4000
            // PreGrowthUser = 0
            // GrownTotal = 4000 * 1.099 = 4396
            // GrownEmployer = 4000 * 1.099 = 4396

            expect(next.amount).toBeCloseTo(4396);
            expect(next.employerBalance).toBeCloseTo(4396);
        });

        it('should limit withdrawal to vested amount when exceeding vesting', () => {
            const assumptions = { ...mockAssumptions };
            // 1. Setup - 0% vested (just started)
            const acc = new InvestedAccount(
                'i1', '401k',
                10000, // Total
                5000,  // Employer Portion
                0,     // Tenure (will become 1, so 25% vested: 1 * 0.25 = 0.25)
                0.1, 'Traditional 401k', true, 0.25
            );

            // 2. Act: Try to withdraw $8,000 (exceeds user equity + vested funds)
            const next = acc.increment(assumptions, -8000, 0);

            // 3. Assert - BOY timing:
            // Growth Rate: 1.099
            // NewTenure = 1, vestedPct = 0.25
            // Pre-growth: User = 5000, Employer = 5000
            // Withdrawal = 8000:
            //   - User equity: 5000 (all used)
            //   - Shortfall: 3000
            //   - Vested employer: 5000 * 0.25 = 1250
            //   - Allowed from employer: min(3000, 1250) = 1250
            // PreGrowthEmployer = 5000 - 1250 = 3750
            // PreGrowthUser = 0
            // GrownTotal = 3750 * 1.099 = 4121.25
            // GrownEmployer = 3750 * 1.099 = 4121.25

            expect(next.amount).toBeCloseTo(4121.25);
            expect(next.employerBalance).toBeCloseTo(4121.25);

            // User equity should be 0 (wiped out their portion)
            const userEquity = next.amount - next.employerBalance;
            expect(userEquity).toBeCloseTo(0);
        });

        it('should use customROR when set on the account', () => {
            // Create account with customROR of 5% (ignores global 10%)
            const acc = new InvestedAccount(
                'i1', 'Custom ROR',
                10000,
                0, // employerBalance
                0, // tenureYears
                0.5, // expenseRatio
                'Brokerage',
                true,
                0.2,
                10000, // costBasis
                5 // customROR = 5%
            );

            const nextYear = acc.increment(mockAssumptions, 0, 0);

            // With inflationAdjusted=false: 5% customROR - 0.5% expense = 4.5% net
            // 10000 * 1.045 = 10450
            expect(nextYear.amount).toBeCloseTo(10450);
        });

        it('should use customROR with inflation when inflationAdjusted is true', () => {
            const inflationAssumptions = {
                ...mockAssumptions,
                macro: { ...mockAssumptions.macro, inflationAdjusted: true }
            };

            // Create account with customROR of 5%
            const acc = new InvestedAccount(
                'i1', 'Custom ROR',
                10000,
                0, 0, 0.5, 'Brokerage', true, 0.2, 10000,
                5 // customROR = 5%
            );

            const nextYear = acc.increment(inflationAssumptions, 0, 0);

            // With inflationAdjusted=true: 5% customROR + 3% inflation - 0.5% expense = 7.5% net
            // 10000 * 1.075 = 10750
            expect(nextYear.amount).toBeCloseTo(10750);
        });

        it('should prioritize overrideReturnRate over customROR', () => {
            // Account has customROR of 5%, but we override with 15%
            const acc = new InvestedAccount(
                'i1', 'Override Test',
                10000,
                0, 0, 0.5, 'Brokerage', true, 0.2, 10000,
                5 // customROR = 5%
            );

            // Override return rate takes priority
            const nextYear = acc.increment(mockAssumptions, 0, 0, 15);

            // 15% override - 0.5% expense = 14.5% net
            // 10000 * 1.145 = 11450
            expect(nextYear.amount).toBeCloseTo(11450);
        });

        it('should cap employer balance at total when employer exceeds total (edge case)', () => {
            // This tests the safety check at line 174
            // Create an extreme scenario where we might get employer > total
            // We need a scenario where negative growth could cause this
            const negativeReturnAssumptions = {
                ...mockAssumptions,
                investments: {
                    ...mockAssumptions.investments,
                    returnRates: { ror: -50 } // -50% return (extreme market crash)
                }
            };

            // Account with significant employer balance
            const acc = new InvestedAccount(
                'i1', 'Crash Test',
                10000,
                9000, // 90% employer balance
                5, // fully vested
                0,
                'Traditional 401k',
                true,
                0.2
            );

            // User withdraws almost everything, then negative return
            const next = acc.increment(negativeReturnAssumptions, -9500, 0);

            // After withdrawal and negative return, employer balance should not exceed total
            expect(next.employerBalance).toBeLessThanOrEqual(next.amount);
            expect(next.employerBalance).toBeGreaterThanOrEqual(0);
        });

        // User-specified hand-verified test scenarios
        it('should grow $100,000 + $6,000 user + $3,000 employer at 7% to $116,630', () => {
            const assumptions7Pct = {
                ...mockAssumptions,
                investments: {
                    ...mockAssumptions.investments,
                    returnRates: { ror: 7 } // 7%
                }
            };

            // Account with 0 expense ratio for exact calculation
            const acc = new InvestedAccount(
                'i1', '401k',
                100000, // amount
                0,      // employerBalance (starts at 0)
                0,      // tenureYears
                0,      // expenseRatio = 0 for exact match
                'Traditional 401k',
                true,
                0.2     // vestedPerYear
            );

            const nextYear = acc.increment(assumptions7Pct, 6000, 3000);

            // BOY timing: ($100,000 + $6,000 + $3,000) × 1.07 = $109,000 × 1.07 = $116,630
            expect(nextYear.amount).toBeCloseTo(116630);
        });

        it('should use overrideReturnRate for Monte Carlo: ($100,000 + $9,000) × 1.10 = $119,900', () => {
            // Account with 0 expense ratio
            const acc = new InvestedAccount(
                'i1', '401k',
                100000, // amount
                0, 0, 0, // employerBalance, tenureYears, expenseRatio
                'Traditional 401k', true, 0.2
            );

            // overrideReturnRate = 10% takes priority over global assumptions
            const nextYear = acc.increment(mockAssumptions, 6000, 3000, 10);

            // BOY timing: ($100,000 + $9,000) × 1.10 = $119,900
            expect(nextYear.amount).toBeCloseTo(119900);
        });

        it('should track conversionAmount in conversionHistory', () => {
            const acc = new InvestedAccount(
                'i1', 'Roth IRA',
                50000, 0, 0, 0, 'Roth IRA', true, 0.2, 50000
            );

            // Add a $50,000 Roth conversion in year 2025
            const nextYear = acc.increment(mockAssumptions, 0, 0, undefined, 50000, 2025);

            // Conversion should be tracked in history
            expect(nextYear.conversionHistory).toHaveLength(1);
            expect(nextYear.conversionHistory[0].amount).toBe(50000);
            expect(nextYear.conversionHistory[0].year).toBe(2025);
        });

        it('should create lots for brokerage accounts with currentYear', () => {
            const acc = new InvestedAccount(
                'i1', 'Taxable Brokerage',
                100000, // amount
                0, 0, 0,
                'Brokerage', // taxType - triggers lot tracking
                true, 0.2,
                100000 // costBasis
            );

            // Contribute $10,000 in year 2025
            const nextYear = acc.increment(mockAssumptions, 10000, 0, undefined, 0, 2025);

            // Should have lots: seed lot + new contribution lot
            expect(nextYear.lots.length).toBeGreaterThanOrEqual(1);
            // Find the new contribution lot
            const newLot = nextYear.lots.find(l => l.purchaseYear === 2025);
            expect(newLot).toBeDefined();
            expect(newLot?.costBasis).toBe(10000);
        });

        // Getter tests
        describe('unrealizedGains getter', () => {
            it('should return $50,000 for amount=$150,000, costBasis=$100,000', () => {
                const acc = new InvestedAccount(
                    'i1', 'Brokerage', 150000, 0, 0, 0, 'Brokerage', true, 0.2, 100000
                );
                expect(acc.unrealizedGains).toBe(50000);
            });

            it('should return $0 for amount=$80,000, costBasis=$100,000 (no negative gains)', () => {
                const acc = new InvestedAccount(
                    'i1', 'Brokerage', 80000, 0, 0, 0, 'Brokerage', true, 0.2, 100000
                );
                // max(0, 80000 - 100000) = max(0, -20000) = 0
                expect(acc.unrealizedGains).toBe(0);
            });

            it('should return $0 for amount=$100,000, costBasis=$100,000 (breakeven)', () => {
                const acc = new InvestedAccount(
                    'i1', 'Brokerage', 100000, 0, 0, 0, 'Brokerage', true, 0.2, 100000
                );
                expect(acc.unrealizedGains).toBe(0);
            });
        });

        describe('totalConversionBasis getter', () => {
            it('should return $25,000 for two conversions totaling $25,000', () => {
                const acc = new InvestedAccount(
                    'i1', 'Roth IRA', 50000, 0, 0, 0, 'Roth IRA', true, 0.2, 50000, undefined,
                    [{ year: 2020, amount: 10000 }, { year: 2021, amount: 15000 }]
                );
                expect(acc.totalConversionBasis).toBe(25000);
            });

            it('should return $0 for empty conversionHistory', () => {
                const acc = new InvestedAccount(
                    'i1', 'Roth IRA', 50000, 0, 0, 0, 'Roth IRA', true, 0.2, 50000, undefined, []
                );
                expect(acc.totalConversionBasis).toBe(0);
            });
        });

        describe('regularContributions getter', () => {
            it('should return $25,000 for costBasis=$50,000, totalConversionBasis=$25,000', () => {
                const acc = new InvestedAccount(
                    'i1', 'Roth IRA', 75000, 0, 0, 0, 'Roth IRA', true, 0.2, 50000, undefined,
                    [{ year: 2020, amount: 10000 }, { year: 2021, amount: 15000 }]
                );
                // regularContributions = costBasis - totalConversionBasis = 50000 - 25000 = 25000
                expect(acc.regularContributions).toBe(25000);
            });

            it('should return $0 for costBasis=$25,000, totalConversionBasis=$25,000', () => {
                const acc = new InvestedAccount(
                    'i1', 'Roth IRA', 50000, 0, 0, 0, 'Roth IRA', true, 0.2, 25000, undefined,
                    [{ year: 2020, amount: 25000 }]
                );
                // regularContributions = 25000 - 25000 = 0
                expect(acc.regularContributions).toBe(0);
            });
        });

        describe('calculateWithdrawalAllocation (proportional method)', () => {
            it('should split $10,000 withdrawal from $100k balance, $60k basis: basis=$6k, gains=$4k', () => {
                const acc = new InvestedAccount(
                    'i1', 'Brokerage', 100000, 0, 0, 0, 'Brokerage', true, 0.2, 60000
                );
                const allocation = acc.calculateWithdrawalAllocation(10000);

                // gains portion = 40000/100000 = 40%
                // basis portion = 60000/100000 = 60%
                expect(allocation.gains).toBe(4000);  // 10000 × 0.40
                expect(allocation.basis).toBe(6000);  // 10000 × 0.60
            });

            it('should return all basis when no gains: $50k balance, $50k basis, withdraw $10k', () => {
                const acc = new InvestedAccount(
                    'i1', 'Brokerage', 50000, 0, 0, 0, 'Brokerage', true, 0.2, 50000
                );
                const allocation = acc.calculateWithdrawalAllocation(10000);

                // 0% gains, 100% basis
                expect(allocation.gains).toBe(0);
                expect(allocation.basis).toBe(10000);
            });

            it('should return all gains when no basis: $100k balance, $0 basis, withdraw $25k', () => {
                const acc = new InvestedAccount(
                    'i1', 'Brokerage', 100000, 0, 0, 0, 'Brokerage', true, 0.2, 0
                );
                const allocation = acc.calculateWithdrawalAllocation(25000);

                // 100% gains, 0% basis
                expect(allocation.gains).toBe(25000);
                expect(allocation.basis).toBe(0);
            });
        });

        describe('calculateLotAwareWithdrawal (FIFO lot selection)', () => {
            it('should use FIFO and classify gains by holding period (3 lots, withdraw $20k)', () => {
                // Setup: 3 lots with different purchase years
                const lots: BrokerageLot[] = [
                    { purchaseYear: 2020, costBasis: 10000, currentValue: 15000 }, // Long-term (6 years)
                    { purchaseYear: 2023, costBasis: 20000, currentValue: 25000 }, // Long-term (3 years)
                    { purchaseYear: 2025, costBasis: 15000, currentValue: 18000 }, // Short-term (1 year)
                ];
                const totalValue = 15000 + 25000 + 18000; // 58000
                const totalBasis = 10000 + 20000 + 15000; // 45000

                const acc = new InvestedAccount(
                    'i1', 'Brokerage', totalValue, 0, 0, 0, 'Brokerage', true, 0.2, totalBasis, undefined, [], lots
                );

                // Withdraw $20,000 in year 2026
                const result = acc.calculateLotAwareWithdrawal(20000, 2026);

                // FIFO: Sells Lot 1 first ($15,000), then $5,000 from Lot 2
                // Lot 1: All 15000 sold, gain = 15000 - 10000 = 5000 (long-term: 2026-2020=6 >= 2)
                // Lot 2: 5000 sold (20% of 25000), gain = 5000 - (20000 × 0.20) = 5000 - 4000 = 1000 (long-term: 2026-2023=3 >= 2)
                expect(result.longTermGains).toBeCloseTo(5000 + 1000, 0); // 6000
                expect(result.shortTermGains).toBe(0); // No short-term lots touched
                expect(result.basisReturn).toBeCloseTo(10000 + 4000, 0); // 14000
            });

            it('should classify all gains as short-term when all lots are recent', () => {
                // All lots purchased in 2025
                const lots: BrokerageLot[] = [
                    { purchaseYear: 2025, costBasis: 10000, currentValue: 15000 }, // gain = 5000
                    { purchaseYear: 2025, costBasis: 20000, currentValue: 25000 }, // gain = 5000
                    { purchaseYear: 2025, costBasis: 15000, currentValue: 18000 }, // gain = 3000
                ];
                const totalValue = 58000;
                const totalBasis = 45000;

                const acc = new InvestedAccount(
                    'i1', 'Brokerage', totalValue, 0, 0, 0, 'Brokerage', true, 0.2, totalBasis, undefined, [], lots
                );

                // Withdraw 30000 in year 2025 (same year as purchase)
                const result = acc.calculateLotAwareWithdrawal(30000, 2025);

                // 2025-2025=0 < 2, so all short-term
                // FIFO order: Lot 1 fully (15000, gain 5000) + Lot 2 partial (15000/25000 = 60%, gain 3000)
                // Total short-term gains = 5000 + 3000 = 8000
                expect(result.longTermGains).toBe(0);
                expect(result.shortTermGains).toBeCloseTo(8000, 0);
            });

            it('should handle withdrawing entire account and match unrealized gains', () => {
                const lots: BrokerageLot[] = [
                    { purchaseYear: 2020, costBasis: 20000, currentValue: 30000 }, // Long-term
                    { purchaseYear: 2025, costBasis: 20000, currentValue: 28000 }, // Short-term
                ];
                const totalValue = 30000 + 28000; // 58000
                const totalBasis = 20000 + 20000; // 40000
                const totalGains = totalValue - totalBasis; // 18000

                const acc = new InvestedAccount(
                    'i1', 'Brokerage', totalValue, 0, 0, 0, 'Brokerage', true, 0.2, totalBasis, undefined, [], lots
                );

                // Withdraw entire account
                const result = acc.calculateLotAwareWithdrawal(totalValue, 2026);

                // Total gains should match unrealized gains
                expect(result.longTermGains + result.shortTermGains).toBeCloseTo(totalGains, 0);
                expect(result.basisReturn).toBeCloseTo(totalBasis, 0);

                // Lot 1 (2020): 30000 - 20000 = 10000 long-term
                // Lot 2 (2025): 28000 - 20000 = 8000 short-term (2026-2025=1 < 2)
                expect(result.longTermGains).toBeCloseTo(10000, 0);
                expect(result.shortTermGains).toBeCloseTo(8000, 0);
            });

            it('should fallback to proportional method when no lots exist', () => {
                // Account without lots (e.g., legacy data)
                const acc = new InvestedAccount(
                    'i1', 'Brokerage', 100000, 0, 0, 0, 'Brokerage', true, 0.2, 60000
                    // No lots array provided
                );

                const result = acc.calculateLotAwareWithdrawal(20000, 2025);

                // Should fallback to proportional: all gains treated as long-term
                expect(result.longTermGains).toBeCloseTo(8000, 0); // 20000 × (40000/100000)
                expect(result.shortTermGains).toBe(0);
                expect(result.basisReturn).toBeCloseTo(12000, 0); // 20000 × (60000/100000)
            });
        });
    });

    describe('PropertyAccount', () => {
        it('should appreciate based on housingAppreciation assumption', () => {
            const acc = new PropertyAccount('p1', 'Home', 500000, 'Financed', 400000, 400000, 'm1');
            const nextYear = acc.increment(mockAssumptions);
            // Expected: 500000 * (1 + 5/100) = 525000
            expect(nextYear.amount).toBe(525000);
        });

        it('should use overrides for value and loan balance when provided', () => {
            const acc = new PropertyAccount('p1', 'Home', 500000, 'Financed', 400000, 400000, 'm1');
            const nextYear = acc.increment(mockAssumptions, { newValue: 510000, newLoanBalance: 395000 });
            expect(nextYear.amount).toBe(510000);
            expect(nextYear.loanAmount).toBe(395000);
        });

        it('should appreciate $400,000 at 3% to $412,000', () => {
            const assumptions3Pct = {
                ...mockAssumptions,
                expenses: {
                    ...mockAssumptions.expenses,
                    housingAppreciation: 3, // 3%
                }
            };
            const acc = new PropertyAccount('p1', 'Home', 400000, 'Financed', 300000, 300000, 'm1');
            const nextYear = acc.increment(assumptions3Pct);
            // $400,000 × 1.03 = $412,000
            expect(nextYear.amount).toBe(412000);
        });

        it('should use newValue override to set property value to $450,000', () => {
            const acc = new PropertyAccount('p1', 'Home', 400000, 'Financed', 300000, 300000, 'm1');
            const nextYear = acc.increment(mockAssumptions, { newValue: 450000 });
            // Override sets exact value regardless of appreciation rate
            expect(nextYear.amount).toBe(450000);
        });
    });

    describe('DebtAccount', () => {
        it('should increase balance based on APR if no override is given', () => {
            const acc = new DebtAccount('d1', 'Student Loan', 20000, 'l1', 5); // 5% APR
            const nextYear = acc.increment(mockAssumptions);
            // Expected: 20000 * 1.05 = 21000
            expect(nextYear.amount).toBe(21000);
        });

        it('should use overrideBalance when provided', () => {
            const acc = new DebtAccount('d1', 'Student Loan', 20000, 'l1', 5);
            // Simulate a payment reducing the balance
            const nextYear = acc.increment(mockAssumptions, 18000);
            expect(nextYear.amount).toBe(18000);
        });

        it('should grow $5,000 at 20% APR to $6,000', () => {
            const acc = new DebtAccount('d1', 'Credit Card', 5000, 'l1', 20); // 20% APR
            const nextYear = acc.increment(mockAssumptions);
            // $5,000 × 1.20 = $6,000
            expect(nextYear.amount).toBe(6000);
        });

        it('should use override to set balance to $3,000', () => {
            const acc = new DebtAccount('d1', 'Credit Card', 5000, 'l1', 20);
            const nextYear = acc.increment(mockAssumptions, 3000);
            // Override sets exact balance regardless of APR
            expect(nextYear.amount).toBe(3000);
        });
    });

    describe('DeficitDebtAccount', () => {
        it('should create with 0% APR and no linked account', () => {
            const acc = new DeficitDebtAccount('def-1', 'Budget Deficit', 5000);

            expect(acc.id).toBe('def-1');
            expect(acc.name).toBe('Budget Deficit');
            expect(acc.amount).toBe(5000);
            expect(acc.apr).toBe(0);
            expect(acc.linkedAccountId).toBe('');
        });

        it('should not grow with APR on increment (0% interest)', () => {
            const acc = new DeficitDebtAccount('def-1', 'Deficit', 5000);
            const nextYear = acc.increment(mockAssumptions);

            // DeficitDebtAccount has 0% APR, so amount stays same
            expect(nextYear.amount).toBe(5000);
        });

        it('should use overrideBalance when provided', () => {
            const acc = new DeficitDebtAccount('def-1', 'Deficit', 5000);
            const nextYear = acc.increment(mockAssumptions, 3000);

            expect(nextYear.amount).toBe(3000);
        });

        it('should return DeficitDebtAccount instance on increment', () => {
            const acc = new DeficitDebtAccount('def-1', 'Deficit', 5000);
            const nextYear = acc.increment(mockAssumptions);

            expect(nextYear).toBeInstanceOf(DeficitDebtAccount);
        });
    });

    describe('ESPPAccount', () => {
        const createTestLot = (overrides: Partial<ESPPLot> = {}): ESPPLot => ({
            id: 'lot-1',
            grantDate: new Date('2024-01-01'),
            purchaseDate: new Date('2024-06-30'),
            fmvAtGrant: 100,
            fmvAtPurchase: 110,
            purchasePrice: 85, // 15% discount from grant price
            shares: 100,
            totalCost: 8500,
            discountAmount: 15,
            ...overrides
        });

        it('should initialize with correct defaults', () => {
            const acc = new ESPPAccount('espp-1', 'Company ESPP', 10000);
            expect(acc.lots).toEqual([]);
            expect(acc.linkedIncomeId).toBeNull();
            expect(acc.customROR).toBeUndefined();
        });

        it('should calculate total cost basis from lots', () => {
            const lot1 = createTestLot({ id: 'lot-1', totalCost: 1000 });
            const lot2 = createTestLot({ id: 'lot-2', totalCost: 2000 });
            const acc = new ESPPAccount('espp-1', 'Company ESPP', 5000, [lot1, lot2]);

            expect(acc.totalCostBasis).toBe(3000);
        });

        it('should calculate unrealized gains', () => {
            const lot = createTestLot({ totalCost: 8500 });
            const acc = new ESPPAccount('espp-1', 'Company ESPP', 12000, [lot]);

            // Current value - cost basis = 12000 - 8500 = 3500
            expect(acc.unrealizedGains).toBe(3500);
        });

        it('should return 0 for unrealized gains when at a loss', () => {
            const lot = createTestLot({ totalCost: 8500 });
            const acc = new ESPPAccount('espp-1', 'Company ESPP', 5000, [lot]);

            // unrealizedGains should be 0 (not negative) due to Math.max
            expect(acc.unrealizedGains).toBe(0);
        });

        it('should identify qualifying disposition after holding period', () => {
            const acc = new ESPPAccount('espp-1', 'Company ESPP', 10000);
            const lot = createTestLot({
                grantDate: new Date('2020-01-01'),
                purchaseDate: new Date('2020-06-30')
            });

            // 2 years from grant (Jan 2022) AND 1 year from purchase (Jun 2021)
            // Sale date in 2023 should be qualifying
            const saleDate = new Date('2023-01-15');
            expect(acc.calculateDispositionType(lot, saleDate)).toBe('qualifying');
        });

        it('should identify disqualifying disposition before holding period', () => {
            const acc = new ESPPAccount('espp-1', 'Company ESPP', 10000);
            const lot = createTestLot({
                grantDate: new Date('2024-01-01'),
                purchaseDate: new Date('2024-06-30')
            });

            // Selling in 2024 - not 2 years from grant
            const saleDate = new Date('2024-12-15');
            expect(acc.calculateDispositionType(lot, saleDate)).toBe('disqualifying');
        });

        it('should count qualifying vs disqualifying lots', () => {
            const oldLot = createTestLot({
                id: 'old-lot',
                grantDate: new Date('2020-01-01'),
                purchaseDate: new Date('2020-06-30')
            });
            const newLot = createTestLot({
                id: 'new-lot',
                grantDate: new Date('2024-01-01'),
                purchaseDate: new Date('2024-06-30')
            });
            const acc = new ESPPAccount('espp-1', 'Company ESPP', 20000, [oldLot, newLot]);

            const counts = acc.getLotCounts(new Date('2024-12-01'));
            expect(counts.qualifying).toBe(1);
            expect(counts.disqualifying).toBe(1);
        });

        it('should add a lot and update amount', () => {
            const acc = new ESPPAccount('espp-1', 'Company ESPP', 10000);
            const newLot = createTestLot({ shares: 50, fmvAtPurchase: 100 });

            const updatedAcc = acc.addLot(newLot);

            expect(updatedAcc.lots.length).toBe(1);
            // Amount should increase by FMV of new shares: 50 * 100 = 5000
            expect(updatedAcc.amount).toBe(15000);
        });

        it('should grow based on assumptions', () => {
            const acc = new ESPPAccount('espp-1', 'Company ESPP', 10000);
            const nextYear = acc.increment(mockAssumptions);

            // 10% return (no expense ratio for ESPP)
            expect(nextYear.amount).toBeCloseTo(11000);
        });

        it('should use customROR when set', () => {
            const acc = new ESPPAccount('espp-1', 'Company ESPP', 10000, [], null, 5);
            const nextYear = acc.increment(mockAssumptions);

            // 5% customROR (inflationAdjusted is false in mockAssumptions)
            expect(nextYear.amount).toBeCloseTo(10500);
        });

        it('should calculate sale tax for disqualifying disposition', () => {
            const lot = createTestLot({
                purchaseDate: new Date('2024-06-30'),
                fmvAtGrant: 100,
                fmvAtPurchase: 110,
                purchasePrice: 85,
                shares: 100
            });
            const acc = new ESPPAccount('espp-1', 'Company ESPP', 15000, [lot]);

            // Sale at $150 per share, 6 months after purchase (disqualifying)
            const saleDate = new Date('2025-01-15');
            const result = acc.calculateSaleTax(50, 150, saleDate);

            // Disqualifying: ordinary income = (110 - 85) * 50 = 1250
            // Capital gains = (150 - 110) * 50 = 2000 (short-term since < 1 year)
            expect(result.ordinaryIncome).toBe(1250);
            expect(result.shortTermGains).toBe(2000);
            expect(result.longTermGains).toBe(0);
        });

        it('should remove sold shares using FIFO', () => {
            const oldLot = createTestLot({ id: 'old', shares: 50, purchaseDate: new Date('2023-01-01') });
            const newLot = createTestLot({ id: 'new', shares: 50, purchaseDate: new Date('2024-01-01') });
            const acc = new ESPPAccount('espp-1', 'Company ESPP', 15000, [oldLot, newLot]);

            // Sell 60 shares - should use all of oldLot (50) and 10 from newLot
            const updatedAcc = acc.removeSoldShares(60, 100);

            expect(updatedAcc.lots.length).toBe(1); // Only newLot remains (partial)
            expect(updatedAcc.lots[0].shares).toBe(40); // 50 - 10 = 40 remaining
        });

        // New ESPP Features Tests
        describe('Advanced ESPP Features', () => {
            it('should initialize with new properties', () => {
                const acc = new ESPPAccount(
                    'espp-1', 'Company ESPP', 10000, [], null, 7,
                    'AAPL',  // stockTicker
                    150.50,  // currentSharePrice
                    'disqualifying_first',  // withdrawalPreference
                    365      // minimumHoldingDays
                );

                expect(acc.stockTicker).toBe('AAPL');
                expect(acc.currentSharePrice).toBe(150.50);
                expect(acc.withdrawalPreference).toBe('disqualifying_first');
                expect(acc.minimumHoldingDays).toBe(365);
            });

            it('should default new properties appropriately', () => {
                const acc = new ESPPAccount('espp-1', 'Company ESPP', 10000);

                expect(acc.stockTicker).toBeUndefined();
                expect(acc.currentSharePrice).toBeUndefined();
                expect(acc.withdrawalPreference).toBe('fifo');
                expect(acc.minimumHoldingDays).toBe(0);
            });

            it('should preserve new properties through addLot', () => {
                const acc = new ESPPAccount(
                    'espp-1', 'Company ESPP', 10000, [], null, 7,
                    'AAPL', 150.50, 'qualifying_first', 180
                );
                const newLot = createTestLot({ shares: 50, fmvAtPurchase: 100 });

                const updatedAcc = acc.addLot(newLot);

                expect(updatedAcc.stockTicker).toBe('AAPL');
                expect(updatedAcc.currentSharePrice).toBe(150.50);
                expect(updatedAcc.withdrawalPreference).toBe('qualifying_first');
                expect(updatedAcc.minimumHoldingDays).toBe(180);
            });

            it('should preserve new properties through increment', () => {
                const acc = new ESPPAccount(
                    'espp-1', 'Company ESPP', 10000, [], null, undefined,
                    'GOOG', 100, 'dont_sell_until_qualifying', 90
                );

                const nextYear = acc.increment(mockAssumptions);

                expect(nextYear.stockTicker).toBe('GOOG');
                expect(nextYear.currentSharePrice).toBe(100);
                expect(nextYear.withdrawalPreference).toBe('dont_sell_until_qualifying');
                expect(nextYear.minimumHoldingDays).toBe(90);
            });

            it('should preserve new properties through removeSoldShares', () => {
                const lot = createTestLot({ shares: 100 });
                const acc = new ESPPAccount(
                    'espp-1', 'Company ESPP', 15000, [lot], null, undefined,
                    'MSFT', 200, 'disqualifying_first', 365
                );

                const updatedAcc = acc.removeSoldShares(50, 100);

                expect(updatedAcc.stockTicker).toBe('MSFT');
                expect(updatedAcc.currentSharePrice).toBe(200);
                expect(updatedAcc.withdrawalPreference).toBe('disqualifying_first');
                expect(updatedAcc.minimumHoldingDays).toBe(365);
            });
        });

        describe('getEligibleLots', () => {
            it('should return all lots when minimumHoldingDays is 0', () => {
                const lot1 = createTestLot({ id: 'lot-1', purchaseDate: new Date('2024-01-01') });
                const lot2 = createTestLot({ id: 'lot-2', purchaseDate: new Date('2024-12-01') });
                const acc = new ESPPAccount('espp-1', 'Company ESPP', 20000, [lot1, lot2]);

                const eligible = acc.getEligibleLots(new Date('2024-12-15'));
                expect(eligible.length).toBe(2);
            });

            it('should filter lots based on minimum holding days', () => {
                // Lot 1: purchased 200 days ago
                // Lot 2: purchased 50 days ago
                const baseDate = new Date('2024-06-01');
                const lot1Date = new Date(baseDate);
                lot1Date.setDate(lot1Date.getDate() - 200);
                const lot2Date = new Date(baseDate);
                lot2Date.setDate(lot2Date.getDate() - 50);

                const lot1 = createTestLot({ id: 'lot-1', purchaseDate: lot1Date });
                const lot2 = createTestLot({ id: 'lot-2', purchaseDate: lot2Date });

                const acc = new ESPPAccount(
                    'espp-1', 'Company ESPP', 20000, [lot1, lot2], null, undefined,
                    undefined, undefined, 'fifo', 100 // 100-day minimum hold
                );

                const eligible = acc.getEligibleLots(baseDate);
                expect(eligible.length).toBe(1);
                expect(eligible[0].id).toBe('lot-1');
            });

            it('should return empty array when no lots meet holding period', () => {
                const recentDate = new Date();
                recentDate.setDate(recentDate.getDate() - 30);

                const lot = createTestLot({ purchaseDate: recentDate });
                const acc = new ESPPAccount(
                    'espp-1', 'Company ESPP', 10000, [lot], null, undefined,
                    undefined, undefined, 'fifo', 365 // 365-day minimum hold
                );

                const eligible = acc.getEligibleLots(new Date());
                expect(eligible.length).toBe(0);
            });
        });

        describe('getEligibleShares', () => {
            it('should calculate total eligible shares', () => {
                const baseDate = new Date('2024-06-01');
                const oldDate = new Date(baseDate);
                oldDate.setDate(oldDate.getDate() - 200);
                const newDate = new Date(baseDate);
                newDate.setDate(newDate.getDate() - 50);

                const lot1 = createTestLot({ id: 'lot-1', purchaseDate: oldDate, shares: 100 });
                const lot2 = createTestLot({ id: 'lot-2', purchaseDate: newDate, shares: 50 });

                const acc = new ESPPAccount(
                    'espp-1', 'Company ESPP', 20000, [lot1, lot2], null, undefined,
                    undefined, undefined, 'fifo', 100
                );

                const eligibleShares = acc.getEligibleShares(baseDate);
                expect(eligibleShares).toBe(100); // Only lot1's shares
            });
        });

        describe('hasQualifyingLots', () => {
            it('should return true when qualifying lots exist', () => {
                const oldLot = createTestLot({
                    id: 'old-lot',
                    grantDate: new Date('2020-01-01'),
                    purchaseDate: new Date('2020-06-30')
                });
                const acc = new ESPPAccount('espp-1', 'Company ESPP', 10000, [oldLot]);

                expect(acc.hasQualifyingLots(new Date('2024-12-01'))).toBe(true);
            });

            it('should return false when no qualifying lots exist', () => {
                const newLot = createTestLot({
                    id: 'new-lot',
                    grantDate: new Date('2024-01-01'),
                    purchaseDate: new Date('2024-06-30')
                });
                const acc = new ESPPAccount('espp-1', 'Company ESPP', 10000, [newLot]);

                expect(acc.hasQualifyingLots(new Date('2024-12-01'))).toBe(false);
            });
        });

        describe('calculateSaleTax with lotOrder', () => {
            it('should sell disqualifying lots first when preference is disqualifying_first', () => {
                // Old qualifying lot
                const qualifyingLot = createTestLot({
                    id: 'qualifying',
                    grantDate: new Date('2020-01-01'),
                    purchaseDate: new Date('2020-06-30'),
                    shares: 50,
                    fmvAtGrant: 100,
                    fmvAtPurchase: 110,
                    purchasePrice: 85
                });
                // New disqualifying lot
                const disqualifyingLot = createTestLot({
                    id: 'disqualifying',
                    grantDate: new Date('2024-01-01'),
                    purchaseDate: new Date('2024-06-30'),
                    shares: 50,
                    fmvAtGrant: 100,
                    fmvAtPurchase: 110,
                    purchasePrice: 85
                });

                const acc = new ESPPAccount('espp-1', 'Company ESPP', 15000, [qualifyingLot, disqualifyingLot]);
                const saleDate = new Date('2024-12-01');

                // Sell 50 shares with disqualifying_first preference
                const result = acc.calculateSaleTax(50, 150, saleDate, 'disqualifying_first');

                // Should use the disqualifying lot (all 50 shares from it)
                expect(result.lotsUsed.length).toBe(1);
                expect(result.lotsUsed[0].id).toBe('disqualifying');
            });

            it('should sell qualifying lots first when preference is qualifying_first', () => {
                // Old qualifying lot
                const qualifyingLot = createTestLot({
                    id: 'qualifying',
                    grantDate: new Date('2020-01-01'),
                    purchaseDate: new Date('2020-06-30'),
                    shares: 50
                });
                // New disqualifying lot
                const disqualifyingLot = createTestLot({
                    id: 'disqualifying',
                    grantDate: new Date('2024-01-01'),
                    purchaseDate: new Date('2024-06-30'),
                    shares: 50
                });

                const acc = new ESPPAccount('espp-1', 'Company ESPP', 15000, [disqualifyingLot, qualifyingLot]);
                const saleDate = new Date('2024-12-01');

                // Sell 50 shares with qualifying_first preference
                const result = acc.calculateSaleTax(50, 150, saleDate, 'qualifying_first');

                // Should use the qualifying lot first
                expect(result.lotsUsed.length).toBe(1);
                expect(result.lotsUsed[0].id).toBe('qualifying');
            });

            it('should respect eligible lots filter', () => {
                const baseDate = new Date('2024-06-01');
                const oldDate = new Date(baseDate);
                oldDate.setDate(oldDate.getDate() - 200);
                const newDate = new Date(baseDate);
                newDate.setDate(newDate.getDate() - 50);

                const eligibleLot = createTestLot({ id: 'eligible', purchaseDate: oldDate, shares: 100 });
                const ineligibleLot = createTestLot({ id: 'ineligible', purchaseDate: newDate, shares: 100 });

                const acc = new ESPPAccount(
                    'espp-1', 'Company ESPP', 30000, [eligibleLot, ineligibleLot], null, undefined,
                    undefined, undefined, 'fifo', 100
                );

                const eligibleLots = acc.getEligibleLots(baseDate);
                const result = acc.calculateSaleTax(50, 150, baseDate, 'fifo', eligibleLots);

                // Should only use the eligible lot
                expect(result.lotsUsed.length).toBe(1);
                expect(result.lotsUsed[0].id).toBe('eligible');
            });
        });

        describe('updateLot', () => {
            it('should update a specific lot', () => {
                const lot = createTestLot({ id: 'lot-1', shares: 100 });
                const acc = new ESPPAccount('espp-1', 'Company ESPP', 15000, [lot]);

                const updatedAcc = acc.updateLot('lot-1', { shares: 150 });

                expect(updatedAcc.lots[0].shares).toBe(150);
            });

            it('should preserve other lots when updating one', () => {
                const lot1 = createTestLot({ id: 'lot-1', shares: 100 });
                const lot2 = createTestLot({ id: 'lot-2', shares: 50 });
                const acc = new ESPPAccount('espp-1', 'Company ESPP', 20000, [lot1, lot2]);

                const updatedAcc = acc.updateLot('lot-1', { shares: 75 });

                expect(updatedAcc.lots.length).toBe(2);
                expect(updatedAcc.lots.find(l => l.id === 'lot-2')?.shares).toBe(50);
            });
        });

        describe('deleteLot', () => {
            it('should remove a lot by ID', () => {
                const lot1 = createTestLot({ id: 'lot-1', shares: 100 });
                const lot2 = createTestLot({ id: 'lot-2', shares: 50 });
                const acc = new ESPPAccount('espp-1', 'Company ESPP', 20000, [lot1, lot2]);

                const updatedAcc = acc.deleteLot('lot-1');

                expect(updatedAcc.lots.length).toBe(1);
                expect(updatedAcc.lots[0].id).toBe('lot-2');
            });

            it('should reduce amount when deleting a lot', () => {
                const lot = createTestLot({ id: 'lot-1', shares: 100, fmvAtPurchase: 100 });
                const acc = new ESPPAccount('espp-1', 'Company ESPP', 15000, [lot]);

                const updatedAcc = acc.deleteLot('lot-1');

                // Should reduce by lot value: 100 shares * $100 FMV = $10,000
                expect(updatedAcc.amount).toBe(5000);
            });
        });

        // User-specified hand-verified test scenarios for ESPP
        describe('calculateDispositionType edge cases', () => {
            it('should return disqualifying when < 2 years from grant', () => {
                const acc = new ESPPAccount('espp-1', 'Company ESPP', 10000);
                const lot = createTestLot({
                    grantDate: new Date('2023-01-15'),
                    purchaseDate: new Date('2023-07-15')
                });

                // 2024-06-01: Only ~1.4 years from grant (needs 2 years)
                const saleDate = new Date('2024-06-01');
                expect(acc.calculateDispositionType(lot, saleDate)).toBe('disqualifying');
            });

            it('should return qualifying when 2+ years from grant AND 1+ year from purchase', () => {
                const acc = new ESPPAccount('espp-1', 'Company ESPP', 10000);
                const lot = createTestLot({
                    grantDate: new Date('2023-01-15'),
                    purchaseDate: new Date('2023-07-15')
                });

                // 2025-02-01: 2+ years from grant (Jan 2023), 1.5+ years from purchase (Jul 2023)
                const saleDate = new Date('2025-02-01');
                expect(acc.calculateDispositionType(lot, saleDate)).toBe('qualifying');
            });

            it('should return qualifying at exactly 2 years from grant + 1 year from purchase', () => {
                const acc = new ESPPAccount('espp-1', 'Company ESPP', 10000);
                const lot = createTestLot({
                    grantDate: new Date('2022-01-15'),
                    purchaseDate: new Date('2022-07-15')
                });

                // Exactly 2 years from grant: 2024-01-15
                // Exactly 1 year from purchase: 2023-07-15
                // Sale at 2024-07-15: 2.5 years from grant, 2 years from purchase (both conditions met)
                const saleDate = new Date('2024-07-15');
                expect(acc.calculateDispositionType(lot, saleDate)).toBe('qualifying');
            });

            it('should return disqualifying when 2+ years from grant but < 1 year from purchase', () => {
                const acc = new ESPPAccount('espp-1', 'Company ESPP', 10000);
                // Grant date is 2 years ago, but purchase just happened 6 months ago
                const lot = createTestLot({
                    grantDate: new Date('2022-01-01'),
                    purchaseDate: new Date('2024-01-01')  // Long offering period
                });

                // 2024-06-01: 2.4 years from grant BUT only 5 months from purchase
                const saleDate = new Date('2024-06-01');
                expect(acc.calculateDispositionType(lot, saleDate)).toBe('disqualifying');
            });
        });

        describe('calculateSaleTax with hand-verified values', () => {
            it('should calculate disqualifying disposition: ordinary=$2000, STCG=$2000', () => {
                // Disqualifying: bargain element is ordinary income
                const lot: ESPPLot = {
                    id: 'lot-1',
                    grantDate: new Date('2024-01-01'),
                    purchaseDate: new Date('2024-06-30'),
                    fmvAtGrant: 100,
                    fmvAtPurchase: 100,  // FMV at purchase = $100
                    purchasePrice: 80,    // Purchase price = $80 (20% discount)
                    shares: 100,
                    totalCost: 8000,
                    discountAmount: 20
                };
                const acc = new ESPPAccount('espp-1', 'Company ESPP', 12000, [lot]);

                // Sale at $120/share, 3 months after purchase (disqualifying, short-term)
                const saleDate = new Date('2024-10-01');
                const result = acc.calculateSaleTax(100, 120, saleDate);

                // Disqualifying:
                // Ordinary income = (FMV at purchase - purchase price) × shares = ($100 - $80) × 100 = $2,000
                // Capital gains = (sale price - FMV at purchase) × shares = ($120 - $100) × 100 = $2,000 (short-term)
                expect(result.ordinaryIncome).toBe(2000);
                expect(result.shortTermGains).toBe(2000);
                expect(result.longTermGains).toBe(0);
            });

            it('should calculate qualifying disposition: ordinary=$1500, LTCG=$2500', () => {
                // Qualifying: ordinary income = lesser of grant discount or actual gain
                const lot: ESPPLot = {
                    id: 'lot-1',
                    grantDate: new Date('2020-01-01'),
                    purchaseDate: new Date('2020-06-30'),
                    fmvAtGrant: 100,      // FMV at grant = $100
                    fmvAtPurchase: 100,   // FMV at purchase = $100
                    purchasePrice: 80,     // Purchase price = $80 (from 15% discount on grant or purchase)
                    shares: 100,
                    totalCost: 8000,
                    discountAmount: 20
                };
                const acc = new ESPPAccount('espp-1', 'Company ESPP', 12000, [lot]);

                // Sale at $120/share, 3+ years after (qualifying, long-term)
                const saleDate = new Date('2023-07-01');
                const result = acc.calculateSaleTax(100, 120, saleDate);

                // Qualifying:
                // Grant discount = 15% of FMV at grant = $100 × 0.15 = $15/share
                // Actual gain = $120 - $80 = $40/share
                // Ordinary income = min($15, $40) × 100 = $1,500
                // LTCG = ($40 - $15) × 100 = $2,500
                expect(result.ordinaryIncome).toBe(1500);
                expect(result.longTermGains).toBe(2500);
                expect(result.shortTermGains).toBe(0);
            });

            it('should compare lotOrder effects with mixed qualifying/disqualifying lots', () => {
                const qualifyingLot: ESPPLot = {
                    id: 'qualifying',
                    grantDate: new Date('2020-01-01'),
                    purchaseDate: new Date('2020-06-30'),
                    fmvAtGrant: 100,
                    fmvAtPurchase: 100,
                    purchasePrice: 85,
                    shares: 50,
                    totalCost: 4250,
                    discountAmount: 15
                };
                const disqualifyingLot: ESPPLot = {
                    id: 'disqualifying',
                    grantDate: new Date('2024-01-01'),
                    purchaseDate: new Date('2024-06-30'),
                    fmvAtGrant: 100,
                    fmvAtPurchase: 100,
                    purchasePrice: 85,
                    shares: 50,
                    totalCost: 4250,
                    discountAmount: 15
                };

                const acc = new ESPPAccount('espp-1', 'Company ESPP', 15000, [qualifyingLot, disqualifyingLot]);
                const saleDate = new Date('2024-12-01');

                // Sell with disqualifying_first - should use disqualifying lot
                const resultDQ = acc.calculateSaleTax(50, 120, saleDate, 'disqualifying_first');
                expect(resultDQ.lotsUsed[0].id).toBe('disqualifying');
                // Disqualifying: ordinary = (100-85) × 50 = $750
                expect(resultDQ.ordinaryIncome).toBe(750);

                // Sell with qualifying_first - should use qualifying lot
                const resultQ = acc.calculateSaleTax(50, 120, saleDate, 'qualifying_first');
                expect(resultQ.lotsUsed[0].id).toBe('qualifying');
                // Qualifying: ordinary = min(15%, gain) × 50
                // Grant discount = 100 × 0.15 = $15/share
                // Actual gain = 120 - 85 = $35/share
                // Ordinary = min(15, 35) × 50 = $750
                expect(resultQ.ordinaryIncome).toBe(750);
                // LTCG = (35 - 15) × 50 = $1000
                expect(resultQ.longTermGains).toBe(1000);
            });
        });

        describe('increment preserves lot costBasis', () => {
            it('should grow $50,000 at 8% to $54,000', () => {
                const assumptions8Pct = {
                    ...mockAssumptions,
                    investments: {
                        ...mockAssumptions.investments,
                        returnRates: { ror: 8 }
                    }
                };

                const acc = new ESPPAccount('espp-1', 'Company ESPP', 50000);
                const nextYear = acc.increment(assumptions8Pct);

                // $50,000 × 1.08 = $54,000
                expect(nextYear.amount).toBe(54000);
            });

            it('should preserve lot costBasis after increment', () => {
                const lot: ESPPLot = {
                    id: 'lot-1',
                    grantDate: new Date('2024-01-01'),
                    purchaseDate: new Date('2024-06-30'),
                    fmvAtGrant: 100,
                    fmvAtPurchase: 110,
                    purchasePrice: 85,
                    shares: 100,
                    totalCost: 8500,  // This is the costBasis
                    discountAmount: 15
                };
                const acc = new ESPPAccount('espp-1', 'Company ESPP', 11000, [lot]);

                const nextYear = acc.increment(mockAssumptions);

                // Amount should grow (10% in mockAssumptions)
                expect(nextYear.amount).toBeCloseTo(12100);

                // But lot's totalCost (costBasis) should remain unchanged
                expect(nextYear.lots[0].totalCost).toBe(8500);
                expect(nextYear.lots[0].purchasePrice).toBe(85);
                expect(nextYear.lots[0].shares).toBe(100);
            });
        });
    });

    describe('reconstituteAccount', () => {
        it('should create a SavedAccount instance', () => {
            const data = { className: 'SavedAccount', id: 's1', name: 'Savings', amount: 100, apr: 1 };
            const account = reconstituteAccount(data);
            expect(account).toBeInstanceOf(SavedAccount);
            if (account) {
                expect(account.id).toBe('s1');
                expect((account as SavedAccount).apr).toBe(1);
            }
        });

        it('should create an InvestedAccount instance with defaults', () => {
            const data = { className: 'InvestedAccount', id: 'i1', name: 'Roth', amount: 5000 };
            const account = reconstituteAccount(data);
            expect(account).toBeInstanceOf(InvestedAccount);
            if (account) {
                expect(account.amount).toBe(5000);
                expect((account as InvestedAccount).expenseRatio).toBe(0.1); // default
            }
        });
        
        it('should create a PropertyAccount instance', () => {
            const data = { className: 'PropertyAccount', id: 'p1', name: 'House', amount: 200000 };
            const account = reconstituteAccount(data);
            expect(account).toBeInstanceOf(PropertyAccount);
            if (account) {
                expect(account.id).toBe('p1');
            }
        });

        it('should create a DebtAccount instance', () => {
            const data = { className: 'DebtAccount', id: 'd1', name: 'Car Loan', amount: 15000 };
            const account = reconstituteAccount(data);
            expect(account).toBeInstanceOf(DebtAccount);
            if (account) {
                expect(account.id).toBe('d1');
            }
        });

        it('should create a DeficitDebtAccount instance', () => {
            const data = { className: 'DeficitDebtAccount', id: 'def-1', name: 'Budget Deficit', amount: 5000 };
            const account = reconstituteAccount(data);
            expect(account).toBeInstanceOf(DeficitDebtAccount);
            if (account) {
                expect(account.id).toBe('def-1');
                expect(account.name).toBe('Budget Deficit');
                expect(account.amount).toBe(5000);
                expect((account as DeficitDebtAccount).apr).toBe(0);
            }
        });

        it('should create an ESPPAccount instance with lots', () => {
            const data = {
                className: 'ESPPAccount',
                id: 'espp-1',
                name: 'Company ESPP',
                amount: 15000,
                lots: [
                    {
                        id: 'lot-1',
                        grantDate: '2024-01-01T00:00:00.000Z',
                        purchaseDate: '2024-06-30T00:00:00.000Z',
                        fmvAtGrant: 100,
                        fmvAtPurchase: 110,
                        purchasePrice: 85,
                        shares: 100,
                        totalCost: 8500,
                        discountAmount: 15
                    }
                ],
                linkedIncomeId: 'income-1',
                customROR: 8
            };
            const account = reconstituteAccount(data);
            expect(account).toBeInstanceOf(ESPPAccount);
            if (account) {
                const espp = account as ESPPAccount;
                expect(espp.id).toBe('espp-1');
                expect(espp.lots.length).toBe(1);
                expect(espp.lots[0].shares).toBe(100);
                expect(espp.lots[0].grantDate).toBeInstanceOf(Date);
                expect(espp.linkedIncomeId).toBe('income-1');
                expect(espp.customROR).toBe(8);
            }
        });

        it('should create an ESPPAccount instance with new properties', () => {
            const data = {
                className: 'ESPPAccount',
                id: 'espp-2',
                name: 'Advanced ESPP',
                amount: 25000,
                lots: [],
                linkedIncomeId: null,
                customROR: 6,
                stockTicker: 'NVDA',
                currentSharePrice: 450.75,
                withdrawalPreference: 'disqualifying_first',
                minimumHoldingDays: 180
            };
            const account = reconstituteAccount(data);
            expect(account).toBeInstanceOf(ESPPAccount);
            if (account) {
                const espp = account as ESPPAccount;
                expect(espp.stockTicker).toBe('NVDA');
                expect(espp.currentSharePrice).toBe(450.75);
                expect(espp.withdrawalPreference).toBe('disqualifying_first');
                expect(espp.minimumHoldingDays).toBe(180);
            }
        });

        it('should use default values for missing new ESPP properties', () => {
            const data = {
                className: 'ESPPAccount',
                id: 'espp-3',
                name: 'Legacy ESPP',
                amount: 10000,
                lots: []
                // No new properties provided
            };
            const account = reconstituteAccount(data);
            expect(account).toBeInstanceOf(ESPPAccount);
            if (account) {
                const espp = account as ESPPAccount;
                expect(espp.stockTicker).toBeUndefined();
                expect(espp.currentSharePrice).toBeUndefined();
                expect(espp.withdrawalPreference).toBe('fifo');
                expect(espp.minimumHoldingDays).toBe(0);
            }
        });

        it('should return null for unknown className', () => {
            const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
            const data = { className: 'ImaginaryAccount', id: 'x1', amount: 100 };
            const account = reconstituteAccount(data);
            expect(account).toBeNull();
            consoleSpy.mockRestore();
        });

        it('should return null for invalid data', () => {
            const account = reconstituteAccount(null);
            expect(account).toBeNull();
        });
    });
});
