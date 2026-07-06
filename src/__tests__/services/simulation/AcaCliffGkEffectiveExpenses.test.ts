/**
 * The rate-match ACA-cliff conversion estimator must use the GK-EFFECTIVE
 * living expenses, not the un-trimmed total.
 *
 * Regression for the 2026-06-24 deep-review LOW finding: estimateMAGI inside
 * planConversion (rate-match strategy) derived its spending deficit from
 * input.totalLivingExpenses, while the authoritative solver loop spends the
 * GK-trimmed effectiveLivingExpenses. Under Guardrails trimming the un-trimmed
 * total overstated the deficit -> overstated brokerage LTCG -> overstated
 * predicted MAGI -> the ACA binary search cut the Roth conversion more than
 * necessary (it under-converted).
 *
 * Setup: a sub-65 ACA-aware retiree on the rate-match strategy with a large
 * Traditional balance (so the conversion ceiling is a positive 22%) and a
 * low-basis brokerage so the spending deficit realizes LTCG that pushes the
 * estimated MAGI right up against the ~$64.4k single ACA cliff. GK trimming is
 * active: totalLivingExpenses $55k but the GK budget is $40k, so the
 * authoritative loop only spends $40k.
 *
 * With the bug the ACA search sized the conversion off the $55k deficit and cut
 * it to ~$11.3k. With the fix it sizes off the trimmed $40k deficit and permits
 * ~$22.3k while keeping MAGI under the cliff. The regression asserts the
 * conversion exceeds the old throttled amount.
 */
import { describe, it, expect } from 'vitest';
import { solveRetirementYear, YearSolverInput } from '../../../services/simulation/YearSolver';
import { getAcaCliffThreshold } from '../../../services/simulation/TaxOptimizedWithdrawal';
import { InvestedAccount } from '../../../components/Objects/Accounts/models';
import { PassiveIncome } from '../../../components/Objects/Income/models';
import { OtherExpense } from '../../../components/Objects/Expense/models';
import { AssumptionsState, defaultAssumptions, createBuiltinMilestones } from '../../../components/Objects/Assumptions/AssumptionsContext';
import { TaxState } from '../../../components/Objects/Taxes/TaxContext';

const BIRTH_YEAR = 1970; // Age 60 in 2030: retired, sub-65 (ACA cliff active), no early-withdrawal penalty
// 400% FPL, single, INFLATED forward to 2030 from the latest published table (2026)
// — the same #185-inflated cliff the engine now enforces. (Was hardcoded to the frozen
// $64,400 2026 value, which under-#185 let the solver correctly raise the ceiling.)
const ACA_CLIFF_SINGLE_2030 = getAcaCliffThreshold('single', 2030, defaultAssumptions);

function buildInput(): YearSolverInput {
    const traditional = new InvestedAccount('trad-1', 'Traditional IRA', 2500000, 0, 20, 0.05, 'Traditional IRA');
    const roth = new InvestedAccount('roth-1', 'Roth IRA', 50000, 0, 20, 0.05, 'Roth IRA');
    // Low-basis brokerage (80% gain ratio): the deficit draw realizes substantial LTCG -> MAGI.
    const brokerage = new InvestedAccount('brokerage-1', 'Brokerage', 300000, 0, 15, 0.07, 'Brokerage', true, 0.8, 60000);
    const pension = new PassiveIncome('pension-1', 'Pension', 30000, 'Annually', 'No', 'Other', new Date('2010-01-01'), undefined, false);

    const expenses = [new OtherExpense('exp-1', 'Living', 55000, 'Annually', new Date('2010-01-01'))];

    const assumptions: AssumptionsState = {
        ...defaultAssumptions,
        milestones: createBuiltinMilestones(BIRTH_YEAR, 60, 95),
        investments: {
            ...defaultAssumptions.investments,
            taxOptimizationEnabled: true,
            rothConversionStrategy: 'rate-match',
            returnRates: { ror: 5 },
        },
        withdrawalStrategy: [
            { id: 'ws-1', name: 'Brokerage', accountId: 'brokerage-1' },
            { id: 'ws-2', name: 'Traditional', accountId: 'trad-1' },
        ],
    };

    const taxState: TaxState = {
        filingStatus: 'Single', stateResidency: 'Texas', deductionMethod: 'Standard',
        fedOverride: null, ficaOverride: null, stateOverride: null, year: 2030,
    };

    return {
        year: 2030, currentAge: 60, isRetired: true, incomes: [pension], expenses,
        totalLivingExpenses: 55000, rmdAmount: 0,
        accounts: [traditional, roth, brokerage],
        withdrawalOrder: [{ accountId: 'brokerage-1' }, { accountId: 'trad-1' }],
        taxState, assumptions, taxOptimizationEnabled: true, acaAware: true,
        // GK trimming: budget below total living expenses, fixed below budget, so
        // effectiveLivingExpenses = gkBudget ($40k) < totalLivingExpenses ($55k).
        gkBudget: 40000, fixedExpenses: 30000, discretionaryExpenses: 25000,
    };
}

describe('ACA-cliff conversion estimate uses GK-effective living expenses', () => {
    it('does not under-convert by deriving the ACA deficit from un-trimmed total expenses', () => {
        const yearPlan = solveRetirementYear(buildInput());

        // Conversion income is the realized Roth conversion for the year.
        const converted = yearPlan.income.conversionIncome;

        // Sanity: the ACA binary search is actually engaged (a positive but
        // cliff-limited conversion). If it weren't, the test would be vacuous.
        expect(converted).toBeGreaterThan(0);
        // The search keeps MAGI at/under the cliff (with the engine's $1k buffer).
        expect(yearPlan.magi).toBeLessThanOrEqual(ACA_CLIFF_SINGLE_2030);

        // Bug behavior sized the ACA cut off the un-trimmed $55k deficit and
        // throttled the conversion to ~$11.3k. The fix sizes off the trimmed
        // $40k deficit and permits ~$22.3k. Require materially more than the old
        // throttled amount.
        expect(converted).toBeGreaterThan(15000);
    });
});
