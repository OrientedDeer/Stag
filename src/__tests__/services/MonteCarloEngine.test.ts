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
import { SavedAccount, InvestedAccount } from '../../components/Objects/Accounts/models';

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

        it('should mark scenario as failed when net worth hits zero', () => {
            const timeline = [
                createMockSimulationYear(2025, 100000),
                createMockSimulationYear(2026, 0),
                createMockSimulationYear(2027, -50000),
            ];

            const result = analyzeScenario(1, timeline, [7, -50, -100]);

            expect(result.success).toBe(false);
            expect(result.yearOfDepletion).toBe(2026);
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
            },
            macro: {
                inflationRate: 2.6,
                healthcareInflation: 3.9,
                inflationAdjusted: false, // Important: not inflation adjusted
            },
            demographics: {
                startAge: 30,
                startYear: 2025,
                retirementAge: 65,
                lifeExpectancy: 90,
            },
            income: { salaryGrowth: 1.0, socialSecurityStartAge: 67 },
            expenses: { lifestyleCreep: 75, housingAppreciation: 1.4, rentInflation: 1.2 },
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
