/**
 * Tests for IncomeClassifier date filtering fix.
 * Verifies that incomes outside their active date range return $0.
 */
import { describe, it, expect } from 'vitest';
import { classifyIncome, getTotalSSBenefits } from '../../services/simulation/IncomeClassifier';
import {
    WorkIncome,
    BaseIncome,
    AnyIncome,
    SocialSecurityIncome,
    CurrentSocialSecurityIncome,
    FutureSocialSecurityIncome,
} from '../../components/Objects/Income/models';

/**
 * Build a "reconstituted" SS income: a plain data object carrying only the
 * `className` tag (no concrete-subclass prototype) so `instanceof` is FALSE but
 * the canonical isSocialSecurity matches via className. BaseIncome.prototype is
 * attached only so getAnnualAmount() runs — modelling a sim year rehydrated from
 * cache / marshalled across a worker, where the concrete prototype is lost.
 */
function reconstitutedSS(className: string, amount: number): AnyIncome {
    const obj = { className, id: `recon-${className}`, name: 'Reconstituted SS', amount, frequency: 'Annually', earned_income: 'No' };
    Object.setPrototypeOf(obj, BaseIncome.prototype);
    return obj as unknown as AnyIncome;
}

/**
 * A METHOD-LESS className-only SS object (raw literal, no prototype) — the
 * createMockSimulationYear / worker-literal shape. isSocialSecurity matches it by
 * className, so getTotalSSBenefits selects it; the guard must keep it from throwing
 * on the missing getAnnualAmount and contribute 0.
 */
function methodlessSS(className: string, amount: number): AnyIncome {
    return { className, id: `bare-${className}`, name: 'Bare SS', amount, frequency: 'Annually', earned_income: 'No' } as unknown as AnyIncome;
}

describe('IncomeClassifier date filtering', () => {
    it('should return $0 for income that ended before simulation year', () => {
        // Income ended in 2030, simulation year is 2035
        const endedIncome = new WorkIncome(
            'test-1', 'Ended Job', 100000, 'Annually', 'Yes',
            0, 0, 0, 0, '', null, 'FIXED',
            new Date(2020, 0, 1),  // start
            new Date(2030, 11, 31) // end
        );

        const result = classifyIncome([endedIncome], 0, 0, 2035);
        
        expect(result.classified.spendable).toBe(0);
        expect(result.classified.breakdown.wages).toBe(0);
    });

    it('should return $0 for income that starts after simulation year', () => {
        // Income starts in 2040, simulation year is 2035
        const futureIncome = new WorkIncome(
            'test-2', 'Future Job', 100000, 'Annually', 'Yes',
            0, 0, 0, 0, '', null, 'FIXED',
            new Date(2040, 0, 1),  // start (future)
            undefined              // no end
        );

        const result = classifyIncome([futureIncome], 0, 0, 2035);
        
        expect(result.classified.spendable).toBe(0);
        expect(result.classified.breakdown.wages).toBe(0);
    });

    it('should return full amount for active income', () => {
        // Income active from 2020-2040, simulation year is 2035
        const activeIncome = new WorkIncome(
            'test-3', 'Active Job', 100000, 'Annually', 'Yes',
            0, 0, 0, 0, '', null, 'FIXED',
            new Date(2020, 0, 1),  // start (past)
            new Date(2040, 11, 31) // end (future)
        );

        const result = classifyIncome([activeIncome], 0, 0, 2035);
        
        expect(result.classified.spendable).toBe(100000);
        expect(result.classified.breakdown.wages).toBe(100000);
    });

    it('should prorate income that starts mid-year', () => {
        // Income starts July 1, 2035
        const midYearIncome = new WorkIncome(
            'test-4', 'Mid-Year Job', 100000, 'Annually', 'Yes',
            0, 0, 0, 0, '', null, 'FIXED',
            new Date(2035, 6, 1),  // start mid-year (month index 6)
            undefined              // no end
        );

        const result = classifyIncome([midYearIncome], 0, 0, 2035);

        // July (index 6) through December (index 11) = 6 months = 6/12 = 50%
        expect(result.classified.spendable).toBeCloseTo(50000, 0);
    });
});

// Issue #125: classifyIncome / getTotalSSBenefits previously filtered SS by
// instanceof of the three concrete classes only, so a reconstituted
// (prototype-stripped) SS income — instanceof=false, className tag intact —
// fell through to the "default: treat as spendable passive" branch. Spendable
// total was unaffected (SS is spendable too), but it landed in breakdown.passive
// instead of breakdown.socialSecurity, and getTotalSSBenefits returned $0,
// which feeds SS provisional-income taxability. Converging on the canonical
// className-aware isSocialSecurity fixes the bucketing for cached/worker years.
describe('IncomeClassifier reconstituted SS (issue #125)', () => {
    const YEAR = 2035;

    it.each([
        'SocialSecurityIncome',
        'CurrentSocialSecurityIncome',
        'FutureSocialSecurityIncome',
    ])('buckets a reconstituted %s as socialSecurity, not passive', (className) => {
        const recon = reconstitutedSS(className, 30000);
        // Guard: not a concrete-class instance (old instanceof filter would miss it).
        expect(recon instanceof SocialSecurityIncome).toBe(false);
        expect(recon instanceof CurrentSocialSecurityIncome).toBe(false);
        expect(recon instanceof FutureSocialSecurityIncome).toBe(false);

        const result = classifyIncome([recon], 0, 0, YEAR);
        expect(result.classified.breakdown.socialSecurity).toBe(30000);
        expect(result.classified.breakdown.passive).toBe(0);
        // SS is spendable either way; the regression was the breakdown bucket.
        expect(result.classified.spendable).toBe(30000);
    });

    it('getTotalSSBenefits counts a reconstituted SS income (was $0 before)', () => {
        const recon = reconstitutedSS('CurrentSocialSecurityIncome', 24000);
        expect(getTotalSSBenefits([recon], YEAR)).toBe(24000);
    });

    // Issue #125 follow-up: the className-aware predicate also matches a method-less
    // className-only SS object (mock-fixture / worker literal). getTotalSSBenefits's
    // getAnnualAmount call is guarded (`?.() ?? 0`), so it must not throw and the
    // bare object contributes 0 while real instances still sum.
    it('getTotalSSBenefits does not throw on a method-less SS object and contributes 0', () => {
        const bare = methodlessSS('CurrentSocialSecurityIncome', 24000);
        expect((bare as { getAnnualAmount?: unknown }).getAnnualAmount).toBeUndefined();
        expect(() => getTotalSSBenefits([bare], YEAR)).not.toThrow();
        expect(getTotalSSBenefits([bare], YEAR)).toBe(0);
        const real = reconstitutedSS('SocialSecurityIncome', 30000);
        expect(getTotalSSBenefits([bare, real], YEAR)).toBe(30000);
    });
});
