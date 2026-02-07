import { describe, it, expect, vi } from 'vitest';
import { SeededRandom, calculateMean, calculateStdDev } from '../../services/RandomGenerator';
import {
    calculateSuccessRate,
    getPercentileValue,
    calculatePercentiles,
    analyzeScenario,
    summarizeScenarios,
    calculateFinalNetWorthStats,
} from '../../services/MonteCarloAggregator';
import {
    validateConfig,
    estimateRunTime,
    runMonteCarloSimulationSync,
    runMonteCarloSimulation,
} from '../../services/MonteCarloEngine';
import { ScenarioResult, MonteCarloConfig } from '../../services/MonteCarloTypes';
import { SimulationYear } from '../../components/Objects/Assumptions/SimulationEngine';
import { SavedAccount, InvestedAccount, DeficitDebtAccount } from '../../components/Objects/Accounts/models';
import { PassiveIncome } from '../../components/Objects/Income/models';
import { OtherExpense } from '../../components/Objects/Expense/models';
import { defaultAssumptions, createBuiltinMilestones } from '../../components/Objects/Assumptions/AssumptionsContext';
import { TaxState } from '../../components/Objects/Taxes/TaxContext';

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
          livingExpenses: 0,
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
            niit: 0,
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
          livingExpenses: 0,
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
                    fed: 0, state: 0, fica: 0, preTax: 0, insurance: 0, postTax: 0, capitalGains: 0, niit: 0,
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
                rothConversionTargetBracket: 0.22,
                taxOptimizationEnabled: false,
            },
            macro: {
                inflationRate: 2.6,
                healthcareInflation: 3.9,
                inflationAdjusted: false, // Important: not inflation adjusted
            },
            demographics: {},
            milestones: [],  // Milestones not needed for this increment test
            income: { salaryGrowth: 1.0, qualifiesForSocialSecurity: true, socialSecurityFundingPercent: 100 },
            expenses: { lifestyleCreep: 75, housingAppreciation: 1.4, rentInflation: 1.2 },
            display: { useCompactCurrency: true, showExperimentalFeatures: false, hsaEligible: true },
            simulation: { useNewEngine: false },
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

// ============================================================================
// MonteCarloEngine Tests
// ============================================================================

// --- Test Fixtures ---
function createTestConfig(overrides: Partial<MonteCarloConfig> = {}): MonteCarloConfig {
    return {
        enabled: true,
        numScenarios: 10,
        returnMean: 7,
        returnStdDev: 15,
        seed: 12345,
        preset: 'custom',
        ...overrides,
    };
}

function createTestAssumptions(birthYear: number = 1970, retirementAge: number = 65, lifeExpectancy: number = 90) {
    return {
        ...defaultAssumptions,
        milestones: createBuiltinMilestones(birthYear, retirementAge, lifeExpectancy),
        investments: {
            ...defaultAssumptions.investments,
            returnRates: { ror: 7 },
        },
    };
}

function createTestTaxState(): TaxState {
    return {
        filingStatus: 'Single',
        stateResidency: 'Virginia',
        deductionMethod: 'Standard',
        fedOverride: null,
        ficaOverride: null,
        stateOverride: null,
        year: 2025,
    };
}

function createTestAccounts() {
    // Brokerage account with $500,000
    return [
        new InvestedAccount('brokerage1', 'Brokerage', 500000, 0, 0, 0.1, 'Brokerage'),
    ];
}

function createTestIncomes() {
    // Passive income of $30,000/year
    return [
        new PassiveIncome(
            'passive1', 'Dividends', 30000, 'Annually', 'No', 'Dividend',
            new Date('2025-01-01'), new Date('2100-12-31')
        ),
    ];
}

function createTestExpenses() {
    // Basic expense of $40,000/year (creates small deficit to test withdrawals)
    return [
        new OtherExpense(
            'expense1', 'Living Expenses', 40000, 'Annually',
            new Date('2025-01-01'), new Date('2100-12-31')
        ),
    ];
}

