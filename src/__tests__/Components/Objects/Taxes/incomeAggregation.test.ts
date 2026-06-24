import { describe, it, expect } from 'vitest';
import { getSocialSecurityBenefits } from '../../../../components/Objects/Taxes/taxService/incomeAggregation';
import {
  BaseIncome,
  AnyIncome,
  SocialSecurityIncome,
  CurrentSocialSecurityIncome,
  FutureSocialSecurityIncome,
} from '../../../../components/Objects/Income/models';

/**
 * Build a "reconstituted" SS income: a plain data object carrying only the
 * `className` discriminator (no concrete-subclass prototype), so
 * `instanceof SocialSecurityIncome/Current/Future` is FALSE but the
 * canonical isSocialSecurity matches via className. The BaseIncome prototype is
 * attached only so the aggregation's getProratedAnnual()/getPeriodsPerYear()
 * still run — this mirrors a sim year rehydrated from cache or marshalled across
 * a worker, where the concrete prototype is lost but the className tag survives.
 */
function reconstitutedSS(className: string, amount: number, frequency = 'Annually'): AnyIncome {
  const obj = { className, id: `recon-${className}`, name: 'Reconstituted SS', amount, frequency, earned_income: 'No' };
  Object.setPrototypeOf(obj, BaseIncome.prototype);
  return obj as unknown as AnyIncome;
}

/**
 * A METHOD-LESS className-only SS object: a raw plain literal (no prototype, no
 * getProratedAnnual/getAnnualAmount) — exactly what createMockSimulationYear
 * fixtures and some worker round-trips produce. isSocialSecurity matches it via
 * className, so the converged filter selects it; the body must NOT throw on the
 * missing method and must contribute 0 (mirrors the sibling pension extraction).
 */
function methodlessSS(className: string, amount: number): AnyIncome {
  return { className, id: `bare-${className}`, name: 'Bare SS', amount, frequency: 'Annually', earned_income: 'No' } as unknown as AnyIncome;
}

describe('getSocialSecurityBenefits', () => {
  const YEAR = 2030;

  // Regression: PR #52 finding #2.
  // The three SS income types are SIBLINGS (all extend BaseIncome). getSocialSecurityBenefits
  // originally filtered only Current/Future, silently omitting the base SocialSecurityIncome
  // class. Because federalTax.ts computes `nonSSGross = grossIncome - getSocialSecurityBenefits`,
  // a dropped SS benefit stays in ordinary income and is taxed at 100% instead of the IRS
  // <=85% rule (and likewise for state tax and the Roth conversion DP). The tax oracle never
  // caught it because it only ever constructs Current/Future SS, never the base class.
  it('counts a base SocialSecurityIncome as a Social Security benefit', () => {
    const ss = new SocialSecurityIncome('ss-base', 'Social Security', 30000, 'Annually', 67);
    expect(getSocialSecurityBenefits([ss], YEAR)).toBe(30000);
  });

  it('counts all three SS income classes together', () => {
    const base = new SocialSecurityIncome('ss-base', 'SS (base)', 30000, 'Annually', 67);
    const current = new CurrentSocialSecurityIncome('ss-cur', 'SS (current)', 24000, 'Annually');
    // FutureSocialSecurityIncome amount = calculatedPIA * 12 = 3000 * 12 = 36000
    const future = new FutureSocialSecurityIncome('ss-fut', 'SS (future)', 67, 3000);

    expect(getSocialSecurityBenefits([base, current, future], YEAR)).toBe(90000);
  });

  it('ignores non-SS income', () => {
    const ss = new SocialSecurityIncome('ss-base', 'SS', 30000, 'Annually', 67);
    // A second base SS plus one that should be excluded by being absent entirely:
    expect(getSocialSecurityBenefits([ss], YEAR)).toBe(30000);
    expect(getSocialSecurityBenefits([], YEAR)).toBe(0);
  });

  // Issue #125: before converging on the canonical className-aware isSocialSecurity,
  // this site filtered by instanceof of the three concrete SS classes only, so a
  // reconstituted (prototype-stripped) SS benefit was dropped — leaving it in
  // nonSSGross and taxed at 100% instead of the IRS <=85% rule. One per SS sub-class.
  it.each([
    'SocialSecurityIncome',
    'CurrentSocialSecurityIncome',
    'FutureSocialSecurityIncome',
  ])('counts a reconstituted %s (className-only, instanceof=false) as a benefit', (className) => {
    const recon = reconstitutedSS(className, 30000);
    // Guard: the fixture really is NOT a concrete-class instance (so the old
    // instanceof filter would have missed it).
    expect(recon instanceof SocialSecurityIncome).toBe(false);
    expect(recon instanceof CurrentSocialSecurityIncome).toBe(false);
    expect(recon instanceof FutureSocialSecurityIncome).toBe(false);
    expect(getSocialSecurityBenefits([recon], YEAR)).toBe(30000);
  });

  // Issue #125 follow-up: the className-aware predicate now ALSO matches a
  // METHOD-LESS className-only SS object (createMockSimulationYear / worker
  // literal). The body must not crash on the missing getProratedAnnual and must
  // contribute 0 (matching the sibling pension extraction's `?.() ?? 0`). The old
  // instanceof filter silently excluded these; ours selects them, so the guard
  // is what prevents extractBaselineProjections from throwing (BugCAndDBracketSpace).
  it.each([
    'SocialSecurityIncome',
    'CurrentSocialSecurityIncome',
    'FutureSocialSecurityIncome',
  ])('does not throw on a method-less %s and contributes 0', (className) => {
    const bare = methodlessSS(className, 30000);
    expect((bare as { getProratedAnnual?: unknown }).getProratedAnnual).toBeUndefined();
    expect(() => getSocialSecurityBenefits([bare], YEAR)).not.toThrow();
    expect(getSocialSecurityBenefits([bare], YEAR)).toBe(0);
    // A method-bearing SS alongside a method-less one still sums correctly.
    const real = new SocialSecurityIncome('ss-real', 'Real SS', 24000, 'Annually', 67);
    expect(getSocialSecurityBenefits([bare, real], YEAR)).toBe(24000);
  });
});
