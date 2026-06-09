import { describe, it, expect } from 'vitest';
import { getSocialSecurityBenefits } from '../../../../components/Objects/Taxes/taxService/incomeAggregation';
import {
  SocialSecurityIncome,
  CurrentSocialSecurityIncome,
  FutureSocialSecurityIncome,
} from '../../../../components/Objects/Income/models';

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
});
