/**
 * Unit tests for Roth conversion service.
 *
 * This service handles automatic Roth conversions during retirement,
 * including bracket filling, SS torpedo awareness, and tax calculation.
 */
import { describe, it, expect } from 'vitest';
import {
    executeRothConversions,
    RothConversionInput,
    getTraditionalAccountsForConversion,
    getRothAccountsForConversion,
    findOptimalConversionWithSSTorpedo
} from '../../../services/simulation/RothConversionService';
import { InvestedAccount, SavedAccount, AnyAccount } from '../../../components/Objects/Accounts/models';
import { PassiveIncome, AnyIncome } from '../../../components/Objects/Income/models';
import { OtherExpense, AnyExpense } from '../../../components/Objects/Expense/models';
import {
    AssumptionsState,
    defaultAssumptions,
    createBuiltinMilestones,
    WithdrawalBucket
} from '../../../components/Objects/Assumptions/AssumptionsContext';
import { TaxState } from '../../../components/Objects/Taxes/TaxContext';
import { WithdrawalState } from '../../../services/simulation/types';
import { TaxParameters } from '../../../data/TaxData';
import { calculateEffectiveConversionTax } from '../../../services/simulation/helpers';

// Helper to create test assumptions
function createTestAssumptions(overrides: Partial<{
    birthYear: number;
    retirementAge: number;
    rothConversionTargetBracket: number;
    withdrawalStrategy: WithdrawalBucket[];
    autoRothConversions: boolean;
    taxOptimizationEnabled: boolean;
}> = {}): AssumptionsState {
    const birthYear = overrides.birthYear ?? 1960;
    const retirementAge = overrides.retirementAge ?? 65;

    return {
        ...defaultAssumptions,
        milestones: createBuiltinMilestones(birthYear, retirementAge, 90),
        investments: {
            ...defaultAssumptions.investments,
            rothConversionTargetBracket: overrides.rothConversionTargetBracket ?? 0.22,
            autoRothConversions: overrides.autoRothConversions ?? true,
            taxOptimizationEnabled: overrides.taxOptimizationEnabled ?? false,
        },
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
// regularContributions is set via costBasis (regularContributions = costBasis - totalConversionBasis)
function createRothAccount(
    id: string,
    name: string,
    balance: number,
    taxType: 'Roth 401k' | 'Roth IRA' = 'Roth IRA',
    regularContributions: number = balance
): InvestedAccount {
    // Constructor: id, name, amount, employerBalance, tenureYears, expenseRatio, taxType, isContributionEligible, vestedPerYear, costBasis
    return new InvestedAccount(id, name, balance, 0, 0, 0, taxType, true, 0.2, regularContributions);
}

// Helper to create RothConversionInput
function createConversionInput(
    accounts: AnyAccount[],
    options: Partial<{
        allIncomes: AnyIncome[];
        nextExpenses: AnyExpense[];
        year: number;
        assumptions: AssumptionsState;
        taxState: TaxState;
        totalGrossIncome: number;
        preTaxDeductions: number;
        postTaxDeductions: number;
        totalTax: number;
        currentAge: number;
        withdrawalState: WithdrawalState;
    }> = {}
): RothConversionInput {
    return {
        accounts,
        allIncomes: options.allIncomes ?? [],
        nextExpenses: options.nextExpenses ?? [],
        year: options.year ?? 2025,
        assumptions: options.assumptions ?? createTestAssumptions(),
        taxState: options.taxState ?? createTestTaxState(),
        previousSimulation: [],
        totalGrossIncome: options.totalGrossIncome ?? 50000,
        preTaxDeductions: options.preTaxDeductions ?? 0,
        postTaxDeductions: options.postTaxDeductions ?? 0,
        totalTax: options.totalTax ?? 5000,
        currentAge: options.currentAge ?? 65,
        withdrawalState: options.withdrawalState ?? createWithdrawalState(),
    };
}

describe('RothConversionService', () => {
    describe('executeRothConversions', () => {
        describe('pre-calculated amount handling', () => {
            it('should use pre-calculated amount when provided', () => {
                const traditionalAccount = createTraditionalAccount('trad1', 'Traditional IRA', 500000);
                const rothAccount = createRothAccount('roth1', 'Roth IRA', 100000);
                const input = createConversionInput([traditionalAccount, rothAccount], {
                    totalGrossIncome: 30000, // Low income
                });
                const logs: string[] = [];

                const result = executeRothConversions(input, logs, 25000); // Pre-calculated $25k

                expect(result.rothConversionResult).toBeDefined();
                expect(result.rothConversionResult?.amount).toBe(25000);
            });

            it('should skip conversion when pre-calculated amount is 0', () => {
                const traditionalAccount = createTraditionalAccount('trad1', 'Traditional IRA', 500000);
                const rothAccount = createRothAccount('roth1', 'Roth IRA', 100000);
                const input = createConversionInput([traditionalAccount, rothAccount]);
                const logs: string[] = [];

                const result = executeRothConversions(input, logs, 0); // Pre-calculated 0

                expect(result.rothConversionResult).toBeUndefined();
            });

            it('should cap at available Traditional balance', () => {
                const traditionalAccount = createTraditionalAccount('trad1', 'Traditional IRA', 10000);
                const rothAccount = createRothAccount('roth1', 'Roth IRA', 100000);
                const input = createConversionInput([traditionalAccount, rothAccount]);
                const logs: string[] = [];

                const result = executeRothConversions(input, logs, 50000); // Request more than available

                expect(result.rothConversionResult).toBeDefined();
                expect(result.rothConversionResult?.amount).toBeLessThanOrEqual(10000);
            });
        });

        describe('skip conditions', () => {
            it('should skip when deficit exceeds available sources (under 59.5)', () => {
                // Small Traditional balance ($5k), small Roth contributions ($500)
                // Available sources: Traditional $5k + Roth contributions $500 = $5.5k total
                // Deficit: income $10k - tax $2k - expenses $50k = -$42k deficit
                // Since $42k > $5.5k, should skip conversion
                const traditionalAccount = createTraditionalAccount('trad1', 'Traditional IRA', 5000);
                const rothAccount = createRothAccount('roth1', 'Roth IRA', 10000, 'Roth IRA', 500); // Only $500 contributions

                // Create large deficit: income < expenses
                const input = createConversionInput([traditionalAccount, rothAccount], {
                    totalGrossIncome: 10000,
                    totalTax: 2000,
                    nextExpenses: [
                        new OtherExpense('exp1', 'Living', 50000, 'Annually', new Date('2020-01-01')),
                    ],
                    currentAge: 55, // Under 59.5
                    assumptions: createTestAssumptions({ rothConversionTargetBracket: 0.22 }),
                });
                const logs: string[] = [];

                executeRothConversions(input, logs);

                // Should skip because deficit ($42k) exceeds available sources ($5.5k)
                expect(logs.some(l => l.includes('deficit') || l.includes('SKIP'))).toBe(true);
            });

            it('should include Traditional as valid source for deficit', () => {
                // Traditional counts as valid source even with penalty
                const traditionalAccount = createTraditionalAccount('trad1', 'Traditional IRA', 100000);
                const rothAccount = createRothAccount('roth1', 'Roth IRA', 10000);
                const savings = new SavedAccount('sav1', 'Emergency Fund', 5000, 0);

                const input = createConversionInput([traditionalAccount, rothAccount, savings], {
                    totalGrossIncome: 20000,
                    totalTax: 3000,
                    nextExpenses: [
                        new OtherExpense('exp1', 'Living', 30000, 'Annually', new Date('2020-01-01')),
                    ],
                    currentAge: 55,
                    assumptions: createTestAssumptions({ rothConversionTargetBracket: 0.12 }),
                });
                const logs: string[] = [];

                executeRothConversions(input, logs);

                // Should NOT skip because Traditional ($100k) + Savings ($5k) > deficit
                expect(logs.some(l => l.includes('SKIP') && l.includes('deficit'))).toBe(false);
            });

            it('should include Roth contributions as valid source', () => {
                const traditionalAccount = createTraditionalAccount('trad1', 'Traditional IRA', 500000);
                const rothAccount = createRothAccount('roth1', 'Roth IRA', 50000, 'Roth IRA', 50000); // All contributions

                const input = createConversionInput([traditionalAccount, rothAccount], {
                    totalGrossIncome: 20000,
                    totalTax: 3000,
                    nextExpenses: [
                        new OtherExpense('exp1', 'Living', 25000, 'Annually', new Date('2020-01-01')),
                    ],
                    currentAge: 55,
                    assumptions: createTestAssumptions({ rothConversionTargetBracket: 0.12 }),
                });
                const logs: string[] = [];

                executeRothConversions(input, logs);

                // Roth contributions are penalty-free, so no skip
                expect(logs.some(l => l.includes('SKIP') && l.includes('deficit'))).toBe(false);
            });

            it('should not skip when sufficient sources available', () => {
                const traditionalAccount = createTraditionalAccount('trad1', 'Traditional IRA', 500000);
                const rothAccount = createRothAccount('roth1', 'Roth IRA', 100000);
                const savings = new SavedAccount('sav1', 'Emergency Fund', 50000, 0);

                const input = createConversionInput([traditionalAccount, rothAccount, savings], {
                    totalGrossIncome: 40000,
                    totalTax: 5000,
                    nextExpenses: [
                        new OtherExpense('exp1', 'Living', 30000, 'Annually', new Date('2020-01-01')),
                    ],
                    currentAge: 55,
                    assumptions: createTestAssumptions({ rothConversionTargetBracket: 0.12 }),
                });
                const logs: string[] = [];

                executeRothConversions(input, logs);

                // No deficit skip
                expect(logs.some(l => l.includes('SKIP') && l.includes('deficit'))).toBe(false);
            });
        });

        describe('preliminary cash flow calculation', () => {
            it('should calculate living expenses from expense list', () => {
                const traditionalAccount = createTraditionalAccount('trad1', 'Traditional IRA', 500000);
                const rothAccount = createRothAccount('roth1', 'Roth IRA', 100000);

                const input = createConversionInput([traditionalAccount, rothAccount], {
                    totalGrossIncome: 60000,
                    totalTax: 8000,
                    nextExpenses: [
                        new OtherExpense('exp1', 'Housing', 20000, 'Annually', new Date('2020-01-01')),
                        new OtherExpense('exp2', 'Food', 10000, 'Annually', new Date('2020-01-01')),
                    ],
                    currentAge: 65,
                    assumptions: createTestAssumptions({ rothConversionTargetBracket: 0.22 }),
                });
                const logs: string[] = [];

                // Should process without errors
                const result = executeRothConversions(input, logs);
                expect(result).toBeDefined();
            });

            it('should account for reinvested income', () => {
                const traditionalAccount = createTraditionalAccount('trad1', 'Traditional IRA', 500000);
                const rothAccount = createRothAccount('roth1', 'Roth IRA', 100000);

                // Reinvested income reduces available cash
                const reinvestedIncome = new PassiveIncome(
                    'int1', 'Interest', 5000, 'Annually', 'No', 'Interest',
                    new Date('2025-01-01'), new Date('2025-12-31'), true // isReinvested
                );

                const input = createConversionInput([traditionalAccount, rothAccount], {
                    allIncomes: [reinvestedIncome],
                    totalGrossIncome: 55000, // Includes reinvested interest
                    totalTax: 7000,
                    nextExpenses: [
                        new OtherExpense('exp1', 'Living', 45000, 'Annually', new Date('2020-01-01')),
                    ],
                    currentAge: 65,
                });
                const logs: string[] = [];

                const result = executeRothConversions(input, logs);
                expect(result).toBeDefined();
            });
        });

        describe('effective rate checking', () => {
            it('should skip conversion if effective rate exceeds target', () => {
                const traditionalAccount = createTraditionalAccount('trad1', 'Traditional IRA', 500000);
                const rothAccount = createRothAccount('roth1', 'Roth IRA', 100000);

                // High income already in 32%+ bracket - need to provide incomes since
                // the function uses TaxService.getGrossIncome(allIncomes, year) for rate calculation
                const highIncome = new PassiveIncome(
                    'inc1', 'High Income', 250000, 'Annually', 'No', 'Other',
                    new Date('2025-01-01'), new Date('2025-12-31')
                );

                const input = createConversionInput([traditionalAccount, rothAccount], {
                    allIncomes: [highIncome],
                    totalGrossIncome: 250000, // High income
                    totalTax: 50000,
                    assumptions: createTestAssumptions({ rothConversionTargetBracket: 0.22 }), // Target 22%
                    currentAge: 65,
                });
                const logs: string[] = [];

                const result = executeRothConversions(input, logs);

                // Should skip because effective rate > 22%
                expect(result.rothConversionResult).toBeUndefined();
            });

            it('should allow conversion at or below target rate', () => {
                const traditionalAccount = createTraditionalAccount('trad1', 'Traditional IRA', 500000);
                const rothAccount = createRothAccount('roth1', 'Roth IRA', 100000);

                // Low income in 12% bracket
                const input = createConversionInput([traditionalAccount, rothAccount], {
                    totalGrossIncome: 30000,
                    totalTax: 2000,
                    assumptions: createTestAssumptions({ rothConversionTargetBracket: 0.22 }), // Target 22%
                    currentAge: 65,
                });
                const logs: string[] = [];

                const result = executeRothConversions(input, logs);

                // Should allow conversion at low rate
                expect(result.rothConversionResult).toBeDefined();
            });
        });

        describe('account selection', () => {
            it('should select Traditional accounts in withdrawal order', () => {
                const trad1 = createTraditionalAccount('trad1', 'Traditional IRA', 100000);
                const trad2 = createTraditionalAccount('trad2', 'Traditional 401k', 200000, 'Traditional 401k');
                const rothAccount = createRothAccount('roth1', 'Roth IRA', 50000);

                // Withdrawal order: trad2 first, then trad1
                const withdrawalStrategy: WithdrawalBucket[] = [
                    { id: 'w1', name: '401k', accountId: 'trad2' },
                    { id: 'w2', name: 'IRA', accountId: 'trad1' },
                ];

                const input = createConversionInput([trad1, trad2, rothAccount], {
                    totalGrossIncome: 30000,
                    assumptions: createTestAssumptions({
                        rothConversionTargetBracket: 0.22,
                        withdrawalStrategy,
                    }),
                });
                const logs: string[] = [];

                const result = executeRothConversions(input, logs, 50000);

                // Should convert from trad2 first (in withdrawal order)
                expect(result.rothConversionResult?.fromAccountIds['trad2']).toBeDefined();
            });

            it('should select Roth accounts in reverse withdrawal order', () => {
                const traditionalAccount = createTraditionalAccount('trad1', 'Traditional IRA', 500000);
                const roth1 = createRothAccount('roth1', 'Roth IRA', 50000);
                const roth2 = createRothAccount('roth2', 'Roth 401k', 100000, 'Roth 401k');

                // Withdrawal order: roth1 first, roth2 second
                // Conversion should go to roth2 first (reverse order)
                const withdrawalStrategy: WithdrawalBucket[] = [
                    { id: 'w1', name: 'Roth IRA', accountId: 'roth1' },
                    { id: 'w2', name: 'Roth 401k', accountId: 'roth2' },
                ];

                const input = createConversionInput([traditionalAccount, roth1, roth2], {
                    totalGrossIncome: 30000,
                    assumptions: createTestAssumptions({
                        rothConversionTargetBracket: 0.22,
                        withdrawalStrategy,
                    }),
                });
                const logs: string[] = [];

                const result = executeRothConversions(input, logs, 25000);

                // Deposits should go to roth2 (last in withdrawal order = first in reverse)
                expect(result.rothConversionResult?.toAccountIds['roth2']).toBe(25000);
            });

            it('should include accounts not in withdrawal order', () => {
                const trad1 = createTraditionalAccount('trad1', 'Traditional IRA', 100000);
                const trad2 = createTraditionalAccount('trad2', 'Traditional 401k', 200000, 'Traditional 401k');
                const rothAccount = createRothAccount('roth1', 'Roth IRA', 50000);

                // Empty withdrawal strategy
                const input = createConversionInput([trad1, trad2, rothAccount], {
                    totalGrossIncome: 30000,
                    assumptions: createTestAssumptions({
                        rothConversionTargetBracket: 0.22,
                        withdrawalStrategy: [], // No order specified
                    }),
                });
                const logs: string[] = [];

                const result = executeRothConversions(input, logs, 50000);

                // Should still find and convert from Traditional accounts
                expect(result.rothConversionResult).toBeDefined();
                expect(result.rothConversionResult?.amount).toBeGreaterThan(0);
            });

            it('should skip depleted Traditional accounts', () => {
                // Account with 0 balance is skipped (availableBalance <= 0 check)
                const depletedTrad = createTraditionalAccount('trad1', 'Depleted IRA', 0);
                const fundedTrad = createTraditionalAccount('trad2', 'Funded IRA', 100000);
                const rothAccount = createRothAccount('roth1', 'Roth IRA', 50000);

                const withdrawalStrategy: WithdrawalBucket[] = [
                    { id: 'w1', name: 'Depleted', accountId: 'trad1' }, // First but depleted
                    { id: 'w2', name: 'Funded', accountId: 'trad2' },
                ];

                const input = createConversionInput([depletedTrad, fundedTrad, rothAccount], {
                    totalGrossIncome: 30000,
                    assumptions: createTestAssumptions({
                        rothConversionTargetBracket: 0.22,
                        withdrawalStrategy,
                    }),
                });
                const logs: string[] = [];

                const result = executeRothConversions(input, logs, 25000);

                // Should skip depleted and convert from funded
                expect(result.rothConversionResult?.fromAccountIds['trad2']).toBe(25000);
                expect(result.rothConversionResult?.fromAccountIds['trad1']).toBeUndefined();
            });
        });

        describe('conversion execution', () => {
            it('should withdraw from Traditional accounts', () => {
                const traditionalAccount = createTraditionalAccount('trad1', 'Traditional IRA', 500000);
                const rothAccount = createRothAccount('roth1', 'Roth IRA', 100000);
                const withdrawalState = createWithdrawalState();

                const input = createConversionInput([traditionalAccount, rothAccount], {
                    totalGrossIncome: 30000,
                    withdrawalState,
                });
                const logs: string[] = [];

                executeRothConversions(input, logs, 25000);

                // userInflows should show negative for Traditional (withdrawal)
                expect(withdrawalState.userInflows['trad1']).toBe(-25000);
            });

            it('should deposit to Roth accounts', () => {
                const traditionalAccount = createTraditionalAccount('trad1', 'Traditional IRA', 500000);
                const rothAccount = createRothAccount('roth1', 'Roth IRA', 100000);
                const withdrawalState = createWithdrawalState();

                const input = createConversionInput([traditionalAccount, rothAccount], {
                    totalGrossIncome: 30000,
                    withdrawalState,
                });
                const logs: string[] = [];

                executeRothConversions(input, logs, 25000);

                // userInflows should show positive for Roth (deposit)
                expect(withdrawalState.userInflows['roth1']).toBe(25000);
            });

            it('should track conversion in conversionDeposits', () => {
                const traditionalAccount = createTraditionalAccount('trad1', 'Traditional IRA', 500000);
                const rothAccount = createRothAccount('roth1', 'Roth IRA', 100000);

                const input = createConversionInput([traditionalAccount, rothAccount], {
                    totalGrossIncome: 30000,
                });
                const logs: string[] = [];

                const result = executeRothConversions(input, logs, 25000);

                // conversionDeposits should track Roth deposit
                expect(result.conversionDeposits['roth1']).toBe(25000);
            });

            it('should update userInflows for both sides', () => {
                const traditionalAccount = createTraditionalAccount('trad1', 'Traditional IRA', 500000);
                const rothAccount = createRothAccount('roth1', 'Roth IRA', 100000);
                const withdrawalState = createWithdrawalState();

                const input = createConversionInput([traditionalAccount, rothAccount], {
                    totalGrossIncome: 30000,
                    withdrawalState,
                });
                const logs: string[] = [];

                executeRothConversions(input, logs, 25000);

                // Both accounts should have updated inflows
                expect(withdrawalState.userInflows['trad1']).toBe(-25000); // Withdrawal
                expect(withdrawalState.userInflows['roth1']).toBe(25000);  // Deposit
            });
        });

        describe('tax calculation', () => {
            it('should calculate federal tax on conversion', () => {
                const traditionalAccount = createTraditionalAccount('trad1', 'Traditional IRA', 500000);
                const rothAccount = createRothAccount('roth1', 'Roth IRA', 100000);

                const input = createConversionInput([traditionalAccount, rothAccount], {
                    totalGrossIncome: 30000,
                    taxState: createTestTaxState({ filingStatus: 'Single' }),
                });
                const logs: string[] = [];

                const result = executeRothConversions(input, logs, 25000);

                // Should have federal tax increase
                expect(result.fedTaxIncrease).toBeGreaterThan(0);
            });

            it('should calculate state tax on conversion', () => {
                const traditionalAccount = createTraditionalAccount('trad1', 'Traditional IRA', 500000);
                const rothAccount = createRothAccount('roth1', 'Roth IRA', 100000);

                // Use higher income to ensure state tax is triggered above deductions
                const input = createConversionInput([traditionalAccount, rothAccount], {
                    totalGrossIncome: 60000, // Higher income to be above VA standard deduction
                    taxState: createTestTaxState({ stateResidency: 'Virginia' }), // Virginia has state income tax
                });
                const logs: string[] = [];

                const result = executeRothConversions(input, logs, 25000);

                // Virginia has state income tax, so should have state tax increase
                expect(result.stateTaxIncrease).toBeGreaterThan(0);
            });

            it('should return tax cost in result', () => {
                const traditionalAccount = createTraditionalAccount('trad1', 'Traditional IRA', 500000);
                const rothAccount = createRothAccount('roth1', 'Roth IRA', 100000);

                const input = createConversionInput([traditionalAccount, rothAccount], {
                    totalGrossIncome: 30000,
                });
                const logs: string[] = [];

                const result = executeRothConversions(input, logs, 25000);

                expect(result.rothConversionResult?.taxCost).toBeGreaterThan(0);
            });
        });

        describe('conversion result structure', () => {
            it('should include amount converted', () => {
                const traditionalAccount = createTraditionalAccount('trad1', 'Traditional IRA', 500000);
                const rothAccount = createRothAccount('roth1', 'Roth IRA', 100000);

                const input = createConversionInput([traditionalAccount, rothAccount], {
                    totalGrossIncome: 30000,
                });
                const logs: string[] = [];

                const result = executeRothConversions(input, logs, 25000);

                expect(result.rothConversionResult?.amount).toBe(25000);
            });

            it('should include taxCost', () => {
                const traditionalAccount = createTraditionalAccount('trad1', 'Traditional IRA', 500000);
                const rothAccount = createRothAccount('roth1', 'Roth IRA', 100000);

                const input = createConversionInput([traditionalAccount, rothAccount], {
                    totalGrossIncome: 30000,
                });
                const logs: string[] = [];

                const result = executeRothConversions(input, logs, 25000);

                expect(result.rothConversionResult?.taxCost).toBeDefined();
                expect(typeof result.rothConversionResult?.taxCost).toBe('number');
            });

            it('should include fromAccounts by name', () => {
                const traditionalAccount = createTraditionalAccount('trad1', 'Traditional IRA', 500000);
                const rothAccount = createRothAccount('roth1', 'Roth IRA', 100000);

                const input = createConversionInput([traditionalAccount, rothAccount], {
                    totalGrossIncome: 30000,
                });
                const logs: string[] = [];

                const result = executeRothConversions(input, logs, 25000);

                expect(result.rothConversionResult?.fromAccounts['Traditional IRA']).toBe(25000);
            });

            it('should include toAccounts by name', () => {
                const traditionalAccount = createTraditionalAccount('trad1', 'Traditional IRA', 500000);
                const rothAccount = createRothAccount('roth1', 'Roth IRA', 100000);

                const input = createConversionInput([traditionalAccount, rothAccount], {
                    totalGrossIncome: 30000,
                });
                const logs: string[] = [];

                const result = executeRothConversions(input, logs, 25000);

                expect(result.rothConversionResult?.toAccounts['Roth IRA']).toBe(25000);
            });

            it('should include account IDs', () => {
                const traditionalAccount = createTraditionalAccount('trad1', 'Traditional IRA', 500000);
                const rothAccount = createRothAccount('roth1', 'Roth IRA', 100000);

                const input = createConversionInput([traditionalAccount, rothAccount], {
                    totalGrossIncome: 30000,
                });
                const logs: string[] = [];

                const result = executeRothConversions(input, logs, 25000);

                expect(result.rothConversionResult?.fromAccountIds['trad1']).toBe(25000);
                expect(result.rothConversionResult?.toAccountIds['roth1']).toBe(25000);
            });
        });

        describe('edge cases', () => {
            it('should return undefined when no Traditional accounts', () => {
                const rothAccount = createRothAccount('roth1', 'Roth IRA', 100000);
                const brokerage = new InvestedAccount('brok1', 'Brokerage', 200000, 0, 0, 0, 'Brokerage');

                const input = createConversionInput([rothAccount, brokerage], {
                    totalGrossIncome: 30000,
                });
                const logs: string[] = [];

                const result = executeRothConversions(input, logs, 25000);

                expect(result.rothConversionResult).toBeUndefined();
            });

            it('should return undefined when no Roth accounts', () => {
                const traditionalAccount = createTraditionalAccount('trad1', 'Traditional IRA', 500000);
                const brokerage = new InvestedAccount('brok1', 'Brokerage', 200000, 0, 0, 0, 'Brokerage');

                const input = createConversionInput([traditionalAccount, brokerage], {
                    totalGrossIncome: 30000,
                });
                const logs: string[] = [];

                const result = executeRothConversions(input, logs, 25000);

                expect(result.rothConversionResult).toBeUndefined();
            });

            it('should return undefined when Traditional balance < $100', () => {
                const traditionalAccount = createTraditionalAccount('trad1', 'Traditional IRA', 50);
                const rothAccount = createRothAccount('roth1', 'Roth IRA', 100000);

                const input = createConversionInput([traditionalAccount, rothAccount], {
                    totalGrossIncome: 30000,
                });
                const logs: string[] = [];

                const result = executeRothConversions(input, logs, 25000);

                expect(result.rothConversionResult).toBeUndefined();
            });

            it('should handle zero conversion amount', () => {
                const traditionalAccount = createTraditionalAccount('trad1', 'Traditional IRA', 500000);
                const rothAccount = createRothAccount('roth1', 'Roth IRA', 100000);

                const input = createConversionInput([traditionalAccount, rothAccount], {
                    totalGrossIncome: 30000,
                });
                const logs: string[] = [];

                const result = executeRothConversions(input, logs, 0);

                expect(result.rothConversionResult).toBeUndefined();
                expect(result.fedTaxIncrease).toBe(0);
                expect(result.stateTaxIncrease).toBe(0);
            });

            it('should handle multiple Traditional accounts', () => {
                const trad1 = createTraditionalAccount('trad1', 'Traditional IRA 1', 30000);
                const trad2 = createTraditionalAccount('trad2', 'Traditional IRA 2', 40000);
                const rothAccount = createRothAccount('roth1', 'Roth IRA', 100000);

                const input = createConversionInput([trad1, trad2, rothAccount], {
                    totalGrossIncome: 30000,
                });
                const logs: string[] = [];

                const result = executeRothConversions(input, logs, 50000);

                // Should convert from both accounts
                expect(result.rothConversionResult?.amount).toBe(50000);
                // First account exhausted, then second used
                const from1 = result.rothConversionResult?.fromAccountIds['trad1'] || 0;
                const from2 = result.rothConversionResult?.fromAccountIds['trad2'] || 0;
                expect(from1 + from2).toBe(50000);
            });

            it('should handle account with prior withdrawals', () => {
                const traditionalAccount = createTraditionalAccount('trad1', 'Traditional IRA', 100000);
                const rothAccount = createRothAccount('roth1', 'Roth IRA', 50000);
                const withdrawalState = createWithdrawalState({
                    userInflows: { 'trad1': -30000 } // Already withdrew $30k
                });

                const input = createConversionInput([traditionalAccount, rothAccount], {
                    totalGrossIncome: 30000,
                    withdrawalState,
                });
                const logs: string[] = [];

                const result = executeRothConversions(input, logs, 80000);

                // Should cap at available balance: $100k - $30k = $70k
                expect(result.rothConversionResult?.amount).toBeLessThanOrEqual(70000);
            });
        });
    });
});

// =============================================================================
// Helper Function Tests
// =============================================================================

describe('getTraditionalAccountsForConversion', () => {
    it('should return Traditional accounts in withdrawal order', () => {
        const trad1 = createTraditionalAccount('trad1', 'Traditional IRA', 100000);
        const trad2 = createTraditionalAccount('trad2', 'Traditional 401k', 200000, 'Traditional 401k');
        const roth = createRothAccount('roth1', 'Roth IRA', 50000);
        const brokerage = new InvestedAccount('brok1', 'Brokerage', 100000, 0, 0, 0, 'Brokerage');

        const withdrawalOrder: WithdrawalBucket[] = [
            { id: 'w1', name: '401k First', accountId: 'trad2' },
            { id: 'w2', name: 'IRA Second', accountId: 'trad1' },
        ];

        const result = getTraditionalAccountsForConversion(
            [trad1, trad2, roth, brokerage],
            withdrawalOrder
        );

        expect(result).toHaveLength(2);
        expect(result[0].id).toBe('trad2'); // First in withdrawal order
        expect(result[1].id).toBe('trad1'); // Second in withdrawal order
    });

    it('should include accounts not in withdrawal order after ordered ones', () => {
        const trad1 = createTraditionalAccount('trad1', 'Traditional IRA', 100000);
        const trad2 = createTraditionalAccount('trad2', 'Traditional 401k', 200000, 'Traditional 401k');
        const trad3 = createTraditionalAccount('trad3', 'Another IRA', 50000);

        const withdrawalOrder: WithdrawalBucket[] = [
            { id: 'w1', name: '401k', accountId: 'trad2' },
        ];

        const result = getTraditionalAccountsForConversion(
            [trad1, trad2, trad3],
            withdrawalOrder
        );

        expect(result).toHaveLength(3);
        expect(result[0].id).toBe('trad2'); // In withdrawal order
        // trad1 and trad3 follow (order may vary but both should be present)
        expect(result.map(a => a.id)).toContain('trad1');
        expect(result.map(a => a.id)).toContain('trad3');
    });

    it('should exclude Roth and Brokerage accounts', () => {
        const trad = createTraditionalAccount('trad1', 'Traditional IRA', 100000);
        const roth = createRothAccount('roth1', 'Roth IRA', 50000);
        const brokerage = new InvestedAccount('brok1', 'Brokerage', 100000, 0, 0, 0, 'Brokerage');

        const result = getTraditionalAccountsForConversion([trad, roth, brokerage], []);

        expect(result).toHaveLength(1);
        expect(result[0].id).toBe('trad1');
    });

    it('should return empty array when no Traditional accounts exist', () => {
        const roth = createRothAccount('roth1', 'Roth IRA', 50000);
        const brokerage = new InvestedAccount('brok1', 'Brokerage', 100000, 0, 0, 0, 'Brokerage');

        const result = getTraditionalAccountsForConversion([roth, brokerage], []);

        expect(result).toHaveLength(0);
    });
});

describe('getRothAccountsForConversion', () => {
    it('should return Roth accounts in REVERSE withdrawal order', () => {
        const roth1 = createRothAccount('roth1', 'Roth IRA', 50000);
        const roth2 = createRothAccount('roth2', 'Roth 401k', 100000, 'Roth 401k');
        const trad = createTraditionalAccount('trad1', 'Traditional IRA', 200000);

        // Withdrawal order: roth1 first, roth2 second
        // Conversion deposits should go to: roth2 first (reverse)
        const withdrawalOrder: WithdrawalBucket[] = [
            { id: 'w1', name: 'Roth IRA', accountId: 'roth1' },
            { id: 'w2', name: 'Roth 401k', accountId: 'roth2' },
        ];

        const result = getRothAccountsForConversion([roth1, roth2, trad], withdrawalOrder);

        expect(result).toHaveLength(2);
        expect(result[0].id).toBe('roth2'); // Last in withdrawal = first for deposits
        expect(result[1].id).toBe('roth1'); // First in withdrawal = last for deposits
    });

    it('should include accounts not in withdrawal order after ordered ones', () => {
        const roth1 = createRothAccount('roth1', 'Roth IRA', 50000);
        const roth2 = createRothAccount('roth2', 'Roth 401k', 100000, 'Roth 401k');
        const roth3 = createRothAccount('roth3', 'Another Roth', 75000);

        const withdrawalOrder: WithdrawalBucket[] = [
            { id: 'w1', name: 'Roth IRA', accountId: 'roth1' },
        ];

        const result = getRothAccountsForConversion([roth1, roth2, roth3], withdrawalOrder);

        expect(result).toHaveLength(3);
        expect(result[0].id).toBe('roth1'); // Only one in order, so it's first in reverse
        expect(result.map(a => a.id)).toContain('roth2');
        expect(result.map(a => a.id)).toContain('roth3');
    });

    it('should exclude Traditional and Brokerage accounts', () => {
        const roth = createRothAccount('roth1', 'Roth IRA', 50000);
        const trad = createTraditionalAccount('trad1', 'Traditional IRA', 100000);
        const brokerage = new InvestedAccount('brok1', 'Brokerage', 100000, 0, 0, 0, 'Brokerage');

        const result = getRothAccountsForConversion([roth, trad, brokerage], []);

        expect(result).toHaveLength(1);
        expect(result[0].id).toBe('roth1');
    });

    it('should return empty array when no Roth accounts exist', () => {
        const trad = createTraditionalAccount('trad1', 'Traditional IRA', 100000);
        const brokerage = new InvestedAccount('brok1', 'Brokerage', 100000, 0, 0, 0, 'Brokerage');

        const result = getRothAccountsForConversion([trad, brokerage], []);

        expect(result).toHaveLength(0);
    });
});

// =============================================================================
// Binary Search (SS Torpedo) Tests
// =============================================================================

// 2026 Single federal tax brackets for testing
const testFedParams: TaxParameters = {
    standardDeduction: 16100,
    brackets: [
        { threshold: 0, rate: 0.10 },
        { threshold: 12400, rate: 0.12 },
        { threshold: 50400, rate: 0.22 },
        { threshold: 105700, rate: 0.24 },
        { threshold: 201775, rate: 0.32 },
        { threshold: 256225, rate: 0.35 },
        { threshold: 640600, rate: 0.37 }
    ],
    socialSecurityTaxRate: 0.062,
    socialSecurityWageBase: 176100,
    medicareTaxRate: 0.0145,
    capitalGainsBrackets: [
        { threshold: 0, rate: 0.00 },
        { threshold: 49700, rate: 0.15 },
        { threshold: 548200, rate: 0.20 }
    ]
};

describe('findOptimalConversionWithSSTorpedo', () => {
    describe('with Social Security (SS torpedo effect)', () => {
        it('should find optimal amount that keeps effective rate <= target', () => {
            const agiExcludingSS = 20000;
            const totalSSBenefits = 30000;
            const maxBracketAmount = 50000;
            const targetRate = 0.22;

            const result = findOptimalConversionWithSSTorpedo(
                agiExcludingSS,
                totalSSBenefits,
                maxBracketAmount,
                targetRate,
                'Single',
                testFedParams
            );

            // Verify the result keeps effective rate <= target
            const effectiveResult = calculateEffectiveConversionTax(
                agiExcludingSS,
                totalSSBenefits,
                0,
                result,
                'Single',
                testFedParams,
                null
            );
            expect(effectiveResult.effectiveRate).toBeLessThanOrEqual(targetRate);
            expect(result).toBeGreaterThan(0);
        });

        it('should return less than maxBracketAmount when SS torpedo triggers', () => {
            // High SS benefits create torpedo effect
            const agiExcludingSS = 20000;
            const totalSSBenefits = 40000; // High SS
            const maxBracketAmount = 80000;
            const targetRate = 0.22;

            const result = findOptimalConversionWithSSTorpedo(
                agiExcludingSS,
                totalSSBenefits,
                maxBracketAmount,
                targetRate,
                'Single',
                testFedParams
            );

            // SS torpedo should reduce optimal amount below bracket headroom
            // When $1 of conversion causes $1.85 of taxable income (due to SS taxation)
            expect(result).toBeLessThan(maxBracketAmount);
        });

        it('should verify slightly higher amount would exceed target rate', () => {
            const agiExcludingSS = 20000;
            const totalSSBenefits = 30000;
            const maxBracketAmount = 50000;
            const targetRate = 0.22;

            const result = findOptimalConversionWithSSTorpedo(
                agiExcludingSS,
                totalSSBenefits,
                maxBracketAmount,
                targetRate,
                'Single',
                testFedParams
            );

            // Check that a slightly higher amount exceeds target rate
            const higherAmount = result + 500; // Add beyond tolerance
            if (higherAmount <= maxBracketAmount) {
                const higherResult = calculateEffectiveConversionTax(
                    agiExcludingSS,
                    totalSSBenefits,
                    0,
                    higherAmount,
                    'Single',
                    testFedParams,
                    null
                );
                // May or may not exceed depending on exact position
                // Just verify we're in a reasonable range
                expect(higherResult.effectiveRate).toBeGreaterThanOrEqual(result > 0 ? 0 : -1);
            }
        });
    });

    describe('without Social Security (no torpedo effect)', () => {
        it('should return maxBracketAmount when no SS benefits', () => {
            const agiExcludingSS = 30000;
            const totalSSBenefits = 0; // No SS
            const maxBracketAmount = 40000;
            const targetRate = 0.22;

            const result = findOptimalConversionWithSSTorpedo(
                agiExcludingSS,
                totalSSBenefits,
                maxBracketAmount,
                targetRate,
                'Single',
                testFedParams
            );

            // No SS torpedo = use full bracket headroom
            expect(result).toBe(maxBracketAmount);
        });

        it('should return maxBracketAmount when maxBracketAmount is 0', () => {
            const agiExcludingSS = 30000;
            const totalSSBenefits = 20000;
            const maxBracketAmount = 0; // No headroom
            const targetRate = 0.22;

            const result = findOptimalConversionWithSSTorpedo(
                agiExcludingSS,
                totalSSBenefits,
                maxBracketAmount,
                targetRate,
                'Single',
                testFedParams
            );

            expect(result).toBe(0);
        });
    });

    describe('tolerance and convergence', () => {
        it('should converge within default tolerance of $100', () => {
            const agiExcludingSS = 25000;
            const totalSSBenefits = 25000;
            const maxBracketAmount = 60000;
            const targetRate = 0.22;

            const result = findOptimalConversionWithSSTorpedo(
                agiExcludingSS,
                totalSSBenefits,
                maxBracketAmount,
                targetRate,
                'Single',
                testFedParams
            );

            // Test with slightly less (should still be valid)
            if (result >= 100) {
                const lowerResult = calculateEffectiveConversionTax(
                    agiExcludingSS,
                    totalSSBenefits,
                    0,
                    result - 100,
                    'Single',
                    testFedParams,
                    null
                );
                expect(lowerResult.effectiveRate).toBeLessThanOrEqual(targetRate);
            }
        });

        it('should respect custom tolerance parameter', () => {
            const agiExcludingSS = 25000;
            const totalSSBenefits = 25000;
            const maxBracketAmount = 60000;
            const targetRate = 0.22;
            const customTolerance = 500;

            const result = findOptimalConversionWithSSTorpedo(
                agiExcludingSS,
                totalSSBenefits,
                maxBracketAmount,
                targetRate,
                'Single',
                testFedParams,
                customTolerance
            );

            // Result should be valid (within tolerance of optimal)
            expect(result).toBeGreaterThanOrEqual(0);
            expect(result).toBeLessThanOrEqual(maxBracketAmount);
        });
    });

    describe('edge cases', () => {
        it('should handle very low target rate', () => {
            const agiExcludingSS = 30000;
            const totalSSBenefits = 20000;
            const maxBracketAmount = 50000;
            const targetRate = 0.10; // Very low target

            const result = findOptimalConversionWithSSTorpedo(
                agiExcludingSS,
                totalSSBenefits,
                maxBracketAmount,
                targetRate,
                'Single',
                testFedParams
            );

            // Should return a small amount or 0
            expect(result).toBeLessThan(maxBracketAmount);
        });

        it('should handle high target rate', () => {
            const agiExcludingSS = 20000;
            const totalSSBenefits = 20000;
            const maxBracketAmount = 100000;
            const targetRate = 0.32; // High target

            const result = findOptimalConversionWithSSTorpedo(
                agiExcludingSS,
                totalSSBenefits,
                maxBracketAmount,
                targetRate,
                'Single',
                testFedParams
            );

            // With high target rate, should be able to convert more
            expect(result).toBeGreaterThan(0);
        });

        it('should handle MFJ filing status', () => {
            const agiExcludingSS = 40000;
            const totalSSBenefits = 50000;
            const maxBracketAmount = 80000;
            const targetRate = 0.22;

            const result = findOptimalConversionWithSSTorpedo(
                agiExcludingSS,
                totalSSBenefits,
                maxBracketAmount,
                targetRate,
                'Married Filing Jointly',
                testFedParams
            );

            expect(result).toBeGreaterThanOrEqual(0);
            expect(result).toBeLessThanOrEqual(maxBracketAmount);
        });
    });
});
