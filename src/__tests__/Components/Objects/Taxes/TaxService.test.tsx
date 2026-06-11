import { describe, it, expect } from 'vitest';
import { TaxState } from '../../../../components/Objects/Taxes/TaxContext';
import { AssumptionsState, defaultAssumptions, createBuiltinMilestones } from '../../../../components/Objects/Assumptions/AssumptionsContext';
import {
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
    calculateUnifiedStateTax,
    calculateFederalTaxFromIncomes,
    getMarginalTaxRate,
    getCombinedMarginalRate,
    getSALTCap,
    calculateESPPDispositionTax
} from '../../../../components/Objects/Taxes/TaxService';
import { WorkIncome, CurrentSocialSecurityIncome } from '../../../../components/Objects/Income/models';
import { MortgageExpense, DependentExpense } from '../../../../components/Objects/Expense/models';

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


// =============================================================================
// ESPP Disposition Tax Tests
// =============================================================================
describe('TaxService: ESPP Disposition Tax', () => {

    describe('calculateESPPDispositionTax', () => {

        // -------------------------------------------------------------------------
        // Qualifying Disposition Tests
        // -------------------------------------------------------------------------
        describe('Qualifying Dispositions', () => {
            it('should calculate ordinary income as grant discount when gain exceeds discount', () => {
                // Scenario: Large gain exceeding the 15% grant discount
                // Grant FMV: $100, Purchase Price: $85 (15% discount)
                // Sale Price: $150
                // Shares: 100
                const result = calculateESPPDispositionTax(
                    100,    // shares
                    150,    // salePrice
                    85,     // purchasePrice
                    100,    // fmvAtGrant
                    100,    // fmvAtPurchase (same as grant for simplicity)
                    true,   // qualifying
                    true    // longTermCG
                );

                // Total gain = (150 - 85) * 100 = $6,500
                // Grant discount = $100 * 0.15 * 100 = $1,500
                // Ordinary income = min($1,500, $6,500) = $1,500
                // LTCG = $6,500 - $1,500 = $5,000
                expect(result.ordinaryIncome).toBe(1500);
                expect(result.longTermCapitalGains).toBe(5000);
                expect(result.shortTermCapitalGains).toBe(0);
                expect(result.totalTaxableGain).toBe(6500);
            });

            it('should calculate ordinary income as actual gain when gain is less than discount', () => {
                // Scenario: Small gain less than the 15% grant discount
                // Grant FMV: $100, Purchase Price: $85 (15% discount)
                // Sale Price: $90 (small gain)
                // Shares: 100
                const result = calculateESPPDispositionTax(
                    100,    // shares
                    90,     // salePrice
                    85,     // purchasePrice
                    100,    // fmvAtGrant
                    100,    // fmvAtPurchase
                    true,   // qualifying
                    true    // longTermCG
                );

                // Total gain = (90 - 85) * 100 = $500
                // Grant discount = $100 * 0.15 * 100 = $1,500
                // Ordinary income = min($1,500, $500) = $500
                // LTCG = $500 - $500 = $0
                expect(result.ordinaryIncome).toBe(500);
                expect(result.longTermCapitalGains).toBe(0);
                expect(result.shortTermCapitalGains).toBe(0);
                expect(result.totalTaxableGain).toBe(500);
            });
        });

        // -------------------------------------------------------------------------
        // Disqualifying Disposition Tests
        // -------------------------------------------------------------------------
        describe('Disqualifying Dispositions', () => {
            it('should calculate bargain element as ordinary income with STCG', () => {
                // Scenario: Sold before qualifying period, short-term hold
                // FMV at purchase: $120, Purchase Price: $85
                // Sale Price: $130
                // Shares: 50
                const result = calculateESPPDispositionTax(
                    50,     // shares
                    130,    // salePrice
                    85,     // purchasePrice
                    100,    // fmvAtGrant
                    120,    // fmvAtPurchase (higher than grant)
                    false,  // disqualifying
                    false   // shortTermCG
                );

                // Total gain = (130 - 85) * 50 = $2,250
                // Bargain element = (120 - 85) * 50 = $1,750
                // Ordinary income = $1,750
                // STCG = $2,250 - $1,750 = $500
                expect(result.ordinaryIncome).toBe(1750);
                expect(result.shortTermCapitalGains).toBe(500);
                expect(result.longTermCapitalGains).toBe(0);
                expect(result.totalTaxableGain).toBe(2250);
            });

            it('should calculate bargain element as ordinary income with LTCG', () => {
                // Scenario: Sold before qualifying period, but held > 1 year
                // FMV at purchase: $110, Purchase Price: $85
                // Sale Price: $140
                // Shares: 100
                const result = calculateESPPDispositionTax(
                    100,    // shares
                    140,    // salePrice
                    85,     // purchasePrice
                    100,    // fmvAtGrant
                    110,    // fmvAtPurchase
                    false,  // disqualifying
                    true    // longTermCG (held > 1 year from purchase)
                );

                // Total gain = (140 - 85) * 100 = $5,500
                // Bargain element = (110 - 85) * 100 = $2,500
                // Ordinary income = $2,500
                // LTCG = $5,500 - $2,500 = $3,000
                expect(result.ordinaryIncome).toBe(2500);
                expect(result.longTermCapitalGains).toBe(3000);
                expect(result.shortTermCapitalGains).toBe(0);
                expect(result.totalTaxableGain).toBe(5500);
            });
        });

        // -------------------------------------------------------------------------
        // Loss Scenarios
        // -------------------------------------------------------------------------
        describe('Loss Scenarios', () => {
            it('should treat loss as short-term capital loss when not held long enough', () => {
                // Sale price below purchase price
                const result = calculateESPPDispositionTax(
                    100,    // shares
                    80,     // salePrice (below purchase)
                    85,     // purchasePrice
                    100,    // fmvAtGrant
                    100,    // fmvAtPurchase
                    false,  // disqualifying
                    false   // shortTermCG
                );

                // Total gain = (80 - 85) * 100 = -$500 (loss)
                expect(result.ordinaryIncome).toBe(0);
                expect(result.shortTermCapitalGains).toBe(-500);
                expect(result.longTermCapitalGains).toBe(0);
                expect(result.totalTaxableGain).toBe(-500);
            });

            it('should treat loss as long-term capital loss when held > 1 year', () => {
                const result = calculateESPPDispositionTax(
                    50,     // shares
                    70,     // salePrice (below purchase)
                    85,     // purchasePrice
                    100,    // fmvAtGrant
                    100,    // fmvAtPurchase
                    true,   // qualifying
                    true    // longTermCG
                );

                // Total gain = (70 - 85) * 50 = -$750 (loss)
                expect(result.ordinaryIncome).toBe(0);
                expect(result.longTermCapitalGains).toBe(-750);
                expect(result.shortTermCapitalGains).toBe(0);
                expect(result.totalTaxableGain).toBe(-750);
            });
        });

        // -------------------------------------------------------------------------
        // Edge Cases
        // -------------------------------------------------------------------------
        describe('Edge Cases', () => {
            it('should handle zero shares', () => {
                const result = calculateESPPDispositionTax(
                    0, 100, 85, 100, 100, true, true
                );
                expect(result.ordinaryIncome).toBe(0);
                expect(result.longTermCapitalGains).toBe(0);
                expect(result.shortTermCapitalGains).toBe(0);
                expect(result.totalTaxableGain).toBe(0);
            });

            it('should handle sale at exact purchase price (no gain/loss)', () => {
                const result = calculateESPPDispositionTax(
                    100,    // shares
                    85,     // salePrice = purchasePrice
                    85,     // purchasePrice
                    100,    // fmvAtGrant
                    100,    // fmvAtPurchase
                    true,   // qualifying
                    true    // longTermCG
                );

                // Total gain = 0
                expect(result.ordinaryIncome).toBe(0);
                expect(result.longTermCapitalGains).toBe(0);
                expect(result.shortTermCapitalGains).toBe(0);
                expect(result.totalTaxableGain).toBe(0);
            });

            it('should cap ordinary income at total gain for qualifying disposition', () => {
                // Edge case where grant discount exceeds actual gain
                const result = calculateESPPDispositionTax(
                    10,     // shares
                    86,     // salePrice (tiny gain)
                    85,     // purchasePrice
                    100,    // fmvAtGrant
                    100,    // fmvAtPurchase
                    true,   // qualifying
                    true    // longTermCG
                );

                // Total gain = (86 - 85) * 10 = $10
                // Grant discount = $100 * 0.15 * 10 = $150
                // Ordinary income = min($150, $10) = $10
                expect(result.ordinaryIncome).toBe(10);
                expect(result.longTermCapitalGains).toBe(0);
                expect(result.totalTaxableGain).toBe(10);
            });
        });
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

        it('should return 2025 federal parameters with specific values', () => {
            const params = getTaxParameters(2025, 'Single', 'federal');
            expect(params).toBeDefined();
            expect(params?.standardDeduction).toBe(15750);
            expect(params?.brackets[0].rate).toBe(0.10);
            expect(params?.brackets[1].threshold).toBe(11925);
            expect(params?.brackets[1].rate).toBe(0.12);
            expect(params?.brackets[2].threshold).toBe(48475);
            expect(params?.brackets[2].rate).toBe(0.22);
        });

        it('should return MFS parameters with specific values', () => {
            const params = getTaxParameters(2024, 'Married Filing Separately', 'federal');
            expect(params).toBeDefined();
            expect(params?.standardDeduction).toBe(14600);
            expect(params?.brackets[1].threshold).toBe(11600);
            expect(params?.brackets[6].threshold).toBe(365600); // MFS has lower top bracket threshold
            expect(params?.capitalGainsBrackets?.[2].threshold).toBe(291850); // MFS LTCG threshold
        });

        it('should return closest year data for non-existent year (2023)', () => {
            // 2023 doesn't exist in database, should return 2024 (closest)
            const params = getTaxParameters(2023, 'Single', 'federal');
            expect(params).toBeDefined();
            // Should match 2024 values
            expect(params?.standardDeduction).toBe(14600);
            expect(params?.brackets[1].threshold).toBe(11600);
        });

        it('should return 2026 values for future year WITHOUT inflation adjustment', () => {
            // Without inflation adjustment, future years use closest available year (2026)
            const params = getTaxParameters(2030, 'Single', 'federal', undefined, noInflationAssumptions);
            expect(params).toBeDefined();
            // 2026 Single values
            expect(params?.standardDeduction).toBe(16100);
            expect(params?.brackets[1].threshold).toBe(12400);
        });

        it('should inflate values for future year WITH inflation adjustment', () => {
            const inflationAssumptions: AssumptionsState = {
                ...noInflationAssumptions,
                macro: { ...noInflationAssumptions.macro, inflationAdjusted: true, inflationRate: 3 }
            };
            // 2030 is 4 years after max_year (2026)
            // Expected: 16100 * (1.03)^4 = 16100 * 1.12550881 = 18121 (rounded)
            const params = getTaxParameters(2030, 'Single', 'federal', undefined, inflationAssumptions);
            expect(params).toBeDefined();
            expect(params?.standardDeduction).toBe(18121);
            // Bracket threshold: 12400 * 1.12550881 = 13956 (rounded)
            expect(params?.brackets[1].threshold).toBe(13956);
        });

        it('should return state parameters for Virginia', () => {
            const params = getTaxParameters(2024, 'Single', 'state', 'Virginia');
            expect(params).toBeDefined();
            expect(params?.standardDeduction).toBe(8500);
            expect(params?.brackets[0].rate).toBe(0.02);
            expect(params?.socialSecurityTreatment).toBe('exempt');
        });

        it('should return undefined for state without inflation adjustment setting', () => {
            const params = getTaxParameters(2024, 'Single', 'state', undefined);
            expect(params).toBeUndefined();
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
            expect(total).toBe(105000); 
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
            // Deduction = annual mortgage interest for $400k @ 3%, 30yr loan
            // Year 1 interest ≈ $11,885.79 (amortization calculated from current balance)
            expect(deductions).toBeCloseTo(11885.79, 0);
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
                // PR#55 #3: corrected 2024 Single bracket to breakpoint convention
                // 11600 * 0.10 = 1160
                // (47150 - 11600) * 0.12 = 4266.00
                // (50000 - 47150) * 0.22 = 627.00
                // Total = 6053.00
                expect(tax).toBeCloseTo(6053.00);
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
            // SS is capped at the 2024 wage base of 168,600. Medicare is not.
            // SS = 168600 * 0.062 = 10453.2
            // Medicare = 500000 * 0.0145 = 7250
            // Additional Medicare = 0.9% * (500000 - 200000 single threshold) = 2700
            // Total = 10453.2 + 7250 + 2700 = 20403.2
            expect(fica).toBeCloseTo(20403.2);
        });

        it('should use FICA override when provided', () => {
            const income = new WorkIncome('w1', 'Job', 100000, 'Annually', 'Yes', 0, 0, 0, 0, 'acc1', 'Traditional 401k', 'FIXED', new Date('2020-01-01'));
            const taxState = createTaxState({ ficaOverride: 5000 });
            const fica = calculateFicaTax(taxState, [income], 2024, noInflationAssumptions);
            expect(fica).toBe(5000);
        });

        it('should combine FICA from multiple income sources', () => {
            const job1 = new WorkIncome('w1', 'Job 1', 80000, 'Annually', 'Yes', 0, 0, 0, 0, 'acc1', 'Traditional 401k', 'FIXED', new Date('2020-01-01'));
            const job2 = new WorkIncome('w2', 'Job 2', 60000, 'Annually', 'Yes', 0, 0, 0, 0, 'acc2', 'Traditional 401k', 'FIXED', new Date('2020-01-01'));
            const taxState = createTaxState();
            const fica = calculateFicaTax(taxState, [job1, job2], 2024, noInflationAssumptions);
            // Combined earned income = 140k (below 2024 wage base of 168,600)
            // SS = 140000 * 0.062 = 8680
            // Medicare = 140000 * 0.0145 = 2030
            // Total = 10710
            expect(fica).toBe(10710);
        });

        it('should apply FICA exemptions (insurance, HSA)', () => {
            // Monthly income with $500/month insurance and $200/month HSA = $8400/year FICA exempt
            const income = new WorkIncome(
                'w1', 'Job', 8333.33, 'Monthly', 'Yes',  // ~$100k/year
                0,      // preTax401k (not FICA exempt)
                500,    // insurance per month (FICA exempt)
                0,      // rothContribution
                0,      // employerMatch
                'acc1', 'Traditional 401k', 'FIXED',
                new Date('2020-01-01'),
                undefined,
                200     // HSA per month (FICA exempt)
            );
            const taxState = createTaxState();
            const fica = calculateFicaTax(taxState, [income], 2024, noInflationAssumptions);
            // Annual gross = 8333.33 * 12 = 99999.96
            // FICA exemptions = (500 + 200) * 12 = 8400
            // Taxable base = 99999.96 - 8400 = 91599.96
            // SS = 91599.96 * 0.062 = 5679.20
            // Medicare = 91599.96 * 0.0145 = 1328.20
            // Total = 7007.40
            expect(fica).toBeCloseTo(7007.4, 0);
        });

        it('should combine multiple incomes and respect wage base cap', () => {
            const job1 = new WorkIncome('w1', 'Job 1', 100000, 'Annually', 'Yes', 0, 0, 0, 0, 'acc1', 'Traditional 401k', 'FIXED', new Date('2020-01-01'));
            const job2 = new WorkIncome('w2', 'Job 2', 100000, 'Annually', 'Yes', 0, 0, 0, 0, 'acc2', 'Traditional 401k', 'FIXED', new Date('2020-01-01'));
            const taxState = createTaxState();
            const fica = calculateFicaTax(taxState, [job1, job2], 2024, noInflationAssumptions);
            // Combined earned income = 200k (above 2024 wage base of 168,600)
            // SS = 168600 * 0.062 = 10453.2
            // Medicare = 200000 * 0.0145 = 2900
            // Total = 13353.2
            expect(fica).toBeCloseTo(13353.2);
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

        it('should apply Virginia senior deduction for age 65+', () => {
            const income = new WorkIncome('w1', 'Job', 100000, 'Annually', 'Yes', 0, 0, 0, 0, 'acc1', 'Traditional 401k', 'FIXED', new Date('2020-01-01'));
            const taxState = createTaxState({ stateResidency: 'Virginia' });
            // Assumptions with age 65 (born 1959, tax year 2024)
            const seniorAssumptions: AssumptionsState = {
                ...noInflationAssumptions,
                milestones: createBuiltinMilestones(1959, 1, 15)
            };
            const stateTax = calculateStateTax(taxState, [income], [], 2024, seniorAssumptions);
            // Virginia 2024 Single: standard deduction $8,500 + senior deduction $12,000 = $20,500
            // Taxable: 100k - 20.5k = 79.5k
            // VA brackets: 3k@2% + 2k@3% + 12k@5% + 62.5k@5.75%
            // = 60 + 60 + 600 + 3593.75 = 4313.75
            expect(stateTax).toBeCloseTo(4313.75, 0);
        });

        it('should double Virginia senior deduction for MFJ', () => {
            const income = new WorkIncome('w1', 'Job', 100000, 'Annually', 'Yes', 0, 0, 0, 0, 'acc1', 'Traditional 401k', 'FIXED', new Date('2020-01-01'));
            const taxState = createTaxState({ stateResidency: 'Virginia', filingStatus: 'Married Filing Jointly' });
            const seniorAssumptions: AssumptionsState = {
                ...noInflationAssumptions,
                milestones: createBuiltinMilestones(1959, 1, 15)
            };
            const stateTax = calculateStateTax(taxState, [income], [], 2024, seniorAssumptions);
            // MFJ: standard $17,000 + senior $24,000 (2x $12k) = $41,000
            // Taxable: 100k - 41k = 59k
            // VA brackets: 3k@2% + 2k@3% + 12k@5% + 42k@5.75%
            // = 60 + 60 + 600 + 2415 = 3135
            expect(stateTax).toBeCloseTo(3135, 0);
        });

        it('should exclude Social Security from Virginia state tax', () => {
            const work = new WorkIncome('w1', 'Job', 50000, 'Annually', 'Yes', 0, 0, 0, 0, 'acc1', 'Traditional 401k', 'FIXED', new Date('2020-01-01'));
            const ss = new CurrentSocialSecurityIncome('ss1', 'SS', 30000, 'Annually', new Date('2020-01-01'));
            const taxState = createTaxState({ stateResidency: 'Virginia' });
            const stateTax = calculateStateTax(taxState, [work, ss], [], 2024, noInflationAssumptions);
            // Virginia exempts SS. Gross without SS = 50k
            // Taxable: 50k - 8.5k = 41.5k
            // VA brackets: 3k@2% + 2k@3% + 12k@5% + 24.5k@5.75%
            // = 60 + 60 + 600 + 1408.75 = 2128.75
            expect(stateTax).toBeCloseTo(2128.75, 0);
        });

        it('should use itemized deduction when higher than standard (Auto mode)', () => {
            const income = new WorkIncome('w1', 'Job', 100000, 'Annually', 'Yes', 0, 0, 0, 0, 'acc1', 'Traditional 401k', 'FIXED', new Date(2020, 0, 1));
            // Large mortgage with ~$12k/year interest
            const mortgage = new MortgageExpense('m1', 'Home', 'Monthly', 500000, 400000, 400000, 3, 30, 1.2, 0, 1, 100, 0.3, 0, 50, 'Itemized', 0.8, 'a1', new Date(2020, 0, 1));
            mortgage.loan_balance = mortgage.getBalanceAtDate('2024-01-02');
            const taxState = createTaxState({ stateResidency: 'DC', deductionMethod: 'Auto' });
            const taxAuto = calculateStateTax(taxState, [income], [mortgage], 2024, noInflationAssumptions);
            const taxStandard = calculateStateTax({ ...taxState, deductionMethod: 'Standard' }, [income], [mortgage], 2024, noInflationAssumptions);
            const taxItemized = calculateStateTax({ ...taxState, deductionMethod: 'Itemized' }, [income], [mortgage], 2024, noInflationAssumptions);
            // Auto should pick the lower tax
            expect(taxAuto).toBe(Math.min(taxStandard, taxItemized));
        });

        it('should calculate California state tax', () => {
            const income = new WorkIncome('w1', 'Job', 100000, 'Annually', 'Yes', 0, 0, 0, 0, 'acc1', 'Traditional 401k', 'FIXED', new Date('2020-01-01'));
            const taxState = createTaxState({ stateResidency: 'California' });
            const stateTax = calculateStateTax(taxState, [income], [], 2025, noInflationAssumptions);
            // CA 2025 Single: standard deduction $5,540
            // Taxable: 100k - 5.54k = 94.46k
            // CA progressive brackets lead to ~$5,327 tax
            expect(stateTax).toBeCloseTo(5327, 0);
        });
    });

    describe('calculateUnifiedStateTax', () => {
        it('should include additional ordinary income in tax base', () => {
            const income = new WorkIncome('w1', 'Job', 50000, 'Annually', 'Yes', 0, 0, 0, 0, 'acc1', 'Traditional 401k', 'FIXED', new Date('2020-01-01'));
            const taxState = createTaxState({ stateResidency: 'DC' });
            const taxWithoutAdditional = calculateUnifiedStateTax(taxState, [income], [], 0, 2024, noInflationAssumptions);
            const taxWithAdditional = calculateUnifiedStateTax(taxState, [income], [], 50000, 2024, noInflationAssumptions);
            // Additional $50k should increase the tax
            expect(taxWithAdditional).toBeGreaterThan(taxWithoutAdditional);
            // Tax on $100k total should match calculateStateTax with $100k income
            const income100k = new WorkIncome('w1', 'Job', 100000, 'Annually', 'Yes', 0, 0, 0, 0, 'acc1', 'Traditional 401k', 'FIXED', new Date('2020-01-01'));
            const taxDirect = calculateStateTax(taxState, [income100k], [], 2024, noInflationAssumptions);
            expect(taxWithAdditional).toBeCloseTo(taxDirect);
        });

        it('should respect state override', () => {
            const income = new WorkIncome('w1', 'Job', 50000, 'Annually', 'Yes', 0, 0, 0, 0, 'acc1', 'Traditional 401k', 'FIXED', new Date('2020-01-01'));
            const taxState = createTaxState({ stateResidency: 'DC', stateOverride: 2500 });
            const stateTax = calculateUnifiedStateTax(taxState, [income], [], 50000, 2024, noInflationAssumptions);
            expect(stateTax).toBe(2500);
        });

        it('should return 0 for no-tax state even with additional income', () => {
            const income = new WorkIncome('w1', 'Job', 50000, 'Annually', 'Yes', 0, 0, 0, 0, 'acc1', 'Traditional 401k', 'FIXED', new Date('2020-01-01'));
            const taxState = createTaxState({ stateResidency: 'Texas' });
            const stateTax = calculateUnifiedStateTax(taxState, [income], [], 100000, 2024, noInflationAssumptions);
            expect(stateTax).toBe(0);
        });

        it('should exclude Social Security and include additional income', () => {
            const work = new WorkIncome('w1', 'Job', 30000, 'Annually', 'Yes', 0, 0, 0, 0, 'acc1', 'Traditional 401k', 'FIXED', new Date('2020-01-01'));
            const ss = new CurrentSocialSecurityIncome('ss1', 'SS', 20000, 'Annually', new Date('2020-01-01'));
            const taxState = createTaxState({ stateResidency: 'Virginia' });
            // Add $20k withdrawal
            const stateTax = calculateUnifiedStateTax(taxState, [work, ss], [], 20000, 2024, noInflationAssumptions);
            // Virginia exempts SS. Base = 30k + 20k withdrawal = 50k (SS excluded)
            // Taxable: 50k - 8.5k = 41.5k
            // VA brackets: 3k@2% + 2k@3% + 12k@5% + 24.5k@5.75%
            // = 60 + 60 + 600 + 1408.75 = 2128.75
            expect(stateTax).toBeCloseTo(2128.75, 0);
        });

        it('should apply Virginia senior deduction with additional income', () => {
            const income = new WorkIncome('w1', 'Job', 50000, 'Annually', 'Yes', 0, 0, 0, 0, 'acc1', 'Traditional 401k', 'FIXED', new Date('2020-01-01'));
            const taxState = createTaxState({ stateResidency: 'Virginia' });
            const seniorAssumptions: AssumptionsState = {
                ...noInflationAssumptions,
                milestones: createBuiltinMilestones(1959, 1, 15)
            };
            // $50k work + $30k withdrawal = $80k total
            const stateTax = calculateUnifiedStateTax(taxState, [income], [], 30000, 2024, seniorAssumptions);
            // Virginia 2024 Single: standard $8,500 + senior $12,000 = $20,500
            // Taxable: 80k - 20.5k = 59.5k
            // VA brackets: 3k@2% + 2k@3% + 12k@5% + 42.5k@5.75%
            // = 60 + 60 + 600 + 2443.75 = 3163.75
            expect(stateTax).toBeCloseTo(3163.75, 0);
        });
    });

    describe('calculateFederalTaxFromIncomes', () => {
        it('should calculate federal tax with standard deduction', () => {
            const income = new WorkIncome('w1', 'Job', 100000, 'Annually', 'Yes', 0, 0, 0, 0, 'acc1', 'Traditional 401k', 'FIXED', new Date('2020-01-01'));
            const taxState = createTaxState({ deductionMethod: 'Standard' });
            const fedTax = calculateFederalTaxFromIncomes(taxState, [income], [], 0, 2024, noInflationAssumptions);
            // PR#55 #3: corrected 2024 Single bracket to breakpoint convention
            // Taxable income: 100k - 14.6k (std deduction) = 85.4k
            // 11600 * 0.10 = 1160
            // (47150 - 11600) * 0.12 = 4266.00
            // (85400 - 47150) * 0.22 = 8415.00
            // Total = 13841.00
            expect(fedTax).toBeCloseTo(13841.00);
        });

        it('should calculate federal tax with itemized deductions', () => {
            // Use Date constructor with args to ensure local time
            const income = new WorkIncome('w1', 'Job', 100000, 'Annually', 'Yes', 0, 0, 0, 0, 'acc1', 'Traditional 401k', 'FIXED', new Date(2020, 0, 1));
            const mortgage = new MortgageExpense('m1', 'Home', 'Monthly', 500000, 400000, 400000, 3, 30, 1.2, 0, 1, 100, 0.3, 0, 50, 'Itemized', 0.8, 'a1', new Date(2020, 0, 1));
            mortgage.loan_balance = mortgage.getBalanceAtDate('2024-01-02');
            const taxState = createTaxState({ deductionMethod: 'Itemized', stateResidency: 'DC' });
            const fedTax = calculateFederalTaxFromIncomes(taxState, [income], [mortgage], 0, 2024, noInflationAssumptions);
            // PR#55 #3: corrected 2024 Single bracket to breakpoint convention (+$0.10 vs old +1 boundary)
            // Placeholder value. Actual tax depends on the calculated itemized deduction.
            expect(fedTax).toBeCloseTo(13356.44);
        });

        it('should use federal override when provided', () => {
            const income = new WorkIncome('w1', 'Job', 100000, 'Annually', 'Yes', 0, 0, 0, 0, 'acc1', 'Traditional 401k', 'FIXED', new Date('2020-01-01'));
            const taxState = createTaxState({ fedOverride: 15000 });
            const fedTax = calculateFederalTaxFromIncomes(taxState, [income], [], 0, 2024, noInflationAssumptions);
            expect(fedTax).toBe(15000);
        });
    });

    describe('FICA and State Tax with Social Security', () => {
        /**
         * Tests for FICA and state tax handling of Social Security income.
         * NOTE: Federal tax SS integration tests are in SocialSecurityTax.test.tsx
         */

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

    describe('getItemizedDeductions with non-Mortgage expenses', () => {
        it('should calculate itemized deductions for non-mortgage expenses', () => {
            // DependentExpense with Itemized deduction (Annually to avoid proration)
            const expense = new DependentExpense(
                'd1',
                'Child Care',
                12000,
                'Annually',
                'Itemized',
                6000, // tax_deductible amount (annual)
                new Date('2024-01-01'),
                new Date('2024-12-31')
            );

            const deductions = getItemizedDeductions([expense], 2024);
            // Should return the tax_deductible amount for the year
            expect(deductions).toBe(6000);
        });

        it('should combine mortgage and non-mortgage itemized deductions', () => {
            const mortgage = new MortgageExpense('m1', 'Home', 'Monthly', 500000, 400000, 400000, 3, 30, 1.2, 0, 1, 100, 0.3, 0, 50, 'Itemized', 0.8, 'a1', new Date('2024-01-02'));
            const dependent = new DependentExpense(
                'd1',
                'Child Care',
                12000,
                'Annually',
                'Itemized',
                3000, // Annual tax deductible amount
                new Date('2024-01-01'),
                new Date('2024-12-31')
            );

            const deductions = getItemizedDeductions([mortgage, dependent], 2024);
            // Should include both mortgage interest (~11885) and dependent deduction (3000)
            expect(deductions).toBeCloseTo(11885.79 + 3000, 0);
        });
    });

    describe('getMarginalTaxRate', () => {
        it('should return correct marginal rate for income in 12% bracket', () => {
            const params = getTaxParameters(2024, 'Single', 'federal');
            if (params) {
                // PR#55 #3: corrected 2024 Single bracket to breakpoint convention
                // Taxable income of $30,000 is in the 12% bracket (11,600 - 47,150)
                const result = getMarginalTaxRate(30000, params);
                expect(result.rate).toBe(0.12);
                expect(result.bracketStart).toBe(11600);
                expect(result.bracketEnd).toBe(47150);
                expect(result.headroom).toBe(47150 - 30000);
            }
        });

        it('should return correct marginal rate for zero income', () => {
            const params = getTaxParameters(2024, 'Single', 'federal');
            if (params) {
                const result = getMarginalTaxRate(0, params);
                expect(result.rate).toBe(0.10);
                expect(result.bracketStart).toBe(0);
                expect(result.headroom).toBe(11600); // Room until 12% bracket
            }
        });

        it('should return correct marginal rate for negative income', () => {
            const params = getTaxParameters(2024, 'Single', 'federal');
            if (params) {
                const result = getMarginalTaxRate(-5000, params);
                expect(result.rate).toBe(0.10);
                expect(result.bracketStart).toBe(0);
            }
        });

        it('should return top bracket rate for very high income', () => {
            const params = getTaxParameters(2024, 'Single', 'federal');
            if (params) {
                // Income above the top bracket threshold ($609,351 for 2024 Single)
                const result = getMarginalTaxRate(1000000, params);
                expect(result.rate).toBe(0.37);
                expect(result.bracketEnd).toBe(Infinity);
                expect(result.headroom).toBe(Infinity);
            }
        });

        it('should handle income exactly at bracket boundary', () => {
            const params = getTaxParameters(2024, 'Single', 'federal');
            if (params) {
                // Exactly at the 12% bracket start
                const result = getMarginalTaxRate(11600, params);
                expect(result.rate).toBe(0.12);
                expect(result.bracketStart).toBe(11600);
            }
        });
    });

    describe('getCombinedMarginalRate', () => {
        it('should calculate combined rate for income below SS wage base', () => {
            const result = getCombinedMarginalRate(
                50000,
                0,
                createTaxState({ stateResidency: 'Texas' }),
                2024,
                noInflationAssumptions,
                true
            );

            // Federal rate for ~35,400 taxable (50k - 14.6k std ded) = 12%
            // State = 0% (Texas)
            // FICA = 7.65% (6.2% SS + 1.45% Medicare)
            expect(result.federal).toBe(0.12);
            expect(result.state).toBe(0);
            expect(result.fica).toBeCloseTo(0.0765);
            expect(result.combined).toBeCloseTo(0.12 + 0.0765);
        });

        it('should only include Medicare rate above SS wage base', () => {
            const result = getCombinedMarginalRate(
                175000, // Above 2024 SS wage base ($168,600), below the $200k Additional-Medicare threshold
                0,
                createTaxState({ stateResidency: 'Texas' }),
                2024,
                noInflationAssumptions,
                true
            );

            // Above SS wage base, only Medicare (1.45%) applies, not SS (6.2%);
            // below the $200k threshold so the 0.9% Additional Medicare surtax does not apply.
            expect(result.fica).toBe(0.0145); // Only Medicare rate
        });

        it('should exclude FICA when includesFICA is false', () => {
            const result = getCombinedMarginalRate(
                50000,
                0,
                createTaxState({ stateResidency: 'Texas' }),
                2024,
                noInflationAssumptions,
                false
            );

            expect(result.fica).toBe(0);
            expect(result.combined).toBe(result.federal + result.state);
        });

        it('should include state tax in combined rate', () => {
            const result = getCombinedMarginalRate(
                100000,
                0,
                createTaxState({ stateResidency: 'DC' }),
                2024,
                noInflationAssumptions,
                true
            );

            // Taxable income = 100000 - 14600 = 85400
            // Federal: In 22% bracket ($47,151-$100,525)
            // DC State: In 8.5% bracket ($60,000-$250,000)
            expect(result.federal).toBe(0.22);
            expect(result.state).toBe(0.085);
            expect(result.combined).toBe(result.federal + result.state + result.fica);
        });

        it('should calculate federal headroom correctly', () => {
            const result = getCombinedMarginalRate(
                50000,
                0,
                createTaxState({ stateResidency: 'Texas' }),
                2024,
                noInflationAssumptions,
                true
            );

            // PR#55 #3: corrected 2024 Single bracket to breakpoint convention
            // Taxable = 50000 - 14600 = 35400, in 12% bracket (11600-47150)
            // Headroom = 47150 - 35400 = 11750
            expect(result.federalHeadroom).toBeCloseTo(11750);
        });
    });

    describe('getSALTCap', () => {
        it('should return $10,000 for single filers (2018-2024)', () => {
            expect(getSALTCap(2018, 'Single')).toBe(10000);
            expect(getSALTCap(2020, 'Single')).toBe(10000);
            expect(getSALTCap(2024, 'Single')).toBe(10000);
        });

        it('should return $5,000 for married filing separately (2018-2024)', () => {
            expect(getSALTCap(2018, 'Married Filing Separately')).toBe(5000);
            expect(getSALTCap(2024, 'Married Filing Separately')).toBe(5000);
        });

        it('should return $40,000 for joint filers in 2025 (OBBBA)', () => {
            expect(getSALTCap(2025, 'Single')).toBe(40000);
            expect(getSALTCap(2025, 'Married Filing Jointly')).toBe(40000);
        });

        it('should return $20,000 for MFS in 2025 (OBBBA)', () => {
            expect(getSALTCap(2025, 'Married Filing Separately')).toBe(20000);
        });

        it('should return $10,000 for 2023 (TCJA era)', () => {
            expect(getSALTCap(2023, 'Single')).toBe(10000);
            expect(getSALTCap(2023, 'Married Filing Jointly')).toBe(10000);
            expect(getSALTCap(2023, 'Married Filing Separately')).toBe(5000);
        });

        it('should apply 1% annual increase for 2026-2029', () => {
            // 2026: 40000 * 1.01 = 40400
            expect(getSALTCap(2026, 'Single')).toBe(40400);
            // 2027: 40000 * 1.01^2 = 40804
            expect(getSALTCap(2027, 'Single')).toBe(40804);
            // 2028: 40000 * 1.01^3 = 41212
            expect(getSALTCap(2028, 'Single')).toBe(41212);
            // 2029: 40000 * 1.01^4 = 41624
            expect(getSALTCap(2029, 'Single')).toBe(41624);
        });

        it('should apply 1% annual increase for MFJ (2027)', () => {
            // MFJ 2027: 40000 * 1.01^2 = 40804
            expect(getSALTCap(2027, 'Married Filing Jointly')).toBe(40804);
        });

        it('should apply 1% annual increase for MFS (2026-2029)', () => {
            // MFS gets half: 20000 base
            // 2026: 20000 * 1.01 = 20200
            expect(getSALTCap(2026, 'Married Filing Separately')).toBe(20200);
            // 2027: 20000 * 1.01^2 = 20402
            expect(getSALTCap(2027, 'Married Filing Separately')).toBe(20402);
        });

        it('should revert to $10,000 in 2030 and beyond', () => {
            expect(getSALTCap(2030, 'Single')).toBe(10000);
            expect(getSALTCap(2031, 'Single')).toBe(10000);
            expect(getSALTCap(2031, 'Married Filing Jointly')).toBe(10000);
            expect(getSALTCap(2031, 'Married Filing Separately')).toBe(5000);
            expect(getSALTCap(2035, 'Married Filing Jointly')).toBe(10000);
        });

        it('should return Infinity for pre-TCJA years (before 2018)', () => {
            expect(getSALTCap(2017, 'Single')).toBe(Infinity);
            expect(getSALTCap(2010, 'Married Filing Jointly')).toBe(Infinity);
        });
    });

    describe('State Tax: Social Security Treatment', () => {
        /**
         * Tests for data-driven Social Security treatment in state taxes.
         * States with socialSecurityTreatment: 'exempt' should exclude SS from state taxable income.
         */

        it('should exclude SS income from state tax for California (exempt)', () => {
            const ssIncome = new CurrentSocialSecurityIncome(
                'ss1',
                'SS Benefits',
                3000, // $3000/month = $36,000/year
                'Monthly',
                new Date('2025-01-01'),
                new Date('2025-12-31')
            );

            // California has socialSecurityTreatment: 'exempt'
            const stateTax = calculateStateTax(
                createTaxState({ stateResidency: 'California' }),
                [ssIncome],
                [],
                2025,
                noInflationAssumptions
            );

            // With only SS income and SS being exempt, state tax should be $0
            expect(stateTax).toBe(0);
        });

        it('should exclude SS income from state tax for DC (exempt)', () => {
            const ssIncome = new CurrentSocialSecurityIncome(
                'ss1',
                'SS Benefits',
                2500,
                'Monthly',
                new Date('2025-01-01'),
                new Date('2025-12-31')
            );

            const stateTax = calculateStateTax(
                createTaxState({ stateResidency: 'DC' }),
                [ssIncome],
                [],
                2025,
                noInflationAssumptions
            );

            // DC has socialSecurityTreatment: 'exempt', so SS should not be taxed
            expect(stateTax).toBe(0);
        });

        it('should exclude SS income from state tax for North Carolina (exempt)', () => {
            const ssIncome = new CurrentSocialSecurityIncome(
                'ss1',
                'SS Benefits',
                2000,
                'Monthly',
                new Date('2025-01-01'),
                new Date('2025-12-31')
            );

            const stateTax = calculateStateTax(
                createTaxState({ stateResidency: 'North Carolina' }),
                [ssIncome],
                [],
                2025,
                noInflationAssumptions
            );

            // NC has socialSecurityTreatment: 'exempt'
            expect(stateTax).toBe(0);
        });

        it('should exclude SS income from state tax for Virginia (exempt)', () => {
            const ssIncome = new CurrentSocialSecurityIncome(
                'ss1',
                'SS Benefits',
                2500,
                'Monthly',
                new Date('2025-01-01'),
                new Date('2025-12-31')
            );

            const stateTax = calculateStateTax(
                createTaxState({ stateResidency: 'Virginia' }),
                [ssIncome],
                [],
                2025,
                noInflationAssumptions
            );

            // VA has socialSecurityTreatment: 'exempt'
            expect(stateTax).toBe(0);
        });

        it('should default to exempt for states without socialSecurityTreatment field', () => {
            const ssIncome = new CurrentSocialSecurityIncome(
                'ss1',
                'SS Benefits',
                2500,
                'Monthly',
                new Date('2025-01-01'),
                new Date('2025-12-31')
            );

            // Texas has no socialSecurityTreatment field (and zero rate anyway)
            const stateTax = calculateStateTax(
                createTaxState({ stateResidency: 'Texas' }),
                [ssIncome],
                [],
                2025,
                noInflationAssumptions
            );

            // Texas has no income tax, but the behavior should still default to 'exempt'
            expect(stateTax).toBe(0);
        });
    });

    describe('State Tax: Virginia Senior Deduction', () => {
        /**
         * Tests for Virginia's $12,000 senior deduction at age 65+.
         * The deduction should apply when age >= seniorAge (65).
         */

        const createAssumptionsWithAge = (birthYear: number): AssumptionsState => ({
            ...noInflationAssumptions,
            milestones: createBuiltinMilestones(birthYear, 65, 90)
        });

        it('should apply Virginia senior deduction at age 65', () => {
            // Person born in 1960, tax year 2025 = age 65
            const assumptions = createAssumptionsWithAge(1960);

            const workIncome = new WorkIncome(
                'w1',
                'Pension',
                50000,
                'Annually',
                'No', // Not earned income
                0, 0, 0, 0,
                'acc1',
                'Traditional 401k',
                'FIXED',
                new Date('2025-01-01'),
                new Date('2025-12-31')
            );

            const stateTax = calculateStateTax(
                createTaxState({ stateResidency: 'Virginia' }),
                [workIncome],
                [],
                2025,
                assumptions
            );

            // VA 2025: Standard deduction $8750 + Senior deduction $12000 = $20750
            // Taxable = $50000 - $20750 = $29250
            // Tax: $60 (2% on $3000) + $60 (3% on $2000) + $600 (5% on $12000) + $704.38 (5.75% on $12250)
            // = $60 + $60 + $600 + $704.38 = $1424.38
            expect(stateTax).toBeCloseTo(1424.38, 0);
        });

        it('should NOT apply Virginia senior deduction below age 65', () => {
            // Person born in 1965, tax year 2025 = age 60
            const assumptions = createAssumptionsWithAge(1965);

            const workIncome = new WorkIncome(
                'w1',
                'Pension',
                50000,
                'Annually',
                'No',
                0, 0, 0, 0,
                'acc1',
                'Traditional 401k',
                'FIXED',
                new Date('2025-01-01'),
                new Date('2025-12-31')
            );

            const stateTax = calculateStateTax(
                createTaxState({ stateResidency: 'Virginia' }),
                [workIncome],
                [],
                2025,
                assumptions
            );

            // VA 2025: Standard deduction $8750 only (no senior deduction)
            // Taxable = $50000 - $8750 = $41250
            // Tax: $60 (2% on $3000) + $60 (3% on $2000) + $600 (5% on $12000) + $1394.38 (5.75% on $24250)
            // = $60 + $60 + $600 + $1394.38 = $2114.38
            expect(stateTax).toBeCloseTo(2114.38, 0);
        });

        it('should apply senior deduction for ages above 65', () => {
            // Person born in 1955, tax year 2025 = age 70
            const assumptions = createAssumptionsWithAge(1955);

            const workIncome = new WorkIncome(
                'w1',
                'Pension',
                50000,
                'Annually',
                'No',
                0, 0, 0, 0,
                'acc1',
                'Traditional 401k',
                'FIXED',
                new Date('2025-01-01'),
                new Date('2025-12-31')
            );

            const stateTaxAt70 = calculateStateTax(
                createTaxState({ stateResidency: 'Virginia' }),
                [workIncome],
                [],
                2025,
                assumptions
            );

            // Should get the senior deduction at age 70 (same as age 65)
            const assumptionsAt65 = createAssumptionsWithAge(1960);
            const stateTaxAt65 = calculateStateTax(
                createTaxState({ stateResidency: 'Virginia' }),
                [workIncome],
                [],
                2025,
                assumptionsAt65
            );

            expect(stateTaxAt70).toBeCloseTo(stateTaxAt65, 0);
        });

        it('should double Virginia senior deduction for Married Filing Jointly', () => {
            // Person born in 1960, tax year 2025 = age 65
            // MFJ should get $24,000 senior deduction (2 x $12,000)
            const assumptions = createAssumptionsWithAge(1960);

            const workIncome = new WorkIncome(
                'w1',
                'Pension',
                50000,
                'Annually',
                'No',
                0, 0, 0, 0,
                'acc1',
                'Traditional 401k',
                'FIXED',
                new Date('2025-01-01'),
                new Date('2025-12-31')
            );

            const stateTax = calculateStateTax(
                createTaxState({ stateResidency: 'Virginia', filingStatus: 'Married Filing Jointly' }),
                [workIncome],
                [],
                2025,
                assumptions
            );

            // VA 2025 MFJ: Standard deduction $17500 + Senior deduction $24000 = $41500
            // Taxable = $50000 - $41500 = $8500
            // Tax: $60 (2% on $3000) + $60 (3% on $2000) + $175 (5% on $3500)
            // = $60 + $60 + $175 = $295
            expect(stateTax).toBeCloseTo(295, 0);
        });

        it('should NOT double Virginia senior deduction for Married Filing Separately', () => {
            // Person born in 1960, tax year 2025 = age 65
            // MFS should get $12,000 senior deduction (not doubled)
            const assumptions = createAssumptionsWithAge(1960);

            const workIncome = new WorkIncome(
                'w1',
                'Pension',
                50000,
                'Annually',
                'No',
                0, 0, 0, 0,
                'acc1',
                'Traditional 401k',
                'FIXED',
                new Date('2025-01-01'),
                new Date('2025-12-31')
            );

            const stateTax = calculateStateTax(
                createTaxState({ stateResidency: 'Virginia', filingStatus: 'Married Filing Separately' }),
                [workIncome],
                [],
                2025,
                assumptions
            );

            // VA 2025 MFS: Standard deduction $8750 + Senior deduction $12000 = $20750
            // Taxable = $50000 - $20750 = $29250
            // Same tax as Single at age 65
            expect(stateTax).toBeCloseTo(1424.38, 0);
        });

        it('should keep Single Virginia senior deduction at $12,000', () => {
            // Person born in 1960, tax year 2025 = age 65
            // Single should get $12,000 senior deduction (not doubled)
            const assumptions = createAssumptionsWithAge(1960);

            const workIncome = new WorkIncome(
                'w1',
                'Pension',
                50000,
                'Annually',
                'No',
                0, 0, 0, 0,
                'acc1',
                'Traditional 401k',
                'FIXED',
                new Date('2025-01-01'),
                new Date('2025-12-31')
            );

            const stateTaxSingle = calculateStateTax(
                createTaxState({ stateResidency: 'Virginia', filingStatus: 'Single' }),
                [workIncome],
                [],
                2025,
                assumptions
            );

            const stateTaxMFJ = calculateStateTax(
                createTaxState({ stateResidency: 'Virginia', filingStatus: 'Married Filing Jointly' }),
                [workIncome],
                [],
                2025,
                assumptions
            );

            // MFJ should have lower tax due to doubled senior deduction
            // Single: $1424.38, MFJ: $295
            expect(stateTaxMFJ).toBeLessThan(stateTaxSingle);
        });
    });
});