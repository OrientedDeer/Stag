/**
 * Unit tests for spending strategy functions.
 *
 * These functions control lifestyle creep, withdrawal targets,
 * and spending cap enforcement during retirement.
 */
import { describe, it, expect } from 'vitest';
import {
    applyLifestyleCreep,
    applyProsperitySpending,
    calculateStrategyTarget,
    calculateTotalDiscretionary,
    enforceSpendingCap,
} from '../../../services/simulation/SpendingStrategy';
import { AnyExpense, FoodExpense, VacationExpense, MortgageExpense, LoanExpense } from '../../../components/Objects/Expense/models';
import { WorkIncome } from '../../../components/Objects/Income/models';
import { AnyAccount, InvestedAccount, SavedAccount, ESPPAccount } from '../../../components/Objects/Accounts/models';
import { AssumptionsState, createBuiltinMilestones, defaultAssumptions } from '../../../components/Objects/Assumptions/AssumptionsContext';
import { WithdrawalResult, GuardrailTrigger } from '../../../services/WithdrawalStrategies';
import { SimulationYear } from '../../../services/simulation/types';

// Helper to create test assumptions
function createTestAssumptions(overrides: Partial<{
    salaryGrowth: number;
    lifestyleCreep: number;
    withdrawalStrategy: 'None' | 'Needs Based' | 'Fixed Real' | 'Percentage' | 'Guyton Klinger';
    withdrawalRate: number;
    inflationRate: number;
    gkUpperGuardrail: number;
    gkLowerGuardrail: number;
    gkAdjustmentPercent: number;
    birthYear: number;
    retirementAge: number;
    lifeExpectancy: number;
}> = {}): AssumptionsState {
    const birthYear = overrides.birthYear ?? 1990;
    const retirementAge = overrides.retirementAge ?? 65;
    const lifeExpectancy = overrides.lifeExpectancy ?? 90;

    return {
        ...defaultAssumptions,
        income: {
            ...defaultAssumptions.income,
            salaryGrowth: overrides.salaryGrowth ?? 3.0,
        },
        expenses: {
            ...defaultAssumptions.expenses,
            lifestyleCreep: overrides.lifestyleCreep ?? 50.0,
        },
        macro: {
            ...defaultAssumptions.macro,
            inflationRate: overrides.inflationRate ?? 3.0,
        },
        investments: {
            ...defaultAssumptions.investments,
            withdrawalStrategy: overrides.withdrawalStrategy ?? 'Guyton Klinger',
            withdrawalRate: overrides.withdrawalRate ?? 4.0,
            gkUpperGuardrail: overrides.gkUpperGuardrail ?? 1.2,
            gkLowerGuardrail: overrides.gkLowerGuardrail ?? 0.8,
            gkAdjustmentPercent: overrides.gkAdjustmentPercent ?? 10,
        },
        milestones: createBuiltinMilestones(birthYear, retirementAge, lifeExpectancy),
    };
}

// Helper to create a discretionary expense (with startDate in the past so it's active)
function createDiscretionaryExpense(id: string, name: string, amount: number): AnyExpense {
    const expense = new VacationExpense(id, name, amount, 'Annually', new Date('2020-01-01'));
    expense.isDiscretionary = true;
    return expense;
}

// Helper to create a non-discretionary expense (with startDate in the past so it's active)
function createFixedExpense(id: string, name: string, amount: number): AnyExpense {
    const expense = new FoodExpense(id, name, amount, 'Annually', new Date('2020-01-01'));
    expense.isDiscretionary = false;
    return expense;
}

// Helper to create WorkIncome
function createWorkIncome(id: string, amount: number): WorkIncome {
    return new WorkIncome(
        id, 'Test Job', amount, 'Annually', 'Yes',
        0, 0, 0, 0, '', null, 'FIXED'
    );
}

// Helper to create a withdrawal result
function createWithdrawalResult(
    amount: number,
    guardrailTriggered: GuardrailTrigger = 'none'
): WithdrawalResult {
    return {
        amount,
        baseAmount: amount,
        initialPortfolio: 1000000,
        guardrailTriggered,
        targetWithdrawalRate: 0.04,
        currentWithdrawalRate: amount / 1000000,
    };
}