// --- validateConfig Tests ---
describe('validateConfig', () => {
    describe('numScenarios validation', () => {
        it('should return error when numScenarios = 0', () => {
            const config = createTestConfig({ numScenarios: 0 });
            const result = validateConfig(config);
            expect(result).not.toBeNull();
            expect(result).toContain('at least 1');
        });

        it('should return error when numScenarios = -1', () => {
            const config = createTestConfig({ numScenarios: -1 });
            const result = validateConfig(config);
            expect(result).not.toBeNull();
            expect(result).toContain('at least 1');
        });

        it('should return error when numScenarios = 10001 (over 10000 limit)', () => {
            const config = createTestConfig({ numScenarios: 10001 });
            const result = validateConfig(config);
            expect(result).not.toBeNull();
            expect(result).toContain('10,000');
        });

        it('should return null when numScenarios = 1 (valid, boundary)', () => {
            const config = createTestConfig({ numScenarios: 1 });
            const result = validateConfig(config);
            expect(result).toBeNull();
        });

        it('should return null when numScenarios = 10000 (valid, boundary)', () => {
            const config = createTestConfig({ numScenarios: 10000 });
            const result = validateConfig(config);
            expect(result).toBeNull();
        });

        it('should return null when numScenarios = 500 (valid, middle)', () => {
            const config = createTestConfig({ numScenarios: 500 });
            const result = validateConfig(config);
            expect(result).toBeNull();
        });
    });

    describe('returnStdDev validation', () => {
        it('should return error when returnStdDev = -1', () => {
            const config = createTestConfig({ returnStdDev: -1 });
            const result = validateConfig(config);
            expect(result).not.toBeNull();
            expect(result).toContain('negative');
        });

        it('should return error when returnStdDev = 101 (over 100 limit)', () => {
            const config = createTestConfig({ returnStdDev: 101 });
            const result = validateConfig(config);
            expect(result).not.toBeNull();
            expect(result).toContain('100');
        });

        it('should return null when returnStdDev = 0 (valid, boundary)', () => {
            const config = createTestConfig({ returnStdDev: 0 });
            const result = validateConfig(config);
            expect(result).toBeNull();
        });

        it('should return null when returnStdDev = 100 (valid, boundary)', () => {
            const config = createTestConfig({ returnStdDev: 100 });
            const result = validateConfig(config);
            expect(result).toBeNull();
        });

        it('should return null when returnStdDev = 15 (valid, typical value)', () => {
            const config = createTestConfig({ returnStdDev: 15 });
            const result = validateConfig(config);
            expect(result).toBeNull();
        });
    });

    describe('combined validation', () => {
        it('should return error when both numScenarios and returnStdDev invalid', () => {
            const config = createTestConfig({ numScenarios: 0, returnStdDev: -1 });
            const result = validateConfig(config);
            expect(result).not.toBeNull();
            // Should return the first error encountered (numScenarios checked first)
        });

        it('should return null for fully valid config', () => {
            const config = createTestConfig({
                numScenarios: 100,
                returnMean: 7,
                returnStdDev: 15,
                seed: 42,
            });
            const result = validateConfig(config);
            expect(result).toBeNull();
        });
    });
});

// --- estimateRunTime Tests ---
describe('estimateRunTime', () => {
    it('should return 15000ms for numScenarios=100, yearsToRun=30', () => {
        const result = estimateRunTime(100, 30);
        expect(result).toBe(100 * 30 * 5); // 15000
    });

    it('should return 5ms for numScenarios=1, yearsToRun=1', () => {
        const result = estimateRunTime(1, 1);
        expect(result).toBe(5);
    });

    it('should return 0ms for numScenarios=0, yearsToRun=30', () => {
        const result = estimateRunTime(0, 30);
        expect(result).toBe(0);
    });

    it('should return 200000ms for numScenarios=1000, yearsToRun=40', () => {
        const result = estimateRunTime(1000, 40);
        expect(result).toBe(1000 * 40 * 5); // 200000
    });
});

