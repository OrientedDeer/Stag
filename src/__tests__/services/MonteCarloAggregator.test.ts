/**
 * Tests for MonteCarloAggregator functions
 *
 * Tests the aggregation and statistical analysis functions
 * used to summarize Monte Carlo simulation results.
 */

import { describe, it, expect } from 'vitest';
import {
    getPercentileValue,
    calculatePercentiles,
    analyzeScenario,
    summarizeScenarios,
} from '../../services/MonteCarloAggregator';
import { ScenarioResult } from '../../services/MonteCarloTypes';
import { SimulationYear } from '../../components/Objects/Assumptions/SimulationEngine';
import { InvestedAccount, DeficitDebtAccount } from '../../components/Objects/Accounts/models';

// =============================================================================
// Test Helpers
// =============================================================================

function createMockSimulationYear(year: number, netWorth: number, hasDeficitDebt: boolean = false): SimulationYear {
    const accounts: (InvestedAccount | DeficitDebtAccount)[] = [
        new InvestedAccount('acc1', 'Investment', netWorth, 0, 0, 0.1, 'Brokerage')
    ];

    if (hasDeficitDebt) {
        accounts.push(new DeficitDebtAccount('deficit1', 'Deficit Debt', 10000));
    }

    return {
        year,
        incomes: [],
        expenses: [],
        accounts,
        cashflow: {
            totalIncome: 50000,
            totalExpense: 40000,
            livingExpenses: 30000,
            discretionary: 10000,
            investedUser: 5000,
            investedMatch: 0,
            totalInvested: 5000,
            bucketAllocations: 0,
            bucketDetail: {},
            withdrawals: 0,
            withdrawalDetail: {}
        },
        taxDetails: {
            fed: 5000,
            state: 2000,
            fica: 3000,
            preTax: 0,
            insurance: 0,
            postTax: 0,
            capitalGains: 0,
            withdrawalOrdinaryTax: 0,
            niit: 0
        },
        logs: []
    };
}

function createMockScenario(
    scenarioId: number,
    finalNetWorth: number,
    success: boolean = true,
    yearCount: number = 3,
    yearOfDepletion: number | null = null
): ScenarioResult {
    const timeline: SimulationYear[] = [];
    const baseYear = 2024;

    for (let i = 0; i < yearCount; i++) {
        const yearNetWorth = finalNetWorth * (0.7 + (0.3 * i / (yearCount - 1 || 1)));
        const hasDeficitDebt = yearOfDepletion !== null && (baseYear + i) >= yearOfDepletion;
        timeline.push(createMockSimulationYear(baseYear + i, yearNetWorth, hasDeficitDebt));
    }

    return {
        scenarioId,
        timeline,
        success,
        finalNetWorth,
        yearOfDepletion,
        yearlyReturns: Array(yearCount).fill(7)
    };
}

// =============================================================================
// getPercentileValue tests
// =============================================================================

describe('getPercentileValue', () => {
    it('should return 0 for empty array', () => {
        expect(getPercentileValue([], 50)).toBe(0);
    });

    it('should return single value for any percentile', () => {
        expect(getPercentileValue([100], 0)).toBe(100);
        expect(getPercentileValue([100], 50)).toBe(100);
        expect(getPercentileValue([100], 100)).toBe(100);
    });

    describe('sorted array [0, 25, 50, 75, 100]', () => {
        const sorted = [0, 25, 50, 75, 100];

        it('should return 0 for percentile 0', () => {
            expect(getPercentileValue(sorted, 0)).toBe(0);
        });

        it('should return 50 for percentile 50', () => {
            expect(getPercentileValue(sorted, 50)).toBe(50);
        });

        it('should return 100 for percentile 100', () => {
            expect(getPercentileValue(sorted, 100)).toBe(100);
        });
    });

    describe('linear interpolation', () => {
        it('should interpolate [0, 100] at percentile 25 to 25', () => {
            expect(getPercentileValue([0, 100], 25)).toBe(25);
        });

        it('should interpolate [0, 100] at percentile 75 to 75', () => {
            expect(getPercentileValue([0, 100], 75)).toBe(75);
        });

        it('should return 20 for [10, 20, 30] at percentile 50', () => {
            expect(getPercentileValue([10, 20, 30], 50)).toBe(20);
        });

        it('should interpolate between values', () => {
            // [0, 100] at 50% should be 50
            expect(getPercentileValue([0, 100], 50)).toBe(50);
        });
    });
});

