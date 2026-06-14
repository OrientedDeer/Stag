import { describe, it, expect } from 'vitest';
import {
    computeGKRateSuggestion,
    getRetirementYearSpendingAndPortfolio,
    GK_RATE_SUGGESTION_THRESHOLD_PP,
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

/** Build an AssumptionsState with the GK strategy + a given initial rate. */
function makeAssumptions(overrides: {
    strategy?: AssumptionsState['investments']['withdrawalStrategy'];
    withdrawalRate?: number;
} = {}): AssumptionsState {
    return {
        ...defaultAssumptions,
        investments: {
            ...defaultAssumptions.investments,
            withdrawalStrategy: overrides.strategy ?? 'Guyton Klinger',
            withdrawalRate: overrides.withdrawalRate ?? 4.0,
        },
        milestones: createBuiltinMilestones(BIRTH_YEAR, RETIREMENT_AGE, 90),
    };
}

/** Build a minimal SimulationYear with just the fields the function reads. */
function makeYear(opts: {
    year: number;
    livingExpenses: number;
    initialPortfolio?: number;
    accountTotal?: number;
    requiredAdjustment?: number;
    guardrailTriggered?: 'none' | 'capital-preservation' | 'prosperity';
    isEndOfYearProjection?: boolean;
}): SimulationYear {
    const strategyWithdrawal: WithdrawalResult | undefined =
        opts.initialPortfolio !== undefined
            ? {
                  amount: 0,
                  baseAmount: 0,
                  initialPortfolio: opts.initialPortfolio,
                  guardrailTriggered: 'none',
                  targetWithdrawalRate: 4,
                  currentWithdrawalRate: 4,
              }
            : undefined;

    return {
        year: opts.year,
        incomes: [],
        expenses: [],
        accounts:
            opts.accountTotal !== undefined
                ? [new InvestedAccount('a1', 'Test', opts.accountTotal)]
                : [],
        cashflow: {
            totalIncome: 0,
            totalExpense: opts.livingExpenses,
            livingExpenses: opts.livingExpenses,
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
        strategyAdjustment:
            opts.requiredAdjustment !== undefined
                ? {
                      guardrailTriggered: opts.guardrailTriggered ?? 'none',
                      requiredAdjustment: opts.requiredAdjustment,
                      actualAdjustment: opts.requiredAdjustment,
                      discretionaryAvailable: opts.requiredAdjustment,
                  }
                : undefined,
        isEndOfYearProjection: opts.isEndOfYearProjection,
    };
}

describe('getRetirementYearSpendingAndPortfolio', () => {
    it('returns null for an empty simulation', () => {
        expect(getRetirementYearSpendingAndPortfolio([], makeAssumptions())).toBeNull();
    });

    it('finds the retirement year and uses initialPortfolio as the denominator', () => {
        const sim = [
            makeYear({ year: RETIREMENT_YEAR - 1, livingExpenses: 50000, initialPortfolio: 900000 }),
            makeYear({ year: RETIREMENT_YEAR, livingExpenses: 50000, initialPortfolio: 1_000_000 }),
        ];
        const result = getRetirementYearSpendingAndPortfolio(sim, makeAssumptions());
        expect(result).toEqual({ plannedSpending: 50000, portfolioAtRetirement: 1_000_000 });
    });

    it('adds back the budget-cap trim to reconstruct planned (pre-cap) spending', () => {
        // Reported living expenses were trimmed to 40k; the cap wanted to cut 10k.
        const sim = [
            makeYear({
                year: RETIREMENT_YEAR,
                livingExpenses: 40000,
                initialPortfolio: 1_000_000,
                requiredAdjustment: 10000,
                guardrailTriggered: 'none',
            }),
        ];
        const result = getRetirementYearSpendingAndPortfolio(sim, makeAssumptions());
        expect(result?.plannedSpending).toBe(50000);
    });

    it('does not add back a prosperity adjustment (that is an increase, not a cap)', () => {
        const sim = [
            makeYear({
                year: RETIREMENT_YEAR,
                livingExpenses: 60000,
                initialPortfolio: 1_000_000,
                requiredAdjustment: 0,
                guardrailTriggered: 'prosperity',
            }),
        ];
        const result = getRetirementYearSpendingAndPortfolio(sim, makeAssumptions());
        expect(result?.plannedSpending).toBe(60000);
    });

    it('falls back to summing the account snapshot when initialPortfolio is absent', () => {
        const sim = [makeYear({ year: RETIREMENT_YEAR, livingExpenses: 50000, accountTotal: 800000 })];
        const result = getRetirementYearSpendingAndPortfolio(sim, makeAssumptions());
        expect(result?.portfolioAtRetirement).toBe(800000);
    });

    it('skips synthetic end-of-year projection rows', () => {
        const sim = [
            makeYear({ year: RETIREMENT_YEAR, livingExpenses: 99999, initialPortfolio: 1, isEndOfYearProjection: true }),
            makeYear({ year: RETIREMENT_YEAR, livingExpenses: 50000, initialPortfolio: 1_000_000 }),
        ];
        const result = getRetirementYearSpendingAndPortfolio(sim, makeAssumptions());
        expect(result).toEqual({ plannedSpending: 50000, portfolioAtRetirement: 1_000_000 });
    });

    it('returns null when there is no retirement-year row', () => {
        const sim = [makeYear({ year: RETIREMENT_YEAR - 5, livingExpenses: 50000, initialPortfolio: 1_000_000 })];
        expect(getRetirementYearSpendingAndPortfolio(sim, makeAssumptions())).toBeNull();
    });

    it('returns null when the portfolio is non-positive', () => {
        const sim = [makeYear({ year: RETIREMENT_YEAR, livingExpenses: 50000, initialPortfolio: 0 })];
        expect(getRetirementYearSpendingAndPortfolio(sim, makeAssumptions())).toBeNull();
    });
});

describe('computeGKRateSuggestion', () => {
    it('returns null when the active strategy is not Guyton-Klinger', () => {
        const sim = [makeYear({ year: RETIREMENT_YEAR, livingExpenses: 50000, initialPortfolio: 1_000_000 })];
        // 50k / 1M = 5% implied vs 4% set, but Fixed Real → no suggestion.
        const result = computeGKRateSuggestion(sim, makeAssumptions({ strategy: 'Fixed Real' }));
        expect(result).toBeNull();
    });

    it('flags when implied rate meaningfully exceeds the configured rate', () => {
        // 50k / 1M = 5% implied vs 4% configured → gap 1pp > threshold.
        const sim = [makeYear({ year: RETIREMENT_YEAR, livingExpenses: 50000, initialPortfolio: 1_000_000 })];
        const result = computeGKRateSuggestion(sim, makeAssumptions({ withdrawalRate: 4.0 }));
        expect(result).not.toBeNull();
        expect(result!.configuredRate).toBe(4.0);
        expect(result!.impliedRate).toBeCloseTo(5.0, 5);
        expect(result!.suggestedRate).toBe(5.0);
        expect(result!.plannedSpending).toBe(50000);
        expect(result!.portfolioAtRetirement).toBe(1_000_000);
    });

    it('does not flag when the implied rate is within the threshold of the configured rate', () => {
        // 40.5k / 1M = 4.05% implied vs 4% configured → gap 0.05pp < 0.25pp.
        const sim = [makeYear({ year: RETIREMENT_YEAR, livingExpenses: 40500, initialPortfolio: 1_000_000 })];
        const result = computeGKRateSuggestion(sim, makeAssumptions({ withdrawalRate: 4.0 }));
        expect(result).toBeNull();
    });

    it('does not flag when the implied rate is below the configured rate', () => {
        // 30k / 1M = 3% implied vs 4% configured.
        const sim = [makeYear({ year: RETIREMENT_YEAR, livingExpenses: 30000, initialPortfolio: 1_000_000 })];
        const result = computeGKRateSuggestion(sim, makeAssumptions({ withdrawalRate: 4.0 }));
        expect(result).toBeNull();
    });

    it('rounds the suggested rate UP to the nearest 0.1% so it covers the spend', () => {
        // 47_300 / 1M = 4.73% → ceil to 4.8%.
        const sim = [makeYear({ year: RETIREMENT_YEAR, livingExpenses: 47300, initialPortfolio: 1_000_000 })];
        const result = computeGKRateSuggestion(sim, makeAssumptions({ withdrawalRate: 4.0 }));
        expect(result!.impliedRate).toBeCloseTo(4.73, 5);
        expect(result!.suggestedRate).toBe(4.8);
    });

    it('does not over-bump a clean 0.1% rate that float arithmetic perturbs', () => {
        // 58_000 / 1M = 5.8% exactly, but (58000/1_000_000)*100 evaluates to
        // 5.800000000000001 in IEEE-754. A naive Math.ceil(x*10)/10 would bump
        // it to 5.9% (and disagree with the 5.8% the banner shows); the epsilon
        // guard keeps it at 5.8%.
        const sim = [makeYear({ year: RETIREMENT_YEAR, livingExpenses: 58000, initialPortfolio: 1_000_000 })];
        const result = computeGKRateSuggestion(sim, makeAssumptions({ withdrawalRate: 4.0 }));
        expect(result).not.toBeNull();
        expect(result!.suggestedRate).toBe(5.8);
    });

    it('uses the reconstructed pre-cap spending so a capped year still flags', () => {
        // Reported 40k after a 12k cap → planned 52k → 5.2% implied vs 4%.
        const sim = [
            makeYear({
                year: RETIREMENT_YEAR,
                livingExpenses: 40000,
                initialPortfolio: 1_000_000,
                requiredAdjustment: 12000,
                guardrailTriggered: 'none',
            }),
        ];
        const result = computeGKRateSuggestion(sim, makeAssumptions({ withdrawalRate: 4.0 }));
        expect(result!.impliedRate).toBeCloseTo(5.2, 5);
        expect(result!.suggestedRate).toBe(5.2);
    });

    it('honors a custom threshold argument', () => {
        // 4.2% implied vs 4% set → gap 0.2pp. Passes default (0.25) → null; fails 0.1 → flagged.
        const sim = [makeYear({ year: RETIREMENT_YEAR, livingExpenses: 42000, initialPortfolio: 1_000_000 })];
        expect(computeGKRateSuggestion(sim, makeAssumptions({ withdrawalRate: 4.0 }))).toBeNull();
        const flagged = computeGKRateSuggestion(sim, makeAssumptions({ withdrawalRate: 4.0 }), 0.1);
        expect(flagged).not.toBeNull();
    });

    it('exposes the default threshold constant', () => {
        expect(GK_RATE_SUGGESTION_THRESHOLD_PP).toBeGreaterThan(0);
    });
});
