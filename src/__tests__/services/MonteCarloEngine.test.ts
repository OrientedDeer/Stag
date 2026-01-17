import { describe, it, expect } from 'vitest';
import { SeededRandom, calculateMean, calculateStdDev } from '../../services/RandomGenerator';
import {
    calculateSuccessRate,
    getPercentileValue,
    calculatePercentiles,
    analyzeScenario,
    summarizeScenarios,
    calculateFinalNetWorthStats,
} from '../../services/MonteCarloAggregator';
import { ScenarioResult } from '../../services/MonteCarloTypes';
import { SimulationYear } from '../../components/Objects/Assumptions/SimulationEngine';
import { SavedAccount, InvestedAccount, DeficitDebtAccount } from '../../components/Objects/Accounts/models';

// --- SeededRandom Tests ---
describe('SeededRandom', () => {
    it('should produce deterministic results with same seed', () => {
        const rng1 = new SeededRandom(12345);
        const rng2 = new SeededRandom(12345);

        const values1 = [rng1.next(), rng1.next(), rng1.next()];
        const values2 = [rng2.next(), rng2.next(), rng2.next()];

        expect(values1).toEqual(values2);
    });

    it('should produce different results with different seeds', () => {
        const rng1 = new SeededRandom(12345);
        const rng2 = new SeededRandom(54321);

        expect(rng1.next()).not.toEqual(rng2.next());
    });

    it('should generate values in [0, 1) range', () => {
        const rng = new SeededRandom(42);
        for (let i = 0; i < 1000; i++) {
            const value = rng.next();
            expect(value).toBeGreaterThanOrEqual(0);
            expect(value).toBeLessThan(1);
        }
    });

    it('should generate normal distribution with correct mean and stdDev', () => {
        const rng = new SeededRandom(12345);
        const samples: number[] = [];
        const targetMean = 7;
        const targetStdDev = 15;

        for (let i = 0; i < 10000; i++) {
            samples.push(rng.normal(targetMean, targetStdDev));
        }

        const actualMean = calculateMean(samples);
        const actualStdDev = calculateStdDev(samples);

        // Allow 5% tolerance for statistical variance
        expect(actualMean).toBeCloseTo(targetMean, 0);
        expect(actualStdDev).toBeCloseTo(targetStdDev, 0);
    });

    it('should generate returns array with correct length', () => {
        const rng = new SeededRandom(42);
        const returns = rng.generateReturns(30, 7, 15);

        expect(returns.length).toBe(30);
    });

    it('should reset to original seed', () => {
        const rng = new SeededRandom(12345);
        const first = rng.next();
        rng.next();
        rng.next();

        rng.reset(12345);
        expect(rng.next()).toBe(first);
    });

    it('should get and restore state', () => {
        const rng = new SeededRandom(12345);
        rng.next();
        rng.next();

        const savedState = rng.getState();
        const nextValue = rng.next();

        // Create new generator and restore state
        const rng2 = new SeededRandom(99999); // Different seed
        rng2.reset(savedState); // Restore to saved state

        expect(rng2.next()).toBe(nextValue);
    });

    describe('lognormal distribution', () => {
        it('should generate positive values only', () => {
            const rng = new SeededRandom(42);

            for (let i = 0; i < 1000; i++) {
                const value = rng.lognormal(1.07, 0.15);
                expect(value).toBeGreaterThan(0);
            }
        });

        it('should approximate target mean for lognormal', () => {
            const rng = new SeededRandom(12345);
            const samples: number[] = [];
            const targetMean = 1.07; // 7% growth factor

            for (let i = 0; i < 10000; i++) {
                samples.push(rng.lognormal(targetMean, 0.15));
            }

            const actualMean = calculateMean(samples);

            // Lognormal mean should be close to target (within 5%)
            expect(actualMean).toBeGreaterThan(targetMean * 0.95);
            expect(actualMean).toBeLessThan(targetMean * 1.05);
        });

        it('should have right-skewed distribution (mean > median)', () => {
            const rng = new SeededRandom(42);
            const samples: number[] = [];

            for (let i = 0; i < 10000; i++) {
                samples.push(rng.lognormal(1.07, 0.20));
            }

            const mean = calculateMean(samples);
            const sorted = [...samples].sort((a, b) => a - b);
            const median = sorted[Math.floor(sorted.length / 2)];

            // Lognormal is right-skewed: mean > median
            expect(mean).toBeGreaterThan(median);
        });
    });

    describe('generateLognormalReturns', () => {
        it('should generate array of correct length', () => {
            const rng = new SeededRandom(42);
            const returns = rng.generateLognormalReturns(30, 7, 15);

            expect(returns.length).toBe(30);
        });

        it('should generate returns as percentages', () => {
            const rng = new SeededRandom(42);
            const returns = rng.generateLognormalReturns(100, 7, 15);

            // Returns should be reasonable percentages (mostly between -50% and +50%)
            const reasonable = returns.filter(r => r > -50 && r < 50);
            expect(reasonable.length).toBeGreaterThan(90); // At least 90% reasonable
        });

        it('should never produce returns below -100%', () => {
            const rng = new SeededRandom(12345);

            // Run many scenarios with high volatility
            for (let i = 0; i < 100; i++) {
                const returns = rng.generateLognormalReturns(50, 5, 25); // High volatility

                for (const r of returns) {
                    expect(r).toBeGreaterThan(-100); // Can't lose more than 100%
                }
            }
        });

        it('should have mean close to target return', () => {
            const rng = new SeededRandom(12345);
            const allReturns: number[] = [];
            const targetReturn = 7;

            // Generate many years to get good statistical sample
            for (let i = 0; i < 100; i++) {
                const returns = rng.generateLognormalReturns(30, targetReturn, 15);
                allReturns.push(...returns);
            }

            const actualMean = calculateMean(allReturns);

            // Mean should be close to target (within 1 percentage point)
            expect(actualMean).toBeGreaterThan(targetReturn - 1);
            expect(actualMean).toBeLessThan(targetReturn + 1);
        });

        it('should produce deterministic results with same seed', () => {
            const rng1 = new SeededRandom(42);
            const rng2 = new SeededRandom(42);

            const returns1 = rng1.generateLognormalReturns(10, 7, 15);
            const returns2 = rng2.generateLognormalReturns(10, 7, 15);

            expect(returns1).toEqual(returns2);
        });
    });
});

