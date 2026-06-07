/**
 * Debug test for a reported scenario:
 * - $841k Traditional 401k
 * - $581k Brokerage
 * - $213k Roth IRA
 * - $35k Social Security starting at 67
 * - $44k rent + $24k other expenses = $68k/year
 * - Inflation off, rent increasing at 1.2%
 *
 * Issues reported:
 * 1. Deficit appearing on cashflow chart
 * 2. Traditional 401k being emptied instead of preserved
 */

import { describe, it, expect } from 'vitest';
import { runSimulation } from '../../components/Objects/Assumptions/useSimulation';
import {
    AssumptionsState,
    defaultAssumptions,
    createBuiltinMilestones,
} from '../../components/Objects/Assumptions/AssumptionsContext';
import { TaxState } from '../../components/Objects/Taxes/TaxContext';
import { InvestedAccount, AnyAccount } from '../../components/Objects/Accounts/models';
import { CurrentSocialSecurityIncome, AnyIncome } from '../../components/Objects/Income/models';
import { AnyExpense, RentExpense, OtherExpense } from '../../components/Objects/Expense/models';
// TODO: Re-implement tax optimization functions per TAX_OPTIMIZATION_SPEC.md

// ============================================================================
// Test Setup - reported scenario
// ============================================================================

function createUserAssumptions(birthYear: number, retirementAge: number): AssumptionsState {
    const lifeExpectancy = 90;

    return {
        ...defaultAssumptions,
        milestones: createBuiltinMilestones(birthYear, retirementAge, lifeExpectancy),
        investments: {
            ...defaultAssumptions.investments,
            returnRates: { ror: 6 },
            taxOptimizationEnabled: true,
            autoRothConversions: true,
            withdrawalStrategy: 'Fixed Real',
            withdrawalRate: 4,
        },
        expenses: {
            ...defaultAssumptions.expenses,
            rentInflation: 1.2, // User's rent inflation
        },
        macro: {
            ...defaultAssumptions.macro,
            inflationRate: 0, // Inflation OFF
            inflationAdjusted: false,
        },
        // Withdrawal order: Savings -> Brokerage -> Traditional -> Roth
        // This is the standard order that drains taxable accounts first
        withdrawalStrategy: [
            { accountId: 'brokerage', name: 'Brokerage', id: 'bucket-1' },
            { accountId: 'trad-401k', name: 'Traditional 401k', id: 'bucket-2' },
            { accountId: 'roth-ira', name: 'Roth IRA', id: 'bucket-3' },
        ],
    };
}

function createUserTaxState(): TaxState {
    return {
        filingStatus: 'Single', // Assuming single based on scenario
        stateResidency: 'Virginia',
        deductionMethod: 'Standard',
        fedOverride: null,
        ficaOverride: null,
        stateOverride: null,
        year: new Date().getFullYear(),
    };
}

function createUserAccounts(): AnyAccount[] {
    return [
        // Traditional 401k - $841k
        new InvestedAccount(
            'trad-401k',
            'Traditional 401k',
            841000,
            0, 0, 0.1, 'Traditional 401k', false, 0.2, 841000
        ),
        // Brokerage - $581k
        new InvestedAccount(
            'brokerage',
            'Brokerage',
            581000,
            0, 0, 0.1, 'Brokerage', false, 0.2, 400000 // Cost basis ~$400k
        ),
        // Roth IRA - $213k
        new InvestedAccount(
            'roth-ira',
            'Roth IRA',
            213000,
            0, 0, 0.1, 'Roth IRA', false, 0.2, 150000 // Cost basis (contributions)
        ),
    ];
}

function createUserIncomes(ssStartYear: number): AnyIncome[] {
    return [
        // Social Security - $35k starting at 67
        new CurrentSocialSecurityIncome(
            'ss-1',
            'Social Security',
            35000,
            'Annually',
            new Date(ssStartYear, 0, 1),
            undefined
        ),
    ];
}

