import { describe, it, expect } from 'vitest';
import { AssumptionsState, defaultAssumptions } from '../../components/Objects/Assumptions/AssumptionsContext';
import { TaxState } from '../../components/Objects/Taxes/TaxContext';
import { InvestedAccount } from '../../components/Objects/Accounts/models';
import { FutureSocialSecurityIncome } from '../../components/Objects/Income/models';
import { FoodExpense } from '../../components/Objects/Expense/models';
import { simulateOneYear } from '../../components/Objects/Assumptions/SimulationEngine';

/**
 * Debug test for Roth conversion deficit issue
 * The user reports seeing a deficit matching the Roth conversion amount
 * in early retirement years.
 */
describe('Roth Conversion Deficit Debug', () => {
    const mockTaxState: TaxState = {
        filingStatus: 'Single',
        stateResidency: 'Texas', // No state tax
        deductionMethod: 'Standard',
        fedOverride: null,
        ficaOverride: null,
        stateOverride: null,
        year: 2025
    };

    it('should trace through Roth conversion cashflow', () => {
        // Setup: Early retirement with low income, Roth conversion enabled
        const retiredAssumptions: AssumptionsState = {
            ...defaultAssumptions,
            demographics: {
                birthYear: 1960, // Age 65 in 2025
                lifeExpectancy: 90,
                retirementAge: 65
            },
            investments: {
                ...defaultAssumptions.investments,
                returnRates: { ror: 7 },
                withdrawalRate: 4,
                withdrawalStrategy: 'Fixed Real',
                autoRothConversions: true // Enable auto conversions
            },
            withdrawalStrategy: [
                { id: 'ws-trad', accountId: 'trad-401k', name: 'Traditional 401k' },
                { id: 'ws-roth', accountId: 'roth-ira', name: 'Roth IRA' },
                { id: 'ws-brokerage', accountId: 'brokerage', name: 'Brokerage' }
            ]
        };

        // Accounts
        const traditional401k = new InvestedAccount(
            'trad-401k',
            'Traditional 401k',
            500000, // $500k balance
            0, 0, 0.1,
            'Traditional 401k'
        );

        const rothIRA = new InvestedAccount(
            'roth-ira',
            'Roth IRA',
            100000, // $100k balance
            0, 0, 0.1,
            'Roth IRA'
        );

        const brokerage = new InvestedAccount(
            'brokerage',
            'Brokerage',
            200000, // $200k balance
            0, 0, 0.1,
            'Brokerage',
            true,
            0.5,
            150000 // $150k cost basis
        );

        // Small Social Security income
        const ssIncome = new FutureSocialSecurityIncome(
            'ss-1',
            'Social Security',
            65,
            2000, // $2000/month
            2025,
            new Date('2025-01-01'),
            new Date('2060-12-31')
        );

        // Living expenses
        const livingExpense = new FoodExpense(
            'exp-1',
            'Living Expenses',
            40000, // $40k/year
            'Annually',
            new Date('2025-01-01'),
            undefined
        );

        console.log('\n========== ROTH CONVERSION DEBUG TEST ==========\n');
        console.log('SETUP:');
        console.log('  Traditional 401k: $500,000');
        console.log('  Roth IRA: $100,000');
        console.log('  Brokerage: $200,000');
        console.log('  Social Security: $24,000/year');
        console.log('  Living Expenses: $40,000/year');
        console.log('  Auto Roth Conversions: ENABLED');
        console.log('');

        const result = simulateOneYear(
            2025,
            [ssIncome],
            [livingExpense],
            [traditional401k, rothIRA, brokerage],
            retiredAssumptions,
            mockTaxState
        );

        console.log('========== SIMULATION RESULT ==========\n');

        // Cashflow breakdown
        console.log('CASHFLOW:');
        console.log(`  totalIncome (cash): $${result.cashflow.totalIncome.toLocaleString()}`);
        console.log(`  totalExpense: $${result.cashflow.totalExpense.toLocaleString()}`);
        console.log(`  discretionary: $${result.cashflow.discretionary.toLocaleString()}`);
        console.log(`  withdrawals: $${result.cashflow.withdrawals.toLocaleString()}`);
        console.log(`  withdrawalDetail:`, result.cashflow.withdrawalDetail);
        console.log('');

        // Tax breakdown
        console.log('TAXES:');
        console.log(`  fed: $${result.taxDetails.fed.toLocaleString()}`);
        console.log(`  state: $${result.taxDetails.state.toLocaleString()}`);
        console.log(`  fica: $${result.taxDetails.fica.toLocaleString()}`);
        const totalTax = result.taxDetails.fed + result.taxDetails.state + result.taxDetails.fica;
        console.log(`  TOTAL TAX: $${totalTax.toLocaleString()}`);
        console.log('');

        // Roth conversion details
        console.log('ROTH CONVERSION:');
        if (result.rothConversion) {
            console.log(`  amount: $${result.rothConversion.amount.toLocaleString()}`);
            console.log(`  taxCost: $${result.rothConversion.taxCost.toLocaleString()}`);
            console.log(`  fromAccounts:`, result.rothConversion.fromAccounts);
            console.log(`  toAccounts:`, result.rothConversion.toAccounts);
        } else {
            console.log('  No conversion performed');
        }
        console.log('');

        // Account balances after
        console.log('ACCOUNT BALANCES AFTER:');
        result.accounts.forEach(acc => {
            console.log(`  ${acc.name}: $${acc.amount.toLocaleString()}`);
        });
        console.log('');

        // Logs from simulation
        console.log('SIMULATION LOGS:');
        result.logs.forEach(log => console.log(`  ${log}`));
        console.log('');

        // Analysis
        console.log('========== ANALYSIS ==========\n');
        const conversionAmount = result.rothConversion?.amount || 0;
        const conversionTax = result.rothConversion?.taxCost || 0;

        console.log('Expected cashflow:');
        console.log(`  SS Income: $24,000`);
        console.log(`  - Living Expenses: $40,000`);
        console.log(`  - Tax on conversion: $${conversionTax.toLocaleString()}`);
        console.log(`  = Deficit (before withdrawals): $${(24000 - 40000 - conversionTax).toLocaleString()}`);
        console.log('');

        console.log('The Roth conversion amount should NOT create a deficit!');
        console.log('Only the TAX on the conversion should need to be covered.');
        console.log(`  Conversion amount: $${conversionAmount.toLocaleString()}`);
        console.log(`  Conversion tax: $${conversionTax.toLocaleString()}`);
        console.log('');

        // Check if deficit matches conversion amount (the bug)
        if (Math.abs(result.cashflow.withdrawals - conversionAmount) < 100) {
            console.log('⚠️  BUG DETECTED: Withdrawals match conversion amount!');
            console.log('    This suggests the conversion is being treated as an expense.');
        }

        // Basic assertion - the test should complete
        expect(result).toBeDefined();
        expect(result.cashflow).toBeDefined();
    });

    it('should compare with and without Roth conversions', () => {
        const baseAssumptions: AssumptionsState = {
            ...defaultAssumptions,
            demographics: {
                birthYear: 1960,
                lifeExpectancy: 90,
                retirementAge: 65
            },
            investments: {
                ...defaultAssumptions.investments,
                returnRates: { ror: 7 },
                withdrawalRate: 4,
                withdrawalStrategy: 'Fixed Real',
                autoRothConversions: false // DISABLED
            },
            withdrawalStrategy: [
                { id: 'ws-trad', accountId: 'trad-401k', name: 'Traditional 401k' },
                { id: 'ws-brokerage', accountId: 'brokerage', name: 'Brokerage' }
            ]
        };

        const withConversions: AssumptionsState = {
            ...baseAssumptions,
            investments: {
                ...baseAssumptions.investments,
                autoRothConversions: true // ENABLED
            },
            withdrawalStrategy: [
                { id: 'ws-trad', accountId: 'trad-401k', name: 'Traditional 401k' },
                { id: 'ws-roth', accountId: 'roth-ira', name: 'Roth IRA' },
                { id: 'ws-brokerage', accountId: 'brokerage', name: 'Brokerage' }
            ]
        };

        const ssIncome = new FutureSocialSecurityIncome('ss-1', 'Social Security', 65, 2000, 2025, new Date('2025-01-01'), new Date('2060-12-31'));
        const expense = new FoodExpense('exp-1', 'Living', 40000, 'Annually', new Date('2025-01-01'), undefined);

        console.log('\n========== COMPARISON TEST ==========\n');

        // Create fresh accounts for each run
        const accountsWithout = [
            new InvestedAccount('trad-401k', 'Traditional 401k', 500000, 0, 0, 0.1, 'Traditional 401k'),
            new InvestedAccount('roth-ira', 'Roth IRA', 100000, 0, 0, 0.1, 'Roth IRA'),
            new InvestedAccount('brokerage', 'Brokerage', 200000, 0, 0, 0.1, 'Brokerage', true, 0.5, 150000)
        ];

        // Run WITHOUT conversions
        const resultWithout = simulateOneYear(
            2025,
            [ssIncome],
            [expense],
            accountsWithout,
            baseAssumptions,
            mockTaxState
        );

        console.log('WITHOUT Roth Conversions:');
        console.log(`  totalIncome: $${resultWithout.cashflow.totalIncome.toLocaleString()}`);
        console.log(`  discretionary: $${resultWithout.cashflow.discretionary.toLocaleString()}`);
        console.log(`  withdrawals: $${resultWithout.cashflow.withdrawals.toLocaleString()}`);
        console.log(`  totalTax: $${(resultWithout.taxDetails.fed + resultWithout.taxDetails.state + resultWithout.taxDetails.fica).toLocaleString()}`);
        console.log('');

        // Create fresh accounts for each run
        const accountsWith = [
            new InvestedAccount('trad-401k', 'Traditional 401k', 500000, 0, 0, 0.1, 'Traditional 401k'),
            new InvestedAccount('roth-ira', 'Roth IRA', 100000, 0, 0, 0.1, 'Roth IRA'),
            new InvestedAccount('brokerage', 'Brokerage', 200000, 0, 0, 0.1, 'Brokerage', true, 0.5, 150000)
        ];

        // Run WITH conversions
        const resultWith = simulateOneYear(
            2025,
            [ssIncome],
            [expense],
            accountsWith,
            withConversions,
            mockTaxState
        );

        console.log('WITH Roth Conversions:');
        console.log(`  totalIncome: $${resultWith.cashflow.totalIncome.toLocaleString()}`);
        console.log(`  discretionary: $${resultWith.cashflow.discretionary.toLocaleString()}`);
        console.log(`  withdrawals: $${resultWith.cashflow.withdrawals.toLocaleString()}`);
        console.log(`  totalTax: $${(resultWith.taxDetails.fed + resultWith.taxDetails.state + resultWith.taxDetails.fica).toLocaleString()}`);
        if (resultWith.rothConversion) {
            console.log(`  conversionAmount: $${resultWith.rothConversion.amount.toLocaleString()}`);
            console.log(`  conversionTax: $${resultWith.rothConversion.taxCost.toLocaleString()}`);
        }
        console.log('');

        // The difference in withdrawals should only be the tax on the conversion
        const withdrawalDiff = resultWith.cashflow.withdrawals - resultWithout.cashflow.withdrawals;
        const conversionTax = resultWith.rothConversion?.taxCost || 0;

        console.log('DIFFERENCE:');
        console.log(`  Extra withdrawals: $${withdrawalDiff.toLocaleString()}`);
        console.log(`  Conversion tax: $${conversionTax.toLocaleString()}`);
        console.log(`  Should be similar (diff for tax only)`);

        if (resultWith.rothConversion) {
            const conversionAmount = resultWith.rothConversion.amount;
            if (Math.abs(withdrawalDiff - conversionAmount) < Math.abs(withdrawalDiff - conversionTax)) {
                console.log('');
                console.log('⚠️  BUG: Extra withdrawals are closer to conversion AMOUNT than conversion TAX!');
                console.log('    This means the conversion is being treated as an expense.');
            }
        }

        expect(resultWithout).toBeDefined();
        expect(resultWith).toBeDefined();
    });

    it('should test very low income scenario (like user reported)', () => {
        // User reported: 2041: $1,840 income with high effective rate
        // This suggests very low regular income in early retirement

        const lowIncomeAssumptions: AssumptionsState = {
            ...defaultAssumptions,
            demographics: {
                birthYear: 1980, // Age 45 in 2025, retiring at 40 (early retirement)
                lifeExpectancy: 90,
                retirementAge: 40
            },
            investments: {
                ...defaultAssumptions.investments,
                returnRates: { ror: 7 },
                withdrawalRate: 4,
                withdrawalStrategy: 'Fixed Real',
                autoRothConversions: true
            },
            withdrawalStrategy: [
                { id: 'ws-trad', accountId: 'trad-401k', name: 'Traditional 401k' },
                { id: 'ws-roth', accountId: 'roth-ira', name: 'Roth IRA' },
                { id: 'ws-brokerage', accountId: 'brokerage', name: 'Brokerage' }
            ]
        };

        // Only a small amount of passive/interest income
        const passiveIncome = {
            getAnnualAmount: () => 1840,
            getProratedAnnual: () => 1840,
            getMonthlyAmount: () => 1840 / 12,
            getAppliedAmount: () => 1840,
            isActive: () => true,
            increment: () => passiveIncome,
            id: 'passive-1',
            name: 'Interest Income',
            startDate: new Date('2025-01-01'),
            endDate: new Date('2060-12-31'),
            type: 'Passive' as const
        };

        const accounts = [
            new InvestedAccount('trad-401k', 'Traditional 401k', 500000, 0, 0, 0.1, 'Traditional 401k'),
            new InvestedAccount('roth-ira', 'Roth IRA', 100000, 0, 0, 0.1, 'Roth IRA'),
            new InvestedAccount('brokerage', 'Brokerage', 200000, 0, 0, 0.1, 'Brokerage', true, 0.5, 150000)
        ];

        const expense = new FoodExpense('exp-1', 'Living', 30000, 'Annually', new Date('2025-01-01'), undefined);

        console.log('\n========== LOW INCOME SCENARIO ==========\n');
        console.log('SETUP:');
        console.log('  Interest Income: $1,840/year');
        console.log('  Living Expenses: $30,000/year');
        console.log('  Traditional 401k: $500,000');
        console.log('  Roth IRA: $100,000');
        console.log('  Brokerage: $200,000');
        console.log('');

        const result = simulateOneYear(
            2025,
            [passiveIncome as any],
            [expense],
            accounts,
            lowIncomeAssumptions,
            mockTaxState
        );

        console.log('RESULT:');
        console.log(`  totalIncome: $${result.cashflow.totalIncome.toLocaleString()}`);
        console.log(`  discretionary: $${result.cashflow.discretionary.toLocaleString()}`);
        console.log(`  withdrawals: $${result.cashflow.withdrawals.toLocaleString()}`);
        console.log(`  withdrawalDetail:`, result.cashflow.withdrawalDetail);
        console.log('');
        console.log('TAXES:');
        console.log(`  fed: $${result.taxDetails.fed.toLocaleString()}`);
        console.log(`  total: $${(result.taxDetails.fed + result.taxDetails.state + result.taxDetails.fica).toLocaleString()}`);
        console.log('');

        if (result.rothConversion) {
            console.log('ROTH CONVERSION:');
            console.log(`  amount: $${result.rothConversion.amount.toLocaleString()}`);
            console.log(`  taxCost: $${result.rothConversion.taxCost.toLocaleString()}`);
            console.log(`  fromAccounts:`, result.rothConversion.fromAccounts);
            console.log(`  toAccounts:`, result.rothConversion.toAccounts);
        }
        console.log('');

        console.log('LOGS:');
        result.logs.forEach(log => console.log(`  ${log}`));

        expect(result).toBeDefined();
    });

    it('should test scenario where deficit might match conversion amount', () => {
        // Scenario: Very low income, modest expenses, Roth conversion fills bracket
        // This might cause the deficit to visually match the conversion amount

        const testAssumptions: AssumptionsState = {
            ...defaultAssumptions,
            demographics: {
                birthYear: 2001,
                lifeExpectancy: 90,
                retirementAge: 40
            },
            investments: {
                ...defaultAssumptions.investments,
                returnRates: { ror: 5.9 },
                withdrawalRate: 4,
                withdrawalStrategy: 'Guyton Klinger',
                autoRothConversions: true
            },
            withdrawalStrategy: [
                { id: 'ws-brokerage', accountId: 'brokerage', name: 'Brokerage' },
                { id: 'ws-trad', accountId: 'trad-401k', name: 'Trad 401k' },
                { id: 'ws-roth', accountId: 'roth-ira', name: 'Roth IRA' }
            ]
        };

        const taxState: TaxState = {
            filingStatus: 'Single',
            stateResidency: 'DC',
            deductionMethod: 'Auto',
            fedOverride: null,
            ficaOverride: null,
            stateOverride: null,
            year: 2041
        };

        // Small income - interest only
        const income = {
            getAnnualAmount: () => 1840,
            getProratedAnnual: () => 1840,
            getMonthlyAmount: () => 153.33,
            getAppliedAmount: () => 1840,
            isActive: () => true,
            increment: () => income,
            id: 'interest-1',
            name: 'Interest',
            startDate: new Date('2041-01-01'),
            endDate: new Date('2091-12-31'),
            type: 'Passive' as const
        };

        // Lower expenses
        const expense = new FoodExpense(
            'exp-1',
            'Living Expenses',
            50000,
            'Annually',
            new Date('2041-01-01'),
            undefined
        );

        // Accounts with different sizes
        const trad401k = new InvestedAccount(
            'trad-401k', 'Trad 401k', 500000, 0, 0, 0.1, 'Traditional 401k'
        );
        const rothIRA = new InvestedAccount(
            'roth-ira', 'Roth IRA', 100000, 0, 0, 0.1, 'Roth IRA'
        );
        const brokerage = new InvestedAccount(
            'brokerage', 'Brokerage', 100000, 0, 0, 0.1, 'Brokerage', true, 0.5, 80000
        );

        console.log('\n========== DEFICIT MATCHING CONVERSION TEST ==========\n');
        console.log('SETUP:');
        console.log('  Income: $1,840/year (interest only)');
        console.log('  Expenses: $50,000/year');
        console.log('  Trad 401k: $500,000');
        console.log('  Roth IRA: $100,000');
        console.log('  Brokerage: $100,000 (cost basis: $80,000)');
        console.log('');
        console.log('WITHDRAWAL ORDER: Brokerage → Trad 401k → Roth IRA');
        console.log('');

        const result = simulateOneYear(
            2041,
            [income as any],
            [expense],
            [brokerage, trad401k, rothIRA],
            testAssumptions,
            taxState
        );

        console.log('========== RESULT ==========\n');
        console.log('CASHFLOW:');
        console.log(`  totalIncome: $${result.cashflow.totalIncome.toLocaleString()}`);
        console.log(`  totalExpense: $${result.cashflow.totalExpense.toLocaleString()}`);
        console.log(`  discretionary: $${result.cashflow.discretionary.toLocaleString()}`);
        console.log(`  withdrawals: $${result.cashflow.withdrawals.toLocaleString()}`);
        console.log(`  withdrawalDetail:`, JSON.stringify(result.cashflow.withdrawalDetail, null, 2));
        console.log('');

        console.log('TAXES:');
        const totalTax = result.taxDetails.fed + result.taxDetails.state + result.taxDetails.fica;
        console.log(`  fed: $${result.taxDetails.fed.toLocaleString()}`);
        console.log(`  state: $${result.taxDetails.state.toLocaleString()}`);
        console.log(`  capGains: $${result.taxDetails.capitalGains.toLocaleString()}`);
        console.log(`  TOTAL: $${totalTax.toLocaleString()}`);
        console.log('');

        if (result.rothConversion) {
            console.log('ROTH CONVERSION:');
            console.log(`  amount: $${result.rothConversion.amount.toLocaleString()}`);
            console.log(`  taxCost: $${result.rothConversion.taxCost.toLocaleString()}`);
        }
        console.log('');

        // What SHOULD happen:
        // 1. Income: $1,840
        // 2. Expenses: $50,000
        // 3. Pre-tax deficit: $50,000 - $1,840 = $48,160
        // 4. Roth conversion happens, adds tax cost
        // 5. Deficit becomes: $48,160 + conversionTax + anyCapGainsTax
        // 6. Withdrawals should cover the deficit

        const conversionAmount = result.rothConversion?.amount || 0;
        const conversionTax = result.rothConversion?.taxCost || 0;
        const preConversionDeficit = 50000 - 1840;

        console.log('ANALYSIS:');
        console.log(`  Pre-tax/conversion deficit: $${preConversionDeficit.toLocaleString()}`);
        console.log(`  Conversion tax adds: $${conversionTax.toLocaleString()}`);
        console.log(`  Expected total deficit: ~$${(preConversionDeficit + conversionTax).toLocaleString()}`);
        console.log(`  Actual withdrawals: $${result.cashflow.withdrawals.toLocaleString()}`);
        console.log('');

        // Check if withdrawals match conversion amount (the bug)
        if (Math.abs(result.cashflow.withdrawals - conversionAmount) < 1000) {
            console.log('⚠️  WARNING: Withdrawals match CONVERSION AMOUNT!');
        } else if (Math.abs(result.cashflow.withdrawals - (preConversionDeficit + conversionTax)) < 5000) {
            console.log('✅ Withdrawals roughly match expected deficit + conversion tax');
        }

        console.log('');
        console.log('LOGS:');
        result.logs.forEach(log => console.log(`  ${log}`));

        expect(result).toBeDefined();
    });

    it('should test with user actual data - 2041 retirement year', () => {
        // User's exact scenario:
        // - Born 2001, retires at 40 (year 2041)
        // - No income after retirement until Social Security at 67
        // - Expenses ~$68k/year (will be inflated by 2041)
        // - Auto Roth conversions enabled
        // - Withdrawal order: Checking → Group → Brokerage → Trad 401k → Roth 401k → Roth IRA → Savings

        const userAssumptions: AssumptionsState = {
            ...defaultAssumptions,
            demographics: {
                birthYear: 2001,
                lifeExpectancy: 90,
                retirementAge: 40
            },
            macro: {
                inflationRate: 2.6,
                healthcareInflation: 3.9,
                inflationAdjusted: false
            },
            investments: {
                ...defaultAssumptions.investments,
                returnRates: { ror: 5.9 },
                withdrawalRate: 4,
                withdrawalStrategy: 'Guyton Klinger',
                gkUpperGuardrail: 1.2,
                gkLowerGuardrail: 0.8,
                gkAdjustmentPercent: 10,
                autoRothConversions: true
            },
            withdrawalStrategy: [
                { id: 'ws-co', accountId: 'capital-one', name: 'Checking' },
                { id: 'ws-group', accountId: 'group', name: 'Group' },
                { id: 'ws-brokerage', accountId: 'brokerage', name: 'Brokerage' },
                { id: 'ws-trad', accountId: 'trad-401k', name: 'Trad 401k' },
                { id: 'ws-roth401k', accountId: 'roth-401k', name: 'Roth 401k' },
                { id: 'ws-roth', accountId: 'roth-ira', name: 'Roth IRA' },
                { id: 'ws-ally', accountId: 'ally', name: 'Savings' }
            ]
        };

        const taxState: TaxState = {
            filingStatus: 'Single',
            stateResidency: 'DC',
            deductionMethod: 'Auto',
            fedOverride: null,
            ficaOverride: null,
            stateOverride: null,
            year: 2041
        };

        // Simulate accounts grown to 2041 (15 years of 5.9% growth + contributions)
        // Starting values from 2026, grown 15 years at ~5.9% + maxed contributions
        // These are rough projections similar to what the simulation would calculate

        // By 2041, balances would be approximately:
        // - Trad 401k: starts at $94k, contributes $23.5k/year for 15 years = very large
        // For testing, let's use projected values around retirement
        const trad401k = new InvestedAccount(
            'trad-401k',
            'Trad 401k',
            800000, // Large Traditional balance by retirement
            0, 0, 0.27,
            'Traditional 401k'
        );

        const rothIRA = new InvestedAccount(
            'roth-ira',
            'Roth IRA',
            200000, // Grown Roth IRA
            0, 0, 0.06,
            'Roth IRA'
        );

        const roth401k = new InvestedAccount(
            'roth-401k',
            'Roth 401k',
            50000, // Small Roth 401k
            0, 0, 0.27,
            'Roth 401k'
        );

        const brokerage = new InvestedAccount(
            'brokerage',
            'Brokerage',
            300000, // Grown brokerage
            0, 0, 0.06,
            'Brokerage',
            true,
            0.5,
            200000 // cost basis lower than value (gains)
        );

        // Cash accounts (savings)
        const ally = new InvestedAccount(
            'ally',
            'Savings',
            50000, // Emergency fund
            0, 0, 0,
            'Brokerage' // Treat as taxable for withdrawal purposes
        );

        const capitalOne = new InvestedAccount(
            'capital-one',
            'Checking',
            1000,
            0, 0, 0,
            'Brokerage'
        );

        const group = new InvestedAccount(
            'group',
            'Group',
            1000,
            0, 0, 0,
            'Brokerage'
        );

        // NO income in retirement year (work has stopped, SS not started)
        // Only savings account interest
        const interestIncome = {
            getAnnualAmount: () => 1650, // ~3.3% on $50k
            getProratedAnnual: () => 1650,
            getMonthlyAmount: () => 1650 / 12,
            getAppliedAmount: () => 1650,
            isActive: () => true,
            increment: () => interestIncome,
            id: 'interest-1',
            name: 'Savings Interest',
            startDate: new Date('2041-01-01'),
            endDate: new Date('2091-12-31'),
            type: 'Passive' as const
        };

        // Expenses inflated to 2041 (~$68k * 1.026^15 = ~$99k)
        const livingExpenses = new FoodExpense(
            'exp-1',
            'Living Expenses',
            99000, // Inflated expenses
            'Annually',
            new Date('2041-01-01'),
            undefined
        );

        console.log('\n========== USER DATA TEST - 2041 RETIREMENT ==========\n');
        console.log('SETUP (projected to 2041):');
        console.log('  Trad 401k: $800,000');
        console.log('  Roth IRA: $200,000');
        console.log('  Roth 401k: $50,000');
        console.log('  Brokerage: $300,000 (cost basis: $200,000)');
        console.log('  Savings (savings): $50,000');
        console.log('  Checking: $1,000');
        console.log('  Group: $1,000');
        console.log('');
        console.log('  Interest Income: $1,650/year');
        console.log('  Living Expenses: $99,000/year (inflated)');
        console.log('  Auto Roth Conversions: ENABLED');
        console.log('');
        console.log('WITHDRAWAL ORDER:');
        console.log('  1. Checking');
        console.log('  2. Group');
        console.log('  3. Brokerage');
        console.log('  4. Trad 401k');
        console.log('  5. Roth 401k');
        console.log('  6. Roth IRA');
        console.log('  7. Savings');
        console.log('');

        const result = simulateOneYear(
            2041,
            [interestIncome as any],
            [livingExpenses],
            [capitalOne, group, brokerage, trad401k, roth401k, rothIRA, ally],
            userAssumptions,
            taxState
        );

        console.log('========== SIMULATION RESULT ==========\n');

        console.log('CASHFLOW:');
        console.log(`  totalIncome: $${result.cashflow.totalIncome.toLocaleString()}`);
        console.log(`  totalExpense: $${result.cashflow.totalExpense.toLocaleString()}`);
        console.log(`  discretionary: $${result.cashflow.discretionary.toLocaleString()}`);
        console.log(`  withdrawals: $${result.cashflow.withdrawals.toLocaleString()}`);
        console.log(`  totalInvested: $${result.cashflow.totalInvested.toLocaleString()}`);
        console.log(`  withdrawalDetail:`, JSON.stringify(result.cashflow.withdrawalDetail, null, 2));
        console.log('');

        console.log('TAXES:');
        console.log(`  fed: $${result.taxDetails.fed.toLocaleString()}`);
        console.log(`  state: $${result.taxDetails.state.toLocaleString()}`);
        console.log(`  fica: $${result.taxDetails.fica.toLocaleString()}`);
        const totalTax = result.taxDetails.fed + result.taxDetails.state + result.taxDetails.fica;
        console.log(`  TOTAL TAX: $${totalTax.toLocaleString()}`);
        console.log('');

        if (result.rothConversion) {
            console.log('ROTH CONVERSION:');
            console.log(`  amount: $${result.rothConversion.amount.toLocaleString()}`);
            console.log(`  taxCost: $${result.rothConversion.taxCost.toLocaleString()}`);
            console.log(`  fromAccounts:`, result.rothConversion.fromAccounts);
            console.log(`  toAccounts:`, result.rothConversion.toAccounts);
        } else {
            console.log('ROTH CONVERSION: None');
        }
        console.log('');

        console.log('ACCOUNT BALANCES AFTER:');
        result.accounts.forEach(acc => {
            console.log(`  ${acc.name}: $${acc.amount.toLocaleString()}`);
        });
        console.log('');

        console.log('SIMULATION LOGS:');
        result.logs.forEach(log => console.log(`  ${log}`));
        console.log('');

        // Analysis
        console.log('========== ANALYSIS ==========\n');
        const conversionAmount = result.rothConversion?.amount || 0;
        const conversionTax = result.rothConversion?.taxCost || 0;

        console.log('Expected cashflow:');
        console.log(`  Interest Income: $1,650`);
        console.log(`  - Living Expenses: $99,000`);
        console.log(`  - Tax (excluding conversion tax): $${(totalTax - conversionTax).toLocaleString()}`);
        const expectedDeficit = 1650 - 99000 - (totalTax - conversionTax);
        console.log(`  = Base Deficit: $${expectedDeficit.toLocaleString()}`);
        console.log('');
        console.log(`  Roth Conversion Amount: $${conversionAmount.toLocaleString()}`);
        console.log(`  Roth Conversion Tax: $${conversionTax.toLocaleString()}`);
        console.log(`  Additional withdrawal needed for conversion tax: $${conversionTax.toLocaleString()}`);
        console.log('');
        console.log(`  Total Expected Withdrawals: $${(Math.abs(expectedDeficit) + conversionTax).toLocaleString()}`);
        console.log(`  Actual Withdrawals: $${result.cashflow.withdrawals.toLocaleString()}`);
        console.log('');

        // Check if the bug exists
        const withdrawalMatchesConversion = Math.abs(result.cashflow.withdrawals - conversionAmount) < 1000;
        const withdrawalMatchesExpectedDeficit = Math.abs(result.cashflow.withdrawals - (Math.abs(expectedDeficit) + conversionTax)) < 1000;

        if (withdrawalMatchesConversion && !withdrawalMatchesExpectedDeficit) {
            console.log('⚠️  BUG DETECTED: Withdrawals (~' + result.cashflow.withdrawals.toLocaleString() + ') match CONVERSION AMOUNT!');
            console.log('    The conversion is being treated as a cash expense.');
        } else if (withdrawalMatchesExpectedDeficit) {
            console.log('✅ Withdrawals match expected deficit + conversion tax (CORRECT)');
        } else {
            console.log('⚠️  Withdrawals do not match expected values');
            console.log(`    Expected: ~$${(Math.abs(expectedDeficit) + conversionTax).toLocaleString()}`);
            console.log(`    Actual: $${result.cashflow.withdrawals.toLocaleString()}`);
        }

        expect(result).toBeDefined();
    });
});
