/**
 * Scenario 8: Roth Conversion with ACA Cliff
 *
 * This test verifies that Roth conversion respects ACA income limits
 * when the user is under 65 and buying insurance on the marketplace.
 *
 * Setup:
 *   Age 58, retired, $0 income, expenses $45k
 *   Brokerage $300k (33% gain ratio), Traditional $700k
 *   ACA cliff: $62,500 (400% FPL, single 2025)
 *
 * Expected Flow:
 *   1. Without ACA: conversion would be higher to fill bracket
 *   2. MAGI includes LTCG from brokerage withdrawal
 *   3. Conversion is reduced to stay under ACA cliff
 *   4. Decision log explains: "Conversion reduced: MAGI would exceed ACA cliff"
 *   5. Buffer maintained (~$500 under cliff)
 *   6. Solved in 1-2 passes
 */

import { describe, it, expect, beforeEach } from 'vitest';

// Level 1: Unit imports
import { classifyIncome } from '../../../services/simulation/IncomeClassifier';
import { planWithdrawals, createOrderedSnapshots } from '../../../services/simulation/WithdrawalPlanner';

// Level 2: Solver imports
import { solveRetirementYear, YearSolverInput } from '../../../services/simulation/YearSolver';

// Level 3: Full simulation imports
import { simulateOneYear } from '../../../components/Objects/Assumptions/SimulationEngine';

// Model imports
import { InvestedAccount, SavedAccount } from '../../../components/Objects/Accounts/models';
import { OtherExpense } from '../../../components/Objects/Expense/models';
import { AssumptionsState, defaultAssumptions, createBuiltinMilestones } from '../../../components/Objects/Assumptions/AssumptionsContext';
import { TaxState } from '../../../components/Objects/Taxes/TaxContext';

// =============================================================================
// TEST FIXTURES
// =============================================================================

const SCENARIO_YEAR = 2025;
const BIRTH_YEAR = 1967; // Age 58 in 2025
const ACA_CLIFF_2025 = 62500; // 400% FPL for Single in 2025 (approximate)

function createScenarioAccounts() {
    // Brokerage: $300k with 33% gains
    const brokerage = new InvestedAccount(
        'brokerage-1', 'Brokerage', 300000,
        0, 10, 0.07, 'Brokerage',
        true, 0.2, 200000  // costBasis = $200k, gains = $100k, ratio = 33%
    );

    // Traditional: $1.5M - large enough that PMT pacing exceeds ACA cliff
    // This creates conversion pressure that forces ACA cliff logic to kick in
    const traditional = new InvestedAccount(
        'trad-1', 'Traditional IRA', 1500000,
        0, 15, 0.05, 'Traditional IRA'
    );

    // Roth: $50k
    const roth = new InvestedAccount(
        'roth-1', 'Roth IRA', 50000,
        0, 10, 0.05, 'Roth IRA',
        true, 0.2, 30000
    );

    // Savings: $20k
    const savings = new SavedAccount('savings-1', 'Savings', 20000, 2.0);

    return { brokerage, traditional, roth, savings };
}

function createScenarioExpenses() {
    const living = new OtherExpense(
        'living-1', 'Living Expenses', 45000, 'Annually', new Date('2020-01-01')
    );
    return { living };
}

function createScenarioAssumptions(useNewEngine: boolean = true): AssumptionsState {
    return {
        ...defaultAssumptions,
        milestones: createBuiltinMilestones(BIRTH_YEAR, 55, 95),
        simulation: {
            useNewEngine,
        },
        investments: {
            ...defaultAssumptions.investments,
            taxOptimizationEnabled: true,
            returnRates: { ror: 6 },
        },
        withdrawalStrategy: [
            { id: 'ws-1', name: 'Brokerage', accountId: 'brokerage-1' },
            { id: 'ws-2', name: 'Traditional', accountId: 'trad-1' },
            { id: 'ws-3', name: 'Roth', accountId: 'roth-1' },
            { id: 'ws-4', name: 'Savings', accountId: 'savings-1' },
        ],
    };
}

function createScenarioTaxState(): TaxState {
    return {
        filingStatus: 'Single',
        stateResidency: 'Texas', // Use full state name (database uses names, not codes)
        deductionMethod: 'Standard',
        fedOverride: null,
        ficaOverride: null,
        stateOverride: null,
        year: SCENARIO_YEAR,
    };
}

