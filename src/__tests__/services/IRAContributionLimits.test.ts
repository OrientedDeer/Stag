import { describe, it, expect } from 'vitest';
import { processInflows } from '../../services/simulation/AccountGrowth';
import { InvestedAccount, SavedAccount } from '../../components/Objects/Accounts/models';
import { WorkIncome, PassiveIncome } from '../../components/Objects/Income/models';
import { WithdrawalState } from '../../services/simulation/types';
import { createBuiltinMilestones } from '../../components/Objects/Assumptions/AssumptionsContext';

function makeWithdrawalState(): WithdrawalState {
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
    };
}

function makeAssumptions(priorities: any[] = []) {
    return {
        demographics: { priorEarnings: [] },
        milestones: createBuiltinMilestones(1980, 65, 90),
        macro: { inflationRate: 3, healthcareInflation: 5, inflationAdjusted: false },
        investments: {
            returnRates: { ror: 7 },
            withdrawalRate: 4,
            withdrawalStrategy: 'None' as const,
            autoRothConversions: false,
            rothConversionTargetBracket: 0.22,
            gkUpperGuardrail: 20,
            gkLowerGuardrail: 20,
            gkAdjustmentPercent: 10,
        },
        income: { salaryGrowth: 3, socialSecurityFundingPercent: 100 },
        expenses: { lifestyleCreep: 0 },
        withdrawalStrategy: [],
        priorities,
    } as any;
}