describe('SpendingStrategy', () => {
    describe('applyLifestyleCreep', () => {
        describe('skip conditions', () => {
            it('should return unchanged expenses when retired', () => {
                const expenses = [createDiscretionaryExpense('1', 'Vacation', 5000)];
                const incomes = [createWorkIncome('w1', 100000)];
                const assumptions = createTestAssumptions({ lifestyleCreep: 50 });
                const logs: string[] = [];

                const result = applyLifestyleCreep(
                    expenses,
                    incomes,
                    assumptions,
                    2025,
                    true, // retired
                    logs
                );

                expect(result).toBe(expenses); // Same reference, unchanged
                expect(logs).toHaveLength(0);
            });

            it('should return unchanged expenses when lifestyleCreep is 0', () => {
                const expenses = [createDiscretionaryExpense('1', 'Vacation', 5000)];
                const incomes = [createWorkIncome('w1', 100000)];
                const assumptions = createTestAssumptions({ lifestyleCreep: 0 });
                const logs: string[] = [];

                const result = applyLifestyleCreep(
                    expenses,
                    incomes,
                    assumptions,
                    2025,
                    false,
                    logs
                );

                expect(result).toBe(expenses);
            });

            it('should return unchanged expenses when lifestyleCreep is negative', () => {
                const expenses = [createDiscretionaryExpense('1', 'Vacation', 5000)];
                const incomes = [createWorkIncome('w1', 100000)];
                const assumptions = createTestAssumptions({ lifestyleCreep: -10 });
                const logs: string[] = [];

                const result = applyLifestyleCreep(
                    expenses,
                    incomes,
                    assumptions,
                    2025,
                    false,
                    logs
                );

                expect(result).toBe(expenses);
            });

            it('should return unchanged expenses when no salary raise', () => {
                const expenses = [createDiscretionaryExpense('1', 'Vacation', 5000)];
                const incomes = [createWorkIncome('w1', 100000)];
                const assumptions = createTestAssumptions({ salaryGrowth: 0 });
                const logs: string[] = [];

                const result = applyLifestyleCreep(
                    expenses,
                    incomes,
                    assumptions,
                    2025,
                    false,
                    logs
                );

                expect(result).toBe(expenses);
            });
        });

        describe('basic lifestyle creep calculation', () => {
            it('should calculate total raise from WorkIncome', () => {
                const expenses = [createDiscretionaryExpense('1', 'Vacation', 5000)];
                const incomes = [createWorkIncome('w1', 100000)]; // $100k salary
                const assumptions = createTestAssumptions({
                    salaryGrowth: 3, // 3% raise
                    lifestyleCreep: 100, // 100% of raise goes to expenses
                });
                const logs: string[] = [];

                const result = applyLifestyleCreep(
                    expenses,
                    incomes,
                    assumptions,
                    2025,
                    false,
                    logs
                );

                // $100k * 3% = $3k raise, 100% creep = $3k added to discretionary
                // $5k vacation becomes $5k + $3k = $8k
                expect(result[0].getAnnualAmount()).toBeCloseTo(8000, 0);
            });

            it('should apply lifestyleCreep percentage to raise', () => {
                const expenses = [createDiscretionaryExpense('1', 'Vacation', 5000)];
                const incomes = [createWorkIncome('w1', 100000)];
                const assumptions = createTestAssumptions({
                    salaryGrowth: 3, // 3% = $3k raise
                    lifestyleCreep: 50, // 50% of raise
                });
                const logs: string[] = [];

                const result = applyLifestyleCreep(
                    expenses,
                    incomes,
                    assumptions,
                    2025,
                    false,
                    logs
                );

                // $3k raise * 50% = $1.5k creep
                // $5k + $1.5k = $6.5k
                expect(result[0].getAnnualAmount()).toBeCloseTo(6500, 0);
            });

            it('should increase only discretionary expenses', () => {
                const discretionary = createDiscretionaryExpense('1', 'Vacation', 5000);
                const fixed = createFixedExpense('2', 'Food', 10000);
                const expenses = [discretionary, fixed];
                const incomes = [createWorkIncome('w1', 100000)];
                const assumptions = createTestAssumptions({
                    salaryGrowth: 3,
                    lifestyleCreep: 100,
                });
                const logs: string[] = [];

                const result = applyLifestyleCreep(
                    expenses,
                    incomes,
                    assumptions,
                    2025,
                    false,
                    logs
                );

                // Only discretionary expense should increase
                const resultDiscretionary = result.find(e => e.id === '1')!;
                const resultFixed = result.find(e => e.id === '2')!;

                expect(resultDiscretionary.getAnnualAmount()).toBeGreaterThan(5000);
                expect(resultFixed.getAnnualAmount()).toBe(10000); // Unchanged
            });

            it('should not modify non-discretionary expenses', () => {
                const fixed = createFixedExpense('1', 'Rent', 24000);
                const expenses = [fixed];
                const incomes = [createWorkIncome('w1', 100000)];
                const assumptions = createTestAssumptions({
                    salaryGrowth: 5,
                    lifestyleCreep: 100,
                });
                const logs: string[] = [];

                const result = applyLifestyleCreep(
                    expenses,
                    incomes,
                    assumptions,
                    2025,
                    false,
                    logs
                );

                // No discretionary expenses to increase, should return unchanged
                expect(result).toBe(expenses);
            });
        });

        describe('proportional distribution', () => {
            it('should distribute creep proportionally across discretionary expenses', () => {
                // Two discretionary expenses: $2k and $8k (20% and 80% of total)
                const small = createDiscretionaryExpense('1', 'Subscriptions', 2000);
                const large = createDiscretionaryExpense('2', 'Vacation', 8000);
                const expenses = [small, large];
                const incomes = [createWorkIncome('w1', 100000)];
                const assumptions = createTestAssumptions({
                    salaryGrowth: 10, // $10k raise
                    lifestyleCreep: 50, // $5k creep
                });
                const logs: string[] = [];

                const result = applyLifestyleCreep(
                    expenses,
                    incomes,
                    assumptions,
                    2025,
                    false,
                    logs
                );

                // $5k creep distributed proportionally:
                // Small: $2k + ($5k * 20%) = $2k + $1k = $3k
                // Large: $8k + ($5k * 80%) = $8k + $4k = $12k
                const resultSmall = result.find(e => e.id === '1')!;
                const resultLarge = result.find(e => e.id === '2')!;

                expect(resultSmall.getAnnualAmount()).toBeCloseTo(3000, 0);
                expect(resultLarge.getAnnualAmount()).toBeCloseTo(12000, 0);
            });

            it('should handle single discretionary expense', () => {
                const expenses = [createDiscretionaryExpense('1', 'Vacation', 5000)];
                const incomes = [createWorkIncome('w1', 100000)];
                const assumptions = createTestAssumptions({
                    salaryGrowth: 5,
                    lifestyleCreep: 100,
                });
                const logs: string[] = [];

                const result = applyLifestyleCreep(
                    expenses,
                    incomes,
                    assumptions,
                    2025,
                    false,
                    logs
                );

                // All $5k creep goes to single expense
                expect(result[0].getAnnualAmount()).toBeCloseTo(10000, 0);
            });

            it('should handle multiple discretionary expenses', () => {
                const e1 = createDiscretionaryExpense('1', 'Vacation', 3000);
                const e2 = createDiscretionaryExpense('2', 'Entertainment', 3000);
                const e3 = createDiscretionaryExpense('3', 'Hobbies', 4000);
                const expenses = [e1, e2, e3]; // Total: $10k
                const incomes = [createWorkIncome('w1', 100000)];
                const assumptions = createTestAssumptions({
                    salaryGrowth: 10, // $10k raise
                    lifestyleCreep: 50, // $5k creep
                });
                const logs: string[] = [];

                const result = applyLifestyleCreep(
                    expenses,
                    incomes,
                    assumptions,
                    2025,
                    false,
                    logs
                );

                // Total after creep should be $15k
                const total = result.reduce((sum, e) => sum + e.getAnnualAmount(), 0);
                expect(total).toBeCloseTo(15000, 0);
            });
        });

        describe('edge cases', () => {
            it('should handle zero total discretionary expenses', () => {
                const expenses = [createFixedExpense('1', 'Rent', 24000)];
                const incomes = [createWorkIncome('w1', 100000)];
                const assumptions = createTestAssumptions({
                    salaryGrowth: 5,
                    lifestyleCreep: 100,
                });
                const logs: string[] = [];

                const result = applyLifestyleCreep(
                    expenses,
                    incomes,
                    assumptions,
                    2025,
                    false,
                    logs
                );

                // No discretionary to distribute to
                expect(result).toBe(expenses);
            });

            it('should handle multiple WorkIncomes with different raises', () => {
                const expenses = [createDiscretionaryExpense('1', 'Vacation', 10000)];
                const incomes = [
                    createWorkIncome('w1', 100000), // $3k raise at 3%
                    createWorkIncome('w2', 50000),  // $1.5k raise at 3%
                ];
                const assumptions = createTestAssumptions({
                    salaryGrowth: 3,
                    lifestyleCreep: 100,
                });
                const logs: string[] = [];

                const result = applyLifestyleCreep(
                    expenses,
                    incomes,
                    assumptions,
                    2025,
                    false,
                    logs
                );

                // Total raise: $4.5k, 100% creep = $4.5k added
                expect(result[0].getAnnualAmount()).toBeCloseTo(14500, 0);
            });

            it('should log the lifestyle creep application', () => {
                const expenses = [createDiscretionaryExpense('1', 'Vacation', 5000)];
                const incomes = [createWorkIncome('w1', 100000)];
                const assumptions = createTestAssumptions({
                    salaryGrowth: 3,
                    lifestyleCreep: 50,
                });
                const logs: string[] = [];

                applyLifestyleCreep(
                    expenses,
                    incomes,
                    assumptions,
                    2025,
                    false,
                    logs
                );

                expect(logs).toHaveLength(1);
                expect(logs[0]).toContain('Lifestyle creep');
                expect(logs[0]).toContain('50%');
            });
        });
    });

    describe('calculateStrategyTarget (Guyton Klinger)', () => {
        describe('basic Guyton-Klinger calculation', () => {
            it('should calculate withdrawal target based on portfolio', () => {
                const accounts: AnyAccount[] = [
                    new InvestedAccount('inv1', 'Brokerage', 1000000, 0, 0, 0.1, 'Brokerage'),
                ];
                const assumptions = createTestAssumptions({
                    withdrawalRate: 4,
                    birthYear: 1960,
                    retirementAge: 65,
                });
                const logs: string[] = [];

                const result = calculateStrategyTarget(
                    accounts,
                    assumptions,
                    [], // No previous simulation
                    2025, // Year
                    65, // Current age (first year of retirement)
                    logs
                );

                expect(result).toBeDefined();
                expect(result!.amount).toBeGreaterThan(0);
                // First year should be close to withdrawal rate * portfolio
                expect(result!.amount).toBeCloseTo(40000, -2); // ~$40k at 4%
            });

            it('should use withdrawal rate from assumptions', () => {
                const accounts: AnyAccount[] = [
                    new InvestedAccount('inv1', 'Brokerage', 1000000, 0, 0, 0.1, 'Brokerage'),
                ];
                const assumptions3pct = createTestAssumptions({ withdrawalRate: 3 });
                const assumptions5pct = createTestAssumptions({ withdrawalRate: 5 });
                const logs: string[] = [];

                const result3 = calculateStrategyTarget(accounts, assumptions3pct, [], 2025, 65, logs);
                const result5 = calculateStrategyTarget(accounts, assumptions5pct, [], 2025, 65, []);

                expect(result3!.amount).toBeLessThan(result5!.amount);
            });

            it('should track years in retirement', () => {
                const accounts: AnyAccount[] = [
                    new InvestedAccount('inv1', 'Brokerage', 1000000, 0, 0, 0.1, 'Brokerage'),
                ];
                const assumptions = createTestAssumptions({
                    birthYear: 1960,
                    retirementAge: 65,
                });
                const logs: string[] = [];

                // First year of retirement (2025 - (1960 + 65) = 0)
                const result = calculateStrategyTarget(accounts, assumptions, [], 2025, 65, logs);

                expect(result).toBeDefined();
                expect(logs.some(l => l.includes('Guyton Klinger'))).toBe(true);
            });
        });

        describe('portfolio calculation', () => {
            it('should sum InvestedAccount balances', () => {
                const accounts: AnyAccount[] = [
                    new InvestedAccount('inv1', '401k', 500000, 0, 0, 0.1, 'Traditional 401k'),
                    new InvestedAccount('inv2', 'IRA', 300000, 0, 0, 0.1, 'Traditional IRA'),
                ];
                const assumptions = createTestAssumptions({
                    withdrawalRate: 4,
                    birthYear: 1960,
                    retirementAge: 65,
                });
                const logs: string[] = [];

                const result = calculateStrategyTarget(accounts, assumptions, [], 2025, 65, logs);

                // $800k portfolio at 4% = $32k (with some inflation adjustment possible)
                expect(result!.amount).toBeGreaterThan(30000);
                expect(result!.amount).toBeLessThan(35000);
            });

            it('should sum SavedAccount balances', () => {
                const accounts: AnyAccount[] = [
                    new SavedAccount('sav1', 'Emergency Fund', 100000, 4),
                ];
                const assumptions = createTestAssumptions({
                    withdrawalRate: 4,
                    birthYear: 1960,
                    retirementAge: 65,
                });
                const logs: string[] = [];

                const result = calculateStrategyTarget(accounts, assumptions, [], 2025, 65, logs);

                // $100k at 4% = $4k (with some adjustment possible)
                expect(result!.amount).toBeGreaterThan(3500);
                expect(result!.amount).toBeLessThan(4500);
            });

            it('should sum ESPPAccount balances', () => {
                const accounts: AnyAccount[] = [
                    new ESPPAccount('espp1', 'Company ESPP', 200000),
                ];
                const assumptions = createTestAssumptions({
                    withdrawalRate: 4,
                    birthYear: 1960,
                    retirementAge: 65,
                });
                const logs: string[] = [];

                const result = calculateStrategyTarget(accounts, assumptions, [], 2025, 65, logs);

                // $200k at 4% = $8k (with some adjustment possible)
                expect(result!.amount).toBeGreaterThan(7000);
                expect(result!.amount).toBeLessThan(9000);
            });
        });

        describe('previous withdrawal tracking', () => {
            it('should use previous strategy result for adjustments', () => {
                const accounts: AnyAccount[] = [
                    new InvestedAccount('inv1', 'Brokerage', 1000000, 0, 0, 0.1, 'Brokerage'),
                ];
                const assumptions = createTestAssumptions({ withdrawalRate: 4 });

                const previousSimulation: SimulationYear[] = [{
                    year: 2024,
                    incomes: [],
                    expenses: [],
                    accounts: accounts,
                    cashflow: {
                        totalIncome: 0,
                        totalExpense: 40000,
                        livingExpenses: 40000,
                        discretionary: 0,
                        investedUser: 0,
                        investedMatch: 0,
                        totalInvested: 0,
                        bucketAllocations: 0,
                        bucketDetail: {},
                        withdrawals: 0,
                        withdrawalDetail: {},
                    },
                    taxDetails: { fed: 0, state: 0, fica: 0, preTax: 0, insurance: 0, postTax: 0, capitalGains: 0, withdrawalOrdinaryTax: 0, niit: 0 },
                    logs: [],
                    strategyWithdrawal: createWithdrawalResult(40000),
                }];

                const logs: string[] = [];

                const result = calculateStrategyTarget(accounts, assumptions, previousSimulation, 2025, 65, logs);

                expect(result).toBeDefined();
            });

            it('should handle empty previous simulation', () => {
                const accounts: AnyAccount[] = [
                    new InvestedAccount('inv1', 'Brokerage', 1000000, 0, 0, 0.1, 'Brokerage'),
                ];
                const assumptions = createTestAssumptions({ withdrawalRate: 4 });
                const logs: string[] = [];

                const result = calculateStrategyTarget(accounts, assumptions, [], 2025, 65, logs);

                expect(result).toBeDefined();
                expect(result!.amount).toBeGreaterThan(0);
            });
        });
    });

    describe('calculateStrategyTarget (Fixed Real / Percentage)', () => {
        describe('Fixed Real strategy', () => {
            it('should calculate fixed real withdrawal', () => {
                const accounts: AnyAccount[] = [
                    new InvestedAccount('inv1', 'Brokerage', 1000000, 0, 0, 0.1, 'Brokerage'),
                ];
                // birthYear=1960, retirementAge=65 means retirement starts in 2025
                const assumptions = createTestAssumptions({
                    withdrawalStrategy: 'Fixed Real',
                    withdrawalRate: 4,
                    birthYear: 1960,
                    retirementAge: 65,
                });
                const logs: string[] = [];

                const result = calculateStrategyTarget(accounts, assumptions, [], 2025, 65, logs);

                expect(result).toBeDefined();
                expect(result!.amount).toBeCloseTo(40000, -2);
            });

            it('should adjust for inflation over time', () => {
                const accounts: AnyAccount[] = [
                    new InvestedAccount('inv1', 'Brokerage', 1000000, 0, 0, 0.1, 'Brokerage'),
                ];
                const assumptions = createTestAssumptions({
                    withdrawalStrategy: 'Fixed Real',
                    withdrawalRate: 4,
                    inflationRate: 3,
                    birthYear: 1960,
                    retirementAge: 65,
                });

                // First year withdrawal
                const firstYearResult = calculateStrategyTarget(accounts, assumptions, [], 2025, 65, []);

                // Create previous simulation for second year
                const previousSim: SimulationYear[] = [{
                    year: 2025,
                    incomes: [],
                    expenses: [],
                    accounts: accounts,
                    cashflow: {
                        totalIncome: 0,
                        totalExpense: firstYearResult!.amount,
                        livingExpenses: firstYearResult!.amount,
                        discretionary: 0,
                        investedUser: 0,
                        investedMatch: 0,
                        totalInvested: 0,
                        bucketAllocations: 0,
                        bucketDetail: {},
                        withdrawals: 0,
                        withdrawalDetail: {},
                    },
                    taxDetails: { fed: 0, state: 0, fica: 0, preTax: 0, insurance: 0, postTax: 0, capitalGains: 0, withdrawalOrdinaryTax: 0, niit: 0 },
                    logs: [],
                    strategyWithdrawal: firstYearResult,
                }];

                const secondYearResult = calculateStrategyTarget(accounts, assumptions, previousSim, 2026, 66, []);

                // Second year should be higher due to inflation adjustment
                expect(secondYearResult!.amount).toBeGreaterThan(firstYearResult!.amount);
            });
        });

        describe('Percentage strategy', () => {
            it('should calculate percentage of current portfolio', () => {
                const accounts: AnyAccount[] = [
                    new InvestedAccount('inv1', 'Brokerage', 1000000, 0, 0, 0.1, 'Brokerage'),
                ];
                const assumptions = createTestAssumptions({
                    withdrawalStrategy: 'Percentage',
                    withdrawalRate: 4,
                    birthYear: 1960,
                    retirementAge: 65,
                });
                const logs: string[] = [];

                const result = calculateStrategyTarget(accounts, assumptions, [], 2025, 65, logs);

                expect(result!.amount).toBeCloseTo(40000, -2);
            });

            it('should recalculate each year based on portfolio', () => {
                const smallerPortfolio: AnyAccount[] = [
                    new InvestedAccount('inv1', 'Brokerage', 800000, 0, 0, 0.1, 'Brokerage'),
                ];
                const largerPortfolio: AnyAccount[] = [
                    new InvestedAccount('inv1', 'Brokerage', 1200000, 0, 0, 0.1, 'Brokerage'),
                ];
                const assumptions = createTestAssumptions({
                    withdrawalStrategy: 'Percentage',
                    withdrawalRate: 4,
                    birthYear: 1960,
                    retirementAge: 65,
                });

                const smallResult = calculateStrategyTarget(smallerPortfolio, assumptions, [], 2025, 65, []);
                const largeResult = calculateStrategyTarget(largerPortfolio, assumptions, [], 2025, 65, []);

                expect(smallResult!.amount).toBeCloseTo(32000, -2);
                expect(largeResult!.amount).toBeCloseTo(48000, -2);
            });
        });

        describe('portfolio calculation', () => {
            it('should sum all invested asset balances', () => {
                const accounts: AnyAccount[] = [
                    new InvestedAccount('inv1', '401k', 400000, 0, 0, 0.1, 'Traditional 401k'),
                    new SavedAccount('sav1', 'Emergency', 100000, 4),
                    new ESPPAccount('espp1', 'ESPP', 200000),
                ];
                const assumptions = createTestAssumptions({
                    withdrawalStrategy: 'Fixed Real',
                    withdrawalRate: 4,
                    birthYear: 1960,
                    retirementAge: 65,
                });
                const logs: string[] = [];

                const result = calculateStrategyTarget(accounts, assumptions, [], 2025, 65, logs);

                // $700k total at 4% = $28k
                expect(result!.amount).toBeCloseTo(28000, -2);
            });
        });

        describe('None and Needs Based strategies', () => {
            it('should return undefined for None strategy', () => {
                const accounts: AnyAccount[] = [
                    new InvestedAccount('inv1', 'Brokerage', 1000000, 0, 0, 0.1, 'Brokerage'),
                ];
                const assumptions = createTestAssumptions({
                    withdrawalStrategy: 'None',
                });
                const logs: string[] = [];

                const result = calculateStrategyTarget(accounts, assumptions, [], 2025, 65, logs);

                expect(result).toBeUndefined();
            });

            it('should return undefined for Needs Based strategy', () => {
                const accounts: AnyAccount[] = [
                    new InvestedAccount('inv1', 'Brokerage', 1000000, 0, 0, 0.1, 'Brokerage'),
                ];
                const assumptions = createTestAssumptions({
                    withdrawalStrategy: 'Needs Based',
                });
                const logs: string[] = [];

                const result = calculateStrategyTarget(accounts, assumptions, [], 2025, 65, logs);

                expect(result).toBeUndefined();
            });
        });
    });

    describe('enforceSpendingCap (Guyton Klinger)', () => {
        describe('within budget scenarios', () => {
            it('should not trim expenses when deficit within budget', () => {
                const expenses = [
                    createDiscretionaryExpense('1', 'Vacation', 10000),
                    createFixedExpense('2', 'Food', 20000),
                ];
                const strategyResult = createWithdrawalResult(50000); // $50k budget
                const assumptions = createTestAssumptions(); // defaults to GK
                const logs: string[] = [];

                const result = enforceSpendingCap(
                    expenses,
                    strategyResult,
                    -30000, // $30k deficit (within $50k budget)
                    0, // totalGrossIncome
                    0, // preTaxDeductions
                    0, // postTaxDeductions
                    0, // totalTax
                    0, // reinvestedIncome
                    2025,
                    assumptions,
                    logs
                );

                // Expenses unchanged
                expect(result.nextExpenses[0].getAnnualAmount()).toBe(10000);
                expect(result.nextExpenses[1].getAnnualAmount()).toBe(20000);
                expect(result.strategyAdjustmentResult).toBeUndefined();
            });

            it('should log OK message when within budget', () => {
                const expenses = [createFixedExpense('1', 'Food', 20000)];
                const strategyResult = createWithdrawalResult(50000);
                const assumptions = createTestAssumptions();
                const logs: string[] = [];

                enforceSpendingCap(
                    expenses,
                    strategyResult,
                    -30000,
                    0, 0, 0, 0, 0,
                    2025,
                    assumptions,
                    logs
                );

                expect(logs.some(l => l.includes('[OK]'))).toBe(true);
                expect(logs.some(l => l.includes('within budget'))).toBe(true);
            });
        });

        describe('over budget scenarios', () => {
            it('should calculate excess spending', () => {
                const expenses = [createDiscretionaryExpense('1', 'Vacation', 30000)];
                const strategyResult = createWithdrawalResult(40000); // $40k budget
                const assumptions = createTestAssumptions();
                const logs: string[] = [];

                const result = enforceSpendingCap(
                    expenses,
                    strategyResult,
                    -50000, // $50k deficit exceeds $40k budget by $10k
                    0, 0, 0, 0, 0,
                    2025,
                    assumptions,
                    logs
                );

                expect(result.strategyAdjustmentResult).toBeDefined();
                expect(result.strategyAdjustmentResult!.requiredAdjustment).toBe(10000);
            });

            it('should trim discretionary expenses to match budget', () => {
                const expenses = [createDiscretionaryExpense('1', 'Vacation', 30000)];
                const strategyResult = createWithdrawalResult(40000);
                const assumptions = createTestAssumptions();
                const logs: string[] = [];

                const result = enforceSpendingCap(
                    expenses,
                    strategyResult,
                    -50000, // $10k over budget
                    0, 0, 0, 0, 0,
                    2025,
                    assumptions,
                    logs
                );

                // Vacation trimmed by $10k from $30k to $20k
                expect(result.nextExpenses[0].getAnnualAmount()).toBeCloseTo(20000, 0);
            });

            it('should cap trim at total discretionary available', () => {
                const expenses = [
                    createDiscretionaryExpense('1', 'Vacation', 10000),
                    createFixedExpense('2', 'Food', 30000),
                ];
                const strategyResult = createWithdrawalResult(20000); // $20k budget
                const assumptions = createTestAssumptions();
                const logs: string[] = [];

                const result = enforceSpendingCap(
                    expenses,
                    strategyResult,
                    -50000, // $30k over budget, but only $10k discretionary
                    0, 0, 0, 0, 0,
                    2025,
                    assumptions,
                    logs
                );

                // Can only trim $10k (all discretionary)
                expect(result.strategyAdjustmentResult!.actualAdjustment).toBe(10000);
                expect(result.strategyAdjustmentResult!.requiredAdjustment).toBe(30000);
            });
        });

        describe('discretionary trimming', () => {
            it('should apply cut ratio to discretionary expenses', () => {
                const expenses = [
                    createDiscretionaryExpense('1', 'Vacation', 20000),
                    createDiscretionaryExpense('2', 'Entertainment', 10000),
                ];
                const strategyResult = createWithdrawalResult(40000);
                const assumptions = createTestAssumptions();
                const logs: string[] = [];

                const result = enforceSpendingCap(
                    expenses,
                    strategyResult,
                    -55000, // $15k over budget, total discretionary $30k, cut 50%
                    0, 0, 0, 0, 0,
                    2025,
                    assumptions,
                    logs
                );

                // Both trimmed by 50%
                expect(result.nextExpenses[0].getAnnualAmount()).toBeCloseTo(10000, 0);
                expect(result.nextExpenses[1].getAnnualAmount()).toBeCloseTo(5000, 0);
            });

            it('should preserve non-discretionary expenses', () => {
                const expenses = [
                    createDiscretionaryExpense('1', 'Vacation', 20000),
                    createFixedExpense('2', 'Rent', 24000),
                ];
                const strategyResult = createWithdrawalResult(30000);
                const assumptions = createTestAssumptions();
                const logs: string[] = [];

                const result = enforceSpendingCap(
                    expenses,
                    strategyResult,
                    -50000, // $20k over budget
                    0, 0, 0, 0, 0,
                    2025,
                    assumptions,
                    logs
                );

                // Rent unchanged
                const rent = result.nextExpenses.find(e => e.id === '2')!;
                expect(rent.getAnnualAmount()).toBe(24000);
            });

            it('should recalculate total living expenses after trim', () => {
                const expenses = [createDiscretionaryExpense('1', 'Vacation', 30000)];
                const strategyResult = createWithdrawalResult(40000);
                const assumptions = createTestAssumptions();
                const logs: string[] = [];

                const result = enforceSpendingCap(
                    expenses,
                    strategyResult,
                    -50000,
                    0, 0, 0, 0, 0,
                    2025,
                    assumptions,
                    logs
                );

                expect(result.totalLivingExpenses).toBeCloseTo(20000, 0);
            });
        });

        describe('no discretionary available', () => {
            it('should log warning when no discretionary to trim', () => {
                const expenses = [createFixedExpense('1', 'Rent', 50000)];
                const strategyResult = createWithdrawalResult(40000);
                const assumptions = createTestAssumptions();
                const logs: string[] = [];

                enforceSpendingCap(
                    expenses,
                    strategyResult,
                    -50000,
                    0, 0, 0, 0, 0,
                    2025,
                    assumptions,
                    logs
                );

                expect(logs.some(l => l.includes('[WARN]'))).toBe(true);
                expect(logs.some(l => l.includes('no discretionary'))).toBe(true);
            });

            it('should set warning in strategyAdjustmentResult', () => {
                const expenses = [createFixedExpense('1', 'Rent', 50000)];
                const strategyResult = createWithdrawalResult(40000);
                const assumptions = createTestAssumptions();
                const logs: string[] = [];

                const result = enforceSpendingCap(
                    expenses,
                    strategyResult,
                    -50000,
                    0, 0, 0, 0, 0,
                    2025,
                    assumptions,
                    logs
                );

                expect(result.strategyAdjustmentResult).toBeDefined();
                expect(result.strategyAdjustmentResult!.warning).toBeDefined();
                expect(result.strategyAdjustmentResult!.warning).toContain('no discretionary');
            });
        });

        describe('strategyAdjustmentResult', () => {
            it('should include guardrailTriggered', () => {
                const expenses = [createDiscretionaryExpense('1', 'Vacation', 30000)];
                const strategyResult = createWithdrawalResult(20000, 'capital-preservation');
                const assumptions = createTestAssumptions();
                const logs: string[] = [];

                const result = enforceSpendingCap(
                    expenses,
                    strategyResult,
                    -40000,
                    0, 0, 0, 0, 0,
                    2025,
                    assumptions,
                    logs
                );

                expect(result.strategyAdjustmentResult!.guardrailTriggered).toBe('capital-preservation');
            });

            it('should include requiredAdjustment', () => {
                const expenses = [createDiscretionaryExpense('1', 'Vacation', 30000)];
                const strategyResult = createWithdrawalResult(30000);
                const assumptions = createTestAssumptions();
                const logs: string[] = [];

                const result = enforceSpendingCap(
                    expenses,
                    strategyResult,
                    -50000, // $20k over
                    0, 0, 0, 0, 0,
                    2025,
                    assumptions,
                    logs
                );

                expect(result.strategyAdjustmentResult!.requiredAdjustment).toBe(20000);
            });

            it('should include actualAdjustment', () => {
                const expenses = [createDiscretionaryExpense('1', 'Vacation', 10000)];
                const strategyResult = createWithdrawalResult(30000);
                const assumptions = createTestAssumptions();
                const logs: string[] = [];

                const result = enforceSpendingCap(
                    expenses,
                    strategyResult,
                    -50000, // $20k over, but only $10k discretionary
                    0, 0, 0, 0, 0,
                    2025,
                    assumptions,
                    logs
                );

                expect(result.strategyAdjustmentResult!.actualAdjustment).toBe(10000);
            });

            it('should include warning when partial adjustment', () => {
                const expenses = [
                    createDiscretionaryExpense('1', 'Vacation', 10000),
                    createFixedExpense('2', 'Rent', 30000),
                ];
                const strategyResult = createWithdrawalResult(20000);
                const assumptions = createTestAssumptions();
                const logs: string[] = [];

                const result = enforceSpendingCap(
                    expenses,
                    strategyResult,
                    -50000, // $30k over, but only $10k discretionary
                    0, 0, 0, 0, 0,
                    2025,
                    assumptions,
                    logs
                );

                expect(result.strategyAdjustmentResult!.warning).toBeDefined();
                expect(result.strategyAdjustmentResult!.warning).toContain('fixed expenses');
            });
        });
    });

    describe('enforceSpendingCap (Fixed Real / Percentage)', () => {
        describe('within budget scenarios', () => {
            it('should not trim expenses when deficit within budget', () => {
                const expenses = [createDiscretionaryExpense('1', 'Vacation', 10000)];
                const strategyResult = createWithdrawalResult(40000);
                const assumptions = createTestAssumptions({ withdrawalStrategy: 'Fixed Real' });
                const logs: string[] = [];

                const result = enforceSpendingCap(
                    expenses,
                    strategyResult,
                    -30000,
                    0, 0, 0, 0, 0,
                    2025,
                    assumptions,
                    logs
                );

                expect(result.nextExpenses[0].getAnnualAmount()).toBe(10000);
                expect(result.strategyAdjustmentResult).toBeUndefined();
            });
        });

        describe('over budget scenarios', () => {
            it('should trim discretionary expenses for Fixed Real', () => {
                const expenses = [createDiscretionaryExpense('1', 'Vacation', 30000)];
                const strategyResult = createWithdrawalResult(40000);
                const assumptions = createTestAssumptions({ withdrawalStrategy: 'Fixed Real' });
                const logs: string[] = [];

                const result = enforceSpendingCap(
                    expenses,
                    strategyResult,
                    -50000, // $10k over
                    0, 0, 0, 0, 0,
                    2025,
                    assumptions,
                    logs
                );

                expect(result.nextExpenses[0].getAnnualAmount()).toBeCloseTo(20000, 0);
            });

            it('should trim discretionary expenses for Percentage', () => {
                const expenses = [createDiscretionaryExpense('1', 'Vacation', 30000)];
                const strategyResult = createWithdrawalResult(40000);
                const assumptions = createTestAssumptions({ withdrawalStrategy: 'Percentage' });
                const logs: string[] = [];

                const result = enforceSpendingCap(
                    expenses,
                    strategyResult,
                    -50000, // $10k over
                    0, 0, 0, 0, 0,
                    2025,
                    assumptions,
                    logs
                );

                expect(result.nextExpenses[0].getAnnualAmount()).toBeCloseTo(20000, 0);
            });
        });

        describe('adjustment result', () => {
            it('should return undefined when no adjustment needed', () => {
                const expenses = [createDiscretionaryExpense('1', 'Vacation', 10000)];
                const strategyResult = createWithdrawalResult(50000);
                const assumptions = createTestAssumptions({ withdrawalStrategy: 'Fixed Real' });
                const logs: string[] = [];

                const result = enforceSpendingCap(
                    expenses,
                    strategyResult,
                    -30000,
                    0, 0, 0, 0, 0,
                    2025,
                    assumptions,
                    logs
                );

                expect(result.strategyAdjustmentResult).toBeUndefined();
            });

            it('should return capital-preservation guardrail when trimmed', () => {
                const expenses = [
                    createDiscretionaryExpense('1', 'Vacation', 10000),
                    createFixedExpense('2', 'Rent', 40000),
                ];
                const strategyResult = createWithdrawalResult(30000);
                const assumptions = createTestAssumptions({ withdrawalStrategy: 'Fixed Real' });
                const logs: string[] = [];

                const result = enforceSpendingCap(
                    expenses,
                    strategyResult,
                    -60000, // $30k over, only $10k discretionary
                    0, 0, 0, 0, 0,
                    2025,
                    assumptions,
                    logs
                );

                expect(result.strategyAdjustmentResult).toBeDefined();
                expect(result.strategyAdjustmentResult!.guardrailTriggered).toBe('capital-preservation');
            });
        });
    });

    describe('applyProsperitySpending', () => {
        describe('basic prosperity scenarios', () => {
            it('should increase discretionary proportionally when budget exceeds expenses', () => {
                // Test 1: Budget > expenses, discretionary increases proportionally
                const expenses = [
                    createFixedExpense('1', 'Rent', 30000),
                    createDiscretionaryExpense('2', 'Travel', 20000),
                ];
                const logs: string[] = [];

                const result = applyProsperitySpending(
                    expenses,
                    50000, // currentTotalExpenses
                    60000, // budgetTarget
                    2025,
                    logs
                );

                expect(result.prosperityApplied).toBe(true);
                expect(result.surplusToInvest).toBe(0);
                // Discretionary increased by 50%: $20k * 1.5 = $30k
                expect(result.adjustedExpenses[1].getAnnualAmount()).toBeCloseTo(30000, 0);
                // Fixed unchanged
                expect(result.adjustedExpenses[0].getAnnualAmount()).toBeCloseTo(30000, 0);
            });

            it('should invest entire surplus when no discretionary expenses exist', () => {
                // Test 2: Budget > expenses, no discretionary
                const expenses = [
                    createFixedExpense('1', 'Rent', 50000),
                ];
                const logs: string[] = [];

                const result = applyProsperitySpending(
                    expenses,
                    50000, // currentTotalExpenses
                    60000, // budgetTarget
                    2025,
                    logs
                );

                expect(result.prosperityApplied).toBe(false);
                expect(result.surplusToInvest).toBe(10000);
                expect(result.adjustedExpenses[0].getAnnualAmount()).toBeCloseTo(50000, 0);
            });

            it('should make no changes when budget <= expenses', () => {
                // Test 3: Budget <= expenses (no prosperity)
                const expenses = [
                    createFixedExpense('1', 'Rent', 30000),
                    createDiscretionaryExpense('2', 'Travel', 20000),
                ];
                const logs: string[] = [];

                const result = applyProsperitySpending(
                    expenses,
                    50000, // currentTotalExpenses
                    45000, // budgetTarget (less than expenses)
                    2025,
                    logs
                );

                expect(result.prosperityApplied).toBe(false);
                expect(result.surplusToInvest).toBe(0);
                expect(result.adjustedExpenses[0].getAnnualAmount()).toBeCloseTo(30000, 0);
                expect(result.adjustedExpenses[1].getAnnualAmount()).toBeCloseTo(20000, 0);
            });
        });

        describe('100% cap enforcement', () => {
            it('should cap increase at 100% of discretionary (doubling) and invest remainder', () => {
                // Test 4: Surplus exceeds 100% cap
                const expenses = [
                    createFixedExpense('1', 'Rent', 30000),
                    createDiscretionaryExpense('2', 'Travel', 10000),
                ];
                const logs: string[] = [];

                const result = applyProsperitySpending(
                    expenses,
                    40000, // currentTotalExpenses
                    70000, // budgetTarget ($30k surplus)
                    2025,
                    logs
                );

                expect(result.prosperityApplied).toBe(true);
                // Can only double discretionary: $10k -> $20k (increase of $10k)
                expect(result.adjustedExpenses[1].getAnnualAmount()).toBeCloseTo(20000, 0);
                // Remaining $20k goes to investments
                expect(result.surplusToInvest).toBe(20000);
            });

            it('should increase multiple discretionary expenses proportionally', () => {
                // Test 5: Multiple discretionary expenses
                const expenses = [
                    createFixedExpense('1', 'Rent', 20000),
                    createDiscretionaryExpense('2', 'Travel', 10000),
                    createDiscretionaryExpense('3', 'Dining', 5000),
                ];
                const logs: string[] = [];

                const result = applyProsperitySpending(
                    expenses,
                    35000, // currentTotalExpenses
                    60000, // budgetTarget ($25k surplus, $15k discretionary)
                    2025,
                    logs
                );

                expect(result.prosperityApplied).toBe(true);
                // Cap at 100% increase: all discretionary doubles
                expect(result.adjustedExpenses[1].getAnnualAmount()).toBeCloseTo(20000, 0); // Travel: $10k -> $20k
                expect(result.adjustedExpenses[2].getAnnualAmount()).toBeCloseTo(10000, 0); // Dining: $5k -> $10k
                // $25k surplus - $15k increase = $10k invested
                expect(result.surplusToInvest).toBe(10000);
            });
        });

        describe('edge cases', () => {
            it('should handle zero discretionary expenses', () => {
                // Test 6: Zero discretionary (same as Test 2)
                const expenses = [
                    createFixedExpense('1', 'Rent', 30000),
                    createFixedExpense('2', 'Utilities', 10000),
                    createFixedExpense('3', 'Food', 10000),
                ];
                const logs: string[] = [];

                const result = applyProsperitySpending(
                    expenses,
                    50000,
                    60000,
                    2025,
                    logs
                );

                expect(result.prosperityApplied).toBe(false);
                expect(result.surplusToInvest).toBe(10000);
            });

            it('should make no changes when budget exactly equals expenses', () => {
                // Test 7: Budget exactly equals expenses
                const expenses = [
                    createFixedExpense('1', 'Rent', 30000),
                    createDiscretionaryExpense('2', 'Travel', 20000),
                ];
                const logs: string[] = [];

                const result = applyProsperitySpending(
                    expenses,
                    50000,
                    50000, // Exactly equal
                    2025,
                    logs
                );

                expect(result.prosperityApplied).toBe(false);
                expect(result.surplusToInvest).toBe(0);
            });

            it('should handle very small surplus', () => {
                // Test 8: Very small surplus
                const expenses = [
                    createFixedExpense('1', 'Rent', 30000),
                    createDiscretionaryExpense('2', 'Travel', 20000),
                ];
                const logs: string[] = [];

                const result = applyProsperitySpending(
                    expenses,
                    50000,
                    50001, // $1 surplus
                    2025,
                    logs
                );

                expect(result.prosperityApplied).toBe(true);
                expect(result.surplusToInvest).toBe(0);
                // Very small increase: $20k + $1 surplus = $20,001
                expect(result.adjustedExpenses[1].getAnnualAmount()).toBeCloseTo(20001, 0);
            });
        });

        describe('logging', () => {
            it('should log prosperity increase details', () => {
                const expenses = [
                    createFixedExpense('1', 'Rent', 30000),
                    createDiscretionaryExpense('2', 'Travel', 20000),
                ];
                const logs: string[] = [];

                applyProsperitySpending(expenses, 50000, 60000, 2025, logs);

                expect(logs.some(l => l.includes('Prosperity'))).toBe(true);
                expect(logs.some(l => l.includes('discretionary increased'))).toBe(true);
            });

            it('should log when surplus goes to investment', () => {
                const expenses = [
                    createFixedExpense('1', 'Rent', 30000),
                    createDiscretionaryExpense('2', 'Travel', 10000),
                ];
                const logs: string[] = [];

                applyProsperitySpending(expenses, 40000, 70000, 2025, logs);

                expect(logs.some(l => l.includes('will be invested'))).toBe(true);
            });
        });
    });

    describe('calculateTotalDiscretionary', () => {
        it('should sum annual amounts of discretionary expenses', () => {
            const expenses: AnyExpense[] = [
                createDiscretionaryExpense('1', 'Travel', 10000),
                createDiscretionaryExpense('2', 'Entertainment', 5000),
            ];

            const result = calculateTotalDiscretionary(expenses, 2025);

            expect(result).toBe(15000);
        });

        it('should exclude non-discretionary expenses', () => {
            const expenses: AnyExpense[] = [
                createFixedExpense('1', 'Rent', 30000),
                createDiscretionaryExpense('2', 'Travel', 10000),
                createFixedExpense('3', 'Utilities', 3000),
            ];

            const result = calculateTotalDiscretionary(expenses, 2025);

            // Only Travel (discretionary) is counted
            expect(result).toBe(10000);
        });

        it('should use calculateAnnualAmortization for discretionary MortgageExpense', () => {
            // Create a discretionary mortgage (unusual but testing the branch)
            const mortgage = new MortgageExpense(
                'mort1', 'Vacation Home', 'Monthly',
                300000, 250000, 250000, // valuation, loan_balance, starting_loan_balance
                4, 30, // apr, term_length
                1.0, 0, 1, 100, 0.3, 0, 50, // taxes, deduction, maintenance, utilities, insurance, pmi, hoa
                'No', 0, 'prop1', new Date('2025-01-01')
            );
            // Mark as discretionary
            (mortgage as unknown as { isDiscretionary: boolean }).isDiscretionary = true;

            const expenses: AnyExpense[] = [mortgage];
            const result = calculateTotalDiscretionary(expenses, 2025);

            // Should use calculateAnnualAmortization, not getAnnualAmount
            const expectedAmortization = mortgage.calculateAnnualAmortization(2025);
            expect(result).toBeCloseTo(expectedAmortization.totalPayment, 0);
        });

        it('should use calculateAnnualAmortization for discretionary LoanExpense', () => {
            // Create a discretionary loan (e.g., vacation loan)
            const loan = new LoanExpense(
                'loan1', 'Vacation Loan', 10000, 'Monthly',
                5, 'Compounding', 200, // apr, interest_type, payment
                'No', 0, 'debt1', new Date('2025-01-01')
            );
            // Mark as discretionary
            (loan as unknown as { isDiscretionary: boolean }).isDiscretionary = true;

            const expenses: AnyExpense[] = [loan];
            const result = calculateTotalDiscretionary(expenses, 2025);

            // Should use calculateAnnualAmortization
            const expectedAmortization = loan.calculateAnnualAmortization(2025);
            expect(result).toBeCloseTo(expectedAmortization.totalPayment, 0);
        });

        it('should correctly sum mixed expenses (only discretionary)', () => {
            const expenses: AnyExpense[] = [
                createFixedExpense('1', 'Rent', 24000),
                createDiscretionaryExpense('2', 'Dining', 6000),
                createFixedExpense('3', 'Insurance', 2400),
                createDiscretionaryExpense('4', 'Hobbies', 3600),
            ];

            const result = calculateTotalDiscretionary(expenses, 2025);

            // Only Dining + Hobbies
            expect(result).toBe(9600);
        });

        it('should return 0 for empty expenses array', () => {
            const result = calculateTotalDiscretionary([], 2025);

            expect(result).toBe(0);
        });

        it('should return 0 when no expenses are discretionary', () => {
            const expenses: AnyExpense[] = [
                createFixedExpense('1', 'Rent', 24000),
                createFixedExpense('2', 'Utilities', 3600),
            ];

            const result = calculateTotalDiscretionary(expenses, 2025);

            expect(result).toBe(0);
        });
    });
});
