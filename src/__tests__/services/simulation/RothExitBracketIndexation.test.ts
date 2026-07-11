/**
 * #157 — the post-horizon Traditional exit drawdown indexes its tax brackets.
 *
 * `bracketAwareTradExitValue` used to price the 45-year post-horizon drawdown with
 * brackets FROZEN at the terminal year's nominal thresholds while the residual (and,
 * since #10, the persisting SS/fixed income) compounds at nominal rates. Real
 * federal/state brackets and standard deductions are inflation-indexed, so the frozen
 * evaluation manufactured bracket creep the real world doesn't have — overstating the
 * exit tax on long drawdowns (an over-conversion bias, opposite sign to the fp-review
 * F2 state-tax gap). The fix indexes the brackets/std-deduction per drawdown year at
 * the household inflation rate (`bracketIndexRate`), keeping the SS provisional-income
 * thresholds statutorily FROZEN in nominal terms.
 *
 * WHY IN-LOOP INDEXATION and not the "evaluate in real terms" (g_real, cola=0) swap
 * the issue proposed: the bracket tax is positively homogeneous, so real-terms
 * evaluation is exactly equivalent to indexed brackets — EXCEPT that the SS
 * provisional-income thresholds ($25k/$32k…) are frozen by statute. A real-terms
 * evaluation implicitly indexes them too, over-valuing SS-heavy small residuals
 * (measured +1.2% at $250k/Single/$40k SS, +2.1% at $80k SS; ≤ +0.35% at $1M). The
 * in-loop version matches the explicitly year-indexed TRUTH drawdown to the cent.
 */
import { describe, it, expect } from 'vitest';
import {
    bracketAwareTradExitValue,
    planConversionsViaDP,
    type DPYearContext,
} from '../../../services/simulation/RothConversionDP';
import * as TaxService from '../../../components/Objects/Taxes/TaxService';
import { getDistributionPeriod } from '../../../data/RMDData';
import { type TaxParameters, type FilingStatus } from '../../../data/TaxData';
import { defaultAssumptions } from '../../../components/Objects/Assumptions/AssumptionsContext';
import { makeDPContext } from './dpFixtures';

// ---------------------------------------------------------------------------
// TRUTH harness: an explicitly year-indexed drawdown, implemented independently
// of the production loop. Nominal balance compounds at nominal g; SS/fixed income
// grow at i; year t prices taxes with brackets/std-deduction inflated by (1+i)^t
// (Math.pow, not the production loop's running product); the SS provisional
// thresholds stay nominal-frozen (they're constants inside TaxService); PV is
// discounted at nominal g back to horizon-year dollars.
// ---------------------------------------------------------------------------

const inflateParams = (p: TaxParameters, factor: number): TaxParameters => ({
    ...p,
    standardDeduction: p.standardDeduction * factor,
    brackets: p.brackets.map(b => ({ threshold: b.threshold * factor, rate: b.rate })),
});

function truthExitValue(
    B: number,
    terminalAge: number,
    gNom: number,
    i: number,
    fedParams: TaxParameters,
    filing: FilingStatus,
    ssBenefit: number,
    fixedIncome: number,
    stateParams: TaxParameters | null,
): number {
    if (B < 1) return 0;
    let bal = B, pv = 0, age = terminalAge, t = 0;
    let grossW = 0, totalTax = 0;
    let ss = ssBenefit, fixed = fixedIncome;
    while (bal > 100 && t < 45) {
        const div = Math.max(2, getDistributionPeriod(Math.min(age, 115)));
        const w = Math.min(bal, bal / div);
        const idxFactor = Math.pow(1 + i, t);
        const fedT = inflateParams(fedParams, idxFactor);
        const stT = stateParams ? inflateParams(stateParams, idxFactor) : null;
        const stateTaxOn = (ordinary: number): number => {
            if (!stT) return 0;
            let base = ordinary;
            if (ss > 0 && stT.socialSecurityTreatment === 'taxable') {
                base += TaxService.getTaxableSocialSecurityBenefits(ss, ordinary, 0, filing);
            }
            return TaxService.calculateTax(base, 0, stT);
        };
        const baseTax = TaxService.calculateTotalFederalTax(fixed, ss, 0, 0, 0, filing, fedT).totalTax
            + stateTaxOn(fixed);
        const taxWith = TaxService.calculateTotalFederalTax(fixed + w, ss, 0, 0, 0, filing, fedT).totalTax
            + stateTaxOn(fixed + w);
        const tax = Math.max(0, taxWith - baseTax);
        pv += (w - tax) / Math.pow(1 + gNom, t);
        grossW += w; totalTax += tax;
        bal = (bal - w) * (1 + gNom);
        ss *= (1 + i); fixed *= (1 + i);
        age++; t++;
    }
    if (bal > 100) {
        const tailRate = grossW > 0 ? Math.min(0.5, totalTax / grossW) : 0;
        pv += (bal * (1 - tailRate)) / Math.pow(1 + gNom, t);
    }
    return pv;
}

