/**
 * fp-review F1: the ACA subsidy loss is REAL engine cash.
 *
 * Pre-65 retirement years whose ACA MAGI reaches the 400%-FPL cliff lose the
 * marketplace premium subsidy. The engine now charges the user's estimated
 * annual subsidy (assumptions.investments.acaAnnualSubsidyLoss, default $12k)
 * as cash in those years — mirroring the IRMAA convention (folded into the
 * deficit and the year's total tax, surfaced as tax.aca) — so the
 * engine-direct conversion search's judge prices cliff crossings instead of
 * scoring them $0.
 *
 * Also pins the phantom-display fix: the conversion's taxAmount no longer
 * folds in an ACA penalty the sim charges elsewhere (the charge appears
 * exactly once, in tax.aca).
 */
import { describe, it, expect } from 'vitest';

import { solveRetirementYear, type YearSolverInput } from '../../../services/simulation/YearSolver';
import { getAcaCliffThreshold } from '../../../services/simulation/TaxOptimizedWithdrawal';
import { runSimulation } from '../../../components/Objects/Assumptions/useSimulation';
import { InvestedAccount, SavedAccount, type AnyAccount } from '../../../components/Objects/Accounts/models';
import { PassiveIncome } from '../../../components/Objects/Income/models';
import { OtherExpense } from '../../../components/Objects/Expense/models';
import {
    type AssumptionsState,
    defaultAssumptions,
    createBuiltinMilestones,
    ACA_SUBSIDY_LOSS_DEFAULT,
} from '../../../components/Objects/Assumptions/AssumptionsContext';
import { type TaxState } from '../../../components/Objects/Taxes/TaxContext';

const YEAR = new Date().getFullYear();
const CLIFF = getAcaCliffThreshold('single', YEAR);

const taxState: TaxState = {
    filingStatus: 'Single',
    stateResidency: 'Texas',
    deductionMethod: 'Standard',
    fedOverride: null,
    ficaOverride: null,
    stateOverride: null,
    year: YEAR,
};

function makeAssumptions(overrides: Partial<AssumptionsState['investments']> = {}): AssumptionsState {
    return {
        ...defaultAssumptions,
        milestones: createBuiltinMilestones(YEAR - 60, 55, 95),
        investments: {
            ...defaultAssumptions.investments,
            returnRates: { ror: 5 },
            taxOptimizationEnabled: true,
            rothConversionStrategy: 'dp-precomputed',
            acaAware: true,
            ...overrides,
        },
    };
}

/**
 * Retired, no income; spending funded from cash (no MAGI from withdrawals) so
 * the DP-planned conversion is the only MAGI driver and the acaAware on/off
 * total-tax delta is exactly the subsidy charge.
 */
function makeSolverInput(opts: {
    conversion: number;
    currentAge?: number;
    investments?: Partial<AssumptionsState['investments']>;
    acaAware?: boolean;
    livingExpenses?: number;
}): YearSolverInput {
    const accounts: AnyAccount[] = [
        new SavedAccount('cash', 'Cash', 500_000, 0),
        new InvestedAccount('trad', 'Traditional IRA', 1_500_000, 0, 15, 0.05, 'Traditional IRA'),
        new InvestedAccount('roth', 'Roth IRA', 50_000, 0, 10, 0.05, 'Roth IRA', true, 0.2, 50_000),
    ];
    return {
        year: YEAR,
        currentAge: opts.currentAge ?? 60,
        isRetired: true,
        incomes: [],
        expenses: [new OtherExpense('living', 'Living', opts.livingExpenses ?? 40_000, 'Annually', new Date(YEAR - 5, 0, 1))],
        totalLivingExpenses: opts.livingExpenses ?? 40_000,
        rmdAmount: 0,
        accounts,
        withdrawalOrder: [{ accountId: 'cash' }, { accountId: 'trad' }, { accountId: 'roth' }],
        taxState,
        assumptions: makeAssumptions(opts.investments),
        taxOptimizationEnabled: true,
        acaAware: opts.acaAware ?? true,
        dpConversionPlan: new Map([[YEAR, opts.conversion]]),
    };
}

