import { describe, it, expect } from 'vitest';
import {
    computeGKRateSuggestion,
    getRetirementYearSpendingAndPortfolio,
    suggestedInitialRate,
} from '../../services/gkRateSuggestion';
import {
    defaultAssumptions,
    createBuiltinMilestones,
    type AssumptionsState,
} from '../../components/Objects/Assumptions/AssumptionsContext';
import { type SimulationYear } from '../../services/simulation/types';
import { type WithdrawalResult } from '../../services/WithdrawalStrategies';
import { InvestedAccount } from '../../components/Objects/Accounts/models';

const BIRTH_YEAR = 1990;
const RETIREMENT_AGE = 65;
const RETIREMENT_YEAR = BIRTH_YEAR + RETIREMENT_AGE; // 2055

function makeAssumptions(overrides: {
    withdrawalRate?: number;
} = {}): AssumptionsState {
    return {
        ...defaultAssumptions,
        investments: {
            ...defaultAssumptions.investments,
            withdrawalStrategy: 'Guyton Klinger',
            withdrawalRate: overrides.withdrawalRate ?? 4.0,
            // Pins MANUAL-rate suggestion mechanics; auto mode returns null by design.
            withdrawalRateMode: 'manual',
        },
        milestones: createBuiltinMilestones(BIRTH_YEAR, RETIREMENT_AGE, 90),
    };
}

/**
 * Build a SimulationYear that mirrors what SimulationEngine emits on a
 * capital-preservation CUT year where discretionary spending CANNOT absorb the
 * full target cut (the partial/failed-cut edge case):
 * - the plan's rate crossed the UPPER guardrail, so GK wants to cut
 *   `targetAdjustment` (= requiredAdjustment) out of spending;
 * - only `appliedAdjustment` (= actualAdjustment) of discretionary is available,
 *   so the engine trims `cashflow.livingExpenses` by ONLY the applied amount —
 *   NOT the larger target (SimulationEngine.tsx:400-416, the cut comes out via
 *   `adj.ratio` which is capped at the available discretionary);
 * - `requiredAdjustment` still records the (larger) target and `actualAdjustment`
 *   records what actually moved, with a `warning` flagging the unmet shortfall.
 */
function makePartialCutYear(opts: {
    plannedSpending: number;     // the user's original itemized plan (pre-adjust)
    targetCut: number;           // dollars GK WANTED to cut (= requiredAdjustment)
    appliedCut: number;          // dollars actually cut, capped at discretionary
    initialPortfolio: number;
}): SimulationYear {
    // The engine reduced living expenses by ONLY the applied cut.
    const trimmedLivingExpenses = opts.plannedSpending - opts.appliedCut;
    const strategyWithdrawal: WithdrawalResult = {
        amount: trimmedLivingExpenses,
        baseAmount: trimmedLivingExpenses,
        initialPortfolio: opts.initialPortfolio,
        guardrailTriggered: 'capital-preservation',
        targetWithdrawalRate: 4,
        currentWithdrawalRate: 4,
    };

    return {
        year: RETIREMENT_YEAR,
        incomes: [],
        expenses: [],
        accounts: [new InvestedAccount('a1', 'Test', opts.initialPortfolio)],
        cashflow: {
            totalIncome: 0,
            totalExpense: trimmedLivingExpenses,
            livingExpenses: trimmedLivingExpenses,
            discretionary: 0,
            investedUser: 0,
            investedMatch: 0,
            totalInvested: 0,
            bucketAllocations: 0,
            bucketDetail: {},
            withdrawals: 0,
            withdrawalDetail: {},
        },
        taxDetails: {
            fed: 0, state: 0, fica: 0, preTax: 0, insurance: 0,
            postTax: 0, capitalGains: 0, withdrawalOrdinaryTax: 0, niit: 0,
        },
        logs: [],
        strategyWithdrawal,
        // requiredAdjustment = the TARGET cut; actualAdjustment = what actually
        // moved. They DIVERGE here because the cut was only partially applied
        // (SimulationEngine.tsx:415-416 + WithdrawalStrategies.ts:325-326).
        strategyAdjustment: {
            guardrailTriggered: 'capital-preservation',
            requiredAdjustment: opts.targetCut,
            actualAdjustment: opts.appliedCut,
            discretionaryAvailable: opts.appliedCut,
            warning: 'Plan unsustainable: discretionary could not absorb the full cut.',
        },
        isEndOfYearProjection: false,
    };
}

describe('GK rate suggestion on a partial/failed capital-preservation cut year', () => {
    // Original plan: $40,000 on a $1M portfolio → 4.0% implied. GK wants to cut
    // $4,000 but only $1,000 of discretionary is available, so reported
    // livingExpenses are trimmed to $39,000 while requiredAdjustment stays $4,000.
    const SCENARIO = {
        plannedSpending: 40000,
        targetCut: 4000,
        appliedCut: 1000,
        initialPortfolio: 1_000_000,
    } as const;

    it('backs out only the APPLIED cut, recovering the true plan (not the target)', () => {
        const sim = [makePartialCutYear(SCENARIO)];

        const result = getRetirementYearSpendingAndPortfolio(sim, makeAssumptions({ withdrawalRate: 3.0 }));
        // Reported $39,000 + applied $1,000 = the original $40,000 plan.
        // The old code added back the $4,000 TARGET → $43,000 (overshoots the plan).
        expect(result?.plannedSpending).toBe(40000);
    });

    it('suggests the plan-implied rate, not a rate inflated by the unapplied cut', () => {
        const sim = [makePartialCutYear(SCENARIO)];

        const result = computeGKRateSuggestion(sim, makeAssumptions({ withdrawalRate: 3.0 }));
        expect(result).not.toBeNull();
        // Implied = 40000 / 1M = 4.0%, NOT 43000 / 1M = 4.3% (the buggy back-out).
        expect(result!.impliedRate).toBeCloseTo(4.0, 5);
        expect(result!.suggestedRate).toBe(4.0);
        // Configured 3.0% is too low → raise toward the plan.
        expect(result!.direction).toBe('raise');
        expect(result!.plannedSpending).toBe(40000);
    });

    it('suggestedInitialRate also reconstructs the pre-cut plan from the applied cut', () => {
        const sim = [makePartialCutYear(SCENARIO)];
        expect(suggestedInitialRate(sim, makeAssumptions({ withdrawalRate: 3.0 }))).toBe(4.0);
    });

    it('a FULL cut (applied === required) behaves exactly as before — no regression', () => {
        // Discretionary fully absorbs the cut: applied === target === $4,000.
        // livingExpenses trimmed to $36,000; backing out either field gives $40,000.
        const sim = [makePartialCutYear({
            plannedSpending: 40000,
            targetCut: 4000,
            appliedCut: 4000,
            initialPortfolio: 1_000_000,
        })];

        const result = getRetirementYearSpendingAndPortfolio(sim, makeAssumptions({ withdrawalRate: 3.0 }));
        expect(result?.plannedSpending).toBe(40000);
        expect(suggestedInitialRate(sim, makeAssumptions({ withdrawalRate: 3.0 }))).toBe(4.0);
    });
});
