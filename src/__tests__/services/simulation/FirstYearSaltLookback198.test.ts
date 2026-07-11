/**
 * #198 stage-2 SALT lookback — FIRST projected year regression.
 *
 * The stage-2 SALT lookback prices a projected year's SALT itemized deduction
 * from the PRIOR row's realized state tax. For the FIRST projected year (year 1)
 * of a mid-year run, the prior row is the SYNTHETIC end-of-year-projection row
 * that useSimulation pushes after yearZero when `remainingFraction > 0 &&
 * !priorYearMode`. That EOY row's `taxDetails.state` is PRORATED by
 * remainingFraction (e.g. opening the app in September ⇒ state = yearZero.state
 * × 3/12), NOT year-0's full-year realized state tax.
 *
 * The bug: the lookback grabbed `previousSimulation[length - 1]` unconditionally,
 * so year 1's SALT was priced from ~1/4 of the real annual state tax — dropping
 * the itemized total (and possibly flipping Auto back to standard), overstating
 * year-1 federal tax, and propagating the error into the DP context and every
 * later year's balances.
 *
 * The fix selects the last NON-EOY-projection prior row (year 0 for year 1),
 * so SALT is priced from the full-year realized state tax.
 *
 * The sibling stage-2 test (ItemizedDeductionProjection198.test.ts) deliberately
 * SKIPS index 0 for exactly this reason; this file pins index 0.
 *
 * Determinism: `vi.setSystemTime` fixes "now" to mid-September so
 * remainingFraction = (11 - 8)/12 = 0.25 and the EOY row is a clean 1/4 proration.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import * as TaxService from '../../../components/Objects/Taxes/TaxService';
import { getItemizedDeductions } from '../../../components/Objects/Taxes/taxService/deductions';
import { runSimulation } from '../../../components/Objects/Assumptions/useSimulation';
import {
    type AssumptionsState,
    defaultAssumptions,
    createBuiltinMilestones,
} from '../../../components/Objects/Assumptions/AssumptionsContext';
import { type TaxState } from '../../../components/Objects/Taxes/TaxContext';
import { InvestedAccount, PropertyAccount } from '../../../components/Objects/Accounts/models';
import { WorkIncome } from '../../../components/Objects/Income/models';
import { MortgageExpense, FoodExpense } from '../../../components/Objects/Expense/models';
import { type SimulationYear } from '../../../services/simulation/types';

// Mid-September of the current year ⇒ currentMonth = 8 ⇒ remainingFraction = 0.25.
const NOW = new Date(new Date().getFullYear(), 8, 15, 12, 0, 0);
const START_YEAR = NOW.getFullYear();
const BIRTH_YEAR = START_YEAR - 45; // working-age (no senior add-ons to confound)
const EXPECTED_REMAINING_FRACTION = (11 - 8) / 12; // 0.25

beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
});
afterEach(() => {
    vi.useRealTimers();
});

function baseTaxState(method: 'Itemized' | 'Auto' | 'Standard', stateResidency: string): TaxState {
    return {
        filingStatus: 'Single',
        stateResidency,
        deductionMethod: method,
        fedOverride: null,
        ficaOverride: null,
        stateOverride: null,
        year: START_YEAR,
    };
}

const baseAssumptions: AssumptionsState = {
    ...defaultAssumptions,
    demographics: {},
    milestones: createBuiltinMilestones(BIRTH_YEAR, 65, 90),
    income: { ...defaultAssumptions.income, salaryGrowth: 0 },
    macro: {
        ...defaultAssumptions.macro,
        inflationRate: 0,
        inflationAdjusted: false,
        taxBracketShiftPct: 0,
        taxBracketShiftStartYear: 0,
    },
    investments: { ...defaultAssumptions.investments, returnRates: { ror: 5 }, autoRothConversions: false },
    withdrawalStrategy: [],
};

function freshAccounts() {
    return [
        new PropertyAccount('acc-property', 'Home', 400_000, 'Financed', 300_000, 300_000, 'exp-mortgage'),
        new InvestedAccount('acc-savings', 'Savings', 50_000, 0, 10, 0.05, 'Brokerage', true, 1.0, 50_000),
    ];
}
function freshMortgage() {
    // $300k @ 6% / 30yr ⇒ ~$17,900 first-year interest.
    return new MortgageExpense(
        'exp-mortgage', 'Mortgage', 'Monthly', 400_000, 300_000, 300_000, 6.0, 30,
        1.5, 0, 1.0, 200, 0.5, 0.5, 200, 'Itemized', 0, 'acc-property',
        new Date(START_YEAR, 0, 1), 0, 0,
    );
}
function freshLiving() {
    return new FoodExpense('exp-living', 'Living', 20_000, 'Annually', new Date(START_YEAR, 0, 1));
}

/** The rows that ran through the projection engine (year 0 + the synthetic EOY
 *  row are built in useSimulation and carry no itemizedDeductionTotal). */
