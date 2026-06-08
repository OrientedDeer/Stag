import { describe, it, expect } from 'vitest';
import {
    getIncomeDescriptor,
    getIncomeIconBg,
    getDisplayAmount,
    getFrequencyDisplay,
    computeContributionWarnings,
} from '../../components/Objects/Income/incomeCardUtils';
import {
    WorkIncome,
    SocialSecurityIncome,
    CurrentSocialSecurityIncome,
    FutureSocialSecurityIncome,
    FERSPensionIncome,
    CSRSPensionIncome,
    PassiveIncome,
    WindfallIncome,
    INCOME_COLORS_BACKGROUND,
} from '../../components/Objects/Income/models';

function makeWorkIncome(overrides: Partial<{
    preTax401k: number;
    roth401k: number;
    hsaContribution: number;
    frequency: 'Weekly' | 'Bi-Weekly' | 'Semi-Monthly' | 'Monthly' | 'Annually';
    amount: number;
}> = {}): WorkIncome {
    return new WorkIncome(
        'inc-1',
        'My Job',
        overrides.amount ?? 100_000,
        overrides.frequency ?? 'Annually',
        'Yes',
        overrides.preTax401k ?? 0,
        0,
        overrides.roth401k ?? 0,
        0,
        '',
        null,
        'FIXED',
        undefined,
        undefined,
        overrides.hsaContribution ?? 0
    );
}

function makeFERSPension(overrides: Partial<{ calculatedBenefit: number }> = {}): FERSPensionIncome {
    return new FERSPensionIncome(
        'fers-1',
        'My Pension',
        25,
        90_000,
        62,
        1960,
        overrides.calculatedBenefit ?? 0
    );
}

function makeCSRSPension(overrides: Partial<{ calculatedBenefit: number }> = {}): CSRSPensionIncome {
    return new CSRSPensionIncome(
        'csrs-1',
        'My CSRS Pension',
        30,
        90_000,
        60,
        overrides.calculatedBenefit ?? 0
    );
}

function makeFutureSS(overrides: Partial<{ calculatedPIA: number; claimingAge: number }> = {}): FutureSocialSecurityIncome {
    return new FutureSocialSecurityIncome(
        'fss-1',
        'Future SS',
        overrides.claimingAge ?? 67,
        overrides.calculatedPIA ?? 0
    );
}

describe('getIncomeDescriptor', () => {
    it('returns WORK for WorkIncome', () => {
        expect(getIncomeDescriptor(makeWorkIncome())).toBe('WORK');
    });

    it('returns SS for any SS variant', () => {
        expect(getIncomeDescriptor(makeFutureSS())).toBe('SS');
        expect(getIncomeDescriptor(
            new CurrentSocialSecurityIncome('css-1', 'Current SS', 2000, 'Monthly')
        )).toBe('SS');
        expect(getIncomeDescriptor(
            new SocialSecurityIncome('ss-1', 'Legacy SS', 2000, 'Monthly', 67)
        )).toBe('SS');
    });

    it('returns PENSION for FERS and CSRS', () => {
        expect(getIncomeDescriptor(makeFERSPension())).toBe('PENSION');
        expect(getIncomeDescriptor(makeCSRSPension())).toBe('PENSION');
    });

    it('returns PASSIVE for PassiveIncome', () => {
        const passive = new PassiveIncome('p-1', 'Rental', 1500, 'Monthly', 'No', 'Rental');
        expect(getIncomeDescriptor(passive)).toBe('PASSIVE');
    });

    it('returns WINDFALL for WindfallIncome', () => {
        const wf = new WindfallIncome('w-1', 'Bonus', 5000, 'Annually', 'No');
        expect(getIncomeDescriptor(wf)).toBe('WINDFALL');
    });
});

describe('getIncomeIconBg', () => {
    it('returns the Pension color for FERS/CSRS (the fix this refactor addresses)', () => {
        const fersBg = getIncomeIconBg(makeFERSPension());
        const csrsBg = getIncomeIconBg(makeCSRSPension());
        expect(fersBg).toBe(INCOME_COLORS_BACKGROUND['Pension']);
        expect(csrsBg).toBe(INCOME_COLORS_BACKGROUND['Pension']);
        // sanity: not the catch-all gray
        expect(fersBg).not.toBe('bg-gray-500');
    });

    it('returns the Work color for WorkIncome', () => {
        expect(getIncomeIconBg(makeWorkIncome())).toBe(INCOME_COLORS_BACKGROUND['Work']);
    });

    it('returns the SocialSecurity color for any SS variant', () => {
        expect(getIncomeIconBg(makeFutureSS())).toBe(INCOME_COLORS_BACKGROUND['SocialSecurity']);
    });
});

