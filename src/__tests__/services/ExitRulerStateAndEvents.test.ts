/**
 * Exit-ruler regression tests for fp-review F2 + F3a (2026-07-02).
 *
 * F2: the post-horizon Traditional exit drawdown must price STATE tax (the
 * conversion-cost side always did), so a residual in a taxed state (DC/CA) is
 * worth LESS than the identical residual in TX. Before the fix the ruler was
 * federal-only and the two were equal — over-valuing residual Traditional and
 * biasing the optimizer toward under-conversion in taxed states.
 *
 * F3a: the ruler must honor SCHEDULED tax life events. A user-scheduled
 * MFJ→Single (widowhood) event before the horizon is priced by the engine, the
 * DP contexts, and the DP's own terminal — the production ruler
 * (buildTradValuation) and getProjectedRMDMarginalRate used the raw year-0
 * taxState and ignored it.
 *
 * Timelines come from the REAL engine (runSimulation on the harness fixture) —
 * no hand-fabricated SimulationYear shapes.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { runSimulation } from '../../components/Objects/Assumptions/useSimulation';
import { buildTradValuation } from '../../tabs/Future/tabs/FutureUtils';
import { getProjectedRMDMarginalRate } from '../../services/TaxOptimizationService';
import { bracketAwareTradExitValue } from '../../services/simulation/RothConversionDP';
import { type TaxState, type TaxLifeEvent } from '../../components/Objects/Taxes/TaxContext';
import { getBirthYear } from '../../components/Objects/Assumptions/AssumptionsContext';
import * as TaxService from '../../components/Objects/Taxes/TaxService';
import { type SimulationYear } from '../../services/simulation/types';
import { type Scenario, makeSSHeavyScenario, realYears } from '../roth-cookbook/harness';

// One shared engine run: the $1.5M-Traditional MFJ fixture (TX, ~$0 SS), zero
// conversions. Every ruler comparison below re-prices the SAME timeline under a
// different taxState, isolating the ruler's own state/event handling.
let sc: Scenario;
let timeline: SimulationYear[];
let lastRealYear: number;

beforeAll(() => {
    sc = makeSSHeavyScenario();
    timeline = runSimulation(
        sc.yearsToRun, sc.accounts, sc.incomes, sc.expenses,
        sc.assumptions, sc.taxState, undefined, { dpConversionPlan: new Map() },
    );
    const reals = realYears(timeline);
    lastRealYear = reals[reals.length - 1].year;
});

const RESIDUAL = 1_500_000;

const widowEvent = (year: number): TaxLifeEvent =>
    ({ id: 'ev-widow', kind: 'filingStatus', value: 'Single', year });

describe('F2 — taxed-state residual Traditional is worth less than the same residual in TX', () => {
    it('DC and CA rulers dock the exit value below the no-tax-state ruler', () => {
        const rulerTX = buildTradValuation(timeline, sc.assumptions, sc.taxState);
        const rulerDC = buildTradValuation(timeline, sc.assumptions, { ...sc.taxState, stateResidency: 'DC' });
        const rulerCA = buildTradValuation(timeline, sc.assumptions, { ...sc.taxState, stateResidency: 'California' });

        const vTX = rulerTX.tradDeferredTax!(RESIDUAL);
        const vDC = rulerDC.tradDeferredTax!(RESIDUAL);
        const vCA = rulerCA.tradDeferredTax!(RESIDUAL);

        // The state marginal on a $1.5M drawdown is a five-figure haircut, not noise.
        expect(vDC).toBeLessThan(vTX - 10_000);
        expect(vCA).toBeLessThan(vTX - 10_000);
    });

    it('bracketAwareTradExitValue: omitting stateParams preserves the legacy fed-only value; passing them lowers it', () => {
        const year = lastRealYear;
        const fedParams = TaxService.getTaxParameters(year, 'Married Filing Jointly', 'federal', undefined, sc.assumptions)!;
        const dcParams = TaxService.getTaxParameters(year, 'Married Filing Jointly', 'state', 'DC', sc.assumptions)!;

        const fedOnly = bracketAwareTradExitValue(
            RESIDUAL, 93, 0.05, fedParams, 'Married Filing Jointly', 'self-liquidate', 30_000, 0, 0,
        );
        const fedOnlyExplicitNull = bracketAwareTradExitValue(
            RESIDUAL, 93, 0.05, fedParams, 'Married Filing Jointly', 'self-liquidate', 30_000, 0, 0, null,
        );
        const withDC = bracketAwareTradExitValue(
            RESIDUAL, 93, 0.05, fedParams, 'Married Filing Jointly', 'self-liquidate', 30_000, 0, 0, dcParams,
        );

        expect(fedOnlyExplicitNull).toBe(fedOnly); // default param = legacy behavior
        expect(withDC).toBeLessThan(fedOnly - 10_000);
    });

    it('bequeath valuation is a flat heir rate — state params do not apply', () => {
        const fedParams = TaxService.getTaxParameters(lastRealYear, 'Married Filing Jointly', 'federal', undefined, sc.assumptions)!;
        const dcParams = TaxService.getTaxParameters(lastRealYear, 'Married Filing Jointly', 'state', 'DC', sc.assumptions)!;
        const noState = bracketAwareTradExitValue(RESIDUAL, 93, 0.05, fedParams, 'Married Filing Jointly', 'bequeath');
        const withState = bracketAwareTradExitValue(
            RESIDUAL, 93, 0.05, fedParams, 'Married Filing Jointly', 'bequeath', 0, 0, 0, dcParams,
        );
        expect(withState).toBe(noState);
    });
});

describe('F3a — the exit ruler honors scheduled tax life events', () => {
    it('a scheduled MFJ→Single event before the horizon lowers the exit value of a large residual', () => {
        const rulerMFJ = buildTradValuation(timeline, sc.assumptions, sc.taxState);
        const taxStateWithEvent: TaxState = { ...sc.taxState, taxEvents: [widowEvent(lastRealYear - 3)] };
        const rulerWidowed = buildTradValuation(timeline, sc.assumptions, taxStateWithEvent);

        // Single brackets/std-deduction are ~half of MFJ, so the same residual's
        // post-horizon drawdown bears materially more tax → lower exit value.
        expect(rulerWidowed.tradDeferredTax!(RESIDUAL)).toBeLessThan(rulerMFJ.tradDeferredTax!(RESIDUAL) - 10_000);
    });

    it('an event scheduled AFTER the horizon does not move the ruler', () => {
        const rulerMFJ = buildTradValuation(timeline, sc.assumptions, sc.taxState);
        const taxStateLateEvent: TaxState = { ...sc.taxState, taxEvents: [widowEvent(lastRealYear + 5)] };
        const rulerLate = buildTradValuation(timeline, sc.assumptions, taxStateLateEvent);
        expect(rulerLate.tradDeferredTax!(RESIDUAL)).toBe(rulerMFJ.tradDeferredTax!(RESIDUAL));
    });

    it('getProjectedRMDMarginalRate reflects a scheduled filing-status event in the RMD era', () => {
        const birthYear = getBirthYear(sc.assumptions.milestones);
        const preRMDYear = birthYear + 74; // fixture RMDs start at 75
        const base = getProjectedRMDMarginalRate(timeline, sc.assumptions, sc.taxState)!;
        const widowed = getProjectedRMDMarginalRate(
            timeline, sc.assumptions, { ...sc.taxState, taxEvents: [widowEvent(preRMDYear)] },
        )!;
        // Same AGI on Single brackets lands in a higher marginal bracket than MFJ.
        expect(widowed).toBeGreaterThan(base);
    });

    it('getProjectedRMDMarginalRate reflects a scheduled state move (TX → DC adds the state marginal)', () => {
        const birthYear = getBirthYear(sc.assumptions.milestones);
        const preRMDYear = birthYear + 74;
        const moveEvent: TaxLifeEvent = { id: 'ev-move', kind: 'stateResidency', value: 'DC', year: preRMDYear };
        const base = getProjectedRMDMarginalRate(timeline, sc.assumptions, sc.taxState)!;
        const moved = getProjectedRMDMarginalRate(
            timeline, sc.assumptions, { ...sc.taxState, taxEvents: [moveEvent] },
        )!;
        expect(moved).toBeGreaterThan(base);
    });
});