// --- runMonteCarloSimulationSync Tests ---
describe('runMonteCarloSimulationSync', () => {
    // Use shorter simulation for faster tests
    const shortAssumptions = createTestAssumptions(2015, 65, 75); // Born 2015, retire 65, die 75 = 10 years of simulation

    describe('structure tests', () => {
        it('should return MonteCarloSummary object', () => {
            const config = createTestConfig({ numScenarios: 5 });
            const result = runMonteCarloSimulationSync(
                config,
                createTestAccounts(),
                createTestIncomes(),
                createTestExpenses(),
                shortAssumptions,
                createTestTaxState()
            );

            expect(result).toBeDefined();
            expect(typeof result).toBe('object');
        });

        it('should have successRate as number between 0 and 100', () => {
            const config = createTestConfig({ numScenarios: 5 });
            const result = runMonteCarloSimulationSync(
                config,
                createTestAccounts(),
                createTestIncomes(),
                createTestExpenses(),
                shortAssumptions,
                createTestTaxState()
            );

            expect(typeof result.successRate).toBe('number');
            expect(result.successRate).toBeGreaterThanOrEqual(0);
            expect(result.successRate).toBeLessThanOrEqual(100);
        });

        it('should have percentiles with p10, p25, p50, p75, p90 keys', () => {
            const config = createTestConfig({ numScenarios: 5 });
            const result = runMonteCarloSimulationSync(
                config,
                createTestAccounts(),
                createTestIncomes(),
                createTestExpenses(),
                shortAssumptions,
                createTestTaxState()
            );

            expect(result.percentiles).toBeDefined();
            expect(result.percentiles).toHaveProperty('p10');
            expect(result.percentiles).toHaveProperty('p25');
            expect(result.percentiles).toHaveProperty('p50');
            expect(result.percentiles).toHaveProperty('p75');
            expect(result.percentiles).toHaveProperty('p90');
        });

        it('should have totalScenarios matching config', () => {
            const config = createTestConfig({ numScenarios: 7 });
            const result = runMonteCarloSimulationSync(
                config,
                createTestAccounts(),
                createTestIncomes(),
                createTestExpenses(),
                shortAssumptions,
                createTestTaxState()
            );

            expect(result.totalScenarios).toBe(7);
        });

        it('should have worstCase, medianCase, bestCase scenarios', () => {
            const config = createTestConfig({ numScenarios: 5 });
            const result = runMonteCarloSimulationSync(
                config,
                createTestAccounts(),
                createTestIncomes(),
                createTestExpenses(),
                shortAssumptions,
                createTestTaxState()
            );

            expect(result.worstCase).toBeDefined();
            expect(result.medianCase).toBeDefined();
            expect(result.bestCase).toBeDefined();
            expect(typeof result.worstCase.finalNetWorth).toBe('number');
            expect(typeof result.medianCase.finalNetWorth).toBe('number');
            expect(typeof result.bestCase.finalNetWorth).toBe('number');
        });

        it('should have worstCase <= medianCase <= bestCase final net worth', () => {
            const config = createTestConfig({ numScenarios: 10 });
            const result = runMonteCarloSimulationSync(
                config,
                createTestAccounts(),
                createTestIncomes(),
                createTestExpenses(),
                shortAssumptions,
                createTestTaxState()
            );

            expect(result.worstCase.finalNetWorth).toBeLessThanOrEqual(result.medianCase.finalNetWorth);
            expect(result.medianCase.finalNetWorth).toBeLessThanOrEqual(result.bestCase.finalNetWorth);
        });

        it('should have averageFinalNetWorth as number', () => {
            const config = createTestConfig({ numScenarios: 5 });
            const result = runMonteCarloSimulationSync(
                config,
                createTestAccounts(),
                createTestIncomes(),
                createTestExpenses(),
                shortAssumptions,
                createTestTaxState()
            );

            expect(typeof result.averageFinalNetWorth).toBe('number');
        });

        it('should have seed matching config', () => {
            const config = createTestConfig({ numScenarios: 5, seed: 99999 });
            const result = runMonteCarloSimulationSync(
                config,
                createTestAccounts(),
                createTestIncomes(),
                createTestExpenses(),
                shortAssumptions,
                createTestTaxState()
            );

            expect(result.seed).toBe(99999);
        });
    });

    describe('behavior tests', () => {
        it('should produce different results with different seeds', () => {
            const config1 = createTestConfig({ numScenarios: 5, seed: 12345 });
            const config2 = createTestConfig({ numScenarios: 5, seed: 54321 });

            const result1 = runMonteCarloSimulationSync(
                config1,
                createTestAccounts(),
                createTestIncomes(),
                createTestExpenses(),
                shortAssumptions,
                createTestTaxState()
            );

            const result2 = runMonteCarloSimulationSync(
                config2,
                createTestAccounts(),
                createTestIncomes(),
                createTestExpenses(),
                shortAssumptions,
                createTestTaxState()
            );

            // Final net worths should differ
            expect(result1.medianCase.finalNetWorth).not.toBe(result2.medianCase.finalNetWorth);
        });

        it('should produce same results with same seed (deterministic)', () => {
            const config = createTestConfig({ numScenarios: 5, seed: 42 });

            const result1 = runMonteCarloSimulationSync(
                config,
                createTestAccounts(),
                createTestIncomes(),
                createTestExpenses(),
                shortAssumptions,
                createTestTaxState()
            );

            const result2 = runMonteCarloSimulationSync(
                config,
                createTestAccounts(),
                createTestIncomes(),
                createTestExpenses(),
                shortAssumptions,
                createTestTaxState()
            );

            expect(result1.medianCase.finalNetWorth).toBe(result2.medianCase.finalNetWorth);
            expect(result1.successRate).toBe(result2.successRate);
            expect(result1.averageFinalNetWorth).toBe(result2.averageFinalNetWorth);
        });

        it('should generally produce higher median finalNetWorth with higher returnMean', () => {
            const lowReturnConfig = createTestConfig({ numScenarios: 20, returnMean: 3, seed: 100 });
            const highReturnConfig = createTestConfig({ numScenarios: 20, returnMean: 12, seed: 100 });

            const lowResult = runMonteCarloSimulationSync(
                lowReturnConfig,
                createTestAccounts(),
                createTestIncomes(),
                createTestExpenses(),
                shortAssumptions,
                createTestTaxState()
            );

            const highResult = runMonteCarloSimulationSync(
                highReturnConfig,
                createTestAccounts(),
                createTestIncomes(),
                createTestExpenses(),
                shortAssumptions,
                createTestTaxState()
            );

            expect(highResult.medianCase.finalNetWorth).toBeGreaterThan(lowResult.medianCase.finalNetWorth);
        });

        it('should produce wider spread in finalNetWorth with higher returnStdDev', () => {
            const lowVolConfig = createTestConfig({ numScenarios: 30, returnStdDev: 5, seed: 200 });
            const highVolConfig = createTestConfig({ numScenarios: 30, returnStdDev: 25, seed: 200 });

            const lowVolResult = runMonteCarloSimulationSync(
                lowVolConfig,
                createTestAccounts(),
                createTestIncomes(),
                createTestExpenses(),
                shortAssumptions,
                createTestTaxState()
            );

            const highVolResult = runMonteCarloSimulationSync(
                highVolConfig,
                createTestAccounts(),
                createTestIncomes(),
                createTestExpenses(),
                shortAssumptions,
                createTestTaxState()
            );

            const lowVolSpread = lowVolResult.bestCase.finalNetWorth - lowVolResult.worstCase.finalNetWorth;
            const highVolSpread = highVolResult.bestCase.finalNetWorth - highVolResult.worstCase.finalNetWorth;

            expect(highVolSpread).toBeGreaterThan(lowVolSpread);
        });

        it('should work with numScenarios=1 (edge case)', () => {
            const config = createTestConfig({ numScenarios: 1 });

            const result = runMonteCarloSimulationSync(
                config,
                createTestAccounts(),
                createTestIncomes(),
                createTestExpenses(),
                shortAssumptions,
                createTestTaxState()
            );

            expect(result.totalScenarios).toBe(1);
            // All cases should be the same with only 1 scenario
            expect(result.worstCase.finalNetWorth).toBe(result.bestCase.finalNetWorth);
        });

        it('should handle zero starting balance gracefully', () => {
            const config = createTestConfig({ numScenarios: 3 });
            const emptyAccounts = [
                new InvestedAccount('brokerage1', 'Brokerage', 0, 0, 0, 0.1, 'Brokerage'),
            ];

            const result = runMonteCarloSimulationSync(
                config,
                emptyAccounts,
                createTestIncomes(),
                createTestExpenses(),
                shortAssumptions,
                createTestTaxState()
            );

            expect(result.totalScenarios).toBe(3);
            // Should complete without errors
        });
    });

    describe('edge cases', () => {
        it('should handle very short simulation (few years)', () => {
            // Born 1960, retire 65, die 70 = person is 66 in 2026, simulation runs ~4 years
            const veryShortAssumptions = createTestAssumptions(1960, 65, 70);
            const config = createTestConfig({ numScenarios: 3 });

            const result = runMonteCarloSimulationSync(
                config,
                createTestAccounts(),
                createTestIncomes(),
                createTestExpenses(),
                veryShortAssumptions,
                createTestTaxState()
            );

            expect(result.totalScenarios).toBe(3);
            // Percentile arrays should be short (person is 66 in 2026, dies at 70 = ~4 years)
            expect(result.percentiles.p50.length).toBeLessThanOrEqual(10);
        });

        it('should handle zero income scenario', () => {
            const config = createTestConfig({ numScenarios: 3 });

            const result = runMonteCarloSimulationSync(
                config,
                createTestAccounts(),
                [], // No income
                createTestExpenses(),
                shortAssumptions,
                createTestTaxState()
            );

            expect(result.totalScenarios).toBe(3);
            // With no income and expenses, net worth should generally decrease
        });

        it('should handle zero expense scenario', () => {
            const config = createTestConfig({ numScenarios: 3 });

            const result = runMonteCarloSimulationSync(
                config,
                createTestAccounts(),
                createTestIncomes(),
                [], // No expenses
                shortAssumptions,
                createTestTaxState()
            );

            expect(result.totalScenarios).toBe(3);
            // With income and no expenses, success rate should be high
            expect(result.successRate).toBeGreaterThanOrEqual(0);
        });
    });

    describe('runSingleScenario behavior (tested via public functions)', () => {
        it('should vary results between scenarios due to random returns', () => {
            const config = createTestConfig({ numScenarios: 10, seed: 999 });

            const result = runMonteCarloSimulationSync(
                config,
                createTestAccounts(),
                createTestIncomes(),
                createTestExpenses(),
                shortAssumptions,
                createTestTaxState()
            );

            // Worst and best should be different with random returns
            expect(result.worstCase.finalNetWorth).not.toBe(result.bestCase.finalNetWorth);
        });

        it('should have different yearly returns for different scenarios', () => {
            const config = createTestConfig({ numScenarios: 5, seed: 888 });

            const result = runMonteCarloSimulationSync(
                config,
                createTestAccounts(),
                createTestIncomes(),
                createTestExpenses(),
                shortAssumptions,
                createTestTaxState()
            );

            // Worst and best cases should have different returns
            const worstReturns = JSON.stringify(result.worstCase.yearlyReturns);
            const bestReturns = JSON.stringify(result.bestCase.yearlyReturns);

            expect(worstReturns).not.toBe(bestReturns);
        });
    });
});

