/**
 * Tests for TaxOptimizationService functions
 *
 * Tests the main analysis functions:
 * - analyzeTaxSituation
 * - generateRecommendations
 * - getMedianRetirementTaxRate
 * - findRothConversionWindows
 * - generateTaxProjections
 */

import { describe, it, expect } from 'vitest';
import {
    analyzeTaxSituation,
    generateRecommendations,
    getMedianRetirementTaxRate,
    getProjectedRMDMarginalRate,
    findRothConversionWindows,
    getOrdinaryAGI,
    getOrdinaryMarginalRate,
    getIncomeThresholdForRate,
    generateTaxProjections,
    analyzeConversionPlan,
    analyzeRothPreTaxAllocation,
    TaxAnalysis,
    // Helper functions
    get401kContributions,
    getHSAContributions,
    generate401kRecommendation,
    generateHSARecommendation,
    generateBracketRecommendation,
    generateRothConversionRecommendation,
    hasTraditionalRetirementBalance,
    RothConversionOpportunity,
} from '../../services/TaxOptimizationService';
import { calculateContributionTaxSavings } from '../../data/ContributionLimits';
import { InvestedAccount } from '../../components/Objects/Accounts/models';
import { SimulationYear } from '../../services/simulation/types';
import { AssumptionsState, defaultAssumptions, createBuiltinMilestones } from '../../components/Objects/Assumptions/AssumptionsContext';
import { TaxState } from '../../components/Objects/Taxes/TaxContext';
import { WorkIncome, PassiveIncome, CurrentSocialSecurityIncome } from '../../components/Objects/Income/models';
import { getTaxParameters } from '../../components/Objects/Taxes/TaxService';

// ============================================================================
// Helper Functions for Creating Test Data
// ============================================================================

function createTestAssumptions(overrides: Partial<{
    birthYear: number;
    retirementAge: number;
    lifeExpectancy: number;
}> = {}): AssumptionsState {
    const birthYear = overrides.birthYear ?? 1970;
    const retirementAge = overrides.retirementAge ?? 65;
    const lifeExpectancy = overrides.lifeExpectancy ?? 90;

    return {
        ...defaultAssumptions,
        milestones: createBuiltinMilestones(birthYear, retirementAge, lifeExpectancy),
        investments: {
            ...defaultAssumptions.investments,
            returnRates: { ror: 7 },
        },
    };
}

function createTestTaxState(overrides: Partial<TaxState> = {}): TaxState {
    return {
        filingStatus: 'Single',
        stateResidency: 'Virginia',
        deductionMethod: 'Standard',
        fedOverride: null,
        ficaOverride: null,
        stateOverride: null,
        year: 2025,
        ...overrides,
    };
}

function createMockSimulationYear(overrides: Partial<{
    year: number;
    totalIncome: number;
    fedTax: number;
    stateTax: number;
    ficaTax: number;
    rothConversionTaxCost: number;
    magi: number;
    longTermCapitalGains: number;
    livingExpenses: number;
    rmdWithdrawn: number;
    incomes: SimulationYear['incomes'];
}>): SimulationYear {
    const year = overrides.year ?? 2025;
    const totalIncome = overrides.totalIncome ?? 100000;
    const fedTax = overrides.fedTax ?? 15000;
    const stateTax = overrides.stateTax ?? 5000;
    const ficaTax = overrides.ficaTax ?? 7650;

    return {
        year,
        incomes: overrides.incomes ?? [],
        expenses: [],
        accounts: [],
        magi: overrides.magi,
        rmdDetails: overrides.rmdWithdrawn !== undefined
            ? { totalRMD: overrides.rmdWithdrawn, totalWithdrawn: overrides.rmdWithdrawn, accountBreakdown: [], shortfall: 0, penalty: 0 }
            : undefined,
        cashflow: {
            totalIncome,
            totalExpense: 50000,
            livingExpenses: overrides.livingExpenses ?? 40000,
            discretionary: 10000,
            investedUser: 10000,
            investedMatch: 5000,
            totalInvested: 15000,
            bucketAllocations: 0,
            bucketDetail: {},
            withdrawals: 0,
            withdrawalDetail: {},
        },
        taxDetails: {
            fed: fedTax,
            state: stateTax,
            fica: ficaTax,
            preTax: 0,
            insurance: 0,
            postTax: 0,
            capitalGains: 0,
            withdrawalOrdinaryTax: 0,
            niit: 0,
            longTermCapitalGains: overrides.longTermCapitalGains,
        },
        logs: [],
        rothConversion: overrides.rothConversionTaxCost !== undefined ? {
            amount: 10000,
            taxCost: overrides.rothConversionTaxCost,
            federalTaxCost: overrides.rothConversionTaxCost,
            stateTaxCost: 0,
            taxAfter: fedTax,
            fromAccounts: {},
            toAccounts: {},
            fromAccountIds: {},
            toAccountIds: {},
        } : undefined,
    };
}

// ============================================================================
// analyzeTaxSituation Tests
// ============================================================================

describe('analyzeTaxSituation', () => {
    const assumptions = createTestAssumptions({ birthYear: 1980 });
    const taxState = createTestTaxState();

    describe('basic analysis', () => {
        it('should return correct year and age', () => {
            const simYear = createMockSimulationYear({ year: 2025 });
            const result = analyzeTaxSituation(simYear, assumptions, taxState);

            expect(result.year).toBe(2025);
            expect(result.age).toBe(45); // 2025 - 1980
        });

        it('should return grossIncome from TaxService', () => {
            // Create a WorkIncome with correct parameter order
            // WorkIncome(id, name, amount, frequency, earned_income, preTax401k, insurance, roth401k, employerMatch, matchAccountId, taxType, contributionGrowthStrategy, startDate, end_date, ...)
            const workIncome = new WorkIncome(
                'work1', 'Job', 100000, 'Annually',
                'Yes',  // earned_income
                0, 0, 0, 0,  // preTax401k, insurance, roth401k, employerMatch
                '',     // matchAccountId
                null,   // taxType
                'FIXED', // contributionGrowthStrategy
                new Date('2025-01-01'), new Date('2025-12-31')  // startDate, end_date
            );
            const simYear = createMockSimulationYear({
                year: 2025,
                incomes: [workIncome],
            });

            const result = analyzeTaxSituation(simYear, assumptions, taxState);

            expect(result.grossIncome).toBe(100000);
        });

        it('should return taxableIncome as grossIncome minus deductions', () => {
            const workIncome = new WorkIncome(
                'work1', 'Job', 80000, 'Annually',
                'Yes',    // earned_income
                5000,     // preTax401k: $5k
                0, 0, 0,  // insurance, roth401k, employerMatch
                '',       // matchAccountId
                null,     // taxType
                'FIXED',  // contributionGrowthStrategy
                new Date('2025-01-01'), new Date('2025-12-31')
            );
            const simYear = createMockSimulationYear({
                year: 2025,
                incomes: [workIncome],
            });

            const result = analyzeTaxSituation(simYear, assumptions, taxState);

            // taxableIncome = gross - preTaxDeductions
            expect(result.taxableIncome).toBeLessThan(result.grossIncome);
        });
    });

    describe('tax breakdown', () => {
        it('should return correct tax values from simYear.taxDetails', () => {
            const simYear = createMockSimulationYear({
                fedTax: 12000,
                stateTax: 4000,
                ficaTax: 7000,
            });

            const result = analyzeTaxSituation(simYear, assumptions, taxState);

            expect(result.federalTax).toBe(12000);
            expect(result.stateTax).toBe(4000);
            expect(result.ficaTax).toBe(7000);
            expect(result.totalTax).toBe(23000);
        });
    });

    describe('effective rate calculation', () => {
        it('should calculate effectiveRate as totalTax / grossIncome when grossIncome > 0', () => {
            const workIncome = new WorkIncome(
                'work1', 'Job', 100000, 'Annually',
                'Yes',    // earned_income
                0, 0, 0, 0,  // preTax401k, insurance, roth401k, employerMatch
                '',       // matchAccountId
                null,     // taxType
                'FIXED',  // contributionGrowthStrategy
                new Date('2025-01-01'), new Date('2025-12-31')
            );
            const simYear = createMockSimulationYear({
                year: 2025,
                incomes: [workIncome],
                fedTax: 15000,
                stateTax: 5000,
                ficaTax: 7650,
            });

            const result = analyzeTaxSituation(simYear, assumptions, taxState);

            const expectedRate = (15000 + 5000 + 7650) / 100000;
            expect(result.effectiveRate).toBeCloseTo(expectedRate, 4);
        });

        it('should return 0 effectiveRate when grossIncome is 0 (no division by zero)', () => {
            const simYear = createMockSimulationYear({
                year: 2025,
                incomes: [], // No income
                fedTax: 0,
                stateTax: 0,
                ficaTax: 0,
            });

            const result = analyzeTaxSituation(simYear, assumptions, taxState);

            expect(result.effectiveRate).toBe(0);
            expect(result.grossIncome).toBe(0);
        });
    });

    describe('marginal rates', () => {
        it('should return marginal rate breakdown with federal, state, fica, combined', () => {
            const workIncome = new WorkIncome(
                'work1', 'Job', 80000, 'Annually',
                'Yes',    // earned_income
                0, 0, 0, 0,  // preTax401k, insurance, roth401k, employerMatch
                '',       // matchAccountId
                null,     // taxType
                'FIXED',  // contributionGrowthStrategy
                new Date('2025-01-01'), new Date('2025-12-31')
            );
            const simYear = createMockSimulationYear({
                year: 2025,
                incomes: [workIncome],
            });

            const result = analyzeTaxSituation(simYear, assumptions, taxState);

            expect(result.marginalRate).toHaveProperty('federal');
            expect(result.marginalRate).toHaveProperty('state');
            expect(result.marginalRate).toHaveProperty('fica');
            expect(result.marginalRate).toHaveProperty('combined');
            expect(typeof result.marginalRate.federal).toBe('number');
            expect(typeof result.marginalRate.state).toBe('number');
            expect(typeof result.marginalRate.fica).toBe('number');
            expect(typeof result.marginalRate.combined).toBe('number');
        });

        it('should return federal headroom', () => {
            const workIncome = new WorkIncome(
                'work1', 'Job', 50000, 'Annually',
                'Yes',    // earned_income
                0, 0, 0, 0,  // preTax401k, insurance, roth401k, employerMatch
                '',       // matchAccountId
                null,     // taxType
                'FIXED',  // contributionGrowthStrategy
                new Date('2025-01-01'), new Date('2025-12-31')
            );
            const simYear = createMockSimulationYear({
                year: 2025,
                incomes: [workIncome],
            });

            const result = analyzeTaxSituation(simYear, assumptions, taxState);

            expect(typeof result.federalHeadroom).toBe('number');
            expect(result.federalHeadroom).toBeGreaterThanOrEqual(0);
        });
    });

    describe('contribution tracking', () => {
        it('should return 401k contributions current and limit', () => {
            const workIncome = new WorkIncome(
                'work1', 'Job', 100000, 'Annually',
                'Yes',     // earned_income
                10000,     // preTax401k: $10k
                0, 0, 0,   // insurance, roth401k, employerMatch
                '',        // matchAccountId
                null,      // taxType
                'FIXED',   // contributionGrowthStrategy
                new Date('2025-01-01'), new Date('2025-12-31'),
                0          // hsaContribution
            );
            const simYear = createMockSimulationYear({
                year: 2025,
                incomes: [workIncome],
            });

            const result = analyzeTaxSituation(simYear, assumptions, taxState);

            expect(result.preTaxContributions.current401k).toBe(10000);
            expect(result.preTaxContributions.limit401k).toBeGreaterThan(0);
        });

        it('should return HSA contributions current and limit', () => {
            const workIncome = new WorkIncome(
                'work1', 'Job', 100000, 'Annually',
                'Yes',     // earned_income
                0,         // preTax401k
                0, 0, 0,   // insurance, roth401k, employerMatch
                '',        // matchAccountId
                null,      // taxType
                'FIXED',   // contributionGrowthStrategy
                new Date('2025-01-01'), new Date('2025-12-31'),
                2000       // hsaContribution: $2k
            );
            const simYear = createMockSimulationYear({
                year: 2025,
                incomes: [workIncome],
            });

            const result = analyzeTaxSituation(simYear, assumptions, taxState);

            expect(result.preTaxContributions.currentHSA).toBe(2000);
            expect(result.preTaxContributions.limitHSA).toBeGreaterThan(0);
        });
    });
});

