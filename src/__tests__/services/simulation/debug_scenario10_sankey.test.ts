/**
 * Debug test to verify Sankey balance calculation in Scenario 10
 */
import { describe, it, expect } from 'vitest';
import { simulateOneYear } from '../../../components/Objects/Assumptions/SimulationEngine';
import { InvestedAccount, SavedAccount } from '../../../components/Objects/Accounts/models';
import { SocialSecurityIncome, PassiveIncome } from '../../../components/Objects/Income/models';
import { OtherExpense } from '../../../components/Objects/Expense/models';
import { AssumptionsState, defaultAssumptions, createBuiltinMilestones } from '../../../components/Objects/Assumptions/AssumptionsContext';
import { TaxState } from '../../../components/Objects/Taxes/TaxContext';

const BIRTH_YEAR = 1960; // Age 67 in 2027

function createAccounts() {
    const traditional = new InvestedAccount(
        'trad-1', 'Traditional IRA', 800000,
        0, 10, 0.05, 'Traditional IRA',
        false, 0, 0
    );
    const roth = new InvestedAccount(
        'roth-1', 'Roth IRA', 200000,
        0, 10, 0.05, 'Roth IRA',
        false, 0, 150000
    );
    const brokerage = new InvestedAccount(
        'brokerage-1', 'Brokerage', 300000,
        0, 10, 0.07, 'Brokerage',
        false, 0, 200000
    );
    const savings = new SavedAccount('savings-1', 'Emergency Fund', 25000, 2.0);
    return [traditional, roth, brokerage, savings];
}

function createIncomes() {
    // Social Security: $2500/month = $30k/year
    const ss = new SocialSecurityIncome(
        'ss-1', 'Social Security',
        2500, 'Monthly', 67,
        undefined, new Date('2027-01-01')
    );
    // Pension: $15k/year
    const pension = new PassiveIncome(
        'pension-1', 'Pension', 15000, 'Annually', 'No', 'Other',
        new Date('2027-01-01'), undefined, false
    );
    return [ss, pension];
}

function createExpenses() {
    return [new OtherExpense('exp-1', 'Living', 50000, 'Annually', new Date('2020-01-01'))];
}

function createAssumptions(): AssumptionsState {
    return {
        ...defaultAssumptions,
        milestones: createBuiltinMilestones(BIRTH_YEAR, 60, 95),
        simulation: { useNewEngine: true },
        investments: {
            ...defaultAssumptions.investments,
            taxOptimizationEnabled: false,
            returnRates: { ror: 5 },
        },
        withdrawalStrategy: [
            { id: 'ws-1', name: 'Traditional', accountId: 'trad-1' },
            { id: 'ws-2', name: 'Brokerage', accountId: 'brokerage-1' },
            { id: 'ws-3', name: 'Roth', accountId: 'roth-1' },
        ],
    };
}

function createTaxState(): TaxState {
    return {
        filingStatus: 'Single',
        stateResidency: 'Texas',
        deductionMethod: 'Standard',
        fedOverride: null,
        ficaOverride: null,
        stateOverride: null,
        year: 2027,
    };
}

describe('Debug Scenario 10 Sankey Balance', () => {
    it('should show Sankey balance components for Year 2027', () => {
        const accounts = createAccounts();
        const incomes = createIncomes();
        const expenses = createExpenses();
        const assumptions = createAssumptions();
        const taxState = createTaxState();

        // Simulate Year 2027 (age 67)
        const result = simulateOneYear(
            2027,
            incomes,
            expenses,
            accounts,
            assumptions,
            taxState,
            [] // no previous simulation
        );

        const cf = result.cashflow;

        console.log('\n========== SCENARIO 10 SANKEY DEBUG (Year 2027) ==========');
        console.log('\nCASHFLOW FIELDS:');
        console.log('  cf.totalIncome:', cf.totalIncome);
        console.log('  cf.withdrawals:', cf.withdrawals);
        console.log('  cf.totalExpense:', cf.totalExpense);
        console.log('  cf.livingExpenses:', cf.livingExpenses);
        console.log('  cf.totalInvested:', cf.totalInvested);
        console.log('  cf.investedUser:', cf.investedUser);
        console.log('  cf.investedMatch:', cf.investedMatch);
        console.log('  cf.bucketAllocations:', cf.bucketAllocations);
        console.log('  cf.discretionary:', cf.discretionary);

        console.log('\nTAX DETAILS:');
        console.log('  fed:', result.taxDetails.fed);
        console.log('  state:', result.taxDetails.state);
        console.log('  fica:', result.taxDetails.fica);
        console.log('  preTax:', result.taxDetails.preTax);
        console.log('  postTax:', result.taxDetails.postTax);
        console.log('  insurance:', result.taxDetails.insurance);

        console.log('\nWITHDRAWAL DETAILS:');
        console.log('  withdrawalDetail:', JSON.stringify(cf.withdrawalDetail, null, 2));

        console.log('\nSANKEY EQUATION:');
        const inflows = cf.totalIncome + cf.withdrawals;
        const outflows = cf.totalExpense + cf.totalInvested + cf.bucketAllocations + cf.discretionary;
        const imbalance = inflows - outflows;

        console.log('  inflows = totalIncome + withdrawals');
        console.log('         =', cf.totalIncome, '+', cf.withdrawals, '=', inflows);
        console.log('  outflows = totalExpense + totalInvested + bucketAllocations + discretionary');
        console.log('          =', cf.totalExpense, '+', cf.totalInvested, '+', cf.bucketAllocations, '+', cf.discretionary, '=', outflows);
        console.log('  IMBALANCE:', imbalance);

        console.log('\nANALYSIS:');
        console.log('  If imbalance ≈ withdrawals, then withdrawals are not flowing out');
        console.log('  withdrawals:', cf.withdrawals);
        console.log('  imbalance:', imbalance);
        console.log('  difference:', Math.abs(cf.withdrawals - imbalance));

        console.log('\nHYPOTHESIS CHECK:');
        console.log('  If trueUserSaved should include withdrawals:');
        const correctedTrueUserSaved = cf.investedUser + cf.withdrawals;
        const correctedTotalInvested = correctedTrueUserSaved + cf.investedMatch;
        const correctedOutflows = cf.totalExpense + correctedTotalInvested + cf.bucketAllocations + cf.discretionary;
        const correctedImbalance = inflows - correctedOutflows;
        console.log('  correctedTotalInvested:', correctedTotalInvested);
        console.log('  correctedOutflows:', correctedOutflows);
        console.log('  correctedImbalance:', correctedImbalance);

        console.log('\n==========================================================\n');

        expect(true).toBe(true);
    });
});
