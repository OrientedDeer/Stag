/**
 * Debug YearSolver surplus calculation
 */
import { describe, it, expect } from 'vitest';
import { solveRetirementYear, YearSolverInput } from '../../../services/simulation/YearSolver';
import { InvestedAccount, SavedAccount, DeficitDebtAccount } from '../../../components/Objects/Accounts/models';
import { SocialSecurityIncome, PassiveIncome } from '../../../components/Objects/Income/models';
import { OtherExpense } from '../../../components/Objects/Expense/models';
import { AssumptionsState, defaultAssumptions, createBuiltinMilestones } from '../../../components/Objects/Assumptions/AssumptionsContext';
import { TaxState } from '../../../components/Objects/Taxes/TaxContext';

const BIRTH_YEAR = 1960; // Age 75 in 2035

describe('Debug YearSolver Surplus', () => {
    it('should show surplus calculation details', () => {
        // Recreate scenario similar to MC Year 2035
        const traditional = new InvestedAccount(
            'trad-1', 'Traditional IRA', 200000, // Lower balance after years of withdrawals
            0, 20, 0.05, 'Traditional IRA'
        );
        const brokerage = new InvestedAccount(
            'brokerage-1', 'Brokerage', 100000,
            0, 15, 0.07, 'Brokerage', true, 0.2, 50000
        );
        const savings = new SavedAccount('savings-1', 'Savings', 25000, 2.0);
        // Include existing deficit debt
        const deficitDebt = new DeficitDebtAccount('system-deficit-debt', 'Uncovered Deficit', 19993);

        const ss = new SocialSecurityIncome(
            'ss-1', 'Social Security', 2500, 'Monthly', 65, undefined, new Date('2025-01-01')
        );
        const pension = new PassiveIncome(
            'pension-1', 'Pension', 12000, 'Annually', 'No', 'Other', new Date('2025-01-01'), undefined, false
        );

        const expenses = [new OtherExpense('exp-1', 'Living', 70000, 'Annually', new Date('2020-01-01'))];

        const assumptions: AssumptionsState = {
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
            ],
        };

        const taxState: TaxState = {
            filingStatus: 'Single', stateResidency: 'Texas', deductionMethod: 'Standard',
            fedOverride: null, ficaOverride: null, stateOverride: null, year: 2035,
        };

        const input: YearSolverInput = {
            year: 2035,
            currentAge: 75,
            isRetired: true,
            incomes: [ss, pension],
            expenses: expenses,
            totalLivingExpenses: 70000,
            rmdAmount: 0, // No RMD for simplicity
            accounts: [traditional, brokerage, savings, deficitDebt],
            withdrawalOrder: [
                { accountId: 'trad-1' },
                { accountId: 'brokerage-1' },
            ],
            taxState,
            assumptions,
            taxOptimizationEnabled: false,
            acaAware: false,
        };

        const yearPlan = solveRetirementYear(input);

        console.log('\n========== YEARSOLVER SURPLUS DEBUG ==========');
        console.log('INPUT:');
        console.log('  totalLivingExpenses:', input.totalLivingExpenses);
        console.log('  rmdAmount:', input.rmdAmount);
        console.log('  deficitDebt balance:', deficitDebt.amount);
        
        console.log('\nOUTPUT:');
        console.log('  yearPlan.surplus:', yearPlan.surplus);
        console.log('  yearPlan.unfundedDeficit:', yearPlan.unfundedDeficit);
        console.log('  yearPlan.tax.total:', yearPlan.tax.total);
        
        console.log('\nINCOME:');
        console.log('  yearPlan.income.spendable:', yearPlan.income.spendable);
        console.log('  yearPlan.income.breakdown:', JSON.stringify(yearPlan.income.breakdown));
        
        console.log('\nWITHDRAWALS:');
        yearPlan.withdrawals.forEach(w => {
            console.log(`  ${w.source}: gross=${w.gross}, net=${w.net}, tax=${w.tax}, reason=${w.reason}`);
        });
        const totalGross = yearPlan.withdrawals.reduce((s, w) => s + w.gross, 0);
        const totalNet = yearPlan.withdrawals.reduce((s, w) => s + w.net, 0);
        console.log('  TOTAL gross:', totalGross);
        console.log('  TOTAL net:', totalNet);
        
        console.log('\nSURPLUS ALLOCATIONS:');
        yearPlan.surplusAllocations.forEach(a => {
            console.log(`  ${a.accountId}: $${a.amount.toFixed(2)} - ${a.reason}`);
        });
        
        console.log('\nSANKEY MATH (from YearSolver perspective):');
        const cashIn = yearPlan.income.spendable + input.rmdAmount + totalNet;
        const cashOut = input.totalLivingExpenses + yearPlan.tax.total;
        console.log('  cashIn = spendable + rmd + netWithdrawals =', yearPlan.income.spendable, '+', input.rmdAmount, '+', totalNet, '=', cashIn);
        console.log('  cashOut = expenses + tax =', input.totalLivingExpenses, '+', yearPlan.tax.total, '=', cashOut);
        console.log('  surplus = cashIn - cashOut =', cashIn - cashOut);
        
        console.log('================================================\n');

        expect(true).toBe(true);
    });
});