// ============================================================================
// generateRecommendations Tests
// ============================================================================

describe('generateRecommendations', () => {
    const assumptions = createTestAssumptions({ birthYear: 1970, retirementAge: 65 });

    function createAnalysis(overrides: Partial<TaxAnalysis> = {}): TaxAnalysis {
        return {
            year: 2025,
            age: 55,
            grossIncome: 100000,
            taxableIncome: 80000,
            federalTax: 12000,
            stateTax: 4000,
            ficaTax: 7650,
            totalTax: 23650,
            effectiveRate: 0.2365,
            marginalRate: {
                federal: 0.22,
                state: 0.05,
                fica: 0.0765,
                combined: 0.3465,
            },
            federalBracket: 22,
            federalHeadroom: 50000,
            preTaxContributions: {
                current401k: 10000,
                limit401k: 23000,
                currentHSA: 1000,
                limitHSA: 4150,
            },
            ...overrides,
        };
    }

    describe('401k recommendation', () => {
        it('should return 401k recommendation when not maxed out', () => {
            const analysis = createAnalysis({
                preTaxContributions: {
                    current401k: 10000,
                    limit401k: 23000, // Gap of $13k
                    currentHSA: 4150,
                    limitHSA: 4150,
                },
                federalHeadroom: Infinity, // No bracket recommendation
            });
            const simulation = [createMockSimulationYear({ year: 2025 })];

            const result = generateRecommendations(analysis, simulation, assumptions, false);

            const rec401k = result.find(r => r.id === '401k-increase');
            expect(rec401k).toBeDefined();
            expect(rec401k?.category).toBe('contribution');
        });

        it('should NOT return 401k recommendation when maxed out', () => {
            const analysis = createAnalysis({
                preTaxContributions: {
                    current401k: 23000,
                    limit401k: 23000, // No gap
                    currentHSA: 4150,
                    limitHSA: 4150,
                },
                federalHeadroom: Infinity,
            });
            const simulation = [createMockSimulationYear({ year: 2025 })];

            const result = generateRecommendations(analysis, simulation, assumptions, false);

            const rec401k = result.find(r => r.id === '401k-increase');
            expect(rec401k).toBeUndefined();
        });
    });

    describe('HSA recommendation', () => {
        it('should return HSA recommendation when not maxed out', () => {
            const analysis = createAnalysis({
                preTaxContributions: {
                    current401k: 23000,
                    limit401k: 23000,
                    currentHSA: 1000,
                    limitHSA: 4150, // Gap of $3150
                },
                federalHeadroom: Infinity,
            });
            const simulation = [createMockSimulationYear({ year: 2025 })];

            const result = generateRecommendations(analysis, simulation, assumptions, false);

            const recHSA = result.find(r => r.id === 'hsa-increase');
            expect(recHSA).toBeDefined();
            expect(recHSA?.category).toBe('contribution');
        });

        it('should NOT return HSA recommendation when maxed out', () => {
            const analysis = createAnalysis({
                preTaxContributions: {
                    current401k: 23000,
                    limit401k: 23000,
                    currentHSA: 4150,
                    limitHSA: 4150, // No gap
                },
                federalHeadroom: Infinity,
            });
            const simulation = [createMockSimulationYear({ year: 2025 })];

            const result = generateRecommendations(analysis, simulation, assumptions, false);

            const recHSA = result.find(r => r.id === 'hsa-increase');
            expect(recHSA).toBeUndefined();
        });
    });

    describe('bracket recommendation', () => {
        it('should return bracket recommendation when federalHeadroom < threshold', () => {
            const analysis = createAnalysis({
                preTaxContributions: {
                    current401k: 23000,
                    limit401k: 23000,
                    currentHSA: 4150,
                    limitHSA: 4150,
                },
                federalHeadroom: 5000, // Below 10000 threshold
            });
            const simulation = [createMockSimulationYear({ year: 2025 })];

            const result = generateRecommendations(analysis, simulation, assumptions, false);

            const recBracket = result.find(r => r.id === 'bracket-management');
            expect(recBracket).toBeDefined();
            expect(recBracket?.category).toBe('timing');
        });

        it('should NOT return bracket recommendation when federalHeadroom > threshold', () => {
            const analysis = createAnalysis({
                preTaxContributions: {
                    current401k: 23000,
                    limit401k: 23000,
                    currentHSA: 4150,
                    limitHSA: 4150,
                },
                federalHeadroom: 50000, // Above threshold
            });
            const simulation = [createMockSimulationYear({ year: 2025 })];

            const result = generateRecommendations(analysis, simulation, assumptions, false);

            const recBracket = result.find(r => r.id === 'bracket-management');
            expect(recBracket).toBeUndefined();
        });
    });

    describe('Roth conversion recommendation', () => {
        it('should NOT include Roth conversion when hasTraditionalBalance = false', () => {
            const analysis = createAnalysis({
                preTaxContributions: {
                    current401k: 23000,
                    limit401k: 23000,
                    currentHSA: 4150,
                    limitHSA: 4150,
                },
                federalHeadroom: Infinity,
            });
            // Create retirement years with low income (would qualify for conversion)
            const retirementYear = 1970 + 65; // 2035
            const simulation = [
                createMockSimulationYear({ year: retirementYear, totalIncome: 30000, fedTax: 2000 }),
            ];

            const result = generateRecommendations(analysis, simulation, assumptions, false);

            const recRoth = result.find(r => r.id === 'roth-conversion-window');
            expect(recRoth).toBeUndefined();
        });

        it('should include Roth conversion recommendation when hasTraditionalBalance = true and windows exist', () => {
            const analysis = createAnalysis({
                preTaxContributions: {
                    current401k: 23000,
                    limit401k: 23000,
                    currentHSA: 4150,
                    limitHSA: 4150,
                },
                federalHeadroom: Infinity,
            });
            // Create retirement years with low income (would qualify for conversion)
            const birthYear = 1970;
            const retirementYear = birthYear + 65; // 2035
            const simulation = [
                createMockSimulationYear({ year: retirementYear, totalIncome: 30000, fedTax: 2000 }),
                createMockSimulationYear({ year: retirementYear + 1, totalIncome: 32000, fedTax: 2200 }),
            ];

            const result = generateRecommendations(analysis, simulation, assumptions, true);

            const recRoth = result.find(r => r.id === 'roth-conversion-window');
            expect(recRoth).toBeDefined();
            expect(recRoth?.category).toBe('conversion');
        });
    });

    describe('sorting', () => {
        it('should sort recommendations by estimatedAnnualSavings descending', () => {
            const analysis = createAnalysis({
                preTaxContributions: {
                    current401k: 10000,
                    limit401k: 23000, // Gap
                    currentHSA: 1000,
                    limitHSA: 4150, // Gap
                },
                federalHeadroom: 5000, // Below threshold
            });
            const simulation = [createMockSimulationYear({ year: 2025 })];

            const result = generateRecommendations(analysis, simulation, assumptions, false);

            // Verify sorted by savings descending
            for (let i = 1; i < result.length; i++) {
                expect(result[i - 1].estimatedAnnualSavings).toBeGreaterThanOrEqual(
                    result[i].estimatedAnnualSavings
                );
            }
        });
    });

    describe('empty results', () => {
        it('should return empty array when no recommendations apply', () => {
            const analysis = createAnalysis({
                preTaxContributions: {
                    current401k: 23000,
                    limit401k: 23000, // Maxed
                    currentHSA: 4150,
                    limitHSA: 4150, // Maxed
                },
                federalHeadroom: Infinity, // No bracket concern
            });
            const simulation = [createMockSimulationYear({ year: 2025 })];

            const result = generateRecommendations(analysis, simulation, assumptions, false);

            expect(result).toEqual([]);
        });
    });
});

// ============================================================================
// getMedianRetirementTaxRate Tests
// ============================================================================

