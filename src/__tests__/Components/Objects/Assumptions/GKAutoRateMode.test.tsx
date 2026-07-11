import { describe, it, expect } from 'vitest';
import { type AssumptionsState, defaultAssumptions, createBuiltinMilestones } from '../../../../components/Objects/Assumptions/AssumptionsContext';
import { type TaxState } from '../../../../components/Objects/Taxes/TaxContext';
import { InvestedAccount } from '../../../../components/Objects/Accounts/models';
import { FoodExpense } from '../../../../components/Objects/Expense/models';
import { simulateOneYear } from '../../../../components/Objects/Assumptions/SimulationEngine';

/**
 * Guyton-Klinger AUTO withdrawal-rate mode (engine derivation).
 *
 * In auto mode (the default) the engine derives the guardrail band center at
 * the first retirement year from the plan itself: planned spending ÷ portfolio
 * at retirement, rounded UP to the nearest 0.1% (fundingRate). The stored
 * `withdrawalRate` is ignored. The derived rate is stamped on
 * `strategyWithdrawal.derivedInitialRate` and carried forward on subsequent
 * years so the band stays fixed. Manual mode keeps the legacy behavior of
 * using the stored rate as the band center.
 */

const mockTaxState: TaxState = {
    filingStatus: 'Single',
    stateResidency: 'DC',
    deductionMethod: 'Standard',
    fedOverride: null,
    ficaOverride: null,
    stateOverride: null,
    year: 2024,
};

/** Already retired: age 65 in 2025, life expectancy 90. */
function makeGKAssumptions(mode: 'auto' | 'manual' | undefined): AssumptionsState {
    return {
        ...defaultAssumptions,
        demographics: {},
        milestones: createBuiltinMilestones(1960, 65, 90),
        income: { ...defaultAssumptions.income, salaryGrowth: 0 },
        macro: { ...defaultAssumptions.macro, inflationRate: 0, inflationAdjusted: false },
        investments: {
            ...defaultAssumptions.investments,
            returnRates: { ror: 0 },
            withdrawalStrategy: 'Guyton Klinger',
            withdrawalRate: 4.0, // deliberately LOWER than the plan-implied 7% below
            withdrawalRateMode: mode,
            gkUpperGuardrail: 1.2,
            gkLowerGuardrail: 0.8,
            gkAdjustmentPercent: 10,
        },
    };
}

/** $70k/yr fully-discretionary plan against a $1M portfolio → implied 7.0%. */
function makeDiscretionaryExpense(): FoodExpense {
    const expense = new FoodExpense('exp-1', 'Living', 70000, 'Annually', new Date(2025, 0, 1), undefined);
    expense.isDiscretionary = true;
    return expense;
}

function makePortfolio(amount: number): InvestedAccount {
    return new InvestedAccount('acc-1', 'Portfolio', amount, 0, 10, 0.0, 'Brokerage', true, 1.0, amount * 0.6);
}

describe('Guyton-Klinger AUTO withdrawal-rate mode', () => {
    it('derives the initial rate from the plan and does NOT cap spending at the configured 4%', () => {
        const result = simulateOneYear(
            2025, [], [makeDiscretionaryExpense()], [makePortfolio(1_000_000)],
            makeGKAssumptions('auto'), mockTaxState,
        );

        // Derived: 70_000 / 1_000_000 × 100 = 7.0% (fundingRate leaves a clean tenth alone).
        expect(result.strategyWithdrawal).toBeDefined();
        expect(result.strategyWithdrawal!.derivedInitialRate).toBe(7.0);
        // The derived rate — not the stored 4.0 — is the band center.
        expect(result.strategyWithdrawal!.targetWithdrawalRate).toBe(7.0);

        // Band is centered on the plan (5.6%–8.4%), so no capital-preservation
        // cut fires even though 7% > the stored 4% band's upper guardrail (4.8%).
        expect(result.strategyAdjustment).toBeUndefined();
        expect(result.strategyWithdrawal!.guardrailTriggered).toBe('none');
        // Full planned spending survives (manual 4% would have cut 10% = $7k).
        expect(result.cashflow.livingExpenses).toBeCloseTo(70000, 0);

        // Derivation is logged.
        expect(result.logs.some(log => log.includes('GK auto rate'))).toBe(true);
    });

    it('treats an absent mode as auto (the default)', () => {
        const assumptions = makeGKAssumptions(undefined);
        delete assumptions.investments.withdrawalRateMode;

        const result = simulateOneYear(
            2025, [], [makeDiscretionaryExpense()], [makePortfolio(1_000_000)],
            assumptions, mockTaxState,
        );

        expect(result.strategyWithdrawal!.derivedInitialRate).toBe(7.0);
    });

    it('rounds a non-tenth implied rate UP to the nearest 0.1%', () => {
        // 70_000 / 1_080_000 = 6.481…% → 6.5%.
        const result = simulateOneYear(
            2025, [], [makeDiscretionaryExpense()], [makePortfolio(1_080_000)],
            makeGKAssumptions('auto'), mockTaxState,
        );

        expect(result.strategyWithdrawal!.derivedInitialRate).toBe(6.5);
    });

    it('carries the derived rate forward instead of re-deriving from later years', () => {
        const year1 = simulateOneYear(
            2025, [], [makeDiscretionaryExpense()], [makePortfolio(1_000_000)],
            makeGKAssumptions('auto'), mockTaxState,
        );
        expect(year1.strategyWithdrawal!.derivedInitialRate).toBe(7.0);

        // Year 2 with a grown portfolio: a fresh derivation would give
        // 70_000 / 1_100_000 = 6.4%, but the retirement-year 7.0% must persist.
        const year2 = simulateOneYear(
            2026, [], [makeDiscretionaryExpense()], [makePortfolio(1_100_000)],
            makeGKAssumptions('auto'), mockTaxState, [year1],
        );

        expect(year2.strategyWithdrawal!.derivedInitialRate).toBe(7.0);
        expect(year2.strategyWithdrawal!.targetWithdrawalRate).toBe(7.0);
    });

    it('manual mode keeps legacy behavior: the stored 4% band centers the guardrails and the cut fires', () => {
        const result = simulateOneYear(
            2025, [], [makeDiscretionaryExpense()], [makePortfolio(1_000_000)],
            makeGKAssumptions('manual'), mockTaxState,
        );

        // No derivation in manual mode.
        expect(result.strategyWithdrawal!.derivedInitialRate).toBeUndefined();
        expect(result.strategyWithdrawal!.targetWithdrawalRate).toBe(4.0);
        expect(result.logs.some(log => log.includes('GK auto rate'))).toBe(false);

        // Plan rate 7% > 4% × 1.2 → capital preservation cuts 10% of spending
        // ($7k) out of discretionary, exactly as before this feature.
        expect(result.strategyAdjustment?.guardrailTriggered).toBe('capital-preservation');
        expect(result.strategyAdjustment?.actualAdjustment).toBeCloseTo(7000, 0);
        expect(result.cashflow.livingExpenses).toBeCloseTo(63000, 0);
    });
});
