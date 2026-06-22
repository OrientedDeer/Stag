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

    it('flags raise when implied rate meaningfully exceeds the configured rate', () => {
        // 50k / 1M = 5% implied vs 4% configured → gap +1pp > threshold.
        const sim = [makeYear({ year: RETIREMENT_YEAR, livingExpenses: 50000, initialPortfolio: 1_000_000 })];
        const result = computeGKRateSuggestion(sim, makeAssumptions({ withdrawalRate: 4.0 }));
        expect(result).not.toBeNull();
        expect(result!.direction).toBe('raise');
        expect(result!.configuredRate).toBe(4.0);
        expect(result!.impliedRate).toBeCloseTo(5.0, 5);
        expect(result!.suggestedRate).toBe(5.0);
        expect(result!.plannedSpending).toBe(50000);
        expect(result!.portfolioAtRetirement).toBe(1_000_000);
    });

    it('flags lower when the configured rate meaningfully exceeds the implied rate', () => {
        // 30k / 1M = 3% implied vs 5% configured → gap -2pp, |gap| > threshold.
        const sim = [makeYear({ year: RETIREMENT_YEAR, livingExpenses: 30000, initialPortfolio: 1_000_000 })];
        const result = computeGKRateSuggestion(sim, makeAssumptions({ withdrawalRate: 5.0 }));
        expect(result).not.toBeNull();
        expect(result!.direction).toBe('lower');
        expect(result!.configuredRate).toBe(5.0);
        expect(result!.impliedRate).toBeCloseTo(3.0, 5);
        expect(result!.suggestedRate).toBe(3.0);
        expect(result!.plannedSpending).toBe(30000);
        expect(result!.portfolioAtRetirement).toBe(1_000_000);
    });

    it('rounds the suggested rate UP to the funding tenth even in the lower direction', () => {
        // 36_700 / 1M = 3.67% implied vs 5% configured → ceil to 3.7% (smallest
        // 0.1% that funds the plan), still well below the configured 5% → lower.
        const sim = [makeYear({ year: RETIREMENT_YEAR, livingExpenses: 36700, initialPortfolio: 1_000_000 })];
        const result = computeGKRateSuggestion(sim, makeAssumptions({ withdrawalRate: 5.0 }));
        expect(result!.direction).toBe('lower');
        expect(result!.impliedRate).toBeCloseTo(3.67, 5);
        expect(result!.suggestedRate).toBe(3.7);
    });

    it('shows the same rate it applies (banner % equals the button %)', () => {
        // 40_300 / 1M = 4.03% implied vs 3.5% configured. Regression guard for the
        // display/apply mismatch: the suggestion is the single funding tenth 4.1%
        // (ceil of 4.03), NOT a nearest-rounded 4.0% in the text with 4.1% on the
        // button. The banner shows suggestedRate, so the two always agree.
        const sim = [makeYear({ year: RETIREMENT_YEAR, livingExpenses: 40300, initialPortfolio: 1_000_000 })];
        const result = computeGKRateSuggestion(sim, makeAssumptions({ withdrawalRate: 3.5 }));
        expect(result!.direction).toBe('raise');
        expect(result!.impliedRate).toBeCloseTo(4.03, 5);
        expect(result!.suggestedRate).toBe(4.1);
    });

    it('clears (no re-fire) once the suggested rate is applied', () => {
        // Apply the 4.1% suggestion from the case above, then recompute: the gap
        // is now under threshold and the suggestion is a no-op, so it returns null
        // rather than flipping to "lower" (the old ceil/floor split ping-ponged).
        const sim = [makeYear({ year: RETIREMENT_YEAR, livingExpenses: 40300, initialPortfolio: 1_000_000 })];
        expect(computeGKRateSuggestion(sim, makeAssumptions({ withdrawalRate: 4.1 }))).toBeNull();
    });

    it('flags a sub-0.1pp shortfall that is still a real dollar cut on a large portfolio', () => {
        // Regression for the budget-cut-with-no-warning bug. Pre-cap spend
        // 83_000 / 2_000_000 = 4.15% implied vs 4.1% configured — only a 0.05pp
        // gap, but on a $2M portfolio that's a $1,000 cut at 4.1%. A pp threshold
        // hid it; comparing the rounded funding tenth (4.2 vs 4.1) flags it.
        const sim = [makeYear({
            year: RETIREMENT_YEAR,
            livingExpenses: 80000,
            initialPortfolio: 2_000_000,
            requiredAdjustment: 3000,
            guardrailTriggered: 'none',
        })];
        const result = computeGKRateSuggestion(sim, makeAssumptions({ withdrawalRate: 4.1 }));
        expect(result).not.toBeNull();
        expect(result!.direction).toBe('raise');
        expect(result!.impliedRate).toBeCloseTo(4.15, 2);
        expect(result!.suggestedRate).toBe(4.2);
    });

    it('does not flag when the configured rate already rounds to the funding tenth', () => {
        // 39.8k / 1M = 3.98% implied → funding tenth ceil = 4.0% = configured, so
        // the rate already covers the plan (slight over-fund, no cut) → no tip.
        const sim = [makeYear({ year: RETIREMENT_YEAR, livingExpenses: 39800, initialPortfolio: 1_000_000 })];
        const result = computeGKRateSuggestion(sim, makeAssumptions({ withdrawalRate: 4.0 }));
        expect(result).toBeNull();
    });

    it('flags a too-low rate even when the shortfall is well under a tenth', () => {
        // 40.5k / 1M = 4.05% implied vs 4.0% configured → funding tenth 4.1% ≠ 4.0%,
        // and at 4.0% the plan is under-funded (a real cut), so it flags.
        const sim = [makeYear({ year: RETIREMENT_YEAR, livingExpenses: 40500, initialPortfolio: 1_000_000 })];
        const result = computeGKRateSuggestion(sim, makeAssumptions({ withdrawalRate: 4.0 }));
        expect(result!.direction).toBe('raise');
        expect(result!.suggestedRate).toBe(4.1);
    });

    it('rounds the raise-direction suggested rate UP to the nearest 0.1% so it covers the spend', () => {
        // 47_300 / 1M = 4.73% → ceil to 4.8%.
        const sim = [makeYear({ year: RETIREMENT_YEAR, livingExpenses: 47300, initialPortfolio: 1_000_000 })];
        const result = computeGKRateSuggestion(sim, makeAssumptions({ withdrawalRate: 4.0 }));
        expect(result!.direction).toBe('raise');
        expect(result!.impliedRate).toBeCloseTo(4.73, 5);
        expect(result!.suggestedRate).toBe(4.8);
    });

    it('does not over-bump a clean 0.1% rate that float arithmetic perturbs (raise)', () => {
        // 58_000 / 1M = 5.8% exactly, but (58000/1_000_000)*100 evaluates to
        // 5.800000000000001 in IEEE-754. A naive Math.ceil(x*10)/10 would bump
        // it to 5.9% (and disagree with the 5.8% the banner shows); the epsilon
        // guard keeps it at 5.8%.
        const sim = [makeYear({ year: RETIREMENT_YEAR, livingExpenses: 58000, initialPortfolio: 1_000_000 })];
        const result = computeGKRateSuggestion(sim, makeAssumptions({ withdrawalRate: 4.0 }));
        expect(result).not.toBeNull();
        expect(result!.direction).toBe('raise');
        expect(result!.suggestedRate).toBe(5.8);
    });

    it('does not over-bump a clean 0.1% rate that float arithmetic perturbs (lower direction)', () => {
        // 29_000 / 1M = 2.9% exactly, but (29000/1_000_000)*100 evaluates to
        // 2.9000000000000004 in IEEE-754. A naive Math.ceil(x*10)/10 would bump it
        // to 3.0%; the -epsilon guard keeps the clean tenth at 2.9%. Set rate 5%
        // → too-high → lower direction.
        const sim = [makeYear({ year: RETIREMENT_YEAR, livingExpenses: 29000, initialPortfolio: 1_000_000 })];
        const result = computeGKRateSuggestion(sim, makeAssumptions({ withdrawalRate: 5.0 }));
        expect(result).not.toBeNull();
        expect(result!.direction).toBe('lower');
        expect(result!.suggestedRate).toBe(2.9);
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
        expect(result!.direction).toBe('raise');
        expect(result!.impliedRate).toBeCloseTo(5.2, 5);
        expect(result!.suggestedRate).toBe(5.2);
    });

    it('does not flag a too-high rate that is still within the funding tenth', () => {
        // 3.92k → 3.92% implied → funding tenth ceil = 4.0% = configured, so the
        // small over-fund is ignored (no cut to prevent) → no tip.
        const sim = [makeYear({ year: RETIREMENT_YEAR, livingExpenses: 39200, initialPortfolio: 1_000_000 })];
        expect(computeGKRateSuggestion(sim, makeAssumptions({ withdrawalRate: 4.0 }))).toBeNull();
    });
});