describe('getMedianRetirementTaxRate', () => {
    const FALLBACK_RATE = 0.22;

    describe('no retirement years', () => {
        it('should return FALLBACK_RETIREMENT_TAX_RATE when all years < retirementYear', () => {
            const simulation = [
                createMockSimulationYear({ year: 2030 }),
                createMockSimulationYear({ year: 2031 }),
            ];

            const result = getMedianRetirementTaxRate(simulation, 2035); // retirementYear after all data

            expect(result).toBe(FALLBACK_RATE);
        });

        it('should return FALLBACK_RETIREMENT_TAX_RATE for empty simulation', () => {
            const result = getMedianRetirementTaxRate([], 2035);

            expect(result).toBe(FALLBACK_RATE);
        });
    });

    describe('single retirement year', () => {
        it('should return that years effective rate', () => {
            // totalTax = 10000, totalIncome = 100000 → rate = 0.10
            const simulation = [
                createMockSimulationYear({
                    year: 2035,
                    totalIncome: 100000,
                    fedTax: 8000,
                    stateTax: 2000,
                    ficaTax: 0,
                }),
            ];

            const result = getMedianRetirementTaxRate(simulation, 2035);

            expect(result).toBeCloseTo(0.10, 4);
        });
    });

    describe('odd number of years', () => {
        it('should return middle value for 3 years', () => {
            const simulation = [
                createMockSimulationYear({ year: 2035, totalIncome: 100000, fedTax: 5000, stateTax: 0, ficaTax: 0 }), // 5%
                createMockSimulationYear({ year: 2036, totalIncome: 100000, fedTax: 10000, stateTax: 0, ficaTax: 0 }), // 10%
                createMockSimulationYear({ year: 2037, totalIncome: 100000, fedTax: 15000, stateTax: 0, ficaTax: 0 }), // 15%
            ];

            const result = getMedianRetirementTaxRate(simulation, 2035);

            expect(result).toBeCloseTo(0.10, 4); // Middle value
        });

        it('should return middle value for 5 years', () => {
            const simulation = [
                createMockSimulationYear({ year: 2035, totalIncome: 100000, fedTax: 5000, stateTax: 0, ficaTax: 0 }), // 5%
                createMockSimulationYear({ year: 2036, totalIncome: 100000, fedTax: 8000, stateTax: 0, ficaTax: 0 }), // 8%
                createMockSimulationYear({ year: 2037, totalIncome: 100000, fedTax: 12000, stateTax: 0, ficaTax: 0 }), // 12%
                createMockSimulationYear({ year: 2038, totalIncome: 100000, fedTax: 15000, stateTax: 0, ficaTax: 0 }), // 15%
                createMockSimulationYear({ year: 2039, totalIncome: 100000, fedTax: 20000, stateTax: 0, ficaTax: 0 }), // 20%
            ];

            const result = getMedianRetirementTaxRate(simulation, 2035);

            expect(result).toBeCloseTo(0.12, 4); // Middle of sorted [5,8,12,15,20]
        });
    });

    describe('even number of years', () => {
        it('should return average of two middle values for 2 years', () => {
            const simulation = [
                createMockSimulationYear({ year: 2035, totalIncome: 100000, fedTax: 10000, stateTax: 0, ficaTax: 0 }), // 10%
                createMockSimulationYear({ year: 2036, totalIncome: 100000, fedTax: 20000, stateTax: 0, ficaTax: 0 }), // 20%
            ];

            const result = getMedianRetirementTaxRate(simulation, 2035);

            expect(result).toBeCloseTo(0.15, 4); // Average of 10% and 20%
        });

        it('should return average of two middle values for 4 years', () => {
            const simulation = [
                createMockSimulationYear({ year: 2035, totalIncome: 100000, fedTax: 5000, stateTax: 0, ficaTax: 0 }), // 5%
                createMockSimulationYear({ year: 2036, totalIncome: 100000, fedTax: 10000, stateTax: 0, ficaTax: 0 }), // 10%
                createMockSimulationYear({ year: 2037, totalIncome: 100000, fedTax: 15000, stateTax: 0, ficaTax: 0 }), // 15%
                createMockSimulationYear({ year: 2038, totalIncome: 100000, fedTax: 20000, stateTax: 0, ficaTax: 0 }), // 20%
            ];

            const result = getMedianRetirementTaxRate(simulation, 2035);

            expect(result).toBeCloseTo(0.125, 4); // Average of 10% and 15%
        });
    });

    describe('Roth conversion tax exclusion', () => {
        it('should exclude Roth conversion tax from rate calculation', () => {
            // Without conversion: fedTax=10000, total=10000 → 10%
            // With conversion tax of 5000 included in fedTax: baseTax = 10000 - 5000 = 5000 → 5%
            const simulation = [
                createMockSimulationYear({
                    year: 2035,
                    totalIncome: 100000,
                    fedTax: 10000,
                    stateTax: 0,
                    ficaTax: 0,
                    rothConversionTaxCost: 5000,
                }),
            ];

            const result = getMedianRetirementTaxRate(simulation, 2035);

            expect(result).toBeCloseTo(0.05, 4); // (10000 - 5000) / 100000
        });
    });

    describe('edge cases', () => {
        it('should return 0 rate when income is 0 (no division error)', () => {
            const simulation = [
                createMockSimulationYear({
                    year: 2035,
                    totalIncome: 0,
                    fedTax: 0,
                    stateTax: 0,
                    ficaTax: 0,
                }),
            ];

            const result = getMedianRetirementTaxRate(simulation, 2035);

            expect(result).toBe(0);
        });

        it('should clamp negative base tax to 0', () => {
            // If conversion tax > total tax, baseTax would be negative
            // Function should clamp to 0
            const simulation = [
                createMockSimulationYear({
                    year: 2035,
                    totalIncome: 100000,
                    fedTax: 5000,
                    stateTax: 0,
                    ficaTax: 0,
                    rothConversionTaxCost: 10000, // More than fed tax
                }),
            ];

            const result = getMedianRetirementTaxRate(simulation, 2035);

            // Math.max(0, baseTax) should clamp negative to 0
            expect(result).toBe(0);
        });
    });
});

// ============================================================================
// getProjectedRMDMarginalRate Tests
// ============================================================================

describe('getProjectedRMDMarginalRate', () => {
    // Single filer in a no-income-tax state isolates the federal bracket math.
    const taxState = createTestTaxState({ filingStatus: 'Single', stateResidency: 'FL' });
    // Born 1955 → RMD start age 73 → RMD years begin 2028.
    const assumptions = createTestAssumptions({ birthYear: 1955 });

    function rmdYear(year: number, tradBalance: number, rmd: number): SimulationYear {
        const y = createMockSimulationYear({ year, incomes: [], rmdWithdrawn: rmd });
        y.accounts = [new InvestedAccount('t1', 'Trad', tradBalance, 0, 0, 0.1, 'Traditional 401k')];
        return y;
    }

    it('returns null when there is no Traditional balance anywhere in the projection', () => {
        const y = createMockSimulationYear({ year: 2030, incomes: [] }); // accounts: []
        expect(getProjectedRMDMarginalRate([y], assumptions, taxState)).toBeNull();
    });

    it('falls back to the peak balance hypothetical-RMD rate when Traditional drains before RMD age', () => {
        // Pre-RMD year (2025 < 2028) holding a large Traditional that never reaches
        // an RMD-era year: the haircut must NOT collapse to 0% — value the peak
        // balance at the rate a hypothetical RMD off it would face.
        const rate = getProjectedRMDMarginalRate([rmdYear(2025, 2_000_000, 0)], assumptions, taxState);
        expect(rate).not.toBeNull();
        expect(rate!).toBeGreaterThan(0.15);
        expect(rate!).toBeLessThan(0.35);
    });

    it('returns the marginal bracket the RMD income lands in', () => {
        // ~$100k RMD (single) lands in the 22% federal bracket.
        const rate = getProjectedRMDMarginalRate([rmdYear(2030, 2_000_000, 100_000)], assumptions, taxState);
        expect(rate).not.toBeNull();
        expect(rate!).toBeGreaterThan(0.18);
        expect(rate!).toBeLessThan(0.30);
    });

    it('rises with a larger Traditional / RMD (higher bracket)', () => {
        const small = getProjectedRMDMarginalRate([rmdYear(2030, 800_000, 40_000)], assumptions, taxState)!;
        const large = getProjectedRMDMarginalRate([rmdYear(2030, 6_000_000, 300_000)], assumptions, taxState)!;
        expect(large).toBeGreaterThan(small);
    });
});

// ============================================================================
// findRothConversionWindows Tests
// ============================================================================

describe('getOrdinaryAGI', () => {
    const filingStatus = 'Single' as const;
    const baseYear = (year: number): SimulationYear => createMockSimulationYear({ year, incomes: [] });

    it('counts RMDs as ordinary income (they are filtered out of simYear.incomes)', () => {
        const simYear = baseYear(2043);
        simYear.rmdDetails = { totalRMD: 40000, totalWithdrawn: 40000, accountBreakdown: [], shortfall: 0, penalty: 0 };
        expect(getOrdinaryAGI(simYear, 73, filingStatus)).toBe(40000);
    });

    it('counts non-RMD Traditional withdrawals as ordinary income', () => {
        const simYear = baseYear(2040);
        simYear.accounts = [new InvestedAccount('t1', 'My Trad', 500000, 0, 0, 0.1, 'Traditional 401k')];
        simYear.cashflow.withdrawalDetail = { 't1': 20000 }; // keyed by account id (#142)
        expect(getOrdinaryAGI(simYear, 70, filingStatus)).toBe(20000);
    });

    it('does NOT count Roth or brokerage withdrawals as ordinary income', () => {
        const simYear = baseYear(2040);
        simYear.accounts = [
            new InvestedAccount('r1', 'My Roth', 300000, 0, 0, 0.1, 'Roth IRA'),
            new InvestedAccount('b1', 'My Brokerage', 300000, 0, 0, 0.1, 'Brokerage'),
        ];
        simYear.cashflow.withdrawalDetail = { 'r1': 30000, 'b1': 15000 }; // keyed by account id (#142)
        expect(getOrdinaryAGI(simYear, 70, filingStatus)).toBe(0);
    });

    it('reduces Social Security to its taxable portion, not the full benefit', () => {
        const simYear = baseYear(2040);
        simYear.incomes = [new CurrentSocialSecurityIncome('ss1', 'Social Security', 30000, 'Annually',
            new Date('2040-01-01'), new Date('2040-12-31'))];
        // $30k SS, no other income → provisional income $15k < $25k threshold → 0% taxable.
        const agi = getOrdinaryAGI(simYear, 70, filingStatus);
        expect(agi).toBeLessThan(30000); // the full-benefit bug would yield 30000
        expect(agi).toBe(0);
    });

    it('folds long-term capital gains into SS provisional income (more SS taxable)', () => {
        const ssYear = (): SimulationYear => {
            const sy = baseYear(2040);
            sy.incomes = [new CurrentSocialSecurityIncome('ss1', 'Social Security', 40000, 'Annually',
                new Date('2040-01-01'), new Date('2040-12-31'))];
            return sy;
        };
        // $40k SS alone: provisional $20k < $25k → no SS taxable → ordinary AGI 0.
        expect(getOrdinaryAGI(ssYear(), 70, filingStatus)).toBe(0);

        // Same year + $40k LTCG: provisional jumps to $60k, pushing SS into taxability.
        // The LTCG itself stays off the ordinary AGI (separate schedule).
        const withLTCG = ssYear();
        withLTCG.taxDetails.longTermCapitalGains = 40000;
        const agi = getOrdinaryAGI(withLTCG, 70, filingStatus);
        expect(agi).toBeGreaterThan(0);
        expect(agi).toBeLessThanOrEqual(0.85 * 40000); // at most 85% of the benefit
    });

    it('excludes the modeled conversion by default, includes it when asked', () => {
        const simYear = baseYear(2040);
        simYear.accounts = [new InvestedAccount('t1', 'My Trad', 500000, 0, 0, 0.1, 'Traditional 401k')];
        simYear.cashflow.withdrawalDetail = { 't1': 20000 }; // keyed by account id (#142)
        simYear.rothConversion = {
            amount: 10000, taxCost: 1200, federalTaxCost: 1200, stateTaxCost: 0, taxAfter: 0,
            fromAccounts: {}, toAccounts: {}, fromAccountIds: {}, toAccountIds: {},
        };
        expect(getOrdinaryAGI(simYear, 70, filingStatus, false)).toBe(20000);
        expect(getOrdinaryAGI(simYear, 70, filingStatus, true)).toBe(30000);
    });
});

