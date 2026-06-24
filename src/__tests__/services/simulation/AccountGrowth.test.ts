/**
 * Unit tests for account growth and inflow processing.
 *
 * These functions handle payroll contributions, employer match,
 * ESPP purchases, and year-over-year account growth.
 *
 * Note: Deficit debt paydown and priority bucket allocations are now
 * handled by SurplusAllocator.allocateSurplus() — see SurplusAllocator.test.ts.
 */
import { describe, it, expect } from 'vitest';
import { processInflows, growAccounts } from '../../../services/simulation/AccountGrowth';
import {
    InvestedAccount,
    SavedAccount,
    ESPPAccount,
    PropertyAccount,
    DebtAccount,
    DeficitDebtAccount,
} from '../../../components/Objects/Accounts/models';
import { WorkIncome } from '../../../components/Objects/Income/models';
import { MortgageExpense, LoanExpense } from '../../../components/Objects/Expense/models';
import { AssumptionsState, defaultAssumptions } from '../../../components/Objects/Assumptions/AssumptionsContext';
import { WithdrawalState } from '../../../services/simulation/types';

// Helper to create a fresh withdrawal state
function createWithdrawalState(overrides: Partial<WithdrawalState> = {}): WithdrawalState {
    return {
        userInflows: {},
        employerInflows: {},
        withdrawalTaxes: 0,
        capitalGainsTaxTotal: 0,
        withdrawalOrdinaryTaxTotal: 0,
        strategyWithdrawalExecuted: 0,
        totalWithdrawals: 0,
        withdrawalDetail: {},
        withdrawalPenalties: 0,
        totalGrossIncome: 0,
        traditionalWithdrawals: 0,
        longTermCapitalGains: 0,
        shortTermCapitalGains: 0,
        stateCapitalGainsTax: 0,
        ...overrides
    };
}

// Helper to create test assumptions
function createTestAssumptions(overrides: Partial<{
    ror: number;
    housingAppreciation: number;
    inflationAdjusted: boolean;
}> = {}): AssumptionsState {
    return {
        ...defaultAssumptions,
        macro: {
            ...defaultAssumptions.macro,
            inflationAdjusted: overrides.inflationAdjusted ?? defaultAssumptions.macro.inflationAdjusted,
        },
        investments: {
            ...defaultAssumptions.investments,
            returnRates: {
                ror: overrides.ror ?? 7,
            },
        },
        expenses: {
            ...defaultAssumptions.expenses,
            housingAppreciation: overrides.housingAppreciation ?? 3,
        },
    };
}

// Helper to create WorkIncome with 401k contributions
function createWorkIncomeWith401k(
    id: string,
    salary: number,
    preTax401k: number,
    roth401k: number,
    employerMatch: number,
    matchAccountId: string
): WorkIncome {
    return new WorkIncome(
        id, 'Test Job', salary, 'Annually', 'Yes',
        preTax401k,    // preTax401k
        0,             // insurance
        roth401k,      // roth401k
        employerMatch, // employerMatch
        matchAccountId,
        null,          // taxType
        'FIXED',       // contributionGrowthStrategy
        new Date('2020-01-01'), // startDate (in the past)
        undefined,     // endDate
        0              // hsaContribution
    );
}

// Helper to create WorkIncome with ESPP
function createWorkIncomeWithESPP(
    id: string,
    salary: number,
    esppAccountId: string,
    contributionPercent: number = 10,
    discountPercent: number = 15,
    hasLookback: boolean = true
): WorkIncome {
    return new WorkIncome(
        id, 'Test Job', salary, 'Annually', 'Yes',
        0, 0, 0, 0, '',
        null, 'FIXED',
        new Date('2020-01-01'),
        undefined,
        0,
        'custom',
        'PERCENTAGE',           // esppContributionType
        contributionPercent,    // esppContributionAmount (percentage)
        discountPercent,        // esppDiscountPercent
        hasLookback,            // esppHasLookback
        6,                      // esppOfferingPeriodMonths
        esppAccountId,          // esppAccountId
        7                       // esppExpectedStockGrowth
    );
}

