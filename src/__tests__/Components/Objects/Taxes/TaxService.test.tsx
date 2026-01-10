import { describe, it, expect } from 'vitest';
import { TaxState } from '../../../../components/Objects/Taxes/TaxContext';
import { AssumptionsState, defaultAssumptions } from '../../../../components/Objects/Assumptions/AssumptionsContext';
import { calculateGrossWithdrawal } from '../../../../components/Objects/Taxes/TaxService';

// --- HELPERS ---

const createTaxState = (overrides: Partial<TaxState> = {}): TaxState => ({
    filingStatus: 'Single',
    stateResidency: 'Texas', // Default to 0% tax state for simpler base tests
    deductionMethod: 'Standard',
    fedOverride: null,
    ficaOverride: null,
    stateOverride: null,
    year: 2024,
    ...overrides
});

// Disable inflation so we can test against exact 2024 bracket numbers
const noInflationAssumptions: AssumptionsState = {
    ...defaultAssumptions,
    macro: {
        ...defaultAssumptions.macro,
        inflationAdjusted: false,
        inflationRate: 0
    }
};

describe('TaxService: Gross Up Calculator', () => {

    // -------------------------------------------------------------------------
    // SCENARIO 1: The "Tax Free" Zone
    // -------------------------------------------------------------------------
    it('Scenario 1: Income is below Standard Deduction (0% Tax)', () => {
        // Setup: 
        // Gross Income: $0
        // Standard Deduction: $14,600 (Single, 2024)
        // Net Needed: $5,000
        // Expected: $5,000 Gross (0 tax because 5000 < 14600)

        const result = calculateGrossWithdrawal(
            5000,   // Net Needed
            0,      // Current Fed Income (Gross)
            14600,  // Current Fed Deduction (Simulating Standard Deduction room)
            0,      // Current State Income
            0,      // Current State Deduction (Texas has 0 standard deduction technically)
            createTaxState({ stateResidency: 'Texas' }), 
            2024,
            noInflationAssumptions
        );

        expect(result.grossWithdrawn).toBeCloseTo(5000, 2);
        expect(result.totalTax).toBeCloseTo(0, 2);
    });

    // -------------------------------------------------------------------------
    // SCENARIO 2: Simple Bracket (12% Flat)
    // -------------------------------------------------------------------------
    it('Scenario 2: Middle of the 12% Bracket', () => {
        // Setup:
        // Taxable Income: $20,000 (We simulate this by passing 20k Income + 0 Deduction)
        // 2024 Single 12% bracket range: $11,600 - $47,151
        // Tax Rate: 12%
        // Math: Need $1000 Net. 
        // Formula: Gross = Net / (1 - TaxRate) = 1000 / 0.88 = 1136.36

        const result = calculateGrossWithdrawal(
            1000,
            20000,  // Current Fed Income
            0,      // Deduction = 0, so Taxable = 20,000
            20000,  // State Income
            0,      // State Deduction
            createTaxState({ stateResidency: 'Texas' }), 
            2024,
            noInflationAssumptions
        );

        expect(result.grossWithdrawn).toBeCloseTo(1136.36, 1);
    });

    // -------------------------------------------------------------------------
    // SCENARIO 3: The "Kink" (Bracket Crossing)
    // -------------------------------------------------------------------------
    it('Scenario 3: Crossing from 12% to 22% (The "Kink")', () => {
        // Setup:
        // 2024 Single Bracket Jump is at $47,151.
        // We start just below it at $47,050 (Taxable).
        // Room in 12% bracket: $101.
        
        // 1. First $101 Gross is taxed at 12%. 
        //    Net from this = 101 * 0.88 = 88.88
        // 2. Remaining Net Needed = 1000 - 88.88 = 911.12
        // 3. Remainder taxed at 22%.
        //    Gross Needed = 911.12 / 0.78 = 1168.10
        // Total Gross = 101 + 1168.10 = 1269.10
        
        const startIncome = 47050; 
        
        const result = calculateGrossWithdrawal(
            1000,
            startIncome,
            0, // Deduction 0 -> Taxable = 47050
            startIncome,
            0,
            createTaxState({ stateResidency: 'Texas' }),
            2024,
            noInflationAssumptions
        );

        expect(result.grossWithdrawn).toBeCloseTo(1269.10, 1);
    });

    // -------------------------------------------------------------------------
    // SCENARIO 4: State Tax Integration
    // -------------------------------------------------------------------------
    it('Scenario 4: Federal (22%) + State (DC)', () => {
        // Setup:
        // Taxable Income: $100,000.
        // Fed Bracket (2024): 22% (Up to $100,526).
        // State (DC): 
        //   DC Brackets for $100k+: 8.5% (Starts at $60k).
        
        // Combined Rate: 22% (Fed) + 8.5% (State) = 30.5%
        // Math: 1000 / (1 - 0.305) = 1000 / 0.695 = 1438.85
        
        // NOTE: This assumes Deductibility is NOT active (Standard Deduction method),
        // so State Tax does not reduce Fed Tax.
        
        const result = calculateGrossWithdrawal(
            1000,
            90000, // Income
            0,      // Deduction 0 -> Taxable 100k
            90000, 
            0,
            createTaxState({ stateResidency: 'DC', deductionMethod: 'Standard' }), 
            2024,
            noInflationAssumptions
        );
        
        expect(result.grossWithdrawn).toBeCloseTo(1438.85, 1);
    });

    // -------------------------------------------------------------------------
    // SCENARIO 5: Overdraft (Convergence Check)
    // -------------------------------------------------------------------------
    it('Scenario 5: Convergence Check (Large Number)', () => {
        // Just ensures the loop doesn't explode or hang if we request $1 Million
        const result = calculateGrossWithdrawal(
            1000000,
            50000,
            0,
            50000,
            0,
            createTaxState({ stateResidency: 'Texas' }),
            2024,
            noInflationAssumptions
        );

        expect(result.grossWithdrawn).toBeGreaterThan(1000000);
        expect(result.grossWithdrawn).toBeLessThan(2000000); 
    });

});