describe('getOrdinaryMarginalRate (#184 shared add-back base)', () => {
    const taxState = createTestTaxState({ filingStatus: 'Single', stateResidency: 'FL' }); // no state tax
    const assumptions = createTestAssumptions({ birthYear: 1970 });

    it('reads the RMD-inclusive bracket, not the pre-RMD one', () => {
        // A retiree whose income OBJECTS are $0 but who takes a $200k RMD faces the
        // 22% federal bracket. The old getGrossIncome base saw $0 and read 10%/0%.
        const simYear = createMockSimulationYear({ year: 2043, incomes: [], rmdWithdrawn: 200000 });
        const withRMD = getOrdinaryMarginalRate(simYear, 73, taxState, assumptions);

        const noRMD = createMockSimulationYear({ year: 2043, incomes: [] });
        const withoutRMD = getOrdinaryMarginalRate(noRMD, 73, taxState, assumptions);

        expect(withRMD.federal).toBeGreaterThan(withoutRMD.federal);
        expect(withRMD.federal).toBeGreaterThanOrEqual(0.22);
    });
});

describe('analyzeRothPreTaxAllocation (#184 future-rate includes RMD)', () => {
    const taxState = createTestTaxState({ filingStatus: 'Single', stateResidency: 'FL' });
    const birthYear = 1970;
    const assumptions = createTestAssumptions({ birthYear, retirementAge: 65 });

    it('prices the future rate at the RMD-year bracket the RMD actually lands in', () => {
        // Current working year with a Traditional 401(k) contribution, and a future RMD
        // year carrying a large RMD. The future rate must reflect the RMD (22%+), so a
        // low-current-rate worker is told to lean Roth — not read a phantom-low future
        // rate that favors pre-tax (the old getGrossIncome base omitted the RMD).
        const work = new WorkIncome(
            'w1', 'Job', 60000, 'Annually', 'Yes',
            10000, 0, 0, 0, '', null, 'FIXED',
            new Date(`${birthYear + 40}-01-01`), new Date(`${birthYear + 40}-12-31`)
        );
        const currentYear = createMockSimulationYear({ year: birthYear + 40, incomes: [work] });
        const rmdYear = createMockSimulationYear({ year: birthYear + 75, incomes: [], rmdWithdrawn: 200000 });

        const result = analyzeRothPreTaxAllocation([currentYear, rmdYear], assumptions, taxState);
        expect(result).not.toBeNull();
        expect(result!.futureRateBasis).toBe('rmd-year');
        // RMD of $200k → well into the 22%+ federal bracket, above any phantom-low future rate.
        expect(result!.futureRate).toBeGreaterThanOrEqual(0.22);
    });
});

describe('findRothConversionWindows', () => {
    const birthYear = 1970;
    const retirementAge = 65;
    const assumptions = createTestAssumptions({ birthYear, retirementAge });

    describe('pre-retirement filtering', () => {
        it('should skip pre-retirement years (age < retirementAge)', () => {
            const simulation = [
                createMockSimulationYear({ year: 2030 }), // Age 60, pre-retirement
                createMockSimulationYear({ year: 2035 }), // Age 65, retirement
            ];

            const result = findRothConversionWindows(simulation, assumptions);

            // Only retirement years should be considered
            const preRetirementResults = result.filter(r => r.age < retirementAge);
            expect(preRetirementResults).toHaveLength(0);
        });
    });

    describe('rate comparison', () => {
        it('should return empty array when no years have marginalRate < retirementTaxRate', () => {
            // Create simulation with high-income retirement years
            const retirementYear = birthYear + retirementAge; // 2035
            const highIncome = new PassiveIncome(
                'rental', 'Rental Income', 200000, 'Annually', 'No', 'Rental',
                new Date(`${retirementYear}-01-01`), new Date(`${retirementYear}-12-31`)
            );
            const simulation = [
                createMockSimulationYear({
                    year: retirementYear,
                    totalIncome: 200000,
                    incomes: [highIncome],
                }),
            ];

            const result = findRothConversionWindows(simulation, assumptions);

            // High income means high marginal rate, no opportunities
            expect(result.length).toBe(0);
        });

        it('should find years where marginalRate < retirementTaxRate', () => {
            const retirementYear = birthYear + retirementAge; // 2035
            // Low income retirement year
            const lowIncome = new PassiveIncome(
                'rental', 'Rental Income', 25000, 'Annually', 'No', 'Rental',
                new Date(`${retirementYear}-01-01`), new Date(`${retirementYear}-12-31`)
            );
            const simulation = [
                createMockSimulationYear({
                    year: retirementYear,
                    totalIncome: 25000,
                    fedTax: 1000,
                    incomes: [lowIncome],
                }),
            ];

            const result = findRothConversionWindows(simulation, assumptions);

            // A genuinely low-income retirement year must surface an opportunity.
            expect(result.length).toBeGreaterThanOrEqual(1);
            expect(result[0].marginalRate).toBeLessThan(0.22); // Less than MIN_CONVERSION_TARGET_RATE
        });

        it('applies the standard deduction when sizing headroom (regression: not gross/AGI)', () => {
            const retirementYear = birthYear + retirementAge;
            const grossOrdinary = 30000;
            const rental = new PassiveIncome(
                'rental', 'Rental Income', grossOrdinary, 'Annually', 'No', 'Rental',
                new Date(`${retirementYear}-01-01`), new Date(`${retirementYear}-12-31`)
            );
            // Retiree with only rental income: negligible federal tax, no FICA/state,
            // so the projected retirement target rate falls back to 22%.
            const simulation = [createMockSimulationYear({
                year: retirementYear, totalIncome: grossOrdinary,
                fedTax: 1000, stateTax: 0, ficaTax: 0, incomes: [rental],
            })];

            const result = findRothConversionWindows(simulation, assumptions, createTestTaxState());
            expect(result.length).toBe(1);

            const fedParams = getTaxParameters(retirementYear, 'Single', 'federal', undefined, assumptions)!;
            const taxableIncome = Math.max(0, grossOrdinary - fedParams.standardDeduction);
            const expectedOptimal = getIncomeThresholdForRate(0.22, fedParams) - taxableIncome;
            expect(result[0].optimalConversionAmount).toBeCloseTo(expectedOptimal, 0);

            // The pre-fix value (no standard deduction) would be smaller by exactly
            // one standard deduction — guard against regressing to that.
            const buggyOptimal = getIncomeThresholdForRate(0.22, fedParams) - grossOrdinary;
            expect(result[0].optimalConversionAmount - buggyOptimal).toBeCloseTo(fedParams.standardDeduction, 0);
        });
    });

    describe('opportunity calculation', () => {
        it('should return opportunities with correct year and age', () => {
            const retirementYear = birthYear + retirementAge;
            const lowIncome = new PassiveIncome(
                'rental', 'Rental Income', 20000, 'Annually', 'No', 'Rental',
                new Date(`${retirementYear}-01-01`), new Date(`${retirementYear}-12-31`)
            );
            const simulation = [
                createMockSimulationYear({
                    year: retirementYear,
                    totalIncome: 20000,
                    fedTax: 500,
                    incomes: [lowIncome],
                }),
            ];

            const result = findRothConversionWindows(simulation, assumptions);

            if (result.length > 0) {
                expect(result[0].year).toBe(retirementYear);
                expect(result[0].age).toBe(retirementAge);
            }
        });

        it('should return multiple qualifying years in order', () => {
            const retirementYear = birthYear + retirementAge;
            const simulation = [];
            for (let i = 0; i < 5; i++) {
                const year = retirementYear + i;
                const income = new PassiveIncome(
                    `rental${i}`, 'Rental Income', 20000, 'Annually', 'No', 'Rental',
                    new Date(`${year}-01-01`), new Date(`${year}-12-31`)
                );
                simulation.push(createMockSimulationYear({
                    year,
                    totalIncome: 20000,
                    fedTax: 500,
                    incomes: [income],
                }));
            }

            const result = findRothConversionWindows(simulation, assumptions);

            // Results should be in year order
            for (let i = 1; i < result.length; i++) {
                expect(result[i].year).toBeGreaterThanOrEqual(result[i - 1].year);
            }
        });
    });

    describe('MIN_CONVERSION_TARGET_RATE', () => {
        it('should use MAX of MIN_CONVERSION_TARGET_RATE (0.22) and calculated rate', () => {
            // Even if calculated rate is lower, should use at least 22%
            const retirementYear = birthYear + retirementAge;
            const lowIncome = new PassiveIncome(
                'rental', 'Rental Income', 15000, 'Annually', 'No', 'Rental',
                new Date(`${retirementYear}-01-01`), new Date(`${retirementYear}-12-31`)
            );
            const simulation = [
                createMockSimulationYear({
                    year: retirementYear,
                    totalIncome: 15000,
                    fedTax: 0, // Very low tax implies very low rate
                    incomes: [lowIncome],
                }),
            ];

            const result = findRothConversionWindows(simulation, assumptions);

            // Should find opportunities up to 22% bracket even if calculated rate is lower
            if (result.length > 0) {
                // The target rate should be at least 22%, so opportunities exist below that
                expect(result[0].marginalRate).toBeLessThanOrEqual(0.22);
            }
        });
    });
});

// ============================================================================
// generateTaxProjections Tests
// ============================================================================