// Shared fixture params: terminal year 2065 nominal thresholds at 2.5% household
// inflation (the same future-year calibration the production ruler resolves).
const assumptions = {
    ...defaultAssumptions,
    macro: { ...defaultAssumptions.macro, inflationAdjusted: true, inflationRate: 2.5 },
};
const YEAR = 2065;
const AGE = 93;
const INFLATION = 0.025;
const G_NOMINAL = 0.095; // 7% real + 2.5% inflation, the nominal-engine convention

const fedFor = (filing: FilingStatus) =>
    TaxService.getTaxParameters(YEAR, filing, 'federal', undefined, assumptions)!;
const dcFor = (filing: FilingStatus) =>
    TaxService.getTaxParameters(YEAR, filing, 'state', 'DC', assumptions) ?? null;

describe('bracketAwareTradExitValue — in-loop bracket indexation (#157)', () => {
    it('matches the explicitly year-indexed TRUTH drawdown to the cent across filings, states, SS levels, and balances', () => {
        for (const filing of ['Married Filing Jointly', 'Single'] as FilingStatus[]) {
            const fed = fedFor(filing);
            for (const st of [null, dcFor(filing)]) {
                for (const ss of [0, 40_000, 80_000]) {
                    for (const B of [250_000, 1_000_000, 3_000_000]) {
                        const prod = bracketAwareTradExitValue(
                            B, AGE, G_NOMINAL, fed, filing, 'self-liquidate',
                            ss, 10_000, INFLATION, st, INFLATION,
                        );
                        const truth = truthExitValue(
                            B, AGE, G_NOMINAL, INFLATION, fed, filing, ss, 10_000, st,
                        );
                        // Identical math modulo pow-vs-running-product FP noise.
                        expect(Math.abs(prod - truth)).toBeLessThan(0.05);
                    }
                }
            }
        }
    });

    it('bracketIndexRate=0 (or omitted) is byte-identical to the legacy frozen-bracket evaluation', () => {
        const fed = fedFor('Married Filing Jointly');
        const st = dcFor('Married Filing Jointly');
        const legacy = bracketAwareTradExitValue(
            1_500_000, AGE, G_NOMINAL, fed, 'Married Filing Jointly', 'self-liquidate',
            40_000, 10_000, INFLATION, st,
        );
        const explicitZero = bracketAwareTradExitValue(
            1_500_000, AGE, G_NOMINAL, fed, 'Married Filing Jointly', 'self-liquidate',
            40_000, 10_000, INFLATION, st, 0,
        );
        expect(explicitZero).toBe(legacy);
    });

    it('at 2.5% inflation the exit of a large residual is CHEAPER (higher value) under indexed brackets than frozen ones', () => {
        const fed = fedFor('Married Filing Jointly');
        const st = dcFor('Married Filing Jointly');
        const frozen = bracketAwareTradExitValue(
            1_500_000, AGE, G_NOMINAL, fed, 'Married Filing Jointly', 'self-liquidate',
            40_000, 10_000, INFLATION, st, 0,
        );
        const indexed = bracketAwareTradExitValue(
            1_500_000, AGE, G_NOMINAL, fed, 'Married Filing Jointly', 'self-liquidate',
            40_000, 10_000, INFLATION, st, INFLATION,
        );
        // Measured ~1.5-2.5% of a $1.5M residual — a five-figure correction, not noise.
        expect(indexed).toBeGreaterThan(frozen + 10_000);
    });

    it('documents why the pure real-terms (g_real, cola=0) swap was NOT shipped: frozen SS thresholds break the homogeneity, over-valuing SS-heavy small residuals by >0.5%', () => {
        const filing: FilingStatus = 'Single';
        const fed = fedFor(filing);
        const gReal = (1 + G_NOMINAL) / (1 + INFLATION) - 1;
        // $250k residual, $80k SS: the torpedo zone dominates the drawdown.
        const swap = bracketAwareTradExitValue(
            250_000, AGE, gReal, fed, filing, 'self-liquidate', 80_000, 10_000, 0, null,
        );
        const truth = truthExitValue(250_000, AGE, G_NOMINAL, INFLATION, fed, filing, 80_000, 10_000, null);
        // The swap implicitly indexes the statutorily-frozen SS provisional thresholds,
        // muting the torpedo in late drawdown years → it OVER-values the residual.
        expect(swap).toBeGreaterThan(truth * 1.005);
        // …while the shipped in-loop indexation stays on the truth (asserted to the cent
        // in the grid test above).
    });

    it('zero inflation: indexation is a no-op (g_real == g when i == 0)', () => {
        const fed = TaxService.getTaxParameters(2030, 'Married Filing Jointly', 'federal')!;
        const frozen = bracketAwareTradExitValue(
            1_000_000, AGE, 0.05, fed, 'Married Filing Jointly', 'self-liquidate', 30_000, 0, 0, null, 0,
        );
        const truth = truthExitValue(1_000_000, AGE, 0.05, 0, fed, 'Married Filing Jointly', 30_000, 0, null);
        expect(frozen).toBeCloseTo(truth, 6);
    });
});