// --- MonteCarloAggregator Tests ---
describe('MonteCarloAggregator', () => {
    // Helper to create mock simulation year
    const createMockSimulationYear = (year: number, netWorth: number): SimulationYear => ({
        year,
        incomes: [],
        expenses: [],
        accounts: [new SavedAccount('1', 'Savings', netWorth)],
        cashflow: {
            totalIncome: 0,
            totalExpense: 0,
            discretionary: 0,
            investedUser: 0,
            investedMatch: 0,
            totalInvested: 0,
            bucketAllocations: 0,
            bucketDetail: {},
            withdrawals: 0,
            withdrawalDetail: {},
        },
        taxDetails: {
            fed: 0,
            state: 0,
            fica: 0,
            preTax: 0,
            insurance: 0,
            postTax: 0,
            capitalGains: 0,
        },
        logs: [],
    });

    // Helper to create mock scenario
    const createMockScenario = (
        id: number,
        finalNetWorth: number,
        yearOfDepletion: number | null = null
    ): ScenarioResult => ({
        scenarioId: id,
        timeline: [
            createMockSimulationYear(2025, 100000),
            createMockSimulationYear(2026, finalNetWorth),
        ],
        success: yearOfDepletion === null,
        finalNetWorth,
        yearOfDepletion,
        yearlyReturns: [7, 7],
    });

    describe('calculateSuccessRate', () => {
        it('should return 100% for all successful scenarios', () => {
            const scenarios = [
                createMockScenario(1, 1000000),
                createMockScenario(2, 2000000),
                createMockScenario(3, 500000),
            ];
            expect(calculateSuccessRate(scenarios)).toBe(100);
        });

        it('should return 0% for all failed scenarios', () => {
            const scenarios = [
                createMockScenario(1, -100, 2025),
                createMockScenario(2, -200, 2026),
            ];
            expect(calculateSuccessRate(scenarios)).toBe(0);
        });

        it('should calculate correct percentage for mixed scenarios', () => {
            const scenarios = [
                createMockScenario(1, 1000000),
                createMockScenario(2, -100, 2025),
                createMockScenario(3, 2000000),
                createMockScenario(4, -200, 2026),
            ];
            expect(calculateSuccessRate(scenarios)).toBe(50);
        });

        it('should return 0 for empty array', () => {
            expect(calculateSuccessRate([])).toBe(0);
        });
    });

    describe('getPercentileValue', () => {
        it('should return correct value for 50th percentile', () => {
            const values = [10, 20, 30, 40, 50];
            expect(getPercentileValue(values, 50)).toBe(30);
        });

        it('should return first value for 0th percentile', () => {
            const values = [10, 20, 30, 40, 50];
            expect(getPercentileValue(values, 0)).toBe(10);
        });

        it('should return last value for 100th percentile', () => {
            const values = [10, 20, 30, 40, 50];
            expect(getPercentileValue(values, 100)).toBe(50);
        });

        it('should interpolate between values', () => {
            const values = [0, 100];
            expect(getPercentileValue(values, 50)).toBe(50);
            expect(getPercentileValue(values, 25)).toBe(25);
            expect(getPercentileValue(values, 75)).toBe(75);
        });

        it('should return 0 for empty array', () => {
            expect(getPercentileValue([], 50)).toBe(0);
        });

        it('should return the value for single element array', () => {
            expect(getPercentileValue([42], 50)).toBe(42);
        });
    });

    describe('calculatePercentiles', () => {
        it('should return empty arrays for empty scenarios', () => {
            const result = calculatePercentiles([]);
            expect(result.p10).toEqual([]);
            expect(result.p50).toEqual([]);
            expect(result.p90).toEqual([]);
        });

        it('should calculate percentiles for multiple scenarios', () => {
            const scenarios = [
                createMockScenario(1, 100000),
                createMockScenario(2, 200000),
                createMockScenario(3, 300000),
            ];

            const result = calculatePercentiles(scenarios);

            // Should have data for each year in timeline
            expect(result.p50.length).toBe(2);
            expect(result.p10.length).toBe(2);
            expect(result.p90.length).toBe(2);
        });
    });

    describe('analyzeScenario', () => {
        it('should mark scenario as successful when net worth stays positive', () => {
            const timeline = [
                createMockSimulationYear(2025, 100000),
                createMockSimulationYear(2026, 150000),
            ];

            const result = analyzeScenario(1, timeline, [7, 7]);

            expect(result.success).toBe(true);
            expect(result.yearOfDepletion).toBeNull();
            expect(result.finalNetWorth).toBe(150000);
        });

        it('should mark scenario as failed when deficit debt is created', () => {
            // Create a simulation year with deficit debt (meaning expenses couldn't be covered)
            const createYearWithDeficitDebt = (year: number, deficitAmount: number): SimulationYear => ({
                year,
                incomes: [],
                expenses: [],
                accounts: [
                    new SavedAccount('1', 'Savings', 0),
                    new DeficitDebtAccount('system-deficit-debt', 'Uncovered Deficit', deficitAmount),
                ],
                cashflow: {
                    totalIncome: 0,
                    totalExpense: 0,
                    discretionary: 0,
                    investedUser: 0,
                    investedMatch: 0,
                    totalInvested: 0,
                    bucketAllocations: 0,
                    bucketDetail: {},
                    withdrawals: 0,
                    withdrawalDetail: {},
                },
                taxDetails: {
                    fed: 0, state: 0, fica: 0, preTax: 0, insurance: 0, postTax: 0, capitalGains: 0,
                },
                logs: [],
            });

            const timeline = [
                createMockSimulationYear(2025, 100000),
                createYearWithDeficitDebt(2026, 10000),  // Deficit debt created
                createYearWithDeficitDebt(2027, 50000),  // More deficit accumulated
            ];

            const result = analyzeScenario(1, timeline, [7, -50, -100]);

            expect(result.success).toBe(false);
            expect(result.yearOfDepletion).toBe(2026);  // First year with deficit debt
        });

        it('should NOT mark scenario as failed for regular debt (mortgages/loans)', () => {
            // Having a mortgage that exceeds assets is normal, not a failure
            const timeline = [
                createMockSimulationYear(2025, 100000),
                createMockSimulationYear(2026, -50000),  // Negative net worth from mortgage, not deficit
                createMockSimulationYear(2027, -30000),
            ];

            const result = analyzeScenario(1, timeline, [7, 7, 7]);

            // Should still be successful - no deficit debt was created
            expect(result.success).toBe(true);
            expect(result.yearOfDepletion).toBeNull();
        });
    });

    describe('summarizeScenarios', () => {
        it('should throw error for empty scenarios', () => {
            expect(() => summarizeScenarios([], 12345)).toThrow('No scenarios to summarize');
        });

        it('should correctly summarize multiple scenarios', () => {
            const scenarios = [
                createMockScenario(1, 100000),
                createMockScenario(2, 200000),
                createMockScenario(3, 300000),
                createMockScenario(4, -50000, 2026),
            ];

            const summary = summarizeScenarios(scenarios, 12345);

            expect(summary.totalScenarios).toBe(4);
            expect(summary.successfulScenarios).toBe(3);
            expect(summary.successRate).toBe(75);
            expect(summary.seed).toBe(12345);

            // Worst case should be the failed scenario
            expect(summary.worstCase.finalNetWorth).toBe(-50000);

            // Best case should be the highest net worth
            expect(summary.bestCase.finalNetWorth).toBe(300000);
        });
    });

    describe('calculateFinalNetWorthStats', () => {
        it('should return zeros for empty scenarios', () => {
            const result = calculateFinalNetWorthStats([]);
            expect(result.min).toBe(0);
            expect(result.max).toBe(0);
            expect(result.mean).toBe(0);
            expect(result.median).toBe(0);
            expect(result.stdDev).toBe(0);
        });

        it('should calculate correct statistics', () => {
            const scenarios = [
                createMockScenario(1, 100000),
                createMockScenario(2, 200000),
                createMockScenario(3, 300000),
                createMockScenario(4, 400000),
            ];

            const result = calculateFinalNetWorthStats(scenarios);

            expect(result.min).toBe(100000);
            expect(result.max).toBe(400000);
            expect(result.mean).toBe(250000);
            expect(result.median).toBe(300000);
        });
    });
});

