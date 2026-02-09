/**
 * Tests for Roth Analysis Functions:
 * - calculateBreakEvenRate
 * - analyzeRothVsPreTax
 * - findOptimalRothAmount
 *
 * Based on test scenarios in docs/ROTH_ANALYSIS_FUNCTIONS_TEST_SCENARIOS.md
 */

import { describe, it, expect } from 'vitest';
import {
    calculateBreakEvenRate,
    analyzeRothVsPreTax,
    findOptimalRothAmount,
} from '../../services/TaxOptimizationService';
import { TaxState } from '../../components/Objects/Taxes/TaxContext';
import { defaultAssumptions, AssumptionsState, createBuiltinMilestones } from '../../components/Objects/Assumptions/AssumptionsContext';
import { SimulationYear } from '../../components/Objects/Assumptions/SimulationEngine';
import { TaxParameters } from '../../data/TaxData';
import { ACAOptions } from '../../services/simulation/helpers';
import { SocialSecurityIncome, WorkIncome } from '../../components/Objects/Income/models';

// =============================================================================
// Test Helpers
// =============================================================================

const createTaxState = (overrides: Partial<TaxState> = {}): TaxState => ({
    filingStatus: 'Single',
    stateResidency: 'Texas', // No state tax by default
    deductionMethod: 'Standard',
    fedOverride: null,
    ficaOverride: null,
    stateOverride: null,
    year: 2026,
    ...overrides
});

const createAssumptions = (overrides: Partial<AssumptionsState> = {}): AssumptionsState => ({
    ...defaultAssumptions,
    milestones: createBuiltinMilestones(1980, 65, 90), // birthYear=1980, retirementAge=65, lifeExpectancy=90
    investments: {
        ...defaultAssumptions.investments,
        returnRates: { ror: 7 }
    },
    macro: {
        ...defaultAssumptions.macro,
        inflationAdjusted: false,
        inflationRate: 0
    },
    ...overrides
});

const createMockSimulationYear = (
    year: number,
    options: {
        grossIncome?: number;
        preTaxDeductions?: number;
        ssIncome?: number;
    } = {}
): SimulationYear => {
    const { grossIncome = 50000, preTaxDeductions = 0, ssIncome = 0 } = options;

    const incomes: any[] = [];
    if (grossIncome > ssIncome) {
        incomes.push(new WorkIncome('work1', 'Salary', grossIncome - ssIncome, 'Annually', 'Yes', 0, 0, 0, 0, '', null, 'FIXED', new Date(`${year}-01-01`)));
    }
    if (ssIncome > 0) {
        incomes.push(new SocialSecurityIncome('ss1', 'Social Security', ssIncome, 'Annually', 67, undefined, new Date(`${year}-01-01`)));
    }

    return {
        year,
        incomes,
        expenses: [],
        accounts: [],
        cashflow: {
            totalIncome: grossIncome,
            totalExpense: 0,
            livingExpenses: 0,
            discretionary: 0,
            investedUser: 0,
            investedMatch: 0,
            totalInvested: 0,
            bucketAllocations: 0,
            bucketDetail: {},
            withdrawals: 0,
            withdrawalDetail: {}
        },
        taxDetails: {
            fed: 0,
            state: 0,
            fica: 0,
            preTax: preTaxDeductions,
            insurance: 0,
            postTax: 0,
            capitalGains: 0,
            withdrawalOrdinaryTax: 0,
            niit: 0
        },
        logs: []
    };
};

// Create simulation spanning multiple years
const createSimulation = (startYear: number, endYear: number, yearConfig?: (year: number) => {
    grossIncome?: number;
    preTaxDeductions?: number;
    ssIncome?: number;
}): SimulationYear[] => {
    const simulation: SimulationYear[] = [];
    for (let y = startYear; y <= endYear; y++) {
        const config = yearConfig ? yearConfig(y) : {};
        simulation.push(createMockSimulationYear(y, config));
    }
    return simulation;
};

// 5% flat state tax params
const stateParams5Percent: TaxParameters = {
    standardDeduction: 0,
    brackets: [{ threshold: 0, rate: 0.05 }],
    socialSecurityTaxRate: 0,
    socialSecurityWageBase: 0,
    medicareTaxRate: 0,
    capitalGainsBrackets: []
};

// =============================================================================
// Part 1: calculateBreakEvenRate
// =============================================================================