function projectedRows(sim: SimulationYear[]): SimulationYear[] {
    return sim.filter(r => r.itemizedDeductionTotal !== undefined);
}

describe("#198 stage 2 — FIRST projected year prices SALT off year-0's FULL-year state tax", () => {
    it('does NOT price year-1 SALT from the prorated synthetic EOY row', () => {
        // DC has an income tax; flat salary keeps year-0 and year-1 state tax equal so
        // the ONLY thing that could make year-1 SALT differ is which prior row it reads.
        const sim = runSimulation(
            6,
            freshAccounts(),
            [new WorkIncome('inc-work', 'Job', 120_000, 'Annually', 'Yes', 0, 0, 0, 0, '', null, 'FIXED')],
            [freshMortgage(), freshLiving()],
            baseAssumptions,
            baseTaxState('Auto', 'DC'),
        );

        // --- Verify the producer emitted the exact shape the bug depends on ---
        // sim[0] = yearZero (full-year), sim[1] = synthetic EOY row (prorated), sim[2] = year 1.
        const yearZero = sim[0];
        const eoyRow = sim[1];
        expect(eoyRow.isEndOfYearProjection).toBe(true);
        expect(yearZero.isEndOfYearProjection).toBeFalsy();
        // The EOY row's state tax is prorated to a quarter of the full-year figure.
        expect(yearZero.taxDetails.state).toBeGreaterThan(800); // DC tax on $120k, well below SALT cap
        expect(eoyRow.taxDetails.state).toBeCloseTo(
            yearZero.taxDetails.state * EXPECTED_REMAINING_FRACTION, 1,
        );

        const projected = projectedRows(sim);
        expect(projected.length).toBeGreaterThan(3);

        const firstProjected = projected[0];
        const idx = sim.indexOf(firstProjected);
        expect(firstProjected.year).toBe(START_YEAR + 1); // year 1
        // Entering-balance mortgage interest (the non-SALT part of the itemized total).
        const mortgageInterest = getItemizedDeductions(sim[idx - 1].expenses, firstProjected.year);
        const saltComponent = firstProjected.itemizedDeductionTotal! - mortgageInterest;

        const cap = TaxService.getSALTCap(firstProjected.year, 'Single');
        const correctSalt = Math.min(yearZero.taxDetails.state, cap); // full-year year-0 state tax
        const buggySalt = Math.min(eoyRow.taxDetails.state, cap); // prorated EOY-row state tax

        // Full vs. quarter of the year-0 state tax — a several-hundred-dollar gap, so
        // the assertion has teeth (buggy ≈ 0.25 × correct).
        expect(correctSalt - buggySalt).toBeGreaterThan(400);

        // THE FIX: year-1 SALT is priced from the full-year year-0 realized state tax.
        expect(saltComponent).toBeCloseTo(correctSalt, 1);
        // And explicitly NOT from the prorated synthetic EOY row.
        expect(Math.abs(saltComponent - buggySalt)).toBeGreaterThan(400);
    });

    it("Auto keeps year 1 itemizing when the full-year SALT + mortgage interest beats the standard deduction", () => {
        // With the prorated (buggy) SALT the year-1 itemized total is understated; here
        // we pin that year 1 bills the SAME (cheaper) federal tax as an explicit Itemized
        // run — i.e. the understatement did not spuriously flip Auto toward standard.
        const auto = runSimulation(
            6, freshAccounts(),
            [new WorkIncome('inc-work', 'Job', 120_000, 'Annually', 'Yes', 0, 0, 0, 0, '', null, 'FIXED')],
            [freshMortgage(), freshLiving()], baseAssumptions, baseTaxState('Auto', 'DC'),
        );
        const itemized = runSimulation(
            6, freshAccounts(),
            [new WorkIncome('inc-work', 'Job', 120_000, 'Annually', 'Yes', 0, 0, 0, 0, '', null, 'FIXED')],
            [freshMortgage(), freshLiving()], baseAssumptions, baseTaxState('Itemized', 'DC'),
        );

        const autoFirst = projectedRows(auto)[0];
        const itmFirst = projectedRows(itemized)[0];
        // Mortgage interest (~$17.9k) alone already clears the standard deduction, so
        // Auto must match the Itemized path in year 1.
        expect(autoFirst.taxDetails.fed).toBeCloseTo(itmFirst.taxDetails.fed, 0);
        // And the Auto year-1 itemized total should include the FULL-year SALT.
        const idx = auto.indexOf(autoFirst);
        const mortgageInterest = getItemizedDeductions(auto[idx - 1].expenses, autoFirst.year);
        const saltComponent = autoFirst.itemizedDeductionTotal! - mortgageInterest;
        const cap = TaxService.getSALTCap(autoFirst.year, 'Single');
        expect(saltComponent).toBeCloseTo(Math.min(auto[0].taxDetails.state, cap), 1);
    });
});