// =============================================================================
// calculatePercentiles tests
// =============================================================================

describe('calculatePercentiles', () => {
    it('should return all empty arrays for empty scenarios', () => {
        const result = calculatePercentiles([]);
        expect(result.p10).toEqual([]);
        expect(result.p25).toEqual([]);
        expect(result.p50).toEqual([]);
        expect(result.p75).toEqual([]);
        expect(result.p90).toEqual([]);
    });

    it('should return single scenario values for all percentiles', () => {
        const scenario = createMockScenario(1, 100000, true, 3);
        const result = calculatePercentiles([scenario]);

        // All percentiles should equal the single scenario's values
        expect(result.p10.length).toBe(3);
        expect(result.p50.length).toBe(3);
        expect(result.p90.length).toBe(3);

        // All should have same net worth since only one scenario
        expect(result.p10[0].netWorth).toBe(result.p90[0].netWorth);
    });

    it('should calculate correct percentiles for multiple scenarios', () => {
        const scenarios = [
            createMockScenario(1, 100000, true, 3),
            createMockScenario(2, 200000, true, 3),
            createMockScenario(3, 300000, true, 3),
            createMockScenario(4, 400000, true, 3),
            createMockScenario(5, 500000, true, 3)
        ];
        const result = calculatePercentiles(scenarios);

        // All percentiles should have 3 years
        expect(result.p10.length).toBe(3);
        expect(result.p50.length).toBe(3);

        // p10 should be lower than p90
        expect(result.p10[2].netWorth).toBeLessThan(result.p90[2].netWorth);
    });

    it('should have correct structure with year and netWorth', () => {
        const scenario = createMockScenario(1, 100000, true, 2);
        const result = calculatePercentiles([scenario]);

        expect(result.p50[0]).toHaveProperty('year');
        expect(result.p50[0]).toHaveProperty('netWorth');
        expect(result.p50[0].year).toBe(2024);
    });
});

// =============================================================================
// analyzeScenario tests
// =============================================================================

describe('analyzeScenario', () => {
    it('should return success=true and yearOfDepletion=null when no deficit debt', () => {
        const timeline = [
            createMockSimulationYear(2024, 100000, false),
            createMockSimulationYear(2025, 110000, false),
            createMockSimulationYear(2026, 120000, false)
        ];

        const result = analyzeScenario(1, timeline, [7, 8, 9]);

        expect(result.success).toBe(true);
        expect(result.yearOfDepletion).toBeNull();
    });

    it('should return success=false and correct yearOfDepletion when deficit debt exists', () => {
        const timeline = [
            createMockSimulationYear(2024, 100000, false),
            createMockSimulationYear(2025, 50000, true),  // Deficit debt appears
            createMockSimulationYear(2026, 0, true)
        ];

        const result = analyzeScenario(1, timeline, [7, -20, -30]);

        expect(result.success).toBe(false);
        expect(result.yearOfDepletion).toBe(2025);
    });

    it('should calculate correct finalNetWorth', () => {
        const timeline = [
            createMockSimulationYear(2024, 100000),
            createMockSimulationYear(2025, 150000),
            createMockSimulationYear(2026, 200000)
        ];

        const result = analyzeScenario(1, timeline, [7, 8, 9]);

        expect(result.finalNetWorth).toBe(200000);
    });

    it('should return all expected fields', () => {
        const timeline = [createMockSimulationYear(2024, 100000)];
        const yearlyReturns = [7];

        const result = analyzeScenario(42, timeline, yearlyReturns);

        expect(result).toHaveProperty('scenarioId', 42);
        expect(result).toHaveProperty('timeline');
        expect(result).toHaveProperty('yearlyReturns');
        expect(result).toHaveProperty('success');
        expect(result).toHaveProperty('finalNetWorth');
        expect(result).toHaveProperty('yearOfDepletion');
        expect(result.timeline).toBe(timeline);
        expect(result.yearlyReturns).toBe(yearlyReturns);
    });
});