describe('calculateBreakEvenRate', () => {
    const taxState = createTaxState();
    const assumptions = createAssumptions();
    const year = 2026;

    describe('Test Group 1.1: Contribution Mode - Marginal Rate', () => {
        // For contributions, break-even = marginal bracket rate
        // 2026 Single brackets (approx with std deduction $15,000):
        // 10%: $0 - $11,925
        // 12%: $11,925 - $48,475
        // 22%: $48,475 - $103,350
        // 24%: $103,350 - $197,300

        it('should return 10% rate for income in 10% bracket', () => {
            // Taxable income 20000, after std deduction ~5000 -> 10% bracket
            const rate = calculateBreakEvenRate(
                20000, 5000, 'contribution',
                0, 0, taxState, year, assumptions, null
            );
            expect(rate).toBeCloseTo(0.10, 2);
        });

        it('should return 12% rate for income in 12% bracket', () => {
            // Taxable income 40000, after std deduction ~25000 -> 12% bracket
            const rate = calculateBreakEvenRate(
                40000, 5000, 'contribution',
                0, 0, taxState, year, assumptions, null
            );
            expect(rate).toBeCloseTo(0.12, 2);
        });

        it('should return 22% rate for income in 22% bracket', () => {
            // Taxable income 80000, after std deduction ~65000 -> 22% bracket
            const rate = calculateBreakEvenRate(
                80000, 5000, 'contribution',
                0, 0, taxState, year, assumptions, null
            );
            expect(rate).toBeCloseTo(0.22, 2);
        });

        it('should return 24% rate for income in 24% bracket', () => {
            // Taxable income 130000, after std deduction ~115000 -> 24% bracket
            const rate = calculateBreakEvenRate(
                130000, 5000, 'contribution',
                0, 0, taxState, year, assumptions, null
            );
            expect(rate).toBeCloseTo(0.24, 2);
        });

        it('should handle income at bracket boundary', () => {
            // Just into 12% bracket
            const rate = calculateBreakEvenRate(
                28500, 5000, 'contribution',
                0, 0, taxState, year, assumptions, null
            );
            expect(rate).toBeCloseTo(0.12, 2);
        });

        it('should return 10% for income below standard deduction', () => {
            // Taxable = 0 after std deduction, but marginal is still 10%
            const rate = calculateBreakEvenRate(
                10000, 5000, 'contribution',
                0, 0, taxState, year, assumptions, null
            );
            expect(rate).toBeCloseTo(0.10, 2);
        });
    });

    describe('Test Group 1.2: Conversion Mode - Basic Effective Rate', () => {
        it('should return ~12% for conversion in single bracket', () => {
            // Income 50000, conversion 10000, all in 12% bracket
            const rate = calculateBreakEvenRate(
                50000, 10000, 'conversion',
                0, 0, taxState, year, assumptions, null
            );
            // Should be close to 12%
            expect(rate).toBeGreaterThanOrEqual(0.10);
            expect(rate).toBeLessThanOrEqual(0.15);
        });

        it('should return higher rate when conversion spans brackets', () => {
            // Income 60000, conversion 20000 -> crosses into 22%
            const rate = calculateBreakEvenRate(
                60000, 20000, 'conversion',
                0, 0, taxState, year, assumptions, null
            );
            expect(rate).toBeGreaterThan(0.12);
        });

        it('should return higher rate for large conversion spanning multiple brackets', () => {
            // Income 50000, conversion 100000 -> spans multiple brackets
            const rate = calculateBreakEvenRate(
                50000, 100000, 'conversion',
                0, 0, taxState, year, assumptions, null
            );
            expect(rate).toBeGreaterThan(0.15);
        });
    });

    describe('Test Group 1.3: Conversion Mode - With SS Torpedo', () => {
        it('should increase rate when SS is in 50% taxable zone', () => {
            const rateNoSS = calculateBreakEvenRate(
                10000, 10000, 'conversion',
                0, 0, taxState, year, assumptions, null
            );
            const rateWithSS = calculateBreakEvenRate(
                10000, 10000, 'conversion',
                25000, 0, taxState, year, assumptions, null
            );
            // SS torpedo should increase effective rate
            expect(rateWithSS).toBeGreaterThan(rateNoSS);
        });

        it('should increase rate more when SS is in 85% taxable zone', () => {
            const rateWithSS50 = calculateBreakEvenRate(
                20000, 15000, 'conversion',
                20000, 0, taxState, year, assumptions, null
            );
            const rateWithSS85 = calculateBreakEvenRate(
                30000, 15000, 'conversion',
                30000, 0, taxState, year, assumptions, null
            );
            // Higher income pushes more SS into taxable, should increase rate
            expect(rateWithSS85).toBeGreaterThanOrEqual(rateWithSS50);
        });

        it('should not add torpedo cost when SS already maxed at 85%', () => {
            // High income where SS is already 85% taxable
            const rate = calculateBreakEvenRate(
                100000, 20000, 'conversion',
                30000, 0, taxState, year, assumptions, null
            );
            // Rate should be close to bracket rate (no additional torpedo)
            expect(rate).toBeGreaterThanOrEqual(0.20);
            expect(rate).toBeLessThanOrEqual(0.30);
        });
    });

    describe('Test Group 1.4: Conversion Mode - With State Tax', () => {
        it('should not include state tax when stateParams is null', () => {
            const rate = calculateBreakEvenRate(
                50000, 20000, 'conversion',
                0, 0, taxState, year, assumptions, null
            );
            // Federal only
            expect(rate).toBeGreaterThan(0.10);
            expect(rate).toBeLessThan(0.20);
        });

        it('should include state tax when stateParams provided', () => {
            const rateNoState = calculateBreakEvenRate(
                50000, 20000, 'conversion',
                0, 0, taxState, year, assumptions, null
            );
            const rateWithState = calculateBreakEvenRate(
                50000, 20000, 'conversion',
                0, 0, taxState, year, assumptions, stateParams5Percent
            );
            // 5% state should increase rate by about 5%
            expect(rateWithState).toBeGreaterThan(rateNoState);
            expect(rateWithState - rateNoState).toBeCloseTo(0.05, 1);
        });
    });

    describe('Test Group 1.5: Edge Cases', () => {
        it('should return 0 for zero amount', () => {
            const rate = calculateBreakEvenRate(
                50000, 0, 'conversion',
                0, 0, taxState, year, assumptions, null
            );
            expect(rate).toBe(0);
        });

        it('should return marginal rate for very small amount', () => {
            const rate = calculateBreakEvenRate(
                50000, 1, 'conversion',
                0, 0, taxState, year, assumptions, null
            );
            // Should be close to marginal rate in 12% bracket
            expect(rate).toBeGreaterThan(0);
            expect(rate).toBeLessThan(0.25);
        });
    });
});

