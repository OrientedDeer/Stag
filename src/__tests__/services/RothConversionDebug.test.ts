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

        const result = simulateOneYear(
            2025,
            [ssIncome],
            [livingExpense],
            [traditional401k, rothIRA, brokerage],
            retiredAssumptions,
            mockTaxState
        );

        // Verify the simulation completed
        expect(result).toBeDefined();
        expect(result.cashflow).toBeDefined();

        // The Roth conversion should NOT require withdrawals matching the conversion amount
        // Only the TAX on the conversion should need to be covered
        if (result.rothConversion) {
            const conversionAmount = result.rothConversion.amount;
            const withdrawals = result.cashflow.withdrawals;

            // Withdrawals should NOT match conversion amount (that would be a bug)
            // They should be much smaller (just covering deficit + conversion tax)
            expect(
                Math.abs(withdrawals - conversionAmount) > 100,
                `Withdrawals ($${withdrawals.toFixed(0)}) should NOT match conversion amount ($${conversionAmount.toFixed(0)})`
            ).toBe(true);
        }
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

        expect(resultWithout).toBeDefined();
        expect(resultWith).toBeDefined();

        // The difference in withdrawals should only be the tax on the conversion
        // NOT the full conversion amount
        if (resultWith.rothConversion) {
            const withdrawalDiff = resultWith.cashflow.withdrawals - resultWithout.cashflow.withdrawals;
            const conversionTax = resultWith.rothConversion.taxCost;
            const conversionAmount = resultWith.rothConversion.amount;

            // Extra withdrawals should be closer to conversion TAX than conversion AMOUNT
            const diffFromTax = Math.abs(withdrawalDiff - conversionTax);
            const diffFromAmount = Math.abs(withdrawalDiff - conversionAmount);

            expect(
                diffFromTax < diffFromAmount,
                `Extra withdrawals ($${withdrawalDiff.toFixed(0)}) should be closer to tax ($${conversionTax.toFixed(0)}) than amount ($${conversionAmount.toFixed(0)})`
            ).toBe(true);
        }
    });
});