describe('DP optimizer under the indexed terminal (#157)', { timeout: 60_000 }, () => {
    // MFJ retiree horizon, nominal engine convention (7% real + 2.5% inflation), SS from
    // 67, RMDs from 73 — a plan shape where the terminal residual is large enough for the
    // exit valuation to steer conversions.
    function buildContexts(): DPYearContext[] {
        const fed = TaxService.getTaxParameters(2024, 'Married Filing Jointly', 'federal')!;
        const ctxs: DPYearContext[] = [];
        for (let i = 0; i < 28; i++) {
            const age = 65 + i;
            const rmdDivisor = age >= 73 ? Math.max(8.0, 26.5 - (age - 73) * 0.9) : 0;
            ctxs.push(makeDPContext(2030 + i, age, {
                filingStatus: 'Married Filing Jointly',
                fedParams: fed,
                nonSSOrdinaryIncomeExclRMD: 20_000,
                ssBenefits: age >= 67 ? 40_000 : 0,
                growthRate: G_NOMINAL,
                rothGrowthRate: G_NOMINAL,
                rmdDivisor,
            }));
        }
        return ctxs;
    }

    it('chosen total conversions weakly DECREASE when the terminal drawdown stops manufacturing bracket creep', () => {
        const contexts = buildContexts();
        const inputs = { contexts, currentTradBalance: 1_500_000, currentRothBalance: 100_000 };
        const baseOpts = {
            objectiveMode: 'max-wealth' as const,
            terminalValuation: 'bracket-aware' as const,
            userSituation: 'self-liquidate' as const,
            terminalCola: INFLATION,
        };
        // Legacy frozen-bracket terminal (explicit override, retained for this A/B).
        const frozenPlan = planConversionsViaDP(inputs, { ...baseOpts, terminalBracketIndexation: 0 });
        // Production default: indexation follows terminalCola.
        const indexedPlan = planConversionsViaDP(inputs, baseOpts);

        const total = (m: Map<number, number>) => [...m.values()].reduce((s, v) => s + v, 0);
        const totalFrozen = total(frozenPlan.conversionsByYear);
        const totalIndexed = total(indexedPlan.conversionsByYear);

        // Cheaper real exit ⇒ residual Traditional is worth more ⇒ converting is less
        // urgent ⇒ optimal conversions weakly decrease at positive inflation.
        expect(totalIndexed).toBeLessThanOrEqual(totalFrozen);
    });

    it('at zero terminalCola the default indexation is 0 — plans are unchanged by the new option plumbing', () => {
        const contexts = buildContexts();
        const inputs = { contexts, currentTradBalance: 1_000_000, currentRothBalance: 50_000 };
        const opts = {
            objectiveMode: 'max-wealth' as const,
            terminalValuation: 'bracket-aware' as const,
            userSituation: 'self-liquidate' as const,
            terminalCola: 0,
        };
        const implicit = planConversionsViaDP(inputs, opts);
        const explicit = planConversionsViaDP(inputs, { ...opts, terminalBracketIndexation: 0 });
        expect([...implicit.conversionsByYear.entries()]).toEqual([...explicit.conversionsByYear.entries()]);
    });
});