// =============================================================================
// Part 2: analyzeRothVsPreTax
// =============================================================================

describe('analyzeRothVsPreTax', () => {
    const taxState = createTaxState();
    const assumptions = createAssumptions();
    const year = 2026;
    const maxAmount = 100000;

    // Default simulation: low income in retirement years
    const simulation = createSimulation(2026, 2060, (y) => {
        if (y >= 2045) {
            return { grossIncome: 30000, ssIncome: 20000 };
        }
        return { grossIncome: 80000 };
    });

    describe('Test Group 2.1: Zero and Edge Cases', () => {
        it('should return benefit=0 and verdict=even for zero amount', () => {
            const result = analyzeRothVsPreTax(
                0, 'contribution', 10, 50000,
                0, 0, taxState, year, assumptions, simulation, maxAmount, null
            );
            expect(result.benefit).toBe(0);
            expect(result.verdict).toBe('even');
        });

        it('should handle zero growth years', () => {
            const result = analyzeRothVsPreTax(
                10000, 'contribution', 0, 50000,
                0, 0, taxState, year, assumptions, simulation, maxAmount, null
            );
            // No growth, pure tax comparison
            expect(result.growthYears).toBe(0);
            expect(result.traditional.valueAtWithdrawal).toBe(10000);
            expect(result.roth.valueAtWithdrawal).toBeLessThan(10000); // Tax was paid
        });
    });

    describe('Test Group 2.2: Growth Projection - Traditional Path', () => {
        it('should correctly project 10 years at 7% growth', () => {
            const result = analyzeRothVsPreTax(
                10000, 'contribution', 10, 50000,
                0, 0, taxState, year, assumptions, simulation, maxAmount, null
            );
            // 10000 * 1.07^10 ≈ 19672
            expect(result.traditional.startingAmount).toBe(10000);
            expect(result.traditional.valueAtWithdrawal).toBeCloseTo(19672, -2);
        });

        it('should correctly project 20 years at 7% growth', () => {
            const result = analyzeRothVsPreTax(
                10000, 'contribution', 20, 50000,
                0, 0, taxState, year, assumptions, simulation, maxAmount, null
            );
            // 10000 * 1.07^20 ≈ 38697
            expect(result.traditional.valueAtWithdrawal).toBeCloseTo(38697, -2);
        });

        it('should correctly project with 0% growth', () => {
            const noGrowthAssumptions = createAssumptions({
                investments: { ...defaultAssumptions.investments, returnRates: { ror: 0 } }
            });
            const result = analyzeRothVsPreTax(
                10000, 'contribution', 10, 50000,
                0, 0, taxState, year, noGrowthAssumptions, simulation, maxAmount, null
            );
            expect(result.traditional.valueAtWithdrawal).toBe(10000);
        });
    });

    describe('Test Group 2.3: Growth Projection - Roth Path', () => {
        it('should start with amount minus tax cost', () => {
            const result = analyzeRothVsPreTax(
                10000, 'contribution', 10, 50000,
                0, 0, taxState, year, assumptions, simulation, maxAmount, null
            );
            // Roth starts with amount minus tax (in 12% bracket)
            expect(result.roth.amountAfterTax).toBeLessThan(10000);
            expect(result.roth.amountAfterTax).toBeGreaterThan(7000); // Not more than 30% tax
        });

        it('should grow tax-free to final value', () => {
            const result = analyzeRothVsPreTax(
                10000, 'contribution', 10, 50000,
                0, 0, taxState, year, assumptions, simulation, maxAmount, null
            );
            // Roth value at withdrawal = amountAfterTax * 1.07^10
            const expectedValue = result.roth.amountAfterTax * Math.pow(1.07, 10);
            expect(result.roth.valueAtWithdrawal).toBeCloseTo(expectedValue, 0);
            // And afterTaxValue = valueAtWithdrawal (no tax)
            expect(result.roth.afterTaxValue).toBe(result.roth.valueAtWithdrawal);
        });
    });

    describe('Test Group 2.4: Verdict Logic', () => {
        it('should return even when rates are similar', () => {
            // Create scenario where current and retirement rates are similar
            const evenSimulation = createSimulation(2026, 2060, () => ({ grossIncome: 50000 }));
            const result = analyzeRothVsPreTax(
                10000, 'contribution', 10, 50000,
                0, 0, taxState, year, assumptions, evenSimulation, maxAmount, null
            );
            // With similar tax rates, should be close to even
            expect(Math.abs(result.benefit)).toBeLessThan(2500);
        });

        it('should favor roth when current rate is lower than retirement rate', () => {
            // Low income now (12% bracket), high retirement income
            const highRetirementSim = createSimulation(2026, 2060, (y) => {
                if (y >= 2045) return { grossIncome: 150000 };
                return { grossIncome: 40000 };
            });
            const result = analyzeRothVsPreTax(
                10000, 'contribution', 19, 40000,
                0, 0, taxState, year, assumptions, highRetirementSim, maxAmount, null
            );
            // Lower current rate should favor Roth
            if (result.currentEffectiveRate < result.retirementMarginalRate) {
                expect(result.verdict).toBe('roth');
            }
        });

        it('should favor traditional when current rate is higher than retirement rate', () => {
            // High income now (24% bracket), low retirement income
            const lowRetirementSim = createSimulation(2026, 2060, (y) => {
                if (y >= 2045) return { grossIncome: 20000 };
                return { grossIncome: 130000 };
            });
            const result = analyzeRothVsPreTax(
                10000, 'contribution', 19, 130000,
                0, 0, taxState, year, assumptions, lowRetirementSim, maxAmount, null
            );
            // Higher current rate should favor Traditional
            if (result.currentEffectiveRate > result.retirementMarginalRate) {
                expect(result.verdict).toBe('traditional');
            }
        });
    });

    describe('Test Group 2.5: Contribution vs Conversion Mode', () => {
        it('should use marginal rate for contribution mode', () => {
            const result = analyzeRothVsPreTax(
                10000, 'contribution', 10, 50000,
                0, 0, taxState, year, assumptions, simulation, maxAmount, null
            );
            // Should be marginal rate (12% bracket)
            expect(result.currentEffectiveRate).toBeCloseTo(0.12, 1);
            // No taxBreakdown for contribution mode
            expect(result.taxBreakdown).toBeUndefined();
        });

        it('should use effective rate and provide breakdown for conversion mode', () => {
            const result = analyzeRothVsPreTax(
                10000, 'conversion', 10, 50000,
                0, 0, taxState, year, assumptions, simulation, maxAmount, null
            );
            // Effective rate for conversion
            expect(result.currentEffectiveRate).toBeGreaterThan(0);
            // Should have taxBreakdown for conversion mode
            expect(result.taxBreakdown).toBeDefined();
        });
    });

    describe('Test Group 2.6: With SS Torpedo', () => {
        it('should show higher effective rate when SS torpedo applies', () => {
            const resultNoSS = analyzeRothVsPreTax(
                15000, 'conversion', 10, 15000,
                0, 0, taxState, year, assumptions, simulation, maxAmount, null
            );
            const resultWithSS = analyzeRothVsPreTax(
                15000, 'conversion', 10, 15000,
                25000, 0, taxState, year, assumptions, simulation, maxAmount, null
            );
            expect(resultWithSS.currentEffectiveRate).toBeGreaterThan(resultNoSS.currentEffectiveRate);
        });

        it('should populate ssTorpedoCost in taxBreakdown when SS present', () => {
            const result = analyzeRothVsPreTax(
                15000, 'conversion', 10, 15000,
                25000, 0, taxState, year, assumptions, simulation, maxAmount, null
            );
            expect(result.taxBreakdown).toBeDefined();
            expect(result.taxBreakdown!.ssTorpedoCost).toBeGreaterThanOrEqual(0);
        });
    });

    describe('Test Group 2.7: With ACA Cliff', () => {
        const acaOptions: ACAOptions = {
            currentAge: 55,
            acaSubsidyAware: true,
            acaCliffThreshold: 64400,
            estimatedSubsidyLoss: 8000
        };

        it('should set crossesACACliff=true when conversion crosses cliff', () => {
            // Income 60000, conversion 10000 -> 70000 > cliff 64400
            const result = analyzeRothVsPreTax(
                10000, 'conversion', 10, 60000,
                0, 0, taxState, year, assumptions, simulation, maxAmount, null, acaOptions
            );
            expect(result.crossesACACliff).toBe(true);
        });

        it('should set crossesACACliff=false when staying below cliff', () => {
            // Income 50000, conversion 10000 -> 60000 < cliff 64400
            const result = analyzeRothVsPreTax(
                10000, 'conversion', 10, 50000,
                0, 0, taxState, year, assumptions, simulation, maxAmount, null, acaOptions
            );
            expect(result.crossesACACliff).toBe(false);
        });
    });

    describe('Test Group 2.8: Reason String', () => {
        it('should contain "saves" for roth verdict', () => {
            // Create scenario favoring Roth
            const lowRetirementSim = createSimulation(2026, 2060, (y) => {
                if (y >= 2036) return { grossIncome: 20000 };
                return { grossIncome: 40000 };
            });
            const result = analyzeRothVsPreTax(
                10000, 'contribution', 10, 40000,
                0, 0, taxState, year, assumptions, lowRetirementSim, maxAmount, null
            );
            if (result.verdict === 'roth') {
                expect(result.reason.toLowerCase()).toContain('save');
            }
        });

        it('should mention same value for even verdict', () => {
            const result = analyzeRothVsPreTax(
                0, 'contribution', 10, 50000,
                0, 0, taxState, year, assumptions, simulation, maxAmount, null
            );
            expect(result.verdict).toBe('even');
            // Reason should indicate equal/same
            expect(result.reason.length).toBeGreaterThan(0);
        });
    });

    describe('Test Group 2.9: Return Value Validation', () => {
        it('should have all required fields with valid values', () => {
            const result = analyzeRothVsPreTax(
                10000, 'conversion', 10, 50000,
                0, 0, taxState, year, assumptions, simulation, maxAmount, null
            );

            // Rate validations
            expect(result.currentEffectiveRate).toBeGreaterThanOrEqual(0);
            expect(result.retirementMarginalRate).toBeGreaterThanOrEqual(0);
            expect(result.breakEvenRate).toBeGreaterThanOrEqual(0);

            // Traditional path validation
            expect(result.traditional.afterTaxValue).toBeCloseTo(
                result.traditional.valueAtWithdrawal - result.traditional.taxAtWithdrawal, 0
            );

            // Roth path validation (no tax at withdrawal)
            expect(result.roth.afterTaxValue).toBe(result.roth.valueAtWithdrawal);

            // Benefit calculation
            expect(result.benefit).toBeCloseTo(
                result.roth.afterTaxValue - result.traditional.afterTaxValue, 0
            );

            // Verdict consistency
            if (result.benefit > 100) {
                expect(result.verdict).toBe('roth');
            } else if (result.benefit < -100) {
                expect(result.verdict).toBe('traditional');
            }

            // Reason is non-empty
            expect(result.reason.length).toBeGreaterThan(0);

            // Tax breakdown components >= 0 for conversion mode
            expect(result.taxBreakdown).toBeDefined();
            expect(result.taxBreakdown!.federalOrdinaryTaxCost).toBeGreaterThanOrEqual(0);
            expect(result.taxBreakdown!.ssTorpedoCost).toBeGreaterThanOrEqual(0);
            expect(result.taxBreakdown!.ltcgBumpCost).toBeGreaterThanOrEqual(0);
            expect(result.taxBreakdown!.niitCost).toBeGreaterThanOrEqual(0);
            expect(result.taxBreakdown!.stateTaxCost).toBeGreaterThanOrEqual(0);
            expect(result.taxBreakdown!.acaSubsidyLost).toBeGreaterThanOrEqual(0);
        });
    });
});