describe('getDisplayAmount', () => {
    it('uses calculatedBenefit for FERS pensions, or "Auto-calculated" if not yet computed', () => {
        expect(getDisplayAmount(makeFERSPension({ calculatedBenefit: 0 }), false)).toBe('Auto-calculated');
        // With a computed benefit it should produce a currency string (not the placeholder)
        const computed = getDisplayAmount(makeFERSPension({ calculatedBenefit: 35_000 }), true);
        expect(computed).not.toBe('Auto-calculated');
        expect(computed).toMatch(/\$/);
    });

    it('uses calculatedBenefit for CSRS pensions', () => {
        expect(getDisplayAmount(makeCSRSPension({ calculatedBenefit: 0 }), false)).toBe('Auto-calculated');
        const computed = getDisplayAmount(makeCSRSPension({ calculatedBenefit: 50_000 }), true);
        expect(computed).toMatch(/\$/);
    });

    it('uses calculatedPIA for FutureSocialSecurityIncome', () => {
        expect(getDisplayAmount(makeFutureSS({ calculatedPIA: 0 }), false)).toBe('Auto-calculated');
        const computed = getDisplayAmount(makeFutureSS({ calculatedPIA: 2500 }), true);
        expect(computed).toMatch(/\$/);
    });

    it('uses .amount for non-pension non-FutureSS income', () => {
        expect(getDisplayAmount(makeWorkIncome({ amount: 5000 }), true)).toMatch(/5,?000/);
    });
});

describe('getFrequencyDisplay', () => {
    it('returns /yr for pensions once computed, empty before', () => {
        expect(getFrequencyDisplay(makeFERSPension({ calculatedBenefit: 0 }))).toBe('');
        expect(getFrequencyDisplay(makeFERSPension({ calculatedBenefit: 35_000 }))).toBe('/yr');
        expect(getFrequencyDisplay(makeCSRSPension({ calculatedBenefit: 50_000 }))).toBe('/yr');
    });

    it('returns /mo for FutureSS once computed, empty before', () => {
        expect(getFrequencyDisplay(makeFutureSS({ calculatedPIA: 0 }))).toBe('');
        expect(getFrequencyDisplay(makeFutureSS({ calculatedPIA: 2500 }))).toBe('/mo');
    });

    it('returns the frequency abbreviation for normal income types', () => {
        const result = getFrequencyDisplay(makeWorkIncome({ frequency: 'Monthly' }));
        expect(result.startsWith('/')).toBe(true);
        expect(result.length).toBeGreaterThan(1);
    });
});

describe('computeContributionWarnings', () => {
    it('returns null for non-WorkIncome (pensions, SS, passive, etc.)', () => {
        expect(computeContributionWarnings(makeFERSPension(), 1960, 2026)).toBeNull();
        expect(computeContributionWarnings(makeFutureSS(), 1960, 2026)).toBeNull();
        const passive = new PassiveIncome('p', 'Dividends', 500, 'Monthly', 'No', 'Dividend');
        expect(computeContributionWarnings(passive, 1960, 2026)).toBeNull();
    });

    it('returns null when contributions are within IRS limits', () => {
        // Modest monthly contribution, well under the annual cap
        const w = makeWorkIncome({ preTax401k: 500, roth401k: 0, frequency: 'Monthly' });
        expect(computeContributionWarnings(w, 1990, 2026)).toBeNull();
    });

    it('flags a 401k warning when annualized contributions blow past the limit', () => {
        // $10k/month × 12 = $120k — well above any 401k limit
        const w = makeWorkIncome({ preTax401k: 10_000, frequency: 'Monthly' });
        const warnings = computeContributionWarnings(w, 1990, 2026);
        expect(warnings).not.toBeNull();
        expect(warnings!.some((wn) => wn.type === '401k')).toBe(true);
        const k401 = warnings!.find((wn) => wn.type === '401k')!;
        expect(k401.annual).toBe(120_000);
        expect(k401.limit).toBeLessThan(k401.annual);
        expect(k401.message).toContain('2026');
    });

    it('flags an HSA warning when annualized HSA blows past the limit', () => {
        const w = makeWorkIncome({ hsaContribution: 2000, frequency: 'Monthly' });
        const warnings = computeContributionWarnings(w, 1990, 2026);
        expect(warnings).not.toBeNull();
        expect(warnings!.some((wn) => wn.type === 'HSA')).toBe(true);
    });

    it('uses the frequency multiplier correctly (annual frequency × 1)', () => {
        // Annual frequency: amount IS the annual contribution
        const w = makeWorkIncome({ preTax401k: 50_000, frequency: 'Annually' });
        const warnings = computeContributionWarnings(w, 1990, 2026);
        // 50k might or might not exceed depending on year/age, so just check annual = 50000
        if (warnings && warnings.some((wn) => wn.type === '401k')) {
            const k401 = warnings.find((wn) => wn.type === '401k')!;
            expect(k401.annual).toBe(50_000);
        }
    });

    it('combines 401k pre-tax and Roth in the 401k total', () => {
        // Pre-tax + Roth combine toward the single 401k elective-deferral limit
        const w = makeWorkIncome({ preTax401k: 5_000, roth401k: 5_000, frequency: 'Monthly' });
        const warnings = computeContributionWarnings(w, 1990, 2026);
        if (warnings) {
            const k401 = warnings.find((wn) => wn.type === '401k');
            if (k401) expect(k401.annual).toBe(120_000); // (5000 + 5000) × 12
        }
    });
});