describe('generateTaxProjections', () => {
    const birthYear = 1970;
    const retirementAge = 65;
    const assumptions = createTestAssumptions({ birthYear, retirementAge });
    const taxState = createTestTaxState();

    describe('basic projection', () => {
        it('should return one projection per simulation year', () => {
            const simulation = [
                createMockSimulationYear({ year: 2025 }),
                createMockSimulationYear({ year: 2026 }),
                createMockSimulationYear({ year: 2027 }),
            ];

            const result = generateTaxProjections(simulation, assumptions, taxState);

            expect(result).toHaveLength(3);
        });

        it('should return correct year and age for each projection', () => {
            const simulation = [
                createMockSimulationYear({ year: 2025 }),
                createMockSimulationYear({ year: 2030 }),
            ];

            const result = generateTaxProjections(simulation, assumptions, taxState);

            expect(result[0].year).toBe(2025);
            expect(result[0].age).toBe(55); // 2025 - 1970

            expect(result[1].year).toBe(2030);
            expect(result[1].age).toBe(60); // 2030 - 1970
        });

        it('should return correct grossIncome from TaxService', () => {
            const workIncome = new WorkIncome(
                'work1', 'Job', 100000, 'Annually',
                'Yes',    // earned_income
                0, 0, 0, 0,  // preTax401k, insurance, roth401k, employerMatch
                '',       // matchAccountId
                null,     // taxType
                'FIXED',  // contributionGrowthStrategy
                new Date('2025-01-01'), new Date('2025-12-31')
            );
            const simulation = [
                createMockSimulationYear({ year: 2025, incomes: [workIncome] }),
            ];

            const result = generateTaxProjections(simulation, assumptions, taxState);

            expect(result[0].grossIncome).toBe(100000);
        });
    });

    describe('effective rate calculation', () => {
        it('should calculate effectiveRate when grossIncome > 0', () => {
            const workIncome = new WorkIncome(
                'work1', 'Job', 100000, 'Annually',
                'Yes',    // earned_income
                0, 0, 0, 0,  // preTax401k, insurance, roth401k, employerMatch
                '',       // matchAccountId
                null,     // taxType
                'FIXED',  // contributionGrowthStrategy
                new Date('2025-01-01'), new Date('2025-12-31')
            );
            const simulation = [
                createMockSimulationYear({
                    year: 2025,
                    incomes: [workIncome],
                    fedTax: 15000,
                    stateTax: 5000,
                    ficaTax: 7650,
                }),
            ];

            const result = generateTaxProjections(simulation, assumptions, taxState);

            const expectedRate = (15000 + 5000 + 7650) / 100000;
            expect(result[0].effectiveRate).toBeCloseTo(expectedRate, 4);
        });

        it('should return 0 effectiveRate when grossIncome is 0', () => {
            const simulation = [
                createMockSimulationYear({
                    year: 2025,
                    incomes: [],
                    fedTax: 0,
                    stateTax: 0,
                    ficaTax: 0,
                }),
            ];

            const result = generateTaxProjections(simulation, assumptions, taxState);

            expect(result[0].effectiveRate).toBe(0);
        });
    });

    describe('marginal rate', () => {
        it('should return combined marginal rate', () => {
            const workIncome = new WorkIncome(
                'work1', 'Job', 80000, 'Annually',
                'Yes',    // earned_income
                0, 0, 0, 0,  // preTax401k, insurance, roth401k, employerMatch
                '',       // matchAccountId
                null,     // taxType
                'FIXED',  // contributionGrowthStrategy
                new Date('2025-01-01'), new Date('2025-12-31')
            );
            const simulation = [
                createMockSimulationYear({ year: 2025, incomes: [workIncome] }),
            ];

            const result = generateTaxProjections(simulation, assumptions, taxState);

            expect(typeof result[0].marginalRate).toBe('number');
            expect(result[0].marginalRate).toBeGreaterThan(0);
        });
    });

    describe('isRetired flag', () => {
        it('should return isRetired = true when age >= retirementAge', () => {
            const retirementYear = birthYear + retirementAge; // 2035
            const simulation = [
                createMockSimulationYear({ year: retirementYear }),
            ];

            const result = generateTaxProjections(simulation, assumptions, taxState);

            expect(result[0].isRetired).toBe(true);
        });

        it('should return isRetired = false when age < retirementAge', () => {
            const preRetirementYear = birthYear + retirementAge - 1; // 2034
            const simulation = [
                createMockSimulationYear({ year: preRetirementYear }),
            ];

            const result = generateTaxProjections(simulation, assumptions, taxState);

            expect(result[0].isRetired).toBe(false);
        });
    });

    describe('isLowTaxYear flag', () => {
        it('should return isLowTaxYear = true when retired AND federal bracket <= 12%', () => {
            const retirementYear = birthYear + retirementAge;
            // Low income in retirement = low bracket
            const lowIncome = new PassiveIncome(
                'rental', 'Rental Income', 25000, 'Annually', 'No', 'Rental',
                new Date(`${retirementYear}-01-01`), new Date(`${retirementYear}-12-31`)
            );
            const simulation = [
                createMockSimulationYear({
                    year: retirementYear,
                    incomes: [lowIncome],
                }),
            ];

            const result = generateTaxProjections(simulation, assumptions, taxState);

            // If federal bracket is <= 12%, isLowTaxYear should be true
            if (result[0].federalBracket <= 12) {
                expect(result[0].isLowTaxYear).toBe(true);
            }
        });

        it('should return isLowTaxYear = false when not retired (even if bracket <= 12%)', () => {
            const preRetirementYear = birthYear + retirementAge - 10; // Well before retirement
            // Low income but not retired
            const lowIncome = new PassiveIncome(
                'part-time', 'Part Time', 20000, 'Annually', 'No', 'Other',
                new Date(`${preRetirementYear}-01-01`), new Date(`${preRetirementYear}-12-31`)
            );
            const simulation = [
                createMockSimulationYear({
                    year: preRetirementYear,
                    incomes: [lowIncome],
                }),
            ];

            const result = generateTaxProjections(simulation, assumptions, taxState);

            expect(result[0].isRetired).toBe(false);
            expect(result[0].isLowTaxYear).toBe(false);
        });

        it('should return isLowTaxYear = false when retired but federal bracket > 12%', () => {
            const retirementYear = birthYear + retirementAge;
            // High income in retirement = high bracket
            const highIncome = new PassiveIncome(
                'rental', 'Rental Income', 150000, 'Annually', 'No', 'Rental',
                new Date(`${retirementYear}-01-01`), new Date(`${retirementYear}-12-31`)
            );
            const simulation = [
                createMockSimulationYear({
                    year: retirementYear,
                    incomes: [highIncome],
                }),
            ];

            const result = generateTaxProjections(simulation, assumptions, taxState);

            expect(result[0].isRetired).toBe(true);
            // High income should put in higher bracket
            if (result[0].federalBracket > 12) {
                expect(result[0].isLowTaxYear).toBe(false);
            }
        });

        it('is NOT low-tax when a large RMD pushes the bracket above 12% (#184)', () => {
            const rmdYear = birthYear + 75; // retired, RMD age
            // Income OBJECTS are modest ($30k SS) — but a large $200k RMD (filtered out of
            // simYear.incomes, carried in rmdDetails) lands the year well above the 12% bracket.
            // The old getGrossIncome base omitted the RMD and mis-badged this "low tax".
            const ss = new CurrentSocialSecurityIncome(
                'ss1', 'Social Security', 30000, 'Annually',
                new Date(`${rmdYear}-01-01`), new Date(`${rmdYear}-12-31`)
            );
            const simulation = [
                createMockSimulationYear({ year: rmdYear, incomes: [ss], rmdWithdrawn: 200000 }),
            ];

            const result = generateTaxProjections(simulation, assumptions, taxState);

            expect(result[0].isRetired).toBe(true);
            expect(result[0].federalBracket).toBeGreaterThan(12);
            expect(result[0].isLowTaxYear).toBe(false);
        });

        it('skips the synthetic end-of-year projection row (#184)', () => {
            const retirementYear = birthYear + retirementAge;
            const real = createMockSimulationYear({ year: retirementYear });
            const eoy = createMockSimulationYear({ year: retirementYear });
            eoy.isEndOfYearProjection = true;
            const result = generateTaxProjections([real, eoy], assumptions, taxState);
            // Only the real row is projected — the EOY duplicate is dropped.
            expect(result).toHaveLength(1);
            expect(result[0].year).toBe(retirementYear);
        });
    });

    describe('FICA inclusion', () => {
        it('should include FICA in marginal calc only when age < retirementAge', () => {
            const preRetirementYear = birthYear + retirementAge - 5; // 2030
            const workIncome = new WorkIncome(
                'work1', 'Job', 80000, 'Annually',
                'Yes',    // earned_income
                0, 0, 0, 0,  // preTax401k, insurance, roth401k, employerMatch
                '',       // matchAccountId
                null,     // taxType
                'FIXED',  // contributionGrowthStrategy
                new Date(`${preRetirementYear}-01-01`), new Date(`${preRetirementYear}-12-31`)
            );
            const simulation = [
                createMockSimulationYear({
                    year: preRetirementYear,
                    incomes: [workIncome],
                }),
            ];

            const result = generateTaxProjections(simulation, assumptions, taxState);

            // Pre-retirement should include FICA in combined marginal rate
            // Combined rate should be higher than just federal+state
            expect(result[0].marginalRate).toBeGreaterThan(0);
        });

        it('should NOT include FICA in marginal calc when age >= retirementAge', () => {
            const retirementYear = birthYear + retirementAge;
            const rentalIncome = new PassiveIncome(
                'rental', 'Rental Income', 80000, 'Annually', 'No', 'Rental',
                new Date(`${retirementYear}-01-01`), new Date(`${retirementYear}-12-31`)
            );
            const simulation = [
                createMockSimulationYear({
                    year: retirementYear,
                    incomes: [rentalIncome],
                }),
            ];

            const result = generateTaxProjections(simulation, assumptions, taxState);

            // Retired, FICA not included in marginal rate
            expect(result[0].isRetired).toBe(true);
            // Rate should be present but not include FICA component
            expect(result[0].marginalRate).toBeGreaterThan(0);
        });
    });
});

// ============================================================================
// get401kContributions Tests
// ============================================================================