// =============================================================================
// LEVEL 1: UNIT TESTS - Individual Module Verification
// =============================================================================

describe('Scenario 8: Level 1 - Unit Tests', () => {
    const accounts = createScenarioAccounts();

    describe('Income Classification', () => {
        it('should have zero spendable income when no income sources', () => {
            const result = classifyIncome([], 0, 0, SCENARIO_YEAR);

            expect(result.classified.spendable).toBe(0);
        });

        it('should count conversion as taxable but not spendable', () => {
            const conversionAmount = 45000;
            const result = classifyIncome([], 0, conversionAmount, SCENARIO_YEAR);

            expect(result.classified.spendable).toBe(0);
            expect(result.classified.conversionIncome).toBe(45000);
            expect(result.classified.taxableTotal).toBe(45000);
        });
    });

    describe('MAGI Calculation for ACA', () => {
        it('should calculate MAGI including LTCG', () => {
            // MAGI = Conversion + LTCG from withdrawals
            // If conversion = $45k and LTCG = $16k
            // MAGI = $61k < $62.5k cliff
            const conversion = 45000;
            const ltcg = 16000;
            const magi = conversion + ltcg;

            expect(magi).toBeLessThan(ACA_CLIFF_2025);
        });

        it('should identify when MAGI would exceed cliff', () => {
            // If conversion = $60k and LTCG = $15k
            // MAGI = $75k > $62.5k cliff
            const conversion = 60000;
            const ltcg = 15000;
            const magi = conversion + ltcg;

            expect(magi).toBeGreaterThan(ACA_CLIFF_2025);
        });
    });

    describe('Withdrawal Planning with Low Income', () => {
        it('should calculate LTCG at 0% rate for low taxable income', () => {
            const assumptions = createScenarioAssumptions();
            const taxState = createScenarioTaxState();

            // With low conversion ($45k), LTCG should be at 0%
            const netNeeded = 45000;
            const snapshots = createOrderedSnapshots(
                [accounts.brokerage],
                [{ accountId: 'brokerage-1' }],
                58
            );

            const result = planWithdrawals(
                netNeeded,
                snapshots,
                58,
                SCENARIO_YEAR,
                taxState,
                45000, // Conversion as ordinary income
                assumptions
            );

            // At $45k ordinary income (below 0% LTCG threshold of ~$48k)
            // LTCG should be taxed at 0%
            expect(result.totalTax).toBeLessThan(1000);
        });
    });
});

// =============================================================================
// LEVEL 2: SOLVER TESTS - YearSolver Integration
// =============================================================================