describe('F1: ACA subsidy repayment is real engine cash (solver level)', () => {
    it('charges the default subsidy when a pre-65 conversion crosses the cliff', () => {
        const plan = solveRetirementYear(makeSolverInput({ conversion: CLIFF + 50_000 }));
        expect(plan.conversion?.amount).toBeGreaterThan(CLIFF);
        expect(plan.tax.aca).toBe(ACA_SUBSIDY_LOSS_DEFAULT);
        // Charged exactly once, inside total.
        const off = solveRetirementYear(makeSolverInput({ conversion: CLIFF + 50_000, acaAware: false }));
        expect(off.tax.aca).toBe(0);
        // The on-run's total tax carries the full charge (plus any knock-on tax
        // on the extra withdrawal that funds it — the DP spending reservation
        // routes the deficit through Traditional here, so the delta exceeds the
        // subsidy alone). The exact-delta property is pinned in the cash-funded
        // surplus-year test below.
        expect(plan.tax.total - off.tax.total).toBeGreaterThanOrEqual(ACA_SUBSIDY_LOSS_DEFAULT - 1);
        // The charge is a real cash cost: it lands in the decision log too.
        expect(plan.decisions.some(d => d.description.includes('ACA subsidy lost'))).toBe(true);
    });

    it('charges nothing when the year stays under the cliff', () => {
        // Small expenses keep the deficit-funding Traditional draw small, so
        // MAGI = conversion + a few $k stays under the cliff.
        const plan = solveRetirementYear(makeSolverInput({
            conversion: Math.floor(CLIFF * 0.5), livingExpenses: 5_000,
        }));
        expect(plan.conversion?.amount).toBeGreaterThan(0);
        expect(plan.tax.aca).toBe(0);
    });

    it('charges nothing at 65+ (Medicare, no marketplace subsidy at stake)', () => {
        const plan = solveRetirementYear(makeSolverInput({ conversion: CLIFF + 50_000, currentAge: 66 }));
        expect(plan.tax.aca).toBe(0);
    });

    it('charges nothing when acaAware is off', () => {
        const plan = solveRetirementYear(makeSolverInput({ conversion: CLIFF + 50_000, acaAware: false }));
        expect(plan.tax.aca).toBe(0);
    });

    it('charges the user-set estimate when acaAnnualSubsidyLoss is overridden', () => {
        const plan = solveRetirementYear(makeSolverInput({
            conversion: CLIFF + 50_000,
            investments: { acaAnnualSubsidyLoss: 7_000 },
        }));
        expect(plan.tax.aca).toBe(7_000);
    });

    it('does NOT fold the ACA penalty into the displayed conversion taxAmount (no phantom, no double count)', () => {
        const plan = solveRetirementYear(makeSolverInput({ conversion: CLIFF + 50_000 }));
        expect(plan.conversion).not.toBeNull();
        // taxAmount = federal components + state; the ACA charge lives ONLY in tax.aca.
        expect(plan.conversion!.taxAmount).toBeCloseTo(
            plan.conversion!.federalTaxCost + plan.conversion!.stateTaxCost, 2,
        );
        expect(plan.conversion!.taxAmount).toBeLessThan(plan.tax.total);
    });

    it('charges in a surplus year whose base income alone crosses the cliff (no conversion needed)', () => {
        const input = makeSolverInput({ conversion: 0 });
        input.incomes = [new PassiveIncome('rent', 'Rental', CLIFF + 30_000, 'Annually', 'No', 'Rental', new Date(YEAR - 5, 0, 1))];
        const plan = solveRetirementYear(input);
        expect(plan.tax.aca).toBe(ACA_SUBSIDY_LOSS_DEFAULT);

        const off = { ...input, acaAware: false };
        const planOff = solveRetirementYear(off);
        expect(planOff.tax.aca).toBe(0);
        // The charge comes straight out of the year's surplus.
        expect(planOff.surplus - plan.surplus).toBeCloseTo(ACA_SUBSIDY_LOSS_DEFAULT, 6);
    });
});

describe('F1: ACA charge reduces net worth only in crossing pre-65 years (sim level)', () => {
    const netWorth = (accounts: AnyAccount[]) => accounts.reduce((s, a) => s + a.amount, 0);

    const simAssumptions = (acaAware: boolean): AssumptionsState => ({
        ...defaultAssumptions,
        milestones: createBuiltinMilestones(YEAR - 60, 55, 90),
        investments: {
            ...defaultAssumptions.investments,
            returnRates: { ror: 5 },
            taxOptimizationEnabled: false, // no conversions — the passive income drives MAGI
            acaAware,
        },
    });

    const simAccounts = (): AnyAccount[] => [
        new SavedAccount('cash', 'Cash', 300_000, 0),
    ];

    const run = (annualPassive: number, acaAware: boolean) => runSimulation(
        12,
        simAccounts(),
        [new PassiveIncome('rent', 'Rental', annualPassive, 'Annually', 'No', 'Rental', new Date(YEAR - 5, 0, 1))],
        [new OtherExpense('living', 'Living', 30_000, 'Annually', new Date(YEAR - 5, 0, 1))],
        simAssumptions(acaAware),
        taxState,
    );

    it('crossing scenario: tax.aca charged for ages 60-64 only, and terminal net worth is lower', () => {
        const over = CLIFF + 40_000;
        const on = run(over, true);
        const off = run(over, false);

        // Skip the year-0 snapshot and EOY projection entries — they are built
        // outside the year solver and carry no irmaa/aca fields (same convention
        // as IRMAA).
        const solvedYears = on.filter((y, i) => i > 0 && !y.isEndOfYearProjection);
        expect(solvedYears.length).toBeGreaterThan(6);
        for (const y of solvedYears) {
            const age = y.year - (YEAR - 60);
            if (age < 65) {
                expect(y.taxDetails.aca).toBe(ACA_SUBSIDY_LOSS_DEFAULT);
            } else {
                expect(y.taxDetails.aca ?? 0).toBe(0);
            }
        }
        for (const y of off) {
            expect(y.taxDetails.aca ?? 0).toBe(0);
        }
        // 5 crossing years (ages 60-64) of real cash out.
        expect(netWorth(on[on.length - 1].accounts)).toBeLessThan(netWorth(off[off.length - 1].accounts));
    });

    it('non-crossing scenario: no charge, timeline unchanged by the flag', () => {
        const under = Math.floor(CLIFF * 0.4);
        const on = run(under, true);
        const off = run(under, false);
        for (const y of on) {
            expect(y.taxDetails.aca ?? 0).toBe(0);
        }
        expect(netWorth(on[on.length - 1].accounts)).toBeCloseTo(netWorth(off[off.length - 1].accounts), 6);
    });
});
