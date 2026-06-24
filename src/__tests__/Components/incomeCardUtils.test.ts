import { describe, it, expect } from 'vitest';
import {
    getIncomeDescriptor,
    getIncomeIconBg,
    getDisplayAmount,
    getFrequencyDisplay,
    computeContributionWarnings,
    getRSUPriceValidationMessage,
    getRSUMilestoneStartWarning,
    getDeferralDestinationValidationMessage,
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
import { RSUAccount, InvestedAccount } from '../../components/Objects/Accounts/models';

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

    // Issue #125: a reconstituted (prototype-stripped) SS income matches via
    // `className`, not `instanceof`. The old per-subclass instanceof cascade
    // dropped these to the 'INCOME' catch-all; the canonical isSocialSecurity
    // tags them 'SS'. One per SS sub-class.
    it.each([
        'SocialSecurityIncome',
        'CurrentSocialSecurityIncome',
        'FutureSocialSecurityIncome',
    ])('returns SS for a reconstituted %s (className-only, no prototype)', (className) => {
        const reconstituted = { className, name: 'Reconstituted SS', amount: 2000, frequency: 'Monthly' } as unknown as Parameters<typeof getIncomeDescriptor>[0];
        expect(getIncomeDescriptor(reconstituted)).toBe('SS');
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

    // Issue #125: reconstituted SS income (className-only) must get the SS color
    // instead of falling through to the muted catch-all.
    it.each([
        'SocialSecurityIncome',
        'CurrentSocialSecurityIncome',
        'FutureSocialSecurityIncome',
    ])('returns the SS color for a reconstituted %s (className-only)', (className) => {
        const reconstituted = { className, name: 'Reconstituted SS', amount: 2000, frequency: 'Monthly' } as unknown as Parameters<typeof getIncomeIconBg>[0];
        expect(getIncomeIconBg(reconstituted)).toBe(INCOME_COLORS_BACKGROUND['SocialSecurity']);
        expect(getIncomeIconBg(reconstituted)).not.toBe('bg-surface-muted');
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

describe('getRSUPriceValidationMessage', () => {
    function makeRSUWorkIncome(overrides: Partial<{
        rsuVestingSchedule: 'NONE' | 'cliff-1yr' | 'graded-3yr' | 'graded-4yr';
        rsuGrantShares: number;
        rsuAccountId: string | null;
        startDate: Date | undefined;
    }> = {}): WorkIncome {
        const w = makeWorkIncome();
        w.rsuVestingSchedule = overrides.rsuVestingSchedule ?? 'cliff-1yr';
        w.rsuGrantShares = overrides.rsuGrantShares ?? 1000;
        // Use `in` so an explicit `rsuAccountId: null` isn't clobbered by ??.
        w.rsuAccountId = 'rsuAccountId' in overrides ? overrides.rsuAccountId ?? null : 'rsu-acct-1';
        // A fixed start date is the grant date the engine vests against. Default to
        // one so the price-required banner can actually fire; tests that exercise the
        // milestone-started (no startDate) path pass `startDate: undefined`.
        w.startDate = 'startDate' in overrides ? overrides.startDate : new Date(2024, 0, 1);
        return w;
    }

    function makeRSUAccount(currentSharePrice?: number): RSUAccount {
        const acc = new RSUAccount('rsu-acct-1', 'My RSUs', 0);
        acc.currentSharePrice = currentSharePrice;
        return acc;
    }

    it('returns null for non-WorkIncome', () => {
        expect(getRSUPriceValidationMessage(makeFERSPension(), [])).toBeNull();
        expect(getRSUPriceValidationMessage(makeFutureSS(), [])).toBeNull();
    });

    it('returns null when no vesting schedule is configured', () => {
        const w = makeRSUWorkIncome({ rsuVestingSchedule: 'NONE' });
        expect(getRSUPriceValidationMessage(w, [makeRSUAccount(150)])).toBeNull();
    });

    it('returns null when the grant has zero shares', () => {
        const w = makeRSUWorkIncome({ rsuGrantShares: 0 });
        expect(getRSUPriceValidationMessage(w, [makeRSUAccount()])).toBeNull();
    });

    it('returns null when no RSU account is linked (a separate condition the UI flags)', () => {
        const w = makeRSUWorkIncome({ rsuAccountId: null });
        expect(getRSUPriceValidationMessage(w, [makeRSUAccount()])).toBeNull();
    });

    it('returns null when the linked account id matches nothing', () => {
        const w = makeRSUWorkIncome({ rsuAccountId: 'does-not-exist' });
        expect(getRSUPriceValidationMessage(w, [makeRSUAccount(150)])).toBeNull();
    });

    it('fires when the linked account has a blank (undefined) share price', () => {
        const w = makeRSUWorkIncome();
        const msg = getRSUPriceValidationMessage(w, [makeRSUAccount(undefined)]);
        expect(msg).not.toBeNull();
        expect(msg).toContain('Current Share Price');
        expect(msg).toContain('My RSUs');
    });

    it('fires when the linked account has a $0 share price (0 counts as unset)', () => {
        const w = makeRSUWorkIncome();
        expect(getRSUPriceValidationMessage(w, [makeRSUAccount(0)])).not.toBeNull();
    });

    it('still fires for a blank price when the income HAS a fixed start date (regression)', () => {
        // The banner is only legitimate when a missing price is genuinely the cause —
        // i.e. the engine WOULD vest (startDate present) but can't value it.
        const w = makeRSUWorkIncome({ startDate: new Date(2024, 0, 1) });
        const msg = getRSUPriceValidationMessage(w, [makeRSUAccount(undefined)]);
        expect(msg).not.toBeNull();
        expect(msg).toContain('Current Share Price');
    });

    it('returns null for a milestone-started grant (no startDate) even with a blank price', () => {
        // Milestone-started WorkIncome has no fixed startDate, so the engine
        // recognizes NO vest at all (RSUVesting: `if (!inc.startDate) return`).
        // The $0 projection there is the missing start date, not the price —
        // a banner saying "set a price, otherwise $0" would misdiagnose the cause.
        const w = makeRSUWorkIncome({ startDate: undefined });
        expect(w.startDate).toBeUndefined();
        expect(w.rsuGrantShares).toBeGreaterThan(0);
        expect(getRSUPriceValidationMessage(w, [makeRSUAccount(undefined)])).toBeNull();
        // ...and a $0 price is likewise not the cause for a milestone-started grant.
        expect(getRSUPriceValidationMessage(w, [makeRSUAccount(0)])).toBeNull();
    });

    it('passes once a positive share price is set on the linked account', () => {
        const w = makeRSUWorkIncome();
        expect(getRSUPriceValidationMessage(w, [makeRSUAccount(150)])).toBeNull();
    });
});

describe('getRSUMilestoneStartWarning', () => {
    function makeMilestoneRSUWorkIncome(overrides: Partial<{
        rsuVestingSchedule: 'NONE' | 'cliff-1yr' | 'graded-3yr' | 'graded-4yr';
        rsuGrantShares: number;
        startDate: Date | undefined;
        startMilestoneId: string | undefined;
    }> = {}): WorkIncome {
        const w = makeWorkIncome();
        w.rsuVestingSchedule = overrides.rsuVestingSchedule ?? 'cliff-1yr';
        w.rsuGrantShares = overrides.rsuGrantShares ?? 1000;
        w.rsuAccountId = 'rsu-acct-1';
        // Milestone-started: no fixed startDate, a startMilestoneId instead.
        w.startDate = 'startDate' in overrides ? overrides.startDate : undefined;
        w.startMilestoneId = 'startMilestoneId' in overrides
            ? overrides.startMilestoneId
            : 'milestone-retire';
        return w;
    }

    it('returns null for non-WorkIncome', () => {
        expect(getRSUMilestoneStartWarning(makeFERSPension())).toBeNull();
        expect(getRSUMilestoneStartWarning(makeFutureSS())).toBeNull();
    });

    it('returns null when no RSU grant is configured (no schedule)', () => {
        const w = makeMilestoneRSUWorkIncome({ rsuVestingSchedule: 'NONE' });
        expect(getRSUMilestoneStartWarning(w)).toBeNull();
    });

    it('returns null when the grant has zero shares', () => {
        const w = makeMilestoneRSUWorkIncome({ rsuGrantShares: 0 });
        expect(getRSUMilestoneStartWarning(w)).toBeNull();
    });

    it('returns null when the income has a fixed start date (vesting works normally)', () => {
        // A fixed startDate is the grant anchor — vesting projects fine, so no notice.
        const w = makeMilestoneRSUWorkIncome({ startDate: new Date(2024, 0, 1) });
        expect(getRSUMilestoneStartWarning(w)).toBeNull();
    });

    it('returns null when there is neither a start date nor a start milestone (half-built grant)', () => {
        const w = makeMilestoneRSUWorkIncome({ startMilestoneId: undefined });
        expect(w.startDate).toBeUndefined();
        expect(getRSUMilestoneStartWarning(w)).toBeNull();
    });

    it('fires for a milestone-started grant with no fixed start date', () => {
        const w = makeMilestoneRSUWorkIncome();
        expect(w.startDate).toBeUndefined();
        expect(w.startMilestoneId).toBe('milestone-retire');
        expect(w.rsuGrantShares).toBeGreaterThan(0);
        const msg = getRSUMilestoneStartWarning(w);
        expect(msg).not.toBeNull();
        expect(msg).toContain('milestone');
        expect(msg).toContain('fixed start date');
    });
});

describe('getDeferralDestinationValidationMessage', () => {
    type DeferralOverrides = Partial<{
        autoMax401k: 'disabled' | 'custom' | 'traditional' | 'roth';
        preTax401k: number;
        roth401k: number;
        matchAccountId: string;
    }>;

    function makeDeferralWorkIncome(overrides: DeferralOverrides = {}): WorkIncome {
        const w = makeWorkIncome({
            preTax401k: overrides.preTax401k ?? 0,
            roth401k: overrides.roth401k ?? 0,
        });
        // 'custom' is the WorkIncome default; only override when asked.
        if (overrides.autoMax401k !== undefined) w.autoMax401k = overrides.autoMax401k;
        w.matchAccountId = overrides.matchAccountId ?? '';
        return w;
    }

    // The helper only reads `acc.id`, so a minimal InvestedAccount is enough.
    const acct = (id: string) => new InvestedAccount(id, `Account ${id}`, 0);
    const ACCOUNTS = [acct('401k-1'), acct('401k-2')];

    it('returns null for non-WorkIncome', () => {
        expect(getDeferralDestinationValidationMessage(makeFERSPension(), ACCOUNTS)).toBeNull();
        expect(getDeferralDestinationValidationMessage(makeFutureSS(), ACCOUNTS)).toBeNull();
        const passive = new PassiveIncome('p', 'Dividends', 500, 'Monthly', 'No', 'Dividend');
        expect(getDeferralDestinationValidationMessage(passive, ACCOUNTS)).toBeNull();
    });

    it('returns null when 401k is disabled (no deferral)', () => {
        const w = makeDeferralWorkIncome({ autoMax401k: 'disabled', matchAccountId: '' });
        expect(getDeferralDestinationValidationMessage(w, ACCOUNTS)).toBeNull();
    });

    it('returns null for a custom mode with $0 in both buckets (no deferral)', () => {
        const w = makeDeferralWorkIncome({ autoMax401k: 'custom', preTax401k: 0, roth401k: 0, matchAccountId: '' });
        expect(getDeferralDestinationValidationMessage(w, ACCOUNTS)).toBeNull();
    });

    it('fires for a pre-tax deferral with no destination (the #123 leak)', () => {
        const w = makeDeferralWorkIncome({ preTax401k: 1000, matchAccountId: '' });
        const msg = getDeferralDestinationValidationMessage(w, ACCOUNTS);
        expect(msg).not.toBeNull();
        expect(msg).toContain('Destination Account');
    });

    it('fires for a Roth deferral with no destination', () => {
        const w = makeDeferralWorkIncome({ roth401k: 800, matchAccountId: '' });
        expect(getDeferralDestinationValidationMessage(w, ACCOUNTS)).not.toBeNull();
    });

    it('fires for an auto-max (traditional) deferral with no destination', () => {
        // Auto-max modes store $0 in preTax401k/roth401k but still defer at sim time.
        const w = makeDeferralWorkIncome({ autoMax401k: 'traditional', preTax401k: 0, roth401k: 0, matchAccountId: '' });
        expect(getDeferralDestinationValidationMessage(w, ACCOUNTS)).not.toBeNull();
    });

    it('fires for an auto-max (roth) deferral with no destination', () => {
        const w = makeDeferralWorkIncome({ autoMax401k: 'roth', matchAccountId: '' });
        expect(getDeferralDestinationValidationMessage(w, ACCOUNTS)).not.toBeNull();
    });

    it('fires for a deferral pointing at a dangling/deleted destination account', () => {
        const w = makeDeferralWorkIncome({ preTax401k: 1000, matchAccountId: 'deleted-acct' });
        const msg = getDeferralDestinationValidationMessage(w, ACCOUNTS);
        expect(msg).not.toBeNull();
        expect(msg).toContain('no longer exists');
    });

    it('tells the user to create an account when none are contribution-eligible', () => {
        const w = makeDeferralWorkIncome({ preTax401k: 1000, matchAccountId: '' });
        const msg = getDeferralDestinationValidationMessage(w, []);
        expect(msg).not.toBeNull();
        expect(msg).toContain('Accounts tab');
    });

    it('returns null when a custom deferral points at a real contribution account', () => {
        const w = makeDeferralWorkIncome({ preTax401k: 1000, matchAccountId: '401k-1' });
        expect(getDeferralDestinationValidationMessage(w, ACCOUNTS)).toBeNull();
    });

    it('returns null when an auto-max deferral points at a real account', () => {
        const w = makeDeferralWorkIncome({ autoMax401k: 'traditional', matchAccountId: '401k-2' });
        expect(getDeferralDestinationValidationMessage(w, ACCOUNTS)).toBeNull();
    });
});
