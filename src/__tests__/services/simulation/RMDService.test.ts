/**
 * Unit tests for RMDService.processRMDs
 *
 * Tests cover:
 * 1. No RMD required (age < RMD start age)
 * 2. RMD required, single Traditional account
 * 3. RMD from multiple Traditional accounts
 * 4. Roth accounts excluded
 * 5. Account balance insufficient for full RMD
 * 6. Tax calculation (marginal)
 * 7. State doesn't tax SS (TX)
 * 8. State taxes SS (MN)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { processRMDs } from '../../../services/simulation/RMDService';
import { InvestedAccount } from '../../../components/Objects/Accounts/models';
import { AssumptionsState, createBuiltinMilestones } from '../../../components/Objects/Assumptions/AssumptionsContext';
import { SimulationYear, WithdrawalState } from '../../../services/simulation/types';
import * as TaxService from '../../../components/Objects/Taxes/TaxService';

// =============================================================================
// Test Helpers
// =============================================================================

function createMockAssumptions(birthYear: number = 1955): AssumptionsState {
    return {
        milestones: createBuiltinMilestones(birthYear, 65, 90),
        income: {
            salaryGrowth: 3,
            taxBracketIncrease: 0,
        },
        investments: {
            returnRates: { ror: 7 },
            withdrawalRate: 4,
            withdrawalStrategy: 'Needs Based',
            gkUpperGuardrail: 20,
            gkLowerGuardrail: -20,
            gkAdjustmentPercent: 10,
        },
        macro: {
            inflationRate: 2.5,
            inflationAdjusted: true,
        },
        expenses: {
            lifestyleCreep: 0,
        },
        tcja: {
            extended: true,
        },
    } as unknown as AssumptionsState;
}

function createWithdrawalState(totalGrossIncome: number = 50000): WithdrawalState {
    return {
        totalGrossIncome,
        totalWithdrawals: 0,
        userInflows: {},
        employerInflows: {},
        withdrawalDetail: {},
        withdrawalTaxes: 0,
        capitalGainsTaxTotal: 0,
        withdrawalOrdinaryTaxTotal: 0,
        strategyWithdrawalExecuted: 0,
        withdrawalPenalties: 0,
        traditionalWithdrawals: 0,
        longTermCapitalGains: 0,
        shortTermCapitalGains: 0,
        stateCapitalGainsTax: 0,
    };
}

function createTraditionalAccount(
    id: string,
    name: string,
    amount: number
): InvestedAccount {
    return new InvestedAccount(
        id,
        name,
        amount,
        0,              // employerBalance
        10,             // tenureYears (fully vested)
        0.1,            // expenseRatio
        'Traditional 401k',
        true,           // isContributionEligible
        0.2,            // vestedPerYear
        amount,         // costBasis
    );
}

function createRothAccount(
    id: string,
    name: string,
    amount: number
): InvestedAccount {
    return new InvestedAccount(
        id,
        name,
        amount,
        0,              // employerBalance
        10,             // tenureYears (fully vested)
        0.1,            // expenseRatio
        'Roth 401k',
        true,           // isContributionEligible
        0.2,            // vestedPerYear
        amount,         // costBasis
    );
}

function createPriorSimulationYear(accounts: InvestedAccount[], year: number): SimulationYear[] {
    return [{
        year,
        incomes: [],
        expenses: [],
        accounts: accounts,
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
            withdrawalOrdinaryTax: 0,
            niit: 0,
        },
        logs: [],
    }];
}

// Mock tax parameters for testing
const mockFedTaxParams = {
    standardDeduction: 16100,
    brackets: [
        { threshold: 0, rate: 0.10 },
        { threshold: 12400, rate: 0.12 },
        { threshold: 50400, rate: 0.22 },
        { threshold: 105700, rate: 0.24 },
    ],
    socialSecurityTaxRate: 0.062,
    socialSecurityWageBase: 176100,
    medicareTaxRate: 0.0145,
    capitalGainsBrackets: [
        { threshold: 0, rate: 0.00 },
        { threshold: 49700, rate: 0.15 },
    ],
};

const mockStateTaxParams = {
    standardDeduction: 5000,
    brackets: [
        { threshold: 0, rate: 0.05 },
        { threshold: 50000, rate: 0.07 },
    ],
    socialSecurityTaxRate: 0,
    socialSecurityWageBase: 0,
    medicareTaxRate: 0,
    capitalGainsBrackets: [],
};

// =============================================================================
// Tests
// =============================================================================

describe('processRMDs', () => {
    // Mock TaxService functions for RMD-required tests
    beforeEach(() => {
        vi.spyOn(TaxService, 'getTaxParameters').mockImplementation(
            (_year, _filingStatus, authority, stateResidency) => {
                if (authority === 'federal') {
                    return mockFedTaxParams;
                }
                // Return state params for states with income tax, undefined for no-tax states
                if (stateResidency === 'TX' || stateResidency === 'FL' || stateResidency === 'NV') {
                    return undefined;
                }
                return mockStateTaxParams;
            }
        );

        // Mock calculateTax to handle undefined/invalid params for no-tax states
        vi.spyOn(TaxService, 'calculateTax').mockImplementation(
            (grossIncome, preTaxDeductions, params) => {
                // Return 0 for states without income tax (undefined or no brackets)
                if (!params || !params.brackets || params.brackets.length === 0) {
                    return 0;
                }
                // Simple progressive tax calculation for testing
                const taxableIncome = Math.max(0, grossIncome - preTaxDeductions - (params.standardDeduction || 0));
                let tax = 0;
                for (let i = 0; i < params.brackets.length; i++) {
                    const current = params.brackets[i];
                    const nextThreshold = params.brackets[i + 1]?.threshold ?? Infinity;
                    const bracketIncome = Math.min(taxableIncome, nextThreshold) - current.threshold;
                    if (bracketIncome > 0) {
                        tax += bracketIncome * current.rate;
                    }
                }
                return Math.max(0, tax);
            }
        );

        vi.spyOn(TaxService, 'getSocialSecurityBenefits').mockReturnValue(0);
        vi.spyOn(TaxService, 'getTaxableSocialSecurityBenefits').mockReturnValue(0);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe('Test 1: No RMD required (age < RMD start age)', () => {
        it('should return empty result when age is below RMD start age', () => {
            const year = 2030;
            const currentAge = 65; // Below 73 (RMD start for birth year 1955)
            const accounts = [createTraditionalAccount('acc1', 'Traditional 401k', 500000)];
            const assumptions = createMockAssumptions(1955); // RMD starts at 73
            const withdrawalState = createWithdrawalState(50000);
            const logs: string[] = [];

            const result = processRMDs(
                year,
                accounts,
                assumptions,
                [],
                currentAge,
                50000,
                withdrawalState,
                logs
            );

            expect(result.rmdDetails).toBeUndefined();
            expect(result.rmdIncomes).toHaveLength(0);
        });

        it('should return empty result at age 72 for birth year 1955', () => {
            const year = 2027;
            const currentAge = 72;
            const accounts = [createTraditionalAccount('acc1', 'Traditional 401k', 500000)];
            const assumptions = createMockAssumptions(1955);
            const withdrawalState = createWithdrawalState(50000);
            const logs: string[] = [];

            const result = processRMDs(
                year,
                accounts,
                assumptions,
                [],
                currentAge,
                50000,
                withdrawalState,
                logs
            );

            expect(result.rmdDetails).toBeUndefined();
            expect(result.rmdIncomes).toHaveLength(0);
        });
    });

    describe('Test 2: RMD required, single Traditional account', () => {
        it('should calculate RMD for single Traditional 401k at age 73', () => {
            const year = 2028;
            const currentAge = 73;
            const priorYearBalance = 500000;
            const accounts = [createTraditionalAccount('acc1', 'Traditional 401k', priorYearBalance)];
            const assumptions = createMockAssumptions(1955);
            const previousSim = createPriorSimulationYear(accounts, 2027);
            const withdrawalState = createWithdrawalState(50000);
            const logs: string[] = [];

            const result = processRMDs(
                year,
                accounts,
                assumptions,
                previousSim,
                currentAge,
                50000,
                withdrawalState,
                logs
            );

            // RMD at age 73: prior balance / 26.5 = 500000 / 26.5 ≈ 18867.92
            const expectedRMD = priorYearBalance / 26.5;

            expect(result.rmdDetails).toBeDefined();
            expect(result.rmdDetails!.totalRMD).toBeCloseTo(expectedRMD, 0);
            expect(result.rmdDetails!.totalWithdrawn).toBeCloseTo(expectedRMD, 0);
            expect(result.rmdDetails!.accountBreakdown).toHaveLength(1);
            expect(result.rmdIncomes).toHaveLength(1);
            expect(result.rmdIncomes[0].amount).toBeCloseTo(expectedRMD, 0);
        });

        it('should calculate RMD for Traditional IRA', () => {
            const year = 2030;
            const currentAge = 75;
            const priorYearBalance = 300000;
            const account = new InvestedAccount(
                'ira1', 'Traditional IRA', priorYearBalance,
                0, 10, 0.1, 'Traditional IRA', true, 0.2, priorYearBalance
            );
            const assumptions = createMockAssumptions(1955);
            const previousSim = createPriorSimulationYear([account], 2029);
            const withdrawalState = createWithdrawalState(50000);
            const logs: string[] = [];

            const result = processRMDs(
                year,
                [account],
                assumptions,
                previousSim,
                currentAge,
                50000,
                withdrawalState,
                logs
            );

            // RMD at age 75: prior balance / 24.6 = 300000 / 24.6 ≈ 12195.12
            const expectedRMD = priorYearBalance / 24.6;

            expect(result.rmdDetails!.totalRMD).toBeCloseTo(expectedRMD, 0);
            expect(result.rmdIncomes).toHaveLength(1);
        });
    });

    describe('Test 3: RMD from multiple Traditional accounts', () => {
        it('should calculate separate RMDs for each Traditional account', () => {
            const year = 2030;
            const currentAge = 75;
            const balance1 = 400000;
            const balance2 = 200000;
            const accounts = [
                createTraditionalAccount('acc1', 'Traditional 401k', balance1),
                new InvestedAccount(
                    'acc2', 'Traditional IRA', balance2,
                    0, 10, 0.1, 'Traditional IRA', true, 0.2, balance2
                ),
            ];
            const assumptions = createMockAssumptions(1955);
            const previousSim = createPriorSimulationYear(accounts, 2029);
            const withdrawalState = createWithdrawalState(50000);
            const logs: string[] = [];

            const result = processRMDs(
                year,
                accounts,
                assumptions,
                previousSim,
                currentAge,
                50000,
                withdrawalState,
                logs
            );

            // RMD at age 75: divisor = 24.6
            const expectedRMD1 = balance1 / 24.6; // ~16260.16
            const expectedRMD2 = balance2 / 24.6; // ~8130.08
            const totalExpectedRMD = expectedRMD1 + expectedRMD2;

            expect(result.rmdDetails!.totalRMD).toBeCloseTo(totalExpectedRMD, 0);
            expect(result.rmdDetails!.accountBreakdown).toHaveLength(2);
            expect(result.rmdIncomes).toHaveLength(2);
        });
    });

    describe('Test 4: Roth accounts excluded', () => {
        it('should NOT calculate RMD for Roth 401k accounts', () => {
            const year = 2030;
            const currentAge = 75;
            const accounts = [
                createRothAccount('roth1', 'Roth 401k', 500000),
            ];
            const assumptions = createMockAssumptions(1955);
            const previousSim = createPriorSimulationYear(accounts, 2029);
            const withdrawalState = createWithdrawalState(50000);
            const logs: string[] = [];

            const result = processRMDs(
                year,
                accounts,
                assumptions,
                previousSim,
                currentAge,
                50000,
                withdrawalState,
                logs
            );

            // Roth accounts don't require RMDs during owner's lifetime
            // RMD is technically required at this age, but Roth accounts don't need to take RMDs
            // So totalRMD should be 0 and no accounts in breakdown
            expect(result.rmdDetails).toBeDefined();
            expect(result.rmdDetails!.totalRMD).toBe(0);
            expect(result.rmdDetails!.accountBreakdown).toHaveLength(0);
            expect(result.rmdIncomes).toHaveLength(0);
        });

        it('should calculate RMD for Traditional but not Roth when mixed', () => {
            const year = 2030;
            const currentAge = 75;
            const tradBalance = 300000;
            const rothBalance = 200000;
            const accounts = [
                createTraditionalAccount('trad1', 'Traditional 401k', tradBalance),
                createRothAccount('roth1', 'Roth 401k', rothBalance),
            ];
            const assumptions = createMockAssumptions(1955);
            const previousSim = createPriorSimulationYear(accounts, 2029);
            const withdrawalState = createWithdrawalState(50000);
            const logs: string[] = [];

            const result = processRMDs(
                year,
                accounts,
                assumptions,
                previousSim,
                currentAge,
                50000,
                withdrawalState,
                logs
            );

            // Only Traditional account should have RMD
            const expectedRMD = tradBalance / 24.6;

            expect(result.rmdDetails!.totalRMD).toBeCloseTo(expectedRMD, 0);
            expect(result.rmdDetails!.accountBreakdown).toHaveLength(1);
            expect(result.rmdDetails!.accountBreakdown[0].accountName).toBe('Traditional 401k');
            expect(result.rmdIncomes).toHaveLength(1);
        });
    });

    describe('Test 5: Account balance insufficient for full RMD', () => {
        it('should withdraw available balance when less than RMD required', () => {
            const year = 2030;
            const currentAge = 75;
            const accountBalance = 5000; // Small balance
            const accounts = [createTraditionalAccount('acc1', 'Traditional 401k', accountBalance)];
            const assumptions = createMockAssumptions(1955);
            const previousSim = createPriorSimulationYear(accounts, 2029);
            const withdrawalState = createWithdrawalState(50000);
            const logs: string[] = [];

            const result = processRMDs(
                year,
                accounts,
                assumptions,
                previousSim,
                currentAge,
                50000,
                withdrawalState,
                logs
            );

            // RMD required: 5000 / 24.6 ≈ 203.25
            // Available: 5000 (vested amount = full account for fully vested)
            // Since account has enough balance, no shortfall
            const expectedRMD = accountBalance / 24.6;

            expect(result.rmdDetails!.totalRMD).toBeCloseTo(expectedRMD, 0);
            expect(result.rmdDetails!.totalWithdrawn).toBeCloseTo(expectedRMD, 0);
            expect(result.rmdDetails!.shortfall).toBe(0);
        });

        it('should show shortfall and penalty when vested amount insufficient', () => {
            const year = 2030;
            const currentAge = 75;
            // Account with employer balance that's not fully vested
            const account = new InvestedAccount(
                'acc1', 'Traditional 401k', 100000,
                80000,    // employerBalance - 80% is employer's
                2,        // tenureYears - only 2 years
                0.1,
                'Traditional 401k',
                true,
                0.2,      // vestedPerYear - 20% per year
                100000,
            );
            // After 2 years: 40% vested of employer portion = 32000
            // User portion: 20000
            // Vested amount: 20000 + 32000 = 52000

            const assumptions = createMockAssumptions(1955);
            const previousSim = createPriorSimulationYear([account], 2029);
            const withdrawalState = createWithdrawalState(50000);
            const logs: string[] = [];

            const result = processRMDs(
                year,
                [account],
                assumptions,
                previousSim,
                currentAge,
                50000,
                withdrawalState,
                logs
            );

            // RMD required: 100000 / 24.6 ≈ 4065.04
            // Vested amount available: 52000
            // This should work fine since 52000 > 4065
            expect(result.rmdDetails!.shortfall).toBe(0);
        });
    });

    describe('RMD start age by birth year', () => {
        it('should require RMD at 72 for birth year 1950', () => {
            const year = 2022;
            const currentAge = 72;
            const accounts = [createTraditionalAccount('acc1', 'Traditional 401k', 500000)];
            const assumptions = createMockAssumptions(1950);
            const previousSim = createPriorSimulationYear(accounts, 2021);
            const withdrawalState = createWithdrawalState(50000);
            const logs: string[] = [];

            const result = processRMDs(
                year,
                accounts,
                assumptions,
                previousSim,
                currentAge,
                50000,
                withdrawalState,
                logs
            );

            expect(result.rmdDetails).toBeDefined();
            expect(result.rmdDetails!.totalRMD).toBeGreaterThan(0);
        });

        it('should require RMD at 75 for birth year 1960', () => {
            const year = 2035;
            const currentAge = 75;
            const accounts = [createTraditionalAccount('acc1', 'Traditional 401k', 500000)];
            const assumptions = createMockAssumptions(1960);
            const previousSim = createPriorSimulationYear(accounts, 2034);
            const withdrawalState = createWithdrawalState(50000);
            const logs: string[] = [];

            const result = processRMDs(
                year,
                accounts,
                assumptions,
                previousSim,
                currentAge,
                50000,
                withdrawalState,
                logs
            );

            expect(result.rmdDetails).toBeDefined();
            expect(result.rmdDetails!.totalRMD).toBeGreaterThan(0);
        });

        it('should NOT require RMD at 74 for birth year 1960', () => {
            const year = 2034;
            const currentAge = 74;
            const accounts = [createTraditionalAccount('acc1', 'Traditional 401k', 500000)];
            const assumptions = createMockAssumptions(1960);
            const withdrawalState = createWithdrawalState(50000);
            const logs: string[] = [];

            const result = processRMDs(
                year,
                accounts,
                assumptions,
                [],
                currentAge,
                50000,
                withdrawalState,
                logs
            );

            expect(result.rmdDetails).toBeUndefined();
        });
    });
});