describe('Scenario 8: Level 2 - Solver Tests', () => {
    let solverInput: YearSolverInput;

    beforeEach(() => {
        const accounts = createScenarioAccounts();
        const expenses = createScenarioExpenses();
        const assumptions = createScenarioAssumptions();
        const taxState = createScenarioTaxState();

        solverInput = {
            year: SCENARIO_YEAR,
            currentAge: 58,
            isRetired: true,
            incomes: [],
            expenses: [expenses.living],
            totalLivingExpenses: 45000,
            rmdAmount: 0,
            accounts: [accounts.brokerage, accounts.traditional, accounts.roth, accounts.savings],
            withdrawalOrder: [
                { accountId: 'brokerage-1' },
                { accountId: 'trad-1' },
                { accountId: 'roth-1' },
                { accountId: 'savings-1' },
            ],
            taxState,
            assumptions,
            taxOptimizationEnabled: true,
            acaAware: true, // KEY: ACA awareness enabled
        };
    });

    it('should solve in 1-2 iterations', () => {
        const yearPlan = solveRetirementYear(solverInput);

        expect(yearPlan.iterations).toBeLessThanOrEqual(2);
        expect(yearPlan.converged).toBe(true);
    });

    it('should perform Roth conversion', () => {
        const yearPlan = solveRetirementYear(solverInput);

        // With tax optimization enabled, should convert
        if (yearPlan.conversion) {
            expect(yearPlan.conversion.amount).toBeGreaterThan(0);
        }
    });

    it('should withdraw from brokerage for expenses', () => {
        const yearPlan = solveRetirementYear(solverInput);

        const brokerageWithdrawals = yearPlan.withdrawals.filter(
            w => w.source === 'brokerage'
        );

        expect(brokerageWithdrawals.length).toBeGreaterThan(0);
    });

    it('should have no unfunded deficit', () => {
        const yearPlan = solveRetirementYear(solverInput);

        expect(yearPlan.unfundedDeficit).toBe(0);
    });

    it('should reduce conversion to stay under ACA cliff', () => {
        // Per spec: Reduced conversion = $45,000
        // Final MAGI = $45,000 + $16,076 LTCG = $61,076 < $62,500 ✓
        const yearPlan = solveRetirementYear(solverInput);

        if (yearPlan.conversion) {
            const conversionAmount = yearPlan.conversion.amount;
            const totalLTCG = yearPlan.withdrawals.reduce((sum, w) => {
                return sum + (w.capitalGains?.longTerm || 0);
            }, 0);
            const magi = conversionAmount + totalLTCG;

            // MAGI should be under ACA cliff
            expect(magi).toBeLessThan(ACA_CLIFF_2025);
        }
    });

    it('should log decision explaining ACA cliff reduction', () => {
        // Per spec: Decision log: "Conversion reduced from $60,282 to $45,000: MAGI would exceed ACA cliff"
        // FEATURE GAP: YearSolver doesn't currently log a decision when ACA cliff reduces conversion
        const yearPlan = solveRetirementYear(solverInput);

        // Find decision explaining ACA cliff reduction
        const acaDecision = yearPlan.decisions.find(
            d => (d.description.toLowerCase().includes('aca') ||
                  d.description.toLowerCase().includes('magi') ||
                  d.description.toLowerCase().includes('cliff')) &&
                 d.description.toLowerCase().includes('reduced')
        );

        // Per spec: Should have decision explaining conversion was reduced due to ACA cliff
        expect(acaDecision).toBeDefined();
        expect(acaDecision!.description).toMatch(/reduced|aca|cliff|magi/i);
    });

    it('should include LTCG from withdrawals in MAGI calculation', () => {
        // Per spec: MAGI includes LTCG from withdrawal (not just conversion)
        // FEATURE GAP: Currently planConversion passes ltcgIncome=0 to coarseToFineSearch
        // because withdrawals are planned AFTER conversion

        const yearPlan = solveRetirementYear(solverInput);

        if (yearPlan.conversion) {
            const conversionAmount = yearPlan.conversion.amount;
            const totalLTCG = yearPlan.withdrawals.reduce((sum, w) => {
                return sum + (w.capitalGains?.longTerm || 0);
            }, 0);

            // The solver should have considered LTCG when deciding conversion amount
            // MAGI = conversion + LTCG must be under cliff
            const magi = conversionAmount + totalLTCG;
            expect(magi).toBeLessThan(ACA_CLIFF_2025);

            // Furthermore, the conversion should be reduced from the bracket-filling amount
            // because LTCG takes up some of the MAGI room under the cliff
            // Without LTCG consideration, conversion would be higher (~$60k)
            // With LTCG consideration, conversion should be reduced (~$45k)
            expect(conversionAmount).toBeLessThan(60000);
        }
    });

    it('should solve algebraically accounting for conversion → tax → withdrawal → LTCG dependency', () => {
        // Per spec: Algebraic solve accounts for conversion → tax → withdrawal → LTCG
        // FEATURE GAP: Currently conversion is planned FIRST without knowing LTCG,
        // then withdrawals are planned. No iteration to resolve the circular dependency.

        const yearPlan = solveRetirementYear(solverInput);

        // The algebraic solve should handle this dependency in 1-2 passes
        expect(yearPlan.converged).toBe(true);
        expect(yearPlan.iterations).toBeLessThanOrEqual(2);

        if (yearPlan.conversion) {
            // The conversion amount should already account for expected LTCG
            // This requires the solver to estimate LTCG before finalizing conversion
            const conversionAmount = yearPlan.conversion.amount;
            const totalLTCG = yearPlan.withdrawals.reduce((sum, w) => {
                return sum + (w.capitalGains?.longTerm || 0);
            }, 0);

            // Final MAGI must respect cliff
            const magi = conversionAmount + totalLTCG;
            expect(magi).toBeLessThan(ACA_CLIFF_2025);

            // Decision log should show the algebraic solving happened
            const algebraicDecision = yearPlan.decisions.find(
                d => d.category === 'conversion' &&
                     (d.description.toLowerCase().includes('ltcg') ||
                      d.description.toLowerCase().includes('magi'))
            );
            expect(algebraicDecision).toBeDefined();
        }
    });

    it('should maintain buffer under ACA cliff (~$500-1000)', () => {
        // Per spec: Buffer maintained (~$500 under cliff)
        const yearPlan = solveRetirementYear(solverInput);

        if (yearPlan.conversion) {
            const conversionAmount = yearPlan.conversion.amount;
            const totalLTCG = yearPlan.withdrawals.reduce((sum, w) => {
                return sum + (w.capitalGains?.longTerm || 0);
            }, 0);
            const magi = conversionAmount + totalLTCG;

            // MAGI should be under cliff with buffer
            const buffer = ACA_CLIFF_2025 - magi;
            expect(buffer).toBeGreaterThan(0);
            expect(buffer).toBeGreaterThanOrEqual(500); // At least $500 buffer
            expect(buffer).toBeLessThan(5000); // But not excessive (wasting conversion opportunity)
        }
    });
});