function createUserExpenses(): AnyExpense[] {
    return [
        // Rent - $44k/year
        new RentExpense(
            'rent-1',
            'Rent',
            44000 / 12, // Monthly payment
            0, // Utilities included in "other"
            'Monthly',
            new Date(),
            undefined,
            undefined,
            undefined
        ),
        // Other expenses - $24k/year
        new OtherExpense(
            'other-1',
            'Living Expenses',
            24000,
            'Annually',
            new Date(),
            undefined,
            undefined,
            undefined
        ),
    ];
}

// ============================================================================
// Debug Tests
// ============================================================================

describe('User Scenario Debug', () => {
    it('should show detailed simulation output for debugging', () => {
        // User is already retired at 40!
        // If they're currently ~40 in 2026, birth year is ~1986
        const birthYear = 1986; // Age 40 in 2026
        const retirementAge = 40; // Already retired
        const ssStartYear = birthYear + 67; // SS at 67 = 2053

        const assumptions = createUserAssumptions(birthYear, retirementAge);
        const taxState = createUserTaxState();
        const accounts = createUserAccounts();
        const incomes = createUserIncomes(ssStartYear);
        const expenses = createUserExpenses();

        console.log('=== USER SCENARIO DEBUG ===');
        console.log('Birth Year:', birthYear);
        console.log('Retirement Age:', retirementAge);
        console.log('SS Start Year:', ssStartYear);
        console.log('Tax Optimization Enabled:', assumptions.investments.taxOptimizationEnabled);
        console.log('Auto Roth Conversions:', assumptions.investments.autoRothConversions);
        console.log('');

        // TODO: Re-implement target balance calculation per TAX_OPTIMIZATION_SPEC.md
        console.log('Target balance calculation pending reimplementation');
        console.log('');

        // Run simulation
        const yearsToRun = 50; // To age 90 (life expectancy)
        const simulation = runSimulation(
            yearsToRun,
            accounts,
            incomes,
            expenses,
            assumptions,
            taxState
        );

        console.log('Simulation length:', simulation.length);
        console.log('');

        // Detailed year-by-year output
        console.log('Year-by-Year Breakdown:');
        console.log('Age\tTrad 401k\tBrokerage\tRoth IRA\tIncome\t\tExpenses\tDeficit\t\tRoth Conv\tWithdrawals');
        console.log('---\t---------\t---------\t--------\t------\t\t--------\t-------\t\t---------\t-----------');

        for (const simYear of simulation) {
            const age = simYear.year - birthYear;

            const tradBalance = simYear.accounts
                .filter(acc => 'taxType' in acc && acc.taxType === 'Traditional 401k')
                .reduce((sum, acc) => sum + acc.amount, 0);

            const brokerageBalance = simYear.accounts
                .filter(acc => 'taxType' in acc && acc.taxType === 'Brokerage')
                .reduce((sum, acc) => sum + acc.amount, 0);

            const rothBalance = simYear.accounts
                .filter(acc => 'taxType' in acc && (acc.taxType === 'Roth IRA' || acc.taxType === 'Roth 401k'))
                .reduce((sum, acc) => sum + acc.amount, 0);

            const income = simYear.cashflow.totalIncome;
            const expenses = simYear.cashflow.totalExpense;
            const deficit = expenses - income;
            const rothConv = simYear.rothConversion?.amount || 0;
            const withdrawals = simYear.cashflow.withdrawals || 0;

            console.log(
                `${age}\t$${Math.round(tradBalance).toLocaleString()}\t$${Math.round(brokerageBalance).toLocaleString()}\t$${Math.round(rothBalance).toLocaleString()}\t$${Math.round(income).toLocaleString()}\t\t$${Math.round(expenses).toLocaleString()}\t\t$${Math.round(deficit).toLocaleString()}\t\t$${Math.round(rothConv).toLocaleString()}\t\t$${Math.round(withdrawals).toLocaleString()}`
            );
        }

        console.log('');

        // Check for issues
        const atAge73 = simulation.find(s => s.year - birthYear === 73);

        console.log('=== ISSUE ANALYSIS ===');

        // Issue 1: Deficit on cashflow
        const yearsWithDeficit = simulation.filter(s => {
            const deficit = s.cashflow.totalExpense - s.cashflow.totalIncome;
            return deficit > 0 && s.cashflow.withdrawals < deficit * 0.9;
        });
        console.log('Years with uncovered deficit:', yearsWithDeficit.length);
        if (yearsWithDeficit.length > 0) {
            console.log('First year with deficit:', yearsWithDeficit[0].year - birthYear);
        }

        // Issue 2: Traditional being emptied
        const tradAtStart = 841000;
        const tradAt73 = atAge73 ? atAge73.accounts
            .filter(acc => 'taxType' in acc && acc.taxType === 'Traditional 401k')
            .reduce((sum, acc) => sum + acc.amount, 0) : 0;

        console.log('Traditional at start:', tradAtStart.toLocaleString());
        console.log('Traditional at 73:', tradAt73.toLocaleString());
        // TODO: Re-implement target balance calculation per TAX_OPTIMIZATION_SPEC.md
        console.log('Traditional preserved?', tradAt73 > 0 ? 'YES' : 'NO - EMPTIED!');

        // Check withdrawal details
        console.log('');
        console.log('=== WITHDRAWAL DETAILS ===');
        for (let i = 0; i < Math.min(10, simulation.length); i++) {
            const s = simulation[i];
            const age = s.year - birthYear;
            console.log(`Age ${age}:`, s.cashflow.withdrawalDetail || 'No detail');
        }

        // Assertions to catch issues
        expect(simulation.length).toBeGreaterThan(0);
    });

    it('should compare tax optimization ON vs OFF for user scenario', () => {
        const birthYear = 1986;
        const retirementAge = 40;
        const ssStartYear = birthYear + 67;

        const taxState = createUserTaxState();
        const accounts = createUserAccounts();
        const incomes = createUserIncomes(ssStartYear);
        const expenses = createUserExpenses();

        // With tax optimization ON
        const assumptionsON = createUserAssumptions(birthYear, retirementAge);
        const simON = runSimulation(50, accounts, incomes, expenses, assumptionsON, taxState);

        // With tax optimization OFF
        const assumptionsOFF = {
            ...createUserAssumptions(birthYear, retirementAge),
            investments: {
                ...createUserAssumptions(birthYear, retirementAge).investments,
                taxOptimizationEnabled: false,
            },
        };
        const simOFF = runSimulation(50, accounts, incomes, expenses, assumptionsOFF, taxState);

        // Compare
        const taxesON = simON.reduce((sum, y) =>
            sum + y.taxDetails.fed + y.taxDetails.state + y.taxDetails.fica + y.taxDetails.capitalGains, 0);
        const taxesOFF = simOFF.reduce((sum, y) =>
            sum + y.taxDetails.fed + y.taxDetails.state + y.taxDetails.fica + y.taxDetails.capitalGains, 0);

        const getTradAt = (sim: typeof simON, age: number) => {
            const year = sim.find(s => s.year - birthYear === age);
            if (!year) return 0;
            return year.accounts
                .filter(acc => 'taxType' in acc && acc.taxType === 'Traditional 401k')
                .reduce((sum, acc) => sum + acc.amount, 0);
        };

        console.log('=== COMPARISON: TAX OPTIMIZATION ON vs OFF ===');
        console.log('');
        console.log('Lifetime Taxes:');
        console.log('  With optimization ON:', taxesON.toLocaleString());
        console.log('  With optimization OFF:', taxesOFF.toLocaleString());
        console.log('  Difference:', (taxesOFF - taxesON).toLocaleString());
        console.log('');
        console.log('Traditional 401k Balances:');
        console.log('  Age 70 (ON):', getTradAt(simON, 70).toLocaleString());
        console.log('  Age 70 (OFF):', getTradAt(simOFF, 70).toLocaleString());
        console.log('  Age 73 (ON):', getTradAt(simON, 73).toLocaleString());
        console.log('  Age 73 (OFF):', getTradAt(simOFF, 73).toLocaleString());
        console.log('  Age 80 (ON):', getTradAt(simON, 80).toLocaleString());
        console.log('  Age 80 (OFF):', getTradAt(simOFF, 80).toLocaleString());
    });
});
