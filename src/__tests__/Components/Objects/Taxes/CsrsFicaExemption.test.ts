/**
 * #139 Part B: a WorkIncome flagged CSRS pays NO Social Security FICA (CSRS
 * employees are outside Social Security) but still pays Medicare. NONE and FERS
 * jobs pay both. With no CSRS job the FICA is byte-identical to before.
 *
 * Wages are kept at $50k (well under the SS wage base) so the Social Security
 * portion is exactly wage × rate, uncapped, making the assertions exact.
 */
import { describe, it, expect } from 'vitest';
import { calculateFicaTax } from '../../../../components/Objects/Taxes/taxService/ficaTax';
import { getCombinedMarginalRate } from '../../../../components/Objects/Taxes/taxService/marginalRates';
import { getTaxParameters } from '../../../../components/Objects/Taxes/taxService/parameters';
import { WorkIncome } from '../../../../components/Objects/Income/models';
import { TaxState } from '../../../../components/Objects/Taxes/TaxContext';
import { defaultAssumptions } from '../../../../components/Objects/Assumptions/AssumptionsContext';

const YEAR = 2025;
const start = new Date(2025, 0, 1);
const end = new Date(2025, 11, 31);

const state: TaxState = {
    filingStatus: 'Single',
    stateResidency: 'Texas',
    deductionMethod: 'Standard',
    fedOverride: null,
    ficaOverride: null,
    stateOverride: null,
    year: YEAR,
};

function job(pensionSystem: 'NONE' | 'FERS' | 'CSRS', id = 'w1'): WorkIncome {
    const w = new WorkIncome(
        id, 'Job', 50000, 'Annually', 'Yes',
        0, 0, 0, 0, '', null, 'FIXED', start, end,
    );
    w.pensionSystem = pensionSystem;
    return w;
}

describe('CSRS Social Security FICA exemption (#139 Part B)', () => {
    const params = getTaxParameters(YEAR, 'Single', 'federal')!;
    const ssOn50k = Math.min(50000, params.socialSecurityWageBase) * params.socialSecurityTaxRate;

    it('a CSRS-flagged job pays Medicare but NOT Social Security', () => {
        const ficaNone = calculateFicaTax(state, [job('NONE')], YEAR);
        const ficaCsrs = calculateFicaTax(state, [job('CSRS')], YEAR);

        expect(ficaCsrs).toBeLessThan(ficaNone);
        // The entire difference is the Social Security portion the CSRS job skips.
        expect(ficaNone - ficaCsrs).toBeCloseTo(ssOn50k, 2);
        expect(ficaCsrs).toBeCloseTo(ficaNone - ssOn50k, 2);
        expect(ssOn50k).toBeGreaterThan(0); // guard: the test would be vacuous at 0
    });

    it('FERS is SS-covered — identical FICA to a non-pension job', () => {
        expect(calculateFicaTax(state, [job('FERS')], YEAR))
            .toBeCloseTo(calculateFicaTax(state, [job('NONE')], YEAR), 6);
    });

    it('only the CSRS job is exempted; a sibling NONE job still pays full SS', () => {
        const ficaMixed = calculateFicaTax(state, [job('NONE', 'w1'), job('CSRS', 'w2')], YEAR);
        const ficaBothNone = calculateFicaTax(state, [job('NONE', 'w1'), job('NONE', 'w2')], YEAR);
        // The two lists differ only by the second job's pension system, so the FICA
        // gap is exactly that one job's skipped Social Security.
        expect(ficaBothNone - ficaMixed).toBeCloseTo(ssOn50k, 2);
    });
});

describe('CSRS marginal FICA rate (#139)', () => {
    const params = getTaxParameters(YEAR, 'Single', 'federal')!;
    const GROSS = 50000; // under both the SS wage base and the Additional Medicare threshold

    // getCombinedMarginalRate(gross, preTaxDed, taxState, year, assumptions,
    //   includesFICA, earnedIncome, ssCoveredEarnedIncome) -> { fica, ... }
    function ficaMarginal(ssCoveredEarned: number): number {
        return getCombinedMarginalRate(
            GROSS, 0, state, YEAR, defaultAssumptions, true, GROSS, ssCoveredEarned,
        ).fica;
    }

    it('drops the 6.2% SS component for a CSRS earner (ssCovered = 0), keeping Medicare', () => {
        const csrs = ficaMarginal(0);          // CSRS-only: no SS-covered wages
        const nonCsrs = ficaMarginal(GROSS);   // fully SS-covered wages under the cap
        expect(nonCsrs - csrs).toBeCloseTo(params.socialSecurityTaxRate, 6); // exactly the 6.2pp
        expect(csrs).toBeCloseTo(params.medicareTaxRate, 6);                 // Medicare only
        expect(params.socialSecurityTaxRate).toBeGreaterThan(0);            // guard: not vacuous
    });

    it('defaults to the SS-inclusive rate when ssCovered is omitted (non-CSRS unchanged)', () => {
        const explicit = ficaMarginal(GROSS);
        const defaulted = getCombinedMarginalRate(GROSS, 0, state, YEAR, defaultAssumptions, true, GROSS).fica;
        expect(defaulted).toBeCloseTo(explicit, 6);
    });
});
