import { describe, it, expect } from 'vitest';
import {
    getContributionLimits,
    get401kLimit,
    getIRALimit,
    getHSALimit,
    calculateContributionTaxSavings
} from '../../data/ContributionLimits';
import {
    getMarginalTaxRate,
    getCombinedMarginalRate,
    getTaxParameters
} from '../../components/Objects/Taxes/TaxService';
import { TaxState } from '../../components/Objects/Taxes/TaxContext';
import { defaultAssumptions, AssumptionsState } from '../../components/Objects/Assumptions/AssumptionsContext';

// --- Test Helpers ---

const createTaxState = (overrides: Partial<TaxState> = {}): TaxState => ({
    filingStatus: 'Single',
    stateResidency: 'California',
    deductionMethod: 'Standard',
    fedOverride: null,
    ficaOverride: null,
    stateOverride: null,
    year: 2024,
    ...overrides
});

const noInflationAssumptions: AssumptionsState = {
    ...defaultAssumptions,
    macro: {
        ...defaultAssumptions.macro,
        inflationAdjusted: false,
        inflationRate: 0
    }
};

// =============================================================================
// Contribution Limits Tests
// =============================================================================

describe('ContributionLimits', () => {
    describe('getContributionLimits', () => {
        it('should return 2024 limits for 2024', () => {
            const limits = getContributionLimits(2024);
            expect(limits.traditional401k).toBe(23000);
            expect(limits.catchUp401k).toBe(7500);
            expect(limits.traditionalIRA).toBe(7000);
            expect(limits.hsaIndividual).toBe(4150);
            expect(limits.hsaFamily).toBe(8300);
        });

        it('should return 2025 limits for 2025', () => {
            const limits = getContributionLimits(2025);
            expect(limits.traditional401k).toBe(23500);
            expect(limits.hsaIndividual).toBe(4300);
        });

        it('should project limits for future years beyond data', () => {
            const limits2030 = getContributionLimits(2030);
            // 4 years from 2026, expect ~2.5% annual increase
            expect(limits2030.traditional401k).toBeGreaterThan(24000);
            expect(limits2030.traditional401k).toBeLessThan(30000);
        });

        it('should return earliest year for past years', () => {
            const limits2020 = getContributionLimits(2020);
            const limits2024 = getContributionLimits(2024);
            expect(limits2020).toEqual(limits2024); // Falls back to 2024 (earliest)
        });

        it('should NOT project future years when inflationAdjusted is false', () => {
            // 2026 is the latest year in data
            const limits2026 = getContributionLimits(2026);
            const limits2030NoInflation = getContributionLimits(2030, false);

            // When inflationAdjusted=false, 2030 should return same as 2026
            expect(limits2030NoInflation.traditional401k).toBe(limits2026.traditional401k);
            expect(limits2030NoInflation.hsaIndividual).toBe(limits2026.hsaIndividual);
        });

        it('should project future years when inflationAdjusted is true (default)', () => {
            const limits2026 = getContributionLimits(2026);
            const limits2030Inflation = getContributionLimits(2030, true);

            // When inflationAdjusted=true, 2030 should be higher than 2026
            expect(limits2030Inflation.traditional401k).toBeGreaterThan(limits2026.traditional401k);
            expect(limits2030Inflation.hsaIndividual).toBeGreaterThan(limits2026.hsaIndividual);
        });
    });

    describe('get401kLimit', () => {
        it('should return base limit for age under 50', () => {
            const limit = get401kLimit(2024, 45);
            expect(limit).toBe(23000);
        });

        it('should add catch-up for age 50 and above', () => {
            const limit = get401kLimit(2024, 50);
            expect(limit).toBe(23000 + 7500); // 30500
        });

        it('should add catch-up for age 55', () => {
            const limit = get401kLimit(2024, 55);
            expect(limit).toBe(30500);
        });
    });

    describe('getIRALimit', () => {
        it('should return base limit for age under 50', () => {
            const limit = getIRALimit(2024, 45);
            expect(limit).toBe(7000);
        });

        it('should add catch-up for age 50 and above', () => {
            const limit = getIRALimit(2024, 50);
            expect(limit).toBe(7000 + 1000); // 8000
        });
    });

    describe('getHSALimit', () => {
        it('should return individual limit for individual coverage', () => {
            const limit = getHSALimit(2024, 45, 'individual');
            expect(limit).toBe(4150);
        });

        it('should return family limit for family coverage', () => {
            const limit = getHSALimit(2024, 45, 'family');
            expect(limit).toBe(8300);
        });

        it('should add catch-up for age 55 and above (individual)', () => {
            const limit = getHSALimit(2024, 55, 'individual');
            expect(limit).toBe(4150 + 1000); // 5150
        });

        it('should add catch-up for age 55 and above (family)', () => {
            const limit = getHSALimit(2024, 55, 'family');
            expect(limit).toBe(8300 + 1000); // 9300
        });
    });

    describe('calculateContributionTaxSavings', () => {
        it('should calculate tax savings correctly', () => {
            const result = calculateContributionTaxSavings(
                10000, // Current contribution
                23000, // Limit
                0.24   // 24% marginal rate
            );

            expect(result.additionalContribution).toBe(13000);
            expect(result.taxSavings).toBe(13000 * 0.24); // $3,120
        });

        it('should return 0 when already at limit', () => {
            const result = calculateContributionTaxSavings(
                23000, // Current at limit
                23000, // Limit
                0.24
            );

            expect(result.additionalContribution).toBe(0);
            expect(result.taxSavings).toBe(0);
        });

        it('should handle over-contribution gracefully', () => {
            const result = calculateContributionTaxSavings(
                25000, // Over the limit
                23000, // Limit
                0.24
            );

            expect(result.additionalContribution).toBe(0);
            expect(result.taxSavings).toBe(0);
        });
    });
});