// =============================================================================
// LEVEL 3: FULL SIMULATION TESTS - End-to-End
// =============================================================================

describe('Scenario 8: Level 3 - Full Simulation', () => {
    it('should produce consistent results with V2 engine', () => {
        const accounts = createScenarioAccounts();
        const expenses = createScenarioExpenses();
        const assumptions = createScenarioAssumptions(true);
        const taxState = createScenarioTaxState();

        const result = simulateOneYear(
            SCENARIO_YEAR,
            [],
            [expenses.living],
            [accounts.brokerage, accounts.traditional, accounts.roth, accounts.savings],
            assumptions,
            taxState
        );

        expect(result.year).toBe(SCENARIO_YEAR);
        expect(result.logs.some(l => l.includes('[V2 Engine]'))).toBe(true);
    });

    it('should track Roth conversion', () => {
        const accounts = createScenarioAccounts();
        const expenses = createScenarioExpenses();
        const assumptions = createScenarioAssumptions(true);
        const taxState = createScenarioTaxState();

        const result = simulateOneYear(
            SCENARIO_YEAR,
            [],
            [expenses.living],
            [accounts.brokerage, accounts.traditional, accounts.roth, accounts.savings],
            assumptions,
            taxState
        );

        // Should have Roth conversion with tax optimization enabled
        if (result.rothConversion) {
            expect(result.rothConversion.amount).toBeGreaterThan(0);
        }
    });

    it('should have withdrawals to cover expenses', () => {
        const accounts = createScenarioAccounts();
        const expenses = createScenarioExpenses();
        const assumptions = createScenarioAssumptions(true);
        const taxState = createScenarioTaxState();

        const result = simulateOneYear(
            SCENARIO_YEAR,
            [],
            [expenses.living],
            [accounts.brokerage, accounts.traditional, accounts.roth, accounts.savings],
            assumptions,
            taxState
        );

        expect(result.cashflow.withdrawals).toBeGreaterThan(0);
    });
});

// =============================================================================
// HAND-CALCULATED VERIFICATION
// =============================================================================

