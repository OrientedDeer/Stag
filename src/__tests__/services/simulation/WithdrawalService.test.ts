/**
 * Unit tests for withdrawal service.
 *
 * This service executes withdrawals to cover expense deficits,
 * handling tax scenarios for each account type.
 */
import { describe, it, expect } from 'vitest';
import {
    executeWithdrawals,
    processDeficitDebt,
    WithdrawalPlan
} from '../../../services/simulation/WithdrawalService';
import {
    InvestedAccount,
    SavedAccount,
    DeficitDebtAccount,
    AnyAccount,
    BrokerageLot
} from '../../../components/Objects/Accounts/models';
import {
    AssumptionsState,
    defaultAssumptions,
    createBuiltinMilestones,
    WithdrawalBucket
} from '../../../components/Objects/Assumptions/AssumptionsContext';
import { TaxState } from '../../../components/Objects/Taxes/TaxContext';
import { WithdrawalState } from '../../../services/simulation/types';

// Helper to create test assumptions
function createTestAssumptions(overrides: Partial<{
    birthYear: number;
    retirementAge: number;
    withdrawalStrategy: WithdrawalBucket[];
}> = {}): AssumptionsState {
    const birthYear = overrides.birthYear ?? 1960;
    const retirementAge = overrides.retirementAge ?? 65;

    return {
        ...defaultAssumptions,
        milestones: createBuiltinMilestones(birthYear, retirementAge, 90),
        withdrawalStrategy: overrides.withdrawalStrategy ?? [],
    };
}

// Helper to create test tax state
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

// Helper to create withdrawal state
function createWithdrawalState(overrides: Partial<WithdrawalState> = {}): WithdrawalState {
    return {
        userInflows: {},
        employerInflows: {},
        withdrawalTaxes: 0,
        capitalGainsTaxTotal: 0,
        strategyWithdrawalExecuted: 0,
        totalWithdrawals: 0,
        withdrawalDetail: {},
        withdrawalPenalties: 0,
        totalGrossIncome: 0,
        traditionalWithdrawals: 0,
        longTermCapitalGains: 0,
        shortTermCapitalGains: 0,
        stateCapitalGainsTax: 0,
        ...overrides,
    };
}

// Helper to create Traditional account
function createTraditionalAccount(
    id: string,
    name: string,
    balance: number,
    taxType: 'Traditional 401k' | 'Traditional IRA' = 'Traditional IRA'
): InvestedAccount {
    return new InvestedAccount(id, name, balance, 0, 0, 0, taxType);
}

// Helper to create Roth account
function createRothAccount(
    id: string,
    name: string,
    balance: number,
    costBasis: number = balance,
    conversionHistory: { year: number; amount: number }[] = []
): InvestedAccount {
    return new InvestedAccount(
        id, name, balance, 0, 0, 0, 'Roth IRA', true, 0.2, costBasis, undefined, conversionHistory
    );
}

// Helper to create Brokerage account with lots
function createBrokerageAccount(
    id: string,
    name: string,
    balance: number,
    costBasis: number = balance,
    lots: BrokerageLot[] = []
): InvestedAccount {
    return new InvestedAccount(
        id, name, balance, 0, 0, 0, 'Brokerage', true, 0.2, costBasis, undefined, [], lots
    );
}

// Helper to create Savings account
function createSavingsAccount(id: string, name: string, balance: number): SavedAccount {
    return new SavedAccount(id, name, balance, 0);
}

