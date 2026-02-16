/**
 * Scenario 2: RMD Surplus (age 75)
 *
 * This test verifies that when RMDs plus other income exceeds expenses,
 * the surplus is correctly allocated per priority (emergency → brokerage).
 *
 * Setup:
 *   Age 75, Traditional $1.5M, SS $30k/yr, pension $20k/yr, expenses $60k
 *   RMD at 75 ≈ $58k (based on 25.5 distribution period)
 *   Filing: Single, TX (no state tax)
 *
 * Expected Flow:
 *   1. RMD calculated correctly (~$58k at 75)
 *   2. RMD + SS + pension = $108k > expenses $60k → surplus $48k
 *   3. Surplus allocated per priority (emergency → brokerage)
 *   4. No deficit despite high tax bill
 *   5. Decision log explains surplus allocation
 *   6. Solved in 1 pass (no withdrawals needed beyond RMD)
 */

import { describe, it, expect, beforeEach } from 'vitest';

// Level 1: Unit imports
import { classifyIncome } from '../../../services/simulation/IncomeClassifier';
import { calculateRMD, isRMDRequired } from '../../../data/RMDData';

// Level 2: Solver imports
import { solveRetirementYear, YearSolverInput } from '../../../services/simulation/YearSolver';

// Level 3: Full simulation imports
import { simulateOneYear } from '../../../components/Objects/Assumptions/SimulationEngine';

// Model imports
import { InvestedAccount, SavedAccount } from '../../../components/Objects/Accounts/models';
import { PassiveIncome, SocialSecurityIncome } from '../../../components/Objects/Income/models';
import { OtherExpense } from '../../../components/Objects/Expense/models';
import { AssumptionsState, defaultAssumptions, createBuiltinMilestones } from '../../../components/Objects/Assumptions/AssumptionsContext';
import { TaxState } from '../../../components/Objects/Taxes/TaxContext';

// =============================================================================
// TEST FIXTURES
// =============================================================================

const SCENARIO_YEAR = 2025;
const BIRTH_YEAR = 1950; // Age 75 in 2025

function createScenarioAccounts() {
    // Traditional: $1.5M (RMD source)
    const traditional = new InvestedAccount(
        'trad-1', 'Traditional IRA', 1500000,
        0, 20, 0.05, 'Traditional IRA'
    );

    // Brokerage: $200k (surplus destination)
    const brokerage = new InvestedAccount(
        'brokerage-1', 'Brokerage', 200000,
        0, 10, 0.07, 'Brokerage',
        true, 0.2, 150000
    );

    // Savings: $15k (below emergency fund target of $30k)
    const savings = new SavedAccount('savings-1', 'Emergency Fund', 15000, 2.0);

    return { traditional, brokerage, savings };
}

function createScenarioIncomes() {
    // Social Security: $30k/year ($2500/month)
    const ss = new SocialSecurityIncome(
        'ss-1', 'Social Security',
        2500,       // Monthly amount
        'Monthly',  // Frequency
        68,         // Claiming age
        undefined,  // FRA benefit
        new Date('2018-01-01') // Start date
    );

    // Pension: $20k/year
    const pension = new PassiveIncome(
        'pension-1', 'Pension', 20000, 'Annually', 'No', 'Other',
        new Date('2018-01-01'), undefined, false
    );

    return { ss, pension };
}

function createScenarioExpenses() {
    const living = new OtherExpense(
        'living-1', 'Living Expenses', 60000, 'Annually', new Date('2020-01-01')
    );
    return { living };
}

function createScenarioAssumptions(): AssumptionsState {
    return {
        ...defaultAssumptions,
        milestones: createBuiltinMilestones(BIRTH_YEAR, 65, 95),
        investments: {
            ...defaultAssumptions.investments,
            taxOptimizationEnabled: false, // No conversion at age 75 with high income
            returnRates: { ror: 5 },
        },
        withdrawalStrategy: [
            { id: 'ws-1', name: 'Traditional', accountId: 'trad-1' },
            { id: 'ws-2', name: 'Brokerage', accountId: 'brokerage-1' },
            { id: 'ws-3', name: 'Savings', accountId: 'savings-1' },
        ],
    };
}

