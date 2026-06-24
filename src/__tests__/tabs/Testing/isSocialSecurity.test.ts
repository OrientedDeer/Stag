import { describe, it, expect } from 'vitest';
import { isSocialSecurity } from '../../../tabs/Testing/Testing';
import {
    SocialSecurityIncome,
    CurrentSocialSecurityIncome,
    FutureSocialSecurityIncome,
    WorkIncome,
    PassiveIncome,
    FERSPensionIncome,
    reconstituteIncome,
} from '../../../components/Objects/Income/models';

// Regression coverage for the Testing-tab SS filters. The three Social Security
// income classes (SocialSecurityIncome, CurrentSocialSecurityIncome,
// FutureSocialSecurityIncome) are SIBLINGS — each extends BaseIncome directly —
// so a single `instanceof SocialSecurityIncome` does NOT catch the two variants,
// and the prior `Future || Current` filters dropped the base class. The base
// class is not creatable in the current UI but can arrive via legacy
// localStorage / imported backup, so the diagnostic filters must catch all three.
describe('isSocialSecurity', () => {
    it('matches the base SocialSecurityIncome instance (the previously-dropped class)', () => {
        const base = new SocialSecurityIncome('ss-base', 'Legacy SS', 30000, 'Annually', 67);
        expect(isSocialSecurity(base)).toBe(true);
    });

    it('matches CurrentSocialSecurityIncome instances', () => {
        const current = new CurrentSocialSecurityIncome('ss-cur', 'Current SS', 24000, 'Annually');
        expect(isSocialSecurity(current)).toBe(true);
    });

    it('matches FutureSocialSecurityIncome instances', () => {
        const future = new FutureSocialSecurityIncome('ss-fut', 'Future SS', 67, 2000, 0);
        expect(isSocialSecurity(future)).toBe(true);
    });

    it('does not match non-Social-Security income (Work, Passive, Pension)', () => {
        const work = new WorkIncome('w', 'Job', 100000, 'Annually', 'Yes', 0, 0, 0, 0, '');
        const passive = new PassiveIncome('p', 'Dividends', 5000, 'Annually', 'No', 'Dividend');
        const pension = new FERSPensionIncome('fers', 'FERS', 30, 100000, 62, 1970);
        expect(isSocialSecurity(work)).toBe(false);
        expect(isSocialSecurity(passive)).toBe(false);
        expect(isSocialSecurity(pension)).toBe(false);
    });

    it('matches via className for serialized objects whose prototype is not restored', () => {
        // A plain object (e.g. straight from JSON) carrying only the className tag.
        expect(isSocialSecurity({ className: 'SocialSecurityIncome' })).toBe(true);
        expect(isSocialSecurity({ className: 'CurrentSocialSecurityIncome' })).toBe(true);
        expect(isSocialSecurity({ className: 'FutureSocialSecurityIncome' })).toBe(true);
    });

    it('does not match unrelated className tags or untagged objects', () => {
        expect(isSocialSecurity({ className: 'WorkIncome' })).toBe(false);
        expect(isSocialSecurity({ className: 'FERSPensionIncome' })).toBe(false);
        expect(isSocialSecurity({})).toBe(false);
    });

    it('matches a base SocialSecurityIncome round-tripped through reconstituteIncome (legacy backup path)', () => {
        const serialized = {
            className: 'SocialSecurityIncome',
            id: 'ss-base',
            name: 'Legacy SS',
            amount: 30000,
            frequency: 'Annually',
            claimingAge: 67,
            startDate: '2030-01-01',
        };
        const restored = reconstituteIncome(serialized);
        expect(restored).not.toBeNull();
        expect(restored).toBeInstanceOf(SocialSecurityIncome);
        expect(isSocialSecurity(restored!)).toBe(true);
    });
});