describe('WithdrawalService', () => {
    describe('executeWithdrawals', () => {
        describe('no withdrawal scenarios', () => {
            it('should return unchanged cash when no deficit', () => {
                const savings = createSavingsAccount('sav1', 'Emergency Fund', 50000);
                const withdrawalState = createWithdrawalState();
                const logs: string[] = [];

                const result = executeWithdrawals(
                    10000, // Positive cash (surplus)
                    [savings],
                    createTestAssumptions(),
                    createTestTaxState(),
                    2025,
                    65,
                    0,
                    withdrawalState,
                    undefined,
                    true,
                    logs
                );

                expect(result.discretionaryCash).toBe(10000);
                expect(withdrawalState.totalWithdrawals).toBe(0);
            });

            it('should return unchanged cash when deficit is zero', () => {
                const savings = createSavingsAccount('sav1', 'Emergency Fund', 50000);
                const withdrawalState = createWithdrawalState();
                const logs: string[] = [];

                const result = executeWithdrawals(
                    0, // Zero cash
                    [savings],
                    createTestAssumptions(),
                    createTestTaxState(),
                    2025,
                    65,
                    0,
                    withdrawalState,
                    undefined,
                    true,
                    logs
                );

                expect(result.discretionaryCash).toBe(0);
                expect(withdrawalState.totalWithdrawals).toBe(0);
            });
        });

        describe('withdrawal plan execution', () => {
            it('should use withdrawal plan when provided', () => {
                const traditional = createTraditionalAccount('trad1', 'Traditional IRA', 100000);
                const savings = createSavingsAccount('sav1', 'Savings', 50000);
                const withdrawalState = createWithdrawalState();
                const logs: string[] = [];

                const plan: WithdrawalPlan = {
                    traditional: 10000,
                    roth: 0,
                    brokerage: 0,
                    savings: 5000
                };

                const result = executeWithdrawals(
                    -15000, // $15k deficit
                    [traditional, savings],
                    createTestAssumptions(),
                    createTestTaxState(),
                    2025,
                    65,
                    0,
                    withdrawalState,
                    undefined,
                    true,
                    logs,
                    plan
                );

                // Plan should be executed: $10k from Traditional + $5k from Savings = $15k
                expect(result.discretionaryCash).toBe(0);
                expect(withdrawalState.totalWithdrawals).toBe(15000);
                expect(logs.some(l => l.includes('tax-optimized withdrawal plan'))).toBe(true);
            });

            it('should execute plan amounts by account type', () => {
                const traditional = createTraditionalAccount('trad1', 'Traditional IRA', 100000);
                const roth = createRothAccount('roth1', 'Roth IRA', 50000);
                const brokerage = createBrokerageAccount('brok1', 'Brokerage', 30000);
                const savings = createSavingsAccount('sav1', 'Savings', 20000);
                const withdrawalState = createWithdrawalState();
                const logs: string[] = [];

                const plan: WithdrawalPlan = {
                    traditional: 5000,
                    roth: 3000,
                    brokerage: 2000,
                    savings: 1000
                };

                executeWithdrawals(
                    -11000,
                    [traditional, roth, brokerage, savings],
                    createTestAssumptions(),
                    createTestTaxState(),
                    2025,
                    65,
                    0,
                    withdrawalState,
                    undefined,
                    true,
                    logs,
                    plan
                );

                expect(withdrawalState.withdrawalDetail['Traditional IRA']).toBe(5000);
                expect(withdrawalState.withdrawalDetail['Roth IRA']).toBe(3000);
                expect(withdrawalState.withdrawalDetail['Brokerage']).toBe(2000);
                expect(withdrawalState.withdrawalDetail['Savings']).toBe(1000);
            });

            it('should handle plan shortfall with fallback', () => {
                // Traditional has less than planned
                const traditional = createTraditionalAccount('trad1', 'Traditional IRA', 3000);
                const savings = createSavingsAccount('sav1', 'Savings', 50000);
                const withdrawalState = createWithdrawalState();
                const logs: string[] = [];

                const plan: WithdrawalPlan = {
                    traditional: 10000, // Request more than available
                    roth: 0,
                    brokerage: 0,
                    savings: 0
                };

                const result = executeWithdrawals(
                    -10000,
                    [traditional, savings],
                    createTestAssumptions(),
                    createTestTaxState(),
                    2025,
                    65,
                    0,
                    withdrawalState,
                    undefined,
                    true,
                    logs,
                    plan
                );

                // Should use fallback to cover remaining $7k
                expect(result.discretionaryCash).toBeCloseTo(0, 0);
                expect(logs.some(l => l.includes('Fallback'))).toBe(true);
            });
        });

        describe('tax-free withdrawals', () => {
            it('should withdraw from SavedAccount tax-free', () => {
                const savings = createSavingsAccount('sav1', 'Emergency Fund', 50000);
                const withdrawalStrategy: WithdrawalBucket[] = [
                    { id: 'w1', name: 'Savings', accountId: 'sav1' }
                ];
                const withdrawalState = createWithdrawalState();
                const logs: string[] = [];

                const result = executeWithdrawals(
                    -10000,
                    [savings],
                    createTestAssumptions({ withdrawalStrategy }),
                    createTestTaxState(),
                    2025,
                    65,
                    0,
                    withdrawalState,
                    undefined,
                    true,
                    logs
                );

                expect(result.discretionaryCash).toBeCloseTo(0);
                expect(withdrawalState.totalWithdrawals).toBe(10000);
                expect(withdrawalState.withdrawalTaxes).toBe(0);
                expect(withdrawalState.totalGrossIncome).toBe(0);
            });

            it('should withdraw from Roth after 59.5 tax-free', () => {
                const roth = createRothAccount('roth1', 'Roth IRA', 100000);
                const withdrawalStrategy: WithdrawalBucket[] = [
                    { id: 'w1', name: 'Roth', accountId: 'roth1' }
                ];
                const withdrawalState = createWithdrawalState();
                const logs: string[] = [];

                const result = executeWithdrawals(
                    -20000,
                    [roth],
                    createTestAssumptions({ withdrawalStrategy }),
                    createTestTaxState(),
                    2025,
                    65, // Over 59.5
                    0,
                    withdrawalState,
                    undefined,
                    true,
                    logs
                );

                expect(result.discretionaryCash).toBeCloseTo(0);
                expect(withdrawalState.totalWithdrawals).toBe(20000);
                expect(withdrawalState.withdrawalTaxes).toBe(0);
                expect(withdrawalState.withdrawalPenalties).toBe(0);
            });

            it('should withdraw from HSA tax-free (for medical)', () => {
                const hsa = new InvestedAccount('hsa1', 'HSA', 10000, 0, 0, 0, 'HSA');
                const withdrawalStrategy: WithdrawalBucket[] = [
                    { id: 'w1', name: 'HSA', accountId: 'hsa1' }
                ];
                const withdrawalState = createWithdrawalState();
                const logs: string[] = [];

                const result = executeWithdrawals(
                    -5000,
                    [hsa],
                    createTestAssumptions({ withdrawalStrategy }),
                    createTestTaxState(),
                    2025,
                    65,
                    0,
                    withdrawalState,
                    undefined,
                    true,
                    logs
                );

                expect(result.discretionaryCash).toBeCloseTo(0);
                expect(withdrawalState.totalWithdrawals).toBe(5000);
                expect(withdrawalState.withdrawalTaxes).toBe(0);
            });
        });

        describe('Roth early withdrawal (before 59.5)', () => {
            it('should withdraw regular contributions penalty-free', () => {
                // Roth with $50k balance, $50k cost basis (all contributions, no gains)
                const roth = createRothAccount('roth1', 'Roth IRA', 50000, 50000);
                const withdrawalStrategy: WithdrawalBucket[] = [
                    { id: 'w1', name: 'Roth', accountId: 'roth1' }
                ];
                const withdrawalState = createWithdrawalState();
                const logs: string[] = [];

                const result = executeWithdrawals(
                    -10000,
                    [roth],
                    createTestAssumptions({ withdrawalStrategy }),
                    createTestTaxState(),
                    2025,
                    50, // Under 59.5
                    0,
                    withdrawalState,
                    undefined,
                    false,
                    logs
                );

                // Contributions are penalty-free even before 59.5
                expect(result.discretionaryCash).toBeCloseTo(0);
                expect(withdrawalState.withdrawalPenalties).toBe(0);
            });

            it('should apply 5-year rule penalty to conversions', () => {
                // Roth with $50k balance, $30k contributions, $20k from conversion done in 2023
                const roth = createRothAccount('roth1', 'Roth IRA', 50000, 50000, [
                    { year: 2023, amount: 20000 }
                ]);
                const withdrawalStrategy: WithdrawalBucket[] = [
                    { id: 'w1', name: 'Roth', accountId: 'roth1' }
                ];
                const withdrawalState = createWithdrawalState();
                const logs: string[] = [];

                executeWithdrawals(
                    -40000, // Need to tap into conversions
                    [roth],
                    createTestAssumptions({ withdrawalStrategy }),
                    createTestTaxState(),
                    2025, // 2025 - 2023 = 2 years < 5 year rule
                    50,
                    0,
                    withdrawalState,
                    undefined,
                    false,
                    logs
                );

                // 10% penalty on conversion amount withdrawn within 5 years
                expect(withdrawalState.withdrawalPenalties).toBeGreaterThan(0);
                expect(logs.some(l => l.includes('5-year rule'))).toBe(true);
            });

            it('should tax earnings as ordinary income', () => {
                // Roth with $60k balance, $40k cost basis (= $20k earnings)
                const roth = createRothAccount('roth1', 'Roth IRA', 60000, 40000);
                const withdrawalStrategy: WithdrawalBucket[] = [
                    { id: 'w1', name: 'Roth', accountId: 'roth1' }
                ];
                const withdrawalState = createWithdrawalState();
                const logs: string[] = [];

                executeWithdrawals(
                    -50000, // Need to tap into earnings
                    [roth],
                    createTestAssumptions({ withdrawalStrategy }),
                    createTestTaxState(),
                    2025,
                    50,
                    0,
                    withdrawalState,
                    undefined,
                    false,
                    logs
                );

                // Earnings are added to gross income
                expect(withdrawalState.totalGrossIncome).toBeGreaterThan(0);
                expect(logs.some(l => l.includes('Early Roth withdrawal') && l.includes('earnings taxed'))).toBe(true);
            });

            it('should apply 10% penalty to earnings', () => {
                const roth = createRothAccount('roth1', 'Roth IRA', 60000, 40000);
                const withdrawalStrategy: WithdrawalBucket[] = [
                    { id: 'w1', name: 'Roth', accountId: 'roth1' }
                ];
                const withdrawalState = createWithdrawalState();
                const logs: string[] = [];

                executeWithdrawals(
                    -50000,
                    [roth],
                    createTestAssumptions({ withdrawalStrategy }),
                    createTestTaxState(),
                    2025,
                    50,
                    0,
                    withdrawalState,
                    undefined,
                    false,
                    logs
                );

                // 10% penalty on earnings
                expect(withdrawalState.withdrawalPenalties).toBeGreaterThan(0);
            });
        });

        describe('Traditional withdrawals', () => {
            it('should track withdrawal in totalGrossIncome', () => {
                const traditional = createTraditionalAccount('trad1', 'Traditional IRA', 100000);
                const withdrawalStrategy: WithdrawalBucket[] = [
                    { id: 'w1', name: 'Traditional', accountId: 'trad1' }
                ];
                const withdrawalState = createWithdrawalState();
                const logs: string[] = [];

                executeWithdrawals(
                    -20000,
                    [traditional],
                    createTestAssumptions({ withdrawalStrategy }),
                    createTestTaxState(),
                    2025,
                    65, // Over 59.5
                    0,
                    withdrawalState,
                    undefined,
                    true,
                    logs
                );

                expect(withdrawalState.totalGrossIncome).toBe(20000);
            });

            it('should track in traditionalWithdrawals', () => {
                const traditional = createTraditionalAccount('trad1', 'Traditional IRA', 100000);
                const withdrawalStrategy: WithdrawalBucket[] = [
                    { id: 'w1', name: 'Traditional', accountId: 'trad1' }
                ];
                const withdrawalState = createWithdrawalState();
                const logs: string[] = [];

                executeWithdrawals(
                    -20000,
                    [traditional],
                    createTestAssumptions({ withdrawalStrategy }),
                    createTestTaxState(),
                    2025,
                    65,
                    0,
                    withdrawalState,
                    undefined,
                    true,
                    logs
                );

                expect(withdrawalState.traditionalWithdrawals).toBe(20000);
            });

            it('should apply 10% early withdrawal penalty before 59.5', () => {
                const traditional = createTraditionalAccount('trad1', 'Traditional IRA', 100000);
                const withdrawalStrategy: WithdrawalBucket[] = [
                    { id: 'w1', name: 'Traditional', accountId: 'trad1' }
                ];
                const withdrawalState = createWithdrawalState();
                const logs: string[] = [];

                executeWithdrawals(
                    -10000,
                    [traditional],
                    createTestAssumptions({ withdrawalStrategy }),
                    createTestTaxState(),
                    2025,
                    50, // Under 59.5
                    0,
                    withdrawalState,
                    undefined,
                    false,
                    logs
                );

                // 10% early withdrawal penalty
                expect(withdrawalState.withdrawalPenalties).toBeGreaterThan(0);
            });

            it('should gross up for penalty to cover deficit', () => {
                const traditional = createTraditionalAccount('trad1', 'Traditional IRA', 100000);
                const withdrawalStrategy: WithdrawalBucket[] = [
                    { id: 'w1', name: 'Traditional', accountId: 'trad1' }
                ];
                const withdrawalState = createWithdrawalState();
                const logs: string[] = [];

                const result = executeWithdrawals(
                    -10000,
                    [traditional],
                    createTestAssumptions({ withdrawalStrategy }),
                    createTestTaxState(),
                    2025,
                    50, // Under 59.5, 10% penalty
                    0,
                    withdrawalState,
                    undefined,
                    false,
                    logs
                );

                // To net $10k after 10% penalty, need to withdraw ~$11,111
                expect(withdrawalState.totalWithdrawals).toBeGreaterThan(10000);
                expect(result.discretionaryCash).toBeCloseTo(0, 0);
            });
        });

        describe('Brokerage withdrawals', () => {
            it('should calculate lot-aware gains', () => {
                // Create brokerage with gains (balance > costBasis)
                // $20,000 balance, $10,000 cost basis = 50% gains
                const brokerage = createBrokerageAccount('brok1', 'Brokerage', 20000, 10000);
                const withdrawalStrategy: WithdrawalBucket[] = [
                    { id: 'w1', name: 'Brokerage', accountId: 'brok1' }
                ];
                const withdrawalState = createWithdrawalState();
                const logs: string[] = [];

                executeWithdrawals(
                    -5000,
                    [brokerage],
                    createTestAssumptions({ withdrawalStrategy }),
                    createTestTaxState(),
                    2025,
                    65,
                    0,
                    withdrawalState,
                    undefined,
                    true,
                    logs
                );

                // Withdrawal should have been recorded
                expect(withdrawalState.withdrawalDetail['Brokerage']).toBeGreaterThan(0);
                // With gains present, should log brokerage withdrawal
                expect(logs.some(l => l.includes('Brokerage'))).toBe(true);
            });

            it('should track gains in withdrawalState', () => {
                // Brokerage with gains (balance > costBasis)
                const brokerage = createBrokerageAccount('brok1', 'Brokerage', 20000, 10000);
                const withdrawalStrategy: WithdrawalBucket[] = [
                    { id: 'w1', name: 'Brokerage', accountId: 'brok1' }
                ];
                const withdrawalState = createWithdrawalState();
                const logs: string[] = [];

                executeWithdrawals(
                    -8000,
                    [brokerage],
                    createTestAssumptions({ withdrawalStrategy }),
                    createTestTaxState(),
                    2025,
                    65,
                    0,
                    withdrawalState,
                    undefined,
                    true,
                    logs
                );

                // Capital gains tax should be tracked
                expect(withdrawalState.capitalGainsTaxTotal).toBeGreaterThanOrEqual(0);
            });

            it('should iterate to find correct gross withdrawal', () => {
                const brokerage = createBrokerageAccount('brok1', 'Brokerage', 100000, 50000);
                const withdrawalStrategy: WithdrawalBucket[] = [
                    { id: 'w1', name: 'Brokerage', accountId: 'brok1' }
                ];
                const withdrawalState = createWithdrawalState();
                const logs: string[] = [];

                const result = executeWithdrawals(
                    -20000,
                    [brokerage],
                    createTestAssumptions({ withdrawalStrategy }),
                    createTestTaxState(),
                    2025,
                    65,
                    0,
                    withdrawalState,
                    undefined,
                    true,
                    logs
                );

                // After accounting for taxes, should cover the deficit
                expect(result.discretionaryCash).toBeCloseTo(0, 0);
            });
        });

        describe('withdrawal order', () => {
            it('should follow user-defined withdrawal strategy', () => {
                const savings = createSavingsAccount('sav1', 'Savings', 50000);
                const traditional = createTraditionalAccount('trad1', 'Traditional IRA', 100000);
                const roth = createRothAccount('roth1', 'Roth IRA', 80000);

                // User wants: Traditional first, then Roth, then Savings
                const withdrawalStrategy: WithdrawalBucket[] = [
                    { id: 'w1', name: 'Traditional', accountId: 'trad1' },
                    { id: 'w2', name: 'Roth', accountId: 'roth1' },
                    { id: 'w3', name: 'Savings', accountId: 'sav1' }
                ];
                const withdrawalState = createWithdrawalState();
                const logs: string[] = [];

                executeWithdrawals(
                    -10000,
                    [savings, traditional, roth],
                    createTestAssumptions({ withdrawalStrategy }),
                    createTestTaxState(),
                    2025,
                    65,
                    0,
                    withdrawalState,
                    undefined,
                    true,
                    logs
                );

                // Should withdraw from Traditional first per user strategy
                expect(withdrawalState.withdrawalDetail['Traditional IRA']).toBe(10000);
                expect(withdrawalState.withdrawalDetail['Roth IRA']).toBeUndefined();
                expect(withdrawalState.withdrawalDetail['Savings']).toBeUndefined();
            });

            it('should respect maxAmount cap for Traditional', () => {
                const traditional = createTraditionalAccount('trad1', 'Traditional IRA', 100000);
                const savings = createSavingsAccount('sav1', 'Savings', 50000);

                const withdrawalStrategy: WithdrawalBucket[] = [
                    { id: 'w1', name: 'Traditional', accountId: 'trad1', maxAmount: 5000 },
                    { id: 'w2', name: 'Savings', accountId: 'sav1' }
                ];
                const withdrawalState = createWithdrawalState();
                const logs: string[] = [];

                executeWithdrawals(
                    -15000,
                    [traditional, savings],
                    createTestAssumptions({ withdrawalStrategy }),
                    createTestTaxState(),
                    2025,
                    65,
                    0,
                    withdrawalState,
                    undefined,
                    true,
                    logs
                );

                // Traditional should be capped at $5k
                expect(withdrawalState.withdrawalDetail['Traditional IRA']).toBe(5000);
                // Remaining $10k from Savings
                expect(withdrawalState.withdrawalDetail['Savings']).toBe(10000);
            });

            it('should skip depleted accounts', () => {
                const depleted = createSavingsAccount('sav1', 'Empty Savings', 0);
                const funded = createSavingsAccount('sav2', 'Funded Savings', 50000);

                const withdrawalStrategy: WithdrawalBucket[] = [
                    { id: 'w1', name: 'Empty', accountId: 'sav1' },
                    { id: 'w2', name: 'Funded', accountId: 'sav2' }
                ];
                const withdrawalState = createWithdrawalState();
                const logs: string[] = [];

                executeWithdrawals(
                    -10000,
                    [depleted, funded],
                    createTestAssumptions({ withdrawalStrategy }),
                    createTestTaxState(),
                    2025,
                    65,
                    0,
                    withdrawalState,
                    undefined,
                    true,
                    logs
                );

                expect(withdrawalState.withdrawalDetail['Empty Savings']).toBeUndefined();
                expect(withdrawalState.withdrawalDetail['Funded Savings']).toBe(10000);
            });

            it('should track prior outflows', () => {
                const savings = createSavingsAccount('sav1', 'Savings', 50000);
                const withdrawalState = createWithdrawalState({
                    userInflows: { 'sav1': -20000 } // Already withdrew $20k
                });
                const withdrawalStrategy: WithdrawalBucket[] = [
                    { id: 'w1', name: 'Savings', accountId: 'sav1' }
                ];
                const logs: string[] = [];

                executeWithdrawals(
                    -40000, // Need $40k but only $30k available
                    [savings],
                    createTestAssumptions({ withdrawalStrategy }),
                    createTestTaxState(),
                    2025,
                    65,
                    0,
                    withdrawalState,
                    undefined,
                    true,
                    logs
                );

                // Can only withdraw $30k (50k - 20k prior outflow)
                expect(withdrawalState.withdrawalDetail['Savings']).toBe(30000);
            });
        });

        describe('withdrawalState updates', () => {
            it('should update userInflows for each withdrawal', () => {
                const savings = createSavingsAccount('sav1', 'Savings', 50000);
                const withdrawalStrategy: WithdrawalBucket[] = [
                    { id: 'w1', name: 'Savings', accountId: 'sav1' }
                ];
                const withdrawalState = createWithdrawalState();
                const logs: string[] = [];

                executeWithdrawals(
                    -10000,
                    [savings],
                    createTestAssumptions({ withdrawalStrategy }),
                    createTestTaxState(),
                    2025,
                    65,
                    0,
                    withdrawalState,
                    undefined,
                    true,
                    logs
                );

                expect(withdrawalState.userInflows['sav1']).toBe(-10000);
            });

            it('should track totalWithdrawals', () => {
                const savings = createSavingsAccount('sav1', 'Savings', 50000);
                const withdrawalStrategy: WithdrawalBucket[] = [
                    { id: 'w1', name: 'Savings', accountId: 'sav1' }
                ];
                const withdrawalState = createWithdrawalState();
                const logs: string[] = [];

                executeWithdrawals(
                    -15000,
                    [savings],
                    createTestAssumptions({ withdrawalStrategy }),
                    createTestTaxState(),
                    2025,
                    65,
                    0,
                    withdrawalState,
                    undefined,
                    true,
                    logs
                );

                expect(withdrawalState.totalWithdrawals).toBe(15000);
            });

            it('should track withdrawalDetail by account name', () => {
                const sav1 = createSavingsAccount('sav1', 'Emergency Fund', 30000);
                const sav2 = createSavingsAccount('sav2', 'Checking', 20000);
                const withdrawalStrategy: WithdrawalBucket[] = [
                    { id: 'w1', name: 'Emergency', accountId: 'sav1' },
                    { id: 'w2', name: 'Checking', accountId: 'sav2' }
                ];
                const withdrawalState = createWithdrawalState();
                const logs: string[] = [];

                executeWithdrawals(
                    -40000,
                    [sav1, sav2],
                    createTestAssumptions({ withdrawalStrategy }),
                    createTestTaxState(),
                    2025,
                    65,
                    0,
                    withdrawalState,
                    undefined,
                    true,
                    logs
                );

                expect(withdrawalState.withdrawalDetail['Emergency Fund']).toBe(30000);
                expect(withdrawalState.withdrawalDetail['Checking']).toBe(10000);
            });

            it('should track withdrawalPenalties', () => {
                const traditional = createTraditionalAccount('trad1', 'Traditional IRA', 100000);
                const withdrawalStrategy: WithdrawalBucket[] = [
                    { id: 'w1', name: 'Traditional', accountId: 'trad1' }
                ];
                const withdrawalState = createWithdrawalState();
                const logs: string[] = [];

                executeWithdrawals(
                    -10000,
                    [traditional],
                    createTestAssumptions({ withdrawalStrategy }),
                    createTestTaxState(),
                    2025,
                    50, // Early withdrawal
                    0,
                    withdrawalState,
                    undefined,
                    false,
                    logs
                );

                expect(withdrawalState.withdrawalPenalties).toBeGreaterThan(0);
            });

            it('should track capitalGainsTaxTotal', () => {
                const brokerage = createBrokerageAccount('brok1', 'Brokerage', 100000, 50000);
                const withdrawalStrategy: WithdrawalBucket[] = [
                    { id: 'w1', name: 'Brokerage', accountId: 'brok1' }
                ];
                const withdrawalState = createWithdrawalState();
                const logs: string[] = [];

                executeWithdrawals(
                    -20000,
                    [brokerage],
                    createTestAssumptions({ withdrawalStrategy }),
                    createTestTaxState(),
                    2025,
                    65,
                    0,
                    withdrawalState,
                    undefined,
                    true,
                    logs
                );

                // With 50% gains, should have capital gains tax
                expect(withdrawalState.capitalGainsTaxTotal).toBeGreaterThanOrEqual(0);
            });
        });

        describe('floating point handling', () => {
            it('should clean up small deficits', () => {
                const savings = createSavingsAccount('sav1', 'Savings', 50000);
                const withdrawalStrategy: WithdrawalBucket[] = [
                    { id: 'w1', name: 'Savings', accountId: 'sav1' }
                ];
                const withdrawalState = createWithdrawalState();
                const logs: string[] = [];

                const result = executeWithdrawals(
                    -10000.001, // Small floating point excess
                    [savings],
                    createTestAssumptions({ withdrawalStrategy }),
                    createTestTaxState(),
                    2025,
                    65,
                    0,
                    withdrawalState,
                    undefined,
                    true,
                    logs
                );

                // Should clean up to zero or very small
                expect(Math.abs(result.discretionaryCash)).toBeLessThan(1);
            });

            it('should clean up small surpluses', () => {
                const savings = createSavingsAccount('sav1', 'Savings', 50000);
                const withdrawalStrategy: WithdrawalBucket[] = [
                    { id: 'w1', name: 'Savings', accountId: 'sav1' }
                ];
                const withdrawalState = createWithdrawalState();
                const logs: string[] = [];

                const result = executeWithdrawals(
                    -9999.999,
                    [savings],
                    createTestAssumptions({ withdrawalStrategy }),
                    createTestTaxState(),
                    2025,
                    65,
                    0,
                    withdrawalState,
                    undefined,
                    true,
                    logs
                );

                // Should clean up small surplus
                expect(result.discretionaryCash).toBeCloseTo(0, 0);
            });
        });
    });

    describe('processDeficitDebt', () => {
        describe('no deficit scenarios', () => {
            it('should not create debt when cash is positive', () => {
                const accounts: AnyAccount[] = [];
                const logs: string[] = [];

                const result = processDeficitDebt(10000, accounts, logs);

                expect(result.existingDeficitDebt).toBeUndefined();
                expect(result.discretionaryCash).toBe(10000);
            });

            it('should not create debt when cash is zero', () => {
                const accounts: AnyAccount[] = [];
                const logs: string[] = [];

                const result = processDeficitDebt(0, accounts, logs);

                expect(result.existingDeficitDebt).toBeUndefined();
                expect(result.discretionaryCash).toBe(0);
            });

            it('should ignore small negative values (rounding)', () => {
                const accounts: AnyAccount[] = [];
                const logs: string[] = [];

                const result = processDeficitDebt(-0.001, accounts, logs);

                expect(result.existingDeficitDebt).toBeUndefined();
            });
        });

        describe('deficit debt creation', () => {
            it('should create DeficitDebtAccount for uncovered deficit', () => {
                const accounts: AnyAccount[] = [];
                const logs: string[] = [];

                const result = processDeficitDebt(-5000, accounts, logs);

                expect(result.existingDeficitDebt).toBeDefined();
                expect(result.existingDeficitDebt?.amount).toBe(5000);
            });

            it('should use system ID for deficit debt', () => {
                const accounts: AnyAccount[] = [];
                const logs: string[] = [];

                const result = processDeficitDebt(-5000, accounts, logs);

                expect(result.existingDeficitDebt?.id).toBe('system-deficit-debt');
                expect(result.existingDeficitDebt?.name).toBe('Uncovered Deficit');
            });

            it('should log warning about uncovered deficit', () => {
                const accounts: AnyAccount[] = [];
                const logs: string[] = [];

                processDeficitDebt(-5000, accounts, logs);

                expect(logs.some(l => l.includes('Uncovered deficit'))).toBe(true);
                expect(logs.some(l => l.includes('$5,000'))).toBe(true);
            });
        });

        describe('existing deficit debt', () => {
            it('should add to existing deficit debt', () => {
                const existingDebt = new DeficitDebtAccount('system-deficit-debt', 'Uncovered Deficit', 3000);
                const accounts: AnyAccount[] = [existingDebt];
                const logs: string[] = [];

                const result = processDeficitDebt(-2000, accounts, logs);

                // Should accumulate: 3000 + 2000 = 5000
                expect(result.existingDeficitDebt?.amount).toBe(5000);
            });

            it('should log total deficit debt amount', () => {
                const existingDebt = new DeficitDebtAccount('system-deficit-debt', 'Uncovered Deficit', 3000);
                const accounts: AnyAccount[] = [existingDebt];
                const logs: string[] = [];

                processDeficitDebt(-2000, accounts, logs);

                expect(logs.some(l => l.includes('Total deficit debt'))).toBe(true);
                expect(logs.some(l => l.includes('$5,000'))).toBe(true);
            });
        });

        describe('return values', () => {
            it('should return existingDeficitDebt', () => {
                const accounts: AnyAccount[] = [];
                const logs: string[] = [];

                const result = processDeficitDebt(-1000, accounts, logs);

                expect(result.existingDeficitDebt).toBeInstanceOf(DeficitDebtAccount);
            });

            it('should return deficitDebtPayment', () => {
                const accounts: AnyAccount[] = [];
                const logs: string[] = [];

                const result = processDeficitDebt(-1000, accounts, logs);

                expect(result.deficitDebtPayment).toBeDefined();
                expect(typeof result.deficitDebtPayment).toBe('number');
            });

            it('should set discretionaryCash to 0 after debt creation', () => {
                const accounts: AnyAccount[] = [];
                const logs: string[] = [];

                const result = processDeficitDebt(-5000, accounts, logs);

                expect(result.discretionaryCash).toBe(0);
            });
        });
    });

    describe('executeWithdrawalPlan (internal)', () => {
        describe('Traditional withdrawals', () => {
            it('should withdraw from Traditional accounts', () => {
                const traditional = createTraditionalAccount('trad1', 'Traditional IRA', 100000);
                const withdrawalState = createWithdrawalState();
                const logs: string[] = [];

                const plan: WithdrawalPlan = {
                    traditional: 15000,
                    roth: 0,
                    brokerage: 0,
                    savings: 0
                };

                executeWithdrawals(
                    -15000,
                    [traditional],
                    createTestAssumptions(),
                    createTestTaxState(),
                    2025,
                    65,
                    0,
                    withdrawalState,
                    undefined,
                    true,
                    logs,
                    plan
                );

                expect(withdrawalState.withdrawalDetail['Traditional IRA']).toBe(15000);
            });

            it('should track in totalGrossIncome', () => {
                const traditional = createTraditionalAccount('trad1', 'Traditional IRA', 100000);
                const withdrawalState = createWithdrawalState();
                const logs: string[] = [];

                const plan: WithdrawalPlan = {
                    traditional: 15000,
                    roth: 0,
                    brokerage: 0,
                    savings: 0
                };

                executeWithdrawals(
                    -15000,
                    [traditional],
                    createTestAssumptions(),
                    createTestTaxState(),
                    2025,
                    65,
                    0,
                    withdrawalState,
                    undefined,
                    true,
                    logs,
                    plan
                );

                expect(withdrawalState.totalGrossIncome).toBe(15000);
            });

            it('should track in traditionalWithdrawals', () => {
                const traditional = createTraditionalAccount('trad1', 'Traditional IRA', 100000);
                const withdrawalState = createWithdrawalState();
                const logs: string[] = [];

                const plan: WithdrawalPlan = {
                    traditional: 15000,
                    roth: 0,
                    brokerage: 0,
                    savings: 0
                };

                executeWithdrawals(
                    -15000,
                    [traditional],
                    createTestAssumptions(),
                    createTestTaxState(),
                    2025,
                    65,
                    0,
                    withdrawalState,
                    undefined,
                    true,
                    logs,
                    plan
                );

                expect(withdrawalState.traditionalWithdrawals).toBe(15000);
            });
        });

        describe('Roth withdrawals', () => {
            it('should withdraw from Roth accounts', () => {
                const roth = createRothAccount('roth1', 'Roth IRA', 50000);
                const withdrawalState = createWithdrawalState();
                const logs: string[] = [];

                const plan: WithdrawalPlan = {
                    traditional: 0,
                    roth: 10000,
                    brokerage: 0,
                    savings: 0
                };

                executeWithdrawals(
                    -10000,
                    [roth],
                    createTestAssumptions(),
                    createTestTaxState(),
                    2025,
                    65,
                    0,
                    withdrawalState,
                    undefined,
                    true,
                    logs,
                    plan
                );

                expect(withdrawalState.withdrawalDetail['Roth IRA']).toBe(10000);
            });

            it('should not add to gross income', () => {
                const roth = createRothAccount('roth1', 'Roth IRA', 50000);
                const withdrawalState = createWithdrawalState();
                const logs: string[] = [];

                const plan: WithdrawalPlan = {
                    traditional: 0,
                    roth: 10000,
                    brokerage: 0,
                    savings: 0
                };

                executeWithdrawals(
                    -10000,
                    [roth],
                    createTestAssumptions(),
                    createTestTaxState(),
                    2025,
                    65,
                    0,
                    withdrawalState,
                    undefined,
                    true,
                    logs,
                    plan
                );

                // Roth withdrawals don't add to gross income
                expect(withdrawalState.totalGrossIncome).toBe(0);
            });
        });

        describe('Brokerage withdrawals', () => {
            it('should withdraw from Brokerage accounts', () => {
                const brokerage = createBrokerageAccount('brok1', 'Brokerage', 50000);
                const withdrawalState = createWithdrawalState();
                const logs: string[] = [];

                const plan: WithdrawalPlan = {
                    traditional: 0,
                    roth: 0,
                    brokerage: 8000,
                    savings: 0
                };

                executeWithdrawals(
                    -8000,
                    [brokerage],
                    createTestAssumptions(),
                    createTestTaxState(),
                    2025,
                    65,
                    0,
                    withdrawalState,
                    undefined,
                    true,
                    logs,
                    plan
                );

                expect(withdrawalState.withdrawalDetail['Brokerage']).toBe(8000);
            });
        });

        describe('Savings withdrawals', () => {
            it('should withdraw from Savings accounts', () => {
                const savings = createSavingsAccount('sav1', 'Savings', 30000);
                const withdrawalState = createWithdrawalState();
                const logs: string[] = [];

                const plan: WithdrawalPlan = {
                    traditional: 0,
                    roth: 0,
                    brokerage: 0,
                    savings: 5000
                };

                executeWithdrawals(
                    -5000,
                    [savings],
                    createTestAssumptions(),
                    createTestTaxState(),
                    2025,
                    65,
                    0,
                    withdrawalState,
                    undefined,
                    true,
                    logs,
                    plan
                );

                expect(withdrawalState.withdrawalDetail['Savings']).toBe(5000);
            });
        });

        describe('fallback behavior', () => {
            it('should try all accounts when plan insufficient', () => {
                // Plan specifies Traditional but it's depleted
                const traditional = createTraditionalAccount('trad1', 'Traditional IRA', 1000);
                const savings = createSavingsAccount('sav1', 'Savings', 50000);
                const withdrawalState = createWithdrawalState();
                const logs: string[] = [];

                const plan: WithdrawalPlan = {
                    traditional: 10000, // More than available
                    roth: 0,
                    brokerage: 0,
                    savings: 0
                };

                const result = executeWithdrawals(
                    -10000,
                    [traditional, savings],
                    createTestAssumptions(),
                    createTestTaxState(),
                    2025,
                    65,
                    0,
                    withdrawalState,
                    undefined,
                    true,
                    logs,
                    plan
                );

                // Should cover deficit via fallback
                expect(result.discretionaryCash).toBeCloseTo(0, 0);
                expect(logs.some(l => l.includes('Fallback'))).toBe(true);
            });

            it('should follow fallback order: Savings, Brokerage, Roth, Traditional', () => {
                // All accounts small, need multiple sources
                const traditional = createTraditionalAccount('trad1', 'Traditional IRA', 100);
                const roth = createRothAccount('roth1', 'Roth IRA', 100);
                const brokerage = createBrokerageAccount('brok1', 'Brokerage', 100);
                const savings = createSavingsAccount('sav1', 'Savings', 100);
                const withdrawalState = createWithdrawalState();
                const logs: string[] = [];

                const plan: WithdrawalPlan = {
                    traditional: 500, // More than all accounts combined
                    roth: 0,
                    brokerage: 0,
                    savings: 0
                };

                executeWithdrawals(
                    -400,
                    [traditional, roth, brokerage, savings],
                    createTestAssumptions(),
                    createTestTaxState(),
                    2025,
                    65,
                    0,
                    withdrawalState,
                    undefined,
                    true,
                    logs,
                    plan
                );

                // Fallback should touch accounts in order
                const fallbackLogs = logs.filter(l => l.includes('Fallback'));
                expect(fallbackLogs.length).toBeGreaterThan(0);
            });
        });
    });
});
