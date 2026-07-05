import { describe, it, expect } from 'vitest';
import {
    computeGKRateSuggestion,
    getRetirementYearSpendingAndPortfolio,
    suggestedInitialRate,
} from '../../services/gkRateSuggestion';
import {
    defaultAssumptions,
    createBuiltinMilestones,
    AssumptionsState,
} from '../../components/Objects/Assumptions/AssumptionsContext';
import { SimulationYear } from '../../services/simulation/types';
import { WithdrawalResult } from '../../services/WithdrawalStrategies';
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
 * Build a SimulationYear that mirrors what SimulationEngine actually emits on a
 * prosperity-BOOST year: the plan's rate crossed the LOWER guardrail, so the
 * engine increased discretionary, re-totaled `cashflow.livingExpenses` to the
 * BOOSTED value, AND stored the same positive dollar move in
 * `strategyAdjustment.requiredAdjustment` (see SimulationEngine.tsx:413-421 —
 * `requiredAdjustment: adj.targetAdjustment`, positive for both cut and boost).
 */
function makeProsperityBoostYear(opts: {
    plannedSpending: number;   // the user's original itemized plan (pre-adjust)
    boost: number;             // dollars the prosperity boost ADDED
    initialPortfolio: number;
}): SimulationYear {
    const boostedLivingExpenses = opts.plannedSpending + opts.boost;
    const strategyWithdrawal: WithdrawalResult = {
        amount: boostedLivingExpenses,
        baseAmount: boostedLivingExpenses,
        initialPortfolio: opts.initialPortfolio,
        guardrailTriggered: 'prosperity',
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
            totalExpense: boostedLivingExpenses,
            livingExpenses: boostedLivingExpenses,
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
        // The engine stores the POSITIVE targetAdjustment here for BOTH cut and
        // boost years (SimulationEngine.tsx:415).
        strategyAdjustment: {
            guardrailTriggered: 'prosperity',
            requiredAdjustment: opts.boost,
            actualAdjustment: opts.boost,
            discretionaryAvailable: opts.boost,
        },
        isEndOfYearProjection: false,
    };
}

describe('GK rate suggestion on a prosperity-boost retirement year', () => {
    it('does not double-count the boost when reconstructing planned spending', () => {
        // Original plan: $28,000 on a $1M portfolio → 2.8% implied. The configured
        // rate (3.4%) is HIGHER, so the plan's rate crosses the LOWER guardrail and
        // a prosperity boost of $2,000 fires: reported livingExpenses are inflated
        // to $30,000 AND requiredAdjustment is +$2,000.
        const sim = [
            makeProsperityBoostYear({
                plannedSpending: 28000,
                boost: 2000,
                initialPortfolio: 1_000_000,
            }),
        ];

        const result = getRetirementYearSpendingAndPortfolio(sim, makeAssumptions({ withdrawalRate: 3.4 }));
        // Must reconstruct the ORIGINAL $28,000 plan, not $30,000 + $2,000 = $32,000.
        expect(result?.plannedSpending).toBe(28000);
    });

    it('suggests the plan-implied rate, not a too-high rate inflated by the boost', () => {
        const sim = [
            makeProsperityBoostYear({
                plannedSpending: 28000,
                boost: 2000,
                initialPortfolio: 1_000_000,
            }),
        ];

        const result = computeGKRateSuggestion(sim, makeAssumptions({ withdrawalRate: 3.4 }));
        expect(result).not.toBeNull();
        // Implied rate is 28000 / 1M = 2.8%, NOT 32000 / 1M = 3.2%.
        expect(result!.impliedRate).toBeCloseTo(2.8, 5);
        expect(result!.suggestedRate).toBe(2.8);
        // The configured 3.4% is too high → lower toward the plan.
        expect(result!.direction).toBe('lower');
        expect(result!.plannedSpending).toBe(28000);
    });

    it('suggestedInitialRate also reconstructs the pre-boost plan', () => {
        const sim = [
            makeProsperityBoostYear({
                plannedSpending: 28000,
                boost: 2000,
                initialPortfolio: 1_000_000,
            }),
        ];
        expect(suggestedInitialRate(sim, makeAssumptions({ withdrawalRate: 3.4 }))).toBe(2.8);
    });
});