// --- Integration Test for Return Override ---
describe('Return Rate Override Integration', () => {
    it('should apply override return rate to InvestedAccount', () => {
        const account = new InvestedAccount(
            '1',
            'Test 401k',
            100000,
            0,     // employerBalance
            0,     // tenureYears
            0.1,   // expenseRatio
            'Traditional 401k'
        );

        const assumptions = {
            investments: {
                returnRates: { ror: 7 },
                withdrawalStrategy: 'Fixed Real' as const,
                withdrawalRate: 4,
                gkUpperGuardrail: 1.2,
                gkLowerGuardrail: 0.8,
                gkAdjustmentPercent: 10,
                autoRothConversions: false,
            },
            macro: {
                inflationRate: 2.6,
                healthcareInflation: 3.9,
                inflationAdjusted: false, // Important: not inflation adjusted
            },
            demographics: {
                birthYear: 1995, // Age 30 in 2025
                retirementAge: 65,
                lifeExpectancy: 90,
            },
            income: { salaryGrowth: 1.0, qualifiesForSocialSecurity: true, socialSecurityFundingPercent: 100 },
            expenses: { lifestyleCreep: 75, housingAppreciation: 1.4, rentInflation: 1.2 },
            display: { useCompactCurrency: true, showExperimentalFeatures: false, hsaEligible: true },
            priorities: [],
            withdrawalStrategy: [],
        };

        // Without override - uses assumptions.investments.returnRates.ror (7%)
        // minus expense ratio (0.1%) = 6.9% growth
        const normalGrowth = account.increment(assumptions, 0, 0);
        expect(normalGrowth.amount).toBeCloseTo(100000 * 1.069, 0);

        // With override of 10% (minus 0.1% expense ratio = 9.9% growth)
        const overrideGrowth = account.increment(assumptions, 0, 0, 10);
        expect(overrideGrowth.amount).toBeCloseTo(100000 * 1.099, 0);

        // With negative override of -20% (minus 0.1% expense ratio = -20.1% "growth")
        const negativeGrowth = account.increment(assumptions, 0, 0, -20);
        expect(negativeGrowth.amount).toBeCloseTo(100000 * 0.799, 0);
    });
});