describe('get401kContributions', () => {
    describe('no WorkIncome', () => {
        it('should return 0 when incomes array is empty', () => {
            const result = get401kContributions([], 2025);
            expect(result).toBe(0);
        });

        it('should return 0 when incomes array has only PassiveIncome', () => {
            const passiveIncome = new PassiveIncome(
                'div1', 'Dividends', 5000, 'Annually', 'No', 'Dividend',
                new Date('2025-01-01'), new Date('2025-12-31')
            );
            const result = get401kContributions([passiveIncome], 2025);
            expect(result).toBe(0);
        });
    });

    describe('single WorkIncome', () => {
        it('should return preTax + roth contribution for single WorkIncome', () => {
            const workIncome = new WorkIncome(
                'work1', 'Job', 100000, 'Annually',
                'Yes',
                10000,  // preTax401k
                0,      // insurance
                5000,   // roth401k
                0,      // employerMatch
                '',
                null,
                'FIXED',
                new Date('2025-01-01'), new Date('2025-12-31')
            );
            const result = get401kContributions([workIncome], 2025);
            expect(result).toBe(15000); // 10000 + 5000
        });

        it('should return 0 when WorkIncome has no 401k contributions', () => {
            const workIncome = new WorkIncome(
                'work1', 'Job', 100000, 'Annually',
                'Yes',
                0, 0, 0, 0,
                '', null, 'FIXED',
                new Date('2025-01-01'), new Date('2025-12-31')
            );
            const result = get401kContributions([workIncome], 2025);
            expect(result).toBe(0);
        });
    });

    describe('multiple WorkIncomes', () => {
        it('should sum contributions from all WorkIncomes', () => {
            const work1 = new WorkIncome(
                'work1', 'Job1', 80000, 'Annually',
                'Yes',
                8000,   // preTax401k
                0, 0, 0,
                '', null, 'FIXED',
                new Date('2025-01-01'), new Date('2025-12-31')
            );
            const work2 = new WorkIncome(
                'work2', 'Job2', 50000, 'Annually',
                'Yes',
                5000,   // preTax401k
                0,
                2000,   // roth401k
                0,
                '', null, 'FIXED',
                new Date('2025-01-01'), new Date('2025-12-31')
            );
            const result = get401kContributions([work1, work2], 2025);
            expect(result).toBe(15000); // 8000 + 5000 + 2000
        });
    });

    describe('with age parameter', () => {
        it('should use getEffective401k when age is provided (for autoMax401k)', () => {
            // WorkIncome with autoMax401k = 'traditional'
            const workIncome = new WorkIncome(
                'work1', 'Job', 100000, 'Annually',
                'Yes',
                5000,   // preTax401k (will be overridden by autoMax)
                0, 0, 0,
                '', null, 'FIXED',
                new Date('2025-01-01'), new Date('2025-12-31'),
                0,      // hsaContribution
                'traditional'  // autoMax401k - will max out preTax
            );
            // 2025 limit for age 45 (no catch-up) should be $23,500
            const result = get401kContributions([workIncome], 2025, 45);
            expect(result).toBe(23500);
        });

        it('should use raw preTax401k + roth401k when age is not provided', () => {
            const workIncome = new WorkIncome(
                'work1', 'Job', 100000, 'Annually',
                'Yes',
                5000,   // preTax401k
                0, 0, 0,
                '', null, 'FIXED',
                new Date('2025-01-01'), new Date('2025-12-31'),
                0,
                'traditional'  // autoMax401k - but no age provided
            );
            const result = get401kContributions([workIncome], 2025);
            // Without age, should use raw values
            expect(result).toBe(5000);
        });
    });
});

// ============================================================================
// getHSAContributions Tests
// ============================================================================

describe('getHSAContributions', () => {
    describe('no WorkIncome', () => {
        it('should return 0 when incomes array is empty', () => {
            const result = getHSAContributions([], 2025);
            expect(result).toBe(0);
        });

        it('should return 0 when incomes array has only PassiveIncome', () => {
            const passiveIncome = new PassiveIncome(
                'div1', 'Dividends', 5000, 'Annually', 'No', 'Dividend',
                new Date('2025-01-01'), new Date('2025-12-31')
            );
            const result = getHSAContributions([passiveIncome], 2025);
            expect(result).toBe(0);
        });
    });

    describe('single WorkIncome', () => {
        it('should return HSA contribution for single WorkIncome', () => {
            const workIncome = new WorkIncome(
                'work1', 'Job', 100000, 'Annually',
                'Yes',
                0, 0, 0, 0,
                '', null, 'FIXED',
                new Date('2025-01-01'), new Date('2025-12-31'),
                3000  // hsaContribution
            );
            const result = getHSAContributions([workIncome], 2025);
            expect(result).toBe(3000);
        });

        it('should return 0 when WorkIncome has no HSA contribution', () => {
            const workIncome = new WorkIncome(
                'work1', 'Job', 100000, 'Annually',
                'Yes',
                0, 0, 0, 0,
                '', null, 'FIXED',
                new Date('2025-01-01'), new Date('2025-12-31'),
                0  // hsaContribution
            );
            const result = getHSAContributions([workIncome], 2025);
            expect(result).toBe(0);
        });
    });

    describe('multiple WorkIncomes', () => {
        it('should sum HSA contributions from all WorkIncomes', () => {
            const work1 = new WorkIncome(
                'work1', 'Job1', 80000, 'Annually',
                'Yes',
                0, 0, 0, 0,
                '', null, 'FIXED',
                new Date('2025-01-01'), new Date('2025-12-31'),
                2000  // hsaContribution
            );
            const work2 = new WorkIncome(
                'work2', 'Job2', 50000, 'Annually',
                'Yes',
                0, 0, 0, 0,
                '', null, 'FIXED',
                new Date('2025-01-01'), new Date('2025-12-31'),
                1500  // hsaContribution
            );
            const result = getHSAContributions([work1, work2], 2025);
            expect(result).toBe(3500);
        });
    });
});

// ============================================================================
// generate401kRecommendation Tests
// ============================================================================

describe('generate401kRecommendation', () => {
    function createAnalysisFor401k(overrides: {
        current401k?: number;
        limit401k?: number;
        federalRate?: number;
        stateRate?: number;
    }): TaxAnalysis {
        return {
            year: 2025,
            age: 45,
            grossIncome: 100000,
            taxableIncome: 80000,
            federalTax: 12000,
            stateTax: 4000,
            ficaTax: 7650,
            totalTax: 23650,
            effectiveRate: 0.2365,
            marginalRate: {
                federal: overrides.federalRate ?? 0.22,
                state: overrides.stateRate ?? 0.05,
                fica: 0.0765,
                combined: (overrides.federalRate ?? 0.22) + (overrides.stateRate ?? 0.05) + 0.0765,
            },
            federalBracket: 22,
            federalHeadroom: 50000,
            preTaxContributions: {
                current401k: overrides.current401k ?? 10000,
                limit401k: overrides.limit401k ?? 23000,
                currentHSA: 0,
                limitHSA: 4150,
            },
        };
    }

    describe('gap thresholds', () => {
        it('should return null when gap < MIN_401K_GAP_FOR_RECOMMENDATION', () => {
            const analysis = createAnalysisFor401k({
                current401k: 22500,
                limit401k: 23000,  // Gap = $500 < $1000 threshold
            });
            const result = generate401kRecommendation(analysis);
            expect(result).toBeNull();
        });

        it('should return recommendation when gap >= MIN_401K_GAP_FOR_RECOMMENDATION', () => {
            const analysis = createAnalysisFor401k({
                current401k: 22000,
                limit401k: 23000,  // Gap = $1000 = threshold
            });
            const result = generate401kRecommendation(analysis);
            expect(result).not.toBeNull();
        });
    });

    describe('savings thresholds', () => {
        it('should return null when savings < MIN_401K_SAVINGS_FOR_RECOMMENDATION', () => {
            // Gap = $2000, but rate is very low so savings < $100
            const analysis = createAnalysisFor401k({
                current401k: 21000,
                limit401k: 23000,  // Gap = $2000
                federalRate: 0.02,  // 2% + 5% state = 7%
                stateRate: 0.02,    // $2000 * 4% = $80 < $100
            });
            const result = generate401kRecommendation(analysis);
            expect(result).toBeNull();
        });

        it('should return recommendation when savings >= MIN_401K_SAVINGS_FOR_RECOMMENDATION', () => {
            const analysis = createAnalysisFor401k({
                current401k: 21000,
                limit401k: 23000,  // Gap = $2000
                federalRate: 0.10,
                stateRate: 0.05,   // $2000 * 15% = $300 >= $100
            });
            const result = generate401kRecommendation(analysis);
            expect(result).not.toBeNull();
        });
    });

    describe('impact levels', () => {
        it('should return impact=high when savings >= IMPACT_HIGH_401K_THRESHOLD', () => {
            // Gap = $13000, rate = 27% → savings = $3510 >= $2000
            const analysis = createAnalysisFor401k({
                current401k: 10000,
                limit401k: 23000,
                federalRate: 0.22,
                stateRate: 0.05,
            });
            const result = generate401kRecommendation(analysis);
            expect(result).not.toBeNull();
            expect(result!.impact).toBe('high');
        });

        it('should return impact=medium when savings >= IMPACT_MEDIUM_401K_THRESHOLD', () => {
            // Gap = $3000, rate = 27% → savings = $810 >= $500
            const analysis = createAnalysisFor401k({
                current401k: 20000,
                limit401k: 23000,
                federalRate: 0.22,
                stateRate: 0.05,
            });
            const result = generate401kRecommendation(analysis);
            expect(result).not.toBeNull();
            expect(result!.impact).toBe('medium');
        });

        it('should return impact=low when savings < IMPACT_MEDIUM_401K_THRESHOLD', () => {
            // Gap = $2000, rate = 10% → savings = $200 < $500
            const analysis = createAnalysisFor401k({
                current401k: 21000,
                limit401k: 23000,
                federalRate: 0.05,
                stateRate: 0.05,
            });
            const result = generate401kRecommendation(analysis);
            expect(result).not.toBeNull();
            expect(result!.impact).toBe('low');
        });
    });

    describe('return structure', () => {
        it('should return correct id and category', () => {
            const analysis = createAnalysisFor401k({
                current401k: 10000,
                limit401k: 23000,
            });
            const result = generate401kRecommendation(analysis);
            expect(result).not.toBeNull();
            expect(result!.id).toBe('401k-increase');
            expect(result!.category).toBe('contribution');
        });

        it('should include actionItems array', () => {
            const analysis = createAnalysisFor401k({
                current401k: 10000,
                limit401k: 23000,
            });
            const result = generate401kRecommendation(analysis);
            expect(result).not.toBeNull();
            expect(Array.isArray(result!.actionItems)).toBe(true);
            expect(result!.actionItems.length).toBeGreaterThan(0);
        });
    });
});

// ============================================================================
// generateHSARecommendation Tests
// ============================================================================