// =============================================================================
// Marginal Tax Rate Tests
// =============================================================================

describe('getMarginalTaxRate', () => {
    it('should return 10% bracket for low income', () => {
        const params = getTaxParameters(2024, 'Single', 'federal', undefined, noInflationAssumptions);
        expect(params).toBeDefined();
        if (!params) return;

        // Taxable income of $5,000 should be in 10% bracket
        const result = getMarginalTaxRate(5000, params);
        expect(result.rate).toBe(0.10);
        expect(result.bracketStart).toBe(0);
        expect(result.bracketEnd).toBe(11600); // 2024 Single 10% bracket ends at $11,600
    });

    it('should return 12% bracket for middle income', () => {
        const params = getTaxParameters(2024, 'Single', 'federal', undefined, noInflationAssumptions);
        expect(params).toBeDefined();
        if (!params) return;

        // Taxable income of $20,000 should be in 12% bracket
        const result = getMarginalTaxRate(20000, params);
        expect(result.rate).toBe(0.12);
    });

    it('should calculate headroom correctly', () => {
        const params = getTaxParameters(2024, 'Single', 'federal', undefined, noInflationAssumptions);
        expect(params).toBeDefined();
        if (!params) return;

        // At $10,000 taxable, should have $1,600 until 12% bracket
        const result = getMarginalTaxRate(10000, params);
        expect(result.rate).toBe(0.10);
        expect(result.headroom).toBe(1600); // 11600 - 10000
    });

    it('should return Infinity headroom for top bracket', () => {
        const params = getTaxParameters(2024, 'Single', 'federal', undefined, noInflationAssumptions);
        expect(params).toBeDefined();
        if (!params) return;

        // Very high income should be in top bracket
        const result = getMarginalTaxRate(1000000, params);
        expect(result.rate).toBe(0.37);
        expect(result.headroom).toBe(Infinity);
    });

    it('should handle zero taxable income', () => {
        const params = getTaxParameters(2024, 'Single', 'federal', undefined, noInflationAssumptions);
        expect(params).toBeDefined();
        if (!params) return;

        const result = getMarginalTaxRate(0, params);
        expect(result.rate).toBe(0.10);
        expect(result.bracketStart).toBe(0);
    });
});

describe('getCombinedMarginalRate', () => {
    it('should combine federal, state, and FICA rates', () => {
        const result = getCombinedMarginalRate(
            75000,  // Gross income
            10000,  // Pre-tax deductions
            createTaxState({ stateResidency: 'California' }),
            2024,
            noInflationAssumptions,
            true    // Include FICA
        );

        // Should have federal and FICA components
        expect(result.federal).toBeGreaterThan(0);
        expect(result.fica).toBeGreaterThan(0);
        // State rate may be >= 0 depending on tax data availability
        expect(result.state).toBeGreaterThanOrEqual(0);
        expect(result.combined).toBe(result.federal + result.state + result.fica);
    });

    it('should exclude FICA when requested', () => {
        const withFica = getCombinedMarginalRate(
            75000,
            10000,
            createTaxState(),
            2024,
            noInflationAssumptions,
            true
        );

        const withoutFica = getCombinedMarginalRate(
            75000,
            10000,
            createTaxState(),
            2024,
            noInflationAssumptions,
            false
        );

        expect(withoutFica.fica).toBe(0);
        expect(withFica.combined).toBeGreaterThan(withoutFica.combined);
    });

    it('should return 0 state tax for Texas', () => {
        const result = getCombinedMarginalRate(
            75000,
            10000,
            createTaxState({ stateResidency: 'Texas' }),
            2024,
            noInflationAssumptions,
            true
        );

        expect(result.state).toBe(0);
    });
});

// =============================================================================
// HSA Exemption Tests
// =============================================================================

describe('HSA Tax Treatment', () => {
    it('should include HSA in pre-tax exemptions', async () => {
        const { getPreTaxExemptions } = await import('../../components/Objects/Taxes/TaxService');
        const { WorkIncome } = await import('../../components/Objects/Income/models');

        const income = new WorkIncome(
            'test-1',
            'Test Job',
            5000,       // Monthly gross
            'Monthly',
            'Yes',
            500,        // Pre-tax 401k
            100,        // Insurance
            0,          // Roth 401k
            0,          // Employer match
            '',
            null,
            'FIXED',
            new Date('2024-01-01'),
            new Date('2024-12-31'),
            200         // HSA contribution
        );

        const exemptions = getPreTaxExemptions([income], 2024);

        // Should include 401k (500) + insurance (100) + HSA (200) = 800/month * 12 = 9600/year
        expect(exemptions).toBe((500 + 100 + 200) * 12);
    });

    it('should include HSA in FICA exemptions', async () => {
        const { getFicaExemptions } = await import('../../components/Objects/Taxes/TaxService');
        const { WorkIncome } = await import('../../components/Objects/Income/models');

        const income = new WorkIncome(
            'test-1',
            'Test Job',
            5000,
            'Monthly',
            'Yes',
            500,        // Pre-tax 401k (NOT FICA exempt)
            100,        // Insurance
            0,
            0,
            '',
            null,
            'FIXED',
            new Date('2024-01-01'),
            new Date('2024-12-31'),
            200         // HSA contribution
        );

        const exemptions = getFicaExemptions([income], 2024);

        // FICA exemptions include insurance (100) + HSA (200), but NOT 401k
        // = 300/month * 12 = 3600/year
        expect(exemptions).toBe((100 + 200) * 12);
    });
});
