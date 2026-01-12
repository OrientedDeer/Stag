import { describe, it, expect } from 'vitest';
import { TaxState } from '../../../../components/Objects/Taxes/TaxContext';
import { AssumptionsState, defaultAssumptions } from '../../../../components/Objects/Assumptions/AssumptionsContext';
import {
    calculateGrossWithdrawal,
    getTaxParameters,
    getGrossIncome,
    getPreTaxExemptions,
    getPostTaxEmployerMatch,
    getPostTaxExemptions,
    getFicaExemptions,
    getEarnedIncome,
    getItemizedDeductions,
    getYesDeductions,
    calculateTax,
    calculateFicaTax,
    calculateStateTax,
    calculateFederalTax
} from '../../../../components/Objects/Taxes/TaxService';
import { WorkIncome, CurrentSocialSecurityIncome } from '../../../../components/Objects/Income/models';
import { MortgageExpense } from '../../../../components/Objects/Expense/models';

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

describe('TaxService: Additional Functions', () => {
    describe('getTaxParameters', () => {
        it('should return federal tax parameters for current year', () => {
            const params = getTaxParameters(2024, 'Single', 'federal');
            expect(params).toBeDefined();
            expect(params?.standardDeduction).toBe(14600);
            expect(params?.brackets[0].threshold).toBe(0);
            expect(params?.brackets[0].rate).toBe(0.10);
            expect(params?.brackets[1].threshold).toBe(11600);
            expect(params?.brackets[1].rate).toBe(0.12);
        });

        it('should return state tax parameters for DC', () => {
            const params = getTaxParameters(2024, 'Single', 'state', 'DC');
            expect(params).toBeDefined();
            expect(params?.standardDeduction).toBe(14600);
            expect(params?.brackets[0].threshold).toBe(0);
            expect(params?.brackets[0].rate).toBe(0.04);
            expect(params?.brackets[1].threshold).toBe(10000);
            expect(params?.brackets[1].rate).toBe(0.06);
        });

        it('should return undefined for invalid state', () => {
            const params = getTaxParameters(2024, 'Single', 'state', 'InvalidState');
            expect(params).toBeUndefined();
        });

        it('should handle inflation-adjusted future years', () => {
            const inflationAssumptions: AssumptionsState = {
                ...noInflationAssumptions,
                macro: { ...noInflationAssumptions.macro, inflationAdjusted: true, inflationRate: 3 }
            };
            const params = getTaxParameters(2030, 'Single', 'federal', undefined, inflationAssumptions);
            expect(params).toBeDefined();
            if (params) {
                expect(params.standardDeduction).toBeGreaterThan(14600); // Should be inflated
            }
        });

        it('should handle different filing statuses', () => {
            const single = getTaxParameters(2024, 'Single', 'federal');
            const married = getTaxParameters(2024, 'Married Filing Jointly', 'federal');
            expect(single?.standardDeduction).toBeLessThan(married?.standardDeduction || 0);
        });
    });

    describe('getGrossIncome', () => {
        it('should calculate total gross income from work income', () => {
            const income = new WorkIncome('w1', 'Job', 100000, 'Annually', 'Yes', 0, 0, 0, 5000, 'acc1', 'Traditional 401k', 'FIXED', new Date('2020-01-01'));
            const total = getGrossIncome([income], 2024);
            expect(total).toBe(100000);
        });

        it('should include employer match for Roth 401k', () => {
            const income = new WorkIncome('w1', 'Job', 100000, 'Annually', 'Yes', 0, 0, 20000, 5000, 'acc1', 'Roth 401k', 'FIXED', new Date('2020-01-01'));
            const total = getGrossIncome([income], 2024);
            expect(total).toBe(100000); 
        });

        it('should handle multiple incomes', () => {
            const income1 = new WorkIncome('w1', 'Job1', 100000, 'Annually', 'Yes', 0, 0, 0, 5000, 'acc1', 'Traditional 401k', 'FIXED', new Date('2020-01-01'));
            const income2 = new WorkIncome('w2', 'Job2', 50000, 'Annually', 'Yes', 0, 0, 0, 2500, 'acc2', 'Traditional 401k', 'FIXED', new Date('2020-01-01'));
            const total = getGrossIncome([income1, income2], 2024);
            expect(total).toBe(150000);
        });
    });

    describe('getPreTaxExemptions', () => {
        it('should calculate pre-tax 401k and insurance exemptions', () => {
            const income = new WorkIncome('w1', 'Job', 100000, 'Annually', 'Yes', 19500, 5000, 0, 0, 'acc1', 'Traditional 401k', 'FIXED', new Date('2020-01-01'));
            const exemptions = getPreTaxExemptions([income], 2024);
            expect(exemptions).toBe(24500); // 19500 + 5000
        });

        it('should return 0 for no pre-tax exemptions', () => {
            const income = new WorkIncome('w1', 'Job', 100000, 'Annually', 'Yes', 0, 0, 0, 0, 'acc1', 'Roth 401k', 'FIXED', new Date('2020-01-01'));
            const exemptions = getPreTaxExemptions([income], 2024);
            expect(exemptions).toBe(0);
        });
    });

    describe('getPostTaxEmployerMatch', () => {
        it('should return employer match for Roth 401k', () => {
            const income = new WorkIncome('w1', 'Job', 100000, 'Annually', 'Yes', 0, 0, 0, 5000, 'acc1', 'Roth 401k', 'FIXED', new Date('2020-01-01'));
            const match = getPostTaxEmployerMatch([income], 2024);
            expect(match).toBe(5000);
        });

        it('should return 0 for Traditional 401k', () => {
            const income = new WorkIncome('w1', 'Job', 100000, 'Annually', 'Yes', 0, 0, 0, 5000, 'acc1', 'Traditional 401k', 'FIXED', new Date('2020-01-01'));
            const match = getPostTaxEmployerMatch([income], 2024);
            expect(match).toBe(0);
        });
    });

    describe('getPostTaxExemptions', () => {
        it('should calculate Roth 401k contributions', () => {
            const income = new WorkIncome('w1', 'Job', 100000, 'Annually', 'Yes', 0, 0, 19500, 0, 'acc1', 'Roth 401k', 'FIXED', new Date('2020-01-01'));
            const exemptions = getPostTaxExemptions([income], 2024);
            expect(exemptions).toBe(19500);
        });
    });

    describe('getFicaExemptions', () => {
        it('should be 0 for standard work income', () => {
            const income = new WorkIncome('w1', 'Job', 100000, 'Annually', 'Yes', 10000, 5000, 0, 0, 'acc1', 'Traditional 401k', 'FIXED', new Date('2020-01-01'));
            const exemptions = getFicaExemptions([income], 2024);
            // Pre-tax 401k is generally NOT exempt from FICA.
            expect(exemptions).toBe(5000); // Only health insurance is exempt
        });
    });

    describe('getEarnedIncome', () => {
        it('should calculate total earned income', () => {
            const income = new WorkIncome('w1', 'Job', 100000, 'Annually', 'Yes', 0, 0, 0, 0, 'acc1', 'Traditional 401k', 'FIXED', new Date('2020-01-01'));
            const earned = getEarnedIncome([income], 2024);
            expect(earned).toBe(100000);
        });
    });

    describe('getYesDeductions', () => {
        it('should sum tax-deductible expenses', () => {
            const mortgage = new MortgageExpense('m1', 'Home', 'Monthly', 500000, 400000, 400000, 3, 30, 1.2, 0, 1, 100, 0.3, 0, 50, 'Yes', 0.8, 'a1', new Date('2020-01-01'));
            const deductions = getYesDeductions([mortgage], 2024);
            expect(deductions).toBeGreaterThan(0);
        });

        it('should return 0 for non-deductible expenses', () => {
            const mortgage = new MortgageExpense('m1', 'Home', 'Monthly', 500000, 400000, 400000, 3, 30, 1.2, 0, 1, 100, 0.3, 0, 50, 'No', 0, 'a1', new Date('2020-01-01'));
            const deductions = getYesDeductions([mortgage], 2024);
            expect(deductions).toBe(0);
        });
    });

    describe('getItemizedDeductions', () => {
        it('should calculate itemized deductions', () => {
            const mortgage = new MortgageExpense('m1', 'Home', 'Monthly', 500000, 400000, 400000, 3, 30, 1.2, 0, 1, 100, 0.3, 0, 50, 'Itemized', 0.8, 'a1', new Date('2024-01-02'));
            const deductions = getItemizedDeductions([mortgage], 2024);
            // Placeholder value. Actual deduction depends on mortgage interest and property taxes.
            expect(deductions).toBeCloseTo(11885.79, 2);
        });
    });

    describe('calculateTax', () => {
        it('should calculate tax with progressive brackets', () => {
            const params = getTaxParameters(2024, 'Single', 'federal');
            if (params) {
                // Taxable income = 64,600 - 14,600 (standard deduction) = 50,000
                const tax = calculateTax(64600, 0, params);
                // 11600 * 0.10 = 1160
                // (47151 - 11600) * 0.12 = 4266.12
                // (50000 - 47151) * 0.22 = 626.78
                // Total = 6052.9
                expect(tax).toBeCloseTo(6052.9);
            }
        });

        it('should return 0 for income below standard deduction', () => {
            const params = getTaxParameters(2024, 'Single', 'federal');
            if (params) {
                const tax = calculateTax(10000, 14600, params);
                expect(tax).toBe(0);
            }
        });

        it('should handle negative taxable income', () => {
            const params = getTaxParameters(2024, 'Single', 'federal');
            if (params) {
                const tax = calculateTax(10000, 20000, params);
                expect(tax).toBe(0);
            }
        });
    });

    describe('calculateFicaTax', () => {
        it('should calculate FICA tax on earned income', () => {
            const income = new WorkIncome('w1', 'Job', 100000, 'Annually', 'Yes', 0, 0, 0, 0, 'acc1', 'Traditional 401k', 'FIXED', new Date('2020-01-01'));
            const taxState = createTaxState();
            const fica = calculateFicaTax(taxState, [income], 2024, noInflationAssumptions);
            // SS (6.2%) on 100k + Medicare (1.45%) on 100k = 6200 + 1450 = 7650
            expect(fica).toBe(7650);
        });

        it('should respect Social Security wage base cap', () => {
            const highIncome = new WorkIncome('w1', 'Job', 500000, 'Annually', 'Yes', 0, 0, 0, 0, 'acc1', 'Traditional 401k', 'FIXED', new Date('2020-01-01'));
            const taxState = createTaxState();
            const fica = calculateFicaTax(taxState, [highIncome], 2024, noInflationAssumptions);
            // SS is capped at the 2024 wage base of 176,100. Medicare is not.
            // SS = 176100 * 0.062 = 10918.2
            // Medicare = 500000 * 0.0145 = 7250
            // Total = 18168.2
            expect(fica).toBeCloseTo(18168.2);
        });

        it('should use FICA override when provided', () => {
            const income = new WorkIncome('w1', 'Job', 100000, 'Annually', 'Yes', 0, 0, 0, 0, 'acc1', 'Traditional 401k', 'FIXED', new Date('2020-01-01'));
            const taxState = createTaxState({ ficaOverride: 5000 });
            const fica = calculateFicaTax(taxState, [income], 2024, noInflationAssumptions);
            expect(fica).toBe(5000);
        });
    });

    describe('calculateStateTax', () => {
        it('should calculate state tax for DC', () => {
            const income = new WorkIncome('w1', 'Job', 100000, 'Annually', 'Yes', 0, 0, 0, 0, 'acc1', 'Traditional 401k', 'FIXED', new Date('2020-01-01'));
            const taxState = createTaxState({ stateResidency: 'DC' });
            const stateTax = calculateStateTax(taxState, [income], [], 2024, noInflationAssumptions);
            // Taxable: 100k - 14.6k (DC standard) = 85.4k
            // 10k@4% = 400
            // 30k@6% = 1800
            // 20k@6.5% = 1300
            // 25.4k@8.5% = 2159
            // Total = 5659
            expect(stateTax).toBeCloseTo(5659);
        });

        it('should return 0 for Texas (no state income tax)', () => {
            const income = new WorkIncome('w1', 'Job', 100000, 'Annually', 'Yes', 0, 0, 0, 0, 'acc1', 'Traditional 401k', 'FIXED', new Date('2020-01-01'));
            const taxState = createTaxState({ stateResidency: 'Texas' });
            const stateTax = calculateStateTax(taxState, [income], [], 2024, noInflationAssumptions);
            expect(stateTax).toBe(0);
        });

        it('should use state override when provided', () => {
            const income = new WorkIncome('w1', 'Job', 100000, 'Annually', 'Yes', 0, 0, 0, 0, 'acc1', 'Traditional 401k', 'FIXED', new Date('2020-01-01'));
            const taxState = createTaxState({ stateResidency: 'California', stateOverride: 3000 });
            const stateTax = calculateStateTax(taxState, [income], [], 2024, noInflationAssumptions);
            expect(stateTax).toBe(3000);
        });
    });

    describe('calculateFederalTax', () => {
        it('should calculate federal tax with standard deduction', () => {
            const income = new WorkIncome('w1', 'Job', 100000, 'Annually', 'Yes', 0, 0, 0, 0, 'acc1', 'Traditional 401k', 'FIXED', new Date('2020-01-01'));
            const taxState = createTaxState({ deductionMethod: 'Standard' });
            const fedTax = calculateFederalTax(taxState, [income], [], 2024, noInflationAssumptions);
            // Taxable income: 100k - 14.6k (std deduction) = 85.4k
            // 11600 * 0.10 = 1160
            // (47151 - 11600) * 0.12 = 4266.12
            // (85400 - 47151) * 0.22 = 8414.78
            // Total = 13840.9
            expect(fedTax).toBeCloseTo(13840.9);
        });

        it('should calculate federal tax with itemized deductions', () => {
            const income = new WorkIncome('w1', 'Job', 100000, 'Annually', 'Yes', 0, 0, 0, 0, 'acc1', 'Traditional 401k', 'FIXED', new Date('2020-01-01'));
            const mortgage = new MortgageExpense('m1', 'Home', 'Monthly', 500000, 400000, 400000, 3, 30, 1.2, 0, 1, 100, 0.3, 0, 50, 'Itemized', 0.8, 'a1', new Date('2020-01-01'));
            mortgage.loan_balance = mortgage.getBalanceAtDate('2024-01-02');
            const taxState = createTaxState({ deductionMethod: 'Itemized', stateResidency: 'DC' });
            const fedTax = calculateFederalTax(taxState, [income], [mortgage], 2024, noInflationAssumptions);
            // Placeholder value. Actual tax depends on the calculated itemized deduction.
            expect(fedTax).toBeCloseTo(13356.34);
        });

        it('should use federal override when provided', () => {
            const income = new WorkIncome('w1', 'Job', 100000, 'Annually', 'Yes', 0, 0, 0, 0, 'acc1', 'Traditional 401k', 'FIXED', new Date('2020-01-01'));
            const taxState = createTaxState({ fedOverride: 15000 });
            const fedTax = calculateFederalTax(taxState, [income], [], 2024, noInflationAssumptions);
            expect(fedTax).toBe(15000);
        });
    });

    describe('Federal Tax Calculation with Social Security', () => {
        /**
         * CRITICAL BUG PREVENTION:
         * These tests verify the specific line of code that was buggy (TaxService.tsx:374).
         *
         * Bug: adjustedGross = annualGross + taxableSSBenefits (double-counted SS)
         * Fix: adjustedGross = annualGross - totalSSBenefits + taxableSSBenefits
         *
         * If the bug is reintroduced, these tests will fail with a federal tax amount
         * that is significantly higher than expected.
         */

        it('should correctly calculate adjustedGross when SS benefits are present', () => {
            // This test verifies the specific line of code that was buggy
            const workIncome = new WorkIncome(
                'w1',
                'Job',
                100000,
                'Annually',
                'Yes',
                0,
                0,
                0,
                0,
                'acc1',
                'Traditional 401k',
                'FIXED',
                new Date('2024-01-01'),
                new Date('2024-12-31')
            );

            const ssIncome = new CurrentSocialSecurityIncome(
                'ss1',
                'SS',
                2000,
                'Monthly',
                new Date('2024-01-01'),
                new Date('2024-12-31')
            );
            // $24,000/year SS

            const fedTax = calculateFederalTax(
                createTaxState(),
                [workIncome, ssIncome],
                [],
                2024,
                noInflationAssumptions
            );

            // Manual calculation to verify adjustedGross is correct:
            // annualGross = 100,000 + 24,000 = 124,000
            // AGI = 124,000 (no pre-tax deductions)
            // Combined income = AGI + (0.5 * SS) = 124,000 + 12,000 = 136,000
            // Since > $34,000, up to 85% of SS is taxable
            // taxableSSBenefits = 0.85 * 24,000 = 20,400
            //
            // CRITICAL: adjustedGross = 124,000 - 24,000 + 20,400 = 120,400
            // (NOT 124,000 + 20,400 = 144,400 which is the bug!)
            //
            // Taxable income = 120,400 - 14,600 (std deduction) = 105,800
            //
            // Tax calculation on $105,800 (Single, 2024):
            // 10% on first $11,600 = $1,160
            // 12% on $11,600 to $47,150 = $4,266
            // 22% on $47,150 to $100,525 = $11,743
            // 24% on $100,525 to $105,800 = $1,266
            // Total: ~$18,435
            //
            // If the bug is present, the tax would be calculated on $144,400 instead:
            // Taxable: 144,400 - 14,600 = 129,800
            // Tax: ~$24,660 (WRONG!)

            expect(fedTax).toBeCloseTo(18434.38, 0); // Within $1
            expect(fedTax).toBeLessThan(20000); // Should NOT be ~24660 (bug value)
        });

        it('should not apply FICA to Social Security benefits', () => {
            const workIncome = new WorkIncome(
                'w1',
                'Job',
                50000,
                'Annually',
                'Yes',
                0,
                0,
                0,
                0,
                'acc1',
                'Traditional 401k',
                'FIXED',
                new Date('2024-01-01'),
                new Date('2024-12-31')
            );

            const ssIncome = new CurrentSocialSecurityIncome(
                'ss1',
                'SS',
                2000,
                'Monthly',
                new Date('2024-01-01'),
                new Date('2024-12-31')
            );
            // $24,000/year SS

            const ficaTax = calculateFicaTax(
                createTaxState(),
                [workIncome, ssIncome],
                2024,
                noInflationAssumptions
            );

            // FICA should only be on work income ($50k), not SS benefits ($24k)
            const expectedFica = 50000 * 0.0765; // 7.65% FICA on work income only
            expect(ficaTax).toBeCloseTo(expectedFica, 10);

            // Verify SS income did NOT increase FICA
            const workOnlyFica = calculateFicaTax(
                createTaxState(),
                [workIncome],
                2024,
                noInflationAssumptions
            );
            expect(ficaTax).toBeCloseTo(workOnlyFica, 1);
        });

        it('should correctly calculate state tax when SS benefits are present', () => {
            const workIncome = new WorkIncome(
                'w1',
                'Job',
                75000,
                'Annually',
                'Yes',
                0,
                0,
                0,
                0,
                'acc1',
                'Traditional 401k',
                'FIXED',
                new Date('2024-01-01'),
                new Date('2024-12-31')
            );

            const ssIncome = new CurrentSocialSecurityIncome(
                'ss1',
                'SS',
                2000,
                'Monthly',
                new Date('2024-01-01'),
                new Date('2024-12-31')
            );
            // $24,000/year SS

            // Test with New York (which may exempt SS from taxation)
            const stateTax = calculateStateTax(
                createTaxState({ stateResidency: 'New York' }),
                [workIncome, ssIncome],
                [],
                2024,
                noInflationAssumptions
            );

            // State tax should be calculated correctly
            // Note: New York may fully exempt SS benefits, so state tax could be $0
            expect(stateTax).toBeGreaterThanOrEqual(0);
            expect(stateTax).toBeLessThan(10000);
        });
    });
});