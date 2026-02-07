/**
 * Debug Monte Carlo Sankey - find where imbalance comes from
 */
import { describe, it, expect } from 'vitest';
import { runMonteCarloSimulationSync } from '../../../services/MonteCarloEngine';
import { MonteCarloConfig } from '../../../services/MonteCarloTypes';
import { InvestedAccount, SavedAccount } from '../../../components/Objects/Accounts/models';
import { SocialSecurityIncome, PassiveIncome } from '../../../components/Objects/Income/models';
import { OtherExpense } from '../../../components/Objects/Expense/models';
import { AssumptionsState, defaultAssumptions, createBuiltinMilestones } from '../../../components/Objects/Assumptions/AssumptionsContext';
import { TaxState } from '../../../components/Objects/Taxes/TaxContext';

const BIRTH_YEAR = 1960;

function createAccounts() {
    const brokerage = new InvestedAccount(
        'brokerage-1', 'Brokerage', 400000,
        0, 15, 0.07, 'Brokerage', true, 0.2, 200000
    );
    const traditional = new InvestedAccount(
        'trad-1', 'Traditional IRA', 600000,
        0, 20, 0.05, 'Traditional IRA'
    );
    const roth = new InvestedAccount(
        'roth-1', 'Roth IRA', 100000,
        0, 15, 0.05, 'Roth IRA', true, 0.2, 60000
    );
    const savings = new SavedAccount('savings-1', 'Savings', 25000, 2.0);
    return [brokerage, traditional, roth, savings];
}

function createIncomes() {
    const ss = new SocialSecurityIncome(
        'ss-1', 'Social Security', 2083, 'Monthly', 65, undefined, new Date('2025-01-01')
    );
    const pension = new PassiveIncome(
        'pension-1', 'Pension', 10000, 'Annually', 'No', 'Other', new Date('2025-01-01'), undefined, false
    );
    return [ss, pension];
}

function createExpenses() {
    return [new OtherExpense('living-1', 'Living Expenses', 55000, 'Annually', new Date('2020-01-01'))];
}

function createAssumptions(): AssumptionsState {
    return {
        ...defaultAssumptions,
        milestones: createBuiltinMilestones(BIRTH_YEAR, 60, 95),
        simulation: { useNewEngine: true },
        investments: {
            ...defaultAssumptions.investments,
            taxOptimizationEnabled: false,
            returnRates: { ror: 6 },
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
        filingStatus: 'Single', stateResidency: 'Texas', deductionMethod: 'Standard',
        fedOverride: null, ficaOverride: null, stateOverride: null, year: 2025,
    };
}

function createConfig(): MonteCarloConfig {
    return { enabled: true, numScenarios: 10, seed: 42, returnMean: 6, returnStdDev: 15, preset: 'custom' };
}

describe('Debug Monte Carlo Sankey', () => {
    it('should show imbalance details for first failing year', () => {
        const result = runMonteCarloSimulationSync(
            createConfig(), createAccounts(), createIncomes(), createExpenses(),
            createAssumptions(), createTaxState()
        );

        console.log('\n========== MONTE CARLO SANKEY DEBUG ==========');
        
        // Check worst case timeline
        let firstImbalanceYear = null;
        for (const year of result.worstCase.timeline) {
            const cf = year.cashflow;
            const inflows = cf.totalIncome + cf.withdrawals;
            const outflows = cf.totalExpense + cf.totalInvested + cf.bucketAllocations + cf.discretionary;
            const imbalance = Math.abs(inflows - outflows);
            
            if (imbalance > 1 && !firstImbalanceYear) {
                firstImbalanceYear = year;
                console.log('\nFIRST IMBALANCED YEAR:', year.year);
                console.log('  totalIncome:', cf.totalIncome);
                console.log('  withdrawals:', cf.withdrawals);
                console.log('  totalExpense:', cf.totalExpense);
                console.log('  totalInvested:', cf.totalInvested);
                console.log('  investedUser:', cf.investedUser);
                console.log('  investedMatch:', cf.investedMatch);
                console.log('  bucketAllocations:', cf.bucketAllocations);
                console.log('  discretionary:', cf.discretionary);
                console.log('  livingExpenses:', cf.livingExpenses);
                console.log('  inflows:', inflows);
                console.log('  outflows:', outflows);
                console.log('  IMBALANCE:', imbalance);
                console.log('  withdrawalDetail:', JSON.stringify(cf.withdrawalDetail));
                console.log('  bucketDetail:', JSON.stringify(cf.bucketDetail));
            }
        }

        // Also check a year with large imbalance
        let maxImbalanceYear = null;
        let maxImbalance = 0;
        for (const year of result.worstCase.timeline) {
            const cf = year.cashflow;
            const inflows = cf.totalIncome + cf.withdrawals;
            const outflows = cf.totalExpense + cf.totalInvested + cf.bucketAllocations + cf.discretionary;
            const imbalance = Math.abs(inflows - outflows);
            if (imbalance > maxImbalance) {
                maxImbalance = imbalance;
                maxImbalanceYear = year;
            }
        }

        if (maxImbalanceYear && maxImbalanceYear !== firstImbalanceYear) {
            const cf = maxImbalanceYear.cashflow;
            console.log('\nMAX IMBALANCE YEAR:', maxImbalanceYear.year);
            console.log('  totalIncome:', cf.totalIncome);
            console.log('  withdrawals:', cf.withdrawals);
            console.log('  totalExpense:', cf.totalExpense);
            console.log('  totalInvested:', cf.totalInvested);
            console.log('  bucketAllocations:', cf.bucketAllocations);
            console.log('  discretionary:', cf.discretionary);
            const inflows = cf.totalIncome + cf.withdrawals;
            const outflows = cf.totalExpense + cf.totalInvested + cf.bucketAllocations + cf.discretionary;
            console.log('  inflows:', inflows);
            console.log('  outflows:', outflows);
            console.log('  IMBALANCE:', maxImbalance);
        }

        console.log('\n================================================\n');
        expect(true).toBe(true);
    });
});
