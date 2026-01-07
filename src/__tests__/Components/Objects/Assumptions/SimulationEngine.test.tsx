import { describe, it, expect } from 'vitest';
import { AssumptionsState, defaultAssumptions } from '../../../../components/Objects/Assumptions/AssumptionsContext';
import { TaxState } from '../../../../components/Objects/Taxes/TaxContext';
import { InvestedAccount } from '../../../../components/Objects/Accounts/models';
import { runSimulation } from '../../../../components/Objects/Assumptions/useSimulation';

// 1. Create a "Clean" Assumptions Object
// We clone the default and override specific fields to ensure 10% growth is exactly 10%.
const cleanAssumptions: AssumptionsState = {
    ...defaultAssumptions,
    personal: {
        startAge: 30,
        startYear: 2025
    },
    macro: {
        ...defaultAssumptions.macro,
        inflationRate: 0,        // Disable inflation for simple math
        inflationAdjusted: false 
    },
    investments: {
        ...defaultAssumptions.investments,
        returnRates: { ror: 10 } // Target: 10% Growth
    }
};

// 2. Mock Tax State (Required input, but irrelevant for this specific test)
// If you don't have a defaultTaxState exported, you can mock a minimal one like this:
const mockTaxState: TaxState = {
    filingStatus: 'Single',
    stateResidency: 'DC',
    deductionMethod: 'Standard',
    fedOverride: null,
    ficaOverride: null,
    stateOverride: null
};

describe('Simulation Engine', () => {

    it('should grow a $1000 account by exactly 10% annually', () => {
        // --- SETUP ---
        const startAmount = 1000;
        
        // Create 1 Account: $1000, 0% Expense Ratio (to not mess up the 10% math)
        const testAccount = new InvestedAccount(
            'acc-1',           // ID
            'Test Fund',       // Name
            startAmount,       // Amount
            0,                 // NonVestedAmount
            0,                 // Expense Ratio (IMPORTANT: set to 0)
            'Brokerage'        // Tax Type
        );

        // --- EXECUTE ---
        // Run for 2 years
        const result = runSimulation(
            2, 
            [testAccount], 
            [], // No Income
            [], // No Expenses
            cleanAssumptions, 
            mockTaxState
        );

        // --- ASSERT ---
        
        // Year 0 (Baseline): Should be $1,000 (Start of 2025)
        const year0 = result[0];
        expect(year0.year).toBe(2025);
        expect(year0.accounts[0].amount).toBe(1000);

        // Year 1: Should be $1,100 ($1000 * 1.10)
        const year1 = result[1];
        expect(year1.year).toBe(2026);
        expect(year1.accounts[0].amount).toBeCloseTo(1100, 2); // Checks to 2 decimal places

        // Year 2: Should be $1,210 ($1100 * 1.10)
        const year2 = result[2];
        expect(year2.year).toBe(2027);
        expect(year2.accounts[0].amount).toBeCloseTo(1210, 2);
    });

});