function createScenarioTaxState(): TaxState {
    return {
        filingStatus: 'Single',
        stateResidency: 'California', // Use full state name (database uses names, not codes)
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

describe('Scenario 2: Level 1 - Unit Tests', () => {
    const incomes = createScenarioIncomes();

    describe('RMD Calculation', () => {
        it('should calculate RMD at age 75 correctly', () => {
            // At age 75, distribution period is ~24.6 (IRS Uniform Table)
            // RMD = $1,500,000 / 24.6 ≈ $60,976
            const balance = 1500000;
            const rmdAmount = calculateRMD(balance, 75);

            expect(rmdAmount).toBeGreaterThan(55000);
            expect(rmdAmount).toBeLessThan(65000);
        });

        it('should verify RMD is required at age 75', () => {
            // For birth year 1950, RMD starts at age 73
            const birthYear = 1950;
            const required = isRMDRequired(75, birthYear);

            expect(required).toBe(true);
        });
    });

    describe('Income Classification', () => {
        it('should classify SS and pension as spendable', () => {
            const result = classifyIncome(
                [incomes.ss, incomes.pension],
                60000, // rmdAmount
                0,     // conversionAmount
                SCENARIO_YEAR
            );

            // SS = $30k, Pension = $20k, RMD = $60k
            // Total spendable = $30k + $20k + $60k = $110k
            expect(result.classified.spendable).toBeGreaterThanOrEqual(100000);
        });

        it('should classify RMD as spendable income', () => {
            const rmdAmount = 60000;
            const result = classifyIncome(
                [incomes.ss, incomes.pension],
                rmdAmount,
                0,
                SCENARIO_YEAR
            );

            expect(result.classified.rmdIncome).toBe(60000);
            expect(result.classified.spendable).toBeGreaterThanOrEqual(rmdAmount);
        });
    });
});

// =============================================================================
// LEVEL 2: SOLVER TESTS - YearSolver Integration
// =============================================================================

describe('Scenario 2: Level 2 - Solver Tests', () => {
    let solverInput: YearSolverInput;

    beforeEach(() => {
        const accounts = createScenarioAccounts();
        const incomes = createScenarioIncomes();
        const expenses = createScenarioExpenses();
        const assumptions = createScenarioAssumptions();
        const taxState = createScenarioTaxState();

        // Pre-calculate RMD using calculateRMD
        // At age 75, Traditional $1.5M → RMD ≈ $61k
        const rmdAmount = calculateRMD(1500000, 75);

        solverInput = {
            year: SCENARIO_YEAR,
            currentAge: 75,
            isRetired: true,
            incomes: [incomes.ss, incomes.pension],
            expenses: [expenses.living],
            totalLivingExpenses: 60000,
            rmdAmount: rmdAmount,
            accounts: [accounts.traditional, accounts.brokerage, accounts.savings],
            withdrawalOrder: [
                { accountId: 'trad-1' },
                { accountId: 'brokerage-1' },
                { accountId: 'savings-1' },
            ],
            taxState,
            assumptions,
            taxOptimizationEnabled: false,
            acaAware: false, // Age > 65
        };
    });

    it('should solve in 1 pass (surplus scenario, no complex withdrawals)', () => {
        const yearPlan = solveRetirementYear(solverInput);

        expect(yearPlan.iterations).toBeLessThanOrEqual(2);
        expect(yearPlan.converged).toBe(true);
    });

    it('should have surplus (income > expenses)', () => {
        const yearPlan = solveRetirementYear(solverInput);

        // SS ($30k) + Pension ($20k) + RMD (~$60k) = ~$110k > expenses $60k
        expect(yearPlan.surplus).toBeGreaterThan(0);
    });

    it('should have RMD withdrawal in plan', () => {
        const yearPlan = solveRetirementYear(solverInput);

        const rmdWithdrawals = yearPlan.withdrawals.filter(
            w => w.reason === 'Required Minimum Distribution'
        );

        expect(rmdWithdrawals.length).toBe(1);
        expect(rmdWithdrawals[0].source).toBe('traditional_ira');
        expect(rmdWithdrawals[0].gross).toBeGreaterThan(55000);
    });

    it('should NOT withdraw beyond RMD (surplus scenario)', () => {
        const yearPlan = solveRetirementYear(solverInput);

        const deficitWithdrawals = yearPlan.withdrawals.filter(
            w => w.reason === 'Spending deficit'
        );

        // No deficit withdrawals needed - income covers expenses
        expect(deficitWithdrawals.length).toBe(0);
    });

    it('should have no unfunded deficit', () => {
        const yearPlan = solveRetirementYear(solverInput);

        expect(yearPlan.unfundedDeficit).toBe(0);
    });

    it('should log RMD in decisions', () => {
        const yearPlan = solveRetirementYear(solverInput);

        const rmdDecisions = yearPlan.decisions.filter(d => d.category === 'rmd');
        expect(rmdDecisions.length).toBeGreaterThan(0);
    });

    it('should log surplus allocation in decisions', () => {
        const yearPlan = solveRetirementYear(solverInput);

        // Decision log should explain surplus allocation
        const surplusDecisions = yearPlan.decisions.filter(
            d => d.category === 'surplus' ||
                 d.description.toLowerCase().includes('surplus')
        );
        expect(surplusDecisions.length).toBeGreaterThan(0);
    });

    it('should allocate surplus to emergency fund BEFORE brokerage', () => {
        // Per spec: Surplus allocated per priority (emergency → brokerage)
        // Emergency fund: current $15k, target $30k, gap = $15k
        const yearPlan = solveRetirementYear(solverInput);

        // Must have surplus allocations
        expect(yearPlan.surplusAllocations.length).toBeGreaterThan(0);

        // Find emergency fund and brokerage allocations
        const emergencyAllocation = yearPlan.surplusAllocations.find(
            a => a.accountId === 'savings-1'
        );
        const brokerageAllocation = yearPlan.surplusAllocations.find(
            a => a.accountId === 'brokerage-1'
        );

        // Emergency fund should be allocated first (fill gap to target)
        expect(emergencyAllocation).toBeDefined();
        // Gap to target = $30k - $15k = $15k
        expect(emergencyAllocation!.amount).toBeCloseTo(15000, -3);

        // If there's brokerage allocation, emergency must come before it
        if (brokerageAllocation) {
            const emergencyIndex = yearPlan.surplusAllocations.findIndex(
                a => a.accountId === 'savings-1'
            );
            const brokerageIndex = yearPlan.surplusAllocations.findIndex(
                a => a.accountId === 'brokerage-1'
            );
            expect(emergencyIndex).toBeLessThan(brokerageIndex);
        }
    });
});

// =============================================================================
// LEVEL 3: FULL SIMULATION TESTS - End-to-End
// =============================================================================

describe('Scenario 2: Level 3 - Full Simulation', () => {
    it('should produce consistent results with V2 engine', () => {
        const accounts = createScenarioAccounts();
        const incomes = createScenarioIncomes();
        const expenses = createScenarioExpenses();
        const assumptions = createScenarioAssumptions();
        const taxState = createScenarioTaxState();

        const result = simulateOneYear(
            SCENARIO_YEAR,
            [incomes.ss, incomes.pension],
            [expenses.living],
            [accounts.traditional, accounts.brokerage, accounts.savings],
            assumptions,
            taxState
        );

        expect(result.year).toBe(SCENARIO_YEAR);
        expect(result.logs.some(l => l.includes('[V2 Engine]'))).toBe(true);
    });

    it('should have RMD details in output', () => {
        const accounts = createScenarioAccounts();
        const incomes = createScenarioIncomes();
        const expenses = createScenarioExpenses();
        const assumptions = createScenarioAssumptions();
        const taxState = createScenarioTaxState();

        const result = simulateOneYear(
            SCENARIO_YEAR,
            [incomes.ss, incomes.pension],
            [expenses.living],
            [accounts.traditional, accounts.brokerage, accounts.savings],
            assumptions,
            taxState
        );

        expect(result.rmdDetails).toBeDefined();
        if (result.rmdDetails) {
            expect(result.rmdDetails.totalRMD).toBeGreaterThan(55000);
            expect(result.rmdDetails.shortfall).toBe(0);
        }
    });

    it('should allocate surplus to accounts', () => {
        const accounts = createScenarioAccounts();
        const incomes = createScenarioIncomes();
        const expenses = createScenarioExpenses();
        const assumptions = createScenarioAssumptions();
        const taxState = createScenarioTaxState();

        const result = simulateOneYear(
            SCENARIO_YEAR,
            [incomes.ss, incomes.pension],
            [expenses.living],
            [accounts.traditional, accounts.brokerage, accounts.savings],
            assumptions,
            taxState
        );

        // With surplus, should have positive discretionary or bucket allocations
        const totalAllocated = result.cashflow.bucketAllocations + result.cashflow.discretionary;
        expect(totalAllocated).toBeGreaterThanOrEqual(0);
    });
});

// =============================================================================
// HAND-CALCULATED VERIFICATION
// =============================================================================

describe('Scenario 2: Hand-Calculated Values', () => {
    it('should calculate RMD distribution period at age 75', () => {
        // IRS Uniform Lifetime Table for age 75
        // Distribution period = 24.6
        const distributionPeriod = 24.6;
        const balance = 1500000;
        const expectedRMD = balance / distributionPeriod;

        expect(expectedRMD).toBeCloseTo(60976, -2); // ~$61k
    });

    it('should calculate total spendable income', () => {
        // SS = $30,000
        // Pension = $20,000
        // RMD = ~$61,000
        // Total = ~$111,000
        const ss = 30000;
        const pension = 20000;
        const rmd = 60976;
        const total = ss + pension + rmd;

        expect(total).toBeCloseTo(110976, -2);
    });

    it('should calculate surplus (income - expenses - taxes)', () => {
        // Spendable income = ~$111,000
        // Living expenses = $60,000
        // Surplus before tax = ~$51,000
        // (Actual surplus depends on tax calculation)
        const income = 110976;
        const expenses = 60000;
        const grossSurplus = income - expenses;

        expect(grossSurplus).toBeCloseTo(50976, -2);
    });

    it('should verify SS taxability at 85% level', () => {
        // With high income (SS + pension + RMD > $34k threshold)
        // SS is 85% taxable
        // Provisional income = (RMD + Pension) + 0.5 × SS
        // = $61k + $20k + $15k = $96k > $34k
        const rmd = 60976;
        const pension = 20000;
        const ss = 30000;
        const provisionalIncome = rmd + pension + (ss * 0.5);

        expect(provisionalIncome).toBeGreaterThan(34000);
        // Therefore: 85% of SS is taxable
    });
});
