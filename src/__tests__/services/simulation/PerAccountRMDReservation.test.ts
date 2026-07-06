/**
 * The RMD must be reserved PER ACCOUNT, not lumped against the first Traditional
 * account.
 *
 * Regression for the 2026-07-06 deep-review MEDIUM finding (#174): the discretionary
 * withdrawal planner reads the raw (undrained) account balances, so the solver
 * reserves the RMD from each account's snapshot to stop the planner re-withdrawing
 * dollars the RMD already claimed. The prior code reserved the ENTIRE RMD against
 * only the first Traditional account. With two equal Traditional IRAs at 75, that
 * over-reserved account A (stranding balance) and left account B unreserved — so the
 * planner could withdraw B's FULL balance on top of B's own RMD drain, fabricating
 * ~$4,065 of phantom spendable cash.
 *
 * RMDService drains each account by its OWN required distribution; the reservation
 * must match that per account.
 */
import { describe, it, expect } from 'vitest';
import { solveRetirementYear, YearSolverInput } from '../../../services/simulation/YearSolver';
import { InvestedAccount } from '../../../components/Objects/Accounts/models';
import { OtherExpense } from '../../../components/Objects/Expense/models';
import { calculateRMD } from '../../../data/RMDData';
import { AssumptionsState, defaultAssumptions, createBuiltinMilestones } from '../../../components/Objects/Assumptions/AssumptionsContext';
import { TaxState } from '../../../components/Objects/Taxes/TaxContext';

const YEAR = 2030;
const AGE = 75;
const BIRTH_YEAR = YEAR - AGE;
const BALANCE = 100_000;

describe('Per-account RMD reservation (#174)', () => {
    it('reserves each account\'s own RMD so the planner cannot over-draw the second Traditional account', () => {
        const tradA = new InvestedAccount('trad-a', 'Traditional IRA A', BALANCE, 0, 20, 0.0, 'Traditional IRA');
        const tradB = new InvestedAccount('trad-b', 'Traditional IRA B', BALANCE, 0, 20, 0.0, 'Traditional IRA');

        // A large living-expense deficit with no income forces the planner to drain
        // BOTH Traditional accounts down to their reserved caps.
        const expenses = [new OtherExpense('exp-1', 'Living', 250_000, 'Annually', new Date('2020-01-01'))];

        const assumptions: AssumptionsState = {
            ...defaultAssumptions,
            milestones: createBuiltinMilestones(BIRTH_YEAR, 60, 95),
            macro: { ...defaultAssumptions.macro, inflationAdjusted: false },
            investments: {
                ...defaultAssumptions.investments,
                taxOptimizationEnabled: false,
                acaAware: false,
                returnRates: { ror: 0 },
            },
            withdrawalStrategy: [
                { id: 'ws-a', name: 'Traditional IRA A', accountId: 'trad-a' },
                { id: 'ws-b', name: 'Traditional IRA B', accountId: 'trad-b' },
            ],
        };

        const taxState: TaxState = {
            filingStatus: 'Single', stateResidency: 'Texas', deductionMethod: 'Standard',
            fedOverride: null, ficaOverride: null, stateOverride: null, year: YEAR,
        };

        // Both accounts have the same balance → the same per-account RMD.
        const perAccountRMD = calculateRMD(BALANCE, AGE);
        expect(perAccountRMD).toBeGreaterThan(0);

        const input: YearSolverInput = {
            year: YEAR,
            currentAge: AGE,
            isRetired: true,
            incomes: [],
            expenses,
            totalLivingExpenses: 250_000,
            // Total required distribution across BOTH accounts (matches what
            // RMDService drains); its presence triggers the per-account reservation.
            rmdAmount: perAccountRMD * 2,
            accounts: [tradA, tradB],
            withdrawalOrder: [{ accountId: 'trad-a' }, { accountId: 'trad-b' }],
            taxState,
            assumptions,
            taxOptimizationEnabled: false,
            acaAware: false,
        };

        const plan = solveRetirementYear(input);

        // The RMD is reported against the first Traditional account; every draw on
        // account B is discretionary ('Spending deficit'). It must not exceed B's own
        // post-RMD available balance — the prior code let it reach the full $100k.
        const discretionaryFromB = plan.withdrawals
            .filter(w => w.accountId === 'trad-b')
            .reduce((s, w) => s + w.gross, 0);

        const bAvailableAfterOwnRMD = BALANCE - perAccountRMD; // ≈ $95,935

        // The scenario really drains B (otherwise it proves nothing).
        expect(discretionaryFromB).toBeGreaterThan(0);
        // B is capped at its OWN post-RMD balance — no phantom ~$4,065.
        expect(discretionaryFromB).toBeLessThanOrEqual(bAvailableAfterOwnRMD + 1);
    });
});
