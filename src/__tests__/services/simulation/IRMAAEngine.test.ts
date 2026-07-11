/**
 * Engine integration tests for Medicare IRMAA: verifies that the YearSolver
 *   - reads year N-2's MAGI (2-year lookback) from previousSimulation,
 *   - only bills it at Medicare age (65+),
 *   - folds the surcharge into tax.total (so it reduces cash / net worth),
 *   - surfaces it on tax.irmaa and exposes the year's MAGI.
 */

import { describe, it, expect } from 'vitest';
import { solveRetirementYear, type YearSolverInput } from '../../../services/simulation/YearSolver';
import { coarseToFineSearch } from '../../../services/simulation/TaxOptimizedWithdrawal';
import { type IRMAAConversionOptions } from '../../../services/simulation/helpers';
import { InvestedAccount, SavedAccount } from '../../../components/Objects/Accounts/models';
import { OtherExpense } from '../../../components/Objects/Expense/models';
import { type AssumptionsState, defaultAssumptions, createBuiltinMilestones } from '../../../components/Objects/Assumptions/AssumptionsContext';
import { type TaxState } from '../../../components/Objects/Taxes/TaxContext';
import * as TaxService from '../../../components/Objects/Taxes/TaxService';
import { getIRMAAAnnualSurcharge, getNextIRMAAThreshold } from '../../../data/IRMAAData';

const YEAR = 2026;

function makeAccounts() {
    const traditional = new InvestedAccount(
        'trad-1', 'Traditional IRA', 800_000, 0, 15, 0.05, 'Traditional IRA',
    );
    const brokerage = new InvestedAccount(
        'brokerage-1', 'Brokerage', 300_000, 0, 10, 0.06, 'Brokerage', true, 0.2, 200_000,
    );
    const savings = new SavedAccount('savings-1', 'Savings', 50_000, 2.0);
    return [brokerage, traditional, savings];
}

function makeAssumptions(birthYear: number): AssumptionsState {
    return {
        ...defaultAssumptions,
        milestones: createBuiltinMilestones(birthYear, 62, 95),
        investments: {
            ...defaultAssumptions.investments,
            // Turn conversions OFF so the test isolates the IRMAA deduction from
            // any conversion-sizing interaction.
            taxOptimizationEnabled: false,
            returnRates: { ror: 6 },
        },
        withdrawalStrategy: [
            { id: 'ws-1', name: 'Brokerage', accountId: 'brokerage-1' },
            { id: 'ws-2', name: 'Traditional', accountId: 'trad-1' },
            { id: 'ws-3', name: 'Savings', accountId: 'savings-1' },
        ],
    };
}

function makeTaxState(filingStatus: TaxState['filingStatus']): TaxState {
    return {
        filingStatus,
        stateResidency: 'Texas',
        deductionMethod: 'Standard',
        fedOverride: null,
        ficaOverride: null,
        stateOverride: null,
        year: YEAR,
    };
}

function baseInput(currentAge: number, filingStatus: TaxState['filingStatus']): YearSolverInput {
    const birthYear = YEAR - currentAge;
    return {
        year: YEAR,
        currentAge,
        isRetired: true,
        incomes: [],
        expenses: [new OtherExpense('living-1', 'Living', 50_000, 'Annually', new Date('2020-01-01'))],
        totalLivingExpenses: 50_000,
        rmdAmount: 0,
        accounts: makeAccounts(),
        withdrawalOrder: [
            { accountId: 'brokerage-1' },
            { accountId: 'trad-1' },
            { accountId: 'savings-1' },
        ],
        taxState: makeTaxState(filingStatus),
        assumptions: makeAssumptions(birthYear),
        taxOptimizationEnabled: false,
        acaAware: false,
    };
}