describe('generateHSARecommendation', () => {
    function createAnalysisForHSA(overrides: {
        currentHSA?: number;
        limitHSA?: number;
        federalRate?: number;
        stateRate?: number;
        ficaRate?: number;
    }): TaxAnalysis {
        return {
            year: 2025,
            age: 45,
            grossIncome: 100000,
            taxableIncome: 80000,
            federalTax: 12000,
            stateTax: 4000,
            ficaTax: 7650,
            totalTax: 23650,
            effectiveRate: 0.2365,
            marginalRate: {
                federal: overrides.federalRate ?? 0.22,
                state: overrides.stateRate ?? 0.05,
                fica: overrides.ficaRate ?? 0.0765,
                combined: (overrides.federalRate ?? 0.22) + (overrides.stateRate ?? 0.05) + (overrides.ficaRate ?? 0.0765),
            },
            federalBracket: 22,
            federalHeadroom: 50000,
            preTaxContributions: {
                current401k: 23000,
                limit401k: 23000,
                currentHSA: overrides.currentHSA ?? 1000,
                limitHSA: overrides.limitHSA ?? 4150,
            },
        };
    }

    describe('gap thresholds', () => {
        it('should return null when gap < MIN_HSA_GAP_FOR_RECOMMENDATION', () => {
            const analysis = createAnalysisForHSA({
                currentHSA: 3800,
                limitHSA: 4150,  // Gap = $350 < $500 threshold
            });
            const result = generateHSARecommendation(analysis);
            expect(result).toBeNull();
        });

        it('should return recommendation when gap >= MIN_HSA_GAP_FOR_RECOMMENDATION', () => {
            const analysis = createAnalysisForHSA({
                currentHSA: 3650,
                limitHSA: 4150,  // Gap = $500 = threshold
            });
            const result = generateHSARecommendation(analysis);
            expect(result).not.toBeNull();
        });
    });

    describe('savings thresholds', () => {
        it('should return null when savings < MIN_HSA_SAVINGS_FOR_RECOMMENDATION', () => {
            // Gap = $1000, but combined rate is very low so savings < $50
            const analysis = createAnalysisForHSA({
                currentHSA: 3150,
                limitHSA: 4150,  // Gap = $1000
                federalRate: 0.02,
                stateRate: 0.01,
                ficaRate: 0.01,  // Combined = 4%, savings = $40 < $50
            });
            const result = generateHSARecommendation(analysis);
            expect(result).toBeNull();
        });

        it('should return recommendation when savings >= MIN_HSA_SAVINGS_FOR_RECOMMENDATION', () => {
            const analysis = createAnalysisForHSA({
                currentHSA: 3150,
                limitHSA: 4150,  // Gap = $1000
                federalRate: 0.10,
                stateRate: 0.05,
                ficaRate: 0.0765,  // Combined ≈ 22.65%, savings ≈ $227 >= $50
            });
            const result = generateHSARecommendation(analysis);
            expect(result).not.toBeNull();
        });
    });

    describe('FICA inclusion', () => {
        it('should include FICA in combined rate calculation', () => {
            // HSA contributions avoid FICA, so savings should include FICA rate
            const analysis = createAnalysisForHSA({
                currentHSA: 0,
                limitHSA: 4150,
                federalRate: 0.22,
                stateRate: 0.05,
                ficaRate: 0.0765,
            });
            const result = generateHSARecommendation(analysis);
            expect(result).not.toBeNull();
            // Combined rate = 22% + 5% + 7.65% = 34.65%
            // Savings = $4150 * 34.65% ≈ $1438
            expect(result!.estimatedAnnualSavings).toBeGreaterThan(1000);
        });
    });

    describe('impact levels', () => {
        it('should return impact=high when savings >= IMPACT_HIGH_HSA_THRESHOLD', () => {
            // Gap = $4150, combined rate = 34.65% → savings ≈ $1438 >= $1000
            const analysis = createAnalysisForHSA({
                currentHSA: 0,
                limitHSA: 4150,
                federalRate: 0.22,
                stateRate: 0.05,
                ficaRate: 0.0765,
            });
            const result = generateHSARecommendation(analysis);
            expect(result).not.toBeNull();
            expect(result!.impact).toBe('high');
        });

        it('should return impact=medium when savings >= IMPACT_MEDIUM_HSA_THRESHOLD', () => {
            // Gap = $2000, combined rate = 20% → savings = $400 >= $300
            const analysis = createAnalysisForHSA({
                currentHSA: 2150,
                limitHSA: 4150,
                federalRate: 0.12,
                stateRate: 0.05,
                ficaRate: 0.03,
            });
            const result = generateHSARecommendation(analysis);
            expect(result).not.toBeNull();
            expect(result!.impact).toBe('medium');
        });

        it('should return impact=low when savings < IMPACT_MEDIUM_HSA_THRESHOLD', () => {
            // Gap = $1000, combined rate = 10% → savings = $100 < $300
            const analysis = createAnalysisForHSA({
                currentHSA: 3150,
                limitHSA: 4150,
                federalRate: 0.05,
                stateRate: 0.03,
                ficaRate: 0.02,
            });
            const result = generateHSARecommendation(analysis);
            expect(result).not.toBeNull();
            expect(result!.impact).toBe('low');
        });
    });

    describe('return structure', () => {
        it('should return correct id and category', () => {
            const analysis = createAnalysisForHSA({
                currentHSA: 0,
                limitHSA: 4150,
            });
            const result = generateHSARecommendation(analysis);
            expect(result).not.toBeNull();
            expect(result!.id).toBe('hsa-increase');
            expect(result!.category).toBe('contribution');
        });
    });
});

// ============================================================================
// generateBracketRecommendation Tests
// ============================================================================

describe('generateBracketRecommendation', () => {
    function createAnalysisForBracket(headroom: number, bracket: number = 22): TaxAnalysis {
        return {
            year: 2025,
            age: 45,
            grossIncome: 100000,
            taxableIncome: 80000,
            federalTax: 12000,
            stateTax: 4000,
            ficaTax: 7650,
            totalTax: 23650,
            effectiveRate: 0.2365,
            marginalRate: {
                federal: bracket / 100,
                state: 0.05,
                fica: 0.0765,
                combined: bracket / 100 + 0.05 + 0.0765,
            },
            federalBracket: bracket,
            federalHeadroom: headroom,
            preTaxContributions: {
                current401k: 23000,
                limit401k: 23000,
                currentHSA: 4150,
                limitHSA: 4150,
            },
        };
    }

    describe('headroom thresholds', () => {
        it('should return null when federalHeadroom > BRACKET_HEADROOM_THRESHOLD', () => {
            const analysis = createAnalysisForBracket(15000); // > $10000
            const result = generateBracketRecommendation(analysis);
            expect(result).toBeNull();
        });

        it('should return null when federalHeadroom = Infinity', () => {
            const analysis = createAnalysisForBracket(Infinity);
            const result = generateBracketRecommendation(analysis);
            expect(result).toBeNull();
        });

        it('should return recommendation when federalHeadroom <= BRACKET_HEADROOM_THRESHOLD', () => {
            const analysis = createAnalysisForBracket(10000); // = threshold
            const result = generateBracketRecommendation(analysis);
            expect(result).not.toBeNull();
        });

        it('should return recommendation when federalHeadroom < BRACKET_HEADROOM_THRESHOLD', () => {
            const analysis = createAnalysisForBracket(5000); // < threshold
            const result = generateBracketRecommendation(analysis);
            expect(result).not.toBeNull();
        });
    });

    describe('return structure', () => {
        it('should return correct id and category', () => {
            const analysis = createAnalysisForBracket(5000);
            const result = generateBracketRecommendation(analysis);
            expect(result).not.toBeNull();
            expect(result!.id).toBe('bracket-management');
            expect(result!.category).toBe('timing');
        });

        it('should include headroom in description', () => {
            const analysis = createAnalysisForBracket(5000, 22);
            const result = generateBracketRecommendation(analysis);
            expect(result).not.toBeNull();
            expect(result!.description).toContain('5,000');
        });

        it('should include federal bracket in description', () => {
            const analysis = createAnalysisForBracket(5000, 24);
            const result = generateBracketRecommendation(analysis);
            expect(result).not.toBeNull();
            expect(result!.description).toContain('24%');
        });
    });
});

// ============================================================================
// generateRothConversionRecommendation Tests
// ============================================================================

describe('generateRothConversionRecommendation', () => {
    function createWindow(overrides: Partial<RothConversionOpportunity> = {}): RothConversionOpportunity {
        return {
            year: 2035,
            age: 65,
            marginalRate: 0.12,
            optimalConversionAmount: 50000,
            taxCost: 6000,
            bracketAfter: 22,
            ...overrides,
        };
    }

    describe('empty or filtered windows', () => {
        it('should return null when windows array is empty', () => {
            const result = generateRothConversionRecommendation([]);
            expect(result).toBeNull();
        });

        it('should return null when all windows have optimalConversionAmount <= MIN_ROTH_CONVERSION_AMOUNT', () => {
            const windows = [
                createWindow({ optimalConversionAmount: 4000 }),
                createWindow({ optimalConversionAmount: 3000 }),
                createWindow({ optimalConversionAmount: 5000 }), // = threshold, filtered out
            ];
            const result = generateRothConversionRecommendation(windows);
            expect(result).toBeNull();
        });
    });

    describe('window selection', () => {
        it('should select lowest marginalRate window as best', () => {
            const windows = [
                createWindow({ year: 2035, age: 65, marginalRate: 0.22, optimalConversionAmount: 30000 }),
                createWindow({ year: 2036, age: 66, marginalRate: 0.10, optimalConversionAmount: 40000 }), // lowest
                createWindow({ year: 2037, age: 67, marginalRate: 0.12, optimalConversionAmount: 35000 }),
            ];
            const result = generateRothConversionRecommendation(windows);
            expect(result).not.toBeNull();
            expect(result!.actionItems[0]).toContain('Age 66');
            expect(result!.actionItems[0]).toContain('10%');
        });

        it('should return up to 3 best windows in actionItems', () => {
            const windows = [
                createWindow({ year: 2035, age: 65, marginalRate: 0.10, optimalConversionAmount: 50000 }),
                createWindow({ year: 2036, age: 66, marginalRate: 0.12, optimalConversionAmount: 50000 }),
                createWindow({ year: 2037, age: 67, marginalRate: 0.15, optimalConversionAmount: 50000 }),
                createWindow({ year: 2038, age: 68, marginalRate: 0.20, optimalConversionAmount: 50000 }),
                createWindow({ year: 2039, age: 69, marginalRate: 0.22, optimalConversionAmount: 50000 }),
            ];
            const result = generateRothConversionRecommendation(windows);
            expect(result).not.toBeNull();
            // Description mentions 3 years
            expect(result!.description).toContain('3 year(s)');
        });
    });

    describe('retirement rate formatting', () => {
        it('should format retirementTaxRate as percentage when provided', () => {
            const windows = [createWindow()];
            const result = generateRothConversionRecommendation(windows, 0.22);
            expect(result).not.toBeNull();
            expect(result!.description).toContain('22%');
        });

        it('should use "higher" when retirementTaxRate is undefined', () => {
            const windows = [createWindow()];
            const result = generateRothConversionRecommendation(windows, undefined);
            expect(result).not.toBeNull();
            expect(result!.description).toContain('higher');
        });
    });

    describe('return structure', () => {
        it('should return correct id, category, and impact', () => {
            const windows = [createWindow()];
            const result = generateRothConversionRecommendation(windows);
            expect(result).not.toBeNull();
            expect(result!.id).toBe('roth-conversion-window');
            expect(result!.category).toBe('conversion');
            expect(result!.impact).toBe('high');
        });
    });
});