describe('IRA Contribution Earned Income Validation', () => {
    describe('blocks contributions without earned income', () => {
        it('blocks Roth IRA contribution when no earned income exists', () => {
            const rothIRA = new InvestedAccount(
                'ira-1', 'Roth IRA', 10000, 0, 0, 0.1,
                'Roth IRA', true, 0
            );
            const accounts = [rothIRA];

            // Passive income - not earned income
            const passiveIncome = new PassiveIncome(
                'pass-1', 'Dividends', 50000, 'Annually', 'No', 'Dividend',
                new Date(2020, 0, 1), undefined
            );
            const incomes = [passiveIncome];

            const priorities = [{ accountId: 'ira-1', capType: 'MAX', capValue: 7000 }];
            const state = makeWithdrawalState();
            const logs: string[] = [];

            processInflows(
                incomes, accounts, makeAssumptions(priorities), 2025, state,
                20000, // $20k discretionary cash available
                undefined, 50000, 45, logs
            );

            // IRA contribution should be blocked (0 earned income)
            expect(state.userInflows['ira-1'] || 0).toBe(0);
            expect(logs.some(log => log.includes('no earned income'))).toBe(true);
        });

        it('blocks Traditional IRA contribution when no earned income exists', () => {
            const tradIRA = new InvestedAccount(
                'ira-1', 'Traditional IRA', 10000, 0, 0, 0.1,
                'Traditional IRA', true, 0
            );
            const accounts = [tradIRA];

            // No incomes at all
            const incomes: any[] = [];

            const priorities = [{ accountId: 'ira-1', capType: 'MAX', capValue: 7000 }];
            const state = makeWithdrawalState();
            const logs: string[] = [];

            processInflows(
                incomes, accounts, makeAssumptions(priorities), 2025, state,
                20000, undefined, 50000, 45, logs
            );

            expect(state.userInflows['ira-1'] || 0).toBe(0);
        });
    });

    describe('caps contributions at earned income', () => {
        it('caps IRA contribution at earned income when earned income < IRA limit', () => {
            const rothIRA = new InvestedAccount(
                'ira-1', 'Roth IRA', 10000, 0, 0, 0.1,
                'Roth IRA', true, 0
            );
            const accounts = [rothIRA];

            // Only $3000 earned income (less than $7000 IRA limit for 2025)
            // WorkIncome constructor: id, name, amount, frequency, earned_income, preTax401k, insurance, roth401k, employerMatch, matchAccountId, ...
            const workIncome = new WorkIncome(
                'work-1', 'Part-time Job', 3000, 'Annually', 'Yes',
                0, 0, 0, 0, '', null, 'FIXED',
                new Date(2020, 0, 1), undefined
            );
            const incomes = [workIncome];

            const priorities = [{ accountId: 'ira-1', capType: 'MAX', capValue: 7000 }];
            const state = makeWithdrawalState();
            const logs: string[] = [];

            processInflows(
                incomes, accounts, makeAssumptions(priorities), 2025, state,
                20000, undefined, 50000, 45, logs
            );

            // Should be capped at earned income ($3000), not IRA limit ($7000)
            expect(state.userInflows['ira-1']).toBe(3000);
            expect(logs.some(log => log.includes('IRA contribution capped'))).toBe(true);
        });

        it('allows full contribution when earned income >= IRA limit', () => {
            const rothIRA = new InvestedAccount(
                'ira-1', 'Roth IRA', 10000, 0, 0, 0.1,
                'Roth IRA', true, 0
            );
            const accounts = [rothIRA];

            // $50000 earned income (more than $7000 IRA limit)
            const workIncome = new WorkIncome(
                'work-1', 'Full-time Job', 50000, 'Annually', 'Yes',
                0, 0, 0, 0, '', null, 'FIXED',
                new Date(2020, 0, 1), undefined
            );
            const incomes = [workIncome];

            const priorities = [{ accountId: 'ira-1', capType: 'MAX', capValue: 7000 }];
            const state = makeWithdrawalState();
            const logs: string[] = [];

            processInflows(
                incomes, accounts, makeAssumptions(priorities), 2025, state,
                20000, undefined, 50000, 45, logs
            );

            // Full IRA limit should be contributed
            expect(state.userInflows['ira-1']).toBe(7000);
        });
    });

    describe('tracks cumulative IRA contributions', () => {
        it('caps total IRA contributions across multiple IRA accounts', () => {
            const rothIRA = new InvestedAccount(
                'roth-ira', 'Roth IRA', 10000, 0, 0, 0.1,
                'Roth IRA', true, 0
            );
            const tradIRA = new InvestedAccount(
                'trad-ira', 'Traditional IRA', 10000, 0, 0, 0.1,
                'Traditional IRA', true, 0
            );
            const accounts = [rothIRA, tradIRA];

            // $50000 earned income
            const workIncome = new WorkIncome(
                'work-1', 'Full-time Job', 50000, 'Annually', 'Yes',
                0, 0, 0, 0, '', null, 'FIXED',
                new Date(2020, 0, 1), undefined
            );
            const incomes = [workIncome];

            // Try to contribute $5000 to each IRA ($10000 total, exceeding $7000 limit)
            const priorities = [
                { accountId: 'roth-ira', capType: 'MAX', capValue: 5000 },
                { accountId: 'trad-ira', capType: 'MAX', capValue: 5000 },
            ];
            const state = makeWithdrawalState();
            const logs: string[] = [];

            processInflows(
                incomes, accounts, makeAssumptions(priorities), 2025, state,
                20000, undefined, 50000, 45, logs
            );

            // First IRA gets $5000, second IRA gets $2000 (remaining of $7000 limit)
            expect(state.userInflows['roth-ira']).toBe(5000);
            expect(state.userInflows['trad-ira']).toBe(2000);

            const totalIRA = (state.userInflows['roth-ira'] || 0) + (state.userInflows['trad-ira'] || 0);
            expect(totalIRA).toBe(7000);
        });
    });

    describe('does not affect non-IRA accounts', () => {
        it('allows Savings contributions without earned income', () => {
            const savings = new SavedAccount('sav-1', 'Emergency Fund', 10000, 1.5);
            const accounts = [savings];

            // No earned income (passive only)
            const passiveIncome = new PassiveIncome(
                'pass-1', 'Dividends', 50000, 'Annually', 'No', 'Dividend',
                new Date(2020, 0, 1), undefined
            );
            const incomes = [passiveIncome];

            const priorities = [{ accountId: 'sav-1', capType: 'MAX', capValue: 10000 }];
            const state = makeWithdrawalState();
            const logs: string[] = [];

            processInflows(
                incomes, accounts, makeAssumptions(priorities), 2025, state,
                20000, undefined, 50000, 45, logs
            );

            // Savings should receive contribution regardless of earned income
            expect(state.userInflows['sav-1']).toBe(10000);
        });

        it('allows Brokerage contributions without earned income', () => {
            const brokerage = new InvestedAccount(
                'brok-1', 'Brokerage', 10000, 0, 0, 0.1,
                'Brokerage', true, 0
            );
            const accounts = [brokerage];

            // No incomes
            const incomes: any[] = [];

            const priorities = [{ accountId: 'brok-1', capType: 'MAX', capValue: 5000 }];
            const state = makeWithdrawalState();
            const logs: string[] = [];

            processInflows(
                incomes, accounts, makeAssumptions(priorities), 2025, state,
                20000, undefined, 50000, 45, logs
            );

            // Brokerage should receive contribution
            expect(state.userInflows['brok-1']).toBe(5000);
        });
    });

    describe('handles catch-up contributions', () => {
        it('allows catch-up IRA contributions for age 50+', () => {
            const rothIRA = new InvestedAccount(
                'ira-1', 'Roth IRA', 10000, 0, 0, 0.1,
                'Roth IRA', true, 0
            );
            const accounts = [rothIRA];

            // Plenty of earned income
            const workIncome = new WorkIncome(
                'work-1', 'Full-time Job', 100000, 'Annually', 'Yes',
                0, 0, 0, 0, '', null, 'FIXED',
                new Date(2020, 0, 1), undefined
            );
            const incomes = [workIncome];

            // Try to contribute $8000 (base $7000 + $1000 catch-up for age 50+)
            const priorities = [{ accountId: 'ira-1', capType: 'MAX', capValue: 8000 }];
            const state = makeWithdrawalState();
            const logs: string[] = [];

            // Age 55 (eligible for catch-up)
            processInflows(
                incomes, accounts, makeAssumptions(priorities), 2025, state,
                20000, undefined, 50000, 55, logs
            );

            // Should allow $8000 (base + catch-up)
            expect(state.userInflows['ira-1']).toBe(8000);
        });
    });
});