// =============================================================================
// summarizeScenarios tests
// =============================================================================

describe('summarizeScenarios', () => {
    it('should throw Error for empty array', () => {
        expect(() => summarizeScenarios([], 12345)).toThrow('No scenarios to summarize');
    });

    it('should return correct successRate', () => {
        const scenarios = [
            createMockScenario(1, 100000, true),
            createMockScenario(2, 200000, true),
            createMockScenario(3, -10000, false),
            createMockScenario(4, 150000, true)
        ];

        const result = summarizeScenarios(scenarios, 12345);
        expect(result.successRate).toBe(75);
    });

    it('should return correct percentiles structure', () => {
        const scenarios = [
            createMockScenario(1, 100000, true, 3),
            createMockScenario(2, 200000, true, 3)
        ];

        const result = summarizeScenarios(scenarios, 12345);

        expect(result.percentiles).toHaveProperty('p10');
        expect(result.percentiles).toHaveProperty('p25');
        expect(result.percentiles).toHaveProperty('p50');
        expect(result.percentiles).toHaveProperty('p75');
        expect(result.percentiles).toHaveProperty('p90');
    });

    it('should have worstCase with lowest finalNetWorth', () => {
        const scenarios = [
            createMockScenario(1, 300000),
            createMockScenario(2, 100000),
            createMockScenario(3, 200000)
        ];

        const result = summarizeScenarios(scenarios, 12345);
        expect(result.worstCase.finalNetWorth).toBe(100000);
    });

    it('should have bestCase with highest finalNetWorth', () => {
        const scenarios = [
            createMockScenario(1, 300000),
            createMockScenario(2, 100000),
            createMockScenario(3, 200000)
        ];

        const result = summarizeScenarios(scenarios, 12345);
        expect(result.bestCase.finalNetWorth).toBe(300000);
    });

    it('should have medianCase as middle scenario', () => {
        const scenarios = [
            createMockScenario(1, 100000),
            createMockScenario(2, 200000),
            createMockScenario(3, 300000)
        ];

        const result = summarizeScenarios(scenarios, 12345);
        expect(result.medianCase.finalNetWorth).toBe(200000);
    });

    it('should calculate averageFinalNetWorth (trimmed mean excludes top/bottom 5%)', () => {
        // With 20 scenarios, 5% trim = 1 from each end
        const scenarios: ScenarioResult[] = [];
        for (let i = 1; i <= 20; i++) {
            scenarios.push(createMockScenario(i, i * 10000));
        }

        const result = summarizeScenarios(scenarios, 12345);

        // Trimmed: excludes 10000 (lowest) and 200000 (highest)
        // Remaining: 20000, 30000, ..., 190000 (18 values)
        // Sum = 20000 + 30000 + ... + 190000 = sum of 2-19 * 10000 = (2+19)*18/2 * 10000 = 1890000
        // Average = 1890000 / 18 = 105000
        expect(result.averageFinalNetWorth).toBeCloseTo(105000, 0);
    });

    it('should return seed in result', () => {
        const scenarios = [createMockScenario(1, 100000)];
        const result = summarizeScenarios(scenarios, 99999);
        expect(result.seed).toBe(99999);
    });

    it('should return totalScenarios count', () => {
        const scenarios = [
            createMockScenario(1, 100000),
            createMockScenario(2, 200000),
            createMockScenario(3, 300000)
        ];

        const result = summarizeScenarios(scenarios, 12345);
        expect(result.totalScenarios).toBe(3);
    });

    it('should return successfulScenarios count', () => {
        const scenarios = [
            createMockScenario(1, 100000, true),
            createMockScenario(2, 200000, true),
            createMockScenario(3, -10000, false)
        ];

        const result = summarizeScenarios(scenarios, 12345);
        expect(result.successfulScenarios).toBe(2);
    });
});