// --- runMonteCarloSimulation (async) Tests ---
describe('runMonteCarloSimulation', () => {
    const shortAssumptions = createTestAssumptions(2015, 65, 75);

    it('should return same structure as sync version', async () => {
        const config = createTestConfig({ numScenarios: 5 });

        const result = await runMonteCarloSimulation(
            config,
            createTestAccounts(),
            createTestIncomes(),
            createTestExpenses(),
            shortAssumptions,
            createTestTaxState()
        );

        expect(result).toBeDefined();
        expect(result.totalScenarios).toBe(5);
        expect(result.percentiles).toHaveProperty('p50');
        expect(result.worstCase).toBeDefined();
        expect(result.medianCase).toBeDefined();
        expect(result.bestCase).toBeDefined();
    });

    it('should call onProgress callback with increasing values', async () => {
        const config = createTestConfig({ numScenarios: 20 });
        const progressValues: number[] = [];

        await runMonteCarloSimulation(
            config,
            createTestAccounts(),
            createTestIncomes(),
            createTestExpenses(),
            shortAssumptions,
            createTestTaxState(),
            (progress) => progressValues.push(progress)
        );

        // Should have called progress at least once
        expect(progressValues.length).toBeGreaterThan(0);

        // Values should be increasing (or equal for same-chunk updates)
        for (let i = 1; i < progressValues.length; i++) {
            expect(progressValues[i]).toBeGreaterThanOrEqual(progressValues[i - 1]);
        }
    });

    it('should call onProgress with values between 0 and 100', async () => {
        const config = createTestConfig({ numScenarios: 15 });
        const progressValues: number[] = [];

        await runMonteCarloSimulation(
            config,
            createTestAccounts(),
            createTestIncomes(),
            createTestExpenses(),
            shortAssumptions,
            createTestTaxState(),
            (progress) => progressValues.push(progress)
        );

        for (const value of progressValues) {
            expect(value).toBeGreaterThanOrEqual(0);
            expect(value).toBeLessThanOrEqual(100);
        }
    });

    it('should call onProgress at least once', async () => {
        const config = createTestConfig({ numScenarios: 5 });
        const progressCallback = vi.fn();

        await runMonteCarloSimulation(
            config,
            createTestAccounts(),
            createTestIncomes(),
            createTestExpenses(),
            shortAssumptions,
            createTestTaxState(),
            progressCallback
        );

        expect(progressCallback).toHaveBeenCalled();
    });

    it('should have final progress at 100', async () => {
        const config = createTestConfig({ numScenarios: 10 });
        const progressValues: number[] = [];

        await runMonteCarloSimulation(
            config,
            createTestAccounts(),
            createTestIncomes(),
            createTestExpenses(),
            shortAssumptions,
            createTestTaxState(),
            (progress) => progressValues.push(progress)
        );

        // Final progress should be 100
        const finalProgress = progressValues[progressValues.length - 1];
        expect(finalProgress).toBe(100);
    });

    it('should work without onProgress callback (optional param)', async () => {
        const config = createTestConfig({ numScenarios: 5 });

        // Should not throw when onProgress is not provided
        const result = await runMonteCarloSimulation(
            config,
            createTestAccounts(),
            createTestIncomes(),
            createTestExpenses(),
            shortAssumptions,
            createTestTaxState()
            // No onProgress callback
        );

        expect(result.totalScenarios).toBe(5);
    });

    it('should resolve successfully with valid config', async () => {
        const config = createTestConfig({ numScenarios: 3 });

        await expect(runMonteCarloSimulation(
            config,
            createTestAccounts(),
            createTestIncomes(),
            createTestExpenses(),
            shortAssumptions,
            createTestTaxState()
        )).resolves.toBeDefined();
    });

    it('should produce same results as sync version with same seed', async () => {
        const config = createTestConfig({ numScenarios: 5, seed: 77777 });

        const asyncResult = await runMonteCarloSimulation(
            config,
            createTestAccounts(),
            createTestIncomes(),
            createTestExpenses(),
            shortAssumptions,
            createTestTaxState()
        );

        const syncResult = runMonteCarloSimulationSync(
            config,
            createTestAccounts(),
            createTestIncomes(),
            createTestExpenses(),
            shortAssumptions,
            createTestTaxState()
        );

        // Results should be identical
        expect(asyncResult.medianCase.finalNetWorth).toBe(syncResult.medianCase.finalNetWorth);
        expect(asyncResult.successRate).toBe(syncResult.successRate);
    });
});