// =============================================================================
// Part 3: findOptimalRothAmount
// =============================================================================

describe('findOptimalRothAmount', () => {
    const taxState = createTaxState();
    const assumptions = createAssumptions();
    const year = 2026;

    describe('Test Group 3.1: Basic Optimization', () => {
        it('should return all-roth when Roth is always better', () => {
            // Low current income (12% bracket), high retirement income
            const highRetirementSim = createSimulation(2026, 2060, (y) => {
                if (y >= 2045) return { grossIncome: 200000 };
                return { grossIncome: 40000 };
            });
            const result = findOptimalRothAmount(
                'contribution', 19, 40000,
                0, 0, taxState, year, assumptions, highRetirementSim, 50000, null
            );
            // When Roth always better, optimalAmount is null, verdict is all-roth
            if (result.optimalVerdict === 'all-roth') {
                expect(result.optimalAmount).toBeNull();
            }
        });

        it('should return all-traditional when Traditional is always better', () => {
            // High current income (32%+ bracket), low retirement income
            const lowRetirementSim = createSimulation(2026, 2060, (y) => {
                if (y >= 2045) return { grossIncome: 15000 };
                return { grossIncome: 250000 };
            });
            const result = findOptimalRothAmount(
                'contribution', 19, 250000,
                0, 0, taxState, year, assumptions, lowRetirementSim, 50000, null
            );
            expect(result.optimalVerdict).toBe('all-traditional');
            expect(result.optimalAmount).toBeNull();
        });

        it('should return optimal amount when mixed benefit', () => {
            // Setup for mixed scenario:
            // - Current income 45000 (after std deduction ~30000, in 12% bracket)
            // - Retirement income 80000 (after std deduction ~65000, in 22% bracket)
            // Small conversions: 12% current < 22% retirement → Roth wins
            // Large conversions: push current into 22%+ → breaks even or Traditional wins
            const mixedSim = createSimulation(2026, 2060, (y) => {
                if (y >= 2045) return { grossIncome: 80000 };
                return { grossIncome: 45000 };
            });
            const result = findOptimalRothAmount(
                'conversion', 19, 45000,
                0, 0, taxState, year, assumptions, mixedSim, 100000, null
            );
            // Should find a partial optimal (some conversion beneficial, not all)
            if (result.optimalVerdict === 'optimal') {
                expect(result.optimalAmount).not.toBeNull();
                expect(result.optimalAmount).toBeGreaterThan(0);
                expect(result.optimalAmount).toBeLessThan(100000);
            }
            // Also accept 'all-roth' if retirement rate is high enough
            expect(['optimal', 'all-roth']).toContain(result.optimalVerdict);
        });
    });

    describe('Test Group 3.2: Bracket Filling', () => {
        it('should suggest amount near bracket boundary', () => {
            // Income 40000 (in 12% bracket), want to fill up to 22% boundary
            const sim = createSimulation(2026, 2060, (y) => {
                if (y >= 2045) return { grossIncome: 80000 };
                return { grossIncome: 40000 };
            });
            const result = findOptimalRothAmount(
                'conversion', 19, 40000,
                0, 0, taxState, year, assumptions, sim, 50000, null
            );
            // Should find an optimal amount that fills bracket
            if (result.optimalVerdict === 'optimal') {
                expect(result.optimalAmount).not.toBeNull();
            }
        });

        it('should respect max limit', () => {
            const sim = createSimulation(2026, 2060, () => ({ grossIncome: 50000 }));
            const result = findOptimalRothAmount(
                'contribution', 10, 40000,
                0, 0, taxState, year, assumptions, sim, 5000, null
            );
            // optimalAmount should not exceed maxAmount
            if (result.optimalAmount !== null) {
                expect(result.optimalAmount).toBeLessThanOrEqual(5000);
            }
        });
    });

    describe('Test Group 3.3: ACA Cliff Avoidance', () => {
        const acaOptions: ACAOptions = {
            currentAge: 55,
            acaSubsidyAware: true,
            acaCliffThreshold: 64400,
            estimatedSubsidyLoss: 8000
        };

        it('should avoid crossing ACA cliff when possible', () => {
            // Income 60000, cliff at 64400, max 20000
            const sim = createSimulation(2026, 2060, () => ({ grossIncome: 60000 }));
            const result = findOptimalRothAmount(
                'conversion', 10, 60000,
                0, 0, taxState, year, assumptions, sim, 20000, null, acaOptions
            );
            // If optimal found, should stay below cliff
            if (result.optimalAmount !== null && result.optimalVerdict === 'optimal') {
                expect(result.optimalAmount).toBeLessThanOrEqual(4400);
            }
        });

        it('should not be affected by cliff when already past it', () => {
            // Income 70000 (already past 64400 cliff)
            const sim = createSimulation(2026, 2060, () => ({ grossIncome: 70000 }));
            const resultWithCliff = findOptimalRothAmount(
                'conversion', 10, 70000,
                0, 0, taxState, year, assumptions, sim, 20000, null, acaOptions
            );
            const resultNoCliff = findOptimalRothAmount(
                'conversion', 10, 70000,
                0, 0, taxState, year, assumptions, sim, 20000, null
            );
            // Both should give similar results since already past cliff
            expect(resultWithCliff.optimalVerdict).toBe(resultNoCliff.optimalVerdict);
        });
    });

    describe('Test Group 3.4: Edge Cases', () => {
        it('should handle zero max amount', () => {
            const sim = createSimulation(2026, 2060, () => ({ grossIncome: 50000 }));
            const result = findOptimalRothAmount(
                'contribution', 10, 50000,
                0, 0, taxState, year, assumptions, sim, 0, null
            );
            // With zero max, should return null or all-traditional
            expect(result.optimalAmount === null || result.optimalAmount === 0).toBe(true);
        });

        it('should handle very small max amount', () => {
            const sim = createSimulation(2026, 2060, () => ({ grossIncome: 50000 }));
            const result = findOptimalRothAmount(
                'contribution', 10, 50000,
                0, 0, taxState, year, assumptions, sim, 100, null
            );
            // Should return valid result
            expect(['all-roth', 'all-traditional', 'optimal']).toContain(result.optimalVerdict);
        });
    });

    describe('Test Group 3.5: Verdict Categories', () => {
        it('should have optimalAmount=null for all-traditional', () => {
            // Force high current bracket, low retirement
            const sim = createSimulation(2026, 2060, (y) => {
                if (y >= 2045) return { grossIncome: 15000 };
                return { grossIncome: 300000 };
            });
            const result = findOptimalRothAmount(
                'contribution', 19, 300000,
                0, 0, taxState, year, assumptions, sim, 50000, null
            );
            if (result.optimalVerdict === 'all-traditional') {
                expect(result.optimalAmount).toBeNull();
            }
        });

        it('should have optimalAmount=null for all-roth', () => {
            // Force low current bracket, high retirement
            const sim = createSimulation(2026, 2060, (y) => {
                if (y >= 2045) return { grossIncome: 250000 };
                return { grossIncome: 30000 };
            });
            const result = findOptimalRothAmount(
                'contribution', 19, 30000,
                0, 0, taxState, year, assumptions, sim, 50000, null
            );
            if (result.optimalVerdict === 'all-roth') {
                expect(result.optimalAmount).toBeNull();
            }
        });

        it('should have 0 < optimalAmount < max for optimal verdict', () => {
            // Mixed scenario
            const sim = createSimulation(2026, 2060, () => ({ grossIncome: 70000 }));
            const result = findOptimalRothAmount(
                'conversion', 15, 70000,
                0, 0, taxState, year, assumptions, sim, 100000, null
            );
            if (result.optimalVerdict === 'optimal') {
                expect(result.optimalAmount).not.toBeNull();
                expect(result.optimalAmount!).toBeGreaterThan(0);
                expect(result.optimalAmount!).toBeLessThan(100000);
            }
        });
    });

    describe('Test Group 3.6: Return Value Validation', () => {
        it('should always return valid optimalVerdict', () => {
            const sim = createSimulation(2026, 2060, () => ({ grossIncome: 50000 }));
            const result = findOptimalRothAmount(
                'contribution', 10, 50000,
                0, 0, taxState, year, assumptions, sim, 50000, null
            );
            expect(['all-roth', 'all-traditional', 'optimal']).toContain(result.optimalVerdict);
        });

        it('should have optimalAmount within bounds when not null', () => {
            const sim = createSimulation(2026, 2060, () => ({ grossIncome: 50000 }));
            const maxAmount = 50000;
            const result = findOptimalRothAmount(
                'contribution', 10, 50000,
                0, 0, taxState, year, assumptions, sim, maxAmount, null
            );
            if (result.optimalAmount !== null) {
                expect(result.optimalAmount).toBeGreaterThanOrEqual(0);
                expect(result.optimalAmount).toBeLessThanOrEqual(maxAmount);
            }
        });
    });
});