describe('IRMAA in the YearSolver (2-year lookback)', () => {
    it('bills a Medicare retiree from year N-2 MAGI and folds it into tax.total', () => {
        const input = baseInput(66, 'Single');
        // N-2 = 2024 with a high MAGI ($250k → Single tier 4 in 2026).
        input.previousSimulation = [
            { year: 2024, accounts: [], magi: 250_000 },
            { year: 2025, accounts: [], magi: 60_000 },
        ];

        const plan = solveRetirementYear(input);
        const expected = getIRMAAAnnualSurcharge(250_000, 'Single', YEAR, input.assumptions);

        expect(expected).toBeGreaterThan(0);
        expect(plan.tax.irmaa).toBeCloseTo(expected, 2);

        // Folded into the total: total includes the surcharge on top of the rest.
        const rest = plan.tax.federal + plan.tax.state + plan.tax.fica
            + plan.tax.capitalGainsLT + plan.tax.withdrawalOrdinaryTax + plan.tax.niit + plan.tax.penalties;
        expect(plan.tax.total).toBeCloseTo(rest + expected, 1);
    });

    it('does NOT bill IRMAA before Medicare age (64)', () => {
        const input = baseInput(64, 'Single');
        input.previousSimulation = [{ year: 2024, accounts: [], magi: 250_000 }];

        const plan = solveRetirementYear(input);
        expect(plan.tax.irmaa).toBe(0);
    });

    it('does NOT bill IRMAA when year N-2 MAGI is in the standard tier', () => {
        const input = baseInput(66, 'Single');
        input.previousSimulation = [{ year: 2024, accounts: [], magi: 80_000 }];

        const plan = solveRetirementYear(input);
        expect(plan.tax.irmaa).toBe(0);
    });

    it('bills MFJ at 2x the per-beneficiary surcharge', () => {
        // Use MAGIs that land in the TOP tier for each filing status so the x2
        // (not the differing thresholds) is what's being tested: $600k is tier 5
        // for Single (> $500k); $800k is tier 5 for MFJ (> $750k).
        const single = baseInput(66, 'Single');
        single.previousSimulation = [{ year: 2024, accounts: [], magi: 600_000 }];
        const mfj = baseInput(66, 'Married Filing Jointly');
        mfj.previousSimulation = [{ year: 2024, accounts: [], magi: 800_000 }];

        const singlePlan = solveRetirementYear(single);
        const mfjPlan = solveRetirementYear(mfj);

        expect(singlePlan.tax.irmaa).toBeGreaterThan(0);
        expect(mfjPlan.tax.irmaa).toBeCloseTo(singlePlan.tax.irmaa * 2, 1);
    });

    it('exposes the year MAGI for the next lookback', () => {
        const input = baseInput(66, 'Single');
        input.previousSimulation = [{ year: 2024, accounts: [], magi: 80_000 }];
        const plan = solveRetirementYear(input);
        // The retiree draws Traditional to fund $50k of spending, so MAGI is positive.
        expect(plan.magi).toBeGreaterThan(0);
    });
});

describe('IRMAA conversion-awareness in coarseToFineSearch', () => {
    const taxState = makeTaxState('Single');
    const assumptions = makeAssumptions(YEAR - 66);
    const fedParams = TaxService.getTaxParameters(YEAR, 'Single', 'federal', undefined, assumptions)!;

    const irmaaOptions: IRMAAConversionOptions = {
        annualSurchargeForMAGI: (magi) => getIRMAAAnnualSurcharge(magi, 'Single', YEAR, assumptions),
        nextThresholdAbove: (magi) => getNextIRMAAThreshold(magi, 'Single', YEAR, assumptions),
    };

    function search(targetRate: number, currentAGI: number, withIrmaa: boolean) {
        return coarseToFineSearch(
            targetRate,
            2_000_000,   // ample Traditional balance
            currentAGI,
            0,           // no SS
            0,           // no LTCG
            fedParams,
            taxState,
            YEAR,
            null,        // federal-only
            undefined,   // no ACA
            assumptions,
            undefined,   // debugLabel
            withIrmaa ? irmaaOptions : undefined,
        ).amount;
    }

    it('never returns MORE with IRMAA awareness on (it can only tighten the cap)', () => {
        // A low 12% bracket target with current AGI below the first IRMAA floor:
        // the bracket edge binds well below the $109k IRMAA cliff. IRMAA must NOT
        // inflate the conversion up toward the cliff (the bug this guards against).
        for (const target of [0.12, 0.22, 0.24]) {
            for (const agi of [30_000, 60_000, 90_000]) {
                const without = search(target, agi, false);
                const withIrmaa = search(target, agi, true);
                expect(withIrmaa).toBeLessThanOrEqual(without + 1); // +1 for rounding
            }
        }
    });

    it('caps just below the IRMAA cliff when that is the binding constraint', () => {
        // High bracket target (37%) so no federal bracket edge binds before the
        // first $109k IRMAA floor; IRMAA should cap the conversion just under it.
        const currentAGI = 40_000;
        const amount = search(0.37, currentAGI, true);
        const floor = getNextIRMAAThreshold(currentAGI, 'Single', YEAR, assumptions)!;
        expect(floor).toBe(109_000);
        // Capped at/just below the cliff conversion (floor - currentAGI), not above it.
        expect(amount).toBeLessThanOrEqual(floor - currentAGI);
        expect(amount).toBeGreaterThan(0);
    });
});
