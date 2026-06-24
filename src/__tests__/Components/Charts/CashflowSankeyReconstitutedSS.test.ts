import { describe, it, expect } from 'vitest';
import { buildCashflowDetail } from '../../../services/simulation/CashflowDetailBuilder';
import {
    BaseIncome,
    AnyIncome,
    SocialSecurityIncome,
    CurrentSocialSecurityIncome,
    FutureSocialSecurityIncome,
} from '../../../components/Objects/Income/models';

/**
 * Issue #125 — CashflowDetailBuilder converges on the canonical, className-aware
 * isSocialSecurity instead of an inline 3-class `instanceof` cascade.
 *
 * The Sankey's per-source income breakdown is built from `simYear.incomes`. A sim
 * year rehydrated from cache or marshalled across the Monte-Carlo / SDP worker
 * boundary loses its concrete-subclass prototypes — the income survives as a plain
 * data object carrying only the `className` tag. With the old instanceof-only
 * cascade those SS incomes failed every SS branch and fell through to the final
 * `else`, getting tagged `kind: 'passive'` — so the chart drew Social Security as a
 * generic passive flow. Matching via className tags them `kind: 'ss'` like a live
 * instance, so the cached/worker view matches the Testing tab.
 */
describe('CashflowDetailBuilder — reconstituted SS classification (issue #125)', () => {
    const YEAR = 2035;

    /**
     * A "reconstituted" SS income: plain data + `className` tag, with
     * BaseIncome.prototype attached only so getProratedAnnual()/getPeriodsPerYear()
     * run. `instanceof` of the concrete SS classes is FALSE — exactly the
     * prototype-stripped object that arrives from a worker/cache round-trip.
     */
    function reconstitutedSS(className: string, amount: number): AnyIncome {
        const obj = {
            className,
            id: `recon-${className}`,
            name: 'Reconstituted SS',
            amount,
            frequency: 'Annually',
            earned_income: 'No',
        };
        Object.setPrototypeOf(obj, BaseIncome.prototype);
        return obj as unknown as AnyIncome;
    }

    it.each([
        'SocialSecurityIncome',
        'CurrentSocialSecurityIncome',
        'FutureSocialSecurityIncome',
    ])('tags a reconstituted %s as kind "ss" (not passive)', (className) => {
        const recon = reconstitutedSS(className, 30000);
        // Guard: not a concrete-class instance, so the old instanceof cascade
        // would have dropped it to the passive catch-all.
        expect(recon instanceof SocialSecurityIncome).toBe(false);
        expect(recon instanceof CurrentSocialSecurityIncome).toBe(false);
        expect(recon instanceof FutureSocialSecurityIncome).toBe(false);

        const detail = buildCashflowDetail({
            incomes: [recon],
            expenses: [],
            accounts: [],
            insurance: 0,
            year: YEAR,
            brokerageLTCGFromGross: 0,
        });

        const ssSources = detail.incomeBySource.filter((s) => s.kind === 'ss');
        const passiveSources = detail.incomeBySource.filter((s) => s.kind === 'passive');

        expect(ssSources).toHaveLength(1);
        expect(ssSources[0].amount).toBe(30000);
        expect(passiveSources).toHaveLength(0);
    });
});