describe('AccountGrowth', () => {
    describe('processInflows', () => {
        describe('payroll contributions', () => {
            it('should process preTax401k contributions', () => {
                const account = new InvestedAccount('401k', '401k', 100000, 0, 0, 0.1, 'Traditional 401k');
                const income = createWorkIncomeWith401k('job1', 100000, 10000, 0, 0, '401k');
                const withdrawalState = createWithdrawalState();
                const assumptions = createTestAssumptions();
                const logs: string[] = [];

                processInflows(
                    [income],
                    [account],
                    assumptions,
                    2025,
                    withdrawalState,
                    50000, // discretionaryCash
                    undefined, // no deficit debt
                    40000, // totalLivingExpenses
                    35, // currentAge
                    logs
                );

                expect(withdrawalState.userInflows['401k']).toBe(10000);
            });

            it('should annualize per-period preTax401k by frequency for deposits (#8)', () => {
                // preTax401k is per pay period. A $1,000/month contribution must deposit
                // $12,000 into the 401k for the year, not $1,000.
                const account = new InvestedAccount('401k', '401k', 100000, 0, 0, 0.1, 'Traditional 401k');
                const income = new WorkIncome(
                    'job1', 'Test Job', 8333, 'Monthly', 'Yes',
                    1000, 0, 0, 0, '401k',
                    null, 'FIXED',
                    new Date('2020-01-01'), undefined, 0
                );
                const withdrawalState = createWithdrawalState();
                const assumptions = createTestAssumptions();
                const logs: string[] = [];

                processInflows(
                    [income], [account], assumptions, 2025, withdrawalState,
                    50000, undefined, 40000, 35, logs
                );

                expect(withdrawalState.userInflows['401k']).toBe(12000);
            });

            it('should process roth401k contributions', () => {
                const account = new InvestedAccount('401k', '401k', 100000, 0, 0, 0.1, 'Roth 401k');
                const income = createWorkIncomeWith401k('job1', 100000, 0, 8000, 0, '401k');
                const withdrawalState = createWithdrawalState();
                const assumptions = createTestAssumptions();
                const logs: string[] = [];

                processInflows(
                    [income],
                    [account],
                    assumptions,
                    2025,
                    withdrawalState,
                    50000,
                    undefined,
                    40000,
                    35,
                    logs
                );

                expect(withdrawalState.userInflows['401k']).toBe(8000);
            });

            it('should calculate employer match', () => {
                const account = new InvestedAccount('401k', '401k', 100000, 0, 0, 0.1, 'Traditional 401k');
                const income = createWorkIncomeWith401k('job1', 100000, 10000, 0, 5000, '401k');
                const withdrawalState = createWithdrawalState();
                const assumptions = createTestAssumptions();
                const logs: string[] = [];

                const result = processInflows(
                    [income],
                    [account],
                    assumptions,
                    2025,
                    withdrawalState,
                    50000,
                    undefined,
                    40000,
                    35,
                    logs
                );

                expect(result.totalEmployerMatch).toBe(5000);
                expect(withdrawalState.employerInflows['401k']).toBe(5000);
            });

            it('should apply active multiplier for partial year', () => {
                const account = new InvestedAccount('401k', '401k', 100000, 0, 0, 0.1, 'Traditional 401k');
                // Income starts mid-year (July 1, 2025) - use local time constructor to avoid timezone issues
                const income = new WorkIncome(
                    'job1', 'Test Job', 100000, 'Annually', 'Yes',
                    12000, 0, 0, 6000, '401k',
                    null, 'FIXED',
                    new Date(2025, 6, 1), // July 1 (month index 6 in local time)
                    undefined
                );
                const withdrawalState = createWithdrawalState();
                const assumptions = createTestAssumptions();
                const logs: string[] = [];

                const result = processInflows(
                    [income],
                    [account],
                    assumptions,
                    2025,
                    withdrawalState,
                    50000,
                    undefined,
                    40000,
                    35,
                    logs
                );

                // Should be 50% of full year (6 months: July-December)
                expect(withdrawalState.userInflows['401k']).toBeCloseTo(6000, -2);
                expect(result.totalEmployerMatch).toBeCloseTo(3000, -2);
            });

            it('should skip inactive work income', () => {
                const account = new InvestedAccount('401k', '401k', 100000, 0, 0, 0.1, 'Traditional 401k');
                // Income ended in 2024
                const income = new WorkIncome(
                    'job1', 'Test Job', 100000, 'Annually', 'Yes',
                    12000, 0, 0, 6000, '401k',
                    null, 'FIXED',
                    new Date('2020-01-01'),
                    new Date('2024-12-31') // Ended before test year
                );
                const withdrawalState = createWithdrawalState();
                const assumptions = createTestAssumptions();
                const logs: string[] = [];

                const result = processInflows(
                    [income],
                    [account],
                    assumptions,
                    2025,
                    withdrawalState,
                    50000,
                    undefined,
                    40000,
                    35,
                    logs
                );

                expect(withdrawalState.userInflows['401k']).toBeUndefined();
                expect(result.totalEmployerMatch).toBe(0);
            });
        });

        describe('ESPP purchase processing', () => {
            it('should create ESPP lots for each purchase period', () => {
                const esppAccount = new ESPPAccount('espp1', 'Company ESPP', 10000);
                const income = createWorkIncomeWithESPP('job1', 100000, 'espp1', 10, 15, false);
                const withdrawalState = createWithdrawalState();
                const assumptions = createTestAssumptions();
                const logs: string[] = [];

                const result = processInflows(
                    [income],
                    [esppAccount],
                    assumptions,
                    2025,
                    withdrawalState,
                    50000,
                    undefined,
                    40000,
                    35,
                    logs
                );

                // Should create 2 lots (one per 6-month period)
                expect(result.esppLots['espp1']).toHaveLength(2);
            });

            it('should apply ESPP discount', () => {
                const esppAccount = new ESPPAccount('espp1', 'Company ESPP', 10000);
                const income = createWorkIncomeWithESPP('job1', 100000, 'espp1', 10, 15, false);
                const withdrawalState = createWithdrawalState();
                const assumptions = createTestAssumptions();
                const logs: string[] = [];

                const result = processInflows(
                    [income],
                    [esppAccount],
                    assumptions,
                    2025,
                    withdrawalState,
                    50000,
                    undefined,
                    40000,
                    35,
                    logs
                );

                const lot = result.esppLots['espp1'][0];
                // Purchase price should be 15% below the base price
                expect(lot.purchasePrice).toBeLessThan(lot.fmvAtPurchase);
                expect(lot.discountAmount).toBeGreaterThan(0);
            });

            it('should apply lookback when enabled', () => {
                const esppAccount = new ESPPAccount('espp1', 'Company ESPP', 10000);
                const incomeWithLookback = createWorkIncomeWithESPP('job1', 100000, 'espp1', 10, 15, true);
                const incomeWithoutLookback = createWorkIncomeWithESPP('job2', 100000, 'espp2', 10, 15, false);
                const esppAccount2 = new ESPPAccount('espp2', 'Company ESPP 2', 10000);

                const wsWithLookback = createWithdrawalState();
                const wsWithoutLookback = createWithdrawalState();
                const assumptions = createTestAssumptions();

                const resultWithLookback = processInflows(
                    [incomeWithLookback],
                    [esppAccount],
                    assumptions,
                    2025,
                    wsWithLookback,
                    50000,
                    undefined,
                    40000,
                    35,
                    []
                );

                const resultWithoutLookback = processInflows(
                    [incomeWithoutLookback],
                    [esppAccount2],
                    assumptions,
                    2025,
                    wsWithoutLookback,
                    50000,
                    undefined,
                    40000,
                    35,
                    []
                );

                // With lookback should have more shares (lower effective purchase price)
                const lotWithLookback = resultWithLookback.esppLots['espp1'][0];
                const lotWithoutLookback = resultWithoutLookback.esppLots['espp2'][0];

                // Lookback uses min(grant, purchase) price for discount
                expect(lotWithLookback.purchasePrice).toBeLessThanOrEqual(lotWithoutLookback.purchasePrice);
            });

            it('should stamp sim-projected lot dates locally (matching user-entered lots)', () => {
                // Sim-projected ESPP lots must be built with LOCAL date constructors, the
                // same as user-entered lots (parseDate → new Date(y, m-1, d)). Every reader
                // (calculateDispositionType, getEligibleLots, daysSincePurchase) uses LOCAL
                // accessors and getTime() deltas, so a lot stamped at UTC midnight and a lot
                // stamped at local midnight classify holding-period / disposition boundaries
                // inconsistently in any non-UTC timezone.
                const esppAccount = new ESPPAccount('espp1', 'Company ESPP', 10000);
                const income = createWorkIncomeWithESPP('job1', 100000, 'espp1', 10, 15, false);
                const withdrawalState = createWithdrawalState();
                const assumptions = createTestAssumptions();
                const logs: string[] = [];

                const result = processInflows(
                    [income], [esppAccount], assumptions, 2025, withdrawalState,
                    50000, undefined, 40000, 35, logs
                );

                // First period: grant month 0 (Jan), purchase month 5 (Jun).
                const lot = result.esppLots['espp1'][0];
                // Local-built equivalents — the engine must produce identical instants.
                const expectedGrant = new Date(2025, 0, 1);
                const expectedPurchase = new Date(2025, 5, 28);
                expect(lot.grantDate.getTime()).toBe(expectedGrant.getTime());
                expect(lot.purchaseDate.getTime()).toBe(expectedPurchase.getTime());

                // And they must read back as the intended local calendar day (midnight),
                // not the prior evening (the UTC-midnight symptom in negative-offset zones).
                expect(lot.grantDate.getFullYear()).toBe(2025);
                expect(lot.grantDate.getMonth()).toBe(0);
                expect(lot.grantDate.getDate()).toBe(1);
                expect(lot.purchaseDate.getMonth()).toBe(5);
                expect(lot.purchaseDate.getDate()).toBe(28);

                // The holding-period reader must classify the sim lot exactly like a
                // user-built lot of the same local dates.
                const userBuiltAccount = new ESPPAccount('espp1', 'Company ESPP', 10000, [
                    { ...lot, grantDate: expectedGrant, purchaseDate: expectedPurchase },
                ]);
                const simBuiltAccount = new ESPPAccount('espp1', 'Company ESPP', 10000, [lot]);
                const saleDate = new Date(2027, 0, 15); // > 2yr from grant, > 1yr from purchase
                expect(simBuiltAccount.calculateDispositionType(lot, saleDate))
                    .toBe(userBuiltAccount.calculateDispositionType(
                        userBuiltAccount.lots[0], saleDate));
            });

            it('should calculate shares based on purchase price', () => {
                const esppAccount = new ESPPAccount('espp1', 'Company ESPP', 10000);
                const income = createWorkIncomeWithESPP('job1', 100000, 'espp1', 10, 15, false);
                const withdrawalState = createWithdrawalState();
                const assumptions = createTestAssumptions();
                const logs: string[] = [];

                const result = processInflows(
                    [income],
                    [esppAccount],
                    assumptions,
                    2025,
                    withdrawalState,
                    50000,
                    undefined,
                    40000,
                    35,
                    logs
                );

                const lot = result.esppLots['espp1'][0];
                // shares = contribution / purchasePrice
                expect(lot.shares).toBeCloseTo(lot.totalCost / lot.purchasePrice, 2);
            });
        });
    });

    describe('growAccounts', () => {
        describe('DeficitDebtAccount', () => {
            it('should reduce balance by deficit debt payment', () => {
                const deficitDebt = new DeficitDebtAccount('system-deficit-debt', 'Uncovered Deficit', 10000);
                const withdrawalState = createWithdrawalState();
                const assumptions = createTestAssumptions();
                const logs: string[] = [];

                const result = growAccounts(
                    [deficitDebt],
                    [],
                    withdrawalState,
                    {}, // conversionDeposits
                    {},
                    {}, // rsuLots // esppLots
                    3000, // deficitDebtPayment
                    deficitDebt,
                    assumptions,
                    2025,
                    undefined, // returnOverride
                    logs
                );

                const updatedDebt = result.find(a => a.id === 'system-deficit-debt') as DeficitDebtAccount;
                expect(updatedDebt.amount).toBe(7000);
            });

            it('should remove account when balance reaches zero', () => {
                const deficitDebt = new DeficitDebtAccount('system-deficit-debt', 'Uncovered Deficit', 5000);
                const withdrawalState = createWithdrawalState();
                const assumptions = createTestAssumptions();
                const logs: string[] = [];

                const result = growAccounts(
                    [deficitDebt],
                    [],
                    withdrawalState,
                    {},
                    {},
                    {}, // rsuLots
                    5000, // Pay off entire debt
                    deficitDebt,
                    assumptions,
                    2025,
                    undefined,
                    logs
                );

                expect(result.find(a => a.id === 'system-deficit-debt')).toBeUndefined();
            });
        });

        describe('DebtAccount growth', () => {
            it('should apply APR to debt balance', () => {
                const debt = new DebtAccount('debt1', 'Car Loan', 10000, '', 6); // 6% APR
                const withdrawalState = createWithdrawalState();
                const assumptions = createTestAssumptions();
                const logs: string[] = [];

                const result = growAccounts(
                    [debt],
                    [],
                    withdrawalState,
                    {},
                    {},
                    {}, // rsuLots
                    0,
                    undefined,
                    assumptions,
                    2025,
                    undefined,
                    logs
                );

                const updatedDebt = result.find(a => a.id === 'debt1') as DebtAccount;
                // $10000 * 1.06 = $10600
                expect(updatedDebt.amount).toBeCloseTo(10600, 0);
            });

            it('should reduce balance by inflows', () => {
                const debt = new DebtAccount('debt1', 'Car Loan', 10000, '', 6);
                const withdrawalState = createWithdrawalState({
                    userInflows: { 'debt1': 2000 }
                });
                const assumptions = createTestAssumptions();
                const logs: string[] = [];

                const result = growAccounts(
                    [debt],
                    [],
                    withdrawalState,
                    {},
                    {},
                    {}, // rsuLots
                    0,
                    undefined,
                    assumptions,
                    2025,
                    undefined,
                    logs
                );

                const updatedDebt = result.find(a => a.id === 'debt1') as DebtAccount;
                // ($10000 * 1.06) - $2000 = $8600
                expect(updatedDebt.amount).toBeCloseTo(8600, 0);
            });

            it('should use linked balance when available', () => {
                const debt = new DebtAccount('debt1', 'Car Loan', 10000, '', 6);
                // LoanExpense constructor: (id, name, amount, frequency, apr, interest_type, payment, is_tax_deductible, tax_deductible, linkedAccountId, startDate, ...)
                const loanExpense = new LoanExpense(
                    'loan-expense',       // id
                    'Car Payment',        // name
                    8000,                 // amount (current balance)
                    'Monthly',            // frequency
                    6,                    // apr
                    'Simple',             // interest_type
                    500,                  // payment (monthly payment amount)
                    'No',                 // is_tax_deductible
                    0,                    // tax_deductible
                    'debt1',              // linkedAccountId - links to DebtAccount
                    new Date('2020-01-01') // startDate
                );
                const withdrawalState = createWithdrawalState();
                const assumptions = createTestAssumptions();
                const logs: string[] = [];

                const result = growAccounts(
                    [debt],
                    [loanExpense],
                    withdrawalState,
                    {},
                    {},
                    {}, // rsuLots
                    0,
                    undefined,
                    assumptions,
                    2025,
                    undefined,
                    logs
                );

                const updatedDebt = result.find(a => a.id === 'debt1') as DebtAccount;
                // Should use the linked expense balance
                expect(updatedDebt.amount).toBe(8000);
            });
        });

        describe('InvestedAccount growth', () => {
            it('should apply user inflows', () => {
                // Set expenseRatio=0 to avoid the 0.1% deduction
                const account = new InvestedAccount('inv1', 'Brokerage', 100000, 0, 0, 0, 'Brokerage');
                const withdrawalState = createWithdrawalState({
                    userInflows: { 'inv1': 10000 }
                });
                const assumptions = createTestAssumptions({ ror: 0 }); // No growth for simplicity
                const logs: string[] = [];

                const result = growAccounts(
                    [account],
                    [],
                    withdrawalState,
                    {},
                    {},
                    {}, // rsuLots
                    0,
                    undefined,
                    assumptions,
                    2025,
                    0, // returnOverride = 0
                    logs
                );

                const updated = result.find(a => a.id === 'inv1') as InvestedAccount;
                expect(updated.amount).toBe(110000);
            });

            it('should apply employer inflows', () => {
                // Set expenseRatio=0 to avoid the 0.1% deduction
                const account = new InvestedAccount('inv1', '401k', 100000, 5000, 0, 0, 'Traditional 401k');
                const withdrawalState = createWithdrawalState({
                    employerInflows: { 'inv1': 3000 }
                });
                const assumptions = createTestAssumptions({ ror: 0 });
                const logs: string[] = [];

                const result = growAccounts(
                    [account],
                    [],
                    withdrawalState,
                    {},
                    {},
                    {}, // rsuLots
                    0,
                    undefined,
                    assumptions,
                    2025,
                    0,
                    logs
                );

                const updated = result.find(a => a.id === 'inv1') as InvestedAccount;
                // employerBalance should increase: 5000 + 3000 = 8000
                expect(updated.employerBalance).toBe(8000);
            });

            it('should apply investment return', () => {
                // Set expenseRatio=0 to get clean return calculation
                const account = new InvestedAccount('inv1', 'Brokerage', 100000, 0, 0, 0, 'Brokerage');
                const withdrawalState = createWithdrawalState();
                // Disable inflation to get exact 10% return
                const assumptions = createTestAssumptions({ ror: 10, inflationAdjusted: false });
                const logs: string[] = [];

                const result = growAccounts(
                    [account],
                    [],
                    withdrawalState,
                    {},
                    {},
                    {}, // rsuLots
                    0,
                    undefined,
                    assumptions,
                    2025,
                    undefined, // Use assumptions ROR
                    logs
                );

                const updated = result.find(a => a.id === 'inv1') as InvestedAccount;
                // $100k * 1.10 = $110k
                expect(updated.amount).toBeCloseTo(110000, 0);
            });

            it('should apply return override when provided', () => {
                // Set expenseRatio=0 to get clean return calculation
                // With override, formula is: 1 + (override - expenseRatio) / 100
                const account = new InvestedAccount('inv1', 'Brokerage', 100000, 0, 0, 0, 'Brokerage');
                const withdrawalState = createWithdrawalState();
                const assumptions = createTestAssumptions({ ror: 10 }); // 10% in assumptions (ignored)
                const logs: string[] = [];

                const result = growAccounts(
                    [account],
                    [],
                    withdrawalState,
                    {},
                    {},
                    {}, // rsuLots
                    0,
                    undefined,
                    assumptions,
                    2025,
                    -5, // -5% return override (bad year)
                    logs
                );

                const updated = result.find(a => a.id === 'inv1') as InvestedAccount;
                // $100k * 0.95 = $95k
                expect(updated.amount).toBeCloseTo(95000, 0);
            });

            it('should track conversion deposits', () => {
                // Set expenseRatio=0 for clean calculation
                const rothAccount = new InvestedAccount('roth1', 'Roth IRA', 50000, 0, 0, 0, 'Roth IRA');
                // Conversion deposits increase balance via userInflows + track history via conversionDeposits
                const withdrawalState = createWithdrawalState({
                    userInflows: { 'roth1': 20000 } // The actual balance increase comes through userInflows
                });
                const assumptions = createTestAssumptions({ ror: 0 });
                const logs: string[] = [];

                const result = growAccounts(
                    [rothAccount],
                    [],
                    withdrawalState,
                    { 'roth1': 20000 }, // conversionDeposits records this in conversion history
                    {},
                    {}, // rsuLots
                    0,
                    undefined,
                    assumptions,
                    2025,
                    0,
                    logs
                );

                const updated = result.find(a => a.id === 'roth1') as InvestedAccount;
                expect(updated.amount).toBe(70000);
                // Also verify conversion history is tracked
                expect(updated.conversionHistory).toHaveLength(1);
                expect(updated.conversionHistory[0].amount).toBe(20000);
                expect(updated.conversionHistory[0].year).toBe(2025);
            });
        });

        describe('SavedAccount growth', () => {
            it('should apply APR interest', () => {
                const account = new SavedAccount('sav1', 'HYSA', 10000, 5); // 5% APR
                const withdrawalState = createWithdrawalState();
                const assumptions = createTestAssumptions();
                const logs: string[] = [];

                const result = growAccounts(
                    [account],
                    [],
                    withdrawalState,
                    {},
                    {},
                    {}, // rsuLots
                    0,
                    undefined,
                    assumptions,
                    2025,
                    undefined,
                    logs
                );

                const updated = result.find(a => a.id === 'sav1') as SavedAccount;
                // $10k * 1.05 = $10,500
                expect(updated.amount).toBeCloseTo(10500, 0);
            });

            it('should add total inflows', () => {
                const account = new SavedAccount('sav1', 'HYSA', 10000, 5);
                const withdrawalState = createWithdrawalState({
                    userInflows: { 'sav1': 5000 }
                });
                const assumptions = createTestAssumptions();
                const logs: string[] = [];

                const result = growAccounts(
                    [account],
                    [],
                    withdrawalState,
                    {},
                    {},
                    {}, // rsuLots
                    0,
                    undefined,
                    assumptions,
                    2025,
                    undefined,
                    logs
                );

                const updated = result.find(a => a.id === 'sav1') as SavedAccount;
                // ($10k + $5k) * 1.05 = $15,750
                expect(updated.amount).toBeCloseTo(15750, 0);
            });
        });

        describe('ESPPAccount growth', () => {
            it('should apply stock growth rate', () => {
                const account = new ESPPAccount('espp1', 'Company ESPP', 10000);
                const withdrawalState = createWithdrawalState();
                // Disable inflation to get clean 8% return (otherwise adds 2.6% inflation)
                const assumptions = createTestAssumptions({ ror: 8, inflationAdjusted: false });
                const logs: string[] = [];

                const result = growAccounts(
                    [account],
                    [],
                    withdrawalState,
                    {},
                    {},
                    {}, // rsuLots
                    0,
                    undefined,
                    assumptions,
                    2025,
                    undefined,
                    logs
                );

                const updated = result.find(a => a.id === 'espp1') as ESPPAccount;
                // $10k * 1.08 = $10,800
                expect(updated.amount).toBeCloseTo(10800, 0);
            });

            it('should add new lots', () => {
                const account = new ESPPAccount('espp1', 'Company ESPP', 10000);
                const withdrawalState = createWithdrawalState();
                const assumptions = createTestAssumptions({ ror: 0 });
                const newLot = {
                    id: 'lot1',
                    grantDate: new Date('2025-01-01'),
                    purchaseDate: new Date('2025-06-28'),
                    fmvAtGrant: 100,
                    fmvAtPurchase: 105,
                    purchasePrice: 85,
                    shares: 50,
                    totalCost: 4250,
                    discountAmount: 15
                };
                const logs: string[] = [];

                const result = growAccounts(
                    [account],
                    [],
                    withdrawalState,
                    {},
                    { 'espp1': [newLot] },
                    {}, // rsuLots
                    0,
                    undefined,
                    assumptions,
                    2025,
                    0,
                    logs
                );

                const updated = result.find(a => a.id === 'espp1') as ESPPAccount;
                expect(updated.lots).toHaveLength(1);
                expect(updated.lots[0].id).toBe('lot1');
            });

            it('should apply return override when provided', () => {
                const account = new ESPPAccount('espp1', 'Company ESPP', 10000);
                const withdrawalState = createWithdrawalState();
                const assumptions = createTestAssumptions({ ror: 8 });
                const logs: string[] = [];

                const result = growAccounts(
                    [account],
                    [],
                    withdrawalState,
                    {},
                    {},
                    {}, // rsuLots
                    0,
                    undefined,
                    assumptions,
                    2025,
                    -10, // Bad year for stock
                    logs
                );

                const updated = result.find(a => a.id === 'espp1') as ESPPAccount;
                // $10k * 0.90 = $9,000
                expect(updated.amount).toBeCloseTo(9000, 0);
            });
        });

        describe('PropertyAccount growth', () => {
            it('should increment PropertyAccount with assumptions', () => {
                const property = new PropertyAccount('prop1', 'Home', 500000, 'Financed', 300000, 400000, '');
                const withdrawalState = createWithdrawalState();
                const assumptions = createTestAssumptions({ housingAppreciation: 4 }); // 4% appreciation
                const logs: string[] = [];

                const result = growAccounts(
                    [property],
                    [],
                    withdrawalState,
                    {},
                    {},
                    {}, // rsuLots
                    0,
                    undefined,
                    assumptions,
                    2025,
                    undefined,
                    logs
                );

                const updated = result.find(a => a.id === 'prop1') as PropertyAccount;
                // $500k * (1.04 + 0.026 inflation) = $533k
                expect(updated.amount).toBeCloseTo(533000, 0);
            });

            it('should update value from linked mortgage', () => {
                const property = new PropertyAccount('prop1', 'Home', 500000, 'Financed', 300000, 400000, '');
                // MortgageExpense constructor: (id, name, frequency, valuation, loan_balance, starting_loan_balance,
                //   apr, term_length, property_taxes, valuation_deduction, maintenance, utilities,
                //   home_owners_insurance, pmi, hoa_fee, is_tax_deductible, tax_deductible, linkedAccountId,
                //   startDate, payment, extra_payment, endDate, ...)
                const mortgage = new MortgageExpense(
                    'mortgage-exp',       // id
                    'Mortgage',           // name
                    'Monthly',            // frequency
                    550000,               // valuation
                    280000,               // loan_balance
                    400000,               // starting_loan_balance
                    4,                    // apr (%)
                    30,                   // term_length (years)
                    1.2,                  // property_taxes (% of valuation)
                    0,                    // valuation_deduction
                    0.5,                  // maintenance (% of valuation)
                    200,                  // utilities (monthly amount)
                    0.3,                  // home_owners_insurance (% of valuation)
                    0,                    // pmi (% of valuation)
                    100,                  // hoa_fee (monthly amount)
                    'Yes',                // is_tax_deductible
                    0,                    // tax_deductible (calculated by constructor)
                    'prop1',              // linkedAccountId - links to PropertyAccount
                    new Date('2020-01-01') // startDate
                );
                const withdrawalState = createWithdrawalState();
                const assumptions = createTestAssumptions();
                const logs: string[] = [];

                const result = growAccounts(
                    [property],
                    [mortgage],
                    withdrawalState,
                    {},
                    {},
                    {}, // rsuLots
                    0,
                    undefined,
                    assumptions,
                    2025,
                    undefined,
                    logs
                );

                const updated = result.find(a => a.id === 'prop1') as PropertyAccount;
                // Should use mortgage valuation and loan balance
                expect(updated.amount).toBe(550000);
                expect(updated.loanAmount).toBe(280000);
            });
        });
    });
});
