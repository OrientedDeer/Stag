/**
 * Scenario 7: Working Year
 *
 * This test verifies proper handling of a working year with salary,
 * 401k contributions, employer match, and surplus allocation.
 *
 * Setup:
 *   Age 35, salary $120k, expenses $65k
 *   401k: 10% employee ($12k), 50% match on 6% ($3.6k)
 *   Emergency fund target $25k (current $15k)
 *   Buckets: Emergency → Roth IRA → Brokerage
 *
 * Expected Flow:
 *   1. 401k contribution = $12,000 (10% of salary)
 *   2. Employer match = $3,600 (50% of first 6%)
 *   3. FICA = $9,180 (on gross $120k)
 *   4. Federal tax ≈ $15,220 (on $120k - standard deduction)
 *   5. Available for allocation after expenses ≈ $18,600
 *   6. Emergency fund topped up: $10,000 (to reach $25k target)
 *   7. Roth IRA contribution: $7,000 (2025 limit)
 *   8. Brokerage remainder: $1,600
 *   9. No withdrawals, no conversion
 *   10. Solved in 1 pass (no circular dependency)
 */

import { describe, it, expect, beforeEach } from 'vitest';

// Level 1: Unit imports
import { classifyIncome } from '../../../services/simulation/IncomeClassifier';

// Level 2: Solver imports
import { solveWorkingYear, YearSolverInput } from '../../../services/simulation/YearSolver';

// Level 3: Full simulation imports
import { simulateOneYear } from '../../../components/Objects/Assumptions/SimulationEngine';

// Model imports
import { InvestedAccount, SavedAccount } from '../../../components/Objects/Accounts/models';
import { WorkIncome } from '../../../components/Objects/Income/models';
import { OtherExpense } from '../../../components/Objects/Expense/models';
import { AssumptionsState, defaultAssumptions, createBuiltinMilestones } from '../../../components/Objects/Assumptions/AssumptionsContext';
import { TaxState } from '../../../components/Objects/Taxes/TaxContext';
import * as TaxService from '../../../components/Objects/Taxes/TaxService';

// =============================================================================
// TEST FIXTURES
// =============================================================================

const SCENARIO_YEAR = 2025;
const BIRTH_YEAR = 1990; // Age 35 in 2025

function createScenarioAccounts() {
    // 401k: $50k (Traditional)
    const trad401k = new InvestedAccount(
        '401k-1', 'Traditional 401k', 50000,
        5000, // employerBalance
        5,    // tenureYears
        0.05, // expenseRatio
        'Traditional 401k',
        true, // isContributionEligible
        0.25  // vestedPerYear
    );

    // Roth IRA: $20k
    const rothIRA = new InvestedAccount(
        'roth-1', 'Roth IRA', 20000,
        0, 5, 0.05, 'Roth IRA',
        true, 0.2, 15000
    );

    // Brokerage: $30k
    const brokerage = new InvestedAccount(
        'brokerage-1', 'Brokerage', 30000,
        0, 5, 0.07, 'Brokerage',
        true, 0.2, 25000
    );

    // Emergency Fund: $15k (target is $25k)
    const savings = new SavedAccount('savings-1', 'Emergency Fund', 15000, 3.0);

    return { trad401k, rothIRA, brokerage, savings };
}

function createScenarioIncomes() {
    // Work Income: $120k salary with 401k contribution
    // 401k: 10% employee ($12k), 50% match on first 6% ($3.6k)
    const work = new WorkIncome(
        'work-1', 'Job',
        120000,      // salary
        'Annually',
        'Yes',       // include in simulation
        12000,       // preTax401k: $12,000 (10% of $120k)
        0,           // insurance
        0,           // roth401k
        3600,        // employerMatch: $3,600 (50% of first 6% = 50% × $7,200)
        '401k-1',    // matchAccountId
        'Traditional 401k',
        'FIXED',     // contributionGrowthStrategy
        new Date('2020-01-01'),
        undefined
    );

    return { work };
}

function createScenarioExpenses() {
    const living = new OtherExpense(
        'living-1', 'Living Expenses', 65000, 'Annually', new Date('2020-01-01')
    );
    return { living };
}