describe('suggestedInitialRate', () => {
    it('returns the implied rate rounded UP to the nearest 0.1%', () => {
        // 47_300 / 1M = 4.73% → ceil to 4.8%.
        const sim = [makeYear({ year: RETIREMENT_YEAR, livingExpenses: 47300, initialPortfolio: 1_000_000 })];
        expect(suggestedInitialRate(sim, makeAssumptions())).toBe(4.8);
    });

    it('is strategy-AGNOSTIC: works while the cached sim still reflects a non-GK strategy', () => {
        // This is the seed-on-switch path: at the instant GK is selected the
        // cached run is still Fixed Real, so computeGKRateSuggestion would be
        // null — but suggestedInitialRate still yields the rate.
        const sim = [makeYear({ year: RETIREMENT_YEAR, livingExpenses: 50000, initialPortfolio: 1_000_000 })];
        expect(computeGKRateSuggestion(sim, makeAssumptions({ strategy: 'Fixed Real' }))).toBeNull();
        expect(suggestedInitialRate(sim, makeAssumptions({ strategy: 'Fixed Real' }))).toBe(5.0);
    });

    it('reconstructs pre-cap planned spending (adds back the budget-cap trim)', () => {
        // Reported 40k after a 12k cap → planned 52k → 5.2%.
        const sim = [
            makeYear({
                year: RETIREMENT_YEAR,
                livingExpenses: 40000,
                initialPortfolio: 1_000_000,
                requiredAdjustment: 12000,
                guardrailTriggered: 'none',
            }),
        ];
        expect(suggestedInitialRate(sim, makeAssumptions())).toBe(5.2);
    });

    it('returns null when retirement-year spending/portfolio cannot be derived', () => {
        expect(suggestedInitialRate([], makeAssumptions())).toBeNull();
        const noRetYear = [makeYear({ year: RETIREMENT_YEAR - 5, livingExpenses: 50000, initialPortfolio: 1_000_000 })];
        expect(suggestedInitialRate(noRetYear, makeAssumptions())).toBeNull();
    });

    it('returns null when planned spending is non-positive', () => {
        const sim = [makeYear({ year: RETIREMENT_YEAR, livingExpenses: 0, initialPortfolio: 1_000_000 })];
        expect(suggestedInitialRate(sim, makeAssumptions())).toBeNull();
    });
});