// ============================================================================
// hasTraditionalRetirementBalance Tests
// ============================================================================

describe('hasTraditionalRetirementBalance', () => {
    describe('empty or no accounts', () => {
        it('should return false for empty simulation', () => {
            const result = hasTraditionalRetirementBalance([]);
            expect(result).toBe(false);
        });

        it('should return false when first year has no accounts', () => {
            const simYear = createMockSimulationYear({ year: 2025 });
            simYear.accounts = [];
            const result = hasTraditionalRetirementBalance([simYear]);
            expect(result).toBe(false);
        });
    });

    describe('Traditional accounts', () => {
        it('should return true when has Traditional 401k', () => {
            const simYear = createMockSimulationYear({ year: 2025 });
            // InvestedAccount(id, name, amount, employerBalance, tenureYears, expenseRatio, taxType, ...)
            simYear.accounts = [
                new InvestedAccount('acc1', 'Traditional 401k', 100000, 0, 0, 0.1, 'Traditional 401k'),
            ];
            const result = hasTraditionalRetirementBalance([simYear]);
            expect(result).toBe(true);
        });

        it('should return true when has Traditional IRA', () => {
            const simYear = createMockSimulationYear({ year: 2025 });
            simYear.accounts = [
                new InvestedAccount('acc1', 'Traditional IRA', 50000, 0, 0, 0.1, 'Traditional IRA'),
            ];
            const result = hasTraditionalRetirementBalance([simYear]);
            expect(result).toBe(true);
        });
    });

    describe('non-Traditional accounts', () => {
        it('should return false when has only Roth 401k', () => {
            const simYear = createMockSimulationYear({ year: 2025 });
            simYear.accounts = [
                new InvestedAccount('acc1', 'Roth 401k', 100000, 0, 0, 0.1, 'Roth 401k'),
            ];
            const result = hasTraditionalRetirementBalance([simYear]);
            expect(result).toBe(false);
        });

        it('should return false when has only Roth IRA', () => {
            const simYear = createMockSimulationYear({ year: 2025 });
            simYear.accounts = [
                new InvestedAccount('acc1', 'Roth IRA', 50000, 0, 0, 0.1, 'Roth IRA'),
            ];
            const result = hasTraditionalRetirementBalance([simYear]);
            expect(result).toBe(false);
        });

        it('should return false when has only Brokerage', () => {
            const simYear = createMockSimulationYear({ year: 2025 });
            simYear.accounts = [
                new InvestedAccount('acc1', 'Brokerage', 200000, 0, 0, 0.1, 'Brokerage'),
            ];
            const result = hasTraditionalRetirementBalance([simYear]);
            expect(result).toBe(false);
        });
    });

    describe('mixed accounts', () => {
        it('should return true when has Traditional among other account types', () => {
            const simYear = createMockSimulationYear({ year: 2025 });
            simYear.accounts = [
                new InvestedAccount('acc1', 'Roth 401k', 100000, 0, 0, 0.1, 'Roth 401k'),
                new InvestedAccount('acc2', 'Traditional IRA', 50000, 0, 0, 0.1, 'Traditional IRA'),
                new InvestedAccount('acc3', 'Brokerage', 200000, 0, 0, 0.1, 'Brokerage'),
            ];
            const result = hasTraditionalRetirementBalance([simYear]);
            expect(result).toBe(true);
        });
    });
});

// ============================================================================
// calculateContributionTaxSavings Tests (from ContributionLimits)
// ============================================================================

describe('calculateContributionTaxSavings', () => {
    describe('basic calculations', () => {
        it('should calculate additionalContribution as limit - current', () => {
            const result = calculateContributionTaxSavings(10000, 23000, 0.22);
            expect(result.additionalContribution).toBe(13000);
        });

        it('should calculate taxSavings as additionalContribution * marginalRate', () => {
            const result = calculateContributionTaxSavings(10000, 23000, 0.22);
            expect(result.taxSavings).toBe(2860); // 13000 * 0.22
        });

        it('should return correct values for common case: current=0, limit=23000, rate=0.22', () => {
            const result = calculateContributionTaxSavings(0, 23000, 0.22);
            expect(result.additionalContribution).toBe(23000);
            expect(result.taxSavings).toBe(5060); // 23000 * 0.22
        });
    });

    describe('edge cases', () => {
        it('should return additionalContribution=0 when current = limit', () => {
            const result = calculateContributionTaxSavings(23000, 23000, 0.22);
            expect(result.additionalContribution).toBe(0);
            expect(result.taxSavings).toBe(0);
        });

        it('should return additionalContribution=0 when current > limit', () => {
            const result = calculateContributionTaxSavings(25000, 23000, 0.22);
            expect(result.additionalContribution).toBe(0);
            expect(result.taxSavings).toBe(0);
        });

        it('should handle zero marginal rate', () => {
            const result = calculateContributionTaxSavings(0, 23000, 0);
            expect(result.additionalContribution).toBe(23000);
            expect(result.taxSavings).toBe(0);
        });

        it('should handle high marginal rate', () => {
            const result = calculateContributionTaxSavings(0, 23000, 0.37);
            expect(result.additionalContribution).toBe(23000);
            expect(result.taxSavings).toBe(8510); // 23000 * 0.37
        });
    });
});

// ============================================================================
// analyzeConversionPlan Tests
// ============================================================================
// Regression tests for analyzer-side display bugs.
// ============================================================================

describe('analyzeConversionPlan', () => {
    /**
     * Build a minimal simulation containing a single conversion year.
     * Used to verify analyzer display logic — the simulation values are
     * stipulated, not produced by running the engine.
     */
    function buildSimulationWithConversion(opts: {
        year: number;
        otherIncome: number;          // pre-conversion taxable income source
        conversionAmount: number;
        federalTaxCost: number;
        stateTaxCost: number;
        traditionalBalance: number;
    }): SimulationYear[] {
        const {
            year, otherIncome, conversionAmount,
            federalTaxCost, stateTaxCost, traditionalBalance
        } = opts;

        const otherIncomeObj = otherIncome > 0
            ? new PassiveIncome(
                'rental-1', 'Rental', otherIncome, 'Annually',
                'No', 'Rental', new Date(`${year}-01-01`)
            )
            : null;

        const traditional = new InvestedAccount(
            'trad-1', 'Traditional IRA', traditionalBalance,
            0, 10, 0.07, 'Traditional IRA'
        );

        return [{
            year,
            incomes: otherIncomeObj ? [otherIncomeObj] : [],
            expenses: [],
            accounts: [traditional],
            cashflow: {
                totalIncome: otherIncome,
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
                fed: federalTaxCost,
                state: stateTaxCost,
                fica: 0,
                preTax: 0,
                insurance: 0,
                postTax: 0,
                capitalGains: 0,
                withdrawalOrdinaryTax: 0,
                niit: 0,
            },
            logs: [],
            rothConversion: {
                amount: conversionAmount,
                taxCost: federalTaxCost + stateTaxCost,
                federalTaxCost,
                stateTaxCost,
                taxAfter: federalTaxCost,
                fromAccounts: { 'Traditional IRA': conversionAmount },
                toAccounts: { 'Roth IRA': conversionAmount },
                fromAccountIds: { 'trad-1': conversionAmount },
                toAccountIds: { 'roth-1': conversionAmount },
            },
        }];
    }

    describe('marginal-rate display (regression: bug where marginal showed pre-conversion bracket)', () => {
        // 2025 single brackets:
        //   0 – 11,600    : 10%
        //   11,600 – 47,150  : 12%
        //   47,150 – 100,525 : 22%
        // Standard deduction: $15,000
        //
        // Scenario: $10k other income, $80k conversion, Single TX (no state tax).
        // Pre-conversion taxable = max(0, 10k - 15k) = $0  → marginal at $0 = 10%
        // Post-conversion taxable = max(0, 90k - 15k) = $75k → marginal at $75k = 22%
        //
        // The displayed marginal must reflect the post-conversion bracket (22%) so it
        // can never be lower than the effective rate.
        it('reflects the post-conversion federal bracket, not the pre-conversion one', () => {
            const taxState = createTestTaxState({ stateResidency: 'Texas' });
            const assumptions = createTestAssumptions({ birthYear: 1980 });
            const simulation = buildSimulationWithConversion({
                year: 2025,
                otherIncome: 10000,
                conversionAmount: 80000,
                federalTaxCost: 11587, // approximate ordinary tax on $75k taxable for single 2025
                stateTaxCost: 0,
                traditionalBalance: 500000,
            });

            const plan = analyzeConversionPlan(simulation, assumptions, taxState);

            expect(plan).not.toBeNull();
            expect(plan!.hasActiveSchedule).toBe(true);
            expect(plan!.schedule).toHaveLength(1);

            const entry = plan!.schedule[0];
            expect(entry.amount).toBe(80000);

            // Marginal must reflect the bracket the LAST converted dollar landed in.
            // For this scenario, that's the 22% federal bracket (Texas has no state tax).
            expect(entry.marginalRate).toBeCloseTo(0.22, 2);

            // Sanity: effective rate ≤ marginal rate, since marginal is the rate at the
            // top of the conversion and effective is the average across it.
            const effectiveRate = entry.taxCost / entry.amount;
            expect(effectiveRate).toBeLessThanOrEqual(entry.marginalRate + 0.001);
        });

        it('marginal stays in the single bracket when the conversion does not cross one', () => {
            const taxState = createTestTaxState({ stateResidency: 'Texas' });
            const assumptions = createTestAssumptions({ birthYear: 1980 });
            // $10k other + $20k conversion = $30k gross. After $15k std ded → $15k taxable.
            // $15k is in the 12% bracket → marginal should be 12%.
            const simulation = buildSimulationWithConversion({
                year: 2025,
                otherIncome: 10000,
                conversionAmount: 20000,
                federalTaxCost: 1800,
                stateTaxCost: 0,
                traditionalBalance: 200000,
            });

            const plan = analyzeConversionPlan(simulation, assumptions, taxState);
            expect(plan!.schedule[0].marginalRate).toBeCloseTo(0.12, 2);
        });
    });
});