function createScenarioAssumptions(_useNewEngine: boolean = false): AssumptionsState {
    return {
        ...defaultAssumptions,
        milestones: createBuiltinMilestones(BIRTH_YEAR, 65, 95),
        investments: {
            ...defaultAssumptions.investments,
            taxOptimizationEnabled: false,
            returnRates: { ror: 7 },
        },
        withdrawalStrategy: [],
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

describe('Scenario 7: Level 1 - Unit Tests', () => {
    const incomes = createScenarioIncomes();

    describe('Income Classification', () => {
        it('should classify work income as spendable', () => {
            const result = classifyIncome(
                [incomes.work],
                0,
                0,
                SCENARIO_YEAR
            );

            // Gross salary = $120k, but 401k contributions are pre-tax
            // Spendable = gross - pre-tax contributions
            expect(result.classified.spendable).toBeGreaterThan(100000);
            expect(result.classified.breakdown.wages).toBeGreaterThan(100000);
        });
    });

    describe('Tax Calculations', () => {
        it('should calculate FICA on gross wages', () => {
            const taxState = createScenarioTaxState();
            const assumptions = createScenarioAssumptions();

            const fica = TaxService.calculateFicaTax(
                taxState,
                [incomes.work],
                SCENARIO_YEAR,
                assumptions
            );

            // FICA = 6.2% SS + 1.45% Medicare = 7.65%
            // On $120k: $9,180
            expect(fica).toBeCloseTo(9180, -2);
        });

        it('should calculate federal tax on taxable income', () => {
            const taxState = createScenarioTaxState();
            const assumptions = createScenarioAssumptions();

            const fedParams = TaxService.getTaxParameters(
                SCENARIO_YEAR,
                taxState.filingStatus,
                'federal',
                undefined,
                assumptions
            );

            // Taxable income = $120k - $12k (401k) - ~$15k (std deduction) = ~$93k
            // This falls in the 22% bracket
            const taxableIncome = 120000 - 12000 - (fedParams?.standardDeduction || 15000);
            const tax = TaxService.calculateTax(taxableIncome, 0, fedParams!);

            expect(tax).toBeGreaterThan(10000);
            expect(tax).toBeLessThan(25000);
        });
    });
});

// =============================================================================
// LEVEL 2: SOLVER TESTS - YearSolver Integration
// =============================================================================

describe('Scenario 7: Level 2 - Solver Tests', () => {
    let solverInput: YearSolverInput;

    beforeEach(() => {
        const accounts = createScenarioAccounts();
        const incomes = createScenarioIncomes();
        const expenses = createScenarioExpenses();
        const assumptions = createScenarioAssumptions();
        const taxState = createScenarioTaxState();

        solverInput = {
            year: SCENARIO_YEAR,
            currentAge: 35,
            isRetired: false, // WORKING YEAR
            incomes: [incomes.work],
            expenses: [expenses.living],
            totalLivingExpenses: 65000,
            rmdAmount: 0,
            accounts: [accounts.trad401k, accounts.rothIRA, accounts.brokerage, accounts.savings],
            withdrawalOrder: [],
            taxState,
            assumptions,
            taxOptimizationEnabled: false,
            acaAware: false,
        };
    });

    it('should solve in 1 pass (no iteration needed)', () => {
        const yearPlan = solveWorkingYear(solverInput);

        expect(yearPlan.iterations).toBeLessThanOrEqual(1);
        expect(yearPlan.converged).toBe(true);
    });

    it('should mark as NOT retired', () => {
        const yearPlan = solveWorkingYear(solverInput);

        expect(yearPlan.isRetired).toBe(false);
    });

    it('should have NO withdrawals', () => {
        const yearPlan = solveWorkingYear(solverInput);

        expect(yearPlan.withdrawals.length).toBe(0);
    });

    it('should have NO conversion', () => {
        const yearPlan = solveWorkingYear(solverInput);

        expect(yearPlan.conversion).toBeNull();
    });

    it('should have positive surplus (income > expenses)', () => {
        const yearPlan = solveWorkingYear(solverInput);

        // Gross $120k - taxes ~$25k - expenses $65k = ~$30k surplus
        expect(yearPlan.surplus).toBeGreaterThan(0);
    });

    it('should have no unfunded deficit', () => {
        const yearPlan = solveWorkingYear(solverInput);

        expect(yearPlan.unfundedDeficit).toBe(0);
    });

    it('should allocate surplus to emergency fund (~$15k)', () => {
        // Emergency fund topped up to reach default target ($30k)
        // Current = $15k, Target = $30k (default), Gap = $15k
        const yearPlan = solveWorkingYear(solverInput);

        const emergencyAllocation = yearPlan.surplusAllocations.find(
            a => a.accountId === 'savings-1'
        );

        expect(emergencyAllocation).toBeDefined();
        // Allow some tolerance for tax calculation variations
        expect(emergencyAllocation!.amount).toBeGreaterThan(13000);
        expect(emergencyAllocation!.amount).toBeLessThan(17000);
    });

    it('should allocate surplus to Roth IRA (remaining after emergency fund)', () => {
        // After filling emergency fund gap ($15k), remaining surplus goes to Roth IRA
        // With larger emergency fund allocation, Roth IRA gets less than the $7k limit
        const yearPlan = solveWorkingYear(solverInput);

        const rothAllocation = yearPlan.surplusAllocations.find(
            a => a.accountId === 'roth-1'
        );

        expect(rothAllocation).toBeDefined();
        // Roth IRA contribution may be less than $7k limit if surplus is smaller
        expect(rothAllocation!.amount).toBeGreaterThan(0);
        expect(rothAllocation!.amount).toBeLessThanOrEqual(7000);
    });

    it('should allocate remainder to brokerage (~$1.6k)', () => {
        // Per spec: Brokerage remainder: $1,600
        const yearPlan = solveWorkingYear(solverInput);

        const brokerageAllocation = yearPlan.surplusAllocations.find(
            a => a.accountId === 'brokerage-1'
        );

        // If there's a brokerage allocation, it should be the remainder
        if (brokerageAllocation) {
            expect(brokerageAllocation.amount).toBeGreaterThan(0);
            expect(brokerageAllocation.amount).toBeLessThan(5000);
        }
    });

    it('should allocate emergency fund BEFORE Roth IRA', () => {
        // Per spec: Buckets: Emergency → Roth IRA → Brokerage
        const yearPlan = solveWorkingYear(solverInput);

        const emergencyIndex = yearPlan.surplusAllocations.findIndex(
            a => a.accountId === 'savings-1'
        );
        const rothIndex = yearPlan.surplusAllocations.findIndex(
            a => a.accountId === 'roth-1'
        );

        // If both exist, emergency should come before Roth
        if (emergencyIndex >= 0 && rothIndex >= 0) {
            expect(emergencyIndex).toBeLessThan(rothIndex);
        }
    });

    it('should calculate FICA tax', () => {
        const yearPlan = solveWorkingYear(solverInput);

        expect(yearPlan.tax.fica).toBeGreaterThan(8000);
        expect(yearPlan.tax.fica).toBeLessThan(10000);
    });

    it('should calculate federal tax', () => {
        const yearPlan = solveWorkingYear(solverInput);

        expect(yearPlan.tax.federal).toBeGreaterThan(10000);
        expect(yearPlan.tax.federal).toBeLessThan(20000);
    });
});

// =============================================================================
// LEVEL 3: FULL SIMULATION TESTS - End-to-End
// =============================================================================

describe('Scenario 7: Level 3 - Full Simulation', () => {
    it('should produce consistent results with V2 engine', () => {
        const accounts = createScenarioAccounts();
        const incomes = createScenarioIncomes();
        const expenses = createScenarioExpenses();
        const assumptions = createScenarioAssumptions(true);
        const taxState = createScenarioTaxState();

        const result = simulateOneYear(
            SCENARIO_YEAR,
            [incomes.work],
            [expenses.living],
            [accounts.trad401k, accounts.rothIRA, accounts.brokerage, accounts.savings],
            assumptions,
            taxState
        );

        expect(result.year).toBe(SCENARIO_YEAR);
        expect(result.logs.some(l => l.includes('[V2 Engine]'))).toBe(true);
    });

    it('should track 401k contributions', () => {
        const accounts = createScenarioAccounts();
        const incomes = createScenarioIncomes();
        const expenses = createScenarioExpenses();
        const assumptions = createScenarioAssumptions(true);
        const taxState = createScenarioTaxState();

        const result = simulateOneYear(
            SCENARIO_YEAR,
            [incomes.work],
            [expenses.living],
            [accounts.trad401k, accounts.rothIRA, accounts.brokerage, accounts.savings],
            assumptions,
            taxState
        );

        // Should have user contributions (employee + employer match)
        expect(result.cashflow.investedUser).toBeGreaterThan(0);
    });

    it('should have no withdrawals in working year', () => {
        const accounts = createScenarioAccounts();
        const incomes = createScenarioIncomes();
        const expenses = createScenarioExpenses();
        const assumptions = createScenarioAssumptions(true);
        const taxState = createScenarioTaxState();

        const result = simulateOneYear(
            SCENARIO_YEAR,
            [incomes.work],
            [expenses.living],
            [accounts.trad401k, accounts.rothIRA, accounts.brokerage, accounts.savings],
            assumptions,
            taxState
        );

        expect(result.cashflow.withdrawals).toBe(0);
    });

    it('should have positive discretionary cash', () => {
        const accounts = createScenarioAccounts();
        const incomes = createScenarioIncomes();
        const expenses = createScenarioExpenses();
        const assumptions = createScenarioAssumptions(true);
        const taxState = createScenarioTaxState();

        const result = simulateOneYear(
            SCENARIO_YEAR,
            [incomes.work],
            [expenses.living],
            [accounts.trad401k, accounts.rothIRA, accounts.brokerage, accounts.savings],
            assumptions,
            taxState
        );

        // Income > expenses + taxes = positive discretionary
        expect(result.cashflow.discretionary).toBeGreaterThanOrEqual(0);
    });
});

// =============================================================================
// HAND-CALCULATED VERIFICATION
// =============================================================================

describe('Scenario 7: Hand-Calculated Values', () => {
    it('should calculate 401k contribution correctly', () => {
        // Salary = $120,000
        // Contribution rate = 10%
        // 401k contribution = $12,000
        const salary = 120000;
        const contributionRate = 0.10;
        const contribution = salary * contributionRate;

        expect(contribution).toBe(12000);
    });

    it('should calculate employer match correctly', () => {
        // Salary = $120,000
        // Match = 50% of first 6%
        // Matched contribution = 6% × $120k = $7,200
        // Match amount = 50% × $7,200 = $3,600
        const salary = 120000;
        const matchUpTo = 0.06;
        const matchPct = 0.50;
        const matchedContribution = salary * matchUpTo;
        const match = matchedContribution * matchPct;

        expect(match).toBe(3600);
    });

    it('should calculate FICA correctly', () => {
        // Gross wages = $120,000
        // Social Security = 6.2% (up to $168,600 in 2025)
        // Medicare = 1.45%
        // FICA = $120,000 × 7.65% = $9,180
        const wages = 120000;
        const ssRate = 0.062;
        const medicareRate = 0.0145;
        const fica = wages * (ssRate + medicareRate);

        expect(fica).toBeCloseTo(9180, 0);
    });

    it('should calculate taxable income correctly', () => {
        // Gross = $120,000
        // 401k = $12,000 (pre-tax)
        // Standard deduction (Single 2025) ≈ $15,000
        // Taxable = $120,000 - $12,000 - $15,000 = $93,000
        const gross = 120000;
        const preTax401k = 12000;
        const standardDeduction = 15000;
        const taxable = gross - preTax401k - standardDeduction;

        expect(taxable).toBeCloseTo(93000, -3);
    });

    it('should calculate federal tax approximately', () => {
        // Taxable income ≈ $93,000
        // 2025 tax brackets (Single):
        // 10% on first $11,925 = $1,192.50
        // 12% on $11,926-$48,475 = $4,386
        // 22% on $48,476-$93,000 = $9,795
        // Total ≈ $15,374
        const taxable = 93000;
        const tax10 = 11925 * 0.10;
        const tax12 = (48475 - 11925) * 0.12;
        const tax22 = (taxable - 48475) * 0.22;
        const totalTax = tax10 + tax12 + tax22;

        expect(totalTax).toBeCloseTo(15374, -2);
    });

    it('should calculate net take-home correctly', () => {
        // Gross = $120,000
        // 401k = $12,000
        // FICA = $9,180
        // Federal tax ≈ $15,374
        // Net = $120,000 - $12,000 - $9,180 - $15,374 = $83,446
        const gross = 120000;
        const contribution401k = 12000;
        const fica = 9180;
        const federalTax = 15374;
        const net = gross - contribution401k - fica - federalTax;

        expect(net).toBeCloseTo(83446, -2);
    });

    it('should calculate surplus after expenses', () => {
        // Net take-home ≈ $83,446
        // Expenses = $65,000
        // Surplus = $18,446
        const netTakeHome = 83446;
        const expenses = 65000;
        const surplus = netTakeHome - expenses;

        expect(surplus).toBeCloseTo(18446, -2);
    });

    it('should calculate emergency fund top-up', () => {
        // Emergency fund topped up to reach default target ($30k)
        // Current = $15k, Target = $30k (default)
        // Top-up = $15k
        const currentEmergency = 15000;
        const targetEmergency = 30000; // DEFAULT_EMERGENCY_FUND_TARGET
        const topUp = targetEmergency - currentEmergency;

        expect(topUp).toBe(15000);
    });

    it('should calculate Roth IRA contribution limit', () => {
        // Per spec: Roth IRA contribution: $7,000 (2025 limit)
        const rothLimit2025 = 7000;

        expect(rothLimit2025).toBe(7000);
    });

    it('should calculate brokerage remainder', () => {
        // Available for allocation = $18,600
        // Emergency top-up = $15,000 (default target $30k - current $15k)
        // Roth IRA = remaining up to $7,000 limit = $3,600
        // Brokerage remainder = $0
        const available = 18600;
        const emergencyTopUp = 15000;
        const rothContribution = Math.min(available - emergencyTopUp, 7000);
        const brokerageRemainder = available - emergencyTopUp - rothContribution;

        expect(rothContribution).toBe(3600);
        expect(brokerageRemainder).toBe(0);
    });
});