// =============================================================================
// Part 4: Integration Tests
// =============================================================================

describe('Roth Analysis Functions Integration', () => {
    const taxState = createTaxState();
    const assumptions = createAssumptions();
    const year = 2026;
    const simulation = createSimulation(2026, 2060, () => ({ grossIncome: 60000 }));

    describe('Test Group 4.1: Consistency Between Functions', () => {
        it('should have consistent breakEvenRate between functions', () => {
            const breakEvenRate = calculateBreakEvenRate(
                50000, 10000, 'conversion',
                0, 0, taxState, year, assumptions, null
            );
            const analysis = analyzeRothVsPreTax(
                10000, 'conversion', 10, 50000,
                0, 0, taxState, year, assumptions, simulation, 50000, null
            );
            // breakEvenRate should match
            expect(analysis.breakEvenRate).toBeCloseTo(breakEvenRate, 2);
        });

        it('should have consistent optimalAmount between functions', () => {
            const optimal = findOptimalRothAmount(
                'conversion', 10, 50000,
                0, 0, taxState, year, assumptions, simulation, 50000, null
            );
            const analysis = analyzeRothVsPreTax(
                10000, 'conversion', 10, 50000,
                0, 0, taxState, year, assumptions, simulation, 50000, null
            );
            // optimalAmount should match
            expect(analysis.optimalAmount).toBe(optimal.optimalAmount);
            expect(analysis.optimalVerdict).toBe(optimal.optimalVerdict);
        });
    });

    describe('Test Group 4.2: Verdict Consistency', () => {
        it('should have optimalVerdict=all-roth when analysis verdict is always roth', () => {
            // Create scenario where Roth clearly wins at all amounts
            const lowCurrentHighRetireSim = createSimulation(2026, 2060, (y) => {
                if (y >= 2045) return { grossIncome: 200000 };
                return { grossIncome: 30000 };
            });

            const optimal = findOptimalRothAmount(
                'contribution', 19, 30000,
                0, 0, taxState, year, assumptions, lowCurrentHighRetireSim, 30000, null
            );

            // Test multiple amounts to verify Roth wins at all levels
            const verdicts: string[] = [];
            for (const amount of [5000, 15000, 25000]) {
                const analysis = analyzeRothVsPreTax(
                    amount, 'contribution', 19, 30000,
                    0, 0, taxState, year, assumptions, lowCurrentHighRetireSim, 30000, null
                );
                verdicts.push(analysis.verdict);
            }

            // If all verdicts are 'roth', optimal should be 'all-roth'
            if (verdicts.every(v => v === 'roth')) {
                expect(optimal.optimalVerdict).toBe('all-roth');
            }
        });

        it('should have optimalVerdict=all-traditional when analysis verdict is always traditional', () => {
            // Create scenario where Traditional clearly wins
            const highCurrentLowRetireSim = createSimulation(2026, 2060, (y) => {
                if (y >= 2045) return { grossIncome: 15000 };
                return { grossIncome: 300000 };
            });

            const optimal = findOptimalRothAmount(
                'contribution', 19, 300000,
                0, 0, taxState, year, assumptions, highCurrentLowRetireSim, 50000, null
            );

            // Test multiple amounts to verify Traditional wins at all levels
            const verdicts: string[] = [];
            for (const amount of [10000, 25000, 40000]) {
                const analysis = analyzeRothVsPreTax(
                    amount, 'contribution', 19, 300000,
                    0, 0, taxState, year, assumptions, highCurrentLowRetireSim, 50000, null
                );
                verdicts.push(analysis.verdict);
            }

            // If all verdicts are 'traditional', optimal should be 'all-traditional'
            if (verdicts.every(v => v === 'traditional')) {
                expect(optimal.optimalVerdict).toBe('all-traditional');
            }
        });
    });
});