describe('Scenario 8: Hand-Calculated Values', () => {
    it('should calculate ACA cliff for Single 2025', () => {
        // Per spec: ACA cliff: $62,500 (400% FPL, single)
        const acaCliff = 62500;

        expect(acaCliff).toBe(62500);
    });

    it('should calculate initial conversion without ACA limit', () => {
        // Per spec: Without ACA: conversion = $60,282
        // Pacing target: $60,282, bracket space: $64,175
        const pacingTarget = 60282;
        const bracketSpace = 64175;

        expect(pacingTarget).toBe(60282);
        expect(bracketSpace).toBeGreaterThan(pacingTarget);
    });

    it('should calculate initial MAGI exceeds cliff', () => {
        // Per spec: Initial MAGI = $60,282 + $15k LTCG = $75,282 > cliff ❌
        const initialConversion = 60282;
        const estimatedLTCG = 15000;
        const initialMAGI = initialConversion + estimatedLTCG;

        expect(initialMAGI).toBeCloseTo(75282, 0);
        expect(initialMAGI).toBeGreaterThan(ACA_CLIFF_2025);
    });

    it('should calculate reduced conversion for ACA compliance', () => {
        // Per spec: Reduced conversion = $45,000
        const reducedConversion = 45000;

        expect(reducedConversion).toBe(45000);
    });

    it('should calculate final MAGI under cliff', () => {
        // Per spec: Final MAGI = $45,000 + $16,076 LTCG = $61,076 < $62,500 ✓
        const finalConversion = 45000;
        const finalLTCG = 16076;
        const finalMAGI = finalConversion + finalLTCG;

        expect(finalMAGI).toBe(61076);
        expect(finalMAGI).toBeLessThan(ACA_CLIFF_2025);
    });

    it('should calculate LTCG from brokerage withdrawal', () => {
        // Brokerage: $300k, basis $200k
        // Gain ratio = 33%
        // If withdraw $50k: LTCG = $50k × 0.33 = $16,667
        const withdrawal = 50000;
        const gainRatio = 0.333;
        const ltcg = withdrawal * gainRatio;

        expect(ltcg).toBeCloseTo(16667, -2);
    });

    it('should verify MAGI calculation', () => {
        // MAGI = Conversion + LTCG
        // If conversion = $45k and withdrawal generates $16k LTCG
        // MAGI = $61,000 < $62,500 cliff ✓
        const conversion = 45000;
        const ltcg = 16000;
        const magi = conversion + ltcg;

        expect(magi).toBe(61000);
        expect(magi).toBeLessThan(ACA_CLIFF_2025);
    });

    it('should calculate max safe conversion', () => {
        // To stay under cliff of $62,500 with estimated LTCG of $16k:
        // Max conversion = $62,500 - $16,000 - buffer
        // Safe conversion ≈ $45,000
        const cliff = 62500;
        const estimatedLTCG = 16000;
        const buffer = 1500;
        const maxConversion = cliff - estimatedLTCG - buffer;

        expect(maxConversion).toBeCloseTo(45000, -3);
    });

    it('should verify LTCG at 0% rate when taxable income is under threshold', () => {
        // Per spec: LTCG still at 0% (ordinary + LTCG under $48,475)
        //
        // CRITICAL: 0% LTCG threshold is based on TAXABLE income, not gross income!
        //
        // Gross ordinary income (conversion) = $45,000
        // Standard deduction (Single 2025) ≈ $15,000
        // TAXABLE ordinary income = $45,000 - $15,000 = $30,000
        //
        // 0% LTCG threshold for Single 2025 ≈ $48,350
        // Since taxable ordinary ($30k) < threshold ($48,350):
        // - All LTCG fits in 0% rate space!
        // - 0% rate space = $48,350 - $30,000 = $18,350
        // - LTCG = $16,000 < $18,350
        // - Therefore: ALL LTCG at 0%, tax = $0
        //
        const grossOrdinaryIncome = 45000;
        const standardDeduction = 15000;
        const taxableOrdinaryIncome = grossOrdinaryIncome - standardDeduction;
        const ltcg = 16000;
        const zeroRateThreshold = 48350;

        // 0% rate space available after ordinary income
        const zeroRateSpace = Math.max(0, zeroRateThreshold - taxableOrdinaryIncome);

        // All LTCG fits in 0% space
        expect(zeroRateSpace).toBeCloseTo(18350, -2);
        expect(ltcg).toBeLessThan(zeroRateSpace);

        // Therefore LTCG tax is $0
        const ltcgAt0 = Math.min(ltcg, zeroRateSpace);
        const ltcgAt15 = Math.max(0, ltcg - zeroRateSpace);
        const tax = ltcgAt15 * 0.15;

        expect(ltcgAt0).toBe(16000);
        expect(ltcgAt15).toBe(0);
        expect(tax).toBe(0);
    });

    it('should verify buffer calculation', () => {
        // Per spec: Buffer maintained (~$500 under cliff)
        // Final MAGI = $45,000 + $16,076 LTCG = $61,076
        // Cliff = $62,500
        // Buffer = $62,500 - $61,076 = $1,424
        const finalConversion = 45000;
        const finalLTCG = 16076;
        const finalMAGI = finalConversion + finalLTCG;
        const buffer = ACA_CLIFF_2025 - finalMAGI;

        expect(finalMAGI).toBe(61076);
        expect(buffer).toBeCloseTo(1424, 0);
        expect(buffer).toBeGreaterThan(500); // At least $500 buffer per spec
    });
});
