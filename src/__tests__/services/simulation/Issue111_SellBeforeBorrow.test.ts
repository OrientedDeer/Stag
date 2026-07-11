/**
 * #111 — a retirement drawdown must reach an account the configured withdrawal
 * order leaves out before reporting a (false) deficit.
 *
 * Scenario (from the user): the order is locked to Roth, a Traditional balance is
 * ignored, and a spending need the Roth can't cover shows up as a deficit — even
 * though the household never went negative. The fix lets solveRetirementYear tap
 * the omitted Traditional as a last resort. "Failure" then means genuinely going
 * negative (every sellable account drained), which the control test pins.
 */
import { describe, it, expect } from 'vitest';
import { InvestedAccount } from '../../../components/Objects/Accounts/models';
import {
    type AssumptionsState,
    defaultAssumptions,
    createBuiltinMilestones,
} from '../../../components/Objects/Assumptions/AssumptionsContext';
import { type TaxState } from '../../../components/Objects/Taxes/TaxContext';
import { solveYear, type YearSolverInput } from '../../../services/simulation/YearSolver';

const YEAR = 2030;

function taxState(): TaxState {
    return {
        filingStatus: 'Single',
        stateResidency: 'Texas',
        deductionMethod: 'Standard',
        fedOverride: null,
        ficaOverride: null,
        stateOverride: null,
        year: YEAR,
    };
}

function assumptions(): AssumptionsState {
    return {
        ...defaultAssumptions,
        milestones: createBuiltinMilestones(1958, 60, 95), // age 72 in 2030
        macro: { ...defaultAssumptions.macro, inflationAdjusted: false, inflationRate: 0 },
        investments: { ...defaultAssumptions.investments, taxOptimizationEnabled: false, returnRates: { ror: 0 } },
    };
}

function retirementInput(accounts: InvestedAccount[], withdrawalOrder: string[]): YearSolverInput {
    return {
        year: YEAR,
        currentAge: 72,
        isRetired: true,
        incomes: [],
        expenses: [],
        totalLivingExpenses: 40000,
        rmdAmount: 0,
        accounts,
        withdrawalOrder: withdrawalOrder.map(accountId => ({ accountId })),
        taxState: taxState(),
        assumptions: assumptions(),
        taxOptimizationEnabled: false,
        acaAware: false,
        previousSimulation: [],
    };
}

// ror=0 so balances don't grow within the year; basis = balance so a Roth/Trad
// draw is clean (Roth qualified at 72, Traditional fully ordinary).
const roth = () => new InvestedAccount('roth-1', 'Roth IRA', 10000, 0, 10, 0.0, 'Roth IRA', false, 0, 10000);
const trad = () => new InvestedAccount('trad-1', 'Traditional IRA', 500000, 0, 10, 0.0, 'Traditional IRA', false, 0, 0);

describe('#111 retirement drawdown reaches an account the order ignores', () => {
    it('a Roth-only order with a large untouched Traditional taps the Trad instead of going to deficit', () => {
        // $40k need, Roth ($10k) is the ONLY listed account — far short — but a $500k
        // Traditional sits untouched. Pre-#111 the unfunded ~$30k became deficit debt
        // (a false "failure" with $500k on hand). Now the drawdown reaches the Trad.
        const plan = solveYear(retirementInput([roth(), trad()], ['roth-1']));

        const tradWithdrawn = plan.withdrawals
            .filter(w => w.source === 'traditional_ira' || w.source === 'traditional_401k')
            .reduce((s, w) => s + w.gross, 0);

        expect(tradWithdrawn).toBeGreaterThan(0);        // the omitted Trad was tapped
        expect(plan.unfundedDeficit).toBeLessThan(1);    // no phantom shortfall
    });

    it('control: with nothing else sellable, a true shortfall stays an unfunded deficit (went negative)', () => {
        // Order lists only the small Roth and there is genuinely nothing else to sell,
        // so the shortfall correctly remains unfunded — the household really is out of
        // money. Confirms the fallback never papers over genuine insolvency.
        const plan = solveYear(retirementInput([roth()], ['roth-1']));

        expect(plan.unfundedDeficit).toBeGreaterThan(1);
    });
